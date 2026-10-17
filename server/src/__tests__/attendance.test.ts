import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Attendance, native (after Horilla). The day rules have their own pure
 * tests (attendanceCompute.test.ts); these cover the rows around them.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { istDate } = await import('../services/attendance/compute.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(features: Record<string, boolean> = { people: true, attendance: true }): Promise<Ctx> {
  const email = `att.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Att owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Att Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };
  if (Object.keys(features).length) await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
  return ctx;
}

const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
});
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send(body).expect(201)).body.employee;

/** A past weekday: a week ago, stepped back off Saturday and Sunday (the default shift's weekly off). */
const pastWeekday = (() => {
  const d = new Date(Date.now() - 7 * 86_400_000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return istDate(d);
})();

let owner: Ctx;
beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('the switch', () => {
  it('is refused while Attendance is off', async () => {
    const off = await makeOwner({ people: true });
    expect((await api(off).get('/overview').expect(403)).body.code).toBe('ATTENDANCE_DISABLED');
  });
});

describe('marking and checking days', () => {
  it('works a manual day out on the person’s shift, and validates it', async () => {
    const shift = (await api(owner).post('/shifts', { name: `Day ${rnd()}`, startTime: '09:30', endTime: '18:30', weeklyOffDays: '0' }).expect(201)).body.shift;
    const p = await person(owner, { name: 'Ravi Kumar' });
    await api(owner).post('/shift-assignments', { employeeIds: [p.id], shiftId: shift.id, effectiveFrom: '2026-01-01' }).expect(200);

    const marked = (await api(owner).put('/records', { employeeId: p.id, date: pastWeekday, checkIn: '09:55', checkOut: '20:30' }).expect(200)).body.record;
    expect(marked.lateMinutes).toBe(25);
    expect(marked.workedMinutes).toBe(575);
    expect(marked.overtimeMinutes).toBe(95);
    expect(marked.status).toBe('PRESENT');
    expect(marked.checkInTime).toBe('09:55');

    await api(owner).post(`/records/${marked.id}/overtime`, { approved: true }).expect(200);
    expect((await api(owner).post('/records/validate', { ids: [marked.id] }).expect(200)).body.validated).toBe(1);

    /* Correcting a validated day un-validates it and drops the overtime approval. */
    const fixed = (await api(owner).put('/records', { employeeId: p.id, date: pastWeekday, checkIn: '09:30', checkOut: '18:30' }).expect(200)).body.record;
    expect(fixed.validated).toBe(false);
    expect(fixed.overtimeApproved).toBe(false);
    expect(fixed.lateMinutes).toBe(0);
  });

  it('refuses a day in the future and a check-out without a check-in', async () => {
    const p = await person(owner, { name: 'Future' });
    await api(owner).put('/records', { employeeId: p.id, date: '2099-01-01', checkIn: '09:00' }).expect(400);
    await api(owner).put('/records', { employeeId: p.id, date: pastWeekday, checkOut: '18:00' }).expect(400);
  });

  it('marks someone on leave without times', async () => {
    const p = await person(owner, { name: 'Leave Taker' });
    const r = (await api(owner).put('/records', { employeeId: p.id, date: pastWeekday, status: 'ON_LEAVE' }).expect(200)).body.record;
    expect(r.status).toBe('ON_LEAVE');
  });
});

describe('the clock', () => {
  it('says so when the signed-in person has no employee file', async () => {
    const lone = await makeOwner();
    expect((await api(lone).get('/me').expect(404)).body.code).toBe('NO_EMPLOYEE_LINK');
  });

  it('links the sign-in by email, then clocks in and out on the server’s time', async () => {
    const c = await makeOwner();
    await person(c, { name: 'Self Clocker', workEmail: c.email });
    expect((await api(c).get('/me').expect(200)).body.clockedIn).toBe(false);
    const inn = await api(c).post('/clock').expect(200);
    expect(inn.body.kind).toBe('IN');
    expect((await api(c).get('/me').expect(200)).body.clockedIn).toBe(true);
    await api(c).post('/clock', { kind: 'IN' }).expect(409);
    const out = await api(c).post('/clock').expect(200);
    expect(out.body.kind).toBe('OUT');
    expect(out.body.record.checkOut).toBeTruthy();
    await api(c).post('/clock', { kind: 'OUT' }).expect(409);
  });
});

describe('the phone punch in the app', () => {
  const SITE = { latitude: 12.9757, longitude: 77.6061 };
  const FAR = { latitude: 13.0207, longitude: 77.6061 };

  it('is the portal’s punch for a signed-in person: off until HR allows it, then checked against the work sites', async () => {
    const c = await makeOwner();
    const emp = await person(c, { name: 'Self Puncher', workEmail: c.email });
    expect((await api(c).get('/me').expect(200)).body.phone).toMatchObject({ allowed: false, next: 'IN' });
    expect((await api(c).post('/me/punch', { ...SITE, accuracy: 10 }).expect(403)).body.code).toBe('PHONE_OFF');

    await api(c).put('/portal-access', { employeeIds: [emp.id], mobilePunch: true }).expect(200);
    await api(c).post('/geofences', { name: 'MG Road office', ...SITE, radiusMeters: 200 }).expect(201);
    expect((await api(c).post('/me/punch', { ...FAR, accuracy: 10 }).expect(403)).body.code).toBe('OUTSIDE');

    const punched = await api(c).post('/me/punch', { ...SITE, accuracy: 10 }).expect(201);
    expect(punched.body).toMatchObject({ kind: 'IN', site: 'MG Road office', photo: false });
    const me = await api(c).get('/me').expect(200);
    expect(me.body.phone).toMatchObject({ allowed: true, next: 'OUT' });
    expect(me.body.phone.sites.map((x: any) => x.name)).toEqual(['MG Road office']);
    expect(me.body.punches).toHaveLength(1);
    expect(me.body.punches[0]).toMatchObject({ kind: 'IN', phone: true, site: 'MG Road office' });
  });
});

describe('imports', () => {
  it('marks days from rows, says which rows failed, and keeps going', async () => {
    const c = await makeOwner();
    const p = await person(c, { name: 'Imported Day', code: 'IMP1' });
    const r = await api(c).post('/records/import', { rows: [
      { employeeCode: 'IMP1', date: pastWeekday, checkIn: '09:10', checkOut: '18:05' },
      { employeeCode: 'NOPE', date: pastWeekday, checkIn: '09:00' },
      { employeeCode: 'imp1', date: '2026-13-40', checkIn: '09:00' },
      { employeeCode: 'IMP1', date: pastWeekday, status: 'on leave' },
    ] }).expect(200);
    expect(r.body).toMatchObject({ imported: 2, failed: 2 });
    expect(r.body.results.map((x: any) => x.row)).toEqual([2, 3]);
    expect(r.body.results[0].error).toMatch(/No employee with code NOPE/);
    const day = (await api(c).get(`/records?from=${pastWeekday}&to=${pastWeekday}&employeeId=${p.id}`).expect(200)).body.records[0];
    expect(day.status).toBe('ON_LEAVE');
    await api(c).post('/records/import', { rows: [] }).expect(400);
  });

  it('imports holidays once, and shift assignments by shift name', async () => {
    const c = await makeOwner();
    const p = await person(c, { name: 'Shifted', code: 'SH1' });
    const h = await api(c).post('/holidays/import', { rows: [
      { date: '2026-11-01', name: 'Founders Day' },
      { date: '2026-11-01', name: 'founders day' },
      { date: '2026-11-02', name: 'Area day', area: 'Nowhere' },
      { date: 'bad', name: 'X' },
    ] }).expect(200);
    expect(h.body).toMatchObject({ imported: 1, skipped: 1, failed: 2 });
    const shift = (await api(c).post('/shifts', { name: 'Night', startTime: '22:00', endTime: '06:00' }).expect(201)).body.shift;
    const a = await api(c).post('/shift-assignments/import', { rows: [
      { employeeCode: 'SH1', shift: 'night', from: '2026-11-01' },
      { employeeCode: 'SH1', shift: 'Day', from: '2026-11-01' },
      { employeeCode: 'SH1', shift: 'Night', from: '2026-11-10', to: '2026-11-01' },
    ] }).expect(200);
    expect(a.body).toMatchObject({ imported: 1, failed: 2 });
    const mine = (await api(c).get(`/shift-assignments?employeeId=${p.id}`).expect(200)).body.assignments;
    expect(mine.some((x: any) => x.shiftId === shift.id && x.effectiveFrom === '2026-11-01')).toBe(true);
  });
});

describe('corrections', () => {
  it('turns an approved request into the day, and will not approve it twice', async () => {
    const c = await makeOwner();
    const me = await person(c, { name: 'Forgot To Clock', workEmail: c.email });
    const reqRow = (await api(c).post('/me/requests', { date: pastWeekday, checkIn: '09:00', checkOut: '18:00', reason: 'Card reader was down' }).expect(201)).body.request;
    expect((await api(c).get('/requests?status=PENDING').expect(200)).body.requests.map((r: any) => r.id)).toContain(reqRow.id);
    await api(c).post(`/requests/${reqRow.id}/approve`).expect(200);
    await api(c).post(`/requests/${reqRow.id}/approve`).expect(409);
    const day = (await api(c).get(`/records?from=${pastWeekday}&to=${pastWeekday}&employeeId=${me.id}`).expect(200)).body.records[0];
    expect(day.source).toBe('REQUEST');
    expect(day.status).toBe('PRESENT');
  });
});

describe('the month for payroll', () => {
  it('counts holidays as paid and missing past days as loss of pay', async () => {
    const c = await makeOwner();
    const month = '2026-09';
    const p = await person(c, { name: 'Monthly', dateOfJoining: '2026-01-01' });
    await api(c).post('/holidays', { date: '2026-09-15', name: 'Test holiday' }).expect(201);
    await api(c).put('/records', { employeeId: p.id, date: '2026-09-01', checkIn: '09:00', checkOut: '18:00' }).expect(200);
    await api(c).put('/records', { employeeId: p.id, date: '2026-09-02', checkIn: '09:00', checkOut: '14:00' }).expect(200);
    const row = (await api(c).get(`/summary?month=${month}`).expect(200)).body.rows.find((r: any) => r.employeeId === p.id);
    /* September 2026: 30 days, 4 Sundays. One holiday. Present 1, half 1, the rest absent. */
    expect(row).toMatchObject({ totalDays: 30, present: 1, halfDays: 1, holidays: 1, weeklyOffs: 4 });
    expect(row.absent).toBe(30 - 1 - 1 - 1 - 4);
    expect(row.payableDays).toBe(30 - row.absent - 0.5);
  });

  it('includes people with no joining date on file', async () => {
    const c = await makeOwner();
    const p = await person(c, { name: 'No Dates' });
    const rows = (await api(c).get('/summary?month=2026-09').expect(200)).body.rows;
    expect(rows.find((r: any) => r.employeeId === p.id)).toMatchObject({ totalDays: 30 });
  });

  it('will not delete a shift with days on it', async () => {
    const c = await makeOwner();
    const s = (await api(c).post('/shifts', { name: 'Only', startTime: '09:00', endTime: '18:00' }).expect(201)).body.shift;
    const p = await person(c, { name: 'Shifted' });
    const loose = await person(c, { name: 'Unassigned' });
    await api(c).post('/shift-assignments', { employeeIds: [p.id], shiftId: s.id, effectiveFrom: '2026-01-01' }).expect(200);
    await api(c).put('/records', { employeeId: p.id, date: pastWeekday, checkIn: '09:00', checkOut: '18:00' }).expect(200);
    // Someone with no assignment stays on the standard shift, not the org's only shift.
    const day = (await api(c).put('/records', { employeeId: loose.id, date: pastWeekday, checkIn: '09:00', checkOut: '18:00' }).expect(200)).body.record;
    expect(day.shiftId).toBeNull();
    await api(c).del(`/shift-assignments/${(await api(c).get(`/shift-assignments?employeeId=${p.id}`).expect(200)).body.assignments[0].id}`).expect(200);
    await api(c).del(`/shifts/${s.id}`).expect(409);
  });
});
