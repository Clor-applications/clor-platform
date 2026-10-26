import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, Plus, X } from 'lucide-react';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { runListExport } from '@ui/components/list/exportMenu';
import { usePermissions } from '@ui/permissions/usePermissions';
import { Avatar } from '@ui/personnel/Employees';

import { can } from '../workforce/shared';
import { listEmployees } from '../workforce/api';
import {
  PRIVATE_LABEL, STATUS_LABEL, STATUS_PILL, approveLeave, cancelLeave, colorOf, createLeaveRequest, daysText,
  getLeaveRequest, getLeaveSettings, listLeaveRequests, listLeaveTypes, pageLeaveRequests, periodChoices, previewLeave, rejectLeave,
} from './api';

/**
 * Time & Leave → Requests (TIME-LEAVE-DECISIONS.md). Everything the list
 * shows is asked of the server: tab, search, type, period and page, kept in
 * the address so Back and refresh return to the same list. Waiting is oldest
 * first, so what has waited longest is on top. A request opens in a drawer
 * that says what it charges, the balance with and without it, who else is
 * away and what happened to it; HR enters leave for someone with the same
 * date-by-date preview the employee app shows.
 */
const TABS = [['PENDING', 'Waiting'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['CANCELLED', 'Cancelled'], ['all', 'All']];
const range = (from, to) => (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);
const half = (h) => (h === 'FIRST' ? 'First half' : h === 'SECOND' ? 'Second half' : '');
const waitedDays = (at) => Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000));
const waitedText = (at) => { const d = waitedDays(at); return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`; };

export function TypeDot({ row }) {
  const masked = row.reasonHidden || row.leaveTypeName === PRIVATE_LABEL;
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${masked ? 'ui-dot-quiet' : ''}`} style={masked ? undefined : { background: colorOf({ color: row.leaveTypeColor, name: row.leaveTypeName }) }} aria-hidden="true" />;
}

export function StatusPill({ row }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`ui-pill ${STATUS_PILL[row.status] || ''}`}>{STATUS_LABEL[row.status] || row.status}</span>
      {row.status === 'PENDING' && row.managerApprovedAt ? <span className="ui-caption">Manager approved</span> : null}
    </span>
  );
}

