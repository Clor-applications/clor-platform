import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * How much a late mark cuts (docs/people/workflow-engine/SPEC.md 3.1, DECISIONS.md 1; owner, 31 Oct 2026): the
 * time actually missed (the default for a company not yet using late marks), the same rounded DOWN per mark, or every
 * N marks = ½ or 1 day (kept, with a warning and a per-person comparison, and kept for companies already on it).
 * Free marks and the grace apply in every mode. HR for the whole company or the owner changes it, audited.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { istInstant } = await import('../services/attendance/compute.js');
const { rulesOf, legacyMarks, marksFromLegacy, withChange } = await import('../services/attendance/timeRules.js');
const { PrismaClient } = await import('../generated/people/index.js');
const { costOf, timeMissedOf, policyText } = await import('../services/attendance/markRules.js');

const app = buildApp().listen(0, '127.0.0.1');
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
    expect(costOf(r, lates, [])).toBe(Math.floor((70 / 480) * 100) / 100);
    expect(timeMissedOf(r, lates, [])).toEqual({ minutes: 70, days: 0.14 });
    /* A 9-hour full day weighs the same minutes less. */
    expect(costOf(r, lates.map((m) => ({ ...m, dayMinutes: 540 })), [])).toBe(Math.floor((70 / 540) * 100) / 100);
    expect(costOf(base({ cutMode: 'TIME_MISSED', late: { free: 4 } }), lates, [])).toBe(0);
  });

  it('rounded: each mark DOWN to 15, 30 or 60 minutes, never more than the day', () => {
    /* Counted: 15, 30, 25 minutes. */
    expect(costOf(base({ cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 15 }), lates, [])).toBe(Math.floor(((15 + 30 + 15) / 480) * 100) / 100);
    expect(costOf(base({ cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 30 }), lates, [])).toBe(Math.floor((30 / 480) * 100) / 100);
    expect(costOf(base({ cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 60 }), lates, [])).toBe(0);
    const r15 = base({ cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 15, late: { free: 0 } });
    /* A 20-minute late under 15 cuts 15; a 10-minute late cuts nothing; a 5-minute late never cuts 15. */
    expect(costOf(r15, [mark('2026-09-01', 20, 1500)], [])).toBe(0.01);
    expect(costOf(r15, [mark('2026-09-01', 10)], [])).toBe(0);
    expect(costOf(r15, [mark('2026-09-01', 5)], [])).toBe(0);
    expect(costOf(base({ cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 60, late: { free: 0 } }), [mark('2026-09-01', 300, 240)], [])).toBe(1);
  });

  it('no mode but the warned every-N rule ever cuts more than the minutes missed (many random months)', () => {
    let seed = 20261101;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const modes = [{ cutMode: 'TIME_MISSED' }, { cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 15 }, { cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 30 }, { cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 60 }];
    for (let i = 0; i < 2000; i += 1) {
      const mode = modes[i % modes.length];
      const r = base({ ...mode, late: { on: true, free: rand(3) }, early: { on: rand(2) === 1, free: rand(3), every: 3 } });
      const days = 1 + rand(26);
      const L: ReturnType<typeof mark>[] = [];
      const E: ReturnType<typeof mark>[] = [];
      for (let d = 1; d <= days; d += 1) {
        const date = `2026-09-${String(d).padStart(2, '0')}`;
        const len = [240, 420, 480, 510, 540, 720][rand(6)];
        if (rand(3)) L.push(mark(date, 1 + rand(len + 60), len));
        if (rand(3)) E.push(mark(date, 1 + rand(len + 60), len));
      }
      /* What the counted marks missed, in days, each day at most the whole day. */
      const perDay = new Map<string, number>();
      const counted = (on: boolean, free: number, ms: typeof L) => (on ? ms.slice(free) : []);
      for (const m of [...counted(r.late.on, r.late.free, L), ...counted(r.early.on, r.early.free, E)]) perDay.set(m.date, Math.min(1, (perDay.get(m.date) || 0) + Math.min(m.minutes, m.dayMinutes) / m.dayMinutes));
      const missed = [...perDay.values()].reduce((a, b) => a + b, 0);
      expect(costOf(r, L, E)).toBeLessThanOrEqual(missed + 1e-9);
    }
    /* The every-N rule can, which is why the screen warns: 3 marks of 5 minutes cost half a day. */
    const step = base({ cutMode: 'HALF_DAY_PER_N', late: { free: 0, every: 3 } });
    expect(costOf(step, [mark('2026-09-01', 5), mark('2026-09-02', 5), mark('2026-09-03', 5)], [])).toBe(0.5);
  });

  it('every N marks: today’s rule, counts as before; early exits count on their own in every mode', () => {
    const r = base({ cutMode: 'HALF_DAY_PER_N' });
    expect(costOf(r, lates, [])).toBe(0.5);
    expect(costOf(r, 4, 0)).toBe(0.5);
    const both = base({ cutMode: 'TIME_MISSED', early: { on: true, free: 0, every: 3 } });
    expect(costOf(both, [], [mark('2026-09-05', 48)])).toBe(0.1);
  });

  it('a minute cut never takes more than the time missed: rounded down to 0.01 day (s.20)', () => {
    const r = base({ cutMode: 'TIME_MISSED', late: { free: 0 } });
    /* 65 of 480 minutes is 0.1354 of a day: 0.13, never 0.14 (67.2 minutes). */
    expect(costOf(r, [mark('2026-09-01', 65)], [])).toBe(0.13);
    for (let m = 1; m <= 480; m += 7) {
      for (const len of [420, 480, 510, 540]) {
        const missed = Math.min(m, len);
        const cut = costOf(r, [mark('2026-09-01', missed, len)], []);
        expect(cut * len).toBeLessThanOrEqual(missed + 1e-9);
      }
    }
    const rounded = base({ cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 15, late: { free: 0 } });
    /* Down to 60 minutes, then down to the 0.01 day: 0.12, not 0.13. */
    expect(costOf(rounded, [mark('2026-09-01', 61)], [])).toBe(0.12);
  });

  it('one day’s late arrival and early exit together cut at most that day', () => {
    const r = base({ cutMode: 'TIME_MISSED', late: { free: 0 }, early: { on: true, free: 0, every: 3 } });
    expect(costOf(r, [mark('2026-09-01', 300)], [mark('2026-09-01', 300)])).toBe(1);
    expect(costOf(r, [mark('2026-09-01', 300), mark('2026-09-02', 48)], [mark('2026-09-01', 300)])).toBe(1.1);
  });

  it('defaults: a company not using late marks gets time missed; one already using them keeps every N = ½ day', () => {
    /* The old round-up value reads as round-down (migration 20261115090000_late_cut_round_down). */
    expect(rulesOf({ timeRules: { marks: { on: true, cutMode: 'TIME_MISSED_ROUNDED', roundToMinutes: 30 } } }).marks).toMatchObject({ cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 30 });
    expect(rulesOf(null).marks.cutMode).toBe('TIME_MISSED');
    expect(rulesOf({ latePenaltyEvery: 0 }).marks.cutMode).toBe('TIME_MISSED');
    expect(legacyMarks({ latePenaltyEvery: 3, lateAllowancePerMonth: 2 })).toMatchObject({ on: true, cutMode: 'HALF_DAY_PER_N', cost: 0.5, late: { every: 3, free: 2 } });
    /* Saved by the People screen before the choice existed: on keeps the step rule, off takes the new default. */
    expect(rulesOf({ timeRules: { marks: { on: true, late: { every: 3 } } } }).marks.cutMode).toBe('HALF_DAY_PER_N');
    expect(rulesOf({ timeRules: { marks: { on: false } } }).marks.cutMode).toBe('TIME_MISSED');
    /* The Attendance app's two numbers change the numbers only, never the cut (review of #89). */
    expect(marksFromLegacy(rulesOf({ timeRules: { marks: { on: false, cutMode: 'TIME_MISSED' } } }), { latePenaltyEvery: 3, lateAllowancePerMonth: 0 }).marks).toMatchObject({ on: true, cutMode: 'TIME_MISSED', late: { every: 3 } });
    expect(marksFromLegacy(rulesOf({ timeRules: { marks: { on: true, cutMode: 'HALF_DAY_PER_N' } } }), { latePenaltyEvery: 4, lateAllowancePerMonth: 1 }).marks.cutMode).toBe('HALF_DAY_PER_N');
  });

  it('the employee reads the rule in one sentence', () => {
    expect(policyText(base({ cutMode: 'TIME_MISSED' }), [])).toMatch(/The first 1 late arrivals by more than 10 minutes in a month are free; after that the time missed is cut, unpaid\./);
    expect(policyText(base({ cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 30 }), ['Casual leave'])).toMatch(/rounded down to 30 minutes, is cut, taken from Casual leave/);
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
    await ppl(hr, 'put', '/attendance-rules', { marks: { on: true, late: { on: true, graceMinutes: 10, free: 0 } }, marksFrom: 'THIS_MONTH' }).expect(200);
    await backdate(c);
    /* 20 + 15 + 30 = 65 minutes (the 5-minute one is inside the grace) of a 480-minute day. */
    expect(await ashaRow()).toMatchObject({ lateMarks: 3, days: 0.13, timeMissedMinutes: 65, timeMissedDays: 0.13, status: 'DUE', lossOfPayDays: 0.13 });
    const pay = (await att(c, 'get', `/payable-days?month=${lastMonth}`).expect(200)).body.rows.find((x: any) => x.employeeId === asha.id);
    expect(pay.why).toMatch(/0\.13 late penalty/);
    /* The Attendance app's step numbers read 0: it would show "half a day every 3", which is not the rule. */
    expect((await att(c, 'get', '/rules').expect(200)).body.rules.latePenaltyEvery).toBe(0);
  });

  it('rounded up and every N marks; the preview sets the cut beside the time missed', async () => {
    await ppl(hr, 'put', '/attendance-rules', { marks: { cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 30 }, marksFrom: 'THIS_MONTH' }).expect(200);
    await backdate(c);
    /* 20, 15 and 30 minutes, each down to 30: 0 + 0 + 30. */
    expect((await ashaRow()).days).toBe(Math.floor((30 / 480) * 100) / 100);
    const p = (await ppl(hr, 'post', '/late-marks/preview', { month: lastMonth, marks: { cutMode: 'HALF_DAY_PER_N', late: { every: 3 }, cost: 0.5 } }).expect(200)).body;
    expect(p.rows.find((r: any) => r.employeeId === asha.id)).toMatchObject({ now: 0.06, then: 0.5, timeMissedDays: 0.13, timeMissedMinutes: 65 });
  });

  it('the change is audited with before and after, as a company setting', async () => {
    const rows = await runInTenant(c.orgId, () => platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'COMPANY_SETTING', entityId: 'attendance.lateMarkCut' }, orderBy: { createdAt: 'asc' } }));
    expect(rows.length).toBe(1);
    expect(rows[0].createdByUserId).toBe(hr.userId);
    expect(JSON.parse(rows[0].metadata!)).toEqual({ before: { cutMode: 'TIME_MISSED', roundToMinutes: 15 }, after: { cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 30 }, from: null });
    expect(rows[0].message).toMatch(/from this month/);
  });

  it('a team manager, a team-scoped approver and another company may not change it; a company-wide approver may', async () => {
    expect((await ppl(lead, 'put', '/attendance-rules', { marks: { cutMode: 'HALF_DAY_PER_N' } })).status).toBe(403);
    expect((await ppl(lead, 'get', '/attendance-rules').expect(200)).body.canEdit).toBe(false);
    expect((await ppl(approverTeam, 'put', '/attendance-rules', { marks: { cutMode: 'HALF_DAY_PER_N' } })).status).toBe(403);
    expect((await request(app).put(`/api/orgs/${c.orgId}/people/attendance-rules`).set(at(other)).send({ marks: { cutMode: 'HALF_DAY_PER_N' } })).status).toBe(403);
    expect((await ppl(c, 'put', '/attendance-rules', { marks: { cutMode: 'EVERYTHING' } }).expect(400)).body.error).toBeTruthy();
    expect((await ppl(c, 'put', '/attendance-rules', { marks: { roundToMinutes: 20 } }).expect(400)).body.error).toBeTruthy();
    await ppl(approverAll, 'put', '/attendance-rules', { marks: { cutMode: 'TIME_MISSED' }, marksFrom: 'THIS_MONTH' }).expect(200);
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
    expect(row).toMatchObject({ lateMarks: 4, days: 0.5, timeMissedMinutes: 75, timeMissedDays: 0.15 });
  }, 60_000);
});

