import React, { useEffect, useState } from 'react';

import { notify } from '@ui/components/ui/notify';
import { apiFetch } from '@platform/http';
import { Panel, WsDrawer } from './wsKit';

/**
 * Workspace → Plan → Billing: changing the plan (platform audit, 11 Nov 2026).
 *
 * CLOR staff set prices, so moving to People, adding or removing an app, or
 * changing seats is a request to sales (server: POST /billing/plan-change
 * opens a Plan-or-billing ticket, answered by email with the new price).
 * Stopping is the account owner's own: renewal off, the plan runs to the end
 * of the period already paid, and it can be turned back on until then.
 *
 * Adding users or employees is the customer's own once CLOR switches it on
 * (server: billing/selfServe.ts, GET/POST /billing/seats): they work at once,
 * and a prorated invoice for the rest of the paid period opens to be paid.
 * Unpaid within the days to pay, those seats alone come off.
 */
const APPS = [
  ['accounting', 'Books'],
  ['people', 'People'],
  ['attendance', 'Attendance'],
  ['payroll', 'Payroll'],
];
const KINDS = [
  ['ADD_APP', 'Add an app'],
  ['REMOVE_APP', 'Remove an app'],
  ['SEATS', 'Change the number of users or employees'],
  ['OTHER', 'Something else about the plan'],
];
const inr = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const heads = (unit, n) => `${n} ${unit === 'EMPLOYEE' ? (n === 1 ? 'employee' : 'employees') : n === 1 ? 'user' : 'users'}`;
const isoDay = (s) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null);
const appName = (code) => APPS.find(([k]) => k === code)?.[1] || code;

/**
 * `asButton`: the page's one primary action, "Change plan", opening the same
 * choices in a side panel (Billing & seats, R&D hand-off); without it, a panel.
 */
