import React, { useMemo, useRef, useState } from 'react';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { formatDate } from '@ui/components/ui/DatePicker';
import { Avatar } from '@ui/personnel/Employees';
import { cancelSwap, listSwaps } from '../api/requests';

/*
 * Shift swaps (FEATURE-UI-AUDIT gap 24): two people swap shifts on a day or a
 * few, asked and accepted in the employee app, approved by the manager in
 * Approvals. HR sees every swap and a manager their team's; HR may cancel an
 * approved one before it starts, which puts the usual shifts back.
 */
const SWAP_STATUS = { ASKED: 'Waiting for the colleague', DECLINED: 'Declined', WAITING: 'Waiting for approval', APPROVED: 'Approved', REJECTED: 'Not approved', WITHDRAWN: 'Withdrawn', CANCELLED: 'Cancelled' };
const SWAP_TONE = { ASKED: 'warn', DECLINED: 'neutral', WAITING: 'warn', APPROVED: 'pos', REJECTED: 'neg', WITHDRAWN: 'neutral', CANCELLED: 'neutral' };
const TABS = [['', 'All'], ['ASKED', 'With the colleague'], ['WAITING', 'For approval'], ['APPROVED', 'Approved']];
const day = (iso) => (iso ? formatDate(String(iso).slice(0, 10)) : '');
const range = (a, b) => (a === b ? day(a) : `${day(a)} – ${day(b)}`);
const shiftText = (s) => (s ? `${s.name}${s.startTime ? ` ${s.startTime}–${s.endTime}` : ''}` : '—');
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function Person({ p, size = 32 }) {
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      <Avatar person={{ name: p.name, photoUrl: p.photoUrl }} size={size} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{p.name || '—'}</span>
        {p.code ? <span className="block truncate ui-caption">{p.code}</span> : null}
      </span>
    </span>
  );
}

export default function ShiftSwaps({ params = {}, updateParams, openScreen }) {
  const p = params || {};
  const status = TABS.some(([k]) => k === p.status) ? p.status : '';
  const page = Math.max(1, Number(p.page || 1));
  const size = [25, 50, 100].includes(Number(p.size)) ? Number(p.size) : 25;
  const set = (patch, push = false) => updateParams?.(patch, { push });
  const req = useRequest(() => listSwaps(status || undefined), [status]);
  const rows = useMemo(() => req.data?.swaps || [], [req.data]);
  const [open, setOpen] = useState(null);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, status || 'all');

  const columns = [
    { key: 'asker', label: 'Asked by', always: true, render: (s) => <Person p={s.requester} /> },
    { key: 'with', label: 'Swaps with', render: (s) => <Person p={s.colleague} /> },
    { key: 'days', label: 'Days', render: (s) => <span className="tabular-nums whitespace-nowrap">{range(s.fromDate, s.toDate)}</span> },
    { key: 'shifts', label: 'Shifts', render: (s) => <span className="whitespace-nowrap">{s.days[0] ? `${s.days[0].requesterShift.name} ⇄ ${s.days[0].colleagueShift.name}` : '—'}</span> },
    { key: 'status', label: 'Status', render: (s) => <span className={`ui-pill ui-pill-${SWAP_TONE[s.status] || 'neutral'}`}>{SWAP_STATUS[s.status] || s.status}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: 'Time' }]} title="Shift swaps" />
      <DataTable
        tabs={(
          <div ref={tabsRef} role="tablist" aria-label="Shift swaps" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
            {TABS.map(([k, l]) => (
              <button key={k || 'all'} type="button" role="tab" aria-selected={status === k} data-key={k || 'all'} className={`ui-tab ${status === k ? 'is-active' : ''}`} onClick={() => set({ status: k || null, page: null }, true)}>{l}</button>
            ))}
            {tabIndicator}
          </div>
        )}
        label="Shift swaps"
        columns={columns}
        rows={rows.slice((page - 1) * size, page * size)}
        rowKey={(s) => s.id}
        total={rows.length}
        page={page}
        pageSize={size}
        noun="swaps"
        onPage={(n) => set({ page: n > 1 ? n : null }, true)}
        onPageSize={(n) => set({ size: n === 25 ? null : n, page: null })}
        onRowClick={(s) => setOpen(s)}
        loading={req.loading}
        refreshing={req.refreshing}
        card={(s) => (
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{s.requester.name} ⇄ {s.colleague.name}</span><span className={`ui-pill ui-pill-${SWAP_TONE[s.status] || 'neutral'}`}>{SWAP_STATUS[s.status] || s.status}</span></span>
            <span className="block truncate ui-caption tabular-nums">{range(s.fromDate, s.toDate)}{s.days[0] ? ` · ${s.days[0].requesterShift.name} ⇄ ${s.days[0].colleagueShift.name}` : ''}</span>
          </span>
        )}
        empty={req.error ? <ErrorState error={req.error} onRetry={req.reload} /> : status ? <EmptyState kind="filtered" title="None here" onClearFilters={() => set({ status: null, page: null })} /> : <EmptyState title="No shift swaps yet" description={`People ask a colleague on another shift from the employee app, for up to ${req.data?.rules?.maxDays || 7} days; the manager approves in Approvals.`} />}
      />
      {open ? <SwapDrawer swap={open} canCancel={Boolean(req.data?.canCancel)} onClose={() => setOpen(null)} onDone={() => { setOpen(null); req.reload(); }} openScreen={openScreen} /> : null}
    </div>
  );
}

