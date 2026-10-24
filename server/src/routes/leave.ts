import { Router } from 'express';
import { ownWorkRefusal } from '../services/makerChecker.js';
import { hrMayDecide } from '../services/attendance/approvalChain.js';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { logDayChange } from '../services/attendance/history.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma, peopleWrite, afterPeopleCommit } from '../utils/peoplePrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE } from '../services/attendance/guards.js';
import { hrOrAttendanceRouteOk } from '../services/people/guards.js';
import { isWeeklyOff } from '../services/attendance/compute.js';
import { ACCRUALS, CALENDAR, balanceFor, periodEnd, periodLabel, periodOf, periodStart, type LeavePeriod } from '../services/attendance/leaveAccrual.js';
import { emit as emitWebhook, leaveEvent, leaveEventFor } from '../services/attendance/webhooks.js';
import { ISO_DATE, closedMonths, codeKey, employeeIn, fail, isHoliday, myEmployee, peopleByCode, sendError, shiftFor, today, withNames, assertMonthOpen, writeDay } from '../services/attendance/days.js';
import { deleteToBin } from '../services/recycleBin.js';
import { recordAudit } from '../services/auditTrail.js';
import { policyProblem } from '../services/people/leavePolicy.js';
import { OPEN, balancesFor, leavePeriodOf, leaveYearOf, round } from '../services/attendance/leaveBalances.js';

/**
 * Leave, basic (after Horilla HRMS's leave app; reference only).
 *
 * Types (paid or unpaid, days a year), per-person allocations when a person
 * gets something other than the type's days, and requests. Approving a
 * request marks each working day in it "on leave" — weekly offs and holidays
 * inside the range are not leave and are not counted. Unpaid leave is loss of
 * pay in the attendance month summary. A request stays inside one calendar
 * year, so a balance is always one year's.
 */
export const leaveRouter = Router();
leaveRouter.use(requireAuth, requireTenantContext);

const R = ATTENDANCE_RESOURCE;
const can = (action: string, resource: string) => requirePermission(ATTENDANCE_MODULE, action as any, resource);
const base = '/orgs/:orgId/attendance/leave';
const MAX_SPAN_DAYS = 60;

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** ?year= when it is a year, else the period today is in. */
const yearParam = async (orgId: string, v: unknown) => {
  const y = Number(v);
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : leaveYearOf(orgId);
};
/** A period's first and last day, and its name. */
export const periodBounds = (p: LeavePeriod, year: number) => ({ year, from: periodStart(p, year), to: periodEnd(p, year), label: periodLabel(p, year) });

/** The days in a range that are leave: not a weekly off on that day's shift, not a holiday. */
async function workingDays(orgId: string, employee: { id: string; branchId: string | null; areaId?: string | null }, from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const { rule } = await shiftFor(orgId, employee.id, d);
    if (isWeeklyOff(rule, d)) continue;
    if (await isHoliday(orgId, d, employee.branchId, employee.areaId ?? null)) continue;
    out.push(d);
  }
  return out;
}

/**
 * The days a request takes. Under the sandwich rule the weekly offs and
 * holidays between its first and last working day are leave too.
 */
async function leaveDays(orgId: string, employee: { id: string; branchId: string | null; areaId?: string | null }, from: string, to: string, sandwich: boolean) {
  const days = await workingDays(orgId, employee, from, to);
  if (!sandwich || days.length < 2) return days;
  const out: string[] = [];
  for (let d = days[0]; d <= days[days.length - 1]; d = addDays(d, 1)) out.push(d);
  return out;
}



export const withTypes = async (orgId: string, rows: any[]) => {
  const types = new Map(
    (await peoplePrisma.leaveType.findMany({ where: { orgId }, select: { id: true, name: true, isPaid: true, color: true } })).map((t) => [t.id, t])
  );
  return (await withNames(orgId, rows)).map((r) => ({
    ...r,
    leaveTypeName: types.get(r.leaveTypeId)?.name || '—',
    isPaid: types.get(r.leaveTypeId)?.isPaid ?? true,
    leaveTypeColor: types.get(r.leaveTypeId)?.color ?? null,
  }));
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const typeSchema = z.object({
  name: z.string().trim().min(1, 'Name the leave type.').max(60),
  code: z.string().trim().max(10).optional().nullable(),
  isPaid: z.boolean().default(true),
  annualDays: z.coerce.number().min(0, 'Days cannot be negative.').max(366).default(0),
  isActive: z.boolean().optional(),
  accrual: z.enum(ACCRUALS as [string, ...string[]]).default('YEARLY'),
  prorateForJoiners: z.boolean().default(false),
  /** null: unused days lapse at the year end. */
  carryForwardMax: z.coerce.number().min(0).max(366).nullable().optional(),
});

/**
 * The policy HR sets on a type. Every field is optional with no default, so
 * a form that does not show them (Attendance's) leaves them as they are.
 */
const policySchema = z.object({
  description: z.string().trim().max(300).nullable().optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'A colour is #rrggbb.').nullable().optional(),
  allowHalfDay: z.boolean().optional(),
  minNoticeDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  maxDaysPerRequest: z.coerce.number().min(0.5, 'At least half a day.').max(366).nullable().optional(),
  backdatedDays: z.coerce.number().int().min(0).max(366).nullable().optional(),
  negativeDays: z.coerce.number().min(0, 'Days cannot be negative.').max(366).optional(),
  gender: z.enum(['FEMALE', 'MALE']).nullable().optional(),
  employeeTypeIds: z.array(z.string().min(1)).max(50).optional(),
  availableAfterDays: z.coerce.number().int().min(0).max(3650).nullable().optional(),
  sandwich: z.boolean().optional(),
  encashable: z.boolean().optional(),
  maxEncashDays: z.coerce.number().min(0).max(366).nullable().optional(),
  /** When each credit lands: START or END of each part of the leave period, or DAY (creditDay, 1–28). */
  creditOn: z.enum(['START', 'END', 'DAY']).optional(),
  creditDay: z.coerce.number().int().min(1, 'A day from 1 to 28.').max(28, 'A day from 1 to 28, so every month has it.').nullable().optional(),
});

