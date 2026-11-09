import React, { useEffect, useRef, useState } from 'react';
import { UserPlus } from '@ui/components/ui/lineIcons';

import { EmptyState } from '@ui/components/ui/Primitives';
import ListHeader from '@ui/components/list/ListHeader';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { usePermissions } from '@ui/permissions/usePermissions';
import Alert from '@ui/components/ui/Alert';
import { notify } from '@ui/components/ui/notify';
import { hasApp } from '@platform/context';
import { listInvites, sendHeldToPayroll } from '@ui/personnel/api';

import { pageJoiners } from './api';
import { NextTask, PersonCell, Progress, can, crumbs } from './shared';
import PlanDrawer from './Plan';
import { istDay } from '@ui/utils/dates';

/**
 * Joining & Leaving → Joining: everyone joining or recently joined. Before
 * day one: details to check, preparing, ready for day one (every step due by
 * the joining day done). After it: joined with steps open, then done. A
 * plan that never started says so. View, search and page live in the address.
 * New joiners come in through the one Add employee form.
 */
const VIEWS = [['preparing', 'Before day one'], ['week', 'This week'], ['joined', 'Joined, steps open'], ['forms', 'Forms not back'], ['done', 'Done'], ['all', 'All']];
/* A joining form sent and not sent back (FEATURE-UI-AUDIT gap 22): not opened, opened, or the link ran out. */
const formState = (i) => (i.status === 'EXPIRED' || ((i.status === 'SENT' || i.status === 'STARTED') && new Date(i.expiresAt) < new Date()) ? ['Link ran out', 'ui-pill-neg']
  : i.status === 'STARTED' ? ['Opened, not sent back', 'ui-pill-warn'] : ['Not opened yet', 'ui-pill-neutral']);
const notBack = (invites) => {
  /* One line per person: their latest form, while it is still not back. */
  const latest = new Map();
  for (const i of invites) if (!latest.has(i.employeeId)) latest.set(i.employeeId, i);
  return [...latest.values()].filter((i) => ['SENT', 'STARTED', 'EXPIRED'].includes(i.status)).map((i) => ({ ...i, name: i.employeeName }));
};
export const STAGE_PILL = { CHECK: 'ui-pill-warn', PREPARING: 'ui-pill-neutral', READY: 'ui-pill-pos', JOINED: 'ui-pill-info', DONE: 'ui-pill-pos', NO_PLAN: 'ui-pill-neg', NOTICE: 'ui-pill-warn', LAST_DAY: 'ui-pill-warn', CLEARING: 'ui-pill-info' };

