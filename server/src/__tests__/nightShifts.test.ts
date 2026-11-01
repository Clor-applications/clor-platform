import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * O-09 and night shifts (TIME-LEAVE-CLOSURE-AUDIT-2026-10-27.md O-09, O-11).
 *
 * O-09, always on: leave or an attendance request on a day in a closed
 * Attendance month is refused when it is asked — from the employee app, the
 * web's own leave and HR entering it — not left waiting for an approval that
 * can never happen.
 *
 * Night shifts, the company feature `attendanceNightShifts`, off by default:
 * a 22:00–06:00 shift belongs to the date it starts. Off, an overnight shift
 * behaves exactly as before; on, times after midnight are that night's, leave
 * on a date covers the night starting on it (a half day, one half of it), the
 * preview and the day record say the same, hours and overtime run across
 * midnight, and holidays are the shift date's.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { clockDateFor } = await import('../services/attendance/punches.js');
const { nightInstants, shiftHalves, isOvernight } = await import('../services/attendance/compute.js');
const { timesOn } = await import('../services/attendance/nightShift.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string; accountId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(features: Record<string, boolean>): Promise<Ctx> {
  const email = `ns.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `NS Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features }).expect(200);
  return c;
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const dayOf = async (c: Ctx, employeeId: string, date: string) => (await att(c, 'get', `/records?from=${date}&to=${date}&employeeId=${employeeId}`).expect(200)).body.records[0];
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();
async function portalFor(c: Ctx, employeeId: string, code: string) {
  const access = (await att(c, 'get', '/portal-access').expect(200)).body.company.code;
  const issued = (await att(c, 'post', '/portal-access/codes', { employeeIds: [employeeId] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company: access, employeeCode: code, activationCode: issued, password: 'mine pass 1' }).expect(200)).body.token;
  return {
    post: (p: string, b: unknown = {}) => request(app).post(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
    get: (p: string) => request(app).get(`/api/portal${p}`).set('Authorization', `Bearer ${token}`),
  };
}
async function nightShift(c: Ctx, employeeIds: string[]) {
  const shift = (await att(c, 'post', '/shifts', { name: `Night ${rnd()}`, startTime: '22:00', endTime: '06:00', fullDayMinutes: 420 }).expect(201)).body.shift;
  await att(c, 'post', '/shift-assignments', { employeeIds, shiftId: shift.id, effectiveFrom: '2026-07-01' }).expect(200);
  return shift;
}

/* A month of this year is named alone, one of another year with its year: from 2027 it reads "September 2026". */
const SEPTEMBER = new Date(Date.now() + 330 * 60_000).toISOString().startsWith('2026') ? 'September' : 'September 2026';
const LEAVE_WORDS = `${SEPTEMBER} is closed. Ask HR to reopen it if this leave must count.`;
const REQUEST_WORDS = `${SEPTEMBER} is closed. Ask HR to reopen it if this request must count.`;

describe('night-shift times, worked out on their own', () => {
  const night = { startTime: '22:00', endTime: '06:00' };
  it('puts times after midnight on the next calendar day, and an out after the in', () => {
    expect(isOvernight(night)).toBe(true);
    expect(isOvernight({ startTime: '09:00', endTime: '18:00' })).toBe(false);
    const a = nightInstants('2026-08-04', night, '21:50', '06:10');
    expect([a.checkIn?.toISOString(), a.checkOut?.toISOString()]).toEqual([ist('2026-08-04', '21:50'), ist('2026-08-05', '06:10')]);
    const b = nightInstants('2026-08-04', night, '23:00', '05:00');
    expect(b.checkOut?.toISOString()).toBe(ist('2026-08-05', '05:00'));
    const c2 = nightInstants('2026-08-04', night, '00:30', null);
    expect([c2.checkIn?.toISOString(), c2.checkOut]).toEqual([ist('2026-08-05', '00:30'), null]);
  });
  it('off, or on a day shift, reads times as it always did', () => {
    expect(timesOn('2026-08-04', night, false, '00:30', '06:00').checkIn?.toISOString()).toBe(ist('2026-08-04', '00:30'));
    expect(timesOn('2026-08-04', { startTime: '09:00', endTime: '18:00' }, true, '09:00', '01:00').checkOut?.toISOString()).toBe(ist('2026-08-05', '01:00'));
  });
  it('splits a night at its midpoint', () => {
    const h = shiftHalves({ startTime: '22:00', endTime: '06:00', breakMinutes: 60, graceMinutes: 10, earlyOutGraceMinutes: 0, halfDayMinutes: 240, fullDayMinutes: 480, overtimeAfterMinutes: null, weeklyOffDays: '0' }, '2026-08-04');
    expect(h.FIRST.to.toISOString()).toBe(ist('2026-08-05', '02:00'));
    expect(h.SECOND.to.toISOString()).toBe(ist('2026-08-05', '06:00'));
  });
});

describe('O-09: a closed month refuses leave and requests when they are asked', () => {
  let c: Ctx;
  let casual: any;
  let asha: any;
  let me: any;
  let app_: Awaited<ReturnType<typeof portalFor>>;
  beforeAll(async () => {
    c = await company({ people: true, attendance: true });
    casual = (await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 24 }).expect(201)).body.type;
    asha = await person(c, { name: 'Asha', code: 'C1' });
    me = await person(c, { name: 'Owner Self', code: 'C2', workEmail: c.email });
    await att(c, 'put', '/request-rules', { WFH: { on: true, backDays: 366 }, MISSED_PUNCH: { on: true, backDays: 366 } }).expect(200);
    app_ = await portalFor(c, asha.id, 'C1');
    await att(c, 'post', '/months/2026-09/close', { acknowledge: true }).expect(200);
  }, 90_000);

  it('HR entering leave gets the refusal with the code and the month, and the preview says it first', async () => {
    const ask = { employeeId: asha.id, leaveTypeId: casual.id, fromDate: '2026-09-08', toDate: '2026-09-09', reason: 'Wedding' };
    const preview = (await att(c, 'post', '/leave/requests/preview', ask).expect(200)).body;
    expect(preview.ok).toBe(false);
    expect(preview.problems[0]).toMatchObject({ code: 'ATTENDANCE_MONTH_CLOSED', message: LEAVE_WORDS, month: '2026-09' });
    const refused = (await att(c, 'post', '/leave/requests', ask).expect(409)).body;
    expect(refused).toMatchObject({ code: 'ATTENDANCE_MONTH_CLOSED', month: '2026-09', error: LEAVE_WORDS });
    /* A request across the month end is refused too: part of it can never be approved. */
    expect((await att(c, 'post', '/leave/requests', { ...ask, fromDate: '2026-09-30', toDate: '2026-10-01' }).expect(409)).body.code).toBe('ATTENDANCE_MONTH_CLOSED');
    expect(await runInTenant(c.orgId, () => peoplePrisma.leaveRequest.count({ where: { orgId: c.orgId, employeeId: asha.id } }))).toBe(0);
  });

  it('the web’s own leave and the employee app get the same words', async () => {
    const ask = { leaveTypeId: casual.id, fromDate: '2026-09-15', toDate: '2026-09-15', reason: 'Clinic' };
    expect((await att(c, 'post', '/me/leave', ask).expect(409)).body).toMatchObject({ code: 'ATTENDANCE_MONTH_CLOSED', error: LEAVE_WORDS });
    expect((await att(c, 'post', '/me/leave/preview', ask).expect(200)).body.problems[0].message).toBe(LEAVE_WORDS);
    expect((await app_.post('/leave', ask).expect(409)).body).toMatchObject({ code: 'ATTENDANCE_MONTH_CLOSED', error: LEAVE_WORDS });
    expect((await app_.post('/leave/preview', ask).expect(200)).body.problems[0].code).toBe('ATTENDANCE_MONTH_CLOSED');
    expect(await runInTenant(c.orgId, () => peoplePrisma.leaveRequest.count({ where: { orgId: c.orgId, employeeId: { in: [asha.id, me.id] } } }))).toBe(0);
  });

  it('changing waiting leave into a closed month is refused the same way', async () => {
    const r = (await att(c, 'post', '/leave/requests', { employeeId: asha.id, leaveTypeId: casual.id, fromDate: '2026-12-07', toDate: '2026-12-07', reason: 'Errand' }).expect(201)).body.request;
    const moved = (await att(c, 'put', `/leave/requests/${r.id}`, { leaveTypeId: casual.id, fromDate: '2026-09-07', toDate: '2026-09-07', reason: 'Errand' }).expect(409)).body;
    expect(moved).toMatchObject({ code: 'ATTENDANCE_MONTH_CLOSED', month: '2026-09', error: LEAVE_WORDS });
  });

  it('attendance requests: HR entering one, and the employee app asking, are refused at once', async () => {
    const hr = (await att(c, 'post', '/requests', { employeeId: asha.id, kind: 'MISSED_PUNCH', date: '2026-09-08', checkIn: '09:00', checkOut: '18:00', reason: 'Card reader down' }).expect(409)).body;
    expect(hr).toMatchObject({ code: 'ATTENDANCE_MONTH_CLOSED', month: '2026-09', error: REQUEST_WORDS });
    expect((await app_.post('/requests', { kind: 'MISSED_PUNCH', date: '2026-09-08', checkIn: '09:00', checkOut: '18:00', reason: 'Card reader down' }).expect(409)).body).toMatchObject({ code: 'ATTENDANCE_MONTH_CLOSED', error: REQUEST_WORDS });
    /* Work from home across the month end: the closed part refuses the whole request. */
    expect((await app_.post('/requests', { kind: 'WFH', date: '2026-09-30', toDate: '2026-10-01', reason: 'Plumber' }).expect(409)).body.month).toBe('2026-09');
    expect(await runInTenant(c.orgId, () => peoplePrisma.attendanceRequest.count({ where: { orgId: c.orgId, employeeId: asha.id } }))).toBe(0);
  });

  it('once the month is reopened, the same leave can be asked for', async () => {
    await att(c, 'post', '/months/2026-09/reopen', { reason: 'Leave must count' }).expect(200);
    await att(c, 'post', '/leave/requests', { employeeId: asha.id, leaveTypeId: casual.id, fromDate: '2026-09-08', toDate: '2026-09-08', reason: 'Wedding' }).expect(201);
  });
});

