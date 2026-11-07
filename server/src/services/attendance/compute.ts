/**
 * A working day, worked out.
 *
 * Given a shift, the day, when someone came and went, and whether the day was
 * a holiday or a weekly off, this answers what the books of a factory would:
 * minutes worked, minutes late, minutes left early, overtime, and whether the
 * day counts as present, half or absent. Pure: no database, so the rules can
 * be tested on their own and every screen and report gets the same answer.
 *
 * Rules (after Horilla HRMS's attendance, adapted):
 * - The shift clock is Indian Standard Time (UTC+5:30, no daylight saving).
 * - An end at or before the start is a night shift ending the next day; the
 *   day belongs to the date it starts.
 * - Late: arriving after start + grace; once late, it counts from the start.
 * - Early out: leaving before end − early-out grace; counts to the end.
 * - Worked: out − in, less the break when the span is longer than a half day.
 * - Status: a full day's minutes (`fullDayNeeded`, below) → PRESENT, half-day
 *   minutes → HALF_DAY, less → ABSENT. Checked in but not out yet → PRESENT,
 *   provisionally, 0 minutes.
 * - Overtime: worked beyond `overtimeAfterMinutes` (default the full day). On
 *   a holiday or weekly off, every minute worked is overtime.
 *
 * The full-day rule (audit 7 Nov 2026, P0): working the shift as scheduled is
 * always a full day. A day counts as present at the shift's own net minutes
 * (start to end, less the break) less the late grace and the early-out
 * grace, or at `fullDayMinutes` if that is lower. So on 09:00–18:00 with a
 * 60-minute break and 10 minutes' grace, 09:10–18:00 (470 minutes) is
 * present; 09:11–18:00 is 11 minutes late and short of the shift, so a half
 * day, as before. Before this, present needed `fullDayMinutes` (480) whatever
 * the shift, so anyone using the grace lost half a day, and a 22:00–06:00
 * shift with a 30-minute break (450 at most) could never be present. The
 * grace is shared: in on time and out up to both graces early is present too
 * (with its early-out mark). A shift cannot be saved with a full day longer
 * than its net minutes (`shiftRuleProblem`); shifts saved before that are
 * scored by the same rule, so they are covered as well.
 */

import { istDate } from '../../utils/istDate.js';

export const IST_OFFSET_MINUTES = 330;

export type ShiftRule = {
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  breakMinutes: number;
  graceMinutes: number;
  earlyOutGraceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  overtimeAfterMinutes: number | null;
  weeklyOffDays: string; // "0,6"
  /** Saturdays of the month that are off as well: "2,4" = second and fourth. */
  offSaturdays?: string;
  /** The punch window: a reader punch this long before the start, or after the end, does not count. Null or absent = no limit. */
  checkInBeforeMinutes?: number | null;
  checkOutAfterMinutes?: number | null;
};

export type DayStatus = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF';

export type DayResult = {
  workedMinutes: number;
  lateMinutes: number;
  earlyOutMinutes: number;
  overtimeMinutes: number;
  status: DayStatus;
};

