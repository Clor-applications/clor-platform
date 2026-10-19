import React, { useEffect, useState } from 'react';
import { CalendarCheck, CalendarOff, ChevronRight, Clock, Cpu, Inbox, ListChecks, UserCheck, UserX, Users } from 'lucide-react';

import { PageHeader, SkeletonCard, StatTile } from '@ui/components/ui/Primitives';
import { getCalendar, getOverview, getReaderHealth, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

/* The reader states the server already decides (Reader health uses the same words). */
const READER = {
  ok: { label: 'Healthy', tone: 'pos' },
  delayed: { label: 'Late checking in', tone: 'warn' },
  warn: { label: 'Needs a look', tone: 'warn' },
  bad: { label: 'Problem', tone: 'neg' },
  offline: { label: 'Offline', tone: 'neg' },
  off: { label: 'Switched off', tone: 'neutral' },
};
const ago = (iso) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};
const weekday = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });

/** Who is in today, who is late, who has not come, and what is waiting for HR. */
/** The DPDP changes of 19 October 2026, announced once per browser until opened or dismissed (the Data protection screen keeps the full list). */
const DPDP_KEY = 'clor.dpdp.announcement.2026-10-19';
function DpdpNotice({ openScreen }) {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(DPDP_KEY) === 'seen';
    } catch {
      return false;
    }
  });
  if (seen || !openScreen) return null;
  const close = () => {
    try {
      localStorage.setItem(DPDP_KEY, 'seen');
    } catch {
      /* shown again next time */
    }
    setSeen(true);
  };
  return (
    <div className="ui-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm" role="status">
      <span><strong>Data protection (DPDP):</strong> fingerprint copies are now off unless you switch them on, under-18s are never tracked, and employees get a privacy notice and their rights in the portal.</span>
      <span className="flex gap-2">
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => { close(); openScreen('dataProtection'); }}>See what changed</button>
        <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={close}>Dismiss</button>
      </span>
    </div>
  );
}

