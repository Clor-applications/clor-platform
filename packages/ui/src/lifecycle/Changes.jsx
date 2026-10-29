import React, { useRef } from 'react';
import { ArrowRightLeft } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { formatDate } from '@ui/components/ui/DatePicker';

import { pageChanges } from './api';
import { PersonCell, crumbs } from './shared';

/**
 * Joining & Leaving → Changes: what is about to change in someone's job and
 * what changed lately. Dated changes waiting for their day, changes waiting
 * for approval, probation ending, contracts ending (both within 30 days or
 * already past), and changes that took effect in the last 30 days. A change
 * is made on the person's record (with its preview and approval); a row
 * opens that record, or the approval.
 */
const VIEWS = [['scheduled', 'Dated'], ['approval', 'Waiting for approval'], ['probation', 'Probation ending'], ['contracts', 'Contracts ending'], ['applied', 'Done lately']];
const DATE_WORD = { scheduled: 'From', approval: 'Asked', probation: 'Ends', contracts: 'Ends', applied: 'From' };

export default function Changes({ params = {}, updateParams, openScreen }) {
  const p = params || {};
  const view = VIEWS.some(([k]) => k === p.view) ? p.view : 'scheduled';
  const page = Math.max(1, Number(p.page || 1));
  const size = [25, 50, 100].includes(Number(p.size)) ? Number(p.size) : 25;
  const set = (patch, push = false) => updateParams?.(patch, { push });
  const query = { view, q: p.q, limit: size, offset: (page - 1) * size };
  const list = useRequest(() => pageChanges(query), [JSON.stringify(query)]);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, view);
  const counts = list.data?.counts || {};
  const go = (r) => (r.kind === 'APPROVAL' ? openScreen?.('approvals', { id: r.id }) : openScreen?.('employee', { id: r.employee.id }));

  const columns = [
    { key: 'person', label: 'Person', always: true, render: (r) => <PersonCell person={r.employee} /> },
    { key: 'what', label: 'What', render: (r) => (
      <span className="block min-w-0 whitespace-normal">
        <span className="block">{r.what}</span>
        {r.from || r.to ? <span className="block ui-caption">{r.from || 'None'} → {r.to || 'None'}</span> : null}
      </span>
    ) },
    { key: 'date', label: DATE_WORD[view], render: (r) => <span className={`tabular-nums whitespace-nowrap ${r.late ? 'ui-text-neg font-medium' : ''}`}>{formatDate(r.date)}{r.late ? ' (passed)' : ''}</span> },
    { key: 'reason', label: 'Reason', render: (r) => (r.reason ? <span className="block max-w-[18rem] truncate">{r.reason}</span> : <span className="ui-caption">—</span>) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={crumbs()} title="Job changes" />
      <div ref={tabsRef} role="tablist" aria-label="Changes" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {VIEWS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={`ui-tab ${view === k ? 'is-active' : ''}`} onClick={() => set({ view: k === 'scheduled' ? null : k, page: null }, true)}>
            {l}{counts[k] && k !== 'applied' ? <span className="ui-tab-count tabular-nums">{counts[k]}</span> : null}
          </button>
        ))}
        {tabIndicator}
      </div>
      <DataTable
        label="Changes"
        columns={columns}
        rows={list.data?.rows || []}
        total={Number(list.data?.total || 0)}
        page={page}
        pageSize={size}
        noun="changes"
        onPage={(n) => set({ page: n > 1 ? n : null }, true)}
        onPageSize={(n) => set({ size: n === 25 ? null : n, page: null })}
        onRowClick={go}
        loading={list.loading}
        refreshing={list.refreshing}
        card={(r) => (
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.employee.name}</span><span className={`ui-caption tabular-nums whitespace-nowrap ${r.late ? 'ui-text-neg' : ''}`}>{formatDate(r.date)}</span></span>
            <span className="block truncate ui-caption">{r.what}{r.to ? ` → ${r.to}` : ''}</span>
          </span>
        )}
        toolbar={<SearchField value={p.q || ''} onSearch={(q) => set({ q: q || null, page: null })} placeholder="Search name, ID or change" label="Search changes" className="w-full sm:w-72" />}
        empty={list.error ? <ErrorState error={list.error} onRetry={list.reload} />
          : p.q ? <EmptyState kind="filtered" title="Nothing matches" onClearFilters={() => set({ q: null, page: null })} />
            : <EmptyState icon={ArrowRightLeft} title={{ scheduled: 'No dated changes waiting', approval: 'No change waiting for approval', probation: 'No probation ends in the next 30 days', contracts: 'No contract ends in the next 30 days', applied: 'No changes in the last 30 days' }[view]} description={view === 'scheduled' ? 'A transfer or promotion dated ahead on someone’s record waits here for its day.' : undefined} />}
      />
    </div>
  );
}
