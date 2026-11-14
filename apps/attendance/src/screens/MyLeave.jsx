import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from '@ui/components/ui/lineIcons';

import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import { expiringWords } from '@ui/timeOff/expiring';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { LEAVE_STATUS, applyLeave, cancelMyLeave, editMyLeave, explainMyLeave, getMyLeave, getMyRestrictedHolidays, listHolidays, pickMyRestrictedHoliday, shortenMyLeave } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';
import LeaveExplain from '../components/LeaveExplain';
import LeaveDocumentField from '@ui/timeOff/LeaveDocumentField';
import HalfDayChoice, { HalfDayNote, halfDayBody, leaveSpan } from '@ui/timeOff/HalfDayChoice';
import { HoursChoice, PreviewNotes } from '@ui/timeOff/LeaveShape';
import { amountFigure, amountWords, hoursBetween, hoursBody, hoursReady, hoursText, hoursWords, isHourly } from '@ui/timeOff/partOfDay';
import { useCanActForSelf } from '@ui/timeOff/shared';
import { addDaysIso as addDays } from '@ui/utils/dates';
import { LeavePill } from '@ui/timeOff/Figures';
import { swatchOf } from '@ui/timeOff/api';
import './MyLeave.css';

/**
 * My leave (People → Time & Leave → My leave, and Attendance's own): one's
 * balances, what was asked for, and asking for more in a drawer that shows,
 * as the dates are picked, the days it takes, the dates it skips and why,
 * and the balance after (AUT-05) — the same preview the employee app shows.
 */
const BLANK = { leaveTypeId: '', fromDate: '', toDate: '', halfDay: '', startHalf: false, endHalf: false, fromTime: '', toTime: '', reason: '' };
const STATUS_LABEL = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
const PRIVATE_LABEL = 'Private leave';
const daysText = (n) => (n === 0.5 ? 'half a day' : `${n} day${n === 1 ? '' : 's'}`);
const range = (from, to) => (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);
const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const NUMBER_WORD = ['', 'one', 'two', 'three', 'four'];
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
/*
 * The company's own holidays still ahead (R&D PEOPLE-16 "Upcoming holidays"): only those for everyone, since a
 * branch's or an area's holidays need the person's place, which this screen does not have. The holiday list needs
 * holidays or leave view; without it the panel is left out.
 */
const loadUpcoming = (today) => {
  const y = Number(String(today).slice(0, 4));
  return Promise.resolve()
    .then(() => Promise.all([listHolidays(y), listHolidays(y + 1)]))
    .then(([a, b]) => [...(a || []), ...(b || [])].filter((h) => !h.branchId && !h.areaId && h.date >= today).sort((x, z) => x.date.localeCompare(z.date)).slice(0, 4))
    .catch(() => null);
};
/** What a request would charge, without saving it (server: leave.ts `me/leave/preview`). */
const previewMyLeave = (body) => apiFetch(`/orgs/${encodeURIComponent(platformOrgId() || '')}/attendance/me/leave/preview`, { method: 'POST', body, skipWarehouseHeader: true });
/**
 * The preview while a request of mine is being changed still sees the request
 * itself: an overlap with its own dates and a balance short by its own days
 * are not problems, and the balance after gets its own days back when the
 * type is unchanged. The server checks the rest on save.
 */
function ownPreview(p, request) {
  if (!p || !request) return p;
  const sameType = p.type?.id === request.leaveTypeId;
  const own = (x) => (x.code === 'OVERLAP' && String(x.message || '').includes(request.fromDate) && String(x.message || '').includes(request.toDate)) || (x.code === 'NO_BALANCE' && sameType);
  const parts = p.parts || [];
  return {
    ...p,
    problems: (p.problems || []).filter((x) => !own(x)),
    parts: sameType && parts.length === 1 ? parts.map((x) => (x.balance?.after == null ? x : { ...x, balance: { ...x.balance, after: Math.round((x.balance.after + request.days) * 100) / 100 } })) : parts,
  };
}

