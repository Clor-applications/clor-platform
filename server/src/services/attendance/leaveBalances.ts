import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { CALENDAR, balanceFor, carryLimitOf, periodEnd, periodOf, periodStart, type LeavePeriod, type Worked } from './leaveAccrual.js';
import { daysWorkedByPeriod } from './daysWorked.js';
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

export type Entitlement = { employeeTypeId?: string | null; minServiceMonths?: number | null; annualDays: number };
type Person = { employeeTypeId?: string | null; dateOfJoining?: string | null; probationEndDate?: string | null; confirmedOn?: string | null };

const monthsBetween = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  return Math.max(0, m);
};

/**
 * The days a year this person gets of a type (TIME-LEAVE-DECISIONS.md, advanced
 * build): the type's own days unless an entitlement rule fits better. Rules
 * name an employee type, a length of service in months, or both; the most
 * specific fitting rule wins (both > service alone > type alone), and among
 * equals the longest service. Service is counted to `asOf` (the period start,
 * or the joining date when later), so a slab crossed mid-period applies from
 * the next period: balances never jump mid-year.
 */
export function entitledDays(type: { annualDays: number; entitlements?: unknown; entitlementsFrom?: string | null }, person: Person | null, asOf: string) {
  const rules = (Array.isArray(type.entitlements) ? type.entitlements : []) as Entitlement[];
  if (!rules.length || !person) return type.annualDays;
  /* Rules added to a type already in use apply from the period they were added in; earlier periods keep the type's own days. */
  if (type.entitlementsFrom && asOf < type.entitlementsFrom) return type.annualDays;
  const service = person.dateOfJoining ? monthsBetween(person.dateOfJoining, asOf) : null;
  let best: { score: number; months: number; days: number } | null = null;
  for (const r of rules) {
    const days = Number(r.annualDays);
    if (!Number.isFinite(days)) continue;
    const byType = r.employeeTypeId ? r.employeeTypeId === person.employeeTypeId : null;
    const byService = r.minServiceMonths != null && r.minServiceMonths > 0 ? service != null && service >= r.minServiceMonths : null;
    if (byType === false || byService === false) continue;
    if (byType === null && byService === null) continue;
    const score = (byType ? 1 : 0) + (byService ? 2 : 0);
    const months = byService ? Number(r.minServiceMonths) : 0;
    if (!best || score > best.score || (score === best.score && months > best.months)) best = { score, months, days };
  }
  return best ? best.days : type.annualDays;
}

/**
 * Probation (type.probationRule): HOLD means credits start only at
 * confirmation, so the person "joined" the type on that day; LOCK means credits
 * build from joining but nothing can be taken until confirmed; ACCRUE leaves
 * probation out of it. Confirmation is `confirmedOn`, else the probation end
 * date once it has passed.
 */
