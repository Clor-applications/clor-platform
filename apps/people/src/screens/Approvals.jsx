import { usePeoplePageSlot } from '@ui/components/list/PeoplePageLayout';
import { ExceptionTag } from '@ui/components/ui/ExceptionTag';
import { errorWords, enumWords } from '@ui/utils/errorWords';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import BulkOutcome from '@ui/components/list/BulkOutcome';
import { bulkOutcome, waitingFirst } from '@ui/picks/round57';
import { Check, X } from '@ui/components/ui/lineIcons';
import { ScanSearch } from '@ui/components/ui/navEmoji';
import ApproveActions from '@ui/components/ui/ApproveActions';

import { FilterTabs, ListEmpty as EmptyState } from '@ui/components/list/ListHeader';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import useJkList, { rowsIn } from '@ui/components/list/useJkList';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest, { useOnlineHint } from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { formatDate } from '@ui/components/ui/DatePicker';
import { usePermissions } from '@ui/permissions/usePermissions';
import { Avatar, SCHEDULED_LABELS } from '@ui/personnel/Employees';
import { can } from '@ui/timeOff/shared';
import { bulkReviewLeave, bulkReviewOvertime, bulkReviewPunches, bulkReviewRequests } from '@ui/timeOff/api';
import { RequestDrawer as LeaveDrawer } from '@ui/timeOff/LeaveRequests';
import { hoursBetween, hoursWords } from '@ui/timeOff/partOfDay';
import { RequestDrawer as AttendanceDrawer, KIND_NAME } from '@ui/timeOff/AttendanceRequests';
import { bulkDecideRequests, decideRequest, getInbox, getRequest, listRequests, replyRequest, withdrawRequest } from '../api/approvals';
import { updateChecklistTask } from '@ui/personnel/api';
import { requestFile } from '../api/requests';
import { openFile } from '@ui/requests/formFiles';
import MoneyRequestDetail from '../money/MoneyRequestDetail';
import { MONEY_TYPES } from '../money/words';
import { Button } from '@ui/components/ui/Primitives';