export default function MyLeave() {
  /* null asks the server for the leave period today falls in; its answer names the year. */
  const [year, setYear] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  /* No employee file behind this sign-in is a state, not a failure: retrying will not change it. */
  const [unlinked, setUnlinked] = useState(false);
  const [asking, setAsking] = useState(false);
  /* The waiting request being changed; the approved one I came back early from. */
  const [editing, setEditing] = useState(null);
  const [shortening, setShortening] = useState(null);
  /* No asking, changing or cancelling for a sign-in the server would refuse (People audit gap 3). */
  const canAct = useCanActForSelf();
  const [explaining, setExplaining] = useState(null);
  /* Restricted holidays go by the calendar year of today, not the leave period. */
  const [restricted, setRestricted] = useState(null);
  const shownYear = year ?? me?.year;
  const [upcoming, setUpcoming] = useState(null);
  const today = me?.today;
  useEffect(() => {
    if (!today) return undefined;
    let live = true;
    loadUpcoming(today).then((h) => { if (live) setUpcoming(h); });
    return () => { live = false; };
  }, [today]);
  const explainLoad = useCallback(() => explainMyLeave(explaining, shownYear), [explaining, shownYear]);

  const load = useCallback(() => {
    getMyLeave(year ?? undefined)
      .then((d) => {
        setMe(d);
        setError('');
        setUnlinked(false);
      })
      .catch((e) => {
        if (e?.status === 404) { setUnlinked(true); return; }
        setError(String(e?.message || 'Could not load your leave.'));
      });
  }, [year]);
  useEffect(() => {
    load();
  }, [load]);
  const loadRestricted = useCallback(() => {
    getMyRestrictedHolidays().then(setRestricted).catch(() => setRestricted(null));
  }, []);
  useEffect(() => {
    loadRestricted();
  }, [loadRestricted]);

  const pick = async (h) => {
    try {
      await pickMyRestrictedHoliday(h.id, !h.picked);
      notify.success(h.picked ? `${h.name} dropped.` : `${h.name} picked.`);
      loadRestricted();
    } catch (err) {
      notify.error(String(err?.message || 'Not changed.'));
    }
  };

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
      description={me?.employee?.name ? `${me.employee.name} · leave period ${shownYear}` : undefined}
      actions={me ? <>
        <div className="inline-flex items-center gap-1" role="group" aria-label="Leave period">
          <button type="button" className="ui-icon-btn" onClick={() => setYear(shownYear - 1)} aria-label="Previous leave period"><ChevronLeft size={16} aria-hidden="true" /></button>
          <span className="min-w-[4ch] text-center tabular-nums">{shownYear}</span>
          <button type="button" className="ui-icon-btn" onClick={() => setYear(shownYear + 1)} aria-label="Next leave period"><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
        {me.types.length && canAct ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAsking(true)}><Plus size={16} aria-hidden="true" /> Ask for leave</button> : null}
      </> : null}
    />
  );

  if (unlinked) return <div className="space-y-6">{header}<EmptyState title="No employee file is linked to your sign-in" description="HR links your sign-in on your employee record." /></div>;
  if (error && !me) return <div className="space-y-6">{header}<LoadFailed message={error} onRetry={load} /></div>;
  if (!me) return <div className="space-y-6" aria-busy="true">{header}<SkeletonCard lines={6} /></div>;

  const cancellable = (r) => r.status === 'PENDING' || (r.status === 'APPROVED' && r.fromDate > me.today);
  const shortenable = (r) => r.status === 'APPROVED' && !r.halfDay && !r.minutes && r.fromDate <= me.today && r.toDate > me.today;
  const hidden = (r) => r.reasonHidden || r.leaveTypeName === PRIVATE_LABEL;
  /* A type's identity colour: its own when a request carries it, else the one its name maps to (README §1). */
  const colourOf = new Map((me.requests || []).filter((r) => r.leaveTypeColor).map((r) => [r.leaveTypeId, r.leaveTypeColor]));
  const columns = [
    { key: 'type', label: 'Leave', always: true, render: (r) => (hidden(r) ? <span className="ml-private">{r.leaveTypeName}</span> : <LeavePill type={r} />) },
    { key: 'dates', label: 'Dates', render: (r) => (
      <span className="block min-w-0">
        <span className="tabular-nums whitespace-nowrap">{range(r.fromDate, r.toDate)}</span>
        {hoursText(r) ? <span className="ui-caption block">{hoursText(r)}</span> : r.halfDay ? <span className="ui-caption block">{r.halfDay === 'FIRST' ? 'First half' : 'Second half'}</span> : r.overflowOfId ? <span className="ui-caption block">Over the balance: loss of pay</span> : null}
        {!hidden(r) && r.reason ? <span className="ml-reason" title={r.reason}>{r.reason}</span> : null}
      </span>
    ) },
    { key: 'days', label: 'Days', align: 'right', render: (r) => <span className="tabular-nums">{r.fromTime && r.toTime ? hoursWords(hoursBetween(r.fromTime, r.toTime)) : r.days}</span> },
    { key: 'status', label: 'Status', render: (r) => (
      <span className="inline-flex flex-col items-start gap-0.5">
        <span className={`ui-pill ${LEAVE_STATUS[r.status] || 'ui-pill-neutral'}`}>{STATUS_LABEL[r.status] || r.status}</span>
        {r.status === 'REJECTED' && r.reviewNote ? <span className="ui-caption whitespace-normal">{r.reviewNote}</span> : null}
      </span>
    ) },
    /* Cancel sits on the row as a text button (R&D PEOPLE-16); Change and Came back early stay in the row's menu. */
    ...(canAct ? [{ key: 'cancel', label: '', align: 'right', always: true, render: (r) => (cancellable(r)
      ? <button type="button" className="ml-text-btn" onClick={(e) => { e.stopPropagation(); cancel(r); }} aria-label={`Cancel ${r.leaveTypeName}, ${range(r.fromDate, r.toDate)}`}>Cancel</button>
      : null) }] : []),
  ];

  return (
    <div className="ml-page">
      {header}
      {me.types.length ? (
        <div className="ml-balances" role="list" aria-label="Balances">
          {me.types.map((t) => {
            const swatch = swatchOf({ name: t.name, color: colourOf.get(t.id) });
            const pct = t.allocated > 0 ? Math.max(0, Math.min(100, (t.available / t.allocated) * 100)) : 0;
            /* One line under the figure: what is waiting, then what changes it (comp-off expiring, the period's end). */
            const note = t.expiring?.length ? expiringWords(t.expiring, formatDate)
              : t.projectedAvailable != null && t.projectedAvailable !== t.available ? `${amountFigure(t.projectedAvailable, t)} by period end`
                : `${amountFigure(t.used || 0, t)} taken`;
            return (
              <div key={t.id} role="listitem" className="ml-balance-cell">
                {t.isPaid ? (
                  <button type="button" className="ml-balance is-link" onClick={() => setExplaining(t.id)}>
                    <span className="ml-balance-head"><LeavePill type={{ name: t.name, color: colourOf.get(t.id) }} /><span className="ml-of">of {amountFigure(t.allocated, t)}{isHourly(t) ? ' hours' : ''}</span></span>
                    <span className="ml-figure">{amountFigure(t.available, t)}<span className="sr-only"> left</span></span>
                    <span className="ml-track" aria-hidden="true"><span style={{ width: `${pct}%`, background: swatch }} /></span>
                    <span className="ml-note">{t.pending ? <span className="ml-waiting">{amountFigure(t.pending, t)} waiting · </span> : null}{note}</span>
                    <span className="sr-only">. How is this worked out?</span>
                  </button>
                ) : (
                  <div className="ml-balance">
                    <span className="ml-balance-head"><LeavePill type={{ name: t.name, color: colourOf.get(t.id) }} /><span className="ml-of">unpaid</span></span>
                    <span className="ml-figure">{t.used}<span className="ml-of"> taken</span></span>
                    <span className="ml-note">No balance: every day is unpaid</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No leave types yet" description="HR sets them up in Leave Policy." />
      )}

      <div className={`ml-columns ${upcoming?.length || restricted?.quota > 0 ? 'has-side' : ''}`}>
        <section className="ml-main" aria-labelledby="ml-requests-h">
          <h2 id="ml-requests-h" className="ml-h2">My requests</h2>
          <DataTable
            label="My leave requests"
            columns={columns}
            rows={me.requests}
            total={me.requests.length}
            noun="requests"
            rowActions={canAct ? (r) => [
              r.status === 'PENDING' ? { key: 'change', label: 'Change', onSelect: () => setEditing(r) } : null,
              shortenable(r) ? { key: 'shorten', label: 'Came back early', onSelect: () => setShortening(r) } : null,
            ] : null}
            card={(r) => (
              <span className="block min-w-0">
                <span className="flex items-center justify-between gap-2"><span className="truncate">{r.leaveTypeName} · {r.fromTime && r.toTime ? hoursWords(hoursBetween(r.fromTime, r.toTime)) : daysText(r.days)}</span><span className={`ui-pill ${LEAVE_STATUS[r.status] || 'ui-pill-neutral'}`}>{STATUS_LABEL[r.status] || r.status}</span></span>
                <span className="flex items-center justify-between gap-2">
                  <span className="block truncate ui-caption tabular-nums">{range(r.fromDate, r.toDate)}</span>
                  {canAct && cancellable(r) ? <button type="button" className="ml-text-btn" onClick={() => cancel(r)} aria-label={`Cancel ${r.leaveTypeName}, ${range(r.fromDate, r.toDate)}`}>Cancel</button> : null}
                </span>
                {r.status === 'REJECTED' && r.reviewNote ? <span className="block ui-caption">{r.reviewNote}</span> : null}
              </span>
            )}
            empty={<EmptyState title="Nothing asked for in this leave period" />}
          />
        </section>

        {upcoming?.length || restricted?.quota > 0 ? (
          <aside className="ml-side" aria-label="Holidays">
            {upcoming?.length ? (
              <section aria-labelledby="ml-hol-h">
                <h2 id="ml-hol-h" className="ml-h2">Upcoming holidays</h2>
                <ul className="ml-list">
                  {upcoming.map((h) => (
                    <li key={h.id || `${h.date}-${h.name}`}>
                      <span className="min-w-0"><span className="ml-list-name">{h.name}</span><span className="ml-list-sub">{formatDate(h.date)}</span></span>
                      <span className="ml-list-end">{weekday(h.date)}{h.isOptional ? ' · optional' : ''}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {restricted?.quota > 0 ? (
              <section aria-labelledby="rh-h">
                <header className="ml-side-head">
                  <h2 id="rh-h" className="ml-h2">Restricted holidays {restricted.year}</h2>
                  <span className="ml-of">{restricted.picked} of {restricted.quota} picked</span>
                </header>
                <ul className="ml-list">
                  {restricted.holidays.length ? restricted.holidays.map((h) => (
                    <li key={h.id}>
                      <span className="min-w-0"><span className="ml-list-name">{h.name}</span><span className="ml-list-sub">{formatDate(h.date)}</span></span>
                      <span className="ml-list-end">
                        {h.picked ? <span className="ui-pill ui-pill-pos">Picked</span> : null}
                        {h.past ? <span className="ui-caption">Past</span> : !canAct ? null : (
                          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!h.picked && restricted.left <= 0} onClick={() => pick(h)}>{h.picked ? 'Drop' : 'Pick'}</button>
                        )}
                      </span>
                    </li>
                  )) : <li className="ml-list-empty">No optional holidays this year.</li>}
                </ul>
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>

      {asking ? <AskLeave types={me.types} onClose={() => setAsking(false)} onDone={() => { setAsking(false); load(); }} /> : null}
      {editing ? <AskLeave types={me.types} rows={me.requests || []} request={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} /> : null}
      {shortening ? <CameBackEarly request={shortening} onClose={() => setShortening(null)} onDone={() => { setShortening(null); load(); }} /> : null}
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
          {/* An hourly type says hours (gap 23). */}
          <span className="font-medium tabular-nums">{isHourly(preview.type) ? amountWords(preview.total, preview.type) : daysText(preview.total)}</span>
          {preview.type?.isPaid === false ? ', unpaid' : ''}
          {saved.length === 1 && saved[0].balance?.after != null ? <> · <span className="tabular-nums">{isHourly(preview.type) ? amountWords(saved[0].balance.after, preview.type) : saved[0].balance.after}</span> left after this</> : null}
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
      <HalfDayNote parts={parts} />
      {skipped.length ? (
        <ul className="space-y-0.5 ui-muted" aria-label="Dates not counted">
          {skipped.map((d) => <li key={d.date}><span className="tabular-nums">{dayLabel(d.date)}</span> — {d.why}</li>)}
        </ul>
      ) : null}
      {(preview.problems || []).map((x) => <p key={x.code + x.message} className="ui-text-neg" role="alert">{x.message}</p>)}
    </section>
  );
}

function AskLeave({ types, rows = [], onClose, onDone, request = null }) {
  const editing = Boolean(request);
  const startForm = request ? { ...BLANK, leaveTypeId: request.leaveTypeId, ...leaveSpan(request, rows), fromTime: request.fromTime || '', toTime: request.toTime || '', reason: request.reason || '' } : BLANK;
  const [form, setForm] = useState(startForm);
  const [saving, setSaving] = useState(false);
  const [got, setGot] = useState(null);
  /* The document a long request of some types asks for; a change keeps the one already sent. */
  const [doc, setDoc] = useState(null);
  const set = (k, v) => setForm((f) => ({
    ...f,
    [k]: v,
    ...(k === 'fromDate' && v && f.toDate && f.toDate < v ? { toDate: v } : {}),
    ...(k === 'leaveTypeId' ? { halfDay: '', startHalf: false, endHalf: false, fromTime: '', toTime: '' } : {}),
  }));
  const listed = types.find((t) => t.id === form.leaveTypeId);
  const hourly = isHourly(listed);

  /* The preview follows the form; only the answer for the dates on screen counts. */
  const key = form.leaveTypeId && form.fromDate && hoursReady(form, listed)
    ? JSON.stringify({ leaveTypeId: form.leaveTypeId, fromDate: form.fromDate, toDate: form.toDate || form.fromDate, ...halfDayBody(form, !hourly), ...hoursBody(form, listed), ...(request ? { editing: request.id } : {}) })
    : '';
  useEffect(() => {
    if (!key) return undefined;
    let off = false;
    const timer = setTimeout(() => {
      previewMyLeave(JSON.parse(key))
        .then((p) => { if (!off) setGot({ ...(request ? ownPreview(p, request) : p), key }); })
        .catch((e) => { if (!off) setGot({ key, ok: false, total: 0, parts: [], problems: [{ code: 'INPUT', message: String(e?.message || 'The days could not be worked out.') }] }); });
    }, 300);
    return () => { off = true; clearTimeout(timer); };
  }, [key, request]);
  const preview = got && got.key === key ? got : null;
  /* Whether the type allows a half day or is private comes with the preview. */
  const type = got?.type && got.type.id === form.leaveTypeId ? got.type : null;
  /* Known from the list of types before the preview answers, so the choice shows as soon as a day is picked. */
  const halfAllowed = Boolean((type || listed)?.allowHalfDay) && !hourly;
  const reasonNeeded = !type?.isPrivate;
  const reasonOk = !reasonNeeded || form.reason.trim().length >= 3;
  const dirty = editing ? JSON.stringify(form) !== JSON.stringify(startForm) : Boolean(form.leaveTypeId || form.fromDate || form.reason);
  const documentMissing = Boolean(preview?.documentNeeded) && !doc && !request?.attachmentDocId;
  const blocked = !key || !preview || Boolean(preview.problems?.length) || !reasonOk || documentMissing || (editing && !dirty && !doc);

  const save = async (e) => {
    e?.preventDefault();
    if (blocked || saving) return;
    setSaving(true);
    try {
      const body = {
        leaveTypeId: form.leaveTypeId,
        fromDate: form.fromDate,
        toDate: form.toDate || form.fromDate,
        ...halfDayBody(form, halfAllowed),
        ...hoursBody(form, listed),
        reason: form.reason.trim(),
        ...(preview.split ? { split: true } : {}),
        ...(doc ? { attachment: doc } : {}),
      };
      if (editing) {
        await editMyLeave(request.id, body);
        notify.success('Changed. It waits for a decision again.');
      } else {
        const r = await applyLeave(body);
        const sent = r.requests || [r.request];
        notify.success(sent.length > 1 ? `Asked for ${daysText(preview.total)} of ${r.request.leaveTypeName}, as ${NUMBER_WORD[sent.length] || sent.length} requests.` : `Asked for ${daysText(r.request.days)} of ${r.request.leaveTypeName}.`);
      }
      onDone();
    } catch (err) {
      notify.error(String(err?.message || (editing ? 'Not changed.' : 'Not sent.')));
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
      title={editing ? 'Change leave' : 'Ask for leave'}
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="ask-leave" className="ui-btn ui-btn-primary" disabled={blocked || saving}>{saving ? (editing ? 'Saving…' : 'Sending…') : editing ? 'Save' : 'Send'}</button>
      </>}
    >
      <form id="ask-leave" onSubmit={save} className="space-y-4">
        <div>
          <PopupSelect showValueSubtext={false} label="Leave type *" value={form.leaveTypeId} onChange={(v) => set('leaveTypeId', v || '')} placeholder="Choose…"
            options={types.map((t) => ({ value: t.id, label: t.isPaid ? `${t.name}, ${isHourly(t) ? amountWords(t.available, t) : t.available} left` : `${t.name}, unpaid` }))} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="ui-label" htmlFor="ml-from">{hourly ? 'Day *' : 'First day *'}</label><DatePicker id="ml-from" value={form.fromDate} onChange={(v) => set('fromDate', v || '')} /></div>
          {hourly ? null : <div><label className="ui-label" htmlFor="ml-to">Last day</label><DatePicker id="ml-to" value={form.toDate} min={form.fromDate} onChange={(v) => set('toDate', v || '')} /></div>}
        </div>
        {hourly
          ? <HoursChoice form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
          : <HalfDayChoice form={form} allowed={halfAllowed} typeName={(type || listed)?.name} label="How much of the day" onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />}
        <label className="block">
          <span className="ui-label">{reasonNeeded ? 'Reason *' : 'Reason'}</span>
          <input className="ui-input w-full" maxLength={500} value={form.reason} onChange={(e) => set('reason', e.target.value)} />
        </label>
        {preview?.documentNeeded || doc ? <LeaveDocumentField typeName={type?.name} afterDays={preview?.documentAfterDays} value={doc} onChange={setDoc} required={!request?.attachmentDocId} note={request?.attachmentDocId ? 'The one already sent stays unless you choose another.' : ''} /> : null}
        <LeavePreview preview={preview} checking={Boolean(key) && !preview} />
        <PreviewNotes preview={preview} />
      </form>
    </Drawer>
  );
}

/** Came back early: approved leave that has started ends on an earlier day; only the days taken are charged. */
function CameBackEarly({ request, onClose, onDone }) {
  const [toDate, setToDate] = useState('');
  const [days, setDays] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!toDate) { setDays(null); return undefined; }
    let off = false;
    previewMyLeave({ leaveTypeId: request.leaveTypeId, fromDate: request.fromDate, toDate, halfDay: null })
      .then((p) => { if (!off) setDays(p?.total ?? null); })
      .catch(() => { if (!off) setDays(null); });
    return () => { off = true; };
  }, [toDate, request]);
  const save = async (e) => {
    e?.preventDefault();
    if (!toDate || saving) return;
    setSaving(true);
    try {
      await shortenMyLeave(request.id, toDate);
      notify.success(`Your leave now ends ${formatDate(toDate)}.`);
      onDone();
    } catch (err) {
      notify.error(String(err?.message || 'Not changed.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      dirty={Boolean(toDate)}
      widthClass="w-[min(36rem,96vw)]"
      title="Came back early"
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="came-back-early" className="ui-btn ui-btn-primary" disabled={!toDate || saving}>{saving ? 'Saving…' : 'Save'}</button>
      </>}
    >
      <form id="came-back-early" onSubmit={save} className="space-y-4">
        <p className="text-sm">{request.leaveTypeName}, <span className="tabular-nums">{range(request.fromDate, request.toDate)}</span>.</p>
        <div className="sm:w-56">
          <label className="ui-label" htmlFor="cbe-to">Last day of leave *</label>
          <DatePicker id="cbe-to" value={toDate} min={request.fromDate} max={addDays(request.toDate, -1)} onChange={(v) => setToDate(v || '')} />
        </div>
        {toDate ? <p className="text-sm tabular-nums" aria-live="polite">{days == null ? 'Working out the days…' : `Charges ${daysText(days)} instead of ${daysText(request.days)}.`}</p> : null}
      </form>
    </Drawer>
  );
}
