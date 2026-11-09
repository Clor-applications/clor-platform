import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AirplaneTilt,
  ArrowUpRight,
  CalendarDots,
  CaretRight,
  Cake,
  ChatsCircle,
  HandWaving,
  ChartLineUp,
  CheckSquare,
  Confetti,
  MapPin,
  PushPin,
  IconContext,
  Medal,
  Megaphone,
  Hourglass,
  SealCheck,
  SignOut,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';

import { SkeletonCard } from '@ui/components/ui/Primitives';
import { getOverview, getPeopleHome, listEmployees, summaryOpened } from '@ui/personnel/api';
import { listLeaveRequests } from '@ui/timeOff/api';
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
/** A chart carries three colours at most; every other team is one grey "Other" (UI rules, 8 Nov 2026). */
const CHART_COLOURS = 3;
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

/*
 * A double-bezel surface (28 Oct 2026, soft structural Home): a tinted tray
 * with a hairline ring holds a white core with its own highlight, radii
 * concentric. `as="button"` makes the whole core the control.
 */
function Bezel({ as = 'div', className = '', i = 0, children, ...rest }) {
  const Core = as;
  return (
    <div className={`soft-bezel ${className}`.trim()} data-reveal style={{ '--i': i }}>
      <Core className={`soft-core${as === 'button' ? ' soft-core-action' : ''}`} {...(as === 'button' ? { type: 'button' } : {})} {...rest}>{children}</Core>
    </div>
  );
}

/* Headcount at the end of each year since the first person joined, and today. */
function growthOf(people) {
  const joins = people.map((p) => p.dateOfJoining).filter(Boolean).sort();
  if (!joins.length) return [];
  const first = Number(joins[0].slice(0, 4));
  const now = new Date();
  const at = (iso) => people.filter((p) => p.dateOfJoining && p.dateOfJoining <= iso && (!p.dateOfLeaving || p.dateOfLeaving > iso)).length;
  const out = [];
  for (let y = first; y < now.getFullYear(); y += 1) out.push({ label: String(y), count: at(`${y}-12-31`) });
  out.push({ label: 'Now', count: at(isoToday()) });
  return out;
}

