import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * HR's month in People (docs/people/design-v1/audit-views/HR-VIEW.md):
 * one Approvals inbox over People approvals, leave, attendance requests and
 * Help Desk; leave decided several at once through the same checks as one;
 * Home counting all of it; the muster roll and a leave summary for a
 * People-only company; payable and loss-of-pay days from Payroll's own
 * calculation; work from home and on duty beside leave, never as leave.
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
  const email = `hri.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `HRI Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features }).expect(200);
  return c;
}
async function colleague(boss: Ctx, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `hric.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const ppl = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) => (await ppl(c, 'post', '/employees', { dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const RULES = { defaultShiftId: null, lateAllowancePerMonth: 0, latePenaltyEvery: 0, photoRetentionDays: 90, readerUsersBecomeEmployees: false };
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const LEAVE_DECIDE = ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW'];

describe('one Approvals inbox', () => {
  let hr: Ctx;
  let clerk: Ctx;
  let lead: Ctx;
  let casual: any;
  let asha: any;
  let report: any;
  let leave: any;
  let teamLeave: any;
  let wfh: any;
  beforeAll(async () => {
    hr = await company({ people: true, attendance: true });
    casual = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    await att(hr, 'put', '/request-rules', { WFH: { on: true }, ON_DUTY: { on: true } }).expect(200);
    clerk = await colleague(hr, ['PEOPLE::Requests::VIEW', 'PEOPLE::Requests::APPROVE', 'PEOPLE::Employees::VIEW']);
    lead = await colleague(hr, LEAVE_DECIDE, true);
    const leadEmp = await person(hr, { name: 'Lead', code: 'I0' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: leadEmp.id }, data: { userId: lead.userId } }));
    asha = await person(hr, { name: 'Asha', code: 'I1' });
    report = await person(hr, { name: 'Report', code: 'I2', reportingManagerId: leadEmp.id });
    leave = (await att(hr, 'post', '/leave/requests', { employeeId: asha.id, leaveTypeId: casual.id, fromDate: '2026-12-01', toDate: '2026-12-01', reason: 'Errand' }).expect(201)).body.request;
    wfh = (await att(hr, 'post', '/requests', { employeeId: asha.id, kind: 'WFH', date: '2026-12-02', reason: 'Plumber coming' }).expect(201)).body.request;
    await ppl(hr, 'post', '/desk', { employeeId: asha.id, category: 'PAYROLL', subject: 'Salary not credited', description: 'October salary missing' }).expect(201);
    teamLeave = (await att(hr, 'post', '/leave/requests', { employeeId: report.id, leaveTypeId: casual.id, fromDate: '2026-12-03', toDate: '2026-12-03', reason: 'Exam' }).expect(201)).body.request;
    /* A People approval routed to the clerk by name. */
    await ppl(hr, 'post', '/approval-rules', { requestType: 'JOB_CHANGE', name: 'Job changes', steps: [{ approver: { kind: 'USER', id: clerk.userId }, dueDays: 2 }] }).expect(201);
    await ppl(hr, 'post', '/requests', { requestType: 'JOB_CHANGE', subjectEmployeeId: asha.id, title: 'Grade for Asha', payload: { employeeId: asha.id, fields: { gradeId: { before: null, after: null } }, reason: 'Correction' } }).expect(201);
  }, 120_000);

  it('HR sees leave, attendance requests and help desk in one list, oldest first, with a count per kind', async () => {
    const box = (await ppl(hr, 'get', '/inbox').expect(200)).body;
    expect(box.items.map((i: any) => i.kind)).toEqual(['LEAVE', 'ATTENDANCE', 'HELPDESK', 'LEAVE']);
    expect(box.counts).toMatchObject({ LEAVE: 2, ATTENDANCE: 1, HELPDESK: 1, APPROVAL: 0, all: 4 });
    const since = box.items.map((i: any) => i.since);
    expect([...since].sort()).toEqual(since);
    expect(box.items[0]).toMatchObject({ id: leave.id, employeeName: 'Asha', what: 'Casual', fromDate: '2026-12-01', days: 1, bulk: true });
    expect(box.items[1]).toMatchObject({ id: wfh.id, what: 'Work from home', subKind: 'WFH', bulk: true });
    expect(box.items[2]).toMatchObject({ kind: 'HELPDESK', what: 'Salary not credited', bulk: false });
  });

  it('the approver named on a People approval sees it, and only what their rights open', async () => {
    const box = (await ppl(clerk, 'get', '/inbox').expect(200)).body;
    expect(box.items.map((i: any) => [i.kind, i.what])).toEqual([['APPROVAL', 'Grade for Asha']]);
    expect(box.rights).toMatchObject({ APPROVAL: { see: true, decide: true }, LEAVE: { see: false }, ATTENDANCE: { see: false }, HELPDESK: { see: false } });
  });

  it('a team lead sees their team only; a role with none of the rights is refused', async () => {
    const box = (await ppl(lead, 'get', '/inbox').expect(200)).body;
    expect(box.items.map((i: any) => i.id)).toEqual([teamLeave.id]);
    const nobody = await colleague(hr, ['PEOPLE::Employees::VIEW']);
    await ppl(nobody, 'get', '/inbox').expect(403);
  });

  it("Home's to-do counts leave, attendance requests and People approvals, opening the inbox on that kind", async () => {
    const todos = (await ppl(hr, 'get', '/home').expect(200)).body.todos;
    const by = (k: string) => todos.find((t: any) => t.key === k);
    expect(by('leave')).toMatchObject({ count: 2, screen: 'approvals', params: { kind: 'LEAVE' } });
    expect(by('attendanceRequests')).toMatchObject({ count: 1, screen: 'approvals', params: { kind: 'ATTENDANCE' } });
    expect(by('helpdesk')).toMatchObject({ count: 1 });
    const mine = (await ppl(clerk, 'get', '/home').expect(200)).body.todos;
    expect(mine.find((t: any) => t.key === 'peopleApprovals')).toMatchObject({ count: 1, screen: 'approvals' });
  });

  it('approved work from home shows beside leave as its own mark, never as leave', async () => {
    const today = todayIst();
    const home = (await att(hr, 'post', '/requests', { employeeId: report.id, kind: 'WFH', date: today, reason: 'Home day' }).expect(201)).body.request;
    await att(hr, 'post', `/requests/${home.id}/approve`, {}).expect(200);
    const overview = (await att(hr, 'get', '/leave/overview').expect(200)).body;
    expect(overview.workingAwayToday.map((r: any) => [r.employeeName, r.kind])).toEqual([['Report', 'WFH']]);
    expect(overview.awayToday.some((r: any) => r.employeeId === report.id)).toBe(false);
    await att(hr, 'post', `/requests/${wfh.id}/approve`, {}).expect(200);
    const month = (await att(hr, 'get', '/leave/working-away?month=2026-12').expect(200)).body.rows;
    expect(month.map((r: any) => [r.employeeName, r.kind, r.fromDate])).toEqual([['Asha', 'WFH', '2026-12-02']]);
    /* A team lead's calendar holds their team's only. */
    expect((await att(lead, 'get', '/leave/working-away?month=2026-12').expect(200)).body.rows).toEqual([]);
  });
});

describe('leave decided several at once', () => {
  let hr: Ctx;
  let boss: Ctx;
  let casual: any;
  let worker: any;
  let loner: any;
  beforeAll(async () => {
    hr = await company({ people: true, attendance: true });
    casual = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    boss = await colleague(hr, LEAVE_DECIDE, true);
    const bossEmp = await person(hr, { name: 'Boss', code: 'B1' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: bossEmp.id }, data: { userId: boss.userId } }));
    worker = await person(hr, { name: 'Worker', code: 'B2', reportingManagerId: bossEmp.id });
    loner = await person(hr, { name: 'Loner', code: 'B3' });
    await att(hr, 'put', '/rules', { ...RULES, leaveApproval: 'MANAGER_THEN_HR' }).expect(200);
  }, 120_000);

  const ask = async (employeeId: string, date: string) => (await att(hr, 'post', '/leave/requests', { employeeId, leaveTypeId: casual.id, fromDate: date, toDate: date, reason: 'Errand' }).expect(201)).body.request;

  it('each goes through the same checks as one: the manager first, then HR, never the manager twice', async () => {
    const w = await ask(worker.id, '2026-12-01');
    const l = await ask(loner.id, '2026-12-02');
    /* HR before the manager: refused for the worker, done for the person with no manager. */
    const first = (await att(hr, 'post', '/leave/requests/bulk-review', { ids: [w.id, l.id], approve: true }).expect(200)).body;
    expect(first).toMatchObject({ done: 1, failed: 1, handedOn: 0 });
    expect(first.results).toEqual([expect.objectContaining({ id: w.id, code: 'MANAGER_FIRST' })]);
    /* The worker's leave waits on the manager, so it is in their inbox, not HR's. */
    expect((await ppl(hr, 'get', '/inbox').expect(200)).body.items.map((i: any) => i.id)).not.toContain(w.id);
    expect((await ppl(boss, 'get', '/inbox').expect(200)).body.items.map((i: any) => i.id)).toEqual([w.id]);
    const step = (await att(boss, 'post', '/leave/requests/bulk-review', { ids: [w.id], approve: true, note: 'Fine' }).expect(200)).body;
    expect(step).toMatchObject({ done: 1, failed: 0, handedOn: 1 });
    const again = (await att(boss, 'post', '/leave/requests/bulk-review', { ids: [w.id], approve: true }).expect(200)).body;
    expect(again.results[0].code).toBe('HR_STEP');
    const box = (await ppl(hr, 'get', '/inbox').expect(200)).body.items;
    expect(box.find((i: any) => i.id === w.id)).toMatchObject({ managerApproved: true });
    expect((await att(hr, 'post', '/leave/requests/bulk-review', { ids: [w.id], approve: true }).expect(200)).body).toMatchObject({ done: 1, failed: 0 });
    expect((await att(hr, 'get', `/leave/requests/${w.id}`).expect(200)).body.request.status).toBe('APPROVED');
  });

  it('rejecting several needs one note, which each person gets; a decided one says so', async () => {
    const a = await ask(loner.id, '2026-12-08');
    const b = await ask(loner.id, '2026-12-09');
    await att(hr, 'post', '/leave/requests/bulk-review', { ids: [a.id, b.id], approve: false }).expect(400);
    await att(hr, 'post', '/leave/requests/bulk-review', { ids: [], approve: true }).expect(400);
    const out = (await att(hr, 'post', '/leave/requests/bulk-review', { ids: [a.id, b.id], approve: false, note: 'Audit week' }).expect(200)).body;
    expect(out).toMatchObject({ done: 2, failed: 0 });
    const story = (await att(hr, 'get', `/leave/requests/${b.id}`).expect(200)).body.request;
    expect(story).toMatchObject({ status: 'REJECTED', reviewNote: 'Audit week' });
    const late = (await att(hr, 'post', '/leave/requests/bulk-review', { ids: [a.id], approve: true }).expect(200)).body;
    expect(late.results[0].error).toMatch(/already rejected/);
  });

  it('needs the approve right, and a team role reaches only its team', async () => {
    const viewer = await colleague(hr, ['ATTENDANCE::Leave Requests::VIEW', 'PEOPLE::Employees::VIEW']);
    const l = await ask(loner.id, '2026-12-10');
    await att(viewer, 'post', '/leave/requests/bulk-review', { ids: [l.id], approve: true }).expect(403);
    const out = (await att(boss, 'post', '/leave/requests/bulk-review', { ids: [l.id], approve: true }).expect(200)).body;
    expect(out.results[0]).toMatchObject({ id: l.id, error: 'No such request.' });
  });
});

describe('a People-only company: registers, payable days', () => {
  let hr: Ctx;
  let asha: any;
  let ravi: any;
  beforeAll(async () => {
    hr = await company({ people: true, attendance: false, payroll: false });
    const casual = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    const unpaid = (await att(hr, 'post', '/leave/types', { name: 'Unpaid', annualDays: 0, isPaid: false }).expect(201)).body.type;
    asha = await person(hr, { name: 'Asha', code: 'M1', guardianName: 'Ramesh' });
    ravi = await person(hr, { name: 'Ravi', code: 'M2' });
    const c = (await att(hr, 'post', '/leave/requests', { employeeId: asha.id, leaveTypeId: casual.id, fromDate: '2026-12-01', toDate: '2026-12-01', reason: 'Errand' }).expect(201)).body.request;
    await att(hr, 'post', `/leave/requests/${c.id}/approve`).expect(200);
    const u = (await att(hr, 'post', '/leave/requests', { employeeId: ravi.id, leaveTypeId: unpaid.id, fromDate: '2026-12-02', toDate: '2026-12-03', reason: 'Village' }).expect(201)).body.request;
    await att(hr, 'post', `/leave/requests/${u.id}/approve`).expect(200);
  }, 120_000);

  it('the muster roll comes from the day record; a day with nothing recorded is blank, not absent', async () => {
    const m = (await ppl(hr, 'get', '/compliance/registers/muster?month=2026-12').expect(200)).body;
    expect(m.columns.slice(0, 4)).toEqual(['Employee ID', 'Name', 'Father’s / husband’s name', '1']);
    expect(m.columns).toHaveLength(3 + 31 + 4);
    const row = m.rows.find((r: string[]) => r[1] === 'Asha');
    expect(row[2]).toBe('Ramesh');
    expect(row[3]).toBe('L');
    expect(row[4]).toBe('');
    expect(row[3 + 31 + 2]).toBe('1');
    expect(row[3 + 31 + 1]).toBe('0');
    expect(m.notes.join(' ')).toMatch(/left blank, not marked absent/);
    await ppl(hr, 'get', '/compliance/registers/muster?month=2026-13').expect(400);
  });

  it('a leave summary by department and type, paid and unpaid', async () => {
    const s = (await ppl(hr, 'get', '/compliance/registers/leave-summary?from=2026-12-01&to=2026-12-31').expect(200)).body;
    expect(s.columns).toEqual(['Department', 'Leave type', 'Paid', 'People', 'Days']);
    expect(s.rows).toEqual([['No department', 'Casual', 'Paid', '1', '1'], ['No department', 'Unpaid', 'Unpaid', '1', '2']]);
    expect(s.totals).toEqual(['All', '', '', '2', '3']);
    expect(s.notes[0]).toBe('3 days of leave taken, 2 of them unpaid.');
  });

  it('registers are for those who keep the records', async () => {
    const lead = await colleague(hr, ['PEOPLE::Employees::VIEW'], true);
    await ppl(lead, 'get', '/compliance/registers/muster?month=2026-12').expect(403);
    await ppl(lead, 'get', '/compliance/registers/leave-summary?from=2026-12-01&to=2026-12-31').expect(403);
  });

  it("payable and loss-of-pay days for the month are Payroll's from-leave figures", async () => {
    const p = (await att(hr, 'get', '/payable-days?month=2026-12').expect(200)).body;
    expect(p.source).toBe('LEAVE');
    expect(p.payrollTaken).toBeNull();
    const by = (name: string) => p.rows.find((r: any) => r.name === name);
    expect(by('Ravi')).toMatchObject({ totalDays: 31, unpaidLeaveDays: 2, lossOfPayDays: 2, payableDays: 29, why: 'Unpaid' });
    expect(by('Asha')).toMatchObject({ totalDays: 31, lossOfPayDays: 0, payableDays: 31 });
    const noRights = await colleague(hr, ['PEOPLE::Employees::VIEW']);
    await att(noRights, 'get', '/payable-days?month=2026-12').expect(403);
  });
});
