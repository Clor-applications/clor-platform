import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, KeyRound, LogOut, Search } from '@ui/components/ui/lineIcons';
import QRCode from 'qrcode';

import { ClorLogo } from '@ui/components/brand';
import { IconSetContext, LineSetContext } from '@ui/components/ui/iconSet';
import Toaster from '@ui/components/ui/Toaster';
import { notify } from '@ui/components/ui/notify';
import { ICON, PageHead, Panel, Stat, WsDrawer, ago } from '../../apps/admin/src/screens/wsKit';
import '../../apps/admin/src/screens/workspace.css';
import { useSession } from '../shell/session';
import SignIn from '../shell/SignIn';
import OperatorBrand from './OperatorBrand';
import { DemoRequestDetail, DemoRequests } from './DemoRequests';
import {
  opsAccount,
  opsAccounts,
  opsAddOperator,
  opsAudit,
  opsChangeOperator,
  opsEnableTwoFactor,
  opsExtendTrial,
  opsGrantPlan,
  opsMe,
  opsOperators,
  opsOverview,
  opsReinstate,
  opsStartTwoFactor,
  opsSuspend,
} from './api';

/**
 * The Clor operator console (W-8.2), at ops.clor.in (or /ops on any Clor
 * host). Clor staff only: the server refuses anybody else and any operator
 * without an authenticator, and asks for a fresh code before every change.
 *
 * What it shows is account metadata — owners, companies, apps, plan, sign-in
 * dates — never a customer's books, people or payroll.
 */
const ROLE = { SUPER_ADMIN: 'Super admin', SUPPORT: 'Support', BILLING: 'Billing' };
const PLAN = { active: 'Active', trialing: 'Trial', past_due: 'Past due', paused: 'Paused', cancelled: 'Cancelled', legacy: 'Legacy (open)', 'no-plan': 'No plan', suspended: 'Suspended' };
const APPS = [
  ['accounting', 'Accounting'],
  ['payroll', 'Payroll'],
  ['people', 'People'],
  ['attendance', 'Attendance'],
];
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const may = (role, ...roles) => role === 'SUPER_ADMIN' || roles.includes(role);

function PlanPill({ plan }) {
  const tone = plan === 'active' || plan === 'legacy' ? 'ws-pill ws-pill--ok' : plan === 'suspended' || plan === 'past_due' ? 'ws-pill ws-pill--danger' : plan === 'trialing' ? 'ws-pill ws-pill--warn' : 'ws-pill';
  return <span className={tone}>{PLAN[plan] || plan}</span>;
}