export const DEFAULT_SHIFT: ShiftRule = {
  startTime: '09:00',
  endTime: '18:00',
  breakMinutes: 60,
  graceMinutes: 10,
  earlyOutGraceMinutes: 0,
  halfDayMinutes: 240,
  fullDayMinutes: 480,
  overtimeAfterMinutes: null,
  weeklyOffDays: '0',
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isHHMM = (s: string) => HHMM.test(String(s || ''));
const minutesOf = (hhmm: string) => {
  const m = HHMM.exec(hhmm);
  if (!m) throw new Error(`Not a time: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
};

/** The instant a local (IST) wall-clock time on a date happens. */
export const istInstant = (date: string, hhmm: string, addDays = 0): Date => {
  const [y, mo, d] = date.split('-').map(Number);
  const utcMs = Date.UTC(y, mo - 1, d + addDays, 0, 0) + (minutesOf(hhmm) - IST_OFFSET_MINUTES) * 60_000;
  return new Date(utcMs);
};

/** The IST calendar date of an instant, YYYY-MM-DD (utils/istDate). */
export { istDate };

/** The IST wall-clock time of an instant, HH:MM. */
export const istTime = (at: Date): string => new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(11, 16);

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date. */
export const weekday = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

const numbers = (s: string | undefined) =>
  String(s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number);

/** A weekly off: one of the shift's off weekdays, or an nth Saturday it gives off (ClorTime isWeekOff). */
export const isWeeklyOff = (shift: ShiftRule, date: string) => {
  const wd = weekday(date);
  if (numbers(shift.weeklyOffDays).includes(wd)) return true;
  if (wd === 6) return numbers(shift.offSaturdays).includes(Math.ceil(Number(date.slice(8, 10)) / 7));
  return false;
};

/** Shift start and end instants for a date, night shifts ending the next day. */
export const shiftWindow = (shift: ShiftRule, date: string) => {
  const start = istInstant(date, shift.startTime);
  const crosses = minutesOf(shift.endTime) <= minutesOf(shift.startTime);
  const end = istInstant(date, shift.endTime, crosses ? 1 : 0);
  return { start, end };
};

/** A shift that ends the next day: its end at or before its start (22:00–06:00). */
export const isOvernight = (shift: Pick<ShiftRule, 'startTime' | 'endTime'>) => minutesOf(shift.endTime) <= minutesOf(shift.startTime);

/** How the screens name an overnight shift: "Night shift 22:00–06:00 (ends next day)". */
export const nightShiftLabel = (shift: Pick<ShiftRule, 'startTime' | 'endTime'>) => `Night shift ${shift.startTime}–${shift.endTime} (ends next day)`;

/**
 * The two halves of a shift on its date, for a half-day leave: the first half
 * from the start to the midpoint, the second from the midpoint to the end. A
 * night shift's midpoint is after midnight (22:00–06:00 splits at 02:00).
 */
export const shiftHalves = (shift: ShiftRule, date: string) => {
  const { start, end } = shiftWindow(shift, date);
  const mid = new Date(start.getTime() + Math.round((end.getTime() - start.getTime()) / 2 / 60_000) * 60_000);
  return { FIRST: { from: start, to: mid }, SECOND: { from: mid, to: end } };
};

/**
 * Wall-clock times written for a night shift's date (a correction, a missed
 * punch, a manager's entry) as the instants they mean. A time before the
 * shift's start and before noon is after midnight, on the next calendar day:
 * in 00:30 on a 22:00–06:00 shift is half past midnight that night, not the
 * morning before it began. Noon, because no night shift starts before it and
 * none ends after it (the same boundary readers use, adms.ts shiftDayOf). An
 * out at or before the in is later again, as for any day.
 */
export const nightInstants = (date: string, shift: Pick<ShiftRule, 'startTime' | 'endTime'>, inHHMM?: string | null, outHHMM?: string | null) => {
  const start = minutesOf(shift.startTime);
  const nextDay = (hhmm: string) => (minutesOf(hhmm) < start && minutesOf(hhmm) < 12 * 60 ? 1 : 0);
  const checkIn = inHHMM ? istInstant(date, inHHMM, nextDay(inHHMM)) : null;
  let checkOut = outHHMM ? istInstant(date, outHHMM, nextDay(outHHMM)) : null;
  if (checkIn && checkOut && checkOut <= checkIn) checkOut = istInstant(date, outHHMM!, nextDay(outHHMM!) + 1);
  return { checkIn, checkOut };
};

const mins = (ms: number) => Math.max(0, Math.round(ms / 60_000));

/** Minutes from start to end as scheduled: a night shift runs past midnight, and an end equal to the start is 24 hours. */
export const shiftSpanMinutes = (shift: Pick<ShiftRule, 'startTime' | 'endTime'>) => {
  const d = minutesOf(shift.endTime) - minutesOf(shift.startTime);
  return d > 0 ? d : d + 24 * 60;
};

/* The break comes off a longer day, but never takes it back under half a day: staying longer must not score worse. */
const netOf = (shift: Pick<ShiftRule, 'breakMinutes' | 'halfDayMinutes'>, span: number) =>
  span > shift.halfDayMinutes ? Math.max(shift.halfDayMinutes, span - shift.breakMinutes) : span;

/** The minutes worked by someone in at the start and out at the end: the span less the break. */
export const scheduledMinutes = (shift: Pick<ShiftRule, 'startTime' | 'endTime' | 'breakMinutes' | 'halfDayMinutes'>) => netOf(shift, shiftSpanMinutes(shift));

/**
 * The minutes that make a day PRESENT: the shift's net minutes less both
 * graces, or the shift's `fullDayMinutes` when that is lower (a flexible
 * shift asking for 6 hours inside a 9-hour window). At least a minute.
 */
export const fullDayNeeded = (shift: Pick<ShiftRule, 'startTime' | 'endTime' | 'breakMinutes' | 'halfDayMinutes' | 'fullDayMinutes' | 'graceMinutes' | 'earlyOutGraceMinutes'>) =>
  Math.max(1, Math.min(shift.fullDayMinutes, scheduledMinutes(shift) - (shift.graceMinutes || 0) - (shift.earlyOutGraceMinutes || 0)));

const hoursWords = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;

/**
 * Why a shift's numbers do not hold together, or null. A full day longer than
 * the shift itself could never be reached by anyone working it as scheduled.
 */
export function shiftRuleProblem(shift: Pick<ShiftRule, 'startTime' | 'endTime' | 'breakMinutes' | 'halfDayMinutes' | 'fullDayMinutes'>): string | null {
  if (shift.halfDayMinutes > shift.fullDayMinutes) return 'A half day cannot be longer than a full day.';
  const net = scheduledMinutes(shift);
  if (shift.fullDayMinutes > net) {
    return `A full day cannot be longer than the shift: ${shift.startTime}–${shift.endTime} less the ${shift.breakMinutes} min break is ${hoursWords(net)}. Set the full day to ${net} minutes or less.`;
  }
  return null;
}

export function computeDay(input: {
  date: string;
  shift: ShiftRule;
  checkIn: Date | null;
  checkOut: Date | null;
  isHoliday?: boolean;
  onLeave?: boolean;
}): DayResult {
  const { date, shift, checkIn, checkOut } = input;
  const off = isWeeklyOff(shift, date);
  const restDay: DayStatus | null = input.isHoliday ? 'HOLIDAY' : off ? 'WEEKLY_OFF' : null;
  const none = { workedMinutes: 0, lateMinutes: 0, earlyOutMinutes: 0, overtimeMinutes: 0 };

  if (!checkIn) {
    if (input.onLeave) return { ...none, status: 'ON_LEAVE' };
    return { ...none, status: restDay || 'ABSENT' };
  }

  const { start, end } = shiftWindow(shift, date);
  const lateBy = mins(checkIn.getTime() - start.getTime());
  const lateMinutes = restDay ? 0 : lateBy > shift.graceMinutes ? lateBy : 0;

  if (!checkOut) {
    /* In, not out yet: today is under way. */
    return { ...none, lateMinutes, status: 'PRESENT' };
  }
  if (checkOut.getTime() < checkIn.getTime()) throw new Error('Check-out is before check-in.');

  const span = mins(checkOut.getTime() - checkIn.getTime());
  const workedMinutes = netOf(shift, span);
  const earlyBy = mins(end.getTime() - checkOut.getTime());
  const earlyOutMinutes = restDay ? 0 : earlyBy > shift.earlyOutGraceMinutes ? earlyBy : 0;
  const otThreshold = shift.overtimeAfterMinutes ?? shift.fullDayMinutes;
  const overtimeMinutes = restDay ? workedMinutes : Math.max(0, workedMinutes - otThreshold);

  /* A day off stays paid whatever was worked on it; the hours are overtime, never a half day's loss of pay. */
  const status: DayStatus =
    workedMinutes >= fullDayNeeded(shift) ? 'PRESENT' : restDay ? restDay : workedMinutes >= shift.halfDayMinutes ? 'HALF_DAY' : 'ABSENT';

  return { workedMinutes, lateMinutes, earlyOutMinutes, overtimeMinutes, status };
}

/**
 * A month for payroll: how many days count as paid.
 *
 * Present, holidays, weekly offs and paid leave are paid; a half day is half;
 * absent days (and unpaid leave, counted by the caller as `unpaidLeaveDays`)
 * are loss of pay. Days with no record at all are counted as absent only up
 * to today — a future day is not a day lost. A past working day with a
 * check-in and no check-out is `incomplete`: it is not paid until someone
 * corrects it, because "in at 09:00" alone says nothing about a day's work.
 */
export function monthSummary(input: {
  days: string[]; // every date in the period, YYYY-MM-DD
  records: Map<string, { status: DayStatus; lateMinutes: number; overtimeMinutes: number; overtimeApproved: boolean; checkIn?: Date | null; checkOut?: Date | null }>;
  shift: (date: string) => ShiftRule;
  holidays: Set<string>;
  today: string;
  unpaidLeaveDays?: number;
  /**
   * The common Indian rule "every 3 late arrivals is half a day's loss of pay":
   * the first `lateAllowance` late days a month are free, then every
   * `latePenaltyEvery` late days costs half a day. 0 = no penalty.
   */
  lateAllowance?: number;
  latePenaltyEvery?: number;
  /**
   * The late-mark penalty already worked out under the company's rules (services/attendance/markRules.ts):
   * the days that are loss of pay after any taken from leave, or a waiver. Given, it replaces the
   * two-number rule above.
   */
  penaltyDays?: number;
}) {
  let present = 0;
  let halfDays = 0;
  let absent = 0;
  let leave = 0;
  let holidays = 0;
  let weeklyOffs = 0;
  let late = 0;
  let overtimeMinutes = 0;
  let notYet = 0;
  let incomplete = 0;
  for (const date of input.days) {
    const r = input.records.get(date);
    if (r) {
      if (r.lateMinutes > 0) late += 1;
      if (r.overtimeApproved) overtimeMinutes += r.overtimeMinutes;
    }
    const restDay: DayStatus | null = input.holidays.has(date) ? 'HOLIDAY' : isWeeklyOff(input.shift(date), date) ? 'WEEKLY_OFF' : null;
    if (r?.status === 'PRESENT' && r.checkIn && !r.checkOut && date < input.today && !restDay) {
      incomplete += 1;
      continue;
    }
    const status: DayStatus | null = r?.status === 'PRESENT' && r.checkIn && !r.checkOut && restDay ? restDay : r?.status ?? restDay;
    if (!status) {
      if (date > input.today) notYet += 1;
      else absent += 1;
      continue;
    }
    if (status === 'PRESENT') present += 1;
    else if (status === 'HALF_DAY') halfDays += 1;
    else if (status === 'ABSENT') absent += 1;
    else if (status === 'ON_LEAVE') leave += 1;
    else if (status === 'HOLIDAY') holidays += 1;
    else if (status === 'WEEKLY_OFF') weeklyOffs += 1;
  }
  const unpaidLeave = Math.min(input.days.length, Math.max(0, input.unpaidLeaveDays || 0));
  const every = Math.max(0, input.latePenaltyEvery || 0);
  const latePenaltyDays = input.penaltyDays !== undefined ? Math.max(0, input.penaltyDays) : every ? Math.floor(Math.max(0, late - Math.max(0, input.lateAllowance || 0)) / every) * 0.5 : 0;
  const lossOfPayDays = Math.min(input.days.length - notYet, absent + incomplete + halfDays * 0.5 + unpaidLeave + latePenaltyDays);
  return {
    totalDays: input.days.length,
    present,
    halfDays,
    absent,
    leave,
    holidays,
    weeklyOffs,
    notYet,
    incompleteDays: incomplete,
    lateCount: late,
    latePenaltyDays,
    approvedOvertimeMinutes: overtimeMinutes,
    lossOfPayDays,
    payableDays: input.days.length - notYet - lossOfPayDays,
  };
}
