/*
 * Round 33 picks (owner, 18 Nov 2026), outside Books.
 *
 * weekstart A: the week starts on Monday. Weekday lists keep their stored
 * numbers (0 = Sunday … 6 = Saturday, as the server saves them) and are only
 * shown Monday first.
 *
 * backdate A: a leave asked for days already gone carries a "late" tag on the
 * approver's list, so the record stays honest.
 */

/** Weekday numbers in the order they are shown: Monday first, Sunday last. */
export const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

/** `labels` indexed by stored weekday number → [{ label, index }] Monday first. */
export const mondayFirst = (labels) => MONDAY_FIRST.map((index) => ({ label: labels[index], index }));

/** Sorts stored weekday numbers (numbers or strings) Monday first. */
export const sortMondayFirst = (days) => [...days].sort((a, b) => MONDAY_FIRST.indexOf(Number(a)) - MONDAY_FIRST.indexOf(Number(b)));

const dayMs = 86_400_000;
const toUtc = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/**
 * How many days after the leave's first day it was asked for (0 when asked on
 * or before it). `askedDay` is the IST day it was asked, YYYY-MM-DD.
 */
export function daysLate(fromDate, askedDay) {
  if (!fromDate || !askedDay) return 0;
  const n = Math.round((toUtc(askedDay) - toUtc(fromDate)) / dayMs);
  return n > 0 ? n : 0;
}

/** "Asked 2 days late", or null when it was asked in time. */
export function lateText(fromDate, askedDay) {
  const n = daysLate(fromDate, askedDay);
  return n ? `Asked ${n} day${n === 1 ? '' : 's'} late` : null;
}
