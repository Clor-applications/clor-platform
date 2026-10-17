import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import {
  DEFAULT_SHIFT,
  computeDay,
  isHHMM,
  istDate,
  istInstant,
  istTime,
  monthSummary,
  type ShiftRule,
} from '../services/attendance/compute.js';
import { clientIp } from '../services/auth.js';
import { loadHolidays, loadSchedule, resolveShift } from '../services/attendance/schedule.js';
import { emit as emitWebhook } from '../services/attendance/webhooks.js';

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
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['PRESENT', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF'] as const;

export const fail = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, code });
export const sendError = (res: any, e: any) => {
  if (e?.status) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  if (String(e?.code) === 'P2002') return res.status(409).json({ error: 'That already exists.' });
  throw e;
};

/**
 * The shift someone works on a date — the one resolver (services/attendance/
 * schedule.ts): temporary, own schedule, rotation, department, company
 * default, else 09:00–18:00 with Sunday off. Never "the org's first shift":
 * creating a night shift must not quietly move everyone unassigned onto nights.
 */
export async function shiftFor(orgId: string, employeeId: string, date: string) {
  return resolveShift(await loadSchedule(orgId, [employeeId]), employeeId, date);
}

/** A company holiday, or one for the person's area (ClorTime's holiday locations). */
export async function isHoliday(orgId: string, date: string, branchId: string | null, areaId: string | null = null) {
  const h = await peoplePrisma.holiday.findFirst({
    where: {
      orgId,
      date,
      isOptional: false,
      AND: [
        { OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] },
        { OR: [{ areaId: null }, ...(areaId ? [{ areaId }] : [])] },
      ],
    },
    select: { id: true },
  });
  return Boolean(h);
}

/** Times on a form are wall-clock HH:MM on the day; an out before the in is the next morning. */
const instants = (date: string, inHHMM?: string | null, outHHMM?: string | null) => {
  const checkIn = inHHMM ? istInstant(date, inHHMM) : null;
  let checkOut = outHHMM ? istInstant(date, outHHMM) : null;
  if (checkIn && checkOut && checkOut <= checkIn) checkOut = istInstant(date, outHHMM!, 1);
  return { checkIn, checkOut };
};

/** Work a day out and write it: the single path every write goes through. */
/** A day in a month HR closed cannot change (AttendanceMonthLock). */
export class MonthClosedError extends Error {
  status = 409;
  code = 'ATTENDANCE_MONTH_CLOSED';
  constructor(month: string) {
    super(`${month} is closed in Attendance. Reopen the month to change its days.`);
  }
}

/** Which of these months (YYYY-MM) are closed for the company. */
export async function closedMonths(orgId: string, months: string[]) {
  const wanted = [...new Set(months.filter(Boolean))];
  if (!wanted.length) return new Set<string>();
  const rows = await peoplePrisma.attendanceMonthLock.findMany({ where: { orgId, month: { in: wanted } }, select: { month: true } });
  return new Set(rows.map((r) => r.month));
}

export async function assertMonthOpen(orgId: string, date: string) {
  const month = date.slice(0, 7);
  if ((await closedMonths(orgId, [month])).has(month)) throw new MonthClosedError(month);
}

