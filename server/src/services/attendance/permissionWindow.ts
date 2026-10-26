import { istInstant, type ShiftRule } from './compute.js';

/**
 * Permission hours (an approved PERMISSION attendance request): a window of
 * the day the person is excused from. The simplest honest reading — a window
 * that reaches the shift's start excuses that day's lateness, one that reaches
 * the shift's end excuses leaving early. Shared by writeDay (so the excuse
 * survives every rewrite of the day) and the request service.
 */
export function permissionCovers(date: string, rule: ShiftRule, win: { checkIn: Date | null; checkOut: Date | null }) {
  if (!win.checkIn || !win.checkOut) return { start: false, end: false };
  const start = istInstant(date, rule.startTime);
  /* A night shift ends the next morning. */
  const end = istInstant(date, rule.endTime, rule.endTime <= rule.startTime ? 1 : 0);
  const within = (at: Date) => win.checkIn! <= at && win.checkOut! >= at;
  return { start: within(start), end: within(end) };
}
