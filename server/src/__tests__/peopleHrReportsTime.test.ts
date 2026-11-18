import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * People's reports of rounds 40 and 45 (services/people/reports.ts): absence,
 * overtime, late comers, leave by type, who is off soon, shifts planned and
 * present, sick days next to weekends, the branch table, probation outcomes
 * and reasons for leaving, on a company of five, with a team manager's cut
 * and the leaving and pay cost gates.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `rept.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Time Reports Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
async function colleague(boss: Ctx, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `colt.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const report = async (c: Ctx, id: string, query = '') => (await people(c).get(`/hr-reports/${id}${query ? `?${query}` : ''}`).expect(200)).body;

let hr: Ctx;
let manager: Ctx;
let viewer: Ctx;
const emp: Record<string, any> = {};
const type: Record<string, string> = {};

beforeAll(async () => {
  hr = await owner();
  manager = await colleague(hr, ['PEOPLE::Employees::VIEW'], true);
  viewer = await colleague(hr, ['PEOPLE::Employees::VIEW']);
  const sales = (await people(hr).post('/structure/departments', { name: 'Sales' }).expect(201)).body.item;
  const ops = (await people(hr).post('/structure/departments', { name: 'Ops' }).expect(201)).body.item;
  const add = async (key: string, body: Record<string, unknown>) => {
    emp[key] = (await people(hr).post('/employees', { code: key, dateOfJoining: '2024-01-01', ...body }).expect(201)).body.employee;
  };
  await add('A', { name: 'Asha', departmentId: sales.id });
  await add('B', { name: 'Bina', departmentId: sales.id });
  await add('C', { name: 'Chetan', departmentId: sales.id, probationEndDate: '2025-04-01' });
  await add('M', { name: 'Mira', departmentId: ops.id });
  await add('D', { name: 'Dev', departmentId: ops.id, reportingManagerId: emp.M.id, probationEndDate: '2025-03-01' });
  const accountId = emp.A.accountId;
  const orgId = hr.orgId;
  const by = 'seed';
  await runInTenant(orgId, async () => {
    await peoplePrisma.employee.update({ where: { id: emp.M.id }, data: { userId: manager.userId } });
    /* Attendance in March 2025: Asha late twice, Bina absent once and half a day, Dev on overtime. */
    const day = (key: string, date: string, status: string, extra: Record<string, unknown> = {}) => ({ accountId, orgId, employeeId: emp[key].id, date, status, createdByUserId: by, ...extra });
    await peoplePrisma.attendanceRecord.createMany({ data: [
      day('A', '2025-03-03', 'PRESENT', { lateMinutes: 10 }), day('A', '2025-03-04', 'PRESENT', { lateMinutes: 30 }), day('A', '2025-03-05', 'PRESENT', { checkIn: new Date('2025-03-05T03:30:00Z') }),
      day('B', '2025-03-03', 'ABSENT'), day('B', '2025-03-04', 'HALF_DAY'), day('B', '2025-03-05', 'PRESENT'), day('B', '2025-03-09', 'WEEKLY_OFF'),
      day('D', '2025-03-03', 'PRESENT', { overtimeMinutes: 90, overtimeApproved: true }), day('D', '2025-03-04', 'PRESENT', { overtimeMinutes: 30, lateMinutes: 5 }),
      day('D', '2025-04-01', 'PRESENT', { overtimeMinutes: 60, overtimeApproved: true }),
    ] });
    for (const [key, name, code, isPrivate] of [['sick', 'Sick leave', 'SL', false], ['casual', 'Casual leave', 'CL', false], ['wellness', 'Wellness leave', 'WL', true]] as const) {
      type[key] = (await peoplePrisma.leaveType.create({ data: { accountId, orgId, name, code, isPrivate, createdByUserId: by } })).id;
    }
    const leave = (key: string, t: string, fromDate: string, toDate: string, days: number, status = 'APPROVED') => ({ accountId, orgId, employeeId: emp[key].id, leaveTypeId: type[t], fromDate, toDate, days, reason: 'x', status, requestedByUserId: by });
    await peoplePrisma.leaveRequest.createMany({ data: [
      /* Monday after a Sunday off; and a Wednesday in the middle of the week. */
      leave('B', 'sick', '2025-03-10', '2025-03-10', 1), leave('B', 'sick', '2025-03-12', '2025-03-12', 1),
      leave('D', 'sick', '2025-03-12', '2025-03-12', 1),
      leave('A', 'casual', '2025-03-05', '2025-03-07', 3), leave('C', 'wellness', '2025-03-05', '2025-03-05', 1),
      leave('C', 'casual', '2025-03-20', '2025-03-21', 2, 'PENDING'),
    ] });
    /* Probation: Chetan confirmed, Dev extended by a review; Mira dismissed before anyone confirmed her. */
    await peoplePrisma.employee.update({ where: { id: emp.C.id }, data: { confirmedOn: '2025-03-15' } });
    await peoplePrisma.probationReview.create({ data: { accountId, orgId, employeeId: emp.D.id, periodEnd: '2025-03-01', outcome: 'EXTEND', newEndDate: '2025-06-01', decidedAt: new Date('2025-03-02T06:00:00Z') } });
    await peoplePrisma.employee.update({ where: { id: emp.B.id }, data: { probationEndDate: '2025-05-01', status: 'LEFT', dateOfLeaving: '2025-04-20', leavingType: 'TERMINATED' } });
    await peoplePrisma.employmentEpisode.updateMany({ where: { employeeId: emp.B.id, seq: 1 }, data: { endDate: '2025-04-20', endType: 'TERMINATED' } });
    /* Two exit interviews: one answered, one where the person stayed on. */
    await peoplePrisma.exitInterview.create({ data: { accountId, orgId, employeeId: emp.B.id, leavingDate: '2025-04-20', status: 'SUBMITTED', reason: 'PAY', couldKeep: 'MAYBE' } });
    await peoplePrisma.exitInterview.create({ data: { accountId, orgId, employeeId: emp.A.id, leavingDate: '2025-04-25', status: 'SUBMITTED', reason: 'GROWTH', outcome: 'RETAINED' } });
  });
}, 180_000);