export async function writeDay(opts: {
  accountId: string;
  orgId: string;
  userId: string;
  employee: { id: string; branchId: string | null; areaId?: string | null };
  date: string;
  checkIn: Date | null;
  checkOut: Date | null;
  statusOverride?: (typeof STATUSES)[number] | null;
  source: string;
  note?: string | null;
  /** Set when an approved leave writes the day; cleared by any other write. */
  leaveRequestId?: string | null;
}) {
  /* Every way a day is written comes through here, so a closed month is held shut in one place. */
  await assertMonthOpen(opts.orgId, opts.date);
  const { shiftId, rule } = await shiftFor(opts.orgId, opts.employee.id, opts.date);
  const holiday = await isHoliday(opts.orgId, opts.date, opts.employee.branchId, opts.employee.areaId ?? null);
  const computed = computeDay({
    date: opts.date,
    shift: rule,
    checkIn: opts.checkIn,
    checkOut: opts.checkOut,
    isHoliday: holiday,
    onLeave: opts.statusOverride === 'ON_LEAVE',
  });
  const status = opts.statusOverride && !opts.checkIn ? opts.statusOverride : computed.status;
  const data = {
    shiftId,
    checkIn: opts.checkIn,
    checkOut: opts.checkOut,
    workedMinutes: computed.workedMinutes,
    lateMinutes: computed.lateMinutes,
    earlyOutMinutes: computed.earlyOutMinutes,
    overtimeMinutes: computed.overtimeMinutes,
    status,
    source: opts.source,
    leaveRequestId: opts.leaveRequestId ?? null,
    /* A changed day needs checking again. */
    validated: false,
    validatedByUserId: null,
    validatedAt: null,
    ...(opts.note !== undefined ? { note: opts.note } : {}),
  };
  const record = await peoplePrisma.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId: opts.employee.id, date: opts.date } },
    create: { accountId: opts.accountId, orgId: opts.orgId, employeeId: opts.employee.id, date: opts.date, createdByUserId: opts.userId, ...data },
    update: { ...data, overtimeApproved: false },
  });
  emitWebhook(opts.orgId, 'day', {
    employeeId: record.employeeId,
    date: record.date,
    status: record.status,
    checkIn: record.checkIn ? istTime(record.checkIn) : null,
    checkOut: record.checkOut ? istTime(record.checkOut) : null,
    workedMinutes: record.workedMinutes,
    lateMinutes: record.lateMinutes,
    earlyOutMinutes: record.earlyOutMinutes,
    overtimeMinutes: record.overtimeMinutes,
    source: record.source,
  });
  return record;
}

export async function employeeIn(orgId: string, accountId: string, employeeId: string) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId, accountId }, select: { id: true, branchId: true, areaId: true, name: true, status: true } });
  if (!e) throw fail(404, 'No such employee.');
  return e;
}

/**
 * The employee file of the person signed in: the one linked to their user, or
 * — once, if exactly one unlinked file carries their email — that one, linked.
 */
export async function myEmployee(accountId: string, orgId: string, userId: string) {
  const linked = await peoplePrisma.employee.findFirst({ where: { orgId, accountId, userId } });
  if (linked) return linked;
  const user = await platformPrisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const email = String(user?.email || '').trim();
  if (email) {
    const matches = await peoplePrisma.employee.findMany({
      where: {
        orgId,
        accountId,
        userId: null,
        status: { not: 'LEFT' },
        OR: [{ email: { equals: email, mode: 'insensitive' } }, { workEmail: { equals: email, mode: 'insensitive' } }],
      },
    });
    if (matches.length === 1) return peoplePrisma.employee.update({ where: { id: matches[0].id }, data: { userId } });
  }
  throw fail(404, 'Your sign-in is not linked to an employee file yet. Ask HR to set your email on your employee file.', 'NO_EMPLOYEE_LINK');
}

export const withNames = async (orgId: string, rows: any[]) => {
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  const people = ids.length
    ? await peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true, department: true, photoUrl: true } })
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  return rows.map((r) => {
    const p = byId.get(r.employeeId);
    return {
      ...r,
      employeeName: p?.name || '—',
      employeeCode: p?.code || null,
      department: p?.department || null,
      photoUrl: p?.photoUrl || null,
      checkInTime: r.checkIn ? istTime(new Date(r.checkIn)) : null,
      checkOutTime: r.checkOut ? istTime(new Date(r.checkOut)) : null,
    };
  });
};

export const today = () => istDate(new Date());
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
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const to = dateParam(req.query.to, today());
  const from = dateParam(req.query.from, to);
  const pick = (k: string) => String(req.query[k] || '').trim() || undefined;
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
    },
    orderBy: [{ date: 'desc' }],
    take: 2000,
  });
  res.json({ records: await withNames(orgId, rows), from, to });
});

