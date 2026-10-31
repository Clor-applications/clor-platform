import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * How much a late mark cuts (docs/people/workflow-engine/SPEC.md 3.1, DECISIONS.md 1; owner, 31 Oct 2026): the
 * time actually missed (the default for a company not yet using late marks), the same rounded up per mark, or every
 * N marks = ½ or 1 day (kept, with a warning and a per-person comparison, and kept for companies already on it).
 * Free marks and the grace apply in every mode. HR for the whole company or the owner changes it, audited.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { istInstant } = await import('../services/attendance/compute.js');
const { rulesOf, legacyMarks, marksFromLegacy } = await import('../services/attendance/timeRules.js');
const { costOf, timeMissedOf, policyText } = await import('../services/attendance/markRules.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId?: string; userId?: string; email?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `cut.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Cut Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  c.accountId = (await platformPrisma.org.findUnique({ where: { id: c.orgId }, select: { accountId: true } }))!.accountId;
  return c;
}
async function withRole(boss: Ctx, label: string, name: string): Promise<Ctx> {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body;
  const role = (roles.roles || roles).find((r: any) => r.name === label);
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { ...boss, token: login.body.token, userId: user.body.user.id, email };
}
async function custom(boss: Ctx, permissions: string[], ownOnly: boolean): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `cust.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Custom', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { ...boss, token: login.body.token, userId: user.body.user.id, email };
}
const call = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any);
const ppl = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => call(c, m, `/people${p}`, b);
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => call(c, m, `/attendance${p}`, b);
const person = async (c: Ctx, body: Record<string, unknown>) => (await ppl(c, 'post', '/employees', { dateOfJoining: '2025-01-01', ...body }).expect(201)).body.employee;
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lastMonth = (() => {
  const [y, m] = istToday().slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
})();
const workdays = (() => {
  const out: string[] = [];
  for (let d = `${lastMonth}-01`; d.slice(0, 7) === lastMonth; d = plus(d, 1)) if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) out.push(d);
  return out;
})();
const day = (c: Ctx, employeeId: string, date: string, late: number) =>
  runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId, date } },
    create: { accountId: c.accountId!, orgId: c.orgId, employeeId, date, status: 'PRESENT', source: 'MANUAL', checkIn: istInstant(date, '09:00'), checkOut: istInstant(date, '18:00'), lateMinutes: late, earlyOutMinutes: 0, workedMinutes: 480, createdByUserId: 'test' },
    update: { lateMinutes: late },
  }));
const backdate = (c: Ctx) => runInTenant(c.orgId, () => peoplePrisma.attendanceRuleVersion.updateMany({ where: { orgId: c.orgId }, data: { createdAt: new Date('2020-01-01T00:00:00Z') } }));
const mark = (date: string, minutes: number, dayMinutes = 480) => ({ date, minutes, dayMinutes });

describe('the cut, worked out', () => {
  const base = (over: any = {}) => rulesOf({ timeRules: { marks: { on: true, late: { on: true, every: 3, free: 1, graceMinutes: 10 }, cost: 0.5, ...over } } }).marks;
  const lates = [mark('2026-09-01', 20), mark('2026-09-02', 15), mark('2026-09-03', 30), mark('2026-09-04', 25)];

  it('time missed: the counted marks’ whole minutes over the full day, after the free ones in date order', () => {
    const r = base({ cutMode: 'TIME_MISSED' });
    /* The first (20 min) is free; 15 + 30 + 25 = 70 min of a 480-minute day. */
    expect(costOf(r, lates, [])).toBe(Math.round((70 / 480) * 100) / 100);
    expect(timeMissedOf(r, lates, [])).toEqual({ minutes: 70, days: 0.15 });
    /* A 9-hour full day weighs the same minutes less. */
    expect(costOf(r, lates.map((m) => ({ ...m, dayMinutes: 540 })), [])).toBe(Math.round((70 / 540) * 100) / 100);
    expect(costOf(base({ cutMode: 'TIME_MISSED', late: { free: 4 } }), lates, [])).toBe(0);
  });

  it('rounded: each mark up to 15, 30 or 60 minutes, never more than the day', () => {
    expect(costOf(base({ cutMode: 'TIME_MISSED_ROUNDED', roundToMinutes: 15 }), lates, [])).toBe(Math.round(((15 + 30 + 30) / 480) * 100) / 100);
    expect(costOf(base({ cutMode: 'TIME_MISSED_ROUNDED', roundToMinutes: 30 }), lates, [])).toBe(Math.round((90 / 480) * 100) / 100);
    expect(costOf(base({ cutMode: 'TIME_MISSED_ROUNDED', roundToMinutes: 60 }), lates, [])).toBe(Math.round((180 / 480) * 100) / 100);
    expect(costOf(base({ cutMode: 'TIME_MISSED_ROUNDED', roundToMinutes: 60, late: { free: 0 } }), [mark('2026-09-01', 300, 240)], [])).toBe(1);
  });

  it('every N marks: today’s rule, counts as before; early exits count on their own in every mode', () => {
    const r = base({ cutMode: 'HALF_DAY_PER_N' });
    expect(costOf(r, lates, [])).toBe(0.5);
    expect(costOf(r, 4, 0)).toBe(0.5);
    const both = base({ cutMode: 'TIME_MISSED', early: { on: true, free: 0, every: 3 } });
    expect(costOf(both, [], [mark('2026-09-05', 48)])).toBe(0.1);
  });

  it('defaults: a company not using late marks gets time missed; one already using them keeps every N = ½ day', () => {
    expect(rulesOf(null).marks.cutMode).toBe('TIME_MISSED');
    expect(rulesOf({ latePenaltyEvery: 0 }).marks.cutMode).toBe('TIME_MISSED');
    expect(legacyMarks({ latePenaltyEvery: 3, lateAllowancePerMonth: 2 })).toMatchObject({ on: true, cutMode: 'HALF_DAY_PER_N', cost: 0.5, late: { every: 3, free: 2 } });
    /* Saved by the People screen before the choice existed: on keeps the step rule, off takes the new default. */
    expect(rulesOf({ timeRules: { marks: { on: true, late: { every: 3 } } } }).marks.cutMode).toBe('HALF_DAY_PER_N');
    expect(rulesOf({ timeRules: { marks: { on: false } } }).marks.cutMode).toBe('TIME_MISSED');
    /* The Attendance app's two numbers mean "half a day every N": switching on there takes that rule. */
    expect(marksFromLegacy(rulesOf(null), { latePenaltyEvery: 3, lateAllowancePerMonth: 0 }).marks.cutMode).toBe('HALF_DAY_PER_N');
  });

  it('the employee reads the rule in one sentence', () => {
    expect(policyText(base({ cutMode: 'TIME_MISSED' }), [])).toMatch(/The first 1 late arrivals by more than 10 minutes in a month are free; after that the time missed is cut, unpaid\./);
    expect(policyText(base({ cutMode: 'TIME_MISSED_ROUNDED', roundToMinutes: 30 }), ['Casual leave'])).toMatch(/rounded up to 30 minutes, is cut, taken from Casual leave/);
    expect(policyText(base({ cutMode: 'HALF_DAY_PER_N' }), [])).toMatch(/every 3 cost ½ day/);
  });
});

describe('a month under each cut, and who may change it', () => {
  let c: Ctx;
  let other: Ctx;
  let hr: Ctx;
  let lead: Ctx;
  let approverAll: Ctx;
  let approverTeam: Ctx;
  let asha: any;
  beforeAll(async () => {
    c = await company();
    other = await company();
    hr = await withRole(c, 'HR Manager', 'Hema HR');
    lead = await withRole(c, 'Team Manager', 'Lata Lead');
    approverAll = await custom(c, ['ATTENDANCE::Attendance Requests::VIEW', 'ATTENDANCE::Attendance Requests::APPROVE', 'PEOPLE::Employees::VIEW'], false);
    approverTeam = await custom(c, ['ATTENDANCE::Attendance Requests::VIEW', 'ATTENDANCE::Attendance Requests::APPROVE', 'PEOPLE::Employees::VIEW'], true);
    asha = await person(c, { name: 'Asha Rao', code: 'K1' });
    await day(c, asha.id, workdays[0], 20);
    await day(c, asha.id, workdays[1], 15);
    await day(c, asha.id, workdays[2], 30);
    await day(c, asha.id, workdays[3], 5);
  }, 180_000);

  const ashaRow = async () => (await ppl(c, 'get', `/late-marks?month=${lastMonth}`).expect(200)).body.rows.find((r: any) => r.employeeId === asha.id);

  it('a new company switching late marks on is cut the time missed; payable days take it as loss of pay', async () => {
    expect((await ppl(c, 'get', '/attendance-rules').expect(200)).body.rules.marks).toMatchObject({ on: false, cutMode: 'TIME_MISSED', roundToMinutes: 15 });
    await ppl(hr, 'put', '/attendance-rules', { marks: { on: true, late: { on: true, graceMinutes: 10, free: 0 } } }).expect(200);
    await backdate(c);
    /* 20 + 15 + 30 = 65 minutes (the 5-minute one is inside the grace) of a 480-minute day. */
    expect(await ashaRow()).toMatchObject({ lateMarks: 3, days: 0.14, timeMissedMinutes: 65, timeMissedDays: 0.14, status: 'DUE', lossOfPayDays: 0.14 });
    const pay = (await att(c, 'get', `/payable-days?month=${lastMonth}`).expect(200)).body.rows.find((x: any) => x.employeeId === asha.id);
    expect(pay.why).toMatch(/0\.14 late penalty/);
    /* The Attendance app's step numbers read 0: it would show "half a day every 3", which is not the rule. */
    expect((await att(c, 'get', '/rules').expect(200)).body.rules.latePenaltyEvery).toBe(0);
  });

  it('rounded up and every N marks; the preview sets the cut beside the time missed', async () => {
    await ppl(hr, 'put', '/attendance-rules', { marks: { cutMode: 'TIME_MISSED_ROUNDED', roundToMinutes: 30 } }).expect(200);
    await backdate(c);
    expect((await ashaRow()).days).toBe(Math.round((90 / 480) * 100) / 100);
    const p = (await ppl(hr, 'post', '/late-marks/preview', { month: lastMonth, marks: { cutMode: 'HALF_DAY_PER_N', late: { every: 3 }, cost: 0.5 } }).expect(200)).body;
    expect(p.rows.find((r: any) => r.employeeId === asha.id)).toMatchObject({ now: 0.19, then: 0.5, timeMissedDays: 0.14, timeMissedMinutes: 65 });
  });

  it('the change is audited with before and after, as a company setting', async () => {
    const rows = await runInTenant(c.orgId, () => platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'COMPANY_SETTING', entityId: 'attendance.lateMarkCut' }, orderBy: { createdAt: 'asc' } }));
    expect(rows.length).toBe(1);
    expect(rows[0].createdByUserId).toBe(hr.userId);
    expect(JSON.parse(rows[0].metadata!)).toEqual({ before: { cutMode: 'TIME_MISSED', roundToMinutes: 15 }, after: { cutMode: 'TIME_MISSED_ROUNDED', roundToMinutes: 30 } });
  });

  it('a team manager, a team-scoped approver and another company may not change it; a company-wide approver may', async () => {
    expect((await ppl(lead, 'put', '/attendance-rules', { marks: { cutMode: 'HALF_DAY_PER_N' } })).status).toBe(403);
    expect((await ppl(lead, 'get', '/attendance-rules').expect(200)).body.canEdit).toBe(false);
    expect((await ppl(approverTeam, 'put', '/attendance-rules', { marks: { cutMode: 'HALF_DAY_PER_N' } })).status).toBe(403);
    expect((await request(app).put(`/api/orgs/${c.orgId}/people/attendance-rules`).set(at(other)).send({ marks: { cutMode: 'HALF_DAY_PER_N' } })).status).toBe(403);
    expect((await ppl(c, 'put', '/attendance-rules', { marks: { cutMode: 'EVERYTHING' } }).expect(400)).body.error).toBeTruthy();
    expect((await ppl(c, 'put', '/attendance-rules', { marks: { roundToMinutes: 20 } }).expect(400)).body.error).toBeTruthy();
    await ppl(approverAll, 'put', '/attendance-rules', { marks: { cutMode: 'TIME_MISSED' } }).expect(200);
    expect((await ppl(c, 'get', '/attendance-rules').expect(200)).body.rules.marks.cutMode).toBe('TIME_MISSED');
  });
});

describe('a company already using late marks', () => {
  it('keeps every N marks = ½ day with its numbers: the same penalty as before the choice existed', async () => {
    const c = await company();
    const asha = await person(c, { name: 'Old Rule', code: 'O1' });
    for (const d of workdays.slice(0, 4)) await day(c, asha.id, d, 25);
    /* Set through the Attendance app's two numbers, as companies did before People's screen. */
    await runInTenant(c.orgId, () => peoplePrisma.attendanceSettings.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId!, orgId: c.orgId, lateAllowancePerMonth: 1, latePenaltyEvery: 3, updatedByUserId: 'test' }, update: { lateAllowancePerMonth: 1, latePenaltyEvery: 3 } }));
    const rules = (await ppl(c, 'get', '/attendance-rules').expect(200)).body.rules.marks;
    expect(rules).toMatchObject({ on: true, cutMode: 'HALF_DAY_PER_N', cost: 0.5, late: { every: 3, free: 1 } });
    const row = (await ppl(c, 'get', `/late-marks?month=${lastMonth}`).expect(200)).body.rows.find((r: any) => r.employeeId === asha.id);
    /* 4 marks, 1 free, every 3 = ½ day; the time missed (75 min) is shown beside it. */
    expect(row).toMatchObject({ lateMarks: 4, days: 0.5, timeMissedMinutes: 75, timeMissedDays: 0.16 });
  }, 60_000);
});
