import { peoplePrisma, peopleWrite } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { assertMonthOpen } from './days.js';
import { logDayChange } from './history.js';
import { leaveYearOf } from './leaveBalances.js';
import { selfDecisionAllowed } from '../makerChecker.js';
import { notifyPermission } from '../notifications.js';
import { isWeeklyOff, istTime, monthSummary } from './compute.js';
import { loadHolidays, loadSchedule, resolveShift } from './schedule.js';
import { activeManagerOf, chainFor } from './approvalChain.js';
import { managerStepBy } from './standIns.js';
import { OVERTIME_SOURCE, attendanceOnEngine, closeOnEngine, decideOnEngine, engineOf, onEngine, openOnEngine, syncFromRow } from './attendanceEngine.js';
import { addDays as plusDays, eachDay, todayIst } from '../../utils/istDate.js';
export { todayIst };

/**
 * What an employee sees about their own attendance beyond the day itself:
 *  - the days that need attention, each with what to do about it;
 *  - their month, to confirm or dispute before the cutoff;
 *  - the shifts coming up;
 *  - overtime and comp-off;
 *  - where each request stands and who acts next.
 * The same rules as HR's screens; nothing here decides a day on its own.
 */
export type Who = { id: string; accountId: string; orgId: string; name: string; code: string | null; areaId: string | null; branchId: string | null };

const monthDays = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

export type AttentionItem = {
  date: string;
  kind: 'NO_PUNCHES' | 'ABSENT' | 'NO_OUT' | 'FIELD_WAITING' | 'FIX_WAITING';
  text: string;
  /** FIX: ask for a correction; NONE: nothing to do but wait. */
  action: 'FIX' | 'NONE';
  checkIn?: string | null;
};

/** Past working days with something missing or waiting, newest first. */
export async function attentionFor(e: Who, from: string, to: string): Promise<AttentionItem[]> {
  if (from > to) return [];
  const [schedule, holidays, records, corrections, field, leave] = await Promise.all([
    loadSchedule(e.orgId, [e.id]),
    loadHolidays(e.orgId, from, to),
    peoplePrisma.attendanceRecord.findMany({ where: { orgId: e.orgId, employeeId: e.id, date: { gte: from, lte: to } } }),
    peoplePrisma.attendanceRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id, status: 'PENDING', date: { gte: from, lte: to } }, select: { date: true } }),
    peoplePrisma.devicePunch.findMany({ where: { orgId: e.orgId, employeeId: e.id, outsideSite: true, reviewStatus: 'PENDING', shiftDate: { gte: from, lte: to } }, select: { shiftDate: true, localTime: true } }),
    peoplePrisma.leaveRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id, status: 'PENDING', fromDate: { lte: to }, toDate: { gte: from } }, select: { fromDate: true, toDate: true } }),
  ]);
  const mine = holidays.forArea(e.areaId, e.branchId);
  const byDate = new Map(records.map((r) => [r.date, r]));
  const fixing = new Set(corrections.map((c) => c.date));
  const leaveAsked = (d: string) => leave.some((l) => l.fromDate <= d && l.toDate >= d);
  const out: AttentionItem[] = [];
  for (const d of eachDay(from, to)) {
    const r = byDate.get(d);
    const working = !mine.has(d) && !isWeeklyOff(resolveShift(schedule, e.id, d).rule, d);
    if (fixing.has(d)) {
      out.push({ date: d, kind: 'FIX_WAITING', text: 'Your correction is waiting for a decision', action: 'NONE' });
      continue;
    }
    const waiting = field.filter((f) => f.shiftDate === d);
    if (waiting.length) {
      out.push({ date: d, kind: 'FIELD_WAITING', text: `Field punch${waiting.length === 1 ? '' : 'es'} at ${waiting.map((w) => w.localTime.slice(11, 16)).join(', ')} waiting for approval`, action: 'NONE' });
      continue;
    }
    if (!working || leaveAsked(d)) continue;
    if (!r) out.push({ date: d, kind: 'NO_PUNCHES', text: 'No punches on a working day', action: 'FIX' });
    else if (r.status === 'ABSENT') out.push({ date: d, kind: 'ABSENT', text: 'Marked absent', action: 'FIX', checkIn: r.checkIn ? istTime(r.checkIn) : null });
    else if (r.checkIn && !r.checkOut) out.push({ date: d, kind: 'NO_OUT', text: `In at ${istTime(r.checkIn)}, no punch out`, action: 'FIX', checkIn: istTime(r.checkIn) });
  }
  return out.reverse();
}

