import { activeLeaveRule } from '../services/attendance/leaveRules.js';
import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { recordRuleVersion } from '../services/attendance/ruleVersions.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import { isWeeklyOff } from '../services/attendance/compute.js';
import { loadHolidays, loadSchedule, resolveShift } from '../services/attendance/schedule.js';
import { ISO_DATE, closedMonths, daysBetween, daysOfMonth, sendError, today, withNames, writeDay } from '../services/attendance/days.js';
import { recomputeDeviceDay } from '../services/attendance/punches.js';
import { deleteToBin } from '../services/recycleBin.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { DEFAULT_LATE_UPLOAD_HOURS, READER_TRUST, readerTrustOn } from '../services/attendance/trust.js';
import { assertScheduleOpen, rotationRanges, scheduleGuard } from '../services/attendance/scheduleGuard.js';
import { assertNightConsent, nightRefusal, onShiftAhead, rotationShiftIds } from '../services/people/nightConsent.js';
import { marksFromLegacy, nextMonthStart, rulesOf, timeRulesFor } from '../services/attendance/timeRules.js';
import { recordAudit } from '../services/auditTrail.js';
import { teamScope } from '../services/people/scope.js';

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
    /* Its days may not be in a closed month (O-05). */
    await assertScheduleOpen(orgId, [{ from: b.fromDate, to: b.toDate }]);
    const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: b.employeeIds } }, select: { id: true } });
    /* A woman on a shift into the night needs her consent on file (OSH Code s.43; people/nightConsent.ts). */
    await assertNightConsent(orgId, people.map((p) => ({ employeeId: p.id, shiftIds: [b.shiftId] })));
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
  try {
    await assertScheduleOpen(orgId, [{ from: r.fromDate, to: r.toDate }]);
  } catch (e) {
    return sendError(res, e);
  }
  await deleteToBin(req, 'temporarySchedule', r);
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
    const inDept = await peoplePrisma.employee.findMany({ where: { orgId, departmentId: b.departmentId, status: { not: 'LEFT' } }, select: { id: true } });
    await assertNightConsent(orgId, inDept.map((p) => ({ employeeId: p.id, shiftIds: [b.shiftId] })));
    /* The new range, and the range of a row it replaces (same department, same start), may not reach into a closed month (O-05). */
    const replaced = await peoplePrisma.departmentSchedule.findUnique({ where: { departmentId_effectiveFrom: { departmentId: b.departmentId, effectiveFrom: b.effectiveFrom } }, select: { effectiveTo: true } });
    await assertScheduleOpen(orgId, [{ from: b.effectiveFrom, to: b.effectiveTo || null }, ...(replaced ? [{ from: b.effectiveFrom, to: replaced.effectiveTo }] : [])]);
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
  try {
    await assertScheduleOpen(orgId, [{ from: r.effectiveFrom, to: r.effectiveTo }]);
  } catch (e) {
    return sendError(res, e);
  }
  await deleteToBin(req, 'departmentSchedule', r);
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
    /*
     * A rotation has no effective date: a new pattern, period, anchor or on/off
     * re-works every date of everyone on it, so it may not touch a closed
     * month (O-05). The name can always change.
     */
    const pattern = (x: { sequence: string; periodDays: number; anchorDate: string; isActive: boolean }) => JSON.stringify([x.sequence, x.periodDays, x.anchorDate, x.isActive]);
    const next = { sequence: parsed.data.sequence.join(','), periodDays: parsed.data.periodDays, anchorDate: parsed.data.anchorDate, isActive: parsed.data.isActive ?? existing.isActive };
    if (pattern(existing) !== pattern(next)) {
      await assertScheduleOpen(orgId, await rotationRanges(orgId, existing.id), (month) => `${month} is closed in Attendance and people on this rotation work it, so its pattern cannot change. Start a new rotation from a date instead.`);
      /* A night step added to a rotation women are on needs their consent (people/nightConsent.ts). */
      const on = await peoplePrisma.rotationAssignment.findMany({ where: { orgId, rotationId: existing.id, OR: [{ endsOn: null }, { endsOn: { gte: today() } }] }, select: { employeeId: true } });
      await assertNightConsent(orgId, on.map((a) => ({ employeeId: a.employeeId, shiftIds: parsed.data.sequence })));
    }
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
  await deleteToBin(req, 'shiftRotation', existing);
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
  if (b.endsOn && b.endsOn < b.startsOn) return res.status(400).json({ error: 'The end is before the start.' });
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: b.employeeIds } }, select: { id: true } });
  /* The new range, and any row it replaces (same person, rotation and start), may not reach into a closed month (O-05). */
  const replaced = await peoplePrisma.rotationAssignment.findMany({ where: { orgId, rotationId: rotation.id, startsOn: b.startsOn, employeeId: { in: people.map((p) => p.id) } }, select: { endsOn: true } });
  const refused = (await scheduleGuard(orgId)).refusal([{ from: b.startsOn, to: b.endsOn || null }, ...replaced.map((r) => ({ from: b.startsOn, to: r.endsOn }))]);
  if (refused) return sendError(res, refused);
  const noConsent = await nightRefusal(orgId, people.map((p) => ({ employeeId: p.id, shiftIds: rotationShiftIds(rotation.sequence) })));
  if (noConsent) return sendError(res, noConsent);
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
  const refused = (await scheduleGuard(orgId)).refusal([{ from: r.startsOn, to: r.endsOn }]);
  if (refused) return sendError(res, refused);
  await deleteToBin(req, 'rotationAssignment', r);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Attendance rules (company-wide)
