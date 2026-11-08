import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Printer } from '@ui/components/ui/lineIcons';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import SearchField from '@ui/components/ui/SearchField';
import useRequest from '@ui/components/ui/useRequest';
import { getOrgChart } from '@ui/personnel/api';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { organization } from '../organization/api';
import { useTreeKeys } from '@ui/components/ui/useTreeKeys';
import { Avatar } from '@ui/personnel/Employees';
import OrgTreeChart from './OrgTreeChart';
import { todayIst } from '@ui/utils/dates';

/**
 * Who reports to whom. The Chart tab (the default) draws it as a tree of
 * cards (OrgTreeChart); Reporting lines is the same data as an outline,
 * which searches and prints well past a few hundred people. A name opens the
 * person's record; the employee ID tells apart two people with one name.
 * A search keeps each match with the chain of managers above it. Dotted-line
 * managers are named under the person; open seats (ORG-04) sit under their
 * team's lead, or in their own list when the team has no lead on the chart.
 */

export default function OrgChart({ openScreen, params = {}, updateParams }) {
  /* As of a past date (FND-03): who reported to whom then. Open positions are today's, so a past view leaves them out. */
  const asOfDay = params.view === 'departments' ? '' : params.asOf || '';
  const req = useRequest(() => getOrgChart({ asOf: asOfDay }), [asOfDay]);
  /* Three views of one company: the chart as a picture (the default), the same lines as a searchable outline, and who sits in which department under which head. */
  const view = params.view === 'departments' || params.view === 'reporting' ? params.view : 'chart';
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, view);
  /* null until someone opens or closes a row: then the chart's own starting shape applies. */
  const [closedSet, setClosed] = useState(null);
  const [query, setQuery] = useState('');
  /* Arrow keys walk the outline (WAI-ARIA tree): → opens, ← closes or goes up, Enter opens the person. */
  const { ref: treeRef, onKeyDown: treeKeys, onFocus: treeFocus } = useTreeKeys({
    onExpand: (id) => editClosed((next) => { next.delete(id); return next; }),
    onCollapse: (id) => editClosed((next) => next.add(id)),
    onOpen: (id) => openScreen?.('employee', { id }),
  });

  const chart = useMemo(() => {
    const list = req.data?.nodes || [];
    const byId = new Map(list.map((n) => [n.id, n]));
    const kids = new Map();
    for (const n of list) {
      const parent = n.reportingManagerId && byId.has(n.reportingManagerId) ? n.reportingManagerId : null;
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent).push(n);
    }
    const seatsUnder = new Map();
    const loose = [];
    for (const s of req.data?.openSeats || []) {
      if (s.leadEmployeeId && byId.has(s.leadEmployeeId)) seatsUnder.set(s.leadEmployeeId, [...(seatsUnder.get(s.leadEmployeeId) || []), s]);
      else loose.push(s);
    }
    const roots = kids.get(null) || [];
    /* A big company opens two levels deep, not a thousand rows at once (research R043); a small one opens fully. */
    const startClosed = new Set();
    if (list.length > 200) {
      let level = roots;
      for (let depth = 0; level.length; depth += 1) {
        const below = level.flatMap((n) => kids.get(n.id) || []);
        if (depth >= 1) for (const n of level) if ((kids.get(n.id) || []).length || seatsUnder.has(n.id)) startClosed.add(n.id);
        level = below;
      }
    }
    return { byId, kids, roots, seatsUnder, loose, startClosed, unmanaged: roots.filter((n) => !(kids.get(n.id) || []).length).length };
  }, [req.data]);

  /* A match keeps its managers above it, so it is still read in place. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const keep = new Set();
    for (const n of chart.byId.values()) {
      if (![n.name, n.code, n.designation, n.department].some((v) => String(v || '').toLowerCase().includes(q))) continue;
      let at = n;
      const seen = new Set();
      while (at && !seen.has(at.id)) { keep.add(at.id); seen.add(at.id); at = chart.byId.get(at.reportingManagerId); }
    }
    return keep;
  }, [query, chart]);

  function editClosed(change) { setClosed((s) => change(new Set(s ?? chart.startClosed))); }

  if (req.error) return <ErrorState error={req.error} onRetry={req.reload} />;
  if (!req.data) return <SkeletonCard lines={6} />;

  const closed = closedSet ?? chart.startClosed;
  const toggle = (id) => editClosed((next) => { if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const managers = [...chart.kids.keys()].filter(Boolean);
  const nodes = req.data.nodes;
  /* Paper shows the whole chart: every branch open, the search cleared, only the chart itself on the page. */
  const print = () => {
    setClosed(new Set());
    setQuery('');
    const done = () => { document.body.classList.remove('print-chart'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    document.body.classList.add('print-chart');
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  const chartView = view === 'chart' && nodes.length > 0;
  const viewTabs = (
    <div ref={tabsRef} role="tablist" aria-label="Org chart view" className={`ui-record-tablist ui-no-print ${tabIndicator ? 'has-indicator' : ''}`}>
      {[['chart', 'Chart'], ['reporting', 'Reporting lines'], ['departments', 'Departments']].map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={view === k} className={`ui-tab ${view === k ? 'is-active' : ''}`} onClick={() => updateParams?.({ view: k === 'chart' ? null : k }, { push: true })}>{l}</button>
      ))}
      {tabIndicator}
    </div>
  );
  const asOfPicker = (
    <div className="flex items-center gap-2 ui-no-print">
      <label htmlFor="chart-as-of" className="text-sm ui-muted">As of</label>
      <div className="w-40"><DatePicker id="chart-as-of" value={asOfDay || todayIst()} max={todayIst()} onChange={(v) => updateParams?.({ asOf: v && v < todayIst() ? v : null })} /></div>
      {asOfDay ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => updateParams?.({ asOf: null })}>Today</button> : null}
    </div>
  );
  const headcount = nodes.length ? (
    <p className="ui-caption">
      {nodes.length} {nodes.length === 1 ? 'person' : 'people'}{asOfDay ? ` on ${formatDate(asOfDay)}` : ''}
      {req.data.openSeats?.length ? ` · ${req.data.openSeats.length} open ${req.data.openSeats.length === 1 ? 'position' : 'positions'}` : ''}
    </p>
  ) : null;

  /* The chart takes the page (owner, 28 Oct 2026): one row of controls, then the chart down to the bottom of the window. */
  if (chartView) {
    return (
      <div className="space-y-6 ui-print-area oc-page">
        <PageHeader entity="people" breadcrumb={[{ label: 'People' }, { label: 'Org chart' }]} title="Org chart"
          actions={<button type="button" className="ui-btn ui-btn-secondary ui-no-print" onClick={print}><Printer size={16} aria-hidden="true" />Print</button>}
        />
        <OrgTreeChart chart={chart} closed={closed} toggle={toggle} openScreen={openScreen} lead={<>{viewTabs}{asOfPicker}{headcount}</>}
          onExpandAll={() => setClosed(new Set())} onCollapseAll={() => setClosed(new Set(chart.roots.filter((n) => chart.kids.has(n.id) || chart.seatsUnder.has(n.id)).flatMap((n) => (chart.kids.get(n.id) || []).map((k) => k.id))))} />
      </div>
    );
  }

  return (
    <div className="space-y-6 ui-print-area">
      <PageHeader entity="people" breadcrumb={[{ label: 'People' }, { label: 'Org chart' }]} title="Org chart"
        actions={nodes.length ? <button type="button" className="ui-btn ui-btn-secondary ui-no-print" onClick={print}><Printer size={16} aria-hidden="true" />Print</button> : null}
      />
      {viewTabs}
      {view === 'departments' ? <DepartmentView nodes={nodes} openScreen={openScreen} /> : nodes.length === 0 ? (
        asOfDay
          ? <EmptyState title={`Nobody here on ${formatDate(asOfDay)}`} description="Nobody had joined by then." action={<button type="button" className="ui-btn ui-btn-secondary" onClick={() => updateParams?.({ asOf: null })}>Show today</button>} />
          : <EmptyState title="Nobody yet" description="Add employees and who they report to." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 ui-no-print">
            {view === 'reporting' ? <SearchField value={query} onSearch={setQuery} delay={150} placeholder="Search people" label="Find in the org chart" /> : null}
            {asOfPicker}
            {headcount}
            {view === 'reporting' ? (
              <span className="flex gap-3 ml-auto text-sm">
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setClosed(new Set())}>Expand all</button>
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setClosed(new Set(managers))}>Collapse all</button>
              </span>
            ) : null}
          </div>
          {view === 'reporting' && visible && !visible.size ? <p className="ui-muted text-sm">Nobody matches “{query.trim()}”.</p> : null}
          {view === 'reporting' ? (<>
          <ul ref={treeRef} role="tree" aria-label="Reporting lines" className="border-t ui-tree" onKeyDown={treeKeys} onFocus={treeFocus}>
            {chart.roots.filter((n) => !visible || visible.has(n.id)).map((n) => (
              <Node key={n.id} n={n} depth={0} chart={chart} visible={visible} closed={closed} toggle={toggle} openScreen={openScreen} />
            ))}
          </ul>
          {chart.loose.length && !visible ? (
            <section aria-label="Open positions" className="border-t pt-3">
              <h2 className="ui-t-sec">Open positions <span className="ui-caption tabular-nums">{chart.loose.length}</span></h2>
              <ul className="divide-y text-sm">{chart.loose.map((s) => <SeatRow key={s.id} s={s} />)}</ul>
            </section>
          ) : null}
          </>) : null}
        </>
      )}
    </div>
  );
}

