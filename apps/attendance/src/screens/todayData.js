/* What the dashboard's panels work out from the punches and the schedule (AttendanceTodayPanels.jsx). */

/** How often the punch list asks again while today is open and the tab is in view. */
export const LIVE_EVERY_MS = 30_000;
export const LIVE_COUNT = 8;

/** Who a punch is: the matched person, the name the reader has, or the reader ID. */
export const punchWho = (t) => t.employeeName || t.nameOnReader || `Reader ID ${t.pin}`;

/** Where a punch came from: a phone at a site, a phone away from one, or the reader. */
export const punchWhere = (t) => {
  if (t.latitude == null) return { phone: false, text: t.deviceName || 'Reader' };
  return { phone: true, text: t.siteName ? `Phone at ${t.siteName}` : 'Phone, away from a site' };
};

/**
 * The shifts worked on one day, from the schedule calendar's month: each shift
 * with how many people it has, then those off, on leave or on a holiday.
 */
export function shiftsOn(schedule, date) {
  const shifts = new Map((schedule?.shifts || []).map((s) => [s.id, s]));
  const work = new Map();
  const away = { OFF: 0, LEAVE: 0, HOLIDAY: 0 };
  for (const row of schedule?.rows || []) {
    const cell = row.cells?.find((c) => c.date === date);
    if (!cell || cell.kind === 'OUT') continue;
    if (cell.kind in away) {
      away[cell.kind] += 1;
      continue;
    }
    const key = cell.shiftId || 'none';
    const s = shifts.get(cell.shiftId);
    const had = work.get(key) || { id: key, name: cell.name || s?.name || 'No shift set', code: cell.code || s?.code || null, color: cell.color || s?.color || null, startTime: s?.startTime || null, endTime: s?.endTime || null, n: 0 };
    had.n += 1;
    work.set(key, had);
  }
  const list = [...work.values()].sort((a, b) => String(a.startTime || '99').localeCompare(String(b.startTime || '99')) || b.n - a.n);
  return { list, working: list.reduce((t, s) => t + s.n, 0), off: away.OFF, leave: away.LEAVE, holiday: away.HOLIDAY };
}
