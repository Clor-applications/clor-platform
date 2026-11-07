import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The full-day rule (attendance audit 7 Nov 2026, P0).
 *
 * Working the shift as scheduled, within the late grace and the early-out
 * grace, is a full day: present needs the shift's own net minutes (start to
 * end less the break) less both graces, or `fullDayMinutes` when that is
 * lower. Before, present needed `fullDayMinutes` (480) whatever the shift:
 * 09:06–18:00 on the default shift was a half day, and a 22:00–06:00 shift
 * with a 30-minute break could never be present.
 *
 * Also: a shift cannot be saved with a full day longer than itself, and the
 * days already written under the old rule are set to present in open months,
 * while closed months and days a final pay run took are listed, never changed.
 */
const { DEFAULT_SHIFT, computeDay, fullDayNeeded, istInstant, monthSummary, scheduledMinutes, shiftRuleProblem } = await import('../services/attendance/compute.js');
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { fixFullDays, fullDayDays } = await import('../services/attendance/fullDayFix.js');
const { dataHealth } = await import('../services/people/dataHealth.js');

/* Pure rules on fixed dates: nothing here is compared against today. 14 Oct 2026 is a Wednesday, 18 Oct a Sunday. */
const WED = '2026-10-14';
const SUN = '2026-10-18';
const day = (shift: any, inAt: string | null, outAt: string | null, opts: { date?: string; outNextDay?: boolean; isHoliday?: boolean } = {}) => {
  const date = opts.date || WED;
  return computeDay({ date, shift, checkIn: inAt ? istInstant(date, inAt) : null, checkOut: outAt ? istInstant(date, outAt, opts.outNextDay ? 1 : 0) : null, isHoliday: opts.isHoliday });
};

describe('day shift 09:00–18:00, 60 min break, 10 min grace', () => {
  it('on time is present', () => {
    expect(day(DEFAULT_SHIFT, '09:00', '18:00')).toEqual({ workedMinutes: 480, lateMinutes: 0, earlyOutMinutes: 0, overtimeMinutes: 0, status: 'PRESENT' });
  });
  it('in within the grace and out on time is present, not late (the audit case: 09:06–18:00 was a half day)', () => {
    expect(day(DEFAULT_SHIFT, '09:06', '18:00')).toMatchObject({ workedMinutes: 474, lateMinutes: 0, status: 'PRESENT' });
    expect(day(DEFAULT_SHIFT, '09:10', '18:00')).toMatchObject({ workedMinutes: 470, lateMinutes: 0, status: 'PRESENT' });
  });
  it('just past the grace is late and short of the shift: a half day, as before', () => {
    expect(day(DEFAULT_SHIFT, '09:11', '18:00')).toMatchObject({ workedMinutes: 469, lateMinutes: 11, status: 'HALF_DAY' });
  });
  it('late but making the time up is present, with its late mark', () => {
    expect(day(DEFAULT_SHIFT, '09:30', '18:30')).toMatchObject({ workedMinutes: 480, lateMinutes: 30, status: 'PRESENT' });
  });
  it('a genuine half day and an absence stay what they were', () => {
    expect(day(DEFAULT_SHIFT, '09:00', '14:00')).toMatchObject({ workedMinutes: 240, status: 'HALF_DAY' });
    expect(day(DEFAULT_SHIFT, '09:00', '13:00')).toMatchObject({ workedMinutes: 240, status: 'HALF_DAY' });
    expect(day(DEFAULT_SHIFT, '09:00', '11:00')).toMatchObject({ workedMinutes: 120, status: 'ABSENT' });
    expect(day(DEFAULT_SHIFT, null, null)).toMatchObject({ workedMinutes: 0, status: 'ABSENT' });
  });
  it('overtime still starts after the full day, not at the lower mark', () => {
    expect(day(DEFAULT_SHIFT, '09:00', '18:30').overtimeMinutes).toBe(30);
    expect(day(DEFAULT_SHIFT, '09:06', '18:00').overtimeMinutes).toBe(0);
  });
});

describe('early-out grace', () => {
  const shift = { ...DEFAULT_SHIFT, earlyOutGraceMinutes: 15 };
  it('out within the early-out grace is present with no early mark', () => {
    expect(day(shift, '09:00', '17:45')).toMatchObject({ workedMinutes: 465, earlyOutMinutes: 0, status: 'PRESENT' });
  });
  it('both graces used at once is still the shift worked as scheduled', () => {
    expect(fullDayNeeded(shift)).toBe(455);
    expect(day(shift, '09:10', '17:45')).toMatchObject({ workedMinutes: 455, lateMinutes: 0, earlyOutMinutes: 0, status: 'PRESENT' });
  });
  it('past both graces is a half day', () => {
    expect(day(shift, '09:10', '17:44')).toMatchObject({ workedMinutes: 454, earlyOutMinutes: 16, status: 'HALF_DAY' });
  });
});