export default function LeaveRequests({ params = {}, updateParams }) {
  const perms = usePermissions();
  const allowed = (k) => can(perms, k);
  const p = params || {};
  const tab = TABS.some(([k]) => k === p.tab) ? p.tab : 'PENDING';
  const page = Math.max(1, Number(p.page || 1));
  const size = [25, 50, 100].includes(Number(p.size)) ? Number(p.size) : 25;
  const set = (patch, push = false) => updateParams?.(patch, { push });
  /* A notice that names one request (a bell, a link from the overview) opens it. */
  const [picked, setOpenId] = useState(null);
  const openId = picked || p.id || null;

  const settings = useRequest(() => getLeaveSettings(), []);
  const types = useRequest(() => listLeaveTypes(), []);
  const year = p.year ? Number(p.year) : settings.data?.current?.year;
  const query = { status: tab === 'all' ? undefined : tab, q: p.q, leaveTypeId: p.type, year, limit: size, offset: (page - 1) * size };
  const list = useRequest(() => (year ? pageLeaveRequests(query) : Promise.resolve(null)), [JSON.stringify(query)]);
  const rows = list.data?.requests || [];
  const counts = list.data?.counts || {};
  const [adding, setAdding] = useState(false);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, tab);
  const filtered = Boolean(p.q || p.type);

  const columns = [
    { key: 'employee', label: 'Employee', always: true, render: (r) => (
      <span className="flex items-center gap-2.5 min-w-0">
        <Avatar person={{ name: r.employeeName, photoUrl: r.photoUrl }} size={32} />
        <span className="min-w-0">
          <span className="block truncate font-medium">{r.employeeName}</span>
          <span className="block truncate ui-caption">{[r.employeeCode, r.department].filter(Boolean).join(' · ')}</span>
        </span>
      </span>
    ) },
    { key: 'type', label: 'Leave', render: (r) => <span className="inline-flex items-center gap-2 whitespace-nowrap"><TypeDot row={r} />{r.leaveTypeName}</span> },
    { key: 'dates', label: 'Dates', render: (r) => <span className="tabular-nums whitespace-nowrap">{range(r.fromDate, r.toDate)}{r.halfDay ? <span className="ui-caption block">{half(r.halfDay)}</span> : r.groupId ? <span className="ui-caption block">Part of a leave across the period end</span> : null}</span> },
    { key: 'days', label: 'Days', align: 'right', render: (r) => <span className="tabular-nums">{r.days}</span> },
    { key: 'asked', label: tab === 'PENDING' ? 'Waiting since' : 'Asked', render: (r) => <span className={`whitespace-nowrap ${tab === 'PENDING' && waitedDays(r.createdAt) > 2 ? 'ui-text-warn' : ''}`}>{tab === 'PENDING' ? waitedText(r.createdAt) : formatDate(String(r.createdAt).slice(0, 10))}</span> },
    { key: 'status', label: 'Status', render: (r) => <StatusPill row={r} /> },
  ];

  const exportAll = async () => {
    try {
      const all = await listLeaveRequests({ status: tab === 'all' ? undefined : tab, q: p.q, leaveTypeId: p.type, year });
      const columns_ = [['employeeName', 'Employee'], ['employeeCode', 'Employee ID'], ['department', 'Department'], ['leaveTypeName', 'Leave type'], ['fromDate', 'From'], ['toDate', 'To'], ['days', 'Days'], ['reason', 'Reason'], ['statusLabel', 'Status'], ['reviewNote', 'Note']].map(([key, label]) => ({ key, label }));
      runListExport({ format: 'xlsx', title: 'Leave requests', fileName: `leave-requests-${year}`, label: 'Requests', rows: all.map((r) => ({ ...r, reason: r.reason ?? '', statusLabel: STATUS_LABEL[r.status] || r.status })), columns: columns_ });
    } catch (e) {
      notify.error(String(e?.message || 'Could not export.'));
    }
  };

  const periodOptions = settings.data ? periodChoices(settings.data).map((c) => ({ value: String(c.year), label: c.label })) : [];
  const typeOptions = [{ value: '', label: 'Every type' }, ...(types.data || []).map((t) => ({ value: t.id, label: t.name }))];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[{ label: 'People' }, { label: 'Time & Leave' }]}
        title="Leave requests"
        actions={<>
          {allowed('ATTENDANCE::Leave Requests::EXPORT') || perms?.isAdmin ? <button type="button" className="ui-btn ui-btn-secondary" onClick={exportAll}><Download size={16} aria-hidden="true" /> Export</button> : null}
          {allowed('ATTENDANCE::Leave Requests::CREATE') ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Enter leave</button> : null}
        </>}
      />

      <div ref={tabsRef} role="tablist" aria-label="Leave requests" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ui-tab ${tab === k ? 'is-active' : ''}`} onClick={() => set({ tab: k === 'PENDING' ? null : k, page: null }, true)}>
            {l}{counts[k] ? <span className="ui-tab-count tabular-nums">{counts[k]}</span> : null}
          </button>
        ))}
        {tabIndicator}
      </div>

      <DataTable
        label="Leave requests"
        columns={columns}
        rows={rows}
        total={Number(list.data?.total || 0)}
        page={page}
        pageSize={size}
        noun="requests"
        onPage={(n) => set({ page: n > 1 ? n : null }, true)}
        onPageSize={(n) => set({ size: n === 25 ? null : n, page: null })}
        onRowClick={(r) => setOpenId(r.id)}
        loading={list.loading || (!year && settings.loading)}
        refreshing={list.refreshing}
        card={(r) => (
          <span className="flex items-center gap-3 min-w-0">
            <Avatar person={{ name: r.employeeName, photoUrl: r.photoUrl }} size={40} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.employeeName}</span><span className={`ui-pill ${STATUS_PILL[r.status] || ''}`}>{STATUS_LABEL[r.status]}</span></span>
              <span className="block truncate ui-caption">{r.leaveTypeName} · {daysText(r.days)}</span>
              <span className="block truncate ui-caption tabular-nums">{range(r.fromDate, r.toDate)}</span>
            </span>
          </span>
        )}
        toolbar={<>
          <SearchField value={p.q || ''} onSearch={(q) => set({ q: q || null, page: null })} placeholder="Search name or employee ID" label="Search leave requests" className="w-full sm:w-72" />
          <div className="w-full sm:w-48"><PopupSelect showValueSubtext={false} ariaLabel="Leave type" value={p.type || ''} onChange={(v) => set({ type: v || null, page: null })} options={typeOptions} placeholder="Every type" /></div>
          {periodOptions.length > 1 ? <div className="w-full sm:w-48"><PopupSelect showValueSubtext={false} ariaLabel="Leave period" value={String(year || '')} onChange={(v) => set({ year: v && Number(v) !== settings.data?.current?.year ? v : null, page: null })} options={periodOptions} /></div> : null}
        </>}
        empty={list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : filtered ? (
          <EmptyState kind="filtered" title="No requests match" onClearFilters={() => set({ q: null, type: null, page: null })} />
        ) : tab === 'PENDING' ? (
          <EmptyState title="Nothing waiting" />
        ) : (
          <EmptyState title={`No ${tab === 'all' ? '' : `${STATUS_LABEL[tab].toLowerCase()} `}requests in this period`} />
        )}
      />

      {openId ? <RequestDrawer id={openId} allowed={allowed} onClose={() => { setOpenId(null); if (p.id) set({ id: null }); }} onDone={() => { setOpenId(null); if (p.id) set({ id: null }); list.reload(); }} /> : null}
      {adding ? <EnterLeave onClose={() => setAdding(false)} onDone={() => { setAdding(false); set({ tab: null, page: null }); list.reload(); }} /> : null}
    </div>
  );
}

/** The dates a request skips, and why: "Sat 12 Dec — Weekly off". Counted dates are the number already shown. */
export function SkippedDates({ dates, said = false }) {
  const shown = (dates || []).filter((d) => !d.counted || d.why);
  if (!shown.length) return null;
  const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <ul className="space-y-1 text-sm">
      {shown.map((d) => (
        <li key={d.date} className="flex gap-3"><span className="tabular-nums w-24 shrink-0">{day(d.date)}</span><span className={d.counted ? '' : 'ui-muted'}>{d.counted || said ? d.why : `${d.why}, not charged`}</span></li>
      ))}
    </ul>
  );
}

function Fact({ label, children }) {
  return <div><dt className="ui-label">{label}</dt><dd className="mt-0.5">{children}</dd></div>;
}

function RequestDrawer({ id, allowed, onClose, onDone }) {
  const req = useRequest(() => getLeaveRequest(id), [id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [noteError, setNoteError] = useState('');
  const noteRef = useRef(null);
  const d = req.data;
  const r = d?.request;
  const canDecide = allowed('ATTENDANCE::Leave Requests::APPROVE');
  const canCancel = allowed('ATTENDANCE::Leave Requests::EDIT');

  const act = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      notify.success(done);
      onDone();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
      req.reload();
    } finally {
      setBusy(false);
    }
  };
  /* A rejection says why: the person reads it in the employee app. */
  const reject = () => {
    if (!note.trim()) { setNoteError('Say why. They see this with the decision.'); noteRef.current?.focus(); return; }
    act(() => rejectLeave(r.id, note.trim()), 'Rejected.');
  };
  const cancel = async () => {
    const ok = await confirmDialog({
      title: r.status === 'APPROVED' ? 'Cancel this leave?' : 'Withdraw this request?',
      message: r.status === 'APPROVED' ? `The days come off the attendance record and go back to the balance${d.parts?.length > 1 ? ', for every part of this leave' : ''}.` : d.parts?.length > 1 ? 'Both parts of this leave are withdrawn.' : undefined,
      confirmLabel: r.status === 'APPROVED' ? 'Cancel leave' : 'Withdraw',
    });
    if (ok) act(() => cancelLeave(r.id), r.status === 'APPROVED' ? 'Leave cancelled.' : 'Request withdrawn.');
  };

  const actions = !r ? null : r.status === 'PENDING' && canDecide ? (
    <>
      {canCancel ? <button type="button" className="ui-btn ui-btn-ghost mr-auto" disabled={busy} onClick={cancel}>Withdraw</button> : null}
      <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={reject}><X size={16} aria-hidden="true" /> Reject</button>
      <button type="button" className="ui-btn ui-btn-primary" disabled={busy || Boolean(d.waitingForManager)} onClick={() => act(() => approveLeave(r.id, note.trim()), 'Approved.')}><Check size={16} aria-hidden="true" /> Approve</button>
    </>
  ) : OPEN_STATUSES.includes(r.status) && canCancel ? (
    <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={cancel}>{r.status === 'APPROVED' ? 'Cancel leave' : 'Withdraw'}</button>
  ) : null;

  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)]" title={r ? `${r.employeeName}: ${r.leaveTypeName}` : 'Leave request'} actions={actions} dirty={Boolean(note.trim())}>
      {req.error ? <ErrorState error={req.error} onRetry={req.reload} compact /> : !d ? <div className="ui-skel ui-skel-text" aria-busy="true" /> : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Fact label="Dates"><span className="tabular-nums">{range(r.fromDate, r.toDate)}</span>{r.halfDay ? `, ${half(r.halfDay).toLowerCase()}` : ''}</Fact>
            <Fact label="Charged"><span className="tabular-nums">{daysText(r.days)}</span></Fact>
            <Fact label="Status"><StatusPill row={r} /></Fact>
            {d.parts?.length > 1 ? <div className="col-span-2"><Fact label="Across the period end">{d.parts.map((x, i) => <span key={x.id} className="block tabular-nums">Part {i + 1}: {range(x.fromDate, x.toDate)}, {daysText(x.days)}{x.status !== r.status ? ` · ${STATUS_LABEL[x.status]}` : ''}</span>)}</Fact></div> : null}
            <div className="col-span-2"><Fact label="Reason">{r.reasonHidden ? <span className="ui-muted">Private: HR reads the reason.</span> : r.reason ? r.reason : <span className="ui-muted">None given</span>}</Fact></div>
          </dl>

          {d.waitingForManager ? <p className="text-sm ui-text-warn">{d.waitingForManager}</p> : null}

          {d.balance ? (
            <section aria-labelledby="lr-balance" className="space-y-1">
              <h3 id="lr-balance" className="ui-t-sec">Balance</h3>
              <p className="text-sm tabular-nums">
                {OPEN_STATUSES.includes(r.status)
                  ? <>{d.balance.without} {d.balance.without === 1 ? 'day' : 'days'} without this request, <strong>{d.balance.with}</strong> with it</>
                  : <>{d.balance.available} {d.balance.available === 1 ? 'day' : 'days'} left</>}
                <span className="ui-muted"> · {d.balance.label}</span>
              </p>
            </section>
          ) : !r.isPaid ? <p className="text-sm">Unpaid: {daysText(r.days)} of loss of pay.</p> : null}

          {(d.dates || []).some((x) => !x.counted || x.why) ? (
            <section aria-labelledby="lr-dates" className="space-y-2">
              <h3 id="lr-dates" className="ui-t-sec">Dates not charged</h3>
              <SkippedDates dates={d.dates} said />
            </section>
          ) : null}

          <section aria-labelledby="lr-away" className="space-y-2">
            <h3 id="lr-away" className="ui-t-sec">Also away then</h3>
            {!d.alsoAway.length ? <p className="text-sm ui-muted">Nobody else.</p> : (
              <ul className="space-y-1.5 text-sm">
                {d.alsoAway.slice(0, 10).map((x) => (
                  <li key={x.id} className="flex items-center gap-2"><TypeDot row={x} /><span className="font-medium">{x.employeeName}</span><span className="ui-muted tabular-nums">{range(x.fromDate, x.toDate)}{x.status === 'PENDING' ? ', waiting' : ''}{x.department ? ` · ${x.department}` : ''}</span></li>
                ))}
                {d.alsoAway.length > 10 ? <li className="ui-muted">and {d.alsoAway.length - 10} more</li> : null}
              </ul>
            )}
          </section>

          <section aria-labelledby="lr-history" className="space-y-2">
            <h3 id="lr-history" className="ui-t-sec">History</h3>
            <ol className="space-y-2 text-sm">
              {d.history.map((h, i) => (
                <li key={i} className="flex gap-3">
                  <span className="tabular-nums ui-muted w-24 shrink-0">{formatDate(new Date(new Date(h.at).getTime() + 330 * 60_000).toISOString().slice(0, 10))}</span>
                  <span>{h.what}{h.by ? ` by ${h.by}` : ''}{h.note ? <span className="block ui-muted">“{h.note}”</span> : null}</span>
                </li>
              ))}
            </ol>
          </section>

          {r.status === 'PENDING' && canDecide ? (
            <div>
              <label htmlFor="lr-note" className="ui-label">Note to them</label>
              <textarea id="lr-note" ref={noteRef} className={`ui-input w-full ${noteError ? 'is-invalid' : ''}`} rows={2} maxLength={500} value={note} aria-invalid={Boolean(noteError)} aria-describedby={noteError ? 'lr-note-err' : undefined} onChange={(e) => { setNote(e.target.value); setNoteError(''); }} />
              {noteError ? <span id="lr-note-err" className="ui-field-error">{noteError}</span> : null}
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
const OPEN_STATUSES = ['PENDING', 'APPROVED'];

/** What the preview says, in the words the form needs: days, balance after, dates skipped, problems, the split. */
export function LeavePreview({ preview, loading }) {
  if (!preview) return loading ? <p className="text-sm ui-muted" aria-live="polite">Working out the days…</p> : null;
  const parts = preview.parts || [];
  return (
    <section className="space-y-3" aria-live="polite" aria-busy={loading}>
      {parts.length ? (
        <p className="text-sm">
          Charges <strong className="tabular-nums">{daysText(preview.total)}</strong>
          {preview.type?.isPaid === false ? ' of loss of pay' : ''}
          {parts.length === 1 && parts[0].balance?.after != null ? <> · <span className="tabular-nums">{parts[0].balance.after}</span> left after</> : null}
        </p>
      ) : null}
      {preview.split ? (
        <div className="text-sm space-y-1">
          <p>This crosses the end of the leave period, so it is saved as {parts.length} requests:</p>
          <ul className="space-y-0.5">
            {parts.map((x) => <li key={x.from} className="tabular-nums">{range(x.from, x.to)}: {daysText(x.days)}{x.balance?.after != null ? `, ${x.balance.after} left in ${x.label}` : ''}</li>)}
          </ul>
        </div>
      ) : null}
      <SkippedDates dates={parts.flatMap((x) => x.dates || [])} />
      {(preview.problems || []).map((x) => <p key={x.code + x.message} className="text-sm ui-text-neg" role="alert">{x.message}</p>)}
    </section>
  );
}

export function EnterLeave({ onClose, onDone }) {
  const [form, setForm] = useState({ employeeId: '', leaveTypeId: '', fromDate: '', toDate: '', halfDay: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const people = useRequest(() => listEmployees({ limit: 500, sort: 'name', status: 'CURRENT' }).then((r) => r?.employees || []), []);
  const types = useRequest(() => listLeaveTypes().then((t) => t.filter((x) => x.isActive)), []);
  const type = (types.data || []).find((t) => t.id === form.leaveTypeId);
  const oneDay = form.fromDate && form.fromDate === form.toDate;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v, ...(k === 'fromDate' && v && (!f.toDate || f.toDate < v) ? { toDate: v } : {}) }));
  const body = { ...form, halfDay: oneDay && form.halfDay ? form.halfDay : null };
  const ready = form.employeeId && form.leaveTypeId && form.fromDate && form.toDate;
  const dirty = Boolean(form.employeeId || form.leaveTypeId || form.fromDate || form.reason);

  /* The preview follows the form; the newest answer wins and the last one stays while the next loads. */
  const seq = useRef(0);
  useEffect(() => {
    if (!ready) { setPreview(null); return undefined; }
    const n = ++seq.current;
    setPreviewing(true);
    const t = setTimeout(() => {
      previewLeave(body).then((r) => { if (n === seq.current) setPreview(r); }).catch((e) => { if (n === seq.current) setPreview({ problems: [{ code: 'ERR', message: String(e?.message || 'Could not work out the days.') }], parts: [] }); }).finally(() => { if (n === seq.current) setPreviewing(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [form.employeeId, form.leaveTypeId, form.fromDate, form.toDate, form.halfDay]);

  const reasonNeeded = type ? !type.isPrivate : true;
  const reasonOk = !reasonNeeded || form.reason.trim().length >= 3;
  const blocked = !ready || !preview || previewing || (preview.problems || []).length > 0 || !reasonOk;

  const save = async (e) => {
    e?.preventDefault();
    if (blocked || saving) return;
    setSaving(true);
    try {
      const r = await createLeaveRequest({ ...body, reason: form.reason.trim(), split: Boolean(preview?.split) });
      notify.success(r.requests ? `Entered as ${r.requests.length} requests. They wait in Waiting.` : 'Entered. It waits in Waiting.');
      onDone();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      widthClass="w-[min(36rem,96vw)]"
      dirty={dirty}
      title="Enter leave"
      actions={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="enter-leave" className="ui-btn ui-btn-primary" disabled={blocked || saving}>{saving ? 'Saving…' : 'Save'}</button>
      </>}
    >
      <form id="enter-leave" onSubmit={save} className="space-y-4">
        <PopupSelect showValueSubtext={false} label="Employee *" value={form.employeeId} onChange={(v) => set('employeeId', v || '')} placeholder="Choose…" alwaysSearch options={(people.data || []).map((x) => ({ value: x.id, label: x.code ? `${x.name} (${x.code})` : x.name }))} />
        <PopupSelect showValueSubtext={false} label="Leave type *" value={form.leaveTypeId} onChange={(v) => set('leaveTypeId', v || '')} placeholder="Choose…" options={(types.data || []).map((t) => ({ value: t.id, label: t.isPaid ? t.name : `${t.name} (unpaid)` }))} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div><span className="ui-label" id="el-from">First day *</span><DatePicker label="First day" describedBy="el-from" value={form.fromDate} onChange={(v) => set('fromDate', v || '')} /></div>
          <div><span className="ui-label" id="el-to">Last day *</span><DatePicker label="Last day" describedBy="el-to" value={form.toDate} min={form.fromDate} onChange={(v) => set('toDate', v || '')} /></div>
        </div>
        {oneDay && type?.allowHalfDay !== false ? (
          <PopupSelect showValueSubtext={false} label="Day" value={form.halfDay} onChange={(v) => set('halfDay', v || '')} options={[{ value: '', label: 'Whole day' }, { value: 'FIRST', label: 'First half' }, { value: 'SECOND', label: 'Second half' }]} />
        ) : null}
        <label className="block">
          <span className="ui-label">{reasonNeeded ? 'Reason *' : 'Reason'}</span>
          <input className="ui-input w-full" maxLength={500} value={form.reason} onChange={(e) => set('reason', e.target.value)} />
        </label>
        <LeavePreview preview={preview} loading={previewing} />
        {preview?.alsoAwayCount ? <p className="text-sm ui-muted">{preview.alsoAwayCount} {preview.alsoAwayCount === 1 ? 'other person is' : 'others are'} away then{preview.sameDepartment ? `, ${preview.sameDepartment} in the same department` : ''}.</p> : null}
      </form>
    </Drawer>
  );
}

