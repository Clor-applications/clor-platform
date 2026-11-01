import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import request from 'supertest';

/**
 * Time & Leave in People (docs/people/design-v1/TIME-LEAVE-DECISIONS.md).
 * One engine for People and Attendance: a People-only company runs it with
 * its own roles and its own working week; a team role sees its team; private
 * leave stays private; every request can be previewed date by date before it
 * is sent; leave across the period end is saved as linked parts; a request
 * tells its story; the overview and a policy tried on real people.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { deliverOutbox } = await import('../services/people/outbox.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(features: Record<string, boolean>): Promise<Ctx> {
  const email = `tl.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `TL Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features }).expect(200);
  return c;
}
async function colleague(boss: Ctx, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `tlc.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const att = (c: Ctx, m: 'get' | 'post' | 'put' | 'delete', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
/* Dates from today in India, so no test is tied to the day it was written (main went red on 1 Nov 2026). */
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
/** The first day on or after today + n that is not a Sunday (the default weekly off). */
const ahead = (n: number) => { let d = plusDays(istToday(), n); while (weekday(d) === 0) d = plusDays(d, 1); return d; };
/** The first Monday on or after today + n whose week, Monday to Saturday, is inside one calendar (leave) year. */
const mondayAhead = (n: number) => { let d = plusDays(istToday(), n); while (weekday(d) !== 1 || plusDays(d, 5).slice(0, 4) !== d.slice(0, 4)) d = plusDays(d, 1); return d; };
const LEAVE_HR = ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::CREATE', 'ATTENDANCE::Leave Requests::EDIT', 'ATTENDANCE::Leave Requests::APPROVE', 'ATTENDANCE::Leave Types::VIEW', 'PEOPLE::Employees::VIEW'];