describe('leave covers whole half days only', () => {
  it('a cut under half a day is unpaid; 0.6 day takes half a day of leave and 0.1 unpaid', async () => {
    const c = await company();
    const e = await person(c, { name: 'Leave Holder', code: 'LH1' });
    const casual = (await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 0 }).expect(201)).body.type;
    await att(c, 'post', '/leave/adjustments', { employeeId: e.id, leaveTypeId: casual.id, year: Number(lastMonth.slice(0, 4)), days: 5, reason: 'Opening balance' }).expect(201);
    await day(c, e.id, workdays[0], 65);
    await ppl(c, 'put', '/attendance-rules', { marks: { on: true, late: { on: true, graceMinutes: 0, free: 0 }, takeFrom: [casual.id] }, marksFrom: 'THIS_MONTH' }).expect(200);
    await backdate(c);
    const row = async () => (await ppl(c, 'get', `/late-marks?month=${lastMonth}`).expect(200)).body.rows.find((r: any) => r.employeeId === e.id);
    expect(await row()).toMatchObject({ days: 0.13, fromLeave: [], lossOfPayDays: 0.13 });
    await day(c, e.id, workdays[1], 223);
    /* 65 + 223 = 288 minutes = 0.6 day: half a day from Casual, 0.1 unpaid; never 0.6 day of leave (a balance of 4.4). */
    const r = await row();
    expect(r.days).toBe(0.6);
    expect(r.fromLeave).toEqual([expect.objectContaining({ leaveTypeId: casual.id, days: 0.5 })]);
    expect(r.lossOfPayDays).toBe(0.1);
  }, 60_000);
});

