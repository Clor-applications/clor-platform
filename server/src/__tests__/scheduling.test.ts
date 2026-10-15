import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Scheduling (ClorTime's Shift and Schedule modules): one resolver for who
 * works what — temporary > own schedule > rotation > department > company
 * default — rotations with offsets, nth-Saturday offs, area holidays, the
 * late-arrival penalty, the calendar and recomputing after a change.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { rotationSlot } = await import('../services/attendance/schedule.js');
const { isWeeklyOff, monthSummary, DEFAULT_SHIFT } = await import('../services/attendance/compute.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `sch.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Sched owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Sched Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { attendance: true } }).expect(200);
  return ctx;
}
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const ppl = (c: Ctx) => ({
  post: (p: string, b: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
});
const shift = async (c: Ctx, name: string, startTime: string, endTime: string, extra: Record<string, unknown> = {}) =>
  (await att(c).post('/shifts', { name, startTime, endTime, breakMinutes: 0, ...extra }).expect(201)).body.shift;
const cell = async (c: Ctx, month: string, employeeId: string, d: string) =>
  (await att(c).get(`/schedule?month=${month}`).expect(200)).body.rows.find((r: any) => r.employeeId === employeeId).cells.find((x: any) => x.date === d);

describe('the rules, pure', () => {
  it('counts rotation steps from the anchor, with offsets staggering crews', () => {
    // Weekly two-step rotation anchored on Monday 7 Sep 2026.
    expect(rotationSlot('2026-09-07', '2026-09-07', 7, 2)).toBe(0);
    expect(rotationSlot('2026-09-13', '2026-09-07', 7, 2)).toBe(0);
    expect(rotationSlot('2026-09-14', '2026-09-07', 7, 2)).toBe(1);
    expect(rotationSlot('2026-09-21', '2026-09-07', 7, 2)).toBe(0);
    expect(rotationSlot('2026-09-07', '2026-09-07', 7, 2, 1)).toBe(1);
    expect(rotationSlot('2026-09-06', '2026-09-07', 7, 2)).toBeNull();
  });

  it('gives the nth Saturdays off', () => {
    const rule = { ...DEFAULT_SHIFT, offSaturdays: '2,4' };
    // September 2026 Saturdays: 5, 12, 19, 26.
    expect(['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26'].map((d) => isWeeklyOff(rule, d))).toEqual([false, true, false, true]);
    expect(isWeeklyOff(rule, '2026-09-06')).toBe(true); // Sunday
  });

  it('turns every third late day past the allowance into half a day’s loss of pay', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-07', '2026-09-08'];
    const records = new Map(days.map((d) => [d, { status: 'PRESENT' as const, lateMinutes: 20, overtimeMinutes: 0, overtimeApproved: false }]));
    const r = monthSummary({ days, records, shift: () => DEFAULT_SHIFT, holidays: new Set(), today: '2026-12-31', lateAllowance: 1, latePenaltyEvery: 3 });
    // 7 late; 1 free; 6 left → 2 penalties → 1 day.
    expect(r).toMatchObject({ lateCount: 7, latePenaltyDays: 1, lossOfPayDays: 1, payableDays: days.length - 1 });
  });
});

describe('who works what', () => {
  let c: Ctx;
  let general: any;
  let night: any;
  let morning: any;
  let dept: any;
  beforeAll(async () => {
    c = await makeOwner();
    general = await shift(c, 'General', '09:00', '18:00', { code: 'G' });
    night = await shift(c, 'Night', '22:00', '06:00', { code: 'N' });
    morning = await shift(c, 'Morning', '06:00', '14:00', { code: 'M' });
    dept = (await ppl(c).post('/structure/departments', { name: 'Production' }).expect(201)).body.item;
  }, 60_000);

  it('applies temporary > own > rotation > department > company default', async () => {
    const p = (await ppl(c).post('/employees', { name: 'Layered', code: 'L1', departmentId: dept.id, dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    // Nothing yet: the standard 09:00–18:00.
    expect(await cell(c, '2026-09', p.id, '2026-09-08')).toMatchObject({ shiftId: null, name: 'Standard', source: 'DEFAULT' });
    await att(c).put('/rules', { defaultShiftId: general.id, lateAllowancePerMonth: 0, latePenaltyEvery: 0 }).expect(200);
    expect(await cell(c, '2026-09', p.id, '2026-09-08')).toMatchObject({ code: 'G', source: 'DEFAULT' });
    await att(c).post('/department-schedules', { departmentId: dept.id, shiftId: morning.id, effectiveFrom: '2026-09-01' }).expect(201);
    expect(await cell(c, '2026-09', p.id, '2026-09-08')).toMatchObject({ code: 'M', source: 'DEPARTMENT' });
    const rot = (await att(c).post('/rotations', { name: `Days/Nights ${rnd()}`, sequence: [general.id, night.id], periodDays: 7, anchorDate: '2026-09-07' }).expect(201)).body.rotation;
    await att(c).post(`/rotations/${rot.id}/assignments`, { employeeIds: [p.id], startsOn: '2026-09-07' }).expect(201);
    expect(await cell(c, '2026-09', p.id, '2026-09-08')).toMatchObject({ code: 'G', source: 'ROTATION' });
    expect(await cell(c, '2026-09', p.id, '2026-09-15')).toMatchObject({ code: 'N', source: 'ROTATION' });
    await att(c).post('/shift-assignments', { employeeIds: [p.id], shiftId: morning.id, effectiveFrom: '2026-09-14', effectiveTo: '2026-09-20' }).expect(200);
    expect(await cell(c, '2026-09', p.id, '2026-09-15')).toMatchObject({ code: 'M', source: 'EMPLOYEE' });
    expect(await cell(c, '2026-09', p.id, '2026-09-22')).toMatchObject({ code: 'G', source: 'ROTATION' }); // own schedule ended
    await att(c).post('/temporary-schedules', { employeeIds: [p.id], shiftId: night.id, fromDate: '2026-09-16', toDate: '2026-09-16', reason: 'Cover' }).expect(201);
    expect(await cell(c, '2026-09', p.id, '2026-09-16')).toMatchObject({ code: 'N', source: 'TEMPORARY' });
  });

  it('staggers two crews on one rotation by an offset', async () => {
    const a = (await ppl(c).post('/employees', { name: 'Crew A', code: 'CA', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    const b = (await ppl(c).post('/employees', { name: 'Crew B', code: 'CB', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    const rot = (await att(c).post('/rotations', { name: `Crews ${rnd()}`, sequence: [morning.id, night.id], periodDays: 7, anchorDate: '2026-09-07' }).expect(201)).body.rotation;
    await att(c).post(`/rotations/${rot.id}/assignments`, { employeeIds: [a.id], slotOffset: 0, startsOn: '2026-09-07' }).expect(201);
    await att(c).post(`/rotations/${rot.id}/assignments`, { employeeIds: [b.id], slotOffset: 1, startsOn: '2026-09-07' }).expect(201);
    expect([(await cell(c, '2026-09', a.id, '2026-09-08')).code, (await cell(c, '2026-09', b.id, '2026-09-08')).code]).toEqual(['M', 'N']);
    expect([(await cell(c, '2026-09', a.id, '2026-09-15')).code, (await cell(c, '2026-09', b.id, '2026-09-15')).code]).toEqual(['N', 'M']);
    await request(app).delete(`/api/orgs/${c.orgId}/attendance/rotations/${rot.id}`).set(at(c)).expect(409);
  });

  it('keeps holidays to the area they belong to', async () => {
    const plant = (await ppl(c).post('/structure/areas', { name: `Plant ${rnd()}` }).expect(201)).body.item;
    const inPlant = (await ppl(c).post('/employees', { name: 'Plant Person', code: 'PP', areaId: plant.id, dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    const office = (await ppl(c).post('/employees', { name: 'Office Person', code: 'OP', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    await att(c).post('/holidays', { date: '2026-09-17', name: 'Plant foundation day', areaId: plant.id }).expect(201);
    expect((await cell(c, '2026-09', inPlant.id, '2026-09-17')).kind).toBe('HOLIDAY');
    expect((await cell(c, '2026-09', office.id, '2026-09-17')).kind).toBe('WORK');
    const summary = (await att(c).get('/summary?month=2026-09').expect(200)).body.rows;
    expect(summary.find((r: any) => r.employeeId === inPlant.id).holidays).toBe(1);
    expect(summary.find((r: any) => r.employeeId === office.id).holidays).toBe(0);
  });
});

describe('after a schedule changes', () => {
  it('recomputes reader and clock days against the new shift, leaving hand-made days alone', async () => {
    const c = await makeOwner();
    const late = await shift(c, 'Late start', '10:00', '19:00');
    const sn = `SCH${Date.now().toString(36).toUpperCase()}${rnd().toUpperCase()}`;
    await att(c).post('/devices', { serialNumber: sn, name: 'Gate' }).expect(201);
    const p = (await ppl(c).post('/employees', { name: 'Shift Changer', code: '900', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    await request(app).post(`/iclock/cdata?SN=${sn}&table=ATTLOG`).set('Content-Type', 'text/plain').send('900\t2026-09-08 10:05:00\t0\t1\n900\t2026-09-08 19:05:00\t1\t1').expect(200);
    const before = (await att(c).get(`/records?from=2026-09-08&to=2026-09-08&employeeId=${p.id}`).expect(200)).body.records[0];
    expect(before.lateMinutes).toBe(65); // against 09:00
    await att(c).post('/shift-assignments', { employeeIds: [p.id], shiftId: late.id, effectiveFrom: '2026-09-01' }).expect(200);
    expect((await att(c).post('/recompute', { from: '2026-09-01', to: '2026-09-30' }).expect(200)).body.recomputed).toBe(1);
    const after = (await att(c).get(`/records?from=2026-09-08&to=2026-09-08&employeeId=${p.id}`).expect(200)).body.records[0];
    expect(after).toMatchObject({ lateMinutes: 0, shiftId: late.id });
    await att(c).post('/recompute', { from: '2026-01-01', to: '2026-12-31' }).expect(400);
  });
});