const markSchema = z.object({
  employeeId: z.string().trim().min(1),
  date: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'),
  checkIn: z.string().optional().nullable(),
  checkOut: z.string().optional().nullable(),
  status: z.enum(STATUSES).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

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
    const { checkIn, checkOut } = instants(b.date, b.checkIn, b.checkOut);
    const record = await writeDay({
      accountId, orgId, userId: req.auth!.userId, employee, date: b.date, checkIn, checkOut,
      statusOverride: b.status ?? null, source: 'MANUAL', note: b.note ?? null,
    });
    res.json({ record: (await withNames(orgId, [record]))[0] });
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceRouter.delete('/orgs/:orgId/attendance/records/:id', can(PermissionAction.DELETE, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.attendanceRecord.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return res.status(404).json({ error: 'No such day.' });
  try {
    await assertMonthOpen(orgId, r.date);
  } catch (e) {
    return sendError(res, e);
  }
  await peoplePrisma.attendanceRecord.delete({ where: { id: r.id } });
  res.json({ ok: true });
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
  const r = await peoplePrisma.attendanceRecord.updateMany({
    where: { accountId, orgId, id: { in: ids } },
    data: { validated: true, validatedByUserId: req.auth!.userId, validatedAt: new Date() },
  });
  res.json({ validated: r.count });
});

attendanceRouter.post('/orgs/:orgId/attendance/records/:id/overtime', can(PermissionAction.APPROVE, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.attendanceRecord.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return res.status(404).json({ error: 'No such day.' });
  if (!r.overtimeMinutes) return res.status(400).json({ error: 'There is no overtime on that day.' });
  const updated = await peoplePrisma.attendanceRecord.update({
    where: { id: r.id },
    data: { overtimeApproved: req.body?.approved !== false },
  });
  res.json({ record: updated });
});

/** Who can be marked: the people pickers in Attendance, without needing People. */
attendanceRouter.get('/orgs/:orgId/attendance/employees', can(PermissionAction.VIEW, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employees = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, status: { not: 'LEFT' } },
    select: { id: true, name: true, code: true, department: true },
    orderBy: { name: 'asc' },
  });
  res.json({ employees });
});

// ---------------------------------------------------------------------------
// Self-service: my attendance and the clock
// ---------------------------------------------------------------------------

