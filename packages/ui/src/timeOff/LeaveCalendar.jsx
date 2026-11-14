import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from '@ui/components/ui/lineIcons';

import { SkeletonCard } from '@ui/components/ui/Primitives';
import ListHeader from '@ui/components/list/ListHeader';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { PRIVATE_LABEL, STATUS_LABEL, getWorkingAway, getWorkingWeek, listHolidays, listLeaveRequests, swatchOf, todayIst } from './api';
import { homeCrumbs } from './shared';
import { clashDays, clashWords } from './clashes';
import { LeavePill } from './Figures';

/**
 * Time & Leave → Calendar: who is away in a month, one line a person, with
 * the holidays and the company's weekly offs shaded. Waiting requests show
 * lighter, so a manager sees a clash before approving into it. Private leave
 * reaches a reader without the right to see it as "Private leave": no type
 * colour, one neutral tone. Approved work from home and on duty show on the
 * same line with their own outlined mark and letter (H, D): working, not
 * away on leave, and never counted as leave in the Away row.
 */
const WORKING = { WFH: { letter: 'H', name: 'Work from home' }, ON_DUTY: { letter: 'D', name: 'On duty' } };
const workingMark = { border: '1px dashed rgb(var(--fg-subtle))', color: 'rgb(var(--fg-muted))' };
const pad = (n) => String(n).padStart(2, '0');
const monthOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const shift = (month, by) => {
  const [y, m] = month.split('-').map(Number);
  return monthOf(new Date(y, m - 1 + by, 1));
};
const daysIn = (month) => {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${month}-${pad(i + 1)}`);
};
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const title = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const isPrivate = (r) => r.reasonHidden || r.leaveTypeName === PRIVATE_LABEL;
const toneOf = (r) => (isPrivate(r) ? { className: 'ui-dot-quiet' } : { style: { background: swatchOf({ color: r.leaveTypeColor, name: r.leaveTypeName }) } });
/** The company's working week (Settings → Working week); Sunday alone when it cannot be read. */
const offTest = (week) => {
  const offs = new Set(String(week?.weeklyOffDays ?? '0').split(',').filter(Boolean).map(Number));
  const sats = new Set(String(week?.offSaturdays ?? '').split(',').filter(Boolean).map(Number));
  return (date) => {
    const w = weekday(date);
    return offs.has(w) || (w === 6 && sats.has(Math.ceil(Number(date.slice(8)) / 7)));
  };
};

/** "Ananya Iyer" → "Ananya I.": a month cell has room for a first name and an initial. */
const shortName = (n) => { const [first, ...rest] = String(n || '').trim().split(/\s+/); return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first; };
/** The month as weeks from Monday, with the days of the months either side to fill the first and last week. */
const weeksOf = (month) => {
  const days = daysIn(month);
  const lead = (weekday(days[0]) + 6) % 7;
  const cells = [...Array.from({ length: lead }, (_, i) => shiftDay(days[0], i - lead)), ...days];
  while (cells.length % 7) cells.push(shiftDay(cells[cells.length - 1], 1));
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
};
const shiftDay = (iso, by) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + by); return d.toISOString().slice(0, 10); };
const WEEK_HEAD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHOWN_IN_CELL = 3;

/* Which half of a half day, said in the label too: a hover title is no help on a phone or to a screen reader (#80 QA). */
const halfWords = (h) => (h === 'FIRST' ? ', first half' : h === 'SECOND' ? ', second half' : h ? ', half day' : '');

export default function LeaveCalendar() {
  const today = todayIst();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [dept, setDept] = useState('');
  /* Month (R&D PEOPLE-12): the weeks with names in each day; By person: one line a person across the month. */
  const [view, setView] = useState('month');
  const req = useRequest(
    () => Promise.all([listLeaveRequests({ month }), listHolidays(month.slice(0, 4)).catch(() => []), getWorkingWeek().catch(() => null), getWorkingAway(month).catch(() => [])])
      .then(([r, h, week, working]) => ({ month, requests: r.filter((x) => ['APPROVED', 'PENDING'].includes(x.status)), holidays: h, week, working })),
    [month],
  );
  /*
   * Only the open month's answer is drawn (UI audit, 7 Nov 2026). useRequest already lets the newest request win; this
   * also keeps the last month's people off the new month's grid while it loads, and lets a failed month say so rather
   * than sit behind the month before.
   */
  const data = req.data?.month === month ? req.data : undefined;
  const requests = data?.requests;

  const days = daysIn(month);
  const isOffDay = useMemo(() => offTest(data?.week), [data?.week]);
  const holidayOn = useMemo(() => new Map((data?.holidays || []).filter((h) => h.date.startsWith(month) && !h.isOptional).map((h) => [h.date, h.name])), [data, month]);
  const working = data?.working;
  const departments = useMemo(() => [...new Set([...(requests || []), ...(working || [])].map((r) => r.department).filter(Boolean))].sort(), [requests, working]);
  const people = useMemo(() => {
    const byPerson = new Map();
    for (const r of requests || []) {
      if (dept && r.department !== dept) continue;
      if (!byPerson.has(r.employeeId)) byPerson.set(r.employeeId, { id: r.employeeId, name: r.employeeName, department: r.department, leave: [], working: [] });
      byPerson.get(r.employeeId).leave.push(r);
    }
    for (const w of working || []) {
      if (dept && w.department !== dept) continue;
      if (!byPerson.has(w.employeeId)) byPerson.set(w.employeeId, { id: w.employeeId, name: w.employeeName, department: w.department, leave: [], working: [] });
      byPerson.get(w.employeeId).working.push(w);
    }
    return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [requests, working, dept]);
  const workingKinds = [...new Set((working || []).map((w) => w.kind))].filter((k) => WORKING[k]);
  const awayOn = (date) => people.filter((p) => p.leave.some((r) => r.fromDate <= date && date <= r.toDate && r.status === 'APPROVED')).length;
  const legend = useMemo(() => {
    const m = new Map();
    for (const r of requests || []) {
      const key = isPrivate(r) ? PRIVATE_LABEL : r.leaveTypeId;
      if (!m.has(key)) m.set(key, { key, name: isPrivate(r) ? PRIVATE_LABEL : r.leaveTypeName, row: r });
    }
    return [...m.values()].sort((a, b) => (a.key === PRIVATE_LABEL) - (b.key === PRIVATE_LABEL) || a.name.localeCompare(b.name));
  }, [requests]);
  const shaded = (d) => isOffDay(d) || holidayOn.has(d);
  /* Two or more of one department away on the same working day (M4), approved or waiting: flagged before approving a third. */
  const clashes = clashDays((requests || []).filter((r) => !dept || r.department === dept), days[0], days[days.length - 1]).filter((c) => c.date !== c.to || !shaded(c.date));
  const clashOn = new Set(days.filter((d) => !shaded(d) && clashes.some((c) => c.date <= d && d <= c.to)));

  return (
    <div className="space-y-6">
      <ListHeader
        breadcrumb={homeCrumbs()}
        title="Leave calendar"
        description="Who is away on each day of the month, with holidays and weekly offs shaded."
        toolbar={<>
          <div className="inline-flex items-center gap-1" role="group" aria-label="Month">
            <button type="button" className="ui-icon-btn" aria-label="Previous month" onClick={() => setMonth(shift(month, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
            <span className="min-w-36 text-center font-medium" aria-live="polite">{title(month)}</span>
            <button type="button" className="ui-icon-btn" aria-label="Next month" onClick={() => setMonth(shift(month, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
          </div>
          {month !== today.slice(0, 7) ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setMonth(today.slice(0, 7))}>This month</button> : null}
          <div className="pt-seg" role="group" aria-label="View">
            {[['month', 'Month'], ['person', 'By person']].map(([k, l]) => <button key={k} type="button" className="pt-seg-item" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
          </div>
          {departments.length > 1 ? (
            <div className="w-full sm:w-56">
              <PopupSelect showValueSubtext={false} ariaLabel="Department" value={dept} onChange={(v) => setDept(v || '')} placeholder="Every department"
                options={[{ value: '', label: 'Every department' }, ...departments.map((d) => ({ value: d, label: d }))]} />
            </div>
          ) : null}
        </>}
      />

      {/* The month is always drawn (People plan 8 Nov 2026, §3 rule 4): with nobody away it still shows its weekends and holidays. */}
      {req.error && !requests ? <ErrorState error={req.error} onRetry={req.reload} /> : !requests ? <SkeletonCard lines={6} /> : (
        <section className="space-y-3" aria-label={`Leave in ${title(month)}`}>
          {clashes.length ? (
            <ul className="space-y-1 text-sm" aria-label="Away the same day">
              {clashes.map((c) => (
                <li key={`${c.date}:${c.group || ''}`} className="flex flex-wrap items-center gap-2">
                  <span className="ui-pill ui-pill-warn whitespace-nowrap">{clashWords(c.count)}</span>
                  <span className="tabular-nums font-medium">{c.date === c.to ? formatDate(c.date) : `${formatDate(c.date)} – ${formatDate(c.to)}`}</span>
                  <span>{c.group ? `${c.group}: ` : ''}{c.names.join(', ')}{c.waiting ? <span className="ui-caption"> ({c.waiting} waiting)</span> : null}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {view === 'month' ? (
            <MonthGrid month={month} today={today} people={people} isOffDay={isOffDay} holidayOn={holidayOn} clashOn={clashOn} />
          ) : (
          /* Scrolls sideways on a phone: reachable by keyboard, so the days past the edge can be read (axe scrollable-region-focusable). */
          <div className="ui-table-scroll border-t" style={{ borderColor: 'rgb(var(--border))' }} tabIndex={0} role="group" aria-label={`Days of ${title(month)}`}>
            <table className="w-full border-collapse text-xs" aria-label={`Leave in ${title(month)}`}>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-[rgb(var(--app-bg))] p-2 text-left text-sm font-medium min-w-44">Employee</th>
                  {days.map((d) => (
                    <th key={d} scope="col" title={holidayOn.get(d) || undefined} className={`p-0.5 text-center font-normal min-w-6 tabular-nums ${shaded(d) ? 'bg-[rgb(var(--border)/0.45)] ui-muted' : ''} ${d === today ? 'text-[rgb(var(--brand-ink))] font-medium' : ''}`}>
                      <div>{'SMTWTFS'[weekday(d)]}</div>
                      <div>{Number(d.slice(8))}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!people.length ? (
                  <tr className="border-t" style={{ borderColor: 'rgb(var(--border))' }}>
                    <td className="p-3 text-sm ui-muted" colSpan={days.length + 1} role="status">Nobody is away or working elsewhere in {title(month)}{dept ? ` in ${dept}` : ''}. Leave approved for these days shows here, one line a person.</td>
                  </tr>
                ) : null}
                {people.map((p) => (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'rgb(var(--border))' }}>
                    <th scope="row" className="sticky left-0 z-10 bg-[rgb(var(--app-bg))] p-2 text-left text-sm font-normal">
                      {p.name}{p.department ? <span className="ui-caption block">{p.department}</span> : null}
                    </th>
                    {days.map((d) => {
                      const r = p.leave.find((x) => x.fromDate <= d && d <= x.toDate);
                      const tone = r ? toneOf(r) : null;
                      const w = r ? null : p.working.find((x) => x.fromDate <= d && d <= x.toDate && !shaded(d));
                      return (
                        <td key={d} className={`p-0.5 text-center ${shaded(d) ? 'bg-[rgb(var(--border)/0.45)]' : ''}`}>
                          {r ? (
                            <span
                              className={`block h-5 ${r.halfDay ? `w-1/2 ${r.halfDay === 'SECOND' ? 'ml-auto' : ''}` : ''} ${tone.className || ''}`}
                              role="img"
                              data-half={r.halfDay || undefined}
                              style={{ ...(tone.style || {}), opacity: r.status === 'PENDING' ? 0.4 : 1 }}
                              title={`${isPrivate(r) ? PRIVATE_LABEL : r.leaveTypeName}, ${STATUS_LABEL[r.status].toLowerCase()}${halfWords(r.halfDay)}`}
                              aria-label={`${d}: ${isPrivate(r) ? PRIVATE_LABEL : r.leaveTypeName}, ${STATUS_LABEL[r.status].toLowerCase()}${halfWords(r.halfDay)}`}
                            />
                          ) : w ? (
                            <span
                              className="flex h-5 items-center justify-center text-[0.75rem] font-medium"
                              role="img"
                              style={workingMark}
                              title={`${WORKING[w.kind]?.name || w.kind}${w.place ? `, ${w.place}` : ''}${halfWords(w.halfDay)}`}
                              aria-label={`${d}: ${WORKING[w.kind]?.name || w.kind}${halfWords(w.halfDay)}`}
                            >{WORKING[w.kind]?.letter || ''}</span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t" style={{ borderColor: 'rgb(var(--border))' }}>
                  <th scope="row" className="sticky left-0 z-10 bg-[rgb(var(--app-bg))] p-2 text-left text-sm font-medium">Away</th>
                  {days.map((d) => (clashOn.has(d)
                    ? <td key={d} className="p-0.5 text-center" title="Two or more of one department away"><span className="ui-pill ui-pill-warn tabular-nums px-1">{awayOn(d) || '!'}</span></td>
                    : <td key={d} className="p-1 text-center ui-muted tabular-nums">{awayOn(d) || ''}</td>))}
                </tr>
              </tbody>
            </table>
          </div>
          )}
          <ul className="pt-legend" aria-label="Key">
            {legend.map((t) => (isPrivate(t.row)
              ? <li key={t.key} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full ui-dot-quiet" aria-hidden="true" />{t.name}</li>
              : <li key={t.key}><LeavePill type={t.row} /></li>))}
            <li className="inline-flex items-center gap-1.5"><span className="pt-cal-leave is-waiting" aria-hidden="true">&nbsp;&nbsp;&nbsp;</span>Waiting</li>
            <li className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border" style={{ background: 'rgb(var(--surface-sunken))', borderColor: 'rgb(var(--border))' }} aria-hidden="true" />Weekly off</li>
            {holidayOn.size ? <li className="pt-cal-holiday">Holidays in amber</li> : null}
            {people.some((p) => p.leave.some((x) => x.halfDay)) ? <li className="inline-flex items-center gap-1.5"><span className="inline-flex h-2.5 w-5 border" style={{ borderColor: 'rgb(var(--border))' }} aria-hidden="true"><span className="h-full w-1/2 ui-dot-quiet" /></span>Half day: left half first, right half second</li> : null}
            {workingKinds.map((k) => <li key={k} className="inline-flex items-center gap-1.5"><span className="inline-flex h-4 w-4 items-center justify-center text-[0.75rem]" style={workingMark} aria-hidden="true">{WORKING[k].letter}</span>{WORKING[k].name}, working</li>)}
            {[...holidayOn.entries()].map(([d, n]) => <li key={d} className="ui-muted tabular-nums">{Number(d.slice(8))}: {n}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The month as a calendar: weeks from Monday, the people away each day under the date, holidays in amber. */
function MonthGrid({ month, today, people, isOffDay, holidayOn, clashOn }) {
  const weeks = weeksOf(month);
  const awayOnDay = (d) => people.flatMap((p) => [
    ...p.leave.filter((r) => r.fromDate <= d && d <= r.toDate).map((r) => ({ key: r.id, p, r })),
    ...p.working.filter((w) => w.fromDate <= d && d <= w.toDate).map((w) => ({ key: `w:${w.id}`, p, w })),
  ]);
  const empty = !people.length;
  return (
    <div className="pt-month" role="table" aria-label={`Leave in ${title(month)}`}>
      <div className="pt-month-row pt-month-head" role="row">{WEEK_HEAD.map((d) => <span key={d} role="columnheader">{d}</span>)}</div>
      {weeks.map((week) => (
        <div key={week[0]} className="pt-month-row" role="row">
          {week.map((d) => {
            const inMonth = d.startsWith(month);
            const away = inMonth ? awayOnDay(d) : [];
            const holiday = inMonth ? holidayOn.get(d) : null;
            return (
              <div key={d} role="cell" className={`pt-day ${inMonth ? '' : 'is-out'} ${inMonth && isOffDay(d) ? 'is-off' : ''}`} aria-label={inMonth ? `${formatDate(d)}${holiday ? `, ${holiday}` : ''}${away.length ? `, ${away.length} away` : ''}` : undefined}>
                <span className="pt-day-n">{d === today ? <span className="pt-today-mark" aria-current="date">{Number(d.slice(8))}</span> : Number(d.slice(8))}{clashOn.has(d) ? <span className="ui-pill ui-pill-warn ml-auto" title="Two or more of one department away">{away.length} away</span> : null}</span>
                {holiday ? <span className="pt-cal-holiday">{holiday}</span> : null}
                {away.slice(0, SHOWN_IN_CELL).map(({ key, p, r, w }) => (r ? (
                  <span key={key} className={`pt-cal-leave ${r.status === 'PENDING' ? 'is-waiting' : ''}`} title={`${p.name}: ${isPrivate(r) ? PRIVATE_LABEL : r.leaveTypeName}, ${STATUS_LABEL[r.status].toLowerCase()}${halfWords(r.halfDay)}`}>
                    <span className={`inline-block h-2 w-2 shrink-0 rounded-sm ${toneOf(r).className || ''}`} style={toneOf(r).style} aria-hidden="true" />
                    <span className="truncate" aria-hidden="true">{shortName(p.name)}</span>
                    <span className="sr-only">{p.name}</span>
                  </span>
                ) : (
                  <span key={key} className="pt-cal-leave" style={workingMark} title={`${p.name}: ${WORKING[w.kind]?.name || w.kind}`}>
                    <span className="shrink-0 font-medium" aria-hidden="true">{WORKING[w.kind]?.letter || ''}</span>
                    <span className="truncate" aria-hidden="true">{shortName(p.name)}</span>
                    <span className="sr-only">{p.name}, {WORKING[w.kind]?.name || w.kind}</span>
                  </span>
                )))}
                {away.length > SHOWN_IN_CELL ? <span className="ui-caption">+{away.length - SHOWN_IN_CELL} more</span> : null}
              </div>
            );
          })}
        </div>
      ))}
      {empty ? <p className="pt-month-empty" role="status">Nobody is away or working elsewhere in {title(month)}. Approved leave shows on its days here.</p> : null}
    </div>
  );
}
