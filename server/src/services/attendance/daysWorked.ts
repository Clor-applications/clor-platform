import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { isFeatureEnabled } from '../features.js';
import { isWeeklyOff } from './compute.js';
import { today } from './days.js';
import { addDays, periodEnd, periodStart, type LeavePeriod, type Worked } from './leaveAccrual.js';
import { loadHolidays, loadSchedule, resolveShift } from './schedule.js';

/**
 * Days worked, for statutory leave (earned leave by days worked, and the maternity eligibility).
 *
 * The rule, after OSH Code s.32 and Factories Act s.79 as summarised in TIME-LEAVE-MARKET-RESEARCH.md (G1 and the
 * statute table; s.79's Explanation 1 read from the bare-act extract, L5):
 *
 * - With Attendance on, the day record decides: PRESENT is 1, HALF_DAY is 0.5 (WFH and On duty are present days).
 *   Weekly offs, holidays, absent days and leave days are not days worked.
 * - Leave does not earn leave, but leave with wages counts towards the threshold: s.79 deems maternity leave and
 *   leave earned the year before to be days worked "for the computation of the period of 240 days", and says no leave
 *   is earned for them. We count every approved paid leave day that way, which errs to the worker.
 *   So `worked` (what earns) is the days worked, and `eligible` (what meets 180 or 240) is worked plus paid leave.
 * - People only, with no punches: working days by the working week and the holidays, from joining (or the period
 *   start) to leaving (or the period end, or today), less approved leave for `worked`, less unpaid leave for
 *   `eligible`. "How is this worked out?" says the figure came from working days, not from attendance.
 *
 * Not modelled: lay-off days (deemed worked under s.79), the Factories Act two-thirds rule for joiners, and the
 * adolescent rate (1 per 15).
 */
type Person = { id: string; branchId?: string | null; areaId?: string | null; dateOfJoining?: string | null; dateOfLeaving?: string | null };
type Range = { key: string; from: string; to: string };

const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);

/** Whether days worked come from the day record (Attendance on) or from working days (People only). */
export async function workedSource(accountId: string, orgId: string): Promise<Worked['source']> {
  return (await isFeatureEnabled(accountId, orgId, 'attendance')) ? 'RECORD' : 'WORKING_DAYS';
}

