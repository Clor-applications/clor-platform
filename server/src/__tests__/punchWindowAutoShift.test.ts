import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Batch 2, ERPNext gap 6 (owner 29 Oct 2026): a shift's punch window, and the
 * first punch picking the shift for someone with no schedule of their own.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { recomputeDeviceDay } = await import('../services/attendance/punches.js');
const { pickShift, inPunchWindow } = await import('../services/attendance/autoShift.js');
const { DEFAULT_SHIFT } = await import('../services/attendance/compute.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `pw.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `PW Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const dayOf = async (c: Ctx, employeeId: string, date: string) => (await att(c, 'get', `/records?from=${date}&to=${date}&employeeId=${employeeId}`).expect(200)).body.records[0];
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
/* A past Tuesday, a week or so back: a working day in an open month. */
const day = (() => {
  const d = new Date(Date.now() - 7 * 86_400_000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();
const hhmm = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 16);

/** Reader punches for a day, then the day worked out the way a reader's upload does it. */
async function punch(c: Ctx, employeeId: string, times: string[]) {
  const e = await runInTenant(c.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: employeeId } }));
  for (const t of times) {
    await runInTenant(c.orgId, () => peoplePrisma.devicePunch.create({ data: { accountId: e.accountId, orgId: c.orgId, deviceId: 'reader', serialNumber: 'R1', pin: employeeId, at: ist(day, t), localTime: `${day}T${t}:00`, state: 'IN', employeeId, shiftDate: day } }));
  }
  await runInTenant(c.orgId, () => recomputeDeviceDay(e.accountId, c.orgId, { id: e.id, branchId: e.branchId, areaId: e.areaId }, day));
  return dayOf(c, employeeId, day);
}
const picks = (c: Ctx, employeeId: string) => runInTenant(c.orgId, () => peoplePrisma.temporarySchedule.findMany({ where: { orgId: c.orgId, employeeId, pickedByPunch: true } }));

describe('the punch window and picking a shift, worked out on their own', () => {
  const rule = (startTime: string, endTime: string, before: number | null = null, after: number | null = null) => ({ ...DEFAULT_SHIFT, startTime, endTime, checkInBeforeMinutes: before, checkOutAfterMinutes: after });
  it('counts a punch only inside the window; an unset end does not limit', () => {
    const r = rule('09:00', '18:00', 60, 120);
    expect(inPunchWindow(r, '2026-08-04', ist('2026-08-04', '07:59'))).toBe(false);
    expect(inPunchWindow(r, '2026-08-04', ist('2026-08-04', '08:00'))).toBe(true);
    expect(inPunchWindow(r, '2026-08-04', ist('2026-08-04', '20:00'))).toBe(true);
    expect(inPunchWindow(r, '2026-08-04', ist('2026-08-04', '20:01'))).toBe(false);
    expect(inPunchWindow(rule('09:00', '18:00'), '2026-08-04', ist('2026-08-04', '03:00'))).toBe(true);
  });
  it('picks the shift whose start is nearest, among those the punch can open', () => {
    const shifts = [
      { id: 'morning', rule: rule('06:00', '14:00') },
      { id: 'general', rule: rule('09:00', '18:00', 30) },
      { id: 'evening', rule: rule('14:00', '22:00') },
    ];
    expect(pickShift(shifts, '2026-08-04', ist('2026-08-04', '05:50'))).toBe('morning');
    expect(pickShift(shifts, '2026-08-04', ist('2026-08-04', '08:40'))).toBe('general');
    /* 08:20 is before General's 30-minute window opens, so Morning (started 06:00) is the one it can be. */
    expect(pickShift(shifts, '2026-08-04', ist('2026-08-04', '08:20'))).toBe('morning');
    expect(pickShift(shifts, '2026-08-04', ist('2026-08-04', '13:40'))).toBe('evening');
    expect(pickShift(shifts, '2026-08-04', ist('2026-08-04', '22:30'))).toBe(null);
  });
});

