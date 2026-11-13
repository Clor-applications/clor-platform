import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { addDays } from '../../utils/istDate.js';
import { istDate } from './compute.js';

/**
 * Comp-off that expires.
 *
 * A day worked on a weekly off or a holiday can earn a day of the company's
 * comp-off leave type: a row in the leave ledger (LeaveAdjustment) naming the
 * day worked. Until now that day never expired. A leave type may now say how
 * long comp-off credited to it lasts (LeaveType.compOffValidDays); a grant
 * made under it carries the last day it can be used (`expiresOn`).
 *
 *  - Nothing changes for what exists: a type with no validity gives grants
 *    with no expiry, and grants made before a validity was set never get one.
 *  - The validity counts from the day worked. A day credited late (approved
 *    weeks after it was worked) still keeps a week from the day it is
 *    credited, so nobody is given a day that is already gone.
 *  - Leave of the type uses the grant that expires soonest first, and only a
 *    grant that was earned by then and had not expired by the leave's first
 *    day. What is left of a grant after its last day lapses: the nightly leave
 *    job takes those days back with a row of kind LAPSE and marks the grant
 *    (leaveJobs.ts runCompOffExpiry). The person is reminded a week before.
 *
 * No law sets this period. 90 days is offered because it is the common
 * practice in Indian HR policies, and it is the company's to choose.
 */

/** Offered on the leave type's screen; never applied on its own. */
export const COMP_OFF_SUGGESTED_VALID_DAYS = 90;
/** A grant credited late keeps at least this long from the day it is credited. */
export const COMP_OFF_MIN_DAYS_AFTER_CREDIT = 7;
/** The reminder goes out this many days before the last day. */
export const COMP_OFF_REMIND_DAYS = 7;

/** The last day a grant can be used, or null when the type sets no validity. */
export function compOffExpiresOn(validDays: number | null | undefined, workedOn: string, creditedOn: string): string | null {
  const n = Number(validDays);
  if (validDays === null || validDays === undefined || !Number.isFinite(n) || n < 1) return null;
  const byWork = addDays(workedOn, Math.round(n));
  const byCredit = addDays(creditedOn, COMP_OFF_MIN_DAYS_AFTER_CREDIT);
  return byWork > byCredit ? byWork : byCredit;
}

export type Grant = { id: string; workedOn: string; expiresOn: string | null; days: number; lapsedAt?: Date | null; lapsedDays?: number | null };
export type Use = { date: string; days: number };
export type GrantLeft = Grant & { left: number };

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * What is left of each grant after the leave taken. Each use, oldest first,
 * comes off the grant that expires soonest among those it can use: earned on
 * or before the use's day, and not expired by it. A grant that already lapsed
 * holds only what was used of it. A use no grant can take is left to the rest
 * of the balance.
 */
export function grantsLeft(grants: Grant[], uses: Use[]): GrantLeft[] {
  const far = '9999-12-31';
  const rows = grants
    .map((g) => ({ ...g, left: round(g.lapsedAt ? Math.max(0, g.days - (g.lapsedDays || 0)) : g.days) }))
    .sort((a, b) => (a.expiresOn || far).localeCompare(b.expiresOn || far) || a.workedOn.localeCompare(b.workedOn));
  for (const u of [...uses].sort((a, b) => a.date.localeCompare(b.date))) {
    let need = u.days;
    for (const g of rows) {
      if (need <= 0) break;
      if (g.left <= 0 || g.workedOn > u.date || (g.expiresOn && g.expiresOn < u.date)) continue;
      const take = Math.min(g.left, need);
      g.left = round(g.left - take);
      need = round(need - take);
    }
  }
  /* A lapsed grant has nothing left to use, whatever the sums say. */
  return rows.map((g) => (g.lapsedAt ? { ...g, left: 0 } : g));
}

/**
 * Every comp-off grant of these people, with what is left of each: by person,
 * then by leave type. Uses are the leave of the type that is approved or
 * waiting (a request waiting holds its days), and days taken out of the
 * ledger by hand or paid out; a LAPSE row is the lapse itself, not a use.
 */
export async function compOffGrants(orgId: string, employeeIds: string[]) {
  const out = new Map<string, Map<string, GrantLeft[]>>();
  if (!employeeIds.length) return out;
  const grants = await peoplePrisma.leaveAdjustment.findMany({
    where: { orgId, employeeId: { in: employeeIds }, workedOn: { not: null }, days: { gt: 0 }, reversedAt: null },
    select: { id: true, employeeId: true, leaveTypeId: true, workedOn: true, expiresOn: true, days: true, lapsedAt: true, lapsedDays: true },
  });
  if (!grants.length) return out;
  const typeIds = [...new Set(grants.map((g) => g.leaveTypeId))];
  const people = [...new Set(grants.map((g) => g.employeeId))];
  const [requests, debits] = await Promise.all([
    peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId: { in: people }, leaveTypeId: { in: typeIds }, status: { in: ['PENDING', 'APPROVED'] } }, select: { employeeId: true, leaveTypeId: true, fromDate: true, days: true } }),
    peoplePrisma.leaveAdjustment.findMany({ where: { orgId, employeeId: { in: people }, leaveTypeId: { in: typeIds }, days: { lt: 0 }, kind: { not: 'LAPSE' }, reversedAt: null }, select: { employeeId: true, leaveTypeId: true, days: true, createdAt: true } }),
  ]);
  for (const id of people) {
    const byType = new Map<string, GrantLeft[]>();
    for (const typeId of typeIds) {
      const mine = grants.filter((g) => g.employeeId === id && g.leaveTypeId === typeId);
      if (!mine.length) continue;
      const uses: Use[] = [
        ...requests.filter((r) => r.employeeId === id && r.leaveTypeId === typeId).map((r) => ({ date: r.fromDate, days: r.days })),
        ...debits.filter((d) => d.employeeId === id && d.leaveTypeId === typeId).map((d) => ({ date: istDate(d.createdAt), days: -d.days })),
      ];
      byType.set(typeId, grantsLeft(mine.map((g) => ({ ...g, workedOn: g.workedOn! })), uses));
    }
    out.set(id, byType);
  }
  return out;
}

export type Expiring = { days: number; expiresOn: string; workedOn: string };

/**
 * For the person's own leave view: the days of a type that will expire, soonest
 * first, never more in all than the balance they can still take (a year end
 * may already have let some go).
 */
export function expiringOf(grants: GrantLeft[] | undefined, available: number | null | undefined, today: string): Expiring[] {
  let room = Math.max(0, Number(available) || 0);
  const out: Expiring[] = [];
  for (const g of grants || []) {
    if (!g.expiresOn || g.lapsedAt || g.left <= 0 || g.expiresOn < today || room <= 0) continue;
    const days = round(Math.min(g.left, room));
    room = round(room - days);
    out.push({ days, expiresOn: g.expiresOn, workedOn: g.workedOn });
  }
  return out;
}