async function policyOf(orgId: string, body: unknown): Promise<{ data: Record<string, unknown> } | { error: string }> {
  const parsed = policySchema.safeParse(body || {});
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || 'Check the leave policy.' };
  if (parsed.data.creditOn === 'DAY' && !parsed.data.creditDay) return { error: 'Say which day of the month leave is credited.' };
  const ids = parsed.data.employeeTypeIds;
  if (ids?.length) {
    const found = await peoplePrisma.employeeType.count({ where: { orgId, id: { in: ids } } });
    if (found !== new Set(ids).size) return { error: 'One of those employee types is not in this company.' };
  }
  return { data: parsed.data };
}

leaveRouter.get(`${base}/types`, can(PermissionAction.VIEW, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const types = await peoplePrisma.leaveType.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } });
  const used = await peoplePrisma.leaveRequest.groupBy({ by: ['leaveTypeId'], where: { accountId, orgId }, _count: { _all: true } });
  const n = new Map(used.map((u) => [u.leaveTypeId, u._count._all]));
  res.json({ types: types.map((t) => ({ ...t, requests: n.get(t.id) || 0 })) });
});

leaveRouter.post(`${base}/types`, can(PermissionAction.CREATE, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = typeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid leave type.' });
  const policy = await policyOf(orgId, req.body);
  if ('error' in policy) return res.status(400).json({ error: policy.error });
  try {
    const type = await peoplePrisma.leaveType.create({
      data: { accountId, orgId, ...parsed.data, ...policy.data, code: parsed.data.code || null, createdByUserId: req.auth!.userId },
    });
    res.status(201).json({ type });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.put(`${base}/types/:id`, can(PermissionAction.EDIT, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.leaveType.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such leave type.' });
  const parsed = typeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid leave type.' });
  if (parsed.data.isPaid !== existing.isPaid && (await peoplePrisma.leaveRequest.count({ where: { orgId, leaveTypeId: existing.id, status: 'APPROVED' } }))) {
    return res.status(409).json({ error: 'Leave of this type has been approved, so whether it is paid cannot change. Make a new type instead.' });
  }
  const policy = await policyOf(orgId, req.body);
  if ('error' in policy) return res.status(400).json({ error: policy.error });
  try {
    const type = await peopleWrite(orgId, async () => {
      const financial = ['isPaid', 'annualDays', 'accrual', 'prorateForJoiners', 'carryForwardMax', 'creditOn', 'creditDay', 'sandwich'] as const;
      const next = { ...parsed.data, ...policy.data };
      const changed = financial.some((key) => key in next && JSON.stringify((next as any)[key]) !== JSON.stringify(existing[key]));
      if (changed) {
        const activity = await Promise.all([
          peoplePrisma.leaveRequest.count({ where: { orgId, leaveTypeId: existing.id } }),
          peoplePrisma.leaveAllocation.count({ where: { orgId, leaveTypeId: existing.id } }),
          peoplePrisma.leaveAdjustment.count({ where: { orgId, leaveTypeId: existing.id } }),
        ]);
        const accrued = existing.createdAt.toISOString().slice(0, 10) < today() && await peoplePrisma.employee.count({ where: { orgId } });
        if (activity.some(Boolean) || accrued) throw fail(409, 'This policy already has balances or requests. Create a new leave type for the new entitlement; existing history is preserved.', 'LEAVE_POLICY_IN_USE');
      }
      return peoplePrisma.leaveType.update({ where: { id: existing.id }, data: { ...next, code: parsed.data.code || null } });
    });
    res.json({ type });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.delete(`${base}/types/:id`, can(PermissionAction.DELETE, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.leaveType.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such leave type.' });
  const used =
    (await peoplePrisma.leaveRequest.count({ where: { orgId, leaveTypeId: existing.id } })) +
    (await peoplePrisma.leaveAllocation.count({ where: { orgId, leaveTypeId: existing.id } }));
  if (used) return res.status(409).json({ error: 'This leave type has requests or balances. Mark it inactive instead.' });
  await deleteToBin(req, 'leaveType', existing);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

leaveRouter.get(`${base}/balances`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const year = await yearParam(orgId, req.query.year);
  const people = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, status: { not: 'LEFT' } },
    select: { id: true, name: true, code: true, department: true },
    orderBy: { name: 'asc' },
  });
  const { types, balances } = await balancesFor(accountId, orgId, people.map((p) => p.id), year);
  res.json({
    year,
    types: types.filter((t) => t.isActive),
    rows: people.map((p) => ({ employeeId: p.id, name: p.name, code: p.code, department: p.department, balances: Object.fromEntries(balances.get(p.id)!) })),
  });
});

leaveRouter.put(`${base}/allocations`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      employeeId: z.string().min(1),
      leaveTypeId: z.string().min(1),
      year: z.coerce.number().int().min(2000).max(2100),
      /** null puts the person back on the type's annual days. */
      days: z.coerce.number().min(0).max(366).nullable(),
      note: z.string().trim().max(200).optional().nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a person, a leave type, a year and the days.' });
  const b = parsed.data;
  try {
    await employeeIn(orgId, accountId, b.employeeId);
    const type = await peoplePrisma.leaveType.findFirst({ where: { id: b.leaveTypeId, accountId, orgId } });
    if (!type) return res.status(400).json({ error: 'That leave type is not in this organisation.' });
    if (!type.isPaid) return res.status(400).json({ error: 'Unpaid leave has no balance to set.' });
    const key = { employeeId_leaveTypeId_year: { employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, year: b.year } };
    if (b.days === null) {
      await peoplePrisma.leaveAllocation.deleteMany({ where: { orgId, employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, year: b.year } });
      return res.json({ allocation: null });
    }
    const allocation = await peoplePrisma.leaveAllocation.upsert({
      where: key,
      create: { accountId, orgId, employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, year: b.year, days: b.days, note: b.note || null, createdByUserId: req.auth!.userId },
      update: { days: b.days, note: b.note || null },
    });
    res.json({ allocation });
  } catch (e) {
    return sendError(res, e);
  }
});

/*
 * Opening balances from a list (AT-02): a company moving to CLOR mid-year
 * brings each person's days for the year. Same as setting a balance on Leave
 * Balances: the days a person has for that year, in place of the type's own.
 * Rows: employeeCode, leaveType (by name), year, days, note.
 */
leaveRouter.post(`${base}/allocations/import`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nothing to import.' });
  if (rows.length > 5000) return res.status(400).json({ error: 'Import up to 5,000 balances at a time.' });
  const dryRun = req.body?.dryRun === true;
  const [byCode, types] = await Promise.all([peopleByCode(orgId), peoplePrisma.leaveType.findMany({ where: { accountId, orgId }, select: { id: true, name: true, isPaid: true } })]);
  const typeByName = new Map(types.map((t) => [t.name.trim().toLowerCase(), t]));
  const results: Array<{ row: number; ok: boolean; error?: string }> = [];
  let imported = 0;
  const currentYear = await leaveYearOf(orgId);
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] || {};
    const emp = byCode.get(codeKey(r.employeeCode ?? r.code));
    if (!emp) { results.push({ row: i + 1, ok: false, error: `No employee with code ${String(r.employeeCode ?? '').trim() || '(blank)'}.` }); continue; }
    const type = typeByName.get(String(r.leaveType || '').trim().toLowerCase());
    if (!type) { results.push({ row: i + 1, ok: false, error: `No leave type called ${String(r.leaveType || '').trim() || '(blank)'}.` }); continue; }
    if (!type.isPaid) { results.push({ row: i + 1, ok: false, error: `${type.name} is unpaid: it has no balance.` }); continue; }
    const year = Number(String(r.year || '').trim()) || currentYear;
    const days = Number(String(r.days ?? '').trim());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) { results.push({ row: i + 1, ok: false, error: 'The year is a four-digit year.' }); continue; }
    if (!Number.isFinite(days) || days < 0 || days > 366) { results.push({ row: i + 1, ok: false, error: 'Days are a number from 0 to 366.' }); continue; }
    const note = String(r.note || '').trim().slice(0, 200) || 'Imported opening balance';
    if (!dryRun) {
      await peoplePrisma.leaveAllocation.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: type.id, year } },
        create: { accountId, orgId, employeeId: emp.id, leaveTypeId: type.id, year, days, note, createdByUserId: req.auth!.userId },
        update: { days, note },
      });
    }
    imported += 1;
  }
  res.json({ dryRun, imported, failed: results.length, results });
});

