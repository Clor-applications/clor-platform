import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Attendance rules (WORKFLOW-GAP-RESEARCH-2026-10-30 4.4, 4.5, 4.6, B19):
 *  - late marks and early exits that cost part of a day, from leave first, waived with a reason or
 *    applied by HR, feeding payable days; the month's limit on missed punches, HR still entering one;
 *  - the missing-punch nudge: once a day per person, never for a day on leave, the manager's list;
 *  - unexplained absence: the case, two recorded notices, the leaving as ABSCONDED, the hold;
 *  - women's consent to night work, checked wherever a night shift is given.
 * Each with the allowed path, the refusal, another company, another role and the races that matter.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { istInstant } = await import('../services/attendance/compute.js');
const { touchesNight, rulesOf, legacyMarks } = await import('../services/attendance/timeRules.js');
const { costOf, policyText } = await import('../services/attendance/markRules.js');
const { nudgeCompany, startPunchNudges } = await import('../services/attendance/punchNudge.js');
const { checkCompany, startAbsenceChecks } = await import('../services/people/absconding.js');
const { registeredJobs } = await import('../services/jobRegistry.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId?: string; userId?: string; email?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `rules.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Rules Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  const org = await platformPrisma.org.findUnique({ where: { id: c.orgId }, select: { accountId: true } });
  c.accountId = org!.accountId;
  return c;
}
async function withRole(boss: Ctx, label: string, name: string): Promise<Ctx> {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body;
  const role = (roles.roles || roles).find((r: any) => r.name === label);
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, accountId: boss.accountId, userId: user.body.user.id, email };
}
const call = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any);
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => call(c, m, `/attendance${p}`, b);
const ppl = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => call(c, m, `/people${p}`, b);
const person = async (c: Ctx, body: Record<string, unknown>) => (await ppl(c, 'post', '/employees', { dateOfJoining: '2025-01-01', ...body }).expect(201)).body.employee;

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const lastMonth = (() => {
  const [y, m] = istToday().slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
})();
/* The first weekdays (Mon to Sat; Sunday is the default weekly off) of last month. */
const workdays = (() => {
  const out: string[] = [];
  for (let d = `${lastMonth}-01`; d.slice(0, 7) === lastMonth; d = plus(d, 1)) if (dow(d) !== 0) out.push(d);
  return out;
})();
const day = async (c: Ctx, employeeId: string, date: string, f: { inAt?: string; outAt?: string | null; status?: string; late?: number; early?: number }) =>
  runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId, date } },
    create: { accountId: c.accountId!, orgId: c.orgId, employeeId, date, status: f.status || 'PRESENT', source: 'MANUAL', checkIn: f.inAt === undefined ? istInstant(date, '09:00') : f.inAt ? istInstant(date, f.inAt) : null, checkOut: f.outAt === undefined ? istInstant(date, '18:00') : f.outAt ? istInstant(date, f.outAt) : null, lateMinutes: f.late || 0, earlyOutMinutes: f.early || 0, workedMinutes: 480, createdByUserId: 'test' },
    update: { lateMinutes: f.late || 0, earlyOutMinutes: f.early || 0, status: f.status || 'PRESENT' },
  }));

/** The saved rule versions as if made long ago, so they govern last month. */
const backdateRules = (c: Ctx) => runInTenant(c.orgId, () => peoplePrisma.attendanceRuleVersion.updateMany({ where: { orgId: c.orgId }, data: { createdAt: new Date('2020-01-01T00:00:00Z') } }));

