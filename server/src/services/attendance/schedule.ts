import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { DEFAULT_SHIFT, type ShiftRule } from './compute.js';

/**
 * Which shift someone works on a date. One answer for the whole product —
 * the day engine, the month summary, the reports and the schedule screens all
 * ask here, so none can disagree (ClorTime learnt this the hard way: its shift
 * module was "decorative" because the engine read a different table from the
 * one the screens wrote).
 *
 * Precedence, ClorTime's (attendance_engine.js shiftFor, rotations.js):
 *   1. a temporary schedule covering the date
 *   2. the day on the published roster (the roster planner): that shift, worked
 *      whatever the shift's own weekly offs say, or a weekly off on whatever
 *      shift the steps below give. A roster draft is never read here.
 *   3. the person's own schedule (latest start on or before the date, not ended)
 *   4. a rotation they are on (a hand-entered schedule always beats a pattern)
 *   5. their department's schedule
 *   6. the company default shift (Attendance rules), else 09:00–18:00, Sunday off
 * A schedule pointing at a switched-off shift is skipped, as ClorTime's join does.
 */

export type ResolvedShift = { shiftId: string | null; rule: ShiftRule; name: string; code: string | null; color: string | null; source: Source };
export type Source = 'TEMPORARY' | 'ROSTER' | 'EMPLOYEE' | 'ROTATION' | 'DEPARTMENT' | 'DEFAULT';

/** Dates, inclusive, as YYYY-MM-DD. */
export type DateSpan = { from: string; to: string };
/**
 * Roster days are a row a person a day (500 people: about 180,000 a year), so
 * they are read for the dates a caller will resolve and no others. A caller
 * that names no dates gets this many days either side of today.
 */
export const ROSTER_DEFAULT_DAYS = 62;
/** Loaded a day wider than asked at each end: a night shift's morning is scored on the day before, and a rest rule looks a day past the edge. */
const ROSTER_MARGIN_DAYS = 1;
const shiftDate = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The dates roster days are read for: the caller's, or the default window about today, a day wider at each end. */
export function rosterSpan(range?: DateSpan | null, now: Date = new Date()): DateSpan {
  /* Today in India, as every date in Attendance is. */
  const today = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const asked = range && range.from && range.to && range.from <= range.to ? range : { from: shiftDate(today, -ROSTER_DEFAULT_DAYS), to: shiftDate(today, ROSTER_DEFAULT_DAYS) };
  return { from: shiftDate(asked.from, -ROSTER_MARGIN_DAYS), to: shiftDate(asked.to, ROSTER_MARGIN_DAYS) };
}
const warned = new WeakSet<object>();

/** A published roster day: a shift to work, or a weekly off. */
export type RosterMark = { kind: 'SHIFT' | 'OFF'; shiftId: string | null };
/** Every weekday off: what a rostered weekly off makes of the day's rule. */
const EVERY_DAY_OFF = '0,1,2,3,4,5,6';

type Ranged = { shiftId: string; from: string; to: string | null };
export type ScheduleData = {
  shifts: Map<string, { rule: ShiftRule; name: string; code: string | null; color: string | null; isActive: boolean }>;
  defaultShiftId: string | null;
  /** The company's working week on the standard 09:00–18:00 day, for anyone no shift covers (People-only companies set only this). */
  standardRule?: ShiftRule;
  /** Earlier working weeks, oldest first: a date before `until` follows that week instead (a change made from a date). */
  standardEarlier?: Array<{ until: string; rule: ShiftRule }>;
  temporary: Map<string, Ranged[]>;
  /** Published roster days, by person then date. Drafts are never loaded. */
  roster?: Map<string, Map<string, RosterMark>>;
  /** The dates the roster days were loaded for, inclusive: outside them the roster is not known (loadSchedule). */
  rosterRange?: DateSpan;
  assignments: Map<string, Ranged[]>;
  rotations: Map<string, { sequence: Array<string | null>; periodDays: number; anchorDate: string; isActive: boolean }>;
  rotationAssignments: Map<string, Array<{ rotationId: string; slotOffset: number; from: string; to: string | null }>>;
  departmentSchedules: Map<string, Ranged[]>;
  departmentOf: Map<string, string | null>;
};

