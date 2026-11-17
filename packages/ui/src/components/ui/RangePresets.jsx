/**
 * Quick periods in front of a from–to date pair (owner's style pick, 17 Nov 2026): one tap for the
 * usual periods, the two date fields stay for anything else. Dates are ISO strings in India time.
 * The financial year runs April to March.
 */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function presetRanges(today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const fyStart = m >= 3 ? y : y - 1;
  return [
    ['thisMonth', 'This month', iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))],
    ['lastMonth', 'Last month', iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))],
    ['quarter', 'Last 3 months', iso(new Date(y, m - 2, 1)), iso(new Date(y, m + 1, 0))],
    ['fy', 'This financial year', iso(new Date(fyStart, 3, 1)), iso(new Date(fyStart + 1, 2, 31))],
  ];
}

export default function RangePresets({ from = '', to = '', onPick, label = 'Quick periods', today, maxTo = '' }) {
  /* A period that runs past `maxTo` (usually today) stops there. */
  const cap = (t) => (maxTo && t > maxTo ? maxTo : t);
  return (
    <div className="ui-range-presets" role="group" aria-label={label}>
      {presetRanges(today).map(([key, name, f, t]) => (
        <button key={key} type="button" className="ui-range-chip" aria-pressed={from === f && to === cap(t)} onClick={() => onPick?.(f, cap(t))}>{name}</button>
      ))}
    </div>
  );
}
