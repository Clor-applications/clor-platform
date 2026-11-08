import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The full-day rule (attendance audit 7 Nov 2026, P0; review of PR #141).
 *
 * A working day is PRESENT when either
 *   (a) the shift was worked as scheduled: in by the start plus the late
 *       grace, out from the end less the early-out grace (night shifts
 *       across midnight), or
 *   (b) the minutes worked reach `fullDayMinutes`.
 * The graces do not add up to anything more; an early-out grace of 0 means
 * leaving early is not covered by (a); a day under the half-day minutes is
 * never present; a rest day is paid as worked only by (b). Late and early
 * marks, overtime and comp-off are as before.
 *
 * Days written under the old rule (present only by (b)) are corrected only
 * after the latest final pay run's period (or, with none, this month and
 * last); everything older, or under a pay run, or in a closed month, is held
 * and listed on Data health, as are the corrected days.
 */
const { DEFAULT_SHIFT, computeDay, fullDayBy, istInstant, monthSummary, scheduledMinutes, shiftRuleProblem, workedAsScheduled } = await import('../services/attendance/compute.js');
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { fixFullDays, fullDayFixTesting } = await import('../services/attendance/fullDayFix.js');
const { dataHealth } = await import('../services/people/dataHealth.js');

/* Pure rules on fixed dates: nothing here is compared against today. 14 Oct 2026 is a Wednesday, 18 Oct a Sunday. */
const WED = '2026-10-14';
const SUN = '2026-10-18';
const day = (shift: any, inAt: string | null, outAt: string | null, opts: { date?: string; outNextDay?: boolean; isHoliday?: boolean } = {}) => {
  const date = opts.date || WED;
  return computeDay({ date, shift, checkIn: inAt ? istInstant(date, inAt) : null, checkOut: outAt ? istInstant(date, outAt, opts.outNextDay ? 1 : 0) : null, isHoliday: opts.isHoliday });
};

describe('day shift 09:00–18:00, 60 min break, 10 min grace, no early-out grace', () => {
  it('on time is present', () => {
    expect(day(DEFAULT_SHIFT, '09:00', '18:00')).toEqual({ workedMinutes: 480, lateMinutes: 0, earlyOutMinutes: 0, overtimeMinutes: 0, status: 'PRESENT' });
  });
  it('in within the grace and out on time is present, not late (the audit case: 09:06–18:00 was a half day)', () => {
    expect(day(DEFAULT_SHIFT, '09:06', '18:00')).toMatchObject({ workedMinutes: 474, lateMinutes: 0, status: 'PRESENT' });
    expect(day(DEFAULT_SHIFT, '09:10', '18:00')).toMatchObject({ workedMinutes: 470, lateMinutes: 0, status: 'PRESENT' });
    expect(fullDayBy(DEFAULT_SHIFT, WED, istInstant(WED, '09:10'), istInstant(WED, '18:00'), 470)).toBe('SCHEDULE');
  });
  it('just past the grace is late and short of the full day: a half day, as before', () => {
    expect(day(DEFAULT_SHIFT, '09:11', '18:00')).toMatchObject({ workedMinutes: 469, lateMinutes: 11, status: 'HALF_DAY' });
  });
  it('with no early-out grace, leaving a minute early is not the shift worked as scheduled', () => {
    expect(day(DEFAULT_SHIFT, '09:00', '17:59')).toMatchObject({ workedMinutes: 479, earlyOutMinutes: 1, status: 'HALF_DAY' });
    expect(workedAsScheduled(DEFAULT_SHIFT, WED, istInstant(WED, '09:00'), istInstant(WED, '17:59'))).toBe(false);
  });
  it('late but making the time up is present by the minutes, with its late mark', () => {
    expect(day(DEFAULT_SHIFT, '09:30', '18:30')).toMatchObject({ workedMinutes: 480, lateMinutes: 30, status: 'PRESENT' });
    expect(fullDayBy(DEFAULT_SHIFT, WED, istInstant(WED, '09:30'), istInstant(WED, '18:30'), 480)).toBe('MINUTES');
  });
  it('a genuine half day and an absence stay what they were', () => {
    expect(day(DEFAULT_SHIFT, '09:00', '14:00')).toMatchObject({ workedMinutes: 240, status: 'HALF_DAY' });
    expect(day(DEFAULT_SHIFT, '09:00', '13:00')).toMatchObject({ workedMinutes: 240, status: 'HALF_DAY' });
    expect(day(DEFAULT_SHIFT, '09:00', '11:00')).toMatchObject({ workedMinutes: 120, status: 'ABSENT' });
    expect(day(DEFAULT_SHIFT, null, null)).toMatchObject({ workedMinutes: 0, status: 'ABSENT' });
  });
  it('overtime still starts after the full day', () => {
    expect(day(DEFAULT_SHIFT, '09:00', '18:30').overtimeMinutes).toBe(30);
    expect(day(DEFAULT_SHIFT, '09:06', '18:00').overtimeMinutes).toBe(0);
  });
});

describe('early-out grace 15', () => {
  const shift = { ...DEFAULT_SHIFT, earlyOutGraceMinutes: 15 };
  it('out within the early-out grace is present with no early mark', () => {
    expect(day(shift, '09:00', '17:45')).toMatchObject({ workedMinutes: 465, earlyOutMinutes: 0, status: 'PRESENT' });
  });
  it('both graces at once is still the shift as scheduled; neither stretches the other', () => {
    expect(day(shift, '09:10', '17:45')).toMatchObject({ workedMinutes: 455, lateMinutes: 0, earlyOutMinutes: 0, status: 'PRESENT' });
    /* In early does not buy leaving later than the early-out grace: 08:30–17:44 is 494 minutes, a full day by the minutes only. */
    expect(workedAsScheduled(shift, WED, istInstant(WED, '08:30'), istInstant(WED, '17:44'))).toBe(false);
  });
  it('past both graces is a half day', () => {
    expect(day(shift, '09:10', '17:44')).toMatchObject({ workedMinutes: 454, earlyOutMinutes: 16, status: 'HALF_DAY' });
    expect(day(shift, '09:11', '17:45')).toMatchObject({ workedMinutes: 454, lateMinutes: 11, status: 'HALF_DAY' });
  });
});

