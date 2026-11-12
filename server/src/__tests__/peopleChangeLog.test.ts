import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The change log (docs/people/02-PRD.md FND-04; review R-10) and the one
 * write path (FND-08): every change to a person leaves before-and-after
 * lines in the same transaction, sensitive values are never written, the
 * log cannot be edited, and the form, the import and a hire all leave the
 * same trail.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { updateEmployee } = await import('../services/people/employees.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function owner(): Promise<Ctx> {
  const email = `log.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Log Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  ctx.accountId = me.body.orgs.find((o: any) => o.orgId === ctx.orgId).accountId;
  return ctx;
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const logOf = (c: Ctx, employeeId: string) => runInTenant(c.orgId, () => peoplePrisma.changeLog.findMany({ where: { orgId: c.orgId, employeeId }, orderBy: { at: 'asc' } }));

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('the change log', () => {
  it('a field change leaves one line with before, after, who, why and the request id', async () => {
    const dept = (await people(hr).post('/structure/departments', { name: 'Design' }).expect(201)).body.item;
    const e = (await people(hr).post('/employees', { name: 'Meera Shah', code: 'L-1', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const created = await logOf(hr, e.id);
    expect(created).toEqual([expect.objectContaining({ entity: 'Employee', field: 'record', after: 'created', source: 'FORM' })]);
    expect(created[0].correlationId).toBeTruthy();

    await people(hr).put(`/employees/${e.id}`, { departmentId: dept.id, phone: '9800000001', changeNote: 'Joined the studio' }).expect(200);
    const lines = await logOf(hr, e.id);
    const byField = Object.fromEntries(lines.map((l) => [l.field, l]));
    expect(byField.departmentId).toMatchObject({ before: null, after: dept.id, reason: 'Joined the studio', source: 'FORM', redacted: false });
    expect(byField.department).toMatchObject({ before: null, after: 'Design' });
    expect(byField.phone).toMatchObject({ before: null, after: '9800000001' });
    expect(byField.departmentId.actorUserId).toBeTruthy();
    /* Everything one request did shares one correlation id, which is not the create's. */
    expect(byField.phone.correlationId).toBe(byField.departmentId.correlationId);
    expect(byField.phone.correlationId).not.toBe(created[0].correlationId);
  });

  it('a sensitive field is logged as changed, without its value', async () => {
    const e = (await people(hr).post('/employees', { name: 'Ravi Kumar', code: 'L-2' }).expect(201)).body.employee;
    await people(hr).put(`/employees/${e.id}`, { devicePassword: '4321' }).expect(200);
    const line = (await logOf(hr, e.id)).find((l) => l.field === 'devicePassword');
    expect(line).toMatchObject({ redacted: true, before: null, after: null });
  });

  it('the change and its log fail together', async () => {
    const e = (await people(hr).post('/employees', { name: 'Anil Iyer', code: 'L-3' }).expect(201)).body.employee;
    const row = await runInTenant(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: e.id } }));
    const actor = { accountId: hr.accountId, orgId: hr.orgId, userId: null, source: 'API' as const, correlationId: `test-${rnd()}` };
    await expect(
      runInTenant(hr.orgId, () => updateEmployee(actor, row, { city: 'Pune' }, { afterWrite: async () => { throw new Error('the lights went out'); } })),
    ).rejects.toThrow('the lights went out');
    const after = await runInTenant(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: e.id } }));
    expect(after.city).toBeNull();
    expect((await logOf(hr, e.id)).filter((l) => l.field === 'city')).toHaveLength(0);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.count({ where: { correlationId: actor.correlationId } }))).toBe(0);
  });

  it('nothing edits or removes a line', async () => {
    const e = (await people(hr).post('/employees', { name: 'Farah Nair', code: 'L-4' }).expect(201)).body.employee;
    const [line] = await logOf(hr, e.id);
    await expect(runInTenant(hr.orgId, () => peoplePrisma.changeLog.update({ where: { id: line.id }, data: { after: 'tampered' } }))).rejects.toThrow(/append_only/);
    await expect(runInTenant(hr.orgId, () => peoplePrisma.changeLog.delete({ where: { id: line.id } }))).rejects.toThrow(/append_only/);
  });

  it('the form, the import and a hire leave the same trail: a log line, a stint, history and an event', async () => {
    const fromForm = (await people(hr).post('/employees', { name: 'Form Person', code: 'L-5', dateOfJoining: '2026-02-01' }).expect(201)).body.employee;
    const imported = await people(hr).post('/employees/import', { rows: [{ name: 'Import Person', code: 'L-6', dateOfJoining: '2026-02-01' }] }).expect(200);
    const fromImport = imported.body.results[0].id;
    const job = (await people(hr).post('/talent/openings', { title: 'Guard', status: 'OPEN' }).expect(201)).body.opening;
    const candidate = (await people(hr).post('/talent/candidates', { openingId: job.id, name: 'Hired Person', email: 'h@example.com' }).expect(201)).body.candidate;
    await people(hr).post(`/talent/candidates/${candidate.id}/stage`, { stage: 'OFFER' }).expect(200);
    const hired = (await request(app).post(`/api/orgs/${hr.orgId}/people/talent/candidates/${candidate.id}/hire`).set(at(hr)).send({ code: 'L-7', dateOfJoining: '2026-02-01', withoutOffer: true, reason: 'Terms agreed in person' }).expect(201)).body.employee;
    for (const [id, source] of [[fromForm.id, 'FORM'], [fromImport, 'IMPORT'], [hired.id, 'HIRE']] as const) {
      const lines = await logOf(hr, id);
      /* A hire also sends the joining form and the app invite (People plan 8 Nov 2026, step 4): those lines follow the one for the record. */
      expect(lines.filter((l: any) => l.field === 'record'), source).toEqual([expect.objectContaining({ field: 'record', after: 'created', source })]);
      if (source === 'HIRE') expect(lines.map((l: any) => l.field), source).toEqual(expect.arrayContaining(['invite', 'appAccess']));
      expect(await runInTenant(hr.orgId, () => peoplePrisma.employmentEpisode.count({ where: { employeeId: id } })), source).toBe(1);
      const history = (await people(hr).get(`/employees/${id}/history`).expect(200)).body;
      expect(history.events.map((x: any) => x.kind), source).toContain('JOINED');
      const events = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findMany({ where: { employeeId: id } }));
      expect(events.map((x) => x.name), source).toContain('people.employee.created.v1');
      if (source !== 'HIRE') expect(events.map((x) => x.name), source).toEqual(['people.employee.created.v1']);
    }
  });
});
