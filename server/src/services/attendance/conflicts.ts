/**
 * Overlapping schedules, found before they are saved.
 *
 * The resolver (schedule.ts) always picks one shift per day, so an overlap
 * never crashes anything — it silently decides. That is the problem: two
 * temporary schedules on the same days pick whichever comes first, and a new
 * personal schedule quietly replaces an older one from its start date. These
 * functions name what a save would do, so the person saving can see it.
 *
 *   CONFLICT   two temporary schedules cover the same day with different
 *              shifts: which one applies is arbitrary
 *   REPLACES   a personal or department schedule starting inside an older
 *              one takes over from its start date (normal, but worth saying)
 *   OVERRIDES  a temporary schedule hides the person's usual shift on those
 *              days (intended, shown for context)
 */

export type Range = { id?: string; shiftId: string; from: string; to: string | null };
export type Finding = {
  level: 'CONFLICT' | 'REPLACES' | 'OVERRIDES';
  existing: Range;
  overlapFrom: string;
  overlapTo: string | null;
};

const maxDate = (a: string, b: string) => (a > b ? a : b);
const minEnd = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a < b ? a : b);

/** The days two ranges share, or null. Open-ended ranges run forever. */
export function overlap(a: { from: string; to: string | null }, b: { from: string; to: string | null }) {
  const from = maxDate(a.from, b.from);
  const to = minEnd(a.to, b.to);
  if (to !== null && to < from) return null;
  return { from, to };
}

/** A new temporary schedule against the person's existing temporary ones. */
export function temporaryFindings(next: Range, existing: Range[]): Finding[] {
  const out: Finding[] = [];
  for (const e of existing) {
    if (next.id && e.id === next.id) continue;
    const o = overlap(next, e);
    if (!o) continue;
    out.push({ level: e.shiftId === next.shiftId ? 'REPLACES' : 'CONFLICT', existing: e, overlapFrom: o.from, overlapTo: o.to });
  }
  return out;
}

/**
 * A new personal (or department) schedule against existing ones of the same
 * kind. The resolver takes the latest start on or before a day, so a later
 * start replaces an earlier range from that day; the same start overwrites.
 */
export function rangedFindings(next: Range, existing: Range[]): Finding[] {
  const out: Finding[] = [];
  for (const e of existing) {
    if (next.id && e.id === next.id) continue;
    if (e.from === next.from) {
      if (e.shiftId !== next.shiftId) out.push({ level: 'REPLACES', existing: e, overlapFrom: e.from, overlapTo: minEnd(e.to, next.to) });
      continue;
    }
    const o = overlap(next, e);
    if (!o || e.shiftId === next.shiftId) continue;
    out.push({ level: 'REPLACES', existing: e, overlapFrom: o.from, overlapTo: o.to });
  }
  return out;
}

/** Temporary schedules that cover part of a usual schedule (context, not a problem). */
export function overrideFindings(next: Range, temporaries: Range[]): Finding[] {
  const out: Finding[] = [];
  for (const t of temporaries) {
    const o = overlap(next, t);
    if (o && t.shiftId !== next.shiftId) out.push({ level: 'OVERRIDES', existing: t, overlapFrom: o.from, overlapTo: o.to });
  }
  return out;
}

/** Every pair of a person's temporary schedules that clash (for the Exception Center). */
export function clashingTemporaries(list: Range[]) {
  const out: Array<{ a: Range; b: Range; from: string; to: string | null }> = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (list[i].shiftId === list[j].shiftId) continue;
      const o = overlap(list[i], list[j]);
      if (o) out.push({ a: list[i], b: list[j], from: o.from, to: o.to });
    }
  }
  return out;
}
