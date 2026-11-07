import React, { useState } from 'react';
import { CalendarClock, CalendarDays, Clock3, Hourglass, Plus } from '@ui/components/ui/lineIcons';
import { useContentIcon } from '@ui/components/ui/colorSwap';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { usePermissions } from '@ui/permissions/usePermissions';
import { Avatar } from '@ui/personnel/Employees';

import { activeApp, can, homeCrumbs } from './shared';
import { daysText, getTimeOverview } from './api';
import { EnterLeave, TypeDot } from './LeaveRequests';
import { clashDays, clashWords } from './clashes';
import { addDaysIso as addDays, todayIst } from '@ui/utils/dates';

/**
 * Time & Leave → Overview: the owner's morning question — who is away, what
 * is waiting for me, who is away soon — on one page (TIME-LEAVE-DECISIONS.md).
 * The strip counts; the lists below are the people behind the counts, each
 * opening the request it is about. Days that lapse at the period end show
 * only in its last two months, when something can still be done about them.
 */
const range = (from, to) => (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);
const waited = (at) => { const d = Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000)); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };

/** Approved work from home and on duty: shown with the people away, marked as working. */
const WORKING_LABEL = { WFH: 'Work from home', ON_DUTY: 'On duty' };

function Group({ title, count, action, children }) {
  return (
    <section className="space-y-1" aria-label={title}>
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="ui-t-sec">{title}{count ? <span className="ui-caption tabular-nums ml-2">{count}</span> : null}</h2>
        {action}
      </header>
      <ul className="divide-y border-t text-sm">{children}</ul>
    </section>
  );
}

function Person({ r }) {
  return (
    <span className="flex items-center gap-2.5 min-w-0 flex-1">
      <Avatar person={{ name: r.employeeName, photoUrl: r.photoUrl }} size={28} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{r.employeeName}</span>
        <span className="flex items-center gap-1.5 ui-caption truncate"><TypeDot row={r} />{r.leaveTypeName}{r.department ? ` · ${r.department}` : ''}</span>
      </span>
    </span>
  );
}

