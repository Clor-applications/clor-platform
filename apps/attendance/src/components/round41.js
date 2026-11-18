/**
 * Round 41 picks (18 Nov 2026), field and site staff.
 *
 * teammap B: where the field team is now, as a list (no map): one row per
 * person with the place and time of their latest recorded phone punch.
 */

/** The latest recorded punch of each person, newest first. Rows come from GET /attendance/phone-punches `accepted`. */
export function latestPlaces(accepted = []) {
  const last = new Map();
  for (const p of accepted || []) {
    if (!p) continue;
    const key = p.employeeId || p.name;
    if (!key) continue;
    const seen = last.get(key);
    if (!seen || String(p.at || p.time || '') > String(seen.at || seen.time || '')) last.set(key, p);
  }
  return [...last.values()].sort((a, b) => String(b.at || b.time || '').localeCompare(String(a.at || a.time || '')));
}

/** The place words for a row: the street address a field punch found, else the work site, else nothing. */
export function placeOf(p) {
  return p?.address || p?.site || '';
}
