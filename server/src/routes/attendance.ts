import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requireAnyPermission, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { phoneStatus, recordPhonePunch } from '../services/attendance/phonePunch.js';
import { hrMayDecide } from '../services/attendance/approvalChain.js';
import { peoplePrisma, peopleWrite, afterPeopleCommit } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import { hrOrAttendanceRouteOk } from '../services/people/guards.js';
import {
  DEFAULT_SHIFT,
  computeDay,
  isWeeklyOff,
  isHHMM,
  isOvernight,
  nightShiftLabel,
  istDate,
  istInstant,
  istTime,
  monthSummary,
  type ShiftRule,
} from '../services/attendance/compute.js';
import { clientIp } from '../services/auth.js';
import { loadHolidays, loadSchedule, resolveShift } from '../services/attendance/schedule.js';
import { emit as emitWebhook } from '../services/attendance/webhooks.js';
import { logDayChange } from '../services/attendance/history.js';
import { recordRuleVersion } from '../services/attendance/ruleVersions.js';
import { deleteToBin } from '../services/recycleBin.js';
import { MONTH_DAYS, scheduleGuard, shiftRanges, type DateRange } from '../services/attendance/scheduleGuard.js';
import {
  ISO_DATE,
  STATUSES,
  fail,
  sendError,
  shiftFor,
  isHoliday,
  instants,
  MonthClosedError,
  closedMonths,
  assertMonthOpen,
  writeDay,
  employeeIn,
  myEmployee,
  withNames,
  today,
  peopleByCode,
  codeKey,
  daysOfMonth,
  daysBetween,
  periodContext,
  monthRows,
  periodRows,
} from '../services/attendance/days.js';
import { DEFAULT_RULES, KINDS, KIND_WORDS, askRequest, cancelRequest, decideRequest, editRequest, rulesFor, saveRules, story, usage, type Kind } from '../services/attendance/requests.js';
import { CHAINS } from '../services/attendance/approvalChain.js';
import { nightShiftsOn, timesOn } from '../services/attendance/nightShift.js';
import { clockDateFor } from '../services/attendance/punches.js';
import { inScope, scopeWhere, teamScope } from '../services/people/scope.js';
import { isTimeLeaveSuggestionField, timeLeaveSuggestions } from '../services/attendance/suggestions.js';
import { recordAudit } from '../services/auditTrail.js';
import { TRUST_LEVELS, readerTrustOn } from '../services/attendance/trust.js';

/**
 * Attendance, native (after Horilla HRMS's attendance; reference only).
 *
 * The rules for a day live in services/attendance/compute.ts; this file reads
 * and writes the rows around them. Clocking uses the server's clock, never the
 * browser's, so a punch cannot be backdated by changing a phone's time.
 */
export const attendanceRouter = Router();
attendanceRouter.use(requireAuth, requireTenantContext);

const R = ATTENDANCE_RESOURCE;
const can = (action: string, resource: string) => requirePermission(ATTENDANCE_MODULE, action as any, resource);
const dateParam = (v: unknown, fallback: string) => {
  const s = String(v || '').trim();
  return ISO_DATE.test(s) ? s : fallback;
};

// ---------------------------------------------------------------------------
// Overview and records
// ---------------------------------------------------------------------------

attendanceRouter.get('/orgs/:orgId/attendance/overview', can(PermissionAction.VIEW, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const date = dateParam(req.query.date, today());
  const [people, records, holiday] = await Promise.all([
    peoplePrisma.employee.findMany({
      where: { accountId, orgId, status: { in: ['ACTIVE', 'ON_NOTICE'] }, attendanceRequired: true },
      select: { id: true, name: true, code: true, department: true, photoUrl: true },
      orderBy: { name: 'asc' },
    }),
    peoplePrisma.attendanceRecord.findMany({ where: { accountId, orgId, date } }),
    peoplePrisma.holiday.findFirst({ where: { orgId, date, isOptional: false, branchId: null } }),
  ]);
  const byEmployee = new Map(records.map((r) => [r.employeeId, r]));
  const count = (s: string) => records.filter((r) => r.status === s).length;
  res.json({
    date,
    holiday: holiday ? holiday.name : null,
    headcount: people.length,
    present: count('PRESENT'),
    halfDay: count('HALF_DAY'),
    absent: count('ABSENT'),
    onLeave: count('ON_LEAVE'),
    notMarked: people.filter((p) => !byEmployee.has(p.id)).length,
    late: (await withNames(orgId, records.filter((r) => r.lateMinutes > 0))).map((r) => ({
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      checkInTime: r.checkInTime,
      lateMinutes: r.lateMinutes,
    })),
    notIn: people.filter((p) => !byEmployee.get(p.id)?.checkIn && byEmployee.get(p.id)?.status !== 'ON_LEAVE').slice(0, 50),
    toValidate: await peoplePrisma.attendanceRecord.count({ where: { accountId, orgId, validated: false, date: { lt: today() } } }),
    pendingRequests: await peoplePrisma.attendanceRequest.count({ where: { accountId, orgId, status: 'PENDING' } }),
    pendingLeave: await peoplePrisma.leaveRequest.count({ where: { accountId, orgId, status: 'PENDING' } }),
  });
});

attendanceRouter.get('/orgs/:orgId/attendance/records', can(PermissionAction.VIEW, R.records), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const to = dateParam(req.query.to, today());
  const from = dateParam(req.query.from, to);
  const pick = (k: string) => String(req.query[k] || '').trim() || undefined;
  /* Reader trust (O-11): the filter and the column only while the company has it on. */
  const readerTrust = await readerTrustOn(accountId, orgId);
  const trust = readerTrust && (TRUST_LEVELS as readonly string[]).includes(String(pick('trust'))) ? pick('trust') : undefined;
  const rows = await peoplePrisma.attendanceRecord.findMany({
    where: {
      accountId,
      orgId,
      date: { gte: from, lte: to },
      ...(pick('employeeId') ? { employeeId: pick('employeeId') } : {}),
      ...(pick('status') ? { status: pick('status') } : {}),
      ...(pick('validated') ? { validated: pick('validated') === 'true' } : {}),
      ...(pick('late') === 'true' ? { lateMinutes: { gt: 0 } } : {}),
      ...(pick('overtime') === 'true' ? { overtimeMinutes: { gt: 0 } } : {}),
      ...(trust ? { trust } : {}),
    },
    orderBy: [{ date: 'desc' }],
    take: 2000,
  });
  const named = await withNames(orgId, rows);
  /* Off: the rows are exactly as before, with no trust on them. */
  const records = readerTrust ? named : named.map(({ trust: _t, trustReasons: _r, ...r }) => r);
  res.json({ records, from, to, readerTrust });
});

