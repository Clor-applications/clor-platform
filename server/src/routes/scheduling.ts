import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import { isWeeklyOff } from '../services/attendance/compute.js';
import { loadHolidays, loadSchedule, resolveShift } from '../services/attendance/schedule.js';
import { ISO_DATE, closedMonths, daysBetween, daysOfMonth, sendError, today, withNames, writeDay } from './attendance.js';
import { recomputeDeviceDay } from './iclock.js';

/**
 * Scheduling — ClorTime's Shift and Schedule modules: temporary schedules,
 * department schedules, rotations, company attendance rules, a schedule
 * calendar, and recomputing days after a schedule changes. Who works what on
 * a date is answered in one place, services/attendance/schedule.ts.
 */
export const schedulingRouter = Router();
schedulingRouter.use(requireAuth, requireTenantContext);

const R = ATTENDANCE_RESOURCE;
const can = (action: string) => requirePermission(ATTENDANCE_MODULE, action as any, R.shifts);
const base = '/orgs/:orgId/attendance';
const date = z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.');
const optionalDate = date.optional().nullable().or(z.literal(''));

async function shiftIn(orgId: string, shiftId: string) {
  const s = await peoplePrisma.shift.findFirst({ where: { id: shiftId, orgId }, select: { id: true } });
  if (!s) throw Object.assign(new Error('That shift is not in this organisation.'), { status: 400 });
}

// ---------------------------------------------------------------------------
// Temporary schedules
// ---------------------------------------------------------------------------

schedulingRouter.get(`${base}/temporary-schedules`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const from = ISO_DATE.test(String(req.query.from || '')) ? String(req.query.from) : `${today().slice(0, 7)}-01`;
  const rows = await peoplePrisma.temporarySchedule.findMany({ where: { accountId, orgId, toDate: { gte: from } }, orderBy: { fromDate: 'asc' }, take: 1000 });
  const shifts = new Map((await peoplePrisma.shift.findMany({ where: { orgId }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  res.json({ schedules: (await withNames(orgId, rows)).map((r) => ({ ...r, shiftName: shifts.get(r.shiftId) || '—' })) });
});

schedulingRouter.post(`${base}/temporary-schedules`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({ employeeIds: z.array(z.string().min(1)).min(1).max(1000), shiftId: z.string().min(1), fromDate: date, toDate: date, reason: z.string().trim().max(200).optional().nullable() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Choose people, a shift and the days.' });
  const b = parsed.data;
  if (b.toDate < b.fromDate) return res.status(400).json({ error: 'The last day is before the first.' });
  try {
    await shiftIn(orgId, b.shiftId);
    const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: b.employeeIds } }, select: { id: true } });
    await peoplePrisma.temporarySchedule.createMany({
      data: people.map((p) => ({ accountId, orgId, employeeId: p.id, shiftId: b.shiftId, fromDate: b.fromDate, toDate: b.toDate, reason: b.reason || null, createdByUserId: req.auth!.userId })),
    });
    res.status(201).json({ scheduled: people.length });
  } catch (e) {
    return sendError(res, e);
  }
});

