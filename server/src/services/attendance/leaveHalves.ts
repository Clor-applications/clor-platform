/**
 * Which part of a date one leave row takes. A row is a whole-day range, a
 * half of one day (halfDay; main's startHalf/endHalf save a longer leave's
 * half days as rows of their own), or hours on one day (minutes, hourly
 * leave). Everything that marks days, counts balances or works out loss of
 * pay asks here, so they cannot disagree.
 */
export type Half = 'FIRST' | 'SECOND';
export type LeaveShape = { fromDate: string; toDate: string; halfDay?: string | null; minutes?: number | null; days?: number | null };

export function halfOn(r: LeaveShape, date: string): Half | null {
  return r.halfDay && date === r.fromDate ? (r.halfDay as Half) : null;
}

/** True when the row leaves part of the day to be worked: a half, or hours. */
export const partOfDay = (r: LeaveShape, date: string) => Boolean(halfOn(r, date) || r.minutes);

/** What one counted date of the row takes from the balance: a whole day, a half, or the hours' share (days, for hourly leave, is that share). */
export function weightOn(r: LeaveShape, date: string) {
  if (r.minutes) return r.days ?? 0;
  return halfOn(r, date) ? 0.5 : 1;
}

/** HH:MM, on a 15-minute step. */
export const QUARTER_TIME = /^([01]\d|2[0-3]):(00|15|30|45)$/;
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
