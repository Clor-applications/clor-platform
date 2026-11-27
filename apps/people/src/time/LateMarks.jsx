import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { errorWords, enumWords } from '@ui/utils/errorWords';
import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader, Button } from '@ui/components/ui/Primitives';
import { CountLine } from '@ui/components/ui/CountLine';
import { Avatar } from '@ui/personnel/Employees';
import { FilterTabs } from '@ui/components/list/ListHeader';
import ReviewTable from '@ui/components/ui/ReviewTable';
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
  const [view, setView] = useState('ALL');
  const visibleRows = view === 'ALL' ? rows : rows.filter(row => row.status === view);
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
      notify.error((errorWords(e, 'apply the late marks').startsWith('Could not') ? 'Late marks were not applied. No leave or pay was changed. Try again.' : errorWords(e, 'apply the late marks')));
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
      notify.success(r.status === 'WAIVED' ? `Waiver for ${r.name} taken back.` : r.status === 'APPLIED' && r.fromLeave.length ? `Penalty undone; ${leaveText(r.fromLeave)} is back in ${r.name}’s balance.` : `Penalty for ${r.name} undone.`);
      setOpen(null);
      req.reload();
    } catch (e) {
      notify.error(errorWords(e, 'finish that'));
    } finally {
      setBusy('');
    }
  };

  const due = rows.filter((r) => r.status === 'DUE').length;
  const statusTabs = [{ key: 'ALL', label: 'All' }, ...Object.entries(STATUS)
    .filter(([key]) => key === view || rows.some(row => row.status === key))
    .map(([key, [label]]) => ({ key, label }))];
  const stepRule = d?.rules?.cutMode === 'HALF_DAY_PER_N';
  const columns = [
    { key: 'name', label: 'Employee', always: true, render: (r) => (
      <span className="late-mark-person">
        <Avatar person={{ name: r.name, photoUrl: r.photoUrl }} size={28} />
        <span><strong>{r.name}</strong><small>{[r.code, r.department].filter(Boolean).join(' · ')}</small></span>
      </span>
    ) },
    { key: 'marks', label: 'Attendance marks', render: (r) => (
      <span className="late-mark-detail">{r.lateMarks} late{d?.rules?.early?.on ? ` · ${r.earlyMarks} early` : ''}
      </span>
    ) },
    ...(stepRule ? [{ key: 'missed', label: 'Time missed', render: (r) => (
      <span className="tabular-nums">{r.timeMissedMinutes ? `${minutesText(r.timeMissedMinutes)} · ${dayAmount(r.timeMissedDays)}` : '—'}</span>
    ) }] : []),
    { key: 'impact', label: 'Penalty', render: (r) => (
      <span className="late-mark-detail">
        {r.status === 'WAIVED' ? 'No deduction' : r.days ? dayAmount(r.days) : 'None'}
        {r.status !== 'WAIVED' && r.fromLeave?.length > 0 && <small>{leaveText(r.fromLeave)} from leave</small>}
        {r.status !== 'WAIVED' && r.lossOfPayDays > 0 && <small>{dayAmount(r.lossOfPayDays)} unpaid</small>}
      </span>
    ) },
    { key: 'status', label: 'Status', render: (r) => <span className={`ui-pill ui-pill-${STATUS[r.status]?.[1] || 'neutral'}`}>{STATUS[r.status]?.[0] || enumWords(r.status)}</span> },
    { key: 'act', label: 'Action', align: 'right', render: (r) => (
      <span className="inline-flex gap-1 whitespace-nowrap">
        {r.status === 'DUE' ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy === r.employeeId} onClick={() => setWaiving(r)}>Waive</button> : null}
        {r.status === 'WAIVED' || (r.status === 'APPLIED' && d?.canApply) ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy === r.employeeId} onClick={() => undo(r)}>{r.status === 'WAIVED' ? 'Undo waiver' : 'Undo penalty'}</button> : null}
      </span>
    ) },
  ];

  return (
    <div className="late-mark-page space-y-3">
      <PageHeader title="Late marks" summary={d?.rules?.on && <CountLine label="Monthly late marks" items={[
        { label: d.totals.people === 1 ? 'Employee' : 'Employees', value: d.totals.people },
        { label: 'Late marks', value: rows.reduce((n, r) => n + Number(r.lateMarks || 0), 0) },
        { label: 'To apply', value: due, tone: 'warn' },
        { label: 'Waived', value: d.totals.waived },
        { label: 'From leave', value: dayAmount(d.totals.fromLeaveDays) },
        { label: 'Unpaid', value: dayAmount(d.totals.lossOfPayDays) },
      ]} />} actions={<>
        <div className="late-mark-month" role="group" aria-label="Month">
          <button type="button" className="ui-icon-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
          <span className="min-w-28 text-center font-semibold" aria-live="polite">{monthTitle(month)}</span>
          <button type="button" className="ui-icon-btn" aria-label="Next month" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
        {d?.canApply && d?.ended && due > 0 && <Button variant="primary" loading={busy === 'apply'} onClick={apply}>
          Apply {monthTitle(month).split(' ')[0]} penalties
        </Button>}
      </>} />
      {d && !d.rules?.on && !rows.length ? (
        <EmptyState title="Late marks cost nothing now" description="Switch the rule on in Settings, Attendance rules." />
      ) : (
        <ReviewTable key={month}
          label={`Late marks in ${monthTitle(month)}`}
          columns={columns}
          rows={visibleRows}
          tabs={<FilterTabs label="Penalty status" appearance="underline" tabs={statusTabs} value={view} onChange={setView} />}
          rowKey={(r) => r.employeeId}
          total={visibleRows.length}
          noun="people"
          loading={req.loading}
          refreshing={req.refreshing}
          onRowClick={(r) => setOpen(r)}
          card={(r) => (
            <span className="block min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate">{r.name}</span><span className={`ui-pill ui-pill-${STATUS[r.status]?.[1] || 'neutral'}`}>{STATUS[r.status]?.[0]}</span></span>
              <span className="block ui-caption tabular-nums">{r.lateMarks} late{d?.rules?.early?.on ? `, ${r.earlyMarks} early` : ''}{r.status === 'WAIVED' ? ' · No deduction' : r.days ? ` · ${dayAmount(r.days)} penalty` : ''}{r.status !== 'WAIVED' && r.lossOfPayDays ? `, ${dayAmount(r.lossOfPayDays)} unpaid` : ''}</span>
            </span>
          )}
          empty={req.error ? <ErrorState error={req.error} onRetry={req.reload} /> : <EmptyState title={view === 'ALL' ? `No late marks in ${monthTitle(month)}` : `No employees marked “${STATUS[view][0]}”`} kind={view === 'ALL' ? 'new' : 'filtered'} onClearFilters={() => setView('ALL')} />}
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
      footer={<div className="flex flex-wrap justify-end gap-2">
        {row.status === 'DUE' ? <button type="button" className="ui-btn ui-btn-secondary" onClick={onWaive}>Waive</button> : null}
        {canUndo ? <button type="button" className="ui-btn ui-btn-secondary" onClick={onUndo}>{row.status === 'WAIVED' ? 'Undo waiver' : 'Undo penalty'}</button> : null}
      </div>}
    >
      <div className="space-y-4 text-sm">
        <dl className="grid gap-3 grid-cols-2">
          <div><dt className="ui-t-label">Penalty</dt><dd className="tabular-nums">{row.status === 'WAIVED' ? 'No deduction' : dayAmount(row.days)}</dd></div>
          <div><dt className="ui-t-label">Unpaid</dt><dd className="tabular-nums">{row.status === 'WAIVED' || !row.lossOfPayDays ? '0 days' : dayAmount(row.lossOfPayDays)}</dd></div>
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

const waiverSchema = z.object({ reason: z.string().trim().min(3, 'Enter at least 3 characters.').max(500) });

function WaiveDrawer({ row, month, onClose, onDone }) {
  const { control, handleSubmit, formState: { isDirty, isValid } } = useForm({ defaultValues: { reason: '' }, mode: 'onTouched', resolver: zodResolver(waiverSchema) });
  const [busy, setBusy] = useState(false);
  const own = useSuggestions('requestReason');
  const save = async ({ reason }) => {
    setBusy(true);
    try {
      await waivePenalty(row.employeeId, month, reason);
      notify.success(`${row.name}: waived.`);
      onDone();
    } catch (err) {
      notify.error(errorWords(err, 'waive the penalty'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open onClose={onClose} dirty={isDirty} title={`Waive ${dayAmount(row.days)} for ${row.name}`} widthClass="w-[min(32rem,96vw)]"
      footer={<div className="flex justify-end gap-2"><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><Button variant="primary" loading={busy} disabled={!isValid || busy} type="submit" form="waive-form">Waive</Button></div>}
    >
      <form id="waive-form" onSubmit={handleSubmit(save)} className="space-y-3">
        <label className="block">
          <span className="ui-label">Why</span>
          <Controller control={control} name="reason" render={({ field }) => <SuggestInput ref={field.ref} value={field.value} onBlur={field.onBlur} onChange={field.onChange} suggestions={[...REASONS, ...own]} maxLength={500} required autoFocus />} />
        </label>
        <p className="ui-caption">{row.name} and the audit trail keep the reason.</p>
      </form>
    </Drawer>
  );
}