// ---------------------------------------------------------------------------
// Month review and confirmation
// ---------------------------------------------------------------------------

/** The cutoff to confirm a month: this day of the following month (the company sets the day). */
export const cutoffOf = (month: string, day: number) => {
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, Math.min(Math.max(day, 1), 28)));
  return next.toISOString().slice(0, 10);
};

export async function monthReview(e: Who, month: string) {
  const t = todayIst();
  const days = monthDays(month);
  const upTo = days.filter((d) => d <= t);
  const [schedule, holidays, records, settings, confirmation, overtime] = await Promise.all([
    loadSchedule(e.orgId, [e.id]),
    loadHolidays(e.orgId, days[0], days[days.length - 1]),
    peoplePrisma.attendanceRecord.findMany({ where: { orgId: e.orgId, employeeId: e.id, date: { gte: days[0], lte: days[days.length - 1] } } }),
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId: e.orgId } }),
    peoplePrisma.attendanceMonthConfirmation.findUnique({ where: { orgId_employeeId_month: { orgId: e.orgId, employeeId: e.id, month } } }),
    peoplePrisma.overtimeRequest.count({ where: { orgId: e.orgId, employeeId: e.id, status: 'PENDING', date: { gte: days[0], lte: days[days.length - 1] } } }),
  ]);
  const mine = holidays.forArea(e.areaId, e.branchId);
  /* The late-mark penalty under the company's rules, as payroll will take it (markRules.ts). */
  const { penaltiesOver } = await import('./markRules.js');
  const penalty = (await penaltiesOver(e.accountId, e.orgId, days, { employeeIds: [e.id] })).get(e.id);
  /* Before the company's attendance start date a day with no record is not counted, as on the register (audit #5, days.ts periodContext). */
  const start = settings?.attendanceStartDate || null;
  const recorded = new Set(records.map((r) => r.date));
  const counted = start ? days.filter((d) => d >= start || recorded.has(d)) : days;
  const untrackedDays = days.length - counted.length;
  const summary = monthSummary({
    days: counted,
    records: new Map(records.map((r) => [r.date, { status: r.status as any, lateMinutes: r.lateMinutes, overtimeMinutes: r.overtimeMinutes, overtimeApproved: r.overtimeApproved, checkIn: r.checkIn, checkOut: r.checkOut }])),
    shift: (d) => resolveShift(schedule, e.id, d).rule,
    holidays: mine,
    today: t,
    penaltyDays: penalty?.lossOfPayDays ?? 0,
  });
  const unresolved = upTo.length ? await attentionFor(e, days[0], upTo[upTo.length - 1] < t ? upTo[upTo.length - 1] : plusDays(t, -1)) : [];
  const cutoff = cutoffOf(month, settings?.confirmCutoffDay ?? 3);
  const ended = days[days.length - 1] < t || days[days.length - 1] === t;
  return {
    month,
    summary: {
      present: summary.present,
      halfDays: summary.halfDays,
      absent: summary.absent,
      leave: summary.leave,
      holidays: summary.holidays,
      weeklyOffs: summary.weeklyOffs,
      late: summary.lateCount,
      latePenaltyDays: summary.latePenaltyDays,
      lossOfPayDays: summary.lossOfPayDays,
      payableDays: summary.payableDays + untrackedDays,
      notYet: summary.notYet,
      workedMinutes: records.reduce((a, r) => a + (r.workedMinutes || 0), 0),
      overtimeMinutes: records.reduce((a, r) => a + (r.overtimeMinutes || 0), 0),
      approvedOvertimeMinutes: summary.approvedOvertimeMinutes,
    },
    unresolved,
    pendingOvertime: overtime,
    cutoff,
    canConfirm: ended && t <= cutoff,
    why: !ended ? 'You can confirm the month once it has ended.' : t > cutoff ? `The cutoff (${cutoff}) has passed. Ask HR to change anything still wrong.` : null,
    confirmation: confirmation ? { status: confirmation.status, note: confirmation.note, unresolved: confirmation.unresolved, at: confirmation.updatedAt } : null,
  };
}