/*
 * Leave already taken, from a list (AT-02): each row becomes an approved
 * request, through the same approval as any other, so its days are marked
 * "on leave" and the balance counts it. A row that overlaps leave already on
 * file, or covers only weekly offs and holidays, is refused and named.
 * Rows: employeeCode, leaveType, from, to, halfDay (FIRST / SECOND / blank), reason.
 */
leaveRouter.post(`${base}/requests/import`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nothing to import.' });
  if (rows.length > 2000) return res.status(400).json({ error: 'Import up to 2,000 leave rows at a time.' });
  const dryRun = req.body?.dryRun === true;
  const [byCode, types] = await Promise.all([peopleByCode(orgId), peoplePrisma.leaveType.findMany({ where: { accountId, orgId }, select: { id: true, name: true } })]);
  const typeByName = new Map(types.map((t) => [t.name.trim().toLowerCase(), t]));
  const results: Array<{ row: number; ok: boolean; error?: string }> = [];
  let imported = 0;
  const period = await leavePeriodOf(orgId);
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] || {};
    const emp = byCode.get(codeKey(r.employeeCode ?? r.code));
    if (!emp) { results.push({ row: i + 1, ok: false, error: `No employee with code ${String(r.employeeCode ?? '').trim() || '(blank)'}.` }); continue; }
    const type = typeByName.get(String(r.leaveType || '').trim().toLowerCase());
    if (!type) { results.push({ row: i + 1, ok: false, error: `No leave type called ${String(r.leaveType || '').trim() || '(blank)'}.` }); continue; }
    const from = String(r.from || '').trim();
    const to = String(r.to || '').trim() || from;
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) { results.push({ row: i + 1, ok: false, error: 'Dates are YYYY-MM-DD.' }); continue; }
    if (to < from) { results.push({ row: i + 1, ok: false, error: 'The last day is before the first.' }); continue; }
    if (periodOf(period, from) !== periodOf(period, to)) { results.push({ row: i + 1, ok: false, error: `Leave stays inside one leave period. Split it at ${periodEnd(period, periodOf(period, from))}.` }); continue; }
    const half = String(r.halfDay || '').trim().toUpperCase();
    if (half && !['FIRST', 'SECOND'].includes(half)) { results.push({ row: i + 1, ok: false, error: 'Half day is FIRST, SECOND or blank.' }); continue; }
    if (half && from !== to) { results.push({ row: i + 1, ok: false, error: 'A half-day leave is for one day.' }); continue; }
    const days = await workingDays(orgId, emp, from, to);
    if (!days.length) { results.push({ row: i + 1, ok: false, error: 'Those are all weekly offs or holidays.' }); continue; }
    const clash = await peoplePrisma.leaveRequest.findFirst({ where: { orgId, employeeId: emp.id, status: { in: OPEN }, fromDate: { lte: to }, toDate: { gte: from } } });
    if (clash) { results.push({ row: i + 1, ok: false, error: `Overlaps leave already on file (${clash.fromDate} to ${clash.toDate}).` }); continue; }
    if (!dryRun) {
      let row: any = null;
      try {
        row = await peoplePrisma.leaveRequest.create({
          data: { accountId, orgId, employeeId: emp.id, leaveTypeId: type.id, fromDate: from, toDate: to, days: half ? 0.5 : days.length, halfDay: half || null, reason: String(r.reason || '').trim().slice(0, 500) || 'Imported leave', requestedByUserId: req.auth!.userId },
        });
        await approveLeave(accountId, orgId, row, req.auth!.userId, 'Imported');
      } catch (e: any) {
        /* Approval refused (a closed month, punches on the day): do not leave a stray pending request behind. */
        if (row) await peoplePrisma.leaveRequest.delete({ where: { id: row.id } }).catch(() => null);
        results.push({ row: i + 1, ok: false, error: String(e?.message || 'Not imported.') });
        continue;
      }
    }
    imported += 1;
  }
  res.json({ dryRun, imported, failed: results.length, results });
});

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const requestSchema = z.object({
  employeeId: z.string().trim().optional(),
  leaveTypeId: z.string().min(1, 'Choose a leave type.'),
  fromDate: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'),
  toDate: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'),
  reason: z.string().trim().min(3, 'Say why.').max(500),
  /** The first or second half of a single day. */
  halfDay: z.enum(['FIRST', 'SECOND']).nullable().optional(),
});