// ---------------------------------------------------------------------------

schedulingRouter.get(`${base}/rules`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const s = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId } });
  res.json({ rules: { defaultShiftId: s?.defaultShiftId || null, lateAllowancePerMonth: s?.lateAllowancePerMonth ?? 0, latePenaltyEvery: s?.latePenaltyEvery ?? 0, photoRetentionDays: s?.photoRetentionDays ?? 90, readerUsersBecomeEmployees: s?.readerUsersBecomeEmployees ?? true, leaveApproval: s?.leaveApproval ?? 'HR', correctionApproval: s?.correctionApproval ?? 'HR', autoShiftByPunch: s?.autoShiftByPunch ?? false, ...(await lateRule(orgId, s)), ...(await trustRules(accountId, orgId, s)) } });
});

/**
 * The late rule as People's Attendance rules hold it, for the Attendance app: its cut, what the step costs, and whether the
 * two numbers here still set it. They do while People has never saved late marks (the numbers are the rule) or holds the
 * every-N rule; under a minute cut they mean nothing, so they are shown, not set, here (review of #89).
 */
const lateRule = async (orgId: string, s: { timeRules?: unknown } | null) => {
  const m = (await timeRulesFor(orgId)).marks;
  const saved = Boolean((s?.timeRules as any)?.marks);
  return { lateOn: m.on && m.late.on, lateFree: m.late.free, lateCutMode: m.cutMode, lateCost: m.cost, lateRoundToMinutes: m.roundToMinutes, lateRuleInPeople: saved, lateNumbersHere: !saved || m.cutMode === 'HALF_DAY_PER_N' };
};

