import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { closedMonths } from '../attendance/days.js';
import { getMonthSnapshot } from '../attendance/readiness.js';
import { lastOfMonth } from '../attendance/payableDays.js';
import { eachDay } from '../../utils/istDate.js';

/**
 * Which Attendance month closes a payroll run takes its days from (closure
 * audit O-04). Closing a month in Attendance saves a versioned snapshot of
 * its figures; Payroll takes those, not the live rows, once every month the
 * pay period touches is closed, and remembers the version. A month reopened,
 * or closed again with a newer version, after the pull means the run's days
 * may no longer be the month's: approving or locking the run waits until
 * somebody takes the figures again.
 */

/** What the run stored: one entry per month the period touches. */
export type TakenMonth = { month: string; version: number | null; closed: boolean };

export const monthsOf = (startDate: string, endDate: string) => [...new Set(eachDay(startDate, endDate).map((d) => d.slice(0, 7)))];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "September", or "September 2026" when the year needs saying. */
export const monthName = (month: string, withYear = false) => `${MONTHS[Number(month.slice(5, 7)) - 1]}${withYear ? ` ${month.slice(0, 4)}` : ''}`;
const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The plain warning for a pull from months still open. */
export function provisionalWarning(openMonths: string[]) {
  const years = new Set(openMonths.map((m) => m.slice(0, 4)));
  const names = openMonths.map((m) => monthName(m, years.size > 1));
  return `${listWords(names)} ${openMonths.length === 1 ? 'is' : 'are'} not closed in Attendance; these figures can still change.`;
}

/** Numeric fields of a summary row, added across months for a period of several. */
const SUMMED = ['totalDays', 'lossOfPayDays', 'absent', 'halfDays', 'incompleteDays', 'unpaidLeaveDays', 'latePenaltyDays', 'notYet', 'approvedOvertimeMinutes'];

/**
 * The figures for a pay period, per person, from the latest snapshot of each
 * month. Only when every month the period touches is closed and lies wholly
 * inside the period: a snapshot is a whole month, and a period that starts or
 * ends mid-month cannot be cut out of one. Null otherwise (the caller keeps
 * the live rows, which for a closed month cannot move anyway).
 */
export async function snapshotRows(orgId: string, startDate: string, endDate: string) {
  const months = monthsOf(startDate, endDate);
  const whole = months.every((m) => `${m}-01` >= startDate && lastOfMonth(m) <= endDate);
  if (!whole) return null;
  const shut = await closedMonths(orgId, months);
  if (!months.every((m) => shut.has(m))) return null;
  const snaps = await Promise.all(months.map((m) => getMonthSnapshot(orgId, m)));
  if (snaps.some((s) => !s)) return null;
  const byPerson = new Map<string, any>();
  for (const s of snaps) {
    for (const r of s!.rows) {
      const had = byPerson.get(r.employeeId);
      if (!had) {
        byPerson.set(r.employeeId, { ...r });
        continue;
      }
      for (const k of SUMMED) had[k] = (Number(had[k]) || 0) + (Number(r[k]) || 0);
    }
  }
  return { rows: [...byPerson.values()], versions: snaps.map((s) => ({ month: s!.month, version: s!.version, createdAt: s!.createdAt })) };
}

/** What to store on the run at the pull: every month, its state, and the latest version of a closed one. */
export async function takenMonths(orgId: string, startDate: string, endDate: string): Promise<TakenMonth[]> {
  const months = monthsOf(startDate, endDate);
  const shut = await closedMonths(orgId, months);
  const snaps = await peoplePrisma.attendanceMonthSnapshot.findMany({ where: { orgId, month: { in: months } }, orderBy: { version: 'desc' }, select: { month: true, version: true } });
  return months.map((month) => {
    const closed = shut.has(month);
    return { month, closed, version: closed ? snaps.find((s) => s.month === month)?.version ?? null : null };
  });
}

/**
 * The first month the run took closed that has moved since: reopened, or
 * closed again with a newer snapshot. Null when nothing has, or when the run
 * took no closed month (days typed in, or a pull from open months, which is
 * already said to be provisional).
 */
export async function snapshotChange(orgId: string, stored: unknown): Promise<{ month: string; reason: 'REOPENED' | 'NEWER_SNAPSHOT'; message: string } | null> {
  const taken = (Array.isArray(stored) ? stored : []).filter((t: any) => t && t.closed && typeof t.month === 'string') as TakenMonth[];
  if (!taken.length) return null;
  const months = taken.map((t) => t.month);
  const shut = await closedMonths(orgId, months);
  const snaps = await peoplePrisma.attendanceMonthSnapshot.findMany({ where: { orgId, month: { in: months } }, orderBy: { version: 'desc' }, select: { month: true, version: true } });
  for (const t of taken) {
    const name = monthName(t.month, true);
    if (!shut.has(t.month)) {
      return { month: t.month, reason: 'REOPENED', message: `${name} was reopened in Attendance after these days were taken. Take the figures from Attendance again.` };
    }
    const latest = snaps.find((s) => s.month === t.month)?.version ?? null;
    if (latest != null && (t.version == null || latest > t.version)) {
      return { month: t.month, reason: 'NEWER_SNAPSHOT', message: `${name} was closed again in Attendance after these days were taken, so its figures may have changed. Take the figures from Attendance again.` };
    }
  }
  return null;
}
