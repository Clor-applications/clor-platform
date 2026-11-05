import React, { useEffect, useState } from 'react';
import { ArrowRight, ChevronRight } from 'lucide-react';

import { accountAudit, getAccountMe, listAccountMembers, listInvitations, memberDirectory } from '@platform/admin/account';
import { getAccountOverview } from '@platform/admin/admin';
import { operator } from '@platform/operator';
import { ACTION_WORDS } from './AccountActivity';
import { ICON, Meter, Panel, Stat, ago, productIcon } from './wsKit';
import { rupees, seatsByApp, securityOf } from './overviewFigures';
import { requestOpenHelp } from '@platform/context';
import heroImage from '../assets/clor-office.webp';
import heroImageSmall from '../assets/clor-office-800.webp';
import './workspace.css';

/**
 * Workspace → Overview (redesign W-R4).
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

/** Each product's own colour (clor.in); it stays on that product's tile. */
const ACCENT = { accounting: '#2F6FDB', people: '#7A4FD6', payroll: '#1E9E6A', attendance: '#D07A1F', projects: '#2E8DA3', timesheet: '#B5487A' };
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
const APP_NAME = { accounting: 'Accounting', payroll: 'Payroll', people: 'People', attendance: 'Attendance', projects: 'Projects' };

const firstName = (user) => String(user?.firstName || user?.fullName || '').trim().split(/\s+/)[0] || '';