describe('the list', () => {
  it('lists the new reports in their groups', async () => {
    const ids = (await people(hr).get('/hr-reports').expect(200)).body.reports.map((r: any) => r.id);
    for (const id of ['branches', 'probationoutcomes', 'exitreasons', 'absence', 'overtime', 'late', 'leavetypes', 'offsoon', 'shifts', 'sickspells']) expect(ids).toContain(id);
  });
});

describe('time and attendance', () => {
  it('absence: days lost over working days, month by month, as a line', async () => {
    const r = await report(hr, 'absence', 'from=2025-03-01&to=2025-04-30');
    expect(r.rows.map((row: any) => [row.month, row.working, row.absent, row.half, row.lost, row.rate])).toEqual([['Mar 2025', 8, 1, 1, 1.5, 18.8], ['Apr 2025', 1, 0, 0, 0, 0]]);
    expect(r.chart.kind).toBe('line');
    expect(r.chart.series[0].values).toEqual([18.8, 0]);
    expect(r.totals.working).toBe(9);
  });

  it('overtime hours, approved and not', async () => {
    const r = await report(hr, 'overtime', 'from=2025-03-01&to=2025-04-30');
    expect(r.rows.map((row: any) => [row.month, row.approved, row.waiting, row.total, row.people])).toEqual([['Mar 2025', 1.5, 0.5, 2, 1], ['Apr 2025', 1, 0, 1, 1]]);
    expect(r.totals.total).toBe(3);
  });

  it('late comers, most late first, cut to a manager’s team', async () => {
    const r = await report(hr, 'late', 'from=2025-03-01&to=2025-03-31');
    expect(r.rows.map((row: any) => [row.name, row.days, row.average, row.longest])).toEqual([['Asha', 2, 20, 30], ['Dev', 1, 5, 5]]);
    expect((await report(manager, 'late', 'from=2025-03-01&to=2025-03-31')).rows.map((row: any) => row.name)).toEqual(['Dev']);
  });

  it('shifts: due in against present on the day', async () => {
    const r = await report(hr, 'shifts', 'to=2025-03-05');
    expect(r.totals.leave).toBe(2);
    expect(r.totals.present).toBe(1);
    expect(r.totals.planned).toBe(3);
    expect(r.from).toBeNull();
  });
});

