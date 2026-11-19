import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Cancelling approved leave needs the approver's OK again (round 47, decided 19 Nov 2026). A waiting
 * request is still withdrawn at once; approved leave is asked to be cancelled and stays approved, and
 * counting, until an approver agrees or keeps it. HR can still cancel at once, with a reason.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `lc.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `LC Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const user = await platformPrisma.user.findFirstOrThrow({ where: { email }, select: { id: true } });
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: user.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
async function colleague(boss: Ctx, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `lcc.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const inbox = async (c: Ctx) => (await request(app).get(`/api/orgs/${c.orgId}/people/inbox`).set(at(c)).expect(200)).body;
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const link = (c: Ctx, employeeId: string, userId: string) => runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId } }));
const row = (c: Ctx, id: string) => runInTenant(c.orgId, () => peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id } }));
const leaveDays = (c: Ctx, id: string) => runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.count({ where: { orgId: c.orgId, leaveRequestId: id } }));
const bell = (c: Ctx, where: Record<string, unknown> = {}) => runInTenant(c.orgId, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, ...where }, orderBy: { createdAt: 'asc' } }));

/* Working days some weeks ahead, in the same leave year: a Tuesday at least three weeks on, stepped back from the year end. */
const DAY0 = (() => {
  const todayIn = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  let t = Date.parse(`${todayIn}T00:00:00Z`) + 21 * 86_400_000;
  while (new Date(t).getUTCDay() !== 2) t += 86_400_000;
  return t;
})();
const on = (n: number) => new Date(DAY0 + n * 86_400_000).toISOString().slice(0, 10);

const MY = ['ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE'];
const APPROVES_LEAVE = ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW'];

let hr: Ctx;
let approver: Ctx;
let meUser: Ctx;
let emp: any;
let casual: any;
beforeAll(async () => {
  hr = await company();
  approver = await colleague(hr, APPROVES_LEAVE);
  meUser = await colleague(hr, MY);
  emp = await person(hr, { name: 'Cancel Kavya', code: 'LC1' });
  await link(hr, emp.id, meUser.userId);
  casual = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
}, 90_000);

/** What is left of Casual in the leave year of that day. */
const available = async (day: string) => (await att(meUser, 'get', `/me/leave?year=${day.slice(0, 4)}`).expect(200)).body.types.find((t: any) => t.id === casual.id).available;
/** Asked by the person, approved by the approver. */
const approvedLeave = async (from: string, to = from) => {
  const r = (await att(meUser, 'post', '/me/leave', { leaveTypeId: casual.id, fromDate: from, toDate: to, reason: 'Family function' }).expect(201)).body.request;
  await att(approver, 'post', `/leave/requests/${r.id}/approve`).expect(200);
  return r;
};

describe('cancelling leave (round 47)', () => {
  it('withdraws a waiting request at once', async () => {
    const r = (await att(meUser, 'post', '/me/leave', { leaveTypeId: casual.id, fromDate: on(0), toDate: on(0), reason: 'Bank' }).expect(201)).body.request;
    const out = (await att(meUser, 'post', `/me/leave/${r.id}/cancel`).expect(200)).body;
    expect(out.asked).toBeUndefined();
    expect(out.request.status).toBe('CANCELLED');
    expect((await row(hr, r.id)).cancelAskedAt).toBeNull();
  });

  it('asks to cancel approved leave: it stays approved and keeps counting, and the approver is asked', async () => {
    const before = await available(on(7));
    const r = await approvedLeave(on(7), on(8));
    expect(await available(on(7))).toBe(before - 2);
    const out = (await att(meUser, 'post', `/me/leave/${r.id}/cancel`, { reason: 'Trip called off' }).expect(200)).body;
    expect(out.asked).toBe(true);
    const saved = await row(hr, r.id);
    expect(saved).toMatchObject({ status: 'APPROVED', cancelAskedBy: `portal:${emp.id}`, cancelReason: 'Trip called off' });
    expect(saved.cancelAskedAt).toBeTruthy();
    expect((saved.history as any[]).at(-1)).toMatchObject({ what: 'CANCEL_ASKED', note: 'Trip called off' });
    expect(await available(on(7))).toBe(before - 2);
    expect(await leaveDays(hr, r.id)).toBe(2);
    /* Asked once: a second ask waits on the first. */
    expect((await att(meUser, 'post', `/me/leave/${r.id}/cancel`).expect(409)).body.code).toBe('CANCEL_ASKED');
    /* Whoever approved it is told, and it waits in their Approvals inbox, not in bulk. */
    const told = await bell(hr, { userId: approver.userId, dedupeKey: { startsWith: `leave-cancel-asked:${r.id}:` } });
    expect(told).toHaveLength(1);
    expect(told[0].title).toMatch(/^Cancel Kavya \(LC1\) asks to cancel Casual, /);
    const item = (await inbox(approver)).items.find((i: any) => i.key === `LEAVE_CANCEL:${r.id}`);
    expect(item).toMatchObject({ kind: 'LEAVE', cancelAsked: true, bulk: false, reason: 'Trip called off', days: 2 });
    /* HR (company scope) sees it too; the person never decides their own. */
    expect((await inbox(hr)).items.some((i: any) => i.key === `LEAVE_CANCEL:${r.id}`)).toBe(true);
    await att(meUser, 'post', `/leave/requests/${r.id}/cancellation`, { approve: true }).expect(404);
  });

  it('cancels when the approver agrees: the days come off the record and back to the balance', async () => {
    const before = await available(on(14));
    const r = await approvedLeave(on(14));
    expect(await leaveDays(hr, r.id)).toBe(1);
    await att(meUser, 'post', `/me/leave/${r.id}/cancel`).expect(200);
    const out = (await att(approver, 'post', `/leave/requests/${r.id}/cancellation`, { approve: true, note: 'Fine' }).expect(200)).body;
    expect(out).toMatchObject({ cancelled: true, request: { status: 'CANCELLED' } });
    expect((await row(hr, r.id)).reviewedByUserId).toBe(approver.userId);
    expect(await leaveDays(hr, r.id)).toBe(0);
    expect(await available(on(14))).toBe(before);
    expect((await inbox(approver)).items.some((i: any) => i.key === `LEAVE_CANCEL:${r.id}`)).toBe(false);
    /* Decided once. */
    expect((await att(approver, 'post', `/leave/requests/${r.id}/cancellation`, { approve: false }).expect(409)).body.code).toBe('NO_CANCEL_ASK');
  });

  it('keeps the leave when the approver says so, and tells the person', async () => {
    const before = await available(on(21));
    const r = await approvedLeave(on(21));
    await att(meUser, 'post', `/me/leave/${r.id}/cancel`).expect(200);
    const out = (await att(approver, 'post', `/leave/requests/${r.id}/cancellation`, { approve: false, note: 'Audit week, we need you' }).expect(200)).body;
    expect(out).toMatchObject({ cancelled: false, request: { status: 'APPROVED' } });
    const saved = await row(hr, r.id);
    expect(saved).toMatchObject({ status: 'APPROVED', cancelAskedAt: null, cancelAskedBy: null, cancelReason: null });
    expect((saved.history as any[]).at(-1)).toMatchObject({ what: 'CANCEL_REFUSED', note: 'Audit week, we need you' });
    expect(await leaveDays(hr, r.id)).toBe(1);
    expect(await available(on(21))).toBe(before - 1);
    const told = await bell(hr, { userId: meUser.userId, dedupeKey: { startsWith: `leave-cancel-kept:${r.id}:` } });
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ body: 'Audit week, we need you' });
    expect(told[0].title).toMatch(/stays approved$/);
    /* Once kept, the person may ask again. */
    expect((await att(meUser, 'post', `/me/leave/${r.id}/cancel`).expect(200)).body.asked).toBe(true);
  });

  it('lets HR cancel approved leave at once, with a reason the person reads', async () => {
    const before = await available(on(28));
    const r = await approvedLeave(on(28));
    const out = (await att(hr, 'post', `/leave/requests/${r.id}/cancel`, { note: 'Office closed that day' }).expect(200)).body;
    expect(out.request.status).toBe('CANCELLED');
    const saved = await row(hr, r.id);
    expect(saved.reviewNote).toBe('Office closed that day');
    expect((saved.history as any[]).at(-1)).toMatchObject({ what: 'CANCELLED', note: 'Office closed that day' });
    expect(await leaveDays(hr, r.id)).toBe(0);
    expect(await available(on(28))).toBe(before);
  });

  it('refuses an ask once the leave has started, and anyone outside the approvers', async () => {
    const r = await approvedLeave(on(35));
    /* A colleague with no leave rights cannot answer an ask. */
    await att(meUser, 'post', `/me/leave/${r.id}/cancel`).expect(200);
    const stranger = await colleague(hr, MY);
    await att(stranger, 'post', `/leave/requests/${r.id}/cancellation`, { approve: true }).expect(404);
    await att(approver, 'post', `/leave/requests/${r.id}/cancellation`, { approve: 'yes' }).expect(400);
    /* Started (moved into the past by hand): the person uses "Came back early" or asks HR. */
    const started = await approvedLeave(on(42));
    const yesterday = new Date(Date.now() + 330 * 60_000 - 86_400_000).toISOString().slice(0, 10);
    await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.update({ where: { id: started.id }, data: { fromDate: yesterday } }));
    expect((await att(meUser, 'post', `/me/leave/${started.id}/cancel`).expect(409)).body.code).toBe('STARTED');
  });
});
