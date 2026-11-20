import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from '@ui/components/ui/lineIcons';

import { accountAudit, getAccountMe, listAccountMembers, listInvitations, listTickets, memberDirectory } from '@platform/admin/account';
import { getAccountOverview } from '@platform/admin/admin';
import { operator } from '@platform/operator';
import { actionText } from './AccountActivity';
import { planSentence, planWord } from './planWords';
import { listOutsideAccess } from '@platform/admin/outsideAccess';
import { AppMark, Avatar, ICON, Meter, ago, appName, productIcon, seatState } from './wsKit';
import { rupees, seatsByApp, securityOf } from './overviewFigures';
import { orgId, requestOpenHelp } from '@platform/context';
import { apiFetch } from '@platform/http';
import { getPolicy } from '@platform/admin/security';
import { setupSteps } from './SetupGuide';
import { CallMe } from './CallMe';
import './workspace.css';
import './ws-home.css';
import './ws-overview.css';
import './ws-glance.css';

/**
 * Workspace → Overview (redesign W-R4; Workspace plan 11 Nov 2026, P0).
 *
 * Answers five questions in this order: which companies do I run, who has
 * access, which apps are on, what needs me, and what is my subscription
 * doing. It is not another HR or Books screen: it shows summaries the reader
 * may see and links to the screen that owns each one.
 *
 * The starting point, not a menu: what this account runs, what needs doing,
 * what happened. The administration links moved to the sidebar where they
 * belong; this page shows information and a few contextual actions.
 *
 * Everything comes from the server and nothing is invented: the person's
 * account role and their own app access (/account/me); for owners and
 * administrators the account's companies, plan and usage (/account/overview),
 * members and pending invitations, and the account's activity. A member sees
 * their apps and help; numbers they may not read are not drawn at all.
 */

/* The account-level role, said as such: an account owner is not a company admin or an app role. */
const ROLE_LABEL = { OWNER: 'Owner', ADMIN: 'Administrator', BILLING_ADMIN: 'Billing admin', MEMBER: 'Member' };
/* One line under the greeting, by account role. Presentation only: what each can do is the server's. */
const ROLE_LEDE = {
  OWNER: 'Your companies, their apps and people, and what waits on you.',
  ADMIN: 'The companies, apps and people you look after.',
};
const DEFAULT_LEDE = 'The apps you use and what waits on you.';

/** What an app is to this company and this person right now (spec §18): never one universal "switched on". */
export function appState(app, tenant, myApps = null) {
  if (!app.available) return { key: 'soon', label: 'Coming soon', pill: 'ws-pill' };
  if ((tenant?.subscriptions || []).includes(app.id)) {
    /* Switched on for the company is not the same as open to this person: that takes a role. */
    if (Array.isArray(myApps) && !myApps.includes(app.id)) return { key: 'noaccess', label: 'Access not assigned', pill: 'ws-pill' };
    return { key: 'open', label: 'Active', pill: 'ws-pill ws-pill--ok' };
  }
  /* Unrestricted billing (no plan assigned) owns everything sellable; a plan names what it includes. */
  const onPlan = !tenant?.billing?.restricted || (tenant.billing.ownedApps || []).includes(app.id);
  return onPlan ? { key: 'off', label: 'Not switched on', pill: 'ws-pill ws-pill--off' } : { key: 'plan', label: 'Not in plan', pill: 'ws-pill' };
}

/** A count in the figure face (DESIGN.md: numbers are JetBrains Mono, tabular); words beside it stay in the text face. */
const N = ({ children }) => <span className="ui-num">{children}</span>;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const APP_NAME = { accounting: 'Books', payroll: 'Payroll', people: 'People', attendance: 'Attendance', projects: 'Projects' };

/* The address an app opens on (shell/appHosts.js: the accounting app lives at books). */
const HOST_LABEL = { accounting: 'books' };
export const hostLabel = (id) => `${HOST_LABEL[id] || id}.clor.in`;

const firstName = (user) => String(user?.firstName || user?.fullName || '').trim().split(/\s+/)[0] || '';

