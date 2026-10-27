import React, { useMemo, useRef, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SuggestInput from '@ui/components/ui/SuggestInput';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { Avatar } from '@ui/personnel/Employees';

import { can, homeCrumbs } from './shared';
import { useSuggestions } from './suggestions';
import {
  MONTH_NAMES, STATUS_LABEL, STATUS_PILL, bulkReviewRequests, cancelRequest, createMyRequest, createRequest, decideRequest, getRequest, getRequestRules, listPeople,
  pageRequests, requestUsage, todayIst, updateMyRequest, updateRequest,
} from './api';

/**
 * Time & Leave → Attendance requests (TIME-LEAVE-DECISIONS.md, advanced build):
 * missed punch, work from home, on duty and permission hours on one list with
 * one approval. The list is the server's page, kept in the address; Waiting
 * is oldest first. A row opens its story: what, when, how much of the month's
 * quota it takes, what happened to it, and the decision. HR enters a request
 * for someone with the same form the employee app has.
 */
const TABS = [['PENDING', 'Waiting'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['CANCELLED', 'Cancelled'], ['all', 'All']];
export const KINDS = ['MISSED_PUNCH', 'WFH', 'ON_DUTY', 'PERMISSION'];
export const KIND_NAME = { MISSED_PUNCH: 'Missed punch', WFH: 'Work from home', ON_DUTY: 'On duty', PERMISSION: 'Permission' };
const KIND_OPTIONS = [{ value: '', label: 'Every kind' }, ...KINDS.map((k) => ({ value: k, label: KIND_NAME[k] }))];
const SPANS = ['WFH', 'ON_DUTY'];
const half = (h) => (h === 'FIRST' ? 'First half' : h === 'SECOND' ? 'Second half' : '');
const range = (from, to) => (!to || from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);
const waitedDays = (at) => Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000));
const waitedText = (at) => { const d = waitedDays(at); return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`; };
const inTime = (r) => r.checkInTime || r.checkIn || '';
const outTime = (r) => r.checkOutTime || r.checkOut || '';
/** "2 hours", "1 hour 30 minutes". */
export const hoursText = (minutes) => {
  const m = Math.max(0, Number(minutes) || 0);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return [h ? `${h} ${h === 1 ? 'hour' : 'hours'}` : '', rest ? `${rest} minutes` : ''].filter(Boolean).join(' ') || '0 minutes';
};
/** The months to filter by: this one and the eleven before, newest first. */
export const monthChoices = (n = 12) => {
  const out = [];
  const t = todayIst();
  let y = Number(t.slice(0, 4));
  let m = Number(t.slice(5, 7));
  for (let i = 0; i < n; i += 1) {
    out.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTH_NAMES[m - 1]} ${y}` });
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
};
export const monthLabel = (month) => (month ? `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}` : '');

/** "2 of 4 work-from-home days used", "1 of 3 missed-punch requests used, 1 waiting", "2 hours used, no limit". */
export function usageText(kind, u) {
  if (!u) return '';
  const unit = u.unit === 'hours' ? 'permission hours' : u.unit === 'requests' ? 'missed-punch requests' : `${kind === 'WFH' ? 'work-from-home' : 'on-duty'} days`;
  const waiting = u.pending ? `, ${u.pending} waiting` : '';
  if (u.quota == null) return `${u.used} ${unit} used${waiting}, no limit`;
  return `${u.used} of ${u.quota} ${unit} used${waiting}`;
}

/** Date or range, with the half day or the hours window. */
export function WhenCell({ row }) {
  return (
    <span className="tabular-nums whitespace-nowrap">
      {range(row.date, row.toDate)}
      {row.halfDay ? <span className="ui-caption block">{half(row.halfDay)}</span> : null}
      {row.kind === 'PERMISSION' && inTime(row) ? <span className="ui-caption block">{inTime(row)}–{outTime(row)} · {hoursText(row.minutes)}</span> : null}
    </span>
  );
}