async function portalOf(c: Ctx, employee: { id: string; code: string }) {
  const code = (await att(c, 'get', '/portal-access').expect(200)).body.company.code;
  const issued = (await att(c, 'post', '/portal-access/codes', { employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company: code, employeeCode: employee.code, activationCode: issued, password: 'mine pass 1' }).expect(200)).body.token;
  return {
    get: (p: string) => request(app).get(`/api/portal${p}`).set('Authorization', `Bearer ${token}`),
    post: (p: string, b: unknown = {}) => request(app).post(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
  };
}

describe('the rules themselves', () => {
  it('a night window is touched by any minute inside it', () => {
    const w = { from: '19:00', to: '06:00' };
    expect(touchesNight({ startTime: '22:00', endTime: '06:00' }, w)).toBe(true);
    expect(touchesNight({ startTime: '14:00', endTime: '22:00' }, w)).toBe(true);
    expect(touchesNight({ startTime: '05:00', endTime: '13:00' }, w)).toBe(true);
    expect(touchesNight({ startTime: '06:00', endTime: '14:00' }, w)).toBe(false);
    expect(touchesNight({ startTime: '09:00', endTime: '19:00' }, w)).toBe(false);
    expect(touchesNight({ startTime: '09:00', endTime: '18:00' }, { from: '17:00', to: '07:00' })).toBe(true);
  });

  it('every N marks after the free ones cost the step; the old two-number rule reads the same', () => {
    const r = rulesOf({ timeRules: { marks: { on: true, late: { every: 3, free: 1 }, early: { on: true, every: 2 }, cost: 1 } } });
    expect(costOf(r.marks, 3, 0)).toBe(0);
    expect(costOf(r.marks, 4, 0)).toBe(1);
    expect(costOf(r.marks, 7, 3)).toBe(3);
    const old = legacyMarks({ lateAllowancePerMonth: 2, latePenaltyEvery: 3 });
    expect(old).toMatchObject({ on: true, cost: 0.5, late: { every: 3, free: 2 } });
    expect(costOf(old, 5, 0)).toBe(0.5);
    expect(rulesOf({ latePenaltyEvery: 0 }).marks.on).toBe(false);
    expect(policyText(r.marks, ['Casual leave'])).toMatch(/The first 1 late arrivals.*every 3 cost 1 day.*Every 2 early exits.*taken from Casual leave/);
  });

  it('the jobs are registered, so the wake call runs them', () => {
    const a = startPunchNudges({ startupDelayMs: 3_600_000 });
    const b = startAbsenceChecks({ startupDelayMs: 3_600_000 });
    expect(registeredJobs()).toEqual(expect.arrayContaining(['startPunchNudges', 'startAbsenceChecks']));
    a();
    b();
  });
});

describe('settings, versions and who may change them', () => {
  let c: Ctx;
  let other: Ctx;
  let mgr: Ctx;
  beforeAll(async () => {
    c = await company();
    other = await company();
    mgr = await withRole(c, 'Team Manager', 'Mina Lead');
  }, 120_000);

  it('starts with nothing that costs pay switched on', async () => {
    const r = (await ppl(c, 'get', '/attendance-rules').expect(200)).body;
    expect(r.rules.marks.on).toBe(false);
    expect(r.rules.nudge).toMatchObject({ on: true, afterHours: 2 });
    expect(r.rules.absence).toMatchObject({ on: true, days: 5, noticeGapDays: 7 });
    expect(r.rules.night).toMatchObject({ on: true, from: '19:00', to: '06:00' });
  });

  it('HR saves a change as a new version; a team role and another company may not', async () => {
    const v0 = (await ppl(c, 'get', '/attendance-rules').expect(200)).body.version;
    const saved = (await ppl(c, 'put', '/attendance-rules', { marksFrom: 'THIS_MONTH', marks: { on: true, cutMode: 'HALF_DAY_PER_N', late: { every: 3, graceMinutes: 15 } }, night: { from: '20:00' } }).expect(200)).body;
    expect(saved.rules.marks).toMatchObject({ on: true, late: { every: 3, graceMinutes: 15 } });
    expect(saved.rules.night.from).toBe('20:00');
    expect(saved.version).toBeGreaterThan(v0);
    /* The Attendance app's two numbers follow the late rule. */
    expect((await att(c, 'get', '/rules').expect(200)).body.rules).toMatchObject({ latePenaltyEvery: 3 });
    expect((await ppl(c, 'put', '/attendance-rules', { absence: { days: 1 } }).expect(400)).body.error).toMatch(/At least 2/);
    expect((await ppl(c, 'put', '/attendance-rules', { marksFrom: 'THIS_MONTH', marks: { takeFrom: ['nope'] } }).expect(400)).body.error).toMatch(/paid leave types/);
    expect((await ppl(mgr, 'put', '/attendance-rules', { marksFrom: 'THIS_MONTH', marks: { on: false } })).status).toBe(403);
    expect((await call(other, 'put', `/people/attendance-rules`, {}).set('x-org-id', c.orgId)).status).toBeGreaterThanOrEqual(400);
    expect((await request(app).get(`/api/orgs/${c.orgId}/people/attendance-rules`).set(at(other)).set('x-org-id', other.orgId)).status).toBe(403);
  });
});

describe('late marks: preview, waive, apply, payable days', () => {
  let c: Ctx;
  let other: Ctx;
  let mgr: Ctx;
  let mgrEmp: any, asha: any, ravi: any, outsider: any;
  let casual: any;
  const year = Number(lastMonth.slice(0, 4));

  beforeAll(async () => {
    c = await company();
    other = await company();
    mgr = await withRole(c, 'Team Manager', 'Mehul Lead');
    mgrEmp = await person(c, { name: 'Mehul Lead', code: 'LM0', workEmail: mgr.email });
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: mgrEmp.id }, data: { userId: mgr.userId } }));
    asha = await person(c, { name: 'Asha Rao', code: 'LM1', reportingManagerId: mgrEmp.id });
    ravi = await person(c, { name: 'Ravi Kumar', code: 'LM2', reportingManagerId: mgrEmp.id });
    outsider = await person(c, { name: 'Otto Side', code: 'LM3' });
    casual = (await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 0 }).expect(201)).body.type;
    await att(c, 'post', '/leave/adjustments', { employeeId: asha.id, leaveTypeId: casual.id, year, days: 2, reason: 'Opening balance' }).expect(201);
    /* Asha: 3 late marks beyond 10 minutes (and one of 5 minutes that does not count); Ravi: 4 late, no leave left; Otto: 3 late. */
    await day(c, asha.id, workdays[0], { late: 20 });
    await day(c, asha.id, workdays[1], { late: 15 });
    await day(c, asha.id, workdays[2], { late: 30 });
    await day(c, asha.id, workdays[3], { late: 5 });
    for (const d of workdays.slice(0, 4)) await day(c, ravi.id, d, { late: 25 });
    for (const d of workdays.slice(0, 3)) await day(c, outsider.id, d, { late: 25 });
    await ppl(c, 'put', '/attendance-rules', { marksFrom: 'THIS_MONTH', marks: { on: true, cutMode: 'HALF_DAY_PER_N', late: { on: true, every: 3, free: 0, graceMinutes: 10 }, cost: 0.5, takeFrom: [casual.id] } }).expect(200);
    /* The rule was in force all of last month (a month is worked out under the rule of its last day). */
    await backdateRules(c);
  }, 180_000);

  it('works the month out: leave first, else loss of pay, and payable days take only the unpaid part', async () => {
    const m = (await ppl(c, 'get', `/late-marks?month=${lastMonth}`).expect(200)).body;
    const a = m.rows.find((r: any) => r.employeeId === asha.id);
    const r = m.rows.find((x: any) => x.employeeId === ravi.id);
    expect(a).toMatchObject({ lateMarks: 3, days: 0.5, status: 'DUE', lossOfPayDays: 0 });
    expect(a.fromLeave).toEqual([expect.objectContaining({ leaveTypeId: casual.id, days: 0.5 })]);
    expect(r).toMatchObject({ lateMarks: 4, days: 0.5, lossOfPayDays: 0.5, fromLeave: [] });
    const pay = (await att(c, 'get', `/payable-days?month=${lastMonth}`).expect(200)).body.rows;
    expect(pay.find((x: any) => x.employeeId === ravi.id).why).toMatch(/0\.5 late penalty/);
    expect(pay.find((x: any) => x.employeeId === asha.id).why).not.toMatch(/late penalty/);
  });

  it('previews a draft rule against the month without saving it', async () => {
    const p = (await ppl(c, 'post', '/late-marks/preview', { month: lastMonth, marks: { late: { every: 2 } } }).expect(200)).body;
    expect(p.rows.find((x: any) => x.employeeId === ravi.id)).toMatchObject({ now: 0.5, then: 1 });
    expect((await ppl(c, 'get', '/attendance-rules').expect(200)).body.rules.marks.late.every).toBe(3);
  });

  it('a manager sees and waives for the team only, never their own, always with a reason', async () => {
    const mine = (await ppl(mgr, 'get', `/late-marks?month=${lastMonth}`).expect(200)).body;
    expect(mine.rows.map((r: any) => r.employeeId)).not.toContain(outsider.id);
    expect(mine.canApply).toBe(false);
    expect((await ppl(mgr, 'post', `/late-marks/${outsider.id}/waive`, { month: lastMonth, reason: 'Bus strike' })).status).toBe(404);
    expect((await ppl(mgr, 'post', `/late-marks/${mgrEmp.id}/waive`, { month: lastMonth, reason: 'Me' })).status).toBe(403);
    expect((await ppl(mgr, 'post', `/late-marks/${ravi.id}/waive`, { month: lastMonth, reason: '' }).expect(400)).body.error).toMatch(/Say why/);
    const [x, y] = await Promise.all([
      ppl(mgr, 'post', `/late-marks/${ravi.id}/waive`, { month: lastMonth, reason: 'Bus strike all week' }),
      ppl(c, 'post', `/late-marks/${ravi.id}/waive`, { month: lastMonth, reason: 'Bus strike' }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const after = (await ppl(c, 'get', `/late-marks?month=${lastMonth}`).expect(200)).body.rows.find((r: any) => r.employeeId === ravi.id);
    expect(after).toMatchObject({ status: 'WAIVED', lossOfPayDays: 0 });
    expect((await att(c, 'get', `/payable-days?month=${lastMonth}`).expect(200)).body.rows.find((r: any) => r.employeeId === ravi.id).why).not.toMatch(/late penalty/);
    expect((await ppl(mgr, 'post', '/late-marks/apply', { month: lastMonth })).status).toBe(403);
  });

  it('HR applies the month once, however many clicks: leave taken, the version kept; undo gives it back', async () => {
    const [one, two] = await Promise.all([ppl(c, 'post', '/late-marks/apply', { month: lastMonth }), ppl(c, 'post', '/late-marks/apply', { month: lastMonth })]);
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    expect(one.body.applied + two.body.applied).toBe(2); /* Asha and Otto; Ravi is waived */
    const rows = await runInTenant(c.orgId, () => peoplePrisma.attendancePenalty.findMany({ where: { orgId: c.orgId, month: lastMonth } }));
    expect(rows.filter((r) => r.employeeId === asha.id)).toHaveLength(1);
    expect(rows.find((r) => r.employeeId === asha.id)!.ruleVersion).toBeGreaterThan(0);
    const adj = await runInTenant(c.orgId, () => peoplePrisma.leaveAdjustment.findMany({ where: { orgId: c.orgId, employeeId: asha.id, reason: { startsWith: 'Late marks' }, reversedAt: null } }));
    expect(adj).toHaveLength(1);
    expect(adj[0].days).toBe(-0.5);
    /* A rule changed afterwards does not change an applied month. */
    await ppl(c, 'put', '/attendance-rules', { marksFrom: 'THIS_MONTH', marks: { late: { every: 1 } } }).expect(200);
    expect((await ppl(c, 'get', `/late-marks?month=${lastMonth}`).expect(200)).body.rows.find((r: any) => r.employeeId === asha.id)).toMatchObject({ status: 'APPLIED', days: 0.5 });
    await ppl(c, 'put', '/attendance-rules', { marksFrom: 'THIS_MONTH', marks: { late: { every: 3 } } }).expect(200);
    expect((await ppl(c, 'post', `/late-marks/${asha.id}/waive`, { month: lastMonth, reason: 'Late bus' }).expect(409)).body.code).toBe('APPLIED');
    expect((await ppl(mgr, 'post', `/late-marks/${asha.id}/undo`, { month: lastMonth })).status).toBe(403);
    await ppl(c, 'post', `/late-marks/${asha.id}/undo`, { month: lastMonth }).expect(200);
    expect(await runInTenant(c.orgId, () => peoplePrisma.leaveAdjustment.count({ where: { orgId: c.orgId, employeeId: asha.id, reason: { startsWith: 'Late marks' }, reversedAt: null } }))).toBe(0);
  });

  it('another company sees none of it', async () => {
    expect((await request(app).get(`/api/orgs/${c.orgId}/people/late-marks?month=${lastMonth}`).set(at(other)).set('x-org-id', other.orgId)).status).toBe(403);
    const theirs = (await ppl(other, 'get', `/late-marks?month=${lastMonth}`).expect(200)).body;
    expect(theirs.rows).toEqual([]);
  });

  it('the employee app shows the running count and the rule', async () => {
    const thisMonth = istToday().slice(0, 7);
    const A = await portalOf(c, asha);
    const mineNow = (await A.get(`/people/time/marks?month=${lastMonth}`).expect(200)).body;
    expect(mineNow).toMatchObject({ on: true, days: 0.5 });
    expect(mineNow.policy).toMatch(/Every 3 late arrivals by more than 10 minutes in a month cost ½ day, taken from Casual/);
    /* Two marks this month: the next one costs. */
    const days: string[] = [];
    for (let d = `${thisMonth}-01`; d < istToday() && days.length < 2; d = plus(d, 1)) if (dow(d) !== 0) days.push(d);
    for (const d of days) await day(c, asha.id, d, { late: 40 });
    const mine = (await A.get(`/people/time/marks?month=${thisMonth}`).expect(200)).body;
    if (days.length === 2) expect(mine.late.line).toBe('2 of 3 late marks; the next one costs ½ day.');
  });
});

describe('the monthly limit on missed punches', () => {
  it('refuses the person past the limit in plain words; HR can still enter one for them', async () => {
    const c = await company();
    const e = await person(c, { name: 'Neha Iyer', code: 'Q1' });
    const P = await portalOf(c, e);
    const recent: string[] = [];
    for (let d = plus(istToday(), -1); recent.length < 4; d = plus(d, -1)) if (dow(d) !== 0) recent.push(d);
    for (const d of recent.slice(0, 3)) await P.post('/requests', { kind: 'MISSED_PUNCH', date: d, checkIn: '09:00', checkOut: '18:00', reason: 'Forgot to punch' }).expect(201);
    const refused = await P.post('/requests', { kind: 'MISSED_PUNCH', date: recent[3], checkIn: '09:00', checkOut: '18:00', reason: 'Forgot again' }).expect(409);
    expect(refused.body).toMatchObject({ code: 'QUOTA' });
    expect(refused.body.error).toMatch(/You have used your 3 missed-punch requests/);
    await att(c, 'post', '/requests', { employeeId: e.id, kind: 'MISSED_PUNCH', date: recent[3], checkIn: '09:00', checkOut: '18:00', reason: 'Reader was down' }).expect(201);
  });
});

describe('the missing-punch nudge', () => {
  let c: Ctx;
  let mgr: Ctx;
  let lead: any, outMissing: any, noPunch: any, onLeave: any, neverPunches: any;
  /* The days the nudge looks back over (three), newest first, Sundays aside: everyone has them all but the gaps made below. */
  const recent: string[] = [];
  for (let d = plus(istToday(), -1); d >= plus(istToday(), -3); d = plus(d, -1)) if (dow(d) !== 0) recent.push(d);
  const [d1] = recent;
  const morning = () => istInstant(istToday(), '09:30');

  beforeAll(async () => {
    c = await company();
    mgr = await withRole(c, 'Team Manager', 'Nisha Lead');
    lead = await person(c, { name: 'Nisha Lead', code: 'N0', workEmail: mgr.email });
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: mgr.userId } }));
    outMissing = await person(c, { name: 'Out Missing', code: 'N1', reportingManagerId: lead.id });
    noPunch = await person(c, { name: 'No Punch', code: 'N2', reportingManagerId: lead.id });
    onLeave = await person(c, { name: 'On Leave', code: 'N3', reportingManagerId: lead.id });
    neverPunches = await person(c, { name: 'Never Punches', code: 'N4', reportingManagerId: lead.id });
    /* Everyone but the last punched in the last month; that is who is nudged. */
    for (const p of [outMissing, noPunch, onLeave]) await day(c, p.id, plus(istToday(), -10), {});
    for (const d of recent) await day(c, lead.id, d, {});
    await day(c, outMissing.id, d1, { outAt: null });
    await day(c, onLeave.id, d1, { inAt: null, outAt: null, status: 'ON_LEAVE' });
    for (const d of recent.slice(1)) for (const p of [outMissing, noPunch, onLeave]) await day(c, p.id, d, {});
    await ppl(c, 'put', '/attendance-rules', { nudge: { on: true, afterHours: 2 } }).expect(200);
  }, 180_000);

  it('tells each person once a day, two runs at once included, and the manager once in the morning', async () => {
    const runs = await Promise.all([runInTenant(c.orgId, () => nudgeCompany(c.accountId!, c.orgId, morning())), runInTenant(c.orgId, () => nudgeCompany(c.accountId!, c.orgId, morning()))]);
    expect(runs[0].people + runs[1].people).toBe(2);
    expect(runs[0].managers + runs[1].managers).toBe(1);
    const again = await runInTenant(c.orgId, () => nudgeCompany(c.accountId!, c.orgId, morning()));
    expect(again).toEqual({ people: 0, managers: 0 });
    const rows = await runInTenant(c.orgId, () => peoplePrisma.attendanceNudge.findMany({ where: { orgId: c.orgId, sentOn: istToday() } }));
    const fixFor = (id: string) => rows.filter((r) => r.kind === 'FIX' && r.employeeId === id);
    expect(fixFor(outMissing.id)).toHaveLength(1);
    expect((fixFor(outMissing.id)[0].days as any[])[0]).toMatchObject({ date: d1, what: 'NO_OUT', checkIn: '09:00', suggestedOut: '18:00' });
    expect((fixFor(noPunch.id)[0].days as any[])[0]).toMatchObject({ date: d1, what: 'NO_PUNCH' });
    expect(fixFor(onLeave.id)).toHaveLength(0);
    expect(fixFor(neverPunches.id)).toHaveLength(0);
    expect(rows.filter((r) => r.kind === 'TEAM' && r.employeeId === lead.id)).toHaveLength(1);
    const bell = await runInTenant(c.orgId, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, userId: mgr.userId!, kind: 'attendance.punch_team' } }));
    expect(bell).toHaveLength(1);
    expect(bell[0].title).toMatch(/2 days of your team still to fix/);
  });

  it('the app shows the fix filled in until it is asked for, and the nudge is off when the company says so', async () => {
    const P = await portalOf(c, outMissing);
    const f = (await P.get('/people/time/fixes').expect(200)).body;
    expect(f.fixes).toEqual([expect.objectContaining({ date: d1, what: 'NO_OUT', checkIn: '09:00', suggestedOut: '18:00', text: expect.stringMatching(/^No punch-out on/) })]);
    await P.post('/requests', { kind: 'MISSED_PUNCH', date: d1, checkIn: '09:00', checkOut: '18:00', reason: 'Forgot to punch out', reasonCode: 'FORGOT_PUNCH' }).expect(201);
    expect((await P.get('/people/time/fixes').expect(200)).body.fixes).toEqual([]);
    const L = await portalOf(c, lead);
    expect((await L.get('/people/time/fixes').expect(200)).body.team).toMatchObject({ count: 2 });
    const quiet = await company();
    const q = await person(quiet, { name: 'Quiet One', code: 'QQ' });
    await day(quiet, q.id, plus(istToday(), -10), {});
    await ppl(quiet, 'put', '/attendance-rules', { nudge: { on: false } }).expect(200);
    expect(await runInTenant(quiet.orgId, () => nudgeCompany(quiet.accountId!, quiet.orgId, morning()))).toEqual({ people: 0, managers: 0 });
  });
});

