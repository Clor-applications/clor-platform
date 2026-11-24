import React, { useMemo, useRef } from 'react';

import { ChartFrame, INK, Key, Tip, fmtNumber, linear, niceTicks, seriesStyle, useCursor, useWidth } from './core';

/**
 * Line or area over time, with a crosshair that follows the pointer and the
 * arrow keys. Bklit's "Line / Area" shape plus its "Reference area",
 * "Projection line" and "Deadline" utilities, drawn in CLOR's ink.
 *
 * categories: ['Apr', 'May', …]
 * series:     [{ name, values: [n], focus?, dash?, area? }]
 * reference:  [{ value, label }]            horizontal rules (a target, a limit)
 * band:       { from, to, label }           a shaded run of categories (a quarter, a freeze)
 * projectFrom: index from which every series is drawn dashed (a forecast)
 *
 * Series names are written at the line ends, so the chart reads without a legend.
 */
export default function LineChart({
  title,
  figure,
  note,
  categories = [],
  series = [],
  reference = [],
  band,
  projectFrom,
  kind = 'line',
  height = 220,
  format = fmtNumber,
  axisFormat,
  label,
}) {
  const [ref, width] = useWidth();
  const plotRef = useRef(null);
  const n = categories.length;
  const [cursor, setCursor, onKeyDown] = useCursor(n);
  const axisFmt = axisFormat || format;

  const endLabelW = series.length > 1 ? 92 : 12;
  const m = { top: 12, right: endLabelW, bottom: 26, left: 52 };
  const iw = Math.max(40, width - m.left - m.right);
  const ih = height - m.top - m.bottom;

  const { ticks, x, y } = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v) => v != null).map((v) => Number(v) || 0)).concat(reference.map((r) => r.value));
    const t = niceTicks(Math.min(0, ...all), Math.max(1, ...all));
    return {
      ticks: t,
      x: linear(0, Math.max(1, n - 1), 0, iw),
      y: linear(t[0], t[t.length - 1], ih, 0),
    };
  }, [series, reference, n, iw, ih]);

  const labelStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 56))));

  const onMove = (e) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r || n < 1) return;
    const px = e.clientX - r.left - m.left;
    setCursor(Math.max(0, Math.min(n - 1, Math.round((px / iw) * (n - 1)))));
  };

  const said = label || title || 'Line chart';
  const table = {
    caption: said,
    columns: ['', ...series.map((s) => s.name)],
    rows: categories.map((c, i) => [c, ...series.map((s) => (s.values[i] == null ? '' : format(s.values[i])))]),
  };

  /* A missing figure (null) breaks the line rather than dropping it to zero. */
  const has = (v) => v != null && v !== '' && !Number.isNaN(Number(v));
  const pathOf = (vals, from = 0, to = n - 1) => {
    let d = '';
    let pen = false;
    for (let k = from; k <= to; k += 1) {
      if (!has(vals[k])) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(k)},${y(Number(vals[k]))}`;
      pen = true;
    }
    return d;
  };
  const lastOf = (vals) => { for (let k = n - 1; k >= 0; k -= 1) if (has(vals[k])) return k; return -1; };

  return (
    <ChartFrame title={title} figure={figure} note={note} table={table} label={said}>
      <div ref={ref} className="ck-plot-wrap">
        <svg
          ref={plotRef}
          className="ck-plot"
          width={width}
          height={height}
          tabIndex={0}
          role="img"
          aria-label={`${said}. Use the arrow keys to read each point.`}
          onPointerMove={onMove}
          onPointerLeave={() => setCursor(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setCursor(null)}
        >
          <g transform={`translate(${m.left},${m.top})`}>
            {band ? (
              <g>
                <rect x={x(band.from)} width={Math.max(2, x(band.to) - x(band.from))} y={0} height={ih} fill="rgb(var(--hover))" />
                {band.label ? <text className="ck-axis" x={x(band.from) + 4} y={12}>{band.label}</text> : null}
              </g>
            ) : null}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? INK.subtle : INK.hairline} />
                <text className="ck-axis" x={-8} y={y(t)} dy="0.32em" textAnchor="end">{axisFmt(t)}</text>
              </g>
            ))}
            {categories.map((c, i) =>
              (i % labelStep === 0 && (i === n - 1 || n - 1 - i >= labelStep)) || i === n - 1 ? (
                <text key={c + i} className="ck-axis" x={x(i)} y={ih + 18} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
                  {c}
                </text>
              ) : null,
            )}
            {reference.map((r) => (
              <g key={r.label}>
                <line x1={0} x2={iw} y1={y(r.value)} y2={y(r.value)} stroke={INK.muted} strokeDasharray="4 4" />
                <text className="ck-axis" x={4} y={y(r.value) - 6}>{r.label}</text>
              </g>
            ))}
            {series.map((s, si) => {
              const st = seriesStyle(s, si);
              const cut = projectFrom != null && projectFrom < n ? projectFrom : n - 1;
              const solid = pathOf(s.values, 0, cut);
              const proj = projectFrom != null && projectFrom < n - 1 ? pathOf(s.values, cut, n - 1) : null;
              const showArea = (kind === 'area' || s.area) && si === 0;
              return (
                <g key={s.name}>
                  {showArea ? (
                    <path d={`${pathOf(s.values)}L${x(n - 1)},${y(ticks[0])}L${x(0)},${y(ticks[0])}Z`} fill={st.color} opacity="0.08" />
                  ) : null}
                  <path d={solid} fill="none" stroke={st.color} strokeWidth={s.focus ? 2.5 : 2} strokeDasharray={st.dash} strokeLinejoin="round" strokeLinecap="round" />
                  {proj ? <path d={proj} fill="none" stroke={st.color} strokeWidth="2" strokeDasharray="3 4" /> : null}
                  {series.length > 1 && lastOf(s.values) >= 0 ? (
                    <text className="ck-end" x={iw + 6} y={y(Number(s.values[lastOf(s.values)]))} dy="0.32em" fill={st.color === INK.faint ? INK.muted : st.color}>
                      {s.name}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {cursor != null ? (
              <g aria-hidden="true">
                <line x1={x(cursor)} x2={x(cursor)} y1={0} y2={ih} stroke={INK.fg} strokeOpacity="0.4" />
                {series.map((s, si) => (!has(s.values[cursor]) ? null :
                  <circle key={s.name} cx={x(cursor)} cy={y(Number(s.values[cursor]) || 0)} r="4" fill="rgb(var(--surface))" stroke={seriesStyle(s, si).color} strokeWidth="2" />
                ))}
              </g>
            ) : null}
          </g>
        </svg>
        {cursor != null ? (
          <Tip x={m.left + x(cursor)} y={m.top} width={width}>
            <span className="ck-tip-head">{categories[cursor]}</span>
            {series.map((s, si) => {
              const st = seriesStyle(s, si);
              return <Key key={s.name} color={st.color} dash={st.dash} name={s.name} value={has(s.values[cursor]) ? format(s.values[cursor]) : 'No figure'} />;
            })}
          </Tip>
        ) : null}
      </div>
    </ChartFrame>
  );
}
