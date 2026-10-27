import React, { useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { notify } from '@ui/components/ui/notify';
import { formatDateIn } from '@ui/utils/dates';
import { usePermissions } from '@ui/permissions/usePermissions';
import { Avatar, SCHEDULED_LABELS } from '@ui/personnel/Employees';
import { can } from '@ui/timeOff/shared';
import { bulkReviewLeave, bulkReviewRequests } from '@ui/timeOff/api';
import { RequestDrawer as LeaveDrawer } from '@ui/timeOff/LeaveRequests';
import { RequestDrawer as AttendanceDrawer, KIND_NAME } from '@ui/timeOff/AttendanceRequests';
import { decideRequest, getInbox, listRequests, replyRequest, withdrawRequest } from '../api/approvals';

/* The fields a request can name, in plain words (never "photoUrl" or "addressLine"). */
const FIELD_WORDS = {
  photoUrl: 'Photo', firstName: 'First name', lastName: 'Last name', preferredName: 'Preferred name', phone: 'Phone', personalEmail: 'Personal email', email: 'Personal email',
  addressLine: 'Address', city: 'City', state: 'State', country: 'Country', pincode: 'PIN code', dateOfBirth: 'Date of birth', gender: 'Gender', maritalStatus: 'Marital status',
  emergencyContactName: 'Emergency contact', emergencyContactPhone: 'Emergency phone', emergencyContactRelation: 'Relationship', guardianName: 'Father / husband name',
};

/*
 * Approvals (HR view audit, gap 1): one inbox for everything waiting on me —
 * People approvals (profile, job, leaving, letters…), leave, attendance
 * requests (work from home, on duty, permission, missed punch) and Help Desk
 * cases that need a reply — oldest first, with a kind filter kept in the
 * address. A row opens the drawer or screen it belongs to; the rows that can
 * be decided together are approved or rejected at once with one note, each
 * through its own checks. "Asked by me" keeps what I sent for approval.
 */
const STATUS = { WAITING: 'Waiting for approval', APPROVED: 'Approved', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn', MORE_INFO: 'Asked for more' };
const STEP = { WAITING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', MORE_INFO: 'Asked for more', HANDED_ON: 'Handed on', SKIPPED: 'Skipped', WITHDRAWN: 'Withdrawn' };
const TONE = { WAITING: 'warn', APPROVED: 'pos', REJECTED: 'neg', WITHDRAWN: 'neutral', MORE_INFO: 'warn', HANDED_ON: 'neutral', SKIPPED: 'neutral' };
const TYPE = { PROFILE_CHANGE: 'Profile change', JOB_CHANGE: 'Job change', LEAVING: 'Leaving', DOCUMENT_REQUEST: 'Document', LETTER_REQUEST: 'Letter', POLICY_PUBLISH: 'Policy', DESK_ESCALATION: 'Help desk', SEAT_REQUEST: 'Seat', PROBATION: 'Probation' };
const TABS = [['waiting', 'Waiting for me'], ['mine', 'Asked by me']];
const INBOX_KIND = { LEAVE: 'Leave', ATTENDANCE: 'Attendance request', APPROVAL: 'People approval', HELPDESK: 'Help desk' };
const KIND_ORDER = ['LEAVE', 'ATTENDANCE', 'APPROVAL', 'HELPDESK'];

const day = (iso) => (iso ? formatDateIn(String(iso).slice(0, 10)) : '');
const range = (from, to) => (!from ? '' : !to || from === to ? day(from) : `${day(from)} – ${day(to)}`);
const waitedDays = (at) => Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000));
const waitedText = (at) => { const d = waitedDays(at); return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`; };
/** The finer kind, in words: a leave type, "Work from home", "Job change", a desk category. */
const whatOf = (i) => (i.kind === 'ATTENDANCE' ? KIND_NAME[i.subKind] || i.what : i.what);
const kindText = (i) => (i.kind === 'APPROVAL' ? TYPE[i.subKind] || INBOX_KIND.APPROVAL : INBOX_KIND[i.kind]);

export default function Approvals({ params = {}, updateParams, openScreen }) {
  const perms = usePermissions();
  const allowed = (k) => can(perms, k);
  const p = params || {};
  const tab = p.tab === 'mine' ? 'mine' : 'waiting';
  const kind = KIND_ORDER.includes(p.kind) ? p.kind : '';
  const page = Math.max(1, Number(p.page || 1));
  const size = [25, 50, 100].includes(Number(p.size)) ? Number(p.size) : 25;
  const set = (patch, push = false) => updateParams?.(patch, { push });
  const inbox = useRequest(() => getInbox(), []);
  const mine = useRequest(() => (tab === 'mine' ? listRequests() : Promise.resolve(null)), [tab]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkNote, setBulkNote] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, tab);

  const items = useMemo(() => inbox.data?.items || [], [inbox.data]);
  const counts = inbox.data?.counts || {};
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => items.filter((i) => (!kind || i.kind === kind) && (!needle || [i.employeeName, i.employeeCode, i.what, kindText(i)].some((v) => String(v || '').toLowerCase().includes(needle)))), [items, kind, needle]);
  const mineRows = useMemo(() => (mine.data?.mine || []).filter((r) => !needle || [r.title, TYPE[r.requestType]].some((v) => String(v || '').toLowerCase().includes(needle))), [mine.data, needle]);
  const list = tab === 'waiting' ? shown : mineRows;
  const pageRows = list.slice((page - 1) * size, page * size);
  const chosen = shown.filter((i) => selected.has(i.key) && i.bulk);
  const reload = () => { inbox.reload(); if (tab === 'mine') mine.reload(); };

  const decideMany = async (approve) => {
    if (!chosen.length || bulkBusy) return;
    const note = bulkNote.trim();
    if (!approve && !note) { notify.error('Say why. They see this with the decision.'); return; }
    setBulkBusy(true);
    let done = 0;
    let handedOn = 0;
    const failed = [];
    const ids = (k) => chosen.filter((i) => i.kind === k).map((i) => i.id);
    try {
      for (const [k, fn] of [['LEAVE', bulkReviewLeave], ['ATTENDANCE', bulkReviewRequests]]) {
        if (!ids(k).length) continue;
        try {
          const out = await fn(ids(k), approve, note || undefined);
          done += out.done || 0;
          handedOn += out.handedOn || 0;
          for (const r of out.results || []) failed.push(r.error);
        } catch (e) {
          failed.push(...ids(k).map(() => String(e?.message || 'Not done.')));
        }
      }
      /* People approvals have no bulk route: one decision each, the same as from the drawer. */
      for (const id of ids('APPROVAL')) {
        try {
          await decideRequest(id, approve ? 'approve' : 'reject', note || undefined);
          done += 1;
        } catch (e) {
          failed.push(String(e?.message || 'Not done.'));
        }
      }
      const did = approve ? 'approved' : 'rejected';
      const passed = handedOn ? `, ${handedOn} as the manager, now with HR` : '';
      if (failed.length) notify.error(`${done} ${did}${passed}; ${failed.length} not: ${failed[0]}`);
      else notify.success(`${done} ${did}${passed}.`);
      setSelected(new Set());
      setBulkNote('');
      inbox.reload();
    } finally {
      setBulkBusy(false);
    }
  };

  const openItem = (i) => {
    if (i.kind === 'HELPDESK') { openScreen?.('helpdesk', { id: i.id }); return; }
    setOpen(i);
  };

  const waitingColumns = [
    { key: 'employee', label: 'Person', always: true, render: (i) => (
      <span className="flex items-center gap-2.5 min-w-0">
        <Avatar person={{ name: i.employeeName, photoUrl: i.photoUrl }} size={32} />
        <span className="min-w-0">
          <span className="block truncate font-medium">{i.employeeName || '—'}</span>
          {i.employeeCode ? <span className="block truncate ui-caption">{i.employeeCode}</span> : null}
        </span>
      </span>
    ) },
    { key: 'kind', label: 'Kind', render: (i) => <span className="whitespace-nowrap">{kindText(i)}</span> },
    { key: 'what', label: 'Request', render: (i) => <span className="block max-w-xs truncate" title={whatOf(i)}>{whatOf(i)}</span> },
    { key: 'when', label: 'Dates', render: (i) => <span className="tabular-nums whitespace-nowrap">{range(i.fromDate, i.toDate)}{i.halfDay ? <span className="ui-caption block">Half day</span> : null}</span> },
    { key: 'days', label: 'Days', align: 'right', render: (i) => <span className="tabular-nums">{i.days ?? ''}</span> },
    { key: 'since', label: 'Waiting since', render: (i) => (
      <span className="inline-flex flex-col items-start gap-0.5 whitespace-nowrap">
        <span className={waitedDays(i.since) > 2 || i.overdue ? 'ui-text-warn' : ''}>{waitedText(i.since)}</span>
        {i.overdue ? <span className="ui-pill ui-pill-neg">Overdue</span> : i.managerApproved ? <span className="ui-caption">Manager approved</span> : null}
      </span>
    ) },
  ];
  const mineColumns = [
    { key: 'title', label: 'Request', always: true, render: (r) => <span className="font-medium">{r.title}</span> },
    { key: 'kind', label: 'Kind', render: (r) => TYPE[r.requestType] || r.requestType },
    { key: 'asked', label: 'Asked', render: (r) => <span className="tabular-nums">{day(r.createdAt)}</span> },
    { key: 'status', label: 'Status', render: (r) => <span className={`ui-pill ui-pill-${TONE[r.status] || 'neutral'}`}>{STATUS[r.status] || r.status}</span> },
  ];
  const kindOptions = [{ value: '', label: 'Every kind' }, ...KIND_ORDER.filter((k) => inbox.data?.rights?.[k]?.see).map((k) => ({ value: k, label: `${INBOX_KIND[k]}${counts[k] ? ` (${counts[k]})` : ''}` }))];
  const req = tab === 'waiting' ? inbox : mine;
  const filtered = Boolean(needle || (tab === 'waiting' && kind));

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: 'Home' }]} title="Approvals" />

      <div ref={tabsRef} role="tablist" aria-label="Approvals" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ui-tab ${tab === k ? 'is-active' : ''}`} onClick={() => { setSelected(new Set()); set({ tab: k === 'waiting' ? null : k, page: null }, true); }}>
            {l}{k === 'waiting' && counts.all ? <span className="ui-tab-count tabular-nums">{counts.all}</span> : null}
          </button>
        ))}
        {tabIndicator}
      </div>

      {tab === 'waiting' && chosen.length ? (
        <div className="ui-bulkbar" role="region" aria-label="Decide the chosen requests">
          <span className="text-sm"><strong className="tabular-nums">{chosen.length}</strong> chosen</span>
          <input className="ui-input w-full sm:w-72" aria-label="Note to them" placeholder="Note to them (needed to reject)" maxLength={500} value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} />
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={bulkBusy} onClick={() => decideMany(true)}><Check size={14} aria-hidden="true" /> Approve</button>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={bulkBusy || !bulkNote.trim()} onClick={() => decideMany(false)}><X size={14} aria-hidden="true" /> Reject</button>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : null}

      <DataTable
        label={tab === 'waiting' ? 'Waiting for me' : 'Asked by me'}
        columns={tab === 'waiting' ? waitingColumns : mineColumns}
        rows={pageRows}
        rowKey={tab === 'waiting' ? (i) => i.key : (r) => r.id}
        total={list.length}
        page={page}
        pageSize={size}
        noun="requests"
        selectable={tab === 'waiting' && shown.some((i) => i.bulk)}
        selected={selected}
        canSelect={(i) => Boolean(i.bulk)}
        onSelect={(next) => setSelected(new Set([...next].filter((key) => items.find((i) => i.key === key)?.bulk)))}
        onPage={(n) => set({ page: n > 1 ? n : null }, true)}
        onPageSize={(n) => set({ size: n === 25 ? null : n, page: null })}
        onRowClick={tab === 'waiting' ? openItem : (r) => setOpen({ kind: 'APPROVAL', id: r.id, mine: true })}
        loading={req.loading}
        refreshing={req.refreshing}
        card={tab === 'waiting' ? (i) => (
          <span className="flex items-center gap-3 min-w-0">
            <Avatar person={{ name: i.employeeName, photoUrl: i.photoUrl }} size={40} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{i.employeeName || '—'}</span><span className="ui-caption whitespace-nowrap">{waitedText(i.since)}</span></span>
              <span className="block truncate ui-caption">{kindText(i)} · {whatOf(i)}</span>
              {i.fromDate ? <span className="block truncate ui-caption tabular-nums">{range(i.fromDate, i.toDate)}</span> : null}
            </span>
          </span>
        ) : (r) => (
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.title}</span><span className={`ui-pill ui-pill-${TONE[r.status] || 'neutral'}`}>{STATUS[r.status] || r.status}</span></span>
            <span className="block truncate ui-caption">{TYPE[r.requestType] || r.requestType}</span>
          </span>
        )}
        toolbar={<>
          <SearchField value={q} onSearch={(v) => { setQ(v || ''); set({ page: null }); }} placeholder="Search name, employee ID or request" label="Search approvals" className="w-full sm:w-72" />
          {tab === 'waiting' ? <div className="w-full sm:w-56"><PopupSelect showValueSubtext={false} ariaLabel="Kind" value={kind} onChange={(v) => { setSelected(new Set()); set({ kind: v || null, page: null }); }} options={kindOptions} placeholder="Every kind" /></div> : null}
        </>}
        empty={req.error ? (
          <ErrorState error={req.error} onRetry={reload} />
        ) : filtered ? (
          <EmptyState kind="filtered" title="Nothing matches" onClearFilters={() => { setQ(''); set({ kind: null, page: null }); }} />
        ) : tab === 'waiting' ? (
          <EmptyState title="Nothing waiting for you" description="Leave, attendance requests, approvals and help desk cases that need you show here, oldest first." />
        ) : (
          <EmptyState title="You have not asked for anything yet" description="A change you send for approval shows here with each step." />
        )}
      />

      {open?.kind === 'LEAVE' ? <LeaveDrawer id={open.id} allowed={allowed} onClose={() => setOpen(null)} onDone={() => { setOpen(null); inbox.reload(); }} /> : null}
      {open?.kind === 'ATTENDANCE' ? <AttendanceDrawer id={open.id} allowed={allowed} onClose={() => setOpen(null)} onDone={() => { setOpen(null); inbox.reload(); }} /> : null}
      {open?.kind === 'APPROVAL' ? <ApprovalDrawer id={open.id} mine={Boolean(open.mine)} onClose={() => setOpen(null)} onDone={reload} /> : null}
    </div>
  );
}

