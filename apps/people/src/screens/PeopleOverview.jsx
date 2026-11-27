import '@ui/components/ui/DashboardBoard.css';
import { errorWords } from '@ui/utils/errorWords';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, ChevronRight, CircleAlert, Clock, Hourglass, LogOut, Plus, Users } from 'lucide-react';
import { DashboardHeader, DashboardBlock as Block, DashboardFigures } from './PeopleDashboard';
import { useChangeMessage, usePeopleUpdates } from './usePeopleUpdates';

import { SkeletonCard } from '@ui/components/ui/Primitives';
import { getOverview, getPeopleHome, listEmployees, summaryOpened } from '@ui/personnel/api';
import { listLeaveRequests, swatchOf } from '@ui/timeOff/api';
import { listRecords } from '../api/workspace';
import { symbolOf } from './symbols';
import { todayIst } from '@ui/utils/dates';
import { formatDate } from '@ui/components/ui/DatePicker';
import { requestOpenApp } from '@platform/context';
import { usePermissions } from '@ui/permissions/usePermissions';
import { can } from '../workforce/shared';
import { HomeCheckIn } from '@ui/timeOff/MyDays';
import { FinalPayBanner, FinalPayList } from '@ui/lifecycle/LeavingExtras';
import { finalPayList } from '../api/engagement';
import HomeSetup from './HomeSetup';
import HomeMyLeave from './HomeMyLeave';
import { ConnectionBar, DayTimeline, DecideInPlace, HomeSkeleton, TeamsToday, TodayFeed, clockWords, useConnection } from './HomeToday';

const TEAM_FIGURE_ICONS = { headcount: Users, in: Clock, out: CalendarDays, probation: Hourglass, notice: LogOut };
const TONE = { urgent: { label: 'Now', pill: 'neg' }, soon: { label: 'This week', pill: 'neutral' }, info: { label: 'When you can', pill: 'neutral' } };
/** Headcount by department draws the categorical series, never past eight; the rest is one grey "Other" (R&D brand, 14 Nov 2026). */
const CHART_COLOURS = 8;
/*
 * News and events coloured by what they are, never by their place in the list (review of #123): a post for a group
 * is clay, one for everyone violet; a Fun Friday clay, any other event violet. Marigold stays with "Waiting for you".
 */
/* The business day is India's, whatever the browser's clock zone: who is out today, and today's headcount. */
const isoToday = todayIst;
/* A stored day (YYYY-MM-DD) read on its own calendar, never shifted by the browser's clock zone. */
const isDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const words = (d, opts) => (isDay(d) ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' }) : new Date(d).toLocaleDateString('en-IN', opts));
const shortDate = (d) => words(d, { day: 'numeric', month: 'short' });
const dayDate = (d) => words(d, { weekday: 'short', day: 'numeric', month: 'short' });
const monthWords = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthName = () => new Date().toLocaleDateString('en-IN', { month: 'long' });
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
const whenLabel = (days, date) => (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : shortDate(date));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/* The working day after a leave ends: the next day, or Monday after a Friday. */
const backOn = (to) => {
  const d = new Date(`${to}T00:00:00`);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return dayDate(d);
};

/* A face in its team's colour: the photo when there is one, initials when not. */
function Face({ person, size = 40, colour }) {
  /* No text under 12px (DESIGN.md): a small face grows its initials to 12px rather than shrinking them. */
  const style = { width: size, height: size, '--dept': `var(--dept-${colour ?? 0})`, fontSize: size >= 56 ? 17 : size >= 40 ? 14 : size >= 32 ? 13 : 12 }; /* initials on the type scale: 12, 13, 14 or 17 */
  return person?.photoUrl ? (
    <img src={person.photoUrl} alt="" className="people-face" style={style} />
  ) : (
    <span className="people-face" style={style} aria-hidden="true">{initials(person?.name)}</span>
  );
}

const eventDay = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return { day: d.getDate(), month: d.toLocaleDateString('en-IN', { month: 'short' }), weekday: d.toLocaleDateString('en-IN', { weekday: 'long' }) };
};
function eventEmoji(event) {
  const selected = symbolOf(event.details?.symbol)?.emoji;
  if (selected) return selected;
  if (/orientation|onboard|welcome/i.test(event.title)) return '👋';
  if (/town hall|all.hands/i.test(event.title)) return '🎤';
  if (/workshop|training/i.test(event.title)) return '📚';
  if (/fun friday|celebration/i.test(event.title)) return '🎉';
  return '📅';
}
const ago = (iso) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? `${days} days ago` : shortDate(iso);
};

/*
 * A card whose request failed (UI audit, 7 Nov 2026): said as a failure with a way to try again, never drawn as an empty
 * answer. "All caught up" or "Everyone is in today" over a list that never arrived tells the owner nothing waits when it may.
 */
