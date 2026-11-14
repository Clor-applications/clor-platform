import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Plus } from '@ui/components/ui/lineIcons';

import { accountAudit, getAccountMe, listAccountMembers, listInvitations, listTickets, memberDirectory } from '@platform/admin/account';
import { getAccountOverview } from '@platform/admin/admin';
import { operator } from '@platform/operator';
import { ACTION_WORDS } from './AccountActivity';
import { AppMark, Avatar, ICON, Meter, Panel, ago, productIcon } from './wsKit';
import { rupees, seatsByApp, securityOf } from './overviewFigures';
import { orgId, requestOpenHelp } from '@platform/context';
import { apiFetch } from '@platform/http';
import './workspace.css';
import './ws-home.css';

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
/* An app's state as a pill: open is good; the rest are neutral facts, not alarms. */
const pillOf = (s) => (s.key === 'open' ? 'ws-pill ws-pill--ok' : 'ws-pill ws-pill--neutral');

const firstName = (user) => String(user?.firstName || user?.fullName || '').trim().split(/\s+/)[0] || '';


/**
 * What waits on this reader in every app of this company (Workspace plan P1):
 * People and Attendance, Books approvals, Payroll approvals. Counts and the
 * screen that owns each; the app decides, Workspace points.
 */
const getWaiting = () => apiFetch(`/orgs/${encodeURIComponent(orgId())}/workspace/waiting`, { skipWarehouseHeader: true });

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

  /* Needs your attention: only what is true and actionable, the most urgent first. */
  const attention = [
    planBad ? { key: 'plan', tag: 'Plan', action: 'Open plan', icon: ICON.alert, tone: 'danger', title: 'Your plan needs attention', sub: `Status: ${String(plan.status || '').toLowerCase()}.`, go: go('account') } : null,
    seesPlan && bills?.overdue ? { key: 'overdue', tag: 'Overdue', action: 'Pay now', icon: ICON.plan, tone: 'danger', title: `${plural(bills.overdue, 'CLOR invoice')} overdue`, sub: <><N>{rupees(bills.due)}</N> to pay in all. Open Billing to pay.</>, go: go('billing') } : null,
    renewalLine ? { key: 'renewal', tag: 'Plan', action: 'Choose plan', icon: ICON.plan, ...renewalLine, go: go('account') } : null,
    ...waitingLines,
    health?.status === 'attention' ? { key: 'sync', tag: 'Sync', icon: ICON.data, tone: 'warn', title: `${plural(health.issues, 'sync problem')}`, sub: health.alerts?.[0]?.title || health.sources.filter((x) => x.issues).map((x) => x.label).join(', '), go: null } : null,
    privilegedNo2fa ? { key: '2fa', tag: 'Security', action: 'Review members', icon: ICON.warning, tone: 'warn', title: `${privilegedNo2fa} administrator${privilegedNo2fa === 1 ? '' : 's'} without an authenticator`, sub: 'They can change who has access; ask them to switch it on.', go: go('members') } : null,
    seesPlan && bills?.unpaid && !bills.overdue ? { key: 'unpaid', tag: 'Invoice', action: 'Pay', icon: ICON.plan, tone: null, title: `${plural(bills.unpaid, 'CLOR invoice')} to pay`, sub: <><N>{rupees(bills.due)}</N> due. Not overdue yet.</>, go: go('billing') } : null,
    pending ? { key: 'inv', tag: 'Invited', action: 'View invitations', icon: ICON.invite, tone: null, title: `${pending} pending invitation${pending === 1 ? '' : 's'}`, sub: 'Waiting for people to accept.', go: go('invitations') } : null,
    notAssigned.length ? { key: 'na', tag: 'Access', icon: ICON.person, tone: null, title: `You can’t open ${notAssigned.map((s) => s.app.name).join(', ')} yet`, sub: 'An administrator gives access with a role.', go: null } : null,
    isAdmin && overview && overview.companies?.some((c) => !c.gstin && !c.archived) ? { key: 'gstin', tag: 'Missing', pill: 'danger', action: 'Add GSTIN', icon: ICON.company, tone: null, title: 'Company details incomplete', sub: `${overview.companies.filter((c) => !c.gstin && !c.archived).map((c) => c.name).join(', ')}: no GSTIN on record.`, go: go('companies') } : null,
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
  /* One line of facts under the title, each only when it was read. */
  const facts = [
    account || null,
    companyCount != null ? plural(companyCount, 'company', 'companies') : null,
    `${onCount} of ${built.length} apps`,
    memberCount != null ? plural(memberCount, 'member') : null,
  ].filter(Boolean);
  const companiesTable = isAdmin && overview ? (overview.companies || []) : null;

  return (
    <div className="ws">
      <div className="ws-inner">
        <header className="ws-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="ws-title">Workspace</h1>
            <p className="ws-lede">
              {facts.join(' · ')}
              {role ? <> <span className="ws-pill ws-pill--neutral" style={{ marginLeft: 8, verticalAlign: 'middle' }}>{ROLE_LABEL[role] || role}</span></> : null}
            </p>
            <p className="sr-only">{name ? `Welcome back, ${name}. ` : ''}{ROLE_LEDE[role] || DEFAULT_LEDE}</p>
          </div>
          {isAdmin && go('invitations') ? (
            <div className="ws-actions">
              <button type="button" className="ws-btn ws-btn--primary" onClick={go('invitations')}>
                <Plus size={16} aria-hidden="true" /> Invite people
              </button>
            </div>
          ) : null}
        </header>

        <section className="ws-section" aria-labelledby="ws-apps-title">
          <div className="ws-section-head">
            <h2 id="ws-apps-title" className="ws-h2">Your apps</h2>
            {go('apps') ? (
              <button type="button" className="ws-link" onClick={go('apps')}>
                All apps <ChevronRight size={16} aria-hidden="true" />
              </button>
            ) : openMoreApps ? (
              <button type="button" className="ws-link" onClick={() => openMoreApps()}>
                Manage apps <ChevronRight size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <ul className="ws-appgrid ws-apps" role="list">
            {states.map(({ app: a, state: s }) => {
              const open = s.key === 'open';
              const seat = seats?.find((x) => x.app === a.id);
              return (
                <li key={a.id}>
                  <article className="ws-appcard" data-open={open || undefined}>
                    <div className="ws-appcard-top">
                      <AppMark app={a.id} size={36} off={!open && s.key !== 'noaccess'} title={a.name} />
                      <span className={pillOf(s)}>{s.label}</span>
                    </div>
                    <div>
                      <h3 className="ws-appcard-name">{a.name}</h3>
                      {open ? (
                        <button type="button" className="ws-appcard-open" onClick={() => openApp?.(a.id)}>
                          Open {hostLabel(a.id)}
                        </button>
                      ) : s.key === 'off' && openMoreApps ? (
                        <button type="button" className="ws-appcard-open" onClick={() => openMoreApps()}>
                          See how to add it
                        </button>
                      ) : (
                        <p className="ws-appcard-sub">{s.key === 'noaccess' ? 'Ask an administrator for a role.' : s.key === 'plan' ? 'Add it to your plan.' : a.blurb}</p>
                      )}
                      {seat ? (
                        <p className="ws-appcard-sub" style={{ marginTop: 4 }}>
                          <N>{seat.used}</N> {seat.bought != null ? <>of <N>{seat.bought}</N> seats</> : seat.used === 1 ? 'person has access' : 'people have access'}
                        </p>
                      ) : null}
                    </div>
                  </article>
                </li>
              );
            })}
            {planned.map((a) => (
              <li key={a.id}>
                <article className="ws-appcard" aria-label={`${a.name}, coming soon`}>
                  <div className="ws-appcard-top">
                    <AppMark app={a.id} size={36} off title={a.name} />
                    <span className="ws-pill ws-pill--neutral">Coming soon</span>
                  </div>
                  <div>
                    <h3 className="ws-appcard-name">{a.name}</h3>
                    <p className="ws-appcard-sub ws-clamp-2" title={a.blurb}>{a.blurb}</p>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </section>

        {myApps && myApps.length === 0 ? (
          <section className="ws-setup" role="status" aria-labelledby="ws-noaccess-title">
            <h2 id="ws-noaccess-title" className="ws-h2">No app access yet</h2>
            <p className="ws-card-blurb">You are in {tenant?.name || 'this company'}, but no app is open to you yet. An administrator gives access by giving you a role.</p>
          </section>
        ) : null}

        <section ref={attentionRef} className="ws-section" style={{ scrollMarginTop: 16 }} aria-labelledby="ws-attn-title">
          <div className="ws-section-head">
            <h2 id="ws-attn-title" className="ws-h2">Needs your attention</h2>
            {waitingLines.length && go('inbox') ? (
              <button type="button" className="ws-link" onClick={go('inbox')}>
                Open inbox <ChevronRight size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {loading ? (
            <div style={{ display: 'grid', gap: 12 }} aria-hidden="true">
              <span className="ui-skel ui-skel-text" />
              <span className="ui-skel ui-skel-text" style={{ width: '60%' }} />
            </div>
          ) : attention.length ? (
            <ul className="ws-attn" aria-label={urgent ? `${plural(urgent, 'urgent item')}` : 'Nothing urgent'}>
              {attention.map((a) => {
                const body = (
                  <>
                    <span className={`ws-pill ws-pill--${a.pill || (a.tone === 'danger' ? 'danger' : a.tone === 'warn' ? 'warn' : 'neutral')}`}>{a.tag}</span>
                    <span className="ws-attn-text">
                      <span className="ws-attn-title">{a.title}</span>
                      <span className="ws-attn-sub">{a.sub}</span>
                    </span>
                    {a.go ? <span className="ws-attn-act">{a.action || 'Open'} <span aria-hidden="true">→</span></span> : <span />}
                  </>
                );
                return <li key={a.key}>{a.go ? <button type="button" className="ws-attn-row" onClick={a.go}>{body}</button> : <div className="ws-attn-row">{body}</div>}</li>;
              })}
            </ul>
          ) : (
            <p className="ws-card-blurb">Nothing needs you right now.</p>
          )}
        </section>

        <div className="ws-home-split">
          <div className="ws-home-col">
            {companiesTable ? (
              <section aria-labelledby="ws-cos-title">
                <div className="ws-sec-head">
                  <h2 id="ws-cos-title" className="ws-h2">Companies</h2>
                  {go('companies') ? <button type="button" className="ws-link" onClick={go('companies')}>Add company</button> : null}
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
                            <td className="ws-mono">{c.gstin || <span className="ws-missing">Not added</span>}</td>
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
                {/* Only seats that were bought in a number; unmetered ones are on each app card. */}
                {seats ? seats.filter((x) => x.bought != null).map((x) => <Meter key={x.app} label={`${APP_NAME[x.app] || x.app} seats`} used={x.used} limit={x.bought} />) : null}
              </Panel>
            ) : null}
          </div>

          <aside className="ws-home-col" aria-label="Workspace side panel">
            {activity ? (
              <section aria-labelledby="ws-activity-title">
                <div className="ws-sec-head">
                  <h2 id="ws-activity-title" className="ws-h2">Recent activity</h2>
                  {go('accountActivity') ? (
                    <button type="button" className="ws-link" onClick={go('accountActivity')}>View all</button>
                  ) : null}
                </div>
                {activity.length ? (
                  <ul className="ws-feed">
                    {activity.map((e) => (
                      <li key={e.id}>
                        <Avatar name={e.actor?.name || 'Someone'} />
                        <span style={{ minWidth: 0 }}>
                          <strong style={{ fontWeight: 600 }}>{e.actor?.name || 'Someone'}</strong>{' '}
                          <span style={{ color: e.result === 'DENIED' ? 'rgb(var(--neg))' : undefined }}>
                            {e.result === 'DENIED' ? 'was refused: ' : ''}
                            {ACTION_WORDS[e.action] || e.action}
                            {e.targetName ? `: ${e.targetName}` : ''}
                          </span>
                        </span>
                        <span className="ws-feed-when">{ago(e.at)}</span>
                      </li>
                    ))}
                  </ul>
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
                <Meter label="Sign in with an authenticator" used={security.withTotp} limit={security.active || null} />
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
          </aside>
        </div>
      </div>
    </div>
  );
}
