import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AirplaneTilt,
  ArrowRight,
  CalendarDots,
  CaretRight,
  Cake,
  ChatsCircle,
  PushPin,
  IconContext,
  Medal,
  Megaphone,
  Hourglass,
  Plus,
  SignOut,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';

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

const TONE = { urgent: { label: 'Now', pill: 'neg' }, soon: { label: 'This week', pill: 'neutral' }, info: { label: 'When you can', pill: 'neutral' } };
/** Headcount by department draws the categorical series, never past eight; the rest is one grey "Other" (R&D brand, 14 Nov 2026). */
const CHART_COLOURS = 8;
/*
 * News and events coloured by what they are, never by their place in the list (review of #123): a post for a group
 * is clay, one for everyone violet; a Fun Friday clay, any other event violet. Marigold stays with "Waiting for you".
 */
const newsTint = (n) => (n.details?.audienceKind && n.details.audienceKind !== 'ALL' ? 'peach' : 'lilac');
const eventTint = (e) => (/fun friday/i.test(e.title || '') ? 'peach' : 'lilac');
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
  const style = { width: size, height: size, '--dept': `var(--dept-${colour ?? 0})`, fontSize: Math.max(12, Math.round(size * 0.36)) };
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
      <WarningCircle size={16} weight="bold" aria-hidden="true" style={{ color: 'rgb(var(--neg))' }} />
      <span className="min-w-0 flex-1">Could not load {what}. It may not be complete.</span>
      <button type="button" className="people-chip" onClick={onRetry}>Retry</button>
    </div>
  );
}

/*
 * One card's request: the answer into its state, or the failure into `failed`. A refusal (403) is an answer, not a
 * failure: a module switched off or a list this reader may not open is simply empty for them, as before.
 */
function loadCard(key, request, set, setFailed, inFlight) {
  /* One request per card at a time: a second Retry before the first answers asks nothing again. */
  if (inFlight.has(key)) return Promise.resolve();
  inFlight.add(key);
  setFailed((f) => (f[key] ? { ...f, [key]: false } : f));
  set(null);
  return request().then(set, (e) => {
    if (Number(e?.status) === 403) return set([]);
    setFailed((f) => ({ ...f, [key]: true }));
    return undefined;
  }).finally(() => inFlight.delete(key));
}

/*
 * Three short lists under "Waiting for you" (People plan, 8 Nov 2026): probation ending, this week, and last
 * month's attendance close. A list on the page ground under one hairline, no card (DESIGN.md); a block with
 * nothing in it, or one this reader may not see (null from the server), is left out.
 */
