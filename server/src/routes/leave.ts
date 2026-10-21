import { Router } from 'express';
import { hrMayDecide } from '../services/attendance/approvalChain.js';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { logDayChange } from '../services/attendance/history.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import { isWeeklyOff } from '../services/attendance/compute.js';
import { balanceFor } from '../services/attendance/leaveAccrual.js';
import { emit as emitWebhook, leaveEvent, leaveEventFor } from '../services/attendance/webhooks.js';
import {
  ISO_DATE,
  closedMonths,
  codeKey,
  employeeIn,
  fail,
  isHoliday,
  myEmployee,
  peopleByCode,
  sendError,
  shiftFor,
  today,
  withNames,
  writeDay,
} from './attendance.js';

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
const OPEN = ['PENDING', 'APPROVED'];

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const yearParam = (v: unknown) => {
  const y = Number(v);
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : Number(today().slice(0, 4));
};
const round = (n: number) => Math.round(n * 100) / 100;

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

type Balance = { allocated: number; used: number; pending: number; available: number };

/**
 * Each person's balance of each type for a year (services/attendance/leaveAccrual.ts).
 * Unpaid types have no limit (allocated = null). `asOf` is the date earned
 * days are counted to: today in the current year, the year end for a past
 * one; a request is checked against what will have been earned by its first day.
 */
export async function balancesFor(accountId: string, orgId: string, employeeIds: string[], year: number, asOf?: string) {
  const t0 = today();
  const on = asOf || (Number(t0.slice(0, 4)) > year ? `${year}-12-31` : Number(t0.slice(0, 4)) < year ? `${year}-01-01` : t0);
  const from = year - 10;
  const [types, allocations, requests, people] = await Promise.all([
    peoplePrisma.leaveType.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } }),
    peoplePrisma.leaveAllocation.findMany({ where: { accountId, orgId, year: { gte: from, lte: year }, employeeId: { in: employeeIds } } }),
    peoplePrisma.leaveRequest.findMany({
      where: { accountId, orgId, employeeId: { in: employeeIds }, status: { in: OPEN }, fromDate: { gte: `${from}-01-01`, lte: `${year}-12-31` } },
      select: { employeeId: true, leaveTypeId: true, status: true, days: true, fromDate: true },
    }),
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: employeeIds } }, select: { id: true, dateOfJoining: true } }),
  ]);
  const joinedOf = new Map(people.map((p) => [p.id, p.dateOfJoining || null]));
  const out = new Map<string, Map<string, Balance & { allocated: number | null; available: number | null; allocationId: string | null; earned?: number; carriedIn?: number; fullYear?: number | null }>>();
  for (const id of employeeIds) {
    const m = new Map();
    for (const t of types) {
      const mine = requests.filter((r) => r.employeeId === id && r.leaveTypeId === t.id);
      const thisYear = mine.filter((r) => r.fromDate.startsWith(`${year}-`));
      const used = round(thisYear.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.days, 0));
      const pending = round(thisYear.filter((r) => r.status === 'PENDING').reduce((s, r) => s + r.days, 0));
      if (!t.isPaid) {
        m.set(t.id, { allocated: null, allocationId: null, used, pending, available: null });
        continue;
      }
      const allocs = allocations.filter((a) => a.employeeId === id && a.leaveTypeId === t.id);
      const taken = new Map<number, number>();
      for (const r of mine) taken.set(Number(r.fromDate.slice(0, 4)), (taken.get(Number(r.fromDate.slice(0, 4))) || 0) + r.days);
      const b = balanceFor(t, year, joinedOf.get(id) ?? null, on, new Map(allocs.map((a) => [a.year, a.days])), taken);
      m.set(t.id, {
        allocated: b.allocated,
        allocationId: allocs.find((a) => a.year === year)?.id || null,
        used,
        pending,
        available: round(b.allocated - used - pending),
        earned: b.earned,
        carriedIn: b.carriedIn,
        fullYear: b.fullYear,
      });
    }
    out.set(id, m);
  }
  return { types, balances: out };
}

