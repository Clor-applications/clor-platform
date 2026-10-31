import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SuggestInput from '@ui/components/ui/SuggestInput';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { useSuggestions } from '@ui/timeOff/suggestions';

import { applyPenalties, getLateMarks, undoPenalty, waivePenalty } from './api';
import { dayAmount, istToday, lastMonth, minutesText, monthTitle, shiftMonth, shortDay } from './shared';

/**
 * Time → Late marks (WORKFLOW-GAP-RESEARCH-2026-10-30 4.4): who the company's late-mark rule hits in a
 * month, what it costs, and from where. A manager sees their team and waives with a reason; HR waives
 * for anyone and, once the month has ended, applies it: leave is taken in the rule's order and the
 * rest is loss of pay in payable days. Nothing is taken silently: until applied or waived, the unpaid
 * part already shows in payable days as "late penalty".
 */
const STATUS = { DUE: ['To apply', 'warn'], WAIVED: ['Waived', 'neutral'], APPLIED: ['Applied', 'pos'], NONE: ['No penalty', 'neutral'] };
const REASONS = ['Bus or train was late', 'Power cut at home', 'Medical appointment, told the manager', 'Reader was not working', 'Agreed with the manager beforehand'];
const leaveText = (parts) => (parts?.length ? parts.map((p) => `${dayAmount(p.days)} ${p.name}`).join(', ') : '—');