describe('People only: its own roles, its own working week', () => {
  let c: Ctx;
  let casual: any;
  let asha: any;
  beforeAll(async () => {
    c = await company({ people: true, attendance: false });
    casual = (await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    asha = await person(c, { name: 'Asha', code: 'P1' });
  }, 60_000);

  it('a custom HR role with the Time & Leave rights runs leave without Attendance', async () => {
    const clerk = await colleague(c, LEAVE_HR);
    const r = (await att(clerk, 'post', '/leave/requests', { employeeId: asha.id, leaveTypeId: casual.id, fromDate: '2026-12-01', toDate: '2026-12-01', reason: 'Bank work' }).expect(201)).body.request;
    expect((await att(clerk, 'get', '/leave/requests?limit=10').expect(200)).body.total).toBe(1);
    await att(clerk, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    const noRights = await colleague(c, ['PEOPLE::Employees::VIEW']);
    await att(noRights, 'get', '/leave/requests').expect(403);
  });

  it('the working week decides what leave skips: Saturdays off, or the 2nd and 4th', async () => {
    const ask = { employeeId: asha.id, leaveTypeId: casual.id, fromDate: '2026-12-07', toDate: '2026-12-12', reason: 'Trip' };
    expect((await att(c, 'post', '/leave/requests/preview', ask).expect(200)).body.total).toBe(6);
    await att(c, 'put', '/leave/working-week', { weeklyOffDays: '0,6' }).expect(200);
    const five = (await att(c, 'post', '/leave/requests/preview', ask).expect(200)).body;
    expect(five.total).toBe(5);
    expect(five.parts[0].dates.find((d: any) => d.date === '2026-12-12')).toMatchObject({ counted: false, why: 'Weekly off' });
    /* 12 December is the second Saturday. */
    await att(c, 'put', '/leave/working-week', { weeklyOffDays: '0', offSaturdays: '2,4' }).expect(200);
    expect((await att(c, 'post', '/leave/requests/preview', ask).expect(200)).body.total).toBe(5);
    expect((await att(c, 'post', '/leave/requests/preview', { ...ask, fromDate: '2026-12-01', toDate: '2026-12-05' }).expect(200)).body.total).toBe(5);
    expect((await att(c, 'get', '/leave/working-week').expect(200)).body).toMatchObject({ weeklyOffDays: '0', offSaturdays: '2,4', shiftsDecide: false });
    await att(c, 'put', '/leave/working-week', { weeklyOffDays: '0,1,2,3,4,5,6' }).expect(400);
    await att(c, 'put', '/leave/working-week', { weeklyOffDays: '0' }).expect(200);
  });
});

describe('preview, split, privacy, scope, story, overview', () => {
  let hr: Ctx;
  let lead: Ctx;
  let casual: any;
  let sick: any;
  let leadEmp: any;
  let report: any;
  let stranger: any;
  beforeAll(async () => {
    hr = await company({ people: true, attendance: true });
    casual = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    sick = (await att(hr, 'post', '/leave/types', { name: 'Sick', annualDays: 6, isPrivate: true }).expect(201)).body.type;
    lead = await colleague(hr, ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW'], true);
    leadEmp = await person(hr, { name: 'Lead', code: 'L1' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: leadEmp.id }, data: { userId: lead.userId } }));
    report = await person(hr, { name: 'Report', code: 'L2', reportingManagerId: leadEmp.id });
    stranger = await person(hr, { name: 'Stranger', code: 'L3' });
  }, 90_000);

  it('the preview names every date, a holiday by its name, and the sandwich rule', async () => {
    const testDay = (await att(hr, 'post', '/holidays', { date: '2026-12-08', name: 'Test Day' }).expect(201)).body.holiday;
    /* Gone again after this test, so a run on 8 Dec 2026 can still take leave "today" in the overview test below. */
    onTestFinished(async () => { await att(hr, 'delete', `/holidays/${testDay.id}`).expect(200); });
    const p = (await att(hr, 'post', '/leave/requests/preview', { employeeId: report.id, leaveTypeId: casual.id, fromDate: '2026-12-07', toDate: '2026-12-09' }).expect(200)).body;
    expect(p.total).toBe(2);
    expect(p.parts[0].dates.map((d: any) => [d.date, d.counted, d.why])).toEqual([['2026-12-07', true, null], ['2026-12-08', false, 'Holiday: Test Day'], ['2026-12-09', true, null]]);
    expect(p.parts[0].balance).toMatchObject({ before: 12, after: 10 });
    expect(p.ok).toBe(true);
    const sandwich = (await att(hr, 'post', '/leave/types', { name: 'Earned', annualDays: 15, sandwich: true }).expect(201)).body.type;
    const s = (await att(hr, 'post', '/leave/requests/preview', { employeeId: report.id, leaveTypeId: sandwich.id, fromDate: '2026-12-12', toDate: '2026-12-14' }).expect(200)).body;
    /* Sat worked, Sun off, Mon worked: Sunday is charged under the sandwich rule. */
    expect(s.total).toBe(3);
    expect(s.parts[0].dates[1].why).toContain('sandwich');
    /* Too many days: a problem, said before anything is sent. */
    const big = (await att(hr, 'post', '/leave/requests/preview', { employeeId: report.id, leaveTypeId: sick.id, fromDate: '2026-11-16', toDate: '2026-11-28' }).expect(200)).body;
    expect(big.ok).toBe(false);
    expect(big.problems[0].code).toBe('NO_BALANCE');
  });

  it('leave across the period end is refused whole, saved as linked parts, and cancelled together', async () => {
    const ask = { employeeId: report.id, leaveTypeId: casual.id, fromDate: '2026-12-28', toDate: '2027-01-04', reason: 'Year-end trip' };
    expect((await att(hr, 'post', '/leave/requests', ask).expect(400)).body).toMatchObject({ code: 'CROSSES_PERIOD', splitAt: '2026-12-31' });
    const preview = (await att(hr, 'post', '/leave/requests/preview', ask).expect(200)).body;
    expect(preview.split).toBe(true);
    expect(preview.parts.map((p: any) => [p.from, p.to, p.days])).toEqual([['2026-12-28', '2026-12-31', 4], ['2027-01-01', '2027-01-04', 3]]);
    const saved = (await att(hr, 'post', '/leave/requests', { ...ask, split: true }).expect(201)).body;
    expect(saved.requests).toHaveLength(2);
    const rows = await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.findMany({ where: { id: { in: saved.requests.map((r: any) => r.id) } } }));
    expect(new Set(rows.map((r) => r.groupId)).size).toBe(1);
    expect(rows[0].groupId).toBeTruthy();
    const detail = (await att(hr, 'get', `/leave/requests/${saved.request.id}`).expect(200)).body;
    expect(detail.parts).toHaveLength(2);
    await att(hr, 'post', `/leave/requests/${saved.request.id}/cancel`).expect(200);
    const after = await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.findMany({ where: { id: { in: saved.requests.map((r: any) => r.id) } } }));
    expect(after.map((r) => r.status)).toEqual(['CANCELLED', 'CANCELLED']);
  });

  it('private leave: no reason needed; a team lead sees "Private leave", HR sees the type and reason', async () => {
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: report.id, leaveTypeId: sick.id, fromDate: '2026-11-17', toDate: '2026-11-17', reason: 'Fever' }).expect(201)).body.request;
    await att(hr, 'post', '/leave/requests', { employeeId: report.id, leaveTypeId: sick.id, fromDate: '2026-11-18', toDate: '2026-11-18' }).expect(201);
    expect((await att(hr, 'post', '/leave/requests', { employeeId: report.id, leaveTypeId: casual.id, fromDate: '2026-11-19', toDate: '2026-11-19' }).expect(400)).body.error).toBe('Say why.');
    const asLead = (await att(lead, 'get', '/leave/requests?limit=50&status=PENDING').expect(200)).body.requests.find((x: any) => x.id === r.id);
    expect(asLead).toMatchObject({ leaveTypeName: 'Private leave', reason: null, reasonHidden: true });
    const asHr = (await att(hr, 'get', '/leave/requests?limit=50&status=PENDING').expect(200)).body.requests.find((x: any) => x.id === r.id);
    expect(asHr).toMatchObject({ leaveTypeName: 'Sick', reason: 'Fever' });
    /* The calendar's view (month) masks the same way. */
    const cal = (await att(lead, 'get', '/leave/requests?month=2026-11').expect(200)).body.requests.find((x: any) => x.id === r.id);
    expect(cal.reason).toBeNull();
  });

  it('a team lead sees and decides their team only; outside it reads as absent', async () => {
    const mine = (await att(hr, 'post', '/leave/requests', { employeeId: report.id, leaveTypeId: casual.id, fromDate: '2026-11-23', toDate: '2026-11-23', reason: 'Errand' }).expect(201)).body.request;
    const theirs = (await att(hr, 'post', '/leave/requests', { employeeId: stranger.id, leaveTypeId: casual.id, fromDate: '2026-11-23', toDate: '2026-11-23', reason: 'Errand' }).expect(201)).body.request;
    const seen = (await att(lead, 'get', '/leave/requests?limit=100').expect(200)).body.requests.map((x: any) => x.employeeId);
    expect(seen).toContain(report.id);
    expect(seen).not.toContain(stranger.id);
    await att(lead, 'get', `/leave/requests/${theirs.id}`).expect(404);
    await att(lead, 'post', `/leave/requests/${theirs.id}/approve`).expect(404);
    await att(lead, 'get', `/leave/ledger?employeeId=${stranger.id}`).expect(404);
    /* A private type is not shown to the lead at all: not in balances, the ledger or the register. */
    const bal = (await att(lead, 'get', '/leave/balances').expect(200)).body;
    expect(bal.types.map((t: any) => t.name)).not.toContain('Sick');
    expect((await att(lead, 'get', `/leave/ledger?employeeId=${report.id}`).expect(200)).body.types.map((t: any) => t.type.name)).not.toContain('Sick');
    expect((await att(lead, 'get', '/leave/register').expect(200)).body.types.map((t: any) => t.name)).not.toContain('Sick');
    expect((await att(hr, 'get', '/leave/balances').expect(200)).body.types.map((t: any) => t.name)).toContain('Sick');
    const balances = bal.rows.map((x: any) => x.employeeId);
    expect(balances.sort()).toEqual([leadEmp.id, report.id].sort());
    /* "Also away" stays inside the team too. */
    const detail = (await att(lead, 'get', `/leave/requests/${mine.id}`).expect(200)).body;
    expect(detail.alsoAway.map((a: any) => a.employeeId)).not.toContain(stranger.id);
    await att(lead, 'post', `/leave/requests/${mine.id}/approve`).expect(200);
    await att(lead, 'put', '/leave/working-week', { weeklyOffDays: '0' }).expect(403);
  });

  it('a request tells its story: entered for whom, decided by whom, the balance with and without it', async () => {
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: stranger.id, leaveTypeId: casual.id, fromDate: '2026-12-01', toDate: '2026-12-02', reason: 'Wedding' }).expect(201)).body.request;
    await att(hr, 'post', `/leave/requests/${r.id}/approve`, { note: 'Enjoy' }).expect(200);
    const d = (await att(hr, 'get', `/leave/requests/${r.id}`).expect(200)).body;
    expect(d.history.map((h: any) => h.what)).toEqual(['Entered for Stranger', 'Approved']);
    expect(d.history[1]).toMatchObject({ by: 'Owner', note: 'Enjoy' });
    expect(d.balance).toMatchObject({ with: d.balance.without - 2 });
    expect(d.dates.filter((x: any) => x.counted)).toHaveLength(2);
  });

  it('a request tells the people who decide; a decision tells the person, once per leave; private leave stays "leave"', async () => {
    /* HR decides (the default chain); the person has a sign-in of their own. */
    const reportUser = await colleague(hr, ['ATTENDANCE::My Attendance::VIEW']);
    /* Notices about earlier changes are sent first: the outbox works out who to tell when it delivers, and this person had no sign-in then. */
    await deliverOutbox(new Date(), 5000);
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: report.id }, data: { userId: reportUser.userId } }));
    const before = new Date();
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: report.id, leaveTypeId: sick.id, fromDate: '2026-12-15', toDate: '2026-12-15' }).expect(201)).body.request;
    await att(hr, 'post', `/leave/requests/${r.id}/approve`, { note: 'Get well' }).expect(200);
    /* Notices go through the outbox (closure audit O-07): deliver what is queued. */
    await deliverOutbox(new Date(), 5000);
    const notes = await platformPrisma.notification.findMany({ where: { orgId: hr.orgId, createdAt: { gte: before }, kind: { in: ['attendance.leave_asked', 'attendance.leave_decided'] } } });
    const mine = notes.filter((n) => n.userId === reportUser.userId);
    expect(mine).toEqual([expect.objectContaining({ kind: 'attendance.leave_decided', title: 'Your Sick, 15 Dec 2026, is approved', body: 'Get well' })]);
    const asked = notes.filter((n) => n.kind === 'attendance.leave_asked');
    expect(asked.length).toBeGreaterThan(0);
    for (const n of asked) expect(n.title).not.toContain('Sick');
  });

  it("a half day's notice says which half (#80 manager QA: the bell said only 0.5 days)", async () => {
    const before = new Date();
    await att(hr, 'post', '/leave/requests', { employeeId: report.id, leaveTypeId: casual.id, fromDate: '2026-12-16', toDate: '2026-12-16', halfDay: 'SECOND', reason: 'School annual day' }).expect(201);
    await deliverOutbox(new Date(), 5000);
    const asked = await platformPrisma.notification.findMany({ where: { orgId: hr.orgId, createdAt: { gte: before }, kind: 'attendance.leave_asked' } });
    expect(asked.length).toBeGreaterThan(0);
    for (const n of asked) expect(n.body).toBe('Half a day, second half');
  });

  it('the paged list counts every tab under the same search', async () => {
    const page = (await att(hr, 'get', '/leave/requests?limit=1&offset=0&q=Report').expect(200)).body;
    expect(page.requests).toHaveLength(1);
    expect(page.total).toBe(page.counts.all);
    expect(page.counts.CANCELLED).toBe(2);
    expect(page.requests.every((x: any) => x.employeeId === report.id)).toBe(true);
  });

  it('the overview: away today, waiting oldest first, a policy tried on real people', async () => {
    const t = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    /* Today may be a Sunday, and leave on a weekly off is nothing to ask for: this company works every day while the test runs. */
    await att(hr, 'put', '/leave/working-week', { weeklyOffDays: '' }).expect(200);
    let o: any;
    try {
      const r = (await att(hr, 'post', '/leave/requests', { employeeId: leadEmp.id, leaveTypeId: casual.id, fromDate: t, toDate: t, reason: 'Today off' }).expect(201)).body.request;
      expect(r.days).toBe(1);
      await att(hr, 'post', `/leave/requests/${r.id}/approve`).expect(200);
      o = (await att(hr, 'get', '/leave/overview').expect(200)).body;
    } finally {
      await att(hr, 'put', '/leave/working-week', { weeklyOffDays: '0' }).expect(200);
    }
    expect(o.awayToday.map((x: any) => x.employeeId)).toContain(leadEmp.id);
    expect(o.waiting.count).toBeGreaterThan(0);
    const times = o.waiting.oldest.map((x: any) => String(x.createdAt));
    expect([...times].sort()).toEqual(times);

    const tried = (await att(hr, 'post', '/leave/types/preview', { annualDays: 12, accrual: 'MONTHLY' }).expect(200)).body;
    expect(tried.rows.length).toBeGreaterThan(0);
    expect(tried.rows.length).toBeLessThanOrEqual(5);
    expect(tried.rows[0]).toMatchObject({ open: true, fullPeriod: expect.any(Number) });
    const women = (await att(hr, 'post', '/leave/types/preview', { annualDays: 26, gender: 'FEMALE' }).expect(200)).body;
    expect(women.rows.some((x: any) => x.open === false)).toBe(true);
  });
});