export const withTypes = async (orgId: string, rows: any[]) => {
  const types = new Map(
    (await peoplePrisma.leaveType.findMany({ where: { orgId }, select: { id: true, name: true, isPaid: true } })).map((t) => [t.id, t])
  );
  return (await withNames(orgId, rows)).map((r) => ({
    ...r,
    leaveTypeName: types.get(r.leaveTypeId)?.name || '—',
    isPaid: types.get(r.leaveTypeId)?.isPaid ?? true,
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
  accrual: z.enum(['YEARLY', 'MONTHLY']).default('YEARLY'),
  prorateForJoiners: z.boolean().default(false),
  /** null: unused days lapse at the year end. */
  carryForwardMax: z.coerce.number().min(0).max(366).nullable().optional(),
});

leaveRouter.get(`${base}/types`, can(PermissionAction.VIEW, R.leaveTypes), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const types = await peoplePrisma.leaveType.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } });
  const used = await peoplePrisma.leaveRequest.groupBy({ by: ['leaveTypeId'], where: { accountId, orgId }, _count: { _all: true } });
  const n = new Map(used.map((u) => [u.leaveTypeId, u._count._all]));
  res.json({ types: types.map((t) => ({ ...t, requests: n.get(t.id) || 0 })) });
});

leaveRouter.post(`${base}/types`, can(PermissionAction.CREATE, R.leaveTypes), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = typeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid leave type.' });
  try {
    const type = await peoplePrisma.leaveType.create({
      data: { accountId, orgId, ...parsed.data, code: parsed.data.code || null, createdByUserId: req.auth!.userId },
    });
    res.status(201).json({ type });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.put(`${base}/types/:id`, can(PermissionAction.EDIT, R.leaveTypes), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.leaveType.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such leave type.' });
  const parsed = typeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid leave type.' });
  if (parsed.data.isPaid !== existing.isPaid && (await peoplePrisma.leaveRequest.count({ where: { orgId, leaveTypeId: existing.id, status: 'APPROVED' } }))) {
    return res.status(409).json({ error: 'Leave of this type has been approved, so whether it is paid cannot change. Make a new type instead.' });
  }
  try {
    const type = await peoplePrisma.leaveType.update({ where: { id: existing.id }, data: { ...parsed.data, code: parsed.data.code || null } });
    res.json({ type });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.delete(`${base}/types/:id`, can(PermissionAction.DELETE, R.leaveTypes), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.leaveType.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such leave type.' });
  const used =
    (await peoplePrisma.leaveRequest.count({ where: { orgId, leaveTypeId: existing.id } })) +
    (await peoplePrisma.leaveAllocation.count({ where: { orgId, leaveTypeId: existing.id } }));
  if (used) return res.status(409).json({ error: 'This leave type has requests or balances. Mark it inactive instead.' });
  await peoplePrisma.leaveType.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

leaveRouter.get(`${base}/balances`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const year = yearParam(req.query.year);
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
  if (!(await attendanceRouteOk(req, res))) return;
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
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nothing to import.' });
  if (rows.length > 5000) return res.status(400).json({ error: 'Import up to 5,000 balances at a time.' });
  const dryRun = req.body?.dryRun === true;
  const [byCode, types] = await Promise.all([peopleByCode(orgId), peoplePrisma.leaveType.findMany({ where: { accountId, orgId }, select: { id: true, name: true, isPaid: true } })]);
  const typeByName = new Map(types.map((t) => [t.name.trim().toLowerCase(), t]));
  const results: Array<{ row: number; ok: boolean; error?: string }> = [];
  let imported = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] || {};
    const emp = byCode.get(codeKey(r.employeeCode ?? r.code));
    if (!emp) { results.push({ row: i + 1, ok: false, error: `No employee with code ${String(r.employeeCode ?? '').trim() || '(blank)'}.` }); continue; }
    const type = typeByName.get(String(r.leaveType || '').trim().toLowerCase());
    if (!type) { results.push({ row: i + 1, ok: false, error: `No leave type called ${String(r.leaveType || '').trim() || '(blank)'}.` }); continue; }
    if (!type.isPaid) { results.push({ row: i + 1, ok: false, error: `${type.name} is unpaid: it has no balance.` }); continue; }
    const year = Number(String(r.year || '').trim() || today().slice(0, 4));
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
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nothing to import.' });
  if (rows.length > 2000) return res.status(400).json({ error: 'Import up to 2,000 leave rows at a time.' });
  const dryRun = req.body?.dryRun === true;
  const [byCode, types] = await Promise.all([peopleByCode(orgId), peoplePrisma.leaveType.findMany({ where: { accountId, orgId }, select: { id: true, name: true } })]);
  const typeByName = new Map(types.map((t) => [t.name.trim().toLowerCase(), t]));
  const results: Array<{ row: number; ok: boolean; error?: string }> = [];
  let imported = 0;
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
    if (from.slice(0, 4) !== to.slice(0, 4)) { results.push({ row: i + 1, ok: false, error: 'Leave stays inside one year. Split it at 31 December.' }); continue; }
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
  by?: { accountId: string; orgId: string; userId: string }
) {
  const { accountId, orgId } = by || req.tenant!;
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request.' });
  const b = parsed.data;
  if (b.toDate < b.fromDate) return res.status(400).json({ error: 'The last day is before the first.' });
  if (b.fromDate.slice(0, 4) !== b.toDate.slice(0, 4)) return res.status(400).json({ error: 'Leave stays inside one year. Split it at 31 December.' });
  if (addDays(b.fromDate, MAX_SPAN_DAYS - 1) < b.toDate) return res.status(400).json({ error: `One request covers at most ${MAX_SPAN_DAYS} days.` });
  if (employee.status === 'LEFT') return res.status(400).json({ error: 'This person has left.' });
  const type = await peoplePrisma.leaveType.findFirst({ where: { id: b.leaveTypeId, accountId, orgId, isActive: true } });
  if (!type) return res.status(400).json({ error: 'That leave type is not available.' });
  if (b.halfDay && b.fromDate !== b.toDate) return res.status(400).json({ error: 'A half-day leave is for one day.' });
  const days = await workingDays(orgId, employee, b.fromDate, b.toDate);
  if (!days.length) return res.status(400).json({ error: 'Those are all weekly offs or holidays — there is nothing to take leave from.' });
  const count = b.halfDay ? 0.5 : days.length;

  /*
   * Check and insert under one lock per employee. As separate steps, a double
   * tap in the portal passed the overlap and balance checks twice and saved two
   * overlapping requests, overdrawing the balance. The second request now waits
   * here, then sees the first one and is refused.
   */
  const outcome = await peoplePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave:${employee.id}`}))`;
    const clash = await tx.leaveRequest.findFirst({
      where: { orgId, employeeId: employee.id, status: { in: OPEN }, fromDate: { lte: b.toDate }, toDate: { gte: b.fromDate } },
    });
    if (clash) return { status: 409, body: { error: `This overlaps leave already asked for (${clash.fromDate} to ${clash.toDate}).` } };
    if (type.isPaid) {
      const { balances } = await balancesFor(accountId, orgId, [employee.id], Number(b.fromDate.slice(0, 4)), b.fromDate > today() ? b.fromDate : undefined);
      const bal = balances.get(employee.id)!.get(type.id)!;
      if (count > (bal.available ?? Infinity)) {
        return { status: 400, body: { error: `Only ${bal.available} days of ${type.name} are left this year; this is ${count}.`, code: 'NO_BALANCE' } };
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
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const status = String(req.query.status || '').trim();
  const employeeId = String(req.query.employeeId || '').trim();
  const rows = await peoplePrisma.leaveRequest.findMany({
    where: { accountId, orgId, ...(status ? { status } : {}), ...(employeeId ? { employeeId } : {}) },
    orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  });
  res.json({ requests: await withTypes(orgId, rows) });
});

leaveRouter.post(`${base}/requests`, can(PermissionAction.CREATE, R.leave), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  try {
    const employee = await employeeIn(req.tenant!.orgId, req.tenant!.accountId, String(req.body?.employeeId || ''));
    return await createLeave(req, res, employee);
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
  const employee = await employeeIn(orgId, accountId, r.employeeId);
  const type = await peoplePrisma.leaveType.findFirst({ where: { id: r.leaveTypeId, orgId } });
  if (!type) throw fail(409, 'The leave type is gone.');
  /* Holidays or shifts may have changed since it was asked for: count again. */
  const days = await workingDays(orgId, employee, r.fromDate, r.toDate);
  if (!days.length) throw fail(409, 'Nothing in this range is a working day any more. Reject it instead.');
  /* A half-day leave sits beside the other half's punches; a whole day must have none. */
  const worked = r.halfDay
    ? null
    : await peoplePrisma.attendanceRecord.findFirst({ where: { orgId, employeeId: r.employeeId, date: { in: days }, checkIn: { not: null } }, select: { date: true } });
  if (worked) throw fail(409, `${worked.date} has a clock-in. Correct that day first, or reject this request.`);
  const count = r.halfDay ? 0.5 : days.length;
  if (type.isPaid) {
    const { balances } = await balancesFor(accountId, orgId, [r.employeeId], Number(r.fromDate.slice(0, 4)), r.fromDate > today() ? r.fromDate : undefined);
    const bal = balances.get(r.employeeId)!.get(type.id)!;
    /* This request is in "pending" already; what matters is what is left without it. */
    const left = (bal.available ?? Infinity) + r.days;
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
  const updated = await peoplePrisma.leaveRequest.update({
    where: { id: r.id },
    data: { status: 'APPROVED', days: count, reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: note },
  });
  return announce(orgId, updated);
}

export async function rejectLeave(orgId: string, r: any, userId: string, note: string | null) {
  const updated = await peoplePrisma.leaveRequest.update({
    where: { id: r.id },
    data: { status: 'REJECTED', reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: note },
  });
  return announce(orgId, updated);
}

/** The request with names, sent to webhooks as the event its status is. */
async function announce(orgId: string, row: any) {
  const shaped = (await withTypes(orgId, [row]))[0];
  const event = leaveEventFor(row.status);
  if (event) emitWebhook(orgId, event, leaveEvent(shaped));
  return shaped;
}

const noteOf = (req: any) => String(req.body?.note || '').trim().slice(0, 500) || null;

leaveRouter.post(`${base}/requests/:id/approve`, can(PermissionAction.APPROVE, R.leave), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: `This request was already ${r.status.toLowerCase()}.` });
  const turn = await hrMayDecide(orgId, 'leave', r);
  if (!turn.ok) return res.status(409).json({ error: turn.error, code: 'MANAGER_FIRST' });
  try {
    res.json({ request: await approveLeave(accountId, orgId, r, req.auth!.userId, noteOf(req)) });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.post(`${base}/requests/:id/reject`, can(PermissionAction.APPROVE, R.leave), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: `This request was already ${r.status.toLowerCase()}.` });
  res.json({ request: await rejectLeave(orgId, r, req.auth!.userId, noteOf(req)) });
});

leaveRouter.post(`${base}/requests/:id/cancel`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  if (!OPEN.includes(r.status)) return res.status(409).json({ error: `This request was already ${r.status.toLowerCase()}.` });
  if (r.status === 'APPROVED') await clearLeaveDays(orgId, r.id);
  const updated = await peoplePrisma.leaveRequest.update({
    where: { id: r.id },
    data: { status: 'CANCELLED', reviewedByUserId: req.auth!.userId, reviewedAt: new Date() },
  });
  res.json({ request: await announce(orgId, updated) });
});

// ---------------------------------------------------------------------------
// My leave
// ---------------------------------------------------------------------------

leaveRouter.get('/orgs/:orgId/attendance/me/leave', can(PermissionAction.VIEW, R.self), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const year = yearParam(req.query.year);
    const { types, balances } = await balancesFor(accountId, orgId, [me.id], year);
    const mine = balances.get(me.id)!;
    const requests = await peoplePrisma.leaveRequest.findMany({
      where: { accountId, orgId, employeeId: me.id, fromDate: { gte: `${year}-01-01`, lte: `${year}-12-31` } },
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
  if (!(await attendanceRouteOk(req, res))) return;
  try {
    const me = await myEmployee(req.tenant!.accountId, req.tenant!.orgId, req.auth!.userId);
    return await createLeave(req, res, me);
  } catch (e) {
    return sendError(res, e);
  }
});

/** One's own request: a pending one any time, an approved one only before it starts. */
export async function cancelOwnLeave(accountId: string, orgId: string, employeeId: string, id: string): Promise<{ status: number; body: any }> {
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id, accountId, orgId, employeeId } });
  if (!r) return { status: 404, body: { error: 'No such request.' } };
  if (!OPEN.includes(r.status)) return { status: 409, body: { error: `This request was already ${r.status.toLowerCase()}.` } };
  if (r.status === 'APPROVED' && r.fromDate <= today()) return { status: 409, body: { error: 'This leave has started. Ask your manager to cancel it.' } };
  if (r.status === 'APPROVED') await clearLeaveDays(orgId, r.id);
  const updated = await peoplePrisma.leaveRequest.update({ where: { id: r.id }, data: { status: 'CANCELLED' } });
  return { status: 200, body: { request: (await withTypes(orgId, [updated]))[0] } };
}

leaveRouter.post('/orgs/:orgId/attendance/me/leave/:id/cancel', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const out = await cancelOwnLeave(accountId, orgId, me.id, String(req.params.id));
    res.status(out.status).json(out.body);
  } catch (e) {
    return sendError(res, e);
  }
});
