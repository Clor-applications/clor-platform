import { Router } from 'express';
import { ownWorkRefusal } from '../services/makerChecker.js';
import { activeManagerOf, chainFor, hrMayDecide } from '../services/attendance/approvalChain.js';
import { notifyUsers, usersWithPermission } from '../services/notifications.js';
import { resolveAccess } from '../services/access.js';
import { isFeatureEnabled } from '../services/features.js';
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
import { loadSchedule, resolveShift } from '../services/attendance/schedule.js';
import { authorize } from '../middleware/rbac.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { inScope, teamScope, type TeamScope } from '../services/people/scope.js';

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
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const dayWords = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)} ${d.slice(0, 4)}`;
/** "January 2026" for a whole month, "1 Jan 2026 to 31 Mar 2026" otherwise: dates as CLOR writes them. */
const spanWords = (from: string, to: string) =>
  from.slice(8) === '01' && from.slice(0, 7) === to.slice(0, 7) && addDays(to, 1).slice(8) === '01' ? `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}` : `${dayWords(from)} to ${dayWords(to)}`;

/** A period's first and last day, and its name. */
export const periodBounds = (p: LeavePeriod, year: number) => ({ year, from: periodStart(p, year), to: periodEnd(p, year), label: periodLabel(p, year) });

/** One date in a request: whether it is charged, and if not, why (the preview shows every one). */
export type PlannedDay = { date: string; counted: boolean; why: string | null };

/**
 * Every date from first to last: a weekly off on that day's shift (or the
 * company's working week) and a holiday for the person's branch and location
 * are skipped, with the reason. Under the sandwich rule the offs and holidays
 * between the first and last working day are charged too, and say so.
 * Loaded once for the range, not once a day.
 */
export async function dayPlan(orgId: string, employee: { id: string; branchId: string | null; areaId?: string | null }, from: string, to: string, sandwich: boolean): Promise<PlannedDay[]> {
  const [schedule, holidays] = await Promise.all([
    loadSchedule(orgId, [employee.id]),
    peoplePrisma.holiday.findMany({
      where: {
        orgId, date: { gte: from, lte: to }, isOptional: false,
        AND: [
          { OR: [{ branchId: null }, ...(employee.branchId ? [{ branchId: employee.branchId }] : [])] },
          { OR: [{ areaId: null }, ...(employee.areaId ? [{ areaId: employee.areaId }] : [])] },
        ],
      },
      select: { date: true, name: true },
    }),
  ]);
  const holidayOn = new Map(holidays.map((h) => [h.date, h.name]));
  const out: PlannedDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const name = holidayOn.get(d);
    if (name !== undefined) out.push({ date: d, counted: false, why: `Holiday: ${name}` });
    else if (isWeeklyOff(resolveShift(schedule, employee.id, d).rule, d)) out.push({ date: d, counted: false, why: 'Weekly off' });
    else out.push({ date: d, counted: true, why: null });
  }
  const working = out.filter((x) => x.counted);
  if (sandwich && working.length >= 2) {
    const first = working[0].date;
    const last = working[working.length - 1].date;
    for (const x of out) if (!x.counted && x.date > first && x.date < last) { x.counted = true; x.why = `${x.why}, counted (sandwich rule)`; }
  }
  return out;
}

/** The days in a range that are leave: not a weekly off on that day's shift, not a holiday. */
const workingDays = async (orgId: string, employee: { id: string; branchId: string | null; areaId?: string | null }, from: string, to: string) =>
  (await dayPlan(orgId, employee, from, to, false)).filter((x) => x.counted).map((x) => x.date);

/** The days a request takes: working days, and under the sandwich rule the offs between them. */
const leaveDays = async (orgId: string, employee: { id: string; branchId: string | null; areaId?: string | null }, from: string, to: string, sandwich: boolean) =>
  (await dayPlan(orgId, employee, from, to, sandwich)).filter((x) => x.counted).map((x) => x.date);

/*
 * Team scope (services/people/scope.ts), as every People read: a role
 * limited to its own team sees and decides that team's leave only; anyone
 * else reads as absent.
 */
const scopeRows = (scope: TeamScope) => (scope.all ? {} : { employeeId: { in: scope.ids } });
async function scopedOr404(req: any, employeeId: string) {
  if (!inScope(await teamScope(req), employeeId)) throw fail(404, 'No such employee.');
}
/** Company-wide leave set-up (imports, the leave period, the working week): a team role is refused. */
async function wholeCompany(req: any, res: any) {
  if ((await teamScope(req)).all) return true;
  res.status(403).json({ error: 'This is set up for the whole company; your role covers your own team.' });
  return false;
}

/**
 * Private leave (sick, medical, maternity): the reason, and the type itself,
 * are read only by those who decide leave for the whole company (and the
 * person). A team lead, the calendar and colleagues see "Private leave", so
 * cover can be planned without a diagnosis on show.
 */
export async function readsPrivateLeave(req: any) {
  if (req.isAdmin) return true;
  if (!(await teamScope(req)).all) return false;
  return !(await authorize(req, ATTENDANCE_MODULE, PermissionAction.APPROVE, R.leave)) || !(await authorize(req, ATTENDANCE_MODULE, PermissionAction.EDIT, R.leave));
}
export const PRIVATE_LABEL = 'Private leave';
/** Rows as this reader may see them: a private type's name and reason hidden unless they read private leave or it is their own. */
export const masked = (rows: any[], reads: boolean, ownEmployeeId: string | null = null) =>
  rows.map((r) => (!r.isPrivate || reads || (ownEmployeeId && r.employeeId === ownEmployeeId) ? r : { ...r, leaveTypeId: null, leaveTypeName: PRIVATE_LABEL, leaveTypeColor: null, reason: null, reviewNote: null, reasonHidden: true }));

export const withTypes = async (orgId: string, rows: any[]) => {
  const types = new Map(
    (await peoplePrisma.leaveType.findMany({ where: { orgId }, select: { id: true, name: true, isPaid: true, color: true, isPrivate: true } })).map((t) => [t.id, t])
  );
  return (await withNames(orgId, rows)).map((r) => ({
    ...r,
    leaveTypeName: types.get(r.leaveTypeId)?.name || '—',
    isPaid: types.get(r.leaveTypeId)?.isPaid ?? true,
    leaveTypeColor: types.get(r.leaveTypeId)?.color ?? null,
    isPrivate: types.get(r.leaveTypeId)?.isPrivate ?? false,
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
  isPrivate: z.boolean().optional(),
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
    await recordAudit(req, { entity: 'LeaveType', entityId: type.id, action: 'CREATE', message: `Leave type ${type.name}: ${type.isPaid ? `${type.annualDays} days a period, ${type.accrual.toLowerCase().replace('_', '-')}` : 'unpaid'}`, metadata: { ...parsed.data, ...policy.data } });
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
    return res.status(409).json({ error: 'Leave of this type has been approved, so whether it is paid cannot change. Make a new type instead.', code: 'LEAVE_POLICY_IN_USE' });
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
    const changed = Object.keys({ ...parsed.data, ...policy.data }).filter((k) => JSON.stringify((type as any)[k]) !== JSON.stringify((existing as any)[k]));
    if (changed.length) await recordAudit(req, { entity: 'LeaveType', entityId: type.id, action: 'UPDATE', message: `Leave type ${type.name} changed: ${changed.join(', ')}`, metadata: Object.fromEntries(changed.map((k) => [k, { before: (existing as any)[k], after: (type as any)[k] }])) });
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
  const scope = await teamScope(req);
  const people = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, status: { not: 'LEFT' }, ...(scope.all ? {} : { id: { in: scope.ids } }) },
    select: { id: true, name: true, code: true, department: true },
    orderBy: { name: 'asc' },
  });
  const { types, balances } = await balancesFor(accountId, orgId, people.map((p) => p.id), year);
  /* A private type (maternity, sick) is not shown at all to those who may not read private leave. */
  const reads = await readsPrivateLeave(req);
  res.json({
    year,
    types: types.filter((t) => t.isActive && (reads || !t.isPrivate)),
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
    const employee = await employeeIn(orgId, accountId, b.employeeId);
    await scopedOr404(req, employee.id);
    const type = await peoplePrisma.leaveType.findFirst({ where: { id: b.leaveTypeId, accountId, orgId } });
    if (!type) return res.status(400).json({ error: 'That leave type is not in this organisation.' });
    if (!type.isPaid) return res.status(400).json({ error: 'Unpaid leave has no balance to set.' });
    const key = { employeeId_leaveTypeId_year: { employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, year: b.year } };
    if (b.days === null) {
      await peoplePrisma.leaveAllocation.deleteMany({ where: { orgId, employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, year: b.year } });
      await recordAudit(req, { entity: 'LeaveAllocation', entityId: `${b.employeeId}:${b.leaveTypeId}:${b.year}`, action: 'DELETE', message: `${employee.name}: ${type.name} for ${b.year} back on the policy's days`, metadata: { employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, year: b.year } });
      return res.json({ allocation: null });
    }
    const allocation = await peoplePrisma.leaveAllocation.upsert({
      where: key,
      create: { accountId, orgId, employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, year: b.year, days: b.days, note: b.note || null, createdByUserId: req.auth!.userId },
      update: { days: b.days, note: b.note || null },
    });
    await recordAudit(req, { entity: 'LeaveAllocation', entityId: allocation.id, action: 'UPDATE', message: `${employee.name}: ${type.name} for ${b.year} set to ${b.days} days${b.note ? ` (${b.note})` : ''}`, metadata: { employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, year: b.year, days: b.days } });
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
  if (!(await wholeCompany(req, res))) return;
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
  if (!dryRun && imported) await recordAudit(req, { entity: 'LeaveAllocation', entityId: orgId, action: 'IMPORT', message: `Imported ${imported} opening ${imported === 1 ? 'balance' : 'balances'}`, metadata: { rows: rows.slice(0, 5000).map((r: any) => ({ employeeCode: r?.employeeCode ?? r?.code, leaveType: r?.leaveType, year: r?.year, days: r?.days })) } });
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
  if (!(await wholeCompany(req, res))) return;
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
        await approveLeave(accountId, orgId, row, req.auth!.userId, 'Imported', { chain: false });
      } catch (e: any) {
        /* Approval refused (a closed month, punches on the day): do not leave a stray pending request behind. */
        if (row) await peoplePrisma.leaveRequest.delete({ where: { id: row.id } }).catch(() => null);
        results.push({ row: i + 1, ok: false, error: String(e?.message || 'Not imported.') });
        continue;
      }
    }
    imported += 1;
  }
  if (!dryRun && imported) await recordAudit(req, { entity: 'LeaveRequest', entityId: orgId, action: 'IMPORT', message: `Imported ${imported} leave ${imported === 1 ? 'row' : 'rows'} already taken, approved as they came`, metadata: { rows: rows.slice(0, 2000).map((r: any) => ({ employeeCode: r?.employeeCode ?? r?.code, leaveType: r?.leaveType, from: r?.from, to: r?.to })) } });
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
  /** Required, at least three letters, except for a private type, where it is the person's choice. */
  reason: z.string().trim().max(500).optional().default(''),
  /** The first or second half of a single day. */
  halfDay: z.enum(['FIRST', 'SECOND']).nullable().optional(),
  /** Leave crossing the leave-period end is saved as one linked request per period. */
  split: z.boolean().optional(),
});

