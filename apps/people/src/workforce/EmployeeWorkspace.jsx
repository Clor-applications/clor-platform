import React from 'react';
import { ArrowRight, ArrowUpRight, CalendarClock, Files, Hourglass, LogOut, Plus, Users } from 'lucide-react';
import useRequest from '@ui/components/ui/useRequest';
import { listCompanyDocuments } from '@ui/personnel/api';
import { Avatar } from '@ui/personnel/Employees';
import { pageChanges, pageJoiners, pageTasks } from '@ui/lifecycle/api';
import { formatDate } from '@ui/components/ui/DatePicker';
import { todayIst } from '@ui/utils/dates';
import { employeeCounts } from './api';
import { DashboardHeader, DashboardBlock, DashboardFigures } from '../screens/PeopleDashboard';
import { usePeopleUpdates } from '../screens/usePeopleUpdates';

const icons = { headcount: Users, joining: CalendarClock, probation: Hourglass, notice: LogOut, documents: Files };
const join = (...parts) => parts.filter(Boolean).join(' · ');

function LoadMessage({ source, empty }) {
  if (source.error) return <p className="people-empty" role="status">Couldn’t update this list. <button className="ui-link" onClick={source.reload}>Retry</button></p>;
  if (!source.data) return <p className="people-empty" role="status">Loading…</p>;
  return empty ? <p className="people-empty">{empty}</p> : null;
}

