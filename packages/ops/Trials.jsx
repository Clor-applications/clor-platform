import React, { useCallback, useEffect, useState } from 'react';

import { notify } from '@ui/components/ui/notify';
import { PageHead, Panel, WsDrawer, ago } from '../../apps/admin/src/screens/wsKit';
import { opsAccounts, opsExtendTrial, opsGrantPlan, opsResendSignup, opsSignups } from './api';

/**
 * Trials (roadmap item 7): every account on a free trial, and every trial
 * sign-up from clor.in's pricing page, pending or made.
 *
 * Two things the team does here, both for Billing with a fresh code:
 *  - Extend trial: more days on an account's trial (server: routes/ops.ts).
 *  - Convert: set the subscription by hand, active, with the apps chosen
 *    (server: routes/billing.ts, the one place a subscription is set by
 *    hand, which only CLOR may do). No payment is taken: payments come with
 *    roadmap items 8 and 9.
 * Support may send a pending link again.
 */
const APPS = [
  ['accounting', 'Books'],
  ['people', 'People'],
  ['attendance', 'Attendance'],
  ['payroll', 'Payroll'],
];
const appName = (code) => APPS.find(([k]) => k === code)?.[1] || code;
const appsText = (codes = []) => APPS.filter(([k]) => codes.includes(k)).map(([, n]) => n).join(', ') || '—';
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const may = (role, ...roles) => role === 'SUPER_ADMIN' || roles.includes(role);
const Err = ({ children }) => (children ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{children}</p> : null);
const SIGNUP_STATE = { PENDING: ['Link sent', 'ws-pill ws-pill--warn'], CONFIRMED: ['Account made', 'ws-pill ws-pill--ok'], EXPIRED: ['Link ran out', 'ws-pill ws-pill--off'] };
const DAY = 86_400_000;

/** Days left on a trial, as a sentence: "3 days left", "ends today", "ended 2 days ago". */
export const daysLeft = (end, now = Date.now()) => {
  if (!end) return '';
  const d = Math.ceil((new Date(end).getTime() - now) / DAY);
  if (d > 1) return `${d} days left`;
  if (d === 1) return '1 day left';
  if (d === 0) return 'ends today';
  return d === -1 ? 'ended yesterday' : `ended ${-d} days ago`;
};