export const toRule = (s: any): ShiftRule => ({
  startTime: s.startTime,
  endTime: s.endTime,
  breakMinutes: s.breakMinutes,
  graceMinutes: s.graceMinutes,
  earlyOutGraceMinutes: s.earlyOutGraceMinutes,
  halfDayMinutes: s.halfDayMinutes,
  fullDayMinutes: s.fullDayMinutes,
  overtimeAfterMinutes: s.overtimeAfterMinutes,
  weeklyOffDays: s.weeklyOffDays,
  offSaturdays: s.offSaturdays || '',
  checkInBeforeMinutes: s.checkInBeforeMinutes ?? null,
  checkOutAfterMinutes: s.checkOutAfterMinutes ?? null,
});

const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

/** Which step of a rotation a date falls in (ClorTime slotFor): periods counted from the anchor, shifted by the offset. */
export function rotationSlot(date: string, anchorDate: string, periodDays: number, length: number, offset = 0) {
  const days = dayNumber(date) - dayNumber(anchorDate);
  if (days < 0 || length <= 0 || periodDays <= 0) return null;
  const slot = (Math.floor(days / periodDays) + offset) % length;
  return slot < 0 ? slot + length : slot;
}

const covering = (list: Ranged[] | undefined, date: string) => {
  let found: Ranged | null = null;
  for (const r of list || []) {
    if (r.from > date) continue;
    if (r.to && r.to < date) continue;
    if (!found || r.from >= found.from) found = r;
  }
  return found;
};

export function resolveShift(data: ScheduleData, employeeId: string, date: string): ResolvedShift {
  const usable = (id: string | null | undefined) => (id && data.shifts.get(id)?.isActive ? id : null);
  const shaped = (id: string, source: Source): ResolvedShift => {
    const s = data.shifts.get(id)!;
    return { shiftId: id, rule: s.rule, name: s.name, code: s.code, color: s.color, source };
  };

  const temp = (data.temporary.get(employeeId) || []).find((t) => t.from <= date && (!t.to || t.to >= date) && usable(t.shiftId));
  if (temp) return shaped(temp.shiftId, 'TEMPORARY');

  /* The roster names the day itself, so the shift's weekly pattern steps aside: a rostered shift is a working day, a rostered off is not. */
  /* A date outside the dates the roster was read for has no roster day here whatever the table holds: the caller asked for too few dates. Said once, loudly, in the log. */
  if (data.rosterRange && (date < data.rosterRange.from || date > data.rosterRange.to) && !warned.has(data)) {
    warned.add(data);
    console.warn(`[schedule] ${date} resolved outside the roster dates loaded (${data.rosterRange.from} to ${data.rosterRange.to}); pass loadSchedule the dates it will be asked for.`);
  }
  const mark = data.roster?.get(employeeId)?.get(date);
  if (mark?.kind === 'SHIFT' && usable(mark.shiftId)) {
    const r = shaped(mark.shiftId!, 'ROSTER');
    return { ...r, rule: { ...r.rule, weeklyOffDays: '', offSaturdays: '' } };
  }
  const under = schedulesOf(data, employeeId, date);
  return mark?.kind === 'OFF' ? { ...under, rule: { ...under.rule, weeklyOffDays: EVERY_DAY_OFF, offSaturdays: '' }, source: 'ROSTER' } : under;
}