schedulingRouter.delete(`${base}/temporary-schedules/:id`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.temporarySchedule.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return res.status(404).json({ error: 'No such schedule.' });
  await peoplePrisma.temporarySchedule.delete({ where: { id: r.id } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Department schedules
// ---------------------------------------------------------------------------

schedulingRouter.get(`${base}/department-schedules`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const [rows, depts, shifts] = await Promise.all([
    peoplePrisma.departmentSchedule.findMany({ where: { accountId, orgId }, orderBy: [{ effectiveFrom: 'desc' }] }),
    peoplePrisma.department.findMany({ where: { orgId }, select: { id: true, name: true } }),
    peoplePrisma.shift.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  const d = new Map(depts.map((x) => [x.id, x.name]));
  const s = new Map(shifts.map((x) => [x.id, x.name]));
  res.json({ schedules: rows.map((r) => ({ ...r, departmentName: d.get(r.departmentId) || '—', shiftName: s.get(r.shiftId) || '—' })) });
});

schedulingRouter.post(`${base}/department-schedules`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z.object({ departmentId: z.string().min(1), shiftId: z.string().min(1), effectiveFrom: date, effectiveTo: optionalDate }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Choose a department, a shift and a start date.' });
  const b = parsed.data;
  if (b.effectiveTo && b.effectiveTo < b.effectiveFrom) return res.status(400).json({ error: 'The end is before the start.' });
  try {
    await shiftIn(orgId, b.shiftId);
    if (!(await peoplePrisma.department.findFirst({ where: { id: b.departmentId, orgId }, select: { id: true } }))) return res.status(400).json({ error: 'That department is not in this organisation.' });
    const row = await peoplePrisma.departmentSchedule.upsert({
      where: { departmentId_effectiveFrom: { departmentId: b.departmentId, effectiveFrom: b.effectiveFrom } },
      create: { accountId, orgId, departmentId: b.departmentId, shiftId: b.shiftId, effectiveFrom: b.effectiveFrom, effectiveTo: b.effectiveTo || null, createdByUserId: req.auth!.userId },
      update: { shiftId: b.shiftId, effectiveTo: b.effectiveTo || null },
    });
    res.status(201).json({ schedule: row });
  } catch (e) {
    return sendError(res, e);
  }
});

schedulingRouter.delete(`${base}/department-schedules/:id`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.departmentSchedule.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return res.status(404).json({ error: 'No such schedule.' });
  await peoplePrisma.departmentSchedule.delete({ where: { id: r.id } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Rotations
// ---------------------------------------------------------------------------

const rotationSchema = z.object({
  name: z.string().trim().min(1, 'Name the rotation.').max(80),
  /** Shift ids in order, or "OFF" for a step with no rotation shift. */
  sequence: z.array(z.string().min(1)).min(2, 'A rotation has at least two steps.').max(52),
  periodDays: z.coerce.number().int().min(1).max(31).default(7),
  anchorDate: date,
  isActive: z.boolean().optional(),
});

async function checkSequence(orgId: string, sequence: string[]) {
  const ids = sequence.filter((x) => x !== 'OFF');
  if (!ids.length) throw Object.assign(new Error('Put at least one shift in the rotation.'), { status: 400 });
  const found = await peoplePrisma.shift.count({ where: { orgId, id: { in: [...new Set(ids)] } } });
  if (found !== new Set(ids).size) throw Object.assign(new Error('A shift in the rotation is not in this organisation.'), { status: 400 });
}

schedulingRouter.get(`${base}/rotations`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const [rows, counts] = await Promise.all([
    peoplePrisma.shiftRotation.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } }),
    peoplePrisma.rotationAssignment.groupBy({ by: ['rotationId'], where: { orgId }, _count: { _all: true } }),
  ]);
  const n = new Map(counts.map((c) => [c.rotationId, c._count._all]));
  res.json({ rotations: rows.map((r) => ({ ...r, sequence: r.sequence.split(','), people: n.get(r.id) || 0 })) });
});

schedulingRouter.post(`${base}/rotations`, can(PermissionAction.CREATE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = rotationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the rotation.' });
  try {
    await checkSequence(orgId, parsed.data.sequence);
    const r = await peoplePrisma.shiftRotation.create({
      data: { accountId, orgId, ...parsed.data, sequence: parsed.data.sequence.join(','), createdByUserId: req.auth!.userId },
    });
    res.status(201).json({ rotation: { ...r, sequence: r.sequence.split(',') } });
  } catch (e) {
    return sendError(res, e);
  }
});

schedulingRouter.put(`${base}/rotations/:id`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.shiftRotation.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such rotation.' });
  const parsed = rotationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the rotation.' });
  try {
    await checkSequence(orgId, parsed.data.sequence);
    const r = await peoplePrisma.shiftRotation.update({ where: { id: existing.id }, data: { ...parsed.data, sequence: parsed.data.sequence.join(',') } });
    res.json({ rotation: { ...r, sequence: r.sequence.split(',') } });
  } catch (e) {
    return sendError(res, e);
  }
});

schedulingRouter.delete(`${base}/rotations/:id`, can(PermissionAction.DELETE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.shiftRotation.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such rotation.' });
  if (await peoplePrisma.rotationAssignment.count({ where: { orgId, rotationId: existing.id } })) {
    return res.status(409).json({ error: 'People are on this rotation. Take them off it, or switch it off instead.' });
  }
  await peoplePrisma.shiftRotation.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

schedulingRouter.get(`${base}/rotations/:id/assignments`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await peoplePrisma.rotationAssignment.findMany({ where: { accountId, orgId, rotationId: String(req.params.id) }, orderBy: [{ slotOffset: 'asc' }] });
  res.json({ assignments: await withNames(orgId, rows) });
});

schedulingRouter.post(`${base}/rotations/:id/assignments`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rotation = await peoplePrisma.shiftRotation.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!rotation) return res.status(404).json({ error: 'No such rotation.' });
  const parsed = z
    .object({ employeeIds: z.array(z.string().min(1)).min(1).max(1000), slotOffset: z.coerce.number().int().min(0).max(51).default(0), startsOn: date, endsOn: optionalDate })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Choose people and a start date.' });
  const b = parsed.data;
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: b.employeeIds } }, select: { id: true } });
  for (const p of people) {
    await peoplePrisma.rotationAssignment.upsert({
      where: { employeeId_rotationId_startsOn: { employeeId: p.id, rotationId: rotation.id, startsOn: b.startsOn } },
      create: { accountId, orgId, employeeId: p.id, rotationId: rotation.id, slotOffset: b.slotOffset, startsOn: b.startsOn, endsOn: b.endsOn || null, createdByUserId: req.auth!.userId },
      update: { slotOffset: b.slotOffset, endsOn: b.endsOn || null },
    });
  }
  res.status(201).json({ assigned: people.length });
});

