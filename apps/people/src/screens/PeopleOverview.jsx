import React, { useEffect, useState } from 'react';
import { Cake, UserMinus, UserPlus, Users } from 'lucide-react';

import { PageHeader, SkeletonCard, StatTile } from '@ui/components/ui/Primitives';
import { getOverview } from '../api/people';
import { Avatar } from './Employees';

/** People at a glance, after Horilla's employee dashboard. */
export default function PeopleOverview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getOverview()
      .then(setData)
      .catch((e) => setError(String(e?.message || 'Could not load the overview.')));
  }, []);

  if (error) return <div className="ui-card p-4 text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</div>;
  if (!data) return <SkeletonCard lines={6} />;

  const peak = Math.max(1, ...data.byDepartment.map((d) => d.count));

  return (
    <div className="space-y-6">
      <PageHeader entity="people" title="People" description="Who works here, and what is changing." />

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