describe('night shift 22:00–06:00 across midnight', () => {
  /* As the form made it before the fix: a 30-minute break and the 480 default, which no night could reach. */
  const legacy = { ...DEFAULT_SHIFT, startTime: '22:00', endTime: '06:00', breakMinutes: 30, fullDayMinutes: 480 };
  it('is present when worked as scheduled, even on a shift saved with a full day longer than itself', () => {
    expect(scheduledMinutes(legacy)).toBe(450);
    expect(fullDayNeeded(legacy)).toBe(440);
    expect(day(legacy, '21:55', '06:05', { outNextDay: true })).toMatchObject({ workedMinutes: 460, lateMinutes: 0, status: 'PRESENT' });
    expect(day(legacy, '22:10', '06:00', { outNextDay: true })).toMatchObject({ workedMinutes: 440, lateMinutes: 0, status: 'PRESENT' });
  });
  it('is a half day past the grace and short', () => {
    expect(day(legacy, '22:11', '06:00', { outNextDay: true })).toMatchObject({ workedMinutes: 439, lateMinutes: 11, status: 'HALF_DAY' });
  });
});

describe('a custom shift', () => {
  /* A flexible day: 6 hours anywhere in 08:00–20:00. The lower full day holds. */
  const flexi = { ...DEFAULT_SHIFT, startTime: '08:00', endTime: '20:00', fullDayMinutes: 360, graceMinutes: 0 };
  it('keeps its own lower full day', () => {
    expect(fullDayNeeded(flexi)).toBe(360);
    expect(day(flexi, '10:00', '17:00')).toMatchObject({ workedMinutes: 360, status: 'PRESENT' });
    expect(day(flexi, '10:00', '16:30')).toMatchObject({ workedMinutes: 330, status: 'HALF_DAY' });
  });
  it('a 4-hour shift with no break is present at its length less grace', () => {
    const short = { ...DEFAULT_SHIFT, startTime: '14:00', endTime: '18:00', breakMinutes: 0, halfDayMinutes: 120, fullDayMinutes: 240 };
    expect(day(short, '14:05', '18:00')).toMatchObject({ workedMinutes: 235, status: 'PRESENT' });
    expect(day(short, '14:00', '16:00')).toMatchObject({ workedMinutes: 120, status: 'HALF_DAY' });
  });
});

describe('a rest day', () => {
  it('a weekly off worked is paid and all overtime; a short one stays a weekly off', () => {
    expect(day(DEFAULT_SHIFT, '09:06', '18:00', { date: SUN })).toMatchObject({ status: 'PRESENT', lateMinutes: 0, overtimeMinutes: 474 });
    expect(day(DEFAULT_SHIFT, '09:00', '12:00', { date: SUN })).toMatchObject({ status: 'WEEKLY_OFF', overtimeMinutes: 180 });
  });
  it('a holiday with no punches is a holiday', () => {
    expect(day(DEFAULT_SHIFT, null, null, { isHoliday: true }).status).toBe('HOLIDAY');
  });
});

describe('a month at its last day', () => {
  /* The month's own dates, with today its last day: every on-time day is paid in full. */
  it('pays every day worked within the grace in full', () => {
    const days = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
    const records = new Map<string, any>();
    for (const d of days) {
      if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) continue;
      const r = day(DEFAULT_SHIFT, '09:08', '18:00', { date: d });
      records.set(d, { ...r, overtimeApproved: false, checkIn: istInstant(d, '09:08'), checkOut: istInstant(d, '18:00') });
    }
    const s = monthSummary({ days, records, shift: () => DEFAULT_SHIFT, holidays: new Set(), today: '2026-11-30' });
    expect(s).toMatchObject({ halfDays: 0, absent: 0, lossOfPayDays: 0, payableDays: 30, lateCount: 0 });
  });
});

describe('a shift that does not hold together', () => {
  it('says a full day longer than the shift, and accepts one within it', () => {
    expect(shiftRuleProblem({ startTime: '22:00', endTime: '06:00', breakMinutes: 30, halfDayMinutes: 240, fullDayMinutes: 480 })).toMatch(/22:00–06:00 less the 30 min break is 7 h 30 min\. Set the full day to 450 minutes or less/);
    expect(shiftRuleProblem({ startTime: '22:00', endTime: '06:00', breakMinutes: 30, halfDayMinutes: 240, fullDayMinutes: 450 })).toBeNull();
    expect(shiftRuleProblem({ ...DEFAULT_SHIFT })).toBeNull();
    expect(shiftRuleProblem({ ...DEFAULT_SHIFT, halfDayMinutes: 500 })).toMatch(/half day cannot be longer/);
  });
});

