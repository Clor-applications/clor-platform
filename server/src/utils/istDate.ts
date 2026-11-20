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

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "23 Oct 2026" for an ISO day, the way every People screen writes a date; anything else comes back as given. */
export const dayWords = (d: string | null | undefined): string => {
  const s = String(d || '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  return `${Number(s.slice(8, 10))} ${MONTHS_SHORT[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
};

/**
 * A day or a moment as a person reads it, in India's time: "20 Nov 2026". The one formatter for dates in
 * titles, bodies, emails and errors (UX copy audit, 20 Nov 2026), which used to print
 * `toISOString().slice(0, 10)`: a UTC day, in the form a database writes it.
 * Takes an instant, or an ISO day (kept as that calendar day). Null and empty come back as "".
 */
export const dateWords = (at: Date | string | null | undefined): string => {
  if (at == null || at === '') return '';
  if (typeof at === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(at) ? dayWords(at) : dateWords(new Date(at));
  return Number.isFinite(at.getTime()) ? dayWords(istDate(at)) : '';
};

/** "20 Nov 2026, 3:30 pm" in India's time, for a moment where the hour matters (a reply due, a code that runs out). */
export const timeWords = (at: Date | string | null | undefined): string => {
  if (at == null || at === '') return '';
  const d = typeof at === 'string' ? new Date(at) : at;
  if (!Number.isFinite(d.getTime())) return '';
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const h = ist.getUTCHours();
  const m = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${dayWords(ist.toISOString().slice(0, 10))}, ${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
};

/** "1 day", "3 days": a count with its noun said right. */
export const countWords = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