attendanceRouter.get('/orgs/:orgId/attendance/me', can(PermissionAction.VIEW, R.self), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
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
      shift: { name: shift.name, startTime: shift.rule.startTime, endTime: shift.rule.endTime },
      clockedIn: Boolean(open),
      todayRecord: shaped.find((r) => r.date === t) || open,
      records: shaped,
      requests,
    });
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceRouter.post('/orgs/:orgId/attendance/clock', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
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
      const date = istDate(now);
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

const requestSchema = z.object({
  employeeId: z.string().trim().optional(),
  date: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'),
  checkIn: z.string().refine(isHHMM, 'Times are HH:MM, 24-hour.'),
  checkOut: z.string().refine(isHHMM, 'Times are HH:MM, 24-hour.').optional().nullable(),
  reason: z.string().trim().min(3, 'Say why.').max(500),
});

/** `by` is who asks: the signed-in user, or — from the employee portal — the employee themselves. */
export const createRequest = async (req: any, res: any, employeeId: string, by?: { accountId: string; orgId: string; userId: string }) => {
  const { accountId, orgId } = by || req.tenant!;
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request.' });
  const b = parsed.data;
  if (b.date > today()) return res.status(400).json({ error: 'A correction is for a day that has happened.' });
  const { checkIn, checkOut } = instants(b.date, b.checkIn, b.checkOut || null);
  const row = await peoplePrisma.attendanceRequest.create({
    data: { accountId, orgId, employeeId, date: b.date, checkIn, checkOut, reason: b.reason, requestedByUserId: by?.userId || req.auth!.userId },
  });
  res.status(201).json({ request: row });
};

attendanceRouter.post('/orgs/:orgId/attendance/me/requests', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  try {
    const me = await myEmployee(req.tenant!.accountId, req.tenant!.orgId, req.auth!.userId);
    return createRequest(req, res, me.id);
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceRouter.post('/orgs/:orgId/attendance/requests', can(PermissionAction.CREATE, R.requests), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  try {
    const employee = await employeeIn(req.tenant!.orgId, req.tenant!.accountId, String(req.body?.employeeId || ''));
    return createRequest(req, res, employee.id);
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceRouter.get('/orgs/:orgId/attendance/requests', can(PermissionAction.VIEW, R.requests), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const status = String(req.query.status || '').trim();
  const rows = await peoplePrisma.attendanceRequest.findMany({
    where: { accountId, orgId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json({ requests: await withNames(orgId, rows) });
});

const review = (approve: boolean) => async (req: any, res: any) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: `This request was already ${r.status.toLowerCase()}.` });
  try {
    if (approve) {
      const employee = await employeeIn(orgId, accountId, r.employeeId);
      await writeDay({ accountId, orgId, userId: req.auth!.userId, employee, date: r.date, checkIn: r.checkIn, checkOut: r.checkOut, source: 'REQUEST' });
    }
    const updated = await peoplePrisma.attendanceRequest.update({
      where: { id: r.id },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        reviewedByUserId: req.auth!.userId,
        reviewedAt: new Date(),
        reviewNote: String(req.body?.note || '').trim().slice(0, 500) || null,
      },
    });
    res.json({ request: updated });
  } catch (e) {
    return sendError(res, e);
  }
};
attendanceRouter.post('/orgs/:orgId/attendance/requests/:id/approve', can(PermissionAction.APPROVE, R.requests), review(true));
attendanceRouter.post('/orgs/:orgId/attendance/requests/:id/reject', can(PermissionAction.APPROVE, R.requests), review(false));

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
  try {
    const shift = await peoplePrisma.shift.update({ where: { id: existing.id }, data: { ...parsed.data, code: parsed.data.code || null, color: parsed.data.color || null } as any });
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
  await peoplePrisma.shift.delete({ where: { id: existing.id } });
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
  await peoplePrisma.shiftAssignment.delete({ where: { id: r.id } });
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
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const year = String(req.query.year || today().slice(0, 4)).slice(0, 4);
  const holidays = await peoplePrisma.holiday.findMany({
    where: { accountId, orgId, date: { gte: `${year}-01-01`, lte: `${year}-12-31` } },
    orderBy: { date: 'asc' },
  });
  const areas = new Map((await peoplePrisma.area.findMany({ where: { orgId }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  res.json({ holidays: holidays.map((h) => ({ ...h, areaName: h.areaId ? areas.get(h.areaId) || null : null })), year });
});

attendanceRouter.post('/orgs/:orgId/attendance/holidays', can(PermissionAction.CREATE, R.holidays), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = holidaySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid holiday.' });
  try {
    const holiday = await peoplePrisma.holiday.create({
      data: { accountId, orgId, ...parsed.data, branchId: parsed.data.branchId || null, areaId: await areaOrNull(orgId, parsed.data.areaId), isOptional: Boolean(parsed.data.isOptional), createdByUserId: req.auth!.userId },
    });
    res.status(201).json({ holiday });
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceRouter.put('/orgs/:orgId/attendance/holidays/:id', can(PermissionAction.EDIT, R.holidays), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.holiday.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such holiday.' });
  const parsed = holidaySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid holiday.' });
  try {
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
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.holiday.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such holiday.' });
  await peoplePrisma.holiday.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// The month, for payroll
// ---------------------------------------------------------------------------

export const daysOfMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};

/** Every date from one day to another, inclusive. */
export const daysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};

/**
 * Everything a period's figures are worked out from — who was employed, their
 * days, holidays, each person's shift on each date, and which leave was
 * unpaid. Shared by the month summary and the reports so they cannot disagree.
 */
export async function periodContext(accountId: string, orgId: string, from: string, to: string) {
  const days = daysBetween(from, to);
  const [people, records, holidayData, schedule] = await Promise.all([
    peoplePrisma.employee.findMany({
      /* A missing joining or leaving date means "no limit" — never a filter
         on NULL, which SQL treats as unknown and drops the person. */
      where: {
        accountId,
        orgId,
        /* Door-only staff (guards, drivers) open doors but are not expected at work (ClorTime attendance_required). */
        attendanceRequired: true,
        AND: [
          { OR: [{ dateOfLeaving: null }, { dateOfLeaving: { gte: from } }] },
          { OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: to } }] },
        ],
      },
      select: { id: true, name: true, code: true, department: true, departmentId: true, areaId: true, branchId: true, contractorId: true, guardianName: true, dateOfJoining: true, dateOfLeaving: true, status: true },
      orderBy: { name: 'asc' },
    }),
    peoplePrisma.attendanceRecord.findMany({ where: { accountId, orgId, date: { gte: from, lte: to } } }),
    loadHolidays(orgId, from, to),
    loadSchedule(orgId),
  ]);
  const holidays = holidayData.rows;
  /* Company-wide holidays; holidaysFor(person) adds their area's and branch's. */
  const holidaySet = holidayData.company;
  const holidaysFor = (p: { areaId?: string | null; branchId?: string | null }) => holidayData.forArea(p.areaId, p.branchId);
  /* Days on unpaid leave are loss of pay: find which leave days came from an
     unpaid type. A day marked "on leave" by hand is treated as paid. */
  const leaveIds = [...new Set(records.filter((r) => r.status === 'ON_LEAVE' && r.leaveRequestId).map((r) => r.leaveRequestId!))];
  const leaveReqs = leaveIds.length
    ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, id: { in: leaveIds } }, select: { id: true, leaveTypeId: true } })
    : [];
  const unpaidTypes = new Set(
    (await peoplePrisma.leaveType.findMany({ where: { orgId, isPaid: false }, select: { id: true } })).map((x) => x.id)
  );
  const unpaidRequest = new Set(leaveReqs.filter((r) => unpaidTypes.has(r.leaveTypeId)).map((r) => r.id));
  const shiftOn = (employeeId: string, date: string) => resolveShift(schedule, employeeId, date);
  const recordsOf = new Map<string, Map<string, (typeof records)[number]>>();
  for (const r of records) {
    if (!recordsOf.has(r.employeeId)) recordsOf.set(r.employeeId, new Map());
    recordsOf.get(r.employeeId)!.set(r.date, r);
  }
  /* Only the days someone was employed. */
  const spanOf = (p: { dateOfJoining: string | null; dateOfLeaving: string | null }) =>
    days.filter((d) => (!p.dateOfJoining || d >= p.dateOfJoining) && (!p.dateOfLeaving || d <= p.dateOfLeaving));
  const settings = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId } });
  return { days, people, records, holidays, holidaySet, holidaysFor, shiftOn, recordsOf, spanOf, unpaidRequest, settings, today: today() };
}

