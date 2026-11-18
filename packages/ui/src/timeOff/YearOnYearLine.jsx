import React from 'react';

/**
 * This year against last year in one chart (owner's round 30 pick "yoy" A):
 * this period's line solid in the app colour, the same months a year
 * earlier faint and dashed behind it, so the gap reads at a glance.
 *
 * rows: [{ key, label, now, before }] in month order; `before` may be null
 * for a month with nothing a year earlier.
 */
export function shiftYear(day, by = -1) {
  const y = Number(day.slice(0, 4)) + by;
  const rest = day.slice(4) === '-02-29' ? '-02-28' : day.slice(4);
  return `${y}${rest}`;
}

const W = 320;
const H = 120;
const PAD = 6;

function points(values, max) {
  const n = values.length;
  return values
    .map((v, i) => (v == null ? null : `${n === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (n - 1)},${H - PAD - (v / max) * (H - PAD * 2)}`))
    .filter(Boolean)
    .join(' ');
}

export default function YearOnYearLine({ rows, nowLabel = 'This period', beforeLabel = 'A year before', label }) {
  if (!rows?.length) return null;
  const now = rows.map((r) => r.now ?? null);
  const before = rows.map((r) => r.before ?? null);
  const max = Math.max(1, ...now.filter((v) => v != null), ...before.filter((v) => v != null));
  const lastNow = [...now].reverse().find((v) => v != null);
  const lastBefore = [...before].reverse().find((v) => v != null);
  const diff = lastNow != null && lastBefore != null ? lastNow - lastBefore : null;
  const summary = `${label}: ${nowLabel.toLowerCase()} ends at ${lastNow ?? 'no figure'}, ${beforeLabel.toLowerCase()} at ${lastBefore ?? 'no figure'}`;
  return (
    <figure className="ui-yoy">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="none" className="ui-yoy-chart">
        <polyline className="ui-yoy-before" points={points(before, max)} />
        <polyline className="ui-yoy-now" points={points(now, max)} />
      </svg>
      <div className="ui-yoy-axis" aria-hidden="true">
        {rows.map((r) => <span key={r.key}>{r.label}</span>)}
      </div>
      <figcaption className="ui-yoy-key">
        <span><i className="ui-yoy-swatch-now" aria-hidden="true" />{nowLabel}</span>
        <span><i className="ui-yoy-swatch-before" aria-hidden="true" />{beforeLabel}</span>
        {diff != null ? <span className="tabular-nums">{diff === 0 ? 'Same as a year before' : `${diff > 0 ? '+' : ''}${diff} on a year before`}</span> : null}
      </figcaption>
    </figure>
  );
}
