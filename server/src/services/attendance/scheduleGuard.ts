import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { MonthClosedError, today } from './days.js';

/**
 * Schedule changes and closed months (closure audit O-05).
 *
 * A closed Attendance month's payable days are final: Payroll has taken them.
 * Who works what on a date decides those days (weekly offs, the shift's
 * times and rules), so a schedule change is a change to every date it
 * affects. Each write works out that range and is refused when the range
 * touches a closed month, the way a holiday in a closed month is.
 *
 *   - an assignment or schedule affects its effective range;
 *   - a shift's times or rules affect every date it applies on;
 *   - the working week affects every date, or every date from its effectiveFrom.
 *
 * A change dated entirely in the future is always allowed (a month cannot
 * close before it ends, so this is also what the range check says).
 */

/** Dates a change affects, inclusive. A null `from` = since ever; a null `to` = with no end. */
export type DateRange = { from: string | null; to: string | null };

/** The last day-of-month any month can have: `${month}-${MONTH_DAYS}` closes a string date range over a month. */
export const MONTH_DAYS = '31';

/** The month after YYYY-MM, as its first day. */
export const dayAfterMonth = (month: string) => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

const touches = (r: DateRange, month: string) => (!r.from || r.from.slice(0, 7) <= month) && (!r.to || r.to.slice(0, 7) >= month);

/**
 * The company's closed months, read once, to check many ranges against (an
 * import checks every row). Locks are a handful a year, so all of them are read.
 */
export async function scheduleGuard(orgId: string) {
  const months = (await peoplePrisma.attendanceMonthLock.findMany({ where: { orgId }, select: { month: true }, orderBy: { month: 'asc' } })).map((l) => l.month);
  const now = today();
  /** Closed months these ranges touch, earliest first. */
  const closedIn = (ranges: DateRange[]) => {
    const live = ranges.filter((r) => !(r.from && r.from > now));
    return months.filter((m) => live.some((r) => touches(r, m)));
  };
  return {
    months,
    /** The latest closed month, or null. */
    latest: months.length ? months[months.length - 1] : null,
    closedIn,
    /** The refusal for these ranges, or null when they leave every closed month alone. */
    refusal(ranges: DateRange[], message?: (month: string, latest: string) => string) {
      const hit = closedIn(ranges);
      if (!hit.length) return null;
      const first = hit[0];
      const last = hit[hit.length - 1];
      return new MonthClosedError(first, message ? message(first, last) : scheduleMessage(first, last));
    },
    assertOpen(ranges: DateRange[], message?: (month: string, latest: string) => string) {
      const e = this.refusal(ranges, message);
      if (e) throw e;
    },
  };
}

/** The usual refusal: names the closed month and the first date the change could start from instead. */
export const scheduleMessage = (month: string, latest: string) =>
  `${month} is closed in Attendance, and this change would work its days out again. Reopen the month, or make the change from ${dayAfterMonth(latest)} or later.`;

export async function assertScheduleOpen(orgId: string, ranges: DateRange[], message?: (month: string, latest: string) => string) {
  (await scheduleGuard(orgId)).assertOpen(ranges, message);
}

/**
 * Every date a shift applies on: its own schedules (assignments, temporary,
 * department, published roster days), the rotations it is a step of, and every date when it is the
 * company default. A switched-off shift counts too: switching it back on would
 * move those dates onto it again.
 */
export async function shiftRanges(orgId: string, shiftId: string): Promise<DateRange[]> {
  const [settings, assignments, temporary, departments, rotations, rosterDays] = await Promise.all([
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { defaultShiftId: true } }),
    peoplePrisma.shiftAssignment.findMany({ where: { orgId, shiftId }, select: { effectiveFrom: true, effectiveTo: true } }),
    peoplePrisma.temporarySchedule.findMany({ where: { orgId, shiftId }, select: { fromDate: true, toDate: true } }),
    peoplePrisma.departmentSchedule.findMany({ where: { orgId, shiftId }, select: { effectiveFrom: true, effectiveTo: true } }),
    peoplePrisma.shiftRotation.findMany({ where: { orgId }, select: { id: true, sequence: true } }),
    peoplePrisma.rosterDay.findMany({ where: { orgId, shiftId, state: 'PUBLISHED' }, select: { date: true }, distinct: ['date'] }),
  ]);
  if (settings?.defaultShiftId === shiftId) return [{ from: null, to: null }];
  const onRotations = rotations.filter((r) => r.sequence.split(',').map((x) => x.trim()).includes(shiftId)).map((r) => r.id);
  const rotationPeople = onRotations.length
    ? await peoplePrisma.rotationAssignment.findMany({ where: { orgId, rotationId: { in: onRotations } }, select: { startsOn: true, endsOn: true } })
    : [];
  return [
    ...assignments.map((a) => ({ from: a.effectiveFrom, to: a.effectiveTo })),
    ...temporary.map((t) => ({ from: t.fromDate, to: t.toDate })),
    ...departments.map((d) => ({ from: d.effectiveFrom, to: d.effectiveTo })),
    ...rotationPeople.map((r) => ({ from: r.startsOn, to: r.endsOn })),
    ...rosterDays.map((r) => ({ from: r.date, to: r.date })),
  ];
}

/** Every date a rotation applies on: the ranges of the people on it. */
export async function rotationRanges(orgId: string, rotationId: string): Promise<DateRange[]> {
  const rows = await peoplePrisma.rotationAssignment.findMany({ where: { orgId, rotationId }, select: { startsOn: true, endsOn: true } });
  return rows.map((r) => ({ from: r.startsOn, to: r.endsOn }));
}
