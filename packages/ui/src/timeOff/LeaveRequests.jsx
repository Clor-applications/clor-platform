import React, { useEffect, useMemo, useRef, useState } from 'react';
import { waitingSaid } from '../picks/round34';
import LeaveDocumentField from './LeaveDocumentField';
import HalfDayChoice, { HalfDayNote, halfDayBody, leaveSpan } from './HalfDayChoice';
import { HoursChoice, PreviewNotes } from './LeaveShape';
import { hoursBody, hoursReady, hoursText, isHourly } from './partOfDay';
import { AlertTriangle, Check, Download, Plus, X } from '@ui/components/ui/lineIcons';
import { LeavePill, Notice, CountLine, TILE_ICON } from './Figures';
import { clashDays } from './clashes';

import ListHeader, { ListEmpty as EmptyState } from '@ui/components/list/ListHeader';
import BulkOutcome from '@ui/components/list/BulkOutcome';
import { bulkOutcome } from '@ui/picks/round57';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SuggestInput from '@ui/components/ui/SuggestInput';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { decidedLine } from '@ui/picks/round60';
import { runListExport } from '@ui/components/list/exportMenu';
import { usePermissions } from '@ui/permissions/usePermissions';
import { Avatar } from '@ui/personnel/Employees';

import { can, homeCrumbs, istDay } from './shared';
import { lateText } from './round33';
import { BalanceAfter, InlineDocument, LONG_WAIT_DAYS, isWaitingTooLong, stepChipText } from './round47';
import { MONTH_CLOSED, MonthClosedNote } from './MonthClosed';
import { useSuggestions } from './suggestions';
import {
  PRIVATE_LABEL, STATUS_LABEL, STATUS_PILL, approveLeave, bulkReviewLeave, cancelLeave, decideLeaveCancellation, getTimeOverview, createLeaveRequest, daysText,
  getLeaveDocument, getLeaveRequest, getLeaveSettings, listLeaveRequests, listLeaveTypes, pageLeaveRequests, periodChoices, previewLeave, rejectLeave, sendBackLeave, takeBackLeave,
  shortenLeave, swatchOf, updateLeaveRequest, listPeople,
} from './api';
import { addDaysIso as addDays } from '@ui/utils/dates';
import { errorWords } from '@ui/utils/errorWords.js';

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
/* Round 60 toastwords A: the done message names whose leave and which days. */
const leaveDone = (r, verb) => decidedLine({ name: r.employeeName, what: r.leaveTypeName ? r.leaveTypeName.toLowerCase() : 'leave', from: r.fromDate, to: r.toDate, verb });
const range = (from, to) => (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);
const half = (h) => (h === 'FIRST' ? 'First half' : h === 'SECOND' ? 'Second half' : '');
const waitedDays = (at) => Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000));
const waitedText = (at) => { const d = waitedDays(at); return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`; };

export function TypeDot({ row }) {
  const masked = row.reasonHidden || row.leaveTypeName === PRIVATE_LABEL;
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${masked ? 'ui-dot-quiet' : ''}`} style={masked ? undefined : { background: swatchOf({ color: row.leaveTypeColor, name: row.leaveTypeName }) }} aria-hidden="true" />;
}

export function StatusPill({ row }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      {row.status === 'APPROVED' && row.cancelAskedAt
        ? <span className="ui-pill ui-pill-warn">Approved · cancellation asked</span>
        : <span className={`ui-pill ${STATUS_PILL[row.status] || ''}`}>{STATUS_LABEL[row.status] || row.status}</span>}{row.status === 'PENDING' && row.createdAt ? <span className="sr-only">{`, ${waitingSaid(row.createdAt)}`}</span> : null}
      {row.status === 'PENDING' && row.managerApprovedAt ? <span className="ui-caption">{row.managerApprovedById ? 'Manager approved' : 'Handed on to HR'}</span> : null}
      {row.status === 'PENDING' && row.ruleStep > 1 ? <span className="ui-caption">Step {row.ruleStep}</span> : null}
    </span>
  );
}