describe('unexplained absence: notices, the leaving and the hold', () => {
  let c: Ctx;
  let mgr: Ctx;
  let other: Ctx;
  let gone: any, back: any;
  let caseId: string;

  beforeAll(async () => {
    c = await company();
    other = await company();
    mgr = await withRole(c, 'Team Manager', 'Arun Lead');
    gone = await person(c, { name: 'Gone Away', code: 'AB1', personalEmail: 'gone.away@example.com' });
    back = await person(c, { name: 'Came Back', code: 'AB2' });
    /* Present three weeks ago, nothing since: well past five working days. */
    for (const p of [gone, back]) await day(c, p.id, plus(istToday(), -21), {});
  }, 120_000);

  it('the morning check opens one case per person, two runs at once included', async () => {
    const [x, y] = await Promise.all([runInTenant(c.orgId, () => checkCompany(c.accountId!, c.orgId)), runInTenant(c.orgId, () => checkCompany(c.accountId!, c.orgId))]);
    expect(x.opened + y.opened).toBe(2);
    expect((await runInTenant(c.orgId, () => checkCompany(c.accountId!, c.orgId))).opened).toBe(0);
    const list = (await ppl(c, 'get', '/absences').expect(200)).body;
    expect(list.rows).toHaveLength(2);
    const row = list.rows.find((r: any) => r.employeeId === gone.id);
    expect(row.days).toBeGreaterThanOrEqual(5);
    expect(row.next).toMatchObject({ step: 'NOTICE_1' });
    caseId = row.id;
    const told = await runInTenant(c.orgId, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, kind: 'people.absence' } }));
    expect(told.length).toBeGreaterThan(0);
  });

  it('notice 1 goes once, recorded with its channels and copy; notice 2 waits the gap', async () => {
    expect((await ppl(c, 'post', `/absences/${caseId}/notice`, {}).expect(400)).body.error).toMatch(/Who signs/);
    expect((await ppl(mgr, 'post', `/absences/${caseId}/notice`, { signatory: 'Arun' })).status).toBe(403);
    const [a, b] = await Promise.all([ppl(c, 'post', `/absences/${caseId}/notice`, { signatory: 'Meera Shah, HR' }), ppl(c, 'post', `/absences/${caseId}/notice`, { signatory: 'Meera Shah, HR' })]);
    const ok = [a, b].find((r) => r.status === 201)!;
    expect([a.status, b.status]).toContain(201);
    expect(ok.body.notice).toMatchObject({ seq: 1, emailTo: 'gone.away@example.com' });
    expect(ok.body.notice.channels).toEqual(expect.arrayContaining(['APP', 'EMAIL']));
    expect(ok.body.notice.text).toMatch(/report back to work, or write to us explaining your absence, by/);
    expect(ok.body.notice.documentId).toBeTruthy();
    const second = [a, b].find((r) => r !== ok)!;
    expect(second.status).toBe(409);
    expect((await ppl(c, 'post', `/absences/${caseId}/notice`, { signatory: 'Meera Shah, HR' }).expect(409)).body.code).toBe('TOO_SOON');
    expect((await ppl(c, 'post', `/absences/${caseId}/absconded`, {}).expect(409)).body.code).toBe('NOTICES_FIRST');
    /* The person sees it in the app. */
    const G = await portalOf(c, gone);
    expect((await G.get('/people/time/fixes').expect(200)).body.notices).toEqual([expect.objectContaining({ seq: 1 })]);
    await runInTenant(c.orgId, () => peoplePrisma.absenceNotice.updateMany({ where: { caseId, seq: 1 }, data: { sentAt: new Date(Date.now() - 8 * 86_400_000) } }));
    const n2 = (await ppl(c, 'post', `/absences/${caseId}/notice`, { signatory: 'Meera Shah, HR', postRef: 'RL123456789IN' }).expect(201)).body.notice;
    expect(n2).toMatchObject({ seq: 2, postRef: 'RL123456789IN' });
    expect(n2.channels).toContain('POST');
    expect(n2.text).toMatch(/We wrote to you on/);
  });

  it('records ABSCONDED only after the second date, holds and releases the settlement', async () => {
    expect((await ppl(c, 'post', `/absences/${caseId}/absconded`, {}).expect(409)).body.code).toBe('WAIT');
    await runInTenant(c.orgId, () => peoplePrisma.absenceNotice.updateMany({ where: { caseId, seq: 2 }, data: { reportBy: plus(istToday(), -1) } }));
    expect((await ppl(c, 'post', `/absences/${caseId}/absconded`, { hold: true, holdReason: '' }).expect(400)).body.error).toMatch(/why the settlement/);
    const done = (await ppl(c, 'post', `/absences/${caseId}/absconded`, { hold: true, holdReason: 'Laptop not returned' }).expect(200)).body.case;
    expect(done).toMatchObject({ status: 'ABSCONDED', holdReason: 'Laptop not returned' });
    const emp = await runInTenant(c.orgId, () => peoplePrisma.employee.findFirst({ where: { id: gone.id } }));
    expect(emp).toMatchObject({ status: 'LEFT', leavingType: 'ABSCONDED' });
    expect((await ppl(c, 'get', '/absences/holds').expect(200)).body.holds).toEqual([expect.objectContaining({ employeeId: gone.id, reason: 'Laptop not returned' })]);
    const ev = await runInTenant(c.orgId, () => peoplePrisma.outboxEvent.findMany({ where: { orgId: c.orgId, name: 'people.settlement.hold.v1', employeeId: gone.id } }));
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ held: true, reason: 'Laptop not returned' });
    expect((await ppl(c, 'post', `/absences/${caseId}/hold`, { reason: 'again' }).expect(409)).body.code).toBe('HELD');
    await ppl(c, 'post', `/absences/${caseId}/release`, { note: 'Laptop returned 4 Nov' }).expect(200);
    expect((await ppl(c, 'get', '/absences/holds').expect(200)).body.holds).toEqual([]);
    expect((await ppl(c, 'post', `/absences/${caseId}/close`, { outcome: 'RETURNED', note: 'Came in' }).expect(409)).body.code).toBe('ABSCONDED');
  });

  it('a person who came back is closed with a note, nothing recorded; another company sees nothing', async () => {
    const row = (await ppl(c, 'get', '/absences').expect(200)).body.rows.find((r: any) => r.employeeId === back.id);
    expect((await ppl(c, 'post', `/absences/${row.id}/close`, { outcome: 'RETURNED', note: '' }).expect(400)).body.error).toMatch(/Add a note/);
    await ppl(c, 'post', `/absences/${row.id}/close`, { outcome: 'RETURNED', note: 'Back on Monday, was in hospital' }).expect(200);
    expect(await runInTenant(c.orgId, () => peoplePrisma.employee.findFirst({ where: { id: back.id }, select: { status: true } }))).toMatchObject({ status: 'ACTIVE' });
    expect((await ppl(other, 'post', `/absences/${row.id}/close`, { outcome: 'IGNORED', note: 'not mine' })).status).toBe(404);
    expect((await ppl(other, 'get', '/absences').expect(200)).body.rows).toEqual([]);
  });
});

