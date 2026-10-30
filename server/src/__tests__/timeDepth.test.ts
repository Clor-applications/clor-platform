import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Time depth (People audit 30 Oct 2026, gaps 17–20 and 22):
 * - field punches and overtime in the one Approvals inbox, decided there;
 * - holidays per branch, and built-in calendars imported for a branch, which
 *   reach only that branch's people in leave day counting;
 * - leave paid out valued on the policy's pay base and sent to Payroll;
 * - an announcement read only by its audience;
 * - who picked which restricted holiday.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(features: Record<string, boolean> = { people: true, attendance: true, peopleEngage: true }): Promise<Ctx> {
  const email = `td.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `TD Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features }).expect(200);
  return c;
}
async function colleague(boss: Ctx, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `tdc.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const ppl = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) => (await ppl(c, 'post', '/employees', { dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const ownerId = async (c: Ctx) => (await platformPrisma.userOrgMembership.findFirst({ where: { orgId: c.orgId }, orderBy: { createdAt: 'asc' }, select: { userId: true } }))!.userId;
const pastTuesday = (() => {
  const d = new Date(Date.now() - 7 * 86_400_000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();
let minute = 0;
async function fieldPunch(c: Ctx, employeeId: string) {
  const e = await runInTenant(c.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: employeeId } }));
  const mm = String(minute++ % 60).padStart(2, '0');
  return runInTenant(c.orgId, () => peoplePrisma.devicePunch.create({ data: { accountId: e.accountId, orgId: c.orgId, deviceId: 'phone', serialNumber: 'PHONE', pin: employeeId, at: new Date(`${pastTuesday}T04:${mm}:00Z`), localTime: `${pastTuesday}T09:${mm}:00`, state: 'IN', kind: 'IN', employeeId, shiftDate: pastTuesday, outsideSite: true, reviewStatus: 'PENDING' } }));
}
async function overtimeAsk(c: Ctx, employeeId: string, date = pastTuesday) {
  const e = await runInTenant(c.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: employeeId } }));
  return runInTenant(c.orgId, () => peoplePrisma.overtimeRequest.create({ data: { accountId: e.accountId, orgId: c.orgId, employeeId, date, kind: 'OVERTIME', minutes: 90, reason: 'Stock count' } }));
}

describe('field punches and overtime in the one Approvals inbox', () => {
  let hr: Ctx;
  let boss: any;
  let asha: any;
  let ravi: any;
  let self: any;
  beforeAll(async () => {
    hr = await company();
    boss = await person(hr, { name: 'Boss', code: 'B1' });
    asha = await person(hr, { name: 'Asha', code: 'A1' });
    ravi = await person(hr, { name: 'Ravi', code: 'R1', reportingManagerId: boss.id });
    self = await person(hr, { name: 'Owner Self', code: 'O1' });
    await runInTenant(hr.orgId, async () => peoplePrisma.employee.update({ where: { id: self.id }, data: { userId: await ownerId(hr) } }));
  }, 120_000);

  it('HR sees field punches and overtime beside the rest, never their own, with Home counting them', async () => {
    const punch = await fieldPunch(hr, asha.id);
    await fieldPunch(hr, self.id);
    const ot = await overtimeAsk(hr, asha.id);
    const box = (await ppl(hr, 'get', '/inbox').expect(200)).body;
    const kinds = box.items.filter((i: any) => ['PUNCH', 'OVERTIME'].includes(i.kind));
    expect(kinds.map((i: any) => [i.kind, i.id])).toEqual(expect.arrayContaining([['PUNCH', punch.id], ['OVERTIME', ot.id]]));
    expect(kinds.every((i: any) => i.employeeId !== self.id)).toBe(true);
    expect(box.items.find((i: any) => i.id === punch.id)).toMatchObject({ what: 'Field punch in', fromDate: pastTuesday, fromTime: punch.localTime.slice(11, 16), bulk: true });
    expect(box.items.find((i: any) => i.id === ot.id)).toMatchObject({ what: 'Overtime', minutes: 90, reason: 'Stock count' });
    const todos = (await ppl(hr, 'get', '/home').expect(200)).body.todos;
    expect(todos.find((t: any) => t.key === 'fieldPunches')).toMatchObject({ screen: 'approvals', params: { kind: 'PUNCH' } });
    expect(todos.find((t: any) => t.key === 'overtime')).toMatchObject({ params: { kind: 'OVERTIME' } });
  }, 60_000);

  it('approves field punches from the inbox once, however many decide at the same time', async () => {
    const p = await fieldPunch(hr, asha.id);
    const both = await Promise.all([att(hr, 'post', '/phone-punches/bulk-review', { ids: [p.id], approve: true }), att(hr, 'post', '/phone-punches/bulk-review', { ids: [p.id], approve: true })]);
    expect(both.map((r) => r.body.done).sort()).toEqual([0, 1]);
    expect((await runInTenant(hr.orgId, () => peoplePrisma.devicePunch.findUniqueOrThrow({ where: { id: p.id } }))).reviewStatus).toBe('APPROVED');
    const audit = await platformPrisma.auditLog.findMany({ where: { orgId: hr.orgId, entity: 'DevicePunch', entityId: p.id } });
    expect(audit).toHaveLength(1);
  }, 60_000);

  it('a manager-first overtime waits on the manager, and rejecting needs a reason', async () => {
    const chain = (v: string) => runInTenant(hr.orgId, async () => { const e = await peoplePrisma.employee.findUniqueOrThrow({ where: { id: boss.id } }); await peoplePrisma.attendanceSettings.upsert({ where: { orgId: hr.orgId }, create: { accountId: e.accountId, orgId: hr.orgId, overtimeApproval: v, updatedByUserId: 'u' }, update: { overtimeApproval: v } }); });
    await chain('MANAGER_THEN_HR');
    const r = await overtimeAsk(hr, ravi.id);
    expect((await ppl(hr, 'get', '/inbox').expect(200)).body.items.some((i: any) => i.id === r.id)).toBe(false);
    /* Once the manager has taken their step, it is HR's. */
    await runInTenant(hr.orgId, () => peoplePrisma.overtimeRequest.update({ where: { id: r.id }, data: { managerApprovedAt: new Date(), managerApprovedById: boss.id } }));
    expect((await ppl(hr, 'get', '/inbox').expect(200)).body.items.find((i: any) => i.id === r.id)).toMatchObject({ managerApproved: true });
    await att(hr, 'post', '/overtime/requests/bulk-review', { ids: [r.id], approve: false }).expect(400);
    const out = (await att(hr, 'post', '/overtime/requests/bulk-review', { ids: [r.id], approve: false, note: 'Not agreed beforehand' }).expect(200)).body;
    expect(out).toMatchObject({ done: 1, failed: 0 });
    expect((await runInTenant(hr.orgId, () => peoplePrisma.overtimeRequest.findUniqueOrThrow({ where: { id: r.id } }))).status).toBe('REJECTED');
    await chain('HR');
  }, 60_000);

  it('whoever stands in for the manager today decides overtime as the manager; under a manager-only chain HR may not approve', async () => {
    const chain = (v: string) => runInTenant(hr.orgId, async () => { const e = await peoplePrisma.employee.findUniqueOrThrow({ where: { id: boss.id } }); await peoplePrisma.attendanceSettings.upsert({ where: { orgId: hr.orgId }, create: { accountId: e.accountId, orgId: hr.orgId, overtimeApproval: v, updatedByUserId: 'u' }, update: { overtimeApproval: v } }); });
    const deputy = await colleague(hr, ['PEOPLE::Employees::VIEW', 'ATTENDANCE::Attendance Records::VIEW', 'ATTENDANCE::Attendance Records::EDIT']);
    const deputyEmp = await person(hr, { name: 'Deputy', code: 'D9' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: deputyEmp.id }, data: { userId: deputy.userId } }));
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    await att(hr, 'post', '/leave/stand-ins', { managerEmployeeId: boss.id, standInEmployeeId: deputyEmp.id, fromDate: today, toDate: today }).expect(201);
    await chain('MANAGER_THEN_HR');
    const r = await overtimeAsk(hr, ravi.id);
    expect((await ppl(deputy, 'get', '/inbox').expect(200)).body.items.find((i: any) => i.id === r.id)).toMatchObject({ bulk: true });
    expect((await att(deputy, 'post', '/overtime/requests/bulk-review', { ids: [r.id], approve: true }).expect(200)).body).toMatchObject({ done: 1, handedOn: 1 });
    const after = await runInTenant(hr.orgId, () => peoplePrisma.overtimeRequest.findUniqueOrThrow({ where: { id: r.id } }));
    expect(after).toMatchObject({ status: 'PENDING', managerApprovedById: deputyEmp.id });
    /* A manager-only chain: HR's approval is refused while there is an active manager. */
    await chain('MANAGER');
    const s2 = await overtimeAsk(hr, ravi.id, '2026-10-20');
    const refused = (await att(hr, 'post', '/overtime/requests/bulk-review', { ids: [s2.id], approve: true }).expect(200)).body;
    expect(refused).toMatchObject({ done: 0, failed: 1 });
    expect(refused.results[0].error).toMatch(/manager decides/i);
    /* The stand-in closes it. */
    expect((await att(deputy, 'post', '/overtime/requests/bulk-review', { ids: [s2.id], approve: true }).expect(200)).body).toMatchObject({ done: 1, handedOn: 0 });
    await chain('HR');
  }, 120_000);

  it('another company’s punch or overtime is not there; a role without the rights is refused', async () => {
    const other = await company();
    const theirs = await person(other, { name: 'Elsewhere', code: 'E1' });
    const p = await fieldPunch(other, theirs.id);
    const r = await overtimeAsk(other, theirs.id);
    expect((await att(hr, 'post', '/phone-punches/bulk-review', { ids: [p.id], approve: true }).expect(200)).body).toMatchObject({ done: 0, failed: 1 });
    expect((await att(hr, 'post', '/overtime/requests/bulk-review', { ids: [r.id], approve: true }).expect(200)).body).toMatchObject({ done: 0, failed: 1 });
    const viewer = await colleague(hr, ['PEOPLE::Employees::VIEW', 'ATTENDANCE::Attendance Devices::VIEW']);
    await att(viewer, 'post', '/phone-punches/bulk-review', { ids: [p.id], approve: true }).expect(403);
    await att(viewer, 'post', '/overtime/requests/bulk-review', { ids: [r.id], approve: true }).expect(403);
    /* Someone who decides punches only sees punches, not overtime. */
    const reader = await colleague(hr, ['ATTENDANCE::Attendance Devices::VIEW', 'ATTENDANCE::Attendance Devices::EDIT']);
    const box = (await ppl(reader, 'get', '/inbox').expect(200)).body;
    expect(box.rights).toMatchObject({ PUNCH: { see: true }, OVERTIME: { see: false } });
    expect(box.items.every((i: any) => i.kind === 'PUNCH')).toBe(true);
  }, 120_000);
});

describe('holidays per branch, and built-in calendars', () => {
  let hr: Ctx;
  let pune: string;
  let bengaluruPerson: any;
  let punePerson: any;
  let casual: any;
  beforeAll(async () => {
    hr = await company();
    const accountId = (await platformPrisma.org.findUniqueOrThrow({ where: { id: hr.orgId }, select: { accountId: true } })).accountId;
    pune = (await platformPrisma.branch.create({ data: { accountId, orgId: hr.orgId, branchCode: `PN${rnd()}`, branchName: 'Pune', addressLine1: 'Baner', state: 'Maharashtra', country: 'India', createdByUserId: await ownerId(hr) } })).id;
    bengaluruPerson = await person(hr, { name: 'Bengaluru Person', code: 'K1' });
    punePerson = await person(hr, { name: 'Pune Person', code: 'M1' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: bengaluruPerson.id }, data: { branchId: hr.branchId } }));
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: punePerson.id }, data: { branchId: pune } }));
    casual = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
  }, 120_000);

  it('lists the national and state calendars with where they came from, and each branch with its state', async () => {
    const out = (await att(hr, 'get', '/holidays/calendars?year=2027').expect(200)).body;
    /* Delhi's 17 (Annexure I), and the 14 compulsory everywhere else (para 2): the other 3 are a state capital's choice. */
    expect(out.calendars.find((c: any) => c.key === 'IN-DL-2027')).toMatchObject({ name: 'Central government, Delhi 2027', state: 'Delhi', complete: true, days: 17 });
    expect(out.calendars.find((c: any) => c.key === 'IN-2027')).toMatchObject({ complete: false, days: 14 });
    expect(out.calendars.find((c: any) => c.key === 'IN-2027').source).toMatch(/12\/2\/2023-JCA/);
    expect(out.calendars.find((c: any) => c.key === 'IN-2027').note).toMatch(/3 more days are chosen/);
    expect(out.calendars.find((c: any) => c.key === 'IN-DL-2027').note).toMatch(/Six fall on a Saturday or Sunday/);
    expect(out.calendars.some((c: any) => c.state === 'Maharashtra')).toBe(true);
    expect(out.branches.find((b: any) => b.id === pune)).toMatchObject({ name: 'Pune', state: 'Maharashtra' });
    expect((await att(hr, 'get', '/holidays/calendars?year=2031').expect(200)).body.calendars).toEqual([]);
  });

  it('imports a state’s days for its branch only, once, and a preview writes nothing', async () => {
    const key = (await att(hr, 'get', '/holidays/calendars?year=2027').expect(200)).body.calendars.find((c: any) => c.state === 'Maharashtra').key;
    const dry = (await att(hr, 'post', '/holidays/calendars/import', { key, branchId: pune, dryRun: true }).expect(200)).body;
    expect(dry.added.map((h: any) => h.date)).toEqual(['2027-05-01']);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.holiday.count({ where: { orgId: hr.orgId, date: '2027-05-01' } }))).toBe(0);
    const both = await Promise.all([att(hr, 'post', '/holidays/calendars/import', { key, branchId: pune }), att(hr, 'post', '/holidays/calendars/import', { key, branchId: pune })]);
    /* Two at once: one adds the day; the other finds it there, or is told plainly that it was just added. */
    const outcomes = both.map((r) => (r.status === 409 ? 'JUST_ADDED' : r.body.added.length)).sort();
    expect([[0, 1], [1, 'JUST_ADDED']]).toContainEqual(outcomes);
    for (const r of both) if (r.status === 409) expect(r.body).toMatchObject({ code: 'HOLIDAYS_JUST_ADDED' });
    const rows = await runInTenant(hr.orgId, () => peoplePrisma.holiday.findMany({ where: { orgId: hr.orgId, date: '2027-05-01' } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ branchId: pune, isOptional: false });
    const list = (await att(hr, 'get', '/holidays?year=2027').expect(200)).body.holidays;
    expect(list.find((h: any) => h.date === '2027-05-01')).toMatchObject({ branchName: 'Pune' });
  }, 60_000);

  it('imports the national list for everyone and leaves out what is already there', async () => {
    await att(hr, 'post', '/holidays', { date: '2027-01-26', name: 'Republic Day' }).expect(201);
    const out = (await att(hr, 'post', '/holidays/calendars/import', { key: 'IN-2027', branchId: null }).expect(201)).body;
    expect(out.skipped.map((h: any) => h.name)).toEqual(['Republic Day']);
    expect(out.added).toHaveLength(13);
    expect(out.added.map((h: any) => h.name)).not.toContain('Ram Navami');
  }, 60_000);

  it('a branch holiday is off for that branch’s people only when leave is counted', async () => {
    /* A Wednesday kept by Pune alone. */
    await att(hr, 'post', '/holidays', { date: '2026-12-16', name: 'Pune local day', branchId: pune }).expect(201);
    const ask = async (employeeId: string) => (await att(hr, 'post', '/leave/requests', { employeeId, leaveTypeId: casual.id, fromDate: '2026-12-15', toDate: '2026-12-17', reason: 'Family' }).expect(201)).body.request.days;
    expect(await ask(punePerson.id)).toBe(2);
    expect(await ask(bengaluruPerson.id)).toBe(3);
  }, 60_000);

  it('refuses a branch of another company, a calendar that is not there, and a role that may not add holidays', async () => {
    const other = await company();
    expect((await att(hr, 'post', '/holidays', { date: '2026-12-18', name: 'Not ours', branchId: other.branchId }).expect(400)).body.error).toMatch(/branch/i);
    await att(hr, 'post', '/holidays/calendars/import', { key: 'NOPE', branchId: null }).expect(400);
    await att(hr, 'post', '/holidays/calendars/import', { key: 'IN-2027', branchId: other.branchId }).expect(400);
    const viewer = await colleague(hr, ['ATTENDANCE::Holidays::VIEW']);
    await att(viewer, 'get', '/holidays/calendars?year=2027').expect(200);
    await att(viewer, 'post', '/holidays/calendars/import', { key: 'IN-2027', branchId: null }).expect(403);
  }, 120_000);

  it('shows HR who picked which restricted holiday, and what each person has left', async () => {
    await runInTenant(hr.orgId, async () => { const p = await peoplePrisma.employee.findUniqueOrThrow({ where: { id: punePerson.id } }); await peoplePrisma.attendanceSettings.upsert({ where: { orgId: hr.orgId }, create: { accountId: p.accountId, orgId: hr.orgId, restrictedHolidayQuota: 2, updatedByUserId: 'u' }, update: { restrictedHolidayQuota: 2 } }); });
    const optional = (await att(hr, 'post', '/holidays', { date: '2026-12-24', name: 'Christmas Eve', isOptional: true }).expect(201)).body.holiday;
    const e = await runInTenant(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: punePerson.id } }));
    await runInTenant(hr.orgId, () => peoplePrisma.holidayPick.create({ data: { accountId: e.accountId, orgId: hr.orgId, employeeId: punePerson.id, holidayId: optional.id, year: 2026 } }));
    const out = (await att(hr, 'get', '/leave/holidays/restricted/picks?year=2026').expect(200)).body;
    expect(out.quota).toBe(2);
    expect(out.holidays.find((h: any) => h.id === optional.id).people.map((p: any) => p.name)).toEqual(['Pune Person']);
    expect(out.people.find((p: any) => p.employeeId === punePerson.id)).toMatchObject({ picked: 1, left: 1 });
    const outsider = await colleague(hr, ['PEOPLE::Employees::VIEW']);
    await att(outsider, 'get', '/leave/holidays/restricted/picks?year=2026').expect(403);
  }, 60_000);
});

describe('leave paid out, valued on the policy and sent to Payroll', () => {
  let hr: Ctx;
  let el: any;
  let asha: any;
  let year: number;
  beforeAll(async () => {
    hr = await company({ people: true, attendance: true, payroll: true });
    asha = await person(hr, { name: 'Asha', code: 'P1' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: asha.id }, data: { branchId: hr.branchId } }));
    el = (await att(hr, 'post', '/leave/types', { name: 'Earned', annualDays: 18, encashable: true, maxEncashDays: 10, encashBase: 'BASIC_DA', encashDivisor: 26 }).expect(201)).body.type;
    expect(el).toMatchObject({ encashBase: 'BASIC_DA', encashDivisor: 26 });
    year = (await att(hr, 'get', '/leave/balances').expect(200)).body.year;
    await att(hr, 'put', '/leave/allocations', { employeeId: asha.id, leaveTypeId: el.id, year, days: 18 }).expect(200);
  }, 120_000);

  it('without an approved payslip the days wait in Payroll, saying why', async () => {
    const out = (await att(hr, 'post', '/leave/adjustments', { employeeId: asha.id, leaveTypeId: el.id, year, kind: 'ENCASH', days: 2, reason: 'Paid out on request' }).expect(201)).body;
    expect(out.payout).toMatchObject({ sent: false, amount: null });
    expect(out.payout.explanation).toMatch(/No approved payslip/);
    const list = (await request(app).get(`/api/orgs/${hr.orgId}/payroll/leave-encashments`).set(at(hr)).expect(200)).body.encashments;
    expect(list.find((x: any) => x.id === out.adjustment.id)).toMatchObject({ days: 2, amount: null, leaveType: 'Earned' });
  }, 60_000);

  it('with a payslip, basic and DA ÷ 26 becomes a draft earning in the open month of today, in the person’s branch', async () => {
    const accountId = (await platformPrisma.org.findUniqueOrThrow({ where: { id: hr.orgId }, select: { accountId: true } })).accountId;
    const t = new Date(Date.now() + 330 * 60_000);
    const ym = (d: Date) => d.toISOString().slice(0, 7);
    const monthOf = (k: number) => { const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + k, 1)); const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); return { start: `${ym(d)}-01`, end: end.toISOString().slice(0, 10) }; };
    let current = '';
    await runInTenant(hr.orgId, async () => {
      /* Counted by Payroll's "counts for gratuity" mark, not by a name: "Basic Wage" coded BAS, and DA. */
      const comp = async (code: string, name: string, extra: Record<string, unknown> = {}) => (await payrollPrisma.salaryComponent.create({ data: { accountId, orgId: hr.orgId, code, name, type: 'EARNING', createdByUserId: 'u', ...extra } })).id;
      const basic = await comp('BAS', 'Basic Wage', { includeInGratuityWage: true });
      const da = await comp('DA', 'Dearness allowance', { includeInGratuityWage: true });
      const hra = await comp('HRA', 'House rent allowance');
      const bonus = await comp('FEST', 'Festival bonus', { isVariable: true });
      await comp('LEAVE_ENCASH', 'Leave encashment');
      /* A stale month left open two months back, and the month of today: it goes to today's. */
      const stale = monthOf(-2);
      await payrollPrisma.payrollPeriod.create({ data: { accountId, orgId: hr.orgId, name: `Stale ${rnd()}`, startDate: stale.start, endDate: stale.end, createdByUserId: 'u' } });
      const now = monthOf(0);
      current = (await payrollPrisma.payrollPeriod.create({ data: { accountId, orgId: hr.orgId, name: `Now ${rnd()}`, startDate: now.start, endDate: now.end, createdByUserId: 'u' } })).id;
      /* The structure Asha is on: basic, DA and HRA, not the bonus. */
      const structure = await payrollPrisma.salaryStructure.create({ data: { accountId, orgId: hr.orgId, name: `Staff ${rnd()}`, effectiveFrom: '2026-01-01', status: 'ACTIVE', createdByUserId: 'u' } });
      for (const componentId of [basic, da, hra]) await payrollPrisma.salaryStructureComponent.create({ data: { accountId, orgId: hr.orgId, structureId: structure.id, componentId } });
      await payrollPrisma.salaryAssignment.create({ data: { accountId, orgId: hr.orgId, employeeId: asha.id, structureId: structure.id, effectiveFrom: '2026-01-01', annualCtc: 408000, monthlyCtc: 34000, createdByUserId: 'u' } });
      const run = await payrollPrisma.payrollRun.create({ data: { accountId, orgId: hr.orgId, number: `RUN-${rnd()}`, periodId: 'p', payrollDate: '2026-10-31', status: 'APPROVED', createdByUserId: 'u' } });
      const slip = await payrollPrisma.salarySlip.create({ data: { accountId, orgId: hr.orgId, number: 'SLIP-OCT', runId: run.id, employeeId: asha.id, periodId: 'p', payrollDate: '2026-10-31', createdByUserId: 'u' } });
      const line = (componentId: string, code: string, amount: number, fullAmount: number) => payrollPrisma.salarySlipLine.create({ data: { accountId, orgId: hr.orgId, slipId: slip.id, componentId, componentCode: code, componentName: code, type: 'EARNING', amount, fullAmount } });
      /* A month cut short by leave: the full month's rate counts, not what it paid. */
      await line(basic, 'BASIC', 18000, 20000);
      await line(da, 'DA', 5200, 6000);
      await line(hra, 'HRA', 8000, 8000);
      /* A bonus month: the bonus is not a month's wage on either base. */
      await line(bonus, 'FEST', 15000, 15000);
    });
    const out = (await att(hr, 'post', '/leave/adjustments', { employeeId: asha.id, leaveTypeId: el.id, year, kind: 'ENCASH', days: 3, reason: 'Paid out on request' }).expect(201)).body;
    expect(out.payout).toMatchObject({ sent: true, amount: 3000 });
    expect(out.payout.explanation).toMatch(/₹26,000 ÷ 26/);
    const earning = await runInTenant(hr.orgId, () => payrollPrisma.payrollAdjustment.findUniqueOrThrow({ where: { id: `leave-encash:${out.adjustment.id}` } }));
    expect(earning).toMatchObject({ status: 'DRAFT', type: 'EARNING', employeeId: asha.id, periodId: current, branchId: hr.branchId });
    expect(Number(earning.amount)).toBe(3000);
    /* Linked: the leave line cannot be removed while Payroll holds its earning. */
    await att(hr, 'delete' as any, `/leave/adjustments/${out.adjustment.id}`).expect(409);
  }, 60_000);

  it('gross is the salary structure’s fixed pay: no bonus, rounded once', async () => {
    const gross = (await att(hr, 'post', '/leave/types', { name: 'Privilege', annualDays: 10, encashable: true, encashBase: 'GROSS', encashDivisor: 26 }).expect(201)).body.type;
    await att(hr, 'put', '/leave/allocations', { employeeId: asha.id, leaveTypeId: gross.id, year, days: 10 }).expect(200);
    const out = (await att(hr, 'post', '/leave/adjustments', { employeeId: asha.id, leaveTypeId: gross.id, year, kind: 'ENCASH', days: 1, reason: 'Paid out on request' }).expect(201)).body;
    /* 20,000 + 6,000 + 8,000 = 34,000 ÷ 26; the 15,000 bonus is left out. */
    expect(out.payout).toMatchObject({ sent: true, amount: 1307.69 });
    await att(hr, 'post', '/leave/types', { name: 'Basic only', annualDays: 5, encashable: true, encashBase: 'BASIC' }).expect(400);
  }, 60_000);

  it('someone who may change leave but not see payroll is never told what the person earns', async () => {
    const clerk = await colleague(hr, ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::EDIT', 'PEOPLE::Employees::VIEW']);
    const out = (await att(clerk, 'post', '/leave/adjustments', { employeeId: asha.id, leaveTypeId: el.id, year, kind: 'ENCASH', days: 1, reason: 'Paid out on request' }).expect(201)).body;
    expect(out.payout).toEqual({ sent: false, amount: null, explanation: null, why: expect.stringMatching(/Payroll values/) });
    expect(JSON.stringify(out)).not.toMatch(/26,000|SLIP-OCT/);
    /* Payroll sees the amount to check in its own list. */
    const list = (await request(app).get(`/api/orgs/${hr.orgId}/payroll/leave-encashments`).set(at(hr)).expect(200)).body.encashments;
    expect(list.find((x: any) => x.id === out.adjustment.id)).toMatchObject({ amount: 1000 });
    /* One who may read payroll adjustments but not add them sees the amount, and Payroll adds it. */
    const reader = await colleague(hr, ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::EDIT', 'PEOPLE::Employees::VIEW', 'PAYROLL::Payroll Adjustments::VIEW']);
    const seen = (await att(reader, 'post', '/leave/adjustments', { employeeId: asha.id, leaveTypeId: el.id, year, kind: 'ENCASH', days: 1, reason: 'Paid out on request' }).expect(201)).body;
    expect(seen.payout).toMatchObject({ sent: false, amount: 1000 });
  }, 90_000);

  it('refuses a divisor other than 26 or 30', async () => {
    await att(hr, 'post', '/leave/types', { name: 'Odd', annualDays: 5, encashable: true, encashDivisor: 31 }).expect(400);
  });
});

describe('an announcement reaches its audience only', () => {
  let hr: Ctx;
  let ops: any;
  let fin: any;
  let opsPerson: any;
  let finPerson: any;
  let portal: (employeeId: string, code: string) => Promise<any>;
  beforeAll(async () => {
    hr = await company();
    ops = (await ppl(hr, 'post', '/structure/departments', { name: 'Operations' }).expect(201)).body.item;
    fin = (await ppl(hr, 'post', '/structure/departments', { name: 'Finance' }).expect(201)).body.item;
    opsPerson = await person(hr, { name: 'Ops Person', code: 'D1', departmentId: ops.id });
    finPerson = await person(hr, { name: 'Fin Person', code: 'D2', departmentId: fin.id });
    const access = (await att(hr, 'get', '/portal-access').expect(200)).body.company.code;
    portal = async (employeeId: string, code: string) => {
      const issued = (await att(hr, 'post', '/portal-access/codes', { employeeIds: [employeeId] }).expect(200)).body.codes[0].activationCode;
      const token = (await request(app).post('/api/portal/activate').send({ company: access, employeeCode: code, activationCode: issued, password: 'mine pass 1' }).expect(200)).body.token;
      return { get: (p: string) => request(app).get(`/api/portal${p}`).set('Authorization', `Bearer ${token}`) };
    };
  }, 120_000);
  const post = (c: Ctx, title: string, details: Record<string, unknown>) => ppl(c, 'post', '/workspace/announcements', { title, status: 'PUBLISHED', details: { body: 'Read me', ...details } });

  it('the employee app shows a department’s announcement to that department, and everyone’s to all', async () => {
    await post(hr, 'For operations', { audience: 'Operations', audienceKind: 'DEPARTMENT', audienceIds: [ops.id] }).expect(201);
    await post(hr, 'For all', { audience: 'Everyone', audienceKind: 'ALL' }).expect(201);
    /* Written before the audience was a choice: words only, read by everyone. */
    await post(hr, 'Old style', { audience: 'Whole team' }).expect(201);
    /* A file whose department words say Finance but whose department is Operations: the id decides. */
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: opsPerson.id }, data: { department: 'Finance' } }));
    await post(hr, 'For finance', { audience: 'Finance', audienceKind: 'DEPARTMENT', audienceIds: [fin.id] }).expect(201);
    const a = await portal(opsPerson.id, 'D1');
    const b = await portal(finPerson.id, 'D2');
    const titles = async (p: any) => (await p.get('/company-updates').expect(200)).body.announcements.map((x: any) => x.title).sort();
    expect(await titles(a)).toEqual(['For all', 'For operations', 'Old style']);
    expect(await titles(b)).toEqual(['For all', 'For finance', 'Old style']);
  }, 60_000);

  it('a reader in People sees only what is published for them; the author sees every one', async () => {
    const reader = await colleague(hr, ['PEOPLE::Announcements::VIEW']);
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: finPerson.id }, data: { userId: reader.userId } }));
    const seen = (await ppl(reader, 'get', '/workspace/announcements').expect(200)).body.records.map((r: any) => r.title);
    expect(seen).toContain('For all');
    expect(seen).not.toContain('For operations');
    const all = (await ppl(hr, 'get', '/workspace/announcements').expect(200)).body.records.map((r: any) => r.title);
    expect(all).toContain('For operations');
  }, 60_000);

  it('refuses an audience with nobody in it, or someone of another company', async () => {
    expect((await post(hr, 'Nobody', { audienceKind: 'PEOPLE', audienceIds: [] }).expect(400)).body.error).toMatch(/who this is for/);
    const other = await company();
    const stranger = await person(other, { name: 'Stranger', code: 'S1' });
    await post(hr, 'Stranger', { audienceKind: 'PEOPLE', audienceIds: [stranger.id] }).expect(400);
    await post(hr, 'Bad branch', { audienceKind: 'BRANCH', audienceIds: [other.branchId] }).expect(400);
    await post(hr, 'Our branch', { audienceKind: 'BRANCH', audienceIds: [hr.branchId] }).expect(201);
  }, 60_000);
});
