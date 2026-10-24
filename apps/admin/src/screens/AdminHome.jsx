import React, { useEffect, useState } from 'react';
import { ArrowRight, ChevronRight } from 'lucide-react';

import { accountAudit, getAccountMe, listAccountMembers, listInvitations, memberDirectory } from '@platform/admin/account';
import { getAccountOverview } from '@platform/admin/admin';
import { operator } from '@platform/operator';
import { ACTION_WORDS } from './AccountActivity';
import { ICON, Meter, Panel, Stat, ago, productIcon } from './wsKit';
import heroImage from '../assets/clor-office.webp';
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
const ROLE_LABEL = { OWNER: 'Owner', ADMIN: 'Administrator', BILLING_ADMIN: 'Billing admin', MEMBER: 'Member' };

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

const firstName = (user) => String(user?.firstName || user?.fullName || '').trim().split(/\s+/)[0] || '';
const today = () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });


export default function AdminHome({ user, tenant, catalog = [], navItems = [], openScreen, openApp, openMoreApps, accountName = '' }) {
  const [me, setMe] = useState(null);
  const [overview, setOverview] = useState(null);
  const [members, setMembers] = useState(null);
  const [pending, setPending] = useState(null);
  const [privilegedNo2fa, setPrivilegedNo2fa] = useState(null);
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
            .then((d) => live && setPrivilegedNo2fa((d?.members || []).filter((m) => m.status === 'ACTIVE' && !m.authenticator && (m.accountRole === 'OWNER' || m.accountRole === 'ADMIN' || m.companies.some((c) => c.isAdmin))).length))
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
  const active = states.filter((s) => s.state.key === 'open' || s.state.key === 'noaccess').length;
  const notAssigned = states.filter((s) => s.state.key === 'noaccess');
  const activeMembers = members ? members.filter((m) => m.status === 'ACTIVE').length : null;
  const plan = overview?.plan;
  const usage = overview?.usage;

  /* Needs your attention: only what is true and actionable. */
  const attention = [
    pending ? { key: 'inv', icon: ICON.invite, tone: 'brand', title: `${pending} pending invitation${pending === 1 ? '' : 's'}`, sub: 'Waiting for people to accept.', go: go('invitations') } : null,
    privilegedNo2fa ? { key: '2fa', icon: ICON.warning, tone: 'warn', title: `${privilegedNo2fa} administrator${privilegedNo2fa === 1 ? '' : 's'} without an authenticator`, sub: 'They can change who has access; ask them to switch it on.', go: go('members') } : null,
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
              <ICON.company size={18} />
              <span>{tenant?.name || accountName || overview?.account?.name || 'Your company'}</span>
              {role ? (
                <>
                  <ChevronRight size={14} aria-hidden="true" />
                  <span className="ws-pill ws-pill--ok">{ROLE_LABEL[role] || role}</span>
                </>
              ) : null}
            </p>
            <h1 id="ws-hero-title" className="ws-hero-title">{name ? `Welcome back, ${name}` : 'Welcome back'}</h1>
            <p className="ws-hero-lede">Here’s what’s happening in your workspace today.</p>
          </div>
          {/* Clor's office, from a licensed illustration with the sign re-lettered. Decorative. */}
          <div className="ws-hero-media">
            <img src={heroImage} alt="" width="1400" height="559" decoding="async" />
            <time className="ws-hero-date" dateTime={new Date().toISOString().slice(0, 10)}>{today()}</time>
          </div>
        </section>

        {overview || members ? (
          <div className="ws-stats">
            {overview ? (
              <Stat icon={ICON.companies} label="Companies" value={usage?.companies ?? overview.companies?.length ?? 0} note={plan?.limits?.maxCompanies != null ? `of ${plan.limits.maxCompanies} on your plan` : 'no limit on your plan'} onOpen={go('companies')} />
            ) : null}
            {members ? (
              <Stat icon={ICON.people} label="Members" value={activeMembers} note={pending ? `${pending} invitation${pending === 1 ? '' : 's'} pending` : 'no invitations pending'} onOpen={go('members')} />
            ) : null}
            <Stat icon={ICON.apps} label="Applications" value={active} note={`${built.length - active} more available`} onOpen={openMoreApps || null} />
            {plan ? <Stat icon={ICON.plan} label="Plan" value={plan.name} note={plan.inGoodStanding ? 'In good standing' : String(plan.status || '').toLowerCase()} onOpen={go('account')} /> : null}
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
              <ul className="ws-apps" role="list" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 210px), 1fr))' }}>
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
                <ul className="ws-apps" role="list" aria-label="Apps on the way" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))' }}>
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

            <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
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

            <Panel title="Help and resources">
              <ul className="ws-list">
                {[
                  ['/docs/index.html', ICON.library, 'Help center', 'Guides for every app'],
                  ['/docs/readers.html', ICON.guide, 'Attendance readers', 'Connecting biometric readers'],
                  operator.contactEmail ? [`mailto:${operator.contactEmail}`, ICON.chat, 'Contact support', operator.contactEmail] : null,
                ]
                  .filter(Boolean)
                  .map(([href, Icon, title, sub]) => (
                    <li key={title}>
                      <a className="ws-item" href={href} {...(href.startsWith('mailto:') ? {} : { target: '_blank', rel: 'noopener' })}>
                        <span className="ws-tile" aria-hidden="true">
                          <Icon size={18} />
                        </span>
                        <span className="ws-item-text">
                          <span className="ws-item-title">{title}</span>
                          <span className="ws-item-sub">{sub}</span>
                        </span>
                      </a>
                    </li>
                  ))}
              </ul>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}