describe("women's consent to night work", () => {
  let c: Ctx;
  let other: Ctx;
  let mgr: Ctx;
  let priya: any, sunil: any, asha: any;
  let night: any, evening: any, morningShift: any;
  const future = plus(istToday(), 20);

  beforeAll(async () => {
    c = await company();
    other = await company();
    mgr = await withRole(c, 'Team Manager', 'Kiran Lead');
    priya = await person(c, { name: 'Priya Nair', code: 'W1', gender: 'FEMALE' });
    asha = await person(c, { name: 'Asha Menon', code: 'W2', gender: 'FEMALE' });
    sunil = await person(c, { name: 'Sunil Das', code: 'M1', gender: 'MALE' });
    night = (await att(c, 'post', '/shifts', { name: `Night ${rnd()}`, startTime: '22:00', endTime: '06:00' }).expect(201)).body.shift;
    evening = (await att(c, 'post', '/shifts', { name: `Evening ${rnd()}`, startTime: '14:00', endTime: '22:00' }).expect(201)).body.shift;
    morningShift = (await att(c, 'post', '/shifts', { name: `Morning ${rnd()}`, startTime: '06:00', endTime: '14:00' }).expect(201)).body.shift;
  }, 120_000);

  it('refuses a night or evening shift for a woman with no consent, wherever it is given; a man or a day shift is fine', async () => {
    const refused = await att(c, 'post', '/shift-assignments', { employeeIds: [priya.id], shiftId: night.id, effectiveFrom: future }).expect(409);
    expect(refused.body.code).toBe('NIGHT_CONSENT');
    expect(refused.body.error).toMatch(/Priya Nair has no consent to night work on file.*7 pm to 6 am/);
    expect((await att(c, 'post', '/temporary-schedules', { employeeIds: [priya.id], shiftId: evening.id, fromDate: future, toDate: future }).expect(409)).body.code).toBe('NIGHT_CONSENT');
    const rot = (await att(c, 'post', '/rotations', { name: `Rot ${rnd()}`, sequence: [morningShift.id, night.id], periodDays: 7, anchorDate: future }).expect(201)).body.rotation;
    expect((await att(c, 'post', `/rotations/${rot.id}/assignments`, { employeeIds: [asha.id], startsOn: future }).expect(409)).body.code).toBe('NIGHT_CONSENT');
    await att(c, 'post', '/shift-assignments', { employeeIds: [sunil.id], shiftId: evening.id, effectiveFrom: future }).expect(200);
    await att(c, 'post', '/shift-assignments', { employeeIds: [priya.id], shiftId: morningShift.id, effectiveFrom: future }).expect(200);
    const report = (await ppl(c, 'get', '/night-work').expect(200)).body;
    expect(report.rows.map((r: any) => r.employeeId).sort()).toEqual([asha.id, priya.id].sort());
    expect(report.night.words).toBe('7 pm to 6 am');
  });

  it('HR records consent with the signed copy; then the shift may be given', async () => {
    expect((await ppl(mgr, 'post', `/night-work/${priya.id}`, { status: 'GIVEN' })).status).toBe(403);
    expect((await ppl(c, 'post', `/night-work/${priya.id}`, { status: 'MAYBE' }).expect(400)).body.error).toMatch(/given or withdrawn/);
    const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n% consent\n').toString('base64')}`;
    const made = (await ppl(c, 'post', `/night-work/${priya.id}`, { status: 'GIVEN', onDate: istToday(), note: 'Signed form', file: { name: 'consent.pdf', mime: 'application/pdf', data: pdf } }).expect(201)).body.consent;
    expect(made.documentId).toBeTruthy();
    await att(c, 'post', '/temporary-schedules', { employeeIds: [priya.id], shiftId: night.id, fromDate: future, toDate: plus(future, 1) }).expect(201);
    expect((await ppl(c, 'get', '/night-work').expect(200)).body.rows.find((r: any) => r.employeeId === priya.id).consent).toMatchObject({ status: 'GIVEN' });
    expect((await ppl(other, 'post', `/night-work/${priya.id}`, { status: 'GIVEN' })).status).toBe(404);
  });

  it('she withdraws it in the app: HR hears of the night shifts ahead, and new ones are refused, swaps and shift changes too', async () => {
    const P = await portalOf(c, priya);
    const mine = (await P.get('/people/time/night-consent').expect(200)).body;
    expect(mine).toMatchObject({ asked: true, consent: { status: 'GIVEN' }, window: '7 pm to 6 am' });
    const S = await portalOf(c, sunil);
    expect((await S.get('/people/time/night-consent').expect(200)).body).toEqual({ asked: false });
    expect((await S.post('/people/time/night-consent', { status: 'GIVEN' })).status).toBe(400);
    await P.post('/people/time/night-consent', { status: 'WITHDRAWN' }).expect(201);
    const hr = await runInTenant(c.orgId, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, kind: 'people.night_consent' } }));
    expect(hr.length).toBeGreaterThan(0);
    expect((await att(c, 'post', '/temporary-schedules', { employeeIds: [priya.id], shiftId: night.id, fromDate: plus(future, 3), toDate: plus(future, 3) }).expect(409)).body.error).toMatch(/withdrew her consent/);
    await att(c, 'put', '/request-rules', { SHIFT_CHANGE: { on: true } }).expect(200);
    const ask = await P.post('/requests', { kind: 'SHIFT_CHANGE', date: plus(future, 5), shiftId: evening.id, reason: 'Exam in the morning' }).expect(409);
    expect(ask.body).toMatchObject({ code: 'NIGHT_CONSENT' });
    expect(ask.body.error).toMatch(/you have no consent to night work on file/);
    /* A swap that would give her Sunil's evening, on a Saturday (Sunday off for both, so the rest rule holds). */
    let sat = plus(future, 7);
    while (dow(sat) !== 6) sat = plus(sat, 1);
    const swap = await P.post('/people/swaps', { colleagueEmployeeId: sunil.id, fromDate: sat });
    expect(swap.status).toBe(409);
    expect(swap.body.code).toBe('NIGHT_CONSENT');
    const report = (await ppl(c, 'get', '/night-work').expect(200)).body;
    expect(report.rows[0]).toMatchObject({ employeeId: priya.id, problem: true });
    expect(report.totals.problems).toBe(1);
  });
});

