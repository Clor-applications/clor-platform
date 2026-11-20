import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Plus } from '@ui/components/ui/lineIcons';
import { emoji } from '@ui/components/ui/emoji';
import { ClorMark } from '@ui/components/brand';

import { accountAudit, getAccountMe, listAccountMembers, listInvitations, listTickets, memberDirectory } from '@platform/admin/account';
import { getAccountOverview } from '@platform/admin/admin';
import { operator } from '@platform/operator';
import { actionText } from './AccountActivity';
import { planSentence, planWord } from './planWords';
import { listOutsideAccess } from '@platform/admin/outsideAccess';
import { AppMark, Avatar, ICON, Meter, Panel, ago, appInfo, appName, colourIcon, productIcon, seatState } from './wsKit';
import { rupees, seatsByApp, securityOf } from './overviewFigures';
import { orgId, requestOpenHelp } from '@platform/context';
import { apiFetch } from '@platform/http';
import { getPolicy } from '@platform/admin/security';
import { setupSteps } from './SetupGuide';
import { CallMe } from './CallMe';
import './workspace.css';
import './ws-home.css';
import './ws-overview.css';

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

/*
 * Fluent Emoji (flat), local SVGs (navEmoji's family): the Overview's warmth, owner 16 Nov 2026.
 * Decoration and tile marks only; every one sits beside words that say the same thing.
 */
const E = {
  wave: emoji('waving-hand'),
  cool: emoji('smiling-face-with-sunglasses'),
  party: emoji('partying-face'),
  chart: emoji('bar-chart'),
  calendar: emoji('spiral-calendar'),
  check: emoji('check-mark-button'),
  coffee: emoji('hot-beverage'),
  sparkles: emoji('sparkles'),
  building: emoji('office-building'),
  rocket: emoji('rocket'),
  people: emoji('busts-in-silhouette'),
  inbox: emoji('inbox-tray'),
  bell: emoji('bell'),
  clipboard: emoji('clipboard'),
  shield: emoji('shield'),
  mail: emoji('envelope-with-arrow'),
  key: emoji('key'),
  puzzle: emoji('puzzle-piece'),
  card: emoji('credit-card'),
  link: emoji('link'),
  locked: emoji('locked'),
  hug: emoji('hugging-face'),
  books: emoji('books'),
  bulb: emoji('light-bulb'),
  chat: emoji('speech-balloon'),
  letter: emoji('envelope'),
  bolt: emoji('high-voltage'),
  buoy: emoji('ring-buoy'),
  clock: emoji('alarm-clock'),
};


/* The page's three accent hues, in the order they take turns. */
const HUES = ['blue', 'orange', 'green'];

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

/* The members ring: radius and circumference in the 100-unit box. */
const RING_R = 38;
const RING_C = 2 * Math.PI * RING_R;

/* The tone of an attention row, as a tinted icon square: problem, attention, or the app's own quiet mark. */
const TONE_CLASS = { danger: 'wsh-ico--neg', warn: 'wsh-ico--warn', brand: 'wsh-ico--brand' };


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

/**
 * The hero's picture: CLOR at the centre with this account's apps around it, joined to it. Not a
 * stock drawing: every app CLOR has or plans, up to six, wears its own colour (owner, 17 Nov: "add
 * color to icons", "add 6 apps"); one that is switched on sends moving dashes down its line to
 * the hub, one that is not sits on a still, quiet line, so the picture is this workspace and
 * changes as apps are added. Decoration all the same
 * (the Your apps row says it in words): hidden from screen readers, shown only where the hero has
 * room beside the words and Next for you.
 */
/* CLOR's six apps, always all six: the picture is the whole platform, with this company's own apps live in it.
   (The catalog drops Attendance once People is on, since People carries it; the picture still shows it, live.) */