schedulingRouter.delete(`${base}/rotation-assignments/:id`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.rotationAssignment.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return res.status(404).json({ error: 'No such assignment.' });
  await peoplePrisma.rotationAssignment.delete({ where: { id: r.id } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Attendance rules (company-wide)
// ---------------------------------------------------------------------------

schedulingRouter.get(`${base}/rules`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const s = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId } });
  res.json({ rules: { defaultShiftId: s?.defaultShiftId || null, lateAllowancePerMonth: s?.lateAllowancePerMonth ?? 0, latePenaltyEvery: s?.latePenaltyEvery ?? 0, photoRetentionDays: s?.photoRetentionDays ?? 90, readerUsersBecomeEmployees: s?.readerUsersBecomeEmployees ?? true, leaveApproval: s?.leaveApproval ?? 'HR', correctionApproval: s?.correctionApproval ?? 'HR' } });
});

schedulingRouter.put(`${base}/rules`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      defaultShiftId: z.string().min(1).nullable(),
      lateAllowancePerMonth: z.coerce.number().int().min(0).max(31),
      latePenaltyEvery: z.coerce.number().int().min(0).max(31),
      photoRetentionDays: z.coerce.number().int().min(7, 'Keep punch photos at least 7 days.').max(365, 'Keep punch photos at most a year.').default(90),
      readerUsersBecomeEmployees: z.boolean().default(true),
      leaveApproval: z.enum(['HR', 'MANAGER', 'MANAGER_THEN_HR']).default('HR'),
      correctionApproval: z.enum(['HR', 'MANAGER', 'MANAGER_THEN_HR']).default('HR'),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the rules.' });
  try {
    if (parsed.data.defaultShiftId) await shiftIn(orgId, parsed.data.defaultShiftId);
    const s = await peoplePrisma.attendanceSettings.upsert({
      where: { orgId },
      create: { accountId, orgId, ...parsed.data, updatedByUserId: req.auth!.userId },
      update: { ...parsed.data, updatedByUserId: req.auth!.userId },
    });
    res.json({ rules: { defaultShiftId: s.defaultShiftId, lateAllowancePerMonth: s.lateAllowancePerMonth, latePenaltyEvery: s.latePenaltyEvery, photoRetentionDays: s.photoRetentionDays, readerUsersBecomeEmployees: s.readerUsersBecomeEmployees, leaveApproval: s.leaveApproval, correctionApproval: s.correctionApproval } });
  } catch (e) {
    return sendError(res, e);
  }
});

// ---------------------------------------------------------------------------
// The schedule calendar
// ---------------------------------------------------------------------------

/**
 * Who works what, each day of a month — what the engine will score against.
 * Each cell: the shift (code, colour, where it came from) or a weekly off /
 * holiday / leave (ClorTime's Schedule View).
 */
