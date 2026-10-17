/**
 * How many days of a paid leave type somebody has earned in a calendar year,
 * as of a date. Worked out when asked rather than credited by a nightly job:
 * nothing to miss, nothing to run twice, and a policy change applies to every
 * year at once.
 *
 * - YEARLY: the year's days from 1 January (or, for a joiner when the type
 *   prorates, the months left in the year).
 * - MONTHLY: a twelfth at the start of each month, from the joining month.
 * - Joining on or before the 15th counts that month; after, from the next.
 * - Carry-forward: what was left at the end of last year, up to the type's
 *   limit, is added to this year. Last year's own carry-in counts, so a
 *   balance can roll for years — up to the limit each time.
 *
 * Earned days are rounded to the half day, which is how leave is granted.
 */

export type AccrualType = { id: string; annualDays: number; accrual: string; prorateForJoiners: boolean; carryForwardMax: number | null; createdAt: Date };

const half = (n: number) => Math.round(n * 2) / 2;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The first month (1–12) of the year that counts for somebody who joined on this date, or 13 if none. */
export function firstMonth(year: number, joined: string | null) {
  if (!joined) return 1;
  const y = Number(joined.slice(0, 4));
  if (y < year) return 1;
  if (y > year) return 13;
  const m = Number(joined.slice(5, 7));
  return Number(joined.slice(8, 10)) <= 15 ? m : m + 1;
}

/** Days earned in `year` by `asOf` (an ISO date; past years count in full). */
export function earned(type: AccrualType, year: number, joined: string | null, asOf: string) {
  const start = type.accrual === 'MONTHLY' || type.prorateForJoiners ? firstMonth(year, joined) : 1;
  if (start > 12) return 0;
  const asOfYear = Number(asOf.slice(0, 4));
  if (asOfYear < year) return 0;
  const throughMonth = asOfYear > year ? 12 : Number(asOf.slice(5, 7));
  if (type.accrual === 'MONTHLY') {
    const months = Math.max(0, throughMonth - start + 1);
    return half((type.annualDays * months) / 12);
  }
  return type.prorateForJoiners && start > 1 ? half((type.annualDays * (13 - start)) / 12) : type.annualDays;
}

/**
 * One person's balance of one type for a year.
 *
 * `allocations` and `taken` are by year: an allocation replaces what the type
 * would give that year (HR's number wins, carry-in included); `taken` is the
 * days approved or waiting for approval.
 */
export function balanceFor(
  type: AccrualType,
  year: number,
  joined: string | null,
  asOf: string,
  allocations: Map<number, number>,
  taken: Map<number, number>
) {
  const firstYear = Math.max(type.createdAt.getUTCFullYear(), joined ? Number(joined.slice(0, 4)) : 0, year - 10);

  /* What carries into `y`: last year's full entitlement less what was taken, up to the limit. */
  const carriedInto = (y: number): number => {
    if (type.carryForwardMax == null || type.carryForwardMax <= 0 || y - 1 < firstYear) return 0;
    const prev = y - 1;
    const total = allocations.has(prev) ? allocations.get(prev)! : earned(type, prev, joined, `${prev}-12-31`) + carriedInto(prev);
    return round2(Math.min(type.carryForwardMax, Math.max(0, total - (taken.get(prev) || 0))));
  };

  if (allocations.has(year)) {
    const days = allocations.get(year)!;
    return { allocated: days, earned: days, carriedIn: 0, fullYear: days, manual: true };
  }
  const carriedIn = carriedInto(year);
  const soFar = earned(type, year, joined, asOf);
  return {
    allocated: round2(soFar + carriedIn),
    earned: soFar,
    carriedIn,
    /* What the year comes to by 31 December, for "you will have" on screen. */
    fullYear: round2(earned(type, year, joined, `${year}-12-31`) + carriedIn),
    manual: false,
  };
}
