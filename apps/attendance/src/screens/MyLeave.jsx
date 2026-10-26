import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { LEAVE_STATUS, applyLeave, cancelMyLeave, explainMyLeave, getMyLeave } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';
import LeaveExplain from '../components/LeaveExplain';

/**
 * My leave (People → Time & Leave → My leave, and Attendance's own): one's
 * balances, what was asked for, and asking for more in a drawer that shows,
 * as the dates are picked, the days it takes, the dates it skips and why,
 * and the balance after (AUT-05) — the same preview the employee app shows.
 */
const BLANK = { leaveTypeId: '', fromDate: '', toDate: '', halfDay: '', reason: '' };
const STATUS_LABEL = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
const PRIVATE_LABEL = 'Private leave';
const daysText = (n) => (n === 0.5 ? 'half a day' : `${n} day${n === 1 ? '' : 's'}`);
const range = (from, to) => (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);
const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const NUMBER_WORD = ['', 'one', 'two', 'three', 'four'];
/** What a request would charge, without saving it (server: leave.ts `me/leave/preview`). */
const previewMyLeave = (body) => apiFetch(`/orgs/${encodeURIComponent(platformOrgId() || '')}/attendance/me/leave/preview`, { method: 'POST', body, skipWarehouseHeader: true });

export default function MyLeave() {
  /* null asks the server for the leave period today falls in; its answer names the year. */
  const [year, setYear] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  /* No employee file behind this sign-in is a state, not a failure: retrying will not change it. */
  const [unlinked, setUnlinked] = useState(false);
  const [asking, setAsking] = useState(false);
  const [explaining, setExplaining] = useState(null);
  const shownYear = year ?? me?.year;
  const explainLoad = useCallback(() => explainMyLeave(explaining, shownYear), [explaining, shownYear]);

  const load = useCallback(() => {
    getMyLeave(year ?? undefined)
      .then((d) => {
        setMe(d);
        setError('');
      })
      .catch((e) => {
        if (e?.status === 404) { setUnlinked(true); return; }
        setError(String(e?.message || 'Could not load your leave.'));
      });
  }, [year]);
  useEffect(() => {
    load();
  }, [load]);

  const cancel = async (r) => {
    const ok = await confirmDialog({ title: 'Cancel this leave?', message: `${r.leaveTypeName}, ${range(r.fromDate, r.toDate)}`, confirmLabel: 'Yes, cancel it' });
    if (!ok) return;
    try {
      await cancelMyLeave(r.id);
      notify.success('Cancelled.');
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not cancelled.'));
    }
  };

  const header = (
    <PageHeader
      title="My leave"
      actions={me ? <>
        <div className="inline-flex items-center gap-1" role="group" aria-label="Leave period">
          <button type="button" className="ui-icon-btn" onClick={() => setYear(shownYear - 1)} aria-label="Previous leave period"><ChevronLeft size={16} aria-hidden="true" /></button>
          <span className="min-w-[4ch] text-center tabular-nums">{shownYear}</span>
          <button type="button" className="ui-icon-btn" onClick={() => setYear(shownYear + 1)} aria-label="Next leave period"><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
        {me.types.length ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAsking(true)}><Plus size={16} aria-hidden="true" /> Ask for leave</button> : null}
      </> : null}
    />
  );

  if (unlinked) return <div className="space-y-6">{header}<EmptyState title="No employee file is linked to your sign-in" description="HR links your sign-in on your employee record." /></div>;
  if (error && !me) return <div className="space-y-6">{header}<LoadFailed message={error} onRetry={load} /></div>;
  if (!me) return <div className="space-y-6" aria-busy="true">{header}<SkeletonCard lines={6} /></div>;

  const columns = [
    { key: 'dates', label: 'Dates', always: true, render: (r) => (
      <span className="tabular-nums whitespace-nowrap">{range(r.fromDate, r.toDate)}{r.halfDay ? <span className="ui-caption block">{r.halfDay === 'FIRST' ? 'First half' : 'Second half'}</span> : null}</span>
    ) },
    { key: 'type', label: 'Leave', render: (r) => r.leaveTypeName },
    { key: 'days', label: 'Days', align: 'right', render: (r) => <span className="tabular-nums">{r.days}</span> },
    { key: 'reason', label: 'Reason', render: (r) => (r.reasonHidden || r.leaveTypeName === PRIVATE_LABEL ? '' : r.reason || '') },
    { key: 'status', label: 'Status', render: (r) => (
      <span className="inline-flex flex-col items-start gap-0.5">
        <span className={`ui-pill ${LEAVE_STATUS[r.status] || 'ui-pill-neutral'}`}>{STATUS_LABEL[r.status] || r.status}</span>
        {r.status === 'REJECTED' && r.reviewNote ? <span className="ui-caption whitespace-normal">{r.reviewNote}</span> : null}
      </span>
    ) },
  ];
  const cancellable = (r) => r.status === 'PENDING' || (r.status === 'APPROVED' && r.fromDate > me.today);

  return (
    <div className="space-y-6">
      {header}
      {me.types.length ? (
        <div className="ui-metric-strip" role="list" aria-label="Balances">
          {me.types.map((t) => (
            <div key={t.id} role="listitem">
              {t.isPaid ? (
                <button type="button" className="ui-metric" onClick={() => setExplaining(t.id)} aria-label={`${t.name}: ${t.available} of ${t.allocated} left. How is this worked out?`}>
                  <span>
                    <span className="ui-metric-value tabular-nums">{t.available}<span className="ui-caption"> of {t.allocated}</span></span>
                    <span className="ui-metric-label">{t.name}{t.pending ? <span className="tabular-nums">, {t.pending} waiting</span> : null}</span>
                  </span>
                </button>
              ) : (
                <div className="ui-metric">
                  <span>
                    <span className="ui-metric-value tabular-nums">{t.used}<span className="ui-caption"> taken</span></span>
                    <span className="ui-metric-label">{t.name}, unpaid</span>
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No leave types yet" description="HR sets them up in Leave Policy." />
      )}

      <DataTable
        label="My leave requests"
        columns={columns}
        rows={me.requests}
        total={me.requests.length}
        noun="requests"
        rowActions={(r) => [cancellable(r) ? { key: 'cancel', label: 'Cancel', danger: true, onSelect: () => cancel(r) } : null]}
        card={(r) => (
          <span className="min-w-0">
            <span className="flex items-center justify-between gap-2"><span className="truncate">{r.leaveTypeName} · {daysText(r.days)}</span><span className={`ui-pill ${LEAVE_STATUS[r.status] || 'ui-pill-neutral'}`}>{STATUS_LABEL[r.status] || r.status}</span></span>
            <span className="block truncate ui-caption tabular-nums">{range(r.fromDate, r.toDate)}</span>
            {r.status === 'REJECTED' && r.reviewNote ? <span className="block ui-caption">{r.reviewNote}</span> : null}
          </span>
        )}
        empty={<EmptyState title="Nothing asked for in this leave period" />}
      />

      {asking ? <AskLeave types={me.types} onClose={() => setAsking(false)} onDone={() => { setAsking(false); load(); }} /> : null}
      <LeaveExplain open={Boolean(explaining)} onClose={() => setExplaining(null)} load={explainLoad} />
    </div>
  );
}

/** The days a request takes, the dates it skips and why, the balance after, and anything stopping it. */
function LeavePreview({ preview, checking }) {
  if (!preview) return checking ? <p className="text-sm ui-muted" role="status">Working out the days…</p> : null;
  const parts = preview.parts || [];
  const saved = parts.filter((p) => p.days > 0);
  const skipped = parts.flatMap((p) => p.dates || []).filter((d) => d.why);
  return (
    <section className="space-y-2 text-sm" aria-live="polite">
      {preview.total ? (
        <p>
          <span className="font-medium tabular-nums">{daysText(preview.total)}</span>
          {preview.type?.isPaid === false ? ', unpaid' : ''}
          {saved.length === 1 && saved[0].balance?.after != null ? <> · <span className="tabular-nums">{saved[0].balance.after}</span> left after this</> : null}
        </p>
      ) : null}
      {preview.split && saved.length > 1 ? (
        <div className="space-y-1">
          <p>This crosses the end of the leave period, so it is saved as {NUMBER_WORD[saved.length] || saved.length} requests, one per leave period:</p>
          <ul className="space-y-0.5">
            {saved.map((p) => <li key={p.from} className="tabular-nums">{p.label}: {daysText(p.days)}{p.balance?.after != null ? `, ${p.balance.after} left after this` : ''}</li>)}
          </ul>
        </div>
      ) : null}
      {skipped.length ? (
        <ul className="space-y-0.5 ui-muted" aria-label="Dates not counted">
          {skipped.map((d) => <li key={d.date}><span className="tabular-nums">{dayLabel(d.date)}</span> — {d.why}</li>)}
        </ul>
      ) : null}
      {(preview.problems || []).map((x) => <p key={x.code + x.message} className="ui-text-neg" role="alert">{x.message}</p>)}
    </section>
  );
}

function AskLeave({ types, onClose, onDone }) {
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [got, setGot] = useState(null);
  const set = (k, v) => setForm((f) => ({
    ...f,
    [k]: v,
    ...(k === 'fromDate' && v && f.toDate && f.toDate < v ? { toDate: v } : {}),
    ...(k === 'leaveTypeId' ? { halfDay: '' } : {}),
  }));
  const oneDay = Boolean(form.fromDate) && (!form.toDate || form.toDate === form.fromDate);

  /* The preview follows the form; only the answer for the dates on screen counts. */
  const key = form.leaveTypeId && form.fromDate
    ? JSON.stringify({ leaveTypeId: form.leaveTypeId, fromDate: form.fromDate, toDate: form.toDate || form.fromDate, halfDay: oneDay && form.halfDay ? form.halfDay : null })
    : '';
  useEffect(() => {
    if (!key) return undefined;
    let off = false;
    const timer = setTimeout(() => {
      previewMyLeave(JSON.parse(key))
        .then((p) => { if (!off) setGot({ ...p, key }); })
        .catch((e) => { if (!off) setGot({ key, ok: false, total: 0, parts: [], problems: [{ code: 'INPUT', message: String(e?.message || 'The days could not be worked out.') }] }); });
    }, 300);
    return () => { off = true; clearTimeout(timer); };
  }, [key]);
  const preview = got && got.key === key ? got : null;
  /* Whether the type allows a half day or is private comes with the preview. */
  const type = got?.type && got.type.id === form.leaveTypeId ? got.type : null;
  const halfDayOffered = oneDay && Boolean(type?.allowHalfDay);
  const reasonNeeded = !type?.isPrivate;
  const reasonOk = !reasonNeeded || form.reason.trim().length >= 3;
  const blocked = !key || !preview || Boolean(preview.problems?.length) || !reasonOk;
  const dirty = Boolean(form.leaveTypeId || form.fromDate || form.reason);

  const save = async (e) => {
    e?.preventDefault();
    if (blocked || saving) return;
    setSaving(true);
    try {
      const r = await applyLeave({
        leaveTypeId: form.leaveTypeId,
        fromDate: form.fromDate,
        toDate: form.toDate || form.fromDate,
        halfDay: halfDayOffered && form.halfDay ? form.halfDay : null,
        reason: form.reason.trim(),
        ...(preview.split ? { split: true } : {}),
      });
      const sent = r.requests || [r.request];
      notify.success(sent.length > 1 ? `Asked for ${daysText(preview.total)} of ${r.request.leaveTypeName}, as ${NUMBER_WORD[sent.length] || sent.length} requests.` : `Asked for ${daysText(r.request.days)} of ${r.request.leaveTypeName}.`);
      onDone();
    } catch (err) {
      notify.error(String(err?.message || 'Not sent.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      dirty={dirty}
      widthClass="w-[min(36rem,96vw)]"
      title="Ask for leave"
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="ask-leave" className="ui-btn ui-btn-primary" disabled={blocked || saving}>{saving ? 'Sending…' : 'Send'}</button>
      </>}
    >
      <form id="ask-leave" onSubmit={save} className="space-y-4">
        <div>
          <PopupSelect showValueSubtext={false} label="Leave type *" value={form.leaveTypeId} onChange={(v) => set('leaveTypeId', v || '')} placeholder="Choose…"
            options={types.map((t) => ({ value: t.id, label: t.isPaid ? `${t.name}, ${t.available} left` : `${t.name}, unpaid` }))} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="ui-label" htmlFor="ml-from">First day *</label><DatePicker id="ml-from" value={form.fromDate} onChange={(v) => set('fromDate', v || '')} /></div>
          <div><label className="ui-label" htmlFor="ml-to">Last day</label><DatePicker id="ml-to" value={form.toDate} min={form.fromDate} onChange={(v) => set('toDate', v || '')} /></div>
        </div>
        {halfDayOffered ? (
          <div>
            <PopupSelect showValueSubtext={false} label="How much of the day" value={form.halfDay || 'WHOLE'} onChange={(v) => set('halfDay', v === 'WHOLE' ? '' : v || '')}
              options={[{ value: 'WHOLE', label: 'Whole day' }, { value: 'FIRST', label: 'First half' }, { value: 'SECOND', label: 'Second half' }]} />
          </div>
        ) : null}
        <label className="block">
          <span className="ui-label">{reasonNeeded ? 'Reason *' : 'Reason'}</span>
          <input className="ui-input w-full" maxLength={500} value={form.reason} onChange={(e) => set('reason', e.target.value)} />
        </label>
        <LeavePreview preview={preview} checking={Boolean(key) && !preview} />
      </form>
    </Drawer>
  );
}