export default function AdminHome({ user, tenant, catalog = [], navItems = [], openScreen, openApp, openMoreApps, accountName = '' }) {
  const [me, setMe] = useState(null);
  const [overview, setOverview] = useState(null);
  const [members, setMembers] = useState(null);
  const [heroReady, setHeroReady] = useState(false);
  const [pending, setPending] = useState(null);
  const [directory, setDirectory] = useState(null);
  const [activity, setActivity] = useState(null);

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
      })
      /* No answer hides what depends on it; nothing is guessed. */
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tenant?.id]);

  const role = me?.role || null;
  const myApps = Array.isArray(me?.apps) ? me.apps : null;
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const may = new Set(navItems.map((n) => n.key));
  const go = (key) => (may.has(key) ? () => openScreen?.(key) : null);

  const products = catalog.filter((a) => !a.platform);
  const built = products.filter((a) => a.available);
  const planned = products.filter((a) => !a.available);
  const states = built.map((a) => ({ app: a, state: appState(a, tenant, myApps) }));
  const notAssigned = states.filter((s) => s.state.key === 'noaccess');
  const activeMembers = members ? members.filter((m) => m.status === 'ACTIVE').length : null;
  const plan = overview?.plan;
  const usage = overview?.usage;
  const entities = overview?.entities || null;
  const health = overview?.dataHealth || null;
  const runRate = overview ? overview.runRate : undefined;
  const security = directory ? securityOf(directory) : null;
  const privilegedNo2fa = security?.privilegedNo2fa || 0;
  /* Seats for the apps that are built and on the account; Workspace itself is not a seat. */
  const seatApps = built.filter((a) => (tenant?.subscriptions || []).includes(a.id) || (overview?.seats || []).some((x) => x.app === a.id)).map((a) => a.id);
  const seats = directory ? seatsByApp(directory, overview?.seats, seatApps) : null;
  const seatsInUse = seats ? seats.reduce((n, x) => n + x.used, 0) : null;

  /* Needs your attention: only what is true and actionable. */
  const attention = [
    pending ? { key: 'inv', icon: ICON.invite, tone: 'brand', title: `${pending} pending invitation${pending === 1 ? '' : 's'}`, sub: 'Waiting for people to accept.', go: go('invitations') } : null,
    privilegedNo2fa ? { key: '2fa', icon: ICON.warning, tone: 'warn', title: `${privilegedNo2fa} administrator${privilegedNo2fa === 1 ? '' : 's'} without an authenticator`, sub: 'They can change who has access; ask them to switch it on.', go: go('members') } : null,
    health?.status === 'attention' ? { key: 'sync', icon: ICON.data, tone: 'warn', title: `${plural(health.issues, 'sync problem')}`, sub: health.alerts?.[0]?.title || health.sources.filter((x) => x.issues).map((x) => x.label).join(', '), go: null } : null,
    plan && plan.inGoodStanding === false ? { key: 'plan', icon: ICON.alert, tone: 'danger', title: 'Your plan needs attention', sub: `Status: ${String(plan.status || '').toLowerCase()}.`, go: go('account') } : null,
    notAssigned.length ? { key: 'na', icon: ICON.person, tone: null, title: `You can’t open ${notAssigned.map((s) => s.app.name).join(', ')} yet`, sub: 'An administrator gives access with a role.', go: null } : null,
    isAdmin && overview && overview.companies?.some((c) => !c.gstin) ? { key: 'gstin', icon: ICON.company, tone: null, title: 'Company details incomplete', sub: `${overview.companies.filter((c) => !c.gstin).map((c) => c.name).join(', ')}: no GSTIN on record.`, go: go('companies') } : null,
  ].filter(Boolean);

  const name = firstName(user);

  return (
    <div className="ws">
      <div className="ws-inner">
        <section className="ws-hero" aria-labelledby="ws-hero-title">
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
          {/* Clor's office: a licensed illustration, re-lettered and recoloured to the Workspace palette. Decorative. */}
          <div className="ws-hero-media">
            <img
              src={heroImage}
              srcSet={`${heroImageSmall} 800w, ${heroImage} 1400w`}
              sizes="(max-width: 767px) 1px, 42vw"
              alt=""
              width="1400"
              height="559"
              decoding="async"
              data-loaded={heroReady || undefined}
              ref={(el) => {
                if (el?.complete && !heroReady) setHeroReady(true);
              }}
              onLoad={() => setHeroReady(true)}
            />
          </div>
        </section>

        {overview || directory ? (
          <div className="ws-stats" aria-label="Workspace figures">
            {entities ? (
              <Stat
                icon={ICON.companies}
                label="Entities"
                value={<N>{entities.companies}</N>}
                note={
                  <>
                    <N>{entities.branches}</N> {entities.branches === 1 ? 'branch' : 'branches'} · <N>{entities.taxProfiles}</N> GST {entities.taxProfiles === 1 ? 'registration' : 'registrations'}
                    {entities.costCentres ? <> · <N>{entities.costCentres}</N> cost {entities.costCentres === 1 ? 'centre' : 'centres'}</> : null}
                  </>
                }
                onOpen={go('companies')}
              />
            ) : null}
            {seats ? (
              <Stat icon={ICON.people} label="Active seats" value={<N>{seatsInUse}</N>} note={`across ${plural(seats.length, 'app')} · ${plural(activeMembers ?? security.active, 'member')}`} onOpen={go('members')} />
            ) : null}
            {health ? (
              <Stat
                icon={ICON.data}
                tone={health.status === 'attention' ? 'warn' : null}
                label="Data health"
                value={health.status === 'none' ? 'Nothing to sync' : health.status === 'ok' ? 'All flowing' : <><N>{health.issues}</N> {health.issues === 1 ? 'problem' : 'problems'}</>}
                note={health.status === 'none' ? 'No readers, connectors or e-mail yet' : `${plural(health.sources.length, 'source')} checked`}
              />
            ) : null}
            {security ? (
              <Stat
                icon={ICON.secure}
                tone={privilegedNo2fa ? 'warn' : null}
                label="Security"
                value={security.pct == null ? '—' : <N>{security.pct}%</N>}
                note={<><N>{security.withTotp}</N> of <N>{security.active}</N> {security.active === 1 ? 'member signs' : 'members sign'} in with an authenticator</>}
                onOpen={go('securityHome') || go('members')}
              />
            ) : null}
            {runRate !== undefined ? (
              <Stat
                icon={ICON.plan}
                label="Monthly run rate"
                value={runRate?.monthly != null ? <N>{rupees(runRate.monthly)}</N> : 'Not priced yet'}
                note={
                  !runRate
                    ? 'No subscription on record'
                    : runRate.monthly == null
                      ? runRate.unpriced?.length
                        ? `CLOR has not set a price for ${runRate.unpriced.map((a) => APP_NAME[a] || a).join(', ')}`
                        : 'No billing period set'
                      : runRate.status === 'trialing'
                        ? 'once the trial ends'
                        : runRate.interval === 'year'
                          ? 'billed yearly, per month'
                          : `${plan?.name || 'Plan'} · billed monthly`
                }
                onOpen={go('account')}
              />
            ) : null}
          </div>
        ) : null}

        <div className="ws-layout">
          <div className="ws-main">
            <section className="ws-section" aria-labelledby="ws-apps-title">
              <div className="ws-section-head">
                <h2 id="ws-apps-title" className="ws-h2">Your applications</h2>
                {openMoreApps ? (
                  <button type="button" className="ws-link" onClick={() => openMoreApps()}>
                    Manage apps <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <ul className="ws-apps" role="list" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))' }}>
                {states.map(({ app: a, state: s }) => {
                  const Icon = productIcon(a.id);
                  return (
                    <li key={a.id}>
                      <article className={`ws-card${s.key === 'open' ? ' is-open' : ''}`}>
                        <div className="ws-card-top">
                          <span className="ws-tile" style={{ '--tile-fg': ACCENT[a.id] || 'rgb(var(--ws-ink))' }}>
                            <Icon size={22} />
                          </span>
                          <div className="ws-card-id" style={{ display: 'grid', justifyItems: 'start' }}>
                            <h3 className="ws-card-name">{a.name}</h3>
                            <span className={s.pill}>{s.label}</span>
                          </div>
                        </div>
                        <p className="ws-card-blurb ws-clamp-2" style={{ marginTop: 0 }} title={a.blurb}>{a.blurb}</p>
                        <div className="mt-auto">
                          {s.key === 'open' ? (
                            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small ws-card-link" onClick={() => openApp?.(a.id)}>
                              Open {a.name} <ArrowRight size={14} aria-hidden="true" />
                            </button>
                          ) : s.key === 'off' && openMoreApps ? (
                            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => openMoreApps()}>
                              See how to add it
                            </button>
                          ) : (
                            <span className="ws-item-sub">{s.key === 'noaccess' ? 'Ask an administrator for a role.' : s.key === 'plan' ? 'Contact Clor to add it to your plan.' : ''}</span>
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
                          <span className="ws-tile" style={{ '--tile-fg': ACCENT[a.id] || 'rgb(var(--ws-ink))' }}>
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

            <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
              <Panel title="Needs your attention">
                {attention.length ? (
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

              {activity ? (
                <Panel
                  title="Workspace activity"
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
                <Panel title="Data health">
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
                          <span className={x.issues ? 'ws-pill' : 'ws-pill ws-pill--ok'}>{x.issues ? 'Needs a look' : 'Flowing'}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : null}
            </div>
          </div>

          <aside className="ws-side" aria-label="Workspace side panel">
            {isAdmin ? (
              <Panel title="Quick actions">
                <div className="ws-actions-col">
                  {go('invitations') ? (
                    <button type="button" className="ws-btn ws-btn--primary" onClick={go('invitations')}>
                      <span className="inline-flex items-center gap-2"><ICON.invite size={18} /> Add people</span> <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                  {go('companies') ? (
                    <button type="button" className="ws-btn ws-btn--quiet" onClick={go('companies')}>
                      <span className="inline-flex items-center gap-2"><ICON.company size={18} /> Create company</span> <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                  {go('account') ? (
                    <button type="button" className="ws-btn ws-btn--quiet" onClick={go('account')}>
                      <span className="inline-flex items-center gap-2"><ICON.plan size={18} /> Plan and subscriptions</span> <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                  {go('members') ? (
                    <button type="button" className="ws-btn ws-btn--quiet" onClick={go('members')}>
                      <span className="inline-flex items-center gap-2"><ICON.people size={18} /> Manage members</span> <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </Panel>
            ) : null}

            {plan ? (
              <Panel
                title="Your plan"
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
                  <span className={plan.inGoodStanding ? 'ws-pill ws-pill--ok' : 'ws-pill'}>{plan.inGoodStanding ? 'Active' : String(plan.status || '').toLowerCase()}</span>
                </div>
                <Meter label="Companies" used={usage?.companies ?? 0} limit={plan.limits?.maxCompanies ?? null} />
                <Meter label="Users" used={usage?.users ?? 0} limit={plan.limits?.maxUsers ?? null} />
              </Panel>
            ) : null}

            {seats && seats.length ? (
              <Panel
                title="Seats by app"
                action={
                  go('members') ? (
                    <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={go('members')}>
                      Members
                    </button>
                  ) : null
                }
              >
                {seats.map((x) => (
                  <Meter key={x.app} label={APP_NAME[x.app] || x.app} used={x.used} limit={x.bought} />
                ))}
              </Panel>
            ) : null}

            <Panel title="Help and resources">
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
