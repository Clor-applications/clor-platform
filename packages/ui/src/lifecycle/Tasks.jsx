import React, { useState } from 'react';
import { CheckCheck } from '@ui/components/ui/lineIcons';

import { EmptyState } from '@ui/components/ui/Primitives';
import ListHeader from '@ui/components/list/ListHeader';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { usePermissions } from '@ui/permissions/usePermissions';
import ErrorState from '@ui/components/ui/ErrorState';

import { KIND_WORD, OWNER_WORD, READER_PILL, pageTasks } from './api';
import { TaskDrawer, can, crumbs } from './shared';

/**
 * Joining & Leaving → Tasks (was Onboarding & Exit): every joining, leaving,
 * change, probation and letter task, asked of the server by view, kind,
 * search and page, all kept in the address. Mine first; late; nobody's
 * (HR picks them up); everyone's open; done in the last 90 days. A task
 * opens in a drawer to close it (with a note when the step needs one) or to
 * hand it on. Someone without the Employees right sees only their own.
 */
const VIEWS = [['mine', 'Mine'], ['late', 'Late'], ['nobody', 'Nobody’s'], ['open', 'All open'], ['done', 'Done']];
const KINDS = [['', 'Every kind'], ...Object.entries(KIND_WORD)];

export default function Tasks({ params = {}, updateParams, openScreen }) {
  const perms = usePermissions();
  const hr = can(perms, 'PEOPLE::Employees::EDIT');
  const p = params || {};
  const view = VIEWS.some(([k]) => k === p.view) ? p.view : 'mine';
  const page = Math.max(1, Number(p.page || 1));
  const size = [25, 50, 100].includes(Number(p.size)) ? Number(p.size) : 25;
  const set = (patch, push = false) => updateParams?.(patch, { push });
  const query = { view, kind: p.kind, q: p.q, limit: size, offset: (page - 1) * size };
  const list = useRequest(() => pageTasks(query), [JSON.stringify(query)]);
  const [open, setOpen] = useState(null);
  const counts = list.data?.counts || {};
  const mineOnly = Boolean(list.data?.mineOnly);
  const views = mineOnly ? VIEWS.filter(([k]) => k === 'mine' || k === 'done') : VIEWS;
  const filtered = Boolean(p.q || p.kind);

  const columns = [
    { key: 'task', label: 'Task', always: true, render: (t) => (
      <span className="block min-w-0 whitespace-normal">
        <span className="block font-medium">{t.title}</span>
        <span className="block ui-caption">{KIND_WORD[t.kind] || t.kind} · {t.employee.name}{t.employee.code ? ` (${t.employee.code})` : ''}</span>
      </span>
    ) },
    { key: 'owner', label: 'Owner', render: (t) => <span className="whitespace-nowrap">{t.ownerName || <span className="ui-muted">{OWNER_WORD[t.owner] || t.owner}, nobody named</span>}</span> },
    { key: 'due', label: view === 'done' ? 'Done' : 'Due', render: (t) => (view === 'done'
      ? <span className="whitespace-nowrap tabular-nums">{t.doneAt ? formatDate(String(t.doneAt).slice(0, 10)) : ''}<span className="block ui-caption">{t.doneBy}</span></span>
      : <span className={`whitespace-nowrap tabular-nums ${t.late ? 'ui-text-neg font-medium' : ''}`}>{t.dueDate ? formatDate(t.dueDate) : '—'}{t.late ? ' (late)' : ''}</span>) },
    { key: 'state', label: 'State', render: (t) => (t.system === 'READERS' && !t.done
      ? <span className={`ui-pill ${READER_PILL[t.systemState] || 'ui-pill-neutral'}`}>{t.systemState === 'FAILED' ? 'Not confirmed' : t.systemState === 'WAITING' ? 'Waiting for readers' : 'On the last day'}</span>
      : t.needsNote && !t.done ? <span className="ui-pill ui-pill-outline">Needs a note</span>
        : t.ownPlan ? <span className="ui-caption">Your own plan</span> : null) },
  ];

  return (
    <div className="space-y-6">
      <ListHeader
        breadcrumb={crumbs()}
        title="Tasks"
        description="Every joining, leaving, probation and letter step: whose it is, when it is due, and closing it."
        toolbar={<>
          <SearchField value={p.q || ''} onSearch={(q) => set({ q: q || null, page: null })} placeholder="Search task or person" label="Search tasks" className="w-full sm:w-72" />
          <div className="w-full sm:w-44"><PopupSelect showValueSubtext={false} ariaLabel="Kind of task" placeholder="Every kind" value={p.kind || ''} onChange={(v) => set({ kind: v || null, page: null })} options={KINDS.map(([value, label]) => ({ value, label }))} /></div>
        </>}
        tabs={views.map(([k, l]) => ({ key: k, label: l, count: k !== 'done' ? counts[k] : 0, tone: k === 'late' ? 'warn' : undefined }))}
        tab={view}
        onTab={(k) => set({ view: k === 'mine' ? null : k, page: null }, true)}
      />
      <DataTable
        label="Tasks"
        columns={columns}
        rows={list.data?.rows || []}
        total={Number(list.data?.total || 0)}
        page={page}
        pageSize={size}
        noun="tasks"
        onPage={(n) => set({ page: n > 1 ? n : null }, true)}
        onPageSize={(n) => set({ size: n === 25 ? null : n, page: null })}
        onRowClick={(t) => setOpen(t)}
        loading={list.loading}
        refreshing={list.refreshing}
        rowActions={(t) => [
          ...(!t.done ? [{ key: 'open', label: 'Open task', onSelect: () => setOpen(t) }] : []),
          ...(openScreen && !mineOnly ? [{ key: 'record', label: 'Open their record', onSelect: () => openScreen('employee', { id: t.employee.id }) }] : []),
        ]}
        card={(t) => (
          <span className="min-w-0 flex-1">
            <span className="flex items-start justify-between gap-2"><span className="font-medium">{t.title}</span><span className={`ui-caption tabular-nums whitespace-nowrap ${t.late ? 'ui-text-neg' : ''}`}>{t.dueDate ? formatDate(t.dueDate) : ''}</span></span>
            <span className="block truncate ui-caption">{[KIND_WORD[t.kind], t.employee.name, t.ownerName || OWNER_WORD[t.owner]].filter(Boolean).join(' · ')}</span>
          </span>
        )}
        empty={list.error ? <ErrorState error={list.error} onRetry={list.reload} />
          : filtered ? <EmptyState kind="filtered" title="No tasks match" onClearFilters={() => set({ q: null, kind: null, page: null })} />
            : <EmptyState icon={CheckCheck} title={view === 'mine' ? 'Nothing on your name' : view === 'late' ? 'Nothing late' : view === 'nobody' ? 'Every task has an owner' : view === 'done' ? 'Nothing done in the last 90 days' : 'Nothing open'} />}
      />
      {open ? <TaskDrawer task={open} canAssign={hr && !mineOnly} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); list.reload(); }} /> : null}
    </div>
  );
}