const markSchema = z.object({
  employeeId: z.string().trim().min(1),
  date: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'),
  checkIn: z.string().optional().nullable(),
  checkOut: z.string().optional().nullable(),
  status: z.enum(STATUSES).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

/**
 * Times typed for a day as instants. With night shifts on and the person's
 * shift that day ending the next morning, a time after midnight is after
 * midnight (compute.ts nightInstants); otherwise as always.
 */
async function handTimes(orgId: string, accountId: string, employeeId: string, date: string, inHHMM?: string | null, outHHMM?: string | null, on?: boolean) {
  const { rule } = await shiftFor(orgId, employeeId, date);
  if (!isOvernight(rule)) return instants(date, inHHMM, outHHMM);
  return timesOn(date, rule, on ?? (await nightShiftsOn(orgId, accountId)), inHHMM, outHHMM);
}

/** Mark or correct a day for someone (a manager's entry). */
attendanceRouter.put('/orgs/:orgId/attendance/records', can(PermissionAction.EDIT, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = markSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid day.' });
  const b = parsed.data;
  try {
    if ((b.checkIn && !isHHMM(b.checkIn)) || (b.checkOut && !isHHMM(b.checkOut))) throw fail(400, 'Times are HH:MM, 24-hour.');
    if (b.checkOut && !b.checkIn) throw fail(400, 'A check-out needs a check-in.');
    if (b.date > today()) throw fail(400, 'Attendance cannot be marked for a day that has not happened.');
    const employee = await employeeIn(orgId, accountId, b.employeeId);
    const { checkIn, checkOut } = await handTimes(orgId, accountId, employee.id, b.date, b.checkIn, b.checkOut);
    const record = await writeDay({
      accountId, orgId, userId: req.auth!.userId, employee, date: b.date, checkIn, checkOut,
      statusOverride: b.status ?? null, source: 'MANUAL', note: b.note ?? null,
    });
    res.json({ record: (await withNames(orgId, [record]))[0] });
  } catch (e) {
    return sendError(res, e);
  }
});

// ---------------------------------------------------------------------------
// Bulk imports (the Import screen): rows in, a verdict per row out
// ---------------------------------------------------------------------------

const IMPORT_MAX = 2000;
type RowResult = { row: number; ok: boolean; error?: string };


/**
 * Days from a spreadsheet: employee code, date, in, out, status, note. Each
 * row is marked the way the Records screen marks one day, so the shift,
 * late minutes, overtime and closed months are all honoured. Rows that fail
 * say why and the rest still go in — a 300-row file with three bad dates
 * should not come back empty.
 */
attendanceRouter.post('/orgs/:orgId/attendance/records/import', can(PermissionAction.EDIT, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nothing to import.' });
  if (rows.length > IMPORT_MAX) return res.status(400).json({ error: `Import up to ${IMPORT_MAX.toLocaleString('en-IN')} days at a time.` });
  /* dryRun: check every row the same way and save nothing, so the screen can show what would happen first. */
  const dryRun = req.body?.dryRun === true;
  const byCode = await peopleByCode(orgId);
  const nightOn = await nightShiftsOn(orgId, accountId);
  const results: RowResult[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] || {};
    const emp = byCode.get(codeKey(r.employeeCode ?? r.code));
    if (!emp) { results.push({ row: i + 1, ok: false, error: `No employee with code ${String(r.employeeCode ?? r.code ?? '').trim() || '(blank)'}.` }); continue; }
    const parsed = markSchema.safeParse({ employeeId: emp.id, date: String(r.date || '').trim(), checkIn: r.checkIn || null, checkOut: r.checkOut || null, status: r.status ? String(r.status).trim().toUpperCase().replace(/[\s-]+/g, '_') : null, note: r.note || null });
    if (!parsed.success) { results.push({ row: i + 1, ok: false, error: parsed.error.issues[0]?.message || 'Invalid row.' }); continue; }
    const b = parsed.data;
    try {
      if ((b.checkIn && !isHHMM(b.checkIn)) || (b.checkOut && !isHHMM(b.checkOut))) throw fail(400, 'Times are HH:MM, 24-hour.');
      if (b.checkOut && !b.checkIn) throw fail(400, 'A check-out needs a check-in.');
      if (b.date > today()) throw fail(400, 'That day has not happened yet.');
      const employee = await employeeIn(orgId, accountId, b.employeeId);
      const { checkIn, checkOut } = await handTimes(orgId, accountId, employee.id, b.date, b.checkIn, b.checkOut, nightOn);
      if (dryRun) await assertMonthOpen(orgId, b.date);
      else await writeDay({ accountId, orgId, userId: req.auth!.userId, employee, date: b.date, checkIn, checkOut, statusOverride: b.status ?? null, source: 'IMPORT', note: b.note ?? null });
      results.push({ row: i + 1, ok: true });
    } catch (e: any) {
      results.push({ row: i + 1, ok: false, error: e?.message || 'Not imported.' });
    }
  }
  const imported = results.filter((x) => x.ok).length;
  res.json({ dryRun, imported, failed: results.length - imported, results: results.filter((x) => !x.ok) });
});

/** Holidays from a list: date, name, optional (yes/no), area (by name; blank = everyone). A date already on the calendar with the same name is skipped. */
attendanceRouter.post('/orgs/:orgId/attendance/holidays/import', can(PermissionAction.CREATE, R.holidays), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nothing to import.' });
  if (rows.length > 500) return res.status(400).json({ error: 'Import up to 500 holidays at a time.' });
  const dryRun = req.body?.dryRun === true;
  const areas = new Map((await peoplePrisma.area.findMany({ where: { orgId }, select: { id: true, name: true } })).map((a) => [a.name.trim().toLowerCase(), a.id]));
  const existing = await peoplePrisma.holiday.findMany({ where: { orgId }, select: { date: true, name: true } });
  const have = new Set(existing.map((h) => `${h.date}|${h.name.trim().toLowerCase()}`));
  const results: RowResult[] = [];
  let imported = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] || {};
    const areaName = String(r.area || '').trim();
    const areaId = areaName ? areas.get(areaName.toLowerCase()) : null;
    if (areaName && !areaId) { results.push({ row: i + 1, ok: false, error: `No area called ${areaName}.` }); continue; }
    const parsed = holidaySchema.safeParse({ date: String(r.date || '').trim(), name: String(r.name || '').trim(), isOptional: /^(y|yes|true|1)$/i.test(String(r.optional ?? r.isOptional ?? '')), areaId: areaId || null });
    if (!parsed.success) { results.push({ row: i + 1, ok: false, error: parsed.error.issues[0]?.message || 'Invalid row.' }); continue; }
    const key = `${parsed.data.date}|${parsed.data.name.toLowerCase()}`;
    if (have.has(key)) { skipped += 1; continue; }
    if (!dryRun) await peoplePrisma.holiday.create({ data: { accountId, orgId, date: parsed.data.date, name: parsed.data.name, isOptional: Boolean(parsed.data.isOptional), branchId: null, areaId: parsed.data.areaId || null, createdByUserId: req.auth!.userId } });
    have.add(key);
    imported += 1;
  }
  res.json({ dryRun, imported, skipped, failed: results.length, results });
});