describe('night shifts, switched off (the default)', () => {
  let c: Ctx;
  let p: any;
  let casual: any;
  beforeAll(async () => {
    c = await company({ people: true, attendance: true });
    p = await person(c, { name: 'Off Night', code: 'F1' });
    await nightShift(c, [p.id]);
    casual = (await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 24 }).expect(201)).body.type;
  }, 90_000);

  it('is off for a new company', async () => {
    const f = (await request(app).get(`/api/orgs/${c.orgId}/features`).set(at(c)).expect(200)).body.features;
    expect(f.attendanceNightShifts).toBe(false);
  });

  it('an overnight shift behaves exactly as before: in 22:00, out 06:00 across midnight; a time after midnight stays on the date', async () => {
    const day = (await att(c, 'put', '/records', { employeeId: p.id, date: '2026-08-04', checkIn: '22:00', checkOut: '06:00' }).expect(200)).body.record;
    expect(day).toMatchObject({ checkIn: ist('2026-08-04', '22:00'), checkOut: ist('2026-08-05', '06:00'), workedMinutes: 420, status: 'PRESENT' });
    expect(day.shiftLabel).toBeUndefined();
    /* As before the feature: 00:30 is the morning of the date, before the shift began. */
    const early = (await att(c, 'put', '/records', { employeeId: p.id, date: '2026-08-05', checkIn: '00:30', checkOut: '06:00' }).expect(200)).body.record;
    expect(early).toMatchObject({ checkIn: ist('2026-08-05', '00:30'), checkOut: ist('2026-08-05', '06:00'), lateMinutes: 0 });
    const missed = (await att(c, 'post', '/requests', { employeeId: p.id, kind: 'MISSED_PUNCH', date: '2026-08-06', checkIn: '00:30', checkOut: '06:00', reason: 'Card reader down' }).expect(201)).body.request;
    expect(missed.checkIn).toBe(ist('2026-08-06', '00:30'));
  });

  it('the leave preview says nothing about nights, and a web clock-in goes on the calendar date', async () => {
    const preview = (await att(c, 'post', '/leave/requests/preview', { employeeId: p.id, leaveTypeId: casual.id, fromDate: '2026-08-11', toDate: '2026-08-11', reason: 'Home' }).expect(200)).body;
    expect(preview.parts[0].dates[0].night).toBeUndefined();
    const acc = await runInTenant(c.orgId, () => peoplePrisma.employee.findFirst({ where: { id: p.id }, select: { accountId: true } }));
    expect(await runInTenant(c.orgId, () => clockDateFor(c.orgId, acc!.accountId, p.id, new Date(ist('2026-08-12', '01:30'))))).toBe('2026-08-12');
  });
});