export default function Joining({ params = {}, updateParams, openScreen }) {
  const perms = usePermissions();
  const p = params || {};
  const view = VIEWS.some(([k]) => k === p.view) ? p.view : 'preparing';
  const page = Math.max(1, Number(p.page || 1));
  const size = [25, 50, 100].includes(Number(p.size)) ? Number(p.size) : 25;
  const set = (patch, push = false) => updateParams?.(patch, { push });
  const query = { view, q: p.q, limit: size, offset: (page - 1) * size };
  const list = useRequest(() => (view === 'forms' ? Promise.resolve(null) : pageJoiners(query)), [JSON.stringify(query)]);
  /* Joining forms: for the Forms not back view, and for the details held for Payroll (gap 15). */
  const canForms = can(perms, 'PEOPLE::Lifecycle::VIEW');
  const invites = useRequest(() => (canForms ? listInvites() : Promise.resolve([])), [canForms]);
  const forms = notBack(invites.data || []);
  const held = (invites.data || []).filter((i) => i.statutory?.status === 'HELD');
  const canSendHeld = held.length > 0 && hasApp('payroll') && can(perms, 'PEOPLE::Statutory Details::EDIT');
  const [sending, setSending] = useState(false);
  const sendHeld = async () => {
    setSending(true);
    try {
      const r = await sendHeldToPayroll();
      notify.success(r?.sent ? `${r.sent === 1 ? 'One joiner’s' : `${r.sent} joiners’`} details sent to Payroll.` : 'Nothing was waiting to go to Payroll.');
      invites.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not sent.'));
    } finally {
      setSending(false);
    }
  };
  const [open, setOpen] = useState(null);
  const counts = { ...(list.data?.counts || {}), forms: forms.length };
  const canAdd = can(perms, 'PEOPLE::Employees::CREATE');
  /* Opened without a view: the first tab that has rows, not an empty "Before day one" beside a tab with forty (People plan 8 Nov 2026, step 2). Once. */
  const steered = useRef(false);
  useEffect(() => {
    if (steered.current || p.view || !list.data?.counts) return;
    steered.current = true;
    if (Number(counts.preparing) > 0) return;
    const first = VIEWS.find(([k]) => k !== 'done' && k !== 'all' && Number(counts[k]) > 0);
    if (first) set({ view: first[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the first answer only
  }, [list.data]);

  const columns = [
    { key: 'person', label: 'Person', always: true, render: (r) => <PersonCell person={r} line={[r.code, r.designation, r.department].filter(Boolean).join(' · ')} /> },
    { key: 'joins', label: 'Joins on', render: (r) => <span className="tabular-nums whitespace-nowrap">{formatDate(r.dateOfJoining)}</span> },
    { key: 'stage', label: 'Stage', render: (r) => <span className={`ui-pill ${STAGE_PILL[r.stage] || 'ui-pill-neutral'}`}>{r.stageLabel}</span> },
    { key: 'steps', label: 'Steps', render: (r) => <Progress done={r.done} total={r.total} late={r.late} /> },
    { key: 'next', label: 'Next step', render: (r) => <NextTask next={r.next} /> },
  ];

  return (
    <div className="space-y-6">
      <ListHeader
        breadcrumb={crumbs()}
        title="Joining"
        description="Everyone joining or just joined, with their plan's steps and what comes next."
        primary={canAdd ? { label: 'Add employee', icon: UserPlus, onClick: () => openScreen?.('employeeNew') } : null}
        toolbar={<SearchField value={p.q || ''} onSearch={(q) => set({ q: q || null, page: null })} placeholder="Search name, ID or designation" label="Search joiners" className="w-full sm:w-72" />}
        tabs={VIEWS.map(([k, l]) => ({ key: k, label: l, count: k !== 'all' && k !== 'done' ? counts[k] : 0 }))}
        tab={view}
        onTab={(k) => set({ view: k === 'preparing' ? null : k, page: null }, true)}
      />
      {canSendHeld ? (
        <Alert tone="info" title={`${held.length === 1 ? 'One joiner’s' : `${held.length} joiners’`} PAN, PF, ESI and bank details are kept in People`} action={<button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={sending} onClick={sendHeld}>{sending ? 'Sending…' : 'Send to Payroll'}</button>}>
          They were approved before Payroll was switched on.
        </Alert>
      ) : null}
      {view === 'forms' ? <FormsNotBack rows={forms} loading={invites.loading} error={invites.error} reload={invites.reload} openScreen={openScreen} /> : (
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
        empty={list.error ? <ErrorState error={list.error} onRetry={list.reload} />
          : p.q ? <EmptyState kind="filtered" title="Nobody matches" onClearFilters={() => set({ q: null, page: null })} />
            : <EmptyState icon={UserPlus} title={view === 'week' ? 'Nobody starts this week' : view === 'preparing' ? 'Nobody is joining yet' : view === 'joined' ? 'No joiner has steps open' : 'Nobody here'} description={view === 'preparing' && canAdd ? 'Add an employee with a joining date ahead and their plan starts here.' : undefined} />}
      />
      )}
      {open ? <PlanDrawer row={open} kind="JOINING" canEdit={can(perms, 'PEOPLE::Employees::EDIT')} canAssign={can(perms, 'PEOPLE::Employees::EDIT')} openScreen={openScreen} onClose={() => setOpen(null)} onChanged={list.reload} /> : null}
    </div>
  );
}

/** Joining forms sent and not back: whose, when and how they went, and where each stands. Sending again is on the person's record. */
function FormsNotBack({ rows, loading, error, reload, openScreen }) {
  const columns = [
    { key: 'person', label: 'Person', always: true, render: (i) => <PersonCell person={{ name: i.employeeName }} line={[i.employeeCode, i.dateOfJoining ? `joins ${formatDate(String(i.dateOfJoining).slice(0, 10))}` : null].filter(Boolean).join(' · ')} /> },
    { key: 'sent', label: 'Sent', render: (i) => <span className="whitespace-nowrap"><span className="tabular-nums">{formatDate(istDay(i.createdAt))}</span><span className="block ui-caption">{i.channel === 'SMS' ? 'Link by phone' : `To ${i.sentTo}`}</span></span> },
    { key: 'state', label: 'Where it is', render: (i) => { const [label, pill] = formState(i); return <span className={`ui-pill ${pill}`}>{label}</span>; } },
    { key: 'until', label: 'Link works until', render: (i) => <span className="tabular-nums whitespace-nowrap">{formatDate(istDay(i.expiresAt))}</span> },
  ];
  return (
    <DataTable
      label="Forms not back"
      columns={columns}
      rows={rows}
      total={rows.length}
      page={1}
      pageSize={Math.max(25, rows.length)}
      noun="forms"
      loading={loading}
      onRowClick={(i) => openScreen?.('employee', { id: i.employeeId })}
      rowActions={(i) => [{ key: 'record', label: 'Open their record to send again', onSelect: () => openScreen?.('employee', { id: i.employeeId }) }]}
      card={(i) => {
        const [label, pill] = formState(i);
        return (
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{i.employeeName}</span><span className={`ui-pill ${pill}`}>{label}</span></span>
            <span className="block truncate ui-caption tabular-nums">Sent {formatDate(istDay(i.createdAt))} · works until {formatDate(istDay(i.expiresAt))}</span>
          </span>
        );
      }}
      empty={error ? <ErrorState error={error} onRetry={reload} /> : <EmptyState icon={UserPlus} title="Every joining form sent has come back" description="Send one from a joiner’s record: More → Send joining form." />}
    />
  );
}