/** A request's parts: one, or one per leave period when it crosses a period end. */
function partsOf(period: LeavePeriod, from: string, to: string) {
  const parts: Array<{ year: number; from: string; to: string }> = [];
  for (let f = from; f <= to; ) {
    const year = periodOf(period, f);
    const end = periodEnd(period, year) < to ? periodEnd(period, year) : to;
    parts.push({ year, from: f, to: end });
    f = addDays(end, 1);
  }
  return parts;
}

type Asker = { id: string; branchId: string | null; areaId?: string | null; status?: string | null };
type Ask = { leaveTypeId: string; fromDate: string; toDate: string; halfDay?: 'FIRST' | 'SECOND' | null; reason?: string };

/**
 * Everything a request would do, without writing it (AUT-05): each date
 * charged or skipped and why, per leave period; the balance before and
 * after; the policy, overlap and balance problems, in the words the person
 * sees. Used by the preview and, again, by the save, so what the preview
 * says is what the save does.
 */
export async function planLeave(accountId: string, orgId: string, employee: Asker, b: Ask, onBehalf: boolean) {
  if (!ISO_DATE.test(b.fromDate) || !ISO_DATE.test(b.toDate)) return { error: 'Dates are YYYY-MM-DD.' } as const;
  if (b.toDate < b.fromDate) return { error: 'The last day is before the first.' } as const;
  if (addDays(b.fromDate, MAX_SPAN_DAYS - 1) < b.toDate) return { error: `One request covers at most ${MAX_SPAN_DAYS} days.` } as const;
  if (employee.status === 'LEFT') return { error: 'This person has left.' } as const;
  const type = await peoplePrisma.leaveType.findFirst({ where: { id: b.leaveTypeId, accountId, orgId, isActive: true } });
  if (!type) return { error: 'That leave type is not available.' } as const;
  if (b.halfDay && b.fromDate !== b.toDate) return { error: 'A half-day leave is for one day.' } as const;
  const period = await leavePeriodOf(orgId);
  const plan = await dayPlan(orgId, employee, b.fromDate, b.toDate, type.sandwich);
  const t0 = today();
  const parts = [];
  for (const part of partsOf(period, b.fromDate, b.toDate)) {
    const dates = plan.filter((d) => d.date >= part.from && d.date <= part.to);
    const counted = dates.filter((d) => d.counted).length;
    const days = b.halfDay ? (counted ? 0.5 : 0) : counted;
    let balance: { before: number | null; after: number | null; negativeDays: number } = { before: null, after: null, negativeDays: type.negativeDays };
    if (type.isPaid && days) {
      const { balances } = await balancesFor(accountId, orgId, [employee.id], part.year, part.from > t0 ? part.from : undefined);
      const before = balances.get(employee.id)!.get(type.id)!.available ?? null;
      balance = { before, after: before == null ? null : round(before - days), negativeDays: type.negativeDays };
    }
    parts.push({ ...part, label: periodLabel(period, part.year), days, dates, balance });
  }
  const total = round(parts.reduce((a, p) => a + p.days, 0));
  const person = await peoplePrisma.employee.findFirst({ where: { id: employee.id, orgId }, select: { gender: true, employeeTypeId: true, dateOfJoining: true } });
  const clash = await peoplePrisma.leaveRequest.findFirst({ where: { orgId, employeeId: employee.id, status: { in: OPEN }, fromDate: { lte: b.toDate }, toDate: { gte: b.fromDate } } });
  const reasonText = String(b.reason || '').trim();
  const problems: Array<{ code: string; message: string }> = [];
  if (!total) problems.push({ code: 'NO_WORKING_DAYS', message: 'Those are all weekly offs or holidays — there is nothing to take leave from.' });
  const policy = total ? policyProblem(type, person, { fromDate: b.fromDate, halfDay: b.halfDay ?? null, days: total }, t0, onBehalf) : null;
  if (policy) problems.push({ code: 'LEAVE_POLICY', message: policy });
  if (clash) problems.push({ code: 'OVERLAP', message: `This overlaps leave already asked for (${clash.fromDate} to ${clash.toDate}).` });
  for (const p of parts) {
    if (p.balance.after != null && p.balance.after < -type.negativeDays) {
      const extra = type.negativeDays ? ` (and ${type.negativeDays} in advance)` : '';
      problems.push({ code: 'NO_BALANCE', message: `Only ${p.balance.before} ${p.balance.before === 1 ? 'day' : 'days'} of ${type.name} ${p.balance.before === 1 ? 'is' : 'are'} left${parts.length > 1 ? ` in ${p.label}` : ' this year'}${extra}; this is ${p.days}.` });
    }
  }
  if (!type.isPrivate && reasonText.length < 3) problems.push({ code: 'REASON', message: 'Say why.' });
  return { type, parts, total, problems, clash, split: parts.length > 1, reason: reasonText } as const;
}

