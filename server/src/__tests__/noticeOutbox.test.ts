import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * Leave and attendance-request notices are never lost (closure audit O-07,
 * docs/people/design-v1/TIME-LEAVE-CLOSURE-AUDIT-2026-10-27.md). Each notice
 * is an outbox event written with the change; the outbox sends it, tries
 * again when sending fails, and marks it failed after the last try. A dedupe
 * key per person means a retry never sends twice.
 */
/* The notification store "down" for one company only, so other suites sharing the database are not slowed. */
const flaky = vi.hoisted(() => ({ orgId: null as string | null }));
vi.mock('../services/notifications.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/notifications.js')>();
  return {
    ...real,
    sendNotice: async (...args: Parameters<typeof real.sendNotice>) => {
      if (flaky.orgId && args[1] === flaky.orgId) throw new Error('notification store down');
      return real.sendNotice(...args);
    },
  };
});

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { deliverOutbox, failedEvents, NOTICE_EVENT, RETRY_MINUTES } = await import('../services/people/outbox.js');
const notifications = await import('../services/notifications.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `nb.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `NB Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const user = await platformPrisma.user.findFirstOrThrow({ where: { email }, select: { id: true } });
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: user.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
async function colleague(boss: Ctx, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `nbc.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
/*
 * Leave days still to come, whatever today is: a Monday some six weeks on in India's time, and days counted from it
 * (weekdays only). They were fixed days in February and March 2027, and an employee cannot withdraw leave that is past.
 */
const MONDAY = (() => {
  let t = Date.parse(`${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)}T00:00:00Z`) + 40 * 86_400_000;
  while (new Date(t).getUTCDay() !== 1) t += 86_400_000;
  return t;
})();
const on = (n: number) => new Date(MONDAY + n * 86_400_000).toISOString().slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const words = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const link = (c: Ctx, employeeId: string, userId: string) => runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId } }));
const bell = (c: Ctx, where: Record<string, unknown> = {}) => runInTenant(c.orgId, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, ...where }, orderBy: { createdAt: 'asc' } }));
const noticeEvents = (c: Ctx, correlationId: string) => runInTenant(c.orgId, () => peoplePrisma.outboxEvent.findMany({ where: { orgId: c.orgId, name: NOTICE_EVENT, correlationId }, orderBy: { occurredAt: 'asc' } }));
/* The shared test database holds other suites' events too: drain in big batches. */
const drain = (now = new Date()) => deliverOutbox(now, 5000);

/** A weekday at least two weeks ahead, in the same month as the one after it. */
const ahead = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const MY = ['ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE'];
const APPROVES_LEAVE = ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW'];

let hr: Ctx;
let approver: Ctx;
let casual: any;
beforeAll(async () => {
  hr = await company();
  approver = await colleague(hr, APPROVES_LEAVE);
  casual = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
}, 90_000);

describe('leave and request notices go through the outbox (O-07)', () => {
  it('a notice is written with the change and delivered by the outbox, not before', async () => {
    const emp = await person(hr, { name: 'Outbox Asha', code: 'NB1' });
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: casual.id, fromDate: on(2), toDate: on(2), reason: 'Bank work' }).expect(201)).body.request;
    const events = await noticeEvents(hr, `leave_request_${r.id}`);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ deliveredAt: null, attempts: 0, employeeId: emp.id });
    expect(events[0].payload).toMatchObject({ topic: 'leave', request: { id: r.id, status: 'PENDING' } });
    expect(await bell(hr, { userId: approver.userId, kind: 'attendance.leave_asked' })).toHaveLength(0);

    await drain();
    const asked = await bell(hr, { userId: approver.userId, kind: 'attendance.leave_asked' });
    expect(asked).toEqual([expect.objectContaining({ title: `Outbox Asha (NB1) asks for Casual, ${words(on(2))}`, dedupeKey: `leave-asked:${r.id}:new:0` })]);
    const after = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findUniqueOrThrow({ where: { id: events[0].id } }));
    expect(after.deliveredAt).toBeTruthy();
    /* HR entered it: HR is not told of their own entry. */
    expect(await bell(hr, { userId: hr.userId, kind: 'attendance.leave_asked', dedupeKey: `leave-asked:${r.id}:new:0` })).toHaveLength(0);
  });

  it('a delivery that fails is tried again on the backoff, and after the last try is marked failed for an operator', async () => {
    const emp = await person(hr, { name: 'Retry Ravi', code: 'NB2' });
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: casual.id, fromDate: on(3), toDate: on(3), reason: 'Family' }).expect(201)).body.request;
    const [ev] = await noticeEvents(hr, `leave_request_${r.id}`);
    flaky.orgId = hr.orgId;
    const now = new Date();
    try {
      await drain(now);
    } finally {
      flaky.orgId = null;
    }
    const failed = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } }));
    expect(failed).toMatchObject({ deliveredAt: null, attempts: 1, failedAt: null });
    expect(failed.lastError).toContain('notification store down');
    expect(failed.nextAttemptAt!.getTime() - now.getTime()).toBe(RETRY_MINUTES[0] * 60_000);
    expect(await bell(hr, { userId: approver.userId, dedupeKey: `leave-asked:${r.id}:new:0` })).toHaveLength(0);

    /* Not due yet: left alone. Due: sent. */
    await drain(now);
    expect((await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } }))).attempts).toBe(1);
    await drain(new Date(now.getTime() + 2 * 60_000));
    expect((await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } }))).deliveredAt).toBeTruthy();
    expect(await bell(hr, { userId: approver.userId, dedupeKey: `leave-asked:${r.id}:new:0` })).toHaveLength(1);

    /* Another notice, failing on its last try: marked failed, kept, listed for an operator. */
    const r2 = (await att(hr, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: casual.id, fromDate: on(4), toDate: on(4), reason: 'Family' }).expect(201)).body.request;
    const [ev2] = await noticeEvents(hr, `leave_request_${r2.id}`);
    await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.update({ where: { id: ev2.id }, data: { attempts: RETRY_MINUTES.length, nextAttemptAt: null } }));
    flaky.orgId = hr.orgId;
    try {
      await drain();
    } finally {
      flaky.orgId = null;
    }
    const parked = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findUniqueOrThrow({ where: { id: ev2.id } }));
    expect(parked).toMatchObject({ deliveredAt: null, attempts: RETRY_MINUTES.length + 1, nextAttemptAt: null });
    expect(parked.failedAt).toBeTruthy();
    expect((await failedEvents(500)).map((e) => e.id)).toContain(ev2.id);
    /* Parked: not tried again each tick. */
    await drain(new Date(Date.now() + 86_400_000));
    expect((await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findUniqueOrThrow({ where: { id: ev2.id } }))).attempts).toBe(RETRY_MINUTES.length + 1);
  });

  it('a dedupe key means one notice per person, however often it is sent or delivered', async () => {
    const key = `test-dedupe:${rnd()}`;
    const notice = { kind: 'attendance.leave_decided', title: 'Once only' };
    expect(await runInTenant(hr.orgId, () => notifications.sendNotice('', hr.orgId, [approver.userId], notice, { dedupeKey: key }))).toBe(1);
    expect(await runInTenant(hr.orgId, () => notifications.sendNotice('', hr.orgId, [approver.userId, hr.userId], notice, { dedupeKey: key }))).toBe(1);
    expect(await bell(hr, { dedupeKey: key })).toHaveLength(2);

    /* The same event delivered again (a crash after sending, before it was marked delivered): nobody hears twice. */
    const emp = await person(hr, { name: 'Twice Tara', code: 'NB3' });
    await link(hr, emp.id, (await colleague(hr, MY)).userId);
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: casual.id, fromDate: on(7), toDate: on(7), reason: 'Errand' }).expect(201)).body.request;
    await att(hr, 'post', `/leave/requests/${r.id}/approve`, { note: 'Fine' }).expect(200);
    await drain();
    const events = await noticeEvents(hr, `leave_request_${r.id}`);
    await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.updateMany({ where: { id: { in: events.map((e) => e.id) } }, data: { deliveredAt: null, nextAttemptAt: null, attempts: 0 } }));
    await drain();
    const told = await bell(hr, { dedupeKey: { contains: r.id } });
    expect(told.length).toBeGreaterThanOrEqual(2);
    expect(await bell(hr, { dedupeKey: `leave-decided:${r.id}:APPROVED` })).toHaveLength(1);
    const perKey = new Map<string, number>();
    for (const n of told) perKey.set(`${n.userId}|${n.dedupeKey}`, (perKey.get(`${n.userId}|${n.dedupeKey}`) || 0) + 1);
    expect([...perKey.values()].every((n) => n === 1)).toBe(true);
  });

  it('a change to the reason alone asks nobody again; a change of dates does', async () => {
    const emp = await person(hr, { name: 'Edit Esha', code: 'NB4' });
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: casual.id, fromDate: on(9), toDate: on(9), reason: 'Dentist' }).expect(201)).body.request;
    await drain();
    const asked = () => bell(hr, { userId: approver.userId, kind: 'attendance.leave_asked', linkJson: { contains: r.id } });
    expect(await asked()).toHaveLength(1);

    const edited = (await att(hr, 'put', `/leave/requests/${r.id}`, { employeeId: emp.id, leaveTypeId: casual.id, fromDate: on(9), toDate: on(9), reason: 'Dentist, then the bank' }).expect(200)).body.request;
    expect(edited.reason).toBe('Dentist, then the bank');
    expect(await noticeEvents(hr, `leave_request_${r.id}`)).toHaveLength(1);
    await drain();
    expect(await asked()).toHaveLength(1);
    const story = (await att(hr, 'get', `/leave/requests/${r.id}`).expect(200)).body;
    expect(story.history.map((h: any) => h.what)).toContain('Changed the reason');

    await att(hr, 'put', `/leave/requests/${r.id}`, { employeeId: emp.id, leaveTypeId: casual.id, fromDate: on(10), toDate: on(10), reason: 'Dentist, then the bank' }).expect(200);
    await drain();
    expect((await asked()).map((n) => n.dedupeKey)).toEqual([`leave-asked:${r.id}:new:0`, `leave-asked:${r.id}:new:1`]);
  });

  it('an attendance request edited in its reason alone keeps the manager step and asks nobody again', async () => {
    await att(hr, 'put', '/request-rules', { WFH: { on: true, approval: 'MANAGER_THEN_HR' } }).expect(200);
    const bossUser = await colleague(hr, [...MY, 'ATTENDANCE::Attendance Requests::VIEW', 'ATTENDANCE::Attendance Requests::APPROVE', 'PEOPLE::Employees::VIEW']);
    const boss = await person(hr, { name: 'Boss Bala', code: 'NB5' });
    await link(hr, boss.id, bossUser.userId);
    const meUser = await colleague(hr, MY);
    const emp = await person(hr, { name: 'Home Hari', code: 'NB6', reportingManagerId: boss.id });
    await link(hr, emp.id, meUser.userId);
    const date = ahead(16);
    const r = (await att(meUser, 'post', '/me/requests', { kind: 'WFH', date, reason: 'Plumber' }).expect(201)).body.request;
    await att(bossUser, 'post', `/requests/${r.id}/approve`).expect(200);
    const stepped = await runInTenant(hr.orgId, () => peoplePrisma.attendanceRequest.findUniqueOrThrow({ where: { id: r.id } }));
    expect(stepped.managerApprovedAt).toBeTruthy();
    const before = (await noticeEvents(hr, `attendance_request_${r.id}`)).length;
    await att(meUser, 'put', `/me/requests/${r.id}`, { kind: 'WFH', date, reason: 'Plumber, and the electrician' }).expect(200);
    const after = await runInTenant(hr.orgId, () => peoplePrisma.attendanceRequest.findUniqueOrThrow({ where: { id: r.id } }));
    expect(after.managerApprovedAt).toBeTruthy();
    expect(after.reason).toBe('Plumber, and the electrician');
    expect(await noticeEvents(hr, `attendance_request_${r.id}`)).toHaveLength(before);
  });

  it('a person cancelling their own approved work from home tells whoever approved it', async () => {
    await att(hr, 'put', '/request-rules', { WFH: { on: true, approval: 'HR' } }).expect(200);
    const meUser = await colleague(hr, MY);
    const emp = await person(hr, { name: 'Cancel Chitra', code: 'NB7' });
    await link(hr, emp.id, meUser.userId);
    const date = ahead(20);
    const r = (await att(meUser, 'post', '/me/requests', { kind: 'WFH', date, reason: 'Delivery' }).expect(201)).body.request;
    await att(hr, 'post', `/requests/${r.id}/approve`).expect(200);
    await drain();
    await att(meUser, 'post', `/me/requests/${r.id}/cancel`).expect(200);
    await drain();
    const told = await bell(hr, { userId: hr.userId, dedupeKey: `request-cancelled:${r.id}` });
    expect(told).toHaveLength(1);
    expect(told[0].title).toMatch(/^Cancel Chitra \(NB7\) cancelled their work from home, /);
    /* The person is not told of their own cancellation. */
    expect(await bell(hr, { userId: meUser.userId, dedupeKey: { startsWith: `request-` }, kind: 'attendance.request_decided', title: { contains: 'cancelled' } })).toHaveLength(0);
  });

  it('withdrawn leave reaches a real approver: the rule approved it, or a manager approved it in the employee app', async () => {
    const quick = (await att(hr, 'post', '/leave/types', { name: 'Quick', annualDays: 10, autoApproveUpToDays: 2 }).expect(201)).body.type;
    const meUser = await colleague(hr, MY);
    const emp = await person(hr, { name: 'Withdraw Wasim', code: 'NB8' });
    await link(hr, emp.id, meUser.userId);

    /* Approved by the leave rule: nobody approved it by hand, so those who approve leave for him are told. */
    const auto = (await att(meUser, 'post', '/me/leave', { leaveTypeId: quick.id, fromDate: on(23), toDate: on(23), reason: 'Errand' }).expect(201)).body.request;
    expect(auto.status).toBe('APPROVED');
    await att(meUser, 'post', `/me/leave/${auto.id}/cancel`).expect(200);
    await drain();
    const toApprovers = await bell(hr, { dedupeKey: `leave-withdrawn:${auto.id}` });
    expect(toApprovers.map((n) => n.userId).sort()).toEqual([hr.userId, approver.userId].sort());
    expect(toApprovers[0].title).toBe(`Withdraw Wasim (NB8) cancelled Quick, ${words(on(23))}`);

    /* Approved by a manager in the employee app (portal:<their employee id>): reaches the manager's own sign-in. */
    const managerUser = await colleague(hr, MY);
    const manager = await person(hr, { name: 'Portal Manager', code: 'NB9' });
    await link(hr, manager.id, managerUser.userId);
    const byHand = (await att(meUser, 'post', '/me/leave', { leaveTypeId: casual.id, fromDate: on(30), toDate: on(30), reason: 'Wedding' }).expect(201)).body.request;
    await att(hr, 'post', `/leave/requests/${byHand.id}/approve`).expect(200);
    await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.update({ where: { id: byHand.id }, data: { reviewedByUserId: `portal:${manager.id}` } }));
    await att(meUser, 'post', `/me/leave/${byHand.id}/cancel`).expect(200);
    await drain();
    const toManager = await bell(hr, { dedupeKey: `leave-withdrawn:${byHand.id}` });
    expect(toManager.map((n) => n.userId)).toEqual([managerUser.userId]);
    /* No row is ever addressed to a portal id or to "system". */
    expect(await bell(hr, { OR: [{ userId: { startsWith: 'portal:' } }, { userId: 'system' }] })).toHaveLength(0);
  });
});