const RULES = { defaultShiftId: null, lateAllowancePerMonth: 0, latePenaltyEvery: 0, photoRetentionDays: 90, readerUsersBecomeEmployees: false };

describe('manager then HR, imports, split decisions, private leave beyond the leave screens (audit, 27 Oct 2026)', () => {
  let hr: Ctx;
  let boss: Ctx;
  let casual: any;
  let sick: any;
  let bossEmp: any;
  let worker: any;
  beforeAll(async () => {
    hr = await company({ people: true, attendance: true });
    casual = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    sick = (await att(hr, 'post', '/leave/types', { name: 'Sick', annualDays: 6, isPrivate: true }).expect(201)).body.type;
    /* The manager holds a team role that approves leave, and signs in to People. */
    boss = await colleague(hr, ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW'], true);
    bossEmp = await person(hr, { name: 'Boss', code: 'B1' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: bossEmp.id }, data: { userId: boss.userId } }));
    worker = await person(hr, { name: 'Worker', code: 'B2', reportingManagerId: bossEmp.id });
    await att(hr, 'put', '/rules', { ...RULES, leaveApproval: 'MANAGER_THEN_HR' }).expect(200);
  }, 90_000);

  it('the manager takes the first step in People, cannot take the second, and HR then decides', async () => {
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: worker.id, leaveTypeId: casual.id, fromDate: '2026-12-01', toDate: '2026-12-01', reason: 'Errand' }).expect(201)).body.request;
    /* HR first is refused: the manager's step comes first. */
    expect((await att(hr, 'post', `/leave/requests/${r.id}/approve`).expect(409)).body.code).toBe('MANAGER_FIRST');
    const step = (await att(boss, 'post', `/leave/requests/${r.id}/approve`, { note: 'Fine by me' }).expect(200)).body;
    expect(step.stage).toBe('HR');
    expect(step.request.status).toBe('PENDING');
    expect((await att(boss, 'post', `/leave/requests/${r.id}/approve`).expect(403)).body.code).toBe('HR_STEP');
    await att(hr, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    const story = (await att(hr, 'get', `/leave/requests/${r.id}`).expect(200)).body;
    expect(story.history.map((h: any) => h.what)).toEqual(['Entered for Worker', 'Approved by the manager', 'Approved']);
    expect(story.history[1].note).toBe('Fine by me');
  });

  it('leave already taken imports without waiting on the manager', async () => {
    const out = (await att(hr, 'post', '/leave/requests/import', { rows: [{ employeeCode: 'B2', leaveType: 'Casual', from: '2026-09-01', to: '2026-09-01', reason: 'Old leave' }] }).expect(200)).body;
    expect(out).toMatchObject({ imported: 1, failed: 0 });
  });

  it('a leave split at the period end is approved as one', async () => {
    await att(hr, 'put', '/rules', { ...RULES, leaveApproval: 'HR' }).expect(200);
    const saved = (await att(hr, 'post', '/leave/requests', { employeeId: worker.id, leaveTypeId: casual.id, fromDate: '2026-12-30', toDate: '2027-01-01', reason: 'Trip', split: true }).expect(201)).body;
    await att(hr, 'post', `/leave/requests/${saved.request.id}/approve`).expect(200);
    const rows = await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.findMany({ where: { id: { in: saved.requests.map((x: any) => x.id) } } }));
    expect(rows.map((x) => x.status)).toEqual(['APPROVED', 'APPROVED']);
  });

  it('private leave stays private in adjustments, the balance explanation and a filter by its type', async () => {
    await att(hr, 'post', '/leave/adjustments', { employeeId: worker.id, leaveTypeId: sick.id, year: 2026, days: 2, reason: 'Surgery recovery' }).expect(201);
    await att(hr, 'post', '/leave/requests', { employeeId: worker.id, leaveTypeId: sick.id, fromDate: '2026-11-24', toDate: '2026-11-24' }).expect(201);
    const adjustments = (await att(boss, 'get', '/leave/adjustments?year=2026').expect(200)).body.adjustments;
    expect(JSON.stringify(adjustments)).not.toContain('Surgery');
    await att(boss, 'get', `/leave/explain?employeeId=${worker.id}&leaveTypeId=${sick.id}&year=2026`).expect(404);
    expect((await att(boss, 'get', `/leave/requests?limit=50&leaveTypeId=${sick.id}`).expect(200)).body.total).toBe(0);
    expect((await att(hr, 'get', `/leave/requests?limit=50&leaveTypeId=${sick.id}`).expect(200)).body.total).toBe(1);
  });
});