/* Where each app says how today stands (its own overview endpoint). */
const TODAY_SOURCES = [
  { app: 'attendance', path: 'attendance/overview' },
  { app: 'people', path: 'people/overview' },
  { app: 'payroll', path: 'payroll/overview' },
];
/* Whole rupees in the Indian grouping; payroll totals arrive in rupees. */
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/** Today's lines, one per app that answered: a figure, what it counts, and one line of detail. Pure, for the tests. */
export function todayLines(today = {}) {
  const lines = [];
  const att = today.attendance;
  if (att && att.headcount != null) {
    const out = [att.onLeave ? `${att.onLeave} on leave` : null, att.absent ? `${att.absent} absent` : null, att.notMarked ? `${att.notMarked} not marked` : null].filter(Boolean);
    lines.push({
      app: 'attendance',
      screen: 'overview',
      value: att.holiday ? 'Holiday' : `${(att.present || 0) + (att.halfDay || 0)}`,
      note: att.holiday ? null : `of ${att.headcount}`,
      label: att.holiday ? att.holiday : 'In today',
      sub: att.holiday ? null : out.length ? out.join(' · ') : att.headcount ? 'Everyone is accounted for' : 'No one is tracked yet',
    });
  }
  const ppl = today.people;
  if (ppl && ppl.headcount != null) {
    const joined = (ppl.joinedThisMonth || []).length;
    const bday = (ppl.upcomingBirthdays || [])[0];
    lines.push({
      app: 'people',
      screen: 'home',
      value: `${ppl.headcount}`,
      label: ppl.headcount === 1 ? 'Person' : 'People',
      sub: [joined ? `${joined} joined this month` : null, bday ? `${bday.name}’s birthday ${bday.days === 0 ? 'today' : bday.days === 1 ? 'tomorrow' : `in ${bday.days} days`}` : null].filter(Boolean).join(' · ') || 'No one joined this month',
    });
  }
  const pay = today.payroll?.overview;
  if (pay) {
    const run = pay.currentRun;
    lines.push({
      app: 'payroll',
      screen: 'overview',
      value: run ? inr(run.net) : '—',
      label: pay.currentPeriod ? `${pay.currentPeriod.name} payroll` : 'Payroll',
      sub: run ? `${run.stage} · ${run.employeeCount} ${run.employeeCount === 1 ? 'person' : 'people'}` : pay.currentPeriod ? 'Pay run not started' : 'No open pay period',
    });
  }
  return lines;
}

/**
 * What waits on this reader in every app of this company (Workspace plan P1):
 * People and Attendance, Books approvals, Payroll approvals. Counts and the
 * screen that owns each; the app decides, Workspace points.
 */
const getWaiting = () => apiFetch(`/orgs/${encodeURIComponent(orgId())}/workspace/waiting`, { skipWarehouseHeader: true });

const dateWords = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const DAY = 86400000;
const WEEK = 7 * DAY;
const inDays = (n) => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

/** What the subscription itself needs said (server: subscriptionWatch). Lapsed is the plan line's, said once. */
export function renewalNotice(renewal, planBad = false) {
  if (!renewal) return null;
  if (renewal.warn === 'trial-ending') return { tone: 'warn', title: `Your trial ends ${inDays(renewal.daysLeft)}`, sub: `On ${dateWords(renewal.endsAt)}. Choose a plan to keep your apps open.` };
  if (renewal.warn === 'ending') return { tone: 'warn', title: `Your plan stops ${inDays(renewal.daysLeft)}`, sub: `It is set to end on ${dateWords(renewal.endsAt)} and not renew.` };
  if (renewal.warn === 'lapsed' && !planBad) return { tone: 'danger', title: 'Your plan has lapsed', sub: 'Your data is safe; renew to keep working in your apps.' };
  return null;
}