export function probationOf(type: { probationRule?: string | null }, person: Person | null, asOf: string) {
  const rule = type.probationRule || 'ACCRUE';
  if (rule === 'ACCRUE' || !person) return { rule, joinedForLeave: person?.dateOfJoining ?? null, locked: false, until: null as string | null };
  const until = person.confirmedOn || person.probationEndDate || null;
  const confirmed = Boolean(until && until <= asOf);
  if (rule === 'HOLD') return { rule, joinedForLeave: until && until > (person.dateOfJoining || '') ? until : person.dateOfJoining ?? null, locked: !confirmed && Boolean(until), until };
  return { rule, joinedForLeave: person.dateOfJoining ?? null, locked: !confirmed && Boolean(until), until };
}

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
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: employeeIds } }, select: { id: true, dateOfJoining: true, dateOfLeaving: true, employeeTypeId: true, probationEndDate: true, confirmedOn: true, branchId: true, areaId: true } }),
    peoplePrisma.leaveAdjustment.findMany({ where: { accountId, orgId, reversedAt: null, year: { gte: from, lte: year }, employeeId: { in: employeeIds } }, select: { employeeId: true, leaveTypeId: true, year: true, days: true } }),
  ]);
  /* Statutory types only (each opt-in): days worked per period, and the days asked for and refused per period. */
  const byWorked = types.filter((t) => t.isPaid && t.accrualBasis === 'PER_DAYS_WORKED');
  const workedOf = new Map<string, Map<string, Worked>>();
  if (byWorked.length && people.length) {
    const firstYear = Math.max(from - 1, Math.min(...byWorked.map((t) => periodOf(period, t.createdAt.toISOString().slice(0, 10)))) - 1);
    for (const [id, m] of await daysWorkedByPeriod(accountId, orgId, people, period, firstYear, year)) workedOf.set(id, m);
  }
  const oshTypes = types.filter((t) => t.isPaid && t.oshCarry).map((t) => t.id);
  const refusedRows = oshTypes.length
    ? await peoplePrisma.leaveRequest.findMany({ where: { accountId, orgId, employeeId: { in: employeeIds }, leaveTypeId: { in: oshTypes }, status: 'REJECTED', reviewedByUserId: { not: 'system' }, fromDate: { gte: periodStart(period, from), lte: end } }, select: { employeeId: true, leaveTypeId: true, days: true, fromDate: true } })
    : [];
  const personOf = new Map(people.map((p) => [p.id, p]));
  const leftOf = new Map(people.map((p) => [p.id, p.dateOfLeaving || null]));
  const out = new Map<string, Map<string, Balance & { allocated: number | null; available: number | null; allocationId: string | null; earned?: number; carriedIn?: number; lapsed?: number; fullYear?: number | null; adjusted?: number; credits?: Array<{ date: string; days: number; total: number; from: string; to: string }>; entitled?: number; locked?: boolean; lockedUntil?: string | null; carryLimit?: number; refused?: number; worked?: { previous: Worked | null; current: Worked | null } }>>();
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
      /* This person's days of the type, and how probation treats them. */
      const person = personOf.get(id) || null;
      const joined = person?.dateOfJoining || null;
      /* Each period at its own entitlement: service counted to that period's start (or joining, when later). */
      const entitledFor = (y: number) => { const ps = periodStart(period, y); return entitledDays(t, person, joined && joined > ps ? joined : ps); };
      const entitled = entitledFor(year);
      const probation = probationOf(t, person, on);
      const workedIn = (y: number) => workedOf.get(id)?.get(String(y)) ?? null;
      const refusedIn = (y: number) => round(refusedRows.filter((r) => r.employeeId === id && r.leaveTypeId === t.id && periodOf(period, r.fromDate) === y).reduce((a, r) => a + r.days, 0));
      /* Carried days lapse unless used in time: the days taken or waiting before then, period by period. */
      const takenBefore = (y: number, date: string) => round(mine.filter((r) => periodOf(period, r.fromDate) === y && r.fromDate < date).reduce((a, r) => a + r.days, 0));
      const b = balanceFor({ ...t, annualDays: entitled }, year, probation.joinedForLeave, on, new Map(allocs.map((a) => [a.year, a.days])), taken, { period, left: leftOf.get(id) ?? null, annualDaysFor: entitledFor, workedIn, refusedIn, takenBefore });
      const refused = t.oshCarry ? refusedIn(year) : 0;
      const allocated = round(b.allocated + adjusted);
      m.set(t.id, {
        allocated,
        allocationId: allocs.find((a) => a.year === year)?.id || null,
        used,
        pending,
        /* Locked by probation: the days are theirs, but none can be taken yet. */
        available: probation.locked ? 0 : round(allocated - used - pending),
        entitled,
        locked: probation.locked,
        lockedUntil: probation.locked ? probation.until : null,
        earned: b.earned,
        carriedIn: b.carriedIn,
        lapsed: 'lapsed' in b ? b.lapsed : 0,
        fullYear: b.fullYear == null ? null : round(b.fullYear + adjusted),
        adjusted,
        credits: b.credits,
        /* What can carry out of this period: the type's limit, and refused days on top under the OSH rule. */
        carryLimit: carryLimitOf(t, refused),
        refused,
        ...(t.accrualBasis === 'PER_DAYS_WORKED' ? { worked: { previous: workedIn(year - 1), current: workedIn(year) } } : {}),
      });
    }
    out.set(id, m);
  }
  return { types, balances: out, period };
}