describe('advanced build: entitlements, probation, workflow per type, stand-ins, edit, came back early, comp-off, restricted holidays, year end', () => {
  let hr: Ctx;
  let lead: Ctx;
  let leadEmp: any;
  let staff: any;
  let intern: any;
  let newcomer: any;
  let internType: any;
  const people = (c: Ctx) => ({
    post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
    put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  });
  beforeAll(async () => {
    hr = await company({ people: true, attendance: true });
    internType = (await people(hr).post('/structure/employee-types', { name: 'Intern' }).expect(201)).body.item;
    lead = await colleague(hr, ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW'], true);
    leadEmp = await person(hr, { name: 'Lead', code: 'A1', dateOfJoining: '2020-01-01' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: leadEmp.id }, data: { userId: lead.userId } }));
    staff = await person(hr, { name: 'Staff', code: 'A2', dateOfJoining: '2021-06-01', reportingManagerId: leadEmp.id });
    intern = await person(hr, { name: 'Intern', code: 'A3', dateOfJoining: '2026-01-01', employeeTypeId: internType.id, reportingManagerId: leadEmp.id });
    newcomer = await person(hr, { name: 'New', code: 'A4', dateOfJoining: '2026-09-01', probationEndDate: '2027-03-01', reportingManagerId: leadEmp.id });
  }, 120_000);

  it('one type gives different days by employee type and by years of service', async () => {
    const t = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12, entitlements: [{ employeeTypeId: internType.id, annualDays: 6 }, { minServiceMonths: 36, annualDays: 15 }] }).expect(201)).body.type;
    const rows = (await att(hr, 'get', '/leave/balances?year=2026').expect(200)).body.rows;
    const of = (id: string) => rows.find((r: any) => r.employeeId === id).balances[t.id];
    expect(of(intern.id).entitled).toBe(6);
    expect(of(staff.id).entitled).toBe(15);
    expect(of(newcomer.id).entitled).toBe(12);
    /* A rule needs an employee type or a length of service. */
    await att(hr, 'post', '/leave/types', { name: 'Bad', annualDays: 1, entitlements: [{ annualDays: 3 }] }).expect(400);
  });

  it('probation: HOLD starts credits at confirmation; LOCK keeps the days but none can be taken', async () => {
    const hold = (await att(hr, 'post', '/leave/types', { name: 'Earned', annualDays: 12, accrual: 'MONTHLY', probationRule: 'HOLD' }).expect(201)).body.type;
    const lock = (await att(hr, 'post', '/leave/types', { name: 'Sick', annualDays: 6, probationRule: 'LOCK' }).expect(201)).body.type;
    const rows = (await att(hr, 'get', '/leave/balances?year=2026').expect(200)).body.rows;
    const mine = rows.find((r: any) => r.employeeId === newcomer.id).balances;
    expect(mine[hold.id].allocated).toBe(0);
    expect(mine[lock.id].locked).toBe(true);
    expect(mine[lock.id].available).toBe(0);
    expect(mine[lock.id].allocated).toBeGreaterThan(0);
    const p = (await att(hr, 'post', '/leave/requests/preview', { employeeId: newcomer.id, leaveTypeId: lock.id, fromDate: '2026-12-01', toDate: '2026-12-01' }).expect(200)).body;
    expect(p.problems[0].code).toBe('NO_BALANCE');
    /* Confirmed: the lock lifts. */
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: newcomer.id }, data: { confirmedOn: '2026-10-01' } }));
    const after = (await att(hr, 'get', '/leave/balances?year=2026').expect(200)).body.rows.find((r: any) => r.employeeId === newcomer.id).balances;
    expect(after[lock.id].locked).toBe(false);
    expect(after[lock.id].available).toBeGreaterThan(0);
  });

  it("a type's own rule approves a short request of the person's own as it is sent; HR entering it still waits", async () => {
    const quick = (await att(hr, 'post', '/leave/types', { name: 'Quick', annualDays: 10, autoApproveUpToDays: 2 }).expect(201)).body.type;
    const staffUser = await colleague(hr, ['ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE']);
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: staff.id }, data: { userId: staffUser.userId } }));
    const own = (await att(staffUser, 'post', '/me/leave', { leaveTypeId: quick.id, fromDate: '2026-12-07', toDate: '2026-12-08', reason: 'Family' }).expect(201)).body.request;
    expect(own.status).toBe('APPROVED');
    expect(own.autoApproved).toBe(true);
    const long = (await att(staffUser, 'post', '/me/leave', { leaveTypeId: quick.id, fromDate: '2026-12-14', toDate: '2026-12-17', reason: 'Trip' }).expect(201)).body.request;
    expect(long.status).toBe('PENDING');
    const byHr = (await att(hr, 'post', '/leave/requests', { employeeId: staff.id, leaveTypeId: quick.id, fromDate: '2026-12-21', toDate: '2026-12-21', reason: 'Entered' }).expect(201)).body.request;
    expect(byHr.status).toBe('PENDING');
    const story = (await att(hr, 'get', `/leave/requests/${own.id}`).expect(200)).body;
    expect(story.history.map((h: any) => h.what)).toEqual(['Asked', 'Approved by the leave rule']);
  });

  it("a type's own chain overrides the company's; a stand-in takes the manager's step while they are away", async () => {
    const chained = (await att(hr, 'post', '/leave/types', { name: 'Chained', annualDays: 10, approval: 'MANAGER_THEN_HR' }).expect(201)).body.type;
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: staff.id, leaveTypeId: chained.id, fromDate: '2026-11-25', toDate: '2026-11-25', reason: 'Errand' }).expect(201)).body.request;
    expect((await att(hr, 'post', `/leave/requests/${r.id}/approve`).expect(409)).body.code).toBe('MANAGER_FIRST');
    /* The lead is away; Deputy stands in. */
    const deputy = await colleague(hr, ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW'], true);
    const deputyEmp = await person(hr, { name: 'Deputy', code: 'A9' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: deputyEmp.id }, data: { userId: deputy.userId } }));
    const t = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    await att(hr, 'post', '/leave/stand-ins', { managerEmployeeId: leadEmp.id, standInEmployeeId: deputyEmp.id, fromDate: t, toDate: t }).expect(201);
    expect((await att(hr, 'get', '/leave/stand-ins').expect(200)).body.standIns[0]).toMatchObject({ standInName: 'Deputy', live: true });
    const step = (await att(deputy, 'post', `/leave/requests/${r.id}/approve`, { note: 'Covering' }).expect(200)).body;
    expect(step.stage).toBe('HR');
    await att(hr, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    const story = (await att(hr, 'get', `/leave/requests/${r.id}`).expect(200)).body;
    expect(story.history.map((h: any) => h.what)).toEqual(['Entered for Staff', 'Approved by the manager', 'Approved']);
  });

  it('a waiting request can be changed, and approved leave that has started can end early', async () => {
    const t = (await att(hr, 'post', '/leave/types', { name: 'Plain', annualDays: 20 }).expect(201)).body.type;
    /* A Monday a fortnight or more ahead, Monday to Thursday inside one leave year: clear of today's leave below. */
    const mon = mondayAhead(14);
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: intern.id, leaveTypeId: t.id, fromDate: mon, toDate: plusDays(mon, 1), reason: 'First' }).expect(201)).body.request;
    const edited = (await att(hr, 'put', `/leave/requests/${r.id}`, { leaveTypeId: t.id, fromDate: plusDays(mon, 1), toDate: plusDays(mon, 3), reason: 'Changed plan' }).expect(200)).body.request;
    expect(edited).toMatchObject({ id: r.id, fromDate: plusDays(mon, 1), toDate: plusDays(mon, 3), days: 3, reason: 'Changed plan' });
    expect((await att(hr, 'get', `/leave/requests/${r.id}`).expect(200)).body.history.map((h: any) => h.what)).toEqual(['Entered for Intern', 'Changed']);
    /* Came back early: approved leave over today, shortened to its first day. */
    const today_ = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    /* Two days either side of today, kept inside this leave year: leave across the year end is refused whole (it broke on 30 Dec–1 Jan). */
    const yearOf = today_.slice(0, 4);
    const from = plusDays(today_, -2) < `${yearOf}-01-01` ? `${yearOf}-01-01` : plusDays(today_, -2);
    const to = plusDays(today_, 2) > `${yearOf}-12-31` ? `${yearOf}-12-31` : plusDays(today_, 2);
    const long = (await att(hr, 'post', '/leave/requests', { employeeId: intern.id, leaveTypeId: t.id, fromDate: from, toDate: to, reason: 'Long' }).expect(201)).body.request;
    await att(hr, 'post', `/leave/requests/${long.id}/approve`).expect(200);
    const before = (await att(hr, 'get', `/leave/ledger?employeeId=${intern.id}&year=${today_.slice(0, 4)}`).expect(200)).body.types.find((x: any) => x.type.id === t.id).balance;
    /* Back on the first working day of the leave (the default week has Sunday off). */
    const backOn = weekday(from) === 0 ? plusDays(from, 1) : from;
    const short = (await att(hr, 'post', `/leave/requests/${long.id}/shorten`, { toDate: backOn }).expect(200)).body.request;
    expect(short.toDate).toBe(backOn);
    expect(short.days).toBeLessThan(long.days);
    const after = (await att(hr, 'get', `/leave/ledger?employeeId=${intern.id}&year=${today_.slice(0, 4)}`).expect(200)).body.types.find((x: any) => x.type.id === t.id);
    expect(after.balance.available).toBeGreaterThan(before.available);
    expect(after.projected.available).toBeGreaterThanOrEqual(after.balance.available);
    const records = await runInTenant(hr.orgId, () => peoplePrisma.attendanceRecord.findMany({ where: { leaveRequestId: long.id } }));
    expect(records.every((x) => x.date <= backOn)).toBe(true);
  });

  it('comp-off granted for a day worked, once; restricted holidays picked within the quota count as holidays', async () => {
    const comp = (await att(hr, 'post', '/leave/types', { name: 'Comp off', annualDays: 0 }).expect(201)).body.type;
    expect((await att(hr, 'post', '/leave/comp-off', { employeeId: staff.id, workedOn: '2026-10-02', days: 1, reason: 'Gandhi Jayanti stock count' }).expect(409)).body.code).toBe('COMP_OFF_TYPE');
    await runInTenant(hr.orgId, () => peoplePrisma.attendanceSettings.upsert({ where: { orgId: hr.orgId }, update: { compOffEnabled: true, compOffLeaveTypeId: comp.id }, create: { accountId: hr.orgId, orgId: hr.orgId, compOffEnabled: true, compOffLeaveTypeId: comp.id, updatedByUserId: 'test' } as any }));
    await att(hr, 'post', '/leave/comp-off', { employeeId: staff.id, workedOn: '2026-10-02', days: 1, reason: 'Gandhi Jayanti stock count' }).expect(201);
    await att(hr, 'post', '/leave/comp-off', { employeeId: staff.id, workedOn: '2026-10-02', days: 1, reason: 'Again' }).expect(409);
    const bal = (await att(hr, 'get', `/leave/ledger?employeeId=${staff.id}&year=2026`).expect(200)).body.types.find((x: any) => x.type.id === comp.id).balance;
    expect(bal.available).toBe(1);

    /* Restricted holidays still to come (a past one cannot be picked; this said 21 and 22 Dec 2026): a Monday and Tuesday weeks ahead. */
    const opt1 = mondayAhead(21);
    const opt2 = plusDays(opt1, 1);
    await att(hr, 'post', '/holidays', { date: opt1, name: 'Optional One', isOptional: true }).expect(201);
    const h2 = (await att(hr, 'post', '/holidays', { date: opt2, name: 'Optional Two', isOptional: true }).expect(201)).body.holiday;
    await att(hr, 'put', '/leave/working-week', { weeklyOffDays: '0', restrictedHolidayQuota: 1 }).expect(200);
    const staffUser = (await runInTenant(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: staff.id } }))).userId!;
    const me = { token: (await request(app).post('/api/auth/login').send({ email: (await platformPrisma.user.findUniqueOrThrow({ where: { id: staffUser } })).email, password: 'Passw0rd!23' }).expect(200)).body.token, orgId: hr.orgId, branchId: hr.branchId };
    const list = (await att(me, 'get', `/me/holidays/restricted?year=${opt1.slice(0, 4)}`).expect(200)).body;
    expect(list).toMatchObject({ quota: 1, left: 1 });
    const one = list.holidays.find((h: any) => h.name === 'Optional One');
    await att(me, 'post', `/me/holidays/restricted/${one.id}`, {}).expect(200);
    expect((await att(me, 'post', `/me/holidays/restricted/${h2.id}`, {}).expect(409)).body.error).toContain('picked your 1');
    const p = (await att(hr, 'post', '/leave/requests/preview', { employeeId: staff.id, leaveTypeId: comp.id, fromDate: opt1, toDate: opt2 }).expect(200)).body;
    expect(p.parts[0].dates.map((x: any) => [x.date, x.counted])).toEqual([[opt1, false], [opt2, true]]);
  });

  it('year end: previewed per person, run once with pay-outs for encashable types, undone until payroll takes it', async () => {
    const c = await company({ people: true, attendance: false });
    const earned = (await att(c, 'post', '/leave/types', { name: 'Earned', annualDays: 15, carryForwardMax: 5, encashable: true, maxEncashDays: 10 }).expect(201)).body.type;
    const p = await person(c, { name: 'Old Hand', code: 'Y1', dateOfJoining: '2020-01-01' });
    /* Last period: 15 days, none taken; 5 carry, 10 lapse, all 10 paid out. */
    const year = new Date().getFullYear() - 1;
    await runInTenant(c.orgId, () => peoplePrisma.leaveType.update({ where: { id: earned.id }, data: { createdAt: new Date(`${year}-01-01T00:00:00Z`) } }));
    const preview = (await att(c, 'get', `/leave/year-end?year=${year}`).expect(200)).body;
    const row = preview.rows.find((r: any) => r.employeeId === p.id);
    expect(row).toMatchObject({ closing: 15, carry: 5, lapse: 10, payOut: 10 });
    expect(preview.ended).toBe(true);
    const run = (await att(c, 'post', '/leave/year-end', { year }).expect(201)).body;
    expect(run.paidOut).toBe(1);
    await att(c, 'post', '/leave/year-end', { year }).expect(409);
    const adj = await runInTenant(c.orgId, () => peoplePrisma.leaveAdjustment.findMany({ where: { orgId: c.orgId, kind: 'ENCASH' } }));
    expect(adj).toEqual([expect.objectContaining({ days: -10, year })]);
    await att(c, 'post', `/leave/year-end/${run.run.id}/undo`, {}).expect(200);
    /* Reversed, not deleted: the pay-out stays on record, and nothing reads it as paid. */
    expect(await runInTenant(c.orgId, () => peoplePrisma.leaveAdjustment.count({ where: { orgId: c.orgId, kind: 'ENCASH', reversedAt: null } }))).toBe(0);
    expect(await runInTenant(c.orgId, () => peoplePrisma.leaveAdjustment.count({ where: { orgId: c.orgId, kind: 'ENCASH', reversedAt: { not: null } } }))).toBe(1);
  });

  it('hand-on: a manager step that waited too long goes to HR; the digest tells an approver once a day', async () => {
    const { runLeaveHandOns, runLeaveDigest } = await import('../services/attendance/leaveJobs.js');
    const slow = (await att(hr, 'post', '/leave/types', { name: 'Slow', annualDays: 10, approval: 'MANAGER_THEN_HR', handOnAfterDays: 2 }).expect(201)).body.type;
    const later = ahead(60);
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: staff.id, leaveTypeId: slow.id, fromDate: later, toDate: later, reason: 'Later' }).expect(201)).body.request;
    expect(await runLeaveHandOns()).toBe(0);
    await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.update({ where: { id: r.id }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } }));
    expect(await runLeaveHandOns()).toBe(1);
    const story = (await att(hr, 'get', `/leave/requests/${r.id}`).expect(200)).body;
    expect(story.history.map((h: any) => h.what)).toContain('Handed on to HR');
    expect(story.waitingForManager).toBeNull();
    await att(hr, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    const first = await runLeaveDigest();
    expect(first).toBeGreaterThan(0);
    expect(await runLeaveDigest()).toBe(0);
  });
});