/** `by` is who asks: the signed-in user, or — from the employee portal — the employee themselves. */
export async function createLeave(
  req: any,
  res: any,
  employee: { id: string; branchId: string | null; areaId?: string | null; status?: string | null },
  by?: { accountId: string; orgId: string; userId: string },
  /** HR entering leave for someone is not held to notice or how far back. */
  opts: { onBehalf?: boolean } = {}
) {
  const { accountId, orgId } = by || req.tenant!;
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request.' });
  const b = parsed.data;
  if (b.toDate < b.fromDate) return res.status(400).json({ error: 'The last day is before the first.' });
  const period = await leavePeriodOf(orgId);
  const leaveYear = periodOf(period, b.fromDate);
  if (periodOf(period, b.toDate) !== leaveYear) return res.status(400).json({ error: `Leave stays inside one leave period (${periodLabel(period, leaveYear)}). Split it at ${periodEnd(period, leaveYear)}.` });
  if (addDays(b.fromDate, MAX_SPAN_DAYS - 1) < b.toDate) return res.status(400).json({ error: `One request covers at most ${MAX_SPAN_DAYS} days.` });
  if (employee.status === 'LEFT') return res.status(400).json({ error: 'This person has left.' });
  const type = await peoplePrisma.leaveType.findFirst({ where: { id: b.leaveTypeId, accountId, orgId, isActive: true } });
  if (!type) return res.status(400).json({ error: 'That leave type is not available.' });
  if (b.halfDay && b.fromDate !== b.toDate) return res.status(400).json({ error: 'A half-day leave is for one day.' });
  const days = await leaveDays(orgId, employee, b.fromDate, b.toDate, type.sandwich);
  if (!days.length) return res.status(400).json({ error: 'Those are all weekly offs or holidays — there is nothing to take leave from.' });
  const count = b.halfDay ? 0.5 : days.length;
  const person = await peoplePrisma.employee.findFirst({ where: { id: employee.id, orgId }, select: { gender: true, employeeTypeId: true, dateOfJoining: true } });
  const problem = policyProblem(type, person, { fromDate: b.fromDate, halfDay: b.halfDay ?? null, days: count }, today(), Boolean(opts.onBehalf));
  if (problem) return res.status(400).json({ error: problem, code: 'LEAVE_POLICY' });

  /*
   * Check and insert under one lock per employee. As separate steps, a double
   * tap in the portal passed the overlap and balance checks twice and saved two
   * overlapping requests, overdrawing the balance. The second request now waits
   * here, then sees the first one and is refused.
   */
  const outcome = await peopleWrite(orgId, async () => {
    const tx = peoplePrisma;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave:${employee.id}`}))`;
    const clash = await tx.leaveRequest.findFirst({
      where: { orgId, employeeId: employee.id, status: { in: OPEN }, fromDate: { lte: b.toDate }, toDate: { gte: b.fromDate } },
    });
    if (clash) return { status: 409, body: { error: `This overlaps leave already asked for (${clash.fromDate} to ${clash.toDate}).` } };
    if (type.isPaid) {
      const { balances } = await balancesFor(accountId, orgId, [employee.id], leaveYear, b.fromDate > today() ? b.fromDate : undefined);
      const bal = balances.get(employee.id)!.get(type.id)!;
      if (count > (bal.available ?? Infinity) + type.negativeDays) {
        const extra = type.negativeDays ? ` (and ${type.negativeDays} in advance)` : '';
        return { status: 400, body: { error: `Only ${bal.available} days of ${type.name} are left this year${extra}; this is ${count}.`, code: 'NO_BALANCE' } };
      }
    }
    const row = await tx.leaveRequest.create({
      data: { accountId, orgId, employeeId: employee.id, leaveTypeId: type.id, fromDate: b.fromDate, toDate: b.toDate, days: count, halfDay: b.halfDay ?? null, reason: b.reason, requestedByUserId: by?.userId || req.auth!.userId },
    });
    return { row };
  });
  if (!('row' in outcome)) return res.status(outcome.status).json(outcome.body);
  res.status(201).json({ request: await announce(orgId, outcome.row) });
}

/** Undo an approved leave's days. Days someone clocked in on anyway are theirs, and stay. */
async function clearLeaveDays(orgId: string, requestId: string) {
  const linked = await peoplePrisma.attendanceRecord.findMany({ where: { orgId, leaveRequestId: requestId }, select: { date: true } });
  for (const day of linked) await assertMonthOpen(orgId, day.date);
  /* A half-day leave's day keeps its punches: worked out again without the leave. */
  const halves = await peoplePrisma.attendanceRecord.findMany({ where: { orgId, leaveRequestId: requestId, status: { not: 'ON_LEAVE' } } });
  for (const h of halves) {
    const emp = await peoplePrisma.employee.findFirst({ where: { id: h.employeeId, orgId }, select: { id: true, branchId: true, areaId: true } });
    if (!emp) continue;
    await writeDay({ accountId: h.accountId, orgId, userId: 'system', employee: emp, date: h.date, checkIn: h.checkIn, checkOut: h.checkOut, source: h.source === 'LEAVE' ? 'DEVICE' : h.source, leaveRequestId: null, reason: 'Half-day leave cancelled or rejected' });
  }
  const cleared = await peoplePrisma.attendanceRecord.findMany({ where: { orgId, leaveRequestId: requestId, status: 'ON_LEAVE', checkIn: null } });
  await peoplePrisma.attendanceRecord.deleteMany({ where: { orgId, leaveRequestId: requestId, status: 'ON_LEAVE', checkIn: null } });
  for (const r of cleared) {
    await logDayChange({ accountId: r.accountId, orgId, employeeId: r.employeeId, date: r.date, recordId: r.id, action: 'LEAVE_CANCELLED', before: r, after: null, userId: 'system', reason: 'Leave cancelled or rejected' });
  }
}

