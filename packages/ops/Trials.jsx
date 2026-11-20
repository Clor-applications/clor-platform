import React, { useCallback, useEffect, useState } from 'react';

import { notify } from '@ui/components/ui/notify';
import { PageHead, Panel, WsDrawer, ago } from '../../apps/admin/src/screens/wsKit';
import { Err, Loading, Pager, errorWords } from './kit';
import { opsAccounts, opsExtendTrial, opsResendSignup, opsSignups } from './api';

/**
 * Trials (roadmap item 7): every account on a free trial, and every trial
 * sign-up from clor.in's pricing page, pending or made.
 *
 * Two things Billing does here:
 *  - Extend trial: more days on an account's trial, with a fresh code
 *    (server: routes/ops.ts).
 *  - Set up paid plan: opens the account's Subscription tab, where New
 *    subscription puts it on a plan at a price and drafts the first invoice.
 *    Nothing is granted from this list: the button used to give the apps
 *    free and call that paid.
 * Support may send a pending link again.
 *
 * The accounts come soonest to end first, a page at a time: that is the order
 * staff work them in. `ending` (a number of days, from Overview's "See all")
 * opens the list narrowed to the trials that end within that many days.
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

export function Trials({ role, openAccount, openSubscription = openAccount, ending = '' }) {
  const [accounts, setAccounts] = useState(null);
  const [signups, setSignups] = useState(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState(null); // { kind: 'extend', account }
  const [page, setPage] = useState(0);
  const [within, setWithin] = useState(() => Number(ending) || 0);
  /* The moment the page opened: the days left are counted from it, not from each render. */
  const [now] = useState(() => Date.now());
  const loadAccounts = useCallback(
    () =>
      opsAccounts({ status: 'trialing', sort: 'trialEnd', page, endingWithin: within || undefined })
        .then((a) => {
          /* The last row of a later page was dealt with: step back rather than show an empty page. */
          if (page > 0 && !a.accounts.length) setPage(page - 1);
          else setAccounts(a);
          setError('');
        })
        .catch((e) => setError(errorWords(e, 'load the trials'))),
    [page, within],
  );
  const loadSignups = useCallback(
    () =>
      opsSignups({})
        .then((r) => (setSignups(r), setError('')))
        .catch((e) => setError(errorWords(e, 'load the sign-ups'))),
    [],
  );
  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);
  useEffect(() => {
    loadSignups();
  }, [loadSignups]);
  const billing = may(role, 'BILLING');
  const support = may(role, 'SUPPORT', 'BILLING');
  const offer = signups?.offer;
  /* Both numbers are the server's, over every trial, not over the page shown. */
  const endingSoon = accounts?.trialsEndingIn7d || 0;
  const pages = accounts ? Math.ceil(accounts.total / (accounts.pageSize || 25)) : 0;
  const meta = !accounts ? null : within ? `${accounts.total} ending in the next ${within} days` : `${accounts.total} on trial${endingSoon ? ` · ${endingSoon} ending within a week` : ''}`;

  return (
    <>
      <PageHead crumbs={['Customers and sales']} title="Trials" counts={meta} />
      <Err onRetry={() => { setError(''); loadAccounts(); loadSignups(); }}>{error}</Err>
      {offer ? (
        <p className="ws-card-blurb">
          A trial from clor.in runs {offer.trialDays} days with {offer.apps.map((a) => a.name).join(', ')}
          {offer.source === 'published' ? ', from the published prices.' : '. No prices are published yet, so this is the default until Pricing publishes a book.'}
        </p>
      ) : null}

      <Panel title="Accounts on trial">
        {within ? (
          <p className="ws-card-blurb">
            Only the trials that end in the next {within} days.{' '}
            <button type="button" className="ops-link" onClick={() => { setPage(0); setWithin(0); }}>Show every trial</button>
          </p>
        ) : null}
        {!accounts ? (
          <Loading />
        ) : accounts.accounts.length === 0 ? (
          <div className="ws-empty"><p>{within ? `No trial ends in the next ${within} days.` : 'Nobody is on a trial right now.'}</p></div>
        ) : (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="sr-only">Accounts on a free trial, soonest to end first</caption>
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
                    <td>{a.lastActiveAt ? ago(a.lastActiveAt) : 'Never'}</td>
                    <td className="num">
                      {billing ? (
                        <span className="inline-flex gap-2">
                          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setAction({ kind: 'extend', account: a })}>Extend trial</button>
                          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => openSubscription(a.id)}>Set up paid plan</button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {accounts ? <Pager page={page} pages={pages} onPage={setPage} /> : null}
      </Panel>

      <Panel title="Sign-ups from clor.in">
        {!signups ? (
          <Loading />
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
                        {support && s.status !== 'CONFIRMED' ? <ResendButton id={s.id} onDone={loadSignups} /> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <TrialDrawer action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); loadAccounts(); }} />
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
      notify.error(errorWords(e, 'send the link'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send link again'}</button>
  );
}

/** Extend: more days on the trial, and why. */
function TrialDrawer({ action, onClose, onDone }) {
  const account = action?.account;
  const [days, setDays] = useState(14);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!action) return;
    setReason('');
    setError('');
    setDays(14);
  }, [action]);
  const n = Number(days);
  const daysOk = Number.isInteger(n) && n >= 1 && n <= 90;
  const dirty = Boolean(reason.trim()) || String(days) !== '14';
  const close = () => { if (!busy) onClose(); };
  const submit = async (e) => {
    e.preventDefault();
    if (busy || !daysOk) return;
    setBusy(true);
    setError('');
    try {
      const r = await opsExtendTrial(account.id, Number(days), reason.trim());
      notify.success(`Trial now ends ${day(r.trialEndsAt)}.`);
      onDone();
    } catch (err) {
      setError(errorWords(err, 'extend the trial'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WsDrawer
      open={Boolean(action)}
      onClose={close}
      dirty={dirty || busy}
      title="Extend the trial"
      description={account ? `${account.name}${account.owner?.email ? `, ${account.owner.email}` : ''}. You will be asked for an authenticator code; the change is recorded and shown to the customer.` : ''}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" disabled={busy} onClick={close}>Cancel</button>
          <button type="submit" form="ops-trial" className="ws-btn ws-btn--primary" disabled={busy || reason.trim().length < 3 || !daysOk}>
            {busy ? 'Working…' : 'Extend trial'}
          </button>
        </>
      }
    >
      <form id="ops-trial" className="grid gap-5" onSubmit={submit}>
        <Err>{error}</Err>
        <div className="grid gap-1">
          <label htmlFor="ops-trial-extra" className="text-sm font-semibold">Extra days</label>
          <input
            id="ops-trial-extra"
            className="ui-input ui-num"
            style={{ maxWidth: 128 }}
            type="text"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 2))}
            aria-invalid={!daysOk || undefined}
            aria-describedby="ops-trial-days"
          />
          <span id="ops-trial-days" className="text-xs" style={{ color: daysOk ? 'rgb(var(--fg-muted))' : 'rgb(var(--ws-danger))' }}>1 to 90 days.</span>
        </div>
        <div className="grid gap-1">
          <label htmlFor="ops-trial-reason" className="text-sm font-semibold">Why</label>
          <textarea id="ops-trial-reason" className="ui-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One sentence, for the record" aria-describedby="ops-trial-why" />
          <span id="ops-trial-why" className="text-xs" style={{ color: 'rgb(var(--fg-muted))' }}>Reason required (3+ characters)</span>
        </div>
        {account?.trialEndsAt ? <p className="ws-card-blurb">Ends {day(account.trialEndsAt)} now; the days are added from today or from then, whichever is later.</p> : null}
      </form>
    </WsDrawer>
  );
}
