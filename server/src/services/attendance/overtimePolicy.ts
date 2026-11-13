/**
 * Overtime, priced and capped.
 *
 * The day engine (compute.ts) says how many minutes of a day are overtime.
 * This says two more things about those minutes, without changing them:
 *
 *  - what they are worth: a rate for each kind of day (a working day, a weekly
 *    off, a holiday). `weighted` minutes are the minutes times the day's rate,
 *    so 2 hours on a holiday at 3× are 6 weighted hours. Payroll still reads
 *    the plain approved hours (`approvedOvertimeMinutes`); the weighted figure
 *    sits beside it for a formula that wants it.
 *  - how many are over the company's caps: a day, a week, a quarter. Minutes
 *    over a cap are never dropped. They stay on the day, are named "over the
 *    cap" wherever overtime is approved, and count once someone approves them.
 *
 * Pure: no database. `overtimePolicyOf` reads the stored JSON over its defaults.
 *
 * Where the defaults and the suggested caps come from (the Factories Act, 1948;
 * it covers factories only, and several states have amended these sections, so
 * the screen says to check the state's own rule before relying on them):
 *
 *  - Rates, 2 for every kind of day: s.59(1), "wages at the rate of twice his
 *    ordinary rate of wages" for work beyond nine hours a day or forty-eight a
 *    week. The Act names no higher rate for a weekly off or a holiday; a
 *    company that pays one sets it.
 *  - Caps are off (null) until a company sets them. Suggested, all from
 *    s.64(4), the limits on the exemptions a state may make by rule:
 *      a day: 2 hours, from (i) "total number of hours of work in any day shall
 *        not exceed ten", less an 8-hour day (1 hour for a 9-hour day, s.54);
 *      a week: 12 hours, from (iii) "total number of hours of work in a week,
 *        including overtime, shall not exceed sixty", less the 48 of s.51;
 *      a quarter: 50 hours, from (iv) "total number of hours of overtime shall
 *        not exceed fifty for any one quarter". s.65(3)(iv) allows 75 under a
 *        state's order for exceptional pressure of work, and state amendments
 *        go higher, which is why this one is said to be state-specific.
 *  - The week runs Sunday to Saturday: s.2(f), "a period of seven days
 *    beginning at midnight on Saturday night". The quarter is three months from
 *    1 January, 1 April, 1 July or 1 October: the Explanation to s.64(4).
 *
 * These were written from the text of the Act as the author knows it, not
 * checked against a current gazette or any state's rules; the screen says so.
 */

export type OvertimeDayType = 'working' | 'weeklyOff' | 'holiday';

export type OvertimePolicy = {
  rates: Record<OvertimeDayType, number>;
  caps: { dayMinutes: number | null; weekMinutes: number | null; quarterMinutes: number | null };
};

/** Factories Act 1948 s.59(1): twice the ordinary rate, whatever the day. */
export const DEFAULT_OVERTIME_RATE = 2;

export const DEFAULT_OVERTIME_POLICY: OvertimePolicy = {
  rates: { working: DEFAULT_OVERTIME_RATE, weeklyOff: DEFAULT_OVERTIME_RATE, holiday: DEFAULT_OVERTIME_RATE },
  caps: { dayMinutes: null, weekMinutes: null, quarterMinutes: null },
};

/** Offered on the screen, never applied on their own: Factories Act 1948 s.64(4)(i), (iii) and (iv), as above. */
export const SUGGESTED_OVERTIME_CAPS = { dayMinutes: 2 * 60, weekMinutes: 12 * 60, quarterMinutes: 50 * 60 } as const;

export const OVERTIME_RATE_MAX = 10;
export const OVERTIME_CAP_MAX = { dayMinutes: 24 * 60, weekMinutes: 7 * 24 * 60, quarterMinutes: 92 * 24 * 60 } as const;

const rateOf = (v: unknown) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n >= 1 && n <= OVERTIME_RATE_MAX ? Math.round(n * 100) / 100 : DEFAULT_OVERTIME_RATE;
};
const capOf = (v: unknown, max: number) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : null;
};

