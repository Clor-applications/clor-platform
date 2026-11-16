import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Plus } from '@ui/components/ui/lineIcons';
import { emoji } from '@ui/components/ui/emoji';

import { accountAudit, getAccountMe, listAccountMembers, listInvitations, listTickets, memberDirectory } from '@platform/admin/account';
import { getAccountOverview } from '@platform/admin/admin';
import { operator } from '@platform/operator';
import { ACTION_WORDS } from './AccountActivity';
import { listOutsideAccess } from '@platform/admin/outsideAccess';
import { AppMark, Avatar, ICON, Meter, Panel, ago, appInfo, appName, productIcon, seatState } from './wsKit';
import { rupees, seatsByApp, securityOf } from './overviewFigures';
import { orgId, requestOpenHelp } from '@platform/context';
import { apiFetch } from '@platform/http';
import { getPolicy } from '@platform/admin/security';
import { setupSteps } from './SetupGuide';
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
const ROLE_LABEL = { OWNER: 'Account Owner', ADMIN: 'Account Admin', BILLING_ADMIN: 'Billing Admin', MEMBER: 'Member' };
/* One line under the greeting, by account role. Presentation only: what each can do is the server's. */
const ROLE_LEDE = {
  OWNER: 'Your workspace, applications and team, all in one place.',
  ADMIN: 'Manage your workspace and keep your team moving.',
};
const DEFAULT_LEDE = 'Your applications and work, all in one place.';

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
  return onPlan ? { key: 'off', label: 'Not switched on', pill: 'ws-pill ws-pill--off' } : { key: 'plan', label: 'Subscription required', pill: 'ws-pill' };
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
};

/** Good morning / afternoon / evening, by the reader's own clock. */
function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
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
 * The hero's illustration: a laptop showing a small Workspace dashboard. Drawn here, in the
 * app's own colours (graphite frame, Blaze marks, the chart palette), so it is never a stock
 * picture and needs no file. Decoration only; the hero hides it from screen readers.
 */