export default function PlanChange({ asButton = false, onInvoice }) {
  const [state, setState] = useState(null);
  const [seats, setSeats] = useState(null);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState(null);
  const [stopping, setStopping] = useState(false);

  const load = () =>
    apiFetch('/billing/subscription')
      .then((r) => {
        setState(r && Array.isArray(r.ownedApps) ? r : false);
        /* Seats are only for whoever may change the plan; anyone else is never asked. */
        if (r?.mayChangePlan)
          apiFetch('/billing/seats')
            .then((x) => setSeats(x || null))
            .catch(() => setSeats(null));
      })
      .catch(() => setState(false));
  useEffect(() => {
    load();
  }, []);

  if (!state || (!state.mayChangePlan && !state.mayStopPlan)) return null;
  const owned = state.ownedApps || [];
  const sub = state.subscription;
  const attendanceOnly = owned.includes('attendance') && !owned.includes('people');
  const running = sub && ['active', 'trialing', 'past_due'].includes(sub.status);
  const endsOn = day(sub?.status === 'trialing' ? sub?.trialEndsAt : sub?.currentPeriodEnd);

  const resume = async () => {
    try {
      await apiFetch('/billing/resume', { method: 'POST', body: {} });
      notify.success('Renewal is back on.');
      load();
    } catch (e) {
      notify.error(String(e?.message || e));
    }
  };

  const ask = (k) => {
    setMenu(false);
    setAsking(k);
  };
  const stop = () => {
    setMenu(false);
    setStopping(true);
  };
  const keep = async () => {
    setMenu(false);
    await resume();
  };

  const addSeats = () => {
    setMenu(false);
    setAdding(true);
  };
  const openInvoice = (id) => {
    setMenu(false);
    onInvoice?.(id);
  };
  const selfServe = state.mayChangePlan && seats?.open ? seats : null;

  const body = (
    <>
      <p className="ws-card-blurb">Apps on this plan: {owned.length ? owned.map(appName).join(', ') : 'none'}.</p>
      {selfServe?.eligible ? (
        <div className="grid gap-2">
          <p className="ws-card-blurb">This plan is paid for {heads(selfServe.unit, selfServe.quantity)}. Add more and they work at once; the extra for the rest of this period comes as an invoice.</p>
          <div>
            <button type="button" className="ws-btn ws-btn--quiet" onClick={addSeats}>
              Add {selfServe.unit === 'EMPLOYEE' ? 'employees' : 'users'}
            </button>
          </div>
        </div>
      ) : selfServe && ['OPEN', 'OVERDUE', 'STOPPING'].includes(selfServe.code) ? (
        <p className="ws-card-blurb">
          {selfServe.reason}
          {selfServe.invoiceId && onInvoice ? (
            <>
              {' '}
              <button type="button" className="ws-link" onClick={() => openInvoice(selfServe.invoiceId)}>
                Open the invoice
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {state.mayChangePlan && attendanceOnly ? (
        <div className="grid gap-2">
          <p className="ws-card-blurb">People adds hiring, performance, learning, assets, expenses and the rest of HR. Everything in Attendance stays, and Attendance comes off the bill.</p>
          <div>
            <button type="button" className="ws-btn ws-btn--quiet" onClick={() => ask('UPGRADE_PEOPLE')}>
              Move to People
            </button>
          </div>
        </div>
      ) : null}
      {state.mayChangePlan ? (
        <p className="ws-card-blurb">
          <button type="button" className="ws-link" onClick={() => ask('ADD_APP')}>
            Ask for another change
          </button>
          . CLOR sales replies by email with the price; nothing changes until you agree.
        </p>
      ) : null}
      {state.mayStopPlan && running ? (
        sub.cancelAtPeriodEnd ? (
          <p className="ws-card-blurb">
            This plan will not renew{endsOn ? `; it stops on ${endsOn}` : ''}.{' '}
            <button type="button" className="ws-link" onClick={keep}>
              Keep the plan
            </button>
          </p>
        ) : (
          <p className="ws-card-blurb">
            <button type="button" className="ws-link" onClick={stop}>
              Stop renewing
            </button>
          </p>
        )
      ) : null}
    </>
  );

  return (
    <>
      {asButton ? (
        <>
          <button type="button" className="ws-btn ws-btn--primary" onClick={() => setMenu(true)}>
            Change plan
          </button>
          {menu ? (
            <WsDrawer open onClose={() => setMenu(false)} title="Change the plan" description={selfServe ? `Add ${selfServe.unit === 'EMPLOYEE' ? 'employees' : 'users'} yourself here. For anything else, CLOR sales replies by email with the price.` : 'CLOR sales replies by email with the new price. Nothing changes until you agree.'}>
              <div className="grid gap-4">{body}</div>
            </WsDrawer>
          ) : null}
        </>
      ) : (
        <Panel title="Change the plan">{body}</Panel>
      )}
      {adding && selfServe ? (
        <AddSeatsDrawer
          seats={selfServe}
          onClose={() => setAdding(false)}
          onDone={(r) => {
            setAdding(false);
            load();
            if (r?.invoice?.id) onInvoice?.(r.invoice.id);
          }}
        />
      ) : null}
      {asking ? <AskDrawer first={asking} owned={owned} onClose={() => setAsking(null)} /> : null}
      {stopping ? <StopDrawer endsOn={endsOn} trial={sub?.status === 'trialing'} onClose={() => setStopping(false)} onDone={load} /> : null}
    </>
  );
}

function AddSeatsDrawer({ seats, onClose, onDone }) {
  const [count, setCount] = useState('1');
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const n = Number(count);
  const valid = Number.isInteger(n) && n >= 1 && n <= seats.maxPerChange;
  const word = seats.unit === 'EMPLOYEE' ? 'employees' : 'users';

  useEffect(() => {
    /* A count out of range asks nothing; what shows is held to a valid count below. */
    if (!valid) return undefined;
    let live = true;
    const t = setTimeout(() => {
      apiFetch(`/billing/seats/quote?add=${n}`)
        .then((r) => {
          if (!live) return;
          setQuote(r?.quote || null);
          setQuoteError('');
        })
        .catch((e) => {
          if (!live) return;
          setQuote(null);
          setQuoteError(String(e?.message || e));
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [n, valid]);

  const ready = valid && quote && quote.add === n;
  const add = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await apiFetch('/billing/seats', { method: 'POST', body: { add: n, total: quote.total } });
      notify.success(r.invoice ? `${heads(seats.unit, n)} added. Invoice ${r.invoice.number} is open to pay.` : `${heads(seats.unit, n)} added.`);
      onDone(r);
    } catch (err) {
      setError(String(err?.message || err));
      setBusy(false);
    }
  };

  return (
    <WsDrawer
      open
      onClose={onClose}
      title={`Add ${word}`}
      description={`They work as soon as you add them. Pay the invoice within ${seats.payDays} days, or these ${word} come off the plan again.`}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" form="ws-add-seats" className="ws-btn ws-btn--primary" disabled={!ready || busy}>
            {busy ? 'Adding…' : valid ? `Add ${heads(seats.unit, n)}` : `Add ${word}`}
          </button>
        </>
      }
    >
      <form id="ws-add-seats" className="grid gap-5" onSubmit={add}>
        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}
        <label className="grid">
          <span>How many more {word}</span>
          <input
            className="ui-input"
            type="number"
            inputMode="numeric"
            min={1}
            max={seats.maxPerChange}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            aria-describedby="ws-add-seats-hint"
          />
          <span id="ws-add-seats-hint" className="ui-caption">
            {valid ? `${heads(seats.unit, seats.quantity)} now, ${heads(seats.unit, seats.quantity + n)} after.` : `From 1 to ${seats.maxPerChange} at a time. For more, ask CLOR.`}
          </span>
        </label>
        {valid && quoteError ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{quoteError}</p> : null}
        {ready ? (
          <dl className="ws-seat-quote">
            <div>
              <dt>For {isoDay(quote.from)} to {isoDay(quote.to)}</dt>
              <dd className="tabular-nums">{inr(quote.subtotal)}</dd>
            </div>
            {quote.taxTotal ? (
              <div>
                <dt>GST</dt>
                <dd className="tabular-nums">{inr(quote.taxTotal)}</dd>
              </div>
            ) : null}
            <div className="ws-seat-quote-total">
              <dt>To pay by {isoDay(quote.dueOn)}</dt>
              <dd className="tabular-nums">{inr(quote.total)}</dd>
            </div>
            <div>
              <dt>From the next renewal, each {quote.period}</dt>
              <dd className="tabular-nums">{inr(quote.perPeriodMore)} more, before GST</dd>
            </div>
          </dl>
        ) : valid && !quoteError ? (
          <p className="ws-card-blurb">Working out the price…</p>
        ) : null}
      </form>
    </WsDrawer>
  );
}

function AskDrawer({ first, owned, onClose }) {
  const [kind, setKind] = useState(first);
  const [app, setApp] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upgrade = kind === 'UPGRADE_PEOPLE';
  const choices = kind === 'ADD_APP' ? APPS.filter(([k]) => !owned.includes(k)) : kind === 'REMOVE_APP' ? APPS.filter(([k]) => owned.includes(k)) : [];
  const needsApp = kind === 'ADD_APP' || kind === 'REMOVE_APP';
  const valid = !needsApp || choices.some(([k]) => k === app);

  const send = async (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await apiFetch('/billing/plan-change', { method: 'POST', body: { kind, app: needsApp ? app : null, note: note.trim() || null } });
      notify.success(`Sent to CLOR sales as ticket ${r.ticket.code}. They reply by email.`);
      onClose();
    } catch (err) {
      setError(String(err?.message || err));
      setBusy(false);
    }
  };

  return (
    <WsDrawer
      open
      onClose={onClose}
      title={upgrade ? 'Move to People' : 'Change the plan'}
      description="CLOR sales replies by email with the new price. Nothing changes, and nothing is charged, until you agree."
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" form="ws-plan-change" className="ws-btn ws-btn--primary" disabled={!valid || busy}>
            {busy ? 'Sending…' : 'Send to CLOR'}
          </button>
        </>
      }
    >
      <form id="ws-plan-change" className="grid gap-5" onSubmit={send}>
        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}
        {upgrade ? (
          <p className="ws-card-blurb">People includes everything in Attendance: leave, holidays, regularisation, shifts and the employee record. Your data stays as it is.</p>
        ) : (
          <>
            <div className="grid">
              <label htmlFor="ws-plan-kind" className="text-sm">What to change</label>
              <select id="ws-plan-kind" className="ui-select" value={kind} onChange={(e) => { setKind(e.target.value); setApp(''); }}>
                {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            {needsApp ? (
              <div className="grid">
                <label htmlFor="ws-plan-app" className="text-sm">Which app</label>
                <select id="ws-plan-app" className="ui-select" value={app} onChange={(e) => setApp(e.target.value)}>
                  <option value="">Choose…</option>
                  {choices.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {!choices.length ? <span className="ui-caption">{kind === 'ADD_APP' ? 'Every app is already on this plan.' : 'No app to remove.'}</span> : null}
              </div>
            ) : null}
          </>
        )}
        <label className="grid">
          <span>Anything sales should know (optional)</span>
          <textarea className="ui-input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="How many employees, and from when" />
        </label>
      </form>
    </WsDrawer>
  );
}

function StopDrawer({ endsOn, trial, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stop = async () => {
    setBusy(true);
    setError('');
    try {
      await apiFetch('/billing/cancel', { method: 'POST', body: { reason: reason.trim() } });
      notify.success(endsOn ? `Renewal is off. The plan runs until ${endsOn}.` : 'Renewal is off.');
      onDone();
      onClose();
    } catch (err) {
      setError(String(err?.message || err));
      setBusy(false);
    }
  };
  return (
    <WsDrawer
      open
      onClose={onClose}
      title="Stop renewing"
      description={endsOn ? `Everything works until ${endsOn}. After that your data stays here to read and export, and you can start again at any time.` : 'Your data stays here to read and export, and you can start again at any time.'}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Keep the plan</button>
          <button type="button" className="ws-btn ws-btn--danger" disabled={busy} onClick={stop}>
            {busy ? 'Stopping…' : trial ? 'Stop after the trial' : 'Stop renewing'}
          </button>
        </>
      }
    >
      <div className="grid gap-5">
        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}
        <label className="grid">
          <span>Why are you stopping? (optional)</span>
          <textarea className="ui-input" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
        </label>
      </div>
    </WsDrawer>
  );
}
