import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Search } from '@ui/components/ui/lineIcons';

import { notify } from '@ui/components/ui/notify';
import { ICON, PageHead, Panel, ago } from '../../apps/admin/src/screens/wsKit';
import { APP_NAMES, Empty, Err, Loading, Pager, ReasonDrawer, SELLABLE, Tabs, appsText, day, may, when } from './kit';
import {
  opsAccount,
  opsAccounts,
  opsCancelSubscription,
  opsChangeApps,
  opsCustomerActivity,
  opsCustomerPayments,
  opsCustomerRequests,
  opsCustomerUsers,
  opsExtendTrial,
  opsGrantPlan,
  opsReinstate,
  opsReopenSubscription,
  opsResendInvitation,
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
      <PageHead crumbs={['Customers']} title="Customers" meta={data ? `${data.total} ${data.total === 1 ? 'customer' : 'customers'}` : null} />
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
                <th className="hidden lg:table-cell">Apps</th>
                <th className="hidden lg:table-cell">Plan</th>
                <th>Status</th>
                <th className="hidden md:table-cell">Trial ends or renews</th>
                <th className="num hidden sm:table-cell">Users</th>
                <th className="hidden md:table-cell">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => {
                const status = customerStatus(a.plan, a.trialEndsAt);
                return (
                  <tr key={a.id}>
                    <td>
                      <button type="button" className="ws-name-link" onClick={() => openCustomer(a.id)}>{a.name}</button>
                      <div className="ws-item-sub tabular-nums">{a.code || '—'}</div>
                    </td>
                    <td className="hidden md:table-cell">
                      <div>{a.owner?.name || '—'}</div>
                      <div className="ws-item-sub">{a.owner?.email || ''}</div>
                    </td>
                    <td className="hidden lg:table-cell" style={{ whiteSpace: 'normal' }}>{appsText(a.apps)}</td>
                    <td className="hidden lg:table-cell">{planWords(a)}</td>
                    <td><StatusPill status={status} /></td>
                    <td className="hidden md:table-cell tabular-nums">{a.plan === 'trialing' ? day(a.trialEndsAt) : a.renewsAt ? day(a.renewsAt) : '—'}</td>
                    <td className="num hidden sm:table-cell">{a.users}</td>
                    <td className="hidden md:table-cell">{a.lastActiveAt ? ago(a.lastActiveAt) : 'Never'}</td>
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
  ['money', 'Invoices and payments'],
  ['requests', 'Requests'],
  ['users', 'Users'],
  ['activity', 'Activity'],
];

export function CustomerPage({ id, tab = 'overview', role, back, setTab, openDemo }) {
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
  const plan = a.suspendedAt ? 'suspended' : s ? customerStatus(s.status, s.trialEndsAt) : a.legacyUnrestrictedAt ? 'legacy' : 'no-plan';
  return (
    <>
      <div>
        <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={back}>
          <ArrowLeft size={14} aria-hidden="true" /> Customers
        </button>
      </div>
      <PageHead
        crumbs={['Customers']}
        title={a.name}
        meta={
          <>
            <span className="tabular-nums">{a.code || '—'}</span> · <StatusPill status={plan} />
          </>
        }
      />
      {a.suspendedAt ? (
        <p className="ws-notice" role="status">
          Suspended on {day(a.suspendedAt)}: {a.suspendedReason}. Nobody in this account can open any of its companies until it is resumed.
        </p>
      ) : null}
      <Tabs label={`${a.name}`} tabs={TABS} value={tab} onChange={setTab} />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="grid gap-6">
        {tab === 'overview' ? <Overview d={d} plan={plan} /> : null}
        {tab === 'subscription' ? <Subscription d={d} plan={plan} role={role} reload={load} /> : null}
        {tab === 'money' ? <Money id={id} /> : null}
        {tab === 'requests' ? <Requests id={id} openDemo={openDemo} /> : null}
        {tab === 'users' ? <Users id={id} role={role} /> : null}
        {tab === 'activity' ? <Activity id={id} /> : null}
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

function Overview({ d, plan }) {
  const owners = d.members.filter((m) => m.role === 'OWNER');
  const s = d.subscription;
  return (
    <>
      <Facts
        rows={[
          ['Owner', owners.length ? owners.map((o) => <div key={o.userId}>{o.name || '—'} · <a href={`mailto:${o.email}`}>{o.email}</a></div>) : '—'],
          ['Status', <StatusPill key="s" status={plan} />],
          ['Apps on', s ? appsText(s.apps) : d.account.legacyUnrestrictedAt ? 'Every app (older account)' : 'None'],
          ['Users', d.members.length],
          ['Created', day(d.account.createdAt)],
          ['Last activity', d.lastActiveAt ? `${ago(d.lastActiveAt)} (${when(d.lastActiveAt)})` : 'Nobody has signed in yet'],
        ]}
      />
      <Panel title={`Companies and branches (${d.companies.length})`}>
        {d.companies.length ? (
          <ul className="ws-list">
            {d.companies.map((c) => (
              <li key={c.id}>
                <div className="ws-item">
                  <span className="ws-tile ws-tile--sm" aria-hidden="true"><ICON.company size={14} /></span>
                  <span className="ws-item-text">
                    <span className="ws-item-title">{c.name}</span>
                    <span className="ws-item-sub">
                      <span className="tabular-nums">{c.code || '—'}</span> · {c.people} {c.people === 1 ? 'person' : 'people'} · since {day(c.createdAt)}
                    </span>
                    {c.branches?.length ? (
                      <span className="ws-item-sub">Branches: {c.branches.map((b) => `${b.name}${b.state ? ` (${b.state})` : ''}`).join(', ')}</span>
                    ) : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ws-card-blurb">No company yet. The owner makes one when they first sign in.</p>
        )}
      </Panel>
    </>
  );
}

/* ----------------------------------------------------------- subscription */
const ACTIONS = {
  trial: { label: 'Extend trial', title: 'Extend the trial', confirm: 'Extend trial', roles: ['BILLING', 'SALES'] },
  apps: { label: 'Change apps', title: 'Change apps', confirm: 'Change apps', roles: ['BILLING'] },
  plan: { label: 'Set a plan', title: 'Set a plan', confirm: 'Set plan', roles: ['BILLING'] },
  suspend: { label: 'Suspend', title: 'Suspend this customer', confirm: 'Suspend', roles: ['SUPPORT', 'BILLING'], tone: 'danger' },
  resume: { label: 'Resume', title: 'Resume this customer', confirm: 'Resume', roles: ['SUPPORT', 'BILLING'] },
  cancel: { label: 'Cancel subscription', title: 'Cancel the subscription', confirm: 'Cancel subscription', roles: ['BILLING'], tone: 'danger' },
  reopen: { label: 'Reopen', title: 'Reopen the subscription', confirm: 'Reopen', roles: ['BILLING'] },
};

function Subscription({ d, plan, role, reload }) {
  const a = d.account;
  const s = d.subscription;
  const [action, setAction] = useState(null);
  const [days, setDays] = useState(14);
  const [apps, setApps] = useState(new Set());
  const [trialDays, setTrialDays] = useState(30);
  const [status, setStatus] = useState('trialing');
  const openAction = (k) => {
    if (k === 'apps') setApps(new Set(s?.apps || []));
    if (k === 'plan') setApps(new Set(['accounting']));
    setAction(k);
  };

  const can = (k) => may(role, ...ACTIONS[k].roles);
  const offered = [
    !s && can('plan') ? 'plan' : null,
    s?.status === 'trialing' && can('trial') ? 'trial' : null,
    s && s.status !== 'cancelled' && can('apps') ? 'apps' : null,
    s && s.status !== 'cancelled' && can('cancel') ? 'cancel' : null,
    s?.status === 'cancelled' && can('reopen') ? 'reopen' : null,
    a.suspendedAt ? (can('resume') ? 'resume' : null) : can('suspend') ? 'suspend' : null,
  ].filter(Boolean);

  const what = {
    trial: `The trial ends on ${day(s?.trialEndsAt)}. The extra days are added to that date, or to today if it has passed.`,
    apps: 'Apps added are switched on for every company in the account; apps taken away are switched off. Their data stays.',
    plan: 'Gives this customer a plan by hand: a free trial, or active for a deal paid outside CLOR. Only CLOR can set a plan by hand.',
    suspend: 'Nobody in this account can open any of its companies until you resume it. They see that CLOR suspended it and to contact support.',
    resume: 'Everybody in this account can sign in and work again.',
    cancel: 'The apps stop for every company in this account. The account and all its data stay, and the subscription can be reopened.',
    reopen: 'Puts the subscription back: on trial if the trial still has days left, otherwise active.',
  };

  const run = async (reason) => {
    const id = a.id;
    if (action === 'trial') await opsExtendTrial(id, Number(days), reason);
    if (action === 'apps') await opsChangeApps(id, [...apps], reason);
    if (action === 'plan') await opsGrantPlan(id, { apps: [...apps].map((appCode) => ({ appCode, priceModel: 'free' })), status, reason, ...(status === 'trialing' ? { trialDays: Number(trialDays) } : {}) });
    if (action === 'suspend') await opsSuspend(id, reason);
    if (action === 'resume') await opsReinstate(id, reason);
    if (action === 'cancel') await opsCancelSubscription(id, reason);
    if (action === 'reopen') await opsReopenSubscription(id, reason);
    notify.success(
      {
        trial: `Trial extended by ${days} days.`,
        apps: 'Apps changed.',
        plan: 'Plan set.',
        suspend: `${a.name} is suspended.`,
        resume: `${a.name} can work again.`,
        cancel: 'Subscription cancelled.',
        reopen: 'Subscription reopened.',
      }[action],
    );
    setAction(null);
    reload();
  };

  const period = s?.currentPeriodStart || s?.currentPeriodEnd ? `${day(s.currentPeriodStart)} to ${day(s.currentPeriodEnd)}` : '—';
  return (
    <>
      <Facts
        rows={[
          ['Status', <StatusPill key="s" status={plan} />],
          ['Apps', s ? appsText(s.apps) : a.legacyUnrestrictedAt ? 'Every app (older account, no plan)' : 'No plan yet'],
          ['Billed', !s ? '—' : s.billingInterval === 'year' ? 'Yearly' : s.billingInterval === 'month' ? 'Monthly' : s.gateway ? `Through ${s.gateway}` : 'Set by hand (no payment taken)'],
          ['Period', period],
          ['Trial', s?.trialEndsAt ? `Ends ${day(s.trialEndsAt)}` : '—'],
          ['Since', s ? day(s.createdAt) : '—'],
        ]}
      />
      {offered.length ? (
        <div className="flex flex-wrap gap-2">
          {offered.map((k) => (
            <button key={k} type="button" className="ws-btn ws-btn--quiet" onClick={() => openAction(k)}>
              {ACTIONS[k].label}
            </button>
          ))}
        </div>
      ) : (
        <p className="ws-card-blurb">Your role can look at this subscription but not change it.</p>
      )}
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
            {SELLABLE.map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={apps.has(k)} onChange={() => setApps((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
                {APP_NAMES[k]}
              </label>
            ))}
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

function Requests({ id, openDemo }) {
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
      <Panel title="Support messages">
        <p className="ws-card-blurb">CLOR does not take support messages in the app yet. When it does, this customer’s show here.</p>
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------ users */
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

  const run = async (reason) => {
    if (act.kind === 'reset') {
      const r = await opsSendResetLink(id, act.user.userId, reason);
      notify.success(r.sent ? `Reset link sent to ${r.email}. It works for 30 minutes.` : `The reset link to ${r.email} did not go. See Email, Log.`);
    }
    if (act.kind === 'signout') {
      const r = await opsSignOutEverywhere(id, act.user.userId, reason);
      notify.success(r.sessionsEnded ? `Signed out on ${r.sessionsEnded} ${r.sessionsEnded === 1 ? 'device' : 'devices'}.` : 'They were not signed in anywhere.');
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
        <table className="ws-table">
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
                <td>
                  <strong style={{ fontWeight: 600 }}>{u.name || '—'}</strong>
                  {u.status === 'off' ? <> <span className="ws-pill ws-pill--off">Off</span></> : null}
                  <div className="ws-item-sub">{u.email}{u.emailConfirmed ? '' : ' · email not confirmed'}</div>
                </td>
                <td className="hidden sm:table-cell">{ACCOUNT_ROLE[u.role] || u.role}</td>
                <td className="hidden md:table-cell">{u.authenticator ? 'Yes' : 'No'}</td>
                <td className="hidden md:table-cell">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
                <td className="hidden lg:table-cell tabular-nums">{u.signedInOn ? `${u.signedInOn} ${u.signedInOn === 1 ? 'device' : 'devices'}` : '—'}</td>
                {support ? (
                  <td className="num">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={u.status === 'off'} onClick={() => setAct({ kind: 'reset', user: u })}>Send reset link</button>
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={!u.signedInOn} onClick={() => setAct({ kind: 'signout', user: u })}>Sign out everywhere</button>
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
        title={act?.kind === 'reset' ? 'Send a password reset link' : act?.kind === 'signout' ? 'Sign out everywhere' : 'Resend the invitation'}
        what={
          act?.kind === 'reset'
            ? `${who} gets an email with a link to set a new password. It works for 30 minutes. You never see the link or the password.`
            : act?.kind === 'signout'
              ? `${who} is signed out on every phone and computer. A page they have open may keep working for up to 15 minutes.`
              : `${who} gets a new invitation email. The old link stops working; the new one works for 7 days.`
        }
        confirmLabel={act?.kind === 'reset' ? 'Send link' : act?.kind === 'signout' ? 'Sign out everywhere' : 'Resend invite'}
        tone={act?.kind === 'signout' ? 'danger' : 'primary'}
        onClose={() => setAct(null)}
        onConfirm={run}
      />
    </>
  );
}

/* --------------------------------------------------------------- activity */
const KINDS = [
  ['all', 'Everything'],
  ['clor', 'What CLOR did'],
  ['account', 'What their people did'],
  ['sign-in', 'Sign-ins'],
];

function Activity({ id }) {
  const [d, setD] = useState(null);
  const [kind, setKind] = useState('all');
  const [error, setError] = useState('');
  useEffect(() => {
    opsCustomerActivity(id).then(setD).catch((e) => setError(String(e?.message || e)));
  }, [id]);
  if (!d) return error ? <Err>{error}</Err> : <Loading />;
  const lines = d.lines.filter((l) => kind === 'all' || l.kind === kind);
  return (
    <>
      <select className="ui-select" style={{ width: 'auto' }} aria-label="Show" value={kind} onChange={(e) => setKind(e.target.value)}>
        {KINDS.map(([k, label]) => (
          <option key={k} value={k}>{label}</option>
        ))}
      </select>
      {lines.length ? (
        <ul className="ws-list">
          {lines.map((l) => (
            <li key={l.id}>
              <div className="ws-item">
                <span className="ws-item-text">
                  <span className="ws-item-title">{l.what}</span>
                  <span className="ws-item-sub">
                    {[l.kind === 'clor' ? `${l.who}, CLOR` : l.who, when(l.at), l.detail].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nothing recorded yet.</Empty>
      )}
    </>
  );
}