describe('rule versions and when a change takes effect', () => {
  it('a "this month" save while a next-month change waits: this month gets only its own change (10 Oct / 20 Oct)', async () => {
    const c = await company();
    const today = istToday();
    const lastOfThis = (() => { const [y, m] = today.slice(0, 7).split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); })();
    const nextMonthFirst = plus(lastOfThis, 1);
    const { marksRulesOn } = await import('../services/attendance/markRules.js');
    const on = (d: string) => runInTenant(c.orgId, () => marksRulesOn(c.orgId, d)).then((x) => x.marks);
    /* The rule since long ago: every 3 marks cost ½ day. */
    await ppl(c, 'put', '/attendance-rules', { marks: { on: true, cutMode: 'HALF_DAY_PER_N', cost: 0.5, late: { on: true, every: 3, free: 0 } }, marksFrom: 'THIS_MONTH' }).expect(200);
    await backdate(c);
    /* "10 Oct": every mark from next month. */
    await ppl(c, 'put', '/attendance-rules', { marks: { late: { every: 1 } } }).expect(200);
    /* "20 Oct": a full day per step, from this month. */
    await ppl(c, 'put', '/attendance-rules', { marks: { cost: 1 }, marksFrom: 'THIS_MONTH' }).expect(200);
    expect(await on(lastOfThis)).toMatchObject({ cost: 1, late: { every: 3 } });
    expect(await on(plus(nextMonthFirst, 27))).toMatchObject({ cost: 1, late: { every: 1 } });
    /* The screen still shows what is saved: the rule from next month. */
    expect((await ppl(c, 'get', '/attendance-rules').expect(200)).body.rules.marks).toMatchObject({ cost: 1, late: { every: 1 } });
  }, 60_000);

  it('withChange takes only what changed, late and early field by field', () => {
    const a = rulesOf({ timeRules: { marks: { on: true, cutMode: 'HALF_DAY_PER_N', late: { every: 3, free: 0 } } } }).marks;
    const b = { ...a, late: { ...a.late, every: 1 } };
    const bc = { ...b, cost: 1 as const, late: { ...b.late, free: 2 } };
    expect(withChange(a, b, bc)).toMatchObject({ cost: 1, late: { every: 3, free: 2 } });
  });

  it('a version saved before the cut existed (marks on, no cutMode) still gives the half-day rule for its month', async () => {
    const c = await company();
    const e = await person(c, { name: 'Past Rule', code: 'PR1' });
    for (const d of workdays.slice(0, 3)) await day(c, e.id, d, 25);
    const old = { marks: { on: true, late: { on: true, graceMinutes: null, every: 3, free: 0 }, early: { on: false, graceMinutes: null, every: 3, free: 0 }, cost: 0.5, takeFrom: [] } };
    await runInTenant(c.orgId, () => peoplePrisma.attendanceRuleVersion.create({ data: { accountId: c.accountId!, orgId: c.orgId, version: 1, rulesJson: JSON.stringify({ kind: 'RULES', name: 'Attendance rules', before: { marks: { on: false } }, after: old }), changedByUserId: 'test', createdAt: new Date('2020-01-01T00:00:00Z') } }));
    await runInTenant(c.orgId, () => peoplePrisma.attendanceSettings.upsert({ where: { orgId: c.orgId }, create: { accountId: c.accountId!, orgId: c.orgId, timeRules: old as any, updatedByUserId: 'test' }, update: { timeRules: old as any } }));
    const row = (await ppl(c, 'get', `/late-marks?month=${lastMonth}`).expect(200)).body.rows.find((r: any) => r.employeeId === e.id);
    expect(row).toMatchObject({ lateMarks: 3, days: 0.5, ruleVersion: 1 });
  }, 60_000);

  it('by default a change to late marks takes effect next month; "from this month" applies to this month', async () => {
    const c = await company();
    const today = istToday();
    const lastOfThis = (() => { const [y, m] = today.slice(0, 7).split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); })();
    const nextMonthFirst = plus(lastOfThis, 1);
    await ppl(c, 'put', '/attendance-rules', { marks: { on: true, cutMode: 'HALF_DAY_PER_N' }, marksFrom: 'THIS_MONTH' }).expect(200);
    const { marksRulesOn } = await import('../services/attendance/markRules.js');
    expect((await runInTenant(c.orgId, () => marksRulesOn(c.orgId, lastOfThis))).marks.cutMode).toBe('HALF_DAY_PER_N');
    const saved = (await ppl(c, 'put', '/attendance-rules', { marks: { cutMode: 'TIME_MISSED' } }).expect(200)).body;
    expect(saved.marksFrom).toBe(nextMonthFirst);
    expect(saved.rules.marks.cutMode).toBe('TIME_MISSED');
    expect((await runInTenant(c.orgId, () => marksRulesOn(c.orgId, lastOfThis))).marks.cutMode).toBe('HALF_DAY_PER_N');
    expect((await runInTenant(c.orgId, () => marksRulesOn(c.orgId, plus(nextMonthFirst, 27)))).marks.cutMode).toBe('TIME_MISSED');
    /* The audit line says when the new cut counts from. */
    const audit = await runInTenant(c.orgId, () => platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'COMPANY_SETTING', entityId: 'attendance.lateMarkCut' }, orderBy: { createdAt: 'asc' } }));
    expect(audit.at(-1)!.message).toContain(`from ${nextMonthFirst}`);
    expect(JSON.parse(audit.at(-1)!.metadata!).from).toBe(nextMonthFirst);
    const general = await runInTenant(c.orgId, () => platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'AttendanceSettings', entityId: c.orgId }, orderBy: { createdAt: 'asc' } }));
    expect(general.at(-1)!.message).toContain(`late marks from ${nextMonthFirst}`);
    expect(JSON.parse(general.at(-1)!.metadata!).from).toBe(nextMonthFirst);
    await ppl(c, 'put', '/attendance-rules', { marks: { cutMode: 'TIME_MISSED_ROUNDED_DOWN' }, marksFrom: 'THIS_MONTH' }).expect(200);
    expect((await runInTenant(c.orgId, () => marksRulesOn(c.orgId, lastOfThis))).marks.cutMode).toBe('TIME_MISSED_ROUNDED_DOWN');
    expect((await ppl(c, 'put', '/attendance-rules', { marks: { on: false }, marksFrom: 'LAST_YEAR' }).expect(400)).body.error).toMatch(/next month|this month/);
  }, 60_000);
});

