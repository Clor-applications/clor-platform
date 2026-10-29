import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Leave and attendance-request holes found in the 28 Oct 2026 audit: a
 * person handing back leave already taken by shortening it, the probation
 * lock passed by the advance days, your own leave imported (so approved) by
 * you, half of a split leave approved by the rule, a manager rejecting after
 * passing a request to HR, double taps past the overlap check, and the
 * year-end payout counting days still waiting.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(features: Record<string, boolean> = { people: true, attendance: true }): Promise<Ctx> {
  const email = `laf.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `LAF Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: signup.body.user?.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features }).expect(200);
  return c;
}
async function colleague(boss: Ctx, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `lafc.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: `Colleague ${rnd()}`, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const link = (c: Ctx, employeeId: string, userId: string) => runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId } }));
const setType = (c: Ctx, t: any, patch: Record<string, unknown>) => att(c, 'put', `/leave/types/${t.id}`, { name: t.name, annualDays: t.annualDays, ...patch });
const row = (c: Ctx, id: string) => runInTenant(c.orgId, () => peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id } }));

const MY = ['ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE'];
const LEAVE_APPROVER = ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW'];
const REQUESTS_HR = ['ATTENDANCE::Attendance Requests::VIEW', 'ATTENDANCE::Attendance Requests::APPROVE', 'PEOPLE::Employees::VIEW'];
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/* A Monday at least a month away, for requests that must not touch today. */
const laterMonday = (() => {
  let d = plus(today, 35);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = plus(d, 1);
  return d;
})();

describe('leave', () => {
  let hr: Ctx;
  let me: Ctx;
  let emp: any;
  let plain: any;
  beforeAll(async () => {
    hr = await company();
    me = await colleague(hr, MY);
    emp = await person(hr, { name: 'Asker Anil', code: 'F1' });
    await link(hr, emp.id, me.userId!);
    plain = (await att(hr, 'post', '/leave/types', { name: 'Plain', annualDays: 20 }).expect(201)).body.type;
  }, 120_000);

  it('the person shortening their own leave ends it today or later; HR may end it on a past day', async () => {
    const long = (await att(hr, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: plain.id, fromDate: plus(today, -4), toDate: plus(today, 3), reason: 'Long trip' }).expect(201)).body.request;
    await att(hr, 'post', `/leave/requests/${long.id}/approve`).expect(200);
    /* Handing back days already taken, with nobody approving it: refused. */
    const past = await att(me, 'post', `/me/leave/${long.id}/shorten`, { toDate: plus(today, -2) }).expect(400);
    expect(past.body.error).toMatch(/Choose a day from/);
    expect((await row(hr, long.id)).toDate).toBe(plus(today, 3));
    const ok = (await att(me, 'post', `/me/leave/${long.id}/shorten`, { toDate: today }).expect(200)).body.request;
    expect(ok.toDate).toBe(today);
    /* HR correcting the record may still go back. */
    const other = await person(hr, { name: 'Other Om', code: 'F2' });
    const hrs = (await att(hr, 'post', '/leave/requests', { employeeId: other.id, leaveTypeId: plain.id, fromDate: plus(today, -4), toDate: plus(today, 3), reason: 'Long trip' }).expect(201)).body.request;
    await att(hr, 'post', `/leave/requests/${hrs.id}/approve`).expect(200);
    const back = plus(today, -3);
    const shortened = await att(hr, 'post', `/leave/requests/${hrs.id}/shorten`, { toDate: back });
    /* Unless the days up to `back` are all weekly offs, which leaves no working day. */
    if (shortened.status === 200) expect(shortened.body.request.toDate).toBe(back);
    else expect(shortened.body.error).toMatch(/no working day/);
  });

  it('a type locked by probation cannot be taken in advance, and the lock is checked again at approval', async () => {
    const probationer = await person(hr, { name: 'New Nita', code: 'F3', probationEndDate: '2027-06-30' });
    const locked = (await att(hr, 'post', '/leave/types', { name: 'Locked', annualDays: 12, negativeDays: 5, probationRule: 'LOCK' }).expect(201)).body.type;
    const refused = await att(hr, 'post', '/leave/requests', { employeeId: probationer.id, leaveTypeId: locked.id, fromDate: laterMonday, toDate: laterMonday, reason: 'Errand' }).expect(400);
    expect(refused.body.code).toBe('NO_BALANCE');
    expect(refused.body.error).toMatch(/until confirmed/);
    /* Asked before the type was locked: approving it now is refused too. */
    const open = (await att(hr, 'post', '/leave/types', { name: 'Open', annualDays: 12, negativeDays: 5 }).expect(201)).body.type;
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: probationer.id, leaveTypeId: open.id, fromDate: laterMonday, toDate: laterMonday, reason: 'Errand' }).expect(201)).body.request;
    await setType(hr, open, { probationRule: 'LOCK', negativeDays: 5 }).expect(200);
    const late = await att(hr, 'post', `/leave/requests/${r.id}/approve`).expect(409);
    expect(late.body.code).toBe('NO_BALANCE');
    expect((await row(hr, r.id)).status).toBe('PENDING');
  });

  it('your own row in a leave import is refused while somebody else can approve it', async () => {
    const mine = await person(hr, { name: 'Owner Self', code: 'F4' });
    await link(hr, mine.id, hr.userId!);
    await colleague(hr, LEAVE_APPROVER);
    const rows = [
      { employeeCode: 'F4', leaveType: 'Plain', from: '2026-03-03', to: '2026-03-03', reason: 'Old leave' },
      { employeeCode: 'F2', leaveType: 'Plain', from: '2026-03-04', to: '2026-03-04', reason: 'Old leave' },
    ];
    const dry = (await att(hr, 'post', '/leave/requests/import', { rows, dryRun: true }).expect(200)).body;
    expect(dry.results).toEqual([expect.objectContaining({ row: 1, ok: false, error: expect.stringMatching(/your own leave/) })]);
    const out = (await att(hr, 'post', '/leave/requests/import', { rows }).expect(200)).body;
    expect(out.imported).toBe(1);
    expect(out.results).toEqual([expect.objectContaining({ row: 1, ok: false })]);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.count({ where: { orgId: hr.orgId, employeeId: mine.id } }))).toBe(0);
  });

  it('a split leave approved by the type rule is approved whole, or every part waits', async () => {
    const auto = (await att(hr, 'post', '/leave/types', { name: 'Quick', annualDays: 12, autoApproveUpToDays: 10 }).expect(201)).body.type;
    const ask = { leaveTypeId: auto.id, fromDate: '2026-12-29', toDate: '2027-01-02', reason: 'Year end', split: true };
    /* Control: nothing in the way, both parts approved. */
    const whole = (await att(me, 'post', '/me/leave', ask).expect(201)).body;
    expect(whole.requests).toHaveLength(2);
    expect(whole.requests.map((x: any) => x.status)).toEqual(['APPROVED', 'APPROVED']);
    /* A clock-in on 1 January: the second part cannot be approved, so neither is. */
    const you = await colleague(hr, MY);
    const youEmp = await person(hr, { name: 'Punched Pia', code: 'F5' });
    await link(hr, youEmp.id, you.userId!);
    const accountId = (await runInTenant(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: youEmp.id } }))).accountId;
    await runInTenant(hr.orgId, () => peoplePrisma.attendanceRecord.create({ data: { accountId, orgId: hr.orgId, employeeId: youEmp.id, date: '2027-01-01', checkIn: new Date('2027-01-01T03:30:00Z'), status: 'PRESENT', source: 'MANUAL', createdByUserId: 'test' } }));
    const held = (await att(you, 'post', '/me/leave', ask).expect(201)).body;
    expect(held.requests).toHaveLength(2);
    for (const part of held.requests) {
      const fresh = await row(hr, part.id);
      expect(fresh.status).toBe('PENDING');
      expect((fresh.history as any[]).some((h) => h.what === 'RULE_SKIPPED')).toBe(true);
    }
    expect(await runInTenant(hr.orgId, () => peoplePrisma.attendanceRecord.count({ where: { orgId: hr.orgId, employeeId: youEmp.id, status: 'ON_LEAVE' } }))).toBe(0);
  });

  it('the year-end payout counts days still waiting as spoken for, as the register does', async () => {
    const cash = (await att(hr, 'post', '/leave/types', { name: 'Cashable', annualDays: 12, encashable: true }).expect(201)).body.type;
    const saver = await person(hr, { name: 'Saver Sam', code: 'F6' });
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: saver.id, leaveTypeId: cash.id, fromDate: '2026-12-01', toDate: '2026-12-03', reason: 'Waiting' }).expect(201)).body.request;
    expect(r.status).toBe('PENDING');
    const ledger = (await att(hr, 'get', `/leave/ledger?employeeId=${saver.id}&year=2026`).expect(200)).body.types.find((x: any) => x.type.id === cash.id).balance;
    expect(ledger.pending).toBe(3);
    const preview = (await att(hr, 'get', '/leave/year-end?year=2026').expect(200)).body;
    const line = preview.rows.find((x: any) => x.employeeId === saver.id && x.leaveTypeId === cash.id);
    expect(line.closing).toBe(ledger.allocated - ledger.used - ledger.pending);
  });
});

describe('attendance requests', () => {
  /* Future working days: a Monday at least a month away. */
  const mon = laterMonday;

  it('after the manager passes it to HR, the manager cannot reject it either', async () => {
    const hr = await company();
    const lead = await colleague(hr, REQUESTS_HR, true);
    const leadEmp = await person(hr, { name: 'Lead', code: 'L1' });
    await link(hr, leadEmp.id, lead.userId!);
    const report = await person(hr, { name: 'Report', code: 'L2', reportingManagerId: leadEmp.id });
    await att(hr, 'put', '/request-rules', { WFH: { on: true, approval: 'MANAGER_THEN_HR' } }).expect(200);
    const r = (await att(hr, 'post', '/requests', { employeeId: report.id, kind: 'WFH', date: mon, reason: 'Home' }).expect(201)).body.request;
    expect((await att(lead, 'post', `/requests/${r.id}/approve`, { note: 'Fine' }).expect(200)).body.stage).toBe('HR');
    const refused = await att(lead, 'post', `/requests/${r.id}/reject`, { note: 'Changed my mind' }).expect(403);
    expect(refused.body.code).toBe('HR_STEP');
    const done = await att(hr, 'post', `/requests/${r.id}/reject`, { note: 'Not this week' }).expect(200);
    expect(done.body.request.status).toBe('REJECTED');
  }, 60_000);

  it('two asks for the same day at once save one; the other is an overlap', async () => {
    const hr = await company();
    const asha = await person(hr, { name: 'Asha', code: 'D1' });
    await att(hr, 'put', '/request-rules', { WFH: { on: true } }).expect(200);
    const ask = () => att(hr, 'post', '/requests', { employeeId: asha.id, kind: 'WFH', date: mon, reason: 'Home' });
    const both = await Promise.all([ask(), ask(), ask()]);
    expect(both.map((x: any) => x.status).sort()).toEqual([201, 409, 409]);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.attendanceRequest.count({ where: { orgId: hr.orgId, employeeId: asha.id, kind: 'WFH' } }))).toBe(1);
    /* An edit is checked under the same lock: moving a second request onto the first's day is an overlap. */
    const second = (await att(hr, 'post', '/requests', { employeeId: asha.id, kind: 'WFH', date: plus(mon, 1), reason: 'Home' }).expect(201)).body.request;
    expect((await att(hr, 'put', `/requests/${second.id}`, { kind: 'WFH', date: mon, reason: 'Home' }).expect(409)).body.code).toBe('OVERLAP');
  }, 60_000);
});
