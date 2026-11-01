/**
 * Calendar days in India's time, as YYYY-MM-DD.
 *
 * The product's day is India's day (UTC+05:30, no daylight saving). Between
 * 00:00 and 05:30 IST the UTC date is still yesterday, so `new Date()
 * .toISOString().slice(0, 10)` dates a leave, a due date or a "today" list a
 * day early. About thirty services each carried their own copy of the right
 * line; this is the one.
 *
 * A YYYY-MM-DD string is a calendar date, not an instant: day arithmetic on it
 * runs at UTC midnight so no offset can move it.
 */

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** The IST calendar date of an instant. */
export const istDate = (at: Date): string => new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Today in India (or the IST date of `now`, for code that is handed a clock). */
export const todayIst = (now: Date = new Date()): string => istDate(now);

/** A calendar date `n` days on (or back, when negative). */
export const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** A calendar date `n` months on, kept inside the month: 31 Jan + 1 month is 28 (or 29) Feb, not 3 Mar. */
export const addMonths = (date: string, n: number): string => {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
};

/** Every date from `from` to `to`, both included; none when `to` is before `from`. */
export const eachDay = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};

/** How many days from `from` to `to`, both included: 1 Apr to 30 Apr is 30. Zero when either is not a date or `to` is before `from`. */
export const daysBetween = (from: string, to: string): number => {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / DAY_MS) + 1;
};
