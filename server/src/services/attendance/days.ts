import { punchedBreakFor } from './breaks.js';
import { peoplePrisma, peopleWrite, afterPeopleCommit } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { computeDay, isOvernight, isWeeklyOff, istDate, istInstant, istTime, monthSummary, nightShiftLabel } from './compute.js';
import { nightShiftsOn } from './nightShift.js';
import { loadHolidays, loadSchedule, resolveShift } from './schedule.js';
import { emit as emitWebhook } from './webhooks.js';
import { logDayChange } from './history.js';
import { permissionCovers } from './permissionWindow.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { asJson, decidedMarker, readerTrustOn, trustForDay } from './trust.js';
import { halfOn, partOfDay } from './leaveHalves.js';
import { eachDay } from '../../utils/istDate.js';

/**
 * Attendance days: the one path a day is written by, and the reads every
 * screen, report, reader and pay run work a period out from.
 *
 * Moved out of routes/attendance.ts so that readers, the portal, payroll and
 * reports call a service rather than another route file (a route importing a
 * route closed an import cycle: attendance → phonePunch → iclock →
 * attendance). Behaviour is unchanged.
 */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const STATUSES = ['PRESENT', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF'] as const;

export const fail = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, code });
export const sendError = (res: any, e: any) => {
  if (e?.status) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.month ? { month: e.month, months: e.months || [e.month] } : {}) });
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

type Place = { areaId: string | null; branchId: string | null };
type Move = { employeeId: string; field: string | null; fromId: string | null; effectiveDate: string };

/**
 * Where people worked on the days after `from`: a location or branch move takes
 * effect from its date, so the days before it keep the old place (and its
 * holidays). Employment history is undone back from today's values, as asOf
 * does for one date. Someone who never moved costs nothing per day.
 */
export async function placesSince(orgId: string, employeeIds: string[], from: string) {
  const moves = employeeIds.length
    ? ((await peoplePrisma.employmentEvent.findMany({
        where: { orgId, employeeId: { in: employeeIds }, field: { in: ['areaId', 'branchId'] }, effectiveDate: { gt: from } },
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
        select: { employeeId: true, field: true, fromId: true, effectiveDate: true },
      })) as Move[])
    : [];
  const byEmployee = new Map<string, Move[]>();
  for (const m of moves) byEmployee.set(m.employeeId, [...(byEmployee.get(m.employeeId) || []), m]);
  return {
    moved: (employeeId: string | undefined) => Boolean(employeeId && byEmployee.has(employeeId)),
    on(person: { id?: string; areaId?: string | null; branchId?: string | null }, date: string): Place {
      const place: Place = { areaId: person.areaId ?? null, branchId: person.branchId ?? null };
      for (const m of (person.id && byEmployee.get(person.id)) || []) {
        if (m.effectiveDate <= date) break;
        if (m.field === 'areaId') place.areaId = m.fromId;
        else place.branchId = m.fromId;
      }
      return place;
    },
  };
}

/**
 * A company holiday, or one for the person's area (ClorTime's holiday
 * locations); with `employeeId`, also a restricted holiday that person picked
 * for themselves (HolidayPick). With `employeeId`, the area and branch are the
 * ones the person had on that date, not today's.
 */
export async function isHoliday(orgId: string, date: string, branchId: string | null, areaId: string | null = null, employeeId: string | null = null) {
  if (employeeId) ({ areaId, branchId } = (await placesSince(orgId, [employeeId], date)).on({ id: employeeId, areaId, branchId }, date));
  const scope = [
    { OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] },
    { OR: [{ areaId: null }, ...(areaId ? [{ areaId }] : [])] },
  ];
  const h = await peoplePrisma.holiday.findFirst({ where: { orgId, date, isOptional: false, AND: scope }, select: { id: true } });
  if (h || !employeeId) return Boolean(h);
  const optional = await peoplePrisma.holiday.findMany({ where: { orgId, date, isOptional: true, AND: scope }, select: { id: true } });
  if (!optional.length) return false;
  return Boolean(await peoplePrisma.holidayPick.findFirst({ where: { orgId, employeeId, holidayId: { in: optional.map((o) => o.id) } }, select: { id: true } }));
}