describe('night shift 22:00–06:00 across midnight', () => {
  /* As the form made it before the fix: a 30-minute break and the 480 default, which no night could reach by the minutes. */
  const legacy = { ...DEFAULT_SHIFT, startTime: '22:00', endTime: '06:00', breakMinutes: 30, fullDayMinutes: 480 };
  it('is present when worked as scheduled, even on a shift saved with a full day longer than itself', () => {
    expect(scheduledMinutes(legacy)).toBe(450);
    expect(day(legacy, '21:55', '06:05', { outNextDay: true })).toMatchObject({ workedMinutes: 460, lateMinutes: 0, status: 'PRESENT' });
    expect(day(legacy, '22:10', '06:00', { outNextDay: true })).toMatchObject({ workedMinutes: 440, lateMinutes: 0, status: 'PRESENT' });
  });
  it('is a half day past the grace, or out before the end', () => {
    expect(day(legacy, '22:11', '06:00', { outNextDay: true })).toMatchObject({ workedMinutes: 439, lateMinutes: 11, status: 'HALF_DAY' });
    expect(day(legacy, '22:00', '05:59', { outNextDay: true })).toMatchObject({ status: 'HALF_DAY' });
  });
});

describe('a custom shift', () => {
  it('a flexible day keeps its own lower full day by the minutes', () => {
    const flexi = { ...DEFAULT_SHIFT, startTime: '08:00', endTime: '20:00', fullDayMinutes: 360, graceMinutes: 0 };
    expect(day(flexi, '10:00', '17:00')).toMatchObject({ workedMinutes: 360, status: 'PRESENT' });
    expect(day(flexi, '10:00', '16:30')).toMatchObject({ workedMinutes: 330, status: 'HALF_DAY' });
  });
  it('a 4-hour shift with no break is present worked as scheduled', () => {
    const short = { ...DEFAULT_SHIFT, startTime: '14:00', endTime: '18:00', breakMinutes: 0, halfDayMinutes: 120, fullDayMinutes: 240 };
    expect(day(short, '14:05', '18:00')).toMatchObject({ workedMinutes: 235, status: 'PRESENT' });
    expect(day(short, '14:00', '16:00')).toMatchObject({ workedMinutes: 120, status: 'HALF_DAY' });
  });
  it('a shift shorter than its half day is never present for working it: clamped to the half-day minutes', () => {
    const tiny = { ...DEFAULT_SHIFT, startTime: '09:00', endTime: '10:00', breakMinutes: 0, halfDayMinutes: 240, fullDayMinutes: 480 };
    expect(day(tiny, '09:00', '10:00')).toMatchObject({ workedMinutes: 60, status: 'ABSENT' });
  });
});

describe('a rest day', () => {
  it('is paid as worked only by the minutes, not by the shift as scheduled', () => {
    expect(day(DEFAULT_SHIFT, '09:00', '18:00', { date: SUN })).toMatchObject({ status: 'PRESENT', overtimeMinutes: 480 });
    expect(day(DEFAULT_SHIFT, '09:06', '18:00', { date: SUN })).toMatchObject({ status: 'WEEKLY_OFF', lateMinutes: 0, overtimeMinutes: 474 });
    expect(day(DEFAULT_SHIFT, '09:00', '12:00', { date: SUN })).toMatchObject({ status: 'WEEKLY_OFF', overtimeMinutes: 180 });
  });
  it('a holiday with no punches is a holiday', () => {
    expect(day(DEFAULT_SHIFT, null, null, { isHoliday: true }).status).toBe('HOLIDAY');
  });
});