function SwapDrawer({ swap, canCancel, onClose, onDone, openScreen }) {
  const [busy, setBusy] = useState(false);
  const cancellable = canCancel && swap.status === 'APPROVED' && swap.fromDate > istToday();
  const cancel = async () => {
    if (!(await confirmDialog({ title: 'Cancel this swap?', message: `${swap.requester.name} and ${swap.colleague.name} go back to their usual shifts on those days. Both are told.`, confirmLabel: 'Cancel the swap' }))) return;
    setBusy(true);
    try {
      await cancelSwap(swap.id);
      notify.success('Swap cancelled; the usual shifts apply.');
      onDone();
    } catch (e) {
      notify.error(String(e?.message || 'Not cancelled.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open onClose={onClose} title={`${swap.requester.name} ⇄ ${swap.colleague.name}`} widthClass="w-[min(36rem,96vw)]"
      actions={(
        <>
          {swap.status === 'WAITING' && openScreen ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => openScreen('approvals')}>Open in Approvals</button> : null}
          {cancellable ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Cancel swap'}</button> : null}
        </>
      )}
    >
      <div className="space-y-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="ui-t-label">Status</dt><dd><span className={`ui-pill ui-pill-${SWAP_TONE[swap.status] || 'neutral'}`}>{SWAP_STATUS[swap.status] || swap.status}</span></dd></div>
          <div><dt className="ui-t-label">Asked</dt><dd className="tabular-nums">{day(swap.createdAt)}</dd></div>
          {swap.reason ? <div className="sm:col-span-2"><dt className="ui-t-label">Why</dt><dd>{swap.reason}</dd></div> : null}
          {swap.colleagueNote ? <div className="sm:col-span-2"><dt className="ui-t-label">{swap.colleague.name} said</dt><dd>{swap.colleagueNote}</dd></div> : null}
          {swap.decisionNote || swap.closedNote ? <div className="sm:col-span-2"><dt className="ui-t-label">Note</dt><dd>{swap.closedNote || swap.decisionNote}</dd></div> : null}
        </dl>
        <table className="w-full text-sm" aria-label="Days">
          <thead>
            <tr className="text-left ui-t-label"><th className="py-1.5 pr-3 font-medium">Day</th><th className="py-1.5 pr-3 font-medium">{swap.requester.name} works</th><th className="py-1.5 font-medium">{swap.colleague.name} works</th></tr>
          </thead>
          <tbody>
            {swap.days.map((d) => (
              <tr key={d.date} className="border-t" style={{ borderColor: 'rgb(var(--border))' }}>
                <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{day(d.date)}</td>
                <td className="py-1.5 pr-3"><span className="ui-muted line-through">{d.requesterShift.name}</span> {shiftText(d.colleagueShift)}</td>
                <td className="py-1.5"><span className="ui-muted line-through">{d.colleagueShift.name}</span> {shiftText(d.requesterShift)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Drawer>
  );
}