// ---------------------------------------------------------------------------
// Through the API and the database
// ---------------------------------------------------------------------------

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
async function company(): Promise<Ctx> {
  const email = `fd.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `FD Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: setup.body.company.accountId || '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  if (!c.accountId) {
    const shift = (await att(c, 'post', '/shifts', { name: `Probe ${rnd()}`, startTime: '09:00', endTime: '18:00' }).expect(201)).body.shift;
    c.accountId = shift.accountId;
  }
  return c;
}
const person = async (c: Ctx, code: string) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: `Person ${code}`, code, dateOfJoining: '2025-01-01' }).expect(201)).body.employee;

/* Months before this one, worked out from today in India; a Wednesday in each, so a working day on the default shift (Sunday off). */
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const monthBack = (n: number) => {
  const [y, m] = istToday().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 7);
};
const wednesdayOf = (month: string, nth = 2) => {
  const first = new Date(`${month}-01T00:00:00Z`);
  const offset = (3 - first.getUTCDay() + 7) % 7;
  return `${month}-${String(1 + offset + (nth - 1) * 7).padStart(2, '0')}`;
};

/* A day as the old rule left it: written through the API (which now scores it present), then set back to what it said before the fix. */
async function legacyDay(c: Ctx, employeeId: string, date: string, inAt: string, outAt: string, status = 'HALF_DAY') {
  const r = (await att(c, 'put', '/records', { employeeId, date, checkIn: inAt, checkOut: outAt }).expect(200)).body.record;
  await runInTenant(c.orgId, () => peoplePrisma.attendanceRecord.update({ where: { id: r.id }, data: { status } }));
  return r;
}
const statusOf = (c: Ctx, id: string) => runInTenant(c.orgId, async () => (await peoplePrisma.attendanceRecord.findUnique({ where: { id } }))!.status);

describe('saving a shift', () => {
  it('refuses a full day longer than the shift, and fills a left-out full day from the shift itself', async () => {
    const c = await company();
    const refused = await att(c, 'post', '/shifts', { name: `Night ${rnd()}`, startTime: '22:00', endTime: '06:00', breakMinutes: 30, fullDayMinutes: 480 }).expect(400);
    expect(refused.body).toMatchObject({ code: 'SHIFT_RULES' });
    expect(refused.body.error).toMatch(/less the 30 min break is 7 h 30 min/);
    const made = (await att(c, 'post', '/shifts', { name: `Night ${rnd()}`, startTime: '22:00', endTime: '06:00', breakMinutes: 30 }).expect(201)).body.shift;
    expect(made.fullDayMinutes).toBe(450);
    const day = (await att(c, 'post', '/shifts', { name: `Day ${rnd()}`, startTime: '09:00', endTime: '18:00' }).expect(201)).body.shift;
    expect(day.fullDayMinutes).toBe(480);
  });

  it('lets a shift saved before the check be renamed, but not re-timed while its full day is too long', async () => {
    const c = await company();
    const s = (await att(c, 'post', '/shifts', { name: `Night ${rnd()}`, startTime: '22:00', endTime: '06:00', breakMinutes: 30 }).expect(201)).body.shift;
    await runInTenant(c.orgId, () => peoplePrisma.shift.update({ where: { id: s.id }, data: { fullDayMinutes: 480 } }));
    const body = { ...s, fullDayMinutes: 480, overtimeAfterMinutes: null, checkInBeforeMinutes: null, checkOutAfterMinutes: null, code: null, color: null };
    for (const k of ['id', 'accountId', 'orgId', 'createdAt', 'updatedAt', 'createdByUserId', 'assignments']) delete (body as any)[k];
    await att(c, 'put', `/shifts/${s.id}`, { ...body, name: `Nights ${rnd()}` }).expect(200);
    const refused = await att(c, 'put', `/shifts/${s.id}`, { ...body, breakMinutes: 45 }).expect(400);
    expect(refused.body.code).toBe('SHIFT_RULES');
    await att(c, 'put', `/shifts/${s.id}`, { ...body, breakMinutes: 45, fullDayMinutes: 435 }).expect(200);
  });
});