export async function confirmMonth(e: Who, month: string, dispute: string | null) {
  const review = await monthReview(e, month);
  if (!review.canConfirm) throw Object.assign(new Error(review.why || 'This month cannot be confirmed now.'), { status: 409 });
  const status = dispute ? 'DISPUTED' : 'CONFIRMED';
  const row = await peoplePrisma.attendanceMonthConfirmation.upsert({
    where: { orgId_employeeId_month: { orgId: e.orgId, employeeId: e.id, month } },
    create: { accountId: e.accountId, orgId: e.orgId, employeeId: e.id, month, status, note: dispute, unresolved: review.unresolved.length },
    update: { status, note: dispute, unresolved: review.unresolved.length },
  });
  if (dispute) {
    await notifyPermission(e.accountId, e.orgId, 'ATTENDANCE::Attendance Records::EDIT', {
      kind: 'attendance.month_disputed',
      title: `${e.name}${e.code ? ` (${e.code})` : ''} says their ${month} attendance is wrong`,
      body: dispute.slice(0, 300),
      link: { app: 'attendance', screen: 'confirmations' },
    }).catch(() => null);
  }
  return row;
}

/** For HR's month close: who confirmed, who disputed (and why), who has not yet. */
export async function confirmationsFor(orgId: string, month: string) {
  const [rows, people] = await Promise.all([
    peoplePrisma.attendanceMonthConfirmation.findMany({ where: { orgId, month } }),
    peoplePrisma.employee.findMany({ where: { orgId, status: { not: 'LEFT' }, portalEnabled: true }, select: { id: true, name: true, code: true } }),
  ]);
  const by = new Map(rows.map((r) => [r.employeeId, r]));
  return {
    month,
    portalPeople: people.length,
    confirmed: rows.filter((r) => r.status === 'CONFIRMED').length,
    disputed: rows.filter((r) => r.status === 'DISPUTED').map((r) => ({ employeeId: r.employeeId, name: people.find((p) => p.id === r.employeeId)?.name || '—', note: r.note, at: r.updatedAt })),
    notYet: people.filter((p) => !by.has(p.id)).length,
  };
}

// ---------------------------------------------------------------------------
// Upcoming shifts
// ---------------------------------------------------------------------------

const SOURCE_SAYS: Record<string, string> = { TEMPORARY: 'Temporary change', ROTATION: 'Rotation', EMPLOYEE: 'Your shift', DEPARTMENT: 'Department shift', DEFAULT: 'Company shift' };

export async function upcomingShifts(e: Who, from: string, count: number) {
  const to = plusDays(from, count - 1);
  const [schedule, holidays, leave] = await Promise.all([
    loadSchedule(e.orgId, [e.id]),
    loadHolidays(e.orgId, from, to),
    peoplePrisma.leaveRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id, status: { in: ['APPROVED', 'PENDING'] }, fromDate: { lte: to }, toDate: { gte: from } }, select: { fromDate: true, toDate: true, status: true, halfDay: true } }),
  ]);
  const mine = holidays.forArea(e.areaId, e.branchId);
  return eachDay(from, to).map((d) => {
    const r = resolveShift(schedule, e.id, d);
    const l = leave.find((x) => x.fromDate <= d && x.toDate >= d);
    const holiday = mine.has(d) ? holidays.rows.find((h) => h.date === d && (!h.areaId || h.areaId === e.areaId))?.name || 'Holiday' : null;
    const off = isWeeklyOff(r.rule, d);
    return {
      date: d,
      kind: holiday ? 'HOLIDAY' : off ? 'OFF' : l ? (l.status === 'APPROVED' ? 'LEAVE' : 'LEAVE_ASKED') : 'WORK',
      shift: r.name,
      startTime: r.rule.startTime,
      endTime: r.rule.endTime,
      crossesMidnight: r.rule.endTime <= r.rule.startTime,
      color: r.color,
      holiday,
      halfDay: l?.halfDay ?? null,
      source: r.source,
      changed: r.source === 'TEMPORARY',
      sourceText: SOURCE_SAYS[r.source] || r.source,
    };
  });
}

