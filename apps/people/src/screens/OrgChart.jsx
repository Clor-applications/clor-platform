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
import { usePeopleUpdates } from './usePeopleUpdates';
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
  const req = useRequest(async () => {
    const chart = await getOrgChart({ asOf: asOfDay });
    if (!Array.isArray(chart?.nodes)) throw new Error('The org chart data could not be read.');
    return chart;
  }, [asOfDay]);
  /* Three views of one company: the chart as a picture (the default), the same lines as a searchable outline, and who sits in which department under which head. */
  /* With no reporting lines drawn yet, the chart would be a row of loose names at 60%: the page opens grouped by
     department instead, at full size, until someone is given a manager (People plan 8 Nov 2026, §3 rule 4). */
  const hasLines = useMemo(() => { const ids = new Set((req.data?.nodes || []).map((n) => n.id)); return (req.data?.nodes || []).some((n) => n.reportingManagerId && ids.has(n.reportingManagerId)); }, [req.data]);
  const view = params.view === 'departments' || params.view === 'reporting' ? params.view : params.view !== 'chart' && req.data && !hasLines && (req.data.nodes || []).length ? 'departments' : 'chart';
  usePeopleUpdates(() => { if (!asOfDay && !req.loading && !req.refreshing) req.reload(); });
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, view);
  /* null until someone opens or closes a row: then the chart's own starting shape applies. */
  const [closedSet, setClosed] = useState(null);
  const [query, setQuery] = useState('');
  const [printAll, setPrintAll] = useState(false);
  const [deptQuery, setDeptQuery] = useState('');
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
    const q = printAll ? '' : query.trim().toLowerCase();
    if (!q) return null;
    const keep = new Set();
    for (const n of chart.byId.values()) {
      if (![n.name, n.code, n.designation, n.department].some((v) => String(v || '').toLowerCase().includes(q))) continue;
      let at = n;
      const seen = new Set();
      while (at && !seen.has(at.id)) { keep.add(at.id); seen.add(at.id); at = chart.byId.get(at.reportingManagerId); }
    }
    return keep;
  }, [query, chart, printAll]);

  function editClosed(change) { setClosed((s) => change(new Set(s ?? chart.startClosed))); }

  if (req.error) return <ErrorState error={req.error} onRetry={req.reload} />;
  if (!req.data) return <SkeletonCard lines={6} />;

  const closed = printAll ? new Set() : closedSet ?? chart.startClosed;
  const toggle = (id) => editClosed((next) => { if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const managers = new Set([...chart.kids.keys(), ...chart.seatsUnder.keys()].filter(Boolean));
  const nodes = req.data.nodes;
  /* Paper shows the whole chart: every branch open, the search cleared, only the chart itself on the page. */
  const print = () => {
    setPrintAll(true);
    const done = () => { setPrintAll(false); document.body.classList.remove('print-chart'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    document.body.classList.add('print-chart');
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  const chartView = view === 'chart' && nodes.length > 0;
  const viewTabs = (
    <div ref={tabsRef} role="tablist" aria-label="Org chart view" className={`ui-record-tablist ui-no-print ${tabIndicator ? 'has-indicator' : ''}`}>
      {[['chart', 'Chart'], ['reporting', 'Reporting lines'], ['departments', 'Departments']].map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={view === k} className={`ui-tab ${view === k ? 'is-active' : ''}`} onClick={() => updateParams?.({ view: k }, { push: true })}>{l}</button>
      ))}
      {tabIndicator}
    </div>
  );
  const asOfPicker = (
    <div className="oc-date ui-no-print">
      <label htmlFor="chart-as-of" className="text-sm ui-muted">As of</label>
      <div className="w-40"><DatePicker id="chart-as-of" value={asOfDay || todayIst()} max={todayIst()} onChange={(v) => updateParams?.({ asOf: v && v < todayIst() ? v : null })} /></div>
      {asOfDay ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => updateParams?.({ asOf: null })}>Today</button> : null}
    </div>
  );
  const headcount = nodes.length ? (
    <p className="ui-caption oc-summary">
      {nodes.length} {nodes.length === 1 ? 'person' : 'people'}{asOfDay ? ` on ${formatDate(asOfDay)}` : ''}
      {req.data.openSeats?.length ? ` · ${req.data.openSeats.length} open ${req.data.openSeats.length === 1 ? 'position' : 'positions'}` : ''}
    </p>
  ) : null;

  return (
    <div className={`oc-workspace ${printAll ? 'ui-print-area' : ''} ${chartView ? 'oc-page' : ''}`}>
      <PageHeader title="Org chart"
        actions={nodes.length ? <button type="button" className="ui-btn ui-btn-secondary ui-no-print" onClick={print}><Printer size={16} aria-hidden="true" />Print</button> : null}
      />
      <div className="oc-navigation">
        {viewTabs}
        <div className="oc-fields">
          {view === 'reporting' ? <SearchField value={query} onSearch={setQuery} delay={150} placeholder="Search people" label="Find in the org chart" /> : null}
          {view === 'departments' ? <SearchField value={deptQuery} onSearch={setDeptQuery} delay={150} placeholder="Search departments or people" label="Search departments or people" /> : asOfPicker}
        </div>
      </div>
      {chartView ? <OrgTreeChart chart={chart} closed={closed} toggle={toggle} openScreen={openScreen} lead={headcount}
        onExpandAll={() => setClosed(new Set())} onCollapseAll={() => setClosed(new Set(managers))} /> : null}
      {view === 'departments' ? <DepartmentView nodes={nodes} openScreen={openScreen} query={printAll ? '' : deptQuery} printAll={printAll} /> : chartView ? null : nodes.length === 0 ? (
        asOfDay
          ? <EmptyState title={`Nobody here on ${formatDate(asOfDay)}`} description="Nobody had joined by then." action={<button type="button" className="ui-btn ui-btn-secondary" onClick={() => updateParams?.({ asOf: null })}>Show today</button>} />
          : <EmptyState title="Nobody yet" description="The chart draws itself from who reports to whom. Add employees, each with a manager, and it appears here." action={openScreen ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => openScreen('employeeNew')}>Add employee</button> : null} />
      ) : (
        <>
          <div className="oc-bar ui-no-print">{headcount}
            {view === 'reporting' && !visible ? <div className="oc-tools">
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setClosed(new Set())}>Expand all</button>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setClosed(new Set(managers))}>Collapse all</button>
            </div> : null}
          </div>
          {view === 'reporting' && visible && !visible.size ? <p className="ui-muted text-sm">Nobody matches “{query.trim()}”.</p> : null}
          {view === 'reporting' ? (<>
          <ul ref={treeRef} role="tree" aria-label="Reporting lines" className="oc-outline ui-tree" onKeyDown={treeKeys} onFocus={treeFocus}>
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
    <li className="ui-tree-row flex items-center gap-2 px-2 py-1.5" style={{ '--oc-depth': depth }} {...(inTree ? { role: 'treeitem', tabIndex: -1, 'data-id': `seat-${s.id}`, 'data-label': s.name, 'aria-label': `${s.name}, open position${s.teamName ? `, ${s.teamName}` : ''}` } : {})}>
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
      <div className="ui-tree-row flex items-center gap-2 rounded-lg px-2 py-1.5 ui-hover-sunken" style={{ '--oc-depth': depth }}>
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
        {all ? <span className="ui-pill ui-pill-neutral ms-auto tabular-nums">{all} direct {all === 1 ? 'report' : 'reports'}</span> : null}
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
function DepartmentView({ nodes, openScreen, query, printAll }) {
  const org = useRequest(async () => {
    const data = await organization();
    if (!Array.isArray(data?.departments)) throw new Error('The department list could not be read.');
    return data;
  }, []);
  const [expanded, setExpanded] = useState(new Map());
  const setBranch = (id, value) => setExpanded((old) => new Map(old).set(id, value));
  const { ref: treeRef, onKeyDown: treeKeys, onFocus: treeFocus } = useTreeKeys({
    onExpand: (id) => setBranch(id, true),
    onCollapse: (id) => setBranch(id, false),
    onOpen: (id) => openScreen?.('employee', { id: id.slice(2) }),
  });
  usePeopleUpdates(() => { if (!org.loading && !org.refreshing) org.reload(); });
  if (org.error) return <ErrorState error={org.error} onRetry={org.reload} />;
  if (!org.data) return <SkeletonCard lines={6} />;

  const departments = org.data.departments.filter((d) => d.isActive !== false);
  const byId = new Map(departments.map((d) => [d.id, d]));
  const byName = new Map(departments.map((d) => [d.name, d.id]));
  const members = new Map();
  for (const n of nodes) {
    const id = byId.has(n.departmentId) ? n.departmentId : byName.get(n.department) || '';
    if (!members.has(id)) members.set(id, []);
    members.get(id).push(n);
  }
  const branches = new Map();
  const shown = [...departments].sort((a, b) => a.name.localeCompare(b.name));
  if (members.has('')) shown.push({ id: '', name: 'No department' });
  for (const d of shown) {
    const parent = byId.has(d.parentId) ? d.parentId : null;
    if (!branches.has(parent)) branches.set(parent, []);
    branches.get(parent).push(d);
  }
  const roots = branches.get(null) || [];
  const term = query.trim().toLowerCase();
  const match = (text) => String(text || '').toLowerCase().includes(term);
  const row = (d, depth, showWholeBranch = false) => {
    const branchMatch = showWholeBranch || match(d.name) || match(d.headName);
    const people = (members.get(d.id) || []).filter((n) => branchMatch || [n.name, n.code, n.designation].some(match))
      .sort((a, b) => Number(b.id === d.headEmployeeId) - Number(a.id === d.headEmployeeId) || a.name.localeCompare(b.name));
    const children = (branches.get(d.id) || []).map((child) => row(child, depth + 1, branchMatch)).filter(Boolean);
    if (term && !branchMatch && !people.length && !children.length) return null;
    const key = d.id || 'none';
    const parent = Boolean(people.length || children.length);
    const isOpen = printAll || Boolean(term) || (expanded.get(key) ?? (roots.length === 1 && depth === 0 && people.length <= 20));
    const total = members.get(d.id)?.length || 0;
    return (
      <li key={key} role="treeitem" data-id={key} data-label={d.name} tabIndex={-1} aria-expanded={parent ? isOpen : undefined}
        aria-label={`${d.name}, ${total} ${total === 1 ? 'person' : 'people'}`}>
        <div className="ui-tree-row oc-dept-row" style={{ '--oc-depth': depth }}>
          <button type="button" tabIndex={-1} disabled={!parent || Boolean(term)} onClick={() => setBranch(key, !isOpen)}>
            {parent ? (isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <span className="w-4" />}
            <span><strong>{d.name}</strong>{d.id ? <small>{d.headName ? `Head · ${d.headName}${d.headLeft ? ' (left)' : ''}` : 'No department head'}</small> : null}</span>
          </button>
          <span className="oc-member-count">{total} {total === 1 ? 'person' : 'people'}</span>
        </div>
        {isOpen && parent ? <ul role="group">
          {people.map((n) => (
            <li key={n.id} role="treeitem" data-id={`p-${n.id}`} data-label={n.name} data-opens="1" tabIndex={-1}
              className="ui-tree-row oc-member-row" style={{ '--oc-depth': depth + 1 }} aria-label={[n.name, n.designation].filter(Boolean).join(', ')}>
              <Avatar person={n} size={30} />
              <span><button type="button" tabIndex={-1} className="ui-doc-title" onClick={() => openScreen?.('employee', { id: n.id })}>{n.name}</button>
                <small>{[n.code, n.designation].filter(Boolean).join(' · ')}</small></span>
              {n.id === d.headEmployeeId ? <span className="oc-head-tag">Department head</span> : null}
            </li>))}
          {children}
        </ul> : null}
      </li>
    );
  };
  if (!roots.length) return <EmptyState title="No departments yet" description="Add departments, and the people in each show here." />;
  const matches = roots.map((d) => row(d, 0)).filter(Boolean);
  return matches.length ? (
    <ul ref={treeRef} role="tree" aria-label="Departments" className="oc-outline ui-tree" onKeyDown={treeKeys} onFocus={treeFocus}>{matches}</ul>
  ) : <p className="ui-caption">No departments or people match “{query.trim()}”.</p>;
}
