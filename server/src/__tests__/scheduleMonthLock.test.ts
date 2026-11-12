import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Schedule changes and a closed month (closure audit O-05). Who works what on
 * a date decides its payable days, so a schedule change is a change to every
 * date it affects: refused when that reaches into a closed month, allowed
 * when it only affects dates after the last closed month or is dated in the
 * future, and allowed again once the month is reopened.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { loadSchedule, resolveShift, weeksBefore } = await import('../services/attendance/schedule.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
});

async function makeOwner(): Promise<Ctx> {
  const email = `schlock.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Sched Lock Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const person = async (c: Ctx, code: string, extra: Record<string, unknown> = {}) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: `Person ${code}`, code, dateOfJoining: '2026-01-01', ...extra }).expect(201)).body.employee;
const shift = async (c: Ctx, name: string, startTime = '09:00', endTime = '18:00') =>
  (await att(c).post('/shifts', { name, startTime, endTime, breakMinutes: 0 }).expect(201)).body.shift;
const shiftBody = (s: any, extra: Record<string, unknown> = {}) => ({
  name: s.name, startTime: s.startTime, endTime: s.endTime, breakMinutes: s.breakMinutes, graceMinutes: s.graceMinutes, earlyOutGraceMinutes: s.earlyOutGraceMinutes,
  halfDayMinutes: s.halfDayMinutes, fullDayMinutes: s.fullDayMinutes, overtimeAfterMinutes: s.overtimeAfterMinutes, weeklyOffDays: s.weeklyOffDays, offSaturdays: s.offSaturdays,
  code: s.code, color: s.color, isActive: s.isActive, ...extra,
});
const close = async (c: Ctx, month: string) => att(c).post(`/months/${month}/close`, { acknowledge: true, ...(await att(c).get(`/months/${month}/readiness`)).body.noRecordConfirm }).expect(200);
const reopen = async (c: Ctx, month: string) => att(c).post(`/months/${month}/reopen`, { reason: 'Correct the schedule' }).expect(200);
const closedRefusal = (res: request.Response, month = '2026-09') => {
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('ATTENDANCE_MONTH_CLOSED');
  expect(res.body.error).toContain(month);
};

describe('the working week kept before a dated change, pure', () => {
  const now = { weeklyOffDays: '0', offSaturdays: '' };
  it('keeps the old week up to the new start', () => {
    expect(weeksBefore([], now, '2026-10-01')).toEqual([{ until: '2026-10-01', weeklyOffDays: '0', offSaturdays: '' }]);
  });
  it('replaces a later dated week, and keeps the one before it', () => {
    const earlier = [{ until: '2026-10-01', weeklyOffDays: '0', offSaturdays: '2,4' }];
    // The current week (from 1 Oct) is Sunday only; a new one from 1 Nov keeps both.
    expect(weeksBefore(earlier, now, '2026-11-01')).toEqual([...earlier, { until: '2026-11-01', weeklyOffDays: '0', offSaturdays: '' }]);
    // Moved back to 15 Sep: the week of 1 Oct never starts, the one before runs to 15 Sep.
    expect(weeksBefore(earlier, now, '2026-09-15')).toEqual([{ until: '2026-09-15', weeklyOffDays: '0', offSaturdays: '2,4' }]);
    // The same start again: nothing new is kept.
    expect(weeksBefore(earlier, now, '2026-10-01')).toEqual(earlier);
  });
});

describe('a closed month and the schedule', () => {
  it('shift assignments: add, delete and import', async () => {
    const c = await makeOwner();
    const p = await person(c, '501');
    const q = await person(c, '502');
    const day = await shift(c, 'Day');
    // Before the close: an open-ended row from August (covers September), and one that ends in August.
    await att(c).post('/shift-assignments', { employeeIds: [p.id], shiftId: day.id, effectiveFrom: '2026-08-01' }).expect(200);
    await att(c).post('/shift-assignments', { employeeIds: [q.id], shiftId: day.id, effectiveFrom: '2026-08-01', effectiveTo: '2026-08-31' }).expect(200);
    const rows = (await att(c).get('/shift-assignments').expect(200)).body.assignments;
    const open = rows.find((r: any) => r.employeeId === p.id);
    await close(c, '2026-09');

    // Refused: a range in the closed month, an open-ended one before it, and replacing a row that covers it.
    closedRefusal(await att(c).post('/shift-assignments', { employeeIds: [q.id], shiftId: day.id, effectiveFrom: '2026-09-10', effectiveTo: '2026-09-20' }));
    closedRefusal(await att(c).post('/shift-assignments', { employeeIds: [q.id], shiftId: day.id, effectiveFrom: '2026-07-01' }));
    closedRefusal(await att(c).post('/shift-assignments', { employeeIds: [p.id], shiftId: day.id, effectiveFrom: '2026-08-01', effectiveTo: '2026-08-15' }));
    closedRefusal(await att(c).del(`/shift-assignments/${open.id}`));
    expect(await peoplePrisma.shiftAssignment.count({ where: { employeeId: p.id } })).toBe(1);

    // Allowed: before the closed month only, after it, in the future.
    await att(c).post('/shift-assignments', { employeeIds: [q.id], shiftId: day.id, effectiveFrom: '2026-08-01', effectiveTo: '2026-08-20' }).expect(200);
    await att(c).post('/shift-assignments', { employeeIds: [q.id], shiftId: day.id, effectiveFrom: '2026-10-01' }).expect(200);
    await att(c).post('/shift-assignments', { employeeIds: [p.id], shiftId: day.id, effectiveFrom: '2026-12-01', effectiveTo: '2026-12-31' }).expect(200);
    const later = (await att(c).get('/shift-assignments').expect(200)).body.assignments.find((r: any) => r.employeeId === q.id && r.effectiveFrom === '2026-10-01');
    await att(c).del(`/shift-assignments/${later.id}`).expect(200);

    // Import: the September row fails with the month named; the November row goes in.
    const imp = await att(c).post('/shift-assignments/import', { rows: [
      { employeeCode: '502', shift: 'Day', from: '2026-09-01', to: '2026-09-30' },
      { employeeCode: '502', shift: 'Day', from: '2026-11-01' },
    ] }).expect(200);
    expect(imp.body.imported).toBe(1);
    expect(imp.body.results).toHaveLength(1);
    expect(imp.body.results[0]).toMatchObject({ row: 1, ok: false });
    expect(imp.body.results[0].error).toContain('2026-09');

    // Reopened, the same changes go through.
    await reopen(c, '2026-09');
    await att(c).post('/shift-assignments', { employeeIds: [q.id], shiftId: day.id, effectiveFrom: '2026-09-10', effectiveTo: '2026-09-20' }).expect(200);
    await att(c).del(`/shift-assignments/${open.id}`).expect(200);
  });

  it('a shift’s times and rules, while a closed month uses it', async () => {
    const c = await makeOwner();
    const p = await person(c, '511');
    const used = await shift(c, 'Used');
    const later = await shift(c, 'Later');
    await att(c).post('/shift-assignments', { employeeIds: [p.id], shiftId: used.id, effectiveFrom: '2026-08-01' }).expect(200);
    await att(c).post('/shift-assignments', { employeeIds: [p.id], shiftId: later.id, effectiveFrom: '2026-11-01' }).expect(200);
    await close(c, '2026-09');

    const refused = await att(c).put(`/shifts/${used.id}`, shiftBody(used, { startTime: '10:00' }));
    closedRefusal(refused);
    expect(refused.body.error).toContain('Create a new shift from a date instead');
    closedRefusal(await att(c).put(`/shifts/${used.id}`, shiftBody(used, { isActive: false })));
    expect((await peoplePrisma.shift.findUnique({ where: { id: used.id } }))!.startTime).toBe('09:00');
    // Its name and colour can still change; a shift no closed month uses can change freely.
    await att(c).put(`/shifts/${used.id}`, shiftBody(used, { name: 'Used day', color: '#336699' })).expect(200);
    /* 10:00–18:00 less the break is 7 hours: a full day of 8 is refused (compute.ts shiftRuleProblem); 7 saves. */
    expect((await att(c).put(`/shifts/${later.id}`, shiftBody(later, { startTime: '10:00' })).expect(400)).body.code).toBe('SHIFT_RULES');
    await att(c).put(`/shifts/${later.id}`, shiftBody(later, { startTime: '10:00', fullDayMinutes: 420 })).expect(200);

    // The company default decides every date: refused too, as is changing the default.
    const def = await shift(c, 'Default');
    await reopen(c, '2026-09');
    await att(c).put('/rules', { defaultShiftId: def.id, lateAllowancePerMonth: 0, latePenaltyEvery: 0 }).expect(200);
    await close(c, '2026-09');
    closedRefusal(await att(c).put(`/shifts/${def.id}`, shiftBody(def, { endTime: '17:00' })));
    closedRefusal(await att(c).put('/rules', { defaultShiftId: null, lateAllowancePerMonth: 0, latePenaltyEvery: 0 }));
    // Rules that leave the default alone still save.
    await att(c).put('/rules', { defaultShiftId: def.id, lateAllowancePerMonth: 2, latePenaltyEvery: 0 }).expect(200);

    await reopen(c, '2026-09');
    await att(c).put(`/shifts/${used.id}`, shiftBody(used, { name: 'Used day', startTime: '10:00', fullDayMinutes: 420 })).expect(200);
    await att(c).put(`/shifts/${def.id}`, shiftBody(def, { endTime: '17:00', fullDayMinutes: 420 })).expect(200);
  });

  it('a closed month’s day recorded on a shift keeps the shift’s rules', async () => {
    const c = await makeOwner();
    const p = await person(c, '515');
    const s = await shift(c, 'Recorded');
    // A temporary schedule puts the day on the shift; the day is written; the schedule is then removed.
    await att(c).post('/temporary-schedules', { employeeIds: [p.id], shiftId: s.id, fromDate: '2026-09-02', toDate: '2026-09-02' }).expect(201);
    await att(c).put('/records', { employeeId: p.id, date: '2026-09-02', checkIn: '09:00', checkOut: '18:00' }).expect(200);
    expect((await peoplePrisma.attendanceRecord.findFirst({ where: { employeeId: p.id, date: '2026-09-02' } }))!.shiftId).toBe(s.id);
    await peoplePrisma.temporarySchedule.deleteMany({ where: { employeeId: p.id } });
    await close(c, '2026-09');
    closedRefusal(await att(c).put(`/shifts/${s.id}`, shiftBody(s, { fullDayMinutes: 420 })));
    await reopen(c, '2026-09');
    await att(c).put(`/shifts/${s.id}`, shiftBody(s, { fullDayMinutes: 420 })).expect(200);
  });

  it('temporary schedules', async () => {
    const c = await makeOwner();
    const p = await person(c, '521');
    const s = await shift(c, 'Cover');
    await att(c).post('/temporary-schedules', { employeeIds: [p.id], shiftId: s.id, fromDate: '2026-09-28', toDate: '2026-10-02' }).expect(201);
    const before = (await peoplePrisma.temporarySchedule.findFirst({ where: { employeeId: p.id } }))!;
    await close(c, '2026-09');

    closedRefusal(await att(c).post('/temporary-schedules', { employeeIds: [p.id], shiftId: s.id, fromDate: '2026-09-10', toDate: '2026-09-12' }));
    closedRefusal(await att(c).post('/temporary-schedules', { employeeIds: [p.id], shiftId: s.id, fromDate: '2026-08-30', toDate: '2026-10-05' }));
    closedRefusal(await att(c).del(`/temporary-schedules/${before.id}`));
    await att(c).post('/temporary-schedules', { employeeIds: [p.id], shiftId: s.id, fromDate: '2026-10-05', toDate: '2026-10-06' }).expect(201);
    await att(c).post('/temporary-schedules', { employeeIds: [p.id], shiftId: s.id, fromDate: '2026-12-01', toDate: '2026-12-02' }).expect(201);
    const future = (await peoplePrisma.temporarySchedule.findFirst({ where: { employeeId: p.id, fromDate: '2026-12-01' } }))!;
    await att(c).del(`/temporary-schedules/${future.id}`).expect(200);

    await reopen(c, '2026-09');
    await att(c).post('/temporary-schedules', { employeeIds: [p.id], shiftId: s.id, fromDate: '2026-09-10', toDate: '2026-09-12' }).expect(201);
    await att(c).del(`/temporary-schedules/${before.id}`).expect(200);
  });

  it('department schedules', async () => {
    const c = await makeOwner();
    const dept = (await request(app).post(`/api/orgs/${c.orgId}/people/structure/departments`).set(at(c)).send({ name: 'Packing' }).expect(201)).body.item;
    const s = await shift(c, 'Packing day');
    await att(c).post('/department-schedules', { departmentId: dept.id, shiftId: s.id, effectiveFrom: '2026-08-01' }).expect(201);
    const before = (await peoplePrisma.departmentSchedule.findFirst({ where: { departmentId: dept.id } }))!;
    await close(c, '2026-09');

    closedRefusal(await att(c).post('/department-schedules', { departmentId: dept.id, shiftId: s.id, effectiveFrom: '2026-09-15' }));
    // Replacing the August row (open-ended, so it covers September) with one ending in August is refused too.
    closedRefusal(await att(c).post('/department-schedules', { departmentId: dept.id, shiftId: s.id, effectiveFrom: '2026-08-01', effectiveTo: '2026-08-31' }));
    closedRefusal(await att(c).del(`/department-schedules/${before.id}`));
    await att(c).post('/department-schedules', { departmentId: dept.id, shiftId: s.id, effectiveFrom: '2026-10-01' }).expect(201);
    await att(c).post('/department-schedules', { departmentId: dept.id, shiftId: s.id, effectiveFrom: '2027-01-01' }).expect(201);

    await reopen(c, '2026-09');
    await att(c).post('/department-schedules', { departmentId: dept.id, shiftId: s.id, effectiveFrom: '2026-09-15' }).expect(201);
    await att(c).del(`/department-schedules/${before.id}`).expect(200);
  });

  it('rotations: their pattern and the people on them', async () => {
    const c = await makeOwner();
    const p = await person(c, '531');
    const q = await person(c, '532');
    const a = await shift(c, 'Crew A', '06:00', '14:00');
    const b = await shift(c, 'Crew B', '14:00', '22:00');
    const rot = (await att(c).post('/rotations', { name: 'Two crews', sequence: [a.id, b.id], periodDays: 7, anchorDate: '2026-08-03' }).expect(201)).body.rotation;
    await att(c).post(`/rotations/${rot.id}/assignments`, { employeeIds: [p.id], startsOn: '2026-08-03' }).expect(201);
    const onIt = (await peoplePrisma.rotationAssignment.findFirst({ where: { employeeId: p.id } }))!;
    await close(c, '2026-09');

    const body = { name: 'Two crews', sequence: [a.id, b.id], periodDays: 7, anchorDate: '2026-08-03' };
    const refused = await att(c).put(`/rotations/${rot.id}`, { ...body, periodDays: 14 });
    closedRefusal(refused);
    expect(refused.body.error).toContain('Start a new rotation from a date instead');
    closedRefusal(await att(c).put(`/rotations/${rot.id}`, { ...body, sequence: [b.id, a.id] }));
    // A crew rotating through a closed month: its shifts' rules are kept too.
    closedRefusal(await att(c).put(`/shifts/${b.id}`, shiftBody(b, { graceMinutes: 30 })));
    await att(c).put(`/rotations/${rot.id}`, { ...body, name: 'Two crews (east)' }).expect(200);

    closedRefusal(await att(c).post(`/rotations/${rot.id}/assignments`, { employeeIds: [q.id], startsOn: '2026-09-07' }));
    closedRefusal(await att(c).del(`/rotation-assignments/${onIt.id}`));
    await att(c).post(`/rotations/${rot.id}/assignments`, { employeeIds: [q.id], startsOn: '2026-10-05' }).expect(201);
    await att(c).post(`/rotations/${rot.id}/assignments`, { employeeIds: [q.id], startsOn: '2026-12-07', endsOn: '2026-12-31' }).expect(201);

    await reopen(c, '2026-09');
    await att(c).put(`/rotations/${rot.id}`, { ...body, periodDays: 14 }).expect(200);
    await att(c).post(`/rotations/${rot.id}/assignments`, { employeeIds: [q.id], startsOn: '2026-09-07' }).expect(201);
    await att(c).del(`/rotation-assignments/${onIt.id}`).expect(200);
  });

  it('the working week: refused for every date, allowed from after the last closed month', async () => {
    const c = await makeOwner();
    const p = await person(c, '541');
    await att(c).put('/leave/working-week', { weeklyOffDays: '0' }).expect(200);
    await close(c, '2026-09');
    const ww = (await att(c).get('/leave/working-week').expect(200)).body;
    expect(ww.firstOpenDate).toBe('2026-10-01');
    expect(ww.effectiveFrom).toBeNull();

    // Saturdays off, for every date: refused. From inside the closed month: refused.
    const all = await att(c).put('/leave/working-week', { weeklyOffDays: '0,6' });
    closedRefusal(all);
    expect(all.body.error).toContain('2026-10-01');
    closedRefusal(await att(c).put('/leave/working-week', { weeklyOffDays: '0,6', effectiveFrom: '2026-09-15' }));
    // Leaving the week alone, the rest of the form still saves.
    await att(c).put('/leave/working-week', { weeklyOffDays: '0', restrictedHolidayQuota: 2 }).expect(200);

    // From after the closed month: allowed, and September keeps the week it was worked out with.
    const saved = await att(c).put('/leave/working-week', { weeklyOffDays: '0,6', effectiveFrom: '2026-10-01' }).expect(200);
    expect(saved.body.effectiveFrom).toBe('2026-10-01');
    expect((await att(c).get('/leave/working-week').expect(200)).body.effectiveFrom).toBe('2026-10-01');
    const sched = await loadSchedule(c.orgId, [p.id]);
    expect(resolveShift(sched, p.id, '2026-09-05').rule.weeklyOffDays).toBe('0');
    expect(resolveShift(sched, p.id, '2026-10-03').rule.weeklyOffDays).toBe('0,6');

    // Dated in the future: always allowed; the October week runs until then.
    await att(c).put('/leave/working-week', { weeklyOffDays: '0', offSaturdays: '2,4', effectiveFrom: '2026-12-01' }).expect(200);
    const later = await loadSchedule(c.orgId, [p.id]);
    expect(resolveShift(later, p.id, '2026-09-05').rule.weeklyOffDays).toBe('0');
    expect(resolveShift(later, p.id, '2026-11-07').rule.weeklyOffDays).toBe('0,6');
    expect(resolveShift(later, p.id, '2026-12-12').rule).toMatchObject({ weeklyOffDays: '0', offSaturdays: '2,4' });

    // Reopened, a change for every date goes through, and the dated weeks are gone.
    await reopen(c, '2026-09');
    const back = await att(c).put('/leave/working-week', { weeklyOffDays: '0,6' }).expect(200);
    expect(back.body.effectiveFrom).toBeNull();
    expect(resolveShift(await loadSchedule(c.orgId, [p.id]), p.id, '2026-09-05').rule.weeklyOffDays).toBe('0,6');
  });
});
