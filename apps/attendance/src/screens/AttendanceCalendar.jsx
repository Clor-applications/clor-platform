import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { getCalendar, listReports, runReport, todayIst } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';

/**
 * The month as a calendar: each day carries how many were in, out, on leave,
 * and whether it was a holiday or an off. Tapping a day opens that day's
 * people — the daily report — beside it. ClorTime's Attendance Calendar.
 */
const shiftMonth = (ym, by) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function AttendanceCalendar() {
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(null);
  const [day, setDay] = useState(null);

  useEffect(() => {
    listReports().then((d) => setDepartments(d?.departments || [])).catch(() => {});
  }, []);
  /* No synchronous resets in the effect: the old month stays until the new one arrives, then the picked day clears. */
  const open = useCallback((d) => {
    setPicked(d.date);
    setDay(null);
    runReport('daily', { date: d.date, ...(departmentId ? { departmentId } : {}) }).then(setDay).catch(() => setDay({ rows: [] }));
  }, [departmentId]);
  /* The side panel opens on today (or the month's last day so far), not on an
     empty "tap a day" — the first question here is always "who is in today". */
  const load = useCallback(
    () => getCalendar({ month, ...(departmentId ? { departmentId } : {}) }).then((d) => {
      setData(d);
      setError(null);
      const shown = (d?.days || []).filter((x) => x.date <= (d.today || todayIst()));
      const first = shown.find((x) => x.date === d.today) || shown[shown.length - 1];
      if (first) open(first); else { setPicked(null); setDay(null); }
    }).catch(setError),
    [month, departmentId, open]
  );
  useEffect(() => { load(); }, [load]);
  const loading = !data || data.month !== month;

  if (error && !data) return <LoadFailed error={error} onRetry={load} />;
  const title = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  /* Monday-first grid: blanks before the 1st. */
  const lead = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;

  return (
    <div className="space-y-3">
      <PageHeader
        entity="attendance"
        title="Attendance calendar"
        description="The month at a glance; tap a day for who was in."
        actions={
          <>
            <span className="flex items-center gap-1">
              <button type="button" className="ui-icon-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
              <span className="ui-t-sec min-w-[9rem] text-center">{title}</span>
              <button type="button" className="ui-icon-btn" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
            </span>
            <select className="ui-select ui-ctl-compact !w-auto" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Department">
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </>
        }
      />
      <div className="pb-8 space-y-6">
      {loading ? <SkeletonCard lines={8} /> : (
        <div className="grid items-start gap-3 xl:grid-cols-[1fr_22rem]">
          <div className="ui-card p-2 sm:p-3">
            <div className="ui-calendar">
              {WEEK.map((w) => <div key={w} className="ui-calendar-head">{w}</div>)}
              {Array.from({ length: lead }).map((_, i) => <div key={`lead-${i}`} />)}
              {data.days.map((d) => {
                const on = picked === d.date;
                const quiet = d.off || d.future;
                return (
                  <button
                    key={d.date}
                    type="button"
                    className="ui-calendar-day"
                    aria-pressed={on}
                    data-off={d.off || undefined}
                    data-today={d.date === data.today || undefined}
                    onClick={() => open(d)}
                  >
                    <span className="ui-calendar-date">{Number(d.date.slice(8))}</span>
                    {d.holiday ? <span className="ui-calendar-tag">{d.holiday}</span> : d.off ? <span className="ui-calendar-tag">Weekly off</span> : null}
                    {!quiet ? (
                      <span className="ui-calendar-counts">
                        <span style={{ color: 'rgb(var(--pos))' }}>{d.present + d.halfDay}</span>
                        <span style={{ color: 'rgb(var(--neg))' }}>{d.absent}</span>
                        <span className="ui-muted">{d.leave}</span>
                      </span>
                    ) : d.future && d.leave ? <span className="ui-calendar-counts"><span className="ui-muted">{d.leave} on leave</span></span> : null}
                  </button>
                );
              })}
            </div>
            <p className="ui-caption px-1 pt-3"><span style={{ color: 'rgb(var(--pos))' }}>in</span> · <span style={{ color: 'rgb(var(--neg))' }}>absent</span> · <span className="ui-muted">leave</span>. Days to come show approved leave only.</p>
          </div>
          <aside className="ui-card p-4 space-y-3" aria-live="polite">
            {!picked ? <p className="ui-caption">Tap a day to see who was in.</p> : (
              <>
                <h2 className="ui-t-sec">{new Date(`${picked}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</h2>
                {!day ? <SkeletonCard lines={4} /> : !day.rows?.length ? <p className="ui-caption">Nobody employed that day.</p> : (
                  <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
                    {day.rows.map((r) => (
                      <li key={`${r.code}-${r.name}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                        <span className="min-w-0 truncate">{r.name}<span className="ui-caption"> · {r.code}</span></span>
                        <span className="shrink-0 ui-caption tabular-nums">{r.in || '—'}{r.out ? `–${r.out}` : ''} · {r.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </aside>
        </div>
      )}
      </div>
    </div>
  );
}
