import { isWeeklyOff } from '../../attendance/compute.js';
import { loadHolidays, loadSchedule, resolveShift } from '../../attendance/schedule.js';
import { addDays as shift } from '../../../utils/istDate.js';

/**
 * Working days for one person (Joining & Leaving, JCL-A03): a step due "two
 * working days after the last day" skips the person's weekly offs (their
 * shift with Attendance, else the company working week) and their holidays
 * (company, branch, location). Counting stops after a year either way, so a
 * calendar with no working days cannot loop.
 */

export type Person = { id: string; areaId?: string | null; branchId?: string | null };

export async function workingCalendar(orgId: string, person: Person, around: string) {
  const [schedule, holidays] = await Promise.all([loadSchedule(orgId, [person.id]), loadHolidays(orgId, shift(around, -400), shift(around, 400))]);
  const off = holidays.forArea(person.areaId ?? null, person.branchId ?? null);
  return (date: string) => !off.has(date) && !isWeeklyOff(resolveShift(schedule, person.id, date).rule, date);
}

/** `base` moved by `n` days: calendar days without `works`, working days with it (the base day itself not counted). */
export function countFrom(base: string, n: number, works: ((date: string) => boolean) | null) {
  if (!works || n === 0) return shift(base, n);
  const step = n > 0 ? 1 : -1;
  let left = Math.abs(n);
  let day = base;
  for (let guard = 0; left > 0 && guard < 366; guard++) {
    day = shift(day, step);
    if (works(day)) left -= 1;
  }
  return day;
}