describe('the Attendance app’s two numbers', () => {
  it('a company that never saved People’s rule: the first change is a baseline version, so this month and undecided earlier ones keep the old rule; it is audited', async () => {
    const c = await company();
    const e = await person(c, { name: 'Base Line', code: 'BL1' });
    for (const d of workdays.slice(0, 3)) await day(c, e.id, d, 25);
    const { marksRulesOn } = await import('../services/attendance/markRules.js');
    const today = istToday();
    const lastOfThis = (() => { const [y, m] = today.slice(0, 7).split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); })();
    const nextMonthFirst = plus(lastOfThis, 1);
    const rules = (await att(c, 'get', '/rules').expect(200)).body.rules;
    await att(c, 'put', '/rules', { defaultShiftId: rules.defaultShiftId, lateAllowancePerMonth: 0, latePenaltyEvery: 3, leaveApproval: 'HR', correctionApproval: 'HR' }).expect(200);
    const versions = (await runInTenant(c.orgId, () => peoplePrisma.attendanceRuleVersion.findMany({ where: { orgId: c.orgId } }))).map((v) => JSON.parse(v.rulesJson)).filter((x) => x.name === 'Attendance rules');
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ from: nextMonthFirst, before: { marks: { on: false } }, after: { marks: { on: true, cutMode: 'HALF_DAY_PER_N', late: { every: 3 } } } });
    /* Last month (undecided) and this month: no penalty, as before the change. Next month: ½ day every 3. */
    expect((await ppl(c, 'get', `/late-marks?month=${lastMonth}`).expect(200)).body.rows.find((r: any) => r.employeeId === e.id)?.days ?? 0).toBe(0);
    expect((await runInTenant(c.orgId, () => marksRulesOn(c.orgId, lastOfThis))).marks.on).toBe(false);
    expect((await runInTenant(c.orgId, () => marksRulesOn(c.orgId, plus(nextMonthFirst, 27)))).marks).toMatchObject({ on: true, cutMode: 'HALF_DAY_PER_N', late: { every: 3 } });
    const audit = await runInTenant(c.orgId, () => platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'AttendanceSettings', entityId: c.orgId } }));
    const line = audit.find((a) => /Late arrivals/.test(a.message));
    expect(line?.message).toBe(`Late arrivals: no penalty → 0 free, then every 3, from ${nextMonthFirst}`);
    expect(JSON.parse(line!.metadata!)).toEqual({ before: { lateAllowancePerMonth: 0, latePenaltyEvery: 0 }, after: { lateAllowancePerMonth: 0, latePenaltyEvery: 3 }, from: nextMonthFirst });
  }, 60_000);

  it('the whole-company check holds with no settings row yet: a team-scoped role may not set the numbers', async () => {
    const c = await company();
    const teamOnly = await custom(c, ['ATTENDANCE::Shifts::VIEW', 'ATTENDANCE::Shifts::EDIT', 'PEOPLE::Employees::VIEW'], true);
    expect(await runInTenant(c.orgId, () => peoplePrisma.attendanceSettings.count({ where: { orgId: c.orgId } }))).toBe(0);
    const res = await att(teamOnly, 'put', '/rules', { defaultShiftId: null, lateAllowancePerMonth: 0, latePenaltyEvery: 3, leaveApproval: 'HR', correctionApproval: 'HR' });
    expect(res.status).toBe(403);
    expect(await runInTenant(c.orgId, () => peoplePrisma.attendanceSettings.count({ where: { orgId: c.orgId } }))).toBe(0);
    /* Not touching the numbers, the same role may save the rest. */
    await att(teamOnly, 'put', '/rules', { defaultShiftId: null, lateAllowancePerMonth: 0, latePenaltyEvery: 0, leaveApproval: 'MANAGER', correctionApproval: 'HR' }).expect(200);
  }, 60_000);

  it('under People’s every-N rule they change the numbers only, versioned from next month; the cut stays and is not audited', async () => {
    const c = await company();
    await ppl(c, 'put', '/attendance-rules', { marks: { on: true, cutMode: 'HALF_DAY_PER_N', cost: 1, late: { on: true, every: 3, free: 0 } }, marksFrom: 'THIS_MONTH' }).expect(200);
    const audits = () => runInTenant(c.orgId, () => platformPrisma.auditLog.count({ where: { orgId: c.orgId, entity: 'COMPANY_SETTING', entityId: 'attendance.lateMarkCut' } }));
    const cutAudits = await audits();
    const before = await runInTenant(c.orgId, () => peoplePrisma.attendanceRuleVersion.count({ where: { orgId: c.orgId } }));
    const rules = (await att(c, 'get', '/rules').expect(200)).body.rules;
    expect(rules).toMatchObject({ lateCutMode: 'HALF_DAY_PER_N', lateCost: 1, lateNumbersHere: true, lateRuleInPeople: true });
    await att(c, 'put', '/rules', { defaultShiftId: rules.defaultShiftId, lateAllowancePerMonth: 1, latePenaltyEvery: 4, leaveApproval: 'HR', correctionApproval: 'HR' }).expect(200);
    expect((await ppl(c, 'get', '/attendance-rules').expect(200)).body.rules.marks).toMatchObject({ cutMode: 'HALF_DAY_PER_N', cost: 1, late: { every: 4, free: 1 } });
    const versions = await runInTenant(c.orgId, () => peoplePrisma.attendanceRuleVersion.findMany({ where: { orgId: c.orgId }, orderBy: { version: 'asc' } }));
    expect(versions.length).toBeGreaterThan(before);
    expect(versions.map((v) => JSON.parse(v.rulesJson)).some((x) => x.name === 'Attendance rules' && x.from)).toBe(true);
    expect(await audits()).toBe(cutAudits);
  }, 60_000);

  it('under a minute cut they are shown, not set: a change is refused and nothing moves', async () => {
    const c = await company();
    await ppl(c, 'put', '/attendance-rules', { marks: { on: true, cutMode: 'TIME_MISSED', late: { on: true, free: 2 } }, marksFrom: 'THIS_MONTH' }).expect(200);
    const rules = (await att(c, 'get', '/rules').expect(200)).body.rules;
    expect(rules).toMatchObject({ lateCutMode: 'TIME_MISSED', lateNumbersHere: false, latePenaltyEvery: 0 });
    const versions = await runInTenant(c.orgId, () => peoplePrisma.attendanceRuleVersion.count({ where: { orgId: c.orgId } }));
    const refused = await att(c, 'put', '/rules', { defaultShiftId: rules.defaultShiftId, lateAllowancePerMonth: rules.lateAllowancePerMonth, latePenaltyEvery: 3, leaveApproval: 'HR', correctionApproval: 'HR' }).expect(409);
    expect(refused.body).toMatchObject({ code: 'LATE_RULE_IN_PEOPLE' });
    expect((await ppl(c, 'get', '/attendance-rules').expect(200)).body.rules.marks).toMatchObject({ on: true, cutMode: 'TIME_MISSED', late: { on: true, free: 2 } });
    expect(await runInTenant(c.orgId, () => peoplePrisma.attendanceRuleVersion.count({ where: { orgId: c.orgId } }))).toBe(versions);
    /* The rest of the screen still saves with the numbers as they read. */
    await att(c, 'put', '/rules', { defaultShiftId: rules.defaultShiftId, lateAllowancePerMonth: rules.lateAllowancePerMonth, latePenaltyEvery: 0, leaveApproval: 'MANAGER', correctionApproval: 'HR' }).expect(200);
    expect((await ppl(c, 'get', '/attendance-rules').expect(200)).body.rules.marks).toMatchObject({ on: true, cutMode: 'TIME_MISSED' });
  }, 60_000);

  it('a company that never saved People’s rule keeps its two-number half day', async () => {
    const c = await company();
    const rules = (await att(c, 'get', '/rules').expect(200)).body.rules;
    await att(c, 'put', '/rules', { defaultShiftId: rules.defaultShiftId, lateAllowancePerMonth: 0, latePenaltyEvery: 3, leaveApproval: 'HR', correctionApproval: 'HR' }).expect(200);
    expect((await att(c, 'get', '/rules').expect(200)).body.rules.lateCutMode).toBe('HALF_DAY_PER_N');
  }, 60_000);
});