export default function AttendanceToday({ openScreen }) {
  const [date, setDate] = useState(todayIst());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  /* Readers and the week are extras: without access to them, or on a failed read, the panel is simply not shown. */
  const [readers, setReaders] = useState(null);
  const [week, setWeek] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getOverview(date)
      .then((d) => !cancelled && (setData(d), setError('')))
      .catch((e) => !cancelled && setError(String(e?.message || 'Could not load today.')));
    return () => {
      cancelled = true;
    };
  }, [date, attempt]);

  useEffect(() => {
    let cancelled = false;
    getReaderHealth().then((d) => !cancelled && setReaders(d)).catch(() => !cancelled && setReaders(null));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    let cancelled = false;
    getCalendar({ month: date.slice(0, 7) })
      .then((d) => {
        if (cancelled) return;
        const days = (d?.days || []).filter((x) => x.date <= date && !x.future).slice(-7);
        setWeek(days.length ? days : null);
      })
      .catch(() => !cancelled && setWeek(null));
    return () => {
      cancelled = true;
    };
  }, [date, attempt]);

  const go = (key) => openScreen && openScreen(key);
  const waiting = data
    ? [
        { n: data.toValidate, label: data.toValidate === 1 ? 'day to validate' : 'days to validate', key: 'records', icon: ListChecks },
        { n: data.pendingRequests, label: data.pendingRequests === 1 ? 'correction request' : 'correction requests', key: 'requests', icon: Inbox },
        { n: data.pendingLeave, label: data.pendingLeave === 1 ? 'leave request' : 'leave requests', key: 'leaveRequests', icon: CalendarCheck },
      ]
    : [];
  const peak = week ? Math.max(1, ...week.map((d) => d.present + d.halfDay + d.absent + d.leave)) : 1;
  const readerList = readers?.readers || [];
  const readerTrouble = readerList.filter((r) => r.status !== 'ok' && r.status !== 'off' && r.status !== 'delayed').length;

  return (
    <div className="space-y-3">
      <PageHeader
        entity="attendance"
        title="Today"
        description={data?.holiday ? `Holiday: ${data.holiday}` : 'Attendance at a glance.'}
        actions={
          <input type="date" className="ui-input" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} aria-label="Day" />
        }
      />
      <div className="pb-8 space-y-6">
      <DpdpNotice openScreen={openScreen} />
      <LoadFailed message={error} onRetry={() => setAttempt((n) => n + 1)} />
      {!data ? (
        error ? null : <SkeletonCard lines={6} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Headcount" value={data.headcount} icon={Users} />
            <StatTile label="Present" value={data.present + data.halfDay} icon={UserCheck} tone="pos" hint={data.halfDay ? `${data.halfDay} half day` : null} />
            <StatTile label="Late" value={data.late.length} icon={Clock} tone={data.late.length ? 'warn' : 'neutral'} />
            {/* Red only when there is something to see: "0 absent" is good news, not an alarm. */}
            <StatTile label="Absent" value={data.absent} icon={UserX} tone={data.absent ? 'neg' : 'neutral'} />
            <StatTile label="On leave" value={data.onLeave} icon={CalendarOff} />
            <StatTile label="Not marked" value={data.notMarked} />
          </div>

          {waiting.some((w) => w.n) ? (
            <section aria-labelledby="waiting-h" className="space-y-2">
              <h2 id="waiting-h" className="ui-t-sec">Waiting for you</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {waiting.filter((w) => w.n).map((w) => (
                  <button key={w.key} type="button" className="ui-card ui-today-action" onClick={() => go(w.key)} disabled={!openScreen}>
                    <w.icon size={18} aria-hidden="true" />
                    <span className="min-w-0 flex-1 text-left">
                      <strong className="tabular-nums">{w.n}</strong> {w.label}
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="grid items-start gap-4 xl:grid-cols-3">
            <section className={`ui-card p-4 ${readers ? 'xl:col-span-2' : 'xl:col-span-3'}`} aria-labelledby="week-h">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                <h2 id="week-h" className="ui-t-sec">Last {week?.length || 7} days</h2>
                <span className="ui-caption ui-legend">
                  <i data-k="in" aria-hidden="true" />In <i data-k="absent" aria-hidden="true" />Absent <i data-k="leave" aria-hidden="true" />Leave
                </span>
              </div>
              {week ? (
                <ol className="ui-week" aria-label="People in, absent and on leave each day">
                  {week.map((d) => {
                    const inn = d.present + d.halfDay;
                    const label = `${weekday(d.date)} ${Number(d.date.slice(8))}: ${inn} in, ${d.absent} absent, ${d.leave} on leave${d.holiday ? `, ${d.holiday}` : d.off ? ', weekly off' : ''}`;
                    return (
                      <li key={d.date} aria-label={label} title={label}>
                        <span className="ui-week-n tabular-nums" aria-hidden="true">{inn}</span>
                        <span className="ui-week-bar" aria-hidden="true">
                          <span data-k="leave" style={{ height: `${(d.leave / peak) * 100}%` }} />
                          <span data-k="absent" style={{ height: `${(d.absent / peak) * 100}%` }} />
                          <span data-k="in" style={{ height: `${(inn / peak) * 100}%` }} />
                        </span>
                        <span className="ui-week-day" aria-hidden="true">{d.holiday || d.off ? 'Off' : weekday(d.date)}<b>{Number(d.date.slice(8))}</b></span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="ui-muted text-sm">No days recorded yet this month.</p>
              )}
            </section>

            {readers ? (
              <section className="ui-card p-4" aria-labelledby="readers-h">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h2 id="readers-h" className="ui-t-sec">Readers</h2>
                  <span className="ui-caption">{readerList.length ? (readerTrouble ? `${readerTrouble} need${readerTrouble === 1 ? 's' : ''} a look` : 'All healthy') : 'None added'}</span>
                </div>
                {readerList.length ? (
                  <ul className="divide-y">
                    {readerList.slice(0, 5).map((r) => {
                      const st = READER[r.status] || READER.ok;
                      return (
                        <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                          <Cpu size={16} aria-hidden="true" className="ui-subtle shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{r.name}</span>
                            <span className="ui-caption">Last heard {ago(r.lastSeenAt)}</span>
                          </span>
                          <span className={`ui-pill ui-pill-${st.tone}`}>{st.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="ui-muted text-sm">Add a reader under Readers to see it here.</p>
                )}
                {openScreen ? (
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm mt-3" onClick={() => go('readerHealth')}>
                    Open reader health
                  </button>
                ) : null}
              </section>
            ) : null}
          </div>

          <div className="grid items-start gap-4 xl:grid-cols-2">
            <section className="ui-card p-4" aria-labelledby="late-h">
              <h2 id="late-h" className="ui-t-sec mb-3">Late {date === todayIst() ? 'today' : 'that day'}</h2>
              {data.late.length ? (
                <ul className="divide-y">
                  {data.late.map((l) => (
                    <li key={l.employeeId} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="truncate">{l.employeeName}</span>
                      <span className="ui-caption tabular-nums shrink-0">in {l.checkInTime}, {l.lateMinutes} min late</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ui-muted text-sm">Nobody.</p>
              )}
            </section>
            <section className="ui-card p-4" aria-labelledby="notin-h">
              <h2 id="notin-h" className="ui-t-sec mb-3">Not clocked in <span className="ui-caption tabular-nums">{data.notIn.length}</span></h2>
              {data.notIn.length ? (
                <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 2xl:grid-cols-3">
                  {data.notIn.map((p) => (
                    <li key={p.id} className="truncate text-sm">{p.name}<span className="ui-caption">{p.department ? `, ${p.department}` : ''}</span></li>
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
    </div>
  );
}