/** The place, the punches asked for, or the hours. */
export const detailsText = (r) => {
  if (r.kind === 'ON_DUTY') return r.place || '';
  if (r.kind === 'MISSED_PUNCH') return inTime(r) ? `In ${inTime(r)}${outTime(r) ? `, out ${outTime(r)}` : ''}` : '';
  if (r.kind === 'PERMISSION') return hoursText(r.minutes);
  return '';
};

export function StatusPill({ row }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`ui-pill ${STATUS_PILL[row.status] || ''}`}>{STATUS_LABEL[row.status] || row.status}</span>
      {row.status === 'PENDING' && row.managerApprovedAt ? <span className="ui-caption">Manager approved</span> : null}
    </span>
  );
}

export default function AttendanceRequests({ params = {}, updateParams }) {
  const perms = usePermissions();
  const allowed = (k) => can(perms, k);
  const p = params || {};
  const tab = TABS.some(([k]) => k === p.tab) ? p.tab : 'PENDING';
  const page = Math.max(1, Number(p.page || 1));
  const size = [25, 50, 100].includes(Number(p.size)) ? Number(p.size) : 25;
  const set = (patch, push = false) => updateParams?.(patch, { push });
  const [picked, setOpenId] = useState(null);
  const openId = picked || p.id || null;

  const query = { status: tab === 'all' ? undefined : tab, kind: p.kind, month: p.month, q: p.q, limit: size, offset: (page - 1) * size };
  const list = useRequest(() => pageRequests(query), [JSON.stringify(query)]);
  const rows = list.data?.requests || [];
  const counts = list.data?.counts || {};
  const [adding, setAdding] = useState(false);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, tab);
  const filtered = Boolean(p.q || p.kind || p.month);
  const months = useMemo(() => [{ value: '', label: 'Every month' }, ...monthChoices()], []);
  /* Several waiting requests decided at once (a week of missed punches on a Monday): one note, the same checks as one. */
  const canDecide = allowed('ATTENDANCE::Attendance Requests::APPROVE');
  const [selected, setSelected] = useState(() => new Set());
  const [bulkNote, setBulkNote] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [seenTab, setSeenTab] = useState(tab);
  if (seenTab !== tab) { setSeenTab(tab); setSelected(new Set()); }
  const chosen = rows.filter((r) => selected.has(r.id) && r.status === 'PENDING');
  const decideMany = async (approve) => {
    const ids = chosen.map((r) => r.id);
    if (!ids.length || bulkBusy) return;
    if (!approve && !bulkNote.trim()) { notify.error('Say why. They see this with the decision.'); return; }
    setBulkBusy(true);
    try {
      const out = await bulkReviewRequests(ids, approve, bulkNote.trim() || undefined);
      const did = approve ? (out.handedOn && out.handedOn === out.done ? 'approved as the manager; they now wait for HR' : 'approved') : 'rejected';
      if (out.failed) notify.error(`${out.done} ${did}, ${out.failed} not: ${out.results?.[0]?.error || ''}`);
      else notify.success(`${out.done} ${did}.`);
      setSelected(new Set());
      setBulkNote('');
      list.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      setBulkBusy(false);
    }
  };

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
    { key: 'kind', label: 'Kind', render: (r) => <span className="whitespace-nowrap">{KIND_NAME[r.kind] || r.kind}</span> },
    { key: 'when', label: 'When', render: (r) => <WhenCell row={r} /> },
    { key: 'details', label: 'Details', render: (r) => <span className="tabular-nums">{detailsText(r)}</span> },
    { key: 'reason', label: 'Reason', render: (r) => <span className="block max-w-xs truncate" title={r.reason || ''}>{r.reason}</span> },
    { key: 'asked', label: tab === 'PENDING' ? 'Waiting since' : 'Asked', render: (r) => <span className={`whitespace-nowrap ${tab === 'PENDING' && waitedDays(r.createdAt) > 2 ? 'ui-text-warn' : ''}`}>{tab === 'PENDING' ? waitedText(r.createdAt) : formatDate(String(r.createdAt).slice(0, 10))}</span> },
    { key: 'status', label: 'Status', render: (r) => <StatusPill row={r} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={homeCrumbs()}
        title="Attendance requests"
        actions={allowed('ATTENDANCE::Attendance Requests::CREATE') ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Enter request</button> : null}
      />

      <div ref={tabsRef} role="tablist" aria-label="Attendance requests" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ui-tab ${tab === k ? 'is-active' : ''}`} onClick={() => set({ tab: k === 'PENDING' ? null : k, page: null }, true)}>
            {l}{counts[k] ? <span className="ui-tab-count tabular-nums">{counts[k]}</span> : null}
          </button>
        ))}
        {tabIndicator}
      </div>

      {chosen.length ? (
        <div className="ui-bulkbar" role="region" aria-label="Decide the chosen requests">
          <span className="text-sm"><strong className="tabular-nums">{chosen.length}</strong> chosen</span>
          <input className="ui-input w-full sm:w-72" aria-label="Note to them" placeholder="Note to them (needed to reject)" maxLength={500} value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} />
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={bulkBusy} onClick={() => decideMany(true)}><Check size={14} aria-hidden="true" /> Approve</button>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={bulkBusy || !bulkNote.trim()} onClick={() => decideMany(false)}><X size={14} aria-hidden="true" /> Reject</button>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : null}

      <DataTable
        label="Attendance requests"
        columns={columns}
        rows={rows}
        total={Number(list.data?.total || 0)}
        page={page}
        pageSize={size}
        noun="requests"
        selectable={tab === 'PENDING' && canDecide}
        selected={selected}
        onSelect={setSelected}
        onPage={(n) => set({ page: n > 1 ? n : null }, true)}
        onPageSize={(n) => set({ size: n === 25 ? null : n, page: null })}
        onRowClick={(r) => setOpenId(r.id)}
        loading={list.loading}
        refreshing={list.refreshing}
        card={(r) => (
          <span className="flex items-center gap-3 min-w-0">
            <Avatar person={{ name: r.employeeName, photoUrl: r.photoUrl }} size={40} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.employeeName}</span><span className={`ui-pill ${STATUS_PILL[r.status] || ''}`}>{STATUS_LABEL[r.status]}</span></span>
              <span className="block truncate ui-caption">{KIND_NAME[r.kind]}{detailsText(r) ? ` · ${detailsText(r)}` : ''}</span>
              <span className="block truncate ui-caption tabular-nums">{range(r.date, r.toDate)}{r.halfDay ? `, ${half(r.halfDay).toLowerCase()}` : ''}</span>
            </span>
          </span>
        )}
        toolbar={<>
          <SearchField value={p.q || ''} onSearch={(q) => set({ q: q || null, page: null })} placeholder="Search name or employee ID" label="Search attendance requests" className="w-full sm:w-72" />
          <div className="w-full sm:w-44"><PopupSelect showValueSubtext={false} ariaLabel="Kind" value={p.kind || ''} onChange={(v) => set({ kind: v || null, page: null })} options={KIND_OPTIONS} placeholder="Every kind" /></div>
          <div className="w-full sm:w-44"><PopupSelect showValueSubtext={false} ariaLabel="Month" value={p.month || ''} onChange={(v) => set({ month: v || null, page: null })} options={months} placeholder="Every month" /></div>
        </>}
        empty={list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : filtered ? (
          <EmptyState kind="filtered" title="No requests match" onClearFilters={() => set({ q: null, kind: null, month: null, page: null })} />
        ) : tab === 'PENDING' ? (
          <EmptyState title="Nothing waiting" />
        ) : (
          <EmptyState title={`No ${tab === 'all' ? '' : `${STATUS_LABEL[tab].toLowerCase()} `}requests`} />
        )}
      />

      {openId ? <RequestDrawer id={openId} allowed={allowed} onClose={() => { setOpenId(null); if (p.id) set({ id: null }); }} onDone={() => { setOpenId(null); if (p.id) set({ id: null }); list.reload(); }} /> : null}
      {adding ? <EnterRequest onClose={() => setAdding(false)} onDone={() => { setAdding(false); set({ tab: null, page: null }); list.reload(); }} /> : null}
    </div>
  );
}

function Fact({ label, children }) {
  return <div><dt className="ui-label">{label}</dt><dd className="mt-0.5">{children}</dd></div>;
}

const istDate = (at) => formatDate(new Date(new Date(at).getTime() + 330 * 60_000).toISOString().slice(0, 10));
const FIELD_WORDS = { date: 'date', toDate: 'last day', halfDay: 'half day', place: 'place', minutes: 'hours', checkIn: 'in', checkOut: 'out', reason: 'reason', reasonCode: 'what happened' };

/** What happened to a request, in order: asked, changed (which fields), the manager's step, the decision, cancelled. */
export function RequestHistory({ history }) {
  if (!history?.length) return <p className="text-sm ui-muted">Nothing yet.</p>;
  return (
    <ol className="space-y-2 text-sm">
      {history.map((h, i) => (
        <li key={i} className="flex gap-3">
          <span className="tabular-nums ui-muted w-24 shrink-0">{istDate(h.at)}</span>
          <span>
            {h.what}{h.byName ? ` by ${h.byName}` : ''}
            {h.to && Object.keys(h.to).length ? <span className="block ui-muted">{Object.keys(h.to).map((k) => FIELD_WORDS[k] || k).join(', ')}</span> : null}
            {h.note ? <span className="block ui-muted">“{h.note}”</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function RequestDrawer({ id, allowed, onClose, onDone }) {
  const req = useRequest(() => getRequest(id), [id]);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const noteRef = useRef(null);
  const d = req.data;
  const r = d?.request;
  const canDecide = allowed('ATTENDANCE::Attendance Requests::APPROVE');
  const act = async (fn, done) => {
    setBusy(true);
    try {
      const out = await fn();
      notify.success(typeof done === 'function' ? done(out) : done);
      onDone();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
      req.reload();
    } finally {
      setBusy(false);
    }
  };
  /* A refusal says why, whatever the kind: the person reads it in the employee app. */
  const reject = () => {
    if (!note.trim()) { setNoteError('Say why. They see this with the decision.'); noteRef.current?.focus(); return; }
    act(() => decideRequest(r.id, false, note.trim()), 'Rejected.');
  };
  const approve = () => act(() => decideRequest(r.id, true, note.trim() || undefined), (out) => (out?.stage === 'HR' ? 'Approved as the manager. It now waits for HR.' : 'Approved.'));
  const cancel = async () => {
    const ok = await confirmDialog({
      title: r.status === 'APPROVED' ? 'Cancel this request?' : 'Withdraw this request?',
      message: r.status === 'APPROVED' ? 'The days go back to what the punches say.' : undefined,
      confirmLabel: r.status === 'APPROVED' ? 'Cancel request' : 'Withdraw',
    });
    if (ok) act(() => cancelRequest(r.id, note.trim() || undefined), r.status === 'APPROVED' ? 'Request cancelled.' : 'Request withdrawn.');
  };

  if (editing && r) return <EnterRequest request={r} onClose={() => setEditing(false)} onDone={onDone} />;

  const cancellable = r && canDecide && (r.status === 'PENDING' || (r.status === 'APPROVED' && r.kind !== 'MISSED_PUNCH'));
  const actions = !r ? null : r.status === 'PENDING' && canDecide ? (
    <>
      <button type="button" className="ui-btn ui-btn-ghost mr-auto" disabled={busy} onClick={cancel}>Cancel</button>
      <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => setEditing(true)}>Change</button>
      <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={reject}><X size={16} aria-hidden="true" /> Reject</button>
      <button type="button" className="ui-btn ui-btn-primary" disabled={busy || Boolean(d.waitingForManager)} onClick={approve}><Check size={16} aria-hidden="true" /> Approve</button>
    </>
  ) : cancellable ? (
    <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={cancel}>Cancel request</button>
  ) : null;

  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)]" title={r ? `${r.employeeName}: ${KIND_NAME[r.kind] || r.kind}` : 'Attendance request'} actions={actions} dirty={Boolean(note.trim())}>
      {req.error ? <ErrorState error={req.error} onRetry={req.reload} compact /> : !d ? <div className="ui-skel ui-skel-text" aria-busy="true" /> : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Fact label="When"><WhenCell row={r} /></Fact>
            <Fact label="Status"><StatusPill row={r} /></Fact>
            {detailsText(r) ? <Fact label={r.kind === 'ON_DUTY' ? 'Place' : r.kind === 'PERMISSION' ? 'Hours' : 'Punches'}><span className="tabular-nums">{detailsText(r)}</span></Fact> : null}
            {d.chain ? <Fact label="Decided by">{{ HR: 'HR', MANAGER: 'The manager', MANAGER_THEN_HR: 'The manager, then HR' }[d.chain] || d.chain}</Fact> : null}
            <div className="col-span-2"><Fact label="Reason">{r.reason || <span className="ui-muted">None given</span>}</Fact></div>
            {r.reviewNote && r.status !== 'PENDING' ? <div className="col-span-2"><Fact label="Note">{r.reviewNote}</Fact></div> : null}
          </dl>

          {d.waitingForManager ? <p className="text-sm ui-text-warn">{d.waitingForManager}</p> : null}

          {d.usage ? (
            <section aria-labelledby="ar-usage" className="space-y-1">
              <h3 id="ar-usage" className="ui-t-sec">This month</h3>
              <p className="text-sm tabular-nums">{usageText(r.kind, d.usage)}{d.usage.quota != null ? <span className="ui-muted"> · {d.usage.left} left</span> : null}</p>
            </section>
          ) : null}

          {d.days?.length ? (
            <section aria-labelledby="ar-days" className="space-y-2">
              <h3 id="ar-days" className="ui-t-sec">The days as they stand</h3>
              <ul className="space-y-1 text-sm">
                {d.days.map((x) => (
                  <li key={x.date} className="flex gap-3"><span className="tabular-nums w-28 shrink-0">{formatDate(x.date)}</span><span>{x.status ? String(x.status).replace(/_/g, ' ').toLowerCase() : ''}{x.checkInTime ? <span className="tabular-nums ui-muted"> · {x.checkInTime}{x.checkOutTime ? `–${x.checkOutTime}` : ''}</span> : null}</span></li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="ar-history" className="space-y-2">
            <h3 id="ar-history" className="ui-t-sec">History</h3>
            <RequestHistory history={d.history} />
          </section>

          {r.status === 'PENDING' && canDecide ? (
            <div>
              <label htmlFor="ar-note" className="ui-label">Note to them</label>
              <textarea id="ar-note" ref={noteRef} className={`ui-input w-full ${noteError ? 'is-invalid' : ''}`} rows={2} maxLength={500} value={note} aria-invalid={Boolean(noteError)} aria-describedby={noteError ? 'ar-note-err' : undefined} onChange={(e) => { setNote(e.target.value); setNoteError(''); }} />
              {noteError ? <span id="ar-note-err" className="ui-field-error">{noteError}</span> : null}
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

const blank = { employeeId: '', kind: '', date: '', toDate: '', halfDay: '', place: '', checkIn: '', checkOut: '', reason: '' };
const fromRequest = (r) => ({ employeeId: r.employeeId, kind: r.kind, date: r.date, toDate: r.toDate || r.date, halfDay: r.halfDay || '', place: r.place || '', checkIn: inTime(r), checkOut: outTime(r), reason: r.reason || '' });

/**
 * Enter a request for someone, change a waiting one (`request`), or — with
 * `own` — ask for oneself (My days): the same fields per kind, the month's
 * usage for the person and kind before saving, the server's plain words on
 * refusal. `rules` and `usage` may be given (own mode) instead of fetched.
 */
export function EnterRequest({ onClose, onDone, request = null, own = false, rules: givenRules = null, usage: givenUsage = null, month: givenMonth = '' }) {
  const editing = Boolean(request);
  const start = useMemo(() => (request ? fromRequest(request) : blank), [request]);
  const [form, setForm] = useState(start);
  const [saving, setSaving] = useState(false);
  const people = useRequest(() => (editing || own ? Promise.resolve([]) : listPeople()), [editing, own]);
  const rulesReq = useRequest(() => (givenRules ? Promise.resolve({ rules: givenRules }) : getRequestRules()), [givenRules]);
  const rules = rulesReq.data?.rules || givenRules || null;
  const reasons = useSuggestions('requestReason');
  const places = useSuggestions('place');
  const kind = form.kind;
  const spans = SPANS.includes(kind);
  const oneDay = spans && form.date && (!form.toDate || form.toDate === form.date);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v, ...(k === 'date' && v && (!f.toDate || f.toDate < v) ? { toDate: v } : {}), ...(k === 'kind' ? { halfDay: '', place: '', checkIn: '', checkOut: '' } : {}) }));
  /* A kind that is off cannot be asked for; a missed punch always can. */
  const kindOptions = KINDS.filter((k) => k === 'MISSED_PUNCH' || !rules || rules[k]?.on || k === request?.kind).map((k) => ({ value: k, label: KIND_NAME[k] }));
  const month = form.date ? form.date.slice(0, 7) : '';
  const usageReq = useRequest(
    () => (own ? Promise.resolve(givenUsage && (!month || month === givenMonth) ? { usage: givenUsage } : null) : form.employeeId && kind && month ? requestUsage(form.employeeId, month, kind) : Promise.resolve(null)),
    [own, form.employeeId, kind, month, givenUsage, givenMonth],
  );
  const usage = usageReq.data?.usage?.[kind] || null;
  const dirty = JSON.stringify(form) !== JSON.stringify(start);
  const ready = Boolean((own || form.employeeId) && kind && form.date && form.reason.trim().length >= 3
    && (kind !== 'ON_DUTY' || form.place.trim()) && (kind !== 'MISSED_PUNCH' || form.checkIn) && (kind !== 'PERMISSION' || (form.checkIn && form.checkOut)));

  const save = async (e) => {
    e?.preventDefault();
    if (!ready || saving || (editing && !dirty)) return;
    setSaving(true);
    try {
      const body = {
        ...(own || editing ? {} : { employeeId: form.employeeId }),
        kind, date: form.date, reason: form.reason.trim(),
        toDate: spans && form.toDate && form.toDate !== form.date ? form.toDate : null,
        halfDay: oneDay && form.halfDay ? form.halfDay : null,
        place: kind === 'ON_DUTY' ? form.place.trim() : null,
        checkIn: kind === 'MISSED_PUNCH' || kind === 'PERMISSION' ? form.checkIn : null,
        checkOut: kind === 'MISSED_PUNCH' || kind === 'PERMISSION' ? form.checkOut || null : null,
      };
      if (editing) await (own ? updateMyRequest : updateRequest)(request.id, body);
      else await (own ? createMyRequest : createRequest)(body);
      notify.success(editing ? 'Changed. It waits in Waiting.' : own ? 'Sent for approval.' : 'Entered. It waits in Waiting.');
      onDone();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  const title = editing ? (own ? 'Change my request' : `Change ${request.employeeName}'s request`) : own ? 'Ask' : 'Enter request';
  return (
    <Drawer
      open
      onClose={onClose}
      widthClass="w-[min(36rem,96vw)]"
      dirty={dirty}
      title={title}
      actions={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="enter-request" className="ui-btn ui-btn-primary" disabled={!ready || saving || (editing && !dirty)}>{saving ? 'Saving…' : editing ? 'Save' : own ? 'Send' : 'Save'}</button>
      </>}
    >
      <form id="enter-request" onSubmit={save} className="space-y-4">
        {editing && !own
          ? <dl className="text-sm"><Fact label="Employee">{request.employeeName}{request.employeeCode ? <span className="ui-muted"> · {request.employeeCode}</span> : null}</Fact></dl>
          : own ? null
            : <PopupSelect showValueSubtext={false} label="Employee *" value={form.employeeId} onChange={(v) => set('employeeId', v || '')} placeholder="Choose…" alwaysSearch options={(people.data || []).map((x) => ({ value: x.id, label: x.code ? `${x.name} (${x.code})` : x.name }))} />}
        {editing
          ? <dl className="text-sm"><Fact label="Kind">{KIND_NAME[kind]}</Fact></dl>
          : <PopupSelect showValueSubtext={false} label="Kind *" value={kind} onChange={(v) => set('kind', v || '')} placeholder="Choose…" options={kindOptions} />}
        {kind ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><span className="ui-label" id="er-date">{spans ? 'First day *' : 'Day *'}</span><DatePicker label={spans ? 'First day' : 'Day'} describedBy="er-date" value={form.date} max={kind === 'MISSED_PUNCH' ? todayIst() : ''} onChange={(v) => set('date', v || '')} /></div>
              {spans ? <div><span className="ui-label" id="er-to">Last day *</span><DatePicker label="Last day" describedBy="er-to" value={form.toDate} min={form.date} onChange={(v) => set('toDate', v || '')} /></div> : null}
            </div>
            {oneDay ? (
              <PopupSelect showValueSubtext={false} label="Day" value={form.halfDay || 'WHOLE'} onChange={(v) => set('halfDay', v === 'WHOLE' ? '' : v || '')} options={[{ value: 'WHOLE', label: 'Whole day' }, { value: 'FIRST', label: 'First half' }, { value: 'SECOND', label: 'Second half' }]} />
            ) : null}
            {kind === 'ON_DUTY' ? (
              <label className="block">
                <span className="ui-label">Place *</span>
                <SuggestInput maxLength={120} value={form.place} onChange={(v) => set('place', v)} suggestions={places} />
              </label>
            ) : null}
            {kind === 'MISSED_PUNCH' || kind === 'PERMISSION' ? (
              <div className="grid grid-cols-2 gap-4">
                <label className="block"><span className="ui-label">{kind === 'PERMISSION' ? 'From *' : 'In *'}</span><input type="time" className="ui-input w-full tabular-nums" required value={form.checkIn} onChange={(e) => set('checkIn', e.target.value)} /></label>
                <label className="block"><span className="ui-label">{kind === 'PERMISSION' ? 'To *' : 'Out'}</span><input type="time" className="ui-input w-full tabular-nums" required={kind === 'PERMISSION'} value={form.checkOut} onChange={(e) => set('checkOut', e.target.value)} /></label>
              </div>
            ) : null}
            {kind === 'PERMISSION' && rules?.PERMISSION?.maxMinutes ? <p className="ui-caption">Up to {hoursText(rules.PERMISSION.maxMinutes)} at a time.</p> : null}
            <label className="block">
              <span className="ui-label">Reason *</span>
              <SuggestInput maxLength={500} value={form.reason} onChange={(v) => set('reason', v)} suggestions={reasons} />
            </label>
            {usage ? <p className="text-sm tabular-nums" aria-live="polite">{usageText(kind, usage)}{usage.quota != null ? `, ${usage.left} left in ${monthLabel(month)}` : ''}.</p> : null}
          </>
        ) : null}
      </form>
    </Drawer>
  );
}
