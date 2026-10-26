import { peoplePrisma, peopleWrite, afterPeopleCommit } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { computeDay, isWeeklyOff, istDate, istInstant, istTime, monthSummary } from './compute.js';
import { loadHolidays, loadSchedule, resolveShift } from './schedule.js';
import { emit as emitWebhook } from './webhooks.js';
import { logDayChange } from './history.js';
import { permissionCovers } from './permissionWindow.js';

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

/**
 * A company holiday, or one for the person's area (ClorTime's holiday
 * locations); with `employeeId`, also a restricted holiday that person picked
 * for themselves (HolidayPick).
 */
export async function isHoliday(orgId: string, date: string, branchId: string | null, areaId: string | null = null, employeeId: string | null = null) {
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
  /**
   * An approved attendance request on this day (WFH | ON_DUTY | PERMISSION)
   * and its id. Left out: the day keeps what it had, so a reader's punch does
   * not wipe an approved WFH. null clears it (the request was cancelled).
   */
  dayKind?: string | null;
  attendanceRequestId?: string | null;
}) {
  return peopleWrite(opts.orgId, async () => {
    /* Every way a day is written comes through here, so a closed month is held shut in one place. */
    await assertMonthOpen(opts.orgId, opts.date);
    // Resolve leave for every source, not just biometric readers.
    const { shiftId, rule } = await shiftFor(opts.orgId, opts.employee.id, opts.date);
    const holiday = await isHoliday(opts.orgId, opts.date, opts.employee.branchId, opts.employee.areaId ?? null, opts.employee.id);
    const before = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: opts.employee.id, date: opts.date } } });
    const approved = await peoplePrisma.leaveRequest.findFirst({ where: {
      orgId: opts.orgId, employeeId: opts.employee.id, status: 'APPROVED',
      fromDate: { lte: opts.date }, toDate: { gte: opts.date },
    } });
    if (approved && (approved.halfDay || before?.leaveRequestId === approved.id || (!holiday && !isWeeklyOff(rule, opts.date))) && opts.leaveRequestId === undefined) {
      opts = { ...opts, leaveRequestId: approved.id, halfDayLeave: approved.halfDay as 'FIRST' | 'SECOND' | null };
      if (!approved.halfDay) {
        if (opts.checkIn) throw fail(409, 'Cancel the approved leave before recording work on this day.', 'LEAVE_CONFLICT');
        opts.statusOverride = 'ON_LEAVE';
      }
    }
    if (opts.statusOverride === 'ON_LEAVE' && !opts.leaveRequestId) {
      throw fail(409, 'Apply and approve a leave type in People → Leave Requests so the balance is deducted.', 'LEAVE_REQUEST_REQUIRED');
    }
    const computed = computeDay({
      date: opts.date,
      shift: rule,
      checkIn: opts.checkIn,
      checkOut: opts.checkOut,
      isHoliday: holiday,
      onLeave: opts.statusOverride === 'ON_LEAVE',
    });
    const half = opts.halfDayLeave || null;
    const status = half
      ? (computed.workedMinutes || 0) >= rule.halfDayMinutes ? 'PRESENT' : 'HALF_DAY'
      : opts.statusOverride && !opts.checkIn ? opts.statusOverride : computed.status;
    if (half === 'FIRST') computed.lateMinutes = 0;
    if (half === 'SECOND') computed.earlyOutMinutes = 0;
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
    const record = await peoplePrisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: opts.employee.id, date: opts.date } },
      create: { accountId: opts.accountId, orgId: opts.orgId, employeeId: opts.employee.id, date: opts.date, createdByUserId: opts.userId, ...data },
      update: { ...data, overtimeApproved: false },
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
  /* Company-wide holidays; holidaysFor(person) adds their area's and branch's, and the restricted holidays they picked. */
  const holidaySet = holidayData.company;
  const years = [...new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])];
  const picked = await peoplePrisma.holidayPick.findMany({ where: { orgId, year: { in: years } }, select: { employeeId: true, holidayId: true } });
  const optionalDates = picked.length ? new Map((await peoplePrisma.holiday.findMany({ where: { orgId, id: { in: [...new Set(picked.map((x) => x.holidayId))] }, date: { gte: from, lte: to } }, select: { id: true, date: true } })).map((h) => [h.id, h.date])) : new Map<string, string>();
  const pickedOf = new Map<string, string[]>();
  for (const x of picked) { const d = optionalDates.get(x.holidayId); if (d) pickedOf.set(x.employeeId, [...(pickedOf.get(x.employeeId) || []), d]); }
  const holidaysFor = (p: { id?: string; areaId?: string | null; branchId?: string | null }) => {
    const base = holidayData.forArea(p.areaId, p.branchId);
    const mine = p.id ? pickedOf.get(p.id) : null;
    return mine?.length ? new Set([...base, ...mine]) : base;
  };
  /* Days on unpaid leave are loss of pay: find which leave days came from an
     unpaid type, including half-day fractions alongside worked time. */
  const leaveIds = [...new Set(records.filter((r) => r.leaveRequestId).map((r) => r.leaveRequestId!))];
  const leaveReqs = leaveIds.length
    ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, id: { in: leaveIds } }, select: { id: true, leaveTypeId: true, halfDay: true, status: true } })
    : [];
  const unpaidTypes = new Set(
    (await peoplePrisma.leaveType.findMany({ where: { orgId, isPaid: false }, select: { id: true } })).map((x) => x.id)
  );
  const unpaidRequest = new Map(leaveReqs.filter((r) => r.status === 'APPROVED' && unpaidTypes.has(r.leaveTypeId)).map((r) => [r.id, r.halfDay ? 0.5 : 1]));
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
      (r) => spanSet.has(r.date) && r.leaveRequestId && ctx.unpaidRequest.has(r.leaveRequestId)
    ).reduce((sum, r) => sum + (ctx.unpaidRequest.get(r.leaveRequestId!) || 0), 0);
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
