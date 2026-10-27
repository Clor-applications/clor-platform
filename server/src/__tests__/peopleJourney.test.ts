import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The journey and Why (docs/people/02-PRD.md CORE-06, TRACE-01, TRACE-02):
 * every change in order under its stint; a promotion through a request
 * shows date, before and after, approver, rule version and request; a
 * change made by hand says plainly that no approval was recorded.
 */
const { buildApp } = await import('../app.js');
const { deliverOutbox } = await import('../services/people/outbox.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `why.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Why Co ${rnd()}`, state: 'Karnataka' }).expect(200);
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
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('the journey and Why', () => {
  it('a promotion through a request shows before and after, who asked, who approved, the rule version and the request; a change by hand says no approval was recorded', async () => {
    const head = await colleague(hr, 'Head', ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::APPROVE']);
    const junior = (await people(hr).post('/structure/job-positions', { name: 'Designer' }).expect(201)).body.item;
    const senior = (await people(hr).post('/structure/job-positions', { name: 'Senior designer' }).expect(201)).body.item;
    const e = (await people(hr).post('/employees', { name: 'Nisha Verma', code: 'J-1', dateOfJoining: '2026-01-05', jobPositionId: junior.id }).expect(201)).body.employee;

    /* By hand, with a reason: no approval to record. */
    await people(hr).put(`/employees/${e.id}`, { phone: '9876501234', changeNote: 'New SIM' }).expect(200);
    /* Through a rule: the promotion waits, then the head approves it. */
    await people(hr).post('/approval-rules', { requestType: 'JOB_CHANGE', name: 'Job changes', steps: [{ approver: { kind: 'USER', id: head.userId }, dueDays: 3 }] }).expect(201);
    const sent = (await people(hr).put(`/employees/${e.id}`, { jobPositionId: senior.id, changeNote: 'Promotion after the Pune launch' }).expect(200)).body;
    expect(sent.request.status).toBe('WAITING');
    await people(head).post(`/requests/${sent.request.id}/approve`, { comment: 'Well earned' }).expect(200);
    await deliverOutbox(new Date(), 1000);

    const journey = (await people(hr).get(`/employees/${e.id}/journey`).expect(200)).body;
    expect(journey.entries.map((x: any) => [x.kind, x.summary])).toEqual([
      ['APPROVED', 'Designation changed'],
      ['CHANGE', 'Phone changed'],
      ['CHANGE', 'Joined the record'],
    ]);
    expect(journey.entries.every((x: any) => x.stint === 1)).toBe(true);
    const promo = journey.entries[0];
    expect(promo.changes.map((c: any) => [c.field, c.before, c.after])).toEqual([['Designation', 'Designer', 'Senior designer']]);

    const why = (await people(hr).get(`/employees/${e.id}/why/${promo.key}`).expect(200)).body.why;
    expect(why.askedBy).toBe('Asha HR');
    expect(why.approvedBy).toEqual(['Head: Well earned']);
    expect(why.rule).toMatchObject({ name: 'Job changes', version: 1, type: 'JOB_CHANGE' });
    expect(why.request).toMatchObject({ id: sent.request.id, status: 'APPROVED' });
    expect(why.reason).toBe('Promotion after the Pune launch');
    expect(why.downstream.events.map((x: any) => x.name)).toEqual(expect.arrayContaining(['people.employment.changed.v1']));
    expect(why.unknown).not.toEqual(expect.arrayContaining([expect.stringMatching(/No approval recorded/)]));

    const byHand = journey.entries[1];
    const why2 = (await people(hr).get(`/employees/${e.id}/why/${byHand.key}`).expect(200)).body.why;
    expect(why2.what).toEqual([{ field: 'Phone', key: 'phone', before: null, after: '9876501234', redacted: false }]);
    expect(why2.approvedBy).toBeNull();
    expect(why2.unknown).toEqual(expect.arrayContaining([expect.stringMatching(/^No approval recorded: changed by hand/)]));
    expect(why2.reason).toBe('New SIM');
    await people(hr).get(`/employees/${e.id}/why/nope`).expect(404);
  });

  it('a second stint groups its changes apart, and pre-log history says it came before the change log', async () => {
    const e = (await people(hr).post('/employees', { name: 'Ravi Das', code: 'J-2', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    await people(hr).post(`/employees/${e.id}/resign`, { lastDay: '2025-12-31', leavingType: 'RESIGNED' }).expect(200);
    await people(hr).post(`/employees/${e.id}/rehire`, { rejoinDate: '2026-03-01' }).expect(200);
    await people(hr).put(`/employees/${e.id}`, { phone: '9000000002' }).expect(200);
    const journey = (await people(hr).get(`/employees/${e.id}/journey`).expect(200)).body;
    expect(journey.episodes.map((s: any) => s.seq)).toEqual([1, 2]);
    /* Today's change falls in stint 2; the record's creation line is dated today too, so the stint is by the day the change was made, not the joining date. */
    expect(journey.entries[0]).toMatchObject({ kind: 'CHANGE', summary: 'Phone changed', stint: 2 });
    const { peoplePrisma } = await import('../utils/peoplePrisma.js');
    const { runInTenant } = await import('../utils/tenantScope.js');
    /* History that predates the change log: planted the way an old record would carry it. */
    await runInTenant(hr.orgId, () => peoplePrisma.changeLog.deleteMany({ where: { employeeId: e.id } })).catch(() => undefined);
    const old = await runInTenant(hr.orgId, () => peoplePrisma.employmentEvent.create({ data: { accountId: hr.orgId, orgId: hr.orgId, employeeId: e.id, kind: 'CHANGED', field: 'departmentId', fromLabel: 'Ops', toLabel: 'Sales', effectiveDate: '2025-06-01', source: 'FORM' } }));
    const why = (await people(hr).get(`/employees/${e.id}/why/history_${old.id}`).expect(200)).body.why;
    expect(why.unknown).toEqual(['No approval recorded: changed before the change log started.', 'No evidence attached: recorded in employment history only.']);
    expect(why.what).toEqual([{ field: 'Department', before: 'Ops', after: 'Sales' }]);
  });
});