/** Shift assignments from a list: employee code, shift (by name), from, to (blank = open-ended). */
attendanceRouter.post('/orgs/:orgId/attendance/shift-assignments/import', can(PermissionAction.EDIT, R.shifts), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nothing to import.' });
  if (rows.length > IMPORT_MAX) return res.status(400).json({ error: `Import up to ${IMPORT_MAX.toLocaleString('en-IN')} assignments at a time.` });
  const dryRun = req.body?.dryRun === true;
  const [byCode, shifts] = await Promise.all([peopleByCode(orgId), peoplePrisma.shift.findMany({ where: { orgId }, select: { id: true, name: true } })]);
  const shiftByName = new Map(shifts.map((x) => [x.name.trim().toLowerCase(), x.id]));
  const guard = await scheduleGuard(orgId);
  const results: RowResult[] = [];
  let imported = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] || {};
    const emp = byCode.get(codeKey(r.employeeCode ?? r.code));
    if (!emp) { results.push({ row: i + 1, ok: false, error: `No employee with code ${String(r.employeeCode ?? r.code ?? '').trim() || '(blank)'}.` }); continue; }
    const shiftId = shiftByName.get(String(r.shift || '').trim().toLowerCase());
    if (!shiftId) { results.push({ row: i + 1, ok: false, error: `No shift called ${String(r.shift || '').trim() || '(blank)'}.` }); continue; }
    const from = String(r.from ?? r.effectiveFrom ?? '').trim();
    const to = String(r.to ?? r.effectiveTo ?? '').trim() || null;
    if (!ISO_DATE.test(from) || (to && !ISO_DATE.test(to))) { results.push({ row: i + 1, ok: false, error: 'Dates are YYYY-MM-DD.' }); continue; }
    if (to && to < from) { results.push({ row: i + 1, ok: false, error: 'The end is before the start.' }); continue; }
    /* A row reaching into a closed month is refused like the screen's add (O-05); the rest still import. */
    const replaced = guard.months.length ? await peoplePrisma.shiftAssignment.findUnique({ where: { employeeId_effectiveFrom: { employeeId: emp.id, effectiveFrom: from } }, select: { effectiveTo: true } }) : null;
    const refused = guard.refusal(assignmentRanges(from, to, replaced));
    if (refused) { results.push({ row: i + 1, ok: false, error: refused.message }); continue; }
    if (!dryRun) await peoplePrisma.shiftAssignment.upsert({
      where: { employeeId_effectiveFrom: { employeeId: emp.id, effectiveFrom: from } },
      create: { accountId, orgId, employeeId: emp.id, shiftId, effectiveFrom: from, effectiveTo: to, createdByUserId: req.auth!.userId },
      update: { shiftId, effectiveTo: to },
    });
    imported += 1;
  }
  res.json({ dryRun, imported, failed: results.length, results });
});

attendanceRouter.delete('/orgs/:orgId/attendance/records/:id', can(PermissionAction.DELETE, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    await peopleWrite(orgId, async () => {
      const r = await peoplePrisma.attendanceRecord.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
      if (!r) throw fail(404, 'No such day.');
      await assertMonthOpen(orgId, r.date, r.employeeId);
      if (r.leaveRequestId) throw fail(409, 'Cancel the linked leave request before deleting this day.', 'LEAVE_CONFLICT');
      await deleteToBin(req, 'attendanceRecord', r);
      await logDayChange({ accountId, orgId, employeeId: r.employeeId, date: r.date, recordId: r.id, action: 'DELETE', before: r, after: null, userId: req.auth!.userId });
    });
    res.json({ ok: true });
  } catch (e) { return sendError(res, e); }
});

/** Validate days (a manager confirms them). Only past or closed days. */
attendanceRouter.post('/orgs/:orgId/attendance/records/validate', can(PermissionAction.APPROVE, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 2000) : [];
  if (!ids.length) return res.status(400).json({ error: 'Choose the days to validate.' });
  const open = await peoplePrisma.attendanceRecord.count({
    where: { accountId, orgId, id: { in: ids }, checkIn: { not: null }, checkOut: null },
  });
  if (open) return res.status(409).json({ error: `${open} of those days are still open (checked in, not out).` });
  const beforeRows = await peoplePrisma.attendanceRecord.findMany({ where: { accountId, orgId, id: { in: ids }, validated: false } });
  const r = await peoplePrisma.attendanceRecord.updateMany({
    where: { accountId, orgId, id: { in: ids } },
    data: { validated: true, validatedByUserId: req.auth!.userId, validatedAt: new Date() },
  });
  for (const b of beforeRows) {
    await logDayChange({ accountId, orgId, employeeId: b.employeeId, date: b.date, recordId: b.id, action: 'VALIDATE', before: b, after: { ...b, validated: true }, userId: req.auth!.userId });
  }
  res.json({ validated: r.count });
});

attendanceRouter.post('/orgs/:orgId/attendance/records/:id/overtime', can(PermissionAction.APPROVE, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.attendanceRecord.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return res.status(404).json({ error: 'No such day.' });
  if (!r.overtimeMinutes) return res.status(400).json({ error: 'There is no overtime on that day.' });
  /* Overtime is paid with the month: a closed month's overtime is final (closure audit, 27 Oct 2026). */
  try {
    await assertMonthOpen(orgId, r.date, r.employeeId);
  } catch (e) {
    return sendError(res, e);
  }
  const updated = await peoplePrisma.attendanceRecord.update({
    where: { id: r.id },
    data: { overtimeApproved: req.body?.approved !== false },
  });
  await logDayChange({ accountId, orgId, employeeId: r.employeeId, date: r.date, recordId: r.id, action: 'OVERTIME', before: r, after: updated, userId: req.auth!.userId });
  res.json({ record: updated });
});

/**
 * Who can be marked or asked for: the people pickers in Attendance and in the
 * shared Time & Leave screens, without needing People. Anyone who may see
 * days, leave or attendance requests may list them; a team-scoped role sees
 * its own team only.
 */
