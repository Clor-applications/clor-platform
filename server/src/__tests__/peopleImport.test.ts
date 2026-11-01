import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Import (docs/people/02-PRD.md CORE-07): preview lists the bad rows and
 * the matches; commit takes the good rows; update mode changes people by
 * code; undo within a day removes exactly what was made, with its events,
 * and puts changed people back.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `imp.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Imp Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true } }).expect(200);
  return ctx;
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('import', () => {
  it('200 rows, 3 bad: preview lists 3 and the matches; commit takes 197; undo removes exactly 197 and their events', async () => {
    await people(hr).post('/employees', { name: 'Already Here', code: 'OLD-1', dateOfJoining: '2025-01-05', phone: '9000000777' }).expect(201);
    const rows = Array.from({ length: 200 }, (_, i) => ({ name: `Person ${i + 1}`, code: `IM-${i + 1}`, department: i % 2 ? 'Operations' : 'Security', jobPosition: 'Guard', dateOfJoining: '2026-11-01' }));
    rows[4] = { ...rows[4], name: '' } as any; // no name
    rows[9] = { ...rows[9], code: 'OLD-1' }; // code already here
    rows[19] = { ...rows[19], dateOfJoining: 'next monday' } as any; // not a date
    rows[29] = { ...rows[29], phone: '9000000777' } as any; // same phone as someone here: a warning, not an error

    const preview = (await people(hr).post('/employees/import', { rows, dryRun: true }).expect(200)).body;
    expect(preview).toMatchObject({ dryRun: true, imported: 197, failed: 3, batchId: null });
    expect(preview.results.filter((r: any) => !r.ok).map((r: any) => r.row)).toEqual([5, 10, 20]);
    expect(preview.results.find((r: any) => r.row === 30).warning).toMatch(/Same phone as Already Here/);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.employee.count({ where: { orgId: hr.orgId } }))).toBe(1);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.department.count({ where: { orgId: hr.orgId } }))).toBe(0);

    const done = (await people(hr).post('/employees/import', { rows }).expect(200)).body;
    expect(done).toMatchObject({ imported: 197, failed: 3, mode: 'CREATE' });
    expect(done.batchId).toBeTruthy();
    expect(new Date(done.undoUntil).getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.employee.count({ where: { orgId: hr.orgId } }))).toBe(198);
    const events = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.count({ where: { orgId: hr.orgId, name: 'people.employee.created.v1' } }));
    expect(events).toBe(198);
    expect((await people(hr).get('/employees/import/batches').expect(200)).body.batches[0]).toMatchObject({ id: done.batchId, created: 197, updated: 0, failed: 3, canUndo: true });

    const undone = (await people(hr).post(`/employees/import/${done.batchId}/undo`, {}).expect(200)).body;
    expect(undone).toEqual({ removed: 197, restored: 0, kept: 0 });
    expect(await runInTenant(hr.orgId, () => peoplePrisma.employee.count({ where: { orgId: hr.orgId } }))).toBe(1);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.count({ where: { orgId: hr.orgId, name: 'people.employee.created.v1' } }))).toBe(1);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.changeLog.count({ where: { orgId: hr.orgId, after: 'removed: import undone' } }))).toBe(197);
    await people(hr).post(`/employees/import/${done.batchId}/undo`, {}).expect(409);
  });

  it('update mode changes people by code and only the columns given; undo puts them back; a day later undo is refused', async () => {
    const a = (await people(hr).post('/employees', { name: 'Asha Rao', code: 'UP-1', dateOfJoining: '2025-01-05', phone: '9111111111' }).expect(201)).body.employee;
    await people(hr).post('/employees/import', { rows: [{ name: 'Asha Rao', code: 'UP-1', department: 'Finance' }] }).expect(200).then((r) => expect(r.body.failed).toBe(1));
    const done = (await people(hr).post('/employees/import', { rows: [{ name: 'Asha R Rao', code: 'UP-1', department: 'Finance' }, { name: 'New Person', code: 'UP-2' }], mode: 'update' }).expect(200)).body;
    expect(done.results.map((r: any) => r.action)).toEqual(['UPDATE', 'CREATE']);
    const after = (await people(hr).get(`/employees/${a.id}`).expect(200)).body.employee;
    expect(after).toMatchObject({ name: 'Asha R Rao', department: 'Finance', phone: '9111111111' });
    const undone = (await people(hr).post(`/employees/import/${done.batchId}/undo`, {}).expect(200)).body;
    expect(undone).toEqual({ removed: 1, restored: 1, kept: 0 });
    const back = (await people(hr).get(`/employees/${a.id}`).expect(200)).body.employee;
    expect(back).toMatchObject({ name: 'Asha Rao', department: null, phone: '9111111111' });

    const old = (await people(hr).post('/employees/import', { rows: [{ name: 'Late Undo', code: 'UP-9' }] }).expect(200)).body;
    await runInTenant(hr.orgId, () => peoplePrisma.importBatch.update({ where: { id: old.batchId }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } }));
    const refused = await people(hr).post(`/employees/import/${old.batchId}/undo`, {}).expect(409);
    expect(refused.body.error).toContain('24 hours');
  });

  it('undo keeps anyone changed by hand since, and runs once (Workforce audit S9)', async () => {
    const done = (await people(hr).post('/employees/import', { rows: [{ name: 'Keep Me', code: `KM-${Date.now()}` }, { name: 'Drop Me', code: `DM-${Date.now()}` }] }).expect(200)).body;
    const kept = (await people(hr).get('/employees?q=Keep Me&status=ALL').expect(200)).body.employees[0];
    await new Promise((r) => setTimeout(r, 1100));
    await request(app).put(`/api/orgs/${hr.orgId}/people/employees/${kept.id}`).set(at(hr)).send({ phone: '9876543210' }).expect(200);
    const undone = (await people(hr).post(`/employees/import/${done.batchId}/undo`, {}).expect(200)).body;
    expect(undone).toEqual({ removed: 1, restored: 0, kept: 1 });
    await people(hr).get(`/employees/${kept.id}`).expect(200);
    /* Two clicks: the second finds it already undone. */
    await people(hr).post(`/employees/import/${done.batchId}/undo`, {}).expect(409);
  });

  it('reads Indian dates and plain gender, links the manager by employee ID and refuses an unknown work site (Workforce audit O16, O17)', async () => {
    const t = Date.now();
    const r = (await people(hr).post('/employees/import', { rows: [
      { name: 'Lead Person', code: `LP-${t}`, dateOfJoining: '05/10/2025', gender: 'Female' },
      { name: 'Team Member', code: `TM-${t}`, dateOfJoining: '1 Nov 2025', gender: 'm', managerCode: `LP-${t}` },
      { name: 'Nowhere Site', code: `NS-${t}`, workSite: 'Moon Base' },
      { name: 'Bad Date', code: `BD-${t}`, dateOfJoining: '31/02/2026' },
    ] }).expect(200)).body;
    const [lead, member, site, bad] = r.results;
    expect([lead.ok, member.ok, site.ok, bad.ok]).toEqual([true, true, false, false]);
    expect(site.error).toContain('Moon Base');
    expect(bad.error).toContain('does not exist');
    const m = (await request(app).get(`/api/orgs/${hr.orgId}/people/employees/${member.id}`).set(at(hr)).expect(200)).body.employee;
    expect(m).toMatchObject({ dateOfJoining: '2025-11-01', gender: 'MALE', reportingManagerId: lead.id });
    const l = (await request(app).get(`/api/orgs/${hr.orgId}/people/employees/${lead.id}`).set(at(hr)).expect(200)).body.employee;
    expect(l).toMatchObject({ dateOfJoining: '2025-10-05', gender: 'FEMALE' });
  });
});
