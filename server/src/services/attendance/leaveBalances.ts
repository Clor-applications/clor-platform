import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { CALENDAR, balanceFor, periodEnd, periodOf, periodStart, type LeavePeriod } from './leaveAccrual.js';
import { today } from './days.js';

/**
 * Leave balances and the leave year: what someone has, has taken and has left. Moved out of routes/leave.ts so People data health and payroll's final settlement call a service, not a route; behaviour unchanged.
 */
export const OPEN = ['PENDING', 'APPROVED'];

/** The company's leave period (People → Settings → Leave Policy); the calendar year until set. */
export async function leavePeriodOf(orgId: string): Promise<LeavePeriod> {
  const s = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { leavePeriodStartMonth: true, leavePeriodStartDay: true } });
  return s ? { startMonth: s.leavePeriodStartMonth, startDay: s.leavePeriodStartDay } : CALENDAR;
}

/** The leave period a date falls in (today by default), named by the year it starts in. */
export const leaveYearOf = async (orgId: string, date: string = today()) => periodOf(await leavePeriodOf(orgId), date);

export const round = (n: number) => Math.round(n * 100) / 100;

type Balance = { allocated: number; used: number; pending: number; available: number };

/**
 * Each person's balance of each type for a year (services/attendance/leaveAccrual.ts).
 * Unpaid types have no limit (allocated = null). `asOf` is the date earned
 * days are counted to: today in the current year, the year end for a past
 * one; a request is checked against what will have been earned by its first day.
 */
export async function balancesFor(accountId: string, orgId: string, employeeIds: string[], year: number, asOf?: string) {
  const period = await leavePeriodOf(orgId);
  const t0 = today();
  const start = periodStart(period, year);
  const end = periodEnd(period, year);
  const on = asOf || (t0 > end ? end : t0 < start ? start : t0);
  const from = year - 10;
  const [types, allocations, requests, people, adjustments] = await Promise.all([
    peoplePrisma.leaveType.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } }),
    peoplePrisma.leaveAllocation.findMany({ where: { accountId, orgId, year: { gte: from, lte: year }, employeeId: { in: employeeIds } } }),
    peoplePrisma.leaveRequest.findMany({
      where: { accountId, orgId, employeeId: { in: employeeIds }, status: { in: OPEN }, fromDate: { gte: periodStart(period, from), lte: end } },
      select: { employeeId: true, leaveTypeId: true, status: true, days: true, fromDate: true },
    }),
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: employeeIds } }, select: { id: true, dateOfJoining: true, dateOfLeaving: true } }),
    peoplePrisma.leaveAdjustment.findMany({ where: { accountId, orgId, year: { gte: from, lte: year }, employeeId: { in: employeeIds } }, select: { employeeId: true, leaveTypeId: true, year: true, days: true } }),
  ]);
  const joinedOf = new Map(people.map((p) => [p.id, p.dateOfJoining || null]));
  const leftOf = new Map(people.map((p) => [p.id, p.dateOfLeaving || null]));
  const out = new Map<string, Map<string, Balance & { allocated: number | null; available: number | null; allocationId: string | null; earned?: number; carriedIn?: number; fullYear?: number | null; adjusted?: number; credits?: Array<{ date: string; days: number; total: number; from: string; to: string }> }>>();
  for (const id of employeeIds) {
    const m = new Map();
    for (const t of types) {
      const mine = requests.filter((r) => r.employeeId === id && r.leaveTypeId === t.id);
      const thisYear = mine.filter((r) => periodOf(period, r.fromDate) === year);
      const used = round(thisYear.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.days, 0));
      const pending = round(thisYear.filter((r) => r.status === 'PENDING').reduce((s, r) => s + r.days, 0));
      if (!t.isPaid) {
        m.set(t.id, { allocated: null, allocationId: null, used, pending, available: null });
        continue;
      }
      const allocs = allocations.filter((a) => a.employeeId === id && a.leaveTypeId === t.id);
      const taken = new Map<number, number>();
      for (const r of mine) taken.set(periodOf(period, r.fromDate), (taken.get(periodOf(period, r.fromDate)) || 0) + r.days);
      /* The ledger: a credit is days not taken, a debit (paid out) days gone, so each also moves what carries forward. */
      const adj = adjustments.filter((a) => a.employeeId === id && a.leaveTypeId === t.id);
      for (const a of adj) taken.set(a.year, (taken.get(a.year) || 0) - a.days);
      const adjusted = round(adj.filter((a) => a.year === year).reduce((sum, a) => sum + a.days, 0));
      const b = balanceFor(t, year, joinedOf.get(id) ?? null, on, new Map(allocs.map((a) => [a.year, a.days])), taken, { period, left: leftOf.get(id) ?? null });
      const allocated = round(b.allocated + adjusted);
      m.set(t.id, {
        allocated,
        allocationId: allocs.find((a) => a.year === year)?.id || null,
        used,
        pending,
        available: round(allocated - used - pending),
        earned: b.earned,
        carriedIn: b.carriedIn,
        fullYear: b.fullYear == null ? null : round(b.fullYear + adjusted),
        adjusted,
        credits: b.credits,
      });
    }
    out.set(id, m);
  }
  return { types, balances: out, period };
}