/** `by` is who asks: the signed-in user, or — from the employee portal — the employee themselves. */
export async function createLeave(
  req: any,
  res: any,
  employee: Asker,
  by?: { accountId: string; orgId: string; userId: string },
  /** HR entering leave for someone is not held to notice or how far back. */
  opts: { onBehalf?: boolean } = {}
) {
  const { accountId, orgId } = by || req.tenant!;
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request.' });
  const b = parsed.data;
  const first = await planLeave(accountId, orgId, employee, b, Boolean(opts.onBehalf));
  if ('error' in first) return res.status(400).json({ error: first.error });
  if (first.split && !b.split) {
    const end = first.parts[0].to;
    return res.status(400).json({ error: `Leave stays inside one leave period (${first.parts[0].label}). Split it at ${end}.`, code: 'CROSSES_PERIOD', splitAt: end });
  }
  /* Reason, policy and "nothing to take" are the person's to fix; overlap and balance are checked again under the lock. */
  const early = first.problems.find((p) => ['REASON', 'NO_WORKING_DAYS', 'LEAVE_POLICY'].includes(p.code));
  if (early) return res.status(400).json({ error: early.message, code: early.code === 'REASON' ? undefined : early.code });

  /*
   * Check and insert under one lock per employee. As separate steps, a double
   * tap in the portal passed the overlap and balance checks twice and saved two
   * overlapping requests, overdrawing the balance. The second request now waits
   * here, then sees the first one and is refused.
   */
  const outcome = await peopleWrite(orgId, async (): Promise<{ status: number; body: Record<string, unknown> } | { rows: any[] }> => {
    const tx = peoplePrisma;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave:${employee.id}`}))`;
    const plan = await planLeave(accountId, orgId, employee, b, Boolean(opts.onBehalf));
    if ('error' in plan) return { status: 400, body: { error: plan.error } };
    const overlap = plan.problems.find((p) => p.code === 'OVERLAP');
    if (overlap) return { status: 409, body: { error: overlap.message } };
    const short = plan.problems.find((p) => p.code === 'NO_BALANCE');
    if (short) return { status: 400, body: { error: short.message, code: 'NO_BALANCE' } };
    const groupId = plan.split ? `lg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` : null;
    const rows = [];
    for (const part of plan.parts.filter((p) => p.days > 0)) {
      rows.push(await tx.leaveRequest.create({
        data: { accountId, orgId, employeeId: employee.id, leaveTypeId: plan.type.id, fromDate: part.from, toDate: part.to, days: part.days, halfDay: b.halfDay ?? null, reason: plan.reason, groupId, requestedByUserId: by?.userId || req.auth!.userId },
      }));
    }
    return { rows };
  });
  if (!('rows' in outcome)) return res.status(outcome.status).json(outcome.body);
  const shaped: any[] = [];
  for (const row of outcome.rows) shaped.push(await announce(orgId, row));
  res.status(201).json({ request: shaped[0], ...(shaped.length > 1 ? { requests: shaped } : {}) });
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

const STATUSES_ = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

/**
 * Leave requests. With `limit` (People's list): one page, searched and
 * filtered on the server, with the total and a count per status for the tabs.
 * Without it (Attendance's screen, the calendar), the old shape, still capped.
 * Always inside the caller's team scope, private leave masked.
 */
leaveRouter.get(`${base}/requests`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const scope = await teamScope(req);
  const status = String(req.query.status || '').trim();
  const employeeId = String(req.query.employeeId || '').trim();
  /* ?month=YYYY-MM: requests touching that month (the leave calendar). */
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : '';
  const inMonth = month ? { fromDate: { lte: `${month}-31` }, toDate: { gte: `${month}-01` } } : {};
  /* ?from&to: requests touching the range (the overview's week). */
  const from = ISO_DATE.test(String(req.query.from || '')) ? String(req.query.from) : '';
  const to = ISO_DATE.test(String(req.query.to || '')) ? String(req.query.to) : '';
  const inRange = from && to ? { fromDate: { lte: to }, toDate: { gte: from } } : {};
  /* ?year=: applications starting in that leave period (the register of applications). */
  const yearQ = Number(req.query.year);
  const period = Number.isInteger(yearQ) && yearQ >= 2000 && yearQ <= 2100 ? await leavePeriodOf(orgId) : null;
  const inYear = period ? { fromDate: { gte: periodStart(period, yearQ), lte: periodEnd(period, yearQ) } } : {};
  let leaveTypeId = String(req.query.leaveTypeId || '').trim();
  /* Filtering by a private type would name who took it: for a non-reader it finds nothing. */
  if (leaveTypeId && !(await readsPrivateLeave(req)) && (await peoplePrisma.leaveType.findFirst({ where: { id: leaveTypeId, orgId }, select: { isPrivate: true } }))?.isPrivate) leaveTypeId = '__none__';
  /* Search and department narrow the people first, then the requests: name, employee ID. */
  const q = String(req.query.q || '').trim().slice(0, 80);
  const departmentId = String(req.query.departmentId || '').trim();
  let people: string[] | null = scope.all ? null : scope.ids;
  if (q || departmentId) {
    const found = await peoplePrisma.employee.findMany({
      where: { orgId, ...(people ? { id: { in: people } } : {}), ...(departmentId ? { departmentId } : {}), ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] } : {}) },
      select: { id: true },
      take: 5000,
    });
    people = found.map((f) => f.id);
  }
  const base_ = { accountId, orgId, ...(employeeId ? { employeeId } : {}), ...(people ? { employeeId: employeeId ? (people.includes(employeeId) ? employeeId : '__none__') : { in: people } } : {}), ...(leaveTypeId ? { leaveTypeId } : {}), ...inMonth, ...inRange, ...inYear };
  const where = { ...base_, ...(status ? { status } : {}) };
  const reads = await readsPrivateLeave(req);
  const limitQ = Number(req.query.limit);
  if (Number.isInteger(limitQ) && limitQ > 0) {
    const limit = Math.min(100, limitQ);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    /* Waiting: oldest first, so what has waited longest is on top; the rest newest first. */
    const orderBy: any = status === 'PENDING' ? [{ createdAt: 'asc' }] : [{ fromDate: 'desc' }, { createdAt: 'desc' }];
    const [rows, total, grouped] = await Promise.all([
      peoplePrisma.leaveRequest.findMany({ where, orderBy, take: limit, skip: offset }),
      peoplePrisma.leaveRequest.count({ where }),
      peoplePrisma.leaveRequest.groupBy({ by: ['status'], where: base_, _count: { _all: true } }),
    ]);
    const counts: Record<string, number> = Object.fromEntries(STATUSES_.map((k) => [k, 0]));
    for (const g of grouped) counts[g.status] = g._count._all;
    counts.all = Object.values(counts).reduce((a, n) => a + n, 0);
    return res.json({ requests: masked(await withTypes(orgId, rows), reads), total, counts, limit, offset });
  }
  const rows = await peoplePrisma.leaveRequest.findMany({
    where,
    orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
    take: period ? 5000 : 500,
  });
  res.json({ requests: masked(await withTypes(orgId, rows), reads) });
});

