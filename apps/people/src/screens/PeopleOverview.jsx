import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AirplaneTilt,
  ArrowUpRight,
  CalendarDots,
  CaretRight,
  Cake,
  ChatsCircle,
  Check,
  HandWaving,
  ChartLineUp,
  CheckSquare,
  Confetti,
  MapPin,
  PushPin,
  IconContext,
  Medal,
  Megaphone,
  SealCheck,
  SignOut,
  UsersThree,
} from '@phosphor-icons/react';

import { SkeletonCard } from '@ui/components/ui/Primitives';
import { getOverview, getPeopleHome, listEmployees, listMyTasks, summaryOpened, updateChecklistTask } from '@ui/personnel/api';
import { approveLeave, listLeaveRequests } from '@ui/timeOff/api';
import { listRecords } from '../api/workspace';
import { symbolOf } from './symbols';
import { notify } from '@ui/components/ui/notify';
import { formatDateIn } from '@ui/utils/dates';
import { platformContext } from '@platform/context';
import { HomeCheckIn } from '@ui/timeOff/MyDays';
import { FinalPayBanner, FinalPayList } from '@ui/lifecycle/LeavingExtras';
import { finalPayList } from '../api/engagement';
import HomeSetup from './HomeSetup';

const TONE = { urgent: { label: 'Now', pill: 'neg' }, soon: { label: 'This week', pill: 'neutral' }, info: { label: 'When you can', pill: 'neutral' } };
const DEPT_COLOURS = 8;
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const shortDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const dayDate = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const monthName = () => new Date().toLocaleDateString('en-IN', { month: 'long' });
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
const whenLabel = (days, date) => (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : shortDate(date));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const range = (from, to) => (from === to ? dayDate(from) : `${shortDate(from)} to ${shortDate(to)}`);
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
  const [todos, setTodos] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [people, setPeople] = useState(null);
  const [leave, setLeave] = useState(null);
  const [news, setNews] = useState(null);
  const [events, setEvents] = useState(null);
  /* Final pay due for leavers whose last day has come (WORKFLOW-GAP-RESEARCH 4.3). */
  const [finalPay, setFinalPay] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const revealRoot = useReveal();
  /* The setup list replaces "All caught up" while it is showing (HomeSetup). */
  const [setupShowing, setSetupShowing] = useState(false);
  const onSetup = useCallback((d) => setSetupShowing(Boolean(d?.setup?.show)), []);
  const loadTasks = () => listMyTasks().then(setTasks).catch(() => setTasks([]));
  const tick = async (t) => {
    try {
      await updateChecklistTask(t.id, { done: true });
      setTasks((list) => (list || []).filter((x) => x.id !== t.id));
      notify.success(`${t.title}: done.`);
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };
  const approve = async (r) => {
    setBusy(r.id);
    try {
      await approveLeave(r.id, null);
      setLeave((list) => (list || []).map((x) => (x.id === r.id ? { ...x, status: 'APPROVED' } : x)));
      notify.success(`${r.employeeName}'s ${String(r.leaveTypeName || 'leave').toLowerCase()} approved.`);
    } catch (e) {
      notify.error(String(e?.message || 'Not approved.'));
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    getOverview()
      .then(setData)
      .catch((e) => setError(String(e?.message || 'Could not load the overview.')));
    getPeopleHome()
      .then(setTodos)
      .catch(() => setTodos([]));
    listEmployees({ limit: 500 })
      .then((r) => setPeople((r?.employees || []).filter((p) => p.status !== 'LEFT')))
      .catch(() => setPeople([]));
    listLeaveRequests()
      .then(setLeave)
      .catch(() => setLeave([]));
    /* Engage may be switched off for the company: then both lists are simply empty. */
    listRecords('announcements').then(setNews).catch(() => setNews([]));
    listRecords('events').then(setEvents).catch(() => setEvents([]));
    finalPayList().then(setFinalPay).catch(() => setFinalPay([]));
    loadTasks();
    /* Opened from the Monday summary's e-mail: counted once (PRODUCT-VIEW §7). */
    try {
      if (new URLSearchParams(window.location.search).get('from') === 'weekly') summaryOpened().catch(() => {});
    } catch { /* no address to read */ }
  }, []);
  const go = (screen, params) => () => openScreen?.(screen, params);
  const openPerson = (id) => () => openScreen?.('employee', { id });

  const depts = useMemo(() => [...(data?.byDepartment || [])].sort((a, b) => b.count - a.count), [data]);
  const colourOf = useMemo(() => {
    const m = new Map(depts.map((d, i) => [d.name, (i % DEPT_COLOURS) + 1]));
    return (name) => m.get(name) || 0;
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

  const rawFirst = String(platformContext().user?.fullName || '').trim().split(/\s+/)[0];
  const firstName = rawFirst ? rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1) : '';
  const today = isoToday();
  const pending = (leave || []).filter((r) => r.status === 'PENDING').sort((a, b) => a.fromDate.localeCompare(b.fromDate));
  /* Everything waiting in the one Approvals inbox (leave, attendance requests, field punches, overtime, People approvals):
     Home's to-dos that open it carry its counts. Leave stays the detail line. Until they load, leave alone. */
  const inboxTodos = (todos || []).filter((t) => t.screen === 'approvals');
  const waiting = todos ? inboxTodos.reduce((n, t) => n + (Number(t.count) || 0), 0) : pending.length;
  const outToday = (leave || []).filter((r) => r.status === 'APPROVED' && r.fromDate <= today && r.toDate >= today);
  const onNotice = data.byStatus.ON_NOTICE || 0;
  const tenure = averageTenure(people || []);
  const openTasks = (tasks || []).filter((t) => !t.done);
  /* Leave already listed above with its own Approve: the summary row would say it twice. */
  const otherTodos = (todos || []).filter((t) => !(pending.length && t.screen === 'leaveRequests'));
  const deptOf = new Map((people || []).map((p) => [p.id, p.department]));
  const posts = (news || []).filter((n) => n.status === 'PUBLISHED').slice(0, 3);
  const upcoming = (events || [])
    .filter((e) => e.status === 'SCHEDULED' && (e.details?.endDate || e.details?.startDate || '') >= today)
    .sort((a, b) => String(a.details?.startDate).localeCompare(String(b.details?.startDate)))
    .slice(0, 4);
  const insight = insightsOf(people || []);

  return (
    <IconContext.Provider value={{ weight: 'duotone' }}>
    <div className="people-home people-soft" ref={revealRoot}>
      <header className="soft-band-top" data-reveal style={{ '--i': 0 }}>
        <div className="min-w-0">
          <span className="soft-band-eyebrow">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h1 className="soft-band-title">{firstName ? `${greeting()}, ${firstName}` : greeting()}</h1>
          <p className="soft-band-sub">
            {waiting ? <>You have <strong>{plural(waiting, 'request')}</strong> to answer</> : <>Nothing waits for your answer</>}
            {leave ? <> and <strong>{plural(outToday.length, 'person', 'people')}</strong> {outToday.length === 1 ? 'is' : 'are'} out today.</> : '.'}
          </p>
        </div>
        <div className="soft-actions">
          <button type="button" className="soft-pill" data-tint="peach" onClick={go('leaveRequests')}><CalendarDots size={18} aria-hidden="true" /> Leave requests</button>
          <button type="button" className="soft-pill" data-tint="lilac" onClick={go('helpdesk')}><ChatsCircle size={18} aria-hidden="true" /> HR cases</button>
          <button type="button" className="soft-pill" data-tint="butter" onClick={go('announcements')}><Megaphone size={18} aria-hidden="true" /> Announce</button>
          <button type="button" className="soft-pill soft-pill-primary" onClick={go('employeeNew')}>
            Add an employee
            <span className="soft-pill-orb"><ArrowUpRight size={16} weight="bold" aria-hidden="true" /></span>
          </button>
        </div>
      </header>
      <HomeCheckIn />
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
              <span className="soft-band-stat-value">{data.headcount}</span>
              <span className="soft-band-stat-note">{data.joinedThisMonth.length ? `+${data.joinedThisMonth.length} in ${monthName()}` : `None joined in ${monthName()}`}</span>
            </button>
            <button type="button" className="soft-band-stat" data-tint="mint" onClick={go('leaveCalendar')}>
              <span className="soft-band-stat-label"><AirplaneTilt size={16} aria-hidden="true" /> Out today</span>
              <span className="soft-band-stat-row">
                <span className="soft-band-stat-value">{leave ? outToday.length : '–'}</span>
                {outToday.length ? (
                  <span className="soft-faces" aria-hidden="true">
                    {outToday.slice(0, 3).map((r) => <Face key={r.id} person={{ name: r.employeeName, photoUrl: r.photoUrl }} size={26} colour={colourOf(r.department)} />)}
                  </span>
                ) : null}
              </span>
              <span className="soft-band-stat-note">{leave ? `${data.headcount - outToday.length} of ${data.headcount} at work` : 'Loading leave'}</span>
            </button>
            <button type="button" className="soft-band-stat" data-tint="peach" data-attention={waiting > 0 || undefined} onClick={go('approvals')}>
              <span className="soft-band-stat-label"><SealCheck size={16} aria-hidden="true" /> To approve</span>
              <span className="soft-band-stat-value">{todos || leave ? waiting : '–'}</span>
              <span className="soft-band-stat-note">{pending.length ? `${plural(pending.length, 'leave request')}, next starts ${dayDate(pending[0].fromDate)}` : waiting ? 'No leave among them' : 'Nothing to approve'}</span>
            </button>
            {/* The company keeps who is leaving from this reader (Company choices): no leaving figures. */}
            {data.leavingsHidden ? null : (
              <button type="button" className="soft-band-stat" data-tint="lilac" onClick={go('employees')}>
                <span className="soft-band-stat-label"><SignOut size={16} aria-hidden="true" /> On notice</span>
                <span className="soft-band-stat-value">{onNotice}</span>
                <span className="soft-band-stat-note">{data.leftThisMonth ? `${plural(data.leftThisMonth, 'person', 'people')} left in ${monthName()}` : `Nobody left in ${monthName()}`}</span>
              </button>
            )}
          </div>

          <Bezel i={2}>
            <section aria-labelledby="todo-h">
              <PanelHead id="todo-h" icon={SealCheck} tint="peach" title="Waiting for you" action={pending.length ? <button type="button" className="people-more" onClick={go('leaveRequests')}>All requests <CaretRight size={14} aria-hidden="true" /></button> : null} />
              {pending.length ? (
                <ul className="people-list">
                  {pending.slice(0, 4).map((r) => (
                    <li key={r.id} className="people-approval">
                      <Face person={{ name: r.employeeName, photoUrl: r.photoUrl }} size={34} colour={colourOf(r.department)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm"><button type="button" className="people-name-link" onClick={openPerson(r.employeeId)}>{r.employeeName}</button> <span className="ui-muted">asks for {String(r.leaveTypeName || 'leave').toLowerCase()}</span></p>
                        <p className="ui-caption truncate">{range(r.fromDate, r.toDate)}, {plural(r.days, 'day')}. {r.reason}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button type="button" className="soft-chip" onClick={go('leaveRequests')}>Review</button>
                        <button type="button" className="soft-chip soft-chip-pos" disabled={busy === r.id} onClick={() => approve(r)}>
                          <Check size={14} weight="bold" aria-hidden="true" /> {busy === r.id ? 'Approving' : 'Approve'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {!todos ? (
                <div className="p-4"><SkeletonCard lines={2} /></div>
              ) : otherTodos.length ? (
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
              ) : !pending.length ? (
                <p className="people-empty">{setupShowing ? 'Nothing waits for you yet. Start with the steps below.' : <><strong>All caught up</strong>. Nothing needs your answer right now.</>}</p>
              ) : null}
            </section>
          </Bezel>

          {/* The setup list sits under what waits on you, so a request is never below the fold behind it (2 Nov 2026). */}
          <HomeSetup openScreen={openScreen} onState={onSetup} />

          {openTasks.length ? (
            <Bezel i={3}>
              <section aria-labelledby="mytasks-h">
                <PanelHead id="mytasks-h" icon={CheckSquare} tint="sky" title="Your tasks" />
                <ul className="people-list">
                  {openTasks.slice(0, 6).map((t) => (
                    <li key={t.id} className="people-row">
                      <input type="checkbox" className="mt-0.5" aria-label={`Done: ${t.title}`} onChange={() => tick(t)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{t.title} <span className="ui-muted">· {t.employee?.name}</span></p>
                        <p className="ui-caption">{t.kind.charAt(0)}{t.kind.slice(1).toLowerCase()}{t.dueDate ? ` · due ${formatDateIn(t.dueDate)}` : ''}{t.overdue ? <span className="ui-pill ui-pill-neg ml-2">Overdue</span> : null}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </Bezel>
          ) : null}

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
              ) : (
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
                    <span className="soft-note">people, grown from {growth[0]?.count ?? 0} in {growth[0]?.label || 'the start'}</span>
                  </div>
                  <GrowthChart points={growth} />
                  <div className="soft-team-bar" role="img" aria-label={depts.map((d) => `${d.name} ${d.count}`).join(', ')}>
                    {depts.map((d) => <span key={d.name} title={`${d.name}: ${d.count}`} style={{ flexGrow: d.count, '--dept': `var(--dept-${colourOf(d.name)})` }} />)}
                  </div>
                  <ul className="soft-team-keys">
                    {depts.slice(0, 6).map((d) => (
                      <li key={d.name} style={{ '--dept': `var(--dept-${colourOf(d.name)})` }}><span className="people-dot" aria-hidden="true" />{d.name} <b>{d.count}</b></li>
                    ))}
                    {depts.length > 6 ? <li className="ui-caption">+{depts.length - 6} more</li> : null}
                  </ul>
                </div>
                <div className="soft-snap-side">
                  <div className="soft-insight">
                    <span className="soft-label">Gender mix</span>
                    <div className="soft-split" role="img" aria-label={insight.gender.map(([k, v]) => `${k} ${v}`).join(', ') || 'Gender mix: none recorded yet'}>
                      {insight.gender.map(([k, v], i) => <span key={k} style={{ flexGrow: v, '--dept': `var(--dept-${[1, 2, 3][i] ?? 8})` }} />)}
                    </div>
                    <ul className="soft-insight-list soft-insight-inline">
                      {insight.gender.map(([k, v], i) => (
                        <li key={k} style={{ '--dept': `var(--dept-${[1, 2, 3][i] ?? 8})` }}><span className="people-dot" aria-hidden="true" />{k}<b>{Math.round((v / insight.n) * 100)}%</b></li>
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
              </div>
            </section>
          </Bezel>
        </div>

        <aside className="soft-side" aria-label="Company news">
          <Bezel i={2}>
            <section aria-labelledby="news-h">
              <PanelHead id="news-h" icon={Megaphone} tint="butter" title="Announcements" action={<button type="button" className="people-more" onClick={go('announcements')}>Post one <CaretRight size={14} aria-hidden="true" /></button>} />
              {posts.length ? (
                <ul className="people-list">
                  {posts.map((n, i) => (
                    <li key={n.id}>
                      <button type="button" className="soft-news" onClick={go('announcements')}>
                        <span className="soft-news-icon" data-tint={['butter', 'mint', 'lilac'][i % 3]} data-symbol={symbolOf(n.details?.symbol) ? '' : undefined}>
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
              ) : (
                <p className="people-empty">{news ? 'Nothing posted yet. Share news, a policy change or a welcome.' : 'Loading…'}</p>
              )}
            </section>
          </Bezel>

          <Bezel i={3}>
            <section aria-labelledby="events-h">
              <PanelHead id="events-h" icon={Confetti} tint="lilac" title="Coming up" action={<button type="button" className="people-more" onClick={go('events')}>All events <CaretRight size={14} aria-hidden="true" /></button>} />
              {upcoming.length ? (
                <ul className="soft-events">
                  {upcoming.map((e, j) => {
                    const d = eventDay(e.details.startDate);
                    const fun = /fun friday/i.test(e.title);
                    return (
                      <li key={e.id}>
                        <button type="button" className="soft-event" data-fun={fun ? '' : undefined} data-tint={fun ? 'butter' : ['sky', 'mint', 'lilac', 'peach'][j % 4]} onClick={go('events')}>
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
              ) : (
                <p className="people-empty">{events ? 'No events planned. A Fun Friday is a good start.' : 'Loading…'}</p>
              )}
            </section>
          </Bezel>
          <Bezel i={5}>
            <section aria-labelledby="celebrate-h">
              <PanelHead id="celebrate-h" icon={Cake} tint="butter" title="Celebrate" action={<span className="ui-caption">Next 30 days</span>} />
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
              ) : (
                <p className="people-empty">Nothing to celebrate in the next 30 days.</p>
              )}
            </section>
          </Bezel>
        </aside>
      </div>
    </div>
    </IconContext.Provider>
  );
}
