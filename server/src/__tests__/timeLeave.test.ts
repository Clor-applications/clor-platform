import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const app = buildApp().listen(0);
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
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
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
    await att(hr, 'post', '/holidays', { date: '2026-12-08', name: 'Test Day' }).expect(201);
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
    const balances = (await att(lead, 'get', '/leave/balances').expect(200)).body.rows.map((x: any) => x.employeeId);
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

  it('the paged list counts every tab under the same search', async () => {
    const page = (await att(hr, 'get', '/leave/requests?limit=1&offset=0&q=Report').expect(200)).body;
    expect(page.requests).toHaveLength(1);
    expect(page.total).toBe(page.counts.all);
    expect(page.counts.CANCELLED).toBe(2);
    expect(page.requests.every((x: any) => x.employeeId === report.id)).toBe(true);
  });

  it('the overview: away today, waiting oldest first, a policy tried on real people', async () => {
    const t = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: leadEmp.id, leaveTypeId: casual.id, fromDate: t, toDate: t, reason: 'Today off' }).expect(201)).body.request;
    if (r.days) await att(hr, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    const o = (await att(hr, 'get', '/leave/overview').expect(200)).body;
    if (r.days) expect(o.awayToday.map((x: any) => x.employeeId)).toContain(leadEmp.id);
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