const ART_APPS = ['accounting', 'payroll', 'people', 'attendance', 'projects', 'timesheet'];
const HUB = { x: 130, y: 105 };
/* Six places round the hub, a flattened hexagon: top and bottom on the centre line, two each side. */
const SPOTS = [{ x: 43, y: 62 }, { x: 130, y: 25 }, { x: 217, y: 62 }, { x: 217, y: 148 }, { x: 130, y: 185 }, { x: 43, y: 148 }];
function AppsArt({ apps = [] }) {
  const placed = apps.slice(0, SPOTS.length).map((a, i) => ({ ...a, ...SPOTS[i] }));
  return (
    <span className="wsh-hub-art">
      <svg viewBox="0 0 260 210" width="260" height="210" focusable="false">
        {/* Each app's line to CLOR, drawn from the app inward so its dashes run toward the hub. One that is
            switched on carries its colour and moves; one that is not is a still, quiet dash. */}
        {placed.map((a) => (
          <line
            key={a.id}
            x1={a.x}
            y1={a.y}
            x2={HUB.x}
            y2={HUB.y}
            className="wsh-hub-link"
            data-on={a.on || undefined}
            style={{ stroke: `rgb(var(${appInfo(a.id)?.color || '--border-strong'}) / ${a.on ? 0.85 : 0.4})` }}
          />
        ))}
        <circle cx={HUB.x} cy={HUB.y} r="40" className="wsh-hub-pulse" />
      </svg>
      <span className="wsh-hub" style={{ left: HUB.x, top: HUB.y }}><ClorMark size={34} title="" /></span>
      {placed.map((a, i) => (
        <span key={a.id} className="wsh-hub-app" data-on={a.on || undefined} style={{ left: a.x, top: a.y, animationDelay: `${-1.1 * i}s` }}>
          <AppMark app={a.id} size={32} title="" />
        </span>
      ))}
    </span>
  );
}

