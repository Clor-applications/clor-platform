import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Probation (docs/people/02-PRD.md LIFE-03): a review, then confirm, extend
 * or end; each outcome recorded through the one write path, the person told;
 * and a request where the company has a rule.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `prob.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Prob Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
async function colleague(boss: Ctx, name: string, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('probation', () => {
  it('a review is saved against the period; confirming sets the date, writes history and tells the person', async () => {
    const e = (await people(hr).post('/employees', { name: 'Meera Shah', code: 'PR-1', dateOfJoining: '2026-08-01', probationEndDate: '2026-11-01' }).expect(201)).body.employee;
    const review = (await people(hr).post(`/employees/${e.id}/probation/review`, { goals: 'Ship the Pune redesign', observations: 'Delivered early, strong with clients', recommendation: 'CONFIRM' }).expect(201)).body.review;
    expect(review).toMatchObject({ periodEnd: '2026-11-01', recommendation: 'CONFIRM', outcome: null });
    const r = (await people(hr).post(`/employees/${e.id}/probation/decide`, { outcome: 'CONFIRM', note: 'Welcome aboard' }).expect(200)).body;
    expect(r.applied.confirmedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const row = await runInTenant(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: e.id } }));
    expect(row.confirmedOn).toBe(r.applied.confirmedOn);
    const history = (await people(hr).get(`/employees/${e.id}/history`).expect(200)).body.events;
    expect(history.find((x: any) => x.kind === 'CONFIRMED')).toMatchObject({ title: 'Confirmed after probation', effectiveDate: r.applied.confirmedOn });
    expect((await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.count({ where: { employeeId: e.id, name: 'people.employee.probation_confirmed.v1' } })))).toBe(1);
    const reviews = (await people(hr).get(`/employees/${e.id}/probation`).expect(200)).body.reviews;
    expect(reviews[0]).toMatchObject({ outcome: 'CONFIRM', note: 'Welcome aboard' });
    /* Once confirmed, there is nothing more to decide. */
    await people(hr).post(`/employees/${e.id}/probation/decide`, { outcome: 'EXTEND', newEndDate: '2027-01-01' }).expect(409);
  });

  it('extending asks for a later date; ending records a termination on the last day', async () => {
    const e = (await people(hr).post('/employees', { name: 'Ravi Kumar', code: 'PR-2', dateOfJoining: '2026-08-01', probationEndDate: '2026-11-01' }).expect(201)).body.employee;
    await people(hr).post(`/employees/${e.id}/probation/decide`, { outcome: 'EXTEND' }).expect(400);
    await people(hr).post(`/employees/${e.id}/probation/decide`, { outcome: 'EXTEND', newEndDate: '2026-10-01' }).expect(400);
    const ext = (await people(hr).post(`/employees/${e.id}/probation/decide`, { outcome: 'EXTEND', newEndDate: '2027-01-31', note: 'Three more months' }).expect(200)).body;
    expect(ext.applied).toEqual({ probationEndDate: '2027-01-31' });
    const lines = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findMany({ where: { employeeId: e.id, field: 'probationEndDate' } }));
    expect(lines).toEqual([expect.objectContaining({ before: '2026-11-01', after: '2027-01-31', reason: 'Three more months' })]);
    const end = (await people(hr).post(`/employees/${e.id}/probation/decide`, { outcome: 'END', lastDay: '2027-01-31', note: 'Not confirmed' }).expect(200)).body;
    expect(end.applied).toMatchObject({ left: true, lastDay: '2027-01-31' });
    const row = await runInTenant(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: e.id } }));
    expect(row).toMatchObject({ status: 'LEFT', leavingType: 'TERMINATED', dateOfLeaving: '2027-01-31' });
  });

  it('with a rule, the decision is a request; approving it applies the outcome with the request on the log', async () => {
    const head = await colleague(hr, 'Priya', ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::APPROVE']);
    await people(hr).post('/approval-rules', { requestType: 'PROBATION', name: 'Probation', steps: [{ approver: { kind: 'USER', id: head.userId }, dueDays: 3 }] }).expect(201);
    const e = (await people(hr).post('/employees', { name: 'Anil Iyer', code: 'PR-3', dateOfJoining: '2026-08-01', probationEndDate: '2026-11-01' }).expect(201)).body.employee;
    const r = (await people(hr).post(`/employees/${e.id}/probation/decide`, { outcome: 'CONFIRM', note: 'Good quarter' }).expect(200)).body;
    expect(r.request).toMatchObject({ requestType: 'PROBATION', status: 'WAITING' });
    expect((await runInTenant(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: e.id } }))).confirmedOn).toBeNull();
    const done = (await people(head).post(`/requests/${r.request.id}/approve`, {}).expect(200)).body;
    expect(done.request.status).toBe('APPROVED');
    expect(done.outcome.confirmedOn).toBeTruthy();
    const line = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findFirst({ where: { employeeId: e.id, field: 'confirmedOn' } }));
    expect(line).toMatchObject({ source: 'APPROVAL', requestId: r.request.id });
  });
});