attendanceRouter.get(
  '/orgs/:orgId/attendance/employees',
  requireAnyPermission([ATTENDANCE_MODULE, PermissionAction.VIEW, R.records], [ATTENDANCE_MODULE, PermissionAction.VIEW, R.leave], [ATTENDANCE_MODULE, PermissionAction.VIEW, R.requests]),
  async (req, res) => {
    if (!(await hrOrAttendanceRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const employees = await peoplePrisma.employee.findMany({
      where: { accountId, orgId, status: { not: 'LEFT' }, ...scopeWhere(await teamScope(req)) },
      select: { id: true, name: true, code: true, department: true },
      orderBy: { name: 'asc' },
    });
    res.json({ employees });
  },
);

/** Time & Leave field suggestions (a leave reason, a request reason, an on-duty place): the same words People offers, for a company with only Attendance. */
attendanceRouter.get(
  '/orgs/:orgId/attendance/suggestions',
  requireAnyPermission([ATTENDANCE_MODULE, PermissionAction.VIEW, R.leave], [ATTENDANCE_MODULE, PermissionAction.VIEW, R.requests]),
  async (req, res) => {
    if (!(await hrOrAttendanceRouteOk(req, res))) return;
    const field = String(req.query.field || '');
    if (!isTimeLeaveSuggestionField(field)) return res.json({ values: [] });
    res.json({ values: await timeLeaveSuggestions(req.tenant!.orgId, field) });
  },
);

// ---------------------------------------------------------------------------
// Self-service: my attendance and the clock
// ---------------------------------------------------------------------------

attendanceRouter.get('/orgs/:orgId/attendance/me', can(PermissionAction.VIEW, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const t = today();
    const from = istDate(new Date(Date.now() - 31 * 86_400_000));
    const [records, shift, requests] = await Promise.all([
      peoplePrisma.attendanceRecord.findMany({ where: { orgId, employeeId: me.id, date: { gte: from } }, orderBy: { date: 'desc' } }),
      shiftFor(orgId, me.id, t),
      peoplePrisma.attendanceRequest.findMany({ where: { orgId, employeeId: me.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const shaped = await withNames(orgId, records);
    /* An open record from last night's shift still counts as "in". */
    const open = shaped.find((r) => r.checkIn && !r.checkOut && Date.now() - new Date(r.checkIn).getTime() < 20 * 3_600_000) || null;
    res.json({
      employee: { id: me.id, name: me.name, code: me.code },
      today: t,
      shift: { name: shift.name, startTime: shift.rule.startTime, endTime: shift.rule.endTime, ...(isOvernight(shift.rule) && (await nightShiftsOn(orgId, accountId)) ? { label: nightShiftLabel(shift.rule) } : {}) },
      clockedIn: Boolean(open),
      todayRecord: shaped.find((r) => r.date === t) || open,
      records: shaped,
      requests,
      /* The phone punch card, when HR has switched it on for this person (Portal access). */
      ...(await phoneStatus(me)),
    });
  } catch (e) {
    return sendError(res, e);
  }
});

/** A punch from the phone, with the same checks as the employee portal's (services/attendance/phonePunch.ts). */
attendanceRouter.post('/orgs/:orgId/attendance/me/punch', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    if (me.status === 'LEFT') throw fail(403, 'This employee file is marked as having left.');
    const out = await recordPhonePunch(me, req.body);
    res.status(out.status).json(out.body);
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceRouter.post('/orgs/:orgId/attendance/clock', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    if (me.status === 'LEFT') throw fail(403, 'This employee file is marked as having left.');
    const now = new Date();
    const open = await peoplePrisma.attendanceRecord.findFirst({
      where: { orgId, employeeId: me.id, checkIn: { not: null, gte: new Date(now.getTime() - 20 * 3_600_000) }, checkOut: null },
      orderBy: { checkIn: 'desc' },
    });
    const wanted = req.body?.kind === 'IN' || req.body?.kind === 'OUT' ? req.body.kind : open ? 'OUT' : 'IN';
    let record;
    if (wanted === 'OUT') {
      if (!open) throw fail(409, 'You are not clocked in.');
      record = await writeDay({ accountId, orgId, userId: req.auth!.userId, employee: me, date: open.date, checkIn: open.checkIn, checkOut: now, source: 'CLOCK' });
    } else {
      if (open) throw fail(409, 'You are already clocked in.');
      const date = await clockDateFor(orgId, accountId, me.id, now);
      const existing = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: me.id, date } } });
      if (existing?.checkOut) throw fail(409, 'Today is already closed. Ask for a correction if you came back in.');
      record = await writeDay({ accountId, orgId, userId: req.auth!.userId, employee: me, date, checkIn: now, checkOut: null, source: 'CLOCK' });
    }
    await peoplePrisma.attendanceActivity.create({
      data: { accountId, orgId, employeeId: me.id, at: now, kind: wanted, source: 'CLOCK', ip: clientIp(req) || null },
    });
    res.json({ kind: wanted, record: (await withNames(orgId, [record]))[0] });
  } catch (e) {
    return sendError(res, e);
  }
});

// ---------------------------------------------------------------------------
// Correction requests
// ---------------------------------------------------------------------------


/*
 * Attendance requests of four kinds (services/attendance/requests.ts): a
 * missed punch (the correction, as before, the default kind), work from home,
 * on duty and permission hours. These routes open for a People-only company
 * too (hrOrAttendanceRouteOk): a request is HR's as much as Attendance's.
 */

/** `by` is who asks: the signed-in user, or — from the employee portal — the employee themselves. */
export const createRequest = async (req: any, res: any, employeeId: string, by?: { accountId: string; orgId: string; userId: string }) => {
  const { accountId, orgId } = by || req.tenant!;
  const userId = by?.userId || req.auth!.userId;
  try {
    const employee = await employeeIn(orgId, accountId, employeeId);
    /* HR entering it for someone is not held to the back-date window; a person asking for themselves is. */
    const onBehalf = !by && !(await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId, userId }, select: { id: true } }));
    const row = await askRequest({ accountId, orgId, userId, onBehalf }, employee, req.body);
    res.status(201).json({ request: row });
  } catch (e) {
    return sendError(res, e);
  }
};

/** The employee file of the signed-in user, or null: the manager's step and "my own" are decided from it. */
const myFile = (orgId: string, userId: string) => peoplePrisma.employee.findFirst({ where: { orgId, userId }, select: { id: true } });
const noteOf = (req: any) => String(req.body?.note || '').trim().slice(0, 500) || null;
const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

attendanceRouter.post('/orgs/:orgId/attendance/me/requests', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  try {
    const me = await myEmployee(req.tenant!.accountId, req.tenant!.orgId, req.auth!.userId);
    return createRequest(req, res, me.id);
  } catch (e) {
    return sendError(res, e);
  }
});