/* ------------------------------------------------------------------ review of PR #78 */

describe('late marks: pay periods, half days, the rule of the month, leave and payroll (review of #78)', () => {
  let c: Ctx;
  let mgr: Ctx;
  let lead: any, kavya: any, arjun: any;
  let casual: any;
  const year = Number(lastMonth.slice(0, 4));
  const thisMonth = istToday().slice(0, 7);

  beforeAll(async () => {
    c = await company();
    mgr = await withRole(c, 'Team Manager', 'Lata Lead');
    lead = await person(c, { name: 'Lata Lead', code: 'PR0', workEmail: mgr.email });
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: mgr.userId } }));
    kavya = await person(c, { name: 'Kavya Shetty', code: 'PR1', reportingManagerId: lead.id });
    arjun = await person(c, { name: 'Arjun Pai', code: 'PR2', reportingManagerId: lead.id });
    casual = (await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 0 }).expect(201)).body.type;
    await att(c, 'post', '/leave/adjustments', { employeeId: kavya.id, leaveTypeId: casual.id, year, days: 1, reason: 'Opening balance' }).expect(201);
    for (const d of workdays.slice(0, 3)) await day(c, kavya.id, d, { late: 20 });
    for (const d of workdays.slice(0, 3)) await day(c, arjun.id, d, { late: 20 });
    /* Arjun's fourth late day was a half day, and his fifth has no punch-out: neither is a mark. */
    await day(c, arjun.id, workdays[3], { late: 20, status: 'HALF_DAY' });
    await day(c, arjun.id, workdays[4], { late: 20, outAt: null });
    await ppl(c, 'put', '/attendance-rules', { marksFrom: 'THIS_MONTH', marks: { on: true, cutMode: 'HALF_DAY_PER_N', late: { on: true, every: 3, free: 0 }, cost: 0.5, takeFrom: [casual.id] } }).expect(200);
    await backdateRules(c);
  }, 180_000);

  it('counts whole present days only', async () => {
    const m = (await ppl(c, 'get', `/late-marks?month=${lastMonth}`).expect(200)).body;
    expect(m.rows.find((r: any) => r.employeeId === arjun.id)).toMatchObject({ lateMarks: 3, days: 0.5 });
  });

  it('works a month out under the rule in force on its last day', async () => {
    /* A stricter rule saved today does not reach last month. */
    await ppl(c, 'put', '/attendance-rules', { marksFrom: 'THIS_MONTH', marks: { late: { every: 1 } } }).expect(200);
    expect((await ppl(c, 'get', `/late-marks?month=${lastMonth}`).expect(200)).body.rows.find((r: any) => r.employeeId === kavya.id).days).toBe(0.5);
    await ppl(c, 'put', '/attendance-rules', { marksFrom: 'THIS_MONTH', marks: { late: { every: 3 } } }).expect(200);
  });

  it('blocks the readiness checklist, and a 26th-to-25th pay period charges the month once, with its waiver or apply', async () => {
    const { monthReadiness } = await import('../services/attendance/readiness.js');
    const ready = await runInTenant(c.orgId, () => monthReadiness(c.accountId!, c.orgId, lastMonth));
    expect(ready.checks.find((x: any) => x.key === 'penalties')).toMatchObject({ severity: 'block', count: 2 });
    const { undecidedIn } = await import('../services/attendance/markRules.js');
    const { periodRows, daysBetween } = await import('../services/attendance/days.js');
    const period = daysBetween(`${lastMonth}-26`, `${thisMonth}-25`);
    expect((await runInTenant(c.orgId, () => undecidedIn(c.accountId!, c.orgId, period))).map((u) => u.employeeId).sort()).toEqual([arjun.id, kavya.id].sort());
    await ppl(c, 'post', `/late-marks/${arjun.id}/waive`, { month: lastMonth, reason: 'Road works all week' }).expect(201);
    await ppl(c, 'post', '/late-marks/apply', { month: lastMonth }).expect(200);
    const rows = await runInTenant(c.orgId, () => periodRows(c.accountId!, c.orgId, period));
    const k = rows.find((r: any) => r.employeeId === kavya.id) as any;
    const a = rows.find((r: any) => r.employeeId === arjun.id) as any;
    expect(a.penalty).toMatchObject({ status: 'WAIVED' });
    expect(a.latePenaltyDays).toBe(0);
    expect(k.penalty).toMatchObject({ status: 'APPLIED', fromLeaveDays: 0.5 });
    expect(k.latePenaltyDays).toBe(0);
    /* The next period does not charge last month again. */
    const next = await runInTenant(c.orgId, () => periodRows(c.accountId!, c.orgId, daysBetween(`${thisMonth}-26`, plus(`${thisMonth}-25`, 31))));
    expect((next.find((r: any) => r.employeeId === kavya.id) as any).penalty).toBeNull();
    expect(await runInTenant(c.orgId, () => undecidedIn(c.accountId!, c.orgId, period))).toEqual([]);
  });

  it('a waiver is taken back by whoever gave it or HR, an apply only by HR', async () => {
    await ppl(c, 'post', `/late-marks/${kavya.id}/undo`, { month: lastMonth }).expect(200);
    await ppl(c, 'post', `/late-marks/${kavya.id}/waive`, { month: lastMonth, reason: 'HR agreed' }).expect(201);
    expect((await ppl(mgr, 'post', `/late-marks/${kavya.id}/undo`, { month: lastMonth })).status).toBe(403);
    await ppl(c, 'post', `/late-marks/${kavya.id}/undo`, { month: lastMonth }).expect(200);
  });

  it('takes nothing from a leave year already closed, and never more than is left', async () => {
    await runInTenant(c.orgId, () => peoplePrisma.leaveYearEnd.create({ data: { accountId: c.accountId!, orgId: c.orgId, year, summaryJson: '{}', ranByUserId: 'test' } }));
    const r = (await ppl(c, 'get', `/late-marks?month=${lastMonth}`).expect(200)).body.rows.find((x: any) => x.employeeId === kavya.id);
    expect(r).toMatchObject({ status: 'DUE', fromLeave: [], lossOfPayDays: 0.5 });
    await runInTenant(c.orgId, () => peoplePrisma.leaveYearEnd.deleteMany({ where: { orgId: c.orgId } }));
    await att(c, 'post', '/leave/adjustments', { employeeId: kavya.id, leaveTypeId: casual.id, year, days: -5, reason: 'Corrected' }).expect(201);
    const after = (await ppl(c, 'get', `/late-marks?month=${lastMonth}`).expect(200)).body.rows.find((x: any) => x.employeeId === kavya.id);
    expect(after).toMatchObject({ fromLeave: [], lossOfPayDays: 0.5 });
  });
});

