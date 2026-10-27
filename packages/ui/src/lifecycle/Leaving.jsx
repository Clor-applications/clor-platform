import React, { useRef, useState } from 'react';
import { UserMinus } from 'lucide-react';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { formatDate } from '@ui/components/ui/DatePicker';
import { usePermissions } from '@ui/permissions/usePermissions';

import { READER_PILL, pageLeavers } from './api';
import { PersonCell, Progress, can, crumbs } from './shared';
import { STAGE_PILL } from './Joining';
import PlanDrawer from './Plan';

/**
 * Joining & Leaving → Leaving: everyone on notice or recently gone. For each,
 * the last day, the steps, and the three things that go wrong when nobody
 * watches: the readers (waiting, confirmed, not confirmed), final wages (due
 * in working days, paid or late) and their CLOR sign-in. Why someone leaves
 * is shown only to HR. A leaving is recorded on the person's record, where
 * the notice, approval and preview are; each row opens the plan.
 */
const VIEWS = [['notice', 'On notice'], ['clearing', 'Left, steps open'], ['done', 'Done'], ['all', 'All']];
const TYPE_WORD = { RESIGNED: 'Resigned', TERMINATED: 'Employment ended', RETIRED: 'Retired', ABSCONDED: 'Stopped coming', CONTRACT_ENDED: 'Contract ended', DECEASED: 'Passed away' };

export default function Leaving({ params = {}, updateParams, openScreen }) {
  const perms = usePermissions();
  const p = params || {};
  const view = VIEWS.some(([k]) => k === p.view) ? p.view : 'notice';
  const page = Math.max(1, Number(p.page || 1));
  const size = [25, 50, 100].includes(Number(p.size)) ? Number(p.size) : 25;
  const set = (patch, push = false) => updateParams?.(patch, { push });
  const query = { view, q: p.q, limit: size, offset: (page - 1) * size };
  const list = useRequest(() => pageLeavers(query), [JSON.stringify(query)]);
  const [open, setOpen] = useState(null);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, view);
  const counts = list.data?.counts || {};

  const columns = [
    { key: 'person', label: 'Person', always: true, render: (r) => <PersonCell person={r} line={[r.code, r.leavingType ? TYPE_WORD[r.leavingType] || r.leavingType : r.designation].filter(Boolean).join(' · ')} /> },
    { key: 'last', label: 'Last day', render: (r) => <span className="tabular-nums whitespace-nowrap">{formatDate(r.dateOfLeaving)}<span className="block"><span className={`ui-pill ${STAGE_PILL[r.stage] || 'ui-pill-neutral'}`}>{r.stageLabel}</span></span></span> },
    { key: 'steps', label: 'Steps', render: (r) => <Progress done={r.done} total={r.total} late={r.late} /> },
    { key: 'readers', label: 'Readers', render: (r) => (r.readers ? <span className={`ui-pill ${READER_PILL[r.readers.state] || 'ui-pill-neutral'}`}>{r.readers.word}</span> : <span className="ui-caption">—</span>) },
    { key: 'wages', label: 'Final wages', render: (r) => (r.wages
      ? <span className={`whitespace-nowrap ${r.wages.late ? 'ui-text-neg font-medium' : ''}`}>{r.wages.paid ? 'Paid' : r.wages.late ? `Late since ${formatDate(r.wages.dueDate)}` : `Due ${formatDate(r.wages.dueDate)}`}</span>
      : <span className="ui-caption">—</span>) },
    { key: 'signin', label: 'CLOR sign-in', render: (r) => (r.signIn ? <span className="whitespace-nowrap">{r.signIn.open ? (r.status === 'LEFT' ? 'Still on' : 'On until the last day') : 'Turned off'}</span> : <span className="ui-caption">None</span>) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={crumbs()} title="Leaving" />
      <div ref={tabsRef} role="tablist" aria-label="Leaving" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {VIEWS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={`ui-tab ${view === k ? 'is-active' : ''}`} onClick={() => set({ view: k === 'notice' ? null : k, page: null }, true)}>
            {l}{counts[k] && k !== 'all' && k !== 'done' ? <span className="ui-tab-count tabular-nums">{counts[k]}</span> : null}
          </button>
        ))}
        {tabIndicator}
      </div>
      <DataTable
        label="Leaving"
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
            <span className="block truncate ui-caption tabular-nums">Last day {formatDate(r.dateOfLeaving)} · {r.total ? `${r.done} of ${r.total} steps` : 'no plan'}</span>
            <span className="block truncate ui-caption">{[r.readers ? `Readers: ${r.readers.word.toLowerCase()}` : null, r.wages ? (r.wages.paid ? 'wages paid' : r.wages.late ? 'wages late' : `wages due ${formatDate(r.wages.dueDate)}`) : null].filter(Boolean).join(' · ')}</span>
          </span>
        )}
        toolbar={<SearchField value={p.q || ''} onSearch={(q) => set({ q: q || null, page: null })} placeholder="Search name, ID or designation" label="Search leavers" className="w-full sm:w-72" />}
        empty={list.error ? <ErrorState error={list.error} onRetry={list.reload} />
          : p.q ? <EmptyState kind="filtered" title="Nobody matches" onClearFilters={() => set({ q: null, page: null })} />
            : <EmptyState icon={UserMinus} title={view === 'notice' ? 'Nobody is on notice' : view === 'clearing' ? 'No leaver has steps open' : 'Nobody here'} description={view === 'notice' ? 'Record a leaving on the person’s record, or approve a resignation, and it shows here.' : undefined} />}
      />
      {open ? <PlanDrawer row={open} kind="LEAVING" canEdit={can(perms, 'PEOPLE::Employees::EDIT')} canAssign={can(perms, 'PEOPLE::Employees::EDIT')} openScreen={openScreen} onClose={() => setOpen(null)} onChanged={list.reload} /> : null}
    </div>
  );
}