/** My own requests of every kind, newest first, with this month's usage per kind and what is switched on. */
attendanceRouter.get('/orgs/:orgId/attendance/me/requests', can(PermissionAction.VIEW, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : today().slice(0, 7);
    const rules = await rulesFor(orgId);
    const [rows, ...use] = await Promise.all([
      peoplePrisma.attendanceRequest.findMany({ where: { orgId, employeeId: me.id }, orderBy: { createdAt: 'desc' }, take: 200 }),
      ...KINDS.map((k) => usage(orgId, me.id, k, month, { rules })),
    ]);
    res.json({ month, requests: await withNames(orgId, rows), usage: Object.fromEntries(use.map((u) => [u.kind, u])), rules });
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceRouter.put('/orgs/:orgId/attendance/me/requests/:id', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: String(req.params.id), orgId, employeeId: me.id } });
    if (!r) return res.status(404).json({ error: 'No such request.' });
    res.json({ request: await editRequest({ accountId, orgId, userId: req.auth!.userId, onBehalf: false }, r, req.body) });
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceRouter.post('/orgs/:orgId/attendance/me/requests/:id/cancel', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: String(req.params.id), orgId, employeeId: me.id } });
    if (!r) return res.status(404).json({ error: 'No such request.' });
    res.json({ request: await cancelRequest(accountId, orgId, r, { userId: req.auth!.userId, employeeId: me.id, hr: false }) });
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceRouter.post('/orgs/:orgId/attendance/requests', can(PermissionAction.CREATE, R.requests), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  try {
    const employee = await employeeIn(req.tenant!.orgId, req.tenant!.accountId, String(req.body?.employeeId || ''));
    if (!inScope(await teamScope(req), employee.id)) return res.status(404).json({ error: 'No such employee.' });
    return createRequest(req, res, employee.id);
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * Requests, inside the caller's team scope. With `limit` (People's list): one
 * page, searched and filtered on the server, with the total and a count per
 * status for the tabs. Without it, the old shape, still capped.
 */
attendanceRouter.get('/orgs/:orgId/attendance/requests', can(PermissionAction.VIEW, R.requests), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const scope = await teamScope(req);
  const status = String(req.query.status || '').trim();
  const kind = String(req.query.kind || '').trim();
  const employeeId = String(req.query.employeeId || '').trim();
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : '';
  const inMonth = month ? { date: { lte: `${month}-31` }, OR: [{ toDate: null, date: { gte: `${month}-01` } }, { toDate: { gte: `${month}-01` } }] } : {};
  /* Search narrows the people first, then the requests: name, employee ID. */
  const q = String(req.query.q || '').trim().slice(0, 80);
  let people: string[] | null = scope.all ? null : scope.ids;
  if (q) {
    const found = await peoplePrisma.employee.findMany({ where: { orgId, ...(people ? { id: { in: people } } : {}), OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] }, select: { id: true }, take: 5000 });
    people = found.map((f) => f.id);
  }
  const base_ = { accountId, orgId, ...(employeeId ? { employeeId } : {}), ...(people ? { employeeId: employeeId ? (people.includes(employeeId) ? employeeId : '__none__') : { in: people } } : {}), ...(kind ? { kind } : {}), ...inMonth };
  const where = { ...base_, ...(status ? { status } : {}) };
  const limitQ = Number(req.query.limit);
  if (Number.isInteger(limitQ) && limitQ > 0) {
    const limit = Math.min(100, limitQ);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    /* Waiting: oldest first, so what has waited longest is on top; the rest newest first. */
    const orderBy: any = status === 'PENDING' ? [{ createdAt: 'asc' }] : [{ date: 'desc' }, { createdAt: 'desc' }];
    const [rows, total, grouped] = await Promise.all([
      peoplePrisma.attendanceRequest.findMany({ where, orderBy, take: limit, skip: offset }),
      peoplePrisma.attendanceRequest.count({ where }),
      peoplePrisma.attendanceRequest.groupBy({ by: ['status'], where: base_, _count: { _all: true } }),
    ]);
    const counts: Record<string, number> = Object.fromEntries(REQUEST_STATUSES.map((k) => [k, 0]));
    for (const g of grouped) counts[g.status] = g._count._all;
    counts.all = Object.values(counts).reduce((a, n) => a + n, 0);
    return res.json({ requests: await withNames(orgId, rows), total, counts, limit, offset });
  }
  const rows = await peoplePrisma.attendanceRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 });
  res.json({ requests: await withNames(orgId, rows) });
});

/** Used, waiting and left this month for one person and kind (every kind when none is given). */
attendanceRouter.get('/orgs/:orgId/attendance/requests/usage', can(PermissionAction.VIEW, R.requests), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const employeeId = String(req.query.employeeId || '').trim();
  if (!employeeId || !inScope(await teamScope(req), employeeId)) return res.status(404).json({ error: 'No such employee.' });
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : today().slice(0, 7);
  const kind = String(req.query.kind || '').trim();
  if (kind && !(KINDS as readonly string[]).includes(kind)) return res.status(400).json({ error: 'Unknown request kind.' });
  const rules = await rulesFor(orgId);
  const kinds = kind ? [kind as Kind] : [...KINDS];
  const use = await Promise.all(kinds.map((k) => usage(orgId, employeeId, k, month, { rules })));
  res.json({ month, usage: Object.fromEntries(use.map((u) => [u.kind, u])) });
});

/** The company's request rules (Settings → Request rules): what is on, quotas, back-date windows, who approves. */
attendanceRouter.get('/orgs/:orgId/attendance/request-rules', can(PermissionAction.VIEW, R.requests), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  res.json({ rules: await rulesFor(req.tenant!.orgId), kinds: KINDS, chains: CHAINS, defaults: DEFAULT_RULES });
});

attendanceRouter.put('/orgs/:orgId/attendance/request-rules', can(PermissionAction.APPROVE, R.requests), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  /* The rules are the company's: a team role does not set them. */
  if (!(await teamScope(req)).all) return res.status(403).json({ error: 'Request rules are set by someone who decides for the whole company.' });
  try {
    const before = await rulesFor(orgId);
    const rules = await saveRules(accountId, orgId, req.auth!.userId, req.body);
    const changed = KINDS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(rules[k]));
    if (changed.length) await recordAudit(req, { entity: 'AttendanceSettings', entityId: orgId, action: 'UPDATE', message: `Request rules changed: ${changed.map((k) => `${KIND_WORDS[k].name} ${rules[k].on ? 'on' : 'off'}`).join(', ')}`, metadata: Object.fromEntries(changed.map((k) => [k, { before: before[k], after: rules[k] }])) });
    res.json({ rules });
  } catch (e) {
    return sendError(res, e);
  }
});