/** Times on a form are wall-clock HH:MM on the day; an out before the in is the next morning. */
export const instants = (date: string, inHHMM?: string | null, outHHMM?: string | null) => {
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
  month: string;
  months: string[];
  constructor(month: string, message?: string, months?: string[]) {
    super(message || `${month} is closed in Attendance. Reopen the month to change its days.`);
    this.month = month;
    this.months = months?.length ? months : [month];
  }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "September", or "September 2025" for a month outside this year. */
const monthName = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]}${month.slice(0, 4) === today().slice(0, 4) ? '' : ` ${month.slice(0, 4)}`}`;

/**
 * Leave or an attendance request on a day in a closed Attendance month is
 * refused when it is asked (closure audit O-09), not left waiting for an
 * approval that can never happen: approving writes the day, and a closed
 * month's days do not move. The same words for the employee and for HR; the
 * error carries the code and the month, so People can link to Month close.
 */
export async function closedMonthRefusal(orgId: string, dates: string[], what: 'leave' | 'request'): Promise<MonthClosedError | null> {
  const shut = [...(await closedMonths(orgId, dates.map((d) => d.slice(0, 7))))].sort();
  if (!shut.length) return null;
  const names = shut.map(monthName);
  const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const message = `${listed} ${shut.length === 1 ? 'is' : 'are'} closed. Ask HR to reopen ${shut.length === 1 ? 'it' : 'them'} if this ${what} must count.`;
  return new MonthClosedError(shut[0], message, shut);
}

/** Which of these months (YYYY-MM) are closed for the company. */
export async function closedMonths(orgId: string, months: string[]) {
  const wanted = [...new Set(months.filter(Boolean))];
  if (!wanted.length) return new Set<string>();
  const rows = await peoplePrisma.attendanceMonthLock.findMany({ where: { orgId, month: { in: wanted } }, select: { month: true } });
  return new Set(rows.map((r) => r.month));
}

/**
 * A day inside a payroll run that is approved, locked, paid or posted, for a
 * person that run pays. Payroll has taken that day's figures; changing the
 * day now would make leave, the register and the payslip disagree. This
 * holds in every mode, People-only included, where there is no Attendance
 * month close at all (closure audit, 27 Oct 2026). Corrections after that go
 * through Payroll, as an adjustment or the next run.
 */
export class PayrollTakenError extends Error {
  status = 409;
  code = 'PAYROLL_TAKEN';
  constructor(period: string, state: string) {
    super(`Payroll for ${period} is ${state.toLowerCase()} and has taken this day. Record the change in Payroll as an adjustment instead.`);
  }
}
export const FINAL_RUN = ['APPROVED', 'LOCKED', 'PAID', 'POSTED'];
export async function payrollTaken(orgId: string, employeeId: string, date: string): Promise<{ period: string; state: string } | null> {
  const periods = await payrollPrisma.payrollPeriod.findMany({ where: { orgId, startDate: { lte: date }, endDate: { gte: date } }, select: { id: true, name: true } });
  if (!periods.length) return null;
  /* Every final run of the period, not the first: a period can have several (pay groups, branches), and only one may pay this person. */
  const runs = await payrollPrisma.payrollRun.findMany({ where: { orgId, periodId: { in: periods.map((p) => p.id) }, status: { in: FINAL_RUN } }, select: { id: true, status: true, periodId: true, provisionalDays: true } });
  /* A day after the cut-off that the run counted as present before it happened (payrollProvisionalDays) was assumed, not taken: it is recorded as it happens, and next month's payroll corrects the difference. */
  const taking = runs.filter((run) => {
    const cutoff = (run.provisionalDays as { cutoffDate?: string } | null)?.cutoffDate;
    return !(cutoff && date > cutoff);
  });
  if (!taking.length) return null;
  const member = await payrollPrisma.payrollRunEmployee.findFirst({ where: { orgId, runId: { in: taking.map((r) => r.id) }, employeeId, inclusion: 'INCLUDED' }, select: { runId: true } });
  if (!member) return null;
  const run = taking.find((r) => r.id === member.runId)!;
  return { period: periods.find((p) => p.id === run.periodId)?.name || date.slice(0, 7), state: run.status };
}

/**
 * A final payroll run (approved, locked, paid or posted) over any day from `from` to `to` that took its
 * days from Attendance, or null. For a change to many people's days at once. A run whose inputs were all
 * typed in or imported never read the days, so changing them takes nothing from it (review of #144): it
 * counts only with an input from Attendance or a pulled Attendance snapshot.
 */
export async function payrollTakenBetween(orgId: string, from: string, to: string): Promise<{ period: string; state: string } | null> {
  const periods = await payrollPrisma.payrollPeriod.findMany({ where: { orgId, startDate: { lte: to }, endDate: { gte: from } }, select: { id: true, name: true, startDate: true } });
  if (!periods.length) return null;
  const runs = await payrollPrisma.payrollRun.findMany({ where: { orgId, periodId: { in: periods.map((p) => p.id) }, status: { in: FINAL_RUN } }, select: { id: true, status: true, periodId: true, attendanceSnapshots: true } });
  for (const run of runs) {
    const pulled = Array.isArray(run.attendanceSnapshots) && run.attendanceSnapshots.length > 0;
    const used = pulled || (await payrollPrisma.payrollInput.count({ where: { orgId, runId: run.id, source: 'ATTENDANCE' } })) > 0;
    if (!used) continue;
    const period = periods.find((p) => p.id === run.periodId);
    return { period: period?.name || String(period?.startDate || from).slice(0, 7), state: run.status };
  }
  return null;
}

/** The day can still change: its Attendance month is open and, for `employeeId`, no final payroll run has taken it. */
export async function assertMonthOpen(orgId: string, date: string, employeeId?: string | null) {
  const month = date.slice(0, 7);
  if ((await closedMonths(orgId, [month])).has(month)) throw new MonthClosedError(month);
  if (employeeId) {
    const taken = await payrollTaken(orgId, employeeId, date);
    if (taken) throw new PayrollTakenError(taken.period, taken.state);
  }
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
  /** The approved leave attached to this day; resolved centrally for every source. */
  leaveRequestId?: string | null;
  /** Why, for the day's history (a correction's reason, a bulk change's description). */
  reason?: string | null;
  historyAction?: 'WRITE' | 'BULK';
  /**
   * An approved half-day leave on this day: half is paid leave, the punches
   * decide the other half — worked half a shift or more: present (paid in
   * full); less: a half day. No lateness on a first-half leave, no early
   * leaving on a second-half one.
   */
  halfDayLeave?: 'FIRST' | 'SECOND' | null;
  /** Hourly leave on the day: those hours are excused and count towards the day, like permission hours. */
  leaveHours?: { fromTime: string | null; toTime: string | null; minutes: number } | null;
  /**
   * An approved attendance request on this day (WFH | ON_DUTY | PERMISSION)
   * and its id. Left out: the day keeps what it had, so a reader's punch does
   * not wipe an approved WFH. null clears it (the request was cancelled).
   */
  dayKind?: string | null;
  attendanceRequestId?: string | null;
}) {
  /* Reader trust (O-11): asked once, outside the write; off, the two columns are never touched. */
  const trustOn = await readerTrustOn(opts.accountId, opts.orgId);
  return peopleWrite(opts.orgId, async () => {
    /* Every way a day is written comes through here, so a closed month is held shut in one place. */
    await assertMonthOpen(opts.orgId, opts.date, opts.employee.id);
    // Resolve leave for every source, not just biometric readers.
    const { shiftId, rule } = await shiftFor(opts.orgId, opts.employee.id, opts.date);
    const holiday = await isHoliday(opts.orgId, opts.date, opts.employee.branchId, opts.employee.areaId ?? null, opts.employee.id);
    const before = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: opts.employee.id, date: opts.date } } });
    const approved = await peoplePrisma.leaveRequest.findFirst({ where: {
      orgId: opts.orgId, employeeId: opts.employee.id, status: 'APPROVED',
      fromDate: { lte: opts.date }, toDate: { gte: opts.date },
    } });
    /* Part of the day as leave (a half, or hours) keeps the day's punches. */
    const part = approved ? partOfDay(approved, opts.date) : false;
    if (approved && (part || before?.leaveRequestId === approved.id || (!holiday && !isWeeklyOff(rule, opts.date))) && opts.leaveRequestId === undefined) {
      const halfToday = halfOn(approved, opts.date);
      opts = { ...opts, leaveRequestId: approved.id, halfDayLeave: halfToday, leaveHours: !halfToday && approved.minutes ? { fromTime: approved.fromTime, toTime: approved.toTime, minutes: approved.minutes } : null };
      if (!part) {
        if (opts.checkIn) throw fail(409, 'Cancel the approved leave before recording work on this day.', 'LEAVE_CONFLICT');
        opts.statusOverride = 'ON_LEAVE';
      }
    }
    if (opts.statusOverride === 'ON_LEAVE' && !opts.leaveRequestId) {
      throw fail(409, 'Apply and approve a leave type in People → Leave Requests so the balance is deducted.', 'LEAVE_REQUEST_REQUIRED');
    }
    /* A shift on punched breaks: the unpaid break time punched that day, or null when nobody punched a break (breaks.ts). */
    const breakTaken = await punchedBreakFor(opts.orgId, opts.employee.id, opts.date, rule, opts.checkIn, opts.checkOut);
    const computed = computeDay({
      date: opts.date,
      shift: rule,
      checkIn: opts.checkIn,
      checkOut: opts.checkOut,
      isHoliday: holiday,
      onLeave: opts.statusOverride === 'ON_LEAVE',
      breakTakenMinutes: breakTaken,
    });
    const half = opts.halfDayLeave || null;
    const hours = !half ? opts.leaveHours || null : null;
    /* Hourly leave: the hours count towards the day, and lateness or leaving early inside them is excused. */
    const withHours = (computed.workedMinutes || 0) + (hours?.minutes || 0);
    const status = half
      ? (computed.workedMinutes || 0) >= rule.halfDayMinutes ? 'PRESENT' : 'HALF_DAY'
      : hours
        ? withHours >= rule.fullDayMinutes || computed.status === 'PRESENT' ? 'PRESENT' : withHours >= rule.halfDayMinutes ? 'HALF_DAY' : computed.status
        : opts.statusOverride && !opts.checkIn ? opts.statusOverride : computed.status;
    if (half === 'FIRST') computed.lateMinutes = 0;
    if (half === 'SECOND') computed.earlyOutMinutes = 0;
    if (hours?.fromTime && hours.toTime) {
      const covers = permissionCovers(opts.date, rule, { checkIn: istInstant(opts.date, hours.fromTime), checkOut: istInstant(opts.date, hours.toTime) });
      if (covers.start) computed.lateMinutes = 0;
      if (covers.end) computed.earlyOutMinutes = 0;
    }
    /* Permission hours stay excused on every rewrite of the day, not only the one that approved them. */
    const permissionId = opts.dayKind === 'PERMISSION' ? opts.attendanceRequestId : opts.dayKind === undefined && before?.dayKind === 'PERMISSION' ? before.attendanceRequestId : null;
    if (permissionId) {
      const p = await peoplePrisma.attendanceRequest.findFirst({ where: { id: permissionId }, select: { checkIn: true, checkOut: true } });
      const covers = permissionCovers(opts.date, rule, p || { checkIn: null, checkOut: null });
      if (covers.start) computed.lateMinutes = 0;
      if (covers.end) computed.earlyOutMinutes = 0;
    }
    const data = {
      shiftId,
      checkIn: opts.checkIn,
      checkOut: opts.checkOut,
      workedMinutes: computed.workedMinutes,
      lateMinutes: computed.lateMinutes,
      earlyOutMinutes: computed.earlyOutMinutes,
      overtimeMinutes: computed.overtimeMinutes,
      breakMinutes: breakTaken,
      status,
      source: opts.source,
      leaveRequestId: opts.leaveRequestId ?? null,
      /* A changed day needs checking again. */
      validated: false,
      validatedByUserId: null,
      validatedAt: null,
      ...(opts.note !== undefined ? { note: opts.note } : {}),
      ...(opts.dayKind !== undefined ? { dayKind: opts.dayKind } : {}),
      ...(opts.attendanceRequestId !== undefined ? { attendanceRequestId: opts.attendanceRequestId } : {}),
    };
    let trustData: { trust?: string; trustReasons?: ReturnType<typeof asJson> } = {};
    if (trustOn) {
      const t = await trustForDay({ orgId: opts.orgId, employeeId: opts.employee.id, date: opts.date, source: opts.source, userId: opts.userId, dayKind: opts.dayKind !== undefined ? opts.dayKind : before?.dayKind ?? null });
      /* Punches that reached a day decided by hand stay raised for HR while the day stays decided. */
      const reasons = t.trust === 'MANUAL' ? [...t.reasons, ...decidedMarker(before?.trustReasons)] : t.reasons;
      trustData = { trust: t.trust, trustReasons: asJson(reasons) };
    }
    const record = await peoplePrisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: opts.employee.id, date: opts.date } },
      create: { accountId: opts.accountId, orgId: opts.orgId, employeeId: opts.employee.id, date: opts.date, createdByUserId: opts.userId, ...data, ...trustData },
      update: { ...data, ...trustData, overtimeApproved: false },
    });
    await logDayChange({
      accountId: opts.accountId, orgId: opts.orgId, employeeId: record.employeeId, date: record.date, recordId: record.id,
      action: opts.historyAction || 'WRITE', before, after: record, userId: opts.userId, reason: opts.reason ?? opts.note ?? null,
    });
    afterPeopleCommit(() => emitWebhook(opts.orgId, 'day', {
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
    }));
    return record;
  });
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
    if (matches.length === 1) {
      /* Linked only while still unlinked: two first requests at once both find the file, and only one writes. */
      await peoplePrisma.employee.updateMany({ where: { id: matches[0].id, orgId, userId: null }, data: { userId } });
    }
  }
  /*
   * Read again: this request, or one running beside it, may just have linked
   * the file. My leave asks for the leave and the restricted holidays at once
   * on its first open; the slower one found the file already linked by the
   * other (so no longer unlinked) and said "No employee file" until a reload.
   */
  const now = await peoplePrisma.employee.findFirst({ where: { orgId, accountId, userId } });
  if (now) return now;
  throw fail(404, 'Your sign-in is not linked to an employee file yet. Ask HR to set your email on your employee file.', 'NO_EMPLOYEE_LINK');
}

/**
 * "Night shift 22:00–06:00 (ends next day)" by shift id, for the days among
 * these on a shift that ends the next morning — only with night shifts on.
 * Asked only when such a shift is there, so a day-shift company pays nothing.
 */
async function nightLabels(orgId: string, rows: Array<{ shiftId?: string | null; accountId?: string | null }>) {
  const ids = [...new Set(rows.map((r) => r.shiftId).filter((x): x is string => Boolean(x)))];
  if (!ids.length) return new Map<string, string>();
  const night = (await peoplePrisma.shift.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, startTime: true, endTime: true } })).filter(isOvernight);
  if (!night.length || !(await nightShiftsOn(orgId, rows.find((r) => r.accountId)?.accountId))) return new Map<string, string>();
  return new Map(night.map((x) => [x.id, nightShiftLabel(x)]));
}

export const withNames = async (orgId: string, rows: any[]) => {
  /* A row may name nobody (a reader punch whose ID matches no one): it gets no name, and asks for none. */
  const ids = [...new Set(rows.map((r) => r.employeeId).filter((id): id is string => typeof id === 'string'))];
  const people = ids.length
    ? await peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true, department: true, photoUrl: true } })
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const nights = await nightLabels(orgId, rows);
  /* A shift change request names the shift asked for. */
  const asked = [...new Set(rows.filter((r) => r.kind === 'SHIFT_CHANGE' && r.shiftId).map((r) => r.shiftId as string))];
  const shiftNames = new Map(asked.length ? (await peoplePrisma.shift.findMany({ where: { orgId, id: { in: asked } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]) : []);
  return rows.map((r) => {
    const p = byId.get(r.employeeId);
    const shiftLabel = r.shiftId ? nights.get(r.shiftId) : undefined;
    const shiftName = r.kind === 'SHIFT_CHANGE' && r.shiftId ? shiftNames.get(r.shiftId) : undefined;
    return {
      ...r,
      ...(shiftLabel ? { shiftLabel } : {}),
      ...(shiftName ? { shiftName } : {}),
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

/** Employees by code or Reader ID, once per import rather than once per row. */
export async function peopleByCode(orgId: string) {
  const people = await peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, code: true, devicePin: true, name: true, status: true, branchId: true, areaId: true, dateOfJoining: true, dateOfLeaving: true } });
  const byCode = new Map<string, (typeof people)[number]>();
  for (const p of people) {
    if (p.code) byCode.set(p.code.trim().toLowerCase(), p);
    if (p.devicePin) byCode.set(p.devicePin.trim().toLowerCase(), p);
  }
  return byCode;
}
export const codeKey = (v: unknown) => String(v ?? '').trim().toLowerCase();

export const daysOfMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};

/** Every date from one day to another, inclusive. */

/**
 * Everything a period's figures are worked out from — who was employed, their
 * days, holidays, each person's shift on each date, and which leave was
 * unpaid. Shared by the month summary and the reports so they cannot disagree.
 */
/** `employeeIds` narrows it to those people (a team-scoped role); omitted, it is everyone. */
export async function periodContext(accountId: string, orgId: string, from: string, to: string, opts: { employeeIds?: string[] } = {}) {
  const only = opts.employeeIds ? { id: { in: opts.employeeIds } } : {};
  const days = eachDay(from, to);
  const [people, records, holidayData, schedule] = await Promise.all([
    peoplePrisma.employee.findMany({
      /* A missing joining or leaving date means "no limit" — never a filter
         on NULL, which SQL treats as unknown and drops the person. */
      where: {
        accountId,
        orgId,
        /* Door-only staff (guards, drivers) open doors but are not expected at work (ClorTime attendance_required). */
        attendanceRequired: true,
        ...only,
        AND: [
          { OR: [{ dateOfLeaving: null }, { dateOfLeaving: { gte: from } }] },
          { OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: to } }] },
        ],
      },
      select: { id: true, name: true, code: true, department: true, departmentId: true, areaId: true, branchId: true, contractorId: true, guardianName: true, dateOfJoining: true, dateOfLeaving: true, status: true },
      orderBy: { name: 'asc' },
    }),
    peoplePrisma.attendanceRecord.findMany({ where: { accountId, orgId, date: { gte: from, lte: to }, ...(opts.employeeIds ? { employeeId: { in: opts.employeeIds } } : {}) } }),
    loadHolidays(orgId, from, to),
    loadSchedule(orgId),
  ]);
  const holidays = holidayData.rows;
  /* Company-wide holidays; holidaysFor(person) adds their area's and branch's, and the restricted holidays they picked. */
  const holidaySet = holidayData.company;
  const years = [...new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])];
  const picked = await peoplePrisma.holidayPick.findMany({ where: { orgId, year: { in: years } }, select: { employeeId: true, holidayId: true } });
  const optionalDates = picked.length ? new Map((await peoplePrisma.holiday.findMany({ where: { orgId, id: { in: [...new Set(picked.map((x) => x.holidayId))] }, date: { gte: from, lte: to } }, select: { id: true, date: true } })).map((h) => [h.id, h.date])) : new Map<string, string>();
  const pickedOf = new Map<string, string[]>();
  for (const x of picked) { const d = optionalDates.get(x.holidayId); if (d) pickedOf.set(x.employeeId, [...(pickedOf.get(x.employeeId) || []), d]); }
  /* Someone who moved branch or location in (or after) the period has each day's holidays from where they were that day. */
  const places = await placesSince(orgId, people.map((p) => p.id), from);
  const movedHolidays = new Map<string, Set<string>>();
  const holidaysFor = (p: { id?: string; areaId?: string | null; branchId?: string | null }) => {
    let base = holidayData.forArea(p.areaId, p.branchId);
    if (places.moved(p.id)) {
      if (!movedHolidays.has(p.id!)) {
        movedHolidays.set(p.id!, new Set(days.filter((d) => {
          const at = places.on(p, d);
          return holidayData.forArea(at.areaId, at.branchId).has(d);
        })));
      }
      base = movedHolidays.get(p.id!)!;
    }
    const mine = p.id ? pickedOf.get(p.id) : null;
    return mine?.length ? new Set([...base, ...mine]) : base;
  };
  /* Days on unpaid leave are loss of pay: find which leave days came from an
     unpaid type, including half-day fractions alongside worked time. */
  const leaveIds = [...new Set(records.filter((r) => r.leaveRequestId).map((r) => r.leaveRequestId!))];
  const leaveReqs = leaveIds.length
    ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, id: { in: leaveIds } }, select: { id: true, leaveTypeId: true, halfDay: true, minutes: true, days: true, status: true } })
    : [];
  const unpaidTypes = new Set(
    (await peoplePrisma.leaveType.findMany({ where: { orgId, isPaid: false }, select: { id: true } })).map((x) => x.id)
  );
  const unpaidRequest = new Map(leaveReqs.filter((r) => r.status === 'APPROVED' && unpaidTypes.has(r.leaveTypeId)).map((r) => [r.id, r.minutes ? r.days : r.halfDay ? 0.5 : 1]));
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
  /*
   * The first day the company kept attendance on CLOR (audit 7 Nov 2026, #5). A day before it with no
   * record was never tracked: it is not absent, not loss of pay and not "no record". A day before it
   * that does have a record (imported, marked by hand) counts as it always did.
   */
  const startDate = settings?.attendanceStartDate && ISO_DATE.test(settings.attendanceStartDate) ? settings.attendanceStartDate : null;
  const untracked = (employeeId: string, date: string) => Boolean(startDate && date < startDate && !recordsOf.get(employeeId)?.has(date));
  return { days, people, records, holidays, holidaySet, holidaysFor, shiftOn, recordsOf, spanOf, untracked, startDate, unpaidRequest, settings, today: today() };
}

/** Payable and loss-of-pay days per person for a month (the month summary, and Payroll's input). */
export async function monthRows(accountId: string, orgId: string, month: string) {
  return periodRows(accountId, orgId, daysOfMonth(month));
}

/** The same figures for any run of days — a pay period need not be a calendar month. */
export async function periodRows(accountId: string, orgId: string, days: string[]) {
  const ctx = await periodContext(accountId, orgId, days[0], days[days.length - 1]);
  /* Late marks and early exits under the company's rules: the part leave does not cover is loss of pay, never silently (markRules.ts). */
  const { penaltiesOver } = await import('./markRules.js');
  const penalties = await penaltiesOver(accountId, orgId, days, { ctx });
  /* Overtime at each day's rate, and the part over the company's caps (overtimePolicy.ts), beside the plain approved minutes Payroll reads. */
  const { overtimeDaysOver, overtimeTotals } = await import('./overtimeFigures.js');
  const overtime = await overtimeDaysOver(ctx, orgId);
  return ctx.people.map((p) => {
    const span = ctx.spanOf(p);
    const spanSet = new Set(span);
    const recs = ctx.recordsOf.get(p.id) || new Map();
    const unpaidLeaveDays = [...recs.values()].filter(
      (r) => spanSet.has(r.date) && r.leaveRequestId && ctx.unpaidRequest.has(r.leaveRequestId)
    ).reduce((sum, r) => sum + (ctx.unpaidRequest.get(r.leaveRequestId!) || 0), 0);
    const pen = penalties.get(p.id);
    /* Days before the company's attendance start with no record: paid as an employed day, never absent (#5). */
    const counted = span.filter((d) => !ctx.untracked(p.id, d));
    const untrackedDays = span.length - counted.length;
    const summary = monthSummary({
      days: counted,
      records: recs as any,
      shift: (d) => ctx.shiftOn(p.id, d).rule,
      holidays: ctx.holidaysFor(p),
      today: ctx.today,
      unpaidLeaveDays,
      penaltyDays: pen?.lossOfPayDays ?? 0,
    });
    return {
      employeeId: p.id,
      name: p.name,
      code: p.code,
      department: p.department,
      unpaidLeaveDays,
      ...summary,
      ...overtimeTotals(overtime.days.get(p.id), counted, overtime.policy),
      totalDays: summary.totalDays + untrackedDays,
      payableDays: summary.payableDays + untrackedDays,
      untrackedDays,
      earlyCount: pen?.earlyMarks ?? 0,
      penalty: pen && pen.status !== 'NONE' ? { status: pen.status, days: pen.days, lateMarks: pen.lateMarks, earlyMarks: pen.earlyMarks, fromLeaveDays: Math.round(pen.fromLeave.reduce((s, x) => s + x.days, 0) * 100) / 100 } : null,
    };
  });
}
