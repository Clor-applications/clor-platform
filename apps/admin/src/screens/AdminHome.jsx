import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronRight } from '@ui/components/ui/lineIcons';

import { accountAudit, getAccountMe, listAccountMembers, listInvitations, listTickets, memberDirectory } from '@platform/admin/account';
import { getAccountOverview } from '@platform/admin/admin';
import { operator } from '@platform/operator';
import { ACTION_WORDS } from './AccountActivity';
import { ICON, Meter, Panel, Stat, ago, productIcon } from './wsKit';
import { rupees, seatsByApp, securityOf } from './overviewFigures';
import { orgId, requestOpenHelp } from '@platform/context';
import { apiFetch } from '@platform/http';
import './workspace.css';

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

const firstName = (user) => String(user?.firstName || user?.fullName || '').trim().split(/\s+/)[0] || '';


/** The one waiting number from People (approvals, leave, attendance requests and own tasks): this company, this reader. */
const getWaiting = () => apiFetch(`/orgs/${encodeURIComponent(orgId())}/people/inbox/waiting`, { skipWarehouseHeader: true });

const dateWords = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const inDays = (n) => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

/** What the subscription itself needs said (server: subscriptionWatch). Lapsed is the plan line's, said once. */
export function renewalNotice(renewal, planBad = false) {
  if (!renewal) return null;
  if (renewal.warn === 'trial-ending') return { tone: 'warn', title: `Your trial ends ${inDays(renewal.daysLeft)}`, sub: `On ${dateWords(renewal.endsAt)}. Choose a plan to keep your apps open.` };
  if (renewal.warn === 'ending') return { tone: 'warn', title: `Your plan stops ${inDays(renewal.daysLeft)}`, sub: `It is set to end on ${dateWords(renewal.endsAt)} and not renew.` };
  if (renewal.warn === 'lapsed' && !planBad) return { tone: 'danger', title: 'Your plan has lapsed', sub: 'Your data is safe; renew to keep working in your apps.' };
  return null;
}

