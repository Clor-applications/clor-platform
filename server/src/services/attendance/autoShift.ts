import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { isOvernight, shiftWindow, type ShiftRule } from './compute.js';
import { loadSchedule, resolveShift, toRule } from './schedule.js';

/**
 * The punch window and the first punch picking the shift (ERPNext gap 6,
 * batch 2; owner 29 Oct 2026).
 *
 * Punch window: a shift may say how early a check-in and how late a check-out
 * still count (ERPNext's "begin check-in before shift start" and "allow
 * check-out after shift end"). A reader punch outside it is kept, as every
 * punch is, but does not make the day: a 05:10 punch from the night watchman
 * walking past the reader is not a 09:00 shift's check-in.
 *
 * First punch picks the shift: with the company switch on, someone who has no
 * schedule of their own — no temporary, personal or rotation schedule; the
 * department's schedule and the company default may be overridden — works
 * the shift marked "can be picked" whose start is nearest their first punch of
 * the day, among those whose window takes it. The pick is saved as a one-day
 * temporary schedule marked pickedByPunch, so the day, the month, reports and
 * payroll all read the same shift (schedule.ts resolveShift). A later, earlier
 * punch may pick again; a schedule a person wrote is never touched. Shifts
 * that end the next day are not picked: which date a night punch belongs to
 * is itself decided by the shift, and guessing both at once is how a 06:00
 * exit lands on the wrong day.
 */

/** With no window set, a check-in up to this long before a shift's start can still pick it. */
export const PICK_EARLY_MINUTES = 180;

/** Is this instant inside the shift's punch window on that date? Unset ends do not limit. */
export function inPunchWindow(rule: Pick<ShiftRule, 'startTime' | 'endTime' | 'checkInBeforeMinutes' | 'checkOutAfterMinutes'>, date: string, at: Date) {
  const { start, end } = shiftWindow(rule as ShiftRule, date);
  if (rule.checkInBeforeMinutes != null && at.getTime() < start.getTime() - rule.checkInBeforeMinutes * 60_000) return false;
  if (rule.checkOutAfterMinutes != null && at.getTime() > end.getTime() + rule.checkOutAfterMinutes * 60_000) return false;
  return true;
}

/** The punches of a day that count for its shift: those inside the window. */
export function withinWindow<T extends { at: Date }>(rule: ShiftRule, date: string, points: T[]) {
  if (rule.checkInBeforeMinutes == null && rule.checkOutAfterMinutes == null) return points;
  return points.filter((p) => inPunchWindow(rule, date, p.at));
}

/**
 * Which pickable shift a first punch picks: the one whose start is nearest,
 * among those it could be the check-in of (not before the window opens, not
 * after the shift ends). Null when none takes it.
 */
export function pickShift(candidates: Array<{ id: string; rule: ShiftRule }>, date: string, firstPunch: Date) {
  let best: { id: string; gap: number } | null = null;
  for (const c of candidates) {
    const { start, end } = shiftWindow(c.rule, date);
    const early = (c.rule.checkInBeforeMinutes ?? PICK_EARLY_MINUTES) * 60_000;
    if (firstPunch.getTime() < start.getTime() - early || firstPunch.getTime() >= end.getTime()) continue;
    const gap = Math.abs(firstPunch.getTime() - start.getTime());
    if (!best || gap < best.gap) best = { id: c.id, gap };
  }
  return best?.id ?? null;
}

/**
 * Pick (or re-pick, or let go of) the day's shift from its first punch. Does
 * nothing when the company switch is off or the person has a schedule someone
 * wrote. Returns the shift picked, or null.
 */
export async function autoPickShift(accountId: string, orgId: string, employeeId: string, date: string, firstPunch: Date | null) {
  const settings = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { autoShiftByPunch: true } });
  if (!settings?.autoShiftByPunch) return null;
  const temps = await peoplePrisma.temporarySchedule.findMany({ where: { orgId, employeeId, fromDate: { lte: date }, toDate: { gte: date } } });
  /* A temporary schedule a person wrote (a shift change request, HR's own) wins; the pick never replaces it. */
  if (temps.some((t) => !t.pickedByPunch)) return null;
  const mine = temps.find((t) => t.pickedByPunch && t.fromDate === date && t.toDate === date) || null;
  /* What the day would be without a pick: a personal or rotation schedule decides, so nothing is picked. */
  const data = await loadSchedule(orgId, [employeeId]);
  data.temporary.delete(employeeId);
  const without = resolveShift(data, employeeId, date);
  const letGo = async () => {
    if (mine) await peoplePrisma.temporarySchedule.delete({ where: { id: mine.id } });
    return null;
  };
  if (without.source === 'EMPLOYEE' || without.source === 'ROTATION' || !firstPunch) return letGo();
  const shifts = await peoplePrisma.shift.findMany({ where: { orgId, autoPick: true, isActive: true } });
  const candidates = shifts.map((s) => ({ id: s.id, rule: toRule(s) })).filter((c) => !isOvernight(c.rule));
  const picked = pickShift(candidates, date, firstPunch);
  if (!picked || picked === without.shiftId) return letGo();
  if (mine) {
    if (mine.shiftId !== picked) await peoplePrisma.temporarySchedule.update({ where: { id: mine.id }, data: { shiftId: picked } });
  } else {
    await peoplePrisma.temporarySchedule.create({
      data: { accountId, orgId, employeeId, shiftId: picked, fromDate: date, toDate: date, reason: 'Picked by the first punch', pickedByPunch: true, createdByUserId: 'reader' },
    });
  }
  return picked;
}
