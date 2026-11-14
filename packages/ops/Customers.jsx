import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Search } from '@ui/components/ui/lineIcons';

import { notify } from '@ui/components/ui/notify';
import { PageHead, Panel, ago } from '../../apps/admin/src/screens/wsKit';
import { inr } from './money';
import { units } from './CustomPlans';
import { Limits } from './Limits';
import { SupportAccess } from './SupportAccess';
import { DealDrawer } from './Deals';
import { APP_NAMES, Empty, Err, Loading, Pager, ReasonDrawer, SELLABLE, Tabs, appsText, day, may, when } from './kit';
import {
  opsAccount,
  opsAccounts,
  opsCancelSubscription,
  opsChangeApps,
  opsCustomerActivity,
  opsCustomerConnections,
  opsCustomerPayments,
  opsCustomerRequests,
  opsCustomerUsers,
  opsExtendTrial,
  opsGrantPlan,
  opsReinstate,
  opsReopenSubscription,
  opsResendInvitation,
  opsResetAuthenticator,
  opsRetryEmails,
  opsUnlockUser,
  opsSendResetLink,
  opsSignOutEverywhere,
  opsSuspend,
} from './api';

/**
 * Customers (operator console; roadmap item 13): every customer account, and
 * one page for each with what CLOR staff need to look after it. Account
 * metadata only, never a customer's books, people or payroll. Every change
 * asks why, takes an authenticator code, and goes in the audit log and the
 * customer's own security record.
 */

/* What a customer's state is called on the console. */
const STATUS = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Overdue',
  overdue: 'Overdue',
  paused: 'Paused',
  cancelled: 'Cancelled',
  legacy: 'Active (older account)',
  'no-plan': 'No plan',
  suspended: 'Suspended',
};
const FILTERS = [
  ['all', 'All'],
  ['trialing', 'Trial'],
  ['active', 'Active'],
  ['overdue', 'Overdue'],
  ['suspended', 'Suspended'],
  ['cancelled', 'Cancelled'],
];

/** A trial that has run out is overdue, whatever the subscription row says. */
export const customerStatus = (plan, trialEndsAt) => (plan === 'trialing' && trialEndsAt && new Date(trialEndsAt).getTime() < Date.now() ? 'overdue' : plan);

export function StatusPill({ status }) {
  const tone =
    status === 'active' || status === 'legacy'
      ? 'ws-pill ws-pill--ok'
      : status === 'suspended' || status === 'past_due' || status === 'overdue'
        ? 'ws-pill ws-pill--danger'
        : status === 'trialing'
          ? 'ws-pill ws-pill--warn'
          : status === 'cancelled' || status === 'no-plan'
            ? 'ws-pill ws-pill--off'
            : 'ws-pill';
  return <span className={tone}>{STATUS[status] || status}</span>;
}

const planWords = (a) => (a.plan === 'no-plan' || a.plan === 'legacy' ? '—' : a.interval === 'year' ? 'Yearly' : a.interval === 'month' ? 'Monthly' : a.byHand ? 'Set by hand' : 'Through payments');