describe('migration 20261115090000_late_cut_round_down', () => {
  it('rewrites saved round-up rules and versions to round-down, as the application role, twice', async () => {
    const c = await company();
    const marks = { on: true, cutMode: 'TIME_MISSED_ROUNDED', roundToMinutes: 30, late: { on: true, every: 3, free: 0, graceMinutes: null } };
    await runInTenant(c.orgId, () => peoplePrisma.attendanceSettings.create({ data: { accountId: c.accountId!, orgId: c.orgId, timeRules: { marks } as any, updatedByUserId: 'test' } }));
    await runInTenant(c.orgId, () => peoplePrisma.attendanceRuleVersion.create({ data: { accountId: c.accountId!, orgId: c.orgId, version: 1, rulesJson: JSON.stringify({ kind: 'RULES', name: 'Attendance rules', before: { marks: { on: false, cutMode: 'TIME_MISSED' } }, after: { marks } }), changedByUserId: 'test' } }));
    const sql = readFileSync(resolve(process.cwd(), 'prisma/people/migrations/20261115090000_late_cut_round_down/migration.sql'), 'utf8');
    const statements = sql.replace(/^\s*--.*$/gm, '').split(';').map((x) => x.trim()).filter(Boolean);
    const db = new PrismaClient({ datasources: { db: { url: `${process.env.PEOPLE_DATABASE_URL}&connection_limit=1` } } });
    try {
      const [role] = await db.$queryRawUnsafe<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
      expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
      for (const x of statements) await db.$executeRawUnsafe(x);
      for (const x of statements) await db.$executeRawUnsafe(x);
    } finally {
      await db.$disconnect();
    }
    const settings = await runInTenant(c.orgId, () => peoplePrisma.attendanceSettings.findUnique({ where: { orgId: c.orgId } }));
    expect((settings!.timeRules as any).marks).toMatchObject({ cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 30, late: { every: 3 } });
    const v = await runInTenant(c.orgId, () => peoplePrisma.attendanceRuleVersion.findFirst({ where: { orgId: c.orgId } }));
    expect(JSON.parse(v!.rulesJson)).toMatchObject({ before: { marks: { cutMode: 'TIME_MISSED' } }, after: { marks: { cutMode: 'TIME_MISSED_ROUNDED_DOWN' } } });
  }, 60_000);
});
