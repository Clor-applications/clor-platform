import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from '@ui/components/ui/lineIcons';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { getCalendar, listReports, runReport, todayIst } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { errorWords } from '@ui/utils/errorWords';
import { SelectField } from '@ui/components/ui/SelectField';

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
const longDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/* What a day cell says to a screen reader: the date and what is shown on it. */
const dayLabelFor = (d, today) => {
  const parts = [longDay(d.date)];
  if (d.date === today) parts.push('today');
  if (d.holiday) parts.push(`holiday, ${d.holiday}`);
  else if (d.off) parts.push('weekly off');
  if (!(d.off || d.future)) parts.push(`${d.present + d.halfDay} in, ${d.absent} absent, ${d.leave} on leave`);
  else if (d.future && d.leave) parts.push(`${d.leave} on leave`);
  return parts.join(', ');
};

export default function AttendanceCalendar() {
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(null);
  const [day, setDay] = useState(null);
  const [dayError, setDayError] = useState('');
  /* The day the arrow keys are on: the one cell in the Tab order (a roving tab stop). */
  const [focusDate, setFocusDate] = useState(null);
  const grid = useRef(null);
  const asked = useRef(0);

  useEffect(() => {
    listReports().then((d) => setDepartments(d?.departments || [])).catch(() => {});
  }, []);
  /* No synchronous resets in the effect: the old month stays until the new one arrives, then the picked day clears. */
  /* A day that did not load says so, with a retry: "Nobody employed that day" is only for a day that loaded empty. */
  const open = useCallback((d) => {
    const n = ++asked.current;
    setPicked(d.date);
    setFocusDate(d.date);
    setDay(null);
    setDayError('');
    runReport('daily', { date: d.date, ...(departmentId ? { departmentId } : {}) })
      .then((r) => { if (n === asked.current) setDay(r); })
      .catch((e) => { if (n === asked.current) setDayError(errorWords(e, 'load that day')); });
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
    }).catch((e) => setError(errorWords(e, 'load the calendar'))),
    [month, departmentId, open]
  );
  useEffect(() => { load(); }, [load]);
  const loading = !data || data.month !== month;

  /* Arrow keys move a day (left, right) or a week (up, down); Home and End go to the month's first and last day. */
  const onGridKey = (e) => {
    const days = data?.days || [];
    if (!days.length) return;
    const at = Math.max(0, days.findIndex((x) => x.date === focusDate));
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    let to = null;
    if (step !== undefined) to = Math.min(days.length - 1, Math.max(0, at + step));
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = days.length - 1;
    if (to === null) return;
    e.preventDefault();
    const date = days[to].date;
    setFocusDate(date);
    grid.current?.querySelector(`[data-date="${date}"]`)?.focus();
  };

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
            <SelectField className="ui-select ui-ctl-compact !w-auto" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Department">
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectField>
          </>
        }
      />
      <div className="pb-8 space-y-6">
      {/* A failed month shows under the page header, with a retry, not in place of the page. */}
      <LoadFailed message={error} onRetry={load} />
      {loading ? (error ? null : <SkeletonCard lines={8} />) : (
        <div className="grid items-start gap-3 xl:grid-cols-[1fr_22rem]">
          <div className="ui-card p-2 sm:p-3">
            <div className="ui-calendar" ref={grid} role="group" aria-label={`${title}: days`} onKeyDown={onGridKey}>
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
                    data-date={d.date}
                    tabIndex={d.date === (focusDate && data.days.some((x) => x.date === focusDate) ? focusDate : data.days[0]?.date) ? 0 : -1}
                    aria-label={dayLabelFor(d, data.today)}
                    aria-pressed={on}
                    data-off={d.off || undefined}
                    data-today={d.date === data.today || undefined}
                    onClick={() => open(d)}
                  >
                    <span className="ui-calendar-date">{Number(d.date.slice(8))}</span>
                    {d.holiday ? <span className="ui-calendar-tag" data-short="Hol" title={d.holiday}>{d.holiday}</span> : d.off ? <span className="ui-calendar-tag" data-short="Off">Weekly off</span> : null}
                    {!quiet ? (
                      <span className="ui-calendar-counts">
                        <span className="ui-count-in">{d.present + d.halfDay}<span className="ui-count-k"> in</span></span>
                        <span className="ui-count-absent">{d.absent}<span className="ui-count-k"> absent</span></span>
                        <span className="ui-muted">{d.leave}<span className="ui-count-k"> leave</span></span>
                      </span>
                    ) : d.future && d.leave ? <span className="ui-calendar-counts"><span className="ui-muted">{d.leave} on leave</span></span> : null}
                  </button>
                );
              })}
            </div>
            <p className="ui-caption px-1 pt-3">Each day shows who was in, absent and on leave. Days to come show approved leave only.</p>
          </div>
          <aside className="ui-card p-4 space-y-3" aria-live="polite">
            {!picked ? <p className="ui-caption">Tap a day to see who was in.</p> : (
              <>
                <h2 className="ui-t-sec">{longDay(picked)}</h2>
                {dayError ? <LoadFailed message={dayError} onRetry={() => open({ date: picked })} /> : !day ? <SkeletonCard lines={4} /> : !day.rows?.length ? <p className="ui-caption">Nobody employed that day.</p> : (
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