/** One request's story: the row, its history with names, the month's usage, the days as they stand. */
attendanceRouter.get('/orgs/:orgId/attendance/requests/:id', can(PermissionAction.VIEW, R.requests), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r || !inScope(await teamScope(req), r.employeeId)) return res.status(404).json({ error: 'No such request.' });
  try {
    const mine = await myFile(orgId, req.auth!.userId);
    res.json({ ...(await story(accountId, orgId, r)), ownRequest: Boolean(mine && mine.id === r.employeeId) });
  } catch (e) {
    return sendError(res, e);
  }
});

const review = (approve: boolean) => async (req: any, res: any) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  const scope = await teamScope(req);
  if (!r || !inScope(scope, r.employeeId)) return res.status(404).json({ error: 'No such request.' });
  try {
    /* A decider with an employee file may be the person's manager (or stand in for them): the manager's step is theirs. */
    const mine = await myFile(orgId, req.auth!.userId);
    const out = await decideRequest(accountId, orgId, r, approve, { userId: req.auth!.userId, managerId: mine?.id ?? null, scopeAll: scope.all }, noteOf(req));
    res.json(out);
  } catch (e) {
    return sendError(res, e);
  }
};
attendanceRouter.post('/orgs/:orgId/attendance/requests/:id/approve', can(PermissionAction.APPROVE, R.requests), review(true));
attendanceRouter.post('/orgs/:orgId/attendance/requests/:id/reject', can(PermissionAction.APPROVE, R.requests), review(false));

/** HR cancels any request, before or after its date; the person cancels their own through /me/requests. (Attendance Requests has no Edit right: whoever decides them may also change or cancel.) */
attendanceRouter.post('/orgs/:orgId/attendance/requests/:id/cancel', can(PermissionAction.APPROVE, R.requests), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r || !inScope(await teamScope(req), r.employeeId)) return res.status(404).json({ error: 'No such request.' });
  try {
    const mine = await myFile(orgId, req.auth!.userId);
    res.json({ request: await cancelRequest(accountId, orgId, r, { userId: req.auth!.userId, employeeId: mine?.id ?? null, hr: true }, noteOf(req)) });
  } catch (e) {
    return sendError(res, e);
  }
});

/** Change a waiting request (dates, half day, place, hours, reason); the manager's step is reset. */
attendanceRouter.put('/orgs/:orgId/attendance/requests/:id', can(PermissionAction.APPROVE, R.requests), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r || !inScope(await teamScope(req), r.employeeId)) return res.status(404).json({ error: 'No such request.' });
  try {
    const mine = await myFile(orgId, req.auth!.userId);
    res.json({ request: await editRequest({ accountId, orgId, userId: req.auth!.userId, onBehalf: !mine || mine.id !== r.employeeId }, r, req.body) });
  } catch (e) {
    return sendError(res, e);
  }
});

// ---------------------------------------------------------------------------
// Shifts, assignments, holidays
// ---------------------------------------------------------------------------

const shiftSchema = z.object({
  name: z.string().trim().min(1, 'A shift needs a name.').max(80),
  startTime: z.string().refine(isHHMM, 'Start is HH:MM.'),
  endTime: z.string().refine(isHHMM, 'End is HH:MM.'),
  breakMinutes: z.coerce.number().int().min(0).max(600).default(60),
  graceMinutes: z.coerce.number().int().min(0).max(240).default(10),
  earlyOutGraceMinutes: z.coerce.number().int().min(0).max(240).default(0),
  halfDayMinutes: z.coerce.number().int().min(0).max(1440).default(240),
  fullDayMinutes: z.coerce.number().int().min(1).max(1440).default(480),
  overtimeAfterMinutes: z.coerce.number().int().min(0).max(1440).optional().nullable(),
  weeklyOffDays: z.string().regex(/^([0-6](,[0-6])*)?$/, 'Weekly offs are day numbers 0–6.').default('0'),
  offSaturdays: z.string().regex(/^([1-5](,[1-5])*)?$/, 'Saturdays off are 1–5 (first to fifth).').default(''),
  code: z.string().trim().max(6).optional().nullable(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Colours are #RRGGBB.').optional().nullable().or(z.literal('')),
  isActive: z.boolean().optional(),
});

/**
 * A shift's times and rules can change only while no closed month uses it:
 * a schedule on it covering a closed month, it being the company default, or
 * a closed month's day recorded on it.
 */
async function shiftOpen(orgId: string, shiftId: string) {
  const guard = await scheduleGuard(orgId);
  if (!guard.months.length) return;
  const message = (month: string) => `${month} is closed in Attendance and uses this shift, so its times and rules cannot change. Create a new shift from a date instead.`;
  guard.assertOpen(await shiftRanges(orgId, shiftId), message);
  const day = await peoplePrisma.attendanceRecord.findFirst({
    where: { orgId, shiftId, OR: guard.months.map((m) => ({ date: { gte: `${m}-01`, lte: `${m}-${MONTH_DAYS}` } })) },
    orderBy: { date: 'asc' },
    select: { date: true },
  });
  if (day) throw new MonthClosedError(day.date.slice(0, 7), message(day.date.slice(0, 7)));
}

/** The dates an assignment write affects: the new range, and the range of the row it replaces (same person, same start). */
const assignmentRanges = (from: string, to: string | null, replaced?: { effectiveTo: string | null } | null): DateRange[] => [
  { from, to },
  ...(replaced ? [{ from, to: replaced.effectiveTo }] : []),
];

attendanceRouter.get('/orgs/:orgId/attendance/shifts', can(PermissionAction.VIEW, R.shifts), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const shifts = await peoplePrisma.shift.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } });
  const assigned = await peoplePrisma.shiftAssignment.groupBy({ by: ['shiftId'], where: { accountId, orgId }, _count: { _all: true } });
  const n = new Map(assigned.map((a) => [a.shiftId, a._count._all]));
  res.json({ shifts: shifts.map((s) => ({ ...s, assignments: n.get(s.id) || 0 })) });
});

