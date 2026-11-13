import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { isWeeklyOff } from './compute.js';
import type { periodContext } from './days.js';
import { capOvertime, hasOvertimeCaps, overCapWords, overtimeCapFrom, overtimeDayType, overtimePolicyOf, weightedOvertime, type CapReason, type OvertimeDayType, type OvertimePolicy } from './overtimePolicy.js';

/**
 * Each overtime day of a period, priced and capped (overtimePolicy.ts), read
 * from the same period context as the month summary and the reports, so the
 * approvals list, the register, Payroll readiness and the figure Payroll takes
 * cannot disagree about what a day's overtime is worth or how much of it is
 * over the cap. Nothing here changes a day.
 */

type Ctx = Awaited<ReturnType<typeof periodContext>>;

export type OvertimeDay = {
  date: string;
  minutes: number;
  approved: boolean;
  dayType: OvertimeDayType;
  rate: number;
  /** Minutes times the day's rate. */
  weightedMinutes: number;
  /** The part over a cap, and which cap; 0 and null when inside every cap or no cap is set. */
  overCapMinutes: number;
  overCapBy: CapReason | null;
  /** "1 h over the cap of 2 h a day", or null. */
  overCap: string | null;
};

export type OvertimeTotals = {
  /** Approved overtime, each minute at its day's rate: what the plain approved hours are worth in ordinary-rate minutes. */
  weightedOvertimeMinutes: number;
  /** Approved overtime by kind of day: the minutes, and the same minutes at the rate. */
  overtimeByDayType: Record<OvertimeDayType, { minutes: number; weightedMinutes: number; rate: number }>;
  /** Recorded overtime over a cap, approved or not; and the part of it already approved. */
  overCapOvertimeMinutes: number;
  approvedOverCapMinutes: number;
};

export const policyOfSettings = (settings: { overtimePolicy?: unknown } | null | undefined): OvertimePolicy => overtimePolicyOf(settings?.overtimePolicy);

/**
 * Every overtime day in the context's period, by person and date. With a cap
 * set, the overtime worked earlier in the first date's week and quarter is read
 * too, so a month's first days are measured against what was already worked.
 */
export async function overtimeDaysOver(ctx: Ctx, orgId: string): Promise<{ policy: OvertimePolicy; days: Map<string, Map<string, OvertimeDay>> }> {
  const policy = policyOfSettings(ctx.settings as { overtimePolicy?: unknown } | null);
  const out = new Map<string, Map<string, OvertimeDay>>();
  const inPeriod = ctx.records.filter((r) => r.overtimeMinutes > 0);
  if (!inPeriod.length) return { policy, days: out };
  const ids = [...new Set(inPeriod.map((r) => r.employeeId))];
  const from = ctx.days[0];
  const earlier = hasOvertimeCaps(policy)
    ? await peoplePrisma.attendanceRecord.findMany({ where: { orgId, employeeId: { in: ids }, date: { gte: overtimeCapFrom(from), lt: from }, overtimeMinutes: { gt: 0 } }, select: { employeeId: true, date: true, overtimeMinutes: true } })
    : [];
  const personOf = new Map(ctx.people.map((p) => [p.id, p]));
  for (const id of ids) {
    const mine = inPeriod.filter((r) => r.employeeId === id);
    const capped = capOvertime(
      [...earlier.filter((r) => r.employeeId === id), ...mine].map((r) => ({ date: r.date, minutes: r.overtimeMinutes })),
      policy,
    );
    const person = personOf.get(id);
    const holidays = person ? ctx.holidaysFor(person) : ctx.holidaySet;
    const byDate = new Map<string, OvertimeDay>();
    for (const r of mine) {
      const dayType = overtimeDayType(holidays.has(r.date), isWeeklyOff(ctx.shiftOn(id, r.date).rule, r.date));
      const c = capped.get(r.date);
      byDate.set(r.date, {
        date: r.date,
        minutes: r.overtimeMinutes,
        approved: r.overtimeApproved,
        dayType,
        rate: policy.rates[dayType],
        weightedMinutes: weightedOvertime(r.overtimeMinutes, dayType, policy),
        overCapMinutes: c?.overCap || 0,
        overCapBy: c?.by || null,
        overCap: overCapWords(c, policy),
      });
    }
    out.set(id, byDate);
  }
  return { policy, days: out };
}

/** One person's totals over some dates of the period (the dates the month summary counted). */
export function overtimeTotals(days: Map<string, OvertimeDay> | undefined, dates: Iterable<string>, policy: OvertimePolicy): OvertimeTotals {
  const byType = (t: OvertimeDayType) => ({ minutes: 0, weightedMinutes: 0, rate: policy.rates[t] });
  const t: OvertimeTotals = { weightedOvertimeMinutes: 0, overtimeByDayType: { working: byType('working'), weeklyOff: byType('weeklyOff'), holiday: byType('holiday') }, overCapOvertimeMinutes: 0, approvedOverCapMinutes: 0 };
  if (!days) return t;
  for (const date of dates) {
    const d = days.get(date);
    if (!d) continue;
    t.overCapOvertimeMinutes += d.overCapMinutes;
    if (!d.approved) continue;
    t.weightedOvertimeMinutes += d.weightedMinutes;
    t.overtimeByDayType[d.dayType].minutes += d.minutes;
    t.overtimeByDayType[d.dayType].weightedMinutes += d.weightedMinutes;
    t.approvedOverCapMinutes += d.overCapMinutes;
  }
  return t;
}

/**
 * The same, for a handful of days named one by one (the requests waiting, a
 * day being approved): each person's period is read once, from the earliest
 * date asked about to the latest.
 */
export async function overtimeDaysFor(accountId: string, orgId: string, asked: Array<{ employeeId: string; date: string }>) {
  const { periodContext: load } = await import('./days.js');
  const empty = { policy: policyOfSettings(await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { overtimePolicy: true } })), days: new Map<string, Map<string, OvertimeDay>>() };
  if (!asked.length) return empty;
  const dates = asked.map((a) => a.date).sort();
  const ctx = await load(accountId, orgId, dates[0], dates[dates.length - 1], { employeeIds: [...new Set(asked.map((a) => a.employeeId))] });
  return overtimeDaysOver(ctx, orgId);
}