export default function LateMarks({ params = {}, updateParams }) {
  const month = /^\d{4}-\d{2}$/.test(String(params?.month || '')) ? params.month : lastMonth();
  const setMonth = (m) => updateParams?.({ month: m === lastMonth() ? null : m }, { push: true });
  const req = useRequest(() => getLateMarks(month), [month]);
  const d = req.data;
  const rows = useMemo(() => d?.rows || [], [d]);
  const [open, setOpen] = useState(null);
  const [waiving, setWaiving] = useState(null);
  const [busy, setBusy] = useState('');
  const thisMonth = istToday().slice(0, 7);

  const apply = async () => {
    const due = rows.filter((r) => r.status === 'DUE');
    const ok = await confirmDialog({
      title: `Apply late marks for ${monthTitle(month)}?`,
      message: `${due.length} ${due.length === 1 ? 'person' : 'people'}: ${dayAmount(due.reduce((s, r) => s + r.fromLeave.reduce((x, p) => x + p.days, 0), 0))} from leave and ${dayAmount(due.reduce((s, r) => s + r.lossOfPayDays, 0))} unpaid. Each person can still be undone while the month is open.`,
      confirmLabel: 'Apply',
    });
    if (!ok) return;
    setBusy('apply');
    try {
      const out = await applyPenalties(month);
      notify.success(`${out.applied} applied${out.skipped?.length ? `; ${out.skipped.length} skipped: ${out.skipped[0].why}` : ''}.`);
      req.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not applied.'));
    } finally {
      setBusy('');
    }
  };
  const undo = async (r) => {
    const ok = await confirmDialog({ title: r.status === 'WAIVED' ? `Take back the waiver for ${r.name}?` : `Undo ${r.name}’s penalty?`, message: r.status === 'APPLIED' && r.fromLeave.length ? `${leaveText(r.fromLeave)} goes back to their balance.` : 'The rule decides the month again.', confirmLabel: r.status === 'WAIVED' ? 'Take back' : 'Undo' });
    if (!ok) return;
    setBusy(r.employeeId);
    try {
      await undoPenalty(r.employeeId, month);
      notify.success('Done.');
      setOpen(null);
      req.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      setBusy('');
    }
  };

  const due = rows.filter((r) => r.status === 'DUE').length;
  const stepRule = d?.rules?.cutMode === 'HALF_DAY_PER_N';
  const columns = [
    { key: 'name', label: 'Employee', always: true, render: (r) => <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="block truncate ui-caption">{[r.code, r.department].filter(Boolean).join(' · ')}</span></span> },
    { key: 'late', label: 'Late', align: 'right', render: (r) => <span className="tabular-nums">{r.lateMarks}</span> },
    ...(d?.rules?.early?.on ? [{ key: 'early', label: 'Early', align: 'right', render: (r) => <span className="tabular-nums">{r.earlyMarks}</span> }] : []),
    { key: 'days', label: 'Penalty', align: 'right', render: (r) => <span className="tabular-nums">{dayAmount(r.days)}</span> },
    /* Every N marks can cut more than the time missed (Code on Wages s.20): each person's two figures side by side. */
    ...(stepRule ? [{ key: 'missed', label: 'Time missed', align: 'right', render: (r) => <span className={`tabular-nums ${r.days > r.timeMissedDays ? 'font-medium' : ''}`}>{r.timeMissedMinutes ? `${minutesText(r.timeMissedMinutes)} · ${dayAmount(r.timeMissedDays)}` : '—'}</span> }] : []),
    { key: 'leave', label: 'From leave', render: (r) => <span className="tabular-nums">{r.status === 'WAIVED' ? '—' : leaveText(r.fromLeave)}</span> },
    { key: 'lop', label: 'Unpaid', align: 'right', render: (r) => <span className="tabular-nums font-medium">{dayAmount(r.lossOfPayDays)}</span> },
    { key: 'status', label: 'Status', render: (r) => <span className={`ui-pill ui-pill-${STATUS[r.status]?.[1] || 'neutral'}`}>{STATUS[r.status]?.[0] || r.status}</span> },
    { key: 'act', label: '', align: 'right', render: (r) => (
      <span className="inline-flex gap-1 whitespace-nowrap">
        {r.status === 'DUE' ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy === r.employeeId} onClick={() => setWaiving(r)}>Waive</button> : null}
        {r.status === 'WAIVED' || (r.status === 'APPLIED' && d?.canApply) ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy === r.employeeId} onClick={() => undo(r)}>{r.status === 'WAIVED' ? 'Take back' : 'Undo'}</button> : null}
      </span>
    ) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[{ label: 'People' }, { label: 'Time' }]}
        title="Late marks"
        actions={d?.canApply && d?.ended && due ? <button type="button" className="ui-btn ui-btn-primary" disabled={busy === 'apply'} onClick={apply}>{busy === 'apply' ? 'Applying…' : `Apply ${monthTitle(month).split(' ')[0]}`}</button> : null}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1" role="group" aria-label="Month">
          <button type="button" className="ui-icon-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
          <span className="min-w-36 text-center font-medium" aria-live="polite">{monthTitle(month)}</span>
          <button type="button" className="ui-icon-btn" aria-label="Next month" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
        {d && d.rules?.on ? <p className="text-sm tabular-nums">{d.totals.people} {d.totals.people === 1 ? 'person' : 'people'} · {dayAmount(d.totals.fromLeaveDays)} from leave · {dayAmount(d.totals.lossOfPayDays)} unpaid{d.totals.waived ? ` · ${d.totals.waived} waived` : ''}</p> : null}
      </div>
      {d && !d.rules?.on && !rows.length ? (
        <EmptyState title="Late marks cost nothing now" description="Switch the rule on in Settings, Attendance rules." />
      ) : (
        <DataTable
          label={`Late marks in ${monthTitle(month)}`}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.employeeId}
          total={rows.length}
          noun="people"
          loading={req.loading}
          refreshing={req.refreshing}
          onRowClick={(r) => setOpen(r)}
          card={(r) => (
            <span className="block min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.name}</span><span className={`ui-pill ui-pill-${STATUS[r.status]?.[1] || 'neutral'}`}>{STATUS[r.status]?.[0]}</span></span>
              <span className="block ui-caption tabular-nums">{r.lateMarks} late{d?.rules?.early?.on ? `, ${r.earlyMarks} early` : ''}{r.days ? ` · ${dayAmount(r.days)}` : ''}{r.lossOfPayDays ? `, ${dayAmount(r.lossOfPayDays)} unpaid` : ''}</span>            </span>
          )}
          empty={req.error ? <ErrorState error={req.error} onRetry={req.reload} /> : <EmptyState title={`No late marks in ${monthTitle(month)}`} />}
        />
      )}
      {d?.ended === false && rows.some((r) => r.status === 'DUE') ? <p className="ui-caption">The month is still running. It can be applied once it ends.</p> : null}
      {open ? <MarksDrawer row={open} month={month} early={Boolean(d?.rules?.early?.on)} onClose={() => setOpen(null)} onWaive={() => { setWaiving(open); setOpen(null); }} onUndo={() => undo(open)} canUndo={open.status === 'WAIVED' || (open.status === 'APPLIED' && d?.canApply)} /> : null}
      {waiving ? <WaiveDrawer row={waiving} month={month} onClose={() => setWaiving(null)} onDone={() => { setWaiving(null); req.reload(); }} /> : null}
    </div>
  );
}