export default function EmployeeWorkspace({ overviewModule, navItems = [], openScreen }) {
  const items = overviewModule?.items || [];
  const pages = Object.fromEntries(items.map((item) => [item.key, item]));
  const mayAdd = navItems.some((item) => item.key === 'employeeNew');
  const taskView = pages.employees ? 'late' : 'mine';
  const counts = useRequest(employeeCounts, [], { enabled: !!pages.employees });
  const tasks = useRequest(() => pageTasks({ view: taskView, limit: 3 }), [taskView], { enabled: !!pages.checklists });
  const docs = useRequest(listCompanyDocuments, [], { enabled: !!pages.documents });
  const joining = useRequest(() => pageJoiners({ view: 'preparing', limit: 3 }), [], { enabled: !!pages.joiners });
  const probation = useRequest(() => pageChanges({ view: 'probation', limit: 3 }), [], { enabled: !!pages.lifecycleChanges });
  usePeopleUpdates(() => { counts.reload(); tasks.reload(); docs.reload(); joining.reload(); probation.reload(); });

  const today = todayIst();
  const expired = (docs.data || []).filter((d) => d.expiresOn && d.expiresOn < today).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  const ownTasks = tasks.data?.mineOnly || taskView === 'mine';
  const tasksTarget = { view: ownTasks ? 'mine' : 'late' };
  const firstTask = tasks.data?.rows?.[0];
  const firstDoc = expired[0];
  const queue = [
    pages.checklists && { key: 'checklists', label: ownTasks ? 'My open tasks' : 'Overdue tasks', source: tasks, number: tasks.data?.total,
      detail: firstTask ? join(firstTask.title, firstTask.employee?.name, firstTask.dueDate && 'Due ' + formatDate(firstTask.dueDate)) : null,
      action: 'View tasks', params: tasksTarget },
    pages.documents && { key: 'documents', label: 'Expired documents', source: docs, number: docs.data && expired.length,
      detail: firstDoc ? join(firstDoc.title, firstDoc.employeeName, 'Expired ' + formatDate(firstDoc.expiresOn)) : null,
      action: 'Review documents', params: { tab: 'expired' } },
  ].filter(Boolean);
  const figures = [
    pages.employees && { key: 'headcount', label: 'Working now', value: counts.data?.total, action: 'Open directory', onClick: () => openScreen('employees', { working: 'now' }) },
    pages.joiners && { key: 'joining', label: 'Upcoming starters', value: joining.data?.total, action: 'View joining', onClick: () => openScreen('joiners', { view: 'preparing' }) },
    pages.lifecycleChanges && { key: 'probation', label: 'Probation ending', value: probation.data?.total, detail: 'Next 30 days', action: 'Review probation', onClick: () => openScreen('lifecycleChanges', { view: 'probation' }) },
    pages.employees && counts.data?.onNotice != null && !counts.data.leavingsHidden && { key: 'notice', label: 'On notice', value: counts.data.onNotice, action: 'View employees', onClick: () => openScreen('employees', { status: 'ON_NOTICE' }) },
  ].filter(Boolean);
  const quickPages = ['employees', 'orgChart', 'documents'].map((key) => pages[key]).filter(Boolean);
  return <div className="people-home people-home--daily">
    <DashboardHeader title="Employees overview" action={mayAdd && <button type="button" className="ui-btn ui-btn-primary" onClick={() => openScreen('employeeNew')}><Plus size={16} aria-hidden="true" /> Add employee</button>}>
      {quickPages.length > 0 && <nav className="people-brief-links" aria-label="Employee destinations">
        {quickPages.map((page) => <a className="people-arrow-link" key={page.key} href={`?app=people&open=${page.key}`} onClick={(event) => {
          if (event.button || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
          event.preventDefault(); openScreen(page.key);
        }}>{page.key === 'employees' ? 'Employee directory' : page.label}<ArrowUpRight size={16} aria-hidden="true" /></a>)}
      </nav>}
    </DashboardHeader>
    <div className="people-home-work">
      {queue.length > 0 && <DashboardBlock id="employee-work" title="Needs attention" className="people-home-queue">
        <ul className="people-list people-work-list">{queue.map((q) => <li className="people-work-item" key={q.key}>
          <div className="people-work-item-label"><span className="people-work-count tabular-nums">{q.number ?? '—'}</span><div>
            <h3 className="people-row-title">{q.label}</h3>{(q.source.error || !q.source.data || q.detail) && <span className="ui-caption">{q.source.error ? 'Couldn’t update this list.' : q.source.data ? q.detail : 'Loading…'}</span>}
          </div></div><button className="people-arrow-link" onClick={() => openScreen(q.key, q.params)}>{q.action}<ArrowRight size={16} aria-hidden="true" /></button>
        </li>)}</ul>
      </DashboardBlock>}
      {pages.joiners && <DashboardBlock id="employee-starts" title="Upcoming starters" className="people-home-personal" action={<button className="people-more" onClick={() => openScreen('joiners', { view: 'preparing' })}>View all</button>}>
        <ul className="people-list">{joining.data?.rows?.map((r) => <li key={r.id}><div className="people-row"><Avatar person={r} size={32} />
          <span className="min-w-0"><strong className="people-row-title">{r.name}</strong><span className="ui-caption block">{join(formatDate(r.dateOfJoining), r.designation)}</span>
          <span className="ui-caption block">{r.total ? `${r.done} of ${r.total} steps complete` : 'No joining plan'}</span></span></div></li>)}</ul>
        <LoadMessage source={joining} empty={!joining.data?.rows?.length && 'No upcoming starters.'} />
      </DashboardBlock>}
      {pages.lifecycleChanges && <DashboardBlock id="employee-probation" title="Probation reviews" className="people-home-events" action={<button className="people-more" onClick={() => openScreen('lifecycleChanges', { view: 'probation' })}>View all</button>}>
        <ul className="people-list">{probation.data?.rows?.map((r) => <li key={r.id || r.employee.id}><div className="people-row"><Avatar person={r.employee} size={32} />
          <span className="min-w-0"><strong className="people-row-title">{r.employee.name}</strong><span className="ui-caption block">{join(r.employee.code, 'Ends ' + formatDate(r.date))}</span></span></div></li>)}</ul>
        <LoadMessage source={probation} empty={!probation.data?.rows?.length && 'No probation periods end in the next 30 days.'} />
      </DashboardBlock>}
      {!queue.length && !pages.joiners && !pages.lifecycleChanges && <DashboardBlock id="employee-pages" title="Employee pages" className="people-home-queue">
        <ul className="people-list">{items.filter((p) => !p.overviewOf).map((p) => <li key={p.key}><button className="people-arrow-link" onClick={() => openScreen(p.key)}>{p.label}<ArrowRight size={16} aria-hidden="true" /></button></li>)}</ul>
      </DashboardBlock>}
    </div>
    {!!figures.length && <DashboardFigures id="employee-summary" title="Employee summary" figures={figures} icons={icons} />}
    {counts.error && <LoadMessage source={counts} />}
  </div>;
}
