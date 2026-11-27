import '@ui/components/ui/DashboardBoard.css';
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight } from '@ui/components/ui/lineIcons';
import { CalendarDays, Fingerprint, Inbox, ListChecks } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { PartsBar } from '@ui/components/ui/FigureViews';
import '../attendance.css';

import { getCalendar, getOverview, getReaderHealth, todayIst } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';
import GetStarted from '../components/GetStarted';
import MoveToPeople from '../components/MoveToPeople';
import { TodayScreen } from '../components/round24';
import { errorWords } from '@ui/utils/errorWords';

/* The reader states the server already decides (Reader health uses the same words). */
const READER = {
  ok: { label: 'Healthy', tone: 'pos' },
  delayed: { label: 'Slow to report', tone: 'warn' },
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
const longDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** One of today's figures (R&D KPI tile): the tile's colour on its top edge and chip; a state figure takes its ink when `on`. */
/** One plain sentence for the day: who is in, who is late, who is away. */
function daySentence(data, isToday) {
  const inn = data.present + data.halfDay;
  if (data.holiday) return `${data.holiday}, a holiday.`;
  if (!data.headcount) return 'Add people under People → Employees to start tracking attendance.';
  if (!inn && isToday) return `Nobody has punched in yet. ${data.headcount} ${data.headcount === 1 ? 'person is' : 'people are'} expected.`;
  const parts = [`${inn} of ${data.headcount} ${isToday ? 'in so far' : 'were in'}`];
  if (data.late.length) parts.push(`${data.late.length} late`);
  if (data.onLeave) parts.push(`${data.onLeave} on leave`);
  if (data.absent) parts.push(`${data.absent} absent`);
  return `${parts.join(', ')}.`;
}

/** The day's parts for the ring: on time, late, on leave, absent, and the rest not in yet (or not marked, on a past day). */
export function dayParts(data, isToday) {
  const inn = data.present + data.halfDay;
  const late = Math.min(inn, data.late.length);
  const rest = Math.max(0, data.headcount - inn - data.onLeave - data.absent);
  return {
    total: Math.max(data.headcount, inn + data.onLeave + data.absent),
    middle: `${Math.min(100, Math.round((inn / Math.max(1, data.headcount)) * 100))}%`,
    middleWords: `${inn} of ${data.headcount} in`,
    parts: [
      { key: 'onTime', label: 'In on time', value: inn - late, tone: 'pos' },
      { key: 'late', label: 'In late', value: late, tone: 'warn' },
      { key: 'leave', label: 'On leave', value: data.onLeave, tone: 'info' },
      { key: 'absent', label: 'Absent', value: data.absent, tone: 'neg' },
      { key: 'rest', label: isToday ? 'Not in yet' : 'Not marked', value: rest, tone: 'none' },
    ],
  };
}

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
  const [dayResult, setDayResult] = useState(null);
  const [onScreen, setOnScreen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [readers, setReaders] = useState(null);
  const [weekResult, setWeekResult] = useState(null);
  const [weekAttempt, setWeekAttempt] = useState(0);
  const day = dayResult?.date === date ? dayResult : null;
  const data = day?.data;
  const error = day?.error;
  const recentDays = weekResult?.date === date ? weekResult : null;
  const week = recentDays?.days;
  const isToday = date === todayIst();

  useEffect(() => {
    let cancelled = false;
    getOverview(date)
      .then((data) => !cancelled && setDayResult({ date, data }))
      .catch((e) => !cancelled && setDayResult({ date, error: errorWords(e, 'load attendance for this day') }));
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
        setWeekResult({ date, days });
      })
      .catch((e) => !cancelled && setWeekResult({ date, error: errorWords(e, 'load recent days') }));
    return () => {
      cancelled = true;
    };
  }, [date, weekAttempt]);

  /* The gate screen asks again every minute while it is open. */
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  const go = (key) => openScreen && openScreen(key);
  const waiting = data
    ? [
        { n: data.toValidate, label: data.toValidate === 1 ? 'day to validate' : 'days to validate', key: 'records', icon: ListChecks, tone: 'mint' },
        { n: data.pendingRequests, label: data.pendingRequests === 1 ? 'correction' : 'corrections', key: 'requests', icon: Inbox, tone: 'info' },
        { n: data.pendingLeave, label: data.pendingLeave === 1 ? 'leave request' : 'leave requests', key: 'leaveRequests', icon: CalendarDays, tone: 'lilac' },
      ]
    : [];
  const weekRate = week
    ? (() => {
        const work = week.filter((d) => !d.off && !d.holiday);
        const exp = work.reduce((t, d) => t + d.present + d.halfDay + d.absent + d.leave, 0);
        return exp ? Math.round((work.reduce((t, d) => t + d.present + d.halfDay, 0) / exp) * 100) : null;
      })()
    : null;
  const readerList = readers?.readers || [];
  const activeReaders = readerList.filter((r) => r.status !== 'off');
  const readerTrouble = activeReaders.filter((r) => r.status !== 'ok').length;

  return (
    <div className="space-y-3">
      <PageHeader
        entity="attendance"
        title="Today"
        description={data?.holiday ? `Holiday: ${data.holiday}` : undefined} introduction={data?.holiday ? undefined : 'Attendance at a glance.'}
        /* The day's figures as one count line, not six tiles (DESIGN.md "Page header"; design audit step 2).
           Zero clauses drop out; late, absent and not marked are the ones that need someone. */
        counts={data ? [
          { key: 'headcount', label: data.headcount === 1 ? 'person' : 'people', value: data.headcount },
          { key: 'present', label: data.halfDay ? `present (${data.halfDay} half day)` : 'present', value: data.present + data.halfDay },
          { key: 'late', label: 'late', value: data.late.length, tone: 'warn' },
          { key: 'absent', label: 'absent', value: data.absent, tone: 'neg' },
          { key: 'leave', label: 'on leave', value: data.onLeave },
          { key: 'unmarked', label: 'not marked', value: data.notMarked, tone: 'warn' },
        ] : null}
        actions={
          <>
            {data ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setOnScreen(true)}>Show on a screen</button> : null}
            <input type="date" className="ui-input" value={date} max={todayIst()} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setOnScreen(false); } }} aria-label="Day" />
          </>
        }
      />
      <div className="pb-8 space-y-6">
      <LoadFailed message={error} onRetry={() => setAttempt((n) => n + 1)} />
      {!data ? (
        error ? null : <SkeletonCard lines={6} />
      ) : (
        <>
          <div className="dashboard-board">
            <section className="dashboard-panel" data-featured aria-labelledby="hello-h">
              <h2 id="hello-h" className="dashboard-panel-title">{longDate(date)}</h2>
              <p className="dashboard-panel-meta">{daySentence(data, date === todayIst())}</p>
              {data.headcount ? <PartsBar label="Attendance breakdown" {...dayParts(data, isToday)} /> : null}
            </section>
            <section className="dashboard-panel" aria-labelledby="attendance-work">
              <h2 className="dashboard-panel-title" id="attendance-work">Waiting for you</h2>
              {waiting.some((w) => w.n) ? (
                <ul className="ui-today-hero-queue">
                  {waiting.filter((w) => w.n).map((w) => (
                    <li key={w.key}>
                      <button type="button" className="ui-today-hero-action" onClick={() => go(w.key)} disabled={!openScreen}>
                        <span className="ui-accent-ico" data-tone={w.tone} aria-hidden="true"><w.icon size={16} /></span>
                        <span className="min-w-0 flex-1 text-left">
                          <strong className="tabular-nums">{w.n}</strong> {w.label}
                        </span>
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ui-today-hero-clear">Nothing to validate or approve.</p>
              )}
            </section>
          </div>

          <DpdpNotice openScreen={openScreen} />

          {/* A company still setting up: six steps read from its records (components/GetStarted.jsx). */}
          <GetStarted openScreen={openScreen} />


          <div className="grid items-stretch gap-4 xl:grid-cols-3">
            <section className={`att-chart ${readers ? 'xl:col-span-2' : 'xl:col-span-3'}`} aria-labelledby="week-h">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                <span className="flex items-baseline gap-3">
                  <h2 id="week-h" className="ui-t-sec">Last {week?.length || 7} days</h2>
                  {weekRate != null ? <span className="ui-caption tabular-nums">{weekRate}% turned up on working days</span> : null}
                </span>
                <span className="ui-caption ui-legend">
                  <i data-k="in" aria-hidden="true" />In <i data-k="leave" aria-hidden="true" />On leave <i data-k="absent" aria-hidden="true" />Absent
                </span>
              </div>
              {!recentDays ? (
                <p className="ui-muted text-sm" role="status">Loading recent days…</p>
              ) : recentDays.error ? (
                <LoadFailed message={recentDays.error} onRetry={() => {
                  setWeekResult(null);
                  setWeekAttempt((n) => n + 1);
                }} />
              ) : week.length ? (
                <div className="ui-week-plot">
                  <span className="ui-week-axis" aria-hidden="true"><i>100%</i><i>50%</i><i>0</i></span>
                  <ol className="ui-week" aria-label="Share of people in each day">
                    {week.map((d) => {
                      const inn = d.present + d.halfDay;
                      const total = inn + d.absent + d.leave;
                      const off = Boolean(d.holiday || d.off);
                      const pct = (n) => (total ? (n / total) * 100 : 0);
                      const label = `${weekday(d.date)} ${Number(d.date.slice(8))}: ${inn} in, ${d.absent} absent, ${d.leave} on leave${d.holiday ? `, ${d.holiday}` : d.off ? ', weekly off' : ''}`;
                      return (
                        <li key={d.date} aria-label={label} title={label} data-today={d.date === todayIst() ? '' : undefined} data-off={off ? '' : undefined}>
                          <span className="ui-week-n tabular-nums" aria-hidden="true">
                            {off || !total ? '' : <>{inn}<small>/{total}</small></>}
                          </span>
                          <span className="ui-week-bar" aria-hidden="true">
                            <span data-k="in" style={{ height: `${pct(inn)}%` }} />
                            <span data-k="leave" style={{ height: `${pct(d.leave)}%` }} />
                          </span>
                          <span className="ui-week-day" aria-hidden="true">{off ? 'Off' : weekday(d.date)}<b>{Number(d.date.slice(8))}</b></span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : (
                <p className="ui-muted text-sm">No days recorded yet this month.</p>
              )}
            </section>

            {readers ? (
              <section aria-labelledby="readers-h">
                <div className="att-block-head flex items-baseline justify-between gap-3">
                  <h2 id="readers-h" className="ui-t-sec">Readers</h2>
                  {readerTrouble ? <span className="ui-pill ui-pill-warn">{readerTrouble} need{readerTrouble === 1 ? 's' : ''} review</span> : (
                    <span className="ui-caption">{activeReaders.length ? 'Active readers healthy' : readerList.length ? 'All switched off' : 'None added'}</span>
                  )}
                </div>
                {readerList.length ? (
                  <ul className="divide-y">
                    {readerList.slice(0, 5).map((r) => {
                      const st = READER[r.status] || { label: 'Status unknown', tone: 'neutral' };
                      return (
                        <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                          <Fingerprint size={16} aria-hidden="true" className="ui-subtle shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{r.name}</span>
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

          <div className="grid items-stretch gap-4 xl:grid-cols-3">
            <section aria-labelledby="late-h">
              <h2 id="late-h" className="ui-t-sec att-block-head">Late {date === todayIst() ? 'today' : 'that day'}</h2>
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
            <section className="xl:col-span-2" aria-labelledby="notin-h">
              <h2 id="notin-h" className="ui-t-sec att-block-head">{isToday ? 'Not in yet' : 'No punch recorded'} <span className="ui-caption tabular-nums">{data.notIn.length}{isToday ? ` · ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : ''}</span></h2>
              {data.notIn.length ? (
                <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
                  {data.notIn.map((p) => (
                    <li key={p.id} className="truncate text-sm">{p.name}<span className="ui-caption">{p.department ? `, ${p.department}` : ''}</span></li>
                  ))}
                </ul>
              ) : (
                <p className="ui-muted text-sm">{isToday ? 'Everyone is in.' : 'No missing punches in this list.'}</p>
              )}
            </section>
          </div>
        </>
      )}
      <MoveToPeople />
      </div>
      {onScreen && data ? <TodayScreen data={data} dateLabel={longDate(date)} onClose={() => setOnScreen(false)} onRefresh={refresh} /> : null}
    </div>
  );
}
