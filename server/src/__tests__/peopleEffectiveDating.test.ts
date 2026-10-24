import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Effective-dated changes (docs/people/02-PRD.md FND-02) and reading as of a
 * date (FND-03). A change dated next month waits, shows on the record, is
 * applied on its day once, and the directory can be read as it was.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { applyDueChanges } = await import('../services/people/effectiveDating.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `eff.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Eff Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  del: (path: string) => request(app).delete(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
});

let hr: Ctx;
let design: any;
let security: any;
beforeAll(async () => {
  hr = await owner();
  design = (await people(hr).post('/structure/departments', { name: 'Design' }).expect(201)).body.item;
  security = (await people(hr).post('/structure/departments', { name: 'Security' }).expect(201)).body.item;
}, 60_000);

describe('a change dated in the future', () => {
  it('waits on the record, shows as "changes on", and is applied on its day once', async () => {
    const e = (await people(hr).post('/employees', { name: 'Meera Shah', code: 'E-1', departmentId: design.id, dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    const r = await people(hr).put(`/employees/${e.id}`, { departmentId: security.id, effectiveFrom: '2099-12-01', changeNote: 'Moving to the night team' }).expect(200);
    expect(r.body.scheduled).toEqual([expect.objectContaining({ field: 'departmentId', fromLabel: 'Design', toLabel: 'Security', effectiveOn: '2099-12-01', status: 'PENDING' })]);
    /* Nothing changed today. */
    const now = (await people(hr).get(`/employees/${e.id}`).expect(200)).body;
    expect(now.employee.department).toBe('Design');
    expect(now.scheduledChanges).toEqual([expect.objectContaining({ field: 'departmentId', effectiveOn: '2099-12-01' })]);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.changeLog.count({ where: { employeeId: e.id, field: 'departmentId' } }))).toBe(0);

    /* The same form sent twice queues it once. */
    await people(hr).put(`/employees/${e.id}`, { departmentId: security.id, effectiveFrom: '2099-12-01' }).expect(200);
    expect((await people(hr).get(`/employees/${e.id}`).expect(200)).body.scheduledChanges).toHaveLength(1);

    /* Its day comes: applied once, through the one write path. */
    const first = await applyDueChanges('2099-12-01', 'run-a');
    expect(first.applied).toBeGreaterThanOrEqual(1);
    const again = await applyDueChanges('2099-12-01', 'run-b');
    expect(again.applied).toBe(0);
    const after = (await people(hr).get(`/employees/${e.id}`).expect(200)).body;
    expect(after.employee.department).toBe('Security');
    expect(after.scheduledChanges).toEqual([]);
    const lines = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findMany({ where: { employeeId: e.id, field: 'departmentId' } }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ before: design.id, after: security.id, source: 'SCHEDULED', reason: 'Moving to the night team' });
    const history = (await people(hr).get(`/employees/${e.id}/history`).expect(200)).body.events.find((x: any) => x.field === 'departmentId');
    expect(history).toMatchObject({ from: 'Design', to: 'Security', effectiveDate: '2099-12-01' });
    const events = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findMany({ where: { employeeId: e.id, name: 'people.employment.changed.v1' } }));
    expect(events).toHaveLength(1);
  });

  it('can be withdrawn before its day; a date in the past applies at once', async () => {
    const e = (await people(hr).post('/employees', { name: 'Ravi Kumar', code: 'E-2', departmentId: design.id }).expect(201)).body.employee;
    const r = await people(hr).put(`/employees/${e.id}`, { departmentId: security.id, effectiveFrom: '2099-06-01' }).expect(200);
    await people(hr).del(`/employees/${e.id}/scheduled/${r.body.scheduled[0].id}`).expect(200);
    expect((await people(hr).get(`/employees/${e.id}`).expect(200)).body.scheduledChanges).toEqual([]);
    await people(hr).put(`/employees/${e.id}`, { departmentId: security.id, effectiveFrom: '2026-01-10' }).expect(200);
    expect((await people(hr).get(`/employees/${e.id}`).expect(200)).body.employee.department).toBe('Security');
  });
});

describe('reading as of a date', () => {
  it('the directory shows where each person was, and who was not yet there', async () => {
    const a = (await people(hr).post('/employees', { name: 'Anil Iyer', code: 'E-3', departmentId: design.id, dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    await people(hr).put(`/employees/${a.id}`, { departmentId: security.id, effectiveFrom: '2026-03-01' }).expect(200);
    const late = (await people(hr).post('/employees', { name: 'Late Joiner', code: 'E-4', departmentId: design.id, dateOfJoining: '2026-06-01' }).expect(201)).body.employee;

    const asOf = (await people(hr).get('/employees?asOf=2026-02-01&limit=500').expect(200)).body.employees;
    const anil = asOf.find((x: any) => x.id === a.id);
    expect(anil.department).toBe('Design');
    expect(anil.departmentId).toBe(design.id);
    expect(asOf.find((x: any) => x.id === late.id)).toBeUndefined();

    const today = (await people(hr).get('/employees?limit=500').expect(200)).body.employees;
    expect(today.find((x: any) => x.id === a.id).department).toBe('Security');
    expect(today.find((x: any) => x.id === late.id)).toBeTruthy();

    const profile = (await people(hr).get(`/employees/${a.id}?asOf=2026-02-01`).expect(200)).body.employee;
    expect(profile).toMatchObject({ department: 'Design', asOf: '2026-02-01' });
  });

  it('someone who has left shows as they were on a date before they left', async () => {
    const e = (await people(hr).post('/employees', { name: 'Farah Nair', code: 'E-5', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    await people(hr).post(`/employees/${e.id}/resign`, { lastDay: '2026-04-30', leavingType: 'RESIGNED' }).expect(200);
    const before = (await people(hr).get('/employees?asOf=2026-03-01&limit=500').expect(200)).body.employees.find((x: any) => x.id === e.id);
    expect(before).toMatchObject({ status: 'ACTIVE', dateOfLeaving: null });
    const now = (await people(hr).get('/employees?status=LEFT&limit=500').expect(200)).body.employees.find((x: any) => x.id === e.id);
    expect(now.status).toBe('LEFT');
  });
});

describe('the directory beyond 500 people', () => {
  it('pages to the end and counts them all', async () => {
    const c = await owner();
    const org = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${c.token}`).expect(200);
    const accountId = org.body.orgs.find((o: any) => o.orgId === c.orgId).accountId;
    await runInTenant(c.orgId, () =>
      peoplePrisma.employee.createMany({ data: Array.from({ length: 620 }, (_, i) => ({ accountId, orgId: c.orgId, name: `Person ${String(i).padStart(3, '0')}`, code: `P-${i}`, status: 'ACTIVE', createdByUserId: 'seed' })) }),
    );
    const p1 = (await people(c).get('/employees?limit=500&offset=0').expect(200)).body;
    const p2 = (await people(c).get('/employees?limit=500&offset=500').expect(200)).body;
    expect(p1.total).toBe(620);
    expect(p1.employees).toHaveLength(500);
    expect(p2.employees).toHaveLength(120);
    expect(new Set([...p1.employees, ...p2.employees].map((x: any) => x.id)).size).toBe(620);
  }, 60_000);
});