leaveRouter.get(`${base}/requests`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const status = String(req.query.status || '').trim();
  const employeeId = String(req.query.employeeId || '').trim();
  /* ?month=YYYY-MM: requests touching that month (the leave calendar). */
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : '';
  const inMonth = month ? { fromDate: { lte: `${month}-31` }, toDate: { gte: `${month}-01` } } : {};
  /* ?year=: applications starting in that leave period (the register of applications). */
  const yearQ = Number(req.query.year);
  const period = Number.isInteger(yearQ) && yearQ >= 2000 && yearQ <= 2100 ? await leavePeriodOf(orgId) : null;
  const inYear = period ? { fromDate: { gte: periodStart(period, yearQ), lte: periodEnd(period, yearQ) } } : {};
  const rows = await peoplePrisma.leaveRequest.findMany({
    where: { accountId, orgId, ...(status ? { status } : {}), ...(employeeId ? { employeeId } : {}), ...inMonth, ...inYear },
    orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
    take: period ? 5000 : 500,
  });
  res.json({ requests: await withTypes(orgId, rows) });
});

leaveRouter.post(`${base}/requests`, can(PermissionAction.CREATE, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  try {
    const employee = await employeeIn(req.tenant!.orgId, req.tenant!.accountId, String(req.body?.employeeId || ''));
    return await createLeave(req, res, employee, undefined, { onBehalf: true });
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * Approve a pending request: count its working days again, check nothing was
 * worked on them, the balance, and that no month is closed, then write the
 * days. Throws `fail` errors (sendError or the public API answer them).
 */
export async function approveLeave(accountId: string, orgId: string, r: any, userId: string, note: string | null) {
  return peopleWrite(orgId, async () => {
    const current = await peoplePrisma.leaveRequest.findFirst({ where: { id: r.id, accountId, orgId } });
    if (!current || current.status !== 'PENDING') throw fail(409, 'This request is no longer pending.');
    r = current;
    const turn = await hrMayDecide(orgId, 'leave', r);
    if (!turn.ok) throw fail(409, turn.error, 'MANAGER_FIRST');
    const employee = await employeeIn(orgId, accountId, r.employeeId);
    const type = await peoplePrisma.leaveType.findFirst({ where: { id: r.leaveTypeId, orgId } });
    if (!type) throw fail(409, 'The leave type is gone.');
    /* Holidays or shifts may have changed since it was asked for: count again. */
    const days = await leaveDays(orgId, employee, r.fromDate, r.toDate, type.sandwich);
    if (!days.length) throw fail(409, 'Nothing in this range is a working day any more. Reject it instead.');
    /* A half-day leave sits beside the other half's punches; a whole day must have none. */
    const worked = r.halfDay
      ? null
      : await peoplePrisma.attendanceRecord.findFirst({ where: { orgId, employeeId: r.employeeId, date: { in: days }, checkIn: { not: null } }, select: { date: true } });
    if (worked) throw fail(409, `${worked.date} has a clock-in. Correct that day first, or reject this request.`);
    const count = r.halfDay ? 0.5 : days.length;
    if (type.isPaid) {
      const { balances } = await balancesFor(accountId, orgId, [r.employeeId], await leaveYearOf(orgId, r.fromDate), r.fromDate > today() ? r.fromDate : undefined);
      const bal = balances.get(r.employeeId)!.get(type.id)!;
      /* This request is in "pending" already; what matters is what is left without it. */
      const left = (bal.available ?? Infinity) + r.days + type.negativeDays;
      if (count > left) throw fail(409, `Only ${round(left)} days of ${type.name} are left this year; this is ${count}.`, 'NO_BALANCE');
    }
    /* Checked before any day is written, so an approval never stops halfway through a closed month. */
    const shut = await closedMonths(orgId, days.map((d) => d.slice(0, 7)));
    if (shut.size) throw fail(409, `${[...shut].sort().join(', ')} ${shut.size === 1 ? 'is' : 'are'} closed in Attendance. Reopen it to approve leave in it.`, 'ATTENDANCE_MONTH_CLOSED');
    if (r.halfDay) {
      /* The day keeps its punches; it is worked out with half of it as leave (writeDay's halfDayLeave rule). */
      const day = days[0];
      const existing = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: r.employeeId, date: day } } });
      await writeDay({
        accountId, orgId, userId, employee, date: day,
        checkIn: existing?.checkIn ?? null, checkOut: existing?.checkOut ?? null,
        source: existing?.source && existing.source !== 'LEAVE' ? existing.source : 'DEVICE',
        leaveRequestId: r.id, halfDayLeave: r.halfDay as 'FIRST' | 'SECOND',
        note: `${type.name}, ${r.halfDay === 'FIRST' ? 'first' : 'second'} half: ${r.reason}`.slice(0, 500),
      });
    } else {
      for (const date of days) {
        await writeDay({
          accountId,
          orgId,
          userId,
          employee,
          date,
          checkIn: null,
          checkOut: null,
          statusOverride: 'ON_LEAVE',
          source: 'LEAVE',
          leaveRequestId: r.id,
          note: `${type.name}: ${r.reason}`.slice(0, 500),
        });
      }
    }
    /* Only while still pending: a second approval at the same moment rolls this whole transaction back (A-13). */
    const claimed = await peoplePrisma.leaveRequest.updateMany({
      where: { id: r.id, status: 'PENDING' },
      data: { status: 'APPROVED', days: count, reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: note },
    });
    if (claimed.count !== 1) throw fail(409, 'This request is no longer pending.');
    const updated = await peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id: r.id } });
    return announce(orgId, updated);
  });
}

