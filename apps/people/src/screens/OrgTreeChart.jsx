import { Handle, Position, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import React, { useMemo, useState } from 'react';
import { tintOf } from '../organization/tints';
import { Minus, Plus, Maximize2 } from '@ui/components/ui/lineIcons';

import './orgChart.css';
import { identityCat } from '@ui/personnel/Employees';

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
function OrgNode({ data }) {
  return <>
    <Handle type="target" position={Position.Top} isConnectable={false} />
    {data.seat ? <SeatCard s={data.seat} /> : <PersonCard {...data} />}
    <Handle type="source" position={Position.Bottom} isConnectable={false} />
  </>;
}
const orgNodeTypes = { person: OrgNode };

// Each parent sits midway between its outer children. A forest shares the same horizontal cursor.
function buildFlow(chart, ctx) {
  const nodes = [];
  const edges = [];
  let nextLeaf = 0;
  function place(n, depth, parent, seat = false) {
    const id = (seat ? 'seat-' : 'person-') + n.id;
    const kids = seat ? [] : chart.kids.get(n.id) || [];
    const seats = seat ? [] : chart.seatsUnder.get(n.id) || [];
    const open = !seat && !ctx.closed.has(n.id) && kids.length + seats.length > 0;
    const children = open ? [
      ...kids.map((k) => place(k, depth + 1, id)),
      ...seats.map((s) => place(s, depth + 1, id, true)),
    ] : [];
    const x = children.length ? (children[0] + children[children.length - 1]) / 2 : nextLeaf++ * 248;
    const data = seat ? { seat: n } : { n, ctx, count: kids.length, seats: seats.length, open, compact: !kids.length && !seats.length };
    nodes.push({ id, type: 'person', position: { x, y: depth * 200 }, data });
    if (parent) edges.push({ id: parent + '/' + id, source: parent, target: id, type: 'smoothstep' });
    return x;
  }
  chart.roots.forEach((n) => place(n, 0, null));
  chart.loose.forEach((s) => place(s, 0, null, true));
  return { nodes, edges };
}

export default function OrgTreeChart({ chart, closed, toggle, openScreen, onExpandAll, onCollapseAll, lead = null }) {
  /* One colour per department, the same as on the Organisation overview and the structure page (tintOf, from the name). */
  const tones = useMemo(() => {
    const names = [...new Set([...chart.byId.values()].map((n) => n.department).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return new Map(names.map((d) => [d, tintOf(d)]));
  }, [chart]);

  const [flow, setFlow] = useState(null);
  const [zoom, setZoom] = useState(1);
  const ctx = { chart, closed, toggle, openScreen, tones };
  const { nodes, edges } = buildFlow(chart, ctx);
  const fit = () => flow?.fitView({ padding: 0.15, maxZoom: 1 });
  const legend = [...tones.entries()];

  return (
    <section className="oc" aria-label="Org chart">
      {/* One row: what the page passes in (the view, the date, the count) on the left, the chart's own controls on the right. */}
      <div className="oc-bar ui-no-print">
        {lead ? <div className="oc-lead">{lead}</div> : <span />}
        <div className="oc-tools">
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => { onExpandAll(); requestAnimationFrame(() => requestAnimationFrame(fit)); }}>Expand all</button>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => { onCollapseAll(); requestAnimationFrame(() => requestAnimationFrame(fit)); }}>Collapse all</button>
          <div className="oc-zoom" role="group" aria-label="Zoom">
            <button type="button" className="oc-zoom-btn" onClick={() => flow?.zoomTo(Math.max(MIN, zoom - STEP))} disabled={zoom <= MIN} aria-label="Zoom out"><Minus size={14} /></button>
            <span className="oc-zoom-value tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button type="button" className="oc-zoom-btn" onClick={() => flow?.zoomTo(Math.min(MAX, zoom + STEP))} disabled={zoom >= MAX} aria-label="Zoom in"><Plus size={14} /></button>
            <button type="button" className="oc-zoom-btn oc-zoom-fit" onClick={fit}><Maximize2 size={13} aria-hidden="true" />Fit</button>
          </div>
        </div>
      </div>
      <div className="oc-stage">
      {/* The departments' colours, floating in the chart's corner rather than taking a row above it. */}
      {legend.length > 1 ? (
        <ul className="oc-legend oc-legend-float ui-no-print" aria-label="Departments">
          {legend.map(([d, tone]) => <li key={d} data-tone={tone}><i aria-hidden="true" />{d}</li>)}
        </ul>
      ) : null}
      <div className="oc-frame oc-flow ui-no-print">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={orgNodeTypes} onInit={setFlow} onMove={(_, viewport) => setZoom(viewport.zoom)}
          fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} minZoom={MIN} maxZoom={MAX}
          nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} deleteKeyCode={null}
          zoomOnDoubleClick={false} preventScrolling={false} aria-label="Reporting hierarchy" />
      </div>
      <div className="oc-tree-outline">
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
  const stacked = leavesOnly && count > 6;
  return (
    <li className={`oc-node ${open && stacked ? 'has-stack' : ''}`}>
      <PersonCard n={n} ctx={ctx} count={kids.length} seats={seats.length} open={open} compact={!count} />
      {open ? (
        <ul className={stacked ? 'oc-stack' : leavesOnly ? 'oc-level oc-terminal' : 'oc-level'}>
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
          : <span className="oc-avatar" aria-hidden="true" style={{ '--oc-face': `var(--cat-${identityCat(n.name)})` }}>{initialsOf(n.name)}</span>}
        <span className="oc-text">
          <span className="oc-name" title={n.name}>{n.name}</span>
          <span className="oc-role" title={n.designation || undefined}>{n.designation || '—'}</span>
          {n.department && !compact ? <span className="oc-dept"><i aria-hidden="true" />{n.department}</span> : null}
          {dotted ? <span className="oc-dotted">Also reports to {dotted.name}</span> : null}
        </span>
      </button>
      {total ? (
        <button type="button" className="oc-count" aria-expanded={open} onClick={() => ctx.toggle(n.id)}
          aria-label={`${open ? 'Hide' : 'Show'} ${reports}`} title={reports}>
          {open ? <Minus size={11} aria-hidden="true" /> : <Plus size={11} aria-hidden="true" />}
          <span className="tabular-nums">{count ? `${count} ${count === 1 ? 'report' : 'reports'}` : ''}{count && seats ? ' · ' : ''}{seats ? `${seats} open` : ''}</span>
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