leaveRouter.post(`${base}/requests`, can(PermissionAction.CREATE, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  try {
    const employee = await employeeIn(req.tenant!.orgId, req.tenant!.accountId, String(req.body?.employeeId || ''));
    await scopedOr404(req, employee.id);
    await createLeave(req, res, employee, undefined, { onBehalf: true });
    if (res.statusCode === 201) await recordAudit(req, { entity: 'LeaveRequest', entityId: employee.id, action: 'CREATE', message: `Entered leave for ${employee.name}, ${req.body?.fromDate} to ${req.body?.toDate}`, metadata: { employeeId: employee.id, leaveTypeId: req.body?.leaveTypeId, fromDate: req.body?.fromDate, toDate: req.body?.toDate } });
    return;
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * Approve a pending request: count its working days again, check nothing was
 * worked on them, the balance, and that no month is closed, then write the
 * days. Throws `fail` errors (sendError or the public API answer them).
 */
/** `chain: false`: leave already taken, imported from a list, is not waiting on anybody's step. */
export async function approveLeave(accountId: string, orgId: string, r: any, userId: string, note: string | null, opts: { chain?: boolean } = {}) {
  return peopleWrite(orgId, async () => {
    const current = await peoplePrisma.leaveRequest.findFirst({ where: { id: r.id, accountId, orgId } });
    if (!current || current.status !== 'PENDING') throw fail(409, 'This request is no longer pending.');
    r = current;
    if (opts.chain !== false) {
      const turn = await hrMayDecide(orgId, 'leave', r);
      if (!turn.ok) throw fail(409, turn.error, 'MANAGER_FIRST');
    }
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
        /* A private type's name and reason stay off the day record, which attendance staff read. */
        note: type.isPrivate ? `${PRIVATE_LABEL}, ${r.halfDay === 'FIRST' ? 'first' : 'second'} half` : `${type.name}, ${r.halfDay === 'FIRST' ? 'first' : 'second'} half: ${r.reason}`.slice(0, 500),
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
          note: type.isPrivate ? PRIVATE_LABEL : `${type.name}: ${r.reason}`.slice(0, 500),
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

/**
 * A decision on a request, and on every other waiting part of the same leave
 * split at the period end, in one transaction: what the person asked for was
 * one leave, so it is approved or refused as one.
 */
export async function decideLeave(accountId: string, orgId: string, r: any, userId: string, note: string | null, approve: boolean) {
  return peopleWrite(orgId, async () => {
    const parts = r.groupId ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: r.groupId, status: 'PENDING', id: { not: r.id } }, orderBy: { fromDate: 'asc' } }) : [];
    const first = approve ? await approveLeave(accountId, orgId, r, userId, note) : await rejectLeave(orgId, r, userId, note);
    for (const x of parts) {
      if (approve) await approveLeave(accountId, orgId, x, userId, note);
      else await rejectLeave(orgId, x, userId, note);
    }
    return first;
  });
}

/**
 * The manager's step under "manager, then HR": recorded on the request (and
 * its other parts), which stays waiting for HR. From the employee app or,
 * for a manager with a CLOR sign-in, from People.
 */
export async function managerStep(orgId: string, r: any, managerId: string, note: string | null) {
  return peopleWrite(orgId, async () => {
    const ids = r.groupId ? (await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: r.groupId, status: 'PENDING' }, select: { id: true } })).map((x) => x.id) : [r.id];
    const changed = await peoplePrisma.leaveRequest.updateMany({ where: { id: { in: ids }, orgId, status: 'PENDING', managerApprovedAt: null }, data: { managerApprovedAt: new Date(), managerApprovedById: managerId, managerNote: note } });
    if (!changed.count) throw fail(409, 'This request is no longer waiting for the manager.');
    const row = await peoplePrisma.leaveRequest.findFirstOrThrow({ where: { id: r.id } });
    return announce(orgId, row);
  });
}

/** The request with names, sent to webhooks as the event its status is, and to the people it concerns. */
async function announce(orgId: string, row: any) {
  const shaped = (await withTypes(orgId, [row]))[0];
  const event = leaveEventFor(row.status);
  if (event) afterPeopleCommit(() => emitWebhook(orgId, event, leaveEvent(shaped)));
  afterPeopleCommit(() => tellAboutLeave(orgId, shaped).catch((e) => console.error('[leave] notice not sent:', e instanceof Error ? e.message : e)));
  return shaped;
}

/**
 * Who may act on a waiting request now: those who approve leave, narrowed to
 * whoever's scope holds the person (a team lead hears only of their team).
 */
async function approversOf(accountId: string, orgId: string, employeeId: string) {
  const users = await usersWithPermission(accountId, orgId, 'ATTENDANCE::Leave Requests::APPROVE');
  const out: string[] = [];
  for (const userId of users) {
    const access = await resolveAccess(accountId, orgId, userId);
    if (!access.ownDocumentsOnly || inScope(await teamScope({ ownDocumentsOnly: true, tenant: { orgId }, auth: { userId } } as any), employeeId)) out.push(userId);
  }
  return out;
}

/**
 * One notice per leave, never per part of a leave split at the period end
 * (the first part speaks for the whole span): a new request goes to whoever
 * acts on it next (the manager when the company asks the manager first, else
 * those who approve leave for that person); the manager's step tells HR; a
 * decision or a cancellation goes to the person unless they made it, and a
 * cancelled approved leave tells whoever approved it. Private leave says
 * "leave", not its type, outside the person's own notice.
 */
async function tellAboutLeave(orgId: string, r: any) {
  let from = r.fromDate;
  let to = r.toDate;
  let days = r.days;
  if (r.groupId) {
    const group = await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: r.groupId }, orderBy: { fromDate: 'asc' }, select: { id: true, fromDate: true, toDate: true, days: true, status: true } });
    if (group[0] && group[0].id !== r.id) return;
    const same = group.filter((x) => x.status === r.status);
    from = same[0]?.fromDate || from;
    to = same[same.length - 1]?.toDate || to;
    days = round(same.reduce((a, x) => a + x.days, 0));
  }
  const emp = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { accountId: true, name: true, code: true, userId: true } });
  if (!emp) return;
  const when = from === to ? dayWords(from) : `${dayWords(from)} to ${dayWords(to)}`;
  const what = r.isPrivate ? 'leave' : r.leaveTypeName;
  const who = `${emp.name}${emp.code ? ` (${emp.code})` : ''}`;
  const app = (await isFeatureEnabled(emp.accountId, orgId, 'people')) ? 'people' : 'attendance';
  const link = { app, screen: 'leaveRequests', params: { id: r.id } };
  const byPerson = (u: string | null | undefined) => Boolean(u) && (u === emp.userId || u === `portal:${r.employeeId}`);
  if (r.status === 'PENDING') {
    const chain = await chainFor(orgId, 'leave');
    const manager = chain !== 'HR' && !r.managerApprovedAt ? await activeManagerOf(orgId, r.employeeId) : null;
    if (manager) {
      /* The manager acts first: in People with a sign-in, else in the employee app's queue (no notice there). */
      const managerUser = (await peoplePrisma.employee.findFirst({ where: { id: manager.id, orgId }, select: { userId: true } }))?.userId;
      if (managerUser) await notifyUsers(emp.accountId, orgId, [managerUser], { kind: 'attendance.leave_asked', title: `${who} asks for ${what}, ${when}`, body: `${days} ${days === 1 ? 'day' : 'days'}`, link }, { except: r.requestedByUserId });
      return;
    }
    const title = r.managerApprovedAt ? `${who}'s ${what}, ${when}, is approved by the manager and waits for you` : `${who} asks for ${what}, ${when}`;
    await notifyUsers(emp.accountId, orgId, await approversOf(emp.accountId, orgId, r.employeeId), { kind: 'attendance.leave_asked', title, body: `${days} ${days === 1 ? 'day' : 'days'}`, link }, { except: r.requestedByUserId });
    return;
  }
  if (!['APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status)) return;
  const word = ({ APPROVED: 'approved', REJECTED: 'not approved', CANCELLED: 'cancelled' } as Record<string, string>)[r.status];
  if (emp.userId && !byPerson(r.reviewedByUserId)) {
    await notifyUsers(emp.accountId, orgId, [emp.userId], { kind: 'attendance.leave_decided', title: `Your ${r.leaveTypeName}, ${when}, is ${word}`, body: r.reviewNote || null, link: { app, screen: 'myLeave' } }, { except: r.reviewedByUserId });
  }
  /* The person took back leave that was approved: whoever approved it plans around it. */
  if (r.status === 'CANCELLED' && byPerson(r.reviewedByUserId)) {
    const approval = await platformPrisma.auditLog.findFirst({ where: { orgId, entity: 'LeaveRequest', entityId: r.id, action: 'APPROVE' }, orderBy: { createdAt: 'desc' }, select: { createdByUserId: true } });
    if (approval?.createdByUserId) await notifyUsers(emp.accountId, orgId, [approval.createdByUserId], { kind: 'attendance.leave_decided', title: `${who} cancelled ${what}, ${when}`, link }, { except: emp.userId });
  }
}

/**
 * Requests waiting on this reader, not on someone before them: inside their
 * scope, not their own, and not still with the person's manager when the
 * company asks the manager first. One definition for the overview and Home.
 */
export async function waitingForReader(orgId: string, scope: TeamScope, userId: string) {
  const rows = await peoplePrisma.leaveRequest.findMany({ where: { orgId, status: 'PENDING', ...scopeRows(scope) }, orderBy: { createdAt: 'asc' }, take: 2000 });
  if (!rows.length) return rows;
  const chain = await chainFor(orgId, 'leave');
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, userId: true, reportingManagerId: true } });
  const of = new Map(people.map((p) => [p.id, p]));
  const managerIds = [...new Set(people.map((p) => p.reportingManagerId).filter(Boolean) as string[])];
  const managers = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: managerIds } }, select: { id: true, status: true, userId: true } })).map((m) => [m.id, m]));
  return rows.filter((r) => {
    const p = of.get(r.employeeId);
    if (p?.userId && p.userId === userId) return false;
    const m = p?.reportingManagerId ? managers.get(p.reportingManagerId) : null;
    const activeManager = m && m.status !== 'LEFT' && m.status !== 'SUSPENDED' ? m : null;
    /* The manager's own queue: still theirs while their step is open. */
    if (chain === 'MANAGER_THEN_HR' && !r.managerApprovedAt && activeManager) return activeManager.userId === userId;
    return true;
  });
}

