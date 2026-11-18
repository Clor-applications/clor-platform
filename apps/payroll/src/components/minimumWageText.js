/* Round 66 "minwage": shared words and rules for minimum wages. */

/** Minimum wage skill levels, as the state notifications name them. */
export const SKILL_LEVELS = [
  { value: 'UNSKILLED', label: 'Unskilled' },
  { value: 'SEMI_SKILLED', label: 'Semi-skilled' },
  { value: 'SKILLED', label: 'Skilled' },
  { value: 'HIGHLY_SKILLED', label: 'Highly skilled' },
];

/** Which rows are in force today: the latest from-date on or before today, per state, zone and skill. */
export function inForceIds(rates, today) {
  const best = new Map();
  for (const r of rates) {
    if (r.effectiveFrom > today) continue;
    const key = `${r.state}|${(r.zone || '').toUpperCase()}|${r.skill}`;
    const cur = best.get(key);
    if (!cur || r.effectiveFrom > cur.effectiveFrom) best.set(key, r);
  }
  return new Set([...best.values()].map((r) => r.id));
}