export async function rejectLeave(orgId: string, r: any, userId: string, note: string | null) {
  return peopleWrite(orgId, async () => {
    const current = await peoplePrisma.leaveRequest.findFirst({ where: { id: r.id, orgId } });
    if (!current || current.status !== 'PENDING') throw fail(409, 'This request is no longer pending.');
    const updated = await peoplePrisma.leaveRequest.update({
      where: { id: r.id },
      data: { status: 'REJECTED', reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: note },
    });
    return announce(orgId, updated);
  });
}

/** The request with names, sent to webhooks as the event its status is. */
async function announce(orgId: string, row: any) {
  const shaped = (await withTypes(orgId, [row]))[0];
  const event = leaveEventFor(row.status);
  if (event) afterPeopleCommit(() => emitWebhook(orgId, event, leaveEvent(shaped)));
  return shaped;
}

const noteOf = (req: any) => String(req.body?.note || '').trim().slice(0, 500) || null;

leaveRouter.post(`${base}/requests/:id/approve`, can(PermissionAction.APPROVE, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: `This request was already ${r.status.toLowerCase()}.` });
  const turn = await hrMayDecide(orgId, 'leave', r);
  if (!turn.ok) return res.status(409).json({ error: turn.error, code: 'MANAGER_FIRST' });
  /* A-13: your own leave is approved by somebody else, as the company's maker-checker setting decides (a one-person company still can). */
  const own = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { userId: true } });
  const refused = await ownWorkRefusal(req, { makers: [own?.userId], module: ATTENDANCE_MODULE, resource: R.leave, entity: 'ATTENDANCE_LEAVE_REQUEST', entityId: r.id, what: 'leave request' });
  if (refused) return res.status(refused.status).json(refused.body);
  try {
    res.json({ request: await approveLeave(accountId, orgId, r, req.auth!.userId, noteOf(req)) });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.post(`${base}/requests/:id/reject`, can(PermissionAction.APPROVE, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: `This request was already ${r.status.toLowerCase()}.` });
  res.json({ request: await rejectLeave(orgId, r, req.auth!.userId, noteOf(req)) });
});

export async function cancelLeaveRequest(accountId: string, orgId: string, id: string, userId: string) {
  return peopleWrite(orgId, async () => {
    const r = await peoplePrisma.leaveRequest.findFirst({ where: { id, accountId, orgId } });
    if (!r || !OPEN.includes(r.status)) throw fail(409, 'This request is no longer open.');
    const updated = await peoplePrisma.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED', reviewedByUserId: userId, reviewedAt: new Date() } });
    if (r.status === 'APPROVED') await clearLeaveDays(orgId, r.id);
    return announce(orgId, updated);
  });
}

leaveRouter.post(`${base}/requests/:id/cancel`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try { res.json({ request: await cancelLeaveRequest(accountId, orgId, String(req.params.id), req.auth!.userId) }); }
  catch (e) { return sendError(res, e); }
});

// ---------------------------------------------------------------------------
// Adjustments and the ledger (People → Time Off → Balances)
// ---------------------------------------------------------------------------

const adjustmentSchema = z.object({
  employeeId: z.string().min(1, 'Choose the person.'),
  leaveTypeId: z.string().min(1, 'Choose the leave type.'),
  year: z.coerce.number().int().min(2000).max(2100),
  /** ADJUST: positive adds, negative takes away. ENCASH: the days paid out, as a positive number. */
  days: z.coerce.number().refine((n) => n !== 0 && Math.abs(n) <= 366, 'Give the days, not zero.'),
  kind: z.enum(['ADJUST', 'ENCASH']).default('ADJUST'),
  reason: z.string().trim().min(3, 'Say why.').max(300),
});