/** An audit row for leave actions that have no CLOR request behind them (the employee app, imports). */
export async function leaveAudit(who: { accountId: string; orgId: string; userId: string }, entry: { entityId: string; action: string; message: string; metadata?: Record<string, unknown> }) {
  try {
    await platformPrisma.auditLog.create({ data: { accountId: who.accountId, orgId: who.orgId, branchId: '', entity: 'LeaveRequest', entityId: entry.entityId, action: entry.action, message: entry.message.slice(0, 500), metadata: entry.metadata ? JSON.stringify(entry.metadata).slice(0, 20_000) : null, createdByUserId: who.userId, correlationId: null } });
  } catch (e) {
    console.error('[leave] audit not recorded:', e instanceof Error ? e.message : e);
  }
}

const noteOf = (req: any) => String(req.body?.note || '').trim().slice(0, 500) || null;

leaveRouter.post(`${base}/requests/:id/approve`, can(PermissionAction.APPROVE, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r || !inScope(await teamScope(req), r.employeeId)) return res.status(404).json({ error: 'No such request.' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: `This request was already ${r.status.toLowerCase()}.` });
  const scope = await teamScope(req);
  if ((await chainFor(orgId, 'leave')) === 'MANAGER_THEN_HR') {
    const manager = await activeManagerOf(orgId, r.employeeId);
    const managerUser = manager ? (await peoplePrisma.employee.findFirst({ where: { id: manager.id, orgId }, select: { userId: true } }))?.userId : null;
    /* The manager's own step, taken in People: recorded, and the request goes on to HR. */
    if (!r.managerApprovedAt && managerUser && managerUser === req.auth!.userId) {
      try {
        const request = await managerStep(orgId, r, manager!.id, noteOf(req));
        await recordAudit(req, { entity: 'LeaveRequest', entityId: r.id, action: 'MANAGER_APPROVE', message: `Manager approved ${request.employeeName}'s leave, ${r.fromDate} to ${r.toDate}; now with HR`, metadata: { employeeId: r.employeeId } });
        return res.json({ request: masked([request], await readsPrivateLeave(req))[0], stage: 'HR' });
      } catch (e) {
        return sendError(res, e);
      }
    }
    /* HR's step is a second pair of eyes: not the manager who took the first, and someone who decides for the whole company. */
    if (r.managerApprovedAt) {
      const firstBy = r.managerApprovedById ? (await peoplePrisma.employee.findFirst({ where: { id: r.managerApprovedById, orgId }, select: { userId: true } }))?.userId : null;
      if ((firstBy && firstBy === req.auth!.userId) || !scope.all) return res.status(403).json({ error: 'HR approves after the manager; the manager cannot take both steps.', code: 'HR_STEP' });
    }
  }
  const turn = await hrMayDecide(orgId, 'leave', r);
  if (!turn.ok) return res.status(409).json({ error: turn.error, code: 'MANAGER_FIRST' });
  /* A-13: your own leave is approved by somebody else, as the company's maker-checker setting decides (a one-person company still can). */
  const own = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { userId: true } });
  const refused = await ownWorkRefusal(req, { makers: [own?.userId], module: ATTENDANCE_MODULE, resource: R.leave, entity: 'ATTENDANCE_LEAVE_REQUEST', entityId: r.id, what: 'leave request' });
  if (refused) return res.status(refused.status).json(refused.body);
  try {
    const request = await decideLeave(accountId, orgId, r, req.auth!.userId, noteOf(req), true);
    await recordAudit(req, { entity: 'LeaveRequest', entityId: r.id, action: 'APPROVE', message: `Approved ${request.employeeName}'s ${request.leaveTypeName}, ${r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`} (${request.days} days)`, metadata: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, days: request.days } });
    res.json({ request: masked([request], await readsPrivateLeave(req))[0] });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.post(`${base}/requests/:id/reject`, can(PermissionAction.APPROVE, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r || !inScope(await teamScope(req), r.employeeId)) return res.status(404).json({ error: 'No such request.' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: `This request was already ${r.status.toLowerCase()}.` });
  try {
    const request = await decideLeave(accountId, orgId, r, req.auth!.userId, noteOf(req), false);
    await recordAudit(req, { entity: 'LeaveRequest', entityId: r.id, action: 'REJECT', message: `Rejected ${request.employeeName}'s ${request.leaveTypeName}, ${r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`}${noteOf(req) ? `: ${noteOf(req)}` : ''}`, metadata: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId } });
    res.json({ request: masked([request], await readsPrivateLeave(req))[0] });
  } catch (e) {
    return sendError(res, e);
  }
});

export async function cancelLeaveRequest(accountId: string, orgId: string, id: string, userId: string) {
  return peopleWrite(orgId, async () => {
    const r = await peoplePrisma.leaveRequest.findFirst({ where: { id, accountId, orgId } });
    if (!r || !OPEN.includes(r.status)) throw fail(409, 'This request is no longer open.');
    /* Parts of one leave across a period end are cancelled together: what the person asked for was one leave. */
    const parts = r.groupId ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: r.groupId, status: { in: OPEN }, id: { not: r.id } } }) : [];
    let first = null;
    for (const x of [r, ...parts]) {
      const updated = await peoplePrisma.leaveRequest.update({ where: { id: x.id }, data: { status: 'CANCELLED', reviewedByUserId: userId, reviewedAt: new Date() } });
      if (x.status === 'APPROVED') await clearLeaveDays(orgId, x.id);
      const shaped = await announce(orgId, updated);
      first = first || shaped;
    }
    return first;
  });
}