/* Headcount over the years as an area: a quiet line, a fading fill, today marked. */
function GrowthChart({ points }) {
  if (points.length < 2) return null;
  const W = 600;
  const H = 160;
  const pad = 8;
  const max = Math.max(1, ...points.map((p) => p.count));
  const min = 0;
  const span = max - min;
  const x = (i) => pad + (i * (W - pad * 2)) / (points.length - 1);
  const y = (c) => pad + (H - pad * 2) * (1 - (c - min) / span) * 0.85 + (H - pad * 2) * 0.05;
  /* A gentle curve through the points: each segment bends at its midpoint. */
  const line = points.map((p, i) => {
    if (!i) return `M${x(0).toFixed(1)},${y(p.count).toFixed(1)}`;
    const mx = ((x(i - 1) + x(i)) / 2).toFixed(1);
    return `C${mx},${y(points[i - 1].count).toFixed(1)} ${mx},${y(p.count).toFixed(1)} ${x(i).toFixed(1)},${y(p.count).toFixed(1)}`;
  }).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const last = points[points.length - 1];
  return (
    <figure className="soft-chart" aria-label={`Headcount by year: ${points.map((p) => `${p.label} ${p.count}`).join(', ')}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="soft-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--brand))" stopOpacity="0.22" />
            <stop offset="100%" stopColor="rgb(var(--brand))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#soft-area)" />
        <path d={line} className="soft-chart-line" fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="soft-chart-dot" style={{ left: `${(x(points.length - 1) / W) * 100}%`, top: `${(y(last.count) / H) * 100}%` }} aria-hidden="true">
        <span className="soft-chart-tip">{last.count}</span>
      </span>
      <figcaption className="soft-chart-axis">
        {points.map((p, i) => <span key={i}>{p.label}</span>)}
      </figcaption>
    </figure>
  );
}

/* Company insights from the directory itself: who works here, where, for how long, hired when. */
function insightsOf(people) {
  const n = people.length || 1;
  const count = (fn) => people.reduce((m, p) => { const k = fn(p); if (k) m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());
  const gender = count((p) => ({ FEMALE: 'Women', MALE: 'Men', OTHER: 'Another identity' })[p.gender] || null);
  const places = [...count((p) => p.workLocation || null)].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const now = Date.now();
  const bands = [['Under 1 year', 0, 1], ['1 to 3 years', 1, 3], ['3 to 5 years', 3, 5], ['5 years or more', 5, 99]].map(([label, lo, hi]) => ({
    label,
    count: people.filter((p) => {
      if (!p.dateOfJoining) return false;
      const y = (now - new Date(p.dateOfJoining).getTime()) / (365.25 * 86_400_000);
      return y >= lo && y < hi;
    }).length,
  }));
  const thisYear = new Date().getFullYear();
  const hires = [4, 3, 2, 1, 0].map((k) => ({ label: String(thisYear - k), count: people.filter((p) => String(p.dateOfJoining || '').startsWith(String(thisYear - k))).length }));
  return { n, gender: [...gender].sort((a, b) => b[1] - a[1]), places, bands, hires };
}

const eventDay = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return { day: d.getDate(), month: d.toLocaleDateString('en-IN', { month: 'short' }), weekday: d.toLocaleDateString('en-IN', { weekday: 'long' }) };
};
const ago = (iso) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? `${days} days ago` : shortDate(iso);
};

/* A panel's head: a small tinted icon, the title, and one link on the right. */
function PanelHead({ id, icon: Icon, tint, title, action = null }) {
  return (
    <header className="people-panel-head">
      <h2 id={id} className="soft-panel-title"><span className="soft-panel-icon" data-tint={tint}><Icon size={16} weight="duotone" aria-hidden="true" /></span>{title}</h2>
      {action}
    </header>
  );
}

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
      <button type="button" className="soft-chip" onClick={onRetry}>Retry</button>
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

/* Sections rise into place as they first scroll into view; once shown they stay. */
function useReveal() {
  const root = useRef(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const items = [...el.querySelectorAll('[data-reveal]:not([data-shown])')];
    if (typeof IntersectionObserver === 'undefined') {
      items.forEach((n) => n.setAttribute('data-shown', ''));
      return undefined;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.setAttribute('data-shown', '');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach((n) => io.observe(n));
    return () => io.disconnect();
  });
  return root;
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
  return <div className="people-glance" data-reveal style={{ '--i': 2 }}>{blocks}</div>;
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

/* Average time at the company, in years, from joining dates. */
function averageTenure(people) {
  const now = Date.now();
  const spans = people.map((p) => (p.dateOfJoining ? (now - new Date(p.dateOfJoining).getTime()) / (365.25 * 86_400_000) : NaN)).filter((y) => y >= 0);
  return spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : null;
}

/**
 * People → Home (founder, 22 Oct 2026: simpler than the HR apps on the
 * market; 28 Oct: an owner's day at a glance). The four numbers an owner
 * asks first, then what waits for them with the answer one click away, then
 * who is away today and who to congratulate, then every team.
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
  const revealRoot = useReveal();
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
  /* The team bar and its keys: the three biggest teams, then the rest as one grey "Other". */
  const teamBar = useMemo(() => {
    const rest = depts.slice(CHART_COLOURS);
    const head = depts.slice(0, CHART_COLOURS).map((d, i) => ({ name: d.name, count: d.count, colour: i + 1 }));
    return rest.length ? [...head, { name: rest.length === 1 ? rest[0].name : 'Other', count: rest.reduce((n, d) => n + d.count, 0), colour: 0 }] : head;
  }, [depts]);
  const growth = useMemo(() => growthOf(people || []), [people]);
  const celebrations = useMemo(() => {
    const bdays = (data?.upcomingBirthdays || []).map((b) => ({ ...b, kind: 'birthday' }));
    /* Someone who asked not to be announced is left out (WORKFLOW-GAP-RESEARCH 4.8); the server already drops their birthday. */
    const quiet = new Set(data?.celebrationOptOuts || []);
    const annivs = anniversariesOf((people || []).filter((p) => !quiet.has(p.id))).map((a) => ({ ...a, kind: 'anniversary' }));
    return [...bdays, ...annivs].sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
  }, [data, people]);

  if (error) return <div className="ui-card p-4 text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</div>;
  if (!data) return <SkeletonCard lines={6} />;

  const today = isoToday();
  const pending = (leave || []).filter((r) => r.status === 'PENDING').sort((a, b) => a.fromDate.localeCompare(b.fromDate));
  /*
   * Everything waiting in the one Approvals inbox, as the inbox counts it (help desk included): the same number the
   * rail's Inbox badge and the Inbox's Waiting tab show (People plan, 8 Nov 2026). Leave stays the detail line.
   * Until it loads, leave alone; unknown (null) while it failed, never a confident nought.
   */
  const waiting = glance ? glance.waiting : todos ? 0 : failed.todos ? null : pending.length;
  const waitFailed = Boolean(failed.todos || failed.leave);
  /* The two lines that make up the waiting number: requests in the Inbox, and the tasks on my name (Inbox › My tasks). */
  const myTaskLine = (todos || []).find((t) => t.key === 'myTasks') || null;
  const requestsWaiting = Math.max(0, (waiting || 0) - (myTaskLine?.count || 0));
  const outToday = (leave || []).filter((r) => r.status === 'APPROVED' && r.fromDate <= today && r.toDate >= today);
  const onNotice = data.byStatus.ON_NOTICE || 0;
  const tenure = averageTenure(people || []);
  /* Leave already listed above with its own Approve: the summary row would say it twice. */
  /* What the Inbox holds is the one line above; the rest of Home's to-dos are tasks, listed here. */
  /* Probation has its own figure and its own list below, so it is not a third time a task row here. */
  const otherTodos = (todos || []).filter((t) => t.screen !== 'approvals' && t.screen !== 'leaveRequests' && t.key !== 'probation' && t.key !== 'myTasks');
  const deptOf = new Map((people || []).map((p) => [p.id, p.department]));
  const posts = (news || []).filter((n) => n.status === 'PUBLISHED').slice(0, 3);
  const upcoming = (events || [])
    .filter((e) => e.status === 'SCHEDULED' && (e.details?.endDate || e.details?.startDate || '') >= today)
    .sort((a, b) => String(a.details?.startDate).localeCompare(String(b.details?.startDate)))
    .slice(0, 4);
  const insight = insightsOf(people || []);
  /* Probation ending in 30 days or past and undecided: the to-do's count (in this reader's scope), the list for the dates. */
  const probationDue = Number((todos || []).find((t) => t.key === 'probation')?.count) || 0;
  const probationOver = (glance?.probation || []).filter((p) => p.over).length;
  const nextProbation = (glance?.probation || []).find((p) => !p.over) || null;

  return (
    <IconContext.Provider value={{ weight: 'duotone' }}>
    <div className="people-home people-soft" ref={revealRoot}>
      <header className="soft-band-top" data-reveal style={{ '--i': 0 }}>
        <div className="min-w-0">
          {/* Titled by the day, not a time-of-day greeting (8 Nov 2026). */}
          <h1 className="soft-band-title">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
          <p className="soft-band-sub">
            {waiting === null ? <>Could not check what waits for your answer</> : !todos && !leave ? <>Checking what waits for your answer</> : waiting ? <><strong>{plural(waiting, 'thing')}</strong> {waiting === 1 ? 'waits' : 'wait'} for your answer</> : <>Nothing waits for your answer</>}
            {leave ? <> and <strong data-zero={outToday.length === 0 || undefined}>{plural(outToday.length, 'person', 'people')}</strong> {outToday.length === 1 ? 'is' : 'are'} out today.</> : '.'}
          </p>
        </div>
        <div className="soft-actions">
          <button type="button" className="soft-pill" data-tint="mint" onClick={go('leaveRequests')}><CalendarDots size={18} aria-hidden="true" /> Leave requests</button>
          {may('PEOPLE::HR Cases::VIEW') ? <button type="button" className="soft-pill" data-tint="lilac" onClick={go('helpdesk')}><ChatsCircle size={18} aria-hidden="true" /> HR cases</button> : null}
          {may('PEOPLE::Announcements::CREATE') ? <button type="button" className="soft-pill" data-tint="lilac" onClick={go('announcements')}><Megaphone size={18} aria-hidden="true" /> Announce</button> : null}
          {may('PEOPLE::Employees::CREATE') ? (
            <button type="button" className="soft-pill soft-pill-primary" onClick={go('employeeNew')}>Add an employee</button>
          ) : null}
        </div>
      </header>
      <HomeCheckIn />
      {failed.finalPay ? <CardFailed what="the final pay that is due" onRetry={loadFinalPay} /> : null}
      {finalPay.length ? (
        <section aria-label="Final pay due" className="space-y-2" data-reveal style={{ '--i': 1 }}>
          {finalPay.length === 1 ? (
            <FinalPayBanner clock={finalPay[0]} name={finalPay[0].name} showRule={false} action={<button type="button" className="ui-link inline-flex min-h-11 items-center whitespace-nowrap sm:min-h-0" onClick={go('leavers', { open: finalPay[0].employeeId })}>Open plan</button>} />
          ) : <FinalPayList rows={finalPay} onOpen={(id) => go('leavers', { open: id })} onMore={go('leavers', { view: 'clearing' })} />}
          <p className="ui-caption">Code on Wages 2019 s.17(2): wages within two working days of the last day. Clearance does not hold them up.</p>
        </section>
      ) : null}
      <div className="soft-layout">
        <div className="soft-main">
          <div className="soft-band-stats" data-reveal style={{ '--i': 1 }}>
            <button type="button" className="soft-band-stat" data-tint="sky" onClick={go('employees')}>
              <span className="soft-band-stat-label"><UsersThree size={16} aria-hidden="true" /> Headcount</span>
              <span className="soft-band-stat-value" data-zero={Number(data.headcount) === 0 || undefined}>{data.headcount}</span>
              <span className="soft-band-stat-note">{data.joinedThisMonth.length ? `+${data.joinedThisMonth.length} in ${monthName()}` : `None joined in ${monthName()}`}</span>
            </button>
            <button type="button" className="soft-band-stat" data-tint="mint" onClick={go('leaveCalendar')}>
              <span className="soft-band-stat-label"><AirplaneTilt size={16} aria-hidden="true" /> Out today</span>
              <span className="soft-band-stat-row">
                <span className="soft-band-stat-value" data-zero={(leave && outToday.length === 0) || undefined}>{leave ? outToday.length : '–'}</span>
                {outToday.length ? (
                  <span className="soft-faces" aria-hidden="true">
                    {outToday.slice(0, 3).map((r) => <Face key={r.id} person={{ name: r.employeeName, photoUrl: r.photoUrl }} size={26} colour={colourOf(r.department)} />)}
                  </span>
                ) : null}
              </span>
              <span className="soft-band-stat-note">{leave ? `${data.headcount - outToday.length} of ${data.headcount} at work` : failed.leave ? 'Could not load leave' : 'Loading leave'}</span>
            </button>
            {/*
             * No approvals among Home's figures (owner, 8 Nov 2026): the Inbox owns them and Home says it once, in the
             * line under "Waiting for you". This figure is a decision that is Home's: probation to confirm, extend or end.
             */}
            <button type="button" className="soft-band-stat" data-tint="peach" data-attention={probationDue > 0 || undefined} onClick={go('employees', { prob: 'on' })}>
              <span className="soft-band-stat-label"><Hourglass size={16} aria-hidden="true" /> Probation due</span>
              <span className="soft-band-stat-value" data-zero={(todos && probationDue === 0) || undefined}>{todos ? probationDue : '–'}</span>
              <span className="soft-band-stat-note">{failed.todos ? 'Could not load' : !todos ? 'Checking' : probationOver ? `${plural(probationOver, 'person', 'people')} past their date` : nextProbation ? `Next ends ${shortDate(nextProbation.endsOn)}` : 'None in the next 30 days'}</span>
            </button>
            {/* The company keeps who is leaving from this reader (Company choices): no leaving figures. */}
            {data.leavingsHidden ? null : (
              <button type="button" className="soft-band-stat" data-tint="lilac" onClick={go('employees')}>
                <span className="soft-band-stat-label"><SignOut size={16} aria-hidden="true" /> On notice</span>
                <span className="soft-band-stat-value" data-zero={Number(onNotice) === 0 || undefined}>{onNotice}</span>
                <span className="soft-band-stat-note">{data.leftThisMonth ? `${plural(data.leftThisMonth, 'person', 'people')} left in ${monthName()}` : `Nobody left in ${monthName()}`}</span>
              </button>
            )}
          </div>

          <Bezel i={2}>
            <section aria-labelledby="todo-h">
              <PanelHead id="todo-h" icon={SealCheck} tint="butter" title="Waiting for you" />
              {/*
               * Approvals live in the Inbox, not on Home (owner, 8 Nov 2026): one line with the Inbox's own count, the
               * number the rail badge and the Inbox's Waiting tab show, and the way there.
               */}
              {/*
                * The card adds up to the subtitle's number, no more (People plan 8 Nov 2026, §3 rule 1): the requests in the
                * Inbox on one line, the tasks on my name on another, each opening the Inbox tab that holds them.
                */}
              {waiting ? (
                <ul className="people-list">
                  {requestsWaiting ? (
                    <li>
                      <button type="button" onClick={go('approvals')} className="people-row people-row-action">
                        <span className="people-row-count" data-tone="warn">{requestsWaiting}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-sm">{requestsWaiting === 1 ? '1 request waits' : `${requestsWaiting} requests wait`} for you</span>
                          <span className="ui-caption block">{pending.length ? `${plural(pending.length, 'leave request')} among them, next starts ${dayDate(pending[0].fromDate)}` : 'Leave, attendance and other requests'}</span>
                        </span>
                        <span className="people-more">Open Inbox <CaretRight size={14} aria-hidden="true" /></span>
                      </button>
                    </li>
                  ) : null}
                  {myTaskLine ? (
                    <li>
                      <button type="button" onClick={go('approvals', { tab: 'tasks' })} className="people-row people-row-action">
                        <span className="people-row-count" data-tone="warn">{myTaskLine.count}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-sm">{myTaskLine.count === 1 ? '1 task is' : `${myTaskLine.count} tasks are`} on your name</span>
                          <span className="ui-caption block">Joining, leaving and other plan steps given to you</span>
                        </span>
                        <span className="people-more">My tasks <CaretRight size={14} aria-hidden="true" /></span>
                      </button>
                    </li>
                  ) : null}
                </ul>
              ) : null}
              {waitFailed ? <CardFailed what={failed.todos ? 'what waits for you' : 'the leave waiting for you'} onRetry={retryWaiting} role="alert" /> : null}
              {failed.todos ? null : !todos ? (
                <div className="p-4"><SkeletonCard lines={2} /></div>
              ) : !waiting && !waitFailed ? (
                <p className="people-empty">{setupShowing ? 'Nothing waits for you yet. Start with the steps below.' : <><strong>All caught up</strong>. Nothing needs your answer right now.</>}</p>
              ) : null}
            </section>
          </Bezel>

          {/* HR's other to-dos: not answers anyone waits on, so not in the waiting number; each opens the screen that fixes it. */}
          {otherTodos.length ? (
          <Bezel i={3}>
            <section aria-labelledby="attention-h">
              <PanelHead id="attention-h" icon={CheckSquare} tint="sky" title="Needs attention" />
                <ul className="people-list">
                  {otherTodos.map((t) => (
                    <li key={t.key}>
                      <button type="button" onClick={go(t.screen, t.params)} className="people-row people-row-action">
                        <span className="people-row-count" data-tone={t.tone === 'info' ? undefined : 'warn'}>{t.count}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-sm">{t.title}</span>
                            <span className={`ui-pill ui-pill-${TONE[t.tone]?.pill || 'neutral'}`}>{TONE[t.tone]?.label}</span>
                          </span>
                          <span className="ui-caption block">{t.detail}</span>
                        </span>
                        <CaretRight size={16} className="ui-subtle shrink-0" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
            </section>
          </Bezel>
          ) : null}

          <HomeGlance glance={glance} go={go} />

          {/* The setup list sits under what waits on you, so a request is never below the fold behind it (2 Nov 2026). */}
          <HomeSetup openScreen={openScreen} onState={onSetup} />

          <Bezel i={4}>
            <section aria-labelledby="out-h">
              <PanelHead id="out-h" icon={AirplaneTilt} tint="mint" title="Out today" action={<button type="button" className="people-more" onClick={go('leaveCalendar')}>Leave calendar <CaretRight size={14} aria-hidden="true" /></button>} />
              {outToday.length ? (
                <ul className="soft-out">
                  {outToday.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="soft-out-card" onClick={openPerson(r.employeeId)}>
                        <Face person={{ name: r.employeeName, photoUrl: r.photoUrl }} size={34} colour={colourOf(r.department)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{r.employeeName}</span>
                          <span className="ui-caption block truncate">{r.leaveTypeName || 'Leave'}</span>
                          <span className="soft-back">Back {backOn(r.toDate)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : failed.leave ? <CardFailed what="who is out today" onRetry={loadLeave} /> : (
                <p className="people-empty">{leave ? 'Everyone is in today.' : 'Loading leave…'}</p>
              )}
            </section>
          </Bezel>

          <Bezel i={6}>
            <section aria-labelledby="snap-h">
              <PanelHead id="snap-h" icon={ChartLineUp} tint="sky" title="Company snapshot" action={<button type="button" className="people-more" onClick={go('reports')}>Reports <CaretRight size={14} aria-hidden="true" /></button>} />
              <div className="soft-snapshot">
                <div className="soft-snap-growth">
                  <div className="flex items-baseline gap-2">
                    <span className="soft-snap-value">{data.headcount}</span>
                    {people ? <span className="soft-note">people, grown from {growth[0]?.count ?? 0} in {growth[0]?.label || 'the start'}</span> : <span className="soft-note">people</span>}
                  </div>
                  {failed.people ? <CardFailed what="the company figures" onRetry={loadPeople} /> : <GrowthChart points={growth} />}
                  <div className="soft-team-bar" role="img" aria-label={depts.map((d) => `${d.name} ${d.count}`).join(', ')}>
                    {teamBar.map((d) => <span key={d.name} title={`${d.name}: ${d.count}`} style={{ flexGrow: d.count, '--dept': `var(--dept-${d.colour})` }} />)}
                  </div>
                  <ul className="soft-team-keys">
                    {teamBar.map((d) => (
                      <li key={d.name} style={{ '--dept': `var(--dept-${d.colour})` }}><span className="people-dot" aria-hidden="true" />{d.name} <b>{d.count}</b></li>
                    ))}
                  </ul>
                </div>
                {failed.people ? null : (
                <div className="soft-snap-side">
                  <div className="soft-insight">
                    <span className="soft-label">Gender mix</span>
                    <div className="soft-split" role="img" aria-label={insight.gender.map(([k, v]) => `${k} ${v}`).join(', ') || 'Gender mix: none recorded yet'}>
                      {insight.gender.map(([k, v], i) => <span key={k} style={{ flexGrow: v, '--dept': `var(--dept-${[1, 2, 3][i] ?? 0})` }} />)}
                    </div>
                    <ul className="soft-insight-list soft-insight-inline">
                      {insight.gender.map(([k, v], i) => (
                        <li key={k} style={{ '--dept': `var(--dept-${[1, 2, 3][i] ?? 0})` }}><span className="people-dot" aria-hidden="true" />{k}<b>{Math.round((v / insight.n) * 100)}%</b></li>
                      ))}
                    </ul>
                  </div>
                  <div className="soft-insight">
                    <span className="soft-label">Time at the company <span className="ui-caption">· avg {tenure !== null ? `${tenure.toFixed(1)} yrs` : '–'}</span></span>
                    <ul className="soft-bars" data-tint="mint">
                      {insight.bands.map((b) => (
                        <li key={b.label}><span className="truncate">{b.label}</span><span className="soft-bar"><span style={{ width: `${(b.count / insight.n) * 100}%` }} /></span><b>{b.count}</b></li>
                      ))}
                    </ul>
                  </div>
                  <div className="soft-insight">
                    <span className="soft-label">Where people work</span>
                    <ul className="soft-bars" data-tint="lilac">
                      {insight.places.map(([k, v]) => (
                        <li key={k}><span className="flex items-center gap-1.5 truncate"><MapPin size={14} aria-hidden="true" />{k}</span><span className="soft-bar"><span style={{ width: `${(v / insight.n) * 100}%` }} /></span><b>{v}</b></li>
                      ))}
                    </ul>
                  </div>
                </div>
                )}
              </div>
            </section>
          </Bezel>
        </div>

        <aside className="soft-side" aria-label="Company news">
          <Bezel i={2}>
            <section aria-labelledby="news-h">
              <PanelHead id="news-h" icon={Megaphone} tint="lilac" title="Announcements" action={may('PEOPLE::Announcements::CREATE') ? <button type="button" className="people-more" onClick={go('announcements')}>Post one <CaretRight size={14} aria-hidden="true" /></button> : null} />
              {posts.length ? (
                <ul className="people-list">
                  {posts.map((n, i) => (
                    <li key={n.id}>
                      <button type="button" className="soft-news" onClick={go('announcements')}>
                        <span className="soft-news-icon" data-tint={newsTint(n)} data-symbol={symbolOf(n.details?.symbol) ? '' : undefined}>
                          {symbolOf(n.details?.symbol) ? <span aria-hidden="true">{symbolOf(n.details.symbol).emoji}</span> : i === 0 ? <PushPin size={16} aria-hidden="true" /> : <Megaphone size={16} aria-hidden="true" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="soft-news-title">{n.title}</span>
                          <span className="soft-news-body">{n.details?.body}</span>
                          <span className="soft-news-meta">{ago(n.updatedAt)}{n.details?.audienceKind && n.details.audienceKind !== 'ALL' ? ` · For ${n.details.audience}` : n.details?.audience ? ` · For ${n.details.audience.toLowerCase()}` : ''}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : failed.news ? <CardFailed what="announcements" onRetry={loadNews} /> : (
                <p className="people-empty">{news ? 'Nothing posted yet. Share news, a policy change or a welcome.' : 'Loading…'}</p>
              )}
            </section>
          </Bezel>

          <Bezel i={3}>
            <section aria-labelledby="events-h">
              <PanelHead id="events-h" icon={Confetti} tint="lilac" title="Coming up" action={may('PEOPLE::Events::VIEW') ? <button type="button" className="people-more" onClick={go('events')}>All events <CaretRight size={14} aria-hidden="true" /></button> : null} />
              {upcoming.length ? (
                <ul className="soft-events">
                  {upcoming.map((e) => {
                    const d = eventDay(e.details.startDate);
                    const fun = /fun friday/i.test(e.title);
                    return (
                      <li key={e.id}>
                        <button type="button" className="soft-event" data-fun={fun ? '' : undefined} data-tint={eventTint(e)} onClick={go('events')}>
                          <span className="soft-event-date"><b>{d.day}</b><span>{d.month}</span></span>
                          <span className="min-w-0 flex-1">
                            {fun ? <span className="soft-fun"><Confetti size={12} weight="fill" aria-hidden="true" /> Fun Friday</span> : null}
                            <span className="soft-event-title">{symbolOf(e.details?.symbol) ? <span className="soft-emoji" aria-hidden="true">{symbolOf(e.details.symbol).emoji}</span> : null}{fun ? e.title.replace(/^fun friday:\s*/i, '') : e.title}</span>
                            <span className="soft-event-meta">{d.weekday}{e.details?.location ? `, ${e.details.location}` : ''}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : failed.events ? <CardFailed what="events" onRetry={loadEvents} /> : (
                <p className="people-empty">{events ? 'No events planned. A Fun Friday is a good start.' : 'Loading…'}</p>
              )}
            </section>
          </Bezel>
          <Bezel i={5}>
            <section aria-labelledby="celebrate-h">
              <PanelHead id="celebrate-h" icon={Cake} tint="peach" title="Celebrate" action={<span className="ui-caption">Next 30 days</span>} />
              {celebrations.length || data.joinedThisMonth.length ? (
                <ul className="people-list">
                  {data.joinedThisMonth.slice(0, 1).map((j) => (
                    <li key={`new-${j.id}`}>
                      <button type="button" className="people-row people-row-action" onClick={go('employees')}>
                        <span className="soft-faces" aria-hidden="true">
                          {data.joinedThisMonth.slice(0, 3).map((x) => <Face key={x.id} person={x} size={30} colour={colourOf(deptOf.get(x.id))} />)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{plural(data.joinedThisMonth.length, 'new joiner')}</span>
                          <span className="ui-caption block truncate">{data.joinedThisMonth.map((x) => x.name.split(' ')[0]).join(', ')}</span>
                        </span>
                        <span className="ui-pill people-pill-today"><HandWaving size={12} aria-hidden="true" /> Welcome</span>
                      </button>
                    </li>
                  ))}
                  {celebrations.slice(0, 3).map((c) => (
                    <li key={`${c.kind}-${c.id}`}>
                      <button type="button" className="people-row people-row-action" onClick={openPerson(c.id)}>
                        <span className="people-celebrate-face">
                          <Face person={c} size={30} colour={colourOf(deptOf.get(c.id))} />
                          <span className="people-celebrate-badge" data-kind={c.kind}>{c.kind === 'birthday' ? <Cake size={10} weight="fill" aria-hidden="true" /> : <Medal size={10} weight="fill" aria-hidden="true" />}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{c.name}</span>
                          <span className="ui-caption block truncate">{c.kind === 'birthday' ? 'Birthday' : `${plural(c.years, 'year')} at the company`}</span>
                        </span>
                        {c.days <= 1 ? <span className="ui-pill people-pill-today">{whenLabel(c.days, c.date)}</span> : <span className="ui-caption tabular-nums">{whenLabel(c.days, c.date)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : failed.people ? null : (
                <p className="people-empty">Nothing to celebrate in the next 30 days.</p>
              )}
              {/* Work anniversaries come from the directory: when it failed, say so rather than leave them out. */}
              {failed.people ? <CardFailed what="work anniversaries" onRetry={loadPeople} /> : null}
            </section>
          </Bezel>
        </aside>
      </div>
    </div>
    </IconContext.Provider>
  );
}