function SkeletonStats() {
  return (
    <div className="ws-stats" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="ws-stat" style={{ display: 'grid', gap: 8 }}>
          <span className="ui-skel ui-skel-text" style={{ width: '40%' }} />
          <span className="ui-skel" style={{ height: 24, width: '30%', borderRadius: 8 }} />
          <span className="ui-skel ui-skel-text" style={{ width: '70%' }} />
        </div>
      ))}
    </div>
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
  const attentionRef = useRef(null);

  useEffect(() => {
    let live = true;
    getAccountMe()
      .then((r) => {
        if (!live) return;
        setMe(r || null);
        const role = r?.role;
        if (role === 'OWNER' || role === 'ADMIN' || role === 'BILLING_ADMIN') getAccountOverview().then((o) => live && setOverview(o)).catch(() => {});
        if (role === 'OWNER' || role === 'ADMIN') {
          listAccountMembers().then((m) => live && setMembers(m?.members || [])).catch(() => {});
          listInvitations().then((x) => live && setPending((x?.invitations || []).filter((i) => i.status === 'PENDING').length)).catch(() => {});
          accountAudit({ limit: 6 }).then((a) => live && setActivity(a?.events || [])).catch(() => {});
          memberDirectory()
            .then((d) => live && setDirectory(d?.members || []))
            .catch(() => {});
        }
        listTickets().then((t) => live && setTickets(t?.tickets || [])).catch(() => {});
        /* What waits on this person in People or Attendance, for anyone who can open either here. */
        const apps = Array.isArray(r?.apps) ? r.apps : [];
        if (apps.includes('people') || apps.includes('attendance')) getWaiting().then((w) => live && setWaiting(w || null)).catch(() => {});
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
  const openable = states.filter((s) => s.state.key === 'open');
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
  const seatsInUse = seats ? seats.reduce((n, x) => n + x.used, 0) : null;
  const seatsBought = seats && seats.every((x) => x.bought != null) ? seats.reduce((n, x) => n + x.bought, 0) : null;
  const inboxApp = myApps?.includes('people') ? 'people' : myApps?.includes('attendance') ? 'attendance' : null;
  const planBad = plan && plan.inGoodStanding === false;
  const renewalLine = seesPlan ? renewalNotice(renewal, planBad) : null;

  /* Needs your attention: only what is true and actionable, the most urgent first. */
  const attention = [
    planBad ? { key: 'plan', icon: ICON.alert, tone: 'danger', title: 'Your plan needs attention', sub: `Status: ${String(plan.status || '').toLowerCase()}.`, go: go('account') } : null,
    seesPlan && bills?.overdue ? { key: 'overdue', icon: ICON.plan, tone: 'danger', title: `${plural(bills.overdue, 'CLOR invoice')} overdue`, sub: <><N>{rupees(bills.due)}</N> to pay in all. Open Billing to pay.</>, go: go('billing') } : null,
    renewalLine ? { key: 'renewal', icon: ICON.plan, ...renewalLine, go: go('account') } : null,
    waiting?.waiting ? { key: 'waiting', icon: ICON.history, tone: 'brand', title: `${plural(waiting.waiting, 'thing')} waiting for you`, sub: [waiting.approvals ? plural(waiting.approvals, 'approval') : '', waiting.tasks ? plural(waiting.tasks, 'task') : ''].filter(Boolean).join(' · ') || 'In your inbox.', go: inboxApp ? () => openApp?.(inboxApp) : null } : null,
    health?.status === 'attention' ? { key: 'sync', icon: ICON.data, tone: 'warn', title: `${plural(health.issues, 'sync problem')}`, sub: health.alerts?.[0]?.title || health.sources.filter((x) => x.issues).map((x) => x.label).join(', '), go: null } : null,
    privilegedNo2fa ? { key: '2fa', icon: ICON.warning, tone: 'warn', title: `${privilegedNo2fa} administrator${privilegedNo2fa === 1 ? '' : 's'} without an authenticator`, sub: 'They can change who has access; ask them to switch it on.', go: go('members') } : null,
    seesPlan && bills?.unpaid && !bills.overdue ? { key: 'unpaid', icon: ICON.plan, tone: null, title: `${plural(bills.unpaid, 'CLOR invoice')} to pay`, sub: <><N>{rupees(bills.due)}</N> due. Not overdue yet.</>, go: go('billing') } : null,
    pending ? { key: 'inv', icon: ICON.invite, tone: null, title: `${pending} pending invitation${pending === 1 ? '' : 's'}`, sub: 'Waiting for people to accept.', go: go('invitations') } : null,
    notAssigned.length ? { key: 'na', icon: ICON.person, tone: null, title: `You can’t open ${notAssigned.map((s) => s.app.name).join(', ')} yet`, sub: 'An administrator gives access with a role.', go: null } : null,
    isAdmin && overview && overview.companies?.some((c) => !c.gstin && !c.archived) ? { key: 'gstin', icon: ICON.company, tone: null, title: 'Company details incomplete', sub: `${overview.companies.filter((c) => !c.gstin && !c.archived).map((c) => c.name).join(', ')}: no GSTIN on record.`, go: go('companies') } : null,
  ].filter(Boolean);
  const repliedTo = (tickets || []).filter((t) => t.status === 'WAITING');
  /* CLOR answered and waits on the customer: after the urgent items, before the routine ones. */
  const firstCalm = attention.findIndex((a) => a.tone !== 'danger' && a.tone !== 'warn');
  if (repliedTo.length) attention.splice(firstCalm < 0 ? attention.length : firstCalm, 0, { key: 'tickets', icon: ICON.chat, tone: 'brand', title: repliedTo.length === 1 ? `CLOR replied to ${repliedTo[0].code}` : `CLOR replied to ${repliedTo.length} tickets`, sub: repliedTo.length === 1 ? repliedTo[0].subject : 'They are waiting for your answer.', go: go('support') });
  const urgent = attention.filter((a) => a.tone === 'danger' || a.tone === 'warn').length;

  const name = firstName(user);
  const toAttention = () => attentionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="ws">
      <div className="ws-inner">
        <section className="ws-hero" aria-labelledby="ws-hero-title">
          <div className="ws-hero-row">
            <div className="ws-hero-text">
              <p className="ws-hero-crumb">
                <ICON.companies size={18} />
                <span className="ws-hero-account" title={accountName || overview?.account?.name || tenant?.name || ''}>
                  {accountName || overview?.account?.name || tenant?.name || 'Your account'}
                </span>
                {role ? <span className="ws-pill ws-pill--ok">{ROLE_LABEL[role] || role}</span> : null}
              </p>
              <h1 id="ws-hero-title" className="ws-hero-title">{name ? `Welcome back, ${name}` : 'Welcome back'}</h1>
              <p className="ws-hero-lede">{ROLE_LEDE[role] || DEFAULT_LEDE}</p>
            </div>
            {isAdmin && go('invitations') ? (
              <button type="button" className="ws-btn ws-btn--primary ws-hero-action" onClick={go('invitations')}>
                <ICON.invite size={18} aria-hidden="true" /> Add people
              </button>
            ) : null}
          </div>
        </section>

        {loading ? (
          <SkeletonStats />
        ) : (
          <div className="ws-stats" aria-label="Your business at a glance">
            {entities ? (
              <Stat
                icon={ICON.companies}
                label="Companies"
                value={<N>{entities.companies}</N>}
                note={
                  <>
                    <N>{entities.branches}</N> {entities.branches === 1 ? 'branch' : 'branches'} · <N>{entities.taxProfiles}</N> GST {entities.taxProfiles === 1 ? 'registration' : 'registrations'}
                  </>
                }
                onOpen={go('companies')}
              />
            ) : null}
            {seats ? (
              <Stat
                icon={ICON.people}
                label="Team"
                value={<N>{activeMembers ?? security.active}</N>}
                note={seatsBought != null ? <><N>{seatsInUse}</N> of <N>{seatsBought}</N> seats in use</> : <><N>{seatsInUse}</N> app {seatsInUse === 1 ? 'seat' : 'seats'} in use{pending ? <> · <N>{pending}</N> invited</> : null}</>}
                onOpen={go('members')}
              />
            ) : null}
            <Stat
              icon={ICON.apps}
              label="Applications"
              value={<><N>{onCount}</N> <span className="ws-stat-of">of <N>{built.length}</N></span></>}
              note={myApps ? (openable.length ? `You can open ${plural(openable.length, 'app')}` : 'None open to you yet') : 'Switched on for this company'}
              onOpen={openMoreApps ? () => openMoreApps() : null}
            />
            <Stat
              icon={urgent ? ICON.warning : ICON.alert}
              tone={attention.some((a) => a.tone === 'danger') ? 'danger' : urgent ? 'warn' : null}
              label="Needs attention"
              value={attention.length ? <N>{attention.length}</N> : 'All clear'}
              note={attention.length ? (urgent ? `${plural(urgent, 'urgent item')}` : 'Nothing urgent') : 'Nothing needs you right now'}
              onOpen={attention.length ? toAttention : null}
            />
          </div>
        )}

        <div className="ws-layout">
          <div className="ws-main">
            <div ref={attentionRef} style={{ scrollMarginTop: 16 }}>
              <Panel title="Needs your attention">
                {loading ? (
                  <div style={{ display: 'grid', gap: 12 }} aria-hidden="true">
                    <span className="ui-skel ui-skel-text" />
                    <span className="ui-skel ui-skel-text" style={{ width: '60%' }} />
                  </div>
                ) : attention.length ? (
                  <ul className="ws-list">
                    {attention.map((a) => {
                      const body = (
                        <>
                          <span className={`ws-tile${a.tone ? ` ws-tile--${a.tone}` : ''}`} aria-hidden="true">
                            <a.icon size={18} />
                          </span>
                          <span className="ws-item-text">
                            <span className="ws-item-title">{a.title}</span>
                            <span className="ws-item-sub">{a.sub}</span>
                          </span>
                          {a.go ? <ChevronRight size={16} aria-hidden="true" /> : null}
                        </>
                      );
                      return <li key={a.key}>{a.go ? <button type="button" className="ws-item" onClick={a.go}>{body}</button> : <div className="ws-item">{body}</div>}</li>;
                    })}
                  </ul>
                ) : (
                  <p className="ws-card-blurb">Nothing needs you right now.</p>
                )}
              </Panel>
            </div>

            <section className="ws-section" aria-labelledby="ws-apps-title">
              <div className="ws-section-head">
                <h2 id="ws-apps-title" className="ws-h2">My applications</h2>
                {openMoreApps ? (
                  <button type="button" className="ws-link" onClick={() => openMoreApps()}>
                    Manage apps <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <ul className="ws-apps" role="list" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))' }}>
                {states.map(({ app: a, state: s }) => {
                  const Icon = productIcon(a.id);
                  const open = s.key === 'open';
                  const seat = seats?.find((x) => x.app === a.id);
                  return (
                    <li key={a.id}>
                      <article className={`ws-card${open ? ' is-open' : ''}`}>
                        <div className="ws-card-top">
                          <span className="ws-tile">
                            <Icon size={22} />
                          </span>
                          <div className="ws-card-id" style={{ display: 'grid', justifyItems: 'start' }}>
                            <h3 className="ws-card-name">{a.name}</h3>
                            <span className={s.pill}>{s.label}</span>
                          </div>
                        </div>
                        <p className="ws-card-blurb ws-clamp-2" style={{ marginTop: 0 }} title={a.blurb}>{a.blurb}</p>
                        {seat ? (
                          <p className="ws-item-sub" style={{ margin: 0 }}>
                            <N>{seat.used}</N> {seat.bought != null ? <>of <N>{seat.bought}</N> seats</> : seat.used === 1 ? 'person has access' : 'people have access'}
                          </p>
                        ) : null}
                        <div className="mt-auto">
                          {open ? (
                            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small ws-card-link" onClick={() => openApp?.(a.id)}>
                              Open {a.name} <ArrowRight size={14} aria-hidden="true" />
                            </button>
                          ) : s.key === 'off' && openMoreApps ? (
                            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => openMoreApps()}>
                              See how to add it
                            </button>
                          ) : (
                            <span className="ws-item-sub">{s.key === 'noaccess' ? 'Ask an administrator for a role.' : s.key === 'plan' ? 'Contact CLOR to add it to your plan.' : ''}</span>
                          )}
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
              {planned.length ? (
                <ul className="ws-apps" role="list" aria-label="Apps on the way" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' }}>
                  {planned.map((a) => {
                    const Icon = productIcon(a.id);
                    return (
                      <li key={a.id}>
                        <article className="ws-card is-soon" style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <span className="ws-tile">
                            <Icon size={22} />
                          </span>
                          <span className="ws-item-text">
                            <span className="ws-item-title">
                              {a.name} <span className="ws-pill" style={{ marginLeft: 6 }}>Coming soon</span>
                            </span>
                            <span className="ws-item-sub">{a.blurb}</span>
                          </span>
                        </article>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>

            {myApps && myApps.length === 0 ? (
              <section className="ws-setup" role="status" aria-labelledby="ws-noaccess-title">
                <h2 id="ws-noaccess-title" className="ws-h2">No app access yet</h2>
                <p className="ws-card-blurb">You are in {tenant?.name || 'this company'}, but no app is open to you yet. An administrator gives access by giving you a role.</p>
              </section>
            ) : null}

            {activity || (health && health.sources.length) ? (
              <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
                {activity ? (
                  <Panel
                    title="Recent activity"
                    action={
                      go('accountActivity') ? (
                        <button type="button" className="ws-link" onClick={go('accountActivity')}>
                          View all <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      ) : null
                    }
                  >
                    {activity.length ? (
                      <ul className="ws-list">
                        {activity.map((e) => (
                          <li key={e.id}>
                            <div className="ws-item">
                              <span className={`ws-tile${e.result === 'DENIED' ? ' ws-tile--danger' : ''}`} aria-hidden="true">
                                {e.result === 'DENIED' ? <ICON.warning size={18} /> : <ICON.history size={18} />}
                              </span>
                              <span className="ws-item-text">
                                <span className="ws-item-title">
                                  {ACTION_WORDS[e.action] || e.action}
                                  {e.targetName ? `: ${e.targetName}` : ''}
                                </span>
                                <span className="ws-item-sub">{e.actor?.name || 'Someone'}</span>
                              </span>
                              <span className="ws-item-end">{ago(e.at)}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ws-card-blurb">No activity yet.</p>
                    )}
                  </Panel>
                ) : null}
                {health && health.sources.length ? (
                  <Panel title="Connections">
                    <ul className="ws-list">
                      {health.sources.map((x) => (
                        <li key={x.key}>
                          <div className="ws-item">
                            <span className={`ws-tile${x.issues ? ' ws-tile--warn' : ''}`} aria-hidden="true">
                              {x.issues ? <ICON.warning size={18} /> : <ICON.data size={18} />}
                            </span>
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

          <aside className="ws-side" aria-label="Workspace side panel">
            {plan ? (
              <Panel
                title="Subscription"
                action={
                  go('account') ? (
                    <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={go('account')}>
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
                {/* Only seats that were bought in a number; unmetered ones are on each app card. */}
                {seats ? seats.filter((x) => x.bought != null).map((x) => <Meter key={x.app} label={`${APP_NAME[x.app] || x.app} seats`} used={x.used} limit={x.bought} />) : null}
              </Panel>
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
                <Meter label="Sign in with an authenticator" used={security.withTotp} limit={security.active || null} />
                <p className="ws-item-sub" style={{ margin: 0 }}>
                  {privilegedNo2fa ? <><N>{privilegedNo2fa}</N> {privilegedNo2fa === 1 ? 'administrator has' : 'administrators have'} none yet.</> : 'Every administrator uses one.'}
                </p>
              </Panel>
            ) : null}

            {isAdmin ? (
              <Panel title="Shortcuts">
                <ul className="ws-list">
                  {[
                    ['companies', ICON.company, 'Add a company'],
                    ['members', ICON.people, 'Members and access'],
                    ['roles', ICON.secure, 'Roles and permissions'],
                    ['export', ICON.data, 'Export your data'],
                  ]
                    .filter(([key]) => go(key))
                    .map(([key, Icon, title]) => (
                      <li key={key}>
                        <button type="button" className="ws-item ws-item--button" onClick={go(key)}>
                          <span className="ws-tile" aria-hidden="true"><Icon size={18} /></span>
                          <span className="ws-item-text"><span className="ws-item-title">{title}</span></span>
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                </ul>
              </Panel>
            ) : null}

            <Panel title="Help and support">
              <ul className="ws-list">
                {[
                  ['welcome', ICON.library, 'Help centre', 'Guides for the Workspace and every app'],
                  ['setup', ICON.guide, 'Set up your workspace', 'The four steps to a ready company'],
                  ['readers', ICON.guide, 'Integrations', 'Readers, Tally, HR tools, single sign-on'],
                ].map(([topic, Icon, title, sub]) => (
                  <li key={title}>
                    <button type="button" className="ws-item ws-item--button" onClick={() => requestOpenHelp(topic)}>
                      <span className="ws-tile" aria-hidden="true">
                        <Icon size={18} />
                      </span>
                      <span className="ws-item-text">
                        <span className="ws-item-title">{title}</span>
                        <span className="ws-item-sub">{sub}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {go('support') ? (
                  <li>
                    <button type="button" className="ws-item ws-item--button" onClick={go('support')}>
                      <span className="ws-tile" aria-hidden="true">
                        <ICON.chat size={18} />
                      </span>
                      <span className="ws-item-text">
                        <span className="ws-item-title">Ask CLOR support</span>
                        <span className="ws-item-sub">{tickets?.some((t) => t.status === 'OPEN' || t.status === 'WAITING') ? `${tickets.filter((t) => t.status === 'OPEN' || t.status === 'WAITING').length} open · see your tickets` : 'Open a ticket and get the answer by email'}</span>
                      </span>
                    </button>
                  </li>
                ) : null}
                {operator.contactEmail ? (
                  <li>
                    <a className="ws-item" href={`mailto:${operator.contactEmail}`}>
                      <span className="ws-tile" aria-hidden="true">
                        <ICON.chat size={18} />
                      </span>
                      <span className="ws-item-text">
                        <span className="ws-item-title">Contact support</span>
                        <span className="ws-item-sub">{operator.contactEmail}</span>
                      </span>
                    </a>
                  </li>
                ) : null}
              </ul>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}