leaveRouter.post(`${base}/requests/:id/cancel`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { employeeId: true, fromDate: true, toDate: true } });
    if (!r || !inScope(await teamScope(req), r.employeeId)) return res.status(404).json({ error: 'No such request.' });
    const request = await cancelLeaveRequest(accountId, orgId, String(req.params.id), req.auth!.userId);
    await recordAudit(req, { entity: 'LeaveRequest', entityId: String(req.params.id), action: 'CANCEL', message: `Cancelled ${request.employeeName}'s ${request.leaveTypeName}, ${r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`}`, metadata: { employeeId: r.employeeId } });
    res.json({ request: masked([request], await readsPrivateLeave(req))[0] });
  } catch (e) { return sendError(res, e); }
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
    where: { accountId, orgId, year: await yearParam(orgId, req.query.year), ...(employeeId ? { employeeId } : {}), ...scopeRows(await teamScope(req)) },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  /* A private type's adjustments are not shown to those who may not read private leave. */
  const reads = await readsPrivateLeave(req);
  res.json({ adjustments: (await withTypes(orgId, rows)).filter((a: any) => reads || !a.isPrivate) });
});

leaveRouter.post(`${base}/adjustments`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = adjustmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the adjustment.' });
  const b = parsed.data;
  try {
    const employee = await employeeIn(orgId, accountId, b.employeeId);
    await scopedOr404(req, employee.id);
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
    if (!row || !inScope(await teamScope(req), row.employeeId)) throw fail(404, 'No such adjustment.');
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
    await scopedOr404(req, employee.id);
    const year = await yearParam(orgId, req.query.year);
    const { types, balances, period } = await balancesFor(accountId, orgId, [employee.id], year);
    const bounds = periodBounds(period, year);
    const t0 = today();
    const [requests, adjustments] = await Promise.all([
      peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId: employee.id, status: { in: OPEN }, fromDate: { gte: bounds.from, lte: bounds.to } }, orderBy: { fromDate: 'asc' } }),
      peoplePrisma.leaveAdjustment.findMany({ where: { orgId, employeeId: employee.id, year }, orderBy: { createdAt: 'asc' } }),
    ]);
    const mine = balances.get(employee.id)!;
    const own = Boolean(req.auth?.userId) && (await peoplePrisma.employee.findFirst({ where: { id: employee.id, orgId }, select: { userId: true } }))?.userId === req.auth!.userId;
    const reads = own || (await readsPrivateLeave(req));
    const out = types
      .filter((t) => reads || !t.isPrivate)
      .filter((t) => t.isActive || requests.some((r) => r.leaveTypeId === t.id) || adjustments.some((a) => a.leaveTypeId === t.id))
      .map((t) => {
        const bal = mine.get(t.id)!;
        const entries: Array<{ date: string; kind: string; days: number; note: string; id?: string }> = [];
        if (t.isPaid) {
          if (bal.carriedIn) entries.push({ date: bounds.from, kind: 'CARRIED', days: bal.carriedIn, note: `Carried from ${periodLabel(period, year - 1)}` });
          if (bal.allocationId) entries.push({ date: bounds.from, kind: 'ALLOCATED', days: round((bal.allocated ?? 0) - (bal.adjusted ?? 0)), note: 'Set for this person this period' });
          /* Each credit on its own date, as the policy lands it; those still to come are shown, not counted. */
          else for (const c of bal.credits || []) {
            entries.push({ date: c.date, kind: c.date <= t0 ? 'CREDIT' : 'UPCOMING', days: c.days, note: c.from === bounds.from && c.to === bounds.to ? 'This period’s days' : `For ${spanWords(c.from, c.to)}` });
          }
          for (const a of adjustments.filter((x) => x.leaveTypeId === t.id)) {
            entries.push({ id: a.id, date: a.createdAt.toISOString().slice(0, 10), kind: a.kind, days: a.days, note: a.reason });
          }
        }
        for (const r of requests.filter((x) => x.leaveTypeId === t.id)) {
          entries.push({ id: r.id, date: r.fromDate, kind: r.status === 'APPROVED' ? 'TAKEN' : 'PENDING', days: -r.days, note: r.fromDate === r.toDate ? dayWords(r.fromDate) : `${dayWords(r.fromDate)} to ${dayWords(r.toDate)}` });
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
  if (!(await wholeCompany(req, res))) return;
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
  const scope = await teamScope(req);
  const people = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, ...(scope.all ? {} : { id: { in: scope.ids } }), OR: [{ dateOfLeaving: null }, { dateOfLeaving: { gte: bounds.from } }], AND: [{ OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: bounds.to } }] }] },
    select: { id: true, name: true, code: true, department: true, status: true },
    orderBy: { name: 'asc' },
  });
  const ids = people.map((p) => p.id);
  const [{ types, balances }, adjustments] = await Promise.all([
    balancesFor(accountId, orgId, ids, year),
    peoplePrisma.leaveAdjustment.findMany({ where: { orgId, year, employeeId: { in: ids } }, select: { employeeId: true, leaveTypeId: true, days: true, kind: true } }),
  ]);
  const ended = today() > bounds.to;
  const reads = await readsPrivateLeave(req);
  const shown = types.filter((t) => (reads || !t.isPrivate) && (!typeId || t.id === typeId) && (t.isActive || [...balances.values()].some((m) => (m.get(t.id)?.used || 0) > 0)));
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
// Time & Leave (People): preview, one request's story, the overview, a
// policy tried on real people, the working week
// ---------------------------------------------------------------------------

/** Who else is away (or waiting to be) on these dates, inside the reader's scope; private leave masked. */
async function alsoAway(req: any, orgId: string, employeeId: string, from: string, to: string, reads: boolean) {
  const scope = await teamScope(req);
  const rows = await peoplePrisma.leaveRequest.findMany({
    where: { orgId, status: { in: OPEN }, employeeId: { not: employeeId, ...(scope.all ? {} : { in: scope.ids }) }, fromDate: { lte: to }, toDate: { gte: from } },
    orderBy: { fromDate: 'asc' },
    take: 50,
  });
  return masked(await withTypes(orgId, rows), reads).map((r: any) => ({ id: r.id, employeeId: r.employeeId, employeeName: r.employeeName, department: r.department, leaveTypeName: r.leaveTypeName, leaveTypeColor: r.leaveTypeColor, fromDate: r.fromDate, toDate: r.toDate, status: r.status }));
}

/**
 * A preview as the screens show it: the plan and its problems; for HR and
 * managers (`req`), who else is away. Someone asking for themselves sees
 * their own days only, never colleagues'.
 */
export async function previewOut(req: any | null, accountId: string, orgId: string, employee: Asker & { name?: string; departmentId?: string | null }, body: any, onBehalf: boolean) {
  const parsed = requestSchema.safeParse(body || {});
  if (!parsed.success) return { status: 400, body: { error: parsed.error.issues[0]?.message || 'Check the request.' } };
  const plan = await planLeave(accountId, orgId, employee, parsed.data, onBehalf);
  if ('error' in plan) return { status: 200, body: { ok: false, problems: [{ code: 'INPUT', message: plan.error }], parts: [], total: 0 } };
  /* The reason is the asker's to give; the preview does not hold a draft to it. */
  const own = { ok: !plan.problems.some((p) => p.code !== 'REASON'), type: { id: plan.type.id, name: plan.type.name, isPaid: plan.type.isPaid, isPrivate: plan.type.isPrivate, allowHalfDay: plan.type.allowHalfDay, sandwich: plan.type.sandwich, negativeDays: plan.type.negativeDays }, total: plan.total, split: plan.split, parts: plan.parts.map((p) => ({ year: p.year, label: p.label, from: p.from, to: p.to, days: p.days, balance: p.balance, dates: p.dates })), problems: plan.problems.filter((p) => p.code !== 'REASON'), reasonNeeded: !plan.type.isPrivate };
  if (!req) return { status: 200, body: own };
  const reads = await readsPrivateLeave(req);
  const away = await alsoAway(req, orgId, employee.id, parsed.data.fromDate, parsed.data.toDate, reads);
  const dept = (employee as any).departmentId ?? (await peoplePrisma.employee.findFirst({ where: { id: employee.id, orgId }, select: { departmentId: true } }))?.departmentId ?? null;
  const deptPeople = dept ? new Set((await peoplePrisma.employee.findMany({ where: { orgId, departmentId: dept, status: { not: 'LEFT' } }, select: { id: true } })).map((x) => x.id)) : null;
  return {
    status: 200,
    body: { ...own, alsoAway: away.slice(0, 20), alsoAwayCount: away.length, sameDepartment: deptPeople ? away.filter((a) => deptPeople.has(a.employeeId)).length : null },
  };
}

leaveRouter.post(`${base}/requests/preview`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const employee = await employeeIn(orgId, accountId, String(req.body?.employeeId || ''));
    await scopedOr404(req, employee.id);
    const out = await previewOut(req, accountId, orgId, employee, req.body, true);
    res.status(out.status).json(out.body);
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.post('/orgs/:orgId/attendance/me/leave/preview', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const out = await previewOut(null, accountId, orgId, me, req.body, false);
    res.status(out.status).json(out.body);
  } catch (e) {
    return sendError(res, e);
  }
});

/** Names for the user ids a request carries: CLOR users, the employee app's `portal:<employee>`, the API, CLOR itself. */
async function actorNames(orgId: string, ids: Array<string | null | undefined>) {
  const list = [...new Set(ids.filter(Boolean) as string[])];
  const users = list.filter((x) => !x.includes(':') && x !== 'system');
  const portal = list.filter((x) => x.startsWith('portal:')).map((x) => x.slice(7));
  const [u, e] = await Promise.all([
    users.length ? platformPrisma.user.findMany({ where: { id: { in: users } }, select: { id: true, fullName: true } }) : [],
    portal.length ? peoplePrisma.employee.findMany({ where: { orgId, id: { in: portal } }, select: { id: true, name: true } }) : [],
  ]);
  const out = new Map<string, string>();
  for (const x of u) out.set(x.id, x.fullName);
  for (const x of e) out.set(`portal:${x.id}`, x.name);
  for (const x of list) if (!out.has(x)) out.set(x, x === 'system' ? 'CLOR' : x.startsWith('api:') ? 'An outside system (API)' : 'Someone');
  return out;
}

/**
 * One request's story (TL-045): who asked, for whom, the manager's step, the
 * decision and its note, a cancellation; the days charged and skipped; the
 * balance with and without it; who else is away; the other parts of a leave
 * split at the period end.
 */
leaveRouter.get(`${base}/requests/:id`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r || !inScope(await teamScope(req), r.employeeId)) return res.status(404).json({ error: 'No such request.' });
  try {
    const reads = await readsPrivateLeave(req);
    const [shaped] = masked(await withTypes(orgId, [r]), reads);
    const employee = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { id: true, name: true, userId: true, branchId: true, areaId: true, reportingManagerId: true } });
    const type = await peoplePrisma.leaveType.findFirst({ where: { id: r.leaveTypeId, orgId } });
    const names = await actorNames(orgId, [r.requestedByUserId, r.reviewedByUserId]);
    const manager = r.managerApprovedById ? await peoplePrisma.employee.findFirst({ where: { id: r.managerApprovedById, orgId }, select: { name: true } }) : null;
    const own = Boolean(employee?.userId && r.requestedByUserId === employee.userId) || r.requestedByUserId === `portal:${r.employeeId}`;
    const history: Array<{ at: Date; what: string; by: string | null; note?: string | null }> = [
      { at: r.createdAt, what: own ? 'Asked' : `Entered for ${employee?.name || 'them'}`, by: names.get(r.requestedByUserId) || null },
    ];
    if (r.managerApprovedAt) history.push({ at: r.managerApprovedAt, what: 'Approved by the manager', by: manager?.name || null, note: shaped.reasonHidden ? null : r.managerNote });
    if (r.reviewedAt && r.status !== 'PENDING') history.push({ at: r.reviewedAt, what: ({ APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' } as Record<string, string>)[r.status] || r.status, by: names.get(r.reviewedByUserId || '') || null, note: shaped.reviewNote });
    const dates = employee && type ? await dayPlan(orgId, employee, r.fromDate, r.toDate, type.sandwich) : [];
    let balance = null;
    if (type?.isPaid && !shaped.reasonHidden) {
      const year = await leaveYearOf(orgId, r.fromDate);
      const { balances } = await balancesFor(accountId, orgId, [r.employeeId], year, r.fromDate > today() ? r.fromDate : undefined);
      const b = balances.get(r.employeeId)!.get(type.id)!;
      /* "Without" adds this request back while it still holds days (waiting or approved). */
      const holds = OPEN.includes(r.status);
      balance = { year, label: periodLabel(await leavePeriodOf(orgId), year), allocated: b.allocated, available: b.available, without: b.available == null ? null : round(b.available + (holds ? r.days : 0)), with: b.available == null ? null : round(holds ? b.available : b.available - r.days) };
    }
    const parts = r.groupId ? masked(await withTypes(orgId, await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: r.groupId }, orderBy: { fromDate: 'asc' } })), reads) : [];
    const turn = r.status === 'PENDING' ? await hrMayDecide(orgId, 'leave', r) : { ok: true as const };
    res.json({
      request: shaped,
      history,
      dates,
      balance,
      parts: parts.map((p: any) => ({ id: p.id, fromDate: p.fromDate, toDate: p.toDate, days: p.days, status: p.status })),
      alsoAway: await alsoAway(req, orgId, r.employeeId, r.fromDate, r.toDate, reads),
      waitingForManager: turn.ok ? null : turn.error,
      ownRequest: Boolean(employee?.userId && employee.userId === req.auth!.userId),
    });
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * The Time & Leave overview: who is away today, what is waiting (oldest
 * first, and how long), who comes back this week, who is away in the next
 * seven days, and days that lapse at the period end. Inside the reader's scope.
 */
leaveRouter.get(`${base}/overview`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const scope = await teamScope(req);
  const reads = await readsPrivateLeave(req);
  const t0 = today();
  const week = addDays(t0, 7);
  const sc = scopeRows(scope);
  const [awayRows, waitingAll, upcomingRows] = await Promise.all([
    peoplePrisma.leaveRequest.findMany({ where: { orgId, ...sc, status: 'APPROVED', fromDate: { lte: t0 }, toDate: { gte: t0 } }, orderBy: { toDate: 'asc' }, take: 200 }),
    waitingForReader(orgId, scope, req.auth!.userId),
    peoplePrisma.leaveRequest.findMany({ where: { orgId, ...sc, status: { in: OPEN }, fromDate: { gt: t0, lte: week } }, orderBy: { fromDate: 'asc' }, take: 50 }),
  ]);
  const waitingRows = waitingAll.slice(0, 8);
  const waitingCount = waitingAll.length;
  const oldWaiting = waitingAll.filter((r) => r.createdAt.getTime() < Date.now() - 3 * 86_400_000).length;
  const shape = async (rows: any[]) => masked(await withTypes(orgId, rows), reads).map((r: any) => ({ id: r.id, employeeId: r.employeeId, employeeName: r.employeeName, employeeCode: r.employeeCode, department: r.department, photoUrl: r.photoUrl, leaveTypeName: r.leaveTypeName, leaveTypeColor: r.leaveTypeColor, fromDate: r.fromDate, toDate: r.toDate, days: r.days, halfDay: r.halfDay, status: r.status, createdAt: r.createdAt, managerApprovedAt: r.managerApprovedAt }));
  /* Days that lapse: within 60 days of the period end, what is left above what the type carries forward. */
  const period = await leavePeriodOf(orgId);
  const year = periodOf(period, t0);
  const end = periodEnd(period, year);
  let lapsing: Array<{ employeeId: string; employeeName: string; leaveTypeName: string; days: number }> = [];
  if (addDays(t0, 60) >= end) {
    const people = await peoplePrisma.employee.findMany({ where: { accountId, orgId, status: { not: 'LEFT' }, ...(scope.all ? {} : { id: { in: scope.ids } }) }, select: { id: true, name: true }, take: 2000 });
    const { types, balances } = await balancesFor(accountId, orgId, people.map((p) => p.id), year, end);
    for (const p of people) for (const t of types.filter((x) => x.isPaid && x.isActive && (reads || !x.isPrivate))) {
      const b = balances.get(p.id)?.get(t.id);
      if (!b || b.available == null) continue;
      const carry = t.carryForwardMax == null || t.carryForwardMax <= 0 ? 0 : t.carryForwardMax;
      const lapse = round(b.available - carry);
      if (lapse > 0) lapsing.push({ employeeId: p.id, employeeName: p.name, leaveTypeName: t.name, days: lapse });
    }
    lapsing = lapsing.sort((a, b) => b.days - a.days).slice(0, 20);
  }
  res.json({
    today: t0,
    awayToday: await shape(awayRows),
    waiting: { count: waitingCount, olderThan3Days: oldWaiting, oldest: await shape(waitingRows) },
    upcoming: await shape(upcomingRows),
    lapsing: { periodEnd: end, label: periodLabel(period, year), rows: lapsing },
  });
});

/**
 * A leave type tried on five real people before it is saved (TLA-015): what
 * each gets this period, credited when, and whether the type is open to them.
 * Nothing is written. People are picked to show the edges: the newest
 * joiner, the longest serving, someone who joined mid-period, and two more.
 */
leaveRouter.post(`${base}/types/preview`, can(PermissionAction.VIEW, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = typeSchema.safeParse({ name: 'Preview', ...(req.body || {}) });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the leave type.' });
  const policy = await policyOf(orgId, req.body);
  if ('error' in policy) return res.status(400).json({ error: policy.error });
  const t = { ...parsed.data, ...policy.data } as any;
  const period = await leavePeriodOf(orgId);
  const year = periodOf(period, today());
  const bounds = periodBounds(period, year);
  const scope = await teamScope(req);
  const all = await peoplePrisma.employee.findMany({ where: { accountId, orgId, status: { not: 'LEFT' }, ...(scope.all ? {} : { id: { in: scope.ids } }) }, select: { id: true, name: true, code: true, gender: true, employeeTypeId: true, dateOfJoining: true }, orderBy: { dateOfJoining: 'asc' }, take: 5000 });
  const joined = all.filter((p) => p.dateOfJoining);
  const picks = new Map<string, { person: (typeof all)[number]; why: string }>();
  const add = (p: (typeof all)[number] | undefined, why: string) => { if (p && !picks.has(p.id) && picks.size < 5) picks.set(p.id, { person: p, why }); };
  add(joined[joined.length - 1], 'Newest joiner');
  add(joined[0], 'Longest serving');
  add(joined.find((p) => p.dateOfJoining! > bounds.from && p.dateOfJoining! <= bounds.to), 'Joined this period');
  for (const p of all) add(p, '');
  const accrualType = { id: 'preview', annualDays: t.annualDays, accrual: t.accrual, prorateForJoiners: t.prorateForJoiners, carryForwardMax: t.carryForwardMax ?? null, createdAt: new Date(`${bounds.from}T00:00:00Z`), creditOn: t.creditOn ?? 'START', creditDay: t.creditDay ?? null };
  const t0 = today();
  const rows = [...picks.values()].map(({ person, why }) => {
    const problem = policyProblem({ name: 'This type', allowHalfDay: true, minNoticeDays: null, maxDaysPerRequest: null, backdatedDays: null, gender: t.gender ?? null, employeeTypeIds: t.employeeTypeIds || [], availableAfterDays: t.availableAfterDays ?? null }, person, { fromDate: t0 > (person.dateOfJoining || '') ? t0 : person.dateOfJoining!, halfDay: null, days: 0 }, t0, true);
    if (!t.isPaid) return { employeeId: person.id, name: person.name, code: person.code, why, dateOfJoining: person.dateOfJoining, open: !problem, note: problem, fullPeriod: null, soFar: null, credits: [] };
    const b = balanceFor(accrualType, year, person.dateOfJoining || null, t0 > bounds.to ? bounds.to : t0, new Map(), new Map(), { period });
    return { employeeId: person.id, name: person.name, code: person.code, why, dateOfJoining: person.dateOfJoining, open: !problem, note: problem, fullPeriod: b.fullYear ?? null, soFar: b.earned, credits: (b.credits || []).slice(0, 12).map((c: any) => ({ date: c.date, days: c.days })) };
  });
  res.json({ period: bounds, rows, carry: t.carryForwardMax ?? null });
});

const WEEKDAY = /^([0-6](,[0-6])*)?$/;
/** The company's working week: weekly offs for anyone no shift covers (People-only companies set only this). */
leaveRouter.get(`${base}/working-week`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const s = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { weeklyOffDays: true, offSaturdays: true, defaultShiftId: true } });
  /* What the schedule engine really reads (schedule.ts resolveShift), Attendance on or not: anyone on a shift follows it. */
  const [assigned, rotating, departments, temporary] = await Promise.all([
    peoplePrisma.shiftAssignment.count({ where: { orgId } }),
    peoplePrisma.rotationAssignment.count({ where: { orgId } }),
    peoplePrisma.departmentSchedule.count({ where: { orgId } }),
    peoplePrisma.temporarySchedule.count({ where: { orgId } }),
  ]);
  res.json({
    weeklyOffDays: s?.weeklyOffDays ?? '0',
    offSaturdays: s?.offSaturdays ?? '',
    /* A default shift replaces the working week for everyone not on another shift. */
    defaultShift: Boolean(s?.defaultShiftId),
    shiftsDecide: Boolean(s?.defaultShiftId) || assigned + rotating + departments + temporary > 0,
  });
});

leaveRouter.put(`${base}/working-week`, can(PermissionAction.EDIT, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z.object({
    weeklyOffDays: z.string().regex(WEEKDAY, 'Weekly offs are day numbers 0–6.'),
    offSaturdays: z.string().regex(/^([1-5](,[1-5])*)?$/, 'Saturdays are 1st to 5th.').default(''),
  }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the working week.' });
  const offs = [...new Set(parsed.data.weeklyOffDays.split(',').filter(Boolean))].sort().join(',');
  if (offs.split(',').filter(Boolean).length >= 7) return res.status(400).json({ error: 'At least one day of the week is a working day.' });
  const sats = offs.split(',').includes('6') ? '' : [...new Set(parsed.data.offSaturdays.split(',').filter(Boolean))].sort().join(',');
  const data = { weeklyOffDays: offs, offSaturdays: sats };
  await peoplePrisma.attendanceSettings.upsert({ where: { orgId }, update: data, create: { accountId, orgId, ...data, updatedByUserId: req.auth!.userId } as any });
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  await recordAudit(req, { entity: 'WorkingWeek', entityId: orgId, action: 'UPDATE', message: `Working week: ${offs ? offs.split(',').map((d) => names[Number(d)]).join(', ') : 'no day'} off${sats ? `; Saturdays ${sats} off` : ''}`, metadata: data });
  res.json(data);
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
    await createLeave(req, res, me);
    if (res.statusCode === 201) await recordAudit(req, { entity: 'LeaveRequest', entityId: me.id, action: 'CREATE', message: `${me.name} asked for leave, ${req.body?.fromDate} to ${req.body?.toDate || req.body?.fromDate}`, metadata: { employeeId: me.id, leaveTypeId: req.body?.leaveTypeId } });
    return;
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
    const started = r.groupId
      ? await peoplePrisma.leaveRequest.findFirst({ where: { orgId, groupId: r.groupId, status: 'APPROVED', fromDate: { lte: today() } }, select: { id: true } })
      : r.status === 'APPROVED' && r.fromDate <= today();
    if (started) return { status: 409, body: { error: 'This leave has started. Ask your manager to cancel it.' } };
    return { status: 200, body: { request: await cancelLeaveRequest(accountId, orgId, r.id, `portal:${employeeId}`) } };
  });
}

leaveRouter.post('/orgs/:orgId/attendance/me/leave/:id/cancel', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const out = await cancelOwnLeave(accountId, orgId, me.id, String(req.params.id));
    if (out.status === 200) await recordAudit(req, { entity: 'LeaveRequest', entityId: String(req.params.id), action: 'CANCEL', message: `${me.name} cancelled their own leave`, metadata: { employeeId: me.id } });
    res.status(out.status).json(out.body);
  } catch (e) {
    return sendError(res, e);
  }
});