describe('payroll waits for undecided late marks (review of #78)', () => {
  it('refuses to take attendance for a 26th-to-25th period with a penalty nobody decided, then takes it once waived', async () => {
    const c = await company();
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
    const pay = (p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(b as any);
    const basic = await pay('/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
    const structure = await pay('/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2025-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] }).expect(201);
    const emp = await pay('/employees', { name: 'Neel Rao', code: `PY${rnd().toUpperCase()}`, dateOfJoining: '2025-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
    const employeeId = emp.body.employee.id;
    await pay('/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2025-01-01', annualCtc: 360_000 }).expect(201);
    const thisMonth = istToday().slice(0, 7);
    const period = await pay('/periods', { name: `P ${rnd()}`, startDate: `${lastMonth}-26`, endDate: `${thisMonth}-25`, paymentDate: `${thisMonth}-25` }).expect(201);
    const run = await pay('/runs', { periodId: period.body.period.id }).expect(201);
    for (const d of workdays.slice(0, 3)) await day(c, employeeId, d, { late: 30 });
    await ppl(c, 'put', '/attendance-rules', { marksFrom: 'THIS_MONTH', marks: { on: true, cutMode: 'HALF_DAY_PER_N', late: { on: true, every: 3 }, cost: 0.5 } }).expect(200);
    await backdateRules(c);
    const refused = await pay(`/runs/${run.body.run.id}/inputs/from-attendance`).expect(409);
    expect(refused.body).toMatchObject({ code: 'PENALTIES_UNDECIDED', month: lastMonth, link: { app: 'people', screen: 'lateMarks' } });
    expect(refused.body.error).toMatch(/Neel Rao.*Apply or waive them in People, Time, Late marks/);
    await ppl(c, 'post', `/late-marks/${employeeId}/waive`, { month: lastMonth, reason: 'First month on the rule' }).expect(201);
    await pay(`/runs/${run.body.run.id}/inputs/from-attendance`).expect(200);
  });
});

describe('night work: warn or enforce, and every way a night shift arrives (review of #78)', () => {
  let c: Ctx;
  let dev: any, mira: any, noGender: any, sunil: any, uma: any;
  let night: any, day9: any, dept: any;
  const future = plus(istToday(), 20);

  beforeAll(async () => {
    c = await company();
    dept = (await ppl(c, 'post', '/structure/departments', { name: `Packing ${rnd()}` })).body.item;
    mira = await person(c, { name: 'Mira Das', code: 'NW1', gender: 'FEMALE', departmentId: dept.id });
    uma = await person(c, { name: 'Uma Rao', code: 'NW2', gender: 'FEMALE', departmentId: dept.id });
    dev = await person(c, { name: 'Dev Shah', code: 'NW3', gender: 'MALE', departmentId: dept.id });
    noGender = await person(c, { name: 'Kim Lee', code: 'NW4' });
    sunil = await person(c, { name: 'Sunil Joshi', code: 'NW5', gender: 'MALE' });
    night = (await att(c, 'post', '/shifts', { name: `Night ${rnd()}`, startTime: '22:00', endTime: '06:00' }).expect(201)).body.shift;
    day9 = (await att(c, 'post', '/shifts', { name: `Day ${rnd()}`, startTime: '09:00', endTime: '17:00' }).expect(201)).body.shift;
  }, 120_000);

  it('ENFORCE names every woman a department schedule would reach; no gender is warned, never blocked', async () => {
    const refused = await att(c, 'post', '/department-schedules', { departmentId: dept.id, shiftId: night.id, effectiveFrom: future }).expect(409);
    expect(refused.body.error).toMatch(/Mira Das and Uma Rao have no consent to night work on file/);
    expect(refused.body.error).not.toMatch(/Dev Shah/);
    await att(c, 'post', '/shift-assignments', { employeeIds: [noGender.id], shiftId: night.id, effectiveFrom: future }).expect(200);
    const report = (await ppl(c, 'get', '/night-work').expect(200)).body;
    expect(report.unknownGender).toEqual([expect.objectContaining({ employeeId: noGender.id })]);
    const home = (await ppl(c, 'get', '/home').expect(200)).body;
    expect(JSON.stringify(home)).toMatch(/Record gender for people on night shifts/);
  });

  it('editing a shift into the night, a night default shift and a move into a night department are checked too', async () => {
    await att(c, 'post', '/shift-assignments', { employeeIds: [mira.id], shiftId: day9.id, effectiveFrom: istToday() }).expect(200);
    const edit = await att(c, 'put', `/shifts/${day9.id}`, { ...day9, startTime: '15:00', endTime: '23:00' }).expect(409);
    expect(edit.body.error).toMatch(/Mira Das has no consent/);
    const rules = (await att(c, 'get', '/rules').expect(200)).body.rules;
    expect((await att(c, 'put', '/rules', { ...rules, defaultShiftId: night.id }).expect(409)).body.error).toMatch(/Uma Rao/);
    const other = (await ppl(c, 'post', '/structure/departments', { name: `Night crew ${rnd()}` })).body.item;
    await att(c, 'post', '/department-schedules', { departmentId: other.id, shiftId: night.id, effectiveFrom: future }).expect(201);
    const moved = await ppl(c, 'put', `/employees/${uma.id}`, { departmentId: other.id });
    expect(moved.status).toBe(409);
    expect(moved.body.error).toMatch(/Uma Rao has no consent/);
    await ppl(c, 'put', `/employees/${dev.id}`, { departmentId: other.id }).expect(200);
  });

  it('a swap refused for the colleague says nothing about her', async () => {
    await att(c, 'post', '/shift-assignments', { employeeIds: [uma.id], shiftId: day9.id, effectiveFrom: future }).expect(200);
    const evening = (await att(c, 'post', '/shifts', { name: `Evening ${rnd()}`, startTime: '14:00', endTime: '22:00' }).expect(201)).body.shift;
    await att(c, 'post', '/shift-assignments', { employeeIds: [sunil.id], shiftId: evening.id, effectiveFrom: future }).expect(200);
    const S = await portalOf(c, sunil);
    let sat = plus(future, 7);
    while (dow(sat) !== 6) sat = plus(sat, 1);
    const swap = await S.post('/people/swaps', { colleagueEmployeeId: uma.id, fromDate: sat }).expect(409);
    expect(swap.body).toMatchObject({ code: 'NIGHT_CONSENT', error: "That colleague can't take this shift." });
  });

  it('WARN saves the shift and lists who lacks consent on the report and Home', async () => {
    await ppl(c, 'put', '/attendance-rules', { night: { mode: 'WARN' } }).expect(200);
    await att(c, 'post', '/shift-assignments', { employeeIds: [mira.id], shiftId: night.id, effectiveFrom: future }).expect(200);
    const report = (await ppl(c, 'get', '/night-work').expect(200)).body;
    expect(report.rows.find((r: any) => r.employeeId === mira.id)).toMatchObject({ problem: true });
    expect(report.night.mode).toBe('WARN');
    const home = (await ppl(c, 'get', '/home').expect(200)).body;
    expect(JSON.stringify(home)).toMatch(/Night shifts without consent/);
  });

  it('HR copies are HR-only; a manager sees no notes or history', async () => {
    const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n% consent\n').toString('base64')}`;
    const made = (await ppl(c, 'post', `/night-work/${mira.id}`, { status: 'GIVEN', note: 'Signed in front of HR', file: { name: 'c.pdf', mime: 'application/pdf', data: pdf } }).expect(201)).body.consent;
    const doc = await runInTenant(c.orgId, () => peoplePrisma.employeeDocument.findFirst({ where: { id: made.documentId } }));
    expect(doc).toMatchObject({ classification: 'HR_ONLY', visibleToEmployee: false });
    const mgr = await withRole(c, 'Team Manager', 'Nita Lead');
    const lead = await person(c, { name: 'Nita Lead', code: 'NW9', workEmail: mgr.email });
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: mgr.userId } }));
    await ppl(c, 'put', `/employees/${mira.id}`, { reportingManagerId: lead.id }).expect(200);
    const seen = (await ppl(mgr, 'get', '/night-work').expect(200)).body.rows.find((r: any) => r.employeeId === mira.id);
    expect(seen.consent).toMatchObject({ status: 'GIVEN', note: null, documentId: null });
    expect((await ppl(mgr, 'get', `/night-work/${mira.id}`)).status).toBe(403);
  });
});

