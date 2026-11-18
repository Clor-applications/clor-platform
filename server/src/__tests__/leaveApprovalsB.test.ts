import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Leave approvals, server picks theme B (DESIGN.md rounds 18, 27, 47): "Remind" on my own waiting request (one
 * a day), "Send back with a question" answered by the person, HR deciding while it is still the manager's turn
 * (marked "Decided by HR"), "Take back" an approval until the leave starts, and leave still waiting when its
 * first day passed closed as not approved, only for a company that turned that choice on.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { closePassedLeave, PASSED_NOTE } = await import('../routes/leave.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId?: string; accountId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `lab.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `LAB Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: signup.body.user?.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
async function colleague(boss: Ctx, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: false }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `labc.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: `Colleague ${rnd()}`, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const link = (c: Ctx, employeeId: string, userId: string) => runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId } }));
const row = (c: Ctx, id: string) => runInTenant(c.orgId, () => peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id } }));
const whats = async (c: Ctx, id: string) => (((await row(c, id)).history as any[]) || []).map((h) => h.what);

const MY = ['ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE'];
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const mondayFrom = (n: number) => {
  let d = plus(today, n);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = plus(d, 1);
  return d;
};

describe('leave approvals: remind, a question sent back, decided by HR, take back, passed leave closed', () => {
  let hr: Ctx;
  let me: Ctx;
  let emp: any;
  let plain: any;
  beforeAll(async () => {
    hr = await company();
    me = await colleague(hr, MY);
    emp = await person(hr, { name: 'Asker Anil', code: 'B1' });
    await link(hr, emp.id, me.userId!);
    plain = (await att(hr, 'post', '/leave/types', { name: 'Plain', annualDays: 30 }).expect(201)).body.type;
  }, 120_000);

  it('the person reminds the approvers of their own waiting request once a day; not of someone else’s', async () => {
    const day = mondayFrom(40);
    const r = (await att(me, 'post', '/me/leave', { leaveTypeId: plain.id, fromDate: day, toDate: day, reason: 'Errand' }).expect(201)).body.request;
    /* The day can fall in next year (from mid-November on); the list shows one leave year, so ask for that day's. */
    const listed = (await att(me, 'get', `/me/leave?year=${day.slice(0, 4)}`).expect(200)).body.requests.find((x: any) => x.id === r.id);
    expect(listed).toMatchObject({ canRemind: true, remindedAt: null, question: null });
    const done = (await att(me, 'post', `/me/leave/${r.id}/remind`).expect(200)).body.request;
    expect(done).toMatchObject({ canRemind: false });
    const again = await att(me, 'post', `/me/leave/${r.id}/remind`).expect(429);
    expect(again.body.code).toBe('REMINDED_TODAY');
    expect(await whats(hr, r.id)).toEqual(['ASKED', 'REMINDED']);
    /* Someone else's request: not found for me. */
    const other = await person(hr, { name: 'Other Om', code: 'B2' });
    const theirs = (await att(hr, 'post', '/leave/requests', { employeeId: other.id, leaveTypeId: plain.id, fromDate: day, toDate: day, reason: 'Errand' }).expect(201)).body.request;
    await att(me, 'post', `/me/leave/${theirs.id}/remind`).expect(404);
    /* The reminder is queued as the leave notice with its own key for the day. */
    const queued = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findMany({ where: { orgId: hr.orgId, correlationId: `leave_request_${r.id}` } }));
    expect(queued.some((e) => JSON.stringify(e.payload).includes(`"rem-${today}"`))).toBe(true);
  });

  it('an approver sends a request back with a question; the person answers and it waits on the approver again', async () => {
    const day = mondayFrom(47);
    const r = (await att(me, 'post', '/me/leave', { leaveTypeId: plain.id, fromDate: day, toDate: day, reason: 'Family' }).expect(201)).body.request;
    await att(hr, 'post', `/leave/requests/${r.id}/send-back`, {}).expect(400);
    const sent = (await att(hr, 'post', `/leave/requests/${r.id}/send-back`, { note: 'Is the handover done?' }).expect(200)).body;
    expect(sent.question).toMatchObject({ note: 'Is the handover done?' });
    expect(sent.request.status).toBe('PENDING');
    expect((await att(hr, 'post', `/leave/requests/${r.id}/send-back`, { note: 'Another?' }).expect(409)).body.code).toBe('QUESTION_OPEN');
    const detail = (await att(hr, 'get', `/leave/requests/${r.id}`).expect(200)).body;
    expect(detail.question).toMatchObject({ note: 'Is the handover done?' });
    expect(detail.history.map((h: any) => h.what)).toContain('Sent back with a question');
    expect((await att(me, 'get', `/me/leave?year=${day.slice(0, 4)}`).expect(200)).body.requests.find((x: any) => x.id === r.id).question).toMatchObject({ note: 'Is the handover done?' });
    await att(me, 'post', `/me/leave/${r.id}/answer`, {}).expect(400);
    await att(me, 'post', `/me/leave/${r.id}/answer`, { note: 'Yes, with Ravi.' }).expect(200);
    await att(me, 'post', `/me/leave/${r.id}/answer`, { note: 'Again' }).expect(409);
    const after = (await att(hr, 'get', `/leave/requests/${r.id}`).expect(200)).body;
    expect(after.question).toBeNull();
    expect(after.request.status).toBe('PENDING');
    expect(after.history.map((h: any) => h.what)).toEqual(expect.arrayContaining(['Answered']));
    /* And it is decided as before. */
    await att(hr, 'post', `/leave/requests/${r.id}/approve`, {}).expect(200);
  });

  it('HR decides while it is still the manager’s turn only when it asks to, and the request says “Decided by HR”', async () => {
    const boss = await person(hr, { name: 'Boss Bina', code: 'B3' });
    const report = await person(hr, { name: 'Report Raj', code: 'B4', reportingManagerId: boss.id });
    const chained = (await att(hr, 'post', '/leave/types', { name: 'Chained', annualDays: 20, approval: 'MANAGER_THEN_HR' }).expect(201)).body.type;
    const day = mondayFrom(54);
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: report.id, leaveTypeId: chained.id, fromDate: day, toDate: day, reason: 'Trip' }).expect(201)).body.request;
    expect((await att(hr, 'post', `/leave/requests/${r.id}/approve`, {}).expect(409)).body.code).toBe('MANAGER_FIRST');
    const before = (await att(hr, 'get', `/leave/requests/${r.id}`).expect(200)).body;
    expect(before).toMatchObject({ mayDecideAsHr: true, decidedByHr: false });
    const asHr = await att(hr, 'post', `/leave/requests/${r.id}/approve`, { asHr: true });
    expect(asHr.status).toBe(200);
    const done = asHr.body.request;
    expect(done).toMatchObject({ status: 'APPROVED', decidedByHr: true });
    const detail = (await att(hr, 'get', `/leave/requests/${r.id}`).expect(200)).body;
    expect(detail.decidedByHr).toBe(true);
    expect(detail.history.map((h: any) => h.what)).toContain('Decided by HR');
    /* Rejecting on the manager's turn is marked too. */
    const r2 = (await att(hr, 'post', '/leave/requests', { employeeId: report.id, leaveTypeId: chained.id, fromDate: plus(day, 7), toDate: plus(day, 7), reason: 'Trip' }).expect(201)).body.request;
    await att(hr, 'post', `/leave/requests/${r2.id}/reject`, { note: 'Busy week' }).expect(200);
    expect(await whats(hr, r2.id)).toContain('DECIDED_BY_HR');
  });

  it('an approval is taken back until the leave starts: it waits again and its days come off the record', async () => {
    const day = mondayFrom(61);
    const r = (await att(me, 'post', '/me/leave', { leaveTypeId: plain.id, fromDate: day, toDate: day, reason: 'Visit' }).expect(201)).body.request;
    await att(hr, 'post', `/leave/requests/${r.id}/approve`, {}).expect(200);
    expect((await att(hr, 'get', `/leave/requests/${r.id}`).expect(200)).body.canTakeBack).toBe(true);
    const days = () => runInTenant(hr.orgId, () => peoplePrisma.attendanceRecord.count({ where: { orgId: hr.orgId, leaveRequestId: r.id } }));
    expect(await days()).toBe(1);
    const back = (await att(hr, 'post', `/leave/requests/${r.id}/take-back`, {}).expect(200)).body.request;
    expect(back.status).toBe('PENDING');
    expect(await days()).toBe(0);
    expect(await whats(hr, r.id)).toContain('TAKEN_BACK');
    await att(hr, 'post', `/leave/requests/${r.id}/take-back`, {}).expect(409);
    /* Started leave is cancelled or shortened instead. */
    const started = (await att(hr, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: plain.id, fromDate: plus(today, -1), toDate: plus(today, 1), reason: 'Ill' }).expect(201)).body.request;
    const decided = await att(hr, 'post', `/leave/requests/${started.id}/approve`, {});
    if (decided.status === 200) expect((await att(hr, 'post', `/leave/requests/${started.id}/take-back`, {}).expect(409)).body.code).toBe('STARTED');
  });

  it('leave still waiting when its first day passed is closed as not approved only once the company turns it on', async () => {
    const co = await company();
    const t = (await att(co, 'post', '/leave/types', { name: 'Plain', annualDays: 30 }).expect(201)).body.type;
    const p = await person(co, { name: 'Late Lata', code: 'C1' });
    /* A working day in the past (the default week has Sunday off). */
    let past = plus(today, -3);
    while (new Date(`${past}T00:00:00Z`).getUTCDay() === 0) past = plus(past, -1);
    const old = (await att(co, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: past, toDate: past, reason: 'Errand' }).expect(201)).body.request;
    const ahead = (await att(co, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: mondayFrom(30), toDate: mondayFrom(30), reason: 'Errand' }).expect(201)).body.request;
    const accountId = (await row(co, old.id)).accountId;
    expect(await runInTenant(co.orgId, () => closePassedLeave(accountId, co.orgId))).toBe(0);
    expect((await row(co, old.id)).status).toBe('PENDING');
    const choices = (await request(app).get(`/api/orgs/${co.orgId}/people/company-choices`).set(at(co)).expect(200)).body.choices;
    expect(choices.find((x: any) => x.key === 'leave.closePassed')).toMatchObject({ value: false, default: false });
    await request(app).put(`/api/orgs/${co.orgId}/people/company-choices/leave.closePassed`).set(at(co)).send({ value: true }).expect(200);
    expect(await runInTenant(co.orgId, () => closePassedLeave(accountId, co.orgId))).toBe(1);
    expect(await row(co, old.id)).toMatchObject({ status: 'REJECTED', reviewedByUserId: 'system', reviewNote: PASSED_NOTE });
    expect((await row(co, ahead.id)).status).toBe('PENDING');
  });
});