// ---------------------------------------------------------------------------
// Overtime and comp-off
// ---------------------------------------------------------------------------

/** Days with overtime recorded, and worked rest days that could become comp-off. */
export async function overtimeFor(e: Who, month: string) {
  const days = monthDays(month);
  const [records, schedule, holidays, requests, settings] = await Promise.all([
    peoplePrisma.attendanceRecord.findMany({ where: { orgId: e.orgId, employeeId: e.id, date: { gte: days[0], lte: days[days.length - 1] } }, orderBy: { date: 'asc' } }),
    loadSchedule(e.orgId, [e.id]),
    loadHolidays(e.orgId, days[0], days[days.length - 1]),
    peoplePrisma.overtimeRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id, date: { gte: days[0], lte: days[days.length - 1] } }, orderBy: { createdAt: 'desc' } }),
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId: e.orgId } }),
  ]);
  const mine = holidays.forArea(e.areaId, e.branchId);
  const rest = (d: string) => mine.has(d) || isWeeklyOff(resolveShift(schedule, e.id, d).rule, d);
  const asked = (d: string, kind: string) => requests.find((r) => r.date === d && r.kind === kind && r.status !== 'CANCELLED');
  const rows = records
    .filter((r) => (r.overtimeMinutes || 0) > 0 || (rest(r.date) && r.checkIn))
    .map((r) => {
      const rule = resolveShift(schedule, e.id, r.date).rule;
      const restDay = rest(r.date) && Boolean(r.checkIn);
      const compOffDays = restDay ? ((r.workedMinutes || 0) >= rule.fullDayMinutes ? 1 : (r.workedMinutes || 0) >= rule.halfDayMinutes ? 0.5 : 0) : 0;
      const ot = asked(r.date, 'OVERTIME');
      const co = asked(r.date, 'COMP_OFF');
      return {
        date: r.date,
        workedMinutes: r.workedMinutes || 0,
        overtimeMinutes: r.overtimeMinutes || 0,
        overtimeApproved: r.overtimeApproved,
        restDay,
        compOffDays,
        overtimeRequest: ot ? { id: ot.id, status: ot.status, note: ot.reviewNote } : null,
        compOffRequest: co ? { id: co.id, status: co.status, days: co.days, note: co.reviewNote } : null,
        canAskOvertime: Boolean(settings?.overtimeRequests ?? true) && (r.overtimeMinutes || 0) > 0 && !r.overtimeApproved && !ot,
        canAskCompOff: Boolean(settings?.compOffEnabled && settings.compOffLeaveTypeId) && compOffDays > 0 && !co,
      };
    });
  return {
    month,
    recordedMinutes: rows.reduce((a, r) => a + r.overtimeMinutes, 0),
    approvedMinutes: rows.filter((r) => r.overtimeApproved).reduce((a, r) => a + r.overtimeMinutes, 0),
    pendingMinutes: rows.filter((r) => r.overtimeRequest?.status === 'PENDING').reduce((a, r) => a + r.overtimeMinutes, 0),
    policy: { overtimeRequests: settings?.overtimeRequests ?? true, compOff: Boolean(settings?.compOffEnabled && settings?.compOffLeaveTypeId) },
    days: rows,
  };
}