leaveRouter.get(`${base}/adjustments`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employeeId = String(req.query.employeeId || '').trim();
  const rows = await peoplePrisma.leaveAdjustment.findMany({
    where: { accountId, orgId, year: await yearParam(orgId, req.query.year), ...(employeeId ? { employeeId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json({ adjustments: await withTypes(orgId, rows) });
});

leaveRouter.post(`${base}/adjustments`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = adjustmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the adjustment.' });
  const b = parsed.data;
  try {
    const employee = await employeeIn(orgId, accountId, b.employeeId);
    const type = await peoplePrisma.leaveType.findFirst({ where: { id: b.leaveTypeId, accountId, orgId } });
    if (!type) return res.status(400).json({ error: 'No such leave type.' });
    if (!type.isPaid) return res.status(400).json({ error: `${type.name} is unpaid and has no balance to adjust.` });
    const row = await peopleWrite(orgId, async () => {
      let days = b.days;
      if (b.kind === 'ENCASH') {
        if (!type.encashable) throw fail(400, `${type.name} is not paid out. Turn on encashment in its policy first.`);
        if (days < 0) throw fail(400, 'Give the days paid out as a positive number.');
        const paidOut = -((await peoplePrisma.leaveAdjustment.aggregate({ where: { orgId, employeeId: employee.id, leaveTypeId: type.id, year: b.year, kind: 'ENCASH' }, _sum: { days: true } }))._sum.days ?? 0);
        if (type.maxEncashDays != null && paidOut + days > type.maxEncashDays) {
          throw fail(400, `At most ${type.maxEncashDays} days of ${type.name} are paid out a year; ${paidOut} already are.`);
        }
        const { balances } = await balancesFor(accountId, orgId, [employee.id], b.year);
        const left = balances.get(employee.id)!.get(type.id)!.available ?? 0;
        if (days > left) throw fail(400, `Only ${left} days of ${type.name} are left to pay out.`, 'NO_BALANCE');
        days = -days;
      }
      return peoplePrisma.leaveAdjustment.create({
        data: { accountId, orgId, employeeId: employee.id, leaveTypeId: type.id, year: b.year, days, kind: b.kind, reason: b.reason, createdByUserId: req.auth!.userId },
      });
    });
    const days = row.days;
    await recordAudit(req, {
      entity: 'LeaveAdjustment',
      entityId: row.id,
      action: 'CREATE',
      message: `${b.kind === 'ENCASH' ? 'Paid out' : days > 0 ? 'Added' : 'Took away'} ${Math.abs(days)} days of ${type.name} for ${employee.name} (${b.year}): ${b.reason}`,
      metadata: { employeeId: employee.id, leaveTypeId: type.id, year: b.year, days, kind: b.kind },
    });
    res.status(201).json({ adjustment: (await withTypes(orgId, [row]))[0] });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.delete(`${base}/adjustments/:id`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  await peopleWrite(orgId, async () => {
    const row = await peoplePrisma.leaveAdjustment.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!row) throw fail(404, 'No such adjustment.');
    const earning = row.kind === 'ENCASH' ? await payrollPrisma.payrollAdjustment.findUnique({ where: { id: `leave-encash:${row.id}` } }) : null;
    if (row.paidInRunId || (earning && earning.status !== 'CANCELLED')) throw fail(409, 'This encashment is linked to payroll. Cancel its unconsumed earning first, or use a correcting adjustment.');
    await deleteToBin(req, 'leaveAdjustment', row);
  });
  res.json({ ok: true });
});

/**
 * One person's year, line by line for each type: carried in, earned,
 * adjustments, leave taken and waiting — the answer to "why is my balance this?".
 */
leaveRouter.get(`${base}/ledger`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const employee = await employeeIn(orgId, accountId, String(req.query.employeeId || ''));
    const year = await yearParam(orgId, req.query.year);
    const { types, balances, period } = await balancesFor(accountId, orgId, [employee.id], year);
    const bounds = periodBounds(period, year);
    const t0 = today();
    const [requests, adjustments] = await Promise.all([
      peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId: employee.id, status: { in: OPEN }, fromDate: { gte: bounds.from, lte: bounds.to } }, orderBy: { fromDate: 'asc' } }),
      peoplePrisma.leaveAdjustment.findMany({ where: { orgId, employeeId: employee.id, year }, orderBy: { createdAt: 'asc' } }),
    ]);
    const mine = balances.get(employee.id)!;
    const out = types
      .filter((t) => t.isActive || requests.some((r) => r.leaveTypeId === t.id) || adjustments.some((a) => a.leaveTypeId === t.id))
      .map((t) => {
        const bal = mine.get(t.id)!;
        const entries: Array<{ date: string; kind: string; days: number; note: string; id?: string }> = [];
        if (t.isPaid) {
          if (bal.carriedIn) entries.push({ date: bounds.from, kind: 'CARRIED', days: bal.carriedIn, note: `Carried from ${periodLabel(period, year - 1)}` });
          if (bal.allocationId) entries.push({ date: bounds.from, kind: 'ALLOCATED', days: round((bal.allocated ?? 0) - (bal.adjusted ?? 0)), note: 'Set for this person this period' });
          /* Each credit on its own date, as the policy lands it; those still to come are shown, not counted. */
          else for (const c of bal.credits || []) {
            entries.push({ date: c.date, kind: c.date <= t0 ? 'CREDIT' : 'UPCOMING', days: c.days, note: c.from === bounds.from && c.to === bounds.to ? 'This period’s days' : `For ${c.from} to ${c.to}` });
          }
          for (const a of adjustments.filter((x) => x.leaveTypeId === t.id)) {
            entries.push({ id: a.id, date: a.createdAt.toISOString().slice(0, 10), kind: a.kind, days: a.days, note: a.reason });
          }
        }
        for (const r of requests.filter((x) => x.leaveTypeId === t.id)) {
          entries.push({ id: r.id, date: r.fromDate, kind: r.status === 'APPROVED' ? 'TAKEN' : 'PENDING', days: -r.days, note: r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}` });
        }
        entries.sort((a, b) => a.date.localeCompare(b.date));
        return { type: { id: t.id, name: t.name, code: t.code, color: t.color, isPaid: t.isPaid, encashable: t.encashable }, balance: bal, entries };
      });
    res.json({ employee: { id: employee.id, name: employee.name }, year, period: bounds, types: out });
  } catch (e) {
    return sendError(res, e);
  }
});

// ---------------------------------------------------------------------------
// The leave period, and the register (People → Leave)
// ---------------------------------------------------------------------------

leaveRouter.get(`${base}/settings`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const period = await leavePeriodOf(orgId);
  const year = periodOf(period, today());
  res.json({ ...period, current: periodBounds(period, year), next: periodBounds(period, year + 1), previous: periodBounds(period, year - 1) });
});

leaveRouter.put(`${base}/settings`, can(PermissionAction.EDIT, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      startMonth: z.coerce.number().int().min(1).max(12),
      startDay: z.coerce.number().int().min(1, 'A day from 1 to 28.').max(28, 'A day from 1 to 28, so every month has it.'),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the leave period.' });
  const data = { leavePeriodStartMonth: parsed.data.startMonth, leavePeriodStartDay: parsed.data.startDay };
  await peopleWrite(orgId, async () => {
    const old = await leavePeriodOf(orgId);
    if (old.startMonth !== data.leavePeriodStartMonth || old.startDay !== data.leavePeriodStartDay) {
      const counts = await Promise.all([
        peoplePrisma.leaveRequest.count({ where: { orgId } }),
        peoplePrisma.leaveAllocation.count({ where: { orgId } }),
        peoplePrisma.leaveAdjustment.count({ where: { orgId } }),
      ]);
      if (counts.some(Boolean)) throw fail(409, 'Leave periods cannot change after balances or requests have been recorded. Migrate the existing balances before changing the period.', 'LEAVE_PERIOD_IN_USE');
    }
  await peoplePrisma.attendanceSettings.upsert({ where: { orgId }, update: data, create: { accountId, orgId, ...data, updatedByUserId: req.auth!.userId } as any });
  });
  await recordAudit(req, { entity: 'LeaveSettings', entityId: orgId, action: 'UPDATE', message: `Leave period starts on day ${parsed.data.startDay} of month ${parsed.data.startMonth}`, metadata: parsed.data });
  const period = await leavePeriodOf(orgId);
  res.json({ ...period, current: periodBounds(period, periodOf(period, today())) });
});

/**
 * The leave register: for one leave period, each person and type — opening
 * (carried in), credited, changed by HR, taken, paid out, waiting, lapsed at
 * the period end and what is left. Worked out from the policy and the
 * records, so it is never out of date and nobody runs it.
 */
leaveRouter.get(`${base}/register`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const year = await yearParam(orgId, req.query.year);
  const typeId = String(req.query.leaveTypeId || '').trim();
  const period = await leavePeriodOf(orgId);
  const bounds = periodBounds(period, year);
  const people = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, OR: [{ dateOfLeaving: null }, { dateOfLeaving: { gte: bounds.from } }], AND: [{ OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: bounds.to } }] }] },
    select: { id: true, name: true, code: true, department: true, status: true },
    orderBy: { name: 'asc' },
  });
  const ids = people.map((p) => p.id);
  const [{ types, balances }, adjustments] = await Promise.all([
    balancesFor(accountId, orgId, ids, year),
    peoplePrisma.leaveAdjustment.findMany({ where: { orgId, year, employeeId: { in: ids } }, select: { employeeId: true, leaveTypeId: true, days: true, kind: true } }),
  ]);
  const ended = today() > bounds.to;
  const shown = types.filter((t) => (!typeId || t.id === typeId) && (t.isActive || [...balances.values()].some((m) => (m.get(t.id)?.used || 0) > 0)));
  const rows = [];
  for (const p of people) {
    for (const t of shown) {
      const b = balances.get(p.id)?.get(t.id);
      if (!b) continue;
      const adj = adjustments.filter((a) => a.employeeId === p.id && a.leaveTypeId === t.id);
      const encashed = round(-adj.filter((a) => a.kind === 'ENCASH').reduce((x, a) => x + a.days, 0));
      const changed = round(adj.filter((a) => a.kind !== 'ENCASH').reduce((x, a) => x + a.days, 0));
      if (!t.isPaid) {
        if (b.used || b.pending) rows.push({ employeeId: p.id, name: p.name, code: p.code, department: p.department, leaveTypeId: t.id, leaveType: t.name, isPaid: false, opening: null, credited: null, changed: null, taken: b.used, encashed: null, pending: b.pending, lapsed: null, closing: null });
        continue;
      }
      const closing = round((b.allocated ?? 0) - b.used - b.pending);
      /* At the period end, what the type does not carry forward lapses. */
      const carry = t.carryForwardMax == null || t.carryForwardMax <= 0 ? 0 : Math.min(t.carryForwardMax, Math.max(0, round((b.allocated ?? 0) - b.used)));
      rows.push({
        employeeId: p.id, name: p.name, code: p.code, department: p.department, leaveTypeId: t.id, leaveType: t.name, isPaid: true,
        opening: b.carriedIn ?? 0,
        credited: b.allocationId ? round((b.allocated ?? 0) - (b.adjusted ?? 0)) : b.earned ?? 0,
        changed, taken: b.used, encashed, pending: b.pending,
        lapsed: ended ? round(Math.max(0, (b.allocated ?? 0) - b.used) - carry) : null,
        closing,
      });
    }
  }
  res.json({ period: bounds, ended, types: shown.map((t) => ({ id: t.id, name: t.name, isPaid: t.isPaid, color: t.color })), rows });
});

// ---------------------------------------------------------------------------
// My leave
// ---------------------------------------------------------------------------

leaveRouter.get('/orgs/:orgId/attendance/me/leave', can(PermissionAction.VIEW, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const year = await yearParam(orgId, req.query.year);
    const { types, balances } = await balancesFor(accountId, orgId, [me.id], year);
    const mine = balances.get(me.id)!;
    const requests = await peoplePrisma.leaveRequest.findMany({
      where: { accountId, orgId, employeeId: me.id, fromDate: { gte: periodStart(await leavePeriodOf(orgId), year), lte: periodEnd(await leavePeriodOf(orgId), year) } },
      orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({
      employee: { id: me.id, name: me.name },
      year,
      today: today(),
      types: types.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name, code: t.code, isPaid: t.isPaid, ...mine.get(t.id) })),
      requests: await withTypes(orgId, requests),
    });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.post('/orgs/:orgId/attendance/me/leave', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  try {
    const me = await myEmployee(req.tenant!.accountId, req.tenant!.orgId, req.auth!.userId);
    return await createLeave(req, res, me);
  } catch (e) {
    return sendError(res, e);
  }
});

/** One's own request: a pending one any time, an approved one only before it starts. */
export async function cancelOwnLeave(accountId: string, orgId: string, employeeId: string, id: string): Promise<{ status: number; body: any }> {
  return peopleWrite(orgId, async () => {
    const r = await peoplePrisma.leaveRequest.findFirst({ where: { id, accountId, orgId, employeeId } });
    if (!r) return { status: 404, body: { error: 'No such request.' } };
    if (!OPEN.includes(r.status)) return { status: 409, body: { error: `This request was already ${r.status.toLowerCase()}.` } };
    if (r.status === 'APPROVED' && r.fromDate <= today()) return { status: 409, body: { error: 'This leave has started. Ask your manager to cancel it.' } };
    return { status: 200, body: { request: await cancelLeaveRequest(accountId, orgId, r.id, `portal:${employeeId}`) } };
  });
}

leaveRouter.post('/orgs/:orgId/attendance/me/leave/:id/cancel', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const out = await cancelOwnLeave(accountId, orgId, me.id, String(req.params.id));
    res.status(out.status).json(out.body);
  } catch (e) {
    return sendError(res, e);
  }
});