export function Trials({ role, openAccount }) {
  const [accounts, setAccounts] = useState(null);
  const [signups, setSignups] = useState(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState(null); // { kind: 'extend' | 'convert', account }
  /* The moment the page opened: the days left are counted from it, not from each render. */
  const [now] = useState(() => Date.now());
  const load = useCallback(() => {
    Promise.all([opsAccounts({ status: 'trialing' }), opsSignups({})])
      .then(([a, s]) => {
        setAccounts(a);
        setSignups(s);
        setError('');
      })
      .catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);
  const billing = may(role, 'BILLING');
  const support = may(role, 'SUPPORT', 'BILLING');
  const offer = signups?.offer;
  const endingSoon = (accounts?.accounts || []).filter((a) => a.trialEndsAt && new Date(a.trialEndsAt).getTime() - now < 7 * DAY).length;

  return (
    <>
      <PageHead crumbs={['Operator']} title="Trials" meta={accounts ? `${accounts.total} on trial${endingSoon ? ` · ${endingSoon} ending within a week` : ''}` : null} />
      <Err>{error}</Err>
      {offer ? (
        <p className="ws-card-blurb">
          A trial from clor.in runs {offer.trialDays} days with {offer.apps.map((a) => a.name).join(', ')}
          {offer.source === 'published' ? ', from the published prices.' : '. No prices are published yet, so this is the default until Pricing publishes a book.'}
        </p>
      ) : null}

      <Panel title="Accounts on trial">
        {!accounts ? (
          <p className="ws-card-blurb">Loading…</p>
        ) : accounts.accounts.length === 0 ? (
          <div className="ws-empty"><p>Nobody is on a trial right now.</p></div>
        ) : (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="sr-only">Accounts on a free trial, newest first</caption>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Owner</th>
                  <th>Apps</th>
                  <th>Trial ends</th>
                  <th>Last active</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {accounts.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <button type="button" className="ws-name-link" onClick={() => openAccount(a.id)}>{a.name}</button>
                      <div className="ws-item-sub ui-mono">{a.code || '—'}</div>
                    </td>
                    <td>
                      <div>{a.owner?.name || '—'}</div>
                      <div className="ws-item-sub">{a.owner?.email || ''}</div>
                    </td>
                    <td>{appsText(a.apps)}</td>
                    <td>
                      {day(a.trialEndsAt)}
                      <div className="ws-item-sub">{daysLeft(a.trialEndsAt, now)}</div>
                    </td>
                    <td>{a.lastActiveAt ? ago(a.lastActiveAt) : 'never'}</td>
                    <td className="num">
                      {billing ? (
                        <span className="inline-flex gap-2">
                          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setAction({ kind: 'extend', account: a })}>Extend trial</button>
                          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setAction({ kind: 'convert', account: a })}>Convert</button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Sign-ups from clor.in">
        {!signups ? (
          <p className="ws-card-blurb">Loading…</p>
        ) : signups.signups.length === 0 ? (
          <div className="ws-empty"><p>Nobody has started a trial from clor.in yet. The pricing page’s Start free trial lands here.</p></div>
        ) : (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="sr-only">Trial sign-ups, newest first</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Email</th>
                  <th>Asked for</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {signups.signups.map((s) => {
                  const [label, tone] = SIGNUP_STATE[s.status] || [s.status, 'ws-pill'];
                  return (
                    <tr key={s.id}>
                      <td>
                        {day(s.createdAt)}
                        <div className="ws-item-sub">{ago(s.createdAt)}</div>
                      </td>
                      <td>{s.email}</td>
                      <td>{s.app ? appName(s.app) : '—'}</td>
                      <td>
                        {s.status === 'CONFIRMED' && s.accountId ? (
                          <button type="button" className="ws-name-link" onClick={() => openAccount(s.accountId)}>{s.companyName || 'Open'}</button>
                        ) : (
                          '—'
                        )}
                        {s.status === 'CONFIRMED' ? <div className="ws-item-sub">{appsText(s.apps)}{s.trialDays ? ` · ${s.trialDays} days` : ''}</div> : null}
                      </td>
                      <td>
                        <span className={tone}>{label}</span>
                        {s.status === 'PENDING' ? <div className="ws-item-sub">sent {s.sendCount} time{s.sendCount === 1 ? '' : 's'}</div> : null}
                      </td>
                      <td className="num">
                        {support && s.status !== 'CONFIRMED' ? <ResendButton id={s.id} onDone={load} /> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <TrialDrawer action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); load(); }} />
    </>
  );
}

function ResendButton({ id, onDone }) {
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await opsResendSignup(id);
      notify.success('A new link is on its way. The old one no longer works.');
      onDone();
    } catch (e) {
      notify.error(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send link again'}</button>
  );
}

const TITLES = { extend: 'Extend the trial', convert: 'Convert to a paid plan' };

/** Extend: more days and why. Convert: the subscription set by hand, active, with the apps ticked. */
function TrialDrawer({ action, onClose, onDone }) {
  const account = action?.account;
  const [days, setDays] = useState(14);
  const [reason, setReason] = useState('');
  const [apps, setApps] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!action) return;
    setReason('');
    setError('');
    setDays(14);
    setApps(new Set(account?.apps || []));
  }, [action, account]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (action.kind === 'extend') {
        const r = await opsExtendTrial(account.id, Number(days), reason.trim());
        notify.success(`Trial now ends ${day(r.trialEndsAt)}.`);
      } else {
        const r = await opsGrantPlan(account.id, { apps: [...apps].map((appCode) => ({ appCode, priceModel: 'free' })), status: 'active', reason: reason.trim() });
        /* Free for good is over the limit: it waits for a colleague in Approvals (server: services/ops/grants.ts). */
        if (r?.needsApproval) notify.success(`Sent for approval. ${account.name} stays on the trial until a colleague approves it in Approvals.`);
        else notify.success(`${account.name} is on a paid plan now. It is on the record.`);
      }
      onDone();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };
  const extend = action?.kind === 'extend';
  return (
    <WsDrawer
      open={Boolean(action)}
      onClose={onClose}
      title={action ? TITLES[action.kind] : ''}
      description={account ? `${account.name}${account.owner?.email ? `, ${account.owner.email}` : ''}. You will be asked for an authenticator code; the change is recorded and shown to the customer.` : ''}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" form="ops-trial" className="ws-btn ws-btn--primary" disabled={busy || reason.trim().length < 3 || (!extend && !apps.size)}>
            {busy ? 'Working…' : extend ? 'Extend trial' : 'Convert'}
          </button>
        </>
      }
    >
      <form id="ops-trial" className="grid gap-5" onSubmit={submit}>
        <Err>{error}</Err>
        {extend ? (
          <>
            <label className="grid gap-1">
              <span className="text-sm font-medium">Extra days</span>
              <input className="ui-input ui-num" style={{ maxWidth: 128 }} type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-medium">Why</span>
              <textarea className="ui-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One sentence, for the record" />
            </label>
            {account?.trialEndsAt ? <p className="ws-card-blurb">Ends {day(account.trialEndsAt)} now; the days are added from today or from then, whichever is later.</p> : null}
          </>
        ) : (
          <>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium" style={{ marginBottom: 6 }}>Apps on the plan</legend>
              {APPS.map(([k, label]) => (
                <label key={k}>
                  <input type="checkbox" checked={apps.has(k)} onChange={() => setApps((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} /> {label}
                  {account?.apps?.includes(k) ? <span className="ws-item-sub"> · on the trial</span> : null}
                </label>
              ))}
            </fieldset>
            <label className="grid gap-1">
              <span className="text-sm font-medium">Why</span>
              <textarea className="ui-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One sentence, for the colleague who approves it" />
            </label>
            <p className="ws-card-blurb">The trial ends and the plan is active from when it is set, by hand: no payment is taken and nothing is invoiced from here. The apps are free from then on, so a colleague approves it in Approvals first; until then {account?.name || 'the customer'} stays on the trial.</p>
          </>
        )}
      </form>
    </WsDrawer>
  );
}
