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
 *   2. the person's own schedule (latest start on or before the date, not ended)
 *   3. a rotation they are on (a hand-entered schedule always beats a pattern)
 *   4. their department's schedule
 *   5. the company default shift (Attendance rules), else 09:00–18:00, Sunday off
 * A schedule pointing at a switched-off shift is skipped, as ClorTime's join does.
 */

export type ResolvedShift = { shiftId: string | null; rule: ShiftRule; name: string; code: string | null; color: string | null; source: Source };
export type Source = 'TEMPORARY' | 'EMPLOYEE' | 'ROTATION' | 'DEPARTMENT' | 'DEFAULT';

type Ranged = { shiftId: string; from: string; to: string | null };
export type ScheduleData = {
  shifts: Map<string, { rule: ShiftRule; name: string; code: string | null; color: string | null; isActive: boolean }>;
  defaultShiftId: string | null;
  temporary: Map<string, Ranged[]>;
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
  return { shiftId: null, rule: DEFAULT_SHIFT, name: 'Standard', code: null, color: null, source: 'DEFAULT' };
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

/** Everything resolveShift needs for a company, optionally narrowed to some people. */
export async function loadSchedule(orgId: string, employeeIds?: string[]): Promise<ScheduleData> {
  const byEmp = employeeIds ? { employeeId: { in: employeeIds } } : {};
  const [shifts, settings, temporary, assignments, rotations, rotationAssignments, people, departmentSchedules] = await Promise.all([
    peoplePrisma.shift.findMany({ where: { orgId } }),
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId } }),
    peoplePrisma.temporarySchedule.findMany({ where: { orgId, ...byEmp } }),
    peoplePrisma.shiftAssignment.findMany({ where: { orgId, ...byEmp } }),
    peoplePrisma.shiftRotation.findMany({ where: { orgId } }),
    peoplePrisma.rotationAssignment.findMany({ where: { orgId, ...byEmp } }),
    peoplePrisma.employee.findMany({ where: { orgId, ...(employeeIds ? { id: { in: employeeIds } } : {}) }, select: { id: true, departmentId: true } }),
    peoplePrisma.departmentSchedule.findMany({ where: { orgId } }),
  ]);
  return {
    shifts: new Map(shifts.map((s) => [s.id, { rule: toRule(s), name: s.name, code: s.code, color: s.color, isActive: s.isActive }])),
    defaultShiftId: settings?.defaultShiftId || null,
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
 * holiday locations). Optional holidays are not days off.
 */
export async function loadHolidays(orgId: string, from: string, to: string) {
  const rows = await peoplePrisma.holiday.findMany({ where: { orgId, date: { gte: from, lte: to }, isOptional: false }, select: { date: true, name: true, areaId: true, branchId: true } });
  const company = new Set(rows.filter((h) => !h.areaId && !h.branchId).map((h) => h.date));
  const byArea = new Map<string, Set<string>>();
  for (const h of rows) {
    if (!h.areaId) continue;
    if (!byArea.has(h.areaId)) byArea.set(h.areaId, new Set());
    byArea.get(h.areaId)!.add(h.date);
  }
  const cache = new Map<string, Set<string>>();
  return {
    rows,
    company,
    /** The set of holiday dates for someone in this area (null = no area). */
    forArea(areaId: string | null | undefined) {
      const k = areaId || '';
      if (!cache.has(k)) cache.set(k, new Set([...company, ...(areaId ? byArea.get(areaId) || [] : [])]));
      return cache.get(k)!;
    },
  };
}
