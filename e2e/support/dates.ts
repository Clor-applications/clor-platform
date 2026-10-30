/**
 * Dates the scenarios ask for ("next week", "a Wednesday three weeks out"),
 * in India's time, as YYYY-MM-DD. Each leave scenario takes its own week so
 * scenarios never overlap one person's days, whatever order they run in.
 */
const IST = 'Asia/Kolkata';

export const todayIST = () => new Date(new Date().toLocaleString('en-US', { timeZone: IST }));

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday of the week `weeks` from now (1 = next week). */
export function monday(weeks: number) {
  const d = todayIST();
  d.setHours(12, 0, 0, 0);
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back + 7 * weeks);
  return d;
}

/** A weekday in that week: 0 = Monday … 4 = Friday. */
export const weekday = (weeks: number, day: number) => {
  const d = monday(weeks);
  d.setDate(d.getDate() + day);
  return iso(d);
};

/** "3 Nov 2026"-style, the way the app writes a date. */
export const shortDate = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/*
 * Who uses which week (so two scenarios never touch the same person's days):
 *   E1/E5  Priya   week 1 (Mon–Tue)
 *   E2     Priya   week 2 (Wed, afternoon)
 *   E3     Priya   week 3 (Tue–Thu, holiday Wed)
 *   M1     Imran   week 1
 *   M2     Lakshmi week 1
 *   M3     Deepak  weeks 1 and 2
 *   M4     Imran+Lakshmi week 4 (a clash)
 *   M8     Rahul   week 2
 */
export const HOLIDAY_WEEK = 3;
export const HOLIDAY_DAY = 2;

/** A working day `n` days from today, moved past a Sunday (the seeded weekly off). */
export function workdayFromNow(n: number) {
  const d = todayIST();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return iso(d);
}

/** "02/11/2026": what a person types into the web app's date fields. */
export const dmy = (isoDate: string) => isoDate.split('-').reverse().join('/');

/** The web app's way of writing a span: "2 Nov 2026", or "2 Nov 2026 – 3 Nov 2026". */
export const webSpan = (from: string, to = from) => (from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`);

/** The employee app's way of writing a day: "Mon, 2 Nov". */
export const appDay = (isoDate: string) => new Date(`${isoDate}T12:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
