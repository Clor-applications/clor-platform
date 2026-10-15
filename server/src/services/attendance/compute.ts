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
 * - Status: full-day minutes → PRESENT, half-day minutes → HALF_DAY, less →
 *   ABSENT. Checked in but not out yet → PRESENT, provisionally, 0 minutes.
 * - Overtime: worked beyond `overtimeAfterMinutes` (default the full day). On
 *   a holiday or weekly off, every minute worked is overtime.
 */

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

/** The IST calendar date of an instant, YYYY-MM-DD. */
export const istDate = (at: Date): string => new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);

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

const mins = (ms: number) => Math.max(0, Math.round(ms / 60_000));

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
  const workedMinutes = span > shift.halfDayMinutes ? Math.max(0, span - shift.breakMinutes) : span;
  const earlyBy = mins(end.getTime() - checkOut.getTime());
  const earlyOutMinutes = restDay ? 0 : earlyBy > shift.earlyOutGraceMinutes ? earlyBy : 0;
  const otThreshold = shift.overtimeAfterMinutes ?? shift.fullDayMinutes;
  const overtimeMinutes = restDay ? workedMinutes : Math.max(0, workedMinutes - otThreshold);

  const status: DayStatus =
    workedMinutes >= shift.fullDayMinutes ? 'PRESENT' : workedMinutes >= shift.halfDayMinutes ? 'HALF_DAY' : restDay || 'ABSENT';

  return { workedMinutes, lateMinutes, earlyOutMinutes, overtimeMinutes, status };
}

/**
 * A month for payroll: how many days count as paid.
 *
 * Present, holidays, weekly offs and paid leave are paid; a half day is half;
 * absent days (and unpaid leave, counted by the caller as `unpaidLeaveDays`)
 * are loss of pay. Days with no record at all are counted as absent only up
 * to today — a future day is not a day lost.
 */
export function monthSummary(input: {
  days: string[]; // every date in the period, YYYY-MM-DD
  records: Map<string, { status: DayStatus; lateMinutes: number; overtimeMinutes: number; overtimeApproved: boolean }>;
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
  for (const date of input.days) {
    const r = input.records.get(date);
    if (r) {
      if (r.lateMinutes > 0) late += 1;
      if (r.overtimeApproved) overtimeMinutes += r.overtimeMinutes;
    }
    const status: DayStatus | null = r?.status ?? (input.holidays.has(date) ? 'HOLIDAY' : isWeeklyOff(input.shift(date), date) ? 'WEEKLY_OFF' : null);
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
  const unpaidLeave = Math.min(leave, Math.max(0, input.unpaidLeaveDays || 0));
  const every = Math.max(0, input.latePenaltyEvery || 0);
  const latePenaltyDays = every ? Math.floor(Math.max(0, late - Math.max(0, input.lateAllowance || 0)) / every) * 0.5 : 0;
  const lossOfPayDays = absent + halfDays * 0.5 + unpaidLeave + latePenaltyDays;
  return {
    totalDays: input.days.length,
    present,
    halfDays,
    absent,
    leave,
    holidays,
    weeklyOffs,
    notYet,
    lateCount: late,
    latePenaltyDays,
    approvedOvertimeMinutes: overtimeMinutes,
    lossOfPayDays,
    payableDays: input.days.length - notYet - lossOfPayDays,
  };
}
