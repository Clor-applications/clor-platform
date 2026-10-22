/**
 * How many days of a paid leave type somebody has earned in a leave period,
 * as of a date. Worked out when asked rather than credited by a nightly job:
 * nothing to miss and nothing to run twice. Entitlement fields on a policy
 * with recorded history cannot be edited — yet every credit has its own date, so the ledger and the
 * register show it as a line (founder, 22 Oct 2026: credits automatic, on the
 * company's own dates, not only the 1st or the last day).
 *
 * - The leave period is the company's (1 January by default; 1 April for
 *   April–March; any day 1–28 of any month). A period is named by the year it
 *   starts in.
 * - A type credits its yearly days in parts: YEARLY (one), HALF_YEARLY (two),
 *   QUARTERLY (four) or MONTHLY (twelve).
 * - Each part's credit lands at its START, its END, or on DAY — the first
 *   creditDay (1–28) on or after the part begins.
 * - Joiners: monthly leave starts from the month joined by its 15th; another
 *   type gives its part in full, or, when it prorates, the months of the part
 *   joined by their 15th. Nothing is credited after someone's leaving date.
 * - Carry-forward: what was left at the end of the last period, up to the
 *   type's limit, is added to this one. The last period's own carry-in counts,
 *   so a balance can roll on — up to the limit each time.
 *
 * Earned days are rounded to the half day, which is how leave is granted.
 */

export type AccrualType = {
  id: string;
  annualDays: number;
  accrual: string;
  prorateForJoiners: boolean;
  carryForwardMax: number | null;
  createdAt: Date;
  creditOn?: string | null;
  creditDay?: number | null;
};
export type LeavePeriod = { startMonth: number; startDay: number };
export type AccrualOptions = { period?: LeavePeriod | null; left?: string | null };
export type Credit = { date: string; days: number; total: number; from: string; to: string };

export const CALENDAR: LeavePeriod = { startMonth: 1, startDay: 1 };
const STEP: Record<string, number> = { YEARLY: 12, HALF_YEARLY: 6, QUARTERLY: 3, MONTHLY: 1 };
export const ACCRUALS = Object.keys(STEP);