function MarksDrawer({ row, month, early, onClose, onWaive, onUndo, canUndo }) {
  return (
    <Drawer open onClose={onClose} title={`${row.name}, ${monthTitle(month)}`} widthClass="w-[min(32rem,96vw)]"
      actions={<>
        {row.status === 'DUE' ? <button type="button" className="ui-btn ui-btn-secondary" onClick={onWaive}>Waive</button> : null}
        {canUndo ? <button type="button" className="ui-btn ui-btn-secondary" onClick={onUndo}>{row.status === 'WAIVED' ? 'Take back waiver' : 'Undo'}</button> : null}
      </>}
    >
      <div className="space-y-4 text-sm">
        <dl className="grid gap-3 grid-cols-2">
          <div><dt className="ui-t-label">Penalty</dt><dd className="tabular-nums">{dayAmount(row.days)}</dd></div>
          <div><dt className="ui-t-label">Unpaid</dt><dd className="tabular-nums">{dayAmount(row.lossOfPayDays)}</dd></div>
          {row.timeMissedMinutes ? <div className="col-span-2"><dt className="ui-t-label">Time missed</dt><dd className="tabular-nums">{minutesText(row.timeMissedMinutes)} · {dayAmount(row.timeMissedDays)}</dd></div> : null}
          <div className="col-span-2"><dt className="ui-t-label">From leave</dt><dd>{row.status === 'WAIVED' ? '—' : leaveText(row.fromLeave)}</dd></div>
          {row.decision?.reason ? <div className="col-span-2"><dt className="ui-t-label">Waived because</dt><dd>{row.decision.reason}{row.decidedBy ? ` (${row.decidedBy})` : ''}</dd></div> : null}
        </dl>
        <div>
          <h3 className="ui-t-label mb-1">Late</h3>
          {row.lateDates?.length ? <ul className="flex flex-wrap gap-1.5">{row.lateDates.map((x) => <li key={x} className="ui-pill ui-pill-neutral tabular-nums">{shortDay(x)}</li>)}</ul> : <p className="ui-caption">None</p>}
        </div>
        {early ? (
          <div>
            <h3 className="ui-t-label mb-1">Early</h3>
            {row.earlyDates?.length ? <ul className="flex flex-wrap gap-1.5">{row.earlyDates.map((x) => <li key={x} className="ui-pill ui-pill-neutral tabular-nums">{shortDay(x)}</li>)}</ul> : <p className="ui-caption">None</p>}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

function WaiveDrawer({ row, month, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const own = useSuggestions('requestReason');
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await waivePenalty(row.employeeId, month, reason);
      notify.success(`${row.name}: waived.`);
      onDone();
    } catch (err) {
      notify.error(String(err?.message || 'Not waived.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open onClose={onClose} dirty={Boolean(reason)} title={`Waive ${dayAmount(row.days)} for ${row.name}`} widthClass="w-[min(32rem,96vw)]"
      footer={<div className="flex justify-end gap-2"><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="waive-form" className="ui-btn ui-btn-primary" disabled={busy || reason.trim().length < 3}>{busy ? 'Waiving…' : 'Waive'}</button></div>}
    >
      <form id="waive-form" onSubmit={save} className="space-y-3">
        <label className="block">
          <span className="ui-label">Why</span>
          <SuggestInput value={reason} onChange={setReason} suggestions={[...REASONS, ...own]} maxLength={500} required autoFocus />
        </label>
        <p className="ui-caption">{row.name} and the audit trail keep the reason.</p>
      </form>
    </Drawer>
  );
}