function CardFailed({ what, onRetry, role = 'status' }) {
  /* Polite by default: several side cards failing at once must not interrupt a screen reader in turn. "Waiting for you" alerts. */
  return (
    <div className="people-empty flex flex-wrap items-center gap-2" role={role}>
      <CircleAlert size={16} aria-hidden="true" style={{ color: 'rgb(var(--neg))' }} />
      <span className="min-w-0 flex-1">Could not load {what}. It may not be complete.</span>
      <button type="button" className="people-chip" onClick={onRetry}>Retry</button>
    </div>
  );
}

/*
 * One card's request: the answer into its state, or the failure into `failed`. A refusal (403) is an answer, not a
 * failure: a module switched off or a list this reader may not open is simply empty for them, as before.
 */
function loadCard(key, request, set, setFailed, inFlight, background = false) {
  /* One request per card at a time: a second Retry before the first answers asks nothing again. */
  if (inFlight.has(key)) return Promise.resolve();
  inFlight.add(key);
  setFailed((f) => (f[key] ? { ...f, [key]: false } : f));
  if (!background) set(null);
  return request().then(set, (e) => {
    if (Number(e?.status) === 403) return set([]);
    setFailed((f) => ({ ...f, [key]: true }));
    return undefined;
  }).finally(() => inFlight.delete(key));
}

async function loadUpdateRecords(kind) {
  const records = await listRecords(kind);
  if (!Array.isArray(records)) throw new Error('The records response was incomplete');
  return records;
}

/*
 * Three short lists under "Waiting for you" (People plan, 8 Nov 2026): probation ending, this week, and last
 * month's attendance close. A list on the page ground under one hairline, no card (DESIGN.md); a block with
 * nothing in it, or one this reader may not see (null from the server), is left out.
 */