export function HomeGlance({ glance, go }) {
  if (!glance) return null;
  const { probation, week, monthClose } = glance;
  const weekRows = week ? [
    ...week.joining.map((p) => ({ key: `j-${p.id}`, on: p.on, text: <><b>{p.name}</b> joins</>, open: go('employee', { id: p.id }) })),
    ...week.leaving.map((p) => ({ key: `l-${p.id}`, on: p.on, text: <><b>{p.name}</b>’s last day</>, open: go('employee', { id: p.id }) })),
    ...week.holidays.map((h) => ({ key: `h-${h.date}-${h.name}`, on: h.date, text: <><b>{h.name}</b>{h.optional ? ' (optional holiday)' : ' (holiday)'}</>, open: go('holidays') })),
  ].sort((a, b) => a.on.localeCompare(b.on)) : [];
  const blocks = [];
  if (probation?.length) {
    blocks.push(
      <section key="probation" className="people-glance-block" aria-labelledby="glance-probation">
        <header className="people-glance-head">
          <h2 id="glance-probation" className="people-glance-title">Probation ending</h2>
          <button type="button" className="people-more" onClick={go('employees', { prob: 'on' })}>All <CaretRight size={14} aria-hidden="true" /></button>
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
          ? { tone: 'warn', text: `${monthClose.noRecordDays.toLocaleString('en-IN')} ${monthClose.noRecordDays === 1 ? 'day' : 'days'} with no record to confirm` }
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

/* A block on the page ground: a title, one link on the right, then its list under one hairline. */
function Block({ id, title, action = null, children, label }) {
  return (
    <section aria-labelledby={id} aria-label={label}>
      <header className="people-block-head">
        <h2 id={id} className="people-block-title">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/**
 * People → Home (PEOPLE-01, R&D redesign 14 Nov 2026). The day as the title, one primary (Add an employee), four
 * KPI tiles, then two columns: what needs you and the company by department; who is out today, celebrations,
 * news and what is coming. Lists sit on the page ground under one hairline; only the chart earns the soft panel.
 */
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
  /* The setup list replaces "All caught up" while it is showing (HomeSetup). */
  const [setupShowing, setSetupShowing] = useState(false);
  const onSetup = useCallback((d) => setSetupShowing(Boolean(d?.setup?.show)), []);
  const loadTodos = () => loadCard('todos', getPeopleHome, setHome, setFailed, inFlight);
  const loadLeave = () => loadCard('leave', listLeaveRequests, setLeave, setFailed, inFlight);
  const loadPeople = () => loadCard('people', () => listEmployees({ limit: 500 }).then((r) => (r?.employees || []).filter((p) => p.status !== 'LEFT')), setPeople, setFailed, inFlight);
  const loadNews = () => loadCard('news', () => listRecords('announcements'), setNews, setFailed, inFlight);
  const loadEvents = () => loadCard('events', () => listRecords('events'), setEvents, setFailed, inFlight);
  const loadFinalPay = () => loadCard('finalPay', finalPayList, (v) => setFinalPay(v || []), setFailed, inFlight);
  /* "Waiting for you" reads three lists; its Retry asks again only for those that failed. */
  const retryWaiting = () => {
    if (failed.todos) loadTodos();
    if (failed.leave) loadLeave();
  };

  useEffect(() => {
    getOverview()
      .then(setData)
      .catch((e) => setError(String(e?.message || 'Could not load the overview.')));
    loadTodos();
    loadPeople();
    loadLeave();
    /* Engage may be switched off for the company (a 403): then both lists are simply empty. */
    loadNews();
    loadEvents();
    loadFinalPay();
    /* Opened from the Monday summary's e-mail: counted once (PRODUCT-VIEW §7). */
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

  if (error) return <div className="people-empty" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</div>;
  if (!data) return <SkeletonCard lines={6} />;

  const today = isoToday();
  const pending = (leave || []).filter((r) => r.status === 'PENDING').sort((a, b) => a.fromDate.localeCompare(b.fromDate));
  /*
   * Everything waiting in the one Approvals inbox, as the inbox counts it (help desk included): the same number the
   * rail badge and the Inbox's Waiting tab show (People plan, 8 Nov 2026). Leave stays the detail line.
   * Until it loads, leave alone; unknown (null) while it failed, never a confident nought.
   */
  const waiting = glance ? glance.waiting : todos ? 0 : failed.todos ? null : pending.length;
  const waitFailed = Boolean(failed.todos || failed.leave);
  /* The two lines that make up the waiting number: requests in the Inbox, and the tasks on my name (Inbox › My tasks). */
  const myTaskLine = (todos || []).find((t) => t.key === 'myTasks') || null;
  const requestsWaiting = Math.max(0, (waiting || 0) - (myTaskLine?.count || 0));
  const outToday = (leave || []).filter((r) => r.status === 'APPROVED' && r.fromDate <= today && r.toDate >= today);
  const onNotice = data.byStatus.ON_NOTICE || 0;
  /* What the Inbox holds is the one line above; the rest of Home's to-dos are tasks. Probation has its own figure. */
  const otherTodos = (todos || []).filter((t) => t.screen !== 'approvals' && t.screen !== 'leaveRequests' && t.key !== 'probation' && t.key !== 'myTasks');
  const deptOf = new Map((people || []).map((p) => [p.id, p.department]));
  const posts = (news || []).filter((n) => n.status === 'PUBLISHED').slice(0, 3);
  const upcoming = (events || [])
    .filter((e) => e.status === 'SCHEDULED' && (e.details?.endDate || e.details?.startDate || '') >= today)
    .sort((a, b) => String(a.details?.startDate).localeCompare(String(b.details?.startDate)))
    .slice(0, 4);
  /* Probation ending in 30 days or past and undecided: the to-do's count (in this reader's scope), the list for the dates. */
  const probationDue = Number((todos || []).find((t) => t.key === 'probation')?.count) || 0;
  const probationOver = (glance?.probation || []).filter((p) => p.over).length;
  const nextProbation = (glance?.probation || []).find((p) => !p.over) || null;
  const deptMax = Math.max(1, ...deptBars.map((d) => d.count));
  const joined = data.joinedThisMonth.length;

  return (
    <IconContext.Provider value={{ weight: 'duotone' }}>
    <div className="people-home">
      <header className="people-home-head">
        <div className="min-w-0">
          {/* Titled by the day, not a time-of-day greeting (8 Nov 2026). */}
          <h1 className="ui-t-page">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
          <p className="people-home-sub">
            {waiting === null ? <>Could not check what waits for your answer</> : !todos && !leave ? <>Checking what waits for your answer</> : waiting ? <><strong>{plural(waiting, 'thing')}</strong> {waiting === 1 ? 'waits' : 'wait'} for your answer</> : <>Nothing waits for your answer</>}
            {leave ? <> and <strong data-zero={outToday.length === 0 || undefined}>{plural(outToday.length, 'person', 'people')}</strong> {outToday.length === 1 ? 'is' : 'are'} out today.</> : '.'}
          </p>
        </div>
        {/* One primary, top right; the shortcuts beside it are secondary. */}
        <div className="people-home-actions">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={go('leaveRequests')}><CalendarDots size={16} aria-hidden="true" /> Leave requests</button>
          {may('PEOPLE::HR Cases::VIEW') ? <button type="button" className="ui-btn ui-btn-secondary" onClick={go('helpdesk')}><ChatsCircle size={16} aria-hidden="true" /> HR cases</button> : null}
          {may('PEOPLE::Announcements::CREATE') ? <button type="button" className="ui-btn ui-btn-secondary" onClick={go('announcements')}><Megaphone size={16} aria-hidden="true" /> Announce</button> : null}
          {may('PEOPLE::Employees::CREATE') ? (
            <button type="button" className="ui-btn ui-btn-primary" onClick={go('employeeNew')}><Plus size={16} weight="bold" aria-hidden="true" /> Add an employee</button>
          ) : null}
        </div>
      </header>
      <HomeCheckIn />
      {failed.finalPay ? <CardFailed what="the final pay that is due" onRetry={loadFinalPay} /> : null}
      {finalPay.length ? (
        <section aria-label="Final pay due" className="space-y-2">
          {finalPay.length === 1 ? (
            <FinalPayBanner clock={finalPay[0]} name={finalPay[0].name} showRule={false} action={<button type="button" className="ui-link inline-flex min-h-11 items-center whitespace-nowrap sm:min-h-0" onClick={go('leavers', { open: finalPay[0].employeeId })}>Open plan</button>} />
          ) : <FinalPayList rows={finalPay} onOpen={(id) => go('leavers', { open: id })} onMore={go('leavers', { view: 'clearing' })} />}
          <p className="ui-caption">Code on Wages 2019 s.17(2): wages within two working days of the last day. Clearance does not hold them up.</p>
        </section>
      ) : null}

      <div className="people-kpis">
        <button type="button" className="people-kpi" data-tint="sky" onClick={go('employees')}>
          <span className="people-kpi-icon"><UsersThree size={20} aria-hidden="true" /></span>
          <span className="people-kpi-label">Headcount</span>
          <span className="people-kpi-row"><span className="people-kpi-value" data-zero={Number(data.headcount) === 0 || undefined}>{data.headcount}</span></span>
          <span className="people-kpi-note">{joined ? <><span className="people-delta">+{joined}</span> joined in {monthName()}</> : `None joined in ${monthName()}`}</span>
        </button>
        <button type="button" className="people-kpi" data-tint="peach" onClick={go('leaveCalendar')}>
          <span className="people-kpi-icon"><AirplaneTilt size={20} aria-hidden="true" /></span>
          <span className="people-kpi-label">Out today</span>
          <span className="people-kpi-row">
            <span className="people-kpi-value" data-zero={(leave && outToday.length === 0) || undefined}>{leave ? outToday.length : '–'}</span>
            {outToday.length ? (
              <span className="people-faces" aria-hidden="true">
                {outToday.slice(0, 3).map((r) => <Face key={r.id} person={{ name: r.employeeName, photoUrl: r.photoUrl }} size={28} colour={colourOf(r.department)} />)}
              </span>
            ) : null}
          </span>
          <span className="people-kpi-note">{leave ? `${data.headcount - outToday.length} of ${data.headcount} at work` : failed.leave ? 'Could not load leave' : 'Loading leave'}</span>
        </button>
        {/* No approvals among Home's figures (owner, 8 Nov 2026): the Inbox owns them. Probation is a decision that is Home's. */}
        <button type="button" className="people-kpi" data-tint="mint" data-attention={probationDue > 0 || undefined} onClick={go('employees', { prob: 'on' })}>
          <span className="people-kpi-icon"><Hourglass size={20} aria-hidden="true" /></span>
          <span className="people-kpi-label">Probation due</span>
          <span className="people-kpi-row"><span className="people-kpi-value" data-zero={(todos && probationDue === 0) || undefined}>{todos ? probationDue : '–'}</span></span>
          <span className="people-kpi-note">{failed.todos ? 'Could not load' : !todos ? 'Checking' : probationOver ? `${plural(probationOver, 'person', 'people')} past their date` : nextProbation ? `Next ends ${shortDate(nextProbation.endsOn)}` : 'None in the next 30 days'}</span>
        </button>
        {/* The company keeps who is leaving from this reader (Company choices): no leaving figures. */}
        {data.leavingsHidden ? null : (
          <button type="button" className="people-kpi" data-tint="butter" onClick={go('employees')}>
            <span className="people-kpi-icon"><SignOut size={20} aria-hidden="true" /></span>
            <span className="people-kpi-label">On notice</span>
            <span className="people-kpi-row"><span className="people-kpi-value" data-zero={Number(onNotice) === 0 || undefined}>{onNotice}</span></span>
            <span className="people-kpi-note">{data.leftThisMonth ? `${plural(data.leftThisMonth, 'person', 'people')} left in ${monthName()}` : `Nobody left in ${monthName()}`}</span>
          </button>
        )}
      </div>

      <div className="people-home-grid">
        <div className="people-home-main">
          {/*
           * Approvals live in the Inbox, not on Home (owner, 8 Nov 2026). The block adds up to the subtitle's number, no
           * more (People plan 8 Nov 2026, §3 rule 1): the requests in the Inbox on one line, the tasks on my name on another.
           */}
          <Block id="todo-h" title="Waiting for you">
            {waiting ? (
              <ul className="people-list">
                {requestsWaiting ? (
                  <li>
                    <button type="button" onClick={go('approvals')} className="people-row people-row-action">
                      <span className="people-row-count" data-tone="warn">{requestsWaiting}</span>
                      <span className="min-w-0 flex-1">
                        <span className="people-row-title">{requestsWaiting === 1 ? '1 request waits' : `${requestsWaiting} requests wait`} for you</span>
                        <span className="ui-caption block">{pending.length ? `${plural(pending.length, 'leave request')} among them, next starts ${dayDate(pending[0].fromDate)}` : 'Leave, attendance and other requests'}</span>
                      </span>
                      <span className="people-more">Review <ArrowRight size={14} weight="bold" aria-hidden="true" /></span>
                    </button>
                  </li>
                ) : null}
                {myTaskLine ? (
                  <li>
                    <button type="button" onClick={go('approvals', { tab: 'tasks' })} className="people-row people-row-action">
                      <span className="people-row-count" data-tone="warn">{myTaskLine.count}</span>
                      <span className="min-w-0 flex-1">
                        <span className="people-row-title">{myTaskLine.count === 1 ? '1 task is' : `${myTaskLine.count} tasks are`} on your name</span>
                        <span className="ui-caption block">Joining, leaving and other plan steps given to you</span>
                      </span>
                      <span className="people-more">My tasks <ArrowRight size={14} weight="bold" aria-hidden="true" /></span>
                    </button>
                  </li>
                ) : null}
              </ul>
            ) : null}
            {waitFailed ? <CardFailed what={failed.todos ? 'what waits for you' : 'the leave waiting for you'} onRetry={retryWaiting} role="alert" /> : null}
            {failed.todos ? null : !todos ? (
              <SkeletonCard lines={2} />
            ) : !waiting && !waitFailed ? (
              <p className="people-empty people-list">{setupShowing ? 'Nothing waits for you yet. Start with the steps below.' : <><strong>All caught up</strong>. Nothing needs your answer right now.</>}</p>
            ) : null}
          </Block>

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
                      <span className="people-more">Open <ArrowRight size={14} weight="bold" aria-hidden="true" /></span>
                    </button>
                  </li>
                ))}
              </ul>
            </Block>
          ) : null}

          <HomeGlance glance={glance} go={go} />

          {/* The setup list sits under what waits on you, so a request is never below the fold behind it (2 Nov 2026). */}
          <HomeSetup openScreen={openScreen} onState={onSetup} />

          {deptBars.length ? (
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

        <aside className="people-home-side" aria-label="Today in the company">
          <Block id="out-h" title="Who’s out today" action={<button type="button" className="people-more" onClick={go('leaveCalendar')}>Calendar</button>}>
            {outToday.length ? (
              <ul className="people-list">
                {outToday.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="people-row people-row-action" onClick={openPerson(r.employeeId)}>
                      <Face person={{ name: r.employeeName, photoUrl: r.photoUrl }} size={36} colour={colourOf(r.department)} />
                      <span className="min-w-0 flex-1">
                        <span className="people-row-title truncate">{r.employeeName}</span>
                        <span className="ui-caption block truncate">{r.department ? `${r.department} · ` : ''}back {backOn(r.toDate)}</span>
                      </span>
                      <LeavePill request={r} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : failed.leave ? <CardFailed what="who is out today" onRetry={loadLeave} /> : (
              <p className="people-empty people-list">{leave ? 'Everyone is in today.' : 'Loading leave…'}</p>
            )}
          </Block>

          <Block id="celebrate-h" title="Celebrations" action={<span className="ui-caption">Next 30 days</span>}>
            {celebrations.length || joined ? (
              <ul className="people-list">
                {data.joinedThisMonth.slice(0, 1).map((j) => (
                  <li key={`new-${j.id}`}>
                    <button type="button" className="people-row people-row-action" onClick={go('employees')}>
                      <span className="people-faces" aria-hidden="true">
                        {data.joinedThisMonth.slice(0, 3).map((x) => <Face key={x.id} person={x} size={32} colour={colourOf(deptOf.get(x.id))} />)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="people-row-title truncate">{plural(joined, 'new joiner')}</span>
                        <span className="ui-caption block truncate">{data.joinedThisMonth.map((x) => x.name.split(' ')[0]).join(', ')}</span>
                      </span>
                      <span className="people-when">Welcome</span>
                    </button>
                  </li>
                ))}
                {celebrations.slice(0, 3).map((c) => (
                  <li key={`${c.kind}-${c.id}`}>
                    <button type="button" className="people-row people-row-action" onClick={openPerson(c.id)}>
                      <span className="people-celebrate-face">
                        <Face person={c} size={36} colour={colourOf(deptOf.get(c.id))} />
                        <span className="people-celebrate-badge" data-kind={c.kind}>{c.kind === 'birthday' ? <Cake size={10} weight="fill" aria-hidden="true" /> : <Medal size={10} weight="fill" aria-hidden="true" />}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="people-row-title truncate">{c.name}</span>
                        <span className="ui-caption block truncate">{c.kind === 'birthday' ? 'Birthday' : `${plural(c.years, 'year')} at the company`}</span>
                      </span>
                      <span className="people-when">{whenLabel(c.days, c.date)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : failed.people ? null : (
              <p className="people-empty people-list">Nothing to celebrate in the next 30 days.</p>
            )}
            {/* Work anniversaries come from the directory: when it failed, say so rather than leave them out. */}
            {failed.people ? <CardFailed what="work anniversaries" onRetry={loadPeople} /> : null}
          </Block>

          <Block id="news-h" title="Announcements" action={may('PEOPLE::Announcements::CREATE') ? <button type="button" className="people-more" onClick={go('announcements')}>Post one</button> : null}>
            {posts.length ? (
              <ul className="people-list">
                {posts.map((n, i) => (
                  <li key={n.id}>
                    <button type="button" className="people-row people-row-action items-start" onClick={go('announcements')}>
                      <span className="people-news-icon" data-tint={newsTint(n)}>
                        {symbolOf(n.details?.symbol) ? <span aria-hidden="true">{symbolOf(n.details.symbol).emoji}</span> : i === 0 ? <PushPin size={16} aria-hidden="true" /> : <Megaphone size={16} aria-hidden="true" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="people-row-title">{n.title}</span>
                        <span className="people-row-body">{n.details?.body}</span>
                        <span className="ui-caption block">{ago(n.updatedAt)}{n.details?.audienceKind && n.details.audienceKind !== 'ALL' ? ` · For ${n.details.audience}` : n.details?.audience ? ` · For ${n.details.audience.toLowerCase()}` : ''}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : failed.news ? <CardFailed what="announcements" onRetry={loadNews} /> : (
              <p className="people-empty people-list">{news ? 'Nothing posted yet. Share news, a policy change or a welcome.' : 'Loading…'}</p>
            )}
          </Block>

          <Block id="events-h" title="Coming up" action={may('PEOPLE::Events::VIEW') ? <button type="button" className="people-more" onClick={go('events')}>All events</button> : null}>
            {upcoming.length ? (
              <ul className="people-list">
                {upcoming.map((e) => {
                  const d = eventDay(e.details.startDate);
                  const fun = /fun friday/i.test(e.title);
                  return (
                    <li key={e.id}>
                      <button type="button" className="people-row people-row-action" onClick={go('events')}>
                        <span className="people-date" data-tint={eventTint(e)}><b>{d.day}</b><span>{d.month}</span></span>
                        <span className="min-w-0 flex-1">
                          <span className="people-row-title truncate">{symbolOf(e.details?.symbol) ? <span className="mr-1.5" aria-hidden="true">{symbolOf(e.details.symbol).emoji}</span> : null}{fun ? `Fun Friday: ${e.title.replace(/^fun friday:\s*/i, '')}` : e.title}</span>
                          <span className="ui-caption block truncate">{d.weekday}{e.details?.location ? `, ${e.details.location}` : ''}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : failed.events ? <CardFailed what="events" onRetry={loadEvents} /> : (
              <p className="people-empty people-list">{events ? 'No events planned. A Fun Friday is a good start.' : 'Loading…'}</p>
            )}
          </Block>
        </aside>
      </div>
    </div>
    </IconContext.Provider>
  );
}
