import React from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, Clock, Inbox, Fingerprint, RefreshCw } from 'lucide-react';
import { DashboardHeader, DashboardBlock, DashboardFigures } from '../screens/PeopleDashboard';
import { ExceptionTag } from '@ui/components/ui/ExceptionTag';
import { Avatar } from '@ui/personnel/Employees';
import useRequest from '@ui/components/ui/useRequest';
import { getMyDays, getTimeOverview, listRecords, todayIst } from '@ui/timeOff/api';
import { addDaysIso } from '@ui/utils/dates';
import { getPayrollReadiness, listExceptions, listUnmatchedPunches } from '../../../attendance/src/api/attendance';
import { getInbox } from '../api/approvals';
import { usePeopleUpdates } from '../screens/usePeopleUpdates';

const queues = { leaveRequests: 'LEAVE', attendanceRequests: 'ATTENDANCE', overtime: 'OVERTIME' };
const shortDate = (date, options = { day: 'numeric', month: 'short' }) =>
  date && new Date(date.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', ...options });
const amount = (value, singular, plural = singular + 's') => value + ' ' + (value === 1 ? singular : plural);
const details = (...parts) => parts.filter(Boolean).join(' · ');

function Destination({ page, title = page.label, detail, badge, tone, openScreen }) {
  const Icon = page.icon;
  return <li><button type="button" className="people-row people-row-action" onClick={() => openScreen(page.key, page.params)}>
    {Icon && <Icon size={19} aria-hidden="true" className="shrink-0" />}
    <span className="min-w-0 flex-1">
      <span className="people-row-title">{title}</span>
      {detail && <span className="ui-caption block">{detail}</span>}
      {badge && <ExceptionTag label={badge} tone={tone === 'clear' ? 'pos' : 'warn'} />}
    </span>
    <ArrowRight size={16} className="shrink-0 text-[rgb(var(--link))]" aria-hidden="true" />
  </button></li>;
}

function Message({ source, empty }) {
  if (source.error) return <p className="people-empty" role="status">Couldn’t update this section. <button type="button" className="ui-link" onClick={source.reload}>Retry</button></p>;
  if (!source.data) return <p className="people-empty" role="status">Loading…</p>;
  return empty ? <p className="people-empty">{empty}</p> : null;
}

export default function TimeWorkspace({ overviewModule, navItems = [], openScreen }) {
  const pages = overviewModule?.items || [];
  const page = Object.fromEntries(pages.map((item) => [item.key, item]));
  const reviewPages = pages.filter((p) => queues[p.key]);
  const issues = overviewModule?.shortcuts || [];
  const today = todayIst();
  const yesterday = addDaysIso(today, -1);
  const month = addDaysIso(today.slice(0, 7) + '-01', -1).slice(0, 7);
  const monthLabel = shortDate(month + '-01', { month: 'long', year: 'numeric' });
  const personalOnly = !page.attendance && !page.timeOverview && !issues.length && !reviewPages.length;
  const review = useRequest(getInbox, [], { enabled: !!reviewPages.length });
  const daily = useRequest(() => listRecords({ from: today, to: today }), [today], { enabled: !!page.attendance });
  const leave = useRequest(getTimeOverview, [today], { enabled: !!page.timeOverview });
  const exceptions = useRequest(() => listExceptions({ from: addDaysIso(today, -14), to: yesterday, show: 'open' }), [today], { enabled: !!page.exceptions });
  const pins = useRequest(listUnmatchedPunches, [], { enabled: !!page.unmatched });
  const payroll = useRequest(() => getPayrollReadiness(month), [month], { enabled: !!page.payrollReadiness });
  const mine = useRequest(getMyDays, [today], { enabled: personalOnly && !!page.myDays });
  usePeopleUpdates(() => { review.reload(); daily.reload(); leave.reload(); mine.reload(); });
  const sources = [daily, leave, review, exceptions, pins, payroll, mine];
  const waiting = reviewPages.filter((p) => review.data?.counts?.[queues[p.key]] > 0);
  const away = leave.data?.awayToday || [];
  const present = daily.data?.filter((r) => ['PRESENT', 'HALF_DAY'].includes(r.status)).length;
  const inbox = navItems.some((item) => item.key === 'approvals');
  const punchCount = pins.data?.reduce((n, r) => n + r.punches, 0);
  const figures = [
    page.attendance && { key: 'in', label: 'Present today', value: daily.data?.length >= 2000 ? present + '+' : present, action: 'Daily attendance', onClick: () => openScreen('attendance') },
    page.timeOverview && { key: 'out', label: 'On approved leave', value: leave.data && new Set(away.map((r) => r.employeeId)).size, action: 'View leave', onClick: () => openScreen('timeOverview') },
    !!reviewPages.length && { key: 'review', label: 'Awaiting your review', value: review.data && waiting.reduce((n, p) => n + review.data.counts[queues[p.key]], 0), action: 'Open inbox', onClick: inbox ? () => openScreen('approvals') : null },
    page.unmatched && { key: 'unmatched', label: 'Unmatched punches', value: punchCount, action: 'Match punches', onClick: () => openScreen('unmatched') },
  ].filter(Boolean);

  const openDays = exceptions.data?.exceptions || [];
  const exceptionCount = Object.values(exceptions.data?.counts || {}).reduce((a, b) => a + b, 0);
  const firstDay = openDays[0];
  const reader = pins.data?.[0];
  const blocks = payroll.data?.issues?.filter((issue) => issue.blocks) || [];
  const problem = payroll.data?.blockers?.[0];
  const previews = {
    exceptions: { source: exceptions, badge: exceptionCount + ' open', detail: firstDay ? details(firstDay.employeeName, firstDay.title, shortDate(firstDay.date)) : 'No open exceptions in the last 14 completed days.', warn: exceptionCount > 0 },
    unmatched: { source: pins, badge: amount(pins.data?.length || 0, 'reader ID'), detail: reader ? details('ID ' + reader.pin, reader.areaName || reader.readerName, amount(reader.punches, 'punch', 'punches')) : 'All reader IDs are matched.', warn: !!reader },
    payrollReadiness: { source: payroll, badge: amount(blocks.length, 'blocker'), detail: details(monthLabel, blocks[0]?.title || 'No blocking issues', problem?.name), warn: blocks.length > 0 },
  };
  const shift = mine.data?.records?.find((r) => r.date === today);
  const quickLinks = ['leaveCalendar', 'attendance'].map((key) => page[key]).filter(Boolean);
  return <div className="people-home people-home--daily">
    <DashboardHeader title="Time overview" action={inbox && waiting.length > 0 ?
      <button type="button" className="ui-btn ui-btn-primary" onClick={() => openScreen('approvals')}><Inbox size={16} aria-hidden="true" /> Open inbox</button> : null}>
      <nav className="people-brief-links" aria-label="Time destinations">
        {quickLinks.map((link) => <a key={link.key} className="people-arrow-link" href={`?app=people&open=${link.key}`} onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); openScreen(link.key);
        }}>{link.label}<ArrowUpRight size={16} aria-hidden="true" /></a>)}
        <button className="people-arrow-link" type="button" onClick={() => sources.forEach((source) => source.reload())}>Refresh <RefreshCw size={15} aria-hidden="true" /></button>
      </nav>
    </DashboardHeader>
    <div className="people-home-work">
      {issues.length > 0 && <DashboardBlock id="time-issues" title="Resolve an issue" className="people-home-queue">
        <ul className="people-list">{issues.map((issue) => {
          const { source, badge, detail, warn } = previews[issue.key];
          return <Destination key={issue.key} page={page[issue.key]} title={issue.label}
            detail={source.error ? 'Summary unavailable. Open to review.' : source.data ? detail : 'Loading…'}
            badge={source.data && !source.error ? badge : null} tone={warn ? 'attention' : 'clear'} openScreen={openScreen} />;
        })}</ul>
      </DashboardBlock>}
      {(reviewPages.length > 0 || page.timeOverview) && <div className="people-home-day">
        {reviewPages.length > 0 && <DashboardBlock id="time-review" title="Waiting for review" className="people-home-personal">
          <ul className="people-list">{waiting.map((p) => {
            const item = review.data.items?.find((r) => r.kind === queues[p.key]);
            return <Destination key={p.key} page={p} detail={item && details(item.employeeName, item.minutes ? amount(item.minutes, 'min', 'min') : item.what, shortDate(item.fromDate))}
              badge={review.data.counts[queues[p.key]] + ' waiting'} openScreen={openScreen} />;
          })}</ul><Message source={review} empty={!waiting.length && 'No requests are waiting for your decision.'} />
        </DashboardBlock>}
        {page.timeOverview && <DashboardBlock id="time-away" title="On leave today" className="people-home-away" action={<button className="people-more" onClick={() => openScreen('timeOverview')}>View all</button>}>
          <ul className="people-list">{away.slice(0, 4).map((r) => <li key={r.id}><div className="people-row"><Avatar person={{ name: r.employeeName, photoUrl: r.photoUrl }} size={36} />
            <span className="people-away-details min-w-0"><span className="people-row-title">{r.employeeName}</span><span className="ui-caption block">{details(r.leaveTypeName, r.department)}</span>
              <span className="ui-caption block">{r.halfDay ? 'Half day' : 'Through ' + shortDate(r.toDate)}</span></span></div></li>)}</ul>
          <Message source={leave} empty={!away.length && 'No approved leave today.'} /></DashboardBlock>}
      </div>}
      {page.attendance && <DashboardBlock id="time-records" title="Today’s attendance" className="people-home-events" action={<button className="people-more" onClick={() => openScreen('attendance')}>View all</button>}>
        <ul className="people-list">{daily.data?.slice(0, 4).map((r) => <li key={r.id}><div className="people-row">
          <Avatar person={{ name: r.employeeName || r.name, photoUrl: r.photoUrl }} size={36} />
          <span className="min-w-0"><span className="people-row-title">{r.employeeName || r.name}</span><span className="ui-caption block">{r.shiftLabel || r.department}</span>
            <span className="ui-caption block">{r.checkInTime ? details('In ' + r.checkInTime, r.checkOutTime && 'Out ' + r.checkOutTime) : String(r.status || '').toLowerCase().replaceAll('_', ' ')}</span></span>
        </div></li>)}</ul>
        <Message source={daily} empty={!daily.data?.length && 'No attendance recorded today.'} /></DashboardBlock>}
      {personalOnly && <DashboardBlock id="time-personal" title={page.myDays ? 'My time' : 'Time pages'} className="people-home-queue">
        <ul className="people-list">{pages.filter((p) => !p.overviewOf).map((p) =>
          <Destination key={p.key} page={p} detail={p.key === 'myDays' && mine.data ? shift?.checkInTime ? details('In ' + shift.checkInTime, shift.checkOutTime && 'Out ' + shift.checkOutTime) : 'No check-in recorded today' : undefined} openScreen={openScreen} />)}</ul>
        {mine.error && <Message source={mine} />}</DashboardBlock>}
    </div>
    {figures.length > 0 && <DashboardFigures id="time-figures" title={`Time summary · ${shortDate(today, { weekday: 'short', day: 'numeric', month: 'short' })}`}
      figures={figures} icons={{ in: Clock, out: CalendarDays, review: Inbox, unmatched: Fingerprint }} />}
  </div>;
}