export function HomeGlance({ glance, go }) {
  if (!glance) return null;
  const { probation, week, monthClose, teamWeek } = glance;
  const weekRows = week ? [
    ...week.joining.map((p) => ({ key: `j-${p.id}`, on: p.on, text: <><span className="people-inline-emoji" aria-hidden="true">👋</span><b>{p.name}</b> joins</>, open: go('employee', { id: p.id }) })),
    ...week.leaving.map((p) => ({ key: `l-${p.id}`, on: p.on, text: <><b>{p.name}</b>’s last day</>, open: go('employee', { id: p.id }) })),
    ...week.holidays.map((h) => ({ key: `h-${h.date}-${h.name}`, on: h.date, text: <><b>{h.name}</b>{h.optional ? ' (optional holiday)' : ' (holiday)'}</>, open: go('holidays') })),
  ].sort((a, b) => a.on.localeCompare(b.on)) : [];
  const blocks = [];
  /* Round 55 (week ahead A): a manager's own team for the next seven days, first; their open requests are the waiting line above. */
  if (teamWeek && (teamWeek.away.length || teamWeek.birthdays.length || glance.waiting)) {
    const rows = [
      ...teamWeek.away.map((a) => ({ key: `a-${a.id}-${a.from}`, on: a.from < teamWeek.from ? teamWeek.from : a.from, text: <><b>{a.name}</b> away{a.from === a.to ? '' : ` till ${shortDate(a.to)}`}</>, when: a.from <= teamWeek.from ? 'Away now' : dayDate(a.from), open: go('employee', { id: a.id }) })),
      ...teamWeek.birthdays.map((b) => ({ key: `b-${b.id}`, on: b.on, text: <><b>{b.name}</b>’s birthday</>, when: b.on === teamWeek.from ? 'Today' : dayDate(b.on), open: go('employee', { id: b.id }) })),
    ].sort((x, y) => x.on.localeCompare(y.on));
    blocks.push(
      <section key="teamWeek" className="people-glance-block" aria-labelledby="glance-team-week">
        <header className="people-glance-head">
          <h2 id="glance-team-week" className="people-glance-title">Your team this week</h2>
          <span className="ui-caption tabular-nums">{shortDate(teamWeek.from)} to {shortDate(teamWeek.to)}</span>
        </header>
        <ul className="people-glance-list">
          {glance.waiting ? (
            <li key="open">
              <button type="button" className="people-glance-row" onClick={go('approvals')}>
                <span className="min-w-0 flex-1 truncate"><b className="tabular-nums">{glance.waiting.toLocaleString('en-IN')}</b> {glance.waiting === 1 ? 'item needs' : 'items need'} your action</span>
                <span className="people-glance-when">Open Inbox</span>
              </button>
            </li>
          ) : null}
          {rows.map((r) => (
            <li key={r.key}>
              <button type="button" className="people-glance-row" onClick={r.open}>
                <span className="min-w-0 flex-1 truncate">{r.text}</span>
                <span className="people-glance-when tabular-nums">{r.when}</span>
              </button>
            </li>
          ))}
          {!rows.length ? <li className="ui-caption" style={{ padding: '8px 0' }}>Nobody on your team is away and no birthdays this week.</li> : null}
        </ul>
      </section>,
    );
  }
  if (probation?.length) {
    blocks.push(
      <section key="probation" className="people-glance-block" aria-labelledby="glance-probation">
        <header className="people-glance-head">
          <h2 id="glance-probation" className="people-glance-title">Probation ending</h2>
          <button type="button" className="people-more" onClick={go('employees', { prob: 'on' })}>All <ChevronRight size={16} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" /></button>
        </header>
        <ul className="people-glance-list">
          {probation.map((p) => (
            <li key={p.id}>
              <button type="button" className="people-glance-row" onClick={go('employee', { id: p.id, tab: 'employment', focus: 'probation' })}>
                <span className="min-w-0 flex-1 truncate"><b>{p.name}</b>{p.code ? <span className="ui-muted"> · {p.code}</span> : null}</span>
                <span className="people-glance-when tabular-nums" data-tone={p.over ? 'warn' : undefined}>{p.over ? `Ended ${formatDate(p.endsOn)}` : `Ends ${formatDate(p.endsOn)}`}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>,
    );
  }
  if (weekRows.length) {
    blocks.push(
      <section key="week" className="people-glance-block" aria-labelledby="glance-week">
        <header className="people-glance-head">
          <h2 id="glance-week" className="people-glance-title">This week</h2>
          <span className="ui-caption tabular-nums">{shortDate(week.from)} to {shortDate(week.to)}</span>
        </header>
        <ul className="people-glance-list">
          {weekRows.map((r) => (
            <li key={r.key}>
              <button type="button" className="people-glance-row" onClick={r.open}>
                <span className="min-w-0 flex-1 truncate">{r.text}</span>
                <span className="people-glance-when tabular-nums">{dayDate(r.on)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>,
    );
  }
  if (monthClose) {
    const state = monthClose.closedAt
      ? { tone: 'pos', text: `Closed on ${shortDate(monthClose.closedAt)}` }
      : monthClose.blocking
        ? { tone: 'warn', text: `${plural(monthClose.blocking, 'thing')} to fix before closing` }
        : monthClose.noRecordDays
          ? { tone: 'warn', text: 'Attendance missing, needs confirming' }
          : { tone: undefined, text: 'Ready to close' };
    blocks.push(
      <section key="close" className="people-glance-block" aria-labelledby="glance-close">
        <header className="people-glance-head">
          <h2 id="glance-close" className="people-glance-title">Month close</h2>
        </header>
        <ul className="people-glance-list">
          <li>
            <button type="button" className="people-glance-row" onClick={() => requestOpenApp('attendance', 'monthClose', { month: monthClose.month })}>
              {/* The month is never cut short; a long state wraps under it instead. */}
              <span className="people-glance-month"><b>{monthWords(monthClose.month)}</b></span>
              <span className="people-glance-when people-glance-state" data-tone={state.tone}>{state.text}</span>
            </button>
          </li>
        </ul>
      </section>,
    );
  }
  if (!blocks.length) return null;
  return <div className="people-glance">{blocks}</div>;
}

/* Work anniversaries in the next 30 days, from each person's joining date. */
function anniversariesOf(people) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  for (const p of people) {
    if (!p.dateOfJoining) continue;
    const joined = new Date(p.dateOfJoining);
    if (Number.isNaN(joined.getTime())) continue;
    let next = new Date(today.getFullYear(), joined.getMonth(), joined.getDate());
    if (next < today) next = new Date(today.getFullYear() + 1, joined.getMonth(), joined.getDate());
    const years = next.getFullYear() - joined.getFullYear();
    const days = Math.round((next - today) / 86_400_000);
    if (years >= 1 && days <= 30) out.push({ ...p, years, days, date: next });
  }
  return out;
}

/** A leave type: its colour beside its name, never the colour alone. */
function LeavePill({ request }) {
  const name = request.leaveTypeName || 'Leave';
  return (
    <span className="people-leave-pill" style={{ '--swatch': swatchOf({ color: request.leaveTypeColor, name }) }}>
      <i aria-hidden="true" /><span>{name.replace(/ leave$/i, '')}</span>
    </span>
  );
}



function describeHomeChange(before, after) {
  const changes = [];
  if (after.waiting !== before.waiting) changes.push(`${plural(after.waiting, 'item')} waiting`);
  if (after.today?.inCount != null && after.today.inCount !== before.today?.inCount) changes.push(`${after.today.inCount} checked in`);
  return changes.join(' · ');
}

/* Daily People workspace: decisions and availability first, then team figures and updates. */
export default function PeopleOverview({ openScreen }) {
  const [data, setData] = useState(null);
  /* People → Home's own answer: to-dos, the waiting number, probation, this week, last month's close. */
  const [home, setHome] = useState(null);
  const [people, setPeople] = useState(null);
  const [leave, setLeave] = useState(null);
  const [news, setNews] = useState(null);
  const [events, setEvents] = useState(null);
  /* Final pay due for leavers whose last day has come (WORKFLOW-GAP-RESEARCH 4.3). */
  const [finalPay, setFinalPay] = useState([]);
  const [failed, setFailed] = useState({});
  const inFlight = useRef(new Set()).current;
  const [error, setError] = useState('');
  /* Only what this reader may use (QA, 1 Nov 2026: a Team Manager was offered Announce and Add an employee). The server checks again. */
  const perms = usePermissions();
  const may = (key) => can(perms, key);
  /* Connection lost: the figures stay, marked with when they were fresh; back online, every card asks again. */
  const loadOverview = () => {
    setError('');
    return getOverview()
      .then(setData)
      .catch((e) => setError(errorWords(e, 'load the overview')));
  };
  const reloadAll = () => {
    if (data) getOverview().then(setData, () => {});
    else loadOverview();
    loadTodos();
    loadPeople();
    loadLeave();
    loadNews();
    loadEvents();
    loadFinalPay();
  };
  const conn = useConnection(() => reloadAll());
  /* The setup list replaces "All caught up" while it is showing (HomeSetup). */
  const [setupShowing, setSetupShowing] = useState(false);
  const onSetup = useCallback((d) => setSetupShowing(Boolean(d?.setup?.show)), []);
  const loadTodos = (background = false) => loadCard('todos', getPeopleHome, setHome, setFailed, inFlight, background === true);
  const loadLeave = (background = false) => loadCard('leave', listLeaveRequests, setLeave, setFailed, inFlight, background === true);
  const loadPeople = () => loadCard('people', () => listEmployees({ limit: 500 }).then((r) => (r?.employees || []).filter((p) => p.status !== 'LEFT')), setPeople, setFailed, inFlight);
  const loadNews = () => loadCard('news', () => loadUpdateRecords('announcements'), setNews, setFailed, inFlight);
  const loadEvents = () => loadCard('events', () => loadUpdateRecords('events'), setEvents, setFailed, inFlight);
  const loadFinalPay = () => loadCard('finalPay', finalPayList, (v) => setFinalPay(v || []), setFailed, inFlight);
  usePeopleUpdates(() => { loadTodos(true); loadLeave(true); });
  const activity = useChangeMessage(home && !Array.isArray(home) ? home : null, describeHomeChange);
  /* "Waiting for you" reads three lists; its Retry asks again only for those that failed. */
  const retryWaiting = () => {
    if (failed.todos) loadTodos();
    if (failed.leave) loadLeave();
  };

  useEffect(() => {
    loadOverview();
    loadTodos();
    loadPeople();
    loadLeave();
    /* Engage may be switched off for the company (a 403): then both lists are simply empty. */
    loadNews();
    loadEvents();
    loadFinalPay();
    /* Opened from the Monday summary's email: counted once (PRODUCT-VIEW §7). */
    try {
      if (new URLSearchParams(window.location.search).get('from') === 'weekly') summaryOpened().catch(() => {});
    } catch { /* no address to read */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the first load only; each card reloads itself on Retry
  }, []);
  /* A refusal (403) arrives as []: no to-dos and nothing else to show. */
  const todos = home ? (Array.isArray(home) ? home : home.todos) : null;
  const glance = home && !Array.isArray(home) ? home : null;
  const go = (screen, params) => () => openScreen?.(screen, params);
  const openPerson = (id) => () => openScreen?.('employee', { id });

  const depts = useMemo(() => [...(data?.byDepartment || [])].sort((a, b) => b.count - a.count), [data]);
  const colourOf = useMemo(() => {
    const m = new Map(depts.slice(0, CHART_COLOURS).map((d, i) => [d.name, i + 1]));
    return (name) => m.get(name) || 0;
  }, [depts]);
  /* Headcount by department: the eight biggest teams in the series, then the rest as one grey "Other". */
  const deptBars = useMemo(() => {
    const rest = depts.slice(CHART_COLOURS);
    const head = depts.slice(0, CHART_COLOURS).map((d, i) => ({ name: d.name, count: d.count, colour: i + 1 }));
    return rest.length ? [...head, { name: rest.length === 1 ? rest[0].name : 'Other', count: rest.reduce((n, d) => n + d.count, 0), colour: 0 }] : head;
  }, [depts]);
  const celebrations = useMemo(() => {
    const bdays = (data?.upcomingBirthdays || []).map((b) => ({ ...b, kind: 'birthday' }));
    /* Someone who asked not to be announced is left out (WORKFLOW-GAP-RESEARCH 4.8); the server already drops their birthday. */
    const quiet = new Set(data?.celebrationOptOuts || []);
    const annivs = anniversariesOf((people || []).filter((p) => !quiet.has(p.id))).map((a) => ({ ...a, kind: 'anniversary' }));
    return [...bdays, ...annivs].sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
  }, [data, people]);

  if (error) return (
    <div className="people-empty flex flex-wrap items-center gap-2" role="alert">
      <span>{error}</span>
      <button type="button" className="people-chip" onClick={loadOverview}>Retry</button>
    </div>
  );
  if (!data) return <HomeSkeleton />;

  const today = isoToday();
  const pending = (leave || []).filter((r) => r.status === 'PENDING').sort((a, b) => a.fromDate.localeCompare(b.fromDate));
  /*
   * Everything waiting in the one Approvals inbox, as the inbox counts it (help desk included): the same number the
   * rail badge and the Inbox's Waiting tab show (People plan, 8 Nov 2026). Leave stays the detail line.
   * The leave list can arrive first. It is not an Inbox total.
   */
  const waiting = glance ? glance.waiting : todos ? 0 : null;
  const waitFailed = Boolean(failed.todos || failed.leave);
  /* The two lines that make up the waiting number: requests in the Inbox, and the tasks on my name (Inbox › My tasks). */
  const myTaskLine = (todos || []).find((t) => t.key === 'myTasks') || null;
  const requestsWaiting = Math.max(0, (waiting || 0) - (myTaskLine?.count || 0));
  const outToday = [...new Map((leave || [])
    .filter((r) => r.status === 'APPROVED' && r.fromDate <= today && r.toDate >= today)
    .map((r) => [r.employeeId || r.id, r])).values()];
  const onNotice = data.byStatus.ON_NOTICE || 0;
  /* What the Inbox holds is the one line above; the rest of Home's to-dos are tasks. Probation has its own figure. */
  const otherTodos = (todos || []).filter((t) => t.screen !== 'approvals' && t.screen !== 'leaveRequests' && t.key !== 'probation' && t.key !== 'myTasks');
  const posts = (news || [])
    .filter((n) => n.status === 'PUBLISHED')
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 3);
  const upcoming = (events || [])
    .filter((e) => e.status === 'SCHEDULED' && isDay(e.details?.startDate) && (e.details.endDate || e.details.startDate) >= today)
    .sort((a, b) => String(a.details?.startDate).localeCompare(String(b.details?.startDate)))
    .slice(0, 4);
  /* Probation ending in 30 days or past and undecided: the to-do's count (in this reader's scope), the list for the dates. */
  const probationDue = Number((todos || []).find((t) => t.key === 'probation')?.count) || 0;
  const probationOver = (glance?.probation || []).filter((p) => p.over).length;
  const nextProbation = (glance?.probation || []).find((p) => !p.over) || null;
  const deptMax = Math.max(1, ...deptBars.map((d) => d.count));
  const joined = data.joinedThisMonth.length;
  const today_ = glance?.today || null;
  /* Leave this reader may decide, oldest start first; Home shows three, the Inbox has the rest. */
  const decidable = may('ATTENDANCE::Leave Requests::APPROVE') ? pending : [];
  const onDecided = () => { loadTodos(); loadLeave(); };
  const probationValue = todos ? Math.max(probationDue, probationOver) : null;
  const probationSub = failed.todos ? 'Could not load' : !todos ? 'Checking' : probationOver ? `${plural(probationOver, 'person', 'people')} past their date` : nextProbation ? `Next ends ${shortDate(nextProbation.endsOn)}` : '';
  const attendanceExpected = Number.isFinite(today_?.expected) && today_.expected > 0 ? today_.expected : null;
  const figures = [
    { key: 'headcount', label: 'Headcount', value: data.headcount, detail: joined ? `${plural(joined, 'new joiner')} in ${monthName()}` : 'Active employees', action: 'Open directory', onClick: may('PEOPLE::Employees::VIEW') ? go('employees') : null },
    ...(today_ && Number.isFinite(today_.inCount) ? [{
      key: 'in', label: 'Checked in today', value: today_.inCount,
      detail: attendanceExpected ? `of ${attendanceExpected.toLocaleString('en-IN')} expected` : '',
      max: attendanceExpected,
    }] : []),
    { key: 'out', label: 'On leave today', value: leave ? outToday.length : null, detail: failed.leave ? 'Could not load' : !leave ? 'Checking' : '', status: outToday.length ? { label: 'Approved', tone: 'pos' } : null, action: 'View leave calendar', onClick: may('ATTENDANCE::Leave Requests::VIEW') ? go('leaveCalendar') : null },
    ...(probationValue > 0 || failed.todos ? [{ key: 'probation', label: 'Probation due', value: probationValue, detail: probationSub, status: probationOver && !failed.todos ? { label: 'Overdue', tone: 'neg' } : null, action: 'Review probation', onClick: go('employees', { prob: 'on' }) }] : []),
    ...(!data.leavingsHidden && onNotice > 0 ? [{
      key: 'notice', label: 'On notice', value: onNotice, detail: 'Serving their notice period',
      action: 'View employees', onClick: may('PEOPLE::Employees::VIEW') ? go('employees', { status: 'ON_NOTICE' }) : null,
    }] : []),
  ];
  const waitingForYou = (
    <Block id="todo-h" title="Waiting for you">
      {/* Leave decided in place, with a short undo (owner, 22 Nov 2026, replacing "approvals live only in the Inbox"); the Inbox line below keeps the full count. */}
      {decidable.length && conn.online ? <DecideInPlace requests={decidable} onDecided={onDecided} /> : null}
      {waiting ? (
        <ul className="people-list people-work-list">
          {requestsWaiting ? (
            <li className="people-work-item">
              <div className="people-work-item-label">
                <span className="people-work-count tabular-nums">{requestsWaiting}</span>
                <div className="min-w-0">
                  <h3 className="people-row-title">Requests to review</h3>
                  {pending.length > 0 && <p className="ui-caption">{`${plural(pending.length, 'leave request')} · next starts ${dayDate(pending[0].fromDate)}`}</p>}
                </div>
              </div>
              <button type="button" className="people-arrow-link" onClick={go('approvals', { tab: 'waiting' })}>Review requests <ArrowRight size={16} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" /></button>
            </li>
          ) : null}
          {myTaskLine ? (
            <li className="people-work-item">
              <div className="people-work-item-label">
                <span className="people-work-count tabular-nums">{myTaskLine.count}</span>
                <div className="min-w-0">
                  <h3 className="people-row-title">Tasks assigned to you</h3>
                </div>
              </div>
              <button type="button" className="people-arrow-link" onClick={go('approvals', { tab: 'tasks' })}>View my tasks <ArrowRight size={16} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" /></button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {waitFailed ? <CardFailed what={failed.todos ? 'what waits for you' : 'the leave waiting for you'} onRetry={retryWaiting} role="alert" /> : null}
      {failed.todos ? null : !todos ? (
        <div role="status" aria-label="Loading requests and tasks"><SkeletonCard lines={2} /></div>
      ) : !waiting && !waitFailed ? (
        <p className="people-empty people-list">{setupShowing ? 'Start with the setup steps below.' : 'All caught up'}</p>
      ) : null}
    </Block>
  );

  const canOpenInbox = may('PEOPLE::Requests::VIEW');
  const inboxCount = canOpenInbox && waiting > 0 ? waiting : 0;
  const destinations = [
    canOpenInbox && { key: 'approvals', label: 'Inbox', accessibleName: inboxCount ? `Inbox, ${plural(inboxCount, 'item')} ${inboxCount === 1 ? 'needs' : 'need'} your action` : undefined },
    may('ATTENDANCE::Leave Requests::VIEW') && { key: 'leaveCalendar', label: 'Leave calendar' },
    may('PEOPLE::Employees::VIEW') && { key: 'employees', label: 'Employee directory' },
    may('ATTENDANCE::My Attendance::VIEW') && { key: 'myRequests', label: 'My requests' },
  ].filter(Boolean);

  return (
    <div className="people-home people-home--daily people-home--overview">
      <DashboardHeader title={<time dateTime={today}>{dayDate(today)}</time>}
        action={may('PEOPLE::Employees::CREATE') ? <button type="button" className="ui-btn ui-btn-primary" onClick={go('employeeNew')}><Plus size={16} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" /> Add employee</button> : null}>
        {destinations.length ? (
          <nav className="people-brief-links" aria-label="People destinations">
            {destinations.map(({ key, label, accessibleName }) => (
              <a key={key} className="people-arrow-link" href={`?app=people&open=${key}`} aria-label={accessibleName} onClick={(event) => {
                if (!openScreen || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
                event.preventDefault();
                go(key)();
              }}>
                {label}<ArrowUpRight size={16} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" />
              </a>
            ))}
          </nav>
        ) : null}
      </DashboardHeader>
      {activity && conn.online && !failed.todos ? (
        <p className="people-home-change" role="status"><time dateTime={activity.at.toISOString()}>{clockWords(activity.at)}</time> {activity.text}</p>
      ) : null}
      <ConnectionBar online={conn.online} back={conn.back} onRetry={() => { if (navigator.onLine !== false) reloadAll(); }} />
      {!conn.online ? <p className="people-home-offline">Last updated at {clockWords(conn.since)}.</p> : null}
      {failed.finalPay ? <CardFailed what="the final pay that is due" onRetry={loadFinalPay} /> : null}
      {finalPay.length ? (
        <section aria-label="Final pay due" className="space-y-2">
          {finalPay.length === 1 ? (
            <FinalPayBanner clock={finalPay[0]} name={finalPay[0].name} showRule={false} action={<button type="button" className="ui-link inline-flex min-h-11 items-center whitespace-nowrap sm:min-h-0" onClick={go('leavers', { open: finalPay[0].employeeId })}>Open plan</button>} />
          ) : <FinalPayList rows={finalPay} onOpen={(id) => go('leavers', { open: id })} onMore={go('leavers', { view: 'clearing' })} />}
          <p className="ui-caption">Code on Wages 2019 s.17(2): wages within two working days of the last day. Clearance does not hold them up.</p>
        </section>
      ) : null}

      <section className="people-home-work" aria-label="Your work">
        <div className="people-home-queue">{waitingForYou}</div>
        <section className="people-home-personal" aria-labelledby="people-home-personal-title">
          <h2 className="people-home-section-title" id="people-home-personal-title">My time today</h2>
          <div className="people-home-self">
            <HomeCheckIn primary={!requestsWaiting && !myTaskLine} />
            <HomeMyLeave openScreen={openScreen} />
          </div>
        </section>
        <Block id="events-h" className="people-home-events" title="Upcoming events" action={may('PEOPLE::Events::VIEW') ? <button type="button" className="people-more" onClick={go('events')}>All events</button> : null}>
          {upcoming.length ? (
            <ul className="people-list">
              {upcoming.map((e) => {
                const d = eventDay(e.details.startDate);
                return (
                  <li key={e.id}>
                    <button type="button" className="people-row people-row-action" onClick={go('events')}>
                      <span className="people-date"><b>{d.day}</b><span>{d.month}</span></span>
                      <span className="people-event-emoji" aria-hidden="true">{eventEmoji(e)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="people-row-title">{e.title}</span>
                        <span className="ui-caption block">{d.weekday}{e.details?.location ? `, ${e.details.location}` : ''}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : failed.events ? <CardFailed what="events" onRetry={loadEvents} /> : (
            (events ? <p className="people-empty people-list">No events planned. A Fun Friday is a good start.</p> : <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading"><div className="ui-skel h-9 w-full" /><div className="ui-skel h-9 w-full" /></div>)
          )}
        </Block>
      </section>

      <DashboardFigures id="team-overview-heading" title="Team overview" figures={figures} icons={TEAM_FIGURE_ICONS} />

      <div className="people-home-layout">
        <div className="people-home-primary">
          {/* HR's other to-dos: not answers anyone waits on, so not in the waiting number; each opens the screen that fixes it. */}
          {otherTodos.length ? (
            <Block id="attention-h" title="Needs attention">
              <ul className="people-list">
                {otherTodos.map((t) => (
                  <li key={t.key}>
                    <button type="button" onClick={go(t.screen, t.params)} className="people-row people-row-action">
                      <span className="people-row-count" data-tone={t.tone === 'info' ? undefined : 'warn'}>{t.count}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="people-row-title">{t.title}</span>
                          <span className={`ui-pill ui-pill-${TONE[t.tone]?.pill || 'neutral'}`}>{TONE[t.tone]?.label}</span>
                        </span>
                        <span className="ui-caption block">{t.detail}</span>
                      </span>
                      <span className="people-more">Open <ArrowRight size={16} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" /></span>
                    </button>
                  </li>
                ))}
              </ul>
            </Block>
          ) : null}

          <Block id="news-h" title="Announcements" className="people-home-news" action={may('PEOPLE::Announcements::CREATE') ? <button type="button" className="people-more" onClick={go('announcements')}>Post one</button> : null}>
            {posts.length ? (
              <ul className="people-news-grid">
                {posts.map((n) => (
                  <li key={n.id} data-audience={n.details?.audienceKind && n.details.audienceKind !== 'ALL' ? 'targeted' : undefined}>
                    <button type="button" className="people-row people-row-action items-start" onClick={go('announcements')}>
                      <span className="people-news-icon" aria-hidden="true">
                        {symbolOf(n.details?.symbol)?.emoji || '📢'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="people-row-title">{n.title}</span>
                        <span className="people-row-body">{n.details?.body?.replace(/(\*\*|__|^[-*] )/gm, '')}</span>
                        <span className="ui-caption block">{ago(n.updatedAt)}{n.details?.audienceKind && n.details.audienceKind !== 'ALL' ? ` · For ${n.details.audience}` : n.details?.audience ? ` · For ${n.details.audience.toLowerCase()}` : ''}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : failed.news ? <CardFailed what="announcements" onRetry={loadNews} /> : (
              (news ? <p className="people-empty people-list">No announcements yet.</p> : <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading"><div className="ui-skel h-9 w-full" /><div className="ui-skel h-9 w-full" /></div>)
            )}
          </Block>

          {today_ ? <DayTimeline today={today_} onOpen={() => requestOpenApp('attendance', 'today')} /> : null}
          {today_ ? <TodayFeed today={today_} openPerson={openPerson} /> : null}

          <HomeGlance glance={glance} go={go} />

          {/* The setup list sits under what waits on you, so a request is never below the fold behind it (2 Nov 2026). */}
          <HomeSetup openScreen={openScreen} onState={onSetup} />

          {/* Each team's day as a heat table when Attendance gives the day (style I); otherwise headcount by department. */}
          {today_?.byTeam?.length ? <TeamsToday teams={today_.byTeam} /> : deptBars.length ? (
            <Block id="dept-h" title="Headcount by department" action={<span className="ui-caption">Active employees, today</span>}>
              <figure className="people-dept-chart" aria-label={depts.map((d) => `${d.name} ${d.count}`).join(', ')}>
                <ul>
                  {deptBars.map((d) => (
                    <li key={d.name} style={{ '--dept': `var(--dept-${d.colour})` }}>
                      <span>{d.name}</span>
                      <span className="people-dept-bar" aria-hidden="true"><span style={{ width: `${(d.count / deptMax) * 100}%` }} /></span>
                      <b>{d.count}</b>
                    </li>
                  ))}
                </ul>
              </figure>
            </Block>
          ) : null}
        </div>

        <aside className="people-home-rail" aria-label="Team and calendar">
          <Block id="out-h" className="people-home-away" title="Who’s out today" action={<button type="button" className="people-more" onClick={go('leaveCalendar')}>Calendar</button>}>
            {outToday.length ? (
              <ul className="people-list">
                {outToday.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="people-row people-row-action" onClick={openPerson(r.employeeId)}>
                      <Face person={{ name: r.employeeName, photoUrl: r.photoUrl }} size={36} colour={colourOf(r.department)} />
                      <span className="people-away-details min-w-0">
                        <span className="people-row-title">{r.employeeName}</span>
                        {r.department ? <span className="ui-caption block">{r.department}</span> : null}
                        <span className="ui-caption block">Back {backOn(r.toDate)}</span>
                      </span>
                      <LeavePill request={r} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : failed.leave ? <CardFailed what="who is out today" onRetry={loadLeave} /> : (
              <p className="people-empty people-list">{leave ? 'No approved leave today.' : 'Loading leave…'}</p>
            )}
          </Block>
          {joined > 0 ? (
            <Block id="joiners-h" title="New joiners" className="people-home-welcome" action={<span className="ui-caption">This month</span>}>
              <button type="button" className="people-welcome-link" onClick={go('employees', { from: `${today.slice(0, 7)}-01`, to: today })}>
                <span className="people-welcome-emoji" aria-hidden="true">👋</span>
                <span className="min-w-0"><strong>{plural(joined, 'new joiner')}</strong><span className="ui-caption block">{data.joinedThisMonth.slice(0, 3).map((person) => person.name).join(', ')}{joined > 3 ? ` +${joined - 3} more` : ''}</span></span>
                <ArrowRight size={16} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" />
              </button>
            </Block>
          ) : null}
          <Block id="celebrate-h" title="Celebrations" className="people-home-celebrations" action={<span className="ui-caption">Next 30 days</span>}>
            {celebrations.length ? (
              <ul className="people-list">
                {celebrations.slice(0, 3).map((c) => (
                  <li key={`${c.kind}-${c.id}`}>
                    <button type="button" className="people-row people-row-action" onClick={openPerson(c.id)}>
                      <span className="people-celebration-emoji" aria-hidden="true">{c.kind === 'birthday' ? '🎂' : '🏆'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="people-row-title">{c.name}</span>
                        <span className="ui-caption block">{c.kind === 'birthday' ? 'Birthday' : `${plural(c.years, 'year')} at the company`}</span>
                      </span>
                      <span className="people-when">{whenLabel(c.days, c.date)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : failed.people ? null : <p className="people-empty people-list">Nothing to celebrate in the next 30 days.</p>}
            {failed.people ? <CardFailed what="work anniversaries" onRetry={loadPeople} /> : null}
          </Block>
        </aside>
      </div>
    </div>
  );
}