describe('preview while changing a request, and the comp-off type from People', () => {
  it('the preview leaves the request being changed out of the overlap and gives its days back', async () => {
    const c = await company({ people: true, attendance: false });
    const t = (await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 3 }).expect(201)).body.type;
    const p = await person(c, { name: 'Edit Me', code: 'E1' });
    const r = (await att(c, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-12-01', toDate: '2026-12-03', reason: 'Trip' }).expect(201)).body.request;
    const plain = (await att(c, 'post', '/leave/requests/preview', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-12-02', toDate: '2026-12-04' }).expect(200)).body;
    expect(plain.problems.map((x: any) => x.code).sort()).toEqual(['NO_BALANCE', 'OVERLAP']);
    const editing = (await att(c, 'post', '/leave/requests/preview', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-12-02', toDate: '2026-12-04', editing: r.id }).expect(200)).body;
    expect(editing.problems).toEqual([]);
    expect(editing.parts[0].balance).toMatchObject({ before: 3, after: 0 });
  });

  it('one code per leave type: a second type with the same code is refused, on create and on edit', async () => {
    const c = await company({ people: true, attendance: false });
    const cl = (await att(c, 'post', '/leave/types', { name: 'Casual', code: 'CL', annualDays: 12 }).expect(201)).body.type;
    const clash = await att(c, 'post', '/leave/types', { name: 'Casual (new)', code: 'cl', annualDays: 6 }).expect(409);
    expect(clash.body.code).toBe('LEAVE_TYPE_CODE_TAKEN');
    expect(clash.body.error).toContain('Casual');
    const sl = (await att(c, 'post', '/leave/types', { name: 'Sick', code: 'SL', annualDays: 6 }).expect(201)).body.type;
    expect((await att(c, 'put', `/leave/types/${sl.id}`, { name: 'Sick', code: 'CL', annualDays: 6 }).expect(409)).body.code).toBe('LEAVE_TYPE_CODE_TAKEN');
    /* Its own code again is no clash; no code at all is fine twice over. */
    await att(c, 'put', `/leave/types/${cl.id}`, { name: 'Casual leave', code: 'CL', annualDays: 12 }).expect(200);
    await att(c, 'post', '/leave/types', { name: 'Comp off', annualDays: 0 }).expect(201);
    await att(c, 'post', '/leave/types', { name: 'Unpaid', annualDays: 0 }).expect(201);
  });

  it('the comp-off leave type is set with the working week, so a People-only company can grant comp-off', async () => {
    const c = await company({ people: true, attendance: false });
    const comp = (await att(c, 'post', '/leave/types', { name: 'Comp off', annualDays: 0 }).expect(201)).body.type;
    const p = await person(c, { name: 'Worked Sunday', code: 'W1' });
    expect((await att(c, 'post', '/leave/comp-off', { employeeId: p.id, workedOn: '2026-10-04', days: 1, reason: 'Stock take' }).expect(409)).body.code).toBe('COMP_OFF_TYPE');
    await att(c, 'put', '/leave/working-week', { weeklyOffDays: '0', compOffLeaveTypeId: comp.id }).expect(200);
    expect((await att(c, 'get', '/leave/working-week').expect(200)).body.compOffLeaveTypeId).toBe(comp.id);
    await att(c, 'post', '/leave/comp-off', { employeeId: p.id, workedOn: '2026-10-04', days: 1, reason: 'Stock take' }).expect(201);
  });
});

describe('second audit (27 Oct 2026): slabs by period, rules on a type in use, edits by type, stand-ins as themselves, the rule that waits, lapse notice', () => {
  let hr: Ctx;
  const back = (typeId: string, orgId: string, when: string) => runInTenant(orgId, () => peoplePrisma.leaveType.update({ where: { id: typeId }, data: { createdAt: new Date(`${when}T00:00:00Z`) } }));
  const balance = async (c: Ctx, employeeId: string, typeId: string, year = 2026) => (await att(c, 'get', `/leave/balances?year=${year}`).expect(200)).body.rows.find((r: any) => r.employeeId === employeeId).balances[typeId];
  beforeAll(async () => {
    hr = await company({ people: true, attendance: true });
  }, 60_000);

  it('a service slab crossed this period does not re-earn the periods before it', async () => {
    const t = (await att(hr, 'post', '/leave/types', { name: 'Earned', annualDays: 12, carryForwardMax: 100, entitlements: [{ minServiceMonths: 36, annualDays: 15 }] }).expect(201)).body.type;
    await back(t.id, hr.orgId, '2023-01-01');
    const p = await person(hr, { name: 'Third year', code: 'S1', dateOfJoining: '2023-01-01' });
    const b = await balance(hr, p.id, t.id);
    expect(b.entitled).toBe(15);
    /* 2023, 2024 and 2025 at 12 each, not at 15. */
    expect(b.carriedIn).toBe(36);
    expect(b.fullYear).toBe(51);
  });

  it('entitlement rules may be added to a type in use; they apply from this leave period and history stays', async () => {
    const t = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12, carryForwardMax: 100 }).expect(201)).body.type;
    await back(t.id, hr.orgId, '2024-01-01');
    const p = await person(hr, { name: 'Second year', code: 'S2', dateOfJoining: '2024-01-01' });
    /* "This leave period" is this year's: the rules start on its 1 January, and every full year since 2024 carries in at 12 (it said 2026). */
    const year = Number(istToday().slice(0, 4));
    await att(hr, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: ahead(7), toDate: ahead(7), reason: 'In use' }).expect(201);
    const saved = (await att(hr, 'put', `/leave/types/${t.id}`, { name: 'Casual', annualDays: 12, carryForwardMax: 100, entitlements: [{ minServiceMonths: 24, annualDays: 15 }] }).expect(200)).body.type;
    expect(saved.entitlementsFrom).toBe(`${year}-01-01`);
    const b = await balance(hr, p.id, t.id, year);
    expect(b.entitled).toBe(15);
    expect(b.carriedIn).toBe(12 * (year - 2024));
    /* The days a year still cannot change under balances and requests. */
    expect((await att(hr, 'put', `/leave/types/${t.id}`, { name: 'Casual', annualDays: 10, carryForwardMax: 100 }).expect(409)).body.code).toBe('LEAVE_POLICY_IN_USE');
  });

  it('a waiting request changed to another type gets nothing back from the old one', async () => {
    const casual = (await att(hr, 'post', '/leave/types', { name: 'Casual B', annualDays: 3 }).expect(201)).body.type;
    const earned = (await att(hr, 'post', '/leave/types', { name: 'Earned B', annualDays: 1 }).expect(201)).body.type;
    const p = await person(hr, { name: 'Switcher', code: 'S3' });
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: casual.id, fromDate: '2026-12-01', toDate: '2026-12-03', reason: 'Trip' }).expect(201)).body.request;
    const refused = await att(hr, 'put', `/leave/requests/${r.id}`, { leaveTypeId: earned.id, fromDate: '2026-12-01', toDate: '2026-12-03', reason: 'Trip' }).expect(400);
    expect(refused.body.code).toBe('NO_BALANCE');
    /* The same type, shifted: its own days come back. */
    await att(hr, 'put', `/leave/requests/${r.id}`, { leaveTypeId: casual.id, fromDate: '2026-12-02', toDate: '2026-12-04', reason: 'Trip' }).expect(200);
  });

  it("a stand-in's step is recorded as theirs; they cannot take HR's step after it; their queue shows the team; naming one takes the approve right", async () => {
    const chained = (await att(hr, 'post', '/leave/types', { name: 'Chained', annualDays: 10, approval: 'MANAGER_THEN_HR' }).expect(201)).body.type;
    const boss = await person(hr, { name: 'Boss', code: 'S4', dateOfJoining: '2020-01-01' });
    const staff = await person(hr, { name: 'Staffer', code: 'S5', reportingManagerId: boss.id });
    /* The deputy has whole-company scope: the one case where the manager's step and HR's could meet in one person. */
    const deputy = await colleague(hr, ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW']);
    const deputyEmp = await person(hr, { name: 'Deputy', code: 'S6' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: deputyEmp.id }, data: { userId: deputy.userId } }));
    const t = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const viewer = await colleague(hr, ['ATTENDANCE::Leave Requests::VIEW', 'PEOPLE::Employees::VIEW']);
    await att(viewer, 'post', '/leave/stand-ins', { managerEmployeeId: boss.id, standInEmployeeId: deputyEmp.id, fromDate: t, toDate: t }).expect(403);
    await att(hr, 'post', '/leave/stand-ins', { managerEmployeeId: boss.id, standInEmployeeId: deputyEmp.id, fromDate: t, toDate: t }).expect(201);
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: staff.id, leaveTypeId: chained.id, fromDate: '2026-11-25', toDate: '2026-11-25', reason: 'Errand' }).expect(201)).body.request;
    expect((await att(deputy, 'get', '/leave/overview').expect(200)).body.waiting.oldest.map((x: any) => x.id)).toContain(r.id);
    expect((await att(deputy, 'post', `/leave/requests/${r.id}/approve`, { note: 'Covering' }).expect(200)).body.stage).toBe('HR');
    const row = await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id: r.id } }));
    expect(row.managerApprovedById).toBe(deputyEmp.id);
    expect(row.managerNote).toContain('stood in for Boss');
    expect((await att(deputy, 'post', `/leave/requests/${r.id}/approve`).expect(403)).body.code).toBe('HR_STEP');
    await att(hr, 'post', `/leave/requests/${r.id}/approve`).expect(200);
  });

  it('the leave rule cannot approve a day with a clock-in or approved work from home: the request waits instead; leave over approved WFH is refused', async () => {
    const quick = (await att(hr, 'post', '/leave/types', { name: 'Quick', annualDays: 10, autoApproveUpToDays: 2 }).expect(201)).body.type;
    const me = await colleague(hr, ['ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE']);
    const emp = await person(hr, { name: 'Punched', code: 'S7' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: emp.id }, data: { userId: me.userId } }));
    await att(hr, 'put', '/request-rules', { WFH: { on: true } }).expect(200);
    await att(hr, 'post', '/requests', { employeeId: emp.id, kind: 'WFH', date: '2026-12-09', reason: 'Home' }).expect(201);
    const wfh = (await att(hr, 'get', '/requests?limit=5&kind=WFH').expect(200)).body.requests[0];
    await att(hr, 'post', `/requests/${wfh.id}/approve`).expect(200);
    const own = (await att(me, 'post', '/me/leave', { leaveTypeId: quick.id, fromDate: '2026-12-09', toDate: '2026-12-09', reason: 'Sick' }).expect(201)).body.request;
    expect(own.status).toBe('PENDING');
    const story = (await att(hr, 'get', `/leave/requests/${own.id}`).expect(200)).body;
    expect(story.history.at(-1).note).toContain('Work from home is approved');
    expect((await att(hr, 'post', `/leave/requests/${own.id}/approve`).expect(409)).body.code).toBe('ON_DUTY');
  });

  it('lapsing days: told once, 30 days before the period end, what will go', async () => {
    const { runLapseNotices } = await import('../services/attendance/leaveJobs.js');
    const t = (await att(hr, 'post', '/leave/types', { name: 'Lapsing', annualDays: 6, carryForwardMax: 0 }).expect(201)).body.type;
    const user = await colleague(hr, ['ATTENDANCE::My Attendance::VIEW']);
    const emp = await person(hr, { name: 'Forgetful', code: 'S8' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: emp.id }, data: { userId: user.userId } }));
    expect(await runLapseNotices('2026-10-15')).toBe(0);
    const sent = await runLapseNotices('2026-12-05');
    expect(sent).toBeGreaterThan(0);
    await deliverOutbox(new Date(), 5000);
    const note = await platformPrisma.notification.findFirst({ where: { orgId: hr.orgId, userId: user.userId!, kind: 'attendance.leave_lapse' } });
    expect(note?.title).toContain('will lapse on 31 Dec 2026');
    expect(note?.body).toContain('Lapsing: 6');
    expect(await runLapseNotices('2026-12-06')).toBe(0);
    void t;
  });
});