export default function LeaveRequests({ params = {}, updateParams, openScreen, statusFromTab = false }) {
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
  const allRows = list.data?.requests || [];
  /* Round 47 escalate B: a "Waiting too long" list of requests waiting more than three days. */
  const longWaiting = tab === 'PENDING' ? allRows.filter((r) => isWaitingTooLong(r.createdAt)) : [];
  const onlyLong = tab === 'PENDING' && p.long === '1';
  const rows = onlyLong ? longWaiting : allRows;
  const counts = list.data?.counts || {};
  const [adding, setAdding] = useState(false);
  /* Today's figures for the tiles and the clash notice: the same overview Who's away reads; a refusal leaves them out. */
  const overview = useRequest(() => getTimeOverview().catch(() => null), []);
  const [chosen, setChosen] = useState(() => new Set());
  const [deciding, setDeciding] = useState(false);
  const mayApprove = allowed('ATTENDANCE::Leave Requests::APPROVE');
  /* While a request is open its drawer decides; the list's own buttons step aside so there is one place to decide. */
  const waitingTab = tab === 'PENDING' && mayApprove && !openId;
  const filtered = Boolean(p.q || p.type);
  /* No leave types yet: nothing can be entered or asked for, so the screen's one action is to set them up (People plan 8 Nov 2026, step 3). */
  const noTypes = Array.isArray(types.data) && types.data.length === 0;
  const setUpTypes = noTypes && allowed(LEAVE_TYPES_EDIT) && openScreen ? () => openScreen('leaveTypes') : null;

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
    { key: 'type', label: 'Leave', render: (r) => (r.reasonHidden || r.leaveTypeName === PRIVATE_LABEL ? <span className="inline-flex items-center gap-2 whitespace-nowrap"><TypeDot row={r} />{r.leaveTypeName}</span> : <LeavePill type={r} />) },
    { key: 'dates', label: 'Dates', render: (r) => <span className="tabular-nums whitespace-nowrap">{range(r.fromDate, r.toDate)}{hoursText(r) ? <span className="ui-caption block">{hoursText(r)}</span> : r.halfDay ? <span className="ui-caption block">{half(r.halfDay)}</span> : r.overflowOfId ? <span className="ui-caption block">Over the balance: loss of pay</span> : r.groupId ? <span className="ui-caption block">Part of a longer leave</span> : null}{r.createdAt && lateText(r.fromDate, istDay(r.createdAt)) ? <span className="ui-late-tag">{lateText(r.fromDate, istDay(r.createdAt))}</span> : null}</span> },
    { key: 'days', label: 'Days', align: 'right', render: (r) => <span className="tabular-nums">{r.days}</span> },
    { key: 'asked', label: tab === 'PENDING' ? 'Waiting since' : 'Asked', render: (r) => <span className={`whitespace-nowrap ${tab === 'PENDING' && waitedDays(r.createdAt) > 2 ? 'ui-text-warn' : ''}`}>{tab === 'PENDING' ? waitedText(r.createdAt) : formatDate(istDay(r.createdAt))}</span> },
    { key: 'reason', label: 'Reason', render: (r) => (r.reasonHidden ? <span className="ui-muted">Private</span> : <span className="block max-w-xs truncate" title={r.reason || undefined}>{r.reason || <span className="ui-muted">—</span>}</span>) },
    { key: 'status', label: 'Status', render: (r) => <StatusPill row={r} /> },
    /* Waiting rows decide in place with a tick and a cross (owner's style pick, 17 Nov 2026). The cross opens the request for the reason it needs. */
    ...(waitingTab ? [{ key: 'decide', label: <span className="sr-only">Decide</span>, align: 'right', always: true, render: (r) => (
      <span className="ui-decide">
        <button type="button" className="ui-decide-btn is-yes" disabled={deciding} aria-label={`Approve leave for ${r.employeeName}`} title="Approve" onClick={() => approveOne(r)}><Check size={16} aria-hidden="true" /></button>
        <button type="button" className="ui-decide-btn is-no" aria-label={`Reject leave for ${r.employeeName}`} title="Reject (asks for a reason)" onClick={() => setOpenId(r.id)}><X size={16} aria-hidden="true" /></button>
      </span>
    ) }] : []),
  ];
  /* People: a tab that already names the one status every row shares drops the column that would only repeat it; a manager's step still shows it. */
  const oneStatus = statusFromTab && tab !== 'all' && rows.length > 0 && rows.every((r) => r.status === rows[0].status && !(r.status === 'PENDING' && (r.managerApprovedAt || r.ruleStep > 1)));
  const shownColumns = oneStatus ? columns.filter((c) => c.key !== 'status') : columns;

  const decided = () => { setChosen(new Set()); list.reload(); overview.reload(); };
  const approveOne = async (r) => {
    setDeciding(true);
    try {
      const out = await approveLeave(r.id, '');
      notify.success(out?.stage === 'NEXT' ? 'Your step is approved. It moves on to the next step.' : leaveDone(r, 'approved'));
      decided();
    } catch (e) {
      notify.error(errorWords(e, 'approve the request'));
    } finally {
      setDeciding(false);
    }
  };
  const [outcome, setOutcome] = useState(null);
  const approveChosen = async () => {
    if (!chosen.size) return;
    setDeciding(true);
    setOutcome(null);
    try {
      const out = await bulkReviewLeave([...chosen], true);
      const failed = Number(out?.failed || 0);
      const done = Number(out?.done ?? chosen.size - failed);
      /* Round 57 bulkresult A: each one that could not be approved, by name, with why. */
      const said = bulkOutcome({ done, results: out?.results || [], nameOf: (id) => allRows.find((r) => r.id === id)?.employeeName });
      if (failed && !said.failed.length) said.failed.push({ id: 'rest', name: `${failed} more`, reason: 'Open them to see why.' });
      if (failed) setOutcome(said);
      else notify.success(done === 1 ? 'Approved.' : `${done} approved.`);
      decided();
    } catch (e) {
      notify.error(errorWords(e, 'approve the requests'));
    } finally {
      setDeciding(false);
    }
  };

  /* The tiles: what waits (the oldest first, so the first row says how long), what is approved in the period, who is away today. */
  const ov = overview.data;
  const oldest = tab === 'PENDING' && rows.length && !p.q && !p.type ? waitedDays(rows[0].createdAt) : null;
  const awayToday = ov ? (ov.awayToday?.length || 0) + (ov.workingAwayToday?.length || 0) : null;
  const tiles = [
    { key: 'waiting', label: 'Waiting for a decision', value: counts.PENDING ?? '—', accent: 'warn', tone: Number(counts.PENDING) > 0 ? 'warn' : null, Icon: TILE_ICON.waiting, sub: oldest == null ? 'In this leave period' : oldest === 0 ? 'Oldest asked today' : `Oldest ${oldest} day${oldest === 1 ? '' : 's'}`, busy: list.loading && !list.data },
    { key: 'approved', label: 'Approved', value: counts.APPROVED ?? '—', accent: 2, Icon: TILE_ICON.done, sub: 'In this leave period', busy: list.loading && !list.data },
    { key: 'rejected', label: 'Rejected', value: counts.REJECTED ?? '—', accent: 3, sub: 'In this leave period', busy: list.loading && !list.data },
    awayToday == null ? null : { key: 'away', label: 'Away today', value: awayToday, accent: 4, Icon: TILE_ICON.away, sub: ov?.upcoming?.length ? `${new Set(ov.upcoming.map((x) => x.employeeId)).size} more in the next 7 days` : 'Nobody else in the next 7 days', onClick: openScreen ? () => openScreen('leaveCalendar') : null },
  ];
  /* The first thin day ahead, today and the next fourteen (M4): two or more of one department away at once. */
  const clash = ov ? clashDays([...(ov.awayToday || []), ...(ov.upcoming || [])], ov.today || istDay(new Date().toISOString()), addDays(ov.today || istDay(new Date().toISOString()), 14), { oneGroup: Boolean(ov.team) })[0] : null;

  const exportAll = async () => {
    try {
      const all = await listLeaveRequests({ status: tab === 'all' ? undefined : tab, q: p.q, leaveTypeId: p.type, year });
      const columns_ = [['employeeName', 'Employee'], ['employeeCode', 'Employee ID'], ['department', 'Department'], ['leaveTypeName', 'Leave type'], ['fromDate', 'From'], ['toDate', 'To'], ['days', 'Days'], ['reason', 'Reason'], ['statusLabel', 'Status'], ['reviewNote', 'Note']].map(([key, label]) => ({ key, label }));
      runListExport({ format: 'xlsx', title: 'Leave requests', fileName: `leave-requests-${year}`, label: 'Requests', rows: all.map((r) => ({ ...r, reason: r.reason ?? '', statusLabel: STATUS_LABEL[r.status] || r.status })), columns: columns_ });
    } catch (e) {
      notify.error(errorWords(e, 'export the requests'));
    }
  };

  const periodOptions = settings.data ? periodChoices(settings.data).map((c) => ({ value: String(c.year), label: c.label })) : [];
  const typeOptions = [{ value: '', label: 'Every type' }, ...(types.data || []).map((t) => ({ value: t.id, label: t.name }))];

  return (
    <div className="space-y-6">
      <ListHeader
        breadcrumb={homeCrumbs()}
        title="Leave requests"
        description="Leave asked for in the employee app or entered here: waiting for a decision, or decided, in the leave period."
        secondary={<>
          {allowed('ATTENDANCE::Leave Requests::EXPORT') || perms?.isAdmin ? <button type="button" className="ui-btn ui-btn-secondary" onClick={exportAll}><Download size={16} aria-hidden="true" /> Export</button> : null}
          {waitingTab && !setUpTypes && allowed('ATTENDANCE::Leave Requests::CREATE') ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setAdding(true)} disabled={noTypes}><Plus size={16} aria-hidden="true" /> Enter leave</button> : null}
        </>}
        primary={setUpTypes ? { label: 'Set up leave types', onClick: setUpTypes }
          : waitingTab ? { label: chosen.size ? `Approve ${chosen.size} chosen` : 'Approve chosen', icon: Check, onClick: approveChosen, disabled: !chosen.size || deciding, title: chosen.size ? undefined : 'Tick the requests to approve' }
          : allowed('ATTENDANCE::Leave Requests::CREATE') ? { label: 'Enter leave', icon: Plus, onClick: () => setAdding(true), disabled: noTypes, title: noTypes ? 'No leave types yet' : undefined } : null}
        strip={<CountLine label="Leave figures" items={tiles} />}
        toolbar={<>
          <SearchField value={p.q || ''} onSearch={(q) => set({ q: q || null, page: null })} placeholder="Search name or employee ID" label="Search leave requests" className="w-full sm:w-72" />
          <div className="w-full sm:w-48"><PopupSelect showValueSubtext={false} ariaLabel="Leave type" value={p.type || ''} onChange={(v) => set({ type: v || null, page: null })} options={typeOptions} placeholder="Every type" /></div>
          {tab === 'PENDING' && (longWaiting.length || onlyLong) ? <button type="button" className={`ui-btn ui-btn-sm ${onlyLong ? 'ui-btn-primary' : 'ui-btn-secondary'} ui-long-wait`} aria-pressed={onlyLong} title={`Waiting more than ${LONG_WAIT_DAYS} days`} onClick={() => set({ long: onlyLong ? null : '1', page: null })}>Waiting too long <span className="tabular-nums">({longWaiting.length})</span></button> : null}
          {periodOptions.length > 1 ? <div className="w-full sm:w-48"><PopupSelect showValueSubtext={false} ariaLabel="Leave period" value={String(year || '')} onChange={(v) => set({ year: v && Number(v) !== settings.data?.current?.year ? v : null, page: null })} options={periodOptions} /></div> : null}
        </>}
        tabs={TABS.map(([k, l]) => ({ key: k, label: l, count: counts[k], tone: k === 'PENDING' ? 'warn' : undefined }))}
        tab={tab}
        onTab={(k) => { setChosen(new Set()); set({ tab: k === 'PENDING' ? null : k, page: null }, true); }}
      />

      <BulkOutcome outcome={outcome} verb="approved" onClose={() => setOutcome(null)} />
      <DataTable
        label="Leave requests"
        columns={shownColumns}
        rows={rows}
        total={onlyLong ? rows.length : Number(list.data?.total || 0)}
        page={page}
        pageSize={size}
        noun="requests"
        onPage={(n) => set({ page: n > 1 ? n : null }, true)}
        onPageSize={(n) => set({ size: n === 25 ? null : n, page: null })}
        onRowClick={(r) => setOpenId(r.id)}
        selectable={waitingTab}
        selected={chosen}
        onSelect={setChosen}
        loading={list.loading || (!year && settings.loading)}
        refreshing={list.refreshing}
        card={(r) => (
          <span className="flex items-center gap-3 min-w-0">
            <Avatar person={{ name: r.employeeName, photoUrl: r.photoUrl }} size={40} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.employeeName}</span><span className={`ui-pill ${STATUS_PILL[r.status] || ''}`}>{STATUS_LABEL[r.status]}</span></span>
              <span className="block truncate ui-caption">{r.leaveTypeName} · {daysText(r.days)}</span>
              <span className="block truncate ui-caption tabular-nums">{range(r.fromDate, r.toDate)}{hoursText(r) ? `, ${hoursText(r)}` : ''}</span>
            </span>
          </span>
        )}
        empty={list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : !year && settings.error ? (
          /* Without the settings there is no leave period to ask for, so "Nothing waiting" would be a guess. */
          <ErrorState error={settings.error} onRetry={settings.reload} />
        ) : filtered ? (
          <EmptyState kind="filtered" title="No requests match" onClearFilters={() => set({ q: null, type: null, page: null })} />
        ) : noTypes ? (
          /* The one action is the header's primary; here only the sentence, with the way there as a link. */
          <EmptyState title="No leave types yet" description={<>Leave requests need at least one leave type. Set them up under {setUpTypes ? <button type="button" className="ui-link" onClick={setUpTypes}>Settings › Leave policy</button> : 'Settings › Leave policy'}.</>} />
        ) : tab === 'PENDING' ? (
          <EmptyState title="Nothing waiting" description="Leave asked for in the employee app, or entered here, waits here for a decision." />
        ) : (
          <EmptyState title={`No ${tab === 'all' ? '' : `${STATUS_LABEL[tab].toLowerCase()} `}requests in this period`} />
        )}
      />

      {clash ? (
        <Notice icon={AlertTriangle}>
          <strong>{clash.names.length === 2 ? clash.names.join(' and ') : `${clash.names[0]} and ${clash.count - 1} others`}{clash.group ? ` in ${clash.group}` : ''}</strong> are away at the same time, {range(clash.date, clash.to)}{clash.waiting ? ` (${clash.waiting} still waiting)` : ''}.
        </Notice>
      ) : null}

      {openId ? <RequestDrawer id={openId} allowed={allowed} onClose={() => { setOpenId(null); if (p.id) set({ id: null }); }} onDone={() => { setOpenId(null); if (p.id) set({ id: null }); list.reload(); }} /> : null}
      {adding ? <EnterLeave openScreen={openScreen} onClose={() => setAdding(false)} onDone={() => { setAdding(false); set({ tab: null, page: null }); list.reload(); }} /> : null}
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

