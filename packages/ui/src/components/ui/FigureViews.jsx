import React, { useState } from 'react';

import './FigureViews.css';

/*
 * Two ways to show a few figures without four tiles (owner, 22 Nov 2026, styles E and H):
 * a ring cut into the day's parts, and one figure you switch between views of.
 */

const R = 48;
const C = 2 * Math.PI * R;

/**
 * The day as a ring (style E): each part an arc in its own status colour, the
 * whole in the middle, and the parts listed beside it. Pointing at a part, in
 * the ring or the list, lifts it. A part at nought is left out.
 */
export function PartsRing({ parts, total, middle, middleWords, label }) {
  const [lit, setLit] = useState(null);
  const shown = parts.filter((p) => p.value > 0);
  const sum = Math.max(1, total ?? shown.reduce((n, p) => n + p.value, 0));
  const arcs = shown.reduce((list, p) => {
    const at = list.length ? list[list.length - 1].end : 0;
    const len = (p.value / sum) * C;
    return [...list, { ...p, len, offset: -at, end: at + len }];
  }, []);
  return (
    <div className="ui-ring" onPointerLeave={() => setLit(null)}>
      <svg viewBox="0 0 120 120" className="ui-ring-svg" role="img" aria-label={`${label}: ${shown.map((p) => `${p.value} ${p.label.toLowerCase()}`).join(', ')}`}>
        <circle cx="60" cy="60" r={R} className="ui-ring-track" />
        {arcs.map((a) => (
          <circle
            key={a.key}
            cx="60"
            cy="60"
            r={R}
            className="ui-ring-arc"
            data-tone={a.tone}
            data-lit={lit === a.key || undefined}
            data-dim={(lit && lit !== a.key) || undefined}
            strokeDasharray={`${Math.max(0, a.len - (arcs.length > 1 ? 1.5 : 0))} ${C}`}
            strokeDashoffset={a.offset}
            onPointerEnter={() => setLit(a.key)}
          />
        ))}
      </svg>
      <div className="ui-ring-middle" aria-hidden="true">
        <b className="tabular-nums">{middle}</b>
        <span>{middleWords}</span>
      </div>
      <ul className="ui-ring-facts">
        {shown.map((p) => (
          <li key={p.key} data-tone={p.tone} data-lit={lit === p.key || undefined} onPointerEnter={() => setLit(p.key)}>
            <span>{p.label}</span>
            <b className="tabular-nums">{p.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One figure, four views (style H): a switch picks what to look at, the big figure
 * is the newest value, and the columns are its history with the newest drawn strong.
 * Each view: { key, label, value (the big figure in words), points: [{ key, label, value, words }] }.
 */
export function ViewSwitch({ views, label, initial }) {
  const [on, setOn] = useState(initial || views[0]?.key);
  const view = views.find((v) => v.key === on) || views[0];
  if (!view) return null;
  const max = Math.max(1, ...view.points.map((p) => Math.abs(Number(p.value) || 0)));
  return (
    <div className="ui-views">
      <div className="ui-views-switch" role="group" aria-label={label}>
        {views.map((v) => (
          <button key={v.key} type="button" aria-pressed={v.key === view.key} onClick={() => setOn(v.key)}>
            <span>{v.label}</span>
            <b className="tabular-nums">{v.short ?? v.value}</b>
          </button>
        ))}
      </div>
      <div className="ui-views-body">
        <div className="ui-views-figure">
          <b className="tabular-nums">{view.value}</b>
          {view.note ? <span>{view.note}</span> : null}
        </div>
        {view.points.length ? (
          <ol className="ui-views-cols" aria-label={`${view.label}, month by month`}>
            {view.points.map((p, i) => (
              <li key={p.key} aria-label={`${p.label}: ${p.words}`} title={`${p.label}: ${p.words}`} data-now={i === view.points.length - 1 || undefined}>
                <span className="ui-views-col" aria-hidden="true"><i style={{ height: `${Math.max(2, (Math.abs(Number(p.value) || 0) / max) * 100)}%` }} /></span>
                <span className="ui-views-month" aria-hidden="true">{p.label}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