export default function TimeOverview({ openScreen }) {
  const mark = useContentIcon();
  const perms = usePermissions();
  const req = useRequest(() => getTimeOverview(), []);
  const [adding, setAdding] = useState(false);
  const d = req.data;
  const open = (r) => openScreen?.('leaveRequests', { id: r.id, tab: r.status === 'PENDING' ? null : 'all' });
  /* People decides everything in one Approvals inbox (owner, 28 Oct 2026 audit): this page says who is away and
     sends decisions there, rather than keeping a second waiting list. Attendance has no inbox, so keeps its list. */
  /* The inbox needs its own grant; someone without it keeps the list here and the leave requests screen. */
  const inbox = activeApp() === 'people' && can(perms, 'PEOPLE::Requests::VIEW');
  const toDecide = () => (inbox ? openScreen?.('approvals', { kind: 'LEAVE' }) : openScreen?.('leaveRequests'));
  const header = (
    <PageHeader
      breadcrumb={homeCrumbs()}
      title="Who's away"
      actions={can(perms, 'ATTENDANCE::Leave Requests::CREATE') ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Enter leave</button> : null}
    />
  );

  if (req.error && !d) return <div className="space-y-6">{header}<ErrorState error={req.error} onRetry={req.reload} /></div>;
  if (!d) return <div className="space-y-6" aria-busy="true">{header}<SkeletonCard lines={2} /><SkeletonCard lines={6} /></div>;

  /* Working, but not at the office: approved work from home and on duty, their own mark, never leave. */
  const working = d.workingAwayToday || [];
  const strip = [
    { k: 'away', label: 'Away today', tint: 'mint', value: d.awayToday.length + working.length, Icon: mark(CalendarDays), onClick: () => openScreen?.('leaveCalendar') },
    { k: 'waiting', label: 'Waiting for a decision', tint: 'butter', attention: true, value: d.waiting.count, Icon: mark(Clock3), onClick: toDecide },
    { k: 'old', label: 'Waiting over 3 days', tint: 'butter', attention: true, value: d.waiting.olderThan3Days, Icon: mark(Hourglass), onClick: toDecide },
    { k: 'soon', label: 'Away in the next 7 days', tint: 'lilac', value: new Set(d.upcoming.map((r) => r.employeeId)).size, Icon: mark(CalendarClock), onClick: () => openScreen?.('leaveCalendar') },
  ];

  /* Two or more of a department (of a manager's team, all of it) away on one day, today and the next seven (M4). */
  /* India's day, not UTC's: from 00:00 to 05:30 IST the UTC date is still yesterday (UI audit, 7 Nov 2026). */
  const today = d.today || todayIst();
  const clashes = clashDays([...d.awayToday, ...d.upcoming], today, addDays(today, 7), { oneGroup: Boolean(d.team) });

  return (
    <div className="space-y-6">
      {header}
      <div className="ui-metric-strip" role="list" aria-label="Time and leave counts">
        {strip.map(({ k, label, tint, value, Icon, onClick, attention }) => (
          <div key={k} role="listitem" data-tint={tint}><button type="button" className="ui-metric" data-zero={Number(value) === 0 || undefined} data-attention={(attention && Number(value) > 0) || undefined} onClick={onClick}><Icon size={18} aria-hidden="true" className="ui-metric-icon" /><span><span className="ui-metric-value tabular-nums">{value}</span> <span className="ui-metric-label">{label}</span><span className="sr-only">: open</span></span></button></div>
        ))}
      </div>

      {/* Two columns only when both groups show; with the waiting list in Approvals, "Away today" takes the full width. */}
      <div className={`grid gap-6 ${inbox ? '' : '2xl:grid-cols-2'}`}>
        {inbox ? null : <Group title="Waiting for a decision" count={d.waiting.count} action={d.waiting.count > d.waiting.oldest.length ? <button type="button" className="ui-link text-sm" onClick={() => openScreen?.('leaveRequests')}>All {d.waiting.count}</button> : null}>
          {d.waiting.oldest.length ? d.waiting.oldest.map((r) => (
            <li key={r.id}>
              <button type="button" className="flex w-full flex-wrap items-center gap-3 py-2 text-left" onClick={() => open(r)}>
                <Person r={r} />
                <span className="tabular-nums whitespace-nowrap">{range(r.fromDate, r.toDate)}</span>
                <span className="tabular-nums w-20 text-right">{daysText(r.days)}</span>
                <span className="ui-caption w-28 text-right">{r.managerApprovedAt ? 'Manager approved' : `Asked ${waited(r.createdAt)}`}</span>
              </button>
            </li>
          )) : <li className="py-3 text-sm ui-muted">Nothing waiting.</li>}
        </Group>}

        <Group title="Away today" count={d.awayToday.length + working.length}>
          {d.awayToday.length || working.length ? d.awayToday.map((r) => (
            <li key={r.id}>
              <button type="button" className="flex w-full flex-wrap items-center gap-3 py-2 text-left" onClick={() => open(r)}>
                <Person r={r} />
                <span className="ui-caption whitespace-nowrap">{r.halfDay ? (r.halfDay === 'FIRST' ? 'First half' : 'Second half') : `Back ${formatDate(addDays(r.toDate, 1))}`}</span>
              </button>
            </li>
          )).concat(working.map((w) => (
            <li key={`w:${w.id}`}>
              <button type="button" className="flex w-full flex-wrap items-center gap-3 py-2 text-left" onClick={() => openScreen?.('attendanceRequests', { id: w.id, tab: 'APPROVED' })}>
                <span className="flex items-center gap-2.5 min-w-0 flex-1">
                  <Avatar person={{ name: w.employeeName, photoUrl: w.photoUrl }} size={28} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{w.employeeName}</span>
                    <span className="block ui-caption truncate">{[w.place, w.department].filter(Boolean).join(' · ') || 'Working'}</span>
                  </span>
                </span>
                <span className="ui-pill ui-pill-info whitespace-nowrap">{WORKING_LABEL[w.kind] || w.kind}{w.halfDay ? ', half day' : ''}</span>
              </button>
            </li>
          ))) : <li className="py-3 text-sm ui-muted">Everyone is in.</li>}
        </Group>
      </div>

      {clashes.length ? (
        <Group title="Away the same day" count={clashes.length}>
          {clashes.map((c) => (
            <li key={`${c.date}:${c.group || ''}`} className="flex flex-wrap items-center gap-3 py-2">
              <span className="ui-pill ui-pill-warn whitespace-nowrap">{clashWords(c.count)}</span>
              <span className="tabular-nums whitespace-nowrap font-medium">{range(c.date, c.to)}</span>
              <span className="min-w-0 flex-1">{c.group ? `${c.group}: ` : ''}{c.names.join(', ')}{c.waiting ? <span className="ui-caption"> ({c.waiting} waiting)</span> : null}</span>
            </li>
          ))}
        </Group>
      ) : null}

      <Group title="Next 7 days" count={d.upcoming.length || null}>
        {d.upcoming.length ? d.upcoming.map((r) => (
          <li key={r.id}>
            <button type="button" className="flex w-full flex-wrap items-center gap-3 py-2 text-left" onClick={() => open(r)}>
              <Person r={r} />
              <span className="tabular-nums whitespace-nowrap">{range(r.fromDate, r.toDate)}</span>
              {r.status === 'PENDING' ? <span className="ui-pill ui-pill-warn">Waiting</span> : <span className="ui-pill ui-pill-pos">Approved</span>}
            </button>
          </li>
        )) : <li className="py-3 text-sm ui-muted">Nobody is away in the next seven days.</li>}
      </Group>

      {d.lapsing.rows.length ? (
        <Group title={`Lapsing on ${formatDate(d.lapsing.periodEnd)}`} count={d.lapsing.rows.length} action={<button type="button" className="ui-link text-sm" onClick={() => openScreen?.('leaveBalances')}>Balances</button>}>
          {d.lapsing.rows.map((x) => (
            <li key={`${x.employeeId}:${x.leaveTypeName}`} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1 font-medium">{x.employeeName}</span>
              <span>{x.leaveTypeName}</span>
              <span className="tabular-nums w-20 text-right">{daysText(x.days)}</span>
            </li>
          ))}
        </Group>
      ) : null}

      {adding ? <EnterLeave openScreen={openScreen} onClose={() => setAdding(false)} onDone={() => { setAdding(false); req.reload(); }} /> : null}
    </div>
  );
}