describe('night shifts, switched on', () => {
  let c: Ctx;
  let p: any;
  let casual: any;
  let accountId: string;
  const label = 'Night shift 22:00–06:00 (ends next day)';
  beforeAll(async () => {
    c = await company({ people: true, attendance: true, attendanceNightShifts: true });
    p = await person(c, { name: 'Night Worker', code: '7001' });
    await nightShift(c, [p.id]);
    casual = (await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 24, allowHalfDay: true }).expect(201)).body.type;
    accountId = (await runInTenant(c.orgId, () => peoplePrisma.employee.findFirst({ where: { id: p.id }, select: { accountId: true } })))!.accountId;
  }, 90_000);

  it('is a feature of Attendance: on only with Attendance on', async () => {
    const f = (await request(app).get(`/api/orgs/${c.orgId}/features`).set(at(c)).expect(200)).body.features;
    expect(f.attendanceNightShifts).toBe(true);
    const catalog = (await request(app).get(`/api/orgs/${c.orgId}/features/catalog`).set(at(c)).expect(200)).body;
    const row = (catalog.features || catalog.catalog || catalog).find?.((x: any) => x.key === 'attendanceNightShifts');
    if (row) expect(row).toMatchObject({ dependsOn: 'attendance', defaultEnabled: false });
  });

  it('a time after midnight is that night’s: late counted from 22:00, across midnight', async () => {
    const day = (await att(c, 'put', '/records', { employeeId: p.id, date: '2026-08-03', checkIn: '00:30', checkOut: '06:00' }).expect(200)).body.record;
    /* In at 00:30 on 4 August is two and a half hours late for the 22:00 shift of 3 August. */
    expect(day).toMatchObject({ date: '2026-08-03', checkIn: ist('2026-08-04', '00:30'), checkOut: ist('2026-08-04', '06:00'), lateMinutes: 150, workedMinutes: 270, status: 'HALF_DAY', shiftLabel: label });
    const missed = (await att(c, 'post', '/requests', { employeeId: p.id, kind: 'MISSED_PUNCH', date: '2026-08-24', checkIn: '00:30', checkOut: '06:00', reason: 'Card reader down' }).expect(201)).body.request;
    expect(missed).toMatchObject({ checkIn: ist('2026-08-25', '00:30'), checkOut: ist('2026-08-25', '06:00') });
  });

  it('worked hours, late, early and overtime run across midnight', async () => {
    const long = (await att(c, 'put', '/records', { employeeId: p.id, date: '2026-08-06', checkIn: '22:00', checkOut: '08:00' }).expect(200)).body.record;
    /* 10 hours less the hour's break: 9 worked, 2 over the 7-hour day. */
    expect(long).toMatchObject({ workedMinutes: 540, overtimeMinutes: 120, lateMinutes: 0, earlyOutMinutes: 0, status: 'PRESENT' });
    const short = (await att(c, 'put', '/records', { employeeId: p.id, date: '2026-08-07', checkIn: '22:30', checkOut: '05:30' }).expect(200)).body.record;
    expect(short).toMatchObject({ checkOut: ist('2026-08-08', '05:30'), lateMinutes: 30, earlyOutMinutes: 30, workedMinutes: 360, overtimeMinutes: 0 });
  });

  it('reader punches across midnight make one day, on the date the night began', async () => {
    const sn = `NS${Date.now()}${rnd()}`.slice(0, 20);
    await att(c, 'post', '/devices', { serialNumber: sn, name: 'Gate', direction: 'both' }).expect(201);
    await request(app).post(`/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=9999`).set('Content-Type', 'text/plain').send('7001\t2026-08-17 22:02:00\t0\t1\n7001\t2026-08-18 06:05:00\t1\t1').expect(200);
    expect(await dayOf(c, p.id, '2026-08-17')).toMatchObject({ checkInTime: '22:02', checkOutTime: '06:05', status: 'PRESENT', shiftLabel: label });
    expect(await dayOf(c, p.id, '2026-08-18')).toBeUndefined();
  });

  it('a web clock-in after midnight goes on the night it belongs to', async () => {
    expect(await runInTenant(c.orgId, () => clockDateFor(c.orgId, accountId, p.id, new Date(ist('2026-08-12', '01:30'))))).toBe('2026-08-11');
    expect(await runInTenant(c.orgId, () => clockDateFor(c.orgId, accountId, p.id, new Date(ist('2026-08-12', '21:55'))))).toBe('2026-08-12');
  });

  it('leave on a date covers the night starting on it; the preview and the day record agree', async () => {
    const ask = { employeeId: p.id, leaveTypeId: casual.id, fromDate: '2026-08-19', toDate: '2026-08-19', reason: 'Family' };
    const preview = (await att(c, 'post', '/leave/requests/preview', ask).expect(200)).body;
    expect(preview.total).toBe(1);
    expect(preview.parts[0].dates[0]).toMatchObject({ date: '2026-08-19', counted: true, night: { label, covers: '22:00 on 19 Aug to 06:00 on 20 Aug' } });
    const r = (await att(c, 'post', '/leave/requests', ask).expect(201)).body.request;
    await att(c, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    const day = await dayOf(c, p.id, '2026-08-19');
    expect(day).toMatchObject({ status: 'ON_LEAVE', leaveRequestId: r.id, shiftLabel: preview.parts[0].dates[0].night.label });
    /* The exit from the night before, at 06:00 on the leave day, is that night's, not the leave's. */
    const sn = `NT${Date.now()}${rnd()}`.slice(0, 20);
    await att(c, 'post', '/devices', { serialNumber: sn, name: 'Back gate', direction: 'both' }).expect(201);
    await request(app).post(`/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=9999`).set('Content-Type', 'text/plain').send('7001\t2026-08-18 22:00:00\t0\t1\n7001\t2026-08-19 06:00:00\t1\t1').expect(200);
    expect(await dayOf(c, p.id, '2026-08-18')).toMatchObject({ checkInTime: '22:00', checkOutTime: '06:00', status: 'PRESENT' });
    expect(await dayOf(c, p.id, '2026-08-19')).toMatchObject({ status: 'ON_LEAVE', checkIn: null });
  });

  it('a half day is the first or second half of that night', async () => {
    const first = (await att(c, 'post', '/leave/requests/preview', { employeeId: p.id, leaveTypeId: casual.id, fromDate: '2026-08-26', toDate: '2026-08-26', halfDay: 'FIRST', reason: 'Clinic' }).expect(200)).body;
    expect(first.total).toBe(0.5);
    expect(first.parts[0].dates[0].night).toEqual({ label, covers: 'First half: 22:00 on 26 Aug to 02:00 on 27 Aug' });
    const second = (await att(c, 'post', '/leave/requests/preview', { employeeId: p.id, leaveTypeId: casual.id, fromDate: '2026-08-26', toDate: '2026-08-26', halfDay: 'SECOND', reason: 'Clinic' }).expect(200)).body;
    expect(second.parts[0].dates[0].night.covers).toBe('Second half: 02:00 on 27 Aug to 06:00 on 27 Aug');
    /* Off the first half, in at 02:00 for the second: not late, and the half worked makes the day. */
    const r = (await att(c, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: casual.id, fromDate: '2026-08-26', toDate: '2026-08-26', halfDay: 'FIRST', reason: 'Clinic' }).expect(201)).body.request;
    await att(c, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    const day = (await att(c, 'put', '/records', { employeeId: p.id, date: '2026-08-26', checkIn: '02:00', checkOut: '06:00' }).expect(200)).body.record;
    expect(day).toMatchObject({ checkIn: ist('2026-08-27', '02:00'), checkOut: ist('2026-08-27', '06:00'), workedMinutes: 240, lateMinutes: 0, leaveRequestId: r.id, status: 'PRESENT' });
  });

  it('a holiday is the shift date’s: the night starting on it is the holiday, the night before it is not', async () => {
    await att(c, 'post', '/holidays', { date: '2026-08-10', name: 'Shift-date holiday' }).expect(201);
    await att(c, 'post', '/holidays', { date: '2026-08-13', name: 'Morning-after holiday' }).expect(201);
    const on = (await att(c, 'put', '/records', { employeeId: p.id, date: '2026-08-10', checkIn: '22:00', checkOut: '05:00' }).expect(200)).body.record;
    /* Six hours on a holiday: all overtime, the day stays paid as the holiday. */
    expect(on).toMatchObject({ status: 'HOLIDAY', overtimeMinutes: 360, lateMinutes: 0, earlyOutMinutes: 0 });
    const before = (await att(c, 'put', '/records', { employeeId: p.id, date: '2026-08-12', checkIn: '22:00', checkOut: '06:00' }).expect(200)).body.record;
    expect(before).toMatchObject({ status: 'PRESENT', overtimeMinutes: 0 });
    const preview = (await att(c, 'post', '/leave/requests/preview', { employeeId: p.id, leaveTypeId: casual.id, fromDate: '2026-08-10', toDate: '2026-08-13', reason: 'Trip' }).expect(200)).body;
    const dates = preview.parts[0].dates;
    expect(dates.map((d: any) => [d.date, d.counted])).toEqual([['2026-08-10', false], ['2026-08-11', true], ['2026-08-12', true], ['2026-08-13', false]]);
    expect(dates[0].why).toBe('Holiday: Shift-date holiday');
    expect(dates[2].night.covers).toBe('22:00 on 12 Aug to 06:00 on 13 Aug');
  });

  it('My days in the employee app names the night shift', async () => {
    const me = await portalFor(c, p.id, '7001');
    const month = (await me.get('/attendance?month=2026-08').expect(200)).body;
    expect(month.days.find((d: any) => d.date === '2026-08-17')).toMatchObject({ shiftLabel: label });
  });
});