describe('a month at its last day', () => {
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

/*
 * The release is the row the migration wrote at deploy (globalSetup runs it). Every day these tests write stands for one
 * written before the release, so for this file it is far in the future; a test that needs it in the past sets it, and
 * the file puts back what was there.
 */
const FAR = new Date('2999-01-01T00:00:00Z');
let releaseWas: Date | null = null;
const setRelease = (at: Date) => peoplePrisma.attendanceFullDayFixMeta.upsert({ where: { id: 'release' }, create: { id: 'release', releasedAt: at }, update: { releasedAt: at } });
/* The database clock, which stamps history (TEST_TODAY moves only the app's); a short wait either side keeps two stamps apart. */
const dbNow = async () => {
  await new Promise((done) => setTimeout(done, 25));
  const [{ now }] = await peoplePrisma.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
  await new Promise((done) => setTimeout(done, 25));
  return now;
};
beforeAll(async () => {
  releaseWas = (await peoplePrisma.attendanceFullDayFixMeta.findUnique({ where: { id: 'release' } }))?.releasedAt ?? null;
  expect(releaseWas, 'the migration records the release').toBeTruthy();
  await setRelease(FAR);
});
afterAll(async () => {
  if (releaseWas) await setRelease(releaseWas);
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
/** Close a month the way the screen does: look at the checklist, then confirm what it showed, days with no record included. */
const close = async (c: Ctx, month: string) => {
  const look = await att(c, 'post', `/months/${month}/close`, {});
  if (look.status !== 409 || look.body.code !== 'MONTH_NOT_READY') return look;
  const r = look.body.readiness;
  return att(c, 'post', `/months/${month}/close`, { acknowledge: true, confirmNoRecordDays: r.noRecordDays, confirmNoRecordToken: r.noRecordToken });
};
async function company(): Promise<Ctx> {
  const email = `fd.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `FD Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: '', userId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${c.token}`).expect(200);
  c.userId = me.body.user.id;
  c.accountId = me.body.orgs.find((o: any) => o.orgId === c.orgId).accountId;
  return c;
}
const person = async (c: Ctx, code: string, extra: Record<string, unknown> = {}) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: `Person ${code}`, code, dateOfJoining: '2024-01-01', ...extra }).expect(201)).body.employee;
const fix = (c: Ctx, opts: Parameters<typeof fixFullDays>[1] = {}) => fixFullDays({ accountId: c.accountId, orgId: c.orgId }, opts);
const inTenant = <X>(c: Ctx, fn: () => Promise<X>) => runInTenant(c.orgId, fn);

/* Months before this one, worked out from today in India; a Wednesday in each, a working day on the default shift (Sunday off). */
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const monthBack = (n: number) => {
  const [y, m] = istToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
};
const wednesdayOf = (month: string, nth = 2) => {
  const first = new Date(`${month}-01T00:00:00Z`);
  const offset = (3 - first.getUTCDay() + 7) % 7;
  return `${month}-${String(1 + offset + (nth - 1) * 7).padStart(2, '0')}`;
};

/* A day as the old rule left it: written through the API (which now scores it present), then set back to what it said before the fix. */
async function legacyDay(c: Ctx, employeeId: string, date: string, inAt = '09:06', outAt = '18:00', status = 'HALF_DAY') {
  const r = (await att(c, 'put', '/records', { employeeId, date, checkIn: inAt, checkOut: outAt }).expect(200)).body.record;
  await inTenant(c, () => peoplePrisma.attendanceRecord.update({ where: { id: r.id }, data: { status, validated: true, validatedByUserId: c.userId, validatedAt: new Date() } }));
  return r;
}
const recordOf = (c: Ctx, id: string) => inTenant(c, async () => (await peoplePrisma.attendanceRecord.findUnique({ where: { id } }))!);
const statusOf = async (c: Ctx, id: string) => (await recordOf(c, id)).status;
const reviewOf = (c: Ctx, recordId: string) => inTenant(c, () => peoplePrisma.attendanceFullDayReview.findUnique({ where: { recordId } }));

/* A pay period for a month (to the 28th: every Wednesday used is on or before it) and a run in it. */
async function payRun(c: Ctx, month: string, status: string, employeeIds: string[], opts: { pulled?: boolean; period?: string } = {}) {
  return inTenant(c, async () => {
    const periodId = opts.period || (await payrollPrisma.payrollPeriod.create({ data: { accountId: c.accountId, orgId: c.orgId, name: `${month} ${rnd()}`, startDate: `${month}-01`, endDate: `${month}-28`, createdByUserId: 'test' } as any })).id;
    const run = await payrollPrisma.payrollRun.create({ data: { accountId: c.accountId, orgId: c.orgId, number: `PR-${rnd()}`, periodId, payrollDate: `${month}-28`, status, createdByUserId: 'test' } as any });
    for (const employeeId of employeeIds) {
      await payrollPrisma.payrollRunEmployee.create({ data: { accountId: c.accountId, orgId: c.orgId, runId: run.id, employeeId } as any });
      if (opts.pulled) await payrollPrisma.payrollInput.create({ data: { accountId: c.accountId, orgId: c.orgId, runId: run.id, employeeId, source: 'ATTENDANCE', createdByUserId: 'test' } });
    }
    return { runId: run.id, periodId };
  });
}

describe('saving a shift', () => {
  it('refuses a full day longer than the shift, and fills a left-out full day from the shift itself', async () => {
    const c = await company();
    const refused = await att(c, 'post', '/shifts', { name: `Night ${rnd()}`, startTime: '22:00', endTime: '06:00', breakMinutes: 30, fullDayMinutes: 480 }).expect(400);
    expect(refused.body).toMatchObject({ code: 'SHIFT_RULES' });
    expect(refused.body.error).toMatch(/less the 30 min break is 7 h 30 min/);
    const made = (await att(c, 'post', '/shifts', { name: `Night ${rnd()}`, startTime: '22:00', endTime: '06:00', breakMinutes: 30 }).expect(201)).body.shift;
    expect(made.fullDayMinutes).toBe(450);
    const dayShift = (await att(c, 'post', '/shifts', { name: `Day ${rnd()}`, startTime: '09:00', endTime: '18:00' }).expect(201)).body.shift;
    expect(dayShift.fullDayMinutes).toBe(480);
  });

  it('lets a shift saved before the check be renamed, but not re-timed while its full day is too long; the preview says the same', async () => {
    const c = await company();
    const s = (await att(c, 'post', '/shifts', { name: `Night ${rnd()}`, startTime: '22:00', endTime: '06:00', breakMinutes: 30 }).expect(201)).body.shift;
    await inTenant(c, () => peoplePrisma.shift.update({ where: { id: s.id }, data: { fullDayMinutes: 480 } }));
    const body = { ...s, fullDayMinutes: 480, overtimeAfterMinutes: null, checkInBeforeMinutes: null, checkOutAfterMinutes: null, code: null, color: null };
    for (const k of ['id', 'accountId', 'orgId', 'createdAt', 'updatedAt', 'createdByUserId', 'assignments']) delete (body as any)[k];
    await att(c, 'put', `/shifts/${s.id}`, { ...body, name: `Nights ${rnd()}` }).expect(200);
    await att(c, 'put', `/shifts/${s.id}`, { ...body, isActive: false }).expect(200);
    const refused = await att(c, 'put', `/shifts/${s.id}`, { ...body, breakMinutes: 45 }).expect(400);
    expect(refused.body.code).toBe('SHIFT_RULES');
    await att(c, 'put', `/shifts/${s.id}`, { ...body, breakMinutes: 45, fullDayMinutes: 435 }).expect(200);

    const from = wednesdayOf(monthBack(1));
    const preview = await att(c, 'post', '/rules/simulate', { shiftId: s.id, changes: { breakMinutes: 60 }, from, to: from }).expect(400);
    expect(preview.body).toMatchObject({ code: 'SHIFT_RULES' });
    expect(preview.body.error).toMatch(/Set the full day to 420 minutes or less/);
    await att(c, 'post', '/rules/simulate', { shiftId: s.id, changes: { graceMinutes: 15 }, from, to: from }).expect(200);
  });
});

describe('payroll taken: every final run of a period', () => {
  it('two final runs in one period: a day either one paid cannot be changed', async () => {
    const c = await company();
    const asha = await person(c, 'TR1');
    const ravi = await person(c, 'TR2');
    const date = wednesdayOf(monthBack(2));
    await att(c, 'put', '/records', { employeeId: asha.id, date, checkIn: '09:00', checkOut: '18:00' }).expect(200);
    await att(c, 'put', '/records', { employeeId: ravi.id, date, checkIn: '09:00', checkOut: '18:00' }).expect(200);
    const first = await payRun(c, date.slice(0, 7), 'PAID', [asha.id]);
    await payRun(c, date.slice(0, 7), 'APPROVED', [ravi.id], { period: first.periodId });
    for (const id of [asha.id, ravi.id]) {
      const r = await att(c, 'put', '/records', { employeeId: id, date, checkIn: '09:00', checkOut: '13:00' });
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body.code).toBe('PAYROLL_TAKEN');
    }
  });
});

describe('days written under the old rule', () => {
  it('no final pay run: this month and last are corrected, older days held as OLD; corrected days need validating again; a second run changes nothing', async () => {
    const c = await company();
    const asha = await person(c, 'FD1');
    const last = monthBack(1);
    const onTime = await legacyDay(c, asha.id, wednesdayOf(last));
    const absentWrongly = await legacyDay(c, asha.id, wednesdayOf(last, 4), '09:06', '18:00', 'ABSENT');
    const tooLate = await legacyDay(c, asha.id, wednesdayOf(last, 3), '09:11', '18:00');
    const shortDay = await legacyDay(c, asha.id, wednesdayOf(last, 1), '09:00', '14:00');
    const old = await legacyDay(c, asha.id, wednesdayOf(monthBack(2)));

    /* Another company's old day is not this company's to touch. */
    const other = await company();
    const stranger = await person(other, 'FD9');
    const theirs = await legacyDay(other, stranger.id, wednesdayOf(last));

    const first = await fix(c);
    expect(first.corrected.map((r) => r.recordId).sort()).toEqual([onTime.id, absentWrongly.id].sort());
    expect(first.held.map((r) => [r.recordId, r.held])).toEqual([[old.id, 'OLD']]);
    expect(await statusOf(c, onTime.id)).toBe('PRESENT');
    expect(await statusOf(c, absentWrongly.id)).toBe('PRESENT');
    expect(await statusOf(c, tooLate.id)).toBe('HALF_DAY');
    expect(await statusOf(c, shortDay.id)).toBe('HALF_DAY');
    expect(await statusOf(c, old.id)).toBe('HALF_DAY');
    expect(await statusOf(other, theirs.id)).toBe('HALF_DAY');

    /* A corrected day was validated as a half day; it is no longer, and says so. */
    const after = await recordOf(c, onTime.id);
    expect(after).toMatchObject({ validated: false, validatedByUserId: null, validatedAt: null, workedMinutes: 474 });
    const history = await inTenant(c, () => peoplePrisma.attendanceRecordHistory.findMany({ where: { orgId: c.orgId, recordId: onTime.id, action: 'BULK' } }));
    expect(history).toHaveLength(1);
    expect(history[0].reason).toMatch(/full-day rule.*needs validating again/i);
    expect(history[0].userId).toBe('system');
    expect(await reviewOf(c, onTime.id)).toMatchObject({ outcome: 'CORRECTED', fromStatus: 'HALF_DAY', toStatus: 'PRESENT' });

    const again = await fix(c);
    expect(again.corrected).toEqual([]);
    expect(again.held).toHaveLength(1);
    /* Held once: the log names it the first time only. */
    expect(first.newlyHeld).toHaveLength(1);
    expect(again.newlyHeld).toEqual([]);
    expect(await inTenant(c, () => peoplePrisma.attendanceRecordHistory.count({ where: { orgId: c.orgId, action: 'BULK' } }))).toBe(2);
  });

  it('with a final pay run: only days after its period change; before it, held as PAYROLL_TAKEN for those it paid and BEFORE_PAYROLL for the rest', async () => {
    const c = await company();
    const asha = await person(c, 'FD2');
    const ravi = await person(c, 'FD3');
    const paidMonth = monthBack(2);
    const raviPaid = await legacyDay(c, ravi.id, wednesdayOf(paidMonth));
    const ashaSameMonth = await legacyDay(c, asha.id, wednesdayOf(paidMonth));
    const ashaEarlier = await legacyDay(c, asha.id, wednesdayOf(monthBack(3)));
    const ashaAfter = await legacyDay(c, asha.id, wednesdayOf(monthBack(1)));
    const raviAfter = await legacyDay(c, ravi.id, wednesdayOf(monthBack(1)));
    await payRun(c, paidMonth, 'PAID', [ravi.id]);

    const r = await fix(c);
    expect(r.corrected.map((x) => x.recordId).sort()).toEqual([ashaAfter.id, raviAfter.id].sort());
    expect(Object.fromEntries(r.held.map((x) => [x.recordId, x.held]))).toEqual({ [raviPaid.id]: 'PAYROLL_TAKEN', [ashaSameMonth.id]: 'BEFORE_PAYROLL', [ashaEarlier.id]: 'BEFORE_PAYROLL' });
    for (const id of [raviPaid.id, ashaSameMonth.id, ashaEarlier.id]) expect(await statusOf(c, id)).toBe('HALF_DAY');
  });

  it('a closed month is held; reopening it corrects the day at once; closing a month corrects its days first', async () => {
    const c = await company();
    const p = await person(c, 'FD4');
    const month = monthBack(1);
    const inClosed = await legacyDay(c, p.id, wednesdayOf(month));
    await inTenant(c, () => peoplePrisma.attendanceMonthLock.create({ data: { accountId: c.accountId, orgId: c.orgId, month, lockedByUserId: c.userId } }));
    const r = await fix(c);
    expect(r.held.map((x) => [x.recordId, x.held])).toEqual([[inClosed.id, 'MONTH_CLOSED']]);
    expect(await statusOf(c, inClosed.id)).toBe('HALF_DAY');

    await att(c, 'post', `/months/${month}/reopen`, { reason: 'Correct the full days' }).expect(200);
    expect(await statusOf(c, inClosed.id)).toBe('PRESENT');
    expect(await reviewOf(c, inClosed.id)).toMatchObject({ outcome: 'CORRECTED' });

    /* Another old day, never seen by the daily run, in the month about to close: corrected before the lock and the snapshot. */
    const late = await legacyDay(c, p.id, wednesdayOf(month, 3));
    const closed = await close(c, month);
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(await statusOf(c, late.id)).toBe('PRESENT');
  });

  it('a pay run being prepared that pulled the days holds them (PAYROLL_PENDING); a draft that has not is no bar', async () => {
    const c = await company();
    const calc = await person(c, 'FD5');
    const review = await person(c, 'FD6');
    const draft = await person(c, 'FD7');
    const month = monthBack(1);
    const a = await legacyDay(c, calc.id, wednesdayOf(month));
    const b = await legacyDay(c, review.id, wednesdayOf(month));
    const d = await legacyDay(c, draft.id, wednesdayOf(month));
    await payRun(c, month, 'CALCULATED', [calc.id], { pulled: true });
    await payRun(c, month, 'REVIEW', [review.id], { pulled: true });
    await payRun(c, month, 'DRAFT', [draft.id]);
    const r = await fix(c);
    expect(Object.fromEntries(r.held.map((x) => [x.recordId, x.held]))).toEqual({ [a.id]: 'PAYROLL_PENDING', [b.id]: 'PAYROLL_PENDING' });
    expect(r.corrected.map((x) => x.recordId)).toEqual([d.id]);
    expect(await statusOf(c, a.id)).toBe('HALF_DAY');
    expect(await statusOf(c, b.id)).toBe('HALF_DAY');
  });

  it('between the scan and the lock: a day scored again is not flipped, nor one whose leave became a half day; a note, a validation or a trust update is no bar', async () => {
    const c = await company();
    const p = await person(c, 'FD8');
    const q = await person(c, 'FD10');
    const v = await person(c, 'FD12');
    const n = await person(c, 'FD13');
    const month = monthBack(1);
    const rescored = await legacyDay(c, p.id, wednesdayOf(month));
    const leaveDay = await legacyDay(c, q.id, wednesdayOf(month));
    const validated = await legacyDay(c, v.id, wednesdayOf(month));
    const noted = await legacyDay(c, n.id, wednesdayOf(month));
    await inTenant(c, () => peoplePrisma.attendanceRecord.update({ where: { id: validated.id }, data: { validated: false } }));
    const leave = await inTenant(c, async () => {
      const type = await peoplePrisma.leaveType.create({ data: { accountId: c.accountId, orgId: c.orgId, name: `Casual ${rnd()}`, createdByUserId: c.userId } as any });
      const l = await peoplePrisma.leaveRequest.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: q.id, leaveTypeId: type.id, fromDate: leaveDay.date, toDate: leaveDay.date, days: 1, reason: 'Pending', status: 'PENDING', requestedByUserId: c.userId } });
      await peoplePrisma.attendanceRecord.update({ where: { id: leaveDay.id }, data: { leaveRequestId: l.id } });
      return l;
    });
    const r = await fix(c, {
      beforeCorrect: async (row) => {
        /* Saved again through the API, as a genuine half day: the rule as it is now scored it. */
        if (row.recordId === rescored.id) await att(c, 'put', '/records', { employeeId: p.id, date: rescored.date, checkIn: '09:00', checkOut: '13:00' }).expect(200);
        /* The record itself is untouched: only re-weighing it under the lock finds the half day. */
        if (row.recordId === leaveDay.id) await inTenant(c, () => peoplePrisma.leaveRequest.update({ where: { id: leave.id }, data: { halfDay: 'SECOND', days: 0.5, status: 'APPROVED' } }));
        /* These move updatedAt and score nothing. */
        if (row.recordId === validated.id) await att(c, 'post', '/records/validate', { ids: [validated.id] }).expect(200);
        if (row.recordId === noted.id) await inTenant(c, () => peoplePrisma.attendanceRecord.update({ where: { id: noted.id }, data: { note: 'Edited by someone', trust: 'MANUAL' } }));
      },
    });
    expect(r.corrected.map((x) => x.recordId).sort()).toEqual([validated.id, noted.id].sort());
    expect(await statusOf(c, validated.id)).toBe('PRESENT');
    expect(await statusOf(c, noted.id)).toBe('PRESENT');
    expect(await statusOf(c, rescored.id)).toBe('HALF_DAY');
    expect(await statusOf(c, leaveDay.id)).toBe('HALF_DAY');
    expect(await reviewOf(c, rescored.id)).toBeNull();
    /* Scored since the release, the rewritten day is not the fix's on the next run either. */
    expect((await fix(c)).corrected).toEqual([]);
    expect(await statusOf(c, rescored.id)).toBe('HALF_DAY');
  });

  it('half-day leave is left to the half-day rule; an hourly leave day goes as a write would score it', async () => {
    const c = await company();
    const p = await person(c, 'FD11');
    const month = monthBack(1);
    const half = await legacyDay(c, p.id, wednesdayOf(month, 1));
    const hourlyCovered = await legacyDay(c, p.id, wednesdayOf(month, 2), '09:06', '16:00');
    const hourlyOnTime = await legacyDay(c, p.id, wednesdayOf(month, 3));
    await inTenant(c, async () => {
      const type = await peoplePrisma.leaveType.create({ data: { accountId: c.accountId, orgId: c.orgId, name: `Casual ${rnd()}`, createdByUserId: c.userId } as any });
      const mk = (date: string, extra: Record<string, unknown>) =>
        peoplePrisma.leaveRequest.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: p.id, leaveTypeId: type.id, fromDate: date, toDate: date, days: 0.5, reason: 'Leave', status: 'APPROVED', requestedByUserId: c.userId, ...extra } });
      const h = await mk(half.date, { halfDay: 'FIRST' });
      const hc = await mk(hourlyCovered.date, { days: 0.25, fromTime: '16:00', toTime: '18:00', minutes: 120 });
      const ho = await mk(hourlyOnTime.date, { days: 0.01, fromTime: '17:55', toTime: '18:00', minutes: 5 });
      await peoplePrisma.attendanceRecord.update({ where: { id: half.id }, data: { leaveRequestId: h.id } });
      await peoplePrisma.attendanceRecord.update({ where: { id: hourlyCovered.id }, data: { leaveRequestId: hc.id } });
      await peoplePrisma.attendanceRecord.update({ where: { id: hourlyOnTime.id }, data: { leaveRequestId: ho.id } });
    });
    const r = await fix(c);
    /* 09:06–18:00 with 5 minutes of leave: 479 minutes was short of 480 before; the shift worked as scheduled now. Out at 16:00 is not the shift as scheduled, and 354 + 120 is short of 480: a write leaves it a half day too. */
    expect(r.corrected.map((x) => x.recordId)).toEqual([hourlyOnTime.id]);
    expect(await statusOf(c, half.id)).toBe('HALF_DAY');
    expect(await statusOf(c, hourlyCovered.id)).toBe('HALF_DAY');
  });

  it('a run with a provisional cut-off on the 25th took the days to the 25th only: later days are corrected, for the next run to true up', async () => {
    const c = await company();
    const ravi = await person(c, 'CO1');
    const asha = await person(c, 'CO2');
    const month = monthBack(1);
    /* A working day after the 25th and on or before the period's end (the 28th). */
    const late = ['26', '27', '28'].map((d) => `${month}-${d}`).find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0)!;
    const taken = await legacyDay(c, ravi.id, wednesdayOf(month));
    const raviLate = await legacyDay(c, ravi.id, late);
    const ashaLate = await legacyDay(c, asha.id, late);
    const { runId } = await payRun(c, month, 'PAID', [ravi.id]);
    await inTenant(c, () => payrollPrisma.payrollRun.update({ where: { id: runId }, data: { provisionalDays: { cutoffDate: `${month}-25` } } as any }));
    const r = await fix(c);
    expect(Object.fromEntries(r.held.map((x) => [x.recordId, x.held]))).toEqual({ [taken.id]: 'PAYROLL_TAKEN' });
    expect(r.corrected.map((x) => x.recordId).sort()).toEqual([raviLate.id, ashaLate.id].sort());
  });

  it('the latest final run ended more than two months ago: this month and last only, older days held as OLD', async () => {
    const c = await company();
    const p = await person(c, 'ST1');
    const paid = await legacyDay(c, p.id, wednesdayOf(monthBack(4)));
    const between = await legacyDay(c, p.id, wednesdayOf(monthBack(3)));
    const recent = await legacyDay(c, p.id, wednesdayOf(monthBack(1)));
    await payRun(c, monthBack(4), 'PAID', [p.id]);
    const r = await fix(c);
    expect(Object.fromEntries(r.held.map((x) => [x.recordId, x.held]))).toEqual({ [paid.id]: 'PAYROLL_TAKEN', [between.id]: 'OLD' });
    expect(r.corrected.map((x) => x.recordId)).toEqual([recent.id]);
  });

  it('a one-time fix: a day written after the release is not flipped when its shift gets a longer grace', async () => {
    const c = await company();
    const p = await person(c, 'RL1');
    const s = (await att(c, 'post', '/shifts', { name: `Day ${rnd()}`, startTime: '09:00', endTime: '18:00' }).expect(201)).body.shift;
    const release = await dbNow();
    const r = (await att(c, 'put', '/records', { employeeId: p.id, date: wednesdayOf(monthBack(1)), checkIn: '09:15', checkOut: '18:00' }).expect(200)).body.record;
    await inTenant(c, () => peoplePrisma.attendanceRecord.update({ where: { id: r.id }, data: { shiftId: s.id } }));
    expect(await statusOf(c, r.id)).toBe('HALF_DAY');
    await inTenant(c, () => peoplePrisma.shift.update({ where: { id: s.id }, data: { graceMinutes: 20 } }));
    /* Taken for a day from before the release, it would be corrected: the release is all that keeps it. */
    expect((await fix(c, { apply: false })).open.map((x) => x.recordId)).toEqual([r.id]);
    const run = await fix(c, { releasedAt: release });
    expect(run.corrected).toEqual([]);
    expect(await statusOf(c, r.id)).toBe('HALF_DAY');
  });

  it('the release is the one the migration recorded: a day last scored before it is corrected, one scored after it is not (created after, or saved again after)', async () => {
    const c = await company();
    const p = await person(c, 'DR1');
    const month = monthBack(1);
    const before = await legacyDay(c, p.id, wednesdayOf(month, 1));
    /* Written before the release, saved again after it: its latest scoring write is the new rule's. */
    const savedAgain = await legacyDay(c, p.id, wednesdayOf(month, 2));
    try {
      await setRelease(await dbNow());
      await att(c, 'put', '/records', { employeeId: p.id, date: savedAgain.date, checkIn: '09:06', checkOut: '18:00', note: 'Saved again' }).expect(200);
      await inTenant(c, () => peoplePrisma.attendanceRecord.update({ where: { id: savedAgain.id }, data: { status: 'HALF_DAY' } }));
      const after = await legacyDay(c, p.id, wednesdayOf(month, 3));
      /* Validated after the release: not a scoring write, so the day still counts as scored before it. */
      await inTenant(c, () => peoplePrisma.attendanceRecord.update({ where: { id: before.id }, data: { validated: false } }));
      await att(c, 'post', '/records/validate', { ids: [before.id] }).expect(200);
      const r = await fix(c);
      expect(r.corrected.map((x) => x.recordId)).toEqual([before.id]);
      expect(await statusOf(c, savedAgain.id)).toBe('HALF_DAY');
      expect(await statusOf(c, after.id)).toBe('HALF_DAY');
    } finally {
      await setRelease(FAR);
    }
  });

  it('a held day validated, or its overtime approved, one by one or in bulk, stays held; a closed month validated stays MONTH_CLOSED', async () => {
    const c = await company();
    const p = await person(c, 'VH1');
    const validated = await legacyDay(c, p.id, wednesdayOf(monthBack(2), 1));
    const overtime = await legacyDay(c, p.id, wednesdayOf(monthBack(2), 3));
    const bulk = await legacyDay(c, p.id, wednesdayOf(monthBack(2), 4));
    await inTenant(c, () => peoplePrisma.attendanceRecord.updateMany({ where: { id: { in: [overtime.id, bulk.id] } }, data: { overtimeMinutes: 30 } }));
    await inTenant(c, () => peoplePrisma.attendanceRecord.update({ where: { id: validated.id }, data: { validated: false } }));
    const month = monthBack(1);
    const closed = await legacyDay(c, p.id, wednesdayOf(month));
    await inTenant(c, () => peoplePrisma.attendanceRecord.update({ where: { id: closed.id }, data: { validated: false } }));
    await inTenant(c, () => peoplePrisma.attendanceMonthLock.create({ data: { accountId: c.accountId, orgId: c.orgId, month, lockedByUserId: c.userId } }));
    const first = await fix(c);
    const reasons: Record<string, string> = { [validated.id]: 'OLD', [overtime.id]: 'OLD', [bulk.id]: 'OLD', [closed.id]: 'MONTH_CLOSED' };
    expect(Object.fromEntries(first.held.map((x) => [x.recordId, x.held]))).toEqual(reasons);

    await att(c, 'post', '/records/validate', { ids: [validated.id, closed.id] }).expect(200);
    await att(c, 'post', `/records/${overtime.id}/overtime`, { approved: true }).expect(200);
    const applied = await att(c, 'post', '/records/bulk', { ids: [bulk.id], operation: 'APPROVE_OVERTIME', reason: 'Approved in bulk', preview: false }).expect(200);
    expect(applied.body.applied).toBe(1);
    /* Bulk overtime approval is logged as overtime, not as a bulk write that scored the day. */
    expect(await inTenant(c, () => peoplePrisma.attendanceRecordHistory.count({ where: { orgId: c.orgId, recordId: bulk.id, action: 'OVERTIME' } }))).toBe(1);
    expect((await recordOf(c, closed.id)).validated).toBe(true);

    for (let run = 0; run < 2; run += 1) {
      const r = await fix(c);
      expect(r.settled).toBe(0);
      expect(r.corrected).toEqual([]);
      expect(Object.fromEntries(r.held.map((x) => [x.recordId, x.held]))).toEqual(reasons);
    }
    for (const id of Object.keys(reasons)) {
      expect(await reviewOf(c, id)).toMatchObject({ outcome: 'HELD', reason: reasons[id], settledAs: null, settledAt: null });
      expect(await statusOf(c, id)).toBe('HALF_DAY');
    }
  });

  it('a held day scored again (status, punches or minutes) is settled as RECORD_CHANGED and leaves the list', async () => {
    const c = await company();
    const p = await person(c, 'RC1');
    const old = await legacyDay(c, p.id, wednesdayOf(monthBack(2)));
    expect((await fix(c)).held.map((x) => x.recordId)).toEqual([old.id]);
    await att(c, 'put', '/records', { employeeId: p.id, date: old.date, checkIn: '09:00', checkOut: '13:00' }).expect(200);
    const r = await fix(c);
    expect(r.settled).toBe(1);
    expect(r.held).toEqual([]);
    expect(await reviewOf(c, old.id)).toMatchObject({ outcome: 'HELD', settledAs: 'RECORD_CHANGED' });
  });

  it('a holiday worked short is left as it is', async () => {
    const c = await company();
    const p = await person(c, 'HO1');
    const d = await legacyDay(c, p.id, wednesdayOf(monthBack(1)));
    /* Added straight to the table, as if it were there when the day was written: the API would re-score the day itself. */
    await inTenant(c, () => peoplePrisma.holiday.create({ data: { accountId: c.accountId, orgId: c.orgId, date: d.date, name: 'Test holiday', createdByUserId: c.userId } as any }));
    expect((await fix(c, { apply: false })).open).toEqual([]);
    expect((await fix(c)).corrected).toEqual([]);
    expect(await statusOf(c, d.id)).toBe('HALF_DAY');
  });

  it("a branch's or an area's holiday is the holiday of the people there only", async () => {
    const c = await company();
    const inBranch = await person(c, 'HB1');
    const inArea = await person(c, 'HA1');
    const elsewhere = await person(c, 'HE1');
    const date = wednesdayOf(monthBack(1));
    const area = await inTenant(c, () => peoplePrisma.area.create({ data: { accountId: c.accountId, orgId: c.orgId, name: `Plant ${rnd()}`, createdByUserId: c.userId } as any }));
    await inTenant(c, async () => {
      await peoplePrisma.employee.update({ where: { id: inBranch.id }, data: { branchId: c.branchId, areaId: null } });
      await peoplePrisma.employee.update({ where: { id: inArea.id }, data: { branchId: null, areaId: area.id } });
      await peoplePrisma.employee.update({ where: { id: elsewhere.id }, data: { branchId: null, areaId: null } });
    });
    const branchDay = await legacyDay(c, inBranch.id, date);
    const areaDay = await legacyDay(c, inArea.id, date);
    const otherDay = await legacyDay(c, elsewhere.id, date);
    await inTenant(c, async () => {
      await peoplePrisma.holiday.create({ data: { accountId: c.accountId, orgId: c.orgId, date, name: 'Branch holiday', branchId: c.branchId, createdByUserId: c.userId } as any });
      await peoplePrisma.holiday.create({ data: { accountId: c.accountId, orgId: c.orgId, date, name: 'Area holiday', areaId: area.id, createdByUserId: c.userId } as any });
    });
    const r = await fix(c);
    expect(r.corrected.map((x) => x.recordId)).toEqual([otherDay.id]);
    expect(await statusOf(c, branchDay.id)).toBe('HALF_DAY');
    expect(await statusOf(c, areaDay.id)).toBe('HALF_DAY');
  });

  it('closing a month: a fix that fails does not fail the close with a 500; a day it left stops the close with a clear 409', async () => {
    const c = await company();
    const p = await person(c, 'CL1');
    const month = monthBack(1);
    const d = await legacyDay(c, p.id, wednesdayOf(month));
    fullDayFixTesting.failNext = true;
    const refused = await att(c, 'post', `/months/${month}/close`, { acknowledge: true });
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.code).toBe('FULL_DAYS_PENDING');
    expect(refused.body.error).toMatch(/1 day was scored a half day or absent under the old full-day rule/);
    expect(await inTenant(c, () => peoplePrisma.attendanceMonthLock.count({ where: { orgId: c.orgId, month } }))).toBe(0);
    expect(await statusOf(c, d.id)).toBe('HALF_DAY');
    /* Next time the fix runs, corrects it, and the month closes. */
    expect((await close(c, month)).status).toBe(200);
    expect(await statusOf(c, d.id)).toBe('PRESENT');

    /* With nothing left to correct, a failing fix is no bar at all. */
    const other = await company();
    fullDayFixTesting.failNext = true;
    expect((await close(other, month)).status).toBe(200);
    expect(fullDayFixTesting.failNext).toBe(false);
  });

  it('a night shift saved with the 480 default is corrected through the job', async () => {
    const c = await company();
    const p = await person(c, 'FD12');
    const night = (await att(c, 'post', '/shifts', { name: `Night ${rnd()}`, startTime: '22:00', endTime: '06:00', breakMinutes: 30 }).expect(201)).body.shift;
    await inTenant(c, () => peoplePrisma.shift.update({ where: { id: night.id }, data: { fullDayMinutes: 480 } }));
    const date = wednesdayOf(monthBack(1));
    const legacy = { ...DEFAULT_SHIFT, startTime: '22:00', endTime: '06:00', breakMinutes: 30, fullDayMinutes: 480 };
    const checkIn = istInstant(date, '22:05');
    const checkOut = istInstant(date, '06:00', 1);
    const scored = computeDay({ date, shift: legacy, checkIn, checkOut });
    expect(scored).toMatchObject({ workedMinutes: 445, status: 'PRESENT' });
    const rec = await inTenant(c, () => peoplePrisma.attendanceRecord.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: p.id, date, shiftId: night.id, checkIn, checkOut, workedMinutes: scored.workedMinutes, status: 'HALF_DAY', source: 'DEVICE', createdByUserId: c.userId } }));
    const r = await fix(c);
    expect(r.corrected.map((x) => x.recordId)).toEqual([rec.id]);
    expect(await statusOf(c, rec.id)).toBe('PRESENT');
  });
});

describe('Data health', () => {
  it('lists held days by what to do, with leavers; corrected days for 60 days; paid days leave the list only when marked, audited, and can be undone', async () => {
    const c = await company();
    const ravi = await person(c, 'DH1');
    const leaver = await person(c, 'DH2');
    const asha = await person(c, 'DH3');
    const paidMonth = monthBack(2);
    await legacyDay(c, ravi.id, wednesdayOf(paidMonth));
    await legacyDay(c, leaver.id, wednesdayOf(paidMonth, 1));
    await legacyDay(c, asha.id, wednesdayOf(monthBack(1)));
    const ashaBefore = await legacyDay(c, asha.id, wednesdayOf(paidMonth, 3));
    await payRun(c, paidMonth, 'PAID', [ravi.id, leaver.id]);
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: leaver.id }, data: { status: 'LEFT' } }));
    await fix(c);

    const health = async () => (await request(app).get(`/api/orgs/${c.orgId}/people/data-health`).set(at(c)).expect(200)).body;
    let h = await health();
    const paid = h.checks.find((x: any) => x.id === 'full-day-held-paid');
    expect(paid).toMatchObject({ area: 'Payroll', screen: 'adjustments', count: 2 });
    expect(paid.fix).toMatch(/adjustment/i);
    expect(paid.fix).not.toMatch(/reopen/i);
    const leaverRow = paid.people.find((x: any) => x.id === leaver.id);
    expect(leaverRow.name).toMatch(/\(left\)/);
    expect(leaverRow.detail).toMatch(/half day → present/);
    expect(leaverRow.settle).toHaveLength(1);
    const corrected = h.checks.find((x: any) => x.id === 'full-day-corrected');
    expect(corrected).toMatchObject({ severity: 'TIDY_UP', count: 1 });
    expect(corrected.people[0]).toMatchObject({ id: asha.id });
    expect(corrected.people[0].settle).toBeUndefined();

    /* Paid the difference to the leaver: who and when are kept, the audit log says so. */
    const done = await att(c, 'post', '/full-day/paid', { ids: leaverRow.settle, note: 'Paid in the final settlement' }).expect(200);
    expect(done.body.settled).toBe(1);
    await att(c, 'post', '/full-day/paid', { ids: leaverRow.settle }).expect(409);
    const review = await inTenant(c, () => peoplePrisma.attendanceFullDayReview.findUnique({ where: { id: leaverRow.settle[0] } }));
    expect(review).toMatchObject({ settledAs: 'PAID', settledByUserId: c.userId, note: 'Paid in the final settlement' });
    expect(review!.settledAt).toBeTruthy();
    const audit = await inTenant(c, () => platformPrisma.auditLog.findFirst({ where: { orgId: c.orgId, entity: 'ATTENDANCE_FULL_DAY' } }));
    expect(audit?.message).toMatch(/Marked 1 day paid short as paid the difference: Paid in the final settlement/);

    /* An adjustment is not taken as the difference paid: only marking it paid settles a day. */
    await inTenant(c, () => payrollPrisma.payrollAdjustment.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: ravi.id, componentId: 'x', periodId: 'x', type: 'EARNING', amount: 500, createdByUserId: c.userId } as any }));
    h = await health();
    expect(h.checks.find((x: any) => x.id === 'full-day-held-paid').people.map((p: any) => p.id)).toEqual([ravi.id]);

    /* Undo: the leaver's day is held again, the audit log says so. */
    const undone = await att(c, 'post', '/full-day/unpaid', { ids: leaverRow.settle }).expect(200);
    expect(undone.body.undone).toBe(1);
    await att(c, 'post', '/full-day/unpaid', { ids: leaverRow.settle }).expect(409);
    expect(await inTenant(c, () => peoplePrisma.attendanceFullDayReview.findUnique({ where: { id: leaverRow.settle[0] } }))).toMatchObject({ settledAs: null, settledAt: null, settledByUserId: null, note: null });
    expect((await inTenant(c, () => platformPrisma.auditLog.findFirst({ where: { orgId: c.orgId, entity: 'ATTENDANCE_FULL_DAY', message: { contains: 'held again' } } })))).toBeTruthy();
    h = await health();
    expect(h.checks.find((x: any) => x.id === 'full-day-held-paid').count).toBe(2);

    /* A day before the last pay run that no CLOR run paid: its own list, asking how it was paid. */
    const before = h.checks.find((x: any) => x.id === 'full-day-held-before');
    expect(before).toMatchObject({ area: 'Payroll', count: 1 });
    expect(before.fix).toMatch(/not paid by a CLOR pay run: check how they were paid/);
    expect(before.people[0]).toMatchObject({ id: asha.id });
    expect(before.people[0].settle).toEqual([(await reviewOf(c, ashaBefore.id))!.id]);

    /* Not on the readiness of one person or the Organization overview. */
    const plain = await inTenant(c, () => dataHealth(c.accountId, c.orgId, { payroll: false }));
    expect(plain.checks.some((x: any) => String(x.id).startsWith('full-day'))).toBe(false);
  });

  it('needs Attendance records view; a team-scoped role sees only its own team; a viewer may not mark days paid', async () => {
    const c = await company();
    const lead = await person(c, 'DT1');
    const mine = await person(c, 'DT2', { reportingManagerId: lead.id });
    const other = await person(c, 'DT3');
    const paidMonth = monthBack(2);
    await legacyDay(c, mine.id, wednesdayOf(paidMonth));
    await legacyDay(c, other.id, wednesdayOf(paidMonth));
    await payRun(c, paidMonth, 'PAID', [mine.id, other.id]);
    await fix(c);

    const userWith = async (permissions: string[], ownDocumentsOnly: boolean): Promise<Ctx> => {
      const role = await request(app).post(`/api/orgs/${c.orgId}/roles`).set(at(c)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly }).expect(201);
      await request(app).put(`/api/orgs/${c.orgId}/roles/${role.body.role.id}/permissions`).set(at(c)).send({ permissions }).expect(200);
      const email = `u.${Date.now()}.${rnd()}@example.com`;
      const user = await request(app).post('/api/users').set(at(c)).send({ email, fullName: 'User', password: 'Passw0rd!23', orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }).expect(201);
      await request(app).post(`/api/orgs/${c.orgId}/users/${user.body.user.id}/roles`).set(at(c)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
      const token = (await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200)).body.token;
      return { ...c, token, userId: user.body.user.id };
    };
    const ids = (body: any) => (body.checks.find((x: any) => x.id === 'full-day-held-paid')?.people || []).map((p: any) => p.id).sort();

    const hrOnly = await userWith(['PEOPLE::Employees::VIEW'], false);
    const noAttendance = (await request(app).get(`/api/orgs/${c.orgId}/people/data-health`).set(at(hrOnly)).expect(200)).body;
    expect(noAttendance.checks.some((x: any) => String(x.id).startsWith('full-day'))).toBe(false);

    const viewer = await userWith(['PEOPLE::Employees::VIEW', 'ATTENDANCE::Attendance Records::VIEW'], false);
    const seen = (await request(app).get(`/api/orgs/${c.orgId}/people/data-health`).set(at(viewer)).expect(200)).body;
    expect(ids(seen)).toEqual([mine.id, other.id].sort());
    expect(seen.checks.find((x: any) => x.id === 'full-day-held-paid').people.every((p: any) => !p.settle)).toBe(true);
    const settleIds = (await inTenant(c, () => peoplePrisma.attendanceFullDayReview.findMany({ where: { orgId: c.orgId, outcome: 'HELD' } }))).map((r) => r.id);
    await att(viewer, 'post', '/full-day/paid', { ids: settleIds }).expect(403);

    const teamLead = await userWith(['PEOPLE::Employees::VIEW', 'ATTENDANCE::Attendance Records::VIEW', 'ATTENDANCE::Attendance Records::EDIT', 'ATTENDANCE::My Attendance::VIEW'], true);
    await inTenant(c, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: teamLead.userId } }));
    const team = (await request(app).get(`/api/orgs/${c.orgId}/people/data-health`).set(at(teamLead)).expect(200)).body;
    expect(ids(team)).toEqual([mine.id]);
    /* Marking paid stays inside the team too: the other person's day is not settled. */
    const r = await att(teamLead, 'post', '/full-day/paid', { ids: settleIds }).expect(200);
    expect(r.body.settled).toBe(1);
    const left = await inTenant(c, () => peoplePrisma.attendanceFullDayReview.findMany({ where: { orgId: c.orgId, outcome: 'HELD', settledAt: null } }));
    expect(left.map((x) => x.employeeId)).toEqual([other.id]);
  });
});