const half = (n: number) => Math.round(n * 2) / 2;
const round2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function addMonths(date: string, n: number) {
  const y = Number(date.slice(0, 4));
  const t = Number(date.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(t / 12);
  const mm = ((t % 12) + 12) % 12 + 1;
  return `${yy}-${pad(mm)}-${pad(Math.min(Number(date.slice(8, 10)), daysIn(yy, mm)))}`;
}

/** The first and last day of the leave period that starts in `year`. */
export const periodStart = (p: LeavePeriod | null | undefined, year: number) => `${year}-${pad((p || CALENDAR).startMonth)}-${pad((p || CALENDAR).startDay)}`;
export const periodEnd = (p: LeavePeriod | null | undefined, year: number) => addDays(periodStart(p, year + 1), -1);
/** The leave period a date falls in, by the year it starts in. */
export function periodOf(p: LeavePeriod | null | undefined, date: string) {
  const y = Number(date.slice(0, 4));
  return date >= periodStart(p, y) ? y : y - 1;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (date: string, withDay: boolean) => `${withDay ? `${Number(date.slice(8, 10))} ` : ''}${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
/** "2026" for a calendar year; "Apr 2026 – Mar 2027", or with days when it starts mid-month. */
export function periodLabel(p: LeavePeriod | null | undefined, year: number) {
  const q = p || CALENDAR;
  if (q.startMonth === 1 && q.startDay === 1) return String(year);
  const withDay = q.startDay !== 1;
  return `${short(periodStart(q, year), withDay)} – ${short(periodEnd(q, year), withDay)}`;
}

/** The first month (1–12) of the year that counts for somebody who joined on this date, or 13 if none (calendar years). */
export function firstMonth(year: number, joined: string | null) {
  if (!joined) return 1;
  const y = Number(joined.slice(0, 4));
  if (y < year) return 1;
  if (y > year) return 13;
  const m = Number(joined.slice(5, 7));
  return Number(joined.slice(8, 10)) <= 15 ? m : m + 1;
}

/** When a part's credit lands. */
function creditDate(type: AccrualType, from: string, to: string) {
  if (type.creditOn === 'END') return to;
  if (type.creditOn === 'DAY' && type.creditDay) {
    let d = `${from.slice(0, 8)}${pad(Math.min(28, Math.max(1, type.creditDay)))}`;
    if (d < from) d = addMonths(d, 1);
    return d > to ? to : d;
  }
  return from;
}

/** Every credit of a type in one leave period for one person, in order, with the running total. */
export function creditsFor(type: AccrualType, year: number, joined: string | null, opts: AccrualOptions = {}): Credit[] {
  const step = STEP[type.accrual] || 12;
  const start = periodStart(opts.period, year);
  const per = (type.annualDays * step) / 12;
  const out: Credit[] = [];
  let raw = 0;
  let prev = 0;
  for (let i = 0; i < 12 / step; i += 1) {
    const from = addMonths(start, i * step);
    const to = addDays(addMonths(start, (i + 1) * step), -1);
    if (joined && joined > to) continue;
    let share = 1;
    if (joined && joined > from && (step === 1 || type.prorateForJoiners)) {
      let months = 0;
      for (let k = 0; k < step; k += 1) if (joined <= addDays(addMonths(from, k), 14)) months += 1;
      share = months / step;
    }
    if (!share) continue;
    const scheduled = creditDate(type, from, to);
    const date = joined && joined > scheduled ? joined : scheduled;
    if (opts.left && date > opts.left) continue;
    raw += per * share;
    const total = half(raw);
    out.push({ date, days: round2(total - prev), total, from, to });
    prev = total;
  }
  return out;
}

/** Days earned in the period that starts in `year`, by `asOf` (an ISO date). */
export function earned(type: AccrualType, year: number, joined: string | null, asOf: string, opts: AccrualOptions = {}) {
  let total = 0;
  for (const c of creditsFor(type, year, joined, opts)) if (c.date <= asOf) total = c.total;
  return total;
}

/**
 * One person's balance of one type for a period.
 *
 * `allocations` and `taken` are by period: an allocation replaces what the
 * type would give that period (HR's number wins, carry-in included); `taken`
 * is the days approved or waiting for approval, less HR's credits.
 */
export function balanceFor(
  type: AccrualType,
  year: number,
  joined: string | null,
  asOf: string,
  allocations: Map<number, number>,
  taken: Map<number, number>,
  opts: AccrualOptions = {}
) {
  const created = periodOf(opts.period, type.createdAt.toISOString().slice(0, 10));
  const firstYear = Math.max(created, joined ? periodOf(opts.period, joined) : 0, year - 10);

  /* What carries into `y`: the last period's full entitlement less what was taken, up to the limit. */
  const carriedInto = (y: number): number => {
    if (type.carryForwardMax == null || type.carryForwardMax <= 0 || y - 1 < firstYear) return 0;
    const prev = y - 1;
    const total = allocations.has(prev) ? allocations.get(prev)! : earned(type, prev, joined, periodEnd(opts.period, prev), opts) + carriedInto(prev);
    return round2(Math.min(type.carryForwardMax, Math.max(0, total - (taken.get(prev) || 0))));
  };

  if (allocations.has(year)) {
    const days = allocations.get(year)!;
    return { allocated: days, earned: days, carriedIn: 0, fullYear: days, manual: true, credits: [] as Credit[] };
  }
  const carriedIn = carriedInto(year);
  const credits = creditsFor(type, year, joined, opts);
  const soFar = earned(type, year, joined, asOf, opts);
  return {
    allocated: round2(soFar + carriedIn),
    earned: soFar,
    carriedIn,
    /* What the period comes to by its last day, for "you will have" on screen. */
    fullYear: round2((credits.at(-1)?.total || 0) + carriedIn),
    manual: false,
    credits,
  };
}
