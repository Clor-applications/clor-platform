import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Shared pieces of the CLOR chart kit (24 Nov 2026).
 *
 * The kit takes its chart *shapes* from Bklit UI (MIT): sparkline, line and
 * area with a crosshair, bars, a contribution heatmap, rings, a linear meter
 * and a funnel. It takes nothing of Bklit's look: colours, type and motion
 * follow DESIGN.md (owner, 20 Nov 2026: "content not colour").
 *
 * DESIGN.md "Charts": ink first; series told apart by shape, dash and direct
 * labels; the app colour marks only the series the page is about; category
 * colours only when the category is also written out. Numbers never animate.
 *
 * Plain SVG, no chart library, so a chart adds a few KB, not ECharts.
 */

/* Series inks, in order. `act` is the app colour and is only used when a
   caller marks a series `focus`. Everything else is ink, then greys. */
export const INK = {
  /* Books (data-palette=indigo) has no --act; its navy is --brand-ink. */
  act: 'rgb(var(--act, var(--brand-ink)))',
  act2: 'rgb(var(--act-2))',
  fg: 'rgb(var(--fg))',
  muted: 'rgb(var(--fg-muted))',
  subtle: 'rgb(var(--border-input))',
  faint: 'rgb(var(--border-strong))',
  hairline: 'rgb(var(--border))',
  pos: 'rgb(var(--pos))',
  warn: 'rgb(var(--warn))',
  neg: 'rgb(var(--neg))',
};

/* Unfocused series: ink, then mid grey, then light grey; each with its own dash
   so two series never depend on colour alone. */
const RANK = [
  { color: INK.fg, dash: undefined },
  { color: INK.muted, dash: '6 4' },
  { color: INK.subtle, dash: '2 3' },
  { color: INK.faint, dash: '10 4 2 4' },
];

/** Stroke and dash for series `i`. A `focus` series takes the app colour. */
export function seriesStyle(series, i) {
  if (series.color) return { color: series.color, dash: series.dash };
  if (series.focus) return { color: INK.act, dash: series.dash };
  const r = RANK[Math.min(i, RANK.length - 1)];
  return { color: r.color, dash: series.dash ?? r.dash };
}

export const fmtNumber = (v) => (v == null || Number.isNaN(v) ? '' : Number(v).toLocaleString('en-IN'));

/** Indian money: ₹ in front, true minus, no decimals on a chart axis. */
export const fmtMoney = (v) => {
  if (v == null || Number.isNaN(v)) return '';
  const n = Number(v);
  const abs = Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return `${n < 0 ? '−' : ''}₹${abs}`;
};

/** Short money for axes: ₹12.4L, ₹3.1Cr, ₹850. */
export const fmtMoneyShort = (v) => {
  const n = Math.abs(Number(v) || 0);
  const sign = Number(v) < 0 ? '−' : '';
  if (n >= 1e7) return `${sign}₹${(n / 1e7).toFixed(n >= 1e8 ? 0 : 1)}Cr`;
  if (n >= 1e5) return `${sign}₹${(n / 1e5).toFixed(n >= 1e6 ? 0 : 1)}L`;
  if (n >= 1e3) return `${sign}₹${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return `${sign}₹${n}`;
};

/** Rounded axis ticks from 0 (or a negative min) to just above max. */
export function niceTicks(min, max, count = 4) {
  const lo = Math.min(0, min);
  const hi = max <= lo ? lo + 1 : max;
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let t = start; t <= hi + step * 0.001; t += step) ticks.push(Number(t.toFixed(10)));
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export const linear = (d0, d1, r0, r1) => (v) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

/** Width of the element, kept current. Starts at `fallback` for the first paint and in tests. */
export function useWidth(fallback = 640) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;
  useIso(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const set = () => setW(Math.max(120, Math.round(el.getBoundingClientRect().width)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * The frame every kit chart sits in: an optional title row with one headline
 * figure, the drawing, and a table with the same figures for a screen reader.
 * No box: a chart sits on the page ground (DESIGN.md, no card-in-card).
 */
export function ChartFrame({ title, figure, note, table, children, className = '', label }) {
  return (
    <figure className={`ck-frame ${className}`} aria-label={label || title}>
      {title || figure ? (
        <figcaption className="ck-head">
          {title ? <span className="ck-title">{title}</span> : null}
          {figure != null ? <span className="ck-figure">{figure}</span> : null}
          {note ? <span className="ck-note">{note}</span> : null}
        </figcaption>
      ) : null}
      {children}
      {table ? <DataTable {...table} /> : null}
    </figure>
  );
}

/** Visually hidden table: the chart's figures for assistive tech. */
export function DataTable({ caption, columns, rows }) {
  return (
    <table className="ck-sr">
      {/* Named apart from any table of the same report on the page. */}
      {caption ? <caption>{`Chart figures: ${caption}`}</caption> : null}
      <thead>
        <tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}</tr>
        ))}
      </tbody>
    </table>
  );
}

/** Small floating read-out under the pointer or the keyboard cursor. */
export function Tip({ x, y, width, children }) {
  if (x == null) return null;
  const left = Math.min(Math.max(8, x + 12), width - 8);
  const flip = x + 12 + 180 > width;
  return (
    <div className="ck-tip" role="status" style={{ left, top: y, transform: flip ? 'translateX(calc(-100% - 24px))' : undefined }}>
      {children}
    </div>
  );
}

/** One row in a tip or legend: a swatch drawn as its line (with dash), a name and a value. */
export function Key({ color, dash, shape = 'line', name, value }) {
  return (
    <span className="ck-key">
      <svg width="16" height="10" aria-hidden="true">
        {shape === 'line' ? <line x1="0" x2="16" y1="5" y2="5" stroke={color} strokeWidth="2" strokeDasharray={dash} /> : null}
        {shape === 'box' ? <rect x="3" y="0" width="10" height="10" rx="2" fill={color} /> : null}
      </svg>
      <span className="ck-key-name">{name}</span>
      {value != null ? <span className="ck-key-value">{value}</span> : null}
    </span>
  );
}

/** Arrow keys move a cursor across `count` points; Home/End jump; Escape clears. */
export function useCursor(count) {
  const [i, setI] = useState(null);
  const onKeyDown = (e) => {
    if (!count) return;
    const last = count - 1;
    const map = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
    if (e.key in map) {
      e.preventDefault();
      setI((c) => (c == null ? (map[e.key] > 0 ? 0 : last) : Math.max(0, Math.min(last, c + map[e.key]))));
    } else if (e.key === 'Home') { e.preventDefault(); setI(0); }
    else if (e.key === 'End') { e.preventDefault(); setI(last); }
    else if (e.key === 'Escape') setI(null);
  };
  return [i, setI, onKeyDown];
}