describe('punch window and first-punch shift on a real day', () => {
  let c: Ctx;
  let morning: any;
  let general: any;
  let evening: any;
  beforeAll(async () => {
    c = await company();
    morning = (await att(c, 'post', '/shifts', { name: 'Morning', startTime: '06:00', endTime: '14:00', autoPick: true, weeklyOffDays: '' }).expect(201)).body.shift;
    general = (await att(c, 'post', '/shifts', { name: 'General', startTime: '09:00', endTime: '18:00', checkInBeforeMinutes: 60, checkOutAfterMinutes: 120, autoPick: true, weeklyOffDays: '' }).expect(201)).body.shift;
    evening = (await att(c, 'post', '/shifts', { name: 'Evening', startTime: '14:00', endTime: '22:00', autoPick: true, weeklyOffDays: '' }).expect(201)).body.shift;
  }, 60_000);

  it('a shift keeps its window, and the window is checked', async () => {
    expect(general).toMatchObject({ checkInBeforeMinutes: 60, checkOutAfterMinutes: 120, autoPick: true });
    expect((await att(c, 'post', '/shifts', { name: 'Too wide', startTime: '09:00', endTime: '18:00', checkInBeforeMinutes: 800 }).expect(400)).body.error).toMatch(/12 hours/);
  });

  it('a punch outside the window does not make the day', async () => {
    const p = await person(c, { name: 'Window', code: `W${rnd()}` });
    await att(c, 'post', '/shift-assignments', { employeeIds: [p.id], shiftId: general.id, effectiveFrom: '2026-01-01' }).expect(200);
    const rec = await punch(c, p.id, ['06:30', '09:05', '18:20', '21:30']);
    expect(hhmm(new Date(rec.checkIn))).toBe('09:05');
    expect(hhmm(new Date(rec.checkOut))).toBe('18:20');
  });

  it('off by default: nothing is picked', async () => {
    const p = await person(c, { name: 'Off', code: `O${rnd()}` });
    await punch(c, p.id, ['13:50', '22:05']);
    expect(await picks(c, p.id)).toHaveLength(0);
  });

  it('on: the first punch picks the shift, a later earlier punch picks again, a hand-written schedule is never touched', async () => {
    const rules = (await att(c, 'get', '/rules').expect(200)).body.rules;
    expect(rules.autoShiftByPunch).toBe(false);
    const saved = (await att(c, 'put', '/rules', { ...rules, autoShiftByPunch: true }).expect(200)).body.rules;
    expect(saved.autoShiftByPunch).toBe(true);

    const free = await person(c, { name: 'Free', code: `F${rnd()}` });
    const rec = await punch(c, free.id, ['13:50', '22:05']);
    expect(rec.shiftId).toBe(evening.id);
    expect((await picks(c, free.id)).map((t) => [t.shiftId, t.fromDate, t.toDate])).toEqual([[evening.id, day, day]]);
    /* A punch at 05:55 reaches CLOR later (a reader that was offline): the first punch is now 05:55. */
    const again = await punch(c, free.id, ['05:55']);
    expect(again.shiftId).toBe(morning.id);
    expect((await picks(c, free.id)).map((t) => t.shiftId)).toEqual([morning.id]);

    const assigned = await person(c, { name: 'Assigned', code: `A${rnd()}` });
    await att(c, 'post', '/shift-assignments', { employeeIds: [assigned.id], shiftId: general.id, effectiveFrom: '2026-01-01' }).expect(200);
    expect((await punch(c, assigned.id, ['13:55', '22:00'])).shiftId).toBe(general.id);
    expect(await picks(c, assigned.id)).toHaveLength(0);

    const told = await person(c, { name: 'Told', code: `T${rnd()}` });
    const e = await runInTenant(c.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: told.id } }));
    await runInTenant(c.orgId, () => peoplePrisma.temporarySchedule.create({ data: { accountId: e.accountId, orgId: c.orgId, employeeId: told.id, shiftId: general.id, fromDate: day, toDate: day, reason: 'Shift change', createdByUserId: 'hr' } }));
    expect((await punch(c, told.id, ['05:58', '14:00'])).shiftId).toBe(general.id);
    expect(await picks(c, told.id)).toHaveLength(0);
  }, 60_000);
});

describe('import attendance: the check names repeats and the days it would replace (batch 2, gap 5)', () => {
  it('a person and day twice is refused, and a day already recorded is named with how it was made', async () => {
    const c = await company();
    const p = await person(c, { name: 'Imported', code: `I${rnd()}` });
    const q = await person(c, { name: 'Fresh', code: `J${rnd()}` });
    await punch(c, p.id, ['09:02', '18:01']);
    const rows = [
      { employeeCode: p.code, date: day, checkIn: '09:00', checkOut: '18:00' },
      { employeeCode: q.code, date: day, checkIn: '09:10', checkOut: '18:00' },
      { employeeCode: q.code, date: day, checkIn: '09:30', checkOut: '18:00' },
    ];
    const check = (await att(c, 'post', '/records/import', { rows, dryRun: true }).expect(200)).body;
    expect(check).toMatchObject({ dryRun: true, imported: 2, failed: 1, replacing: [{ row: 1, source: 'DEVICE' }] });
    expect(check.results).toEqual([{ row: 3, ok: false, error: 'Same person and day as row 2. Keep one of them.' }]);
    /* Nothing was saved by the check. */
    expect(await dayOf(c, q.id, day)).toBeUndefined();
    const done = (await att(c, 'post', '/records/import', { rows: rows.slice(0, 2) }).expect(200)).body;
    expect(done).toMatchObject({ imported: 2, failed: 0 });
    expect(hhmm(new Date((await dayOf(c, q.id, day)).checkIn))).toBe('09:10');
  }, 60_000);
});