export default function AdminHome({ user, tenant, catalog = [], navItems = [], openScreen, openApp, accountName = '' }) {
  const [me, setMe] = useState(undefined);
  const [overview, setOverview] = useState(null);
  const [members, setMembers] = useState(null);
  const [pending, setPending] = useState(null);
  const [directory, setDirectory] = useState(null);
  const [activity, setActivity] = useState(null);
  const [waiting, setWaiting] = useState(null);
  const [tickets, setTickets] = useState(null);
  const [outside, setOutside] = useState(null);
  const [invites, setInvites] = useState(null);
  const [setupFacts, setSetupFacts] = useState(null);
  const [today, setToday] = useState({});
  const attentionRef = useRef(null);
  /* At a glance folds away, as the reader left it; Top actions can show one subject at a time. */
  const [folded, setFolded] = useState(false);
  const [area, setArea] = useState(null);
  /* Which apps are on here, as one string: the effect below reads it and must not re-run on a new array of the same apps. */
  const subsKey = (tenant?.subscriptions || []).join(',');

  useEffect(() => {
    let live = true;
    getAccountMe()
      .then((r) => {
        if (!live) return;
        setMe(r || null);
        const role = r?.role;
        if (role === 'OWNER' || role === 'ADMIN' || role === 'BILLING_ADMIN') getAccountOverview().then((o) => live && setOverview(o || false)).catch(() => live && setOverview(false)); /* false: read and failed, so nothing waits on it */
        if (role === 'OWNER' || role === 'ADMIN') {
          listAccountMembers().then((m) => live && setMembers(m?.members || [])).catch(() => {});
          listInvitations()
            .then((x) => {
              if (!live) return;
              setInvites(x?.invitations || []);
              setPending((x?.invitations || []).filter((i) => i.status === 'PENDING').length);
            })
            .catch(() => {});
          /* The company profile and sign-in policy, for the setup steps (SetupGuide reads the same). */
          const org = tenant?.id;
          Promise.all([
            org ? Promise.resolve().then(() => apiFetch(`/orgs/${encodeURIComponent(org)}/company-profile`, { skipWarehouseHeader: true })).then((x) => x?.company || null).catch(() => null) : null,
            Promise.resolve().then(getPolicy).then((x) => x?.policy || null).catch(() => null),
          ]).then(([profile, policy]) => live && setSetupFacts({ profile, policy }));
          accountAudit({ limit: 6 }).then((a) => live && setActivity(a?.events || [])).catch(() => {});
          memberDirectory()
            .then((d) => live && setDirectory(d?.members || []))
            .catch(() => {});
          /* Accountants let in for a time: one whose access ends within a week is worth a word (CLOR-01). */
          Promise.resolve()
            .then(listOutsideAccess)
            .then((o) => live && setOutside(o ? { ...o, readAt: Date.now() } : null))
            .catch(() => {});
        }
        listTickets().then((t) => live && setTickets(t?.tickets || [])).catch(() => {});
        /* What waits on this person in each app they can open here. */
        if (Array.isArray(r?.apps) && r.apps.length) Promise.resolve().then(getWaiting).then((w) => live && setWaiting(w || null)).catch(() => {});
        /*
         * Today in each app this person can open here: the app's own overview, read as that app's
         * screen reads it, so the figures and who may see them are the app's (a refusal draws
         * nothing). Books has no summary on the server yet; it is not guessed at.
         */
        const org = tenant?.id;
        const on = new Set(subsKey.split(',').filter(Boolean));
        TODAY_SOURCES.filter((x) => org && on.has(x.app) && (r?.apps || []).includes(x.app)).forEach((x) => {
          Promise.resolve()
            .then(() => apiFetch(`/orgs/${encodeURIComponent(org)}/${x.path}`, { skipWarehouseHeader: true }))
            .then((d) => live && d && setToday((t) => ({ ...t, [x.app]: d })))
            .catch(() => {});
        });
      })
      /* No answer hides what depends on it; nothing is guessed. */
      .catch(() => live && setMe(null));
    return () => {
      live = false;
    };
  }, [tenant?.id, subsKey]);

  const loading = me === undefined;
  const role = me?.role || null;
  const myApps = Array.isArray(me?.apps) ? me.apps : null;
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const seesPlan = role === 'OWNER' || role === 'BILLING_ADMIN';
  const may = new Set(navItems.map((n) => n.key));
  /* `params` opens the page already filtered to what the line is about, so nobody searches twice. */
  const go = (key, params) => (may.has(key) ? () => (params ? openScreen?.(key, params) : openScreen?.(key)) : null);

  const products = catalog.filter((a) => !a.platform);
  const built = products.filter((a) => a.available);
  const states = built.map((a) => ({ app: a, state: appState(a, tenant, myApps) }));
  const notAssigned = states.filter((s) => s.state.key === 'noaccess');
  const onCount = states.filter((s) => s.state.key === 'open' || s.state.key === 'noaccess').length;
  const activeMembers = members ? members.filter((m) => m.status === 'ACTIVE').length : null;
  const plan = overview?.plan;
  const usage = overview?.usage;
  const health = overview?.dataHealth || null;
  const runRate = overview ? overview.runRate : undefined;
  const renewal = overview?.renewal || null;
  const bills = renewal?.invoices || null;
  const security = directory ? securityOf(directory) : null;
  const privilegedNo2fa = security?.privilegedNo2fa || 0;
  /*
   * Seats for the apps in use: switched on in this company or another of the account's, or with
   * seats bought in a number. An app the plan merely allows is not listed: a bar for an app
   * nobody has switched on read as people working in it. Workspace itself is not a seat.
   */
  const appsOn = new Set([...(tenant?.subscriptions || []), ...(overview?.companies || []).filter((c) => !c.archived).flatMap((c) => c.apps || [])]);
  const seatApps = built.filter((a) => appsOn.has(a.id) || (overview?.seats || []).some((x) => x.app === a.id && x.bought != null)).map((a) => a.id);
  const seats = directory ? seatsByApp(directory, overview?.seats, seatApps) : null;
  const planBad = plan && plan.inGoodStanding === false;
  const renewalLine = seesPlan ? renewalNotice(renewal, planBad) : null;

  /* One line per app and kind of thing waiting, each opening the screen where it is decided; only apps this person can open. */
  const waitingLines = (waiting?.sources || [])
    .filter((x) => !myApps || myApps.includes(x.open.app))
    .map((x) => ({
      key: `waiting-${x.key}`,
      icon: productIcon(x.app) || ICON.history,
      tone: 'brand',
      tag: APP_NAME[x.app] || x.app,
      action: 'Open',
      title: <><N>{x.count}</N> {x.label}</>,
      sub: `In ${APP_NAME[x.app] || x.app}.`,
      go: openApp ? () => openApp(x.open.app, x.open.screen, x.open.params || {}) : null,
    }));

  /* An app at or past the seats bought: what is left, or how far over (seats bought from the plan, used from the directory). */
  const seatLines = (seats || [])
    .filter((x) => x.bought != null && seatState(x.used, x.bought) !== 'ok')
    .map((x) => {
      const over = seatState(x.used, x.bought) === 'over';
      const left = Number(x.bought) - Number(x.used);
      return {
        key: `seats-${x.app}`,
        tag: over ? 'Over limit' : 'Seats',
        pill: over ? 'danger' : 'warn',
        tone: 'warn',
        action: 'Add seats',
        icon: productIcon(x.app),
        title: <>{APP_NAME[x.app] || x.app} is using <N>{x.used}</N> of <N>{x.bought}</N> seats</>,
        sub: over ? `${-left} more than the plan has. Add seats to keep everyone in.` : `${plural(left, 'seat')} left before you need more.`,
        go: go('billing'),
      };
    });
  /* Outside access that ends within a week: renew it or let it lapse. */
  const readAt = outside?.readAt || 0;
  const endingLines = (outside?.outsideAccess || [])
    .filter((r) => r.effective === 'ACTIVE' && r.expiresAt && Date.parse(r.expiresAt) - readAt < WEEK && Date.parse(r.expiresAt) >= readAt)
    .slice(0, 3)
    .map((r) => {
      const days = Math.max(0, Math.ceil((Date.parse(r.expiresAt) - readAt) / DAY));
      const who = r.from?.name || r.person?.name || r.person?.email || 'An accountant';
      return {
        key: `outside-${r.id}`,
        tag: days === 0 ? 'Expires today' : `Expires in ${plural(days, 'day')}`,
        pill: 'warn',
        tone: 'warn',
        action: 'Review access',
        icon: ICON.person,
        title: `${who}’s access ends ${dateWords(r.expiresAt)}`,
        sub: 'Renew it or let it lapse.',
        go: go('outsideAccess'),
      };
    });
  const noGstin = isAdmin && overview ? (overview.companies || []).filter((c) => !c.gstin && !c.archived) : [];

  /* Needs your attention: only what is true and actionable, the most urgent first. */
  const attention = [
    planBad ? { key: 'plan', tag: 'Plan', action: 'Open plan', icon: ICON.alert, tone: 'danger', title: 'Your plan needs attention', sub: planSentence(plan.status), go: go('account') } : null,
    seesPlan && bills?.overdue ? { key: 'overdue', tag: 'Overdue', action: 'Pay now', icon: ICON.plan, tone: 'danger', title: `${plural(bills.overdue, 'CLOR invoice')} overdue`, sub: <><N>{rupees(bills.due)}</N> to pay in all. Open Billing & seats to pay.</>, go: go('billing') } : null,
    renewalLine ? { key: 'renewal', tag: 'Plan', action: 'Choose plan', icon: ICON.plan, ...renewalLine, go: go('account') } : null,
    ...seatLines,
    ...endingLines,
    ...waitingLines,
    health?.status === 'attention' ? { key: 'sync', tag: 'Sync', icon: ICON.data, tone: 'warn', title: `${plural(health.issues, 'sync problem')}`, sub: health.alerts?.[0]?.title || health.sources.filter((x) => x.issues).map((x) => x.label).join(', '), go: null } : null,
    privilegedNo2fa ? { key: '2fa', tag: 'Security', action: 'Review members', icon: ICON.warning, tone: 'warn', title: `${privilegedNo2fa} administrator${privilegedNo2fa === 1 ? '' : 's'} without an authenticator`, sub: 'They can change who has access; ask them to switch it on.', go: go('members', { risk: 'no2fa' }) } : null,
    seesPlan && bills?.unpaid && !bills.overdue ? { key: 'unpaid', tag: 'Invoice', action: 'Pay', icon: ICON.plan, tone: null, title: `${plural(bills.unpaid, 'CLOR invoice')} to pay`, sub: <><N>{rupees(bills.due)}</N> due. Not overdue yet.</>, go: go('billing') } : null,
    pending ? { key: 'inv', tag: 'Invited', action: 'View invitations', icon: ICON.invite, tone: null, title: `${pending} pending invitation${pending === 1 ? '' : 's'}`, sub: 'Waiting for people to accept.', go: go('invitations') } : null,
    notAssigned.length ? { key: 'na', tag: 'Access', icon: ICON.person, tone: null, title: `You can’t open ${notAssigned.map((s) => s.app.name).join(', ')} yet`, sub: 'An administrator gives access with a role.', go: null } : null,
    noGstin.length ? { key: 'gstin', tag: 'Missing', pill: 'danger', action: 'Add GSTIN', icon: ICON.company, tone: null, title: noGstin.length === 1 ? `${noGstin[0].name} has no GSTIN` : `${noGstin.length} companies have no GSTIN`, sub: noGstin.length === 1 ? 'Invoices from this company cannot be e-invoiced until it is added.' : `${noGstin.map((c) => c.name).join(', ')}: invoices cannot be e-invoiced until each is added.`, go: go('companies') } : null,
  ].filter(Boolean);
  const repliedTo = (tickets || []).filter((t) => t.status === 'WAITING');
  const openTickets = (tickets || []).filter((t) => t.status === 'OPEN' || t.status === 'WAITING').length;
  /* CLOR answered and waits on the customer: after the urgent items, before the routine ones. */
  const firstCalm = attention.findIndex((a) => a.tone !== 'danger' && a.tone !== 'warn');
  if (repliedTo.length) attention.splice(firstCalm < 0 ? attention.length : firstCalm, 0, { key: 'tickets', tag: 'Support', action: 'Reply', icon: ICON.chat, tone: 'brand', title: repliedTo.length === 1 ? `CLOR replied to ${repliedTo[0].code}` : `CLOR replied to ${repliedTo.length} tickets`, sub: repliedTo.length === 1 ? repliedTo[0].subject : 'They are waiting for your answer.', go: go('support') });
  const urgent = attention.filter((a) => a.tone === 'danger' || a.tone === 'warn').length;

  const name = firstName(user);
  const account = accountName || overview?.account?.name || tenant?.name || '';
  const memberCount = activeMembers ?? (security ? security.active : null);
  /* Under the greeting: the account's name and this person's role. The counts are said once, in the figures row. */
  const facts = [account || null].filter(Boolean);
  const companiesTable = isAdmin && overview ? (overview.companies || []) : null;


  /* Setup, from the same steps as the rail's Setup guide: owners and administrators only. */
  const steps = isAdmin && overview && directory && setupFacts
    ? setupSteps({ tenantId: tenant?.id, overview, profile: setupFacts.profile, directory: { members: directory }, invitations: invites || [], policy: setupFacts.policy })
    : null;
  const stepsDone = steps ? steps.filter((x) => x.done).length : 0;
  const here = (overview?.companies || []).find((c) => c.orgId === tenant?.id) || (overview?.companies || [])[0] || null;

  /* Until the account's figures are in, an owner's attention list is not complete: no "0" and no "nothing needs you" yet. */
  const settled = !loading && (!(isAdmin || seesPlan) || overview !== null);

  /* People each app has, from the directory: a seat once per person per app. */
  const inApp = directory ? new Map(seatsByApp(directory, [], built.map((a) => a.id)).map((x) => [x.app, x.used])) : null;
  const peopleIn = (id) => (inApp ? inApp.get(id) ?? null : null);

  /* Setup that is not finished is one action among the others, opening the next step (the full list is the rail's Setup guide). */
  const nextStep = steps ? steps.find((x) => !x.done) : null;
  if (nextStep) {
    const firstCalmAt = attention.findIndex((a) => a.tone !== 'danger' && a.tone !== 'warn');
    attention.splice(firstCalmAt < 0 ? attention.length : firstCalmAt, 0, {
      key: 'setup',
      tone: null,
      action: 'Continue setup',
      title: `Finish setting up ${here?.name || 'your company'}`,
      sub: `Next: ${nextStep.title}.`,
      meter: { used: stepsDone, limit: steps.length },
      go: go(nextStep.screen),
    });
  }
  const actions = attention.map((a) => ({ ...a, area: areaOf(a.key) }));
  const areas = [...new Set(actions.map((a) => a.area))];

  /*
   * At a glance (owner, 20 Nov 2026: Home organised like the Microsoft 365 admin center). One card
   * per subject, each a figure, one breakdown and at most two buttons at its foot. A card is drawn
   * only when its figure was read; nothing is guessed and nothing stands at zero.
   */
  const day = Object.fromEntries(todayLines(today).map((x) => [x.app, x]));
  const appRows = states.map(({ app: a, state }) => {
    const on = state.key === 'open' || state.key === 'noaccess';
    const t = day[a.id];
    /* Today's line where the app gave one (Attendance: in today; Payroll: this month's run), else how many people it has. */
    const people = on && peopleIn(a.id) != null ? plural(peopleIn(a.id), 'person', 'people') : null;
    const value = !t ? people || state.label
      : a.id === 'people' ? plural(Number(t.value), 'person', 'people')
      : t.value === '—' ? t.sub
      : `${t.value}${t.note ? ` ${t.note}` : ''}`;
    return {
      id: a.id,
      name: APP_NAME[a.id] || a.name,
      on,
      value,
      what: t && a.id === 'attendance' && !t.note ? null : t && a.id === 'attendance' ? t.label : null,
      open: state.key === 'open' && openApp ? () => openApp(a.id, t?.screen) : null,
    };
  });
  const memberSeats = (seats || []).filter((x) => appsOn.has(x.app) || x.bought != null);

  return (
    <div className="ws wsh">
      <div className="ws-inner wsh-inner">
        <header className="wsg-head">
          <div>
            <h1 id="wsh-hello" className="wsg-title">Home</h1>
            <p className="wsg-lede">
              {name ? <span>Hello, {name}</span> : null}
              {facts.length ? <span>{facts.join(' · ')}</span> : null}
              {role ? <span className="ws-pill">{ROLE_LABEL[role] || role}</span> : null}
            </p>
          </div>
          {isAdmin && go('invitations') ? (
            <button type="button" className="ws-btn ws-btn--primary" onClick={go('invitations')}>
              <Plus size={16} aria-hidden="true" /> Invite people
            </button>
          ) : null}
        </header>

        <section className="wsg-band" aria-labelledby="wsg-glance-title">
          <h2 className="wsg-band-title">
            <button type="button" className="wsg-fold" aria-expanded={!folded} aria-controls="wsg-glance" onClick={() => setFolded((f) => !f)}>
              <span id="wsg-glance-title">At a glance</span>
              <ChevronDown size={18} aria-hidden="true" className="wsg-fold-ico" />
            </button>
          </h2>
          {folded ? null : (
            <div id="wsg-glance" className="wsg-cards">
              {isAdmin && memberCount != null ? (
                <GlanceCard
                  id="members"
                  title="Members"
                  label={memberCount === 1 ? 'Active member' : 'Active members'}
                  figure={memberCount}
                  note={pending ? `${plural(pending, 'invitation')} not accepted yet` : null}
                  foot={[{ label: 'Manage members', go: go('members') }, { label: 'Roles', go: go('roles') }]}
                >
                  {memberSeats.length ? (
                    <div className="wsg-rows" role="group" aria-label="Seats by app">
                      <p className="wsg-sub-title">Seats by app</p>
                      {memberSeats.map((x) => <Meter key={x.app} label={APP_NAME[x.app] || appName(x.app)} used={x.used} limit={x.bought} />)}
                    </div>
                  ) : null}
                </GlanceCard>
              ) : null}

              {appRows.length ? (
                <GlanceCard
                  id="apps"
                  title="Apps"
                  label={onCount === 1 ? 'Active app' : 'Active apps'}
                  figure={onCount || null}
                  of={onCount ? built.length : null}
                  foot={[{ label: 'Manage apps', go: go('apps') }]}
                >
                  <ul className="wsg-list" aria-label="Apps and how today stands">
                    {appRows.map((a) => {
                      const body = (
                        <>
                          <AppMark app={a.id} size={20} off={!a.on} title="" />
                          <span className="wsg-list-name">{a.name}</span>
                          <span className="wsg-list-value">
                            {a.what ? <span className="wsg-list-what">{a.what}</span> : null}
                            <span className={a.on ? 'ui-num' : 'wsg-muted'}>{a.value}</span>
                          </span>
                        </>
                      );
                      return <li key={a.id}>{a.open ? <button type="button" className="wsg-list-row" onClick={a.open} aria-label={`Open ${a.name}: ${a.what ? `${a.what} ` : ''}${a.value}`}>{body}</button> : <div className="wsg-list-row">{body}</div>}</li>;
                    })}
                  </ul>
                </GlanceCard>
              ) : null}

              {plan ? (
                <GlanceCard
                  id="plan"
                  title="Plan"
                  label={renewal?.status === 'trialing' ? 'Each month after the trial' : 'Each month'}
                  figure={runRate?.monthly != null ? rupees(runRate.monthly) : null}
                  emptyFigure={runRate?.unpriced?.length ? `Not priced yet (${runRate.unpriced.map((a) => APP_NAME[a] || a).join(', ')})` : runRate !== undefined ? 'Not priced yet' : null}
                  foot={[{ label: 'Manage billing', go: go('billing') || go('account') }]}
                >
                  <dl className="ws-rows wsg-dl">
                    <div>
                      <dt>Plan</dt>
                      <dd>
                        {plan.name}
                        {/* Tags only on exceptions (DESIGN.md "Status tags"). */}
                        {plan.inGoodStanding && renewal?.status !== 'trialing' ? null : <> <span className={plan.inGoodStanding ? 'ws-pill ws-pill--warn' : 'ws-pill ws-pill--danger'}>{plan.inGoodStanding ? 'Trial' : planWord(plan.status)}</span></>}
                      </dd>
                    </div>
                    {renewal?.endsAt ? (
                      <div>
                        <dt>{renewal.status === 'trialing' ? 'Trial ends' : 'Ends'}</dt>
                        <dd>{dateWords(renewal.endsAt)}</dd>
                      </div>
                    ) : renewal?.renewsAt ? (
                      <div>
                        <dt>Renews</dt>
                        <dd>{dateWords(renewal.renewsAt)}</dd>
                      </div>
                    ) : null}
                    {seesPlan && bills ? (
                      <div>
                        <dt>To pay</dt>
                        <dd>{bills.unpaid ? <N>{rupees(bills.due)}</N> : 'Nothing'}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {plan.limits?.maxCompanies != null ? <Meter label="Companies" used={usage?.companies ?? 0} limit={plan.limits.maxCompanies} /> : null}
                  {plan.limits?.maxUsers != null ? <Meter label="Users" used={usage?.users ?? 0} limit={plan.limits.maxUsers} /> : null}
                </GlanceCard>
              ) : null}

              {security ? (
                <GlanceCard
                  id="security"
                  title="Security"
                  label="Members with an authenticator"
                  figure={security.withTotp}
                  of={security.active || null}
                  note={privilegedNo2fa ? `${plural(privilegedNo2fa, 'administrator')} without one` : 'Every administrator uses one'}
                  foot={[{ label: 'Open security', go: go('securityHome') }]}
                >
                  {health && health.sources.length ? (
                    <ul className="wsg-list" aria-label="Connections">
                      {health.sources.map((x) => (
                        <li key={x.key}>
                          <div className="wsg-list-row">
                            <span className="wsg-list-name">{x.label}</span>
                            <span className="wsg-list-value">
                              {x.issues ? <span className="ws-pill ws-pill--warn">Needs a look</span> : <span className="wsg-muted">Working</span>}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </GlanceCard>
              ) : null}
            </div>
          )}
        </section>

        {myApps && myApps.length === 0 ? (
          <section className="wsg-card wsg-noaccess" role="status" aria-labelledby="ws-noaccess-title">
            <h2 id="ws-noaccess-title" className="wsg-card-title">No app access yet</h2>
            <p className="wsg-muted">You are in {tenant?.name || 'this company'}, but no app is open to you yet. An administrator gives access by giving you a role.</p>
          </section>
        ) : null}

        <section ref={attentionRef} className="wsg-band" style={{ scrollMarginTop: 16 }} aria-labelledby="ws-attn-title">
          <div className="wsg-band-head">
            <h2 id="ws-attn-title" className="wsg-band-title">Top actions</h2>
            {waitingLines.length && go('inbox') ? (
              <button type="button" className="ws-link" onClick={go('inbox')}>
                Open inbox <ChevronRight size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {settled && areas.length > 1 ? (
            <div className="wsg-chips" role="group" aria-label="Show actions about">
              {['All', ...areas].map((x) => {
                const n = x === 'All' ? actions.length : actions.filter((a) => a.area === x).length;
                return (
                  <button key={x} type="button" className="wsg-chip" aria-pressed={(area || 'All') === x} onClick={() => setArea(x === 'All' ? null : x)}>
                    {x} <span className="ui-num">{n}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {!settled ? (
            <ul className="wsg-acts" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <li key={i} className="wsg-card wsg-act">
                  <span className="ui-skel ui-skel-text" style={{ width: '40%' }} />
                  <span className="ui-skel ui-skel-text" style={{ width: '80%' }} />
                  <span className="ui-skel ui-skel-text" style={{ width: '60%' }} />
                </li>
              ))}
            </ul>
          ) : actions.length ? (
            <ul className="wsg-acts" aria-label={urgent ? `${plural(urgent, 'urgent item')}` : 'Nothing urgent'}>
              {actions.filter((a) => !area || a.area === area).map((a) => (
                <li key={a.key} className="wsg-card wsg-act" data-tone={a.tone || undefined}>
                  <div className="wsg-act-head">
                    <span className="wsg-act-area">{a.area}</span>
                    {/* Severity only, and only on what is urgent (DESIGN.md: tags on exceptions); the subject is said once, on the left. */}
                    {a.tone === 'danger' ? <span className="ws-pill ws-pill--danger">Urgent</span> : a.tone === 'warn' ? <span className="ws-pill ws-pill--warn">Needs action</span> : null}
                  </div>
                  <h3 className="wsg-act-title">{a.title}</h3>
                  <p className="wsg-act-sub">{a.sub}</p>
                  {a.meter ? <Meter coverage label="Steps done" used={a.meter.used} limit={a.meter.limit} /> : null}
                  {a.go ? (
                    <div className="wsg-foot">
                      <button type="button" className="ws-btn ws-btn--quiet" onClick={a.go} aria-label={`${a.action || 'Open'}: ${typeof a.title === 'string' ? a.title : textOf(a.title)}`}>
                        {a.action || 'Open'}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="wsg-calm">Nothing needs you right now.</p>
          )}
        </section>

        {companiesTable && companiesTable.length > 1 ? (
          <section className="wsg-band" aria-labelledby="ws-cos-title">
            <div className="wsg-band-head">
              <h2 id="ws-cos-title" className="wsg-band-title">Companies</h2>
              {go('companies') ? <button type="button" className="ws-link" onClick={go('companies')}>All companies <ChevronRight size={16} aria-hidden="true" /></button> : null}
            </div>
            <div className="ws-table-wrap">
              <table className="ws-table">
                <caption className="sr-only">Companies in this account</caption>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>GSTIN</th>
                    <th>Apps</th>
                    <th className="num">Members</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {companiesTable.map((c) => (
                    <tr key={c.orgId}>
                      <td>
                        <span className="ws-cell-main">{c.name}</span>
                        {c.state ? <span className="ws-cell-sub">{c.state}</span> : null}
                      </td>
                      <td>{c.gstin ? <span className="ui-mono">{c.gstin}</span> : <span className="ws-missing">Not added</span>}</td>
                      <td>
                        <span className="ws-appmarks">
                          {(c.apps || []).length ? c.apps.map((id) => <AppMark key={id} app={id} size={20} />) : <span className="ws-cell-sub">None</span>}
                        </span>
                      </td>
                      <td className="num">{c.people ?? 0}</td>
                      <td>{c.archived ? <span className="ws-pill ws-pill--neutral">Archived</span> : c.gstin ? <span className="sr-only">Active</span> : <span className="ws-pill ws-pill--warn">Needs GSTIN</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <div className="wsg-pair">
          {activity ? (
            <section className="wsg-card" aria-labelledby="ws-activity-title">
              <div className="wsg-band-head">
                <h2 id="ws-activity-title" className="wsg-card-title">Recent activity</h2>
                {go('accountActivity') ? <button type="button" className="ws-link" onClick={go('accountActivity')}>View all <ChevronRight size={16} aria-hidden="true" /></button> : null}
              </div>
              {activity.length ? (
                <ol className="wsh-feed">
                  {activity.map((e) => (
                    <li key={e.id} data-denied={e.result === 'DENIED' || undefined}>
                      <Avatar name={e.actor?.name || 'Someone'} />
                      <span className="wsh-feed-text">
                        <span>
                          <strong>{e.actor?.name || 'Someone'}</strong>{' '}
                          <span className="wsh-feed-what">
                            {e.result === 'DENIED' ? 'was refused: ' : ''}
                            {actionText(e.action)}
                            {e.targetName ? `: ${e.targetName}` : ''}
                          </span>
                        </span>
                        <span className="wsh-feed-when">{ago(e.at)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="wsg-muted">Nothing recorded yet. Invitations, role changes and sign-in settings show here as they happen.</p>
              )}
            </section>
          ) : null}

          <section className="wsg-card" aria-labelledby="ws-help-title">
            <h2 id="ws-help-title" className="wsg-card-title">Help and support</h2>
            <ul className="wsg-list">
              <li>
                <button type="button" className="wsg-list-row" onClick={() => requestOpenHelp('welcome')}>
                  <span className="wsg-list-name">Help centre</span>
                  <span className="wsg-list-value wsg-muted">Guides for every app</span>
                </button>
              </li>
              {go('support') ? (
                <li>
                  <button type="button" className="wsg-list-row" onClick={go('support')}>
                    <span className="wsg-list-name">Ask CLOR support</span>
                    <span className="wsg-list-value wsg-muted">{openTickets ? `${openTickets} open` : 'Answer by email'}</span>
                  </button>
                </li>
              ) : null}
              {operator.contactEmail ? (
                <li>
                  <a className="wsg-list-row" href={`mailto:${operator.contactEmail}`}>
                    <span className="wsg-list-name">Contact support</span>
                    <span className="wsg-list-value wsg-muted">{operator.contactEmail}</span>
                  </a>
                </li>
              ) : null}
            </ul>
            {nextStep ? <CallMe /> : null}
          </section>
        </div>
      </div>
    </div>
  );
}

/* Which subject an action belongs to: the chips above Top actions filter by it. */
const AREA = { plan: 'Billing', overdue: 'Billing', renewal: 'Billing', unpaid: 'Billing', seats: 'Billing', outside: 'Members', inv: 'Members', na: 'Members', '2fa': 'Security', gstin: 'Companies', waiting: 'Apps', sync: 'Apps', tickets: 'Support', setup: 'Setup' };
export const areaOf = (key) => AREA[key] || AREA[String(key).split('-')[0]] || 'Other';

/* The words of a title written as JSX (a count in the figure face beside words), for a button's name. */
function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}

/** One card in At a glance: title, what the figure counts, the figure, one breakdown, and its buttons at the foot. */
function GlanceCard({ id, title, label, figure, of = null, emptyFigure = null, note = null, foot = [], children }) {
  const buttons = foot.filter((b) => b.go);
  return (
    <section className="wsg-card wsg-glance" aria-labelledby={`wsg-${id}-title`}>
      <h3 id={`wsg-${id}-title`} className="wsg-card-title">{title}</h3>
      <p className="wsg-label">{label}</p>
      {figure != null ? (
        <p className="wsg-figure ui-num">{figure}{of != null ? <small> of {of}</small> : null}</p>
      ) : emptyFigure ? (
        <p className="wsg-figure-words">{emptyFigure}</p>
      ) : null}
      {note ? <p className="wsg-muted">{note}</p> : null}
      <div className="wsg-glance-body">{children}</div>
      {buttons.length ? (
        <div className="wsg-foot">
          {buttons.map((b) => (
            <button key={b.label} type="button" className="ws-btn ws-btn--quiet" onClick={b.go}>{b.label}</button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