function SeatRow({ s, depth = 0, inTree = false }) {
  return (
    <li className="ui-tree-row flex items-center gap-2 px-2 py-1.5" style={{ marginInlineStart: depth * 20 }} {...(inTree ? { role: 'treeitem', tabIndex: -1, 'data-id': `seat-${s.id}`, 'data-label': s.name, 'aria-label': `${s.name}, open position${s.teamName ? `, ${s.teamName}` : ''}` } : {})}>
      <span className="inline-block w-6" />
      <span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-dashed ui-caption" aria-hidden="true">+</span>
      <span className="min-w-0">
        <span className="block truncate text-sm">{s.name} <span className="ui-pill ui-pill-neutral ml-1">Open position</span></span>
        <span className="block truncate ui-caption">{[s.teamName, s.budgetRef].filter(Boolean).join(' · ') || '—'}</span>
      </span>
    </li>
  );
}

function Node({ n, depth, chart, visible, closed, toggle, openScreen }) {
  const kids = (chart.kids.get(n.id) || []).filter((k) => !visible || visible.has(k.id));
  const seats = visible ? [] : chart.seatsUnder.get(n.id) || [];
  const all = (chart.kids.get(n.id) || []).length;
  /* A search opens every line it keeps. */
  const open = visible ? true : !closed.has(n.id);
  const dotted = n.dottedManagerId ? chart.byId.get(n.dottedManagerId) : null;
  const parent = kids.length || seats.length;
  return (
    <li role="treeitem" tabIndex={-1} data-id={n.id} data-label={n.name} data-opens="1" aria-expanded={parent ? open : undefined}
      aria-label={[n.name, n.designation, n.department, dotted ? `also reports to ${dotted.name}` : null, all ? `${all} direct ${all === 1 ? 'report' : 'reports'}` : null].filter(Boolean).join(', ')}>
      <div className="ui-tree-row flex items-center gap-2 rounded-lg px-2 py-1.5 ui-hover-sunken" style={{ marginInlineStart: depth * 20 }}>
        {parent ? (
          /* For the pointer; the keyboard uses → and ← on the row. */
          <button type="button" tabIndex={-1} aria-hidden="true" className="ui-icon-btn ui-tree-toggle !h-6 !w-6" onClick={() => toggle(n.id)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="inline-block w-6" />
        )}
        <Avatar person={n} size={30} />
        <span className="min-w-0">
          <span className="block truncate text-sm">
            <button type="button" tabIndex={-1} className="ui-doc-title inline" onClick={() => openScreen?.('employee', { id: n.id })}>{n.name}</button>
            {n.code ? <span className="ui-caption tabular-nums ml-1.5">{n.code}</span> : null}
          </span>
          <span className="block truncate ui-caption">
            {[n.designation, n.department].filter(Boolean).join(' · ') || '—'}
            {dotted ? ` · also reports to ${dotted.name}` : ''}
          </span>
        </span>
        {all ? <span className="ui-pill ui-pill-neutral ms-auto tabular-nums" title={`${all} direct ${all === 1 ? 'report' : 'reports'}`}>{all}</span> : null}
      </div>
      {parent && open ? (
        <ul role="group">
          {kids.map((k) => <Node key={k.id} n={k} depth={depth + 1} chart={chart} visible={visible} closed={closed} toggle={toggle} openScreen={openScreen} />)}
          {seats.map((s) => <SeatRow key={s.id} s={s} depth={depth + 1} inTree />)}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Departments view: each department under its parent, its head first, then
 * the people in it. Answers "who runs what, and who works where" — the
 * department tree and the reporting lines are different things and are not
 * drawn as one (research, graph constraints).
 */
function DepartmentView({ nodes, openScreen }) {
  const org = useRequest(() => organization(), []);
  const [open, setOpen] = useState(() => new Set());
  const { ref: treeRef, onKeyDown: treeKeys, onFocus: treeFocus } = useTreeKeys({
    onExpand: (id) => setOpen((s) => new Set(s).add(id === 'none' ? '' : id)),
    onCollapse: (id) => setOpen((s) => { const next = new Set(s); next.delete(id === 'none' ? '' : id); return next; }),
    onOpen: (id) => openScreen?.('employee', { id: id.replace(/^p-/, '') }),
  });
  if (org.error) return <ErrorState error={org.error} onRetry={org.reload} />;
  if (!org.data) return <SkeletonCard lines={6} />;
  const depts = org.data.departments.filter((d) => d.isActive !== false);
  const byDept = new Map();
  for (const n of nodes) {
    const key = n.departmentId || depts.find((d) => d.name === n.department)?.id || '';
    if (!byDept.has(key)) byDept.set(key, []);
    byDept.get(key).push(n);
  }
  const rows = [];
  const walk = (parent, depth) => {
    for (const d of depts.filter((x) => (x.parentId || null) === parent || (!parent && x.parentId && !depts.some((p) => p.id === x.parentId))).sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push({ ...d, depth });
      if (depth < 8) walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  const none = byDept.get('') || [];
  const toggle = (id) => setOpen((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const members = (id, head) => (byDept.get(id) || []).slice().sort((a, b) => (a.id === head ? -1 : b.id === head ? 1 : a.name.localeCompare(b.name)));
  if (!rows.length && !none.length) return <EmptyState title="No departments yet" description="Add departments, and the people in each show here." />;
  return (
    <ul ref={treeRef} role="tree" aria-label="Departments" className="border-t ui-tree" onKeyDown={treeKeys} onFocus={treeFocus}>
      {[...rows, ...(none.length ? [{ id: '', name: 'No department', depth: 0, headEmployeeId: null }] : [])].map((d) => {
        const people = members(d.id, d.headEmployeeId);
        const isOpen = open.has(d.id);
        return (
          <li key={d.id || 'none'} role="treeitem" tabIndex={-1} data-id={d.id || 'none'} data-label={d.name} aria-level={d.depth + 1} data-parent={d.parentId && rows.some((x) => x.id === d.parentId) ? d.parentId : undefined}
            aria-expanded={people.length ? isOpen : undefined}
            aria-label={[d.name, d.id ? (d.headName ? `head ${d.headName}${d.headLeft ? ' (left)' : ''}` : 'no head') : null, `${people.length} ${people.length === 1 ? 'person' : 'people'}`].filter(Boolean).join(', ')}>
            <div className="ui-tree-row flex items-center gap-2 rounded-lg px-2 py-1.5 ui-hover-sunken" style={{ marginInlineStart: d.depth * 20 }}>
              {people.length ? (
                <button type="button" tabIndex={-1} aria-hidden="true" className="ui-icon-btn ui-tree-toggle !h-6 !w-6" onClick={() => toggle(d.id)}>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              ) : <span className="inline-block w-6" />}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{d.name}</span>
                {d.id ? <span className="block truncate ui-caption">{d.headName ? `Head: ${d.headName}${d.headLeft ? ' (left)' : ''}` : 'No head'}</span> : null}
              </span>
              <span className="ui-pill ui-pill-neutral ms-auto tabular-nums" title={`${people.length} ${people.length === 1 ? 'person' : 'people'}`}>{people.length}</span>
            </div>
            {isOpen && people.length ? (
              <ul role="group">
                {people.map((n) => (
                  <li key={n.id} role="treeitem" tabIndex={-1} data-id={`p-${n.id}`} data-label={n.name} data-opens="1" aria-level={d.depth + 2}
                    aria-label={[n.name, n.id === d.headEmployeeId ? 'head' : null, n.designation].filter(Boolean).join(', ')}
                    className="ui-tree-row flex items-center gap-2 px-2 py-1.5" style={{ marginInlineStart: (d.depth + 1) * 20 }}>
                    <span className="inline-block w-6" />
                    <Avatar person={n} size={30} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm"><button type="button" tabIndex={-1} className="ui-doc-title inline" onClick={() => openScreen?.('employee', { id: n.id })}>{n.name}</button>{n.code ? <span className="ui-caption tabular-nums ml-1.5">{n.code}</span> : null}</span>
                      <span className="block truncate ui-caption">{[n.id === d.headEmployeeId ? 'Head' : null, n.designation].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
