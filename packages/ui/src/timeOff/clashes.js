import { addDaysIso as addDays } from '@ui/utils/dates';
/**
 * Two or more people of one group away on the same day (M4): Who's away and
 * the Leave calendar flag it, as the approval panel's "Also away then" does,
 * so a manager sees a thin day before approving into it.
 *
 * A group is a department; `oneGroup` puts everyone the reader sees in one
 * (a team manager's team, whatever its departments). Waiting requests count:
 * a clash is worth knowing before it is approved. Days are the ones between
 * `from` and `to`, both included. Each clash: { date, to, group, count, names, waiting }.
 */

export function clashDays(rows, from, to, { oneGroup = false } = {}) {
  const out = [];
  const open = (rows || []).filter((r) => r && (r.status === 'APPROVED' || r.status === 'PENDING'));
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const groups = new Map();
    for (const r of open) {
      if (!(r.fromDate <= d && d <= r.toDate)) continue;
      const key = oneGroup ? '' : r.department || '';
      if (!groups.has(key)) groups.set(key, new Map());
      const people = groups.get(key);
      const seen = people.get(r.employeeId);
      /* One person with two rows that day (a split leave) is still one person; approved wins over waiting. */
      people.set(r.employeeId, { name: r.employeeName, waiting: seen ? seen.waiting && r.status === 'PENDING' : r.status === 'PENDING' });
    }
    for (const [group, people] of groups) {
      if (people.size < 2) continue;
      const list = [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
      const entry = { date: d, to: d, group: oneGroup ? null : group || null, count: list.length, names: list.map((p) => p.name), waiting: list.filter((p) => p.waiting).length };
      /* The same people over days in a row are one clash, from its first day to its last. */
      const same = out.find((c) => c.group === entry.group && c.to === addDays(d, -1) && c.names.join('|') === entry.names.join('|') && c.waiting === entry.waiting);
      if (same) same.to = d;
      else out.push(entry);
    }
  }
  return out;
}

/** "2 people away the same day" — the words both screens use. */
export const clashWords = (n) => `${n} people away the same day`;
