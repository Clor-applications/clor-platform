import React from 'react';

import { INK, Key, fmtNumber } from './core';

/**
 * Concentric progress rings with the legend beside them. Bklit's "Ring chart".
 * Use for two to four parts of one goal that each have their own limit
 * (onboarding tasks done, payroll steps done, profile complete). For a share
 * of one whole, use a stacked bar; for one figure, a Meter.
 *
 * rings: [{ name, value, max, focus? }]  outermost first
 * center: text in the middle (the overall figure)
 */
export default function RingProgress({ rings = [], center, size = 132, format = fmtNumber, label }) {
  const stroke = 10;
  const gap = 4;
  const c = size / 2;
  const colorOf = (r, i) => (r.focus ? INK.act : [INK.fg, INK.muted, INK.subtle, INK.faint][Math.min(i, 3)]);
  const said = label || rings.map((r) => `${r.name}: ${format(r.value)} of ${format(r.max)}`).join('; ');
  return (
    <div className="ck-rings">
      <svg width={size} height={size} role="img" aria-label={said}>
        {rings.map((r, i) => {
          const rad = c - stroke / 2 - i * (stroke + gap);
          if (rad <= stroke) return null;
          const len = 2 * Math.PI * rad;
          const frac = Math.max(0, Math.min(1, (Number(r.value) || 0) / (r.max || 1)));
          return (
            <g key={r.name} transform={`rotate(-90 ${c} ${c})`}>
              <circle cx={c} cy={c} r={rad} fill="none" stroke={INK.hairline} strokeWidth={stroke} />
              {frac > 0 ? <circle
                cx={c}
                cy={c}
                r={rad}
                fill="none"
                stroke={colorOf(r, i)}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${len * frac} ${len}`}
              /> : null}
            </g>
          );
        })}
        {center ? (
          <text x={c} y={c} dy="0.35em" textAnchor="middle" className="ck-ring-center">{center}</text>
        ) : null}
      </svg>
      <div className="ck-rings-legend">
        {rings.map((r, i) => (
          <Key key={r.name} shape="box" color={colorOf(r, i)} name={r.name} value={`${format(r.value)} of ${format(r.max)}`} />
        ))}
      </div>
    </div>
  );
}