/** Days worked for each person in each range, keyed by person then range key. Ranges may overlap. */
export async function daysWorkedIn(accountId: string, orgId: string, people: Person[], ranges: Range[], source?: Worked['source']) {
  const out = new Map<string, Map<string, Worked>>();
  if (!people.length || !ranges.length) return out;
  const src = source || (await workedSource(accountId, orgId));
  const t0 = today();
  const lo = ranges.reduce((a, r) => min(a, r.from), ranges[0].from);
  const hi = min(ranges.reduce((a, r) => max(a, r.to), ranges[0].to), t0);
  const ids = people.map((p) => p.id);
  if (lo > hi) {
    for (const p of people) out.set(p.id, new Map(ranges.map((r) => [r.key, { worked: 0, eligible: 0, source: src, from: r.from, to: r.to }])));
    return out;
  }
  /* Approved leave, by day: paid and unpaid, from the types. A half day is half. */
  const [types, leave] = await Promise.all([
    peoplePrisma.leaveType.findMany({ where: { orgId }, select: { id: true, isPaid: true } }),
    peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId: { in: ids }, status: 'APPROVED', fromDate: { lte: hi }, toDate: { gte: lo } }, select: { employeeId: true, leaveTypeId: true, fromDate: true, toDate: true, days: true, halfDay: true } }),
  ]);
  const paid = new Map(types.map((t) => [t.id, t.isPaid]));
  const leaveDates = new Map<string, Array<{ from: string; to: string; days: number; paid: boolean; half: boolean }>>();
  for (const r of leave) {
    const list = leaveDates.get(r.employeeId) || [];
    list.push({ from: r.fromDate, to: r.toDate, days: r.days, paid: paid.get(r.leaveTypeId) ?? true, half: Boolean(r.halfDay) });
    leaveDates.set(r.employeeId, list);
  }

  if (src === 'RECORD') {
    const records = await peoplePrisma.attendanceRecord.findMany({ where: { orgId, employeeId: { in: ids }, date: { gte: lo, lte: hi }, status: { in: ['PRESENT', 'HALF_DAY'] } }, select: { employeeId: true, date: true, status: true } });
    for (const p of people) {
      const mine = records.filter((r) => r.employeeId === p.id);
      const m = new Map<string, Worked>();
      for (const rg of ranges) {
        const to = min(rg.to, t0);
        const worked = mine.filter((r) => r.date >= rg.from && r.date <= to).reduce((a, r) => a + (r.status === 'HALF_DAY' ? 0.5 : 1), 0);
        /* Paid leave counted by its request's charged days, in the range: requests stay inside one leave period, so a request is in or out whole for a period; for any other range (the 12 months before), a request crossing the edge counts its share by dates. */
        const paidLeave = (leaveDates.get(p.id) || []).filter((l) => l.paid).reduce((a, l) => a + share(l, rg.from, to), 0);
        m.set(rg.key, { worked: round(worked), eligible: round(worked + paidLeave), source: src, from: rg.from, to: rg.to });
      }
      out.set(p.id, m);
    }
    return out;
  }

  /* People only: working days by the week and the holidays. */
  const [schedule, holidays] = await Promise.all([loadSchedule(orgId, ids, { from: lo, to: hi }), loadHolidays(orgId, lo, hi)]);
  for (const p of people) {
    const off = holidays.forArea(p.areaId ?? null, p.branchId ?? null);
    const m = new Map<string, Worked>();
    for (const rg of ranges) {
      const from = max(rg.from, p.dateOfJoining || rg.from);
      const to = min(min(rg.to, t0), p.dateOfLeaving || rg.to);
      let working = 0;
      for (let d = from; d <= to; d = addDays(d, 1)) if (!off.has(d) && !isWeeklyOff(resolveShift(schedule, p.id, d).rule, d)) working += 1;
      const mine = leaveDates.get(p.id) || [];
      const allLeave = mine.reduce((a, l) => a + share(l, from, to), 0);
      const unpaid = mine.filter((l) => !l.paid).reduce((a, l) => a + share(l, from, to), 0);
      const worked = Math.max(0, working - allLeave);
      m.set(rg.key, { worked: round(worked), eligible: round(Math.max(0, working - unpaid)), source: src, from: rg.from, to: rg.to });
    }
    out.set(p.id, m);
  }
  return out;
}

/** The part of a request's days inside [from, to], by calendar share when it crosses an edge. */
function share(l: { from: string; to: string; days: number }, from: string, to: string) {
  if (from > to || l.to < from || l.from > to) return 0;
  if (l.from >= from && l.to <= to) return l.days;
  const span = dayCount(l.from, l.to);
  return span ? (l.days * dayCount(max(l.from, from), min(l.to, to))) / span : 0;
}
const dayCount = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
const round = (n: number) => Math.round(n * 100) / 100;

/** Days worked in each leave period from `fromYear` to `toYear`, per person (earned leave by days worked). */
export async function daysWorkedByPeriod(accountId: string, orgId: string, people: Person[], period: LeavePeriod, fromYear: number, toYear: number, source?: Worked['source']) {
  const ranges: Range[] = [];
  for (let y = fromYear; y <= toYear; y += 1) ranges.push({ key: String(y), from: periodStart(period, y), to: periodEnd(period, y) });
  return daysWorkedIn(accountId, orgId, people, ranges, source);
}

/** Days worked in the 12 months before `date` (Code on Social Security, maternity: 80 days). */
export async function daysWorkedBefore(accountId: string, orgId: string, person: Person, date: string) {
  const from = addDays(date, -365);
  const to = addDays(date, -1);
  const m = await daysWorkedIn(accountId, orgId, [person], [{ key: 'before', from, to }]);
  return m.get(person.id)?.get('before') ?? { worked: 0, eligible: 0, source: 'WORKING_DAYS' as const, from, to };
}
