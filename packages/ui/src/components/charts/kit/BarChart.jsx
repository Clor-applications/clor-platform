import React from 'react';

import { ChartFrame, INK, Key, Tip, fmtNumber, linear, niceTicks, seriesStyle, useCursor, useWidth } from './core';

/**
 * Bars: vertical over time, or horizontal for a ranked list. Stacked or side
 * by side. Bklit's "Bar chart" shape without the springs (DESIGN.md: numbers
 * never animate).
 *
 * categories: ['Apr', …] or ['Sales', 'Ops', …]
 * series:     [{ name, values: [n], focus? }]
 * highlight:  index of one category drawn in the app colour (this month, this team)
 * labels:     write each bar's figure on it (vertical, while 18 bars or fewer fit)
 *
 * A series with `down: true` is drawn below the zero line (joined up, left
 * down); its figures stay positive in the table and the read-out. A series
 * with its own `color` keeps it (a grey "Other").
 *
 * Horizontal bars carry their value at the bar end, so they need no axis.
 * Stacks keep to three series plus "Other", told apart by tone and a legend.
 */
/* Stack tones: ink, mid grey, grey; a fourth (or a series given `color: INK.faint`) is the light grey "Other". */
const STACK = [INK.fg, INK.muted, INK.subtle, INK.faint];

