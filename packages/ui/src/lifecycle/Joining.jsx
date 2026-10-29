import React, { useRef, useState } from 'react';
import { UserPlus } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { formatDate } from '@ui/components/ui/DatePicker';
import { usePermissions } from '@ui/permissions/usePermissions';

import { pageJoiners } from './api';
import { NextTask, PersonCell, Progress, can, crumbs } from './shared';
import PlanDrawer from './Plan';

/**
 * Joining & Leaving → Joining: everyone joining or recently joined. Before
 * day one: details to check, preparing, ready for day one (every step due by
 * the joining day done). After it: joined with steps open, then done. A
 * plan that never started says so. View, search and page live in the address.
 * New joiners come in through the one Add employee form.
 */
const VIEWS = [['preparing', 'Before day one'], ['week', 'This week'], ['joined', 'Joined, steps open'], ['done', 'Done'], ['all', 'All']];
export const STAGE_PILL = { CHECK: 'ui-pill-warn', PREPARING: 'ui-pill-neutral', READY: 'ui-pill-pos', JOINED: 'ui-pill-info', DONE: 'ui-pill-pos', NO_PLAN: 'ui-pill-neg', NOTICE: 'ui-pill-warn', LAST_DAY: 'ui-pill-warn', CLEARING: 'ui-pill-info' };

export default function Joining({ params = {}, updateParams, openScreen }) {
  const perms = usePermissions();
  const p = params || {};
  const view = VIEWS.some(([k]) => k === p.view) ? p.view : 'preparing';
  const page = Math.max(1, Number(p.page || 1));
  const size = [25, 50, 100].includes(Number(p.size)) ? Number(p.size) : 25;
  const set = (patch, push = false) => updateParams?.(patch, { push });
  const query = { view, q: p.q, limit: size, offset: (page - 1) * size };
  const list = useRequest(() => pageJoiners(query), [JSON.stringify(query)]);
  const [open, setOpen] = useState(null);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, view);
  const counts = list.data?.counts || {};
  const canAdd = can(perms, 'PEOPLE::Employees::CREATE');

  const columns = [
    { key: 'person', label: 'Person', always: true, render: (r) => <PersonCell person={r} line={[r.code, r.designation, r.department].filter(Boolean).join(' · ')} /> },
    { key: 'joins', label: 'Joins on', render: (r) => <span className="tabular-nums whitespace-nowrap">{formatDate(r.dateOfJoining)}</span> },
    { key: 'stage', label: 'Stage', render: (r) => <span className={`ui-pill ${STAGE_PILL[r.stage] || 'ui-pill-neutral'}`}>{r.stageLabel}</span> },
    { key: 'steps', label: 'Steps', render: (r) => <Progress done={r.done} total={r.total} late={r.late} /> },
    { key: 'next', label: 'Next step', render: (r) => <NextTask next={r.next} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={crumbs()} title="Joining" actions={canAdd ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => openScreen?.('employeeNew')}><UserPlus size={16} aria-hidden="true" /> Add employee</button> : null} />
      <div ref={tabsRef} role="tablist" aria-label="Joining" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {VIEWS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={`ui-tab ${view === k ? 'is-active' : ''}`} onClick={() => set({ view: k === 'preparing' ? null : k, page: null }, true)}>
            {l}{counts[k] && k !== 'all' && k !== 'done' ? <span className="ui-tab-count tabular-nums">{counts[k]}</span> : null}
          </button>
        ))}
        {tabIndicator}
      </div>
      <DataTable
        label="Joining"
        columns={columns}
        rows={list.data?.rows || []}
        total={Number(list.data?.total || 0)}
        page={page}
        pageSize={size}
        noun="people"
        onPage={(n) => set({ page: n > 1 ? n : null }, true)}
        onPageSize={(n) => set({ size: n === 25 ? null : n, page: null })}
        onRowClick={(r) => setOpen(r)}
        loading={list.loading}
        refreshing={list.refreshing}
        rowActions={(r) => [{ key: 'plan', label: 'Open plan', onSelect: () => setOpen(r) }, { key: 'record', label: 'Open their record', onSelect: () => openScreen?.('employee', { id: r.id }) }]}
        card={(r) => (
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.name}</span><span className={`ui-pill ${STAGE_PILL[r.stage] || 'ui-pill-neutral'}`}>{r.stageLabel}</span></span>
            <span className="block truncate ui-caption tabular-nums">Joins {formatDate(r.dateOfJoining)} · {r.total ? `${r.done} of ${r.total} steps` : 'no plan'}{r.late ? `, ${r.late} late` : ''}</span>
          </span>
        )}
        toolbar={<SearchField value={p.q || ''} onSearch={(q) => set({ q: q || null, page: null })} placeholder="Search name, ID or designation" label="Search joiners" className="w-full sm:w-72" />}
        empty={list.error ? <ErrorState error={list.error} onRetry={list.reload} />
          : p.q ? <EmptyState kind="filtered" title="Nobody matches" onClearFilters={() => set({ q: null, page: null })} />
            : <EmptyState icon={UserPlus} title={view === 'week' ? 'Nobody starts this week' : view === 'preparing' ? 'Nobody is joining yet' : view === 'joined' ? 'No joiner has steps open' : 'Nobody here'} description={view === 'preparing' && canAdd ? 'Add an employee with a joining date ahead and their plan starts here.' : undefined} />}
      />
      {open ? <PlanDrawer row={open} kind="JOINING" canEdit={can(perms, 'PEOPLE::Employees::EDIT')} canAssign={can(perms, 'PEOPLE::Employees::EDIT')} openScreen={openScreen} onClose={() => setOpen(null)} onChanged={list.reload} /> : null}
    </div>
  );
}