function WorkspaceArt() {
  const c = (v, a = 1) => `rgb(var(${v}) / ${a})`;
  return (
    <svg viewBox="0 0 280 200" width="280" height="200" focusable="false">
      <defs>
        <linearGradient id="wsh-art-bar" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="rgb(var(--marker))" />
          <stop offset="1" stopColor="rgb(var(--cat-4))" />
        </linearGradient>
        <linearGradient id="wsh-art-base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3A3F48" />
          <stop offset="1" stopColor="#202329" />
        </linearGradient>
      </defs>
      {/* Shadow on the desk */}
      <ellipse cx="140" cy="186" rx="118" ry="8" fill="rgb(16 18 22 / 0.12)" />
      {/* Screen */}
      <rect x="36" y="14" width="208" height="140" rx="12" fill="#202329" />
      <rect x="44" y="22" width="192" height="124" rx="6" fill="#FFFFFF" />
      {/* Side rail of the little app */}
      <rect x="44" y="22" width="26" height="124" rx="6" fill={c('--border', 0.6)} />
      <rect x="51" y="30" width="12" height="12" rx="3" fill="rgb(var(--marker))" />
      <rect x="52" y="52" width="10" height="4" rx="2" fill={c('--fg-subtle', 0.5)} />
      <rect x="52" y="64" width="10" height="4" rx="2" fill={c('--fg-subtle', 0.35)} />
      <rect x="52" y="76" width="10" height="4" rx="2" fill={c('--fg-subtle', 0.35)} />
      <rect x="52" y="88" width="10" height="4" rx="2" fill={c('--fg-subtle', 0.35)} />
      {/* Header line and a primary button */}
      <rect x="80" y="30" width="62" height="7" rx="3.5" fill="#202329" />
      <rect x="80" y="41" width="40" height="4" rx="2" fill={c('--fg-subtle', 0.45)} />
      <rect x="196" y="30" width="32" height="12" rx="4" fill="#202329" />
      {/* Three figure tiles */}
      <rect x="80" y="52" width="44" height="22" rx="5" fill={c('--cat-2', 0.14)} />
      <rect x="130" y="52" width="44" height="22" rx="5" fill={c('--cat-1', 0.14)} />
      <rect x="180" y="52" width="48" height="22" rx="5" fill={c('--cat-3', 0.16)} />
      <rect x="86" y="58" width="14" height="5" rx="2.5" fill={c('--cat-2')} />
      <rect x="136" y="58" width="18" height="5" rx="2.5" fill={c('--cat-1')} />
      <rect x="186" y="58" width="12" height="5" rx="2.5" fill={c('--cat-3')} />
      <rect x="86" y="66" width="26" height="3" rx="1.5" fill={c('--fg-subtle', 0.4)} />
      <rect x="136" y="66" width="26" height="3" rx="1.5" fill={c('--fg-subtle', 0.4)} />
      <rect x="186" y="66" width="30" height="3" rx="1.5" fill={c('--fg-subtle', 0.4)} />
      {/* Bar chart */}
      <rect x="80" y="80" width="88" height="58" rx="5" fill="none" stroke={c('--border')} />
      {[[88, 30], [100, 20], [112, 38], [124, 26], [136, 44], [148, 34]].map(([x, h]) => (
        <rect key={x} x={x} y={132 - h} width="8" height={h} rx="2.5" fill="url(#wsh-art-bar)" className="wsh-art-bar" />
      ))}
      {/* Line chart and team */}
      <rect x="174" y="80" width="54" height="58" rx="5" fill="none" stroke={c('--border')} />
      <polyline points="180,118 190,108 200,112 210,96 222,90" fill="none" stroke={c('--cat-7')} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="222" cy="90" r="3" fill={c('--cat-7')} />
      <circle cx="184" cy="129" r="4.5" fill={c('--cat-5')} />
      <circle cx="192" cy="129" r="4.5" fill={c('--cat-1')} />
      <circle cx="200" cy="129" r="4.5" fill={c('--cat-3')} />
      {/* Camera dot, hinge and base */}
      <circle cx="140" cy="18" r="1.6" fill="#4A4F58" />
      <path d="M14 156 H266 L254 176 Q252 180 246 180 H34 Q28 180 26 176 Z" fill="url(#wsh-art-base)" />
      <rect x="116" y="156" width="48" height="5" rx="2.5" fill="#4A4F58" />
      {/* The CLOR orange mark on a floating badge */}
      <g className="wsh-art-badge">
        <rect x="216" y="2" width="40" height="40" rx="10" fill="#FFFFFF" stroke={c('--border')} />
        <path d="M228 14 h10 v5 h-5 v11 h-5 Z M244 28 h-10 v-5 h5 v-11 h5 Z" fill="rgb(var(--logo-mark, 255 84 0))" />
      </g>
    </svg>
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
  const attentionRef = useRef(null);

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
      })
      /* No answer hides what depends on it; nothing is guessed. */
      .catch(() => live && setMe(null));
    return () => {
      live = false;
    };
  }, [tenant?.id]);

  const loading = me === undefined;
  const role = me?.role || null;
  const myApps = Array.isArray(me?.apps) ? me.apps : null;
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const seesPlan = role === 'OWNER' || role === 'BILLING_ADMIN';
  const may = new Set(navItems.map((n) => n.key));
  const go = (key) => (may.has(key) ? () => openScreen?.(key) : null);

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
  /* Seats for the apps that are built and on the account; Workspace itself is not a seat. */
  const seatApps = built.filter((a) => (tenant?.subscriptions || []).includes(a.id) || (overview?.seats || []).some((x) => x.app === a.id)).map((a) => a.id);
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
    planBad ? { key: 'plan', tag: 'Plan', action: 'Open plan', icon: ICON.alert, tone: 'danger', title: 'Your plan needs attention', sub: `Status: ${String(plan.status || '').toLowerCase()}.`, go: go('account') } : null,
    seesPlan && bills?.overdue ? { key: 'overdue', tag: 'Overdue', action: 'Pay now', icon: ICON.plan, tone: 'danger', title: `${plural(bills.overdue, 'CLOR invoice')} overdue`, sub: <><N>{rupees(bills.due)}</N> to pay in all. Open Billing to pay.</>, go: go('billing') } : null,
    renewalLine ? { key: 'renewal', tag: 'Plan', action: 'Choose plan', icon: ICON.plan, ...renewalLine, go: go('account') } : null,
    ...seatLines,
    ...endingLines,
    ...waitingLines,
    health?.status === 'attention' ? { key: 'sync', tag: 'Sync', icon: ICON.data, tone: 'warn', title: `${plural(health.issues, 'sync problem')}`, sub: health.alerts?.[0]?.title || health.sources.filter((x) => x.issues).map((x) => x.label).join(', '), go: null } : null,
    privilegedNo2fa ? { key: '2fa', tag: 'Security', action: 'Review members', icon: ICON.warning, tone: 'warn', title: `${privilegedNo2fa} administrator${privilegedNo2fa === 1 ? '' : 's'} without an authenticator`, sub: 'They can change who has access; ask them to switch it on.', go: go('members') } : null,
    seesPlan && bills?.unpaid && !bills.overdue ? { key: 'unpaid', tag: 'Invoice', action: 'Pay', icon: ICON.plan, tone: null, title: `${plural(bills.unpaid, 'CLOR invoice')} to pay`, sub: <><N>{rupees(bills.due)}</N> due. Not overdue yet.</>, go: go('billing') } : null,
    pending ? { key: 'inv', tag: 'Invited', action: 'View invitations', icon: ICON.invite, tone: null, title: `${pending} pending invitation${pending === 1 ? '' : 's'}`, sub: 'Waiting for people to accept.', go: go('invitations') } : null,
    notAssigned.length ? { key: 'na', tag: 'Access', icon: ICON.person, tone: null, title: `You can’t open ${notAssigned.map((s) => s.app.name).join(', ')} yet`, sub: 'An administrator gives access with a role.', go: null } : null,
    noGstin.length ? { key: 'gstin', tag: 'Missing', pill: 'danger', action: 'Add GSTIN', icon: ICON.company, tone: null, title: noGstin.length === 1 ? `${noGstin[0].name} has no GSTIN` : `${noGstin.length} companies have no GSTIN`, sub: noGstin.length === 1 ? 'Invoices from this company cannot be e-invoiced until it is added.' : `${noGstin.map((c) => c.name).join(', ')}: invoices cannot be e-invoiced until each is added.`, go: go('companies') } : null,
  ].filter(Boolean);
  const repliedTo = (tickets || []).filter((t) => t.status === 'WAITING');
  /* CLOR answered and waits on the customer: after the urgent items, before the routine ones. */
  const firstCalm = attention.findIndex((a) => a.tone !== 'danger' && a.tone !== 'warn');
  if (repliedTo.length) attention.splice(firstCalm < 0 ? attention.length : firstCalm, 0, { key: 'tickets', tag: 'Support', action: 'Reply', icon: ICON.chat, tone: 'brand', title: repliedTo.length === 1 ? `CLOR replied to ${repliedTo[0].code}` : `CLOR replied to ${repliedTo.length} tickets`, sub: repliedTo.length === 1 ? repliedTo[0].subject : 'They are waiting for your answer.', go: go('support') });
  const urgent = attention.filter((a) => a.tone === 'danger' || a.tone === 'warn').length;

  const name = firstName(user);
  const account = accountName || overview?.account?.name || tenant?.name || '';
  const companyCount = entities?.companies ?? (overview ? (overview.companies || []).filter((c) => !c.archived).length : null);
  const memberCount = activeMembers ?? (security ? security.active : null);
  /* One line of facts under the greeting, each only when it was read. */
  const facts = [
    account || null,
    companyCount != null ? plural(companyCount, 'company', 'companies') : null,
    `${onCount} of ${built.length} apps`,
    memberCount != null ? plural(memberCount, 'member') : null,
  ].filter(Boolean);
  const companiesTable = isAdmin && overview ? (overview.companies || []) : null;

  /* What waits on this person, in all: the same sources the attention list shows. */
  const waitingTotal = waiting ? (waiting.sources || []).filter((x) => !myApps || myApps.includes(x.open.app)).reduce((n, x) => n + (Number(x.count) || 0), 0) : null;

  /* Setup, from the same steps as the rail's Setup guide: owners and administrators only. */
  const steps = isAdmin && overview && directory && setupFacts
    ? setupSteps({ tenantId: tenant?.id, overview, profile: setupFacts.profile, directory: { members: directory }, invitations: invites || [], policy: setupFacts.policy })
    : null;
  const stepsDone = steps ? steps.filter((x) => x.done).length : 0;
  const nextStep = steps ? steps.find((x) => !x.done) : null;
  const here = (overview?.companies || []).find((c) => c.orgId === tenant?.id) || (overview?.companies || [])[0] || null;

  /* By id, not the ref: the handler is made during render (react-hooks/refs). */
  /* Until the account's figures are in, an owner's attention list is not complete: no "0" and no "nothing needs you" yet. */
  const settled = !loading && (!(isAdmin || seesPlan) || overview !== null);
  const scrollToAttention = () => document.getElementById('ws-attn-title')?.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  /* The figures across the top: each a fact the server gave, each opening the screen that owns it. */
  const tiles = [
    companyCount != null ? { key: 'companies', icon: E.building, cat: 1, value: companyCount, label: companyCount === 1 ? 'Company' : 'Companies', go: go('companies') } : null,
    { key: 'apps', icon: E.rocket, cat: 7, value: onCount, label: onCount === 1 ? 'Active app' : 'Active apps', note: `of ${built.length}`, go: go('apps') },
    memberCount != null ? { key: 'members', icon: E.people, cat: 5, value: memberCount, label: memberCount === 1 ? 'Member' : 'Members', go: go('members') } : null,
    waitingTotal != null ? { key: 'waiting', icon: E.inbox, cat: 3, value: waitingTotal, label: 'Waiting on you', go: go('inbox') } : null,
    settled ? { key: 'attention', icon: E.bell, cat: 8, value: attention.length, label: attention.length === 1 ? 'Needs attention' : 'Need attention', go: attention.length ? scrollToAttention : null } : null,
    steps ? { key: 'setup', icon: E.clipboard, cat: 6, value: `${stepsDone}/${steps.length}`, label: stepsDone === steps.length ? 'Setup done' : 'Setup steps done', go: nextStep && go(nextStep.screen) ? go(nextStep.screen) : null } : null,
  ].filter(Boolean);

  /* Team and access: who is in the account, and how many people each app has (seats from the directory). */
  const team = isAdmin && members
    ? (() => {
        const mix = [
          { key: 'active', label: 'Active', n: members.filter((m) => m.status === 'ACTIVE').length, color: '--cat-3' },
          { key: 'invited', label: 'Invited', n: pending || 0, color: '--cat-4' },
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

  /* Shortcuts to the jobs an administrator comes here for; each only when this person may open its screen. */
  const quick = [
    { key: 'companies', icon: E.building, label: 'Add company', hint: 'Another business in this account', cat: 1 },
    { key: 'invitations', icon: E.mail, label: 'Invite member', hint: 'Send an email invitation', cat: 5 },
    { key: 'roles', icon: E.key, label: 'Manage access', hint: 'Roles and what each may do', cat: 4 },
    { key: 'apps', icon: E.puzzle, label: 'Apps', hint: 'Switch apps on, see what is coming', cat: 3 },
    { key: 'billing', icon: E.card, label: 'Billing', hint: 'Plan, seats and invoices', cat: 6 },
    { key: 'integrations', icon: E.link, label: 'Integrations', hint: 'Readers, Tally, single sign-on', cat: 7 },
    { key: 'securityHome', icon: E.locked, label: 'Security', hint: 'Sign-in, sessions and two-factor', cat: 8 },
  ].filter((q) => may.has(q.key));


  return (
    <div className="ws wsh">
      <div className="ws-inner wsh-inner">
        {/* Hero: who you are, where you are, and the one primary action. */}
        <section className="wsh-hero" aria-labelledby="wsh-hello">
          <div className="wsh-hero-text">
            <p className="wsh-eyebrow">Welcome to CLOR Workspace</p>
            <h1 id="wsh-hello" className="wsh-hello">
              {greeting()}
              {name ? <>, <span className="wsh-name">{name}</span></> : null}
              <E.wave size={36} className="wsh-wave" aria-hidden="true" />
            </h1>
            <p className="wsh-lede">{ROLE_LEDE[role] || DEFAULT_LEDE}</p>
            <p className="wsh-facts">
              <span>{facts.join(' · ')}</span>
              {role ? <span className="ws-pill ws-pill--neutral">{ROLE_LABEL[role] || role}</span> : null}
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
          {/* Decoration only: a few friendly faces and the things a workspace holds. */}
          <div className="wsh-stage" aria-hidden="true">
            <span className="wsh-orb" />
            <span className="wsh-art"><WorkspaceArt /></span>
            <span className="wsh-chip wsh-chip--1"><E.people size={30} /></span>
            <span className="wsh-chip wsh-chip--2"><E.chart size={30} /></span>
            <span className="wsh-chip wsh-chip--3"><E.calendar size={30} /></span>
            <span className="wsh-chip wsh-chip--4"><E.check size={30} /></span>
            <span className="wsh-chip wsh-chip--5"><E.rocket size={26} /></span>
            <span className="wsh-chip wsh-chip--6"><E.party size={26} /></span>
            <span className="wsh-deco wsh-deco--coffee"><E.coffee size={34} /></span>
            <span className="wsh-deco wsh-deco--spark"><E.sparkles size={24} /></span>
          </div>
        </section>

        {/* The workspace in figures. */}
        {tiles.length ? (
          <ul className="wsh-tiles" aria-label="Workspace at a glance">
            {tiles.map((t) => {
              const Icon = t.icon;
              const body = (
                <>
                  <span className="wsh-tile-ico" aria-hidden="true"><Icon size={26} /></span>
                  <span className="wsh-tile-text">
                    <span className="wsh-tile-value ui-num">{t.value}{t.note ? <small> {t.note}</small> : null}</span>
                    <span className="wsh-tile-label">{t.label}</span>
                  </span>
                  {t.go ? <ChevronRight size={16} className="wsh-tile-go" aria-hidden="true" /> : null}
                </>
              );
              return (
                <li key={t.key} style={{ '--tile': `var(--cat-${t.cat})` }}>
                  {t.go ? <button type="button" className="wsh-tile" onClick={t.go}>{body}</button> : <div className="wsh-tile">{body}</div>}
                </li>
              );
            })}
          </ul>
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
            {team ? (
              <section className="wsh-card" aria-labelledby="wsh-team-title">
                <div className="wsh-card-head">
                  <h2 id="wsh-team-title" className="ws-h2">Team and access</h2>
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

            <div className="wsh-pair">
              <section ref={attentionRef} className="wsh-card" style={{ scrollMarginTop: 16 }} aria-labelledby="ws-attn-title">
                <div className="wsh-card-head">
                  <h2 id="ws-attn-title" className="ws-h2">
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
                  <div style={{ display: 'grid', gap: 12 }} aria-hidden="true">
                    <span className="ui-skel ui-skel-text" />
                    <span className="ui-skel ui-skel-text" style={{ width: '60%' }} />
                  </div>
                ) : attention.length ? (
                  <ul className="wsh-attn" aria-label={urgent ? `${plural(urgent, 'urgent item')}` : 'Nothing urgent'}>
                    {attention.map((a) => {
                      const Icon = a.icon || ICON.alert;
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
                    <h2 id="wsh-co-title" className="ws-h2">Company overview</h2>
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
                  <dl className="wsh-co-figs">
                    <div><dt>Members</dt><dd className="ui-num">{here.people ?? 0}</dd></div>
                    <div><dt>Apps</dt><dd className="ui-num">{(here.apps || []).length}</dd></div>
                    {entities?.branches != null ? <div><dt>Branches</dt><dd className="ui-num">{entities.branches}</dd></div> : null}
                  </dl>
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
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>

            {/* One company is already the Company overview card: the table only when there are two or more. */}
            {companiesTable && (companiesTable.length > 1 || !here) ? (
              <section className="wsh-card" aria-labelledby="ws-cos-title">
                <div className="wsh-card-head">
                  <h2 id="ws-cos-title" className="ws-h2">Companies</h2>
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
                  title="Subscription"
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
                    <span className={plan.inGoodStanding ? 'ws-pill ws-pill--ok' : 'ws-pill ws-pill--danger'}>{plan.inGoodStanding ? (renewal?.status === 'trialing' ? 'Trial' : 'Active') : String(plan.status || '').toLowerCase()}</span>
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
                  <Meter label="Companies" used={usage?.companies ?? 0} limit={plan.limits?.maxCompanies ?? null} />
                  <Meter label="Users" used={usage?.users ?? 0} limit={plan.limits?.maxUsers ?? null} />
                  {/* Only seats that were bought in a number; unmetered ones are on each app tile. */}
                  {seats ? seats.filter((x) => x.bought != null).map((x) => <Meter key={x.app} app={x.app} label={`${APP_NAME[x.app] || x.app} seats`} used={x.used} limit={x.bought} />) : null}
                </Panel>
              ) : null}

              {health && health.sources.length ? (
                <Panel title="Connections">
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
          </div>

          <aside className="wsh-side" aria-label="Workspace side panel">
            {quick.length ? (
              <section className="wsh-card" aria-labelledby="wsh-quick-title">
                <div className="wsh-card-head">
                  <h2 id="wsh-quick-title" className="ws-h2">Quick actions</h2>
                </div>
                <ul className="wsh-quick">
                  {quick.map((q) => {
                    const Icon = q.icon;
                    return (
                      <li key={q.key}>
                        <button type="button" className="wsh-quick-btn" onClick={go(q.key)} style={{ '--tile': `var(--cat-${q.cat})` }}>
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

            {activity ? (
              <section className="wsh-card" aria-labelledby="ws-activity-title">
                <div className="wsh-card-head">
                  <h2 id="ws-activity-title" className="ws-h2">Recent activity</h2>
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
                              {ACTION_WORDS[e.action] || e.action}
                              {e.targetName ? `: ${e.targetName}` : ''}
                            </span>
                          </span>
                          <span className="wsh-feed-when">{ago(e.at)}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="ws-card-blurb">No activity yet.</p>
                )}
              </section>
            ) : null}

            {security ? (
              <Panel
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

            <Panel title="Help and support">
              <ul className="ws-list">
                {[
                  ['welcome', 'Help centre', 'Guides for the Workspace and every app'],
                  ['setup', 'Set up your workspace', 'The four steps to a ready company'],
                  ['readers', 'Integrations', 'Readers, Tally, HR tools, single sign-on'],
                ].map(([topic, title, sub]) => (
                  <li key={title}>
                    <button type="button" className="ws-item ws-item--button" onClick={() => requestOpenHelp(topic)}>
                      <span className="ws-item-text">
                        <span className="ws-item-title">{title}</span>
                        <span className="ws-item-sub">{sub}</span>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
                {go('support') ? (
                  <li>
                    <button type="button" className="ws-item ws-item--button" onClick={go('support')}>
                      <span className="ws-item-text">
                        <span className="ws-item-title">Ask CLOR support</span>
                        <span className="ws-item-sub">{tickets?.some((t) => t.status === 'OPEN' || t.status === 'WAITING') ? `${tickets.filter((t) => t.status === 'OPEN' || t.status === 'WAITING').length} open · see your tickets` : 'Open a ticket and get the answer by email'}</span>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </li>
                ) : null}
                {operator.contactEmail ? (
                  <li>
                    <a className="ws-item" href={`mailto:${operator.contactEmail}`}>
                      <span className="ws-item-text">
                        <span className="ws-item-title">Contact support</span>
                        <span className="ws-item-sub">{operator.contactEmail}</span>
                      </span>
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
