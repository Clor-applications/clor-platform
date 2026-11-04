import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tintOf } from '../organization/tints';
import { Minus, Plus, Maximize2 } from '@ui/components/ui/lineIcons';

import './orgChart.css';

/**
 * The org chart as a picture: the top of the company at the top, each
 * manager's people in a row beneath them, joined by lines. A manager whose
 * people manage nobody shows them as a short column instead of a long row,
 * so a forty-person company still fits a screen. The chart scrolls inside its
 * own frame (the page never scrolls sideways), zooms from 50% to 120%, and
 * Fit sizes it to the frame. Clicking a person opens their record; the count
 * under a manager shows or hides the people who report to them.
 */
const MIN = 0.5;
const MAX = 1.2;
const STEP = 0.1;

const initialsOf = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
const clamp = (z) => Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100));

export default function OrgTreeChart({ chart, closed, toggle, openScreen, onExpandAll, onCollapseAll, lead = null }) {
  /* One colour per department, the same as on the Organisation overview and the structure page (tintOf, from the name). */
  const tones = useMemo(() => {
    const names = [...new Set([...chart.byId.values()].map((n) => n.department).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return new Map(names.map((d) => [d, tintOf(d)]));
  }, [chart]);

  const frameRef = useRef(null);
  const innerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });

  /* A transform does not change layout size, so the scroll area is sized to the scaled chart by hand. */
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return undefined;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* The frame ends at the bottom of the window, so the chart scrolls and the page does not. */
  useLayoutEffect(() => {
    const f = frameRef.current;
    if (!f) return undefined;
    const place = () => f.style.setProperty('--oc-frame-h', `${Math.max(380, window.innerHeight - f.getBoundingClientRect().top - window.scrollY - 24)}px`);
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);

  /* Opens as wide as the frame allows while the names stay readable (60% at least); drag or zoom for the rest. */
  const centred = useRef(false);
  useLayoutEffect(() => {
    const f = frameRef.current;
    if (!f || !size.w || centred.current) return;
    centred.current = true;
    const z = clamp(Math.min(1, Math.max(0.6, (f.clientWidth - 48) / size.w)));
    /* Where the top person sits at 100%, measured before the zoom (and its transition) starts. */
    const root = innerRef.current?.querySelector('.oc-roots > .oc-node > .oc-card')?.getBoundingClientRect();
    const midAt1 = root ? root.left + root.width / 2 - innerRef.current.getBoundingClientRect().left : size.w / 2;
    setZoom(z);
    requestAnimationFrame(() => { f.scrollLeft = Math.max(0, midAt1 * z - f.clientWidth / 2); });
  }, [size.w]);

  const zoomTo = useCallback((next) => {
    const f = frameRef.current;
    const z = clamp(next);
    if (!f) return setZoom(z);
    /* Keep the middle of what is on screen in the middle. */
    const cx = (f.scrollLeft + f.clientWidth / 2) / zoom;
    const cy = (f.scrollTop + f.clientHeight / 2) / zoom;
    setZoom(z);
    requestAnimationFrame(() => {
      f.scrollLeft = cx * z - f.clientWidth / 2;
      f.scrollTop = cy * z - f.clientHeight / 2;
    });
    return undefined;
  }, [zoom]);

  /* After the tree changes shape (expand or collapse all), bring the top person back to the middle. */
  const centreOnRoot = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    const f = frameRef.current;
    const r = innerRef.current?.querySelector('.oc-roots > .oc-node > .oc-card')?.getBoundingClientRect();
    if (!f || !r) return;
    f.scrollLeft = Math.max(0, r.left + r.width / 2 - f.getBoundingClientRect().left + f.scrollLeft - f.clientWidth / 2);
    f.scrollTop = 0;
  }));

  const fit = () => {
    const f = frameRef.current;
    if (!f || !size.w) return;
    const z = clamp(Math.min(1, (f.clientWidth - 48) / size.w));
    setZoom(z);
    requestAnimationFrame(() => { f.scrollTop = 0; f.scrollLeft = Math.max(0, (f.scrollWidth - f.clientWidth) / 2); });
  };

  /* Drag the empty canvas to move around, as on any map. */
  const drag = useRef(null);
  const onPointerDown = (e) => {
    if (e.button !== 0 || e.pointerType === 'touch' || e.target.closest('button')) return;
    const f = frameRef.current;
    drag.current = { x: e.clientX, y: e.clientY, l: f.scrollLeft, t: f.scrollTop };
    f.setPointerCapture(e.pointerId);
    f.classList.add('is-dragging');
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const f = frameRef.current;
    f.scrollLeft = d.l - (e.clientX - d.x);
    f.scrollTop = d.t - (e.clientY - d.y);
  };
  const endDrag = () => { drag.current = null; frameRef.current?.classList.remove('is-dragging'); };

  const ctx = { chart, closed, toggle, openScreen, tones };
  const legend = [...tones.entries()];

  return (
    <section className="oc" aria-label="Org chart">
      {/* One row: what the page passes in (the view, the date, the count) on the left, the chart's own controls on the right. */}
      <div className="oc-bar ui-no-print">
        {lead ? <div className="oc-lead">{lead}</div> : <span />}
        <div className="oc-tools">
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => { onExpandAll(); centreOnRoot(); }}>Expand all</button>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => { onCollapseAll(); centreOnRoot(); }}>Collapse all</button>
          <div className="oc-zoom" role="group" aria-label="Zoom">
            <button type="button" className="oc-zoom-btn" onClick={() => zoomTo(zoom - STEP)} disabled={zoom <= MIN} aria-label="Zoom out"><Minus size={14} /></button>
            <span className="oc-zoom-value tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button type="button" className="oc-zoom-btn" onClick={() => zoomTo(zoom + STEP)} disabled={zoom >= MAX} aria-label="Zoom in"><Plus size={14} /></button>
            <button type="button" className="oc-zoom-btn oc-zoom-fit" onClick={fit}><Maximize2 size={13} aria-hidden="true" />Fit</button>
          </div>
        </div>
      </div>
      <div className="oc-stage">
      {/* The departments' colours, floating in the chart's corner rather than taking a row above it. */}
      {legend.length ? (
        <ul className="oc-legend oc-legend-float ui-no-print" aria-label="Departments">
          {legend.map(([d, tone]) => <li key={d} data-tone={tone}><i aria-hidden="true" />{d}</li>)}
        </ul>
      ) : null}
      <div ref={frameRef} className="oc-frame" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className="oc-sizer" style={{ width: size.w * zoom || undefined, height: size.h * zoom || undefined }}>
          <div ref={innerRef} className="oc-canvas" style={{ transform: `scale(${zoom})` }}>
            <ul className="oc-level oc-roots">
              {chart.roots.map((n) => <Branch key={n.id} n={n} ctx={ctx} />)}
              {chart.loose.length ? (
                <li className="oc-node">
                  <div className="oc-group-label">Open positions</div>
                  <ul className="oc-stack">{chart.loose.map((s) => <li key={s.id}><SeatCard s={s} /></li>)}</ul>
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}

function Branch({ n, ctx }) {
  const { chart, closed } = ctx;
  const kids = chart.kids.get(n.id) || [];
  const seats = chart.seatsUnder.get(n.id) || [];
  const count = kids.length + seats.length;
  const open = count > 0 && !closed.has(n.id);
  /* People who manage nobody sit in a column under their manager: a row of thirty would run off any screen. */
  const leavesOnly = kids.every((k) => !(chart.kids.get(k.id) || []).length && !chart.seatsUnder.has(k.id));
  const stacked = leavesOnly && count >= 2;
  return (
    <li className={`oc-node ${open && stacked ? 'has-stack' : ''}`}>
      <PersonCard n={n} ctx={ctx} count={kids.length} seats={seats.length} open={open} />
      {open ? (
        <ul className={stacked ? 'oc-stack' : 'oc-level'}>
          {kids.map((k) => (stacked
            ? <li key={k.id}><PersonCard n={k} ctx={ctx} count={0} seats={0} open={false} compact /></li>
            : <Branch key={k.id} n={k} ctx={ctx} />))}
          {seats.map((s) => (stacked ? <li key={s.id}><SeatCard s={s} /></li> : <li key={s.id} className="oc-node"><SeatCard s={s} /></li>))}
        </ul>
      ) : null}
    </li>
  );
}

function PersonCard({ n, ctx, count, seats, open, compact = false }) {
  const tone = ctx.tones.get(n.department) || null;
  const dotted = n.dottedManagerId ? ctx.chart.byId.get(n.dottedManagerId) : null;
  const total = count + seats;
  const reports = `${count} direct ${count === 1 ? 'report' : 'reports'}${seats ? `, ${seats} open ${seats === 1 ? 'position' : 'positions'}` : ''}`;
  return (
    <div className={`oc-card ${compact ? 'is-compact' : ''}`} data-tone={tone || undefined}>
      <button type="button" className="oc-card-main" onClick={() => ctx.openScreen?.('employee', { id: n.id })}
        aria-label={[n.name, n.designation, n.department, dotted ? `also reports to ${dotted.name}` : null, total ? reports : null].filter(Boolean).join(', ')}>
        {n.photoUrl
          ? <img src={n.photoUrl} alt="" className="oc-avatar" />
          : <span className="oc-avatar" aria-hidden="true">{initialsOf(n.name)}</span>}
        <span className="oc-text">
          <span className="oc-name" title={n.name}>{n.name}</span>
          <span className="oc-role" title={n.designation || undefined}>{n.designation || '—'}</span>
          {n.department && !compact ? <span className="oc-dept"><i aria-hidden="true" />{n.department}</span> : null}
          {dotted && !compact ? <span className="oc-dotted">Also reports to {dotted.name}</span> : null}
        </span>
      </button>
      {total ? (
        <button type="button" className="oc-count" aria-expanded={open} onClick={() => ctx.toggle(n.id)}
          aria-label={`${open ? 'Hide' : 'Show'} ${reports}`} title={reports}>
          {open ? <Minus size={11} aria-hidden="true" /> : <Plus size={11} aria-hidden="true" />}
          <span className="tabular-nums">{total}</span>
        </button>
      ) : null}
    </div>
  );
}

function SeatCard({ s }) {
  return (
    <div className="oc-card is-compact is-seat">
      <div className="oc-card-main">
        <span className="oc-avatar" aria-hidden="true">+</span>
        <span className="oc-text">
          <span className="oc-name">{s.name}</span>
          <span className="oc-role">Open position{s.teamName ? ` · ${s.teamName}` : ''}</span>
        </span>
      </div>
    </div>
  );
}