export default function BarChart({
  title,
  figure,
  note,
  categories = [],
  series = [],
  stacked = false,
  horizontal = false,
  highlight,
  labels = false,
  height,
  format = fmtNumber,
  axisFormat,
  label,
}) {
  const [ref, width] = useWidth();
  const n = categories.length;
  const [cursor, setCursor, onKeyDown] = useCursor(n);
  /* Below the zero line a figure is still a count: the axis reads 2, not \u22122. */
  const axisFmt = (v) => (axisFormat || format)(series.some((x) => x.down) ? Math.abs(v) : v);
  const multi = series.length > 1;
  const colorOf = (s, si, ci) => {
    if (s.color) return s.color;
    if (multi) return stacked ? (s.focus ? INK.act : STACK[Math.min(si, 3)]) : seriesStyle(s, si).color;
    if (highlight === ci || s.focus) return INK.act;
    return highlight != null ? INK.faint : INK.fg;
  };

  const num = (s, i) => Number(s.values[i]) || 0;
  const ups = series.filter((s) => !s.down);
  const downs = series.filter((s) => s.down);
  const sumOrMax = (list, i) => (list.length ? (stacked ? list.reduce((t, s) => t + num(s, i), 0) : Math.max(...list.map((s) => num(s, i)))) : 0);
  const totals = categories.map((_, i) => sumOrMax(ups, i));
  const depths = categories.map((_, i) => sumOrMax(downs, i));
  const ticks = niceTicks(-Math.max(0, ...depths), Math.max(1, ...totals));
  const showTotal = stacked && multi && !downs.length;

  const said = label || title || 'Bar chart';
  const table = {
    caption: said,
    columns: ['', ...series.map((s) => s.name), ...(showTotal ? ['Total'] : [])],
    rows: categories.map((c, i) => [c, ...series.map((s) => format(s.values[i])), ...(showTotal ? [format(totals[i])] : [])]),
  };
  const legend = multi ? (
    <div className="ck-legend">
      {series.map((s, si) => <Key key={s.name} shape="box" color={colorOf(s, si)} name={s.name} />)}
    </div>
  ) : null;

  if (horizontal) {
    const row = 28;
    const labelW = Math.min(160, Math.max(72, width * 0.28));
    const valueW = 84;
    const iw = Math.max(40, width - labelW - valueW);
    const x = linear(0, ticks[ticks.length - 1], 0, iw);
    const h = height || n * row + 4;
    return (
      <ChartFrame title={title} figure={figure} note={note} table={table} label={said}>
        {legend}
        <div ref={ref} className="ck-plot-wrap">
          <svg className="ck-plot" width={width} height={h} role="img" aria-label={said}>
            {categories.map((c, i) => {
              let acc = 0;
              return (
                <g key={c + i} transform={`translate(0,${i * row})`}>
                  <text className="ck-cat" x={0} y={row / 2} dy="0.32em">
                    {c.length > 22 ? `${c.slice(0, 21)}…` : c}
                    <title>{c}</title>
                  </text>
                  {series.map((s, si) => {
                    const v = Number(s.values[i]) || 0;
                    const bh = stacked || !multi ? 14 : 14 / series.length;
                    const by = stacked || !multi ? (row - 14) / 2 : (row - 14) / 2 + si * bh;
                    const bx = stacked ? x(acc) : 0;
                    if (stacked) acc += v;
                    return <rect key={s.name} x={labelW + bx} y={by} width={Math.max(v ? 2 : 0, x(v))} height={bh} rx="2" fill={colorOf(s, si, i)} />;
                  })}
                  <text className="ck-val" x={labelW + x(totals[i]) + 8} y={row / 2} dy="0.32em">{format(totals[i])}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </ChartFrame>
    );
  }

  const h = height || 220;
  const below = labels && downs.length ? 14 : 0;
  const m = { top: labels ? 20 : 12, right: 8, bottom: 26 + below, left: 52 };
  const iw = Math.max(40, width - m.left - m.right);
  const ih = h - m.top - m.bottom;
  const y = linear(ticks[0], ticks[ticks.length - 1], ih, 0);
  const step = iw / Math.max(1, n);
  const bw = Math.min(40, step * 0.62);
  const labelStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 44))));

  return (
    <ChartFrame title={title} figure={figure} note={note} table={table} label={said}>
      {legend}
      <div ref={ref} className="ck-plot-wrap">
        <svg
          className="ck-plot"
          width={width}
          height={h}
          tabIndex={0}
          role="img"
          aria-label={`${said}. Use the arrow keys to read each bar.`}
          onKeyDown={onKeyDown}
          onBlur={() => setCursor(null)}
          onPointerLeave={() => setCursor(null)}
        >
          <g transform={`translate(${m.left},${m.top})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? INK.subtle : INK.hairline} />
                <text className="ck-axis" x={-8} y={y(t)} dy="0.32em" textAnchor="end">{axisFmt(t)}</text>
              </g>
            ))}
            {categories.map((c, i) => {
              const cx = i * step + step / 2;
              let up = 0;
              let down = 0;
              const gw = stacked || !multi ? bw : bw / series.length;
              return (
                <g key={c + i} onPointerEnter={() => setCursor(i)}>
                  <rect x={i * step} y={0} width={step} height={ih} fill={cursor === i ? 'rgb(var(--hover))' : 'transparent'} />
                  {series.map((s, si) => {
                    const v = num(s, i);
                    let top;
                    let bottom;
                    if (s.down) {
                      top = stacked ? y(-down) : y(0);
                      bottom = stacked ? y(-(down + v)) : y(-v);
                      if (stacked) down += v;
                    } else {
                      top = stacked ? y(up + v) : y(v);
                      bottom = stacked ? y(up) : y(0);
                      if (stacked) up += v;
                    }
                    const bx = stacked || !multi ? cx - bw / 2 : cx - bw / 2 + si * gw;
                    return <rect key={s.name} x={bx} y={top} width={gw - (multi && !stacked ? 1 : 0)} height={Math.max(v ? 1 : 0, bottom - top)} rx="2" fill={colorOf(s, si, i)} />;
                  })}
                  {labels && n <= 18 && totals[i] ? (
                    <text className="ck-val" x={cx} y={y(totals[i]) - 6} textAnchor="middle">{format(totals[i])}</text>
                  ) : null}
                  {labels && n <= 18 && depths[i] ? (
                    <text className="ck-val" x={cx} y={y(-depths[i]) + 14} textAnchor="middle">{format(depths[i])}</text>
                  ) : null}
                  {i % labelStep === 0 ? (
                    <text className="ck-axis" x={cx} y={ih + 18 + below} textAnchor="middle" fontWeight={highlight === i ? 600 : undefined}>{c}</text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
        {cursor != null ? (
          <Tip x={m.left + cursor * step + step / 2} y={m.top} width={width}>
            <span className="ck-tip-head">{categories[cursor]}</span>
            {series.map((s, si) => (
              <Key key={s.name} shape="box" color={colorOf(s, si, cursor)} name={s.name} value={format(s.values[cursor])} />
            ))}
            {showTotal ? <Key shape="none" name="Total" value={format(totals[cursor])} /> : null}
          </Tip>
        ) : null}
      </div>
    </ChartFrame>
  );
}