export async function askOvertime(e: Who, date: string, kind: 'OVERTIME' | 'COMP_OFF', reason: string) {
  const view = await overtimeFor(e, date.slice(0, 7));
  const row = view.days.find((d) => d.date === date);
  if (!row) throw Object.assign(new Error('There is no overtime or rest-day work recorded on that day.'), { status: 400 });
  if (kind === 'OVERTIME' && !row.canAskOvertime) throw Object.assign(new Error(view.policy.overtimeRequests ? 'That overtime is already approved or asked for.' : 'Your company does not take overtime requests.'), { status: 409 });
  if (kind === 'COMP_OFF' && !row.canAskCompOff) throw Object.assign(new Error(view.policy.compOff ? 'Comp-off for that day is already asked for, or the day was too short.' : 'Your company does not give comp-off.'), { status: 409 });
  const data = { accountId: e.accountId, orgId: e.orgId, employeeId: e.id, date, kind, minutes: kind === 'OVERTIME' ? row.overtimeMinutes : row.workedMinutes, days: kind === 'COMP_OFF' ? row.compOffDays : 0, reason: reason.slice(0, 500) };
  if (!(await attendanceOnEngine(e.orgId))) return peoplePrisma.overtimeRequest.create({ data });
  /* On the approval engine (workflow engine 2d): the request and its engine request commit together, under the overtime chain. */
  return peopleWrite(e.orgId, async () => {
    const created = await peoplePrisma.overtimeRequest.create({ data });
    const person = await peoplePrisma.employee.findFirst({ where: { id: e.id, orgId: e.orgId }, select: { userId: true } });
    const opened = await openOnEngine({ accountId: e.accountId, orgId: e.orgId, source: OVERTIME_SOURCE, sourceId: created.id, kind, employeeId: e.id, chain: await overtimeChain(e.orgId), title: `${e.name}: ${kind === 'COMP_OFF' ? 'comp-off' : 'overtime'}, ${date}`, enteredBy: person?.userId || `portal:${e.id}` });
    return opened.done ? peoplePrisma.overtimeRequest.findFirstOrThrow({ where: { id: created.id } }) : created;
  });
}

/**
 * Decide an overtime or comp-off request. Approved overtime marks the day's
 * overtime approved (it then counts in payroll); approved comp-off adds its
 * days to the employee's allocation of the comp-off leave type for that year.
 * `managerId`: the decision is a manager's (their reportee only, and under
 * MANAGER_THEN_HR it passes the request on to HR rather than closing it).
 * On the approval engine (workflow engine 2d) the same checks run first, with
 * the chain the request was asked under, and the engine takes the step.
 */
