import React from 'react';

import { INK, fmtNumber } from './core';

/**
 * A straight gauge: how far a figure has got against its limit, with zones and
 * a target notch. Bklit's "Gauge" in its linear-track form; a dial costs a
 * card's worth of space to say one number, a track costs a line.
 *
 * value, max, target?
 * zones: [{ to, tone: 'pos' | 'warn' | 'neg', label }]  drawn as a thin rule under the track
 * tone:  the fill. Ink by default; a status tone only when the value is in
 *        that state, and then the word goes with it (`status`).
 *
 * Use for: seats used of seats bought, leave taken of leave allowed, budget
 * spent, storage used, GST filing progress.
 */
export default function Meter({ label, value = 0, max = 100, target, zones = [], tone, status, format = fmtNumber, unit = '' }) {
  const pct = (v) => `${Math.max(0, Math.min(100, (Number(v) / (max || 1)) * 100))}%`;
  const fill = tone ? INK[tone] : INK.fg;
  return (
    <div className="ck-meter">
      <div className="ck-meter-head">
        <span className="ck-meter-label">{label}</span>
        <span className="ck-meter-value">
          {format(value)}
          {unit}
          <span className="ck-meter-max">of {format(max)}{unit}</span>
          {status ? <span className={`ck-meter-status ck-tone-${tone || 'neutral'}`}>{status}</span> : null}
        </span>
      </div>
      <div
        className="ck-meter-track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${format(value)}${unit} of ${format(max)}${unit}${status ? `, ${status}` : ''}`}
      >
        <span className="ck-meter-fill" style={{ width: pct(value), background: fill }} />
        {target != null ? <span className="ck-meter-target" style={{ left: pct(target) }} title={`Target ${format(target)}${unit}`} /> : null}
      </div>
      {zones.length ? (
        <div className="ck-meter-zones" aria-hidden="true">
          {zones.map((z, i) => {
            const from = i ? zones[i - 1].to : 0;
            return <span key={z.to} style={{ left: pct(from), width: `calc(${pct(z.to)} - ${pct(from)})`, background: INK[z.tone] }} title={z.label} />;
          })}
        </div>
      ) : null}
    </div>
  );
}