describe('absconding: someone who came back (review of #78)', () => {
  it('refuses ABSCONDED once they are back at work unless confirmed with a reason, and shows since when', async () => {
    const c = await company();
    const p = await person(c, { name: 'Back Again', code: 'BA1' });
    await day(c, p.id, plus(istToday(), -21), {});
    await runInTenant(c.orgId, () => checkCompany(c.accountId!, c.orgId));
    const row = (await ppl(c, 'get', '/absences').expect(200)).body.rows[0];
    await ppl(c, 'post', `/absences/${row.id}/notice`, { signatory: 'HR' }).expect(201);
    await runInTenant(c.orgId, () => peoplePrisma.absenceNotice.updateMany({ where: { caseId: row.id }, data: { sentAt: new Date(Date.now() - 8 * 86_400_000) } }));
    await ppl(c, 'post', `/absences/${row.id}/notice`, { signatory: 'HR' }).expect(201);
    await runInTenant(c.orgId, () => peoplePrisma.absenceNotice.updateMany({ where: { caseId: row.id, seq: 2 }, data: { reportBy: plus(istToday(), -1) } }));
    /* Back at work today, after the last absent day the morning check saw. */
    const back = istToday();
    await day(c, p.id, back, {});
    const listed = (await ppl(c, 'get', '/absences').expect(200)).body.rows[0];
    expect(listed.backSince).toBe(back);
    expect((await ppl(c, 'post', `/absences/${row.id}/absconded`, {}).expect(409)).body.code).toBe('CAME_BACK');
    expect((await ppl(c, 'post', `/absences/${row.id}/absconded`, { confirmBack: true }).expect(409)).body.code).toBe('CAME_BACK');
    await ppl(c, 'post', `/absences/${row.id}/absconded`, { confirmBack: true, reason: 'Came for one day to collect things, then left again' }).expect(200);
  });
});