export async function decideOvertime(orgId: string, id: string, approve: boolean, by: { userId: string; managerId?: string }, note: string | null) {
  const r = await peoplePrisma.overtimeRequest.findFirst({ where: { id, orgId } });
  if (!r) throw Object.assign(new Error('No such request.'), { status: 404 });
  if (r.status !== 'PENDING') {
    await peopleWrite(orgId, () => syncFromRow(r.accountId, orgId, OVERTIME_SOURCE, r.id));
    throw Object.assign(new Error(`This request was already ${r.status.toLowerCase()}.`), { status: 409 });
  }
  /* Nobody decides their own overtime or comp-off (closure audit, 27 Oct 2026). */
  const subject = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { userId: true, reportingManagerId: true } });
  const ownByLogin = Boolean(subject?.userId && subject.userId === by.userId);
  if ((by.managerId && by.managerId === r.employeeId && !ownByLogin) || (ownByLogin && !(await selfDecisionAllowed(r.accountId, orgId, by.userId, 'ATTENDANCE::Attendance Records::EDIT')).allowed)) {
    throw Object.assign(new Error('This is your own request; somebody else has to decide it.'), { status: 403, code: 'OWN_RECORD' });
  }
  /* On the approval engine: the chain it was asked under, and a manager's step the engine closed reads as passed to HR. */
  const engine = await engineOf(orgId, OVERTIME_SOURCE, r.id);
  const on = onEngine(engine);
  const chain = on ? (((engine.payload as { chain?: string })?.chain || 'HR') as Awaited<ReturnType<typeof overtimeChain>>) : await overtimeChain(orgId);
  const passed = Boolean(r.managerApprovedAt || (on && engine.currentStep > 1));
  const audit = (action: string, message: string) =>
    platformPrisma.auditLog
      .create({ data: { accountId: r.accountId, orgId, branchId: '', entity: 'OvertimeRequest', entityId: r.id, action, message: message.slice(0, 500), metadata: JSON.stringify({ employeeId: r.employeeId, kind: r.kind, date: r.date, days: r.days, note }), createdByUserId: by.userId } })
      .catch((e) => console.error('[audit] OvertimeRequest not recorded:', e instanceof Error ? e.message : e)); // eslint-disable-line no-console
  if (by.managerId) {
    /* Their manager, or whoever stands in for that manager today (time depth review). */
    if (!(await managerStepBy(orgId, by.managerId, r.employeeId, undefined, 'ATTENDANCE'))) throw Object.assign(new Error('This request is not yours to decide.'), { status: 403 });
    if (chain === 'HR') throw Object.assign(new Error('HR decides overtime and comp-off at this company.'), { status: 403 });
    if (chain === 'MANAGER_THEN_HR' && passed) throw Object.assign(new Error('You have already approved this; it is with HR now.'), { status: 409 });
    if (approve && chain === 'MANAGER_THEN_HR' && !on) {
      const claimed = await peoplePrisma.overtimeRequest.updateMany({ where: { id: r.id, status: 'PENDING', managerApprovedAt: null }, data: { managerApprovedAt: new Date(), managerApprovedById: by.managerId, reviewNote: note } });
      if (!claimed.count) throw Object.assign(new Error('This request was already decided.'), { status: 409 });
      await audit('MANAGER_APPROVE', `Manager approved ${r.kind === 'OVERTIME' ? 'overtime' : 'comp-off'} for ${r.date}; now with HR`);
      return peoplePrisma.overtimeRequest.findFirstOrThrow({ where: { id: r.id } });
    }
  } else if (chain === 'MANAGER_THEN_HR' && !passed) {
    /* A manager who has left or is suspended is no manager: HR decides. */
    if (approve && (await activeManagerOf(orgId, r.employeeId))) throw Object.assign(new Error('The manager approves this first.'), { status: 409 });
  } else if (chain === 'MANAGER') {
    /* The manager alone decides at this company; HR only when there is no active manager. */
    if (approve && (await activeManagerOf(orgId, r.employeeId))) throw Object.assign(new Error('The manager decides overtime at this company.'), { status: 409, code: 'MANAGER_DECIDES' });
  }
  if (on) {
    const out = await peopleWrite(orgId, async () => {
      const res = await decideOnEngine({ accountId: r.accountId, orgId, source: OVERTIME_SOURCE, sourceId: r.id, userId: by.userId, approve, note, managerTook: { at: r.managerApprovedAt, byEmployeeId: r.managerApprovedById }, ownAllowed: ownByLogin });
      if (!res) throw Object.assign(new Error('This request was already decided.'), { status: 409 });
      if (res.direct) {
        /* HR rejecting while the manager decides, or the person's own decision where the company allows it, as today: written here, and the engine request closes to match. */
        const row = await writeOvertimeDecision(orgId, r.id, approve, by.userId, note);
        await closeOnEngine(r.accountId, orgId, OVERTIME_SOURCE, r.id, approve ? 'APPROVED' : 'REJECTED', `${approve ? 'Approved' : 'Rejected'} outside the steps`, by.userId);
        return { row, managerStep: false };
      }
      if (res.managerStep) {
        const claimed = await peoplePrisma.overtimeRequest.updateMany({ where: { id: r.id, status: 'PENDING', managerApprovedAt: null }, data: { managerApprovedAt: new Date(), managerApprovedById: by.managerId || null, reviewNote: note } });
        if (!claimed.count) throw Object.assign(new Error('This request was already decided.'), { status: 409 });
      }
      return { row: await peoplePrisma.overtimeRequest.findFirstOrThrow({ where: { id: r.id } }), managerStep: res.managerStep };
    }).catch((e: any) => {
      if (approve && ownByLogin && e?.code === 'NOT_YOUR_STEP') throw Object.assign(new Error('This is your own request; somebody else has to decide it.'), { status: 403, code: 'OWN_RECORD' });
      throw e;
    });
    if (out.managerStep) await audit('MANAGER_APPROVE', `Manager approved ${r.kind === 'OVERTIME' ? 'overtime' : 'comp-off'} for ${r.date}; now with HR`);
    else if (out.row.status !== 'PENDING') await audit(out.row.status === 'APPROVED' ? 'APPROVE' : 'REJECT', `${out.row.status === 'APPROVED' ? 'Approved' : 'Rejected'} ${r.kind === 'OVERTIME' ? 'overtime' : `${r.days} day comp-off`} for ${r.date}${note ? `: ${note}` : ''}`);
    return out.row;
  }
  /*
   * One transaction, claimed by status: two people deciding at once cannot
   * both credit comp-off or both approve. Overtime is paid in the month, so a
   * closed month refuses it; comp-off is a dated credit like HR's grant
   * (a LeaveAdjustment with the day worked), in the leave period of that day,
   * once per day worked whichever way it was asked for.
   */
  const row = await peopleWrite(orgId, () => writeOvertimeDecision(orgId, r.id, approve, by.userId, note));
  await audit(approve ? 'APPROVE' : 'REJECT', `${approve ? 'Approved' : 'Rejected'} ${r.kind === 'OVERTIME' ? 'overtime' : `${r.days} day comp-off`} for ${r.date}${note ? `: ${note}` : ''}`);
  return row;
}