/** Steps 3 to 6 of resolveShift: own schedule, rotation, department, company default. */
function schedulesOf(data: ScheduleData, employeeId: string, date: string): ResolvedShift {
  const usable = (id: string | null | undefined) => (id && data.shifts.get(id)?.isActive ? id : null);
  const shaped = (id: string, source: Source): ResolvedShift => {
    const s = data.shifts.get(id)!;
    return { shiftId: id, rule: s.rule, name: s.name, code: s.code, color: s.color, source };
  };

  const own = covering((data.assignments.get(employeeId) || []).filter((a) => usable(a.shiftId)), date);
  if (own) return shaped(own.shiftId, 'EMPLOYEE');

  for (const ra of data.rotationAssignments.get(employeeId) || []) {
    if (ra.from > date || (ra.to && ra.to < date)) continue;
    const rot = data.rotations.get(ra.rotationId);
    if (!rot?.isActive) continue;
    const slot = rotationSlot(date, rot.anchorDate, rot.periodDays, rot.sequence.length, ra.slotOffset);
    const id = slot === null ? null : usable(rot.sequence[slot]);
    if (id) return shaped(id, 'ROTATION');
  }

  const dept = data.departmentOf.get(employeeId);
  const ds = dept ? covering((data.departmentSchedules.get(dept) || []).filter((d) => usable(d.shiftId)), date) : null;
  if (ds) return shaped(ds.shiftId, 'DEPARTMENT');

  const def = usable(data.defaultShiftId);
  if (def) return shaped(def, 'DEFAULT');
  const earlier = data.standardEarlier?.find((e) => date < e.until);
  return { shiftId: null, rule: earlier?.rule || data.standardRule || DEFAULT_SHIFT, name: 'Standard', code: null, color: null, source: 'DEFAULT' };
}

const group = <T, K extends string>(rows: T[], key: (r: T) => K) => {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
};

/** A week the company worked before a working-week change made from a date. */
export type EarlierWeek = { until: string; weeklyOffDays: string; offSaturdays: string };

/** AttendanceSettings.workingWeekEarlier, read safely: well-formed entries, oldest first. */
export function earlierWeeks(raw: unknown): EarlierWeek[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w: any) => w && /^\d{4}-\d{2}-\d{2}$/.test(String(w.until)) && typeof w.weeklyOffDays === 'string')
    .map((w: any) => ({ until: String(w.until), weeklyOffDays: String(w.weeklyOffDays), offSaturdays: String(w.offSaturdays || '') }))
    .sort((a, b) => (a.until < b.until ? -1 : a.until > b.until ? 1 : 0));
}

/**
 * The weeks to keep when the working week changes from `from`: every earlier
 * week that ended by then, and the week `from` falls in, cut short at `from`.
 * Weeks that would have started on or after `from` are replaced by the new one.
 */
export function weeksBefore(earlier: EarlierWeek[], current: { weeklyOffDays: string; offSaturdays: string }, from: string): EarlierWeek[] {
  const kept = earlier.filter((w) => w.until <= from);
  const startOfSegment = kept.length ? kept[kept.length - 1].until : null;
  const covering = earlier.find((w) => w.until > from) || current;
  if (startOfSegment === null || startOfSegment < from) kept.push({ until: from, weeklyOffDays: covering.weeklyOffDays, offSaturdays: covering.offSaturdays || '' });
  return kept;
}

/**
 * Everything resolveShift needs for a company, optionally narrowed to some people.
 *
 * `range` is the dates the caller will resolve, inclusive. The ranged tables
 * (assignments, rotations, department and temporary schedules) are a handful
 * of rows a person and are read whole; published roster days are a row a
 * person a day and are read for `range` only (a day wider at each end). Every
 * caller that knows its dates passes them. With no range the roster is read
 * for ROSTER_DEFAULT_DAYS either side of today, which is right for "now" and
 * wrong for a month last year: resolveShift warns when asked for a date
 * outside what was loaded. The query is served by the indexes the table has:
 * (employeeId, date, state) when people are named, (orgId, state, date) when
 * the whole company is read.
 */
