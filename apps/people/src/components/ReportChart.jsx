import React from 'react';

/**
 * The one chart a People report draws: bars per category, stacked or side by
 * side, in the chart series of DESIGN.md. Three colours at most (UI rules,
 * 8 Nov 2026): the first three series take `--dept-1..3`; a series marked
 * `other`, and anything past the third, is the grey `--dept-0`.
 *
 * Plain CSS bars, like People Home's team bar, so a report adds nothing to
 * the charts bundle. The table under it carries the same figures for a
 * screen reader; the chart itself is one labelled image.
 *
 * chart: { kind: 'stacked' | 'grouped' | 'line', unit?: '%', categories: [label], series: [{ label, values: [n], other }] }
 *
 * A 'line' (round 45 pick: absence as a share of working days, by month) is
 * one SVG polyline a series on the same ground; the table under it has each figure.
 */
export const CHART_COLOURS = 3;
const colourOf = (s, i) => (s.other || i >= CHART_COLOURS ? 0 : i + 1);

const W = 640;
const H = 144;
const PAD = 8;

function LineChart({ chart, label }) {
  const { categories, series } = chart;
  const unit = chart.unit || '';
  const top = Math.max(1, ...series.flatMap((s) => s.values.map((v) => Number(v) || 0)));
  const x = (i) => (categories.length === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (categories.length - 1));
  const y = (v) => H - PAD - ((Number(v) || 0) / top) * (H - PAD * 2);
  const said = categories.map((c, i) => `${c}: ${series.map((s) => `${s.label} ${s.values[i] ?? 0}${unit}`).join(', ')}`).join('; ');
  /* Every month's name while they fit, otherwise every other one. */
  const step = categories.length > 12 ? Math.ceil(categories.length / 12) : 1;
  return (
    <figure className="people-chart" role="img" aria-label={`${label}. ${said}`}>
      <svg className="people-chart-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {series.map((s, n) => (
          <g key={s.label} style={{ '--dept': `var(--dept-${colourOf(s, n)})` }}>
            <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
          </g>
        ))}
      </svg>
      <div className="people-chart-axis" aria-hidden="true">
        {categories.map((c, i) => <span key={c} className="people-chart-label">{i % step === 0 ? c : ''}</span>)}
      </div>
      {series.length > 1 ? (
        <ul className="soft-team-keys" aria-hidden="true">
          {series.map((s, n) => <li key={s.label} style={{ '--dept': `var(--dept-${colourOf(s, n)})` }}><span className="people-dot" />{s.label}</li>)}
        </ul>
      ) : null}
    </figure>
  );
}

export default function ReportChart({ chart, label }) {
  if (!chart?.categories?.length || !chart.series?.length) return null;
  const { categories, series } = chart;
  /* Round 29 pick "chartempty" C: a chart with nothing in it yet is not drawn
     as a row of empty columns; the table under it already says so in words. */
  if (!series.some((s) => (s.values || []).some((v) => Number(v) > 0))) return null;
  if (chart.kind === 'line') return <LineChart chart={chart} label={label} />;
  const stacked = chart.kind === 'stacked';
  const totals = categories.map((_, c) => series.reduce((n, s) => n + (Number(s.values[c]) || 0), 0));
  const top = Math.max(1, ...(stacked ? totals : series.flatMap((s) => s.values.map((v) => Number(v) || 0))));
  const height = (v) => `${((Number(v) || 0) / top) * 100}%`;
  const said = categories.map((c, i) => `${c}: ${series.map((s) => `${s.label} ${s.values[i] ?? 0}`).join(', ')}`).join('; ');
  /* A figure over every bar only while there is room for it. */
  const figures = categories.length <= 18;
  return (
    <figure className="people-chart" role="img" aria-label={`${label}. ${said}`}>
      <div className="people-chart-plot" aria-hidden="true">
        {categories.map((c, i) => (
          <div key={c} className="people-chart-col" title={`${c}: ${series.map((s) => `${s.label} ${s.values[i] ?? 0}`).join(', ')}`}>
            {figures ? <span className="people-chart-value tabular-nums">{stacked || series.length === 1 ? totals[i] : series.map((s) => s.values[i] ?? 0).join(' · ')}</span> : null}
            <div className="people-chart-bars">
              {stacked ? (
                <div className="people-chart-stack">
                  {series.map((s, n) => (Number(s.values[i]) > 0 ? <span key={s.label} style={{ height: height(s.values[i]), '--dept': `var(--dept-${colourOf(s, n)})` }} /> : null))}
                </div>
              ) : series.map((s, n) => <span key={s.label} className="people-chart-bar" style={{ height: height(s.values[i]), '--dept': `var(--dept-${colourOf(s, n)})` }} />)}
            </div>
            <span className="people-chart-label">{c}</span>
          </div>
        ))}
      </div>
      {series.length > 1 ? (
        <ul className="soft-team-keys" aria-hidden="true">
          {series.map((s, n) => <li key={s.label} style={{ '--dept': `var(--dept-${colourOf(s, n)})` }}><span className="people-dot" />{s.label}</li>)}
        </ul>
      ) : null}
    </figure>
  );
}