/* ------------------------------------------------------------------ list */
export function Customers({ initialStatus = 'all', openCustomer }) {
  const [view, setView] = useState({ q: '', status: initialStatus, page: 0 });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      opsAccounts(view)
        .then((r) => live && (setData(r), setError('')))
        .catch((e) => live && setError(String(e?.message || e)));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [view]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <>
      <PageHead
        title="Accounts"
        description="Every customer account. Open one to see its companies, subscription, users and support access."
        meta={data ? `${data.total.toLocaleString('en-IN')} ${data.total === 1 ? 'account' : 'accounts'}` : null}
      />
      <div className="flex flex-wrap gap-2 items-center" role="search">
        <label className="relative flex-1 min-w-[14rem]" style={{ maxWidth: 460 }}>
          <span className="sr-only">Search customers</span>
          <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 ui-muted" />
          <input className="ui-input" style={{ paddingLeft: '2.25rem' }} value={view.q} onChange={(e) => setView((v) => ({ ...v, q: e.target.value, page: 0 }))} placeholder="Name, company ID or owner email" />
        </label>
        <select className="ui-select" style={{ width: 'auto' }} aria-label="Status" value={view.status} onChange={(e) => setView((v) => ({ ...v, status: e.target.value, page: 0 }))}>
          {FILTERS.map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </div>
      <Err>{error}</Err>
      {!data ? (
        error ? null : <Loading />
      ) : data.accounts.length === 0 ? (
        <Empty>{view.q ? 'No customer matches that search.' : 'No customers with this status.'}</Empty>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Customer accounts</caption>
            <thead>
              <tr>
                <th>Account</th>
                <th className="hidden md:table-cell">Owner</th>
                <th className="hidden lg:table-cell">Plan and apps</th>
                <th className="num hidden sm:table-cell">Companies</th>
                <th className="num hidden sm:table-cell">Users</th>
                <th className="hidden md:table-cell">Trial ends or renews</th>
                <th>State</th>
                <th className="hidden xl:table-cell">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => {
                const status = customerStatus(a.plan, a.trialEndsAt);
                return (
                  <tr key={a.id}>
                    <td>
                      <button type="button" className="ws-name-link" onClick={() => openCustomer(a.id)}>{a.title || a.name}</button>
                      <div className="ws-item-sub tabular-nums">{a.code || '—'}</div>
                    </td>
                    <td className="hidden md:table-cell">
                      <div>{a.owner?.name || '—'}</div>
                      <div className="ws-item-sub">{a.owner?.email || ''}</div>
                    </td>
                    <td className="hidden lg:table-cell" style={{ whiteSpace: 'normal', minWidth: '12rem' }}>
                      <div>{planWords(a)}</div>
                      <div className="ws-item-sub">{appsText(a.apps)}</div>
                    </td>
                    <td className="num hidden sm:table-cell">{a.companies}</td>
                    <td className="num hidden sm:table-cell">{a.users}</td>
                    <td className="hidden md:table-cell tabular-nums">{a.plan === 'trialing' ? day(a.trialEndsAt) : a.renewsAt ? day(a.renewsAt) : '—'}</td>
                    <td><StatusPill status={status} /></td>
                    <td className="hidden xl:table-cell">{a.lastActiveAt ? ago(a.lastActiveAt) : 'Never'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={view.page} pages={pages} onPage={(page) => setView((v) => ({ ...v, page }))} />
    </>
  );
}

/* ------------------------------------------------------------ one customer */
const TABS = [
  ['overview', 'Overview'],
  ['subscription', 'Subscription'],
  ['limits', 'Limits'],
  ['money', 'Invoices and payments'],
  ['requests', 'Requests'],
  ['users', 'Users'],
  ['connections', 'Connections'],
  ['access', 'Support access'],
  ['activity', 'Timeline'],
];

export function CustomerPage({ id, tab: asked, role, back, setTab, openDemo, openLink = () => {} }) {
  /* An old or mistyped link opens the overview rather than an empty page. */
  const tab = TABS.some(([k]) => k === asked) ? asked : 'overview';
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    opsAccount(id)
      .then((r) => (setD(r), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, [id]);
  useEffect(load, [load]);

  if (!d) return error ? <Err>{error}</Err> : <Loading />;
  const a = d.account;
  const s = d.subscription;
  const name = a.title || a.name;
  const plan = a.suspendedAt ? 'suspended' : s ? customerStatus(s.status, s.trialEndsAt) : a.legacyUnrestrictedAt ? 'legacy' : 'no-plan';
  const owner = d.members.find((m) => m.role === 'OWNER');
  return (
    <>
      <div>
        <button type="button" className="ops-back" onClick={back}>
          <ArrowLeft size={16} aria-hidden="true" /> Accounts
        </button>
      </div>
      <PageHead
        title={name}
        description={a.ownerName && a.ownerName !== name ? `Owner: ${a.ownerName}` : null}
        actions={
          tab !== 'subscription' && may(role, 'BILLING', 'SALES') ? (
            <button type="button" className="ws-btn ws-btn--primary" onClick={() => setTab('subscription')}>
              Change subscription
            </button>
          ) : null
        }
      />
      <div className="ops-id-line">
        <span className="tabular-nums">{a.code || '—'}</span>
        <span>{d.companies.length} {d.companies.length === 1 ? 'company' : 'companies'}</span>
        <span>{d.members.length} {d.members.length === 1 ? 'user' : 'users'}</span>
        {owner?.email ? <span>owner {owner.email}</span> : null}
      </div>
      <div className="ops-pills">
        <StatusPill status={plan} />
        {s?.apps?.length ? <span className="ws-pill">{appsText(s.apps)}</span> : null}
        {a.legacyUnrestrictedAt && !s ? <span className="ws-pill ws-pill--warn">Fail-open: every app</span> : null}
      </div>
      {a.suspendedAt ? (
        <p className="ws-notice" role="status">
          Suspended on {day(a.suspendedAt)}: {a.suspendedReason}. Nobody in this account can open any of its companies until it is resumed.
        </p>
      ) : null}
      <Tabs label={name} tabs={TABS} value={tab} onChange={setTab} />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="grid gap-8">
        {tab === 'overview' ? <Overview d={d} plan={plan} setTab={setTab} role={role} /> : null}
        {tab === 'subscription' ? <Subscription d={d} name={name} plan={plan} role={role} reload={load} /> : null}
        {tab === 'limits' ? <Limits id={id} name={name} role={role} /> : null}
        {tab === 'money' ? <Money id={id} /> : null}
        {tab === 'requests' ? <Requests id={id} openDemo={openDemo} openLink={openLink} /> : null}
        {tab === 'users' ? <Users id={id} role={role} /> : null}
        {tab === 'connections' ? <Connections id={id} role={role} /> : null}
        {tab === 'access' ? <SupportAccess id={id} companies={d.companies} role={role} /> : null}
        {tab === 'activity' ? <Timeline id={id} openLink={openLink} /> : null}
      </div>
    </>
  );
}

function Facts({ rows }) {
  return (
    <dl className="ops-facts">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/* Shortcuts to where each support job lives on this page; every one still asks why and goes in the audit log. */
const SUPPORT_JOBS = [
  ['users', 'Reset a password or sign someone out', 'Users', ['SUPPORT']],
  ['subscription', 'Extend trial, change apps, suspend', 'Reason', ['BILLING', 'SALES', 'SUPPORT']],
  ['access', 'Ask to look inside a company', 'Customer approves', ['SUPPORT']],
  ['connections', 'Send failed emails again', 'Reason', ['SUPPORT']],
];

function Overview({ d, plan, setTab = () => {}, role }) {
  const owners = d.members.filter((m) => m.role === 'OWNER');
  const s = d.subscription;
  const jobs = SUPPORT_JOBS.filter(([, , , roles]) => may(role, ...roles));
  return (
    <div className="ops-detail">
      <div className="ops-detail-main">
        <section className="ops-section" aria-labelledby="ops-companies">
          <h2 id="ops-companies" className="ops-h2">Companies and branches ({d.companies.length})</h2>
          {d.companies.length ? (
            <div className="ws-table-wrap">
              <table className="ws-table">
                <caption className="sr-only">Companies</caption>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th className="hidden md:table-cell">Company ID</th>
                    <th className="num">People</th>
                    <th className="hidden md:table-cell">Since</th>
                  </tr>
                </thead>
                <tbody>
                  {d.companies.map((c) => (
                    <tr key={c.id}>
                      <td style={{ whiteSpace: 'normal' }}>
                        <span className="ops-strong">{c.name}</span>
                        {c.branches?.length ? (
                          <div className="ws-item-sub">Branches: {c.branches.map((b) => `${b.name}${b.state ? ` (${b.state})` : ''}`).join(', ')}</div>
                        ) : null}
                      </td>
                      <td className="hidden md:table-cell tabular-nums">{c.code || '—'}</td>
                      <td className="num">{c.people}</td>
                      <td className="hidden md:table-cell">{day(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ws-card-blurb">No company yet. The owner makes one when they first sign in.</p>
          )}
        </section>
      </div>
      <aside className="ops-detail-side">
        <section className="ops-card" aria-labelledby="ops-account-facts">
          <h2 id="ops-account-facts" className="ops-h2">Account</h2>
          <Facts
            rows={[
              ['Account ID', <span key="c" className="tabular-nums">{d.account.code || '—'}</span>],
              ['Owner', owners.length ? owners.map((o) => <div key={o.userId}>{o.name || '—'} · <a href={`mailto:${o.email}`}>{o.email}</a></div>) : '—'],
              ['Status', <StatusPill key="s" status={plan} />],
              ['Apps on', s ? appsText(s.apps) : d.account.legacyUnrestrictedAt ? 'Every app (older account)' : 'None'],
              ['Users', <span key="u" className="tabular-nums">{d.members.length}</span>],
              ['Created', day(d.account.createdAt)],
              ['Last activity', d.lastActiveAt ? `${ago(d.lastActiveAt)} (${when(d.lastActiveAt)})` : 'Nobody has signed in yet'],
            ]}
          />
        </section>
        {jobs.length ? (
          <section className="ops-card" aria-labelledby="ops-support-jobs">
            <h2 id="ops-support-jobs" className="ops-h2">Support actions</h2>
            <div className="ops-jobs">
              {jobs.map(([k, label, hint]) => (
                <button key={k} type="button" className="ops-job" onClick={() => setTab(k)}>
                  <span>{label}</span>
                  <span className="ops-job-hint">{hint}</span>
                </button>
              ))}
            </div>
            <p className="ws-card-blurb">Every action asks why, and is written to the staff audit log and to the customer’s own audit log.</p>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

/* ----------------------------------------------------------- subscription */
/* People carries Attendance: ticking People ticks Attendance and holds it there. */
const withIncluded = (set) => {
  const n = new Set(set);
  if (n.has('people')) n.add('attendance');
  return n;
};
const toggle = (set, k) => {
  const n = new Set(set);
  if (n.has(k)) n.delete(k);
  else n.add(k);
  return n;
};

const ACTIONS = {
  trial: { label: 'Extend trial', title: 'Extend the trial', confirm: 'Extend trial', roles: ['BILLING', 'SALES'] },
  apps: { label: 'Change apps', title: 'Change apps', confirm: 'Change apps', roles: ['BILLING'] },
  deal: { label: 'New subscription', roles: ['BILLING'] },
  plan: { label: 'Free plan by hand', title: 'Set a free plan by hand', confirm: 'Set plan', roles: ['BILLING'] },
  suspend: { label: 'Suspend', title: 'Suspend this customer', confirm: 'Suspend', roles: ['SUPPORT', 'BILLING'], tone: 'danger' },
  resume: { label: 'Resume', title: 'Resume this customer', confirm: 'Resume', roles: ['SUPPORT', 'BILLING'] },
  cancel: { label: 'Cancel subscription', title: 'Cancel the subscription', confirm: 'Cancel subscription', roles: ['BILLING'], tone: 'danger' },
  reopen: { label: 'Reopen', title: 'Reopen the subscription', confirm: 'Reopen', roles: ['BILLING'] },
};

function Subscription({ d, name, plan, role, reload }) {
  const a = d.account;
  const s = d.subscription;
  const [action, setAction] = useState(null);
  const [days, setDays] = useState(14);
  const [apps, setApps] = useState(new Set());
  const [trialDays, setTrialDays] = useState(30);
  const [status, setStatus] = useState('trialing');
  const [dealOpen, setDealOpen] = useState(false);
  const openAction = (k) => {
    if (k === 'deal') return setDealOpen(true);
    if (k === 'apps') setApps(withIncluded(new Set(s?.apps || [])));
    if (k === 'plan') setApps(new Set(['accounting']));
    setAction(k);
  };

  const can = (k) => may(role, ...ACTIONS[k].roles);
  const offered = [
    can('deal') ? 'deal' : null,
    !s && can('plan') ? 'plan' : null,
    s?.status === 'trialing' && can('trial') ? 'trial' : null,
    s && s.status !== 'cancelled' && can('apps') ? 'apps' : null,
    s && s.status !== 'cancelled' && can('cancel') ? 'cancel' : null,
    s?.status === 'cancelled' && can('reopen') ? 'reopen' : null,
    a.suspendedAt ? (can('resume') ? 'resume' : null) : can('suspend') ? 'suspend' : null,
  ].filter(Boolean);

  const what = {
    trial: `${name}'s trial ends on ${day(s?.trialEndsAt)}. The extra days are added to that date, or to today if it has passed.`,
    apps: `Apps added are switched on for every company ${name} has; apps taken away are switched off. Their data stays. An app added comes in free, so it waits in Approvals until a colleague approves it; taking one away is done at once.`,
    plan: `Gives ${name} a plan by hand: a free trial, or active for a deal paid outside CLOR. Only CLOR can set a plan by hand. A trial of up to 90 days is set at once; apps given free for good wait in Approvals until a colleague approves them.`,
    suspend: `Suspending ${name} stops everyone in it from opening any of its companies, to read or to change anything, until you resume. They are told CLOR suspended it and to contact support. Their data stays.`,
    resume: `Everyone in ${name} can sign in and work again.`,
    cancel: `Cancelling stops every app for every company ${name} has. Nobody can work in them until the subscription is reopened. The account and all its data stay.`,
    reopen: `Puts ${name}'s subscription back: on trial if the trial still has days left, otherwise active.`,
  };

  const run = async (reason) => {
    const id = a.id;
    let r = null;
    if (action === 'trial') await opsExtendTrial(id, Number(days), reason);
    if (action === 'apps') r = await opsChangeApps(id, [...withIncluded(apps)], reason);
    if (action === 'plan') r = await opsGrantPlan(id, { apps: [...withIncluded(apps)].map((appCode) => ({ appCode, priceModel: 'free' })), status, reason, ...(status === 'trialing' ? { trialDays: Number(trialDays) } : {}) });
    /* Over the limit: nothing changed yet; a colleague approves it in Approvals (server: services/ops/grants.ts). */
    if (r?.needsApproval) {
      notify.success(`Sent for approval. Nothing changes for ${name} until a colleague approves it in Approvals.`);
      setAction(null);
      reload();
      return;
    }
    if (action === 'suspend') await opsSuspend(id, reason);
    if (action === 'resume') await opsReinstate(id, reason);
    if (action === 'cancel') await opsCancelSubscription(id, reason);
    if (action === 'reopen') await opsReopenSubscription(id, reason);
    notify.success(
      {
        trial: `Trial extended by ${days} days.`,
        apps: 'Apps changed.',
        plan: 'Plan set.',
        suspend: `${name} is suspended.`,
        resume: `${name} can work again.`,
        cancel: `${name}'s subscription is cancelled.`,
        reopen: 'Subscription reopened.',
      }[action],
    );
    setAction(null);
    reload();
  };

  const period = s?.currentPeriodStart || s?.currentPeriodEnd ? `${day(s.currentPeriodStart)} to ${day(s.currentPeriodEnd)}` : '—';
  const w = d.waitingApproval;
  return (
    <>
      {w ? (
        <p className="ws-notice" role="status">
          Waiting in Approvals: {w.summary}. Asked by {w.mine ? 'you' : w.askedBy}, {when(w.createdAt)}. Nothing changes for {name} until {w.mine ? 'a colleague' : 'someone other than the person who asked'} approves it, by {when(w.expiresAt)}.
        </p>
      ) : null}
      <Facts
        rows={[
          ['Status', <StatusPill key="s" status={plan} />],
          ['Apps', s ? appsText(s.apps) : a.legacyUnrestrictedAt ? 'Every app (older account, no plan)' : 'No plan yet'],
          ...(s?.deal?.planName
            ? [
                ['Plan', `${s.deal.planName}${s.deal.quantity && s.deal.unit ? `, ${units(s.deal.unit, s.deal.quantity)}` : ''}`],
                ['Price', `${inr(s.deal.amount)} a ${s.billingInterval === 'year' ? 'year' : 'month'} before GST${s.deal.offerCode && s.deal.amount !== s.deal.listAmount ? ` (${s.deal.offerCode}${s.deal.offerEndsAt ? ` until ${day(s.deal.offerEndsAt)}` : ''}; then ${inr(s.deal.listAmount)})` : ''}`],
              ]
            : []),
          ['Billed', !s ? '—' : s.billingInterval === 'year' ? 'Yearly' : s.billingInterval === 'month' ? 'Monthly' : s.gateway ? `Through ${s.gateway}` : 'Set by hand (no payment taken)'],
          ['Period', period],
          ['Trial', s?.trialEndsAt ? `Ends ${day(s.trialEndsAt)}` : '—'],
          ['Since', s ? day(s.createdAt) : '—'],
        ]}
      />
      {offered.length ? (
        <div className="ops-actions">
          {[offered.filter((k) => ACTIONS[k].tone !== 'danger'), offered.filter((k) => ACTIONS[k].tone === 'danger')].map((group, i) =>
            group.length ? (
              <div key={i} className={i ? 'ops-actions-danger' : 'ops-actions-main'}>
                {group.map((k) => (
                  <button key={k} type="button" className={`ws-btn ${i ? 'ws-btn--danger-quiet' : 'ws-btn--quiet'}`} onClick={() => openAction(k)}>
                    {ACTIONS[k].label}
                  </button>
                ))}
              </div>
            ) : null,
          )}
        </div>
      ) : (
        <p className="ws-card-blurb">Your role can look at this subscription but not change it.</p>
      )}
      <DealDrawer
        open={dealOpen}
        account={{ id: a.id, name }}
        onClose={() => setDealOpen(false)}
        onDone={() => {
          setDealOpen(false);
          reload();
        }}
      />
      <ReasonDrawer
        open={Boolean(action)}
        title={action ? ACTIONS[action].title : ''}
        what={action ? what[action] : ''}
        confirmLabel={action ? ACTIONS[action].confirm : ''}
        tone={action ? ACTIONS[action].tone : 'primary'}
        ready={(action !== 'apps' && action !== 'plan') || apps.size > 0}
        onClose={() => setAction(null)}
        onConfirm={run}
      >
        {action === 'trial' ? (
          <label className="grid gap-1">
            <span className="text-sm font-medium">Extra days</span>
            <input className="ui-input tabular-nums" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} style={{ maxWidth: 140 }} />
          </label>
        ) : null}
        {action === 'apps' || action === 'plan' ? (
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium" style={{ marginBottom: 6 }}>Apps</legend>
            {SELLABLE.map((k) => {
              const included = k === 'attendance' && apps.has('people');
              return (
                <label key={k} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    style={{ marginTop: 4 }}
                    checked={included || apps.has(k)}
                    disabled={included}
                    aria-describedby={included ? 'ops-included-attendance' : undefined}
                    onChange={() => setApps((cur) => withIncluded(toggle(cur, k)))}
                  />
                  <span>
                    {APP_NAMES[k]}
                    {included ? <span id="ops-included-attendance" className="ws-item-sub" style={{ display: 'block' }}>Included with People</span> : null}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : null}
        {action === 'plan' ? (
          <>
            <label className="grid gap-1">
              <span className="text-sm font-medium">Status</span>
              <select className="ui-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="trialing">Free trial</option>
                <option value="active">Active (free, or paid outside CLOR)</option>
              </select>
            </label>
            {status === 'trialing' ? (
              <label className="grid gap-1">
                <span className="text-sm font-medium">Trial length in days</span>
                <input className="ui-input tabular-nums" type="number" min={1} max={365} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} style={{ maxWidth: 140 }} />
              </label>
            ) : null}
          </>
        ) : null}
      </ReasonDrawer>
    </>
  );
}

/* ------------------------------------------------- invoices and payments */
function Money({ id }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    opsCustomerPayments(id).then(setD).catch((e) => setError(String(e?.message || e)));
  }, [id]);
  if (!d) return error ? <Err>{error}</Err> : <Loading />;
  if (!d.invoices.length && !d.payments.length) {
    return <Empty>No invoices or payments yet. Once payments are switched on in Money, this customer’s invoices and payments show here.</Empty>;
  }
  return (
    <div className="ws-table-wrap">
      <table className="ws-table">
        <caption className="sr-only">Payments</caption>
        <thead>
          <tr><th>When</th><th>Through</th><th>What</th><th>Applied</th></tr>
        </thead>
        <tbody>
          {d.payments.map((p) => (
            <tr key={p.id}>
              <td className="tabular-nums">{when(p.at)}</td>
              <td>{p.gateway}</td>
              <td>{p.type.replace(/[._]/g, ' ')}</td>
              <td>{p.applied ? <span className="ws-pill ws-pill--ok">Yes</span> : <span className="ws-pill ws-pill--danger">Not applied</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------- requests */
const DEMO_WORDS = { NEW: 'New', CONTACTED: 'Contacted', DEMO_DONE: 'Demo done', ACCOUNT_CREATED: 'Account created', NOT_A_FIT: 'Not a fit' };

const TICKET_WORDS = { OPEN: 'Needs an answer', WAITING: 'Waiting on customer', SOLVED: 'Solved', CLOSED: 'Closed' };

function Requests({ id, openDemo, openLink }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    opsCustomerRequests(id).then(setD).catch((e) => setError(String(e?.message || e)));
  }, [id]);
  if (!d) return error ? <Err>{error}</Err> : <Loading />;
  return (
    <>
      <Panel title="Demo requests">
        {d.demoRequests.length ? (
          <ul className="ws-list">
            {d.demoRequests.map((r) => (
              <li key={r.id}>
                <div className="ws-item">
                  <span className="ws-item-text">
                    <button type="button" className="ws-name-link" style={{ textAlign: 'left' }} onClick={() => openDemo(r.id)}>
                      {r.name}, {r.company}
                    </button>
                    <span className="ws-item-sub">{r.email} · {day(r.createdAt)} · {DEMO_WORDS[r.status] || r.status} · {appsText(r.apps)}</span>
                    {r.message ? <span className="ws-item-sub">“{r.message}”</span> : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ws-card-blurb">No demo request from this customer’s addresses.</p>
        )}
      </Panel>
      <Panel title="Help tickets">
        {d.support?.length ? (
          <ul className="ws-list">
            {d.support.map((t) => (
              <li key={t.id}>
                <div className="ws-item">
                  <span className="ws-item-text">
                    <button type="button" className="ws-name-link" style={{ textAlign: 'left' }} onClick={() => openLink({ page: 'tickets', id: t.id })}>
                      {t.code} {t.subject}
                    </button>
                    <span className="ws-item-sub">{[TICKET_WORDS[t.status] || t.status, t.priority === 'URGENT' ? 'Urgent' : null, `opened ${day(t.createdAt)}`].filter(Boolean).join(' · ')}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ws-card-blurb">This customer has not asked for help in the app.</p>
        )}
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------ users */
/* What each user action does, said before it is done. */
const DRAWER = {
  reset: { title: 'Send a password reset link', confirm: 'Send link', what: (who) => `${who} gets an email with a link to set a new password. It works for 30 minutes. You never see the link or the password.` },
  signout: { title: 'Sign out everywhere', confirm: 'Sign out everywhere', what: (who) => `${who} is signed out on every phone and computer. A page they have open may keep working for up to 15 minutes.` },
  invite: { title: 'Resend the invitation', confirm: 'Resend invite', what: (who) => `${who} gets a new invitation email. The old link stops working; the new one works for 7 days.` },
  unlock: { title: 'Unlock sign-in', confirm: 'Unlock', what: (who) => `${who} was locked out after too many wrong passwords. Unlocking lets them try again now. Their password does not change.` },
  authenticator: {
    title: 'Remove their authenticator',
    confirm: 'Remove authenticator',
    what: (who) => `${who} can then sign in with only their password, and is signed out everywhere and told by email. Do this only after checking it is really them, for example by calling the number on file. Write who asked and how you checked.`,
  },
};

const ACCOUNT_ROLE = { OWNER: 'Owner', ADMIN: 'Administrator', BILLING_ADMIN: 'Billing administrator', MEMBER: 'Member' };

function Users({ id, role }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [act, setAct] = useState(null); // { kind, user | invitation }
  const load = useCallback(() => {
    opsCustomerUsers(id).then(setD).catch((e) => setError(String(e?.message || e)));
  }, [id]);
  useEffect(load, [load]);
  const support = may(role, 'SUPPORT');
  const owner = role === 'SUPER_ADMIN';

  const run = async (reason) => {
    if (act.kind === 'reset') {
      const r = await opsSendResetLink(id, act.user.userId, reason);
      notify.success(r.sent ? `Reset link sent to ${r.email}. It works for 30 minutes.` : `The reset link to ${r.email} did not go. See Email, Log.`);
    }
    if (act.kind === 'signout') {
      const r = await opsSignOutEverywhere(id, act.user.userId, reason);
      notify.success(r.sessionsEnded ? `Signed out on ${r.sessionsEnded} ${r.sessionsEnded === 1 ? 'device' : 'devices'}.` : 'They were not signed in anywhere.');
    }
    if (act.kind === 'unlock') {
      await opsUnlockUser(id, act.user.userId, reason);
      notify.success(`${act.user.name || act.user.email} can sign in again.`);
    }
    if (act.kind === 'authenticator') {
      const r = await opsResetAuthenticator(id, act.user.userId, reason);
      notify.success(`Authenticator taken off. Signed out on ${r.sessionsEnded} ${r.sessionsEnded === 1 ? 'device' : 'devices'}${r.told ? '; they were told by email' : ''}.`);
    }
    if (act.kind === 'invite') {
      await opsResendInvitation(id, act.invitation.id, reason);
      notify.success(`Invitation sent again to ${act.invitation.email}. The new link works for 7 days.`);
    }
    setAct(null);
    load();
  };

  if (!d) return error ? <Err>{error}</Err> : <Loading />;
  const who = act?.user ? act.user.name || act.user.email : act?.invitation?.email;
  return (
    <>
      <div className="ws-table-wrap">
        <table className="ws-table ops-stack">
          <caption className="sr-only">Users</caption>
          <thead>
            <tr>
              <th>Name</th>
              <th className="hidden sm:table-cell">Role</th>
              <th className="hidden md:table-cell">Authenticator</th>
              <th className="hidden md:table-cell">Last sign-in</th>
              <th className="hidden lg:table-cell">Signed in on</th>
              {support ? <th><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {d.users.map((u) => (
              <tr key={u.userId}>
                <td className="ops-primary">
                  <strong style={{ fontWeight: 600 }}>{u.name || '—'}</strong>
                  {u.status === 'off' ? <> <span className="ws-pill ws-pill--off">Off</span></> : null}
                  {u.lockedUntil ? <> <span className="ws-pill ws-pill--warn" title={`Locked until ${when(u.lockedUntil)}`}>Locked out</span></> : null}
                  <div className="ws-item-sub">{u.email}{u.emailConfirmed ? '' : ' · email not confirmed'}</div>
                </td>
                <td className="hidden sm:table-cell" data-label="Role">{ACCOUNT_ROLE[u.role] || u.role}</td>
                <td className="hidden md:table-cell" data-label="Authenticator">{u.authenticator ? 'Yes' : 'No'}</td>
                <td className="hidden md:table-cell" data-label="Last sign-in">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
                <td className="hidden lg:table-cell tabular-nums" data-label="Signed in on">{u.signedInOn ? `${u.signedInOn} ${u.signedInOn === 1 ? 'device' : 'devices'}` : '—'}</td>
                {support ? (
                  <td className="num ops-stack-actions">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={u.status === 'off'} onClick={() => setAct({ kind: 'reset', user: u })}>Send reset link</button>
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={!u.signedInOn} onClick={() => setAct({ kind: 'signout', user: u })}>Sign out everywhere</button>
                      {u.lockedUntil || u.wrongPasswords ? <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setAct({ kind: 'unlock', user: u })}>Unlock</button> : null}
                      {owner && u.authenticator ? <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setAct({ kind: 'authenticator', user: u })}>Remove authenticator</button> : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Panel title="Invitations not taken up">
        {d.invitations.length ? (
          <ul className="ws-list">
            {d.invitations.map((i) => (
              <li key={i.id}>
                <div className="ws-item">
                  <span className="ws-item-text">
                    <span className="ws-item-title">{i.email}</span>
                    <span className="ws-item-sub">
                      {ACCOUNT_ROLE[i.accountRole] || i.accountRole} · sent {i.sendCount} {i.sendCount === 1 ? 'time' : 'times'}, last {day(i.lastSentAt)} · {i.expired ? 'link has run out' : `link works until ${day(i.expiresAt)}`}
                    </span>
                  </span>
                  {support ? <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setAct({ kind: 'invite', invitation: i })}>Resend invite</button> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ws-card-blurb">None waiting.</p>
        )}
      </Panel>
      <ReasonDrawer
        open={Boolean(act)}
        title={DRAWER[act?.kind]?.title || ''}
        what={act ? DRAWER[act.kind].what(who) : ''}
        confirmLabel={DRAWER[act?.kind]?.confirm || ''}
        tone={act?.kind === 'signout' || act?.kind === 'authenticator' ? 'danger' : 'primary'}
        onClose={() => setAct(null)}
        onConfirm={run}
      />
    </>
  );
}

/* ------------------------------------------------------------ connections */
const CONNECTION_STATE = {
  ok: ['Working', 'ws-pill--ok'],
  off: ['Off', 'ws-pill--off'],
  offline: ['Not heard from', 'ws-pill--warn'],
  error: ['Reports an error', 'ws-pill--danger'],
};
const CREDENTIAL_KIND = { API_KEY: 'API keys', SCIM: 'Directory sync tokens', AGENT: 'Site agent tokens', DEVICE_PUSH: 'Reader push keys', PAY_LINK: 'Payment links', SHARE_LINK: 'Share links' };

/**
 * What this customer has connected — attendance readers, site agents, HR
 * and sign-on connections, e-invoicing — and whether each last worked; and
 * their failed email, which Support can send again. Names and errors only.
 */
function Connections({ id, role }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(false);
  const load = useCallback(() => {
    opsCustomerConnections(id).then(setD).catch((e) => setError(String(e?.message || e)));
  }, [id]);
  useEffect(load, [load]);

  if (!d) return error ? <Err>{error}</Err> : <Loading />;
  const troubled = d.items.filter((i) => i.state === 'error' || i.state === 'offline').length;
  return (
    <>
      <Facts
        rows={[
          ['Connections', d.items.length ? `${d.items.length}${troubled ? `, ${troubled} need a look` : ', all fine'}` : 'None set up'],
          ['Emails that failed this week', <span key="m" className="tabular-nums">{d.emailsFailedThisWeek}</span>],
          ['Webhook deliveries that failed this week', <span key="w" className="tabular-nums">{d.webhooksFailedThisWeek}</span>],
          ['Open reader alerts', <span key="r" className="tabular-nums">{d.openReaderAlerts}</span>],
        ]}
      />
      {d.emailsFailedThisWeek && may(role, 'SUPPORT') ? (
        <div>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setRetry(true)}>Send failed emails again</button>
        </div>
      ) : null}
      <Panel title="What they have connected">
        {d.items.length ? (
          <ul className="ws-list">
            {d.items.map((i) => {
              const [word, cls] = CONNECTION_STATE[i.state] || [i.state, ''];
              return (
                <li key={`${i.kind}-${i.id}`}>
                  <div className="ws-item">
                    <span className="ws-item-text">
                      <span className="ws-item-title">{i.name}</span>
                      <span className="ws-item-sub">
                        {i.kind}
                        {i.lastAt ? ` · last seen ${ago(i.lastAt)}` : ''}
                        {i.error ? ` · ${i.error}` : ''}
                      </span>
                    </span>
                    <span className={`ws-pill ${cls}`}>{word}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>No readers, agents, HR, sign-on or e-invoice connections.</Empty>
        )}
      </Panel>
      {d.credentials.length ? (
        <Panel title="Keys and tokens they have made">
          <ul className="ws-list">
            {d.credentials.map((c) => (
              <li key={`${c.kind}-${c.status}`}>
                <div className="ws-item">
                  <span className="ws-item-text">
                    <span className="ws-item-title">{CREDENTIAL_KIND[c.kind] || c.kind}</span>
                    <span className="ws-item-sub">{c.status.toLowerCase()}</span>
                  </span>
                  <span className="tabular-nums">{c.count}</span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <ReasonDrawer
        open={retry}
        title="Send failed emails again"
        what={`Every email to this customer that failed in the last week (${d.emailsFailedThisWeek}, at most 50) is tried once more, as it was.`}
        confirmLabel="Send again"
        onClose={() => setRetry(false)}
        onConfirm={async (reason) => {
          const r = await opsRetryEmails(id, reason);
          notify.success(r.tried ? `${r.sent} of ${r.tried} went. ${r.stillFailing ? `${r.stillFailing} still failing; see Email, Log.` : ''}` : 'Nothing was waiting.');
          setRetry(false);
          load();
        }}
      />
    </>
  );
}

/* --------------------------------------------------------------- timeline */
/* The customer's story (server: services/ops/timeline.ts). Sign-ins are many and rarely the point, so they have their own view. */
const KINDS = [
  ['key', 'Everything but sign-ins'],
  ['all', 'Everything'],
  ['account', 'Account and companies'],
  ['money', 'Invoices and payments'],
  ['support', 'Help, demos and alerts'],
  ['clor', 'What CLOR did'],
  ['people', 'What their people did'],
  ['sign-in', 'Sign-ins'],
];
const TONE = { good: 'rgb(var(--ws-ok))', bad: 'rgb(var(--ws-danger))' };
const dayHead = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const clock = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

function TimelineRow({ l, openLink }) {
  return (
    <div className="ws-item" style={{ alignItems: 'flex-start' }}>
      <span className="ws-item-sub ui-num" style={{ flex: 'none', width: 64, paddingTop: 2 }}>
        {clock(l.at)}
      </span>
      <span className="ws-item-text">
        {l.link ? (
          <button type="button" className="ws-name-link" style={{ textAlign: 'left' }} onClick={() => openLink(l.link)}>
            {l.what}
          </button>
        ) : (
          <span className="ws-item-title">{l.what}</span>
        )}
        {l.who || l.detail ? <span className="ws-item-sub">{[l.who, l.detail].filter(Boolean).join(' · ')}</span> : null}
      </span>
      {l.amount != null ? (
        <span className="ui-num" style={{ flex: 'none', textAlign: 'right', color: TONE[l.tone] || undefined }}>
          {inr(l.amount)}
        </span>
      ) : l.tone === 'bad' ? (
        <span className="ws-pill ws-pill--danger" style={{ flex: 'none' }}>
          Problem
        </span>
      ) : null}
    </div>
  );
}

function Timeline({ id, openLink }) {
  const [d, setD] = useState(null);
  const [kind, setKind] = useState('key');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    opsCustomerActivity(id).then(setD).catch((e) => setError(String(e?.message || e)));
  }, [id]);
  const older = async () => {
    setBusy(true);
    setError('');
    try {
      const next = await opsCustomerActivity(id, d.older);
      setD((was) => ({ ...was, lines: [...was.lines, ...next.lines], older: next.older }));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  if (!d) return error ? <Err>{error}</Err> : <Loading />;
  const lines = d.lines.filter((l) => kind === 'all' || (kind === 'key' ? l.kind !== 'sign-in' : l.kind === kind));
  const days = [];
  for (const l of lines) {
    const head = dayHead(l.at);
    if (days.length && days[days.length - 1].head === head) days[days.length - 1].lines.push(l);
    else days.push({ head, lines: [l] });
  }
  return (
    <>
      {d.upcoming?.length ? (
        <Panel title="Coming up">
          <ul className="ws-list">
            {d.upcoming.map((u) => (
              <li key={u.id}>
                <div className="ws-item">
                  <span className="ws-item-text">
                    {u.link ? (
                      <button type="button" className="ws-name-link" style={{ textAlign: 'left' }} onClick={() => openLink(u.link)}>
                        {u.what}
                      </button>
                    ) : (
                      <span className="ws-item-title" style={u.tone === 'bad' ? { color: TONE.bad } : undefined}>
                        {u.what}
                      </span>
                    )}
                  </span>
                  <span className="ws-item-end">{day(u.at)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <div style={{ maxWidth: 280 }}>
        <select className="ui-select" aria-label="Show" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <Err>{error}</Err>
      {days.length ? (
        days.map((g) => (
          <section key={g.head} aria-label={g.head}>
            <h3 className="ws-item-sub" style={{ fontWeight: 600, margin: '16px 0 2px' }}>
              {g.head}
            </h3>
            <ul className="ws-list">
              {g.lines.map((l) => (
                <li key={l.id}>
                  <TimelineRow l={l} openLink={openLink} />
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <Empty>{d.older ? 'Nothing of this kind on this page. Show older events to look further back.' : 'Nothing of this kind recorded yet.'}</Empty>
      )}
      {d.older ? (
        <div>
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={busy} onClick={older}>
            {busy ? 'Loading…' : 'Show older events'}
          </button>
        </div>
      ) : null}
    </>
  );
}