export async function loadSchedule(orgId: string, employeeIds?: string[], range?: DateSpan | null): Promise<ScheduleData> {
  const byEmp = employeeIds ? { employeeId: { in: employeeIds } } : {};
  const span = rosterSpan(range);
  const [shifts, settings, temporary, assignments, rotations, rotationAssignments, people, departmentSchedules, rosterDays] = await Promise.all([
    peoplePrisma.shift.findMany({ where: { orgId } }),
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId } }),
    peoplePrisma.temporarySchedule.findMany({ where: { orgId, ...byEmp } }),
    peoplePrisma.shiftAssignment.findMany({ where: { orgId, ...byEmp } }),
    peoplePrisma.shiftRotation.findMany({ where: { orgId } }),
    peoplePrisma.rotationAssignment.findMany({ where: { orgId, ...byEmp } }),
    peoplePrisma.employee.findMany({ where: { orgId, ...(employeeIds ? { id: { in: employeeIds } } : {}) }, select: { id: true, departmentId: true } }),
    peoplePrisma.departmentSchedule.findMany({ where: { orgId } }),
    /* Published only: a draft is a plan, and must not move anyone's day. */
    peoplePrisma.rosterDay.findMany({ where: { orgId, state: 'PUBLISHED', date: { gte: span.from, lte: span.to }, ...byEmp }, select: { employeeId: true, date: true, kind: true, shiftId: true } }),
  ]);
  const roster = new Map<string, Map<string, RosterMark>>();
  for (const d of rosterDays) {
    if (d.kind !== 'SHIFT' && d.kind !== 'OFF') continue;
    if (!roster.has(d.employeeId)) roster.set(d.employeeId, new Map());
    roster.get(d.employeeId)!.set(d.date, { kind: d.kind, shiftId: d.shiftId });
  }
  return {
    shifts: new Map(shifts.map((s) => [s.id, { rule: toRule(s), name: s.name, code: s.code, color: s.color, isActive: s.isActive }])),
    defaultShiftId: settings?.defaultShiftId || null,
    standardRule: settings ? { ...DEFAULT_SHIFT, weeklyOffDays: settings.weeklyOffDays ?? DEFAULT_SHIFT.weeklyOffDays, offSaturdays: settings.offSaturdays || '' } : DEFAULT_SHIFT,
    standardEarlier: earlierWeeks(settings?.workingWeekEarlier).map((w) => ({ until: w.until, rule: { ...DEFAULT_SHIFT, weeklyOffDays: w.weeklyOffDays, offSaturdays: w.offSaturdays } })),
    roster,
    rosterRange: span,
    temporary: group(temporary.map((t) => ({ employeeId: t.employeeId, shiftId: t.shiftId, from: t.fromDate, to: t.toDate })), (t) => t.employeeId) as any,
    assignments: group(assignments.map((a) => ({ employeeId: a.employeeId, shiftId: a.shiftId, from: a.effectiveFrom, to: a.effectiveTo })), (a) => a.employeeId) as any,
    rotations: new Map(
      rotations.map((r) => [
        r.id,
        { sequence: r.sequence.split(',').map((x) => (x.trim() && x.trim() !== 'OFF' ? x.trim() : null)), periodDays: r.periodDays, anchorDate: r.anchorDate, isActive: r.isActive },
      ])
    ),
    rotationAssignments: group(
      rotationAssignments.map((r) => ({ employeeId: r.employeeId, rotationId: r.rotationId, slotOffset: r.slotOffset, from: r.startsOn, to: r.endsOn })),
      (r) => r.employeeId
    ) as any,
    departmentSchedules: group(departmentSchedules.map((d) => ({ departmentId: d.departmentId, shiftId: d.shiftId, from: d.effectiveFrom, to: d.effectiveTo })), (d) => d.departmentId) as any,
    departmentOf: new Map(people.map((p) => [p.id, p.departmentId])),
  };
}

/**
 * Holidays a person has, by date: the company's, plus their area's (ClorTime's
 * holiday locations) and their branch's. A holiday set for an area and a branch
 * is for people in both — the same rule as isHoliday, which writes the days.
 * Optional holidays are not days off.
 */
export async function loadHolidays(orgId: string, from: string, to: string) {
  const rows = await peoplePrisma.holiday.findMany({ where: { orgId, date: { gte: from, lte: to }, isOptional: false }, select: { date: true, name: true, areaId: true, branchId: true } });
  const company = new Set(rows.filter((h) => !h.areaId && !h.branchId).map((h) => h.date));
  const cache = new Map<string, Set<string>>();
  return {
    rows,
    company,
    /** The set of holiday dates for someone in this area and branch (null = none). */
    forArea(areaId: string | null | undefined, branchId: string | null | undefined = null) {
      const k = `${areaId || ''}|${branchId || ''}`;
      if (!cache.has(k)) {
        cache.set(k, new Set(rows.filter((h) => (!h.areaId || h.areaId === areaId) && (!h.branchId || h.branchId === branchId)).map((h) => h.date)));
      }
      return cache.get(k)!;
    },
  };
}