/**
 * The decision itself, inside the caller's People transaction: claimed by status, the day's overtime approved or the
 * comp-off credited. The old path calls it directly; on the approval engine it runs when the last step is approved or
 * the request rejected (attendanceEngine.ts), in the same transaction as the step.
 */
export async function writeOvertimeDecision(orgId: string, id: string, approve: boolean, userId: string, note: string | null) {
  const r = await peoplePrisma.overtimeRequest.findFirst({ where: { id, orgId } });
  if (!r) throw Object.assign(new Error('No such request.'), { status: 404 });
  const claimed = await peoplePrisma.overtimeRequest.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED', reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: note } });
  if (!claimed.count) throw Object.assign(new Error('This request was already decided.'), { status: 409 });
  if (approve && r.kind === 'OVERTIME') {
    await assertMonthOpen(orgId, r.date, r.employeeId);
    const day = await peoplePrisma.attendanceRecord.findFirst({ where: { orgId, employeeId: r.employeeId, date: r.date } });
    if (day) {
      const after = await peoplePrisma.attendanceRecord.update({ where: { id: day.id }, data: { overtimeApproved: true } });
      await logDayChange({ accountId: r.accountId, orgId, employeeId: r.employeeId, date: r.date, recordId: day.id, action: 'OVERTIME', before: day, after, userId, reason: `Overtime request approved${note ? `: ${note}` : ''}` });
    }
  } else if (approve) {
    const settings = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { compOffLeaveTypeId: true } });
    if (!settings?.compOffLeaveTypeId) throw Object.assign(new Error('Choose the comp-off leave type first (Overtime & comp-off settings).'), { status: 409 });
    const twice = await peoplePrisma.leaveAdjustment.findFirst({ where: { orgId, reversedAt: null, employeeId: r.employeeId, leaveTypeId: settings.compOffLeaveTypeId, workedOn: r.date } });
    if (twice) throw Object.assign(new Error(`Comp-off for ${r.date} is already granted.`), { status: 409, code: 'COMP_OFF_TWICE' });
    await peoplePrisma.leaveAdjustment.create({ data: { accountId: r.accountId, orgId, employeeId: r.employeeId, leaveTypeId: settings.compOffLeaveTypeId, year: await leaveYearOf(orgId, r.date), days: r.days, kind: 'ADJUST', reason: `Comp-off for ${r.date} (request approved)${note ? `: ${note}` : ''}`.slice(0, 500), workedOn: r.date, createdByUserId: userId } });
  }
  return peoplePrisma.overtimeRequest.findFirstOrThrow({ where: { id: r.id } });
}

export async function overtimeChain(orgId: string) {
  const s = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { overtimeApproval: true } });
  return (['HR', 'MANAGER', 'MANAGER_THEN_HR'].includes(String(s?.overtimeApproval)) ? s!.overtimeApproval : 'HR') as 'HR' | 'MANAGER' | 'MANAGER_THEN_HR';
}

// ---------------------------------------------------------------------------
// Request timeline: who acts next
// ---------------------------------------------------------------------------

export type Step = { label: string; state: 'DONE' | 'NOW' | 'LATER' | 'REFUSED' | 'WITHDRAWN'; at?: Date | null; who?: string | null };

/**
 * The steps a request goes through under the company's approval chain, with
 * what is done, who acts now, and why it was refused.
 */