/** Payable and loss-of-pay days per person for a month (the month summary, and Payroll's input). */
export async function monthRows(accountId: string, orgId: string, month: string) {
  return periodRows(accountId, orgId, daysOfMonth(month));
}

/** The same figures for any run of days — a pay period need not be a calendar month. */
export async function periodRows(accountId: string, orgId: string, days: string[]) {
  const ctx = await periodContext(accountId, orgId, days[0], days[days.length - 1]);
  return ctx.people.map((p) => {
    const span = ctx.spanOf(p);
    const spanSet = new Set(span);
    const recs = ctx.recordsOf.get(p.id) || new Map();
    const unpaidLeaveDays = [...recs.values()].filter(
      (r) => spanSet.has(r.date) && r.status === 'ON_LEAVE' && r.leaveRequestId && ctx.unpaidRequest.has(r.leaveRequestId)
    ).length;
    return {
      employeeId: p.id,
      name: p.name,
      code: p.code,
      department: p.department,
      unpaidLeaveDays,
      ...monthSummary({
        days: span,
        records: recs as any,
        shift: (d) => ctx.shiftOn(p.id, d).rule,
        holidays: ctx.holidaysFor(p),
        today: ctx.today,
        unpaidLeaveDays,
        lateAllowance: ctx.settings?.lateAllowancePerMonth ?? 0,
        latePenaltyEvery: ctx.settings?.latePenaltyEvery ?? 0,
      }),
    };
  });
}

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
  const lock = await peoplePrisma.attendanceMonthLock.upsert({
    where: { orgId_month: { orgId, month } },
    create: { accountId, orgId, month, lockedByUserId: req.auth!.userId },
    update: {},
  });
  res.json({ month, closed: { at: lock.lockedAt, byUserId: lock.lockedByUserId } });
});

/** Reopen a closed month, to correct it. Payroll already taken from it is not changed. */
attendanceRouter.post('/orgs/:orgId/attendance/months/:month/reopen', can(PermissionAction.APPROVE, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  await peoplePrisma.attendanceMonthLock.deleteMany({ where: { orgId, month: String(req.params.month) } });
  res.json({ month: String(req.params.month), closed: null });
});
