import React from 'react';

import { INK, fmtNumber, linear } from './core';

/**
 * A word-sized chart: one line, area or row of bars beside a figure, with no
 * axes. Bklit's "Sparkline" shape. Ink by default; `focus` uses the app colour
 * when this trend is the subject of the page.
 *
 * Use beside a figure on a Home or overview card, or in a table cell
 * ("last 12 months"). Not on its own: a sparkline has no scale.
 */
export default function Sparkline({
  values = [],
  kind = 'line',
  width = 96,
  height = 24,
  focus = false,
  label,
  format = fmtNumber,
}) {
  const n = values.length;
  if (!n) return null;
  const color = focus ? INK.act : INK.fg;
  const nums = values.map((v) => Number(v) || 0);
  const min = Math.min(0, ...nums);
  const max = Math.max(...nums, min + 1);
  const y = linear(min, max, height - 2, 2);
  const said = label ? `${label}: ${nums.map(format).join(', ')}` : nums.map(format).join(', ');

  if (kind === 'bar') {
    const bw = width / n;
    return (
      <svg className="ck-spark" width={width} height={height} role="img" aria-label={said}>
        {nums.map((v, i) => (
          <rect
            key={i}
            x={i * bw + bw * 0.15}
            width={bw * 0.7}
            y={Math.min(y(v), y(0))}
            height={Math.max(1, Math.abs(y(0) - y(v)))}
            rx="1"
            fill={i === n - 1 ? color : INK.faint}
          />
        ))}
      </svg>
    );
  }

  const x = linear(0, Math.max(1, n - 1), 2, width - 4);
  const pts = nums.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return (
    <svg className="ck-spark" width={width} height={height} role="img" aria-label={said}>
      {kind === 'area' ? (
        <polygon points={`${x(0)},${y(min)} ${pts} ${x(n - 1)},${y(min)}`} fill={color} opacity="0.1" />
      ) : null}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(nums[n - 1])} r="2.5" fill={color} />
    </svg>
  );
}
