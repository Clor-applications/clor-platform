import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Overtime by kind of day, and caps (platform audit 11 Nov 2026, "Partial"):
 * - a rate for a working day, a weekly off and a holiday, 2 for each until set;
 * - caps on overtime in a day, a week and a quarter, off until set;
 * - hours over a cap are kept, named "over the cap" where overtime is
 *   approved, and count once approved;
 * - Payroll's figure (approvedOvertimeMinutes) is unchanged, with the same
 *   hours at their rates beside it.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { DEFAULT_OVERTIME_POLICY, SUGGESTED_OVERTIME_CAPS, capOvertime, overCapWords, overtimeCapFrom, overtimeDayType, overtimePolicyOf, overtimeQuarterStart, overtimeWeekStart, weightedOvertime } = await import('../services/attendance/overtimePolicy.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

describe('the overtime policy, on its own', () => {
  it('reads nothing as twice the ordinary rate on every kind of day, and no caps', () => {
    expect(overtimePolicyOf({})).toEqual(DEFAULT_OVERTIME_POLICY);
    expect(overtimePolicyOf(null)).toEqual({ rates: { working: 2, weeklyOff: 2, holiday: 2 }, caps: { dayMinutes: null, weekMinutes: null, quarterMinutes: null } });
  });

  it('keeps what a company set and falls back on anything that is not a rate or a cap', () => {
    const p = overtimePolicyOf({ rates: { working: 1.5, weeklyOff: '2.5', holiday: 0 }, caps: { dayMinutes: 120, weekMinutes: -5, quarterMinutes: '3000' } });
    expect(p.rates).toEqual({ working: 1.5, weeklyOff: 2.5, holiday: 2 });
    expect(p.caps).toEqual({ dayMinutes: 120, weekMinutes: null, quarterMinutes: 3000 });
  });

  it('suggests the Factories Act figures: 2 hours a day, 12 a week, 50 a quarter', () => {
    expect(SUGGESTED_OVERTIME_CAPS).toEqual({ dayMinutes: 120, weekMinutes: 720, quarterMinutes: 3000 });
  });

  it('prices minutes by the kind of day; a holiday on a weekly off is a holiday', () => {
    const p = overtimePolicyOf({ rates: { working: 2, weeklyOff: 2.5, holiday: 3 } });
    expect(overtimeDayType(true, true)).toBe('holiday');
    expect(overtimeDayType(false, true)).toBe('weeklyOff');
    expect(overtimeDayType(false, false)).toBe('working');
    expect(weightedOvertime(120, 'working', p)).toBe(240);
    expect(weightedOvertime(120, 'weeklyOff', p)).toBe(300);
    expect(weightedOvertime(90, 'holiday', p)).toBe(270);
  });

  it('starts a week on Sunday and a quarter on 1 January, April, July and October', () => {
    expect(overtimeWeekStart('2026-10-07')).toBe('2026-10-04'); // a Wednesday
    expect(overtimeWeekStart('2026-10-04')).toBe('2026-10-04'); // a Sunday
    expect(overtimeQuarterStart('2026-11-12')).toBe('2026-10-01');
    expect(overtimeQuarterStart('2026-03-31')).toBe('2026-01-01');
    /* 1 October 2026 is a Thursday: its week began in September, in the quarter before. */
    expect(overtimeCapFrom('2026-10-01')).toBe('2026-09-27');
    expect(overtimeCapFrom('2026-10-20')).toBe('2026-10-01');
  });

  it('splits a day at the cap for a day and drops nothing', () => {
    const p = overtimePolicyOf({ caps: { dayMinutes: 120 } });
    const c = capOvertime([{ date: '2026-10-05', minutes: 180 }, { date: '2026-10-06', minutes: 60 }], p);
    expect(c.get('2026-10-05')).toEqual({ minutes: 180, withinCap: 120, overCap: 60, by: 'DAY' });
    expect(c.get('2026-10-06')).toEqual({ minutes: 60, withinCap: 60, overCap: 0, by: null });
    expect(overCapWords(c.get('2026-10-05'), p)).toBe('1 h over the cap of 2 h a day');
    expect(overCapWords(c.get('2026-10-06'), p)).toBeNull();
  });

  it('counts the week and the quarter from what was already worked, approved or not', () => {
    const p = overtimePolicyOf({ caps: { weekMinutes: 300, quarterMinutes: 600 } });
    const c = capOvertime(
      [
        { date: '2026-10-05', minutes: 200 }, // Monday
        { date: '2026-10-06', minutes: 200 }, // the week has 100 left
        { date: '2026-10-12', minutes: 150 }, // a new week; the quarter has 200 left
        { date: '2026-10-13', minutes: 150 }, // the quarter has 50 left
        { date: '2027-01-04', minutes: 150 }, // a new quarter
      ],
      p,
    );
    expect(c.get('2026-10-06')).toMatchObject({ withinCap: 100, overCap: 100, by: 'WEEK' });
    expect(c.get('2026-10-12')).toMatchObject({ withinCap: 150, overCap: 0, by: null });
    expect(c.get('2026-10-13')).toMatchObject({ withinCap: 50, overCap: 100, by: 'QUARTER' });
    expect(c.get('2027-01-04')).toMatchObject({ withinCap: 150, overCap: 0 });
    expect(overCapWords(c.get('2026-10-13'), p)).toBe('1 h 40 min over the cap of 10 h a quarter');
  });
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `ot.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `OT Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const ppl = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);

/* Last month, so every day has happened: its first Monday, and the days after it. */
const month = (() => {
  const d = new Date(Date.now() + 330 * 60_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
})();
const monday = (() => {
  const d = new Date(`${month}-01T00:00:00Z`);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d;
})();
const day = (n: number) => new Date(monday.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const [MON, TUE, WED, SUN] = [day(0), day(1), day(2), day(6)];

describe('overtime rates and caps on a company’s days', () => {
  let hr: Ctx;
  let asha: any;
  const mark = (date: string, checkIn: string, checkOut: string) => att(hr, 'put', '/records', { employeeId: asha.id, date, checkIn, checkOut }).expect(200);
  const summary = async () => (await att(hr, 'get', `/summary?month=${month}`).expect(200)).body.rows.find((r: any) => r.employeeId === asha.id);
  const recordOn = (date: string) => runInTenant(hr.orgId, () => peoplePrisma.attendanceRecord.findFirstOrThrow({ where: { orgId: hr.orgId, employeeId: asha.id, date } }));
  const approve = async (date: string) => att(hr, 'post', `/records/${(await recordOn(date)).id}/overtime`, { approved: true }).expect(200);
  const rules = async () => (await att(hr, 'get', '/overtime/rules').expect(200)).body;

  beforeAll(async () => {
    hr = await company();
    asha = (await ppl(hr, 'post', '/employees', { name: 'Asha', code: 'A1', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    await att(hr, 'post', '/holidays', { date: WED, name: 'Founders day' }).expect(201);
    /* The standard day: 09:00–18:00, an hour's break, 8 hours a full day, Sunday off. */
    await mark(MON, '09:00', '21:00'); // 11 h worked: 3 h over
    await mark(TUE, '09:00', '20:00'); // 10 h worked: 2 h over
    await mark(WED, '09:00', '13:00'); // a holiday: all 4 h
    await mark(SUN, '09:00', '12:00'); // a weekly off: all 3 h
    await approve(MON);
    await approve(WED);
  });

  it('records the overtime as before: the caps and rates never change a day', async () => {
    expect((await recordOn(MON)).overtimeMinutes).toBe(180);
    expect((await recordOn(TUE)).overtimeMinutes).toBe(120);
    expect((await recordOn(WED)).overtimeMinutes).toBe(240);
    expect((await recordOn(SUN)).overtimeMinutes).toBe(180);
  });

  it('a company that set nothing has twice the rate everywhere and no cap', async () => {
    const r = await rules();
    expect(r.rules.rates).toEqual({ working: 2, weeklyOff: 2, holiday: 2 });
    expect(r.rules.caps).toEqual({ dayMinutes: null, weekMinutes: null, quarterMinutes: null });
    expect(r.suggestedCaps).toEqual({ dayMinutes: 120, weekMinutes: 720, quarterMinutes: 3000 });
    const s = await summary();
    /* What Payroll reads is the approved minutes, as it always was. */
    expect(s.approvedOvertimeMinutes).toBe(420);
    expect(s.weightedOvertimeMinutes).toBe(840);
    expect(s.overCapOvertimeMinutes).toBe(0);
    expect(s.approvedOverCapMinutes).toBe(0);
  });

  it('refuses a rate under 1, and a cap for a day longer than the week’s', async () => {
    const r = (await rules()).rules;
    await att(hr, 'put', '/overtime/rules', { ...r, rates: { working: 0.5, weeklyOff: 2, holiday: 2 } }).expect(400);
    const res = await att(hr, 'put', '/overtime/rules', { ...r, caps: { dayMinutes: 600, weekMinutes: 300, quarterMinutes: null } }).expect(400);
    expect(res.body.error).toMatch(/cap for a day cannot be more than the cap for a week/);
  });

  it('saves rates and caps, keeps them through a save from a screen that does not know them, and records the change', async () => {
    const r = (await rules()).rules;
    const saved = await att(hr, 'put', '/overtime/rules', { ...r, rates: { working: 2, weeklyOff: 2.5, holiday: 3 }, caps: { dayMinutes: 120, weekMinutes: 300, quarterMinutes: null } }).expect(200);
    expect(saved.body.rules.rates).toEqual({ working: 2, weeklyOff: 2.5, holiday: 3 });
    expect(saved.body.rules.caps).toEqual({ dayMinutes: 120, weekMinutes: 300, quarterMinutes: null });
    const { rates: _r, caps: _c, ...older } = saved.body.rules;
    const again = await att(hr, 'put', '/overtime/rules', older).expect(200);
    expect(again.body.rules.rates).toEqual({ working: 2, weeklyOff: 2.5, holiday: 3 });
    expect(again.body.rules.caps.dayMinutes).toBe(120);
    const versions = await runInTenant(hr.orgId, () => peoplePrisma.attendanceRuleVersion.findMany({ where: { orgId: hr.orgId } }));
    expect(versions.filter((v) => JSON.parse(v.rulesJson).name === 'Overtime rates and caps')).toHaveLength(1);
  });

  it('carries each day’s rate and the hours over the cap into the month’s figures, beside what Payroll reads', async () => {
    const s = await summary();
    expect(s.approvedOvertimeMinutes).toBe(420); // Monday 180 + the holiday 240: unchanged
    expect(s.weightedOvertimeMinutes).toBe(180 * 2 + 240 * 3);
    expect(s.overtimeByDayType).toEqual({
      working: { minutes: 180, weightedMinutes: 360, rate: 2 },
      weeklyOff: { minutes: 0, weightedMinutes: 0, rate: 2.5 },
      holiday: { minutes: 240, weightedMinutes: 720, rate: 3 },
    });
    /* Monday 60 over the day; Tuesday inside; Wednesday all 240 over the week (300 used by then); Sunday, a new week, 60 over the day. */
    expect(s.overCapOvertimeMinutes).toBe(60 + 240 + 60);
    expect(s.approvedOverCapMinutes).toBe(60 + 240);
  });

  it('names the hours over the cap on a request waiting for a decision, and approving it counts every hour', async () => {
    const make = (date: string, minutes: number) => runInTenant(hr.orgId, () => peoplePrisma.overtimeRequest.create({ data: { accountId: asha.accountId, orgId: hr.orgId, employeeId: asha.id, date, kind: 'OVERTIME', minutes, reason: 'Stock count' } }));
    const tue = await make(TUE, 120);
    const sun = await make(SUN, 180);
    const list = (await att(hr, 'get', '/overtime/requests?status=PENDING').expect(200)).body.requests;
    const t = list.find((r: any) => r.id === tue.id);
    const u = list.find((r: any) => r.id === sun.id);
    expect(t).toMatchObject({ dayType: 'working', rate: 2, weightedMinutes: 240, overCapMinutes: 0, overCap: null });
    expect(u).toMatchObject({ dayType: 'weeklyOff', rate: 2.5, weightedMinutes: 450, overCapMinutes: 60, overCap: '1 h over the cap of 2 h a day' });
    await att(hr, 'post', `/overtime/requests/${sun.id}/approve`, {}).expect(200);
    expect((await recordOn(SUN)).overtimeApproved).toBe(true);
    const s = await summary();
    expect(s.approvedOvertimeMinutes).toBe(420 + 180); // all 3 hours, the hour over the cap included
    expect(s.overtimeByDayType.weeklyOff).toEqual({ minutes: 180, weightedMinutes: 450, rate: 2.5 });
  });

  it('says so on the days list, the month’s checklist and the overtime register', async () => {
    const records = (await att(hr, 'get', `/records?from=${MON}&to=${SUN}&employeeId=${asha.id}`).expect(200)).body.records;
    expect(records.find((r: any) => r.date === MON)).toMatchObject({ overCapMinutes: 60, overCap: '1 h over the cap of 2 h a day' });
    expect(records.find((r: any) => r.date === WED)).toMatchObject({ overCapMinutes: 240, overCap: '4 h over the cap of 5 h a week' });
    expect(records.find((r: any) => r.date === TUE).overCap).toBeUndefined();

    const ready = (await att(hr, 'get', `/months/${month}/readiness`).expect(200)).body;
    const check = ready.checks.find((c: any) => c.key === 'overtime');
    expect(check.count).toBe(1); // Tuesday: recorded, not approved, inside the caps
    expect(check.hint).toBe('Unapproved overtime is not paid.');

    const report = (await att(hr, 'get', `/reports/overtime?from=${MON}&to=${SUN}`).expect(200)).body;
    expect(report.columns.map((c: any) => c.key)).toEqual(expect.arrayContaining(['dayType', 'rate', 'atRate', 'overCap']));
    const wed = report.rows.find((r: any) => r.date === WED);
    expect(wed).toMatchObject({ dayType: 'Holiday', rate: '3×', atRate: '12:00', overCap: '4:00' });
    expect(report.totals.overCap).toBe('6:00');
  });
});