/** AttendanceSettings.overtimePolicy, read safely over the defaults. */
export function overtimePolicyOf(raw: unknown): OvertimePolicy {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { rates?: Record<string, unknown>; caps?: Record<string, unknown> };
  return {
    rates: { working: rateOf(o.rates?.working), weeklyOff: rateOf(o.rates?.weeklyOff), holiday: rateOf(o.rates?.holiday) },
    caps: {
      dayMinutes: capOf(o.caps?.dayMinutes, OVERTIME_CAP_MAX.dayMinutes),
      weekMinutes: capOf(o.caps?.weekMinutes, OVERTIME_CAP_MAX.weekMinutes),
      quarterMinutes: capOf(o.caps?.quarterMinutes, OVERTIME_CAP_MAX.quarterMinutes),
    },
  };
}

export const hasOvertimeCaps = (p: OvertimePolicy) => p.caps.dayMinutes !== null || p.caps.weekMinutes !== null || p.caps.quarterMinutes !== null;

/** A holiday that falls on a weekly off is a holiday. */
export const overtimeDayType = (isHoliday: boolean, isWeeklyOff: boolean): OvertimeDayType => (isHoliday ? 'holiday' : isWeeklyOff ? 'weeklyOff' : 'working');

/** Minutes times the day's rate, to the minute. */
export const weightedOvertime = (minutes: number, type: OvertimeDayType, policy: OvertimePolicy) => Math.round(Math.max(0, minutes) * policy.rates[type]);

const utc = (date: string) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The Sunday that starts a date's week (Factories Act s.2(f)). */
export const overtimeWeekStart = (date: string) => {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return iso(d);
};

/** The 1 January, 1 April, 1 July or 1 October that starts a date's quarter (Explanation to s.64(4)). */
export const overtimeQuarterStart = (date: string) => `${date.slice(0, 4)}-${String(Math.floor((Number(date.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;

/** The earliest day whose overtime can count against a cap on `date`: its quarter's start, or its week's when that is earlier. */
export const overtimeCapFrom = (date: string) => {
  const q = overtimeQuarterStart(date);
  const w = overtimeWeekStart(date);
  return w < q ? w : q;
};

export type CapReason = 'DAY' | 'WEEK' | 'QUARTER';
export type CappedDay = { minutes: number; withinCap: number; overCap: number; by: CapReason | null };

/**
 * One person's overtime days against the caps. Each day's minutes are split
 * into those inside every cap and those over one; `by` names the tightest cap
 * that cut the day. Overtime worked earlier in the week or quarter uses the
 * cap up whether or not it was approved: the caps are on hours worked.
 *
 * `days` must hold every overtime day from `overtimeCapFrom` of the first date
 * asked about, or the running totals start short.
 */
export function capOvertime(days: Array<{ date: string; minutes: number }>, policy: OvertimePolicy): Map<string, CappedDay> {
  const out = new Map<string, CappedDay>();
  const { dayMinutes, weekMinutes, quarterMinutes } = policy.caps;
  const week = new Map<string, number>();
  const quarter = new Map<string, number>();
  for (const d of [...days].filter((x) => x.minutes > 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const wk = overtimeWeekStart(d.date);
    const q = overtimeQuarterStart(d.date);
    const limits: Array<[CapReason, number]> = [];
    if (dayMinutes !== null) limits.push(['DAY', dayMinutes]);
    if (weekMinutes !== null) limits.push(['WEEK', Math.max(0, weekMinutes - (week.get(wk) || 0))]);
    if (quarterMinutes !== null) limits.push(['QUARTER', Math.max(0, quarterMinutes - (quarter.get(q) || 0))]);
    let withinCap = d.minutes;
    let by: CapReason | null = null;
    for (const [reason, room] of limits) {
      if (room < withinCap) {
        withinCap = room;
        by = reason;
      }
    }
    out.set(d.date, { minutes: d.minutes, withinCap, overCap: d.minutes - withinCap, by });
    week.set(wk, (week.get(wk) || 0) + d.minutes);
    quarter.set(q, (quarter.get(q) || 0) + d.minutes);
  }
  return out;
}

const hm = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;

/** "1 h 30 min over the cap of 2 h a day", for the approver and the employee. */
export function overCapWords(c: Pick<CappedDay, 'overCap' | 'by'> | null | undefined, policy: OvertimePolicy): string | null {
  if (!c?.overCap || !c.by) return null;
  const cap = c.by === 'DAY' ? `${hm(policy.caps.dayMinutes || 0)} a day` : c.by === 'WEEK' ? `${hm(policy.caps.weekMinutes || 0)} a week` : `${hm(policy.caps.quarterMinutes || 0)} a quarter`;
  return `${hm(c.overCap)} over the cap of ${cap}`;
}