/** A People approval with its steps: approve, reject with a reason, ask for more; or, for my own, answer or withdraw. */
function ApprovalDrawer({ id, mine, onClose, onDone }) {
  const list = useRequest(() => listRequests(), [id]);
  const [request, setRequest] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const open = request || [...(list.data?.waitingForMe || []), ...(list.data?.mine || [])].find((r) => r.id === id) || null;
  const deciding = open && open.status === 'WAITING' && !mine;

  const act = async (action) => {
    if (!open) return;
    if (action !== 'approve' && action !== 'withdraw' && !comment.trim()) { notify.error(action === 'reject' ? 'Say why it is not approved.' : 'Say what more is needed.'); return; }
    setBusy(action);
    try {
      const r = action === 'withdraw' ? await withdrawRequest(open.id) : action === 'reply' ? await replyRequest(open.id, comment.trim()) : await decideRequest(open.id, action, comment.trim() || undefined);
      setRequest(r.request);
      setComment('');
      notify.success(action === 'approve' ? (r.request.status === 'APPROVED' ? 'Approved and done.' : 'Approved; sent on to the next step.') : action === 'reject' ? 'Not approved.' : action === 'withdraw' ? 'Withdrawn.' : action === 'reply' ? 'Answer sent.' : 'Asked for more.');
      onDone();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy('');
    }
  };

  return (
    <Drawer open onClose={onClose} title={open?.title || 'Request'} widthClass="w-[min(40rem,96vw)]" dirty={Boolean(comment.trim())}
      actions={open ? (
        <>
          {deciding ? (
            <>
              <button type="button" className="ui-btn ui-btn-secondary" disabled={Boolean(busy)} onClick={() => act('more-info')}>Ask for more</button>
              <button type="button" className="ui-btn ui-btn-secondary" disabled={Boolean(busy)} onClick={() => act('reject')}>Reject</button>
              <button type="button" className="ui-btn ui-btn-primary" disabled={Boolean(busy)} onClick={() => act('approve')}>{busy === 'approve' ? 'Approving…' : 'Approve'}</button>
            </>
          ) : null}
          {mine && open.status === 'MORE_INFO' ? <button type="button" className="ui-btn ui-btn-primary" disabled={Boolean(busy)} onClick={() => act('reply')}>Send answer</button> : null}
          {mine && ['WAITING', 'MORE_INFO'].includes(open.status) ? <button type="button" className="ui-btn ui-btn-secondary" disabled={Boolean(busy)} onClick={() => act('withdraw')}>Withdraw</button> : null}
        </>
      ) : null}
    >
      {list.error && !open ? <ErrorState error={list.error} onRetry={list.reload} compact /> : !open ? <div className="ui-skel ui-skel-text" aria-busy="true" /> : (
        <div className="space-y-4 text-sm">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="ui-t-label">Kind</dt><dd>{TYPE[open.requestType] || open.requestType}</dd></div>
            <div><dt className="ui-t-label">Asked by</dt><dd>{open.requesterName} · {day(open.createdAt)}</dd></div>
            <div><dt className="ui-t-label">Status</dt><dd><span className={`ui-pill ui-pill-${TONE[open.status] || 'neutral'}`}>{STATUS[open.status] || open.status}</span></dd></div>
            <div><dt className="ui-t-label">Due</dt><dd className="tabular-nums">{open.status === 'WAITING' ? day(open.dueAt) : '—'}{open.overdue ? <span className="ui-pill ui-pill-neg ml-2">Overdue</span> : null}</dd></div>
          </dl>
          {open.payload?.fields ? (
            <div>
              <h3 className="ui-t-label mb-1">What changes</h3>
              <ul className="space-y-1">
                {Object.entries(open.payload.fields).map(([k, v]) => (
                  k === 'photoUrl' && open.payload.data?.photoUrl
                    /* A new photo is shown, not described: HR sees what they are approving. */
                    ? <li key={k} className="flex items-center gap-3"><span className="ui-muted">Photo:</span><img src={open.payload.data.photoUrl} alt="New photo asked for" className="h-16 w-16 rounded-full object-cover" /></li>
                    : <li key={k}><span className="ui-muted">{FIELD_WORDS[k] || SCHEDULED_LABELS[k] || k.replace(/Id$/, '')}</span>: <span className="ui-muted">{String(v.before ?? 'None')}</span> → <strong>{String(v.after ?? 'None')}</strong></li>
                ))}
              </ul>
              {open.payload.effectiveOn ? <p className="ui-caption mt-1">Takes effect {day(open.payload.effectiveOn)}</p> : null}
              {open.payload.reason ? <p className="mt-1">{open.payload.reason}</p> : null}
            </div>
          ) : null}
          <div>
            <h3 className="ui-t-label mb-1">Steps</h3>
            <ol className="space-y-2" aria-label="Approval steps">
              {open.steps.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <span className={`ui-pill ui-pill-${TONE[s.status] || 'neutral'}`}>{STEP[s.status] || s.status}</span>
                  <span>Step {s.order}: {s.decidedBy || s.candidates.join(' or ')}{s.standInFor ? ` (standing in for ${s.standInFor})` : ''}</span>
                  <span className="ui-caption tabular-nums">{s.status === 'WAITING' ? `due ${day(s.dueAt)}` : s.decidedAt ? day(s.decidedAt) : ''}</span>
                  {s.comment ? <span className="ui-caption">· {s.comment}</span> : null}
                </li>
              ))}
            </ol>
          </div>
          {deciding || (mine && open.status === 'MORE_INFO') ? (
            <label className="block">
              <span className="ui-label">{mine ? 'Your answer' : 'Comment (needed to reject or ask for more)'}</span>
              <textarea className="ui-input w-full" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
            </label>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