export function RequestDrawer({ id, allowed, onClose, onDone }) {
  const req = useRequest(() => getLeaveRequest(id), [id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [noteError, setNoteError] = useState('');
  const noteRef = useRef(null);
  const d = req.data;
  const r = d?.request;
  /* Under the approval rule only whoever the waiting step names decides; they may do so without the general right. On the approval engine the leave right still decides as before (HR stepping in, or rejecting while the manager decides), and so does whoever the step names. */
  /* On the approval engine the server says, worked out live: theirs to decide (approve and reject), or only to reject while the manager decides (HR, under "the manager, then HR"). Nothing else shows a button that would be refused. */
  const canDecide = d?.step?.engine ? Boolean(d.step.yours || d.step.mayReject) : d?.step ? Boolean(d.step.yours) : allowed('ATTENDANCE::Leave Requests::APPROVE');
  const canApprove = d?.step?.engine ? Boolean(d.step.yours) : true;
  const canCancel = allowed('ATTENDANCE::Leave Requests::EDIT');
  const [editing, setEditing] = useState(false);
  /* Came back early: the new last day, and what the shorter leave charges. */
  const [shortening, setShortening] = useState(false);
  const [shortTo, setShortTo] = useState('');
  const [shortDays, setShortDays] = useState(null);
  const [shownDoc, setShownDoc] = useState(null);
  useEffect(() => {
    if (!shortening || !shortTo || !r) { setShortDays(null); return undefined; }
    let live = true;
    previewLeave({ employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, fromDate: r.fromDate, toDate: shortTo, halfDay: null })
      .then((p) => { if (live) setShortDays(p?.total ?? null); })
      .catch(() => { if (live) setShortDays(null); });
    return () => { live = false; };
  }, [shortening, shortTo, r]);
  const act = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      notify.success(done);
      onDone();
    } catch (e) {
      notify.error(errorWords(e, 'update the request'));
      req.reload();
    } finally {
      setBusy(false);
    }
  };
  /* Round 27: HR for the whole company decides while it is still the manager's turn; the request is marked "Decided by HR". */
  const asHr = Boolean(d?.waitingForManager && d?.mayDecideAsHr);
  const approve = () => act(async () => {
    const out = await approveLeave(r.id, note.trim(), { asHr });
    if (out?.stage === 'NEXT') notify.success('Your step is approved. It moves on to the next step.');
  }, leaveDone(r, 'approved'));
  const openDocument = async () => {
    try {
      const doc = await getLeaveDocument(r.id);
      if (!doc?.dataUrl) return;
      /* Round 47 approvalattach A: it opens inside the request, no download. */
      setShownDoc(doc.dataUrl);
    } catch (e) {
      notify.error(errorWords(e, 'open the document'));
    }
  };
  /* A rejection says why: the person reads it in the employee app. */
  const reject = () => {
    if (!note.trim()) { setNoteError('Say why. They see this with the decision.'); noteRef.current?.focus(); return; }
    act(() => rejectLeave(r.id, note.trim()), leaveDone(r, 'not approved'));
  };
  /* Round 27: send it back with a question (the note); it stays with the same approver until they answer. */
  const sendBack = () => {
    if (!note.trim()) { setNoteError('Write the question in the note. They answer it in the app.'); noteRef.current?.focus(); return; }
    act(() => sendBackLeave(r.id, note.trim()), 'Sent back with your question.');
  };
  /* Round 18: take back an approval before the leave starts. */
  const takeBack = async () => {
    const ok = await confirmDialog({ title: 'Take back this approval?', message: 'It waits for a decision again, its days come off the attendance record, and they are told.', confirmLabel: 'Take back' });
    if (ok) act(() => takeBackLeave(r.id, null), 'Approval taken back. It waits again.');
  };
  /* Round 47: the person asked to cancel this approved leave; it counts until it is agreed. */
  const cancelAsked = Boolean(r?.status === 'APPROVED' && r?.cancelAskedAt);
  const agreeCancel = () => act(() => decideLeaveCancellation(r.id, true, note.trim() || null), 'Cancellation approved. The days go back to their balance.');
  const keepLeave = () => act(() => decideLeaveCancellation(r.id, false, note.trim() || null), 'Leave kept. They are told.');
  const cancel = async () => {
    /* HR cancelling approved leave says why: the person reads it with the notice. */
    if (r.status === 'APPROVED' && !note.trim()) { setNoteError('Say why. They read this with the notice.'); noteRef.current?.focus(); return; }
    const ok = await confirmDialog({
      title: r.status === 'APPROVED' ? 'Cancel this leave?' : 'Withdraw this request?',
      message: r.status === 'APPROVED' ? `The days come off the attendance record and go back to the balance${d.parts?.length > 1 ? ', for every part of this leave' : ''}.` : d.parts?.length > 1 ? 'Every part of this leave is withdrawn.' : undefined,
      confirmLabel: r.status === 'APPROVED' ? 'Cancel leave' : 'Withdraw request',
      cancelLabel: r.status === 'APPROVED' ? 'Keep leave' : 'Keep request',
    });
    if (ok) act(() => cancelLeave(r.id, r.status === 'APPROVED' ? note.trim() : null), r.status === 'APPROVED' ? 'Leave cancelled.' : 'Request withdrawn.');
  };
  const shorten = (e) => {
    e?.preventDefault();
    if (!shortTo || busy) return;
    act(() => shortenLeave(r.id, shortTo), `Now ends ${formatDate(shortTo)}.`);
  };
  const changeable = Boolean(d?.canEdit && canCancel);
  const shortenable = Boolean(d?.canShorten && canCancel);

  if (editing && r) return <EnterLeave request={r} parts={d?.parts || []} onClose={() => setEditing(false)} onDone={onDone} />;

  const actions = !r ? null : shortening ? (
    <>
      <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => { setShortening(false); setShortTo(''); }}>Cancel</button>
      <button type="submit" form="came-back-early" className="ui-btn ui-btn-primary" disabled={busy || !shortTo}>{busy ? 'Saving…' : 'Save'}</button>
    </>
  ) : r.status === 'PENDING' && canDecide ? (
    <>
      {canCancel ? <button type="button" className="ui-btn ui-btn-ghost mr-auto" disabled={busy} onClick={cancel}>Withdraw</button> : null}
      {changeable ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => setEditing(true)}>Change</button> : null}
      {d.question ? null : <button type="button" className="ui-btn ui-btn-ghost" disabled={busy} onClick={sendBack}>Ask a question</button>}
      <button type="button" className="ui-btn ui-btn-ghost" disabled={busy} onClick={reject}><X size={16} aria-hidden="true" /> Reject</button>
      {canApprove ? <button type="button" className="ui-btn ui-btn-primary" disabled={busy || (Boolean(d.waitingForManager) && !asHr)} onClick={approve}><Check size={16} aria-hidden="true" /> {asHr ? 'Approve as HR' : 'Approve'}</button> : null}
    </>
  ) : cancelAsked && canDecide ? (
    <>
      <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={keepLeave}>Keep leave</button>
      <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={agreeCancel}><Check size={16} aria-hidden="true" /> Approve cancellation</button>
    </>
  ) : OPEN_STATUSES.includes(r.status) && (canCancel || d?.canTakeBack) ? (
    <>
      {changeable ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => setEditing(true)}>Change</button> : null}
      {shortenable ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => setShortening(true)}>Came back early</button> : null}
      {d?.canTakeBack ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={takeBack}>Take back approval</button> : null}
      {canCancel ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={cancel}>{r.status === 'APPROVED' ? 'Cancel leave' : 'Withdraw'}</button> : null}
    </>
  ) : null;

  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)]" title={r ? `${r.employeeName}: ${r.leaveTypeName}` : 'Leave request'} actions={actions} dirty={Boolean(note.trim()) || Boolean(shortTo)}>
      {req.error ? <ErrorState error={req.error} onRetry={req.reload} compact /> : !d ? <div className="ui-skel ui-skel-text" aria-busy="true" /> : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Fact label="Dates"><span className="tabular-nums">{range(r.fromDate, r.toDate)}</span>{hoursText(r) ? <span className="tabular-nums">, {hoursText(r)}</span> : r.halfDay ? `, ${half(r.halfDay).toLowerCase()}` : ''}</Fact>
            <Fact label="Charged"><span className="tabular-nums">{daysText(r.days)}</span></Fact>
            <Fact label="Status"><StatusPill row={r} />{d.decidedByHr ? <span className="ui-caption block">Decided by HR</span> : null}</Fact>
            {d.parts?.length > 1 ? <div className="col-span-2"><Fact label="Saved in parts">{d.parts.map((x, i) => <span key={x.id} className="block tabular-nums">Part {i + 1}: {range(x.fromDate, x.toDate)}{x.halfDay ? `, ${half(x.halfDay).toLowerCase()}` : ''}, {daysText(x.days)}{x.overflowOfId ? `, ${x.leaveTypeName} (over the balance)` : ''}{x.status !== r.status ? ` · ${STATUS_LABEL[x.status]}` : ''}</span>)}</Fact></div> : null}
            <div className="col-span-2"><Fact label="Reason">{r.reasonHidden ? <span className="ui-muted">Private: HR reads the reason.</span> : r.reason ? r.reason : <span className="ui-muted">None given</span>}</Fact></div>
          </dl>

          {d.waitingForManager ? <p className="text-sm ui-text-warn">{d.waitingForManager}{asHr ? ' You can decide it as HR; it is marked “Decided by HR”.' : ''}</p> : null}
          {d.question ? <p className="text-sm">Waiting for their answer to {d.question.by ? `${d.question.by}’s` : 'a'} question: <span className="ui-muted">“{d.question.note}”</span></p> : null}
          {d.step ? (
            <section aria-labelledby="lr-step" className="space-y-1">
              <h3 id="lr-step" className="ui-t-sec">Approval</h3>
              {/* Round 47 approvalchain B: only the step it is at, "With HR"; the full trail folds away. */}
              <p className="text-sm">
                <span className={`ui-step-chip${d.step.current && d.step.yours ? ' is-yours' : ''}`}>{stepChipText(d.step)}</span>
                {d.step.current && d.step.dueAt ? <span className="ui-muted tabular-nums"> · due {formatDate(new Date(new Date(d.step.dueAt).getTime() + 330 * 60_000).toISOString().slice(0, 10))}</span> : null}
              </p>
              {d.step.timeline?.length ? (
                <details className="text-sm">
                  <summary className="ui-link">All steps</summary>
                  <ol className="space-y-1 mt-1" aria-label="Steps">
                    {d.step.timeline.map((t, i) => (
                      <li key={`${t.order}-${i}`} className="flex flex-wrap gap-x-2">
                        <span className={t.status === 'WAITING' ? 'font-medium' : ''}>{t.text}</span>
                        {t.on ? <span className="ui-muted tabular-nums">{t.status === 'WAITING' ? 'due ' : ''}{formatDate(t.on)}</span> : null}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
              <p className="ui-caption">{d.step.rule}</p>
            </section>
          ) : null}
          {d.document ? (
            <p className="text-sm flex flex-wrap items-center gap-2"><span className="ui-label m-0">Document</span><span>{d.document.title}</span>{shownDoc ? null : <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={openDocument}>Open</button>}</p>
          ) : null}
          {d.document && shownDoc ? <InlineDocument dataUrl={shownDoc} title={d.document.title} onClose={() => setShownDoc(null)} /> : null}
          {d.document ? null : d.documentNeeded && !r.reasonHidden ? <p className="text-sm ui-muted">No document sent with it, though this type asks for one at this length.</p> : null}
          {d.ownRequest && r.status === 'PENDING' ? <p className="text-sm ui-muted">This is your own request. Somebody else decides it, unless nobody else in the company can.</p> : null}

          {shortening ? (
            <form id="came-back-early" onSubmit={shorten} className="space-y-3" aria-labelledby="lr-short">
              <h3 id="lr-short" className="ui-t-sec">Came back early</h3>
              <div className="sm:w-56">
                <span className="ui-label" id="lr-short-to">Last day of leave *</span>
                <DatePicker label="Last day of leave" describedBy="lr-short-to" value={shortTo} min={r.fromDate} max={addDays(r.toDate, -1)} onChange={(v) => setShortTo(v || '')} />
              </div>
              {shortTo ? <p className="text-sm tabular-nums" aria-live="polite">{shortDays == null ? 'Working out the days…' : `Charges ${daysText(shortDays)} instead of ${daysText(r.days)}.`}</p> : null}
            </form>
          ) : null}

          {d.balance ? (
            <section aria-labelledby="lr-balance" className="space-y-1">
              <h3 id="lr-balance" className="ui-t-sec">Balance</h3>
              <p className="text-sm tabular-nums">
                {OPEN_STATUSES.includes(r.status)
                  ? <BalanceAfter withIt={d.balance.with} without={d.balance.without} />
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
                  <span>{h.what}{h.by ? ` by ${h.by}` : ''}{h.from && h.to ? <span className="tabular-nums">: {range(h.from, h.to)}</span> : null}{h.note ? <span className="block ui-muted">“{h.note}”</span> : null}</span>
                </li>
              ))}
            </ol>
          </section>

          {cancelAsked ? <p className="text-sm ui-text-warn">They asked to cancel this leave{r.cancelReason ? <>: <span className="ui-muted">“{r.cancelReason}”</span></> : '.'} It stays approved, and counts, until it is agreed.</p> : null}
          {(r.status === 'PENDING' && canDecide) || (r.status === 'APPROVED' && (canCancel || (cancelAsked && canDecide))) ? (
            <div>
              <label htmlFor="lr-note" className="ui-label">{r.status === 'APPROVED' && !cancelAsked ? 'Reason, if you cancel it' : 'Note to them'}</label>
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
export { LeaveDocumentField };


/**
 * The preview while a request is being changed: the request itself is still
 * waiting, so an overlap with its own dates and a balance short by its own
 * days are not problems, and the balance after gets its own days back when
 * the type is unchanged. The server checks the rest on save.
 */
function ownPreview(p, request, leaveTypeId) {
  if (!p) return p;
  const sameType = leaveTypeId === request.leaveTypeId;
  /* The request's own days come back when it is changed, so a shortfall is its own only while the new charge fits in the balance plus those days. */
  const fitsWithOwnDays = (p.parts || []).every((x) => x.balance?.after == null || x.balance.after + request.days >= -(x.balance.negativeDays || 0));
  const own = (code, message) => (code === 'OVERLAP' && message.includes(request.fromDate) && message.includes(request.toDate)) || (code === 'NO_BALANCE' && sameType && fitsWithOwnDays);
  return {
    ...p,
    problems: (p.problems || []).filter((x) => !own(x.code, String(x.message || ''))),
    parts: sameType && (p.parts || []).length === 1
      ? p.parts.map((x) => (x.balance?.after == null ? x : { ...x, balance: { ...x.balance, after: Math.round((x.balance.after + request.days) * 100) / 100 } }))
      : p.parts,
  };
}

/** Night shifts on: which night each charged date covers, so the preview and the day record say the same. */
export function NightCover({ dates }) {
  const nights = (dates || []).filter((d) => d.counted && d.night);
  if (!nights.length) return null;
  return (
    <ul className="text-sm space-y-0.5">
      {nights.map((d) => <li key={d.date}><span className="tabular-nums">{formatDate(d.date)}</span>: {d.night.label}. Covers {d.night.covers}.</li>)}
    </ul>
  );
}

/** What the preview says, in the words the form needs: days, balance after, dates skipped, problems, the split. */
export function LeavePreview({ preview, loading }) {
  if (!preview) return loading ? <p className="text-sm ui-muted" aria-live="polite">Working out the days…</p> : null;
  const parts = preview.parts || [];
  return (
    <section className="space-y-3" aria-live="polite" aria-busy={loading}>
      {parts.length ? (<>
        <p className="text-sm">
          Charges <strong className="tabular-nums">{daysText(preview.total)}</strong>
          {preview.type?.isPaid === false ? ' of loss of pay' : ''}
          {parts.length === 1 && parts[0].balance?.after != null ? (parts[0].balance.after < 0
            ? <> · balance after <span className="tabular-nums ui-text-neg font-semibold">{parts[0].balance.after} {Math.abs(parts[0].balance.after) === 1 ? 'day' : 'days'}</span></>
            : <> · <span className="tabular-nums">{parts[0].balance.after}</span> left after</>) : null}
        </p>
        {parts.length === 1 && parts[0].balance?.after < 0 ? <p className="text-sm ui-muted">The days below zero come out of the leave you earn next.</p> : null}
      </>) : null}
      {preview.split ? (
        <div className="text-sm space-y-1">
          <p>This crosses the end of the leave period, so it is saved as {parts.length} requests:</p>
          <ul className="space-y-0.5">
            {parts.map((x) => <li key={x.from} className="tabular-nums">{range(x.from, x.to)}: {daysText(x.days)}{x.balance?.after != null ? `, ${x.balance.after} left in ${x.label}` : ''}</li>)}
          </ul>
        </div>
      ) : null}
      <HalfDayNote parts={parts} />
      <SkippedDates dates={parts.flatMap((x) => x.dates || [])} />
      <NightCover dates={parts.flatMap((x) => x.dates || [])} />
      {(preview.problems || []).map((x) => (x.code === MONTH_CLOSED
        ? <MonthClosedNote key={x.code + x.message} message={x.message} month={x.month} />
        : <p key={x.code + x.message} className="text-sm ui-text-neg" role="alert">{x.message}</p>))}
    </section>
  );
}

/**
 * HR enters leave for someone, or changes a waiting request (`request`): the
 * same form, prefilled, the person fixed. While a request is being changed
 * the preview still sees the request itself, so an overlap with its own dates
 * and a balance short by its own days are not problems; the server decides
 * those on save.
 */
const LEAVE_TYPES_EDIT = 'ATTENDANCE::Leave Types::EDIT';

/** Nothing to choose until the company has a kind of leave: say so, and the way to make one. */
function NoLeaveTypes({ setUp }) {
  return (
    <p className="text-sm ui-muted" role="status">
      No leave types yet, so there is nothing to enter leave against.{' '}
      {setUp ? <button type="button" className="ui-link" onClick={setUp}>Set up leave types</button> : 'Ask whoever runs HR to set them up.'}
    </p>
  );
}

export function EnterLeave({ onClose, onDone, request = null, parts = [], openScreen }) {
  const editing = Boolean(request);
  const perms = usePermissions();
  /* A leave saved as linked parts is changed as one, its half days at either end kept. */
  const start = useMemo(() => (request
    ? { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, ...leaveSpan(request, parts), fromTime: request.fromTime || '', toTime: request.toTime || '', reason: request.reason || '' }
    : { employeeId: '', leaveTypeId: '', fromDate: '', toDate: '', halfDay: '', startHalf: false, endHalf: false, fromTime: '', toTime: '', reason: '' }), [request, parts]);
  const [form, setForm] = useState(start);
  const [saving, setSaving] = useState(false);
  /* The document sent with it: { name, data (data URL), mime }. */
  const [doc, setDoc] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const people = useRequest(() => (editing ? Promise.resolve([]) : listPeople()), [editing]);
  const types = useRequest(() => listLeaveTypes().then((t) => t.filter((x) => x.isActive || x.id === request?.leaveTypeId)), []);
  const reasons = useSuggestions('leaveReason');
  const type = (types.data || []).find((t) => t.id === form.leaveTypeId);
  const hourly = isHourly(type);
  const halfAllowed = type?.allowHalfDay !== false && !hourly;
  const set = (k, v) => setForm((f) => {
    const next = { ...f, [k]: v, ...(k === 'fromDate' && v && (!f.toDate || f.toDate < v) ? { toDate: v } : {}) };
    /* A type that takes only whole days drops a half day chosen under the last type; the picker for it is gone. */
    if (k === 'leaveTypeId' && (types.data || []).find((t) => t.id === v)?.allowHalfDay === false) Object.assign(next, { halfDay: '', startHalf: false, endHalf: false });
    return next;
  });
  const body = { ...form, ...halfDayBody(form, halfAllowed), ...hoursBody(form, type), ...(hourly ? {} : { fromTime: null, toTime: null }) };
  const ready = form.employeeId && form.leaveTypeId && form.fromDate && form.toDate && hoursReady(form, type);
  const dirty = editing ? JSON.stringify(form) !== JSON.stringify(start) : Boolean(form.employeeId || form.leaveTypeId || form.fromDate || form.reason);

  /* The preview follows the form; the newest answer wins and the last one stays while the next loads. */
  const seq = useRef(0);
  useEffect(() => {
    /* Incomplete again: a preview still on its way for the old form must not come back, so it loses its number. */
    if (!ready) { seq.current += 1; setPreview(null); setPreviewing(false); return undefined; }
    const n = ++seq.current;
    setPreviewing(true);
    const t = setTimeout(() => {
      previewLeave(editing ? { ...body, editing: request.id } : body).then((r) => { if (n === seq.current) setPreview(editing ? ownPreview(r, request, form.leaveTypeId) : r); }).catch((e) => { if (n === seq.current) setPreview({ problems: [{ code: 'ERR', message: errorWords(e, 'work out the days') }], parts: [] }); }).finally(() => { if (n === seq.current) setPreviewing(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [form.employeeId, form.leaveTypeId, form.fromDate, form.toDate, form.halfDay, form.startHalf, form.endHalf, form.fromTime, form.toTime]);

  const reasonNeeded = type ? !type.isPrivate : true;
  const reasonOk = !reasonNeeded || form.reason.trim().length >= 3;
  const blocked = !ready || !preview || previewing || (preview.problems || []).length > 0 || !reasonOk || (editing && !dirty);

  const save = async (e) => {
    e?.preventDefault();
    if (blocked || saving) return;
    setSaving(true);
    try {
      const sent = { ...body, reason: form.reason.trim(), split: Boolean(preview?.split), ...(doc ? { attachment: doc } : {}) };
      if (editing) {
        await updateLeaveRequest(request.id, sent);
        notify.success('Changed. It waits in Waiting.');
      } else {
        const r = await createLeaveRequest(sent);
        notify.success(r.requests ? `Entered as ${r.requests.length} requests. They wait in Waiting.` : 'Entered. It waits in Waiting.');
      }
      onDone();
    } catch (err) {
      /* A closed month says so in the form, with the way to Month close; anything else is a toast. */
      if (err?.code === MONTH_CLOSED) setPreview((p) => ({ ...(p || { parts: [] }), problems: [{ code: MONTH_CLOSED, message: String(err.message), month: err.data?.month }] }));
      else notify.error(errorWords(err, 'send the request'));
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
      title={editing ? `Change ${request.employeeName}'s leave` : 'Enter leave'}
      actions={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="enter-leave" className="ui-btn ui-btn-primary" disabled={blocked || saving}>{saving ? 'Saving…' : 'Save'}</button>
      </>}
    >
      <form id="enter-leave" onSubmit={save} className="space-y-4">
        {editing
          ? <dl className="text-sm"><Fact label="Employee">{request.employeeName}{request.employeeCode ? <span className="ui-muted"> · {request.employeeCode}</span> : null}</Fact></dl>
          : <PopupSelect showValueSubtext={false} label="Employee *" value={form.employeeId} onChange={(v) => set('employeeId', v || '')} placeholder="Choose…" alwaysSearch options={(people.data || []).map((x) => ({ value: x.id, label: x.code ? `${x.name} (${x.code})` : x.name }))} />}
        {types.data && !types.data.length
          ? <div><span className="ui-label">Leave type *</span><NoLeaveTypes setUp={can(perms, LEAVE_TYPES_EDIT) && openScreen ? () => { onClose(); openScreen('leaveTypes'); } : null} /></div>
          : <PopupSelect showValueSubtext={false} label="Leave type *" value={form.leaveTypeId} onChange={(v) => set('leaveTypeId', v || '')} placeholder="Choose…" options={(types.data || []).map((t) => ({ value: t.id, label: t.isPaid ? t.name : `${t.name} (unpaid)` }))} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <div><span className="ui-label" id="el-from">{hourly ? 'Day *' : 'First day *'}</span><DatePicker label={hourly ? 'Day' : 'First day'} describedBy="el-from" value={form.fromDate} onChange={(v) => set('fromDate', v || '')} /></div>
          {hourly ? null : <div><span className="ui-label" id="el-to">Last day *</span><DatePicker label="Last day" describedBy="el-to" value={form.toDate} min={form.fromDate} onChange={(v) => set('toDate', v || '')} /></div>}
        </div>
        {hourly
          ? <HoursChoice form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
          : <HalfDayChoice form={form} allowed={halfAllowed} typeName={type?.name} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />}
        <label className="block">
          <span className="ui-label">{reasonNeeded ? 'Reason *' : 'Reason'}</span>
          <SuggestInput maxLength={500} value={form.reason} onChange={(v) => set('reason', v)} suggestions={reasons} />
        </label>
        {preview?.documentNeeded || doc ? <LeaveDocumentField typeName={type?.name} afterDays={preview?.documentAfterDays} value={doc} onChange={setDoc} note="HR entering it may add it later." /> : null}
        <LeavePreview preview={preview} loading={previewing} />
        <PreviewNotes preview={preview} />
        {preview?.alsoAwayCount ? <p className="text-sm ui-muted">{preview.alsoAwayCount} {preview.alsoAwayCount === 1 ? 'other person is' : 'others are'} away then{preview.sameDepartment ? `, ${preview.sameDepartment} in the same department` : ''}.</p> : null}
      </form>
    </Drawer>
  );
}

