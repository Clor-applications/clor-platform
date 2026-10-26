import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Printer } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import SearchField from '@ui/components/ui/SearchField';
import useRequest from '@ui/components/ui/useRequest';
import { getOrgChart } from '@ui/personnel/api';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { organization } from '../organization/api';
import { Avatar } from '@ui/personnel/Employees';

/**
 * Who reports to whom, as an outline: easier to read than boxes and lines
 * once a company is past a dozen people, and it prints. A name opens the
 * person's record; the employee ID tells apart two people with one name.
 * A search keeps each match with the chain of managers above it. Dotted-line
 * managers are named under the person; open seats (ORG-04) sit under their
 * team's lead, or in their own list when the team has no lead on the chart.
 */
export default function OrgChart({ openScreen, params = {}, updateParams }) {
  const req = useRequest(getOrgChart, []);
  /* Two views of one company: who reports to whom, and who sits in which department under which head. */
  const view = params.view === 'departments' ? 'departments' : 'reporting';
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, view);
  const [closed, setClosed] = useState(() => new Set());
  const [query, setQuery] = useState('');

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
    return { byId, kids, roots, seatsUnder, loose, unmanaged: roots.filter((n) => !(kids.get(n.id) || []).length).length };
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

  if (req.error) return <ErrorState error={req.error} onRetry={req.reload} />;
  if (!req.data) return <SkeletonCard lines={6} />;

  const toggle = (id) => setClosed((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
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

  return (
    <div className="space-y-6 ui-print-area">
      <PageHeader entity="people" breadcrumb={[{ label: 'People' }, { label: 'Organization', onClick: () => openScreen?.('organization') }, { label: 'Org Chart' }]} title="Org Chart"
        actions={nodes.length ? <button type="button" className="ui-btn ui-btn-secondary ui-no-print" onClick={print}><Printer size={16} aria-hidden="true" />Print</button> : null}
      />
      <div ref={tabsRef} role="tablist" aria-label="Org chart view" className={`ui-record-tablist ui-no-print ${tabIndicator ? 'has-indicator' : ''}`}>
        {[['reporting', 'Reporting lines'], ['departments', 'Departments']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={`ui-tab ${view === k ? 'is-active' : ''}`} onClick={() => updateParams?.({ view: k === 'reporting' ? null : k }, { push: true })}>{l}</button>
        ))}
        {tabIndicator}
      </div>
      {view === 'departments' ? <DepartmentView nodes={nodes} openScreen={openScreen} /> : nodes.length === 0 ? (
        <EmptyState title="Nobody yet" description="Add employees and who they report to." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 ui-no-print">
            <SearchField value={query} onSearch={setQuery} delay={150} placeholder="Search people" label="Find in the org chart" />
            <span className="flex gap-3 ml-auto text-sm">
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setClosed(new Set())}>Expand all</button>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setClosed(new Set(managers))}>Collapse all</button>
            </span>
          </div>
          <p className="ui-caption">
            {nodes.length} {nodes.length === 1 ? 'person' : 'people'}
            {req.data.openSeats?.length ? ` · ${req.data.openSeats.length} open ${req.data.openSeats.length === 1 ? 'position' : 'positions'}` : ''}
          </p>
          {visible && !visible.size ? <p className="ui-muted text-sm">Nobody matches “{query.trim()}”.</p> : null}
          <ul className="border-t" aria-label="Reporting lines">
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
        </>
      )}
    </div>
  );
}

function SeatRow({ s, depth = 0 }) {
  return (
    <li className="flex items-center gap-2 px-2 py-1.5" style={{ marginInlineStart: depth * 20 }}>
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
  return (
    <li>
      <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 ui-hover-sunken" style={{ marginInlineStart: depth * 20 }}>
        {kids.length || seats.length ? (
          <button type="button" className="ui-icon-btn !h-6 !w-6" aria-expanded={open} aria-label={open ? `Collapse ${n.name}` : `Expand ${n.name}`} onClick={() => toggle(n.id)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="inline-block w-6" />
        )}
        <Avatar person={n} size={30} />
        <span className="min-w-0">
          <span className="block truncate text-sm">
            <button type="button" className="ui-doc-title inline" onClick={() => openScreen?.('employee', { id: n.id })}>{n.name}</button>
            {n.code ? <span className="ui-caption tabular-nums ml-1.5">{n.code}</span> : null}
          </span>
          <span className="block truncate ui-caption">
            {[n.designation, n.department].filter(Boolean).join(' · ') || '—'}
            {dotted ? ` · also reports to ${dotted.name}` : ''}
          </span>
        </span>
        {all ? <span className="ui-pill ui-pill-neutral ms-auto tabular-nums" title={`${all} direct ${all === 1 ? 'report' : 'reports'}`}>{all}</span> : null}
      </div>
      {(kids.length || seats.length) && open ? (
        <ul>
          {kids.map((k) => <Node key={k.id} n={k} depth={depth + 1} chart={chart} visible={visible} closed={closed} toggle={toggle} openScreen={openScreen} />)}
          {seats.map((s) => <SeatRow key={s.id} s={s} depth={depth + 1} />)}
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
    <ul className="border-t" aria-label="Departments">
      {[...rows, ...(none.length ? [{ id: '', name: 'No department', depth: 0, headEmployeeId: null }] : [])].map((d) => {
        const people = members(d.id, d.headEmployeeId);
        const isOpen = open.has(d.id);
        return (
          <li key={d.id || 'none'}>
            <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 ui-hover-sunken" style={{ marginInlineStart: d.depth * 20 }}>
              {people.length ? (
                <button type="button" className="ui-icon-btn !h-6 !w-6" aria-expanded={isOpen} aria-label={isOpen ? `Collapse ${d.name}` : `Expand ${d.name}`} onClick={() => toggle(d.id)}>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              ) : <span className="inline-block w-6" />}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{d.name}</span>
                <span className="block truncate ui-caption">{d.id ? (d.headName ? `Head: ${d.headName}${d.headLeft ? ' (left)' : ''}` : 'No head') : 'People not in a department'}</span>
              </span>
              <span className="ui-pill ui-pill-neutral ms-auto tabular-nums" title={`${people.length} ${people.length === 1 ? 'person' : 'people'}`}>{people.length}</span>
            </div>
            {isOpen && people.length ? (
              <ul>
                {people.map((n) => (
                  <li key={n.id} className="flex items-center gap-2 px-2 py-1.5" style={{ marginInlineStart: (d.depth + 1) * 20 }}>
                    <span className="inline-block w-6" />
                    <Avatar person={n} size={30} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm"><button type="button" className="ui-doc-title inline" onClick={() => openScreen?.('employee', { id: n.id })}>{n.name}</button>{n.code ? <span className="ui-caption tabular-nums ml-1.5">{n.code}</span> : null}</span>
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