/** Reader trust (O-11): the company feature switch, kept beside the reader settings, and the late-upload window. */
const trustRules = async (accountId: string, orgId: string, s: { readerLateUploadHours?: number } | null) => ({
  readerTrust: await readerTrustOn(accountId, orgId),
  readerLateUploadHours: s?.readerLateUploadHours ?? DEFAULT_LATE_UPLOAD_HOURS,
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
      /* RULE: the company's leave approval rule (People → Settings → Approval Rules). */
      leaveApproval: z.enum(['HR', 'MANAGER', 'MANAGER_THEN_HR', 'RULE']).default('HR'),
      correctionApproval: z.enum(['HR', 'MANAGER', 'MANAGER_THEN_HR']).default('HR'),
      /* Left out: unchanged. */
      autoShiftByPunch: z.boolean().optional(),
      readerTrust: z.boolean().optional(),
      readerLateUploadHours: z.coerce.number().int().min(1, 'At least 1 hour.').max(24 * 31, 'At most 31 days.').optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the rules.' });
  const { readerTrust, ...settings } = parsed.data;
  if (settings.leaveApproval === 'RULE' && !(await activeLeaveRule(orgId))) return res.status(400).json({ error: 'Set up the leave approval rule first, in Settings → Approval Rules.' });
  try {
    if (parsed.data.defaultShiftId) await shiftIn(orgId, parsed.data.defaultShiftId);
    const previous = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId } });
    /* The default shift decides every date of anyone with no other schedule, closed months included (O-05). */
    if ((previous?.defaultShiftId || null) !== parsed.data.defaultShiftId) {
      await assertScheduleOpen(orgId, [{ from: null, to: null }], (month) => `${month} is closed in Attendance, and the default shift decides its days. Reopen the month to change the default shift, or assign the shift from a date instead.`);
      /* A night default reaches every woman with no schedule of her own (people/nightConsent.ts). */
      if (parsed.data.defaultShiftId) {
        const on = await onShiftAhead(orgId, null);
        await assertNightConsent(orgId, on.map((id) => ({ employeeId: id, shiftIds: [parsed.data.defaultShiftId!] })));
      }
    }
    /* The two late numbers cost pay: set for the whole company only (as People's Attendance rules are). */
    /* Checked with no settings row too: a first save from 0 to 3 costs pay as much as any. */
    const numbersChange = (previous?.lateAllowancePerMonth ?? 0) !== parsed.data.lateAllowancePerMonth || (previous?.latePenaltyEvery ?? 0) !== parsed.data.latePenaltyEvery;
    const rulesBefore = rulesOf(previous);
    if (numbersChange && !(await teamScope(req)).all) return res.status(403).json({ error: 'Late-mark rules are set by someone who decides for the whole company.' });
    /* The cut is People's choice: these numbers never switch it, and under a minute cut they are not the rule. */
    if (numbersChange && !(await lateRule(orgId, previous)).lateNumbersHere) return res.status(409).json({ code: 'LATE_RULE_IN_PEOPLE', error: 'Late marks are cut by the time missed, set in People under Attendance rules. Change them there.' });
    const s = await peoplePrisma.attendanceSettings.upsert({
      where: { orgId },
      create: { accountId, orgId, ...settings, updatedByUserId: req.auth!.userId },
      update: { ...settings, updatedByUserId: req.auth!.userId },
    });
    /* A new choice here wins over People's Company choices, which only mirror the old words back (companyChoices.ts). */
    if ((previous?.correctionApproval || 'HR') !== s.correctionApproval) {
      await peoplePrisma.peopleSetting.updateMany({ where: { orgId }, data: { correctionApproval: null, updatedByUserId: req.auth!.userId } });
    }
    /*
     * The late rule follows these two numbers, the numbers only, never the cut (timeRules.ts marksFromLegacy), versioned
     * like a save in People and counting from next month. When People has never saved late marks the numbers are the rule
     * (rulesOf reads them), so the version is the baseline too: this month and any undecided earlier month keep the rule
     * they had (markRules.ts marksRulesOn takes the first change's `before`).
     */
    if (numbersChange) {
      const inPeople = Boolean((previous?.timeRules as any)?.marks);
      const next = inPeople ? marksFromLegacy(rulesBefore, s) : rulesOf(s);
      if (inPeople) await peoplePrisma.attendanceSettings.update({ where: { orgId }, data: { timeRules: next as any } });
      const from = nextMonthStart(today());
      if (JSON.stringify(rulesBefore.marks) !== JSON.stringify(next.marks)) {
        await recordRuleVersion(accountId, orgId, req.auth!.userId, { kind: 'RULES', name: 'Attendance rules', before: rulesBefore, after: next, from });
      }
      const nums = (x: { lateAllowancePerMonth: number; latePenaltyEvery: number }) => ({ lateAllowancePerMonth: x.lateAllowancePerMonth, latePenaltyEvery: x.latePenaltyEvery });
      const was = nums({ lateAllowancePerMonth: previous?.lateAllowancePerMonth ?? 0, latePenaltyEvery: previous?.latePenaltyEvery ?? 0 });
      const words = (x: ReturnType<typeof nums>) => (x.latePenaltyEvery ? `${x.lateAllowancePerMonth} free, then every ${x.latePenaltyEvery}` : 'no penalty');
      await recordAudit(req, { entity: 'AttendanceSettings', entityId: orgId, action: 'UPDATE', message: `Late arrivals: ${words(was)} → ${words(nums(s))}, from ${from}`, metadata: { before: was, after: nums(s), from } });
    }
    if (readerTrust !== undefined && readerTrust !== (await readerTrustOn(accountId, orgId))) {
      await platformPrisma.featureSetting.upsert({
        where: { orgId_key: { orgId, key: READER_TRUST } },
        update: { enabled: readerTrust, updatedByUserId: req.auth!.userId },
        create: { accountId, orgId, key: READER_TRUST, enabled: readerTrust, updatedByUserId: req.auth!.userId },
      });
      await recordRuleVersion(accountId, orgId, req.auth!.userId, { kind: 'RULES', before: { readerTrust: !readerTrust }, after: { readerTrust } });
    }
    const pick = (x: any) => (x ? { defaultShiftId: x.defaultShiftId, lateAllowancePerMonth: x.lateAllowancePerMonth, latePenaltyEvery: x.latePenaltyEvery, photoRetentionDays: x.photoRetentionDays, readerUsersBecomeEmployees: x.readerUsersBecomeEmployees, leaveApproval: x.leaveApproval, correctionApproval: x.correctionApproval, readerLateUploadHours: x.readerLateUploadHours, autoShiftByPunch: x.autoShiftByPunch } : null);
    if (JSON.stringify(pick(previous)) !== JSON.stringify(pick(s))) {
      await recordRuleVersion(accountId, orgId, req.auth!.userId, { kind: 'RULES', before: pick(previous), after: pick(s) });
    }
    res.json({ rules: { defaultShiftId: s.defaultShiftId, lateAllowancePerMonth: s.lateAllowancePerMonth, latePenaltyEvery: s.latePenaltyEvery, photoRetentionDays: s.photoRetentionDays, readerUsersBecomeEmployees: s.readerUsersBecomeEmployees, leaveApproval: s.leaveApproval, correctionApproval: s.correctionApproval, autoShiftByPunch: s.autoShiftByPunch, ...(await lateRule(orgId, s)), ...(await trustRules(accountId, orgId, s)) } });
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
