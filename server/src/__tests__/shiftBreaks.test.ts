import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Breaks (platform audit 11 Nov 2026, "Partial"): a shift may name several
 * breaks, each at a time of day or only a length, paid or unpaid; and may take
 * the break from the day's break punches instead of the fixed total. A shift
 * that names none is the shift it always was.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { recomputeDeviceDay } = await import('../services/attendance/punches.js');
const { DEFAULT_SHIFT, computeDay, istInstant, scheduledMinutes } = await import('../services/attendance/compute.js');
const { breaksOf, breaksProblem, effectiveBreaks, punchedBreak, punchedGaps, unpaidBreakMinutes } = await import('../services/attendance/breaks.js');
const { toRule } = await import('../services/attendance/schedule.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const D = '2026-08-04';
const t = (hhmm: string, addDays = 0) => istInstant(D, hhmm, addDays);

describe('a shift’s breaks, on their own', () => {
  const lunch = { name: 'Lunch', startTime: '13:00', endTime: '13:45', minutes: 0, paid: false };
  const tea = { name: 'Tea', startTime: '11:00', endTime: '11:15', minutes: 0, paid: true };
  const rest = { name: 'Rest', minutes: 15, paid: false };

  it('reads a break’s length from its times, or its minutes, and drops what is not a break', () => {
    const b = breaksOf([lunch, tea, rest, { name: 'Nothing' }, 'x', null]);
    expect(b.map((x) => [x.name, x.minutes, x.paid])).toEqual([['Lunch', 45, false], ['Tea', 15, true], ['Rest', 15, false]]);
    expect(unpaidBreakMinutes(b)).toBe(60);
    expect(breaksOf(undefined)).toEqual([]);
  });

  it('reads a shift with no named breaks as its one unpaid break', () => {
    expect(effectiveBreaks({ breaks: [], breakMinutes: 60 })).toEqual([{ name: 'Break', startTime: null, endTime: null, minutes: 60, paid: false }]);
    expect(toRule({ ...DEFAULT_SHIFT, breaks: [], breakMode: 'FIXED' })).toMatchObject({ breakMinutes: 60, breaks: [], breakMode: 'FIXED' });
    /* A row from before the columns existed. */
    expect(toRule({ ...DEFAULT_SHIFT })).toMatchObject({ breaks: [], breakMode: 'FIXED' });
  });

  it('refuses breaks outside the shift, overlapping, or as long as it', () => {
    const shift = { startTime: '09:00', endTime: '18:00' };
    expect(breaksProblem(breaksOf([lunch, tea, rest]), shift)).toBeNull();
    expect(breaksProblem(breaksOf([{ name: 'Late', startTime: '18:30', endTime: '19:00' }]), shift)).toMatch(/outside the shift/);
    expect(breaksProblem(breaksOf([lunch, { name: 'Second', startTime: '13:30', endTime: '14:00' }]), shift)).toBe('Second and Lunch overlap.');
    expect(breaksProblem(breaksOf([{ name: 'All day', minutes: 540 }]), shift)).toBe('The breaks are as long as the shift.');
    /* A night shift's break after midnight is inside it. */
    expect(breaksProblem(breaksOf([{ name: 'Meal', startTime: '01:00', endTime: '01:30' }]), { startTime: '22:00', endTime: '06:00' })).toBeNull();
    expect(breaksProblem(breaksOf([{ name: 'Meal', startTime: '08:00', endTime: '08:30' }]), { startTime: '22:00', endTime: '06:00' })).toMatch(/outside the shift/);
  });

  it('finds the breaks punched in a day: each out followed by an in', () => {
    const gaps = punchedGaps(
      [{ at: t('09:00'), kind: 'IN' }, { at: t('13:00'), kind: 'OUT' }, { at: t('13:30'), kind: 'IN' }, { at: t('16:00'), kind: 'OUT' }, { at: t('18:00'), kind: 'OUT' }],
      t('09:00'),
      t('18:00'),
    );
    /* The 16:00 out has no in after it: not a break. */
    expect(gaps).toEqual([{ from: t('13:00'), to: t('13:30') }]);
    /* A reader that sends no direction: read in turn. */
    expect(punchedGaps([{ at: t('11:00'), kind: null }, { at: t('11:20'), kind: null }, { at: t('13:00'), kind: null }], t('09:00'), t('18:00'))).toEqual([{ from: t('11:00'), to: t('11:20') }]);
    expect(punchedGaps([], t('09:00'), t('18:00'))).toEqual([]);
  });

  it('takes the time out off the day, less the part a paid break covers', () => {
    const shift = { startTime: '09:00', endTime: '18:00', breakMinutes: 60, breaks: breaksOf([lunch, tea]) };
    const out = punchedBreak([{ from: t('11:00'), to: t('11:20') }, { from: t('13:00'), to: t('13:30') }], shift, D);
    expect(out).toEqual({ total: 50, paid: 15, deducted: 35 });
    /* A paid break with only a length: up to that much of the time out. */
    const loose = { ...shift, breaks: breaksOf([lunch, { name: 'Tea', minutes: 15, paid: true }]) };
    expect(punchedBreak([{ from: t('15:00'), to: t('15:10') }], loose, D)).toEqual({ total: 10, paid: 10, deducted: 0 });
    expect(punchedBreak([{ from: t('15:00'), to: t('15:40') }], loose, D)).toEqual({ total: 40, paid: 15, deducted: 25 });
  });

  it('scores a day on punched breaks from the time out, and on fixed breaks as it always did', () => {
    const fixed = { ...DEFAULT_SHIFT };
    const punched = { ...DEFAULT_SHIFT, breakMode: 'PUNCHED' as const };
    const day = { date: D, checkIn: t('09:00'), checkOut: t('18:00') };
    expect(computeDay({ ...day, shift: fixed }).workedMinutes).toBe(480);
    /* Fixed breaks ignore what was punched. */
    expect(computeDay({ ...day, shift: fixed, breakTakenMinutes: 20 }).workedMinutes).toBe(480);
    expect(computeDay({ ...day, shift: punched, breakTakenMinutes: 20 })).toMatchObject({ workedMinutes: 520, overtimeMinutes: 40, status: 'PRESENT' });
    /* No break punched that day: the fixed break. */
    expect(computeDay({ ...day, shift: punched, breakTakenMinutes: null }).workedMinutes).toBe(480);
    expect(computeDay({ ...day, shift: punched }).workedMinutes).toBe(480);
    expect(scheduledMinutes(punched)).toBe(480);
  });
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `br.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `BR Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
/* Past Tuesdays, a week and two weeks back: working days in an open month. */
const tuesday = (weeksBack: number) => {
  const d = new Date(Date.now() - weeksBack * 7 * 86_400_000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const [DAY1, DAY2, DAY3] = [tuesday(1), tuesday(2), tuesday(3)];

describe('breaks on a company’s shifts and days', () => {
  let hr: Ctx;
  let asha: any;
  let shift: any;
  const BREAKS = [
    { name: 'Lunch', startTime: '13:00', endTime: '13:45', paid: false },
    { name: 'Tea', startTime: '11:00', endTime: '11:15', paid: true },
    { name: 'Rest', minutes: 15, paid: false },
  ];
  const body = (patch: Record<string, unknown> = {}) => ({ name: 'Floor', startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 10, earlyOutGraceMinutes: 0, halfDayMinutes: 240, weeklyOffDays: '0', offSaturdays: '', ...patch });
  const dayOf = async (date: string) => (await att(hr, 'get', `/records?from=${date}&to=${date}&employeeId=${asha.id}`).expect(200)).body.records[0];
  /** Reader punches for a day, then the day worked out the way a reader's upload does it. */
  async function punch(date: string, punches: Array<[string, 'IN' | 'OUT' | null]>) {
    for (const [time, kind] of punches) {
      await runInTenant(hr.orgId, () => peoplePrisma.devicePunch.create({ data: { accountId: asha.accountId, orgId: hr.orgId, deviceId: 'reader', serialNumber: 'R1', pin: asha.id, at: ist(date, time), localTime: `${date} ${time}:00`, state: kind === 'OUT' ? '1' : '0', kind, employeeId: asha.id, shiftDate: date } }));
    }
    await runInTenant(hr.orgId, () => recomputeDeviceDay(asha.accountId, hr.orgId, { id: asha.id, branchId: asha.branchId, areaId: asha.areaId }, date));
    return dayOf(date);
  }

  beforeAll(async () => {
    hr = await company();
    asha = (await request(app).post(`/api/orgs/${hr.orgId}/people/employees`).set(at(hr)).send({ name: 'Asha', code: 'A1', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
  });

  it('a shift saved the old way has no named breaks and fixed breaks', async () => {
    const old = (await att(hr, 'post', '/shifts', body({ name: 'General' })).expect(201)).body.shift;
    expect(old).toMatchObject({ breakMinutes: 60, breaks: [], breakMode: 'FIXED', fullDayMinutes: 480 });
  });

  it('saves several breaks; the unpaid ones are the shift’s break', async () => {
    shift = (await att(hr, 'post', '/shifts', body({ breakMinutes: 0, breaks: BREAKS })).expect(201)).body.shift;
    expect(shift.breaks.map((b: any) => [b.name, b.minutes, b.paid])).toEqual([['Lunch', 45, false], ['Tea', 15, true], ['Rest', 15, false]]);
    expect(shift.breakMinutes).toBe(60);
    expect(shift.fullDayMinutes).toBe(480);
    expect(shift.breakMode).toBe('FIXED');
    await runInTenant(hr.orgId, () => peoplePrisma.shiftAssignment.create({ data: { accountId: asha.accountId, orgId: hr.orgId, employeeId: asha.id, shiftId: shift.id, effectiveFrom: '2026-01-01', createdByUserId: 'test' } }));
  });

  it('refuses breaks that do not hold together, in plain words', async () => {
    const overlap = await att(hr, 'post', '/shifts', body({ name: 'Bad', breaks: [BREAKS[0], { name: 'Second', startTime: '13:30', endTime: '14:00' }] })).expect(400);
    expect(overlap.body).toMatchObject({ error: 'Second and Lunch overlap.', code: 'SHIFT_BREAKS' });
    const half = await att(hr, 'post', '/shifts', body({ name: 'Bad', breaks: [{ name: 'Lunch', startTime: '13:00' }] })).expect(400);
    expect(half.body.error).toBe('Lunch: give both a start and an end, or only a length.');
    const none = await att(hr, 'post', '/shifts', body({ name: 'Bad', breaks: [{ name: 'Lunch' }] })).expect(400);
    expect(none.body.error).toBe('Lunch: a break needs a length, or a start and an end.');
  });

  it('keeps the breaks through a save from a screen that does not know them', async () => {
    const saved = (await att(hr, 'put', `/shifts/${shift.id}`, body({ breakMinutes: 30, graceMinutes: 15, fullDayMinutes: 480 })).expect(200)).body.shift;
    expect(saved.graceMinutes).toBe(15);
    expect(saved.breaks).toHaveLength(3);
    expect(saved.breakMinutes).toBe(60);
  });

  it('on fixed breaks, takes the unpaid total off the day whatever was punched', async () => {
    const day = await punch(DAY1, [['09:00', 'IN'], ['13:00', 'OUT'], ['13:20', 'IN'], ['18:00', 'OUT']]);
    expect(day).toMatchObject({ workedMinutes: 480, overtimeMinutes: 0, status: 'PRESENT', breakMinutes: null });
  });

  it('on punched breaks, takes the time punched out and in, less the paid break', async () => {
    shift = (await att(hr, 'put', `/shifts/${shift.id}`, body({ graceMinutes: 15, fullDayMinutes: 480, breaks: BREAKS, breakMode: 'PUNCHED' })).expect(200)).body.shift;
    expect(shift.breakMode).toBe('PUNCHED');
    /* Tea 11:00–11:20 (15 of it paid) and lunch 13:00–13:30: 5 + 30 unpaid. */
    const day = await punch(DAY2, [['09:00', 'IN'], ['11:00', 'OUT'], ['11:20', 'IN'], ['13:00', 'OUT'], ['13:30', 'IN'], ['18:00', 'OUT']]);
    expect(day).toMatchObject({ workedMinutes: 540 - 35, breakMinutes: 35, overtimeMinutes: 25, status: 'PRESENT' });

    const why = (await att(hr, 'get', `/days/explain?employeeId=${asha.id}&date=${DAY2}`).expect(200)).body;
    expect(why.steps.find((s: any) => s.kind === 'worked').text).toBe('Out at 18:00: 9h 00m on site, less 35 min of breaks punched out and in = 8h 25m worked.');
    expect(why.matchesRules).toBe(true);
  });

  it('on punched breaks, a day with no break punches keeps the fixed breaks', async () => {
    const day = await punch(DAY3, [['09:00', 'IN'], ['18:00', 'OUT']]);
    expect(day).toMatchObject({ workedMinutes: 480, breakMinutes: null, overtimeMinutes: 0 });
    const why = (await att(hr, 'get', `/days/explain?employeeId=${asha.id}&date=${DAY3}`).expect(200)).body;
    expect(why.steps.find((s: any) => s.kind === 'worked').text).toMatch(/less the 60 min of breaks \(Lunch 45, Rest 15\) = 8h 00m worked\. No break was punched that day, so the fixed breaks apply\./);
    expect(why.matchesRules).toBe(true);
  });

  it('records the change to the breaks with the shift’s other rules', async () => {
    const versions = await runInTenant(hr.orgId, () => peoplePrisma.attendanceRuleVersion.findMany({ where: { orgId: hr.orgId }, orderBy: { version: 'desc' } }));
    const last = JSON.parse(versions[0].rulesJson);
    expect(last).toMatchObject({ kind: 'SHIFT', ref: shift.id });
    expect(last.before.breakMode).toBe('FIXED');
    expect(last.after.breakMode).toBe('PUNCHED');
  });
});