schedulingRouter.get(`${base}/schedule`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : today().slice(0, 7);
  const departmentId = String(req.query.departmentId || '').trim();
  const areaId = String(req.query.areaId || '').trim();
  const days = daysOfMonth(month);
  const first = days[0];
  const last = days[days.length - 1];
  const people = await peoplePrisma.employee.findMany({
    where: {
      accountId,
      orgId,
      attendanceRequired: true,
      ...(departmentId ? { departmentId } : {}),
      ...(areaId ? { areaId } : {}),
      AND: [{ OR: [{ dateOfLeaving: null }, { dateOfLeaving: { gte: first } }] }, { OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: last } }] }],
    },
    select: { id: true, name: true, code: true, department: true, areaId: true, branchId: true, dateOfJoining: true, dateOfLeaving: true },
    orderBy: { name: 'asc' },
  });
  const [schedule, holidays, leaveDays] = await Promise.all([
    loadSchedule(orgId),
    loadHolidays(orgId, first, last),
    peoplePrisma.attendanceRecord.findMany({ where: { orgId, date: { gte: first, lte: last }, status: 'ON_LEAVE' }, select: { employeeId: true, date: true } }),
  ]);
  const onLeave = new Set(leaveDays.map((l) => `${l.employeeId}|${l.date}`));
  const shiftsUsed = new Map<string, any>();
  const rows = people.map((p) => ({
    employeeId: p.id,
    name: p.name,
    code: p.code,
    department: p.department,
    cells: days.map((d) => {
      if ((p.dateOfJoining && d < p.dateOfJoining) || (p.dateOfLeaving && d > p.dateOfLeaving)) return { date: d, kind: 'OUT' };
      const r = resolveShift(schedule, p.id, d);
      if (r.shiftId && !shiftsUsed.has(r.shiftId)) shiftsUsed.set(r.shiftId, { id: r.shiftId, name: r.name, code: r.code, color: r.color, startTime: r.rule.startTime, endTime: r.rule.endTime });
      const kind = onLeave.has(`${p.id}|${d}`) ? 'LEAVE' : holidays.forArea(p.areaId, p.branchId).has(d) ? 'HOLIDAY' : isWeeklyOff(r.rule, d) ? 'OFF' : 'WORK';
      return { date: d, kind, shiftId: r.shiftId, code: r.code, color: r.color, name: r.name, source: r.source };
    }),
  }));
  res.json({ month, days, rows, shifts: [...shiftsUsed.values()], holidays: holidays.rows.map((h) => ({ date: h.date, name: h.name, areaId: h.areaId })) });
});

// ---------------------------------------------------------------------------
// Recompute after a schedule change
// ---------------------------------------------------------------------------

/**
 * Work days out again against the schedules as they are now. Days from readers
 * and the clock are re-scored; days someone decided by hand (manual, request,
 * leave) are left as they are. At most 62 days at a time.
 */
schedulingRouter.post(`${base}/recompute`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z.object({ from: date, to: date, employeeIds: z.array(z.string()).max(2000).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose the days.' });
  const { from, to, employeeIds } = parsed.data;
  if (to < from || daysBetween(from, to).length > 62) return res.status(400).json({ error: 'Choose up to 62 days.' });
  if (to > today()) return res.status(400).json({ error: 'Days still to come have nothing to work out.' });
  const records = await peoplePrisma.attendanceRecord.findMany({
    where: { accountId, orgId, date: { gte: from, lte: to }, source: { in: ['DEVICE', 'CLOCK'] }, ...(employeeIds?.length ? { employeeId: { in: employeeIds } } : {}) },
  });
  const people = new Map(
    (await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(records.map((r) => r.employeeId))] } }, select: { id: true, branchId: true, areaId: true } })).map((p) => [p.id, p])
  );
  let done = 0;
  /* Closed months keep their figures: skipped, and counted so the screen can say so. */
  const closed = await closedMonths(orgId, records.map((r) => r.date.slice(0, 7)));
  let skippedClosed = 0;
  for (const r of records) {
    const employee = people.get(r.employeeId);
    if (!employee) continue;
    if (closed.has(r.date.slice(0, 7))) {
      skippedClosed += 1;
      continue;
    }
    if (r.source === 'DEVICE') await recomputeDeviceDay(accountId, orgId, employee, r.date);
    else await writeDay({ accountId, orgId, userId: req.auth!.userId, employee, date: r.date, checkIn: r.checkIn, checkOut: r.checkOut, source: 'CLOCK' });
    done += 1;
  }
  res.json({ recomputed: done, skippedClosed });
});