import RequestActivity from './RequestActivity';
import './Approvals.css';
import { addDaysIso, istDay, todayIst } from '@ui/utils/dates';
import { useChangeMessage, usePeopleUpdates } from './usePeopleUpdates';

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
const STATUS = { WAITING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn', MORE_INFO: 'Asked for more' };
const STEP = { WAITING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', MORE_INFO: 'Asked for more', HANDED_ON: 'Handed on', SKIPPED: 'Skipped', WITHDRAWN: 'Withdrawn' };
const TONE = { WAITING: 'warn', APPROVED: 'pos', REJECTED: 'neg', WITHDRAWN: 'neutral', MORE_INFO: 'warn', HANDED_ON: 'neutral', SKIPPED: 'neutral' };
const TYPE = { PROFILE_CHANGE: 'Profile change', JOB_CHANGE: 'Job change', LEAVING: 'Leaving', LEAVING_WITHDRAW: 'Staying on', DOCUMENT_REQUEST: 'Document', LETTER_REQUEST: 'Letter', POLICY_PUBLISH: 'Policy', DESK_ESCALATION: 'Help desk', SEAT_REQUEST: 'Position', PROBATION: 'Probation', SHIFT_SWAP: 'Shift swap', ...MONEY_TYPES };
/* A request type HR set up (FORM:<id>, gap 25) is named by its form; one asked before the name was read shows as a request. */
const typeOf = (requestType, payload) => TYPE[requestType] || (String(requestType || '').startsWith('FORM:') ? payload?.formName || 'Request' : enumWords(requestType));
/* To approve, then my own open tasks (joining, leaving, probation, letters: People plan 8 Nov 2026, step 2), then what I asked for. */
const TABS = [['waiting', 'To approve'], ['tasks', 'My tasks'], ['mine', 'Asked by me']];
const TASK_KIND = { JOINING: 'Joining', LEAVING: 'Leaving', CHANGE: 'Change', PROBATION: 'Probation', RENEWAL: 'Renewal', LETTER: 'Letter', LEAVING_WITHDRAWN: 'Leaving withdrawn' };
const INBOX_KIND = { LEAVE: 'Leave', ATTENDANCE: 'Attendance request', PUNCH: 'Field punch', OVERTIME: 'Overtime', APPROVAL: 'People approval', HELPDESK: 'Help desk' };
const KIND_ORDER = ['LEAVE', 'ATTENDANCE', 'PUNCH', 'OVERTIME', 'APPROVAL', 'HELPDESK'];
/* Each kind's own bulk route: its checks hold per request (a field punch takes no note). */
const BULK = { LEAVE: bulkReviewLeave, ATTENDANCE: bulkReviewRequests, PUNCH: bulkReviewPunches, OVERTIME: bulkReviewOvertime, APPROVAL: bulkDecideRequests };
const hoursText = (m) => (m ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : '');

/* "3 Nov 2026", as every other People list writes a day. */
const day = (iso) => (iso ? formatDate(String(iso).slice(0, 10)) : '');
const range = (from, to) => (!from ? '' : !to || from === to ? day(from) : `${day(from)} – ${day(to)}`);
/* Which half of a half day, as the leave drawer writes it (#80 QA: "Half day" alone did not say which). */
const halfText = (h) => (h === 'FIRST' ? 'First half' : h === 'SECOND' ? 'Second half' : h ? 'Half day' : '');
const waitedDays = (at) => at && Number.isFinite(Date.parse(at)) ? Math.max(0, (Date.parse(todayIst()) - Date.parse(istDay(at))) / 86_400_000) : null;
const waitedText = (at) => { const d = waitedDays(at); return d == null ? '—' : d === 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`; };
/** The finer kind, in words: a leave type, "Work from home", "Job change", a desk category. */
const whatOf = (i) => {
  if (i.kind === 'ATTENDANCE') return KIND_NAME[i.subKind] || i.what;
  /* The kind column already says "Field punch" or "Overtime": the request says what of it. */
  if (i.kind === 'PUNCH') return `${i.subKind === 'OUT' ? 'Out' : 'In'}${i.fromTime ? ` at ${i.fromTime}` : ''}`;
  if (i.kind === 'OVERTIME') return i.subKind === 'COMP_OFF' ? `${i.days} day${i.days === 1 ? '' : 's'} comp-off` : hoursText(i.minutes) || i.what;
  return i.what;
};
/* The reader's own leave, theirs to decide only because of the company's maker-checker setting (A-13): said on the row, never chosen in bulk. */
const OWN_NOTE = { ONLY_APPROVER: 'Your own. You’re the only approver, so this is logged.', ALLOWED: 'Your own. Your company lets you decide it; this is logged.' };
const kindText = (i) => (i.kind === 'APPROVAL' ? TYPE[i.subKind] || (String(i.subKind || '').startsWith('FORM:') ? 'Request' : INBOX_KIND.APPROVAL) : INBOX_KIND[i.kind]);

function taskTiming(task, today) {
  if (!task.dueDate) return '';
  if (task.overdue || task.dueDate < today) return 'Overdue';
  if (task.dueDate === today) return 'Due today';
  if (task.dueDate === addDaysIso(today, 1)) return 'Tomorrow';
  return '';
}

function requestUpdate(request) {
  const steps = request.steps || [];
  if (request.status === 'MORE_INFO') return steps.findLast((step) => step.status === 'MORE_INFO')?.comment;
  if (request.status === 'WAITING' && request.dueAt) return `Decision due ${day(request.dueAt)}`;
  const decision = steps.findLast((step) => step.status === request.status && step.decidedAt);
  return decision ? [decision.decidedBy, day(decision.decidedAt)].filter(Boolean).join(' · ') : '';
}

function describeQueueChange(before, after) {
  const previous = new Map(before.map((row) => [row.key, row]));
  const current = new Set(after.map((row) => row.key));
  const changes = [];
  for (const row of after) {
    const earlier = previous.get(row.key);
    if (!earlier) changes.push(`${row.queue === 'tasks' ? 'New task' : 'New request'} · ${row.name}`);
    else if (earlier.details !== row.details) changes.push(`${row.status || 'Updated'} · ${row.name}`);
  }
  for (const row of before) {
    if (!current.has(row.key)) changes.push(`${row.queue === 'waiting' ? 'No longer waiting' : 'Removed'} · ${row.name}`);
  }
  return changes.length > 1 ? `${changes[0]} (+${changes.length - 1} more)` : changes[0];
}

export default function Approvals({ params = {}, updateParams, openScreen }) {
  const [helpSlot] = usePeoplePageSlot('heading');
  const [columnsSlot] = usePeoplePageSlot('toolbar');
  const online = useOnlineHint();
  const perms = usePermissions();
  const allowed = (k) => can(perms, k);
  const p = params || {};
  const kind = KIND_ORDER.includes(p.kind) ? p.kind : '';
  const set = (patch, push = false) => updateParams?.(patch, { push });
  const inbox = useRequest(() => getInbox(), []);
  /* The inbox opens on what there is to do: with nothing to approve and tasks on my name, My tasks (People plan 8 Nov 2026, step 3). */
  const askedTab = p.tab === 'mine' ? 'mine' : p.tab === 'tasks' ? 'tasks' : p.tab === 'waiting' ? 'waiting' : null;
  const loadedCounts = inbox.data?.counts || null;
  const [initialTab, setInitialTab] = useState(null);
  const suggested = loadedCounts && !loadedCounts.all && loadedCounts.TASK ? 'tasks' : 'waiting';
  useEffect(() => {
    if (loadedCounts && !initialTab) setInitialTab(suggested);
  }, [loadedCounts, initialTab, suggested]);
  const tab = askedTab || initialTab || suggested;
  const personalQueue = tab === 'tasks' || tab === 'mine';
  const mine = useRequest(() => (personalQueue ? listRequests() : Promise.resolve(null)), [personalQueue]);
  const [q, setQ] = useState('');
  /* A notice about a request (a withdrawn one says "Withdrawn") opens it here: ?open=APPROVAL&id=… */
  const [open, setOpen] = useState(() => (p.open === 'APPROVAL' && p.id ? { kind: 'APPROVAL', id: String(p.id) } : null));
  const [selected, setSelected] = useState(() => new Set());
  const [bulkNote, setBulkNote] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  const items = useMemo(() => inbox.data?.items || [], [inbox.data]);
  usePeopleUpdates(() => {
    if (!inbox.loading && !inbox.refreshing) inbox.reload();
    if (personalQueue && !mine.loading && !mine.refreshing) mine.reload();
  });
  const activityRows = useMemo(() => {
    if (tab === 'mine') return mine.data?.mine?.map((r) => ({
      key: r.id, name: r.title, queue: 'mine', status: STATUS[r.status], details: JSON.stringify([r.title, r.status, r.updatedAt]),
    }));
    if (!inbox.data) return null;
    if (tab === 'tasks') return (inbox.data.tasks || []).map((t) => ({
      key: t.id, name: t.title, queue: 'tasks', details: JSON.stringify([t.title, t.dueDate, t.overdue, t.employee?.name]),
    }));
    return items.map((i) => ({
      key: i.key, name: [i.employeeName, kindText(i)].filter(Boolean).join(' · '), queue: 'waiting',
      details: JSON.stringify([i.employeeName, whatOf(i), i.fromDate, i.toDate, i.days, i.step, i.managerApproved, i.overdue, i.cancelAsked]),
    }));
  }, [tab, items, inbox.data, mine.data]);
  const activity = useChangeMessage(activityRows, describeQueueChange, tab);
  const counts = inbox.data?.counts || {};
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => items.filter((i) => (!kind || i.kind === kind) && (!needle || [i.employeeName, i.employeeCode, i.what, kindText(i)].some((v) => String(v || '').toLowerCase().includes(needle)))), [items, kind, needle]);
  /* Round 57 waitingfirst A: my own requests still waiting come first, the oldest on top; then the rest, newest first. */
  const mineRows = useMemo(() => waitingFirst((mine.data?.mine || []).filter((r) => !needle || [r.title, typeOf(r.requestType, r.payload)].some((v) => String(v || '').toLowerCase().includes(needle))), (r) => ['WAITING', 'MORE_INFO'].includes(r.status)), [mine.data, needle]);
  const taskRows = useMemo(() => (inbox.data?.tasks || []).filter((t) => !needle || [t.title, t.employee?.name, t.employee?.code, TASK_KIND[t.kind]].some((v) => String(v || '').toLowerCase().includes(needle))), [inbox.data, needle]);
  const today = todayIst();
  const weekEnd = addDaysIso(today, 6);
  const scopes = tab === 'tasks' ? [
    { key: 'late', label: 'Overdue', match: (t) => taskTiming(t, today) === 'Overdue' },
    { key: 'week', label: 'Due in 7 days', match: (t) => t.dueDate >= today && t.dueDate <= weekEnd },
  ] : tab === 'mine' ? [
    { key: 'reply', label: 'Needs reply', match: (r) => r.status === 'MORE_INFO' },
    { key: 'pending', label: 'Awaiting decision', match: (r) => r.status === 'WAITING' },
    { key: 'closed', label: 'Closed', match: (r) => ['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(r.status) },
  ] : [];
  const rows = tab === 'waiting' ? shown : tab === 'tasks' ? taskRows : mineRows;
  const scope = scopes.find((item) => item.key === p.focus);
  const list = scope ? rows.filter(scope.match) : rows;
  const chosen = shown.filter((i) => selected.has(i.key) && i.bulk);
  const reload = () => { inbox.reload(); if (personalQueue) mine.reload(); };

  const [outcome, setOutcome] = useState(null);
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
      /* Each source's own bulk route runs in parallel; one refused never stops the rest. */
      const routes = Object.entries(BULK).filter(([k]) => ids(k).length);
      const outs = await Promise.allSettled(routes.map(([k, fn]) => fn(ids(k), approve, note || undefined)));
      for (const [i, res] of outs.entries()) {
        const [k] = routes[i];
        if (res.status === 'fulfilled') {
          done += res.value.done || 0;
          handedOn += res.value.handedOn || 0;
          for (const r of res.value.results || []) if (r.error) failed.push({ id: r.id, ok: false, error: r.error, kind: k });
        } else {
          failed.push(...ids(k).map((id) => ({ id, ok: false, error: errorWords(res.reason, 'decide it'), kind: k })));
        }
      }
      const did = approve ? 'approved' : 'rejected';
      const passed = handedOn ? `, ${handedOn} as the manager, now with HR` : '';
      /* Round 57 bulkresult A: "12 approved · 2 could not be", and for each, whose and why. */
      if (failed.length) {
        const nameOf = (id) => chosen.find((i) => i.id === id)?.employeeName;
        setOutcome({ ...bulkOutcome({ done, results: failed, nameOf }), verb: `${did}${passed}` });
      } else { setOutcome(null); notify.success(`${done} ${did}${passed}.`); }
      setSelected(new Set());
      setBulkNote('');
      inbox.reload();
    } finally {
      setBulkBusy(false);
    }
  };

  /* Approve one request from its row, as on Home (owner, 28 Oct 2026 audit): one inbox, decided in place. Rejecting still opens it, for the reason. */
  /* Busy per row, not one flag for the page: approving Asha's leave must not
     block approving Ravi's while the first is still on its way. */
  const [rowBusy, setRowBusy] = useState(() => new Set());
  const rowBusyRef = useRef(new Set());
  const jkRef = useRef(null);
  useJkList(jkRef);
  const approveOne = async (i) => {
    const fn = BULK[i.kind];
    if (!fn || rowBusyRef.current.has(i.key)) return;
    rowBusyRef.current.add(i.key);
    setRowBusy(new Set(rowBusyRef.current));
    try {
      const out = await fn([i.id], true);
      const err = (out.results || [])[0]?.error;
      if (err) notify.error(err);
      else {
        notify.success(out.handedOn ? 'Approved as the manager; now with HR.' : `Approved: ${i.employeeName || 'request'}.`);
        /* Decided, so no longer a choice: left in the selection it would count
           towards the bulk bar and be sent again with the next bulk decision. */
        setSelected((s) => { if (!s.has(i.key)) return s; const n = new Set(s); n.delete(i.key); return n; });
      }
      inbox.reload();
    } catch (e) {
      notify.error(errorWords(e, 'save your decision'));
    } finally {
      rowBusyRef.current.delete(i.key);
      setRowBusy(new Set(rowBusyRef.current));
    }
  };

  const openItem = (i) => {
    if (i.kind === 'HELPDESK') { openScreen?.('helpdesk', { id: i.id }); return; }
    setOpen(i);
  };

  /* A task on my name, done from its row: the same tick as the employee's plan and Tasks › Mine. A step that needs a note says so. */
  const finishTask = async (t, trigger) => {
    if (rowBusyRef.current.has(t.id)) return;
    rowBusyRef.current.add(t.id);
    setRowBusy(new Set(rowBusyRef.current));
    try {
      await updateChecklistTask(t.id, { done: true });
      // Keep the reading position when the completed row disappears.
      if (document.activeElement === trigger && jkRef.current?.contains(trigger)) {
        const rows = rowsIn(jkRef.current);
        const index = rows.findIndex((button) => button.closest('tr, li')?.contains(trigger));
        const neighbour = rows[index + 1] || rows[index - 1];
        (neighbour || jkRef.current.closest('.people-inbox')?.querySelector('[role="tab"][aria-selected="true"]'))?.focus();
      }
      inbox.setData((current) => {
        if (!current?.tasks?.some((task) => task.id === t.id)) return current;
        const tasks = current.tasks.filter((task) => task.id !== t.id);
        const counts = { ...current.counts };
        if (counts.TASK != null) counts.TASK = Math.max(0, counts.TASK - 1);
        if (counts.waiting != null) counts.waiting = Math.max(0, counts.waiting - 1);
        return { ...current, tasks, counts };
      });
      notify.success(`${t.title}: done.`);
      inbox.reload();
    } catch (e) {
      notify.error(errorWords(e, 'mark the task done'));
    } finally {
      rowBusyRef.current.delete(t.id);
      setRowBusy(new Set(rowBusyRef.current));
    }
  };

  const waitingColumns = [
    { key: 'employee', label: 'Person', width: '23%', always: true, render: (i) => (
      <span className="inbox-person">
        <Avatar person={{ name: i.employeeName, photoUrl: i.photoUrl }} size={32} />
        <span className="min-w-0">
          <span className="inbox-name">{i.employeeName || '—'}</span>
          {i.employeeCode ? <span className="block truncate ui-caption ui-mono">{i.employeeCode}</span> : null}
        </span>
      </span>
    ) },
    { key: 'kind', label: 'Kind', width: '15%', render: (i) => <span className="inbox-kind" data-kind={i.kind}>{kindText(i)}</span> },
    { key: 'what', label: 'Request', width: '21%', render: (i) => (
      <span className="inbox-detail">
        <span className="block">{whatOf(i)}</span>
        {OWN_NOTE[i.own] ? <span className="block ui-caption whitespace-normal">{OWN_NOTE[i.own]}</span> : null}
        {/* Round 47: approved leave the person asks to cancel; opened, it reads Approve cancellation or Keep leave. */}
        {i.cancelAsked ? <span className="block ui-caption whitespace-normal">Asks to cancel approved leave{i.reason ? `: “${i.reason}”` : ''}. Open it to decide.</span> : null}
      </span>
    ) },
    { key: 'when', label: 'Dates', width: '17%', render: (i) => <span className="tabular-nums whitespace-nowrap">{range(i.fromDate, i.toDate)}{i.halfDay ? <span className="ui-caption block">{halfText(i.halfDay)}</span> : i.fromTime && i.toTime ? <span className="ui-caption block">{i.fromTime}–{i.toTime}</span> : null}</span> },
    /* Hourly leave reads in hours (gap 23), not a fraction of a day. */
    { key: 'days', label: 'Days', width: '1%', align: 'right', render: (i) => <span className="tabular-nums">{i.fromTime && i.toTime ? hoursWords(hoursBetween(i.fromTime, i.toTime)) : i.days ?? ''}</span> },
    { key: 'since', label: 'Waiting since', width: '16%', render: (i) => (
      <span className="inline-flex flex-col items-center gap-0.5 whitespace-nowrap">
        <span className="inbox-age" data-tone={i.overdue ? 'late' : waitedDays(i.since) > 2 ? 'aging' : 'normal'}>{waitedText(i.since)}</span>
        {i.overdue ? <ExceptionTag label="Overdue" tone="neg" /> : i.managerApproved ? <span className="ui-pill ui-pill-info">Manager approved</span> : i.step > 1 ? <span className="ui-caption">Step {i.step}</span> : null}
      </span>
    ) },
    /* The header names the column for screen readers; sighted people read the buttons. */
    /* Tick and cross (owner's style pick, 17 Nov 2026): the tick approves in place; the cross opens the request, where a reason is asked for. */
    { key: 'act', label: <span className="sr-only">Actions</span>, width: '1%', align: 'right', always: true, render: (i) => (i.bulk || OWN_NOTE[i.own] ? (
      <ApproveActions what={`${whatOf(i)}${i.employeeName ? ` for ${i.employeeName}` : ''}`} busy={rowBusy.has(i.key)} onApprove={() => approveOne(i)} onReject={() => openItem(i)} rejectTitle="Reject (asks for a reason)" />
    ) : null) },
  ];
  const doneButton = (task) => (
    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm inbox-complete" aria-disabled={rowBusy.has(task.id) || undefined} aria-busy={rowBusy.has(task.id) || undefined} onClick={(e) => { e.stopPropagation(); finishTask(task, e.currentTarget); }}>
      <Check size={14} aria-hidden="true" /> {rowBusy.has(task.id) ? 'Saving…' : 'Mark done'}
    </button>
  );
  const openMine = (r) => setOpen({ kind: 'APPROVAL', id: r.id, mine: true });
  const requestSummary = (request) => {
    const update = requestUpdate(request);
    return <span className="inbox-request-copy"><strong className="inbox-record-name">{request.title}</strong>{update && <small className="ui-caption">{update}</small>}</span>;
  };
  const taskColumns = [
    { key: 'task', label: 'Task', width: '32%', always: true, render: (t) => <strong className="inbox-record-name">{t.title}</strong> },
    { key: 'employee', label: 'Employee', width: '21%', render: (t) => <span>{t.employee?.name || '—'}{t.employee?.code && <small className="block ui-caption ui-mono">{t.employee.code}</small>}</span> },
    { key: 'type', label: 'Type', width: '15%', render: (t) => <span className="inbox-kind" data-kind={t.kind}>{TASK_KIND[t.kind] || enumWords(t.kind)}</span> },
    { key: 'due', label: 'Due date', width: '17%', render: (t) => <span className={`whitespace-nowrap tabular-nums ${t.overdue ? 'ui-text-neg' : ''}`}>{t.dueDate ? day(t.dueDate) : '—'}{taskTiming(t, today) && <small className="block inbox-deadline">{taskTiming(t, today)}</small>}</span> },
    { key: 'act', label: 'Action', width: '15%', always: true, render: doneButton },
  ];
  const requestStatus = (r) => <ExceptionTag label={r.status === 'MORE_INFO' ? 'Needs your reply' : STATUS[r.status] || enumWords(r.status)} tone={TONE[r.status] || 'neutral'} />;
  const mineColumns = [
    { key: 'title', label: 'Request', width: '32%', always: true, render: requestSummary },
    { key: 'kind', label: 'Type', width: '21%', render: (r) => <span className="inbox-kind" data-kind="APPROVAL">{typeOf(r.requestType, r.payload)}</span> },
    { key: 'asked', label: 'Submitted', width: '17%', render: (r) => <span className="whitespace-nowrap tabular-nums">{day(r.createdAt)}</span> },
    { key: 'status', label: 'Status', width: '15%', render: requestStatus },
    { key: 'act', label: 'Action', width: '15%', render: (r) => <button type="button" className="ui-link" onClick={() => openMine(r)}>{r.status === 'MORE_INFO' ? 'Reply' : 'View request'}</button> },
  ];
  const kindOptions = [{ value: '', label: 'All types' }, ...KIND_ORDER.filter((k) => inbox.data?.rights?.[k]?.see).map((k) => ({ value: k, label: `${INBOX_KIND[k]}${counts[k] ? ` (${counts[k]})` : ''}` }))];
  const req = tab === 'mine' ? mine : inbox;
  const tabCount = { waiting: counts.all, tasks: counts.TASK };
  const filtered = Boolean(scope || needle || (tab === 'waiting' && kind));

  return (
    <div className="people-inbox" data-queue={tab} data-column-sizing="content">
      <div className="inbox-title-row">
        <h1 className="inbox-heading">Inbox</h1>
        {helpSlot && <span ref={helpSlot} className="people-help-slot" />}
        <span className="inbox-sync" role="status" data-paused={!online || Boolean(req.error)}>
          {!online ? 'Offline' : req.error ? 'Update failed' : req.loading ? 'Loading' : activity ? <>
            <time dateTime={activity.at.toISOString()}>{activity.at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</time> {activity.text}
          </> : 'Auto-updating'}
        </span>
      </div>
      <div className="inbox-workarea">
        <div className="inbox-list-pane">
          <div className="inbox-toolbar">
            <FilterTabs
              appearance="underline"
              tabs={TABS.map(([key, label]) => ({ key, label, count: tabCount[key], tone: key === 'waiting' ? 'warn' : 'info' }))}
              value={tab}
              onChange={(key) => { if (key === tab) return; setSelected(new Set()); setQ(''); set({ tab: key, focus: null, page: null }, true); }}
              label="Approvals"
            />
            <div className="inbox-filters">
              <SearchField key={tab} icon={ScanSearch} value={q} onSearch={setQ} placeholder={tab === 'tasks' ? 'Search tasks' : 'Search requests'} label={tab === 'tasks' ? 'Search tasks' : 'Search approvals'} />
              {tab === 'waiting' && (
                <div className="inbox-type-filter" data-active={Boolean(kind)}>
                  <PopupSelect icon={null} panelAlign="end" panelMinWidth={176} showValueSubtext={false} ariaLabel="Kind" value={kind} onChange={(v) => { setSelected(new Set()); set({ kind: v || null, page: null }); }} options={kindOptions} placeholder="All types" />
                </div>
              )}
              {columnsSlot && <span ref={columnsSlot} className="people-columns-slot" />}
            </div>
          </div>

          {scopes.length > 0 && !req.loading && !req.error && (rows.length > 0 || scope) && (
            <div className="inbox-scope" role="group" aria-label={tab === 'tasks' ? 'Filter by deadline' : 'Filter by progress'}>
              <button type="button" aria-pressed={!scope} onClick={() => set({ focus: null })}>All <b>{rows.length}</b></button>
              {scopes.map(({ key, label, match }) => (
                <button key={key} type="button" aria-pressed={scope?.key === key} onClick={() => set({ focus: key })}>{label} <b>{rows.filter(match).length}</b></button>
              ))}
            </div>
          )}
          <BulkOutcome outcome={outcome} verb={outcome?.verb} onClose={() => setOutcome(null)} />
          {tab === 'waiting' && chosen.length ? (
            <div className="ui-bulkbar" role="region" aria-label="Decide the chosen requests">
              <span className="text-sm"><strong className="tabular-nums">{chosen.length}</strong> chosen</span>
              <input className="ui-input w-full sm:w-72" aria-label="Note to them" placeholder="Note to them (needed to reject)" maxLength={500} value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} />
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={bulkBusy} onClick={() => decideMany(true)}><Check size={14} aria-hidden="true" /> Approve</button>
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={bulkBusy || !bulkNote.trim()} onClick={() => decideMany(false)}><X size={14} aria-hidden="true" /> Reject</button>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          ) : null}

          <div ref={jkRef} className="inbox-records">
          <DataTable
            label={tab === 'waiting' ? 'To approve': tab === 'tasks' ? 'My tasks' : 'Asked by me'}
            columns={tab === 'waiting' ? waitingColumns.filter((col) => col.key !== 'days' || shown.some((i) => i.days != null || (i.fromTime && i.toTime))) : tab === 'tasks' ? taskColumns : mineColumns}
            rows={list}
            prefs={{ density: 'compact' }}
            rowKey={tab === 'waiting' ? (i) => i.key : (r) => r.id}
            selectable={tab === 'waiting' && shown.some((i) => i.bulk)}
            selected={selected}
            canSelect={(i) => Boolean(i.bulk)}
            onSelect={(next) => setSelected(new Set([...next].filter((key) => items.find((i) => i.key === key)?.bulk)))}
            onRowClick={tab === 'waiting' ? openItem : tab === 'tasks' ? (t) => (t.employee?.id ? openScreen?.('employee', { id: t.employee.id }) : undefined) : openMine}
            loading={req.loading}
            refreshing={req.refreshing}
            cardActions={tab === 'tasks' ? doneButton : null}
            card={tab === 'waiting' ? (i) => (
              <span className="flex items-center gap-3 min-w-0">
                <Avatar person={{ name: i.employeeName, photoUrl: i.photoUrl }} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2"><span className="truncate">{i.employeeName || '—'}</span><span className="ui-caption whitespace-nowrap">{waitedText(i.since)}</span></span>
                  <span className="block truncate ui-caption">{kindText(i)} · {whatOf(i)}</span>
                  {i.fromDate ? <span className="block truncate ui-caption tabular-nums">{range(i.fromDate, i.toDate)}{i.halfDay ? `, ${halfText(i.halfDay).toLowerCase()}` : i.fromTime && i.toTime ? `, ${i.fromTime}–${i.toTime}` : ''}</span> : null}
                  {OWN_NOTE[i.own] ? <span className="block ui-caption">{OWN_NOTE[i.own]}</span> : null}
                </span>
              </span>
            ) : tab === 'tasks' ? (t) => (
              <span className="inbox-mobile-record">
                <strong className="inbox-record-name">{t.title}</strong>
                <span className="ui-caption">{[TASK_KIND[t.kind] || enumWords(t.kind), t.employee?.name].filter(Boolean).join(' · ')}</span>
                {t.dueDate && <span className={t.overdue ? 'ui-text-neg' : 'ui-caption'}>{taskTiming(t, today) || 'Due'} · {day(t.dueDate)}</span>}
              </span>
            ) : (r) => (
              <span className="inbox-mobile-record">
                {requestSummary(r)}
                <span className="ui-caption">{typeOf(r.requestType, r.payload)} · {day(r.createdAt)}</span>
                {requestStatus(r)}
              </span>
            )}
            empty={req.error ? (
              <ErrorState error={req.error} onRetry={reload} />
            ) : filtered ? (
              <EmptyState kind="filtered" title="Nothing matches" onClearFilters={() => { setQ(''); set({ kind: null, focus: null, page: null }); }} />
            ) : tab === 'waiting' ? (
              <EmptyState title="Nothing waiting for you" description="Leave, attendance requests, approvals and help desk cases that need you show here, oldest first." />
            ) : tab === 'tasks' ? (
              <EmptyState title="No open tasks" />
            ) : (
              <EmptyState title="No submitted requests" description="Requests you submit for approval appear here." />
            )}
          />
          {list.length ? (
            <p className="ui-caption ui-kbd-hint mt-2" aria-hidden="true"><kbd className="ui-kbd">J</kbd> <kbd className="ui-kbd">K</kbd> move · <kbd className="ui-kbd">Enter</kbd> open{tab === 'waiting' && <> · <kbd className="ui-kbd">A</kbd> approve</>}</p>
          ) : null}
          </div>

        </div>
        {personalQueue && !mine.error && mine.data?.mine && <RequestActivity requests={mine.data.mine} onOpen={openMine} />}
      </div>
      {open?.kind === 'LEAVE' ? <LeaveDrawer id={open.id} allowed={allowed} onClose={() => setOpen(null)} onDone={() => { setOpen(null); inbox.reload(); }} /> : null}
      {open?.kind === 'ATTENDANCE' ? <AttendanceDrawer id={open.id} allowed={allowed} onClose={() => setOpen(null)} onDone={() => { setOpen(null); inbox.reload(); }} /> : null}
      {open?.kind === 'PUNCH' || open?.kind === 'OVERTIME' ? <TimeDrawer item={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); inbox.reload(); }} /> : null}
      {open?.kind === 'APPROVAL' ? <ApprovalDrawer id={open.id} mine={Boolean(open.mine)} onClose={() => setOpen(null)} onDone={reload} /> : null}
    </div>
  );
}

/**
 * A field punch or an overtime request, from the inbox row: who, when, and
 * what they said; approve, or reject (overtime needs a reason, which the
 * person reads). A field punch approved counts like any punch; refused, it
 * stays on record and never counts.
 */
function TimeDrawer({ item, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const noteRef = useRef(null);
  const [busy, setBusy] = useState('');
  const punch = item.kind === 'PUNCH';
  const act = async (approve) => {
    if (busy) return;
    if (!approve && !punch && !note.trim()) { setNoteError('Say why. They see this with the decision.'); noteRef.current?.focus(); return; }
    setNoteError('');
    setBusy(approve ? 'approve' : 'reject');
    try {
      const out = await BULK[item.kind]([item.id], approve, punch ? undefined : note.trim() || undefined);
      const err = (out.results || [])[0]?.error;
      if (err) { notify.error(err); return; }
      notify.success(approve ? (out.handedOn ? 'Approved as the manager; now with HR.' : 'Approved.') : punch ? 'Rejected; the punch does not count.' : 'Rejected.');
      onDone();
    } catch (e) {
      notify.error(errorWords(e, 'save your decision'));
    } finally {
      setBusy('');
    }
  };
  return (
    <Drawer open onClose={onClose} title={`${INBOX_KIND[item.kind]}: ${item.employeeName || '—'}`} widthClass="w-[min(32rem,96vw)]" dirty={Boolean(note.trim())}
      actions={<>
        <Button variant="ghost" loading={busy === 'reject'} disabled={Boolean(busy)} onClick={() => act(false)}>Reject</Button>
        <Button variant="primary" loading={busy === 'approve'} disabled={Boolean(busy)} onClick={() => act(true)}>Approve</Button>
      </>}
    >
      <div className="space-y-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="ui-t-label">Day</dt><dd className="tabular-nums">{day(item.fromDate)}</dd></div>
          {punch ? <div><dt className="ui-t-label">Punch</dt><dd className="tabular-nums">{item.subKind === 'OUT' ? 'Out' : item.subKind === 'IN' ? 'In' : 'Punch'}{item.fromTime ? ` at ${item.fromTime}` : ''}</dd></div> : (
            <div><dt className="ui-t-label">Asked for</dt><dd className="tabular-nums">{item.subKind === 'COMP_OFF' ? `${item.days} day${item.days === 1 ? '' : 's'} comp-off` : `${hoursText(item.minutes) || '—'} overtime`}</dd></div>
          )}
          {punch ? <div><dt className="ui-t-label">Where</dt><dd>{item.place || 'Not named by the phone'}{item.accuracy != null ? <span className="ui-caption block tabular-nums">Accurate to about {item.accuracy} m</span> : null}</dd></div> : null}
          <div><dt className="ui-t-label">Waiting since</dt><dd>{waitedText(item.since)}</dd></div>
          {item.managerApproved ? <div><dt className="ui-t-label">Manager</dt><dd>Approved</dd></div> : null}
        </dl>
        {punch ? <p className="ui-muted">Made outside every work site. Approved, it counts like any punch; rejected, it stays on record and does not count.</p> : null}
        {item.reason ? <p className="ui-muted">“{item.reason}”</p> : null}
        {!punch ? (
          <label className="block"><span className="ui-label">Note to them</span><textarea ref={noteRef} className="ui-input w-full" rows={2} maxLength={500} value={note} onChange={(e) => { setNote(e.target.value); if (noteError) setNoteError(''); }} placeholder="Needed to reject" aria-invalid={noteError ? true : undefined} aria-describedby={noteError ? 'time-note-error' : undefined} />{noteError ? <span id="time-note-error" className="ui-field-error block" role="alert">{noteError}</span> : null}</label>
        ) : null}
      </div>
    </Drawer>
  );
}

/** A People approval with its steps: approve, reject with a reason, ask for more; or, for my own, answer or withdraw. */
function ApprovalDrawer({ id, mine, onClose, onDone }) {
  const req = useRequest(() => getRequest(id).catch((e) => (e?.status === 404 || e?.status === 403 ? null : Promise.reject(e))), [id]);
  const [request, setRequest] = useState(null);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState('');
  const commentRef = useRef(null);
  const [busy, setBusy] = useState('');
  const open = request || req.data || null;
  const deciding = open && open.status === 'WAITING' && !mine;
  /* data === null (not undefined) means the fetch resolved with no match (404/403): say so. */
  const gone = !open && req.data === null && !req.loading && !req.refreshing;

  const act = async (action) => {
    if (!open || busy) return;
    if (action !== 'approve' && action !== 'withdraw' && !comment.trim()) {
      setCommentError(action === 'reject' ? 'Say why it is rejected. They see this with the decision.' : mine ? 'Write your answer first.' : 'Say what more is needed.');
      commentRef.current?.focus();
      return;
    }
    setCommentError('');
    if (action === 'withdraw' && !(await confirmDialog({ title: `Withdraw “${open.title || 'this request'}”?`, message: 'It stops waiting for a decision and nobody can approve it. To ask again, send a new request.', confirmLabel: 'Withdraw request' }))) return;
    setBusy(action);
    try {
      const r = action === 'withdraw' ? await withdrawRequest(open.id) : action === 'reply' ? await replyRequest(open.id, comment.trim()) : await decideRequest(open.id, action, comment.trim() || undefined);
      setRequest(r.request);
      setComment('');
      notify.success(action === 'approve' ? (r.request.status === 'APPROVED' ? 'Approved and done.' : 'Approved; sent on to the next step.') : action === 'reject' ? 'Rejected.' : action === 'withdraw' ? 'Request withdrawn.' : action === 'reply' ? 'Answer sent.' : 'Asked for more.');
      onDone();
    } catch (e) {
      notify.error(errorWords(e, 'save your answer'));
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
              <button type="button" className="ui-btn ui-btn-ghost" disabled={Boolean(busy)} onClick={() => act('reject')}>Reject</button>
              <Button variant="primary" loading={busy === 'approve'} disabled={Boolean(busy)} onClick={() => act('approve')}>Approve</Button>
            </>
          ) : null}
          {mine && open.status === 'MORE_INFO' ? <button type="button" className="ui-btn ui-btn-primary" disabled={Boolean(busy)} onClick={() => act('reply')}>Send answer</button> : null}
          {mine && ['WAITING', 'MORE_INFO'].includes(open.status) ? <button type="button" className="ui-btn ui-btn-secondary" disabled={Boolean(busy)} onClick={() => act('withdraw')}>Withdraw</button> : null}
        </>
      ) : null}
    >
      {req.error && !open ? <ErrorState error={req.error} onRetry={req.reload} compact /> : gone ? (
        <EmptyState title="No longer waiting" description="Someone decided this or it was withdrawn since your list was loaded." />
      ) : !open ? <div className="ui-skel ui-skel-text" aria-busy="true" /> : (
        <div className="space-y-4 text-sm">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="ui-t-label">Kind</dt><dd>{typeOf(open.requestType, open.payload)}</dd></div>
            <div><dt className="ui-t-label">Asked by</dt><dd>{open.requesterName} · {day(open.createdAt)}</dd></div>
            <div><dt className="ui-t-label">Status</dt><dd><span className={`ui-pill ui-pill-${TONE[open.status] || 'neutral'}`}>{STATUS[open.status] || enumWords(open.status)}</span></dd></div>
            <div><dt className="ui-t-label">Due</dt><dd className="tabular-nums">{open.status === 'WAITING' ? day(open.dueAt) : '—'}{open.overdue ? <span className="ml-2"><ExceptionTag label="Overdue" tone="neg" /></span> : null}</dd></div>
          </dl>
          {open.payload?.fields ? (
            <div>
              <h3 className="ui-t-label mb-1">What changes</h3>
              <ul className="space-y-1">
                {Object.entries(open.payload.fields).map(([k, v]) => (
                  k === 'photoUrl' && open.payload.data?.photoUrl
                    /* A new photo is shown, not described: HR sees what they are approving. */
                    ? <li key={k} className="flex items-center gap-3"><span className="ui-muted">Photo:</span><img src={open.payload.data.photoUrl} alt="New photo asked for" className="ui-photo h-16 w-16 rounded-xl object-cover" /></li>
                    : <li key={k}><span className="ui-muted">{FIELD_WORDS[k] || SCHEDULED_LABELS[k] || 'Other detail'}</span>: <span className="ui-muted">{String(v.before ?? 'None')}</span> → <strong>{String(v.after ?? 'None')}</strong></li>
                ))}
              </ul>
              {open.payload.effectiveOn ? <p className="ui-caption mt-1">Takes effect {day(open.payload.effectiveOn)}</p> : null}
              {open.payload.reason ? <p className="mt-1">{open.payload.reason}</p> : null}
            </div>
          ) : null}
          {/* What was asked, line by line: a shift swap's days, a request type's answers (gaps 24, 25). */}
          {(open.requestType === 'SHIFT_SWAP' || String(open.requestType).startsWith('FORM:')) && Array.isArray(open.payload?.lines) && open.payload.lines.length ? (
            <div>
              <h3 className="ui-t-label mb-1">What is asked</h3>
              <dl className="space-y-1">
                {open.payload.lines.map((l, n) => <div key={`${l.label}-${n}`} className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-3"><dt className="ui-muted">{l.label}</dt><dd>{l.value}</dd></div>)}
              </dl>
              {open.payload.colleagueNote ? <p className="mt-1"><span className="ui-muted">{open.payload.colleagueName || 'The colleague'} said:</span> {open.payload.colleagueNote}</p> : null}
              {(open.payload.files || []).length ? (
                <ul className="mt-2 space-y-1" aria-label="Files">
                  {open.payload.files.map((f) => <li key={f.fileId}><button type="button" className="ui-link" onClick={() => requestFile(f.fileId).then(openFile).catch((e) => notify.error(errorWords(e, 'open it')))}>{f.label}: {f.name}</button></li>)}
                </ul>
              ) : null}
              {(open.payload.replies || []).map((x) => <p key={x.at} className="mt-1"><span className="ui-muted">Answer, {day(x.at)}:</span> {x.note}</p>)}
            </div>
          ) : null}
          <MoneyRequestDetail request={open} />
          <div>
            <h3 className="ui-t-label mb-1">Steps</h3>
            <ol className="space-y-2" aria-label="Approval steps">
              {open.steps.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <span className={`ui-pill ui-pill-${TONE[s.status] || 'neutral'}`}>{STEP[s.status] || enumWords(s.status)}</span>
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
              <textarea ref={commentRef} className="ui-input w-full" rows={2} value={comment} onChange={(e) => { setComment(e.target.value); if (commentError) setCommentError(''); }} maxLength={1000} aria-invalid={commentError ? true : undefined} aria-describedby={commentError ? 'approval-comment-error' : undefined} />
              {commentError ? <span id="approval-comment-error" className="ui-field-error block" role="alert">{commentError}</span> : null}
            </label>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