export function timelineOf(r: { createdAt: Date; status: string; managerApprovedAt?: Date | null; reviewedAt?: Date | null; reviewNote?: string | null }, chain: 'HR' | 'MANAGER' | 'MANAGER_THEN_HR', names: { manager: string | null }) {
  const steps: Step[] = [{ label: 'Sent', state: 'DONE', at: r.createdAt }];
  const managerStep = chain !== 'HR' && names.manager;
  const decided = r.status === 'APPROVED' || r.status === 'REJECTED';
  if (r.status === 'CANCELLED') {
    steps.push({ label: 'Withdrawn', state: 'WITHDRAWN', at: r.reviewedAt ?? null });
    return { steps, next: null as string | null };
  }
  if (managerStep && chain === 'MANAGER_THEN_HR') {
    steps.push({ label: `${names.manager} (manager)`, state: r.managerApprovedAt || decided ? (r.status === 'REJECTED' && !r.managerApprovedAt ? 'REFUSED' : 'DONE') : 'NOW', at: r.managerApprovedAt ?? (r.status === 'REJECTED' && !r.managerApprovedAt ? r.reviewedAt : null), who: names.manager });
    if (!(r.status === 'REJECTED' && !r.managerApprovedAt)) steps.push({ label: 'HR', state: decided ? (r.status === 'APPROVED' ? 'DONE' : 'REFUSED') : r.managerApprovedAt ? 'NOW' : 'LATER', at: decided ? r.reviewedAt : null, who: 'HR' });
  } else {
    const who = managerStep && chain === 'MANAGER' ? `${names.manager} (manager)` : 'HR';
    steps.push({ label: who, state: decided ? (r.status === 'APPROVED' ? 'DONE' : 'REFUSED') : 'NOW', at: decided ? r.reviewedAt : null, who });
  }
  steps.push({ label: r.status === 'REJECTED' ? `Declined${r.reviewNote ? `: ${r.reviewNote}` : ''}` : 'Approved', state: r.status === 'APPROVED' ? 'DONE' : r.status === 'REJECTED' ? 'REFUSED' : 'LATER', at: decided ? r.reviewedAt : null });
  const now = steps.find((s) => s.state === 'NOW');
  return { steps, next: now ? now.who || now.label : null };
}

/**
 * The same for leave under the company's leave rule (services/attendance/leaveRules.ts):
 * each step someone approved, the step waiting now and who it waits for.
 */
export function ruleTimelineOf(r: { createdAt: Date; status: string; ruleStep?: number | null; reviewedAt?: Date | null; reviewNote?: string | null; history?: unknown }, waitingFor: string | null) {
  const steps: Step[] = [{ label: 'Sent', state: 'DONE', at: r.createdAt }];
  if (r.status === 'CANCELLED') {
    steps.push({ label: 'Withdrawn', state: 'WITHDRAWN', at: r.reviewedAt ?? null });
    return { steps, next: null as string | null };
  }
  const taken = ((Array.isArray(r.history) ? r.history : []) as Array<{ at?: string; what?: string; note?: string | null }>).filter((h) => h.what === 'STEP_APPROVED');
  for (const h of taken) steps.push({ label: String(h.note || 'A step').split(':')[0], state: 'DONE', at: h.at ? new Date(h.at) : null });
  if (r.status === 'PENDING' && r.ruleStep) steps.push({ label: `Step ${r.ruleStep}`, state: 'NOW', who: waitingFor });
  const decided = r.status === 'APPROVED' || r.status === 'REJECTED';
  steps.push({ label: r.status === 'REJECTED' ? `Declined${r.reviewNote ? `: ${r.reviewNote}` : ''}` : 'Approved', state: r.status === 'APPROVED' ? 'DONE' : r.status === 'REJECTED' ? 'REFUSED' : 'LATER', at: decided ? r.reviewedAt : null });
  const now = steps.find((s) => s.state === 'NOW');
  return { steps, next: now ? now.who || now.label : null };
}

export async function chainsFor(orgId: string) {
  const [leave, correction, overtime] = await Promise.all([chainFor(orgId, 'leave'), chainFor(orgId, 'correction'), overtimeChain(orgId)]);
  /* The employee app knows three shapes; "HR only" reads as HR there (the manager has no step in either). */
  return { leave, correction: correction === 'HR_ONLY' ? 'HR' : correction, overtime } as Record<'leave' | 'correction' | 'overtime', 'HR' | 'MANAGER' | 'MANAGER_THEN_HR'>;
}