attendanceRouter.post('/orgs/:orgId/attendance/shifts', can(PermissionAction.CREATE, R.shifts), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = shiftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid shift.' });
  if (parsed.data.halfDayMinutes > parsed.data.fullDayMinutes) return res.status(400).json({ error: 'A half day cannot be longer than a full day.' });
  try {
    const shift = await peoplePrisma.shift.create({ data: { accountId, orgId, ...parsed.data, code: parsed.data.code || null, color: parsed.data.color || null, createdByUserId: req.auth!.userId } as any });
    res.status(201).json({ shift });
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceRouter.put('/orgs/:orgId/attendance/shifts/:id', can(PermissionAction.EDIT, R.shifts), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.shift.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such shift.' });
  const parsed = shiftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid shift.' });
  if (parsed.data.halfDayMinutes > parsed.data.fullDayMinutes) return res.status(400).json({ error: 'A half day cannot be longer than a full day.' });
  const scoring = (x: any) => ({ startTime: x.startTime, endTime: x.endTime, breakMinutes: x.breakMinutes, graceMinutes: x.graceMinutes, earlyOutGraceMinutes: x.earlyOutGraceMinutes, halfDayMinutes: x.halfDayMinutes, fullDayMinutes: x.fullDayMinutes, overtimeAfterMinutes: x.overtimeAfterMinutes ?? null, weeklyOffDays: x.weeklyOffDays, offSaturdays: x.offSaturdays, isActive: x.isActive });
  try {
    /*
     * A shift has no effective date: new times or rules apply to every date it
     * covers, closed months included (O-05). While a closed month uses it, its
     * times and rules stay; the name, code and colour can still change.
     */
    const next = { ...existing, ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) };
    if (JSON.stringify(scoring(existing)) !== JSON.stringify(scoring(next))) await shiftOpen(orgId, existing.id);
    const shift = await peoplePrisma.shift.update({ where: { id: existing.id }, data: { ...parsed.data, code: parsed.data.code || null, color: parsed.data.color || null } as any });
    if (JSON.stringify(scoring(existing)) !== JSON.stringify(scoring(shift))) {
      await recordRuleVersion(accountId, orgId, req.auth!.userId, { kind: 'SHIFT', ref: shift.id, name: shift.name, before: scoring(existing), after: scoring(shift) });
    }
    res.json({ shift });
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceRouter.delete('/orgs/:orgId/attendance/shifts/:id', can(PermissionAction.DELETE, R.shifts), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.shift.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such shift.' });
  const used = (await peoplePrisma.shiftAssignment.count({ where: { orgId, shiftId: existing.id } })) +
    (await peoplePrisma.attendanceRecord.count({ where: { orgId, shiftId: existing.id } }));
  if (used) return res.status(409).json({ error: 'This shift is assigned or has days recorded on it. Mark it inactive instead.' });
  await deleteToBin(req, 'shift', existing);
  res.json({ ok: true });
});

attendanceRouter.get('/orgs/:orgId/attendance/shift-assignments', can(PermissionAction.VIEW, R.shifts), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employeeId = String(req.query.employeeId || '').trim();
  const rows = await peoplePrisma.shiftAssignment.findMany({
    where: { accountId, orgId, ...(employeeId ? { employeeId } : {}) },
    orderBy: [{ effectiveFrom: 'desc' }],
    take: 1000,
  });
  const shifts = new Map((await peoplePrisma.shift.findMany({ where: { orgId }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  res.json({ assignments: (await withNames(orgId, rows)).map((r) => ({ ...r, shiftName: shifts.get(r.shiftId) || '—' })) });
});

attendanceRouter.post('/orgs/:orgId/attendance/shift-assignments', can(PermissionAction.EDIT, R.shifts), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      employeeIds: z.array(z.string().min(1)).min(1).max(1000),
      shiftId: z.string().min(1),
      effectiveFrom: z.string().regex(ISO_DATE),
      effectiveTo: z.string().regex(ISO_DATE).optional().nullable().or(z.literal('')),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose people, a shift and a start date.' });
  const { employeeIds, shiftId, effectiveFrom } = parsed.data;
  const effectiveTo = parsed.data.effectiveTo || null;
  if (effectiveTo && effectiveTo < effectiveFrom) return res.status(400).json({ error: 'The end is before the start.' });
  const shift = await peoplePrisma.shift.findFirst({ where: { id: shiftId, orgId } });
  if (!shift) return res.status(400).json({ error: 'That shift is not in this organisation.' });
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: employeeIds } }, select: { id: true } });
  /* The new range, and any row it replaces, may not reach into a closed month (O-05). */
  const replaced = await peoplePrisma.shiftAssignment.findMany({ where: { orgId, employeeId: { in: people.map((p) => p.id) }, effectiveFrom }, select: { effectiveTo: true } });
  const refused = (await scheduleGuard(orgId)).refusal([{ from: effectiveFrom, to: effectiveTo }, ...replaced.map((r) => ({ from: effectiveFrom, to: r.effectiveTo }))]);
  if (refused) return sendError(res, refused);
  for (const p of people) {
    await peoplePrisma.shiftAssignment.upsert({
      where: { employeeId_effectiveFrom: { employeeId: p.id, effectiveFrom } },
      create: { accountId, orgId, employeeId: p.id, shiftId, effectiveFrom, effectiveTo, createdByUserId: req.auth!.userId },
      update: { shiftId, effectiveTo },
    });
  }
  res.json({ assigned: people.length });
});

attendanceRouter.delete('/orgs/:orgId/attendance/shift-assignments/:id', can(PermissionAction.EDIT, R.shifts), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.shiftAssignment.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return res.status(404).json({ error: 'No such assignment.' });
  const refused = (await scheduleGuard(orgId)).refusal([{ from: r.effectiveFrom, to: r.effectiveTo }]);
  if (refused) return sendError(res, refused);
  await deleteToBin(req, 'shiftAssignment', r);
  res.json({ ok: true });
});

const areaOrNull = async (orgId: string, areaId: string | null | undefined) => {
  if (!areaId) return null;
  if (!(await peoplePrisma.area.findFirst({ where: { id: areaId, orgId }, select: { id: true } }))) throw fail(400, 'That area is not in this organisation.');
  return areaId;
};

const holidaySchema = z.object({
  date: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'),
  name: z.string().trim().min(1, 'Name the holiday.').max(80),
  isOptional: z.boolean().optional(),
  branchId: z.string().trim().optional().nullable(),
  /** Null = the whole company; set = only that area's people. */
  areaId: z.string().trim().optional().nullable(),
});

