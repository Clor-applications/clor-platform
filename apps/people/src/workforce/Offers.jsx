import React, { useRef } from 'react';
import { FileText } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { formatDate } from '@ui/components/ui/DatePicker';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { PersonCell, crumbs } from '@ui/lifecycle/shared';

import { listOffers, withdrawOffer } from './api';
import { can } from './shared';
import { wholeRupees as rupees } from '@ui/utils/money';
import { istDay } from '@ui/utils/dates';

/**
 * Joining & leaving → Offers (FEATURE-UI-AUDIT gap 7): every offer sent with
 * an accept link, where it stands, and Withdraw while it is still open. An
 * offer is written from the person's record (More → Send an offer) or from a
 * candidate; this list is where HR looks after it is sent. The server keeps
 * a team-limited role to its own team's offers.
 */
const VIEWS = [['open', 'Waiting'], ['accepted', 'Accepted'], ['closed', 'Declined or withdrawn'], ['all', 'All']];
const STATUS = {
  SENT: ['Waiting for them', 'ui-pill-warn'],
  ACCEPTED: ['Accepted', 'ui-pill-pos'],
  DECLINED: ['Declined', 'ui-pill-neg'],
  EXPIRED: ['Ran out', 'ui-pill-neutral'],
  WITHDRAWN: ['Withdrawn', 'ui-pill-neutral'],
};
const inView = (o, view) => (view === 'open' ? o.status === 'SENT' : view === 'accepted' ? o.status === 'ACCEPTED' : view === 'closed' ? ['DECLINED', 'EXPIRED', 'WITHDRAWN'].includes(o.status) : true);
/* A moment as India's calendar day, not the UTC date. */
const sentOn = (o) => formatDate(istDay(o.createdAt));

export default function Offers({ params = {}, updateParams, openScreen }) {
  const perms = usePermissions();
  const p = params || {};
  const view = VIEWS.some(([k]) => k === p.view) ? p.view : 'open';
  const page = Math.max(1, Number(p.page || 1));
  const size = [25, 50, 100].includes(Number(p.size)) ? Number(p.size) : 25;
  const set = (patch, push = false) => updateParams?.(patch, { push });
  const req = useRequest(() => listOffers(), []);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, view);
  const canWithdraw = can(perms, 'PEOPLE::Documents::CREATE');
  const q = String(p.q || '').trim().toLowerCase();
  const all = req.data || [];
  const counts = Object.fromEntries(VIEWS.map(([k]) => [k, all.filter((o) => inView(o, k)).length]));
  const rows = all.filter((o) => inView(o, view) && (!q || `${o.name} ${o.designation} ${o.email}`.toLowerCase().includes(q)));
  const shown = rows.slice((page - 1) * size, page * size);

  const withdraw = async (o) => {
    if (!(await confirmDialog({ title: `Withdraw the offer to ${o.name}?`, message: 'The accept link stops working at once. The letter stays on their record.', confirmLabel: 'Withdraw' }))) return;
    try {
      await withdrawOffer(o.id);
      notify.success(`Offer to ${o.name} withdrawn.`);
      req.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not withdrawn.'));
      req.reload();
    }
  };
  const open = (o) => (o.employeeId ? openScreen?.('employee', { id: o.employeeId }) : o.candidateId ? openScreen?.('candidates', { id: o.candidateId }) : null);
  const status = (o) => { const [label, pill] = STATUS[o.status] || [o.status, 'ui-pill-neutral']; return <span className={`ui-pill ${pill}`}>{label}</span>; };
  const when = (o) => (o.status === 'SENT' ? `Accept by ${formatDate(o.acceptBy)}` : o.status === 'ACCEPTED' && o.acceptedAt ? `Accepted ${formatDate(istDay(o.acceptedAt))}` : o.status === 'DECLINED' && o.declinedAt ? `Declined ${formatDate(istDay(o.declinedAt))}` : o.status === 'EXPIRED' ? `Ran out ${formatDate(o.acceptBy)}` : '');

  const columns = [
    { key: 'person', label: 'Person', always: true, render: (o) => <PersonCell person={{ name: o.name }} line={[o.designation, o.email].filter(Boolean).join(' · ')} /> },
    { key: 'ctc', label: 'Annual CTC', align: 'right', render: (o) => <span className="whitespace-nowrap tabular-nums">{rupees(o.annualCtc)}</span> },
    { key: 'joins', label: 'Joins on', render: (o) => <span className="tabular-nums whitespace-nowrap">{o.joiningDate ? formatDate(o.joiningDate) : '—'}</span> },
    { key: 'sent', label: 'Sent', render: (o) => <span className="tabular-nums whitespace-nowrap">{sentOn(o)}</span> },
    { key: 'status', label: 'Status', render: (o) => <span className="block">{status(o)}<span className="block ui-caption tabular-nums mt-0.5">{when(o)}</span></span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={crumbs()} title="Offers" />
      <div ref={tabsRef} role="tablist" aria-label="Offers" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {VIEWS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={`ui-tab ${view === k ? 'is-active' : ''}`} onClick={() => set({ view: k === 'open' ? null : k, page: null }, true)}>
            {l}{counts[k] && k !== 'all' ? <span className="ui-tab-count tabular-nums">{counts[k]}</span> : null}
          </button>
        ))}
        {tabIndicator}
      </div>
      <DataTable
        label="Offers"
        columns={columns}
        rows={shown}
        total={rows.length}
        page={page}
        pageSize={size}
        noun="offers"
        onPage={(n) => set({ page: n > 1 ? n : null }, true)}
        onPageSize={(n) => set({ size: n === 25 ? null : n, page: null })}
        onRowClick={(o) => open(o)}
        loading={req.loading}
        refreshing={req.refreshing}
        rowActions={(o) => [
          o.employeeId ? { key: 'record', label: 'Open their record', onSelect: () => open(o) } : null,
          o.candidateId ? { key: 'candidate', label: 'Open the candidate', onSelect: () => open(o) } : null,
          canWithdraw && o.status === 'SENT' ? { key: 'withdraw', label: 'Withdraw', danger: true, onSelect: () => withdraw(o) } : null,
        ].filter(Boolean)}
        card={(o) => (
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{o.name}</span>{status(o)}</span>
            <span className="block truncate ui-caption">{[o.designation, rupees(o.annualCtc)].filter(Boolean).join(' · ')}</span>
            <span className="block truncate ui-caption tabular-nums">Sent {sentOn(o)}{when(o) ? ` · ${when(o)}` : ''}</span>
          </span>
        )}
        toolbar={<SearchField value={p.q || ''} onSearch={(v) => set({ q: v || null, page: null })} placeholder="Search name, designation or e-mail" label="Search offers" className="w-full sm:w-72" />}
        empty={req.error ? <ErrorState error={req.error} onRetry={req.reload} />
          : q ? <EmptyState kind="filtered" title="Nobody matches" onClearFilters={() => set({ q: null, page: null })} />
            : <EmptyState icon={FileText} title={view === 'open' ? 'No offer is waiting for an answer' : view === 'accepted' ? 'No offer accepted yet' : view === 'closed' ? 'Nothing declined or withdrawn' : 'No offers sent yet'} description={view === 'open' || view === 'all' ? 'Send one from a joiner’s record: More → Send an offer.' : undefined} />}
      />
    </div>
  );
}