describe('days written under the old rule', () => {
  it('are set to present in an open month; closed months and paid runs are listed and left; again changes nothing', async () => {
    const c = await company();
    const asha = await person(c, 'FD1');
    const ravi = await person(c, 'FD2');
    const open = wednesdayOf(monthBack(1));
    const closedDay = wednesdayOf(monthBack(3));
    const paidDay = wednesdayOf(monthBack(2));

    const onTime = await legacyDay(c, asha.id, open, '09:06', '18:00');
    const tooLate = await legacyDay(c, asha.id, wednesdayOf(monthBack(1), 3), '09:11', '18:00');
    const shortDay = await legacyDay(c, asha.id, wednesdayOf(monthBack(1), 1), '09:00', '14:00');
    const inClosed = await legacyDay(c, ravi.id, closedDay, '09:05', '18:00');
    const inPaid = await legacyDay(c, ravi.id, paidDay, '09:04', '18:00');

    await runInTenant(c.orgId, async () => {
      await peoplePrisma.attendanceMonthLock.create({ data: { accountId: c.accountId, orgId: c.orgId, month: closedDay.slice(0, 7), lockedByUserId: 'test' } });
      const m = paidDay.slice(0, 7);
      const period = await payrollPrisma.payrollPeriod.create({ data: { accountId: c.accountId, orgId: c.orgId, name: m, startDate: `${m}-01`, endDate: `${m}-28`, createdByUserId: 'test' } as any });
      const run = await payrollPrisma.payrollRun.create({ data: { accountId: c.accountId, orgId: c.orgId, number: `PR-${rnd()}`, periodId: period.id, payrollDate: `${m}-28`, status: 'PAID', createdByUserId: 'test' } as any });
      await payrollPrisma.payrollRunEmployee.create({ data: { accountId: c.accountId, orgId: c.orgId, runId: run.id, employeeId: ravi.id } as any });
    });

    /* Another company's old day is not this company's to touch. */
    const other = await company();
    const stranger = await person(other, 'FD9');
    const theirs = await legacyDay(other, stranger.id, open, '09:06', '18:00');

    const seen = await runInTenant(c.orgId, () => fullDayDays({ accountId: c.accountId, orgId: c.orgId }));
    expect(seen.map((r) => [r.date, r.held]).sort()).toEqual([[closedDay, 'MONTH_CLOSED'], [open, null], [paidDay, 'PAYROLL_TAKEN']].sort());

    const first = await fixFullDays({ accountId: c.accountId, orgId: c.orgId });
    expect(first.fixed.map((r) => r.recordId)).toEqual([onTime.id]);
    expect(first.held.map((r) => [r.recordId, r.held, r.from, r.to]).sort()).toEqual([[inClosed.id, 'MONTH_CLOSED', 'HALF_DAY', 'PRESENT'], [inPaid.id, 'PAYROLL_TAKEN', 'HALF_DAY', 'PRESENT']].sort());

    expect(await statusOf(c, onTime.id)).toBe('PRESENT');
    expect(await statusOf(c, tooLate.id)).toBe('HALF_DAY');
    expect(await statusOf(c, shortDay.id)).toBe('HALF_DAY');
    expect(await statusOf(c, inClosed.id)).toBe('HALF_DAY');
    expect(await statusOf(c, inPaid.id)).toBe('HALF_DAY');
    expect(await statusOf(other, theirs.id)).toBe('HALF_DAY');

    const history = await runInTenant(c.orgId, () => peoplePrisma.attendanceRecordHistory.findMany({ where: { orgId: c.orgId, recordId: onTime.id, action: 'BULK' } }));
    expect(history).toHaveLength(1);
    expect(history[0].reason).toMatch(/full-day rule/i);

    const again = await fixFullDays({ accountId: c.accountId, orgId: c.orgId });
    expect(again.fixed).toEqual([]);
    expect(again.held).toHaveLength(2);

    /* The owner sees what was left, person by person, on Data health. */
    const health = await runInTenant(c.orgId, () => dataHealth(c.accountId, c.orgId, { payroll: false }));
    const check = health.checks.find((x: any) => x.id === 'full-day-held');
    expect(check).toMatchObject({ area: 'Attendance', count: 1 });
    expect(check!.people[0]).toMatchObject({ id: ravi.id });
    expect(check!.people[0].detail).toMatch(/half day → present; .*half day → present/);
    const otherHealth = await runInTenant(other.orgId, () => dataHealth(other.accountId, other.orgId, { payroll: false }));
    expect(otherHealth.checks.find((x: any) => x.id === 'full-day-held')).toBeUndefined();
  });

  it('a dry run changes nothing', async () => {
    const c = await company();
    const p = await person(c, 'FD3');
    const r = await legacyDay(c, p.id, wednesdayOf(monthBack(1)), '09:06', '18:00');
    const dry = await fixFullDays({ accountId: c.accountId, orgId: c.orgId }, { apply: false });
    expect(dry).toMatchObject({ fixed: [], held: [], open: 1 });
    expect(await statusOf(c, r.id)).toBe('HALF_DAY');
  });
});