attendanceRouter.get('/orgs/:orgId/attendance/holidays', can(PermissionAction.VIEW, R.holidays), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const year = String(req.query.year || today().slice(0, 4)).slice(0, 4);
  const holidays = await peoplePrisma.holiday.findMany({
    where: { accountId, orgId, date: { gte: `${year}-01-01`, lte: `${year}-12-31` } },
    orderBy: { date: 'asc' },
  });
  const areas = new Map((await peoplePrisma.area.findMany({ where: { orgId }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  res.json({ holidays: holidays.map((h) => ({ ...h, areaName: h.areaId ? areas.get(h.areaId) || null : null })), year });
});

/**
 * A holiday decides whether a day is payable, and a closed month's payable
 * days are final (Payroll has taken them): adding, moving or removing a
 * holiday in a closed month is refused like any other change to its days.
 */
async function holidayMonthsOpen(orgId: string, dates: string[]) {
  const months = [...new Set(dates.filter(Boolean).map((d) => String(d).slice(0, 7)))];
  const closed = await closedMonths(orgId, months);
  if (closed.size) throw new MonthClosedError([...closed][0]);
}

attendanceRouter.post('/orgs/:orgId/attendance/holidays', can(PermissionAction.CREATE, R.holidays), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = holidaySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid holiday.' });
  try {
    await holidayMonthsOpen(orgId, [parsed.data.date]);
    const holiday = await peoplePrisma.holiday.create({
      data: { accountId, orgId, ...parsed.data, branchId: parsed.data.branchId || null, areaId: await areaOrNull(orgId, parsed.data.areaId), isOptional: Boolean(parsed.data.isOptional), createdByUserId: req.auth!.userId },
    });
    res.status(201).json({ holiday });
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceRouter.put('/orgs/:orgId/attendance/holidays/:id', can(PermissionAction.EDIT, R.holidays), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.holiday.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such holiday.' });
  const parsed = holidaySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid holiday.' });
  try {
    await holidayMonthsOpen(orgId, [existing.date, parsed.data.date]);
    const holiday = await peoplePrisma.holiday.update({
      where: { id: existing.id },
      data: { ...parsed.data, branchId: parsed.data.branchId || null, areaId: await areaOrNull(orgId, parsed.data.areaId), isOptional: Boolean(parsed.data.isOptional) },
    });
    res.json({ holiday });
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceRouter.delete('/orgs/:orgId/attendance/holidays/:id', can(PermissionAction.DELETE, R.holidays), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.holiday.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such holiday.' });
  try {
    await holidayMonthsOpen(orgId, [existing.date]);
  } catch (e) {
    return sendError(res, e);
  }
  await deleteToBin(req, 'holiday', existing);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// The month, for payroll
// ---------------------------------------------------------------------------

attendanceRouter.get('/orgs/:orgId/attendance/summary', can(PermissionAction.VIEW, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : today().slice(0, 7);
  const lock = await peoplePrisma.attendanceMonthLock.findUnique({ where: { orgId_month: { orgId, month } } });
  res.json({ month, days: daysOfMonth(month).length, rows: await monthRows(accountId, orgId, month), closed: lock ? { at: lock.lockedAt, byUserId: lock.lockedByUserId } : null });
});

/**
 * Close a month: its days are final. Corrections, leave, manual marks and late
 * reader uploads can no longer change them (reader punches are still kept), so
 * the payable days Payroll takes cannot move afterwards. Approve permission,
 * as validating days is; only a month that has ended can be closed.
 */
attendanceRouter.post('/orgs/:orgId/attendance/months/:month/close', can(PermissionAction.APPROVE, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const month = String(req.params.month);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Months are YYYY-MM.' });
  if (month >= today().slice(0, 7)) return res.status(400).json({ error: 'Only a month that has ended can be closed.' });
  /* The checklist first: a month with open items closes only when someone says they have seen them. */
  const { monthReadiness, snapshotMonth } = await import('../services/attendance/readiness.js');
  const readiness = await monthReadiness(accountId, orgId, month);
  const open = readiness.checks.filter((c) => c.count > 0);
  if (open.length && req.body?.acknowledge !== true) {
    return res.status(409).json({
      error: `${open.length} item${open.length === 1 ? '' : 's'} on the month-close checklist ${open.length === 1 ? 'is' : 'are'} still open.`,
      code: 'MONTH_NOT_READY',
      readiness,
    });
  }
  const result = await peopleWrite(orgId, async () => {
    const latest = await monthReadiness(accountId, orgId, month);
    if (latest.checks.some((c) => c.count > 0) && req.body?.acknowledge !== true) throw fail(409, 'The register changed. Review the month-close checklist again.', 'MONTH_NOT_READY');
    const lock = await peoplePrisma.attendanceMonthLock.upsert({
      where: { orgId_month: { orgId, month } },
      create: { accountId, orgId, month, lockedByUserId: req.auth!.userId },
      update: {},
    });
    const snapshot = await snapshotMonth(accountId, orgId, month, req.auth!.userId, { ...latest, acknowledged: latest.checks.filter((c) => c.count > 0).map((c) => ({ key: c.key, count: c.count })) });
    return { month, closed: { at: lock.lockedAt, byUserId: lock.lockedByUserId }, snapshot: { version: snapshot.version } };
  });
  await recordAudit(req, { entity: 'ATTENDANCE_MONTH', entityId: month, action: 'CLOSE', message: `Closed ${month} (snapshot ${result.snapshot.version})${open.length ? `, with ${open.length} checklist item${open.length === 1 ? '' : 's'} acknowledged` : ''}`, metadata: { month, snapshotVersion: result.snapshot.version, acknowledged: open.map((c) => ({ key: c.key, count: c.count })) } });
  res.json(result);
  emitWebhook(orgId, 'month.closed', { month, closedAt: result.closed.at, byUserId: req.auth!.userId });
});

/**
 * Reopen a closed month, to correct it. Payroll already taken from it is not
 * changed, so a reopen says why and is written to the audit log with who
 * closed it and when (closure audit, 27 Oct 2026: a reopen left no trace).
 */
attendanceRouter.post('/orgs/:orgId/attendance/months/:month/reopen', can(PermissionAction.APPROVE, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const month = String(req.params.month);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Months are YYYY-MM.' });
  const reason = String(req.body?.reason || '').trim().slice(0, 300);
  if (reason.length < 5) return res.status(400).json({ error: 'Say why the month is reopened. It goes in the audit log.', code: 'REASON_NEEDED' });
  const lock = await peoplePrisma.attendanceMonthLock.findUnique({ where: { orgId_month: { orgId, month } } });
  if (!lock) return res.status(409).json({ error: `${month} is not closed.` });
  await peopleWrite(orgId, () => peoplePrisma.attendanceMonthLock.deleteMany({ where: { orgId, month } }));
  await recordAudit(req, { entity: 'ATTENDANCE_MONTH', entityId: month, action: 'REOPEN', message: `Reopened ${month}: ${reason}`, metadata: { month, reason, closedAt: lock.lockedAt, closedByUserId: lock.lockedByUserId } });
  res.json({ month, closed: null });
  emitWebhook(orgId, 'month.reopened', { month: String(req.params.month), byUserId: req.auth!.userId });
});