describe('leave', () => {
  it('days per leave type; a private kind reads “Private leave” for anyone but HR', async () => {
    const r = await report(hr, 'leavetypes', 'from=2025-01-01&to=2025-12-31');
    expect(r.rows.map((row: any) => [row.type, row.days, row.people])).toEqual([['Casual leave', 3, 1], ['Sick leave', 3, 2], ['Wellness leave', 1, 1]]);
    const seen = await report(viewer, 'leavetypes', 'from=2025-01-01&to=2025-12-31');
    expect(seen.rows.map((row: any) => row.type)).toEqual(['Casual leave', 'Sick leave', 'Private leave']);
  });

  it('who is off soon, by week; private leave reads “Away”', async () => {
    const r = await report(hr, 'offsoon', 'from=2025-03-03&to=2025-03-16');
    expect(r.rows.map((row: any) => [row.week, row.name, row.type])).toEqual([
      ['Week of 3 Mar', 'Asha', 'Casual leave'], ['Week of 3 Mar', 'Chetan', 'Wellness leave'],
      ['Week of 10 Mar', 'Dev', 'Sick leave'],
    ]);
    expect(r.chart.series[0].values).toEqual([2, 1]);
    expect((await report(viewer, 'offsoon', 'from=2025-03-03&to=2025-03-16')).rows.map((row: any) => row.type)).toEqual(['Casual leave', 'Away', 'Sick leave']);
  });

  it('sick spells next to a weekly off', async () => {
    const r = await report(hr, 'sickspells', 'from=2025-03-01&to=2025-03-31');
    expect(r.rows.map((row: any) => [row.name, row.spells, row.next])).toEqual([['Bina', 2, 1], ['Dev', 1, 0]]);
    expect(r.totals.share).toBe(33.3);
  });
});

describe('branches, probation and leaving', () => {
  it('branch table; pay cost only with the salary slip right', async () => {
    const r = await report(hr, 'branches', 'from=2025-03-01&to=2025-04-30');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ headcount: 4, leavers: 1 });
    expect(r.columns.map((c: any) => c.label)).toContain('Pay cost');
    const seen = await report(viewer, 'branches', 'from=2025-03-01&to=2025-04-30');
    expect(seen.columns.map((c: any) => c.label)).not.toContain('Pay cost');
    expect(seen.rows[0].pay).toBeUndefined();
  });

  it('probation outcomes month by month', async () => {
    const r = await report(hr, 'probationoutcomes', 'from=2025-03-01&to=2025-04-30');
    expect(r.rows.map((row: any) => [row.month, row.confirmed, row.extended, row.letGo])).toEqual([['Mar 2025', 1, 1, 0], ['Apr 2025', 0, 0, 1]]);
  });

  it('reasons for leaving: one line each, someone kept on left out, only for who reads every reason', async () => {
    const r = await report(hr, 'exitreasons', 'from=2025-04-01&to=2025-04-30');
    expect(r.rows.map((row: any) => [row.name, row.left, row.couldKeep])).toEqual([['Bina', '2025-04-20', 'Maybe']]);
    expect(r.chart.series[0].values).toEqual([1]);
    /* A team manager reads reasons only per leaving, not the whole report. */
    await people(manager).get('/hr-reports/exitreasons?from=2025-04-01&to=2025-04-30').expect(403);
    expect((await people(manager).get('/hr-reports').expect(200)).body.reports.map((x: any) => x.id)).not.toContain('exitreasons');
  });
});
