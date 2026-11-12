import { Router, type Request } from 'express';
import { calendarOf, calendarsFor } from '../services/attendance/holidayCalendars.js';
import { holidayMinimum } from '../services/attendance/holidayMinimum.js';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requireAnyPermission, requirePermission } from '../middleware/rbac.js';
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
  scheduledMinutes,
  shiftRuleProblem,
  type ShiftRule,
} from '../services/attendance/compute.js';
import { clientIp } from '../services/auth.js';
import { loadHolidays, loadSchedule, resolveShift } from '../services/attendance/schedule.js';
import { emit as emitWebhook } from '../services/attendance/webhooks.js';
import { logDayChange } from '../services/attendance/history.js';
import { recordRuleVersion } from '../services/attendance/ruleVersions.js';
import { deleteToBin } from '../services/recycleBin.js';
import { MONTH_DAYS, scheduleGuard, shiftRanges, type DateRange } from '../services/attendance/scheduleGuard.js';
import { nightRefusal, onShiftAhead } from '../services/people/nightConsent.js';
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
  periodContext,
  monthRows,
  periodRows,
  payrollTakenBetween,
} from '../services/attendance/days.js';
import { DEFAULT_RULES, KINDS, KIND_WORDS, askRequest, cancelRequest, decideRequest, editRequest, rulesFor, saveRules, shiftChoices, story, usage, type Kind } from '../services/attendance/requests.js';
import { CHAINS } from '../services/attendance/approvalChain.js';
import { nightShiftsOn, timesOn } from '../services/attendance/nightShift.js';
import { clockDateFor, decideHeldPunch, decideHeldPunches, FUTURE_TOLERANCE_MS, readerClockAhead, workOutPendingDays } from '../services/attendance/punches.js';
import { inScope, scopeWhere, teamScope } from '../services/people/scope.js';
import { isTimeLeaveSuggestionField, timeLeaveSuggestions } from '../services/attendance/suggestions.js';
import { recordAudit } from '../services/auditTrail.js';
import { TRUST_LEVELS, readerTrustOn } from '../services/attendance/trust.js';
import { parseAddressList, plainIp, validEntry, webClockRefusal, webClockSettings } from '../services/attendance/webClock.js';
import { AttendanceSetupError, attendanceSetup, changeAttendanceSetup, type AttendanceStepKey } from '../services/attendance/setup.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE } from '../services/people/guards.js';

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
// Get started (Today's setup list)
// ---------------------------------------------------------------------------

/* What each step's screen asks of whoever changes things there. */
const SETUP_STEP_NEEDS: Array<[AttendanceStepKey, string, string, string]> = [
  ['shift', ATTENDANCE_MODULE, PermissionAction.CREATE, R.shifts],
  ['weeklyOff', ATTENDANCE_MODULE, PermissionAction.EDIT, R.shifts],
  ['holidays', ATTENDANCE_MODULE, PermissionAction.CREATE, R.holidays],
  ['people', PEOPLE_MODULE, PermissionAction.CREATE, PEOPLE_RESOURCE.employees],
  ['punch', ATTENDANCE_MODULE, PermissionAction.CREATE, R.devices],
  ['firstDay', ATTENDANCE_MODULE, PermissionAction.VIEW, R.records],
];

/** The steps this person may act on. */
async function setupStepsFor(req: Request) {
  const may = new Set<string>();
  for (const [key, module, action, resource] of SETUP_STEP_NEEDS) {
    if (!(await authorize(req, module, action as any, resource))) may.add(key);
  }
  return may;
}

/**
 * Attendance → Today: the "Get started" list (services/attendance/setup.ts).
 * For whoever sets Attendance up for the whole company: it takes the right to
 * change shifts, and a team-scoped role is refused, as it is for the rest of
 * the company's set-up.
 */
attendanceRouter.get('/orgs/:orgId/attendance/setup', can(PermissionAction.EDIT, R.shifts), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  if (!(await teamScope(req)).all) return res.status(403).json({ error: 'Setting Attendance up is for someone who sees the whole company.' });
  const { accountId, orgId } = req.tenant!;
  res.json(await attendanceSetup(accountId, orgId, req.auth?.userId || null, await setupStepsFor(req)));
});

