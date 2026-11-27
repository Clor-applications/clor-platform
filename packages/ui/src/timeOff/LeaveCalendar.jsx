import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import SearchField from '@ui/components/ui/SearchField';
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
const SHOWN_IN_CELL = 3;

/* Which half of a half day, said in the label too: a hover title is no help on a phone or to a screen reader (#80 QA). */
const halfWords = (h) => (h === 'FIRST' ? ', first half' : h === 'SECOND' ? ', second half' : h ? ', half day' : '');

export default function LeaveCalendar({ peopleTimePage } = {}) {
  const today = todayIst();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  /*
   * By person first (owner, 19 Nov 2026, DESIGN.md "Pick conflicts resolved": rounds 5 and 17 over round 8): one row a
   * person across the days, leave as blocks. Month (R&D PEOPLE-12) keeps the weeks with names in each day, one tap away.
   */
  const [view, setView] = useState('person');
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
    return [...byPerson.values()].filter((person) => [person.name, person.department].some((text) =>
      text?.toLowerCase().includes(query.toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name));
  }, [requests, working, dept, query]);
  const workingKinds = [...new Set((working || []).map((w) => w.kind))].filter((k) => WORKING[k]);
  const awayOn = (date) => people.filter((p) => p.leave.some((r) => r.fromDate <= date && date <= r.toDate && r.status === 'APPROVED')).length;
  const legend = useMemo(() => {
    const m = new Map();
    for (const r of requests || []) {
      const key = isPrivate(r) ? PRIVATE_LABEL : r.leaveTypeId || r.leaveTypeName || 'leave';
      if (!m.has(key)) m.set(key, { key, name: isPrivate(r) ? PRIVATE_LABEL : r.leaveTypeName || 'Leave', row: r });
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
        description={peopleTimePage ? undefined : "Who is away on each day of the month, with holidays and weekly offs shaded."}
        secondary={peopleTimePage && <SearchField value={query} onSearch={setQuery} placeholder="Search calendar" label="Search calendar" className="w-full sm:w-64" />}
        toolbar={<>
          <div className="inline-flex items-center gap-1" role="group" aria-label="Month">
            <button type="button" className="ui-icon-btn" aria-label="Previous month" onClick={() => setMonth(shift(month, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
            <span className="min-w-36 text-center font-semibold" aria-live="polite">{title(month)}</span>
            <button type="button" className="ui-icon-btn" aria-label="Next month" onClick={() => setMonth(shift(month, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
          </div>
          {month !== today.slice(0, 7) ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setMonth(today.slice(0, 7))}>This month</button> : null}
          <div className="pt-seg" role="group" aria-label="View">
            {[['person', 'By person'], ['month', 'Month']].map(([k, l]) => <button key={k} type="button" className="pt-seg-item" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
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
          {!query && clashes.length ? (
            <ul className="space-y-1 text-sm" aria-label="Away the same day">
              {clashes.map((c) => (
                <li key={`${c.date}:${c.group || ''}`} className="flex flex-wrap items-center gap-2">
                  <span className="ui-pill ui-pill-warn whitespace-nowrap">{clashWords(c.count)}</span>
                  <span className="tabular-nums">{c.date === c.to ? formatDate(c.date) : `${formatDate(c.date)} – ${formatDate(c.to)}`}</span>
                  <span>{c.group ? `${c.group}: ` : ''}{c.names.join(', ')}{c.waiting ? <span className="ui-caption"> ({c.waiting} waiting)</span> : null}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {query && !people.length ? <p className="ui-muted py-3" role="status">No matching employees.</p> : view === 'month' ? (
            <MonthGrid month={month} today={today} people={people} isOffDay={isOffDay} holidayOn={holidayOn} clashOn={clashOn} />
          ) : (
            <PersonRows month={month} today={today} days={days} people={people} shaded={shaded} holidayOn={holidayOn} clashOn={clashOn} awayOn={awayOn} dept={dept} />
          )}
          <ul className="pt-legend" aria-label="Key">
            {legend.map((t) => (isPrivate(t.row)
              ? <li key={t.key} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full ui-dot-quiet" aria-hidden="true" />{t.name}</li>
              : <li key={t.key}><LeavePill type={t.row} /></li>))}
            {view === 'person'
              ? <li className="inline-flex items-center gap-1.5"><span className="pt-rows-swatch ui-dot-quiet" style={{ opacity: 0.4 }} aria-hidden="true" />Waiting, lighter</li>
              : <li className="inline-flex items-center gap-1.5"><span className="pt-cal-leave is-waiting" aria-hidden="true">&nbsp;&nbsp;&nbsp;</span>Waiting</li>}
            <li className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border" style={{ background: 'rgb(var(--fg) / 0.045)', borderColor: 'rgb(var(--border))' }} aria-hidden="true" />Weekly off</li>
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
  const awayOnDay = (d) => people.flatMap((p) => [
    ...p.leave.filter((r) => r.fromDate <= d && d <= r.toDate).map((r) => ({ key: r.id, p, r })),
    ...p.working.filter((w) => w.fromDate <= d && d <= w.toDate).map((w) => ({ key: `w:${w.id}`, p, w })),
  ]);
  const empty = !people.length;
  return (
    <div className="pt-full-calendar">
      <FullCalendar key={month} plugins={[dayGridPlugin]} initialView="dayGridMonth" initialDate={month + '-01'}
        timeZone="UTC" now={today} headerToolbar={false} firstDay={1} fixedWeekCount={false} height="auto"
        dayCellContent={({ date }) => {
            const d = date.toISOString().slice(0, 10);
            const inMonth = d.startsWith(month);
            const away = inMonth ? awayOnDay(d) : [];
            const holiday = inMonth ? holidayOn.get(d) : null;
            return (
              <div key={d} className={`pt-day ${inMonth ? '' : 'is-out'} ${inMonth && isOffDay(d) ? 'is-off' : ''}`} aria-label={inMonth ? `${formatDate(d)}${holiday ? `, ${holiday}` : ''}${away.length ? `, ${away.length} away` : ''}` : undefined}>
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
                    <span className="shrink-0" aria-hidden="true">{WORKING[w.kind]?.letter || ''}</span>
                    <span className="truncate" aria-hidden="true">{shortName(p.name)}</span>
                    <span className="sr-only">{p.name}, {WORKING[w.kind]?.name || w.kind}</span>
                  </span>
                )))}
                {away.length > SHOWN_IN_CELL ? <span className="ui-caption">+{away.length - SHOWN_IN_CELL} more</span> : null}
              </div>
            );
          }} />
      {empty ? <p className="pt-month-empty" role="status">Nobody is away or working elsewhere in {title(month)}. Approved leave shows on its days here.</p> : null}
    </div>
  );
}

/* The person's identity colour, the same hash as the Employees avatar (personnel/Employees identityCat), kept here so the calendar does not load that screen. */
const identityCat = (name) => ([...String(name || '')].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9973, 0) % 8) + 1;
const initialsOf = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
const leaveWords = (r) => `${isPrivate(r) ? PRIVATE_LABEL : r.leaveTypeName}, ${STATUS_LABEL[r.status].toLowerCase()}${halfWords(r.halfDay)}`;

/**
 * By person (rounds 5 and 17): one row a person, a column a day. The name stays put on the left while the days scroll
 * under it on a phone; the scroll is the grid's own, never the page's. A leave is one solid block in its type's colour
 * across its days (a run of cells with the ends rounded), lighter while it waits; a half day fills half its cell, left
 * for the first half, right for the second. Weekly offs and holidays are tinted, today is marked in the head.
 */
function PersonRows({ month, today, days, people, shaded, holidayOn, clashOn, awayOn, dept }) {
  const leaveOn = (p, d) => p.leave.find((x) => x.fromDate <= d && d <= x.toDate);
  return (
    /* Reachable by keyboard, so the days past the edge can be read (axe scrollable-region-focusable). */
    <div className="pt-rows-scroll" tabIndex={0} role="group" aria-label={`Days of ${title(month)}`}>
      <table className="pt-rows ui-table-register" aria-label={`Leave in ${title(month)}`}>
        <thead>
          <tr>
            <th scope="col" className="ui-register-sticky pt-rows-who">Employee</th>
            {days.map((d) => (
              <th
                key={d}
                scope="col"
                title={holidayOn.get(d) || undefined}
                className={`pt-rows-day ${shaded(d) ? 'is-shaded' : ''} ${holidayOn.has(d) ? 'is-holiday' : ''} ${d === today ? 'is-today' : ''}`}
                aria-current={d === today ? 'date' : undefined}
              >
                <span className="pt-rows-wd">{'SMTWTFS'[weekday(d)]}</span>
                <span className="pt-rows-n">{Number(d.slice(8))}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!people.length ? (
            <tr>
              <td className="pt-rows-empty" colSpan={days.length + 1} role="status">Nobody is away or working elsewhere in {title(month)}{dept ? ` in ${dept}` : ''}. Leave approved for these days shows here, one line a person.</td>
            </tr>
          ) : null}
          {people.map((p) => (
            <tr key={p.id}>
              <th scope="row" className="ui-register-sticky pt-rows-who">
                <span className="pt-rows-person">
                  <span className="pt-rows-face" aria-hidden="true" style={{ '--face': `var(--cat-${identityCat(p.name)}, var(--fg-subtle))` }}>{initialsOf(p.name)}</span>
                  <span className="min-w-0">
                    <span className="block truncate">{p.name}</span>
                    {p.department ? <span className="ui-caption block truncate">{p.department}</span> : null}
                  </span>
                </span>
              </th>
              {days.map((d, i) => {
                const r = leaveOn(p, d);
                const cls = `pt-rows-cell ${shaded(d) ? 'is-shaded' : ''} ${d === today ? 'is-today' : ''}`;
                if (r) {
                  const tone = toneOf(r);
                  /* The block runs on from the day before and into the day after when it is the same leave; a half day stands alone. */
                  const joinsBefore = !r.halfDay && i > 0 && leaveOn(p, days[i - 1])?.id === r.id;
                  const joinsAfter = !r.halfDay && i < days.length - 1 && leaveOn(p, days[i + 1])?.id === r.id;
                  return (
                    <td key={d} className={cls}>
                      <span
                        className={`pt-rows-leave ${joinsBefore ? '' : 'is-start'} ${joinsAfter ? '' : 'is-end'} ${r.halfDay ? `is-half ${r.halfDay === 'SECOND' ? 'is-second' : ''}` : ''} ${r.status === 'PENDING' ? 'is-waiting' : ''} ${tone.className || ''}`}
                        role="img"
                        data-half={r.halfDay || undefined}
                        data-joins={[joinsBefore ? 'before' : '', joinsAfter ? 'after' : ''].filter(Boolean).join(' ') || undefined}
                        style={tone.style}
                        title={`${p.name}: ${leaveWords(r)}`}
                        aria-label={`${d}: ${leaveWords(r)}`}
                      />
                    </td>
                  );
                }
                const w = p.working.find((x) => x.fromDate <= d && d <= x.toDate && !shaded(d));
                return (
                  <td key={d} className={cls}>
                    {w ? (
                      <span
                        className="pt-rows-working"
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
          <tr className="pt-rows-away">
            <th scope="row" className="ui-register-sticky pt-rows-who font-semibold">Away</th>
            {days.map((d) => (clashOn.has(d)
              ? <td key={d} className="pt-rows-cell" title="Two or more of one department away"><span className="ui-pill ui-pill-warn tabular-nums px-1">{awayOn(d) || '!'}</span></td>
              : <td key={d} className={`pt-rows-cell ui-muted tabular-nums ${shaded(d) ? 'is-shaded' : ''}`}>{awayOn(d) || ''}</td>))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
