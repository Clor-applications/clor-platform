import React, { useEffect, useState } from 'react';
import { CheckCheck, ChevronRight, Cake, Megaphone, UserMinus, UserPlus, Users } from 'lucide-react';

import { EmptyState, PageHeader, SkeletonCard, StatTile } from '@ui/components/ui/Primitives';
import { getOverview, getPeopleHome, listMyTasks, updateChecklistTask } from '@ui/personnel/api';
import { notify } from '@ui/components/ui/notify';
import { formatDateIn } from '@ui/utils/dates';
import { Avatar } from '@ui/personnel/Employees';
import { HomeCheckIn } from '@ui/timeOff/MyDays';

const TONE = { urgent: { label: 'Now', pill: 'neg' }, soon: { label: 'This week', pill: 'warn' }, info: { label: 'When you can', pill: 'neutral' } };
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/**
 * People → Home (founder, 22 Oct 2026: simpler than the HR apps on the
 * market). First what needs someone today, most urgent first, each one click
 * from the screen that does it; then the few shortcuts people use most; then
 * who works here.
 */
export default function PeopleOverview({ openScreen }) {
  const [data, setData] = useState(null);
  const [todos, setTodos] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState('');
  const loadTasks = () => listMyTasks().then(setTasks).catch(() => setTasks([]));
  const tick = async (t) => {
    try {
      await updateChecklistTask(t.id, { done: true });
      setTasks((list) => (list || []).filter((x) => x.id !== t.id));
      notify.success(`${t.title}: done.`);
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };

  useEffect(() => {
    getOverview()
      .then(setData)
      .catch((e) => setError(String(e?.message || 'Could not load the overview.')));
    getPeopleHome()
      .then(setTodos)
      .catch(() => setTodos([]));
    loadTasks();
  }, []);
  const go = (screen, params) => () => openScreen?.(screen, params);

  if (error) return <div className="ui-card p-4 text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</div>;
  if (!data) return <SkeletonCard lines={6} />;

  const peak = Math.max(1, ...data.byDepartment.map((d) => d.count));

  return (
    <div className="space-y-6">
      <PageHeader entity="people" title={greeting()} description="What needs you today, then who works here." />
      <HomeCheckIn />

      {tasks?.filter((t) => !t.done).length ? (
        <section className="space-y-2" aria-labelledby="mytasks-h">
          <h2 id="mytasks-h" className="ui-t-sec">Your tasks</h2>
          <ul className="ui-card divide-y">
            {tasks.filter((t) => !t.done).slice(0, 12).map((t) => (
              <li key={t.id} className="flex items-start gap-3 p-3">
                <input type="checkbox" className="mt-1" aria-label={`Done: ${t.title}`} onChange={() => tick(t)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{t.title} <span className="ui-muted">· {t.employee?.name}</span></p>
                  <p className="ui-caption">{t.kind.charAt(0)}{t.kind.slice(1).toLowerCase()}{t.dueDate ? ` · due ${formatDateIn(t.dueDate)}` : ''}{t.overdue ? <span className="ui-pill ui-pill-neg ml-2">Overdue</span> : null}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2" aria-labelledby="todo-h">
        <h2 id="todo-h" className="ui-t-sec">To do</h2>
        {!todos ? (
          <SkeletonCard lines={3} />
        ) : todos.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {todos.map((t) => (
              <li key={t.key}>
                <button type="button" onClick={go(t.screen, t.params)} className="ui-card w-full p-4 text-left flex items-center gap-4 hover:border-[rgb(var(--brand))]">
                  <span className="text-2xl font-semibold tabular-nums w-12 text-center">{t.count}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{t.title}</span>
                      <span className={`ui-pill ui-pill-${TONE[t.tone]?.pill || 'neutral'}`}>{TONE[t.tone]?.label}</span>
                    </span>
                    <span className="ui-caption block">{t.detail}</span>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={CheckCheck} title="All caught up" description="Nothing waits for you: no late onboarding items, payroll details, deadlines, leave, cases or candidates." />
        )}
      </section>

      <section className="flex flex-wrap gap-2" aria-label="Shortcuts">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={go('employeeNew')}><UserPlus size={16} aria-hidden="true" /> Add an employee</button>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={go('leaveRequests')}>Leave requests</button>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={go('helpdesk')}>HR cases</button>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={go('announcements')}><Megaphone size={16} aria-hidden="true" /> Post an announcement</button>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Headcount" value={data.headcount} icon={Users} />
        <StatTile label="On notice" value={data.byStatus.ON_NOTICE || 0} tone="warn" />
        <StatTile label="Joined this month" value={data.joinedThisMonth.length} icon={UserPlus} tone="pos" />
        <StatTile label="Left this month" value={data.leftThisMonth} icon={UserMinus} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="ui-card p-5" aria-labelledby="by-dept">
          <h2 id="by-dept" className="ui-t-sec mb-3">By department</h2>
          {data.byDepartment.length ? (
            <ul className="space-y-2">
              {data.byDepartment.map((d) => (
                <li key={d.name} className="grid grid-cols-[10rem_1fr_2.5rem] items-center gap-3 text-sm">
                  <span className="truncate">{d.name}</span>
                  <span className="h-2 rounded-full" style={{ backgroundColor: 'rgb(var(--brand-soft))' }}>
                    <span className="block h-2 rounded-full" style={{ width: `${(d.count / peak) * 100}%`, backgroundColor: 'rgb(var(--brand))' }} />
                  </span>
                  <span className="text-right tabular-nums">{d.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ui-muted text-sm">Nobody yet.</p>
          )}
        </section>

        <section className="ui-card p-5" aria-labelledby="birthdays">
          <h2 id="birthdays" className="ui-t-sec mb-3 flex items-center gap-2"><Cake size={16} aria-hidden="true" /> Birthdays, next 30 days</h2>
          {data.upcomingBirthdays.length ? (
            <ul className="space-y-2">
              {data.upcomingBirthdays.map((b) => (
                <li key={b.id} className="flex items-center gap-2 text-sm">
                  <Avatar person={b} size={28} />
                  <span className="flex-1 truncate">{b.name}</span>
                  <span className="ui-caption">{b.days === 0 ? 'Today' : b.days === 1 ? 'Tomorrow' : new Date(b.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ui-muted text-sm">None coming up.</p>
          )}
        </section>
      </div>

      {data.joinedThisMonth.length ? (
        <section className="ui-card p-5" aria-labelledby="joiners">
          <h2 id="joiners" className="ui-t-sec mb-3">New this month</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.joinedThisMonth.map((j) => (
              <li key={j.id} className="flex items-center gap-2 text-sm">
                <Avatar person={j} size={28} />
                <span className="min-w-0 flex-1 truncate">{j.name}<span className="ui-caption"> · {j.designation || '—'}</span></span>
                <span className="ui-caption">{j.date}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