describe('closure audit (27 Oct 2026): nobody decides their own, team roles keep to their team, closed months stay closed', () => {
  let hr: Ctx;
  let ownerEmp: any;
  let casual: any;
  const ownerId = async (c: Ctx) => (await platformPrisma.userOrgMembership.findFirst({ where: { orgId: c.orgId }, orderBy: { createdAt: 'asc' }, select: { userId: true } }))!.userId;
  beforeAll(async () => {
    hr = await company({ people: true, attendance: true });
    casual = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    ownerEmp = await person(hr, { name: 'Owner Self', code: 'O1' });
    const uid = await ownerId(hr);
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: ownerEmp.id }, data: { userId: uid } }));
    await att(hr, 'put', '/request-rules', { WFH: { on: true } }).expect(200);
  }, 90_000);

  it('the owner alone may decide their own request, and the audit log says so; once somebody else can, they may not', async () => {
    /* Days still to come, Monday and Tuesday (this said 1 and 2 Feb 2027). */
    const homeDay = mondayAhead(7);
    const mine = (await att(hr, 'post', '/requests', { employeeId: ownerEmp.id, kind: 'WFH', date: homeDay, reason: 'Home' }).expect(201)).body.request;
    await att(hr, 'post', `/requests/${mine.id}/approve`).expect(200);
    const lines = await platformPrisma.auditLog.findMany({ where: { orgId: hr.orgId, entityId: mine.id } });
    expect(lines.map((l) => l.action)).toEqual(expect.arrayContaining(['SELF_APPROVED', 'APPROVE']));
    const deputy = await colleague(hr, ['ATTENDANCE::Attendance Requests::VIEW', 'ATTENDANCE::Attendance Requests::APPROVE', 'ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::EDIT', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW']);
    const next = (await att(hr, 'post', '/requests', { employeeId: ownerEmp.id, kind: 'WFH', date: plusDays(homeDay, 1), reason: 'Home again' }).expect(201)).body.request;
    expect((await att(hr, 'post', `/requests/${next.id}/approve`).expect(403)).body.code).toBe('OWN_RECORD');
    /* Several at once: the same rule, per request. */
    const bulk = (await att(hr, 'post', '/requests/bulk-review', { ids: [next.id], approve: true }).expect(200)).body;
    expect(bulk).toMatchObject({ done: 0, failed: 1 });
    await att(deputy, 'post', `/requests/${next.id}/approve`).expect(200);
    /* A balance of one's own, or a pay-out: the same. */
    expect((await att(hr, 'post', '/leave/adjustments', { employeeId: ownerEmp.id, leaveTypeId: casual.id, year: Number(istToday().slice(0, 4)), days: 5, reason: 'Gift to myself' }).expect(403)).body.code).toBe('MAKER_CHECKER');
    expect((await att(hr, 'put', '/leave/allocations', { employeeId: ownerEmp.id, leaveTypeId: casual.id, year: Number(istToday().slice(0, 4)), days: 40 }).expect(403)).body.code).toBe('MAKER_CHECKER');
    await att(deputy, 'post', '/leave/adjustments', { employeeId: ownerEmp.id, leaveTypeId: casual.id, year: Number(istToday().slice(0, 4)), days: 1, reason: 'Worked a holiday' }).expect(201);
  }, 60_000);

  it('a team role does not change leave types, and does not see how a private type was used', async () => {
    const lead = await colleague(hr, ['ATTENDANCE::Leave Types::VIEW', 'ATTENDANCE::Leave Types::CREATE', 'ATTENDANCE::Leave Types::EDIT', 'ATTENDANCE::Leave Requests::VIEW'], true);
    await att(lead, 'post', '/leave/types', { name: 'Team Fun', annualDays: 3 }).expect(403);
    await att(lead, 'put', `/leave/types/${casual.id}`, { name: 'Casual', annualDays: 30 }).expect(403);
    const sick = (await att(hr, 'post', '/leave/types', { name: 'Medical', annualDays: 6, isPrivate: true }).expect(201)).body.type;
    const p = await person(hr, { name: 'Someone', code: 'O9' });
    await att(hr, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: sick.id, fromDate: '2027-03-01', toDate: '2027-03-01', reason: 'Clinic' }).expect(201);
    const seen = (await att(lead, 'get', '/leave/types').expect(200)).body.types.find((t: any) => t.id === sick.id);
    expect(seen.requests).toBeNull();
    expect((await att(hr, 'get', '/leave/types').expect(200)).body.types.find((t: any) => t.id === sick.id).requests).toBe(1);
  });

  it('once the manager has passed leave to HR, the manager can no longer reject it', async () => {
    const slow = (await att(hr, 'post', '/leave/types', { name: 'Two step', annualDays: 10, approval: 'MANAGER_THEN_HR' }).expect(201)).body.type;
    const mgr = await colleague(hr, ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW'], true);
    const mgrEmp = await person(hr, { name: 'Manager', code: 'M7' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: mgrEmp.id }, data: { userId: mgr.userId } }));
    const rep = await person(hr, { name: 'Reportee', code: 'M8', reportingManagerId: mgrEmp.id });
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: rep.id, leaveTypeId: slow.id, fromDate: '2027-04-05', toDate: '2027-04-05', reason: 'Errand' }).expect(201)).body.request;
    expect((await att(mgr, 'post', `/leave/requests/${r.id}/approve`).expect(200)).body.stage).toBe('HR');
    expect((await att(mgr, 'post', `/leave/requests/${r.id}/reject`, { note: 'Changed my mind' }).expect(403)).body.code).toBe('HR_STEP');
    await att(hr, 'post', `/leave/requests/${r.id}/reject`, { note: 'Busy week' }).expect(200);
  });

  it('a closed month refuses a holiday added, moved or removed in it, and overtime approved in it; a reopen says why and is audited', async () => {
    const p = await person(hr, { name: 'Late Worker', code: 'O2' });
    const day = (await att(hr, 'put', '/records', { employeeId: p.id, date: '2026-09-03', checkIn: '09:00', checkOut: '22:00' }).expect(200)).body.record;
    const keep = (await att(hr, 'post', '/holidays', { date: '2026-09-15', name: 'Before close' }).expect(201)).body.holiday;
    await att(hr, 'post', '/months/2026-09/close', { acknowledge: true }).expect(200);
    expect((await att(hr, 'post', '/holidays', { date: '2026-09-10', name: 'Too late' }).expect(409)).body.code).toBe('ATTENDANCE_MONTH_CLOSED');
    await att(hr, 'put', `/holidays/${keep.id}`, { date: '2026-10-15', name: 'Moved out' }).expect(409);
    await (request(app) as any).delete(`/api/orgs/${hr.orgId}/attendance/holidays/${keep.id}`).set(at(hr)).expect(409);
    if (day.overtimeMinutes) await att(hr, 'post', `/records/${day.id}/overtime`, { approved: true }).expect(409);
    expect((await att(hr, 'post', '/months/2026-09/reopen', {}).expect(400)).body.code).toBe('REASON_NEEDED');
    await att(hr, 'post', '/months/2026-09/reopen', { reason: 'Holiday was missed' }).expect(200);
    const line = await platformPrisma.auditLog.findFirst({ where: { orgId: hr.orgId, entity: 'ATTENDANCE_MONTH', action: 'REOPEN' } });
    expect(line?.message).toBe('Reopened 2026-09: Holiday was missed');
    await att(hr, 'post', '/holidays', { date: '2026-09-10', name: 'Now allowed' }).expect(201);
  });

  it('the automatic hand-on writes an audit line, and never writes over a decision taken meanwhile', async () => {
    const { runLeaveHandOns } = await import('../services/attendance/leaveJobs.js');
    const slow = (await att(hr, 'post', '/leave/types', { name: 'Hand on', annualDays: 10, approval: 'MANAGER_THEN_HR', handOnAfterDays: 2 }).expect(201)).body.type;
    const boss = await person(hr, { name: 'Away Boss', code: 'H1' });
    const staff = await person(hr, { name: 'Waiting Staff', code: 'H2', reportingManagerId: boss.id });
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: staff.id, leaveTypeId: slow.id, fromDate: '2027-05-03', toDate: '2027-05-03', reason: 'Later' }).expect(201)).body.request;
    await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.update({ where: { id: r.id }, data: { createdAt: new Date(Date.now() - 5 * 86_400_000) } }));
    await runLeaveHandOns();
    const line = await platformPrisma.auditLog.findFirst({ where: { orgId: hr.orgId, entityId: r.id, action: 'HAND_ON' } });
    expect(line?.createdByUserId).toBe('system');
  });
});
