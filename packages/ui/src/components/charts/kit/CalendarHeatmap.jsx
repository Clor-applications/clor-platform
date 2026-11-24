import React, { useMemo, useState } from 'react';

import { ChartFrame, INK, Key, Tip, useWidth } from './core';

/**
 * A year or a month of days as a grid of squares, a week a column. Bklit's
 * "Heatmap" (contribution) shape.
 *
 * Two modes:
 *  - amount: `days = [{ date: 'YYYY-MM-DD', value }]`, shaded in five steps of
 *    ink (not the app colour), with a "Less … More" key.
 *  - status: `days = [{ date, status }]` and `statuses = [{ key, label, color }]`.
 *    Each status is a category, so the key writes every one out (DESIGN.md).
 *
 * Arrow keys move day by day (left/right) and week by week (up/down).
 */
const STEPS = [0, 0.14, 0.32, 0.55, 0.85];
const DOW = ['Mon', '', 'Wed', '', 'Fri', '', ''];

const parse = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const nice = (s) => parse(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export default function CalendarHeatmap({
  title,
  figure,
  note,
  from,
  to,
  days = [],
  statuses,
  format = (v) => String(v),
  unit = '',
  label,
}) {
  const [ref, width] = useWidth();
  const [cursor, setCursor] = useState(null);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const statusOf = useMemo(() => new Map((statuses || []).map((s) => [s.key, s])), [statuses]);

  const grid = useMemo(() => {
    const start = parse(from || days[0]?.date || iso(new Date()));
    const end = parse(to || days[days.length - 1]?.date || iso(new Date()));
    const first = new Date(start);
    first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
    const cells = [];
    for (let d = new Date(first), k = 0; d <= end; d.setUTCDate(d.getUTCDate() + 1), k += 1) {
      cells.push({ date: iso(d), col: Math.floor(k / 7), row: k % 7, out: d < start });
    }
    return cells;
  }, [from, to, days]);

  const cols = (grid[grid.length - 1]?.col ?? 0) + 1;
  const left = 28;
  const size = Math.max(9, Math.min(16, Math.floor((width - left) / cols) - 2));
  const gap = 2;
  const max = Math.max(1, ...days.map((d) => Number(d.value) || 0));

  const fillOf = (cell) => {
    const d = byDate.get(cell.date);
    if (cell.out) return 'transparent';
    if (statuses) return d?.status ? statusOf.get(d.status)?.color || INK.faint : 'rgb(var(--surface))';
    const v = Number(d?.value) || 0;
    if (!v) return 'rgb(var(--surface))';
    const step = Math.min(4, Math.max(1, Math.ceil((v / max) * 4)));
    return `rgb(var(--fg) / ${STEPS[step]})`;
  };
  const describe = (date) => {
    const d = byDate.get(date);
    if (statuses) return d?.status ? statusOf.get(d.status)?.label || d.status : 'Nothing recorded';
    return d?.value ? `${format(d.value)}${unit}` : 'None';
  };

  const live = grid.filter((c) => !c.out);
  const onKeyDown = (e) => {
    const map = { ArrowRight: 7, ArrowLeft: -7, ArrowDown: 1, ArrowUp: -1 };
    if (e.key === 'Escape') return setCursor(null);
    if (!(e.key in map)) return undefined;
    e.preventDefault();
    const idx = cursor == null ? live.length - 1 : live.findIndex((c) => c.date === cursor);
    const next = live[Math.max(0, Math.min(live.length - 1, idx + map[e.key]))];
    return setCursor(next.date);
  };

  const months = [];
  grid.forEach((c) => {
    if (c.row === 0 && !c.out) {
      const m = parse(c.date).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
      if (!months.length || months[months.length - 1].m !== m) months.push({ m, col: c.col });
    }
  });

  const h = 18 + 7 * (size + gap);
  const cur = cursor ? grid.find((c) => c.date === cursor) : null;
  const said = label || title || 'Calendar';
  const table = {
    caption: said,
    columns: ['Date', statuses ? 'Status' : 'Value'],
    rows: live.filter((c) => byDate.get(c.date)).map((c) => [nice(c.date), describe(c.date)]),
  };

  return (
    <ChartFrame title={title} figure={figure} note={note} table={table} label={said}>
      <div ref={ref} className="ck-plot-wrap">
        <svg
          className="ck-plot"
          width={width}
          height={h}
          tabIndex={0}
          role="img"
          aria-label={`${said}. Use the arrow keys to read each day.`}
          onKeyDown={onKeyDown}
          onBlur={() => setCursor(null)}
          onPointerLeave={() => setCursor(null)}
        >
          {months.map((mo) => (
            <text key={mo.m + mo.col} className="ck-axis" x={left + mo.col * (size + gap)} y={10}>{mo.m}</text>
          ))}
          {DOW.map((d, r) => (d ? <text key={d} className="ck-axis" x={0} y={18 + r * (size + gap) + size / 2} dy="0.32em">{d}</text> : null))}
          {grid.map((c) =>
            c.out ? null : (
              <rect
                key={c.date}
                x={left + c.col * (size + gap)}
                y={18 + c.row * (size + gap)}
                width={size}
                height={size}
                rx="2"
                fill={fillOf(c)}
                stroke={cursor === c.date ? INK.fg : INK.hairline}
                strokeWidth={cursor === c.date ? 1.5 : 1}
                onPointerEnter={() => setCursor(c.date)}
              />
            ),
          )}
        </svg>
        {cur ? (
          <Tip x={left + cur.col * (size + gap) + size} y={18 + cur.row * (size + gap)} width={width}>
            <span className="ck-tip-head">{nice(cur.date)}</span>
            <span>{describe(cur.date)}</span>
          </Tip>
        ) : null}
      </div>
      <div className="ck-legend">
        {statuses ? (
          statuses.map((s) => <Key key={s.key} shape="box" color={s.color} name={s.label} />)
        ) : (
          <span className="ck-scale">
            <span>Less</span>
            {STEPS.map((a, i) => (
              <svg key={a} width="12" height="12" aria-hidden="true">
                <rect x="0.5" y="0.5" width="11" height="11" rx="2" fill={i ? `rgb(var(--fg) / ${a})` : 'rgb(var(--surface))'} stroke={INK.hairline} />
              </svg>
            ))}
            <span>More</span>
          </span>
        )}
      </div>
    </ChartFrame>
  );
}
