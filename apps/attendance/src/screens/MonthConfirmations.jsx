import React, { useCallback, useEffect, useState } from 'react';

import { EmptyState, PageHeader, SkeletonCard, StatTile } from '@ui/components/ui/Primitives';
import { getMonthReadiness, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

/**
 * Employees confirm their month in the app, or say what is wrong with it.
 * The disputes are worth reading before the month is closed.
 */
const lastMonth = () => {
  const [y, m] = todayIst().slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};

export default function MonthConfirmations() {
  const [month, setMonth] = useState(lastMonth());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setData(null);
    getMonthReadiness(month).then((d) => { setData(d.confirmations); setError(''); }).catch((e) => setError(String(e?.message || 'Could not load.')));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Employee confirmations"
        description="Who has confirmed their month in the app, and who says something is wrong."
        actions={<input type="month" className="ui-input !w-auto" value={month} max={todayIst().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />}
      />
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        <SkeletonCard />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Using the app" value={data.portalPeople} />
            <StatTile label="Confirmed" value={data.confirmed} />
            <StatTile label="Say it is wrong" value={data.disputed.length} />
            <StatTile label="Not yet" value={data.notYet} />
          </div>
          {data.disputed.length === 0 ? (
            <EmptyState title="No disputes" description="When someone says their month is wrong, what they wrote appears here." />
          ) : (
            <div className="ui-card overflow-x-auto">
              <table className="ui-table w-full">
                <thead><tr><th>Employee</th><th>What they say</th><th>When</th></tr></thead>
                <tbody>
                  {data.disputed.map((d) => (
                    <tr key={d.employeeId}><td>{d.name}</td><td className="max-w-md">{d.note}</td><td>{new Date(d.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
