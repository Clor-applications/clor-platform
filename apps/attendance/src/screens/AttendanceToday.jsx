import React, { useEffect, useState } from 'react';
import { Clock, UserCheck, UserX, Users } from 'lucide-react';

import { PageHeader, SkeletonCard, StatTile } from '@ui/components/ui/Primitives';
import { getOverview, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

/** Who is in today, who is late, who has not come — after Horilla's dashboard. */
export default function AttendanceToday({ openScreen }) {
  const [date, setDate] = useState(todayIst());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getOverview(date)
      .then((d) => !cancelled && (setData(d), setError('')))
      .catch((e) => !cancelled && setError(String(e?.message || 'Could not load today.')));
    return () => {
      cancelled = true;
    };
  }, [date, attempt]);

  return (
    <div className="space-y-6">
      <PageHeader
        entity="attendance"
        title="Today"
        description={data?.holiday ? `Holiday: ${data.holiday}` : 'Attendance at a glance.'}
        actions={
          <input type="date" className="ui-input" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} aria-label="Day" />
        }
      />
      <LoadFailed message={error} onRetry={() => setAttempt((n) => n + 1)} />
      {!data ? (
        error ? null : <SkeletonCard lines={6} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Headcount" value={data.headcount} icon={Users} />
            <StatTile label="Present" value={data.present + data.halfDay} icon={UserCheck} tone="pos" hint={data.halfDay ? `${data.halfDay} half day` : null} />
            <StatTile label="Late" value={data.late.length} icon={Clock} tone={data.late.length ? 'warn' : 'neutral'} />
            {/* Red only when there is something to see: "0 absent" is good news, not an alarm. */}
            <StatTile label="Absent" value={data.absent} icon={UserX} tone={data.absent ? 'neg' : 'neutral'} />
            <StatTile label="Not marked" value={data.notMarked} hint={data.onLeave ? `${data.onLeave} on leave` : null} />
          </div>

          {data.toValidate || data.pendingRequests || data.pendingLeave ? (
            <div className="ui-card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm" role="status">
              <span className="ui-label !mb-0">Waiting for you</span>
              {[
                [data.toValidate, data.toValidate === 1 ? 'day to validate' : 'days to validate', 'records'],
                [data.pendingRequests, data.pendingRequests === 1 ? 'correction request' : 'correction requests', 'requests'],
                [data.pendingLeave, data.pendingLeave === 1 ? 'leave request' : 'leave requests', 'leaveRequests'],
              ]
                .filter(([n]) => n)
                .map(([n, what, key]) =>
                  openScreen ? (
                    <button key={key} type="button" className="ui-link text-sm" onClick={() => openScreen(key)}>
                      <strong className="tabular-nums">{n}</strong> {what}
                    </button>
                  ) : (
                    <span key={key}>
                      <strong className="tabular-nums">{n}</strong> {what}
                    </span>
                  )
                )}
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="ui-card p-5" aria-labelledby="late-h">
              <h2 id="late-h" className="ui-t-sec mb-3">Late {date === todayIst() ? 'today' : 'that day'}</h2>
              {data.late.length ? (
                <ul className="divide-y">
                  {data.late.map((l) => (
                    <li key={l.employeeId} className="flex items-center justify-between py-2 text-sm">
                      <span>{l.employeeName}</span>
                      <span className="ui-caption tabular-nums">in {l.checkInTime} · {l.lateMinutes} min late</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ui-muted text-sm">Nobody.</p>
              )}
            </section>
            <section className="ui-card p-5" aria-labelledby="notin-h">
              <h2 id="notin-h" className="ui-t-sec mb-3">Not clocked in</h2>
              {data.notIn.length ? (
                <ul className="grid gap-1 sm:grid-cols-2">
                  {data.notIn.map((p) => (
                    <li key={p.id} className="truncate text-sm">{p.name}<span className="ui-caption"> {p.department ? `· ${p.department}` : ''}</span></li>
                  ))}
                </ul>
              ) : (
                <p className="ui-muted text-sm">Everyone is in.</p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