attendanceRouter.post('/orgs/:orgId/attendance/setup', can(PermissionAction.EDIT, R.shifts), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  if (!(await teamScope(req)).all) return res.status(403).json({ error: 'Setting Attendance up is for someone who sees the whole company.' });
  const { accountId, orgId } = req.tenant!;
  try {
    res.json(await changeAttendanceSetup(accountId, orgId, req.auth?.userId || null, await setupStepsFor(req), req.body || {}));
  } catch (e) {
    if (e instanceof AttendanceSetupError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// ---------------------------------------------------------------------------
// Overview and records
// ---------------------------------------------------------------------------

attendanceRouter.get('/orgs/:orgId/attendance/overview', can(PermissionAction.VIEW, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const date = dateParam(req.query.date, today());
  /* A team-scoped role's overview is its own team's: headcount, days, late, queues. */
  const scope = await teamScope(req);
  const mine = scope.all ? {} : { employeeId: { in: scope.ids } };
  const [people, records, holiday] = await Promise.all([
    peoplePrisma.employee.findMany({
      where: { accountId, orgId, status: { in: ['ACTIVE', 'ON_NOTICE'] }, attendanceRequired: true, ...scopeWhere(scope) },
      select: { id: true, name: true, code: true, department: true, photoUrl: true },
      orderBy: { name: 'asc' },
    }),
    peoplePrisma.attendanceRecord.findMany({ where: { accountId, orgId, date, ...mine } }),
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
    toValidate: await peoplePrisma.attendanceRecord.count({ where: { accountId, orgId, validated: false, date: { lt: today() }, ...mine } }),
    pendingRequests: await peoplePrisma.attendanceRequest.count({ where: { accountId, orgId, status: 'PENDING', ...mine } }),
    pendingLeave: await peoplePrisma.leaveRequest.count({ where: { accountId, orgId, status: 'PENDING', ...mine } }),
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
  /* A team-scoped role lists its own team's days only; anyone else's reads as absent. */
  const scope = await teamScope(req);
  const rows = await peoplePrisma.attendanceRecord.findMany({
    where: {
      accountId,
      orgId,
      date: { gte: from, lte: to },
      /* One person asked for: only if they are in scope, never instead of the scope (review of #144). */
      ...(pick('employeeId')
        ? { employeeId: scope.all || scope.ids.includes(pick('employeeId')!) ? pick('employeeId') : '__none__' }
        : scope.all ? {} : { employeeId: { in: scope.ids } }),
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
  /* A real day: '2026-13-40' fits the pattern, and once it sorted before today it was imported (found 1 Nov 2026). */
  date: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.').refine((d) => { const t = new Date(`${d}T00:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; }, 'Dates are YYYY-MM-DD.'),
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
    /* A team-scoped role marks its own team's days only. */
    if (!inScope(await teamScope(req), b.employeeId)) throw fail(404, 'No such employee.');
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
  /* A team-scoped role imports its own team's days only: anyone else's row reads as an unknown code, and is not written. */
  const scope = await teamScope(req);
  const byCode = new Map([...(await peopleByCode(orgId)).entries()].filter(([, e]) => inScope(scope, e.id)));
  const nightOn = await nightShiftsOn(orgId, accountId);
  const results: RowResult[] = [];
  /* Days already recorded for the people and dates in the file: the check says which an import would replace, and how they were made. */
  const dates = [...new Set(rows.map((r: any) => String(r?.date || '').trim()).filter((d: string) => ISO_DATE.test(d)))] as string[];
  const ids = [...new Set(rows.map((r: any) => byCode.get(codeKey(r?.employeeCode ?? r?.code))?.id).filter(Boolean))] as string[];
  const recorded = dates.length && ids.length
    ? new Map((await peoplePrisma.attendanceRecord.findMany({ where: { orgId, employeeId: { in: ids }, date: { in: dates } }, select: { employeeId: true, date: true, source: true } })).map((x) => [`${x.employeeId}|${x.date}`, x.source]))
    : new Map<string, string>();
  const replacing: Array<{ row: number; source: string }> = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] || {};
    const emp = byCode.get(codeKey(r.employeeCode ?? r.code));
    if (!emp) { results.push({ row: i + 1, ok: false, error: `No employee with code ${String(r.employeeCode ?? r.code ?? '').trim() || '(blank)'}.` }); continue; }
    const parsed = markSchema.safeParse({ employeeId: emp.id, date: String(r.date || '').trim(), checkIn: r.checkIn || null, checkOut: r.checkOut || null, status: r.status ? String(r.status).trim().toUpperCase().replace(/[\s-]+/g, '_') : null, note: r.note || null });
    if (!parsed.success) { results.push({ row: i + 1, ok: false, error: parsed.error.issues[0]?.message || 'Invalid row.' }); continue; }
    const b = parsed.data;
    /* The same person and day twice: the second would silently overwrite the first, so neither guess is made. */
    const key = `${emp.id}|${b.date}`;
    if (seen.has(key)) { results.push({ row: i + 1, ok: false, error: `Same person and day as row ${seen.get(key)}. Keep one of them.` }); continue; }
    seen.set(key, i + 1);
    try {
      if ((b.checkIn && !isHHMM(b.checkIn)) || (b.checkOut && !isHHMM(b.checkOut))) throw fail(400, 'Times are HH:MM, 24-hour.');
      if (b.checkOut && !b.checkIn) throw fail(400, 'A check-out needs a check-in.');
      if (b.date > today()) throw fail(400, 'That day has not happened yet.');
      const employee = await employeeIn(orgId, accountId, b.employeeId);
      const { checkIn, checkOut } = await handTimes(orgId, accountId, employee.id, b.date, b.checkIn, b.checkOut, nightOn);
      if (dryRun) await assertMonthOpen(orgId, b.date);
      else await writeDay({ accountId, orgId, userId: req.auth!.userId, employee, date: b.date, checkIn, checkOut, statusOverride: b.status ?? null, source: 'IMPORT', note: b.note ?? null });
      results.push({ row: i + 1, ok: true });
      if (recorded.has(key)) replacing.push({ row: i + 1, source: recorded.get(key)! });
    } catch (e: any) {
      results.push({ row: i + 1, ok: false, error: e?.message || 'Not imported.' });
    }
  }
  const imported = results.filter((x) => x.ok).length;
  res.json({ dryRun, imported, failed: results.length - imported, results: results.filter((x) => !x.ok), replacing });
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
    const noConsent = await nightRefusal(orgId, [{ employeeId: emp.id, shiftIds: [shiftId] }]);
    if (noConsent) { results.push({ row: i + 1, ok: false, error: noConsent.message }); continue; }
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
  const scope = await teamScope(req);
  try {
    await peopleWrite(orgId, async () => {
      const r = await peoplePrisma.attendanceRecord.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
      /* A team-scoped role deletes its own team's days only. */
      if (!r || !inScope(scope, r.employeeId)) throw fail(404, 'No such day.');
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
  /* A team-scoped role validates its own team's days only: any day outside it refuses the lot, as if it were not there. */
  const scope = await teamScope(req);
  if (!scope.all) {
    const owners = await peoplePrisma.attendanceRecord.findMany({ where: { accountId, orgId, id: { in: ids } }, select: { employeeId: true } });
    if (owners.some((o) => !inScope(scope, o.employeeId))) return res.status(404).json({ error: 'No such day.' });
  }
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
  /* A team-scoped role approves its own team's overtime only. */
  if (!r || !inScope(await teamScope(req), r.employeeId)) return res.status(404).json({ error: 'No such day.' });
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
      /* Whether the plain clock may be pressed here, and if not why: the screen says so instead of a button the server refuses (#6). */
      webClock: await (async () => {
        const no = await webClockRefusal(me, plainIp(clientIp(req)));
        if (!no) return { allowed: true };
        /* The day the browser clock opened is closed by it whatever the rules say now (review of #144). */
        if (open && (await openedByBrowser(orgId, me.id, open))) return { allowed: true, outOnly: true, code: no.code, why: no.message };
        return { allowed: false, code: no.code, why: no.message };
      })(),
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

/** Whether this open day was started with the browser clock (its IN is in the clock's own log). */
async function openedByBrowser(orgId: string, employeeId: string, open: { checkIn: Date | null } | null) {
  if (!open?.checkIn) return false;
  const opened = await peoplePrisma.attendanceActivity.findFirst({ where: { orgId, employeeId, source: 'CLOCK', kind: 'IN', at: { gte: new Date(open.checkIn.getTime() - 60_000), lte: new Date(open.checkIn.getTime() + 60_000) } }, select: { id: true } });
  return Boolean(opened);
}

attendanceRouter.post('/orgs/:orgId/attendance/clock', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    if (me.status === 'LEFT') throw fail(403, 'This employee file is marked as having left.');
    /* The punch policy applies here too (audit 7 Nov 2026, #6): the company switch, phone-only people, the office addresses. */
    const now = new Date();
    const open = await peoplePrisma.attendanceRecord.findFirst({
      where: { orgId, employeeId: me.id, checkIn: { not: null, gte: new Date(now.getTime() - 20 * 3_600_000) }, checkOut: null },
      orderBy: { checkIn: 'desc' },
    });
    const wanted = req.body?.kind === 'IN' || req.body?.kind === 'OUT' ? req.body.kind : open ? 'OUT' : 'IN';
    /*
     * A day this clock opened can always be closed by it (review of #144): someone who clocked in at the
     * office and left from elsewhere, or whose company changed the rules since, is not stuck "in".
     */
    const refused = wanted === 'OUT' && (await openedByBrowser(orgId, me.id, open)) ? null : await webClockRefusal(me, plainIp(clientIp(req)));
    if (refused) throw fail(403, refused.message, refused.code);
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

/**
 * Browser clock-in settings (audit #6): the company switch and the office addresses. Kept with the work
 * sites, under Employee Portal, as the rest of "where may punches come from" is. `yourAddress` lets the
 * person setting it up add the network they are on; `recent` are addresses clock-ins came from lately.
 */
attendanceRouter.get('/orgs/:orgId/attendance/clock/settings', can(PermissionAction.VIEW, R.portal), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const s = await webClockSettings(orgId);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const recent = await peoplePrisma.attendanceActivity.groupBy({ by: ['ip'], where: { orgId, source: 'CLOCK', at: { gte: since }, ip: { not: null } }, _count: { _all: true }, orderBy: { _count: { ip: 'desc' } }, take: 10 });
  res.json({ allowed: s.allowed, addresses: s.addresses, yourAddress: plainIp(clientIp(req)), recent: recent.map((r) => ({ address: plainIp(r.ip), clockIns: r._count._all })).filter((r) => r.address) });
});

const webClockSchema = z.object({
  allowed: z.boolean(),
  addresses: z.array(z.string().trim().max(64)).max(50).default([]),
});
attendanceRouter.put('/orgs/:orgId/attendance/clock/settings', can(PermissionAction.EDIT, R.portal), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  /* A company setting: a team-scoped role does not change it for everyone. */
  if (!(await teamScope(req)).all) return res.status(403).json({ error: 'Browser clock-in is set by someone who decides for the whole company.', code: 'TEAM_SCOPED' });
  const parsed = webClockSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Send allowed and up to 50 addresses.' });
  const addresses = parseAddressList(parsed.data.addresses.join('\n'));
  const bad = addresses.filter((a) => !validEntry(a));
  if (bad.length) return res.status(400).json({ error: `${bad[0]} is not an address or a block like 49.205.10.0/24.`, code: 'BAD_ADDRESS' });
  const data = { webClockAllowed: parsed.data.allowed, webClockIps: addresses.join('\n'), updatedByUserId: req.auth!.userId };
  const before = await peopleWrite(orgId, async () => {
    const old = await webClockSettings(orgId);
    await peoplePrisma.attendanceSettings.upsert({ where: { orgId }, create: { accountId, orgId, ...data }, update: data });
    return old;
  });
  await recordAudit(req, { entity: 'ATTENDANCE_SETTINGS', entityId: orgId, action: 'UPDATE', message: `Browser clock-in ${data.webClockAllowed ? (addresses.length ? `on, from ${addresses.length} address${addresses.length === 1 ? '' : 'es'}` : 'on, from anywhere') : 'off'}`, metadata: { before, after: { allowed: data.webClockAllowed, addresses } } });
  res.json({ allowed: data.webClockAllowed, addresses });
});

/**
 * The first day the company kept attendance on CLOR (audit #5). Days before it with no record are not
 * absent, not loss of pay and not "no record" on month close. Set by whoever closes months, for the whole
 * company; refused when it would change a closed month's days.
 */
attendanceRouter.put('/orgs/:orgId/attendance/start-date', can(PermissionAction.APPROVE, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  if (!(await teamScope(req)).all) return res.status(403).json({ error: 'The attendance start date is set by someone who sees the whole company.', code: 'TEAM_SCOPED' });
  const raw = req.body?.date;
  const date = raw === null || raw === '' ? null : String(raw || '');
  if (date !== null) {
    const t = new Date(`${date}T00:00:00Z`);
    if (!ISO_DATE.test(date) || Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== date) return res.status(400).json({ error: 'Dates are YYYY-MM-DD.' });
    if (date > today()) return res.status(400).json({ error: 'The start date cannot be after today.' });
  }
  try {
    const before = await peopleWrite(orgId, async () => {
      const old = (await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { attendanceStartDate: true } }))?.attendanceStartDate ?? null;
      /*
       * Every month whose days this moves: between the two dates, or — when one side is "no start date" —
       * every month before the other. None of them may be closed: their figures went to Payroll.
       */
      if (old !== date) {
        const set = [old, date].filter((x): x is string => Boolean(x)).sort();
        const lo = old && date ? set[0].slice(0, 7) : '0000-01';
        const hi = set[set.length - 1].slice(0, 7);
        const lock = await peoplePrisma.attendanceMonthLock.findFirst({ where: { orgId, month: { gte: lo, lte: hi } }, orderBy: { month: 'asc' }, select: { month: true } });
        if (lock) throw fail(409, `${lock.month} is closed. Reopen it before moving the start date across it.`, 'ATTENDANCE_MONTH_CLOSED');
        /* Nor a month a final payroll run has taken, closed or not (review of #144). */
        const taken = await payrollTakenBetween(orgId, old && date ? set[0] : '0000-01-01', set[set.length - 1]);
        if (taken) throw fail(409, `Payroll for ${taken.period} is ${taken.state.toLowerCase()} and has taken those days. The start date cannot move across it.`, 'PAYROLL_TAKEN');
      }
      await peoplePrisma.attendanceSettings.upsert({ where: { orgId }, create: { accountId, orgId, attendanceStartDate: date, updatedByUserId: req.auth!.userId }, update: { attendanceStartDate: date, updatedByUserId: req.auth!.userId } });
      return old;
    });
    await recordAudit(req, { entity: 'ATTENDANCE_SETTINGS', entityId: orgId, action: 'UPDATE', message: date ? `Attendance kept on CLOR from ${date}` : 'Attendance start date cleared', metadata: { before: { attendanceStartDate: before }, after: { attendanceStartDate: date } } });
    res.json({ attendanceStartDate: date });
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * Reader punches held for a look (audit #11): a time ahead of the server's (the reader's clock was
 * wrong), stored but on no day; and, for the last 31 days, lines whose date does not exist (31 Feb),
 * kept as evidence only. Count releases a held punch once its time has come; Discard keeps it out.
 */
/* Whoever looks after readers, and whoever closes months (the held punches block a close); a team role only its team's (review of #144). */
const heldView = requireAnyPermission([ATTENDANCE_MODULE, PermissionAction.VIEW, R.devices], [ATTENDANCE_MODULE, PermissionAction.APPROVE, R.records]);
const heldDecide = requireAnyPermission([ATTENDANCE_MODULE, PermissionAction.EDIT, R.devices], [ATTENDANCE_MODULE, PermissionAction.APPROVE, R.records]);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
attendanceRouter.get('/orgs/:orgId/attendance/held-punches', heldView, async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const scope = await teamScope(req);
  /* Month close asks for its month only (by the time on the punch); Unmatched punches for all. */
  const month = MONTH.test(String(req.query.month || '')) ? String(req.query.month) : null;
  const where = {
    orgId,
    reviewStatus: 'HELD',
    ...(month ? { localTime: { gte: `${month}-01 00:00:00`, lte: `${month}-31 23:59:59` } } : {}),
    ...(scope.all ? {} : { employeeId: { in: scope.ids } }),
  };
  const due = new Date(Date.now() + FUTURE_TOLERANCE_MS);
  const [held, total, perReader, countable, impossible, devices] = await Promise.all([
    peoplePrisma.devicePunch.findMany({ where, orderBy: { at: 'desc' }, take: 1000 }),
    peoplePrisma.devicePunch.count({ where }),
    /* Every reader with held punches, however many there are: the bulk actions work from these, not from the 1000 listed. */
    peoplePrisma.devicePunch.groupBy({ by: ['deviceId'], where, _count: { _all: true } }),
    peoplePrisma.devicePunch.groupBy({ by: ['deviceId'], where: { ...where, at: { lte: due }, employeeId: scope.all ? { not: null } : { in: scope.ids } }, _count: { _all: true } }),
    !scope.all || month ? Promise.resolve([]) : peoplePrisma.readerEvent.findMany({ where: { orgId, outcome: 'REJECTED', reason: 'Not a real date and time', receivedAt: { gte: new Date(Date.now() - 31 * 86_400_000) } }, orderBy: { receivedAt: 'desc' }, take: 500, select: { id: true, deviceId: true, pin: true, localTime: true, receivedAt: true } }),
    peoplePrisma.attendanceDevice.findMany({ where: { orgId }, select: { id: true, name: true, serialNumber: true } }),
  ]);
  const reader = new Map(devices.map((d) => [d.id, d.name || d.serialNumber]));
  const canCount = new Map(countable.map((g) => [g.deviceId, g._count._all]));
  /* How far ahead each reader's clock looks, so Count all can move its punches back (final review of #144). */
  const ahead = new Map(await Promise.all(perReader.map(async (g) => [g.deviceId, await readerClockAhead(orgId, { deviceId: g.deviceId, month, employeeIds: scope.all ? null : scope.ids })] as const)));
  const named = await withNames(orgId, held.map((p) => ({ employeeId: p.employeeId })));
  res.json({
    month,
    total,
    readers: perReader
      .map((g) => ({ deviceId: g.deviceId, reader: reader.get(g.deviceId) || '—', count: g._count._all, countable: canCount.get(g.deviceId) || 0, aheadMinutes: ahead.get(g.deviceId) ?? null }))
      .sort((a, b) => b.count - a.count),
    held: held.map((p, i) => ({ id: p.id, deviceId: p.deviceId, reader: reader.get(p.deviceId) || p.serialNumber, pin: p.pin, time: p.localTime, receivedAt: p.createdAt, employeeId: p.employeeId, employeeName: p.employeeId ? named[i]?.employeeName || null : null, reason: p.heldReason, due: p.at.getTime() <= Date.now() })),
    impossible: impossible.map((x) => ({ id: x.id, reader: reader.get(x.deviceId) || '—', pin: x.pin, time: x.localTime, receivedAt: x.receivedAt })),
  });
});

/**
 * Count or discard every held punch from one reader (and, from Month close, one month) at once
 * (review of #144): a reader whose clock ran ahead for weeks leaves more than anyone can click
 * through. A team role decides only its people's. One audit entry for the batch, with the counts.
 */
attendanceRouter.post('/orgs/:orgId/attendance/held-punches/bulk', heldDecide, async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const action = req.body?.action === 'release' ? 'release' : req.body?.action === 'discard' ? 'discard' : null;
  const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : '';
  const month = req.body?.month == null || req.body.month === '' ? null : String(req.body.month);
  /* Count only: move each punch back by this many minutes (the reader's clock was ahead), or 0 / null for as recorded. */
  const shiftRaw = req.body?.shiftMinutes;
  const shiftMinutes = shiftRaw == null || shiftRaw === '' ? 0 : Number(shiftRaw);
  if (!action) return res.status(400).json({ error: 'Say whether to count or discard them.' });
  if (!Number.isInteger(shiftMinutes) || shiftMinutes < 0 || shiftMinutes > 7 * 24 * 60) return res.status(400).json({ error: 'Moving punches back takes whole minutes, at most a week.' });
  if (!deviceId) return res.status(400).json({ error: 'Choose the reader.' });
  if (month && !MONTH.test(month)) return res.status(400).json({ error: 'The month should look like 2026-10.' });
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: deviceId, orgId }, select: { id: true, name: true, serialNumber: true } });
  if (!device) return res.status(404).json({ error: 'No such reader.' });
  const scope = await teamScope(req);
  try {
    /* One chunk per call, in one transaction (decideHeldPunches): the screen calls again while `left` is above nought. */
    const out = await peopleWrite(orgId, () => decideHeldPunches(orgId, { deviceId, month, employeeIds: scope.all ? null : scope.ids }, action, { shiftMinutes: action === 'release' ? shiftMinutes : 0 }));
    const done = action === 'release' ? out.counted : out.discarded;
    if (done) {
      const name = device.name || device.serialNumber;
      await recordAudit(req, {
        entity: 'DEVICE_PUNCH',
        entityId: device.id,
        action: action === 'release' ? 'APPROVE' : 'REJECT',
        message: `${done} held reader punch${done === 1 ? ' was' : 'es were'} ${action === 'release' ? 'counted' : 'discarded'} from ${name}${month ? ` for ${month}` : ''}${out.shiftMinutes ? `, moved back ${out.shiftMinutes} min (the reader's clock was ahead)` : ''}`,
        metadata: { deviceId: device.id, month, action, ...out, teamOnly: !scope.all },
      });
    }
    res.json(out);
  } catch (e) {
    return sendError(res, e);
  }
});

const decideHeld = (action: 'release' | 'discard') => async (req: any, res: any) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const scope = await teamScope(req);
  if (!scope.all) {
    const p = await peoplePrisma.devicePunch.findFirst({ where: { id: String(req.params.id), orgId, reviewStatus: 'HELD' }, select: { employeeId: true } });
    if (!p?.employeeId || !inScope(scope, p.employeeId)) return res.status(404).json({ error: 'No such held punch.' });
  }
  try {
    const out = await peopleWrite(orgId, () => decideHeldPunch(orgId, String(req.params.id), action));
    if (out.status !== 200) return res.status(out.status).json({ error: out.error, ...('code' in out && out.code ? { code: out.code } : {}) });
    await recordAudit(req, { entity: 'DEVICE_PUNCH', entityId: String(req.params.id), action: action === 'release' ? 'APPROVE' : 'REJECT', message: action === 'release' ? 'A held reader punch was counted' : 'A held reader punch was discarded', metadata: { punch: out.punch } });
    res.json(out);
  } catch (e) {
    return sendError(res, e);
  }
};
attendanceRouter.post('/orgs/:orgId/attendance/held-punches/:id/release', heldDecide, decideHeld('release'));
attendanceRouter.post('/orgs/:orgId/attendance/held-punches/:id/discard', heldDecide, decideHeld('discard'));

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
    res.json({ month, requests: await withNames(orgId, rows), usage: Object.fromEntries(use.map((u) => [u.kind, u])), rules, shifts: await shiftChoices(orgId, rules) });
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
  const rules = await rulesFor(req.tenant!.orgId);
  res.json({ rules, kinds: KINDS, chains: CHAINS, defaults: DEFAULT_RULES, shifts: await shiftChoices(req.tenant!.orgId, rules) });
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
    const reader = { canDecide: !(await authorize(req, ATTENDANCE_MODULE, PermissionAction.APPROVE as any, R.requests)), scopeAll: (await teamScope(req)).all };
    res.json({ ...(await story(accountId, orgId, r, mine?.id, reader)), ownRequest: Boolean(mine && mine.id === r.employeeId) });
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
  /* Left out: the shift's own net minutes, start to end less the break (compute.ts scheduledMinutes). */
  fullDayMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  overtimeAfterMinutes: z.coerce.number().int().min(0).max(1440).optional().nullable(),
  /* The punch window: how early a check-in and how late a check-out still count; blank = no limit. */
  checkInBeforeMinutes: z.coerce.number().int().min(0, 'The punch window is minutes, 0 or more.').max(720, 'At most 12 hours before the start.').optional().nullable(),
  checkOutAfterMinutes: z.coerce.number().int().min(0, 'The punch window is minutes, 0 or more.').max(720, 'At most 12 hours after the end.').optional().nullable(),
  autoPick: z.boolean().optional(),
  weeklyOffDays: z.string().regex(/^([0-6](,[0-6])*)?$/, 'Weekly offs are day numbers 0–6.').default('0'),
  offSaturdays: z.string().regex(/^([1-5](,[1-5])*)?$/, 'Saturdays off are 1–5 (first to fifth).').default(''),
  code: z.string().trim().max(6).optional().nullable(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Colours are #RRGGBB.').optional().nullable().or(z.literal('')),
  isActive: z.boolean().optional(),
});

/** A shift's full day, or, left out, its own net minutes (start to end less the break). */
const withFullDay = <T extends z.infer<typeof shiftSchema>>(s: T) => ({ ...s, fullDayMinutes: s.fullDayMinutes ?? scheduledMinutes(s) });

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
  const data = withFullDay(parsed.data);
  const problem = shiftRuleProblem(data);
  if (problem) return res.status(400).json({ error: problem, code: 'SHIFT_RULES' });
  parsed.data.fullDayMinutes = data.fullDayMinutes;
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
  const data = withFullDay(parsed.data);
  if (data.halfDayMinutes > data.fullDayMinutes) return res.status(400).json({ error: 'A half day cannot be longer than a full day.', code: 'SHIFT_RULES' });
  /*
   * A full day longer than the shift is refused when the hours change. A shift
   * saved that way before the check keeps its name, code and colour editable:
   * the shift worked as scheduled is still a full day (compute.ts workedAsScheduled).
   */
  const hours = (x: any) => [x.startTime, x.endTime, x.breakMinutes, x.halfDayMinutes, x.fullDayMinutes].join('|');
  const problem = hours(data) !== hours(existing) ? shiftRuleProblem(data) : null;
  parsed.data.fullDayMinutes = data.fullDayMinutes;
  const scoring = (x: any) => ({ startTime: x.startTime, endTime: x.endTime, breakMinutes: x.breakMinutes, graceMinutes: x.graceMinutes, earlyOutGraceMinutes: x.earlyOutGraceMinutes, halfDayMinutes: x.halfDayMinutes, fullDayMinutes: x.fullDayMinutes, overtimeAfterMinutes: x.overtimeAfterMinutes ?? null, checkInBeforeMinutes: x.checkInBeforeMinutes ?? null, checkOutAfterMinutes: x.checkOutAfterMinutes ?? null, weeklyOffDays: x.weeklyOffDays, offSaturdays: x.offSaturdays, isActive: x.isActive });
  try {
    /*
     * A shift has no effective date: new times or rules apply to every date it
     * covers, closed months included (O-05). While a closed month uses it, its
     * times and rules stay; the name, code and colour can still change.
     */
    const next = { ...existing, ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) };
    if (JSON.stringify(scoring(existing)) !== JSON.stringify(scoring(next))) await shiftOpen(orgId, existing.id);
    /* After the closed-month check, so a month that holds the shift is what is said first. */
    if (problem) return res.status(400).json({ error: problem, code: 'SHIFT_RULES' });
    /* New times that run into the night reach every woman on this shift (people/nightConsent.ts). */
    if (next.startTime !== existing.startTime || next.endTime !== existing.endTime) {
      const on = await onShiftAhead(orgId, existing.id);
      const noConsent = await nightRefusal(orgId, on.map((id) => ({ employeeId: id, shiftIds: [existing.id] })), { shifts: [{ id: existing.id, name: next.name, startTime: next.startTime, endTime: next.endTime }] });
      if (noConsent) return sendError(res, noConsent);
    }
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
  /* A woman on a shift into the night needs her consent on file (OSH Code s.43; people/nightConsent.ts). */
  const noConsent = await nightRefusal(orgId, people.map((p) => ({ employeeId: p.id, shiftIds: [shiftId] })));
  if (noConsent) return sendError(res, noConsent);
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

/** A holiday kept by one branch names a branch of this company (time depth, gap 17). */
const branchOrNull = async (orgId: string, branchId: unknown) => {
  const id = typeof branchId === 'string' ? branchId.trim() : '';
  if (!id) return null;
  if (!(await platformPrisma.branch.findFirst({ where: { id, orgId }, select: { id: true } }))) throw fail(400, 'That branch is not in this company.');
  return id;
};

const holidaySchema = z.object({
  date: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'),
  name: z.string().trim().min(1, 'Name the holiday.').max(80),
  isOptional: z.boolean().optional(),
  branchId: z.string().trim().optional().nullable(),
  /** Null = the whole company; set = only that area's people. */
  areaId: z.string().trim().optional().nullable(),
});

/*
 * The holiday list is no secret (every employee sees it in the employee app):
 * whoever reads leave reads it too, so a team manager's Who's away and Leave
 * calendar shade the holidays instead of meeting a 403. Changing it stays
 * with Holidays' own rights.
 */
attendanceRouter.get('/orgs/:orgId/attendance/holidays', requireAnyPermission([ATTENDANCE_MODULE, PermissionAction.VIEW, R.holidays], [ATTENDANCE_MODULE, PermissionAction.VIEW, R.leave]), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const year = String(req.query.year || today().slice(0, 4)).slice(0, 4);
  const holidays = await peoplePrisma.holiday.findMany({
    where: { accountId, orgId, date: { gte: `${year}-01-01`, lte: `${year}-12-31` } },
    orderBy: { date: 'asc' },
  });
  const areas = new Map((await peoplePrisma.area.findMany({ where: { orgId }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  const branches = new Map((await platformPrisma.branch.findMany({ where: { orgId }, select: { id: true, branchName: true } })).map((x) => [x.id, x.branchName]));
  /* State law's minimum of national and festival holidays, per branch in a state that has one (holidayMinimum.ts). */
  res.json({ holidays: holidays.map((h) => ({ ...h, areaName: h.areaId ? areas.get(h.areaId) || null : null, branchName: h.branchId ? branches.get(h.branchId) || null : null })), year, stateMinimum: await holidayMinimum(orgId, year) });
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
      data: { accountId, orgId, ...parsed.data, branchId: await branchOrNull(orgId, parsed.data.branchId), areaId: await areaOrNull(orgId, parsed.data.areaId), isOptional: Boolean(parsed.data.isOptional), createdByUserId: req.auth!.userId },
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
      data: { ...parsed.data, branchId: await branchOrNull(orgId, parsed.data.branchId), areaId: await areaOrNull(orgId, parsed.data.areaId), isOptional: Boolean(parsed.data.isOptional) },
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

/*
 * Built-in holiday calendars (time depth, gap 17): the national list and each
 * state's own days, imported for everyone or for one branch. A branch's
 * holidays reach its people in leave day counting, payable days and the
 * employee app (schedule.ts loadHolidays.forArea, leave.ts dayPlan).
 */
attendanceRouter.get('/orgs/:orgId/attendance/holidays/calendars', can(PermissionAction.VIEW, R.holidays), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const year = /^\d{4}$/.test(String(req.query.year || '')) ? Number(req.query.year) : Number(today().slice(0, 4)) + 1;
  const branches = await platformPrisma.branch.findMany({ where: { orgId, isActive: true }, select: { id: true, branchName: true, state: true }, orderBy: { branchName: 'asc' } });
  res.json({ year, calendars: calendarsFor(year), branches: branches.map((b) => ({ id: b.id, name: b.branchName, state: b.state || null })) });
});

attendanceRouter.post('/orgs/:orgId/attendance/holidays/calendars/import', can(PermissionAction.CREATE, R.holidays), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const cal = calendarOf(String(req.body?.key || ''));
  if (!cal) return res.status(400).json({ error: 'Choose a calendar.' });
  const dryRun = req.body?.dryRun === true;
  try {
    const branchId = await branchOrNull(orgId, req.body?.branchId);
    const branch = branchId ? await platformPrisma.branch.findFirst({ where: { id: branchId, orgId }, select: { branchName: true, state: true } }) : null;
    const closed = await closedMonths(orgId, [...new Set(cal.holidays.map((h) => h.date.slice(0, 7)))]);
    const added: Array<{ date: string; name: string }> = [];
    const skipped: Array<{ date: string; name: string; why: string }> = [];
    /* One write, so two people importing at once cannot both add a day: the second finds it there. */
    await peopleWrite(orgId, async () => {
      const existing = await peoplePrisma.holiday.findMany({ where: { orgId, date: { in: cal.holidays.map((h) => h.date) } }, select: { date: true, name: true, branchId: true, areaId: true } });
      for (const h of cal.holidays) {
        if (closed.has(h.date.slice(0, 7))) { skipped.push({ ...h, why: 'its month is closed' }); continue; }
        const same = existing.filter((x) => x.date === h.date && x.name.toLowerCase() === h.name.toLowerCase());
        if (same.some((x) => !x.branchId && !x.areaId)) { skipped.push({ ...h, why: 'already a holiday for everyone' }); continue; }
        if (same.some((x) => (x.branchId || null) === branchId)) { skipped.push({ ...h, why: 'already on the calendar' }); continue; }
        /* The same day already kept by another branch: a name of its own, since one company has one holiday of a name on a date. */
        const name = same.length ? `${h.name} (${branch?.state || branch?.branchName || 'everyone'})`.slice(0, 80) : h.name;
        if (existing.some((x) => x.date === h.date && x.name.toLowerCase() === name.toLowerCase())) { skipped.push({ ...h, why: 'already on the calendar' }); continue; }
        if (!dryRun) await peoplePrisma.holiday.create({ data: { accountId, orgId, date: h.date, name, isOptional: false, branchId, areaId: null, createdByUserId: req.auth!.userId } });
        existing.push({ date: h.date, name, branchId, areaId: null });
        added.push({ date: h.date, name });
      }
    });
    if (!dryRun && added.length) await recordAudit(req, { entity: 'Holiday', entityId: cal.key, action: 'CREATE', message: `Imported ${added.length} holidays from ${cal.name}${branch ? ` for ${branch.branchName}` : ' for everyone'}`, metadata: { key: cal.key, branchId, added: added.length, skipped: skipped.length, source: cal.source } });
    res.status(dryRun ? 200 : 201).json({ added, skipped, source: cal.source, dryRun });
  } catch (e) {
    /* Two imports at the same moment: the second meets the first's rows (orgId, date, name is unique). */
    if ((e as { code?: string })?.code === 'P2002') return res.status(409).json({ error: 'Someone added these holidays a moment ago. Look at the list before adding them again.', code: 'HOLIDAYS_JUST_ADDED' });
    return sendError(res, e);
  }
});

// ---------------------------------------------------------------------------
// The month, for payroll
// ---------------------------------------------------------------------------

attendanceRouter.get('/orgs/:orgId/attendance/summary', can(PermissionAction.VIEW, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : today().slice(0, 7);
  const lock = await peoplePrisma.attendanceMonthLock.findUnique({ where: { orgId_month: { orgId, month } } });
  /* A team-scoped role sees its own team's rows. */
  const scope = await teamScope(req);
  const rows = (await monthRows(accountId, orgId, month)).filter((r: any) => inScope(scope, r.employeeId));
  res.json({ month, days: daysOfMonth(month).length, rows, closed: lock ? { at: lock.lockedAt, byUserId: lock.lockedByUserId } : null });
});

/**
 * Close a month: its days are final. Corrections, leave, manual marks and late
 * reader uploads can no longer change them (reader punches are still kept), so
 * the payable days Payroll takes cannot move afterwards. Approve permission,
 * as validating days is; only a month that has ended can be closed.
 */
const fullDaysPendingError = (n: number) => `${n} day${n === 1 ? ' was' : 's were'} scored a half day or absent under the old full-day rule and ${n === 1 ? 'has' : 'have'} not been corrected yet. Try closing again in a minute; if it keeps happening, tell support.`;
attendanceRouter.post('/orgs/:orgId/attendance/months/:month/close', can(PermissionAction.APPROVE, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const month = String(req.params.month);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Months are YYYY-MM.' });
  if (month >= today().slice(0, 7)) return res.status(400).json({ error: 'Only a month that has ended can be closed.' });
  /* Closing freezes every person's days: a team role, which sees only its team, does not do it. */
  if (!(await teamScope(req)).all) return res.status(403).json({ error: 'Closing a month is done by someone who sees the whole company.', code: 'TEAM_SCOPED' });
  /* The checklist first: a month with open items closes only when someone says they have seen them. */
  const { monthReadiness, snapshotMonth } = await import('../services/attendance/readiness.js');
  /* Days the old full-day rule scored short are corrected before the month is weighed and closed, so none is left behind the lock (fullDayFix.ts). */
  const { fixFullDaysQuietly } = await import('../services/attendance/fullDayFix.js');
  await fixFullDaysQuietly({ accountId, orgId });
  /* Days a reopen did not get to (marked dayPending) are worked out before the month is judged; nothing in a closed month. */
  await peopleWrite(orgId, () => workOutPendingDays(orgId, month));
  /* A day the fix could not correct is said before the checklist: the counts the closer would confirm are about to change. */
  const { fullDaysToCorrect } = await import('../services/attendance/fullDayFix.js');
  const leftBefore = await fullDaysToCorrect({ accountId, orgId }, month);
  if (leftBefore.length) return res.status(409).json({ error: fullDaysPendingError(leftBefore.length), code: 'FULL_DAYS_PENDING' });
  const readiness = await monthReadiness(accountId, orgId, month);
  const open = readiness.checks.filter((c) => c.count > 0);
  if (open.length && req.body?.acknowledge !== true) {
    return res.status(409).json({
      error: `${open.length} item${open.length === 1 ? '' : 's'} on the month-close checklist ${open.length === 1 ? 'is' : 'are'} still open.`,
      code: 'MONTH_NOT_READY',
      readiness,
    });
  }
  /*
   * Working days with no record are docked as unpaid absence once the month closes (audit 7 Nov 2026, #5).
   * A general "I have seen the open items" is not enough for that: the closer sends back the exact number
   * of days they were shown, so a month whose count changed since, or a close that never looked, is refused.
   */
  const confirmed = Number(req.body?.confirmNoRecordDays);
  const token = String(req.body?.confirmNoRecordToken || '');
  const unconfirmed = (r: { noRecordDays: number; noRecordToken: string | null }) => r.noRecordDays > 0 && (confirmed !== r.noRecordDays || token !== r.noRecordToken);
  /* A reader punch held for a look and dated in the month is on nobody's day: it is decided before the month is final (review of #144). */
  const heldOf = (r: { checks: Array<{ key: string; count: number }> }) => r.checks.find((c) => c.key === 'held')?.count || 0;
  if (heldOf(readiness)) {
    return res.status(409).json({ error: `${heldOf(readiness)} reader punch${heldOf(readiness) === 1 ? ' is' : 'es are'} held for a look in this month. Count or discard ${heldOf(readiness) === 1 ? 'it' : 'them'} first.`, code: 'HELD_PUNCHES', readiness });
  }
  if (unconfirmed(readiness)) {
    return res.status(409).json({
      error: `${readiness.noRecordDays.toLocaleString('en-IN')} working day${readiness.noRecordDays === 1 ? '' : 's'} with no record would be docked as unpaid absence. Confirm them to close the month.`,
      code: 'NO_RECORD_UNCONFIRMED',
      noRecordDays: readiness.noRecordDays,
      people: readiness.people.filter((p) => p.noRecord > 0).map((p) => ({ employeeId: p.employeeId, name: p.name, code: p.code, days: p.noRecordDates })),
    });
  }
  let result: { month: string; closed: { at: Date; byUserId: string }; snapshot: { version: number } };
  try {
    result = await peopleWrite(orgId, async () => {
      /* Under the lock, only a look: a day the fix above should have corrected (it failed, or the day is new) stops the close, never a write here. */
      const left = await fullDaysToCorrect({ accountId, orgId }, month);
      if (left.length) throw fail(409, fullDaysPendingError(left.length), 'FULL_DAYS_PENDING');
      const latest = await monthReadiness(accountId, orgId, month);
      if (latest.checks.some((c) => c.count > 0) && req.body?.acknowledge !== true) throw fail(409, 'The register changed. Review the month-close checklist again.', 'MONTH_NOT_READY');
      if (heldOf(latest)) throw fail(409, 'A reader punch was held for this month since. Review the month-close checklist again.', 'HELD_PUNCHES');
      if (unconfirmed(latest)) throw fail(409, 'The days with no record changed. Review the month-close checklist again.', 'NO_RECORD_UNCONFIRMED');
      const lock = await peoplePrisma.attendanceMonthLock.upsert({
        where: { orgId_month: { orgId, month } },
        create: { accountId, orgId, month, lockedByUserId: req.auth!.userId },
        update: {},
      });
      const snapshot = await snapshotMonth(accountId, orgId, month, req.auth!.userId, { ...latest, acknowledged: latest.checks.filter((c) => c.count > 0).map((c) => ({ key: c.key, count: c.count })), confirmedNoRecordDays: latest.noRecordDays });
      return { month, closed: { at: lock.lockedAt, byUserId: lock.lockedByUserId }, snapshot: { version: snapshot.version } };
    });
  } catch (e) {
    /* The refusals above carry their code (MONTH_NOT_READY, FULL_DAYS_PENDING, HELD_PUNCHES, NO_RECORD_UNCONFIRMED) to the screen. */
    return sendError(res, e);
  }
  await recordAudit(req, { entity: 'ATTENDANCE_MONTH', entityId: month, action: 'CLOSE', message: `Closed ${month} (snapshot ${result.snapshot.version})${open.length ? `, with ${open.length} checklist item${open.length === 1 ? '' : 's'} acknowledged` : ''}${readiness.noRecordDays ? `; ${readiness.noRecordDays} day${readiness.noRecordDays === 1 ? '' : 's'} with no record confirmed as unpaid absence` : ''}`, metadata: { month, snapshotVersion: result.snapshot.version, acknowledged: open.map((c) => ({ key: c.key, count: c.count })), confirmedNoRecordDays: readiness.noRecordDays } });
  res.json(result);
  emitWebhook(orgId, 'month.closed', { month, closedAt: result.closed.at, byUserId: req.auth!.userId });
});

/**
 * Days the old full-day rule paid short, held because a pay run had taken
 * them or the month was closed (fullDayFix.ts): someone paid the difference,
 * and says so. Who and when are kept on each day; the audit log names them.
 */
attendanceRouter.post('/orgs/:orgId/attendance/full-day/paid', can(PermissionAction.EDIT, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))].slice(0, 500) as string[] : [];
  if (!ids.length) return res.status(400).json({ error: 'Say which days were paid.' });
  const note = String(req.body?.note || '').trim().slice(0, 300) || null;
  const { settleFullDays } = await import('../services/attendance/fullDayFix.js');
  const scope = await teamScope(req);
  const settled = await peopleWrite(orgId, () => settleFullDays(orgId, ids, req.auth!.userId, note, scope.all ? undefined : scope.ids));
  if (!settled) return res.status(409).json({ error: 'Those days are no longer waiting to be paid. Check again.' });
  await recordAudit(req, { entity: 'ATTENDANCE_FULL_DAY', entityId: ids[0], action: 'UPDATE', message: `Marked ${settled} day${settled === 1 ? '' : 's'} paid short as paid the difference${note ? `: ${note}` : ''}`, metadata: { ids, settled, note } });
  res.json({ settled });
});

/** Undo "Paid the difference": the days are held again. Same right as marking them paid; audited. */
attendanceRouter.post('/orgs/:orgId/attendance/full-day/unpaid', can(PermissionAction.EDIT, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))].slice(0, 500) as string[] : [];
  if (!ids.length) return res.status(400).json({ error: 'Say which days to hold again.' });
  const { unsettleFullDays } = await import('../services/attendance/fullDayFix.js');
  const scope = await teamScope(req);
  const undone = await peopleWrite(orgId, () => unsettleFullDays(orgId, ids, scope.all ? undefined : scope.ids));
  if (!undone) return res.status(409).json({ error: 'Those days are not marked paid. Check again.' });
  await recordAudit(req, { entity: 'ATTENDANCE_FULL_DAY', entityId: ids[0], action: 'UPDATE', message: `Undid paid the difference on ${undone} day${undone === 1 ? '' : 's'} paid short: held again`, metadata: { ids, undone } });
  res.json({ undone });
});

/**
 * Reopen a closed month, to correct it. Payroll already taken from it is not
 * changed, so a reopen says why and is written to the audit log with who
 * closed it and when (closure audit, 27 Oct 2026: a reopen left no trace).
 */
attendanceRouter.post('/orgs/:orgId/attendance/months/:month/reopen', can(PermissionAction.APPROVE, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const month = String(req.params.month);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Months are YYYY-MM.' });
  const reason = String(req.body?.reason || '').trim().slice(0, 300);
  if (reason.length < 5) return res.status(400).json({ error: 'Say why the month is reopened. It goes in the audit log.', code: 'REASON_NEEDED' });
  if (!(await teamScope(req)).all) return res.status(403).json({ error: 'Reopening a month is done by someone who sees the whole company.', code: 'TEAM_SCOPED' });
  const lock = await peoplePrisma.attendanceMonthLock.findUnique({ where: { orgId_month: { orgId, month } } });
  if (!lock) return res.status(409).json({ error: `${month} is not closed.` });
  /*
   * Reader punches counted while it was closed left their days alone: work those days out now (final review of #144),
   * in the same transaction, so a reopen that fails leaves the month closed with its marks rather than open without them.
   */
  const pendingDays = await peopleWrite(orgId, async () => {
    await peoplePrisma.attendanceMonthLock.deleteMany({ where: { orgId, month } });
    return workOutPendingDays(orgId, month);
  });
  /* The month is open again: days the old full-day rule held in it are corrected now, not at the next daily run (fullDayFix.ts). */
  const { fixFullDaysQuietly } = await import('../services/attendance/fullDayFix.js');
  await fixFullDaysQuietly({ accountId, orgId });
  await recordAudit(req, { entity: 'ATTENDANCE_MONTH', entityId: month, action: 'REOPEN', message: `Reopened ${month}: ${reason}`, metadata: { month, reason, closedAt: lock.lockedAt, closedByUserId: lock.lockedByUserId, pendingDays } });
  res.json({ month, closed: null, pendingDays });
  emitWebhook(orgId, 'month.reopened', { month: String(req.params.month), byUserId: req.auth!.userId });
});