/* ----------------------------------------------------------------- overview */
function Overview({ openAccounts }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    opsOverview().then(setD).catch((e) => setError(String(e?.message || e)));
  }, []);
  const peak = useMemo(() => Math.max(1, ...(d?.signups || []).map((s) => s.count)), [d]);
  return (
    <>
      <PageHead crumbs={['Operator']} title="Overview" />
      {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}
      {d ? (
        <>
          <div className="ws-stats">
            <Stat icon={ICON.companies} label="Accounts" value={d.accounts} note={`${d.companies} companies`} onOpen={() => openAccounts('all')} />
            <Stat icon={ICON.people} label="Active users" value={d.users} note={`${d.activeUsers7d} signed in this week`} />
            <Stat icon={ICON.plan} tone={d.trialsEndingIn7d ? 'warn' : null} label="Trials ending" value={d.trialsEndingIn7d} note="within 7 days" onOpen={() => openAccounts('trialing')} />
            <Stat icon={ICON.warning} tone={d.suspended ? 'warn' : null} label="Suspended" value={d.suspended} onOpen={() => openAccounts('suspended')} />
          </div>
          <Panel title="Sign-ups, last 30 days">
            <div className="ops-bars" role="img" aria-label={`Sign-ups over the last 30 days: ${d.signups.reduce((n, s) => n + s.count, 0)} in total`}>
              {d.signups.map((s) => (
                <span key={s.day} className="ops-bar" title={`${s.day}: ${s.count}`} style={{ height: `${Math.max(3, (s.count / peak) * 100)}%` }} />
              ))}
            </div>
            <div className="ops-bars-axis">
              <span>{day(d.signups[0]?.day)}</span>
              <span>{day(d.signups[d.signups.length - 1]?.day)}</span>
            </div>
          </Panel>
        </>
      ) : error ? null : (
        <p className="ws-card-blurb">Loading…</p>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- accounts */
function Accounts({ initialStatus = 'all', openAccount }) {
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
      <PageHead crumbs={['Operator']} title="Accounts" meta={data ? `${data.total} accounts` : null} />
      <div className="flex flex-wrap gap-2 items-center" role="search">
        <label className="relative flex-1 min-w-[16rem]" style={{ maxWidth: 460 }}>
          <span className="sr-only">Search accounts</span>
          <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 ui-muted" />
          <input className="ui-input" style={{ paddingLeft: '2.25rem' }} value={view.q} onChange={(e) => setView((v) => ({ ...v, q: e.target.value, page: 0 }))} placeholder="Account, company, client ID or email" />
        </label>
        <select className="ui-select" style={{ width: 'auto' }} aria-label="Status" value={view.status} onChange={(e) => setView((v) => ({ ...v, status: e.target.value, page: 0 }))}>
          <option value="all">Every status</option>
          <option value="active">Active</option>
          <option value="trialing">On trial</option>
          <option value="no-plan">No plan</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>
      {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}
      {!data ? (
        <p className="ws-card-blurb">Loading…</p>
      ) : data.accounts.length === 0 ? (
        <div className="ws-empty"><p>No account matches.</p></div>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Customer accounts</caption>
            <thead>
              <tr>
                <th>Account</th>
                <th>Owner</th>
                <th>Plan</th>
                <th className="num">Companies</th>
                <th className="num">Users</th>
                <th>Last active</th>
                <th>Signed up</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.id}>
                  <td>
                    <button type="button" className="ws-name-link" onClick={() => openAccount(a.id)}>{a.name}</button>
                    <div className="ws-item-sub ui-mono">{a.code || '—'}</div>
                  </td>
                  <td>
                    <div>{a.owner?.name || '—'}</div>
                    <div className="ws-item-sub">{a.owner?.email || ''}</div>
                  </td>
                  <td>
                    <PlanPill plan={a.plan} />
                    {a.plan === 'trialing' && a.trialEndsAt ? <div className="ws-item-sub">ends {day(a.trialEndsAt)}</div> : null}
                  </td>
                  <td className="num">{a.companies}</td>
                  <td className="num">{a.users}</td>
                  <td>{a.lastActiveAt ? ago(a.lastActiveAt) : 'never'}</td>
                  <td>{day(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 ? (
        <nav className="flex items-center gap-2" aria-label="Pages">
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={view.page === 0} onClick={() => setView((v) => ({ ...v, page: v.page - 1 }))}>Previous</button>
          <span className="ws-head-meta">Page {view.page + 1} of {pages}</span>
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={view.page + 1 >= pages} onClick={() => setView((v) => ({ ...v, page: v.page + 1 }))}>Next</button>
        </nav>
      ) : null}
    </>
  );
}

/* ----------------------------------------------------------- one account */
function AccountDetail({ id, role, back }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState(null); // 'suspend' | 'reinstate' | 'trial' | 'plan'
  const load = useCallback(() => {
    opsAccount(id).then(setD).catch((e) => setError(String(e?.message || e)));
  }, [id]);
  useEffect(load, [load]);

  if (!d) return error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : <p className="ws-card-blurb">Loading…</p>;
  const a = d.account;
  const s = d.subscription;
  const plan = a.suspendedAt ? 'suspended' : s ? s.status : a.legacyUnrestrictedAt ? 'legacy' : 'no-plan';
  return (
    <>
      <div>
        <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={back}>
          <ArrowLeft size={14} aria-hidden="true" /> Accounts
        </button>
      </div>
      <PageHead
        crumbs={['Operator · Accounts']}
        title={a.name}
        meta={<><span className="ui-mono">{a.code || '—'}</span> · since {day(a.createdAt)}</>}
        actions={
          <>
            {may(role, 'BILLING') ? (
              <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setAction('plan')}>Grant plan</button>
            ) : null}
            {may(role, 'BILLING') && s?.status === 'trialing' ? (
              <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setAction('trial')}>Extend trial</button>
            ) : null}
            {may(role, 'SUPPORT') ? (
              a.suspendedAt ? (
                <button type="button" className="ws-btn ws-btn--primary" onClick={() => setAction('reinstate')}>Reinstate</button>
              ) : (
                <button type="button" className="ws-btn ws-btn--danger" onClick={() => setAction('suspend')}>Suspend</button>
              )
            ) : null}
          </>
        }
      />
      {a.suspendedAt ? (
        <p className="ws-notice" role="status">Suspended {day(a.suspendedAt)}: {a.suspendedReason}</p>
      ) : null}

      <div className="ws-stats">
        <Stat icon={ICON.plan} label="Plan" value={<PlanPill plan={plan} />} note={s?.trialEndsAt ? `trial ends ${day(s.trialEndsAt)}` : s?.currentPeriodEnd ? `renews ${day(s.currentPeriodEnd)}` : s?.gateway ? s.gateway : 'set by hand'} />
        <Stat icon={ICON.companies} label="Companies" value={d.companies.length} />
        <Stat icon={ICON.people} label="Members" value={d.members.length} note={`${d.members.filter((m) => m.role === 'OWNER').length} owner(s)`} />
        <Stat icon={ICON.apps} label="Apps" value={s?.apps?.length ?? (a.legacyUnrestrictedAt ? 'All' : 0)} note={(s?.apps || []).join(', ') || (a.legacyUnrestrictedAt ? 'legacy account' : 'none')} />
      </div>

      <div className="ws-layout">
        <div className="ws-main">
          <Panel title="Members">
            <div className="ws-table-wrap">
              <table className="ws-table">
                <thead>
                  <tr><th>Name</th><th>Account role</th><th>Status</th><th>Authenticator</th><th>Last sign-in</th></tr>
                </thead>
                <tbody>
                  {d.members.map((m) => (
                    <tr key={m.userId}>
                      <td><strong style={{ fontWeight: 600 }}>{m.name || '—'}</strong><div className="ws-item-sub">{m.email}</div></td>
                      <td>{m.role}</td>
                      <td>{m.status === 'SUSPENDED' ? <span className="ws-pill ws-pill--danger">Suspended</span> : <span className="ws-pill ws-pill--ok">Active</span>}</td>
                      <td>{m.authenticator ? 'Yes' : 'No'}</td>
                      <td>{m.lastLoginAt ? ago(m.lastLoginAt) : 'never'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Companies">
            <ul className="ws-list">
              {d.companies.map((c) => (
                <li key={c.id}>
                  <div className="ws-item">
                    <span className="ws-tile ws-tile--sm" aria-hidden="true"><ICON.company size={14} /></span>
                    <span className="ws-item-text">
                      <span className="ws-item-title">{c.name}</span>
                      <span className="ws-item-sub"><span className="ui-mono">{c.code || '—'}</span> · {c.people} people · since {day(c.createdAt)}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <aside className="ws-side">
          <Panel title="What Clor did here">
            {d.operatorEvents.length ? (
              <ul className="ws-list">
                {d.operatorEvents.map((e) => (
                  <li key={e.id}>
                    <div className="ws-item">
                      <span className="ws-item-text">
                        <span className="ws-item-title">{e.action.replace(/_/g, ' ').toLowerCase()}</span>
                        <span className="ws-item-sub">{e.operatorName || 'operator'} · {ago(e.at)}{e.detail?.reason ? ` · ${e.detail.reason}` : ''}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ws-card-blurb">Nothing yet.</p>
            )}
          </Panel>
          <Panel title="Recent security events">
            {d.securityEvents.length ? (
              <ul className="ws-list">
                {d.securityEvents.map((e, i) => (
                  <li key={i}>
                    <div className="ws-item">
                      <span className="ws-item-text">
                        <span className="ws-item-title">{e.eventType.replace(/_/g, ' ').toLowerCase()}</span>
                        <span className="ws-item-sub">{e.email || ''} · {ago(e.createdAt)}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ws-card-blurb">None recorded.</p>
            )}
          </Panel>
        </aside>
      </div>

      <ActionDrawer action={action} account={a} onClose={() => setAction(null)} onDone={() => { setAction(null); load(); }} />
    </>
  );
}

const TITLES = { suspend: 'Suspend this account', reinstate: 'Reinstate this account', trial: 'Extend the trial', plan: 'Grant a plan' };

function ActionDrawer({ action, account, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [days, setDays] = useState(14);
  const [apps, setApps] = useState(() => new Set(['accounting']));
  const [status, setStatus] = useState('trialing');
  const [trialDays, setTrialDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setReason('');
    setError('');
  }, [action]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (action === 'suspend') await opsSuspend(account.id, reason);
      if (action === 'reinstate') await opsReinstate(account.id, reason);
      if (action === 'trial') await opsExtendTrial(account.id, Number(days), reason);
      if (action === 'plan') {
        await opsGrantPlan(account.id, {
          apps: [...apps].map((appCode) => ({ appCode, priceModel: 'free' })),
          status,
          ...(status === 'trialing' ? { trialDays: Number(trialDays) } : {}),
        });
      }
      notify.success('Done. It is on the record.');
      onDone();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };
  const needsReason = action !== 'plan';
  return (
    <WsDrawer
      open={Boolean(action)}
      onClose={onClose}
      title={TITLES[action] || ''}
      description={`${account.name}. You will be asked for an authenticator code; the change is recorded and shown to the customer.`}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" form="ops-action" className={action === 'suspend' ? 'ws-btn ws-btn--danger' : 'ws-btn ws-btn--primary'} disabled={busy || (needsReason && reason.trim().length < 3) || (action === 'plan' && !apps.size)}>
            {busy ? 'Working…' : TITLES[action]}
          </button>
        </>
      }
    >
      <form id="ops-action" className="grid gap-5" onSubmit={submit}>
        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}
        {action === 'suspend' ? <p className="ws-notice">Every company in this account stops working for everybody until it is reinstated.</p> : null}
        {action === 'trial' ? (
          <label className="grid">
            <span>Extra days</span>
            <input className="ui-input" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
        ) : null}
        {action === 'plan' ? (
          <>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium" style={{ marginBottom: 6 }}>Apps</legend>
              {APPS.map(([k, label]) => (
                <label key={k}>
                  <input type="checkbox" checked={apps.has(k)} onChange={() => setApps((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
                  {label}
                </label>
              ))}
            </fieldset>
            <label className="grid">
              <span>Status</span>
              <select className="ui-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="trialing">Free trial</option>
                <option value="active">Active (free or invoiced offline)</option>
              </select>
            </label>
            {status === 'trialing' ? (
              <label className="grid">
                <span>Trial length, days</span>
                <input className="ui-input" type="number" min={1} max={365} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
              </label>
            ) : null}
            <p className="ws-card-blurb">Replaces the account’s current plan. No payment is taken: Clor has no payment provider yet.</p>
          </>
        ) : null}
        {needsReason ? (
          <label className="grid">
            <span>Why</span>
            <textarea className="ui-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One sentence, for the record" />
          </label>
        ) : null}
      </form>
    </WsDrawer>
  );
}

/* ----------------------------------------------------------------- audit */
function AuditLog() {
  const [page, setPage] = useState(0);
  const [d, setD] = useState(null);
  useEffect(() => {
    opsAudit({ page }).then(setD).catch(() => setD({ events: [], hasMore: false }));
  }, [page]);
  return (
    <>
      <PageHead crumbs={['Operator']} title="Operator log" />
      {!d ? (
        <p className="ws-card-blurb">Loading…</p>
      ) : d.events.length === 0 ? (
        <div className="ws-empty"><p>No operator has acted yet.</p></div>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Everything an operator did, newest first</caption>
            <thead><tr><th>When</th><th>Operator</th><th>Action</th><th>Account</th><th>Detail</th></tr></thead>
            <tbody>
              {d.events.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>{e.operator?.fullName || e.operator?.email || e.operatorUserId}</td>
                  <td>{e.action.replace(/_/g, ' ').toLowerCase()}</td>
                  <td>{e.accountName || '—'}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 420 }}>{e.detail?.reason || (e.detail ? JSON.stringify(e.detail).slice(0, 140) : '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d && (page > 0 || d.hasMore) ? (
        <nav className="flex items-center gap-2" aria-label="Pages">
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Newer</button>
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={!d.hasMore} onClick={() => setPage((p) => p + 1)}>Older</button>
        </nav>
      ) : null}
    </>
  );
}

/* ----------------------------------------------------------------- operators */
function Operators({ me }) {
  const [d, setD] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: '', role: 'SUPPORT' });
  const [error, setError] = useState('');
  const load = useCallback(() => opsOperators().then(setD).catch((e) => setError(String(e?.message || e))), []);
  useEffect(() => {
    load();
  }, [load]);
  const add = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await opsAddOperator(form);
      notify.success(`${form.email} is now an operator.`);
      setAdding(false);
      setForm({ email: '', role: 'SUPPORT' });
      load();
    } catch (err) {
      setError(String(err?.message || err));
    }
  };
  const change = async (userId, body) => {
    try {
      await opsChangeOperator(userId, body);
      load();
    } catch (err) {
      notify.error(String(err?.message || err));
    }
  };
  const rows = d ? [...d.bootstrap.map((b) => ({ ...b, bootstrap: true, active: true })), ...d.operators] : [];
  return (
    <>
      <PageHead
        crumbs={['Operator']}
        title="Operators"
        actions={<button type="button" className="ws-btn ws-btn--primary" onClick={() => setAdding(true)}>Add operator</button>}
      />
      {error && !adding ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}
      {!d ? (
        <p className="ws-card-blurb">Loading…</p>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <thead><tr><th>Name</th><th>Role</th><th>Authenticator</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td><strong style={{ fontWeight: 600 }}>{r.name}</strong><div className="ws-item-sub">{r.email}</div></td>
                  <td>
                    {r.bootstrap || r.userId === me.user.id ? (
                      <>{ROLE[r.role]}{r.bootstrap ? <div className="ws-item-sub">set in server settings</div> : null}</>
                    ) : (
                      <select className="ui-select" style={{ width: 'auto' }} aria-label={`Role of ${r.email}`} value={r.role} onChange={(e) => change(r.userId, { role: e.target.value })}>
                        {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    )}
                  </td>
                  <td>{r.authenticator ? 'Yes' : <span className="ws-pill ws-pill--warn">Not set up</span>}</td>
                  <td>{r.active ? <span className="ws-pill ws-pill--ok">Active</span> : <span className="ws-pill">Off</span>}</td>
                  <td className="num">
                    {!r.bootstrap && r.userId !== me.user.id ? (
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => change(r.userId, { active: !r.active })}>{r.active ? 'Switch off' : 'Switch on'}</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <WsDrawer
        open={adding}
        onClose={() => setAdding(false)}
        title="Add an operator"
        description="An existing Clor login. They must set up an authenticator before the console opens for them."
        actions={
          <>
            <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" form="ops-add" className="ws-btn ws-btn--primary" disabled={!form.email.includes('@')}>Add operator</button>
          </>
        }
      >
        <form id="ops-add" className="grid gap-5" onSubmit={add}>
          {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}
          <label className="grid">
            <span>Email</span>
            <input className="ui-input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </label>
          <label className="grid">
            <span>Role</span>
            <select className="ui-select" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              <option value="SUPPORT">Support — look up accounts, suspend and reinstate</option>
              <option value="BILLING">Billing — plans and trials</option>
              <option value="SUPER_ADMIN">Super admin — everything, and operators</option>
            </select>
          </label>
        </form>
      </WsDrawer>
    </>
  );
}

/* ----------------------------------------------------------------- frame */
/* On ops.clor.in the customer workspace is another host; on /ops (local) it is this one. */
const OPS_HOST = typeof window !== 'undefined' && window.location.hostname.split('.')[0] === 'ops';
const WORKSPACE_URL = OPS_HOST ? 'https://app.clor.in' : '/';

/**
 * An operator without an authenticator sets one up here, rather than being
 * sent to a company's profile page they may not have. Scan, type a code back,
 * keep the recovery codes; then the console opens.
 */
function EnrolAuthenticator({ onDone }) {
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const act = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(String(e?.message || 'Not done.'));
    } finally {
      setBusy(false);
    }
  };
  /* The password first, so a stolen session cannot put someone else's authenticator on the console. */
  const begin = (e) => {
    e.preventDefault();
    act(async () => {
      const r = await opsStartTwoFactor(password);
      setPassword('');
      setSetup(r);
      setQr(await QRCode.toDataURL(r.uri, { margin: 1, width: 192 }));
    });
  };
  const confirm = (e) => {
    e.preventDefault();
    act(async () => {
      const r = await opsEnableTwoFactor(code.trim());
      setCodes(r.recoveryCodes);
      setSetup(null);
    });
  };

  if (codes) {
    return (
      <div className="ops-enrol">
        <p className="ws-card-blurb">Your authenticator is on. These recovery codes each work once if you lose your phone. Keep them somewhere safe; they are not shown again.</p>
        <div className="ops-enrol-codes">
          {codes.map((c) => <span key={c} className="ui-mono">{c}</span>)}
        </div>
        <button type="button" className="ws-btn ws-btn--primary" onClick={onDone}>I have saved them — open the console</button>
      </div>
    );
  }
  return (
    <div className="ops-enrol">
      <p className="ws-card-blurb">Clor operators sign in with a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password). Set one up now; it takes a minute.</p>
      {setup ? (
        <form onSubmit={confirm} className="ops-enrol-scan">
          {qr ? <img src={qr} alt="QR code to scan with your authenticator app" width={192} height={192} /> : null}
          <div className="ops-enrol-steps">
            <p>Scan this with your authenticator app, then type the six-digit code it shows.</p>
            <p className="ws-card-blurb">Can’t scan? Enter this key: <span className="ui-mono" style={{ wordBreak: 'break-all' }}>{setup.secret}</span></p>
            <div className="flex gap-2">
              <input className="ui-input ui-num w-36 text-center tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" aria-label="Code from the app" value={code} onChange={(e) => { setCode(e.target.value); setError(''); }} autoFocus />
              <button type="submit" className="ws-btn ws-btn--primary" disabled={busy || code.trim().length !== 6}>Turn on</button>
            </div>
          </div>
        </form>
      ) : (
        <form onSubmit={begin} className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="text-sm font-medium">Your password</span>
            <input type="password" className="ui-input" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} required />
          </label>
          <button type="submit" className="ws-btn ws-btn--primary" disabled={busy || !password}>
            <KeyRound size={16} aria-hidden="true" /> Set up an authenticator app
          </button>
        </form>
      )}
      {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
    </div>
  );
}

const NAV = [
  ['overview', 'Overview', ICON.home],
  ['accounts', 'Accounts', ICON.companies],
  ['demos', 'Demo requests', ICON.mail],
  ['audit', 'Operator log', ICON.history],
  ['operators', 'Operators', ICON.secure, 'SUPER_ADMIN'],
];

function Console() {
  const { user, signOut } = useSession();
  const [me, setMe] = useState(null);
  const [refused, setRefused] = useState(null);
  const [page, setPage] = useState('overview');
  const [accountId, setAccountId] = useState('');
  const [demoId, setDemoId] = useState('');
  const [accountsStatus, setAccountsStatus] = useState('all');
  const [reload, setReload] = useState(0);

  /* Signing in can leave a company's address behind (/o/CLOR-…); the console has no such pages. */
  useEffect(() => {
    if (/^\/o\//.test(window.location.pathname)) window.history.replaceState({}, '', OPS_HOST ? '/' : '/ops');
  }, []);

  useEffect(() => {
    if (!user) return;
    opsMe()
      .then(setMe)
      .catch((e) => setRefused({ code: e?.code || e?.data?.code, message: String(e?.message || e) }));
  }, [user, reload]);

  if (refused) {
    const needsCode = refused.code === 'TWO_FACTOR_SETUP_REQUIRED';
    return (
      <div className="ops-refused">
        <ClorLogo size={28} />
        <h1 className="ws-title">{needsCode ? 'Set up your authenticator' : 'This page is for Clor staff'}</h1>
        {needsCode ? (
          <EnrolAuthenticator onDone={() => { setRefused(null); setReload((n) => n + 1); }} />
        ) : (
          <p className="ws-card-blurb">{refused.message}</p>
        )}
        <div className="flex gap-2">
          <a className="ws-btn ws-btn--quiet" href={WORKSPACE_URL}>Go to your workspace</a>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }

  if (!me) return <p className="ws-card-blurb" style={{ padding: 24 }}>Loading…</p>;

  const open = (p) => {
    setPage(p);
    setAccountId('');
    setDemoId('');
    window.scrollTo(0, 0);
  };
  return (
    <div className="ops">
      <header className="ops-bar-top">
        <ClorLogo size={22} />
        <span className="ops-badge">Operator</span>
        <nav className="ops-nav" aria-label="Operator console">
          {NAV.filter(([, , , only]) => !only || me.role === only).map(([k, label, Icon]) => (
            <button key={k} type="button" className="ops-nav-item" aria-current={page === k ? 'page' : undefined} onClick={() => open(k)}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </nav>
        <span className="ops-who">{me.user.fullName} · {ROLE[me.role]}</span>
        <button type="button" className="ui-icon-btn" aria-label="Sign out" title="Sign out" onClick={signOut}>
          <LogOut size={16} aria-hidden="true" />
        </button>
      </header>
      <main className="ws">
        <div className="ws-inner">
          {accountId ? (
            <AccountDetail id={accountId} role={me.role} back={() => setAccountId('')} />
          ) : demoId ? (
            <DemoRequestDetail id={demoId} role={me.role} back={() => setDemoId('')} openAccount={(id) => { setDemoId(''); setAccountId(id); }} />
          ) : page === 'overview' ? (
            <Overview openAccounts={(st) => { setAccountsStatus(st); open('accounts'); }} />
          ) : page === 'accounts' ? (
            <Accounts key={accountsStatus} initialStatus={accountsStatus} openAccount={setAccountId} />
          ) : page === 'demos' ? (
            <DemoRequests openRequest={setDemoId} />
          ) : page === 'audit' ? (
            <AuditLog />
          ) : page === 'operators' && me.role === 'SUPER_ADMIN' ? (
            <Operators me={me} />
          ) : null}
        </div>
      </main>
      <Toaster />
    </div>
  );
}

/* The console draws in the icon family of every app but Accounting (owner, 9 Nov 2026): two-tone marks, Fluent line icons. */
export default function OpsConsole() {
  return (
    <IconSetContext.Provider value="duo">
      <LineSetContext.Provider value="fluent">
        <OpsScreens />
      </LineSetContext.Provider>
    </IconSetContext.Provider>
  );
}

function OpsScreens() {
  const { user, restoring } = useSession();
  if (restoring) return null;
  if (!user) {
    return (
      <SignIn
        brand={<OperatorBrand />}
        subtitle="Clor staff sign in here with an authenticator."
        onHome={() => (window.location.href = 'https://clor.in')}
        onForgot={() => (window.location.href = 'https://app.clor.in/forgot-password')}
      />
    );
  }
  return <Console />;
}
