import React, { useState } from 'react';
import { CalendarClock, CalendarDays, Clock3, Hourglass, Plus } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { usePermissions } from '@ui/permissions/usePermissions';
import { Avatar } from '@ui/personnel/Employees';

import { can, homeCrumbs } from './shared';
import { daysText, getTimeOverview } from './api';
import { EnterLeave, TypeDot } from './LeaveRequests';

/**
 * Time & Leave → Overview: the owner's morning question — who is away, what
 * is waiting for me, who is away soon — on one page (TIME-LEAVE-DECISIONS.md).
 * The strip counts; the lists below are the people behind the counts, each
 * opening the request it is about. Days that lapse at the period end show
 * only in its last two months, when something can still be done about them.
 */
const range = (from, to) => (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const waited = (at) => { const d = Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000)); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };

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
  const perms = usePermissions();
  const req = useRequest(() => getTimeOverview(), []);
  const [adding, setAdding] = useState(false);
  const d = req.data;
  const open = (r) => openScreen?.('leaveRequests', { id: r.id, tab: r.status === 'PENDING' ? null : 'all' });
  const header = (
    <PageHeader
      breadcrumb={homeCrumbs()}
      title="Time & Leave"
      actions={can(perms, 'ATTENDANCE::Leave Requests::CREATE') ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Enter leave</button> : null}
    />
  );

  if (req.error && !d) return <div className="space-y-6">{header}<ErrorState error={req.error} onRetry={req.reload} /></div>;
  if (!d) return <div className="space-y-6" aria-busy="true">{header}<SkeletonCard lines={2} /><SkeletonCard lines={6} /></div>;

  const strip = [
    { k: 'away', label: 'Away today', value: d.awayToday.length, Icon: CalendarDays, onClick: () => openScreen?.('leaveCalendar') },
    { k: 'waiting', label: 'Waiting for a decision', value: d.waiting.count, Icon: Clock3, onClick: () => openScreen?.('leaveRequests') },
    { k: 'old', label: 'Waiting over 3 days', value: d.waiting.olderThan3Days, Icon: Hourglass, onClick: () => openScreen?.('leaveRequests') },
    { k: 'soon', label: 'Away in the next 7 days', value: new Set(d.upcoming.map((r) => r.employeeId)).size, Icon: CalendarClock, onClick: () => openScreen?.('leaveCalendar') },
  ];

  return (
    <div className="space-y-6">
      {header}
      <div className="ui-metric-strip" role="list" aria-label="Time and leave counts">
        {strip.map(({ k, label, value, Icon, onClick }) => (
          <div key={k} role="listitem"><button type="button" className="ui-metric" onClick={onClick} aria-label={`${value} ${label}: open`}><Icon size={18} aria-hidden="true" className="ui-metric-icon" /><span><span className="ui-metric-value tabular-nums">{value}</span><span className="ui-metric-label">{label}</span></span></button></div>
        ))}
      </div>

      <div className="grid gap-6 2xl:grid-cols-2">
        <Group title="Waiting for a decision" count={d.waiting.count} action={d.waiting.count > d.waiting.oldest.length ? <button type="button" className="ui-link text-sm" onClick={() => openScreen?.('leaveRequests')}>All {d.waiting.count}</button> : null}>
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
        </Group>

        <Group title="Away today" count={d.awayToday.length}>
          {d.awayToday.length ? d.awayToday.map((r) => (
            <li key={r.id}>
              <button type="button" className="flex w-full flex-wrap items-center gap-3 py-2 text-left" onClick={() => open(r)}>
                <Person r={r} />
                <span className="ui-caption whitespace-nowrap">{r.halfDay ? (r.halfDay === 'FIRST' ? 'First half' : 'Second half') : `Back ${formatDate(addDays(r.toDate, 1))}`}</span>
              </button>
            </li>
          )) : <li className="py-3 text-sm ui-muted">Everyone is in.</li>}
        </Group>
      </div>

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

      {adding ? <EnterLeave onClose={() => setAdding(false)} onDone={() => { setAdding(false); req.reload(); }} /> : null}
    </div>
  );
}