export default function AdminHome({ user, tenant, catalog = [], navItems = [], openScreen, openApp, openMoreApps, accountName = '' }) {
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
  const planned = products.filter((a) => !a.available);
  const states = built.map((a) => ({ app: a, state: appState(a, tenant, myApps) }));
  const notAssigned = states.filter((s) => s.state.key === 'noaccess');
  const onCount = states.filter((s) => s.state.key === 'open' || s.state.key === 'noaccess').length;
  const activeMembers = members ? members.filter((m) => m.status === 'ACTIVE').length : null;
  const plan = overview?.plan;
  const usage = overview?.usage;
  const entities = overview?.entities || null;
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
  const companyCount = entities?.companies ?? (overview ? (overview.companies || []).filter((c) => !c.archived).length : null);
  const memberCount = activeMembers ?? (security ? security.active : null);
  /* Under the greeting: the account's name and this person's role. The counts are said once, in the figures row. */
  const facts = [account || null].filter(Boolean);
  const companiesTable = isAdmin && overview ? (overview.companies || []) : null;

  /* What waits on this person, in all: the same sources the attention list shows. */
  const waitingTotal = waiting ? (waiting.sources || []).filter((x) => !myApps || myApps.includes(x.open.app)).reduce((n, x) => n + (Number(x.count) || 0), 0) : null;

  /* Setup, from the same steps as the rail's Setup guide: owners and administrators only. */
  const steps = isAdmin && overview && directory && setupFacts
    ? setupSteps({ tenantId: tenant?.id, overview, profile: setupFacts.profile, directory: { members: directory }, invitations: invites || [], policy: setupFacts.policy })
    : null;
  const stepsDone = steps ? steps.filter((x) => x.done).length : 0;
  const here = (overview?.companies || []).find((c) => c.orgId === tenant?.id) || (overview?.companies || [])[0] || null;

  /* Until the account's figures are in, an owner's attention list is not complete: no "0" and no "nothing needs you" yet. */
  const settled = !loading && (!(isAdmin || seesPlan) || overview !== null);

  /*
   * The figures across the top: each a fact the server gave, each opening the screen that owns it.
   * The tile itself stays white; its icon sits on a soft chip in one of three hues (blue, orange,
   * green: owner, 17 Nov, "it looks dull" with none). The whole tile takes a colour only to show a
   * state (amber or red when something is urgent, green when setup is done).
   * The line under each says what the number alone does not ("1 Member" says little; "Only you so
   * far" says what to do next). Each line only from what was read; none is drawn on a guess.
   */
  const appsOnNames = states.filter((s) => s.state.key === 'open' || s.state.key === 'noaccess').map((s) => s.app.name);
  const waitingApps = waiting ? new Set((waiting.sources || []).filter((x) => (!myApps || myApps.includes(x.open.app)) && Number(x.count) > 0).map((x) => x.app)).size : 0;
  const tiles = [
    companyCount != null
      ? {
          key: 'companies', icon: E.building, hue: 'blue', value: companyCount, label: companyCount === 1 ? 'Company' : 'Companies', go: go('companies'),
          hint: !companiesTable ? null : noGstin.length ? (companyCount === 1 ? 'GSTIN not added' : `${noGstin.length} without a GSTIN`) : companyCount === 1 ? here?.state || null : 'Each has a GSTIN',
        }
      : null,
    { key: 'apps', icon: E.rocket, hue: 'orange', value: onCount, label: onCount === 1 ? 'Active app' : 'Active apps', note: `of ${built.length}`, hint: appsOnNames.length ? appsOnNames.join(', ') : 'None switched on yet', go: go('apps') },
    memberCount != null
      ? {
          key: 'members', icon: E.people, hue: 'green', value: memberCount, label: memberCount === 1 ? 'Member' : 'Members', go: go('members'),
          hint: pending == null ? null : pending ? `${pending} invited, not joined yet` : memberCount === 1 ? 'Only you so far' : 'Everyone has joined',
        }
      : null,
    waitingTotal != null ? { key: 'waiting', icon: E.inbox, hue: 'blue', value: waitingTotal, label: 'Waiting on you', hint: waitingTotal ? `In ${plural(waitingApps, 'app')}` : 'All clear', go: go('inbox') } : null,
  ].filter(Boolean);

  /* Team and access: who is in the account, and how many people each app has (seats from the directory). */
  const team = isAdmin && members
    ? (() => {
        const mix = [
          { key: 'active', label: 'Active', n: members.filter((m) => m.status === 'ACTIVE').length, color: '--cat-3' },
          { key: 'invited', label: 'Invited', n: pending || 0, color: '--marker' },
          { key: 'suspended', label: 'Suspended', n: members.filter((m) => m.status === 'SUSPENDED').length, color: '--border-strong' },
        ];
        const total = mix.reduce((n, x) => n + x.n, 0);
        let at = 0;
        const gap = mix.filter((x) => x.n).length > 1 ? 2 : 0;
        const arcs = mix.filter((x) => x.n).map((x) => {
          const len = Math.max(0, (x.n / Math.max(1, total)) * RING_C - gap);
          const arc = { ...x, len, at };
          at += len + gap;
          return arc;
        });
        const most = Math.max(1, ...(seats || []).map((x) => Number(x.bought ?? x.used) || 0), mix[0].n);
        const seatRows = (seats || []).map((x) => ({ ...x, pct: Math.min(100, Math.round((Number(x.used) / Math.max(1, Number(x.bought ?? most))) * 100)) }));
        return { mix, total, arcs, seats: seatRows };
      })()
    : null;

  /*
   * Your apps: what a workspace is for. Each built app with what it is to this person right now
   * (appState) and the one thing they can do about it: open it, switch it on, or see the plan that
   * has it. The mark wears the app's own colour (identity, DESIGN.md); an app that is not on is grey.
   */
  const peopleIn = directory ? new Map(seatsByApp(directory, [], built.map((a) => a.id)).map((x) => [x.app, x.used])) : null;
  const appCards = states.map(({ app: a, state }) => {
    const act =
      state.key === 'open' ? (openApp ? { label: 'Open', run: () => openApp(a.id) } : null)
      : state.key === 'off' ? (go('apps') ? { label: 'Switch on', run: go('apps') } : null)
      : state.key === 'plan' ? (go('billing') || go('apps') ? { label: 'See plans', run: go('billing') || go('apps') } : null)
      : null;
    const used = state.key === 'open' || state.key === 'noaccess' ? peopleIn?.get(a.id) : null;
    return { id: a.id, name: APP_NAME[a.id] || a.name, blurb: a.blurb, state, act, used };
  });

  /*
   * Today (owner, 17 Nov 2026: "more important information" in the hero, and nothing the page says
   * twice). The hero's card is how the business stands today in each app this person can open:
   * who is in, how many people, where this month's payroll is. What needs doing stays in Needs
   * your attention, once. With no app that reports a day, the card is not drawn and the picture
   * has the room.
   */
  const lines = todayLines(today);
  const dayWords = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  /* Shortcuts to the three jobs the rail does not name; Apps, Billing, Integrations and Security are one click away there. */
  const quick = [
    { key: 'companies', icon: E.building, label: 'Add company', hint: 'Another business in this account' },
    { key: 'invitations', icon: E.mail, label: 'Invite member', hint: 'Send an email invitation' },
    { key: 'roles', icon: E.key, label: 'Manage access', hint: 'Roles and what each may do' },
  ].filter((q) => may.has(q.key));


  return (
    <div className="ws wsh">
      <div className="ws-inner wsh-inner">
        {/* Hero: who you are, where you are, and the one primary action. */}
        <section className="wsh-hero" data-today={lines.length ? '' : undefined} aria-labelledby="wsh-hello">
          <div className="wsh-hero-text">
            <h1 id="wsh-hello" className="wsh-hello">
              Home
            </h1>
            <p className="wsh-lede">
              {name ? <span className="block">Hello, {name} <E.wave size={20} className="wsh-wave" aria-hidden="true" /></span> : null}
              {ROLE_LEDE[role] || DEFAULT_LEDE}
            </p>
            <p className="wsh-facts">
              <span>{facts.join(' · ')}</span>
              {/* The role in green with a live dot: you, signed in now (owner, 19 Nov 2026). */}
              {role ? <span className="ws-pill wsh-role"><span className="wsh-live" aria-hidden="true" />{ROLE_LABEL[role] || role}</span> : null}
            </p>
            {isAdmin && go('invitations') ? (
              <div className="wsh-hero-actions">
                <button type="button" className="ws-btn ws-btn--primary" onClick={go('invitations')}>
                  <Plus size={16} aria-hidden="true" /> Invite people
                </button>
                {go('apps') ? (
                  <button type="button" className="ws-btn wsh-btn-glass" onClick={go('apps')}>
                    Explore apps
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {/* Decoration between the words and the card, only where the hero is wide enough for all three. */}
          <div className="wsh-stage" aria-hidden="true">
            <AppsArt apps={ART_APPS.map((id) => ({ id, on: (tenant?.subscriptions || []).includes(id) }))} />
          </div>
          {lines.length ? (
            <div className="wsh-today" role="group" aria-labelledby="wsh-today-title">
              <p className="wsh-today-head">
                <span id="wsh-today-title" className="wsh-today-label">Today</span>
                <span className="wsh-today-date">{dayWords}</span>
              </p>
              <ul className="wsh-today-list">
                {lines.map((x) => {
                  const body = (
                    <>
                      <AppMark app={x.app} size={28} title="" />
                      <span className="wsh-today-text">
                        <span className="wsh-today-what">{x.label}</span>
                        {x.sub ? <span className="wsh-today-sub">{x.sub}</span> : null}
                      </span>
                      <span className="wsh-today-value ui-num">{x.value}{x.note ? <small> {x.note}</small> : null}</span>
                    </>
                  );
                  return (
                    <li key={x.app}>
                      {openApp ? (
                        <button type="button" className="wsh-today-row" onClick={() => openApp(x.app, x.screen)} aria-label={`${x.label}: ${x.value}${x.note ? ` ${x.note}` : ''}. Open ${APP_NAME[x.app] || x.app}`}>{body}</button>
                      ) : (
                        <div className="wsh-today-row">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </section>

        {/* First, what needs this person and what is left to set up (owner, 17 Nov 2026: rework Home). */}
        <div className="wsh-pair">
          <section ref={attentionRef} className="wsh-card" style={{ scrollMarginTop: 16 }} aria-labelledby="ws-attn-title">
            <div className="wsh-card-head">
              <h2 id="ws-attn-title" className="ws-h2">
                <E.bell size={20} className="ws-head-ico" aria-hidden="true" />
                Needs your attention
                {attention.length ? <span className="wsh-count ui-num" aria-hidden="true">{attention.length}</span> : null}
              </h2>
              {waitingLines.length && go('inbox') ? (
                <button type="button" className="ws-link" onClick={go('inbox')}>
                  Open inbox <ChevronRight size={16} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {!settled ? (
              <ul className="wsh-attn" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <li key={i}>
                    <div className="wsh-attn-row">
                      <span className="ui-skel wsh-ico" />
                      <span className="wsh-attn-text">
                        <span className="ui-skel ui-skel-text" style={{ width: '72%' }} />
                        <span className="ui-skel ui-skel-text" style={{ width: '48%' }} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : attention.length ? (
              <ul className="wsh-attn" aria-label={urgent ? `${plural(urgent, 'urgent item')}` : 'Nothing urgent'}>
                {attention.map((a) => {
                  const Icon = colourIcon(a.icon || ICON.alert);
                  const body = (
                    <>
                      <span className={`wsh-ico ${TONE_CLASS[a.tone] || ''}`} aria-hidden="true"><Icon size={18} /></span>
                      <span className="wsh-attn-text">
                        <span className="wsh-attn-title">{a.title}</span>
                        <span className="wsh-attn-sub">
                          <span className={`ws-pill ws-pill--${a.pill || (a.tone === 'danger' ? 'danger' : a.tone === 'warn' ? 'warn' : 'neutral')}`}>{a.tag}</span>
                          <span>{a.sub}</span>
                        </span>
                      </span>
                      {a.go ? <span className="wsh-attn-act">{a.action || 'Open'} <ChevronRight size={14} aria-hidden="true" /></span> : <span />}
                    </>
                  );
                  return <li key={a.key}>{a.go ? <button type="button" className="wsh-attn-row" onClick={a.go}>{body}</button> : <div className="wsh-attn-row">{body}</div>}</li>;
                })}
              </ul>
            ) : (
              <div className="wsh-calm">
                <E.cool size={40} aria-hidden="true" />
                <p className="ws-card-blurb">Nothing needs you right now. Enjoy the quiet.</p>
              </div>
            )}
          </section>

          {isAdmin && here ? (
            <section className="wsh-card" aria-labelledby="wsh-co-title">
              <div className="wsh-card-head">
                <h2 id="wsh-co-title" className="ws-h2"><E.building size={20} className="ws-head-ico" aria-hidden="true" />Company overview</h2>
                {go('company') ? <button type="button" className="ws-link" onClick={go('company')}>Profile <ChevronRight size={16} aria-hidden="true" /></button> : null}
              </div>
              <div className="wsh-co">
                <span className="wsh-co-ico" aria-hidden="true"><E.building size={30} /></span>
                <span className="wsh-co-text">
                  <span className="wsh-co-name">{here.name}</span>
                  <span className="wsh-co-sub">{here.state || 'State not set'}{here.gstin ? <> · <span className="ui-mono">{here.gstin}</span></> : null}</span>
                </span>
                {here.archived ? <span className="ws-pill ws-pill--neutral">Archived</span> : here.gstin ? <span className="ws-pill ws-pill--ok">Active</span> : <span className="ws-pill ws-pill--warn">Needs GSTIN</span>}
              </div>
              {steps ? (
                <div className="wsh-setup">
                  <div className="wsh-setup-head">
                    <span>Setup progress</span>
                    <span className="ui-num">{Math.round((stepsDone / steps.length) * 100)}%</span>
                  </div>
                  <div className="wsh-bar" role="meter" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={stepsDone}>
                    <span style={{ width: `${Math.round((stepsDone / steps.length) * 100)}%` }} />
                  </div>
                  <ul className="wsh-steps">
                    {steps.map((x) => (
                      <li key={x.key} data-done={x.done || undefined}>
                        <span className="wsh-step-mark" aria-hidden="true">{x.done ? <E.check size={18} /> : null}</span>
                        {!x.done && go(x.screen) ? (
                          <button type="button" className="wsh-step-link" onClick={go(x.screen)}>{x.title}</button>
                        ) : (
                          <span>{x.title}{x.done ? <span className="sr-only"> (done)</span> : null}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {stepsDone < steps.length ? <CallMe /> : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        {/* The workspace in figures. */}
        {tiles.length ? (
          <ul className="wsh-tiles" aria-label="Workspace at a glance">
            {tiles.map((t) => {
              const Icon = t.icon;
              const body = (
                <>
                  <span className="wsh-tile-ico" aria-hidden="true"><Icon size={24} /></span>
                  <span className="wsh-tile-text">
                    <span className="wsh-tile-value ui-num">{t.value}{t.note ? <small> {t.note}</small> : null}</span>
                    <span className="wsh-tile-label">{t.label}</span>
                    {t.hint ? <span className="wsh-tile-hint">{t.hint}</span> : null}
                  </span>
                  {t.go ? <ChevronRight size={16} className="wsh-tile-go" aria-hidden="true" /> : null}
                </>
              );
              return (
                <li key={t.key} data-tone={t.tone || undefined} data-hue={t.hue || undefined}>
                  {t.go ? <button type="button" className="wsh-tile" onClick={t.go}>{body}</button> : <div className="wsh-tile">{body}</div>}
                </li>
              );
            })}
          </ul>
        ) : null}

        {appCards.length ? (
          <section className="wsh-apps-wrap" aria-labelledby="wsh-apps-title">
            <div className="wsh-card-head">
              <h2 id="wsh-apps-title" className="ws-h2"><E.rocket size={20} className="ws-head-ico" aria-hidden="true" />Your apps</h2>
              {go('apps') ? (
                <button type="button" className="ws-link" onClick={go('apps')}>
                  All apps <ChevronRight size={16} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <ul className="wsh-apps">
              {appCards.map((a) => {
                const on = a.state.key === 'open' || a.state.key === 'noaccess';
                const body = (
                  <>
                    <AppMark app={a.id} size={32} off={!on} title="" />
                    <span className="wsh-app-text">
                      <span className="wsh-app-name">{a.name}</span>
                      <span className="wsh-app-state">{on && a.used != null ? <><N>{a.used}</N> {a.used === 1 ? 'person' : 'people'}</> : a.state.label}</span>
                    </span>
                    {a.act ? <span className="wsh-app-act">{a.act.label} <ChevronRight size={14} aria-hidden="true" /></span> : null}
                  </>
                );
                return (
                  <li key={a.id} data-on={on || undefined}>
                    {a.act ? <button type="button" className="wsh-app" onClick={a.act.run} aria-label={`${a.act.label} ${a.name}`}>{body}</button> : <div className="wsh-app">{body}</div>}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {myApps && myApps.length === 0 ? (
          <section className="wsh-card wsh-empty" role="status" aria-labelledby="ws-noaccess-title">
            <E.hug size={40} aria-hidden="true" />
            <div>
              <h2 id="ws-noaccess-title" className="ws-h2">No app access yet</h2>
              <p className="ws-card-blurb">You are in {tenant?.name || 'this company'}, but no app is open to you yet. An administrator gives access by giving you a role.</p>
            </div>
          </section>
        ) : null}

        <div className="wsh-layout">
          <div className="wsh-main">
            {/* A ring of one person and a bar of one say nothing: drawn from three people up. */}
            {team && team.total >= 3 ? (
              <section className="wsh-card" aria-labelledby="wsh-team-title">
                <div className="wsh-card-head">
                  <h2 id="wsh-team-title" className="ws-h2"><E.people size={20} className="ws-head-ico" aria-hidden="true" />Team and access</h2>
                  {go('members') ? (
                    <button type="button" className="ws-link" onClick={go('members')}>
                      Members <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <div className="wsh-team">
                  <figure className="wsh-ring" aria-label={team.mix.map((x) => `${x.n} ${x.label.toLowerCase()}`).join(', ')}>
                    <svg viewBox="0 0 100 100" width="132" height="132" aria-hidden="true">
                      <circle cx="50" cy="50" r={RING_R} className="wsh-ring-track" />
                      {team.arcs.map((x) => (
                        <circle key={x.key} cx="50" cy="50" r={RING_R} className="wsh-ring-arc" style={{ stroke: `rgb(var(${x.color}))` }} strokeDasharray={`${x.len} ${RING_C}`} strokeDashoffset={-x.at} transform="rotate(-90 50 50)" />
                      ))}
                    </svg>
                    <figcaption>
                      <span className="wsh-ring-n ui-num">{team.total}</span>
                      <span className="wsh-ring-l">{team.total === 1 ? 'person' : 'people'}</span>
                    </figcaption>
                  </figure>
                  <ul className="wsh-legend">
                    {team.mix.map((x) => (
                      <li key={x.key}>
                        <span className="wsh-legend-dot" style={{ background: `rgb(var(${x.color}))` }} aria-hidden="true" />
                        <span>{x.label}</span>
                        <span className="ui-num">{x.n}</span>
                      </li>
                    ))}
                  </ul>
                  {team.seats.length ? (
                    <div className="wsh-seats">
                      <p className="wsh-seats-title">People in each app</p>
                      <ul>
                        {team.seats.map((x) => (
                          <li key={x.app}>
                            <AppMark app={x.app} size={22} />
                            <span className="wsh-seat-name">{APP_NAME[x.app] || appName(x.app)}</span>
                            <span className="wsh-seat-bar" aria-hidden="true">
                              <span style={{ width: `${x.pct}%`, background: `rgb(var(${appInfo(x.app)?.color || '--cat-1'}))` }} />
                            </span>
                            <span className="wsh-seat-n ui-num">{x.used}{x.bought != null ? <small> / {x.bought}</small> : null}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* One company is already the Company overview card: the table only when there are two or more. */}
            {companiesTable && (companiesTable.length > 1 || !here) ? (
              <section className="wsh-card" aria-labelledby="ws-cos-title">
                <div className="wsh-card-head">
                  <h2 id="ws-cos-title" className="ws-h2"><E.building size={20} className="ws-head-ico" aria-hidden="true" />Companies</h2>
                  {go('companies') ? <button type="button" className="ws-link" onClick={go('companies')}>Add company <ChevronRight size={16} aria-hidden="true" /></button> : null}
                </div>
                {companiesTable.length ? (
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
                            <td>{c.archived ? <span className="ws-pill ws-pill--neutral">Archived</span> : c.gstin ? <span className="ws-pill ws-pill--ok">Active</span> : <span className="ws-pill ws-pill--warn">Needs GSTIN</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="ws-card-blurb">No companies yet.</p>
                )}
              </section>
            ) : null}

            <div className="wsh-pair">
              {plan ? (
                <Panel
                  icon={E.card}
                  title="Plan"
                  action={
                    go('billing') || go('account') ? (
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={go('billing') || go('account')}>
                        Manage
                      </button>
                    ) : null
                  }
                >
                  <div className="flex items-center gap-2">
                    <strong style={{ fontSize: '1.125rem' }}>{plan.name}</strong>
                    <span className={plan.inGoodStanding ? 'ws-pill ws-pill--ok' : 'ws-pill ws-pill--danger'}>{plan.inGoodStanding ? (renewal?.status === 'trialing' ? 'Trial' : 'Active') : planWord(plan.status)}</span>
                  </div>
                  <dl className="ws-rows">
                    {runRate !== undefined ? (
                      <div>
                        <dt>{renewal?.status === 'trialing' ? 'Each month after the trial' : 'Each month'}</dt>
                        <dd>
                          {runRate?.monthly != null ? <N>{rupees(runRate.monthly)}</N> : runRate?.unpriced?.length ? `Not priced yet (${runRate.unpriced.map((a) => APP_NAME[a] || a).join(', ')})` : 'Not priced yet'}
                          {runRate?.interval === 'year' ? <span className="ws-item-sub"> billed yearly</span> : null}
                        </dd>
                      </div>
                    ) : null}
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
                        <dd>
                          {bills.unpaid ? (
                            go('billing') ? (
                              <button type="button" className="ws-link" onClick={go('billing')}><N>{rupees(bills.due)}</N></button>
                            ) : (
                              <N>{rupees(bills.due)}</N>
                            )
                          ) : (
                            'Nothing'
                          )}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {/* Only where the plan sets a limit: "1, no limit" repeats the figures row. */}
                  {plan.limits?.maxCompanies != null ? <Meter label="Companies" used={usage?.companies ?? 0} limit={plan.limits.maxCompanies} /> : null}
                  {plan.limits?.maxUsers != null ? <Meter label="Users" used={usage?.users ?? 0} limit={plan.limits.maxUsers} /> : null}
                  {/* Only seats that were bought in a number; unmetered ones are on each app tile. */}
                  {seats ? seats.filter((x) => x.bought != null).map((x) => <Meter key={x.app} app={x.app} label={`${APP_NAME[x.app] || x.app} seats`} used={x.used} limit={x.bought} />) : null}
                </Panel>
              ) : null}

              {activity ? (
                <section className="wsh-card" aria-labelledby="ws-activity-title">
                  <div className="wsh-card-head">
                    <h2 id="ws-activity-title" className="ws-h2"><E.clock size={20} className="ws-head-ico" aria-hidden="true" />Recent activity</h2>
                    {go('accountActivity') ? (
                      <button type="button" className="ws-link" onClick={go('accountActivity')}>View all <ChevronRight size={16} aria-hidden="true" /></button>
                    ) : null}
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
                    <div className="wsh-calm">
                      <E.sparkles size={32} aria-hidden="true" />
                      <p className="ws-card-blurb">Nothing recorded yet. Invitations, role changes and sign-in settings show here as they happen.</p>
                    </div>
                  )}
                </section>
              ) : null}
            </div>

            {/* How well the account is guarded and how its connections are doing: two short reads, side by side. */}
            {security || (health && health.sources.length) ? (
              <div className="wsh-pair">
                {security ? (
                  <Panel
                    icon={E.shield}
                    title="Security"
                    action={
                      go('securityHome') ? (
                        <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={go('securityHome')}>
                          Open
                        </button>
                      ) : null
                    }
                  >
                    <Meter coverage label="Sign in with an authenticator" used={security.withTotp} limit={security.active || null} />
                    <p className="ws-item-sub" style={{ margin: 0 }}>
                      {privilegedNo2fa ? <><N>{privilegedNo2fa}</N> {privilegedNo2fa === 1 ? 'administrator has' : 'administrators have'} none yet.</> : 'Every administrator uses one.'}
                    </p>
                  </Panel>
                ) : null}

                {health && health.sources.length ? (
                  <Panel icon={E.link} title="Connections">
                    <ul className="ws-list">
                      {health.sources.map((x) => (
                        <li key={x.key}>
                          <div className="ws-item">
                            <span className="ws-item-text">
                              <span className="ws-item-title">{x.label}</span>
                              <span className="ws-item-sub">
                                {x.key === 'readers' ? <><N>{x.total}</N> active{x.issues ? <> · <N>{x.issues}</N> open {x.issues === 1 ? 'alert' : 'alerts'}</> : ''}</> : null}
                                {x.key === 'connectors' ? <><N>{x.total}</N> active{x.lastSeenAt ? ` · last heard ${ago(x.lastSeenAt)}` : ' · not connected yet'}</> : null}
                                {x.key === 'tally' ? <><N>{x.total}</N> this week{x.failed ? <> · <N>{x.failed}</N> failed</> : ''}{x.waiting ? <> · <N>{x.waiting}</N> waiting over a day</> : ''}</> : null}
                                {x.key === 'email' ? <><N>{x.total}</N> this week{x.issues ? <> · <N>{x.issues}</N> not delivered</> : ''}</> : null}
                              </span>
                            </span>
                            <span className={x.issues ? 'ws-pill ws-pill--warn' : 'ws-pill ws-pill--ok'}>{x.issues ? 'Needs a look' : 'Working'}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                ) : null}
              </div>
            ) : null}
          </div>

          <aside className="wsh-side" aria-label="Workspace side panel">
            {quick.length ? (
              <section className="wsh-card" aria-labelledby="wsh-quick-title">
                <div className="wsh-card-head">
                  <h2 id="wsh-quick-title" className="ws-h2"><E.bolt size={20} className="ws-head-ico" aria-hidden="true" />Quick actions</h2>
                </div>
                <ul className="wsh-quick">
                  {quick.map((q, qi) => {
                    const Icon = q.icon;
                    return (
                      <li key={q.key}>
                        <button type="button" className="wsh-quick-btn" onClick={go(q.key)} data-hue={HUES[qi % HUES.length]}>
                          <span className="wsh-quick-ico" aria-hidden="true"><Icon size={22} /></span>
                          <span className="wsh-quick-text">
                            <span className="wsh-quick-label">{q.label}</span>
                            <span className="wsh-quick-hint">{q.hint}</span>
                          </span>
                          <ChevronRight size={16} className="wsh-quick-go" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {/* The same rows as Quick actions: one icon square (40px, 22px icon) and one row height down the whole side column. */}
            <Panel icon={E.buoy} title="Help and support">
              <ul className="wsh-quick">
                <li>
                  <button type="button" className="wsh-quick-btn" data-hue="blue" onClick={() => requestOpenHelp('welcome')}>
                    <span className="wsh-quick-ico" aria-hidden="true"><E.books size={22} /></span>
                    <span className="wsh-quick-text">
                      <span className="wsh-quick-label">Help centre</span>
                      <span className="wsh-quick-hint">Guides for every app</span>
                    </span>
                    <ChevronRight size={16} className="wsh-quick-go" aria-hidden="true" />
                  </button>
                </li>
                {go('support') ? (
                  <li>
                    <button type="button" className="wsh-quick-btn" data-hue="orange" onClick={go('support')}>
                      <span className="wsh-quick-ico" aria-hidden="true"><E.chat size={22} /></span>
                      <span className="wsh-quick-text">
                        <span className="wsh-quick-label">Ask CLOR support</span>
                        <span className="wsh-quick-hint">{openTickets ? `${openTickets} open · see your tickets` : 'Open a ticket, answer by email'}</span>
                      </span>
                      <ChevronRight size={16} className="wsh-quick-go" aria-hidden="true" />
                    </button>
                  </li>
                ) : null}
                {operator.contactEmail ? (
                  <li>
                    <a className="wsh-quick-btn" data-hue="green" href={`mailto:${operator.contactEmail}`}>
                      <span className="wsh-quick-ico" aria-hidden="true"><E.letter size={22} /></span>
                      <span className="wsh-quick-text">
                        <span className="wsh-quick-label">Contact support</span>
                        <span className="wsh-quick-hint">{operator.contactEmail}</span>
                      </span>
                      <span />
                    </a>
                  </li>
                ) : null}
              </ul>
            </Panel>

            {planned.length && (go('apps') || openMoreApps) ? (
              <section className="wsh-promo" aria-labelledby="wsh-promo-title">
                <div className="wsh-promo-text">
                  <h2 id="wsh-promo-title" className="ws-h2">Get more from CLOR</h2>
                  <p>{planned.map((a) => a.name).join(' and ')} {planned.length === 1 ? 'is' : 'are'} on the way. See what each app does for your team.</p>
                  <button type="button" className="ws-btn ws-btn--primary ws-btn--small" onClick={go('apps') || (() => openMoreApps())}>
                    Explore apps <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </div>
                <E.cool size={72} className="wsh-promo-face" aria-hidden="true" />
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
