import React, { useEffect, useState } from 'react';

import { notify } from '@ui/components/ui/notify';
import { apiFetch } from '@platform/http';
import { LoadError, Panel, WsDrawer } from './wsKit';
import { errorWords } from '@ui/utils/errorWords';
import { Button } from '@ui/components/ui/Primitives';

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
 *
 * Adding an app works the same way, under the same switch (server:
 * billing/selfServeApps.ts, GET/POST /billing/apps): the app's own plan from
 * the price list, the number the customer chooses, on at once, an invoice for
 * the rest of the period, and every renewal after carries it.
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
/** "Payroll, People or Attendance". */
const orList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`);

/**
 * `asButton`: the page's one primary action, "Change plan", opening the same
 * choices in a side panel (Billing & seats, R&D hand-off); without it, a panel.
 */
export default function PlanChange({ asButton = false, onInvoice }) {
  const [state, setState] = useState(null);
  const [seats, setSeats] = useState(null);
  const [apps, setApps] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addingApp, setAddingApp] = useState(false);
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState(null);
  const [stopping, setStopping] = useState(false);
  /* The plan could not be read: said in a line with a retry, where the choices would be (it used to vanish). */
  const [failed, setFailed] = useState(false);
  /* "Keep the plan" is out: the link waits, so renewal is not switched on twice. */
  const [resuming, setResuming] = useState(false);

  const load = () =>
    apiFetch('/billing/subscription')
      .then((r) => {
        setFailed(false);
        setState(r && Array.isArray(r.ownedApps) ? r : false);
        /* Seats are only for whoever may change the plan; anyone else is never asked. */
        if (r?.mayChangePlan) {
          apiFetch('/billing/seats')
            .then((x) => setSeats(x || null))
            .catch(() => setSeats(null));
          apiFetch('/billing/apps')
            .then((x) => setApps(x || null))
            .catch(() => setApps(null));
        }
      })
      .catch(() => {
        setState(false);
        setFailed(true);
      });
  useEffect(() => {
    load();
  }, []);

  if (failed) {
    const note = <LoadError onRetry={() => { setFailed(false); load(); }}>The plan choices could not be loaded.</LoadError>;
    return asButton ? note : <Panel title="Change the plan">{note}</Panel>;
  }
  if (!state || (!state.mayChangePlan && !state.mayStopPlan)) return null;
  const owned = state.ownedApps || [];
  const sub = state.subscription;
  const attendanceOnly = owned.includes('attendance') && !owned.includes('people');
  const running = sub && ['active', 'trialing', 'past_due'].includes(sub.status);
  const endsOn = day(sub?.status === 'trialing' ? sub?.trialEndsAt : sub?.currentPeriodEnd);

  const resume = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      await apiFetch('/billing/resume', { method: 'POST', body: {} });
      notify.success('Renewal is back on.');
      load();
    } catch (e) {
      notify.error(errorWords(e, 'switch renewal back on'));
    } finally {
      setResuming(false);
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
  const selfApps = state.mayChangePlan && apps?.open ? apps : null;
  const canAddApp = Boolean(selfApps?.eligible && selfApps.options?.length);
  /* People brings Attendance with it, so both read as added. */
  const added = new Set((selfApps?.addOns || []).flatMap((a) => (a.appCode === 'people' ? ['people', 'attendance'] : [a.appCode])));
  /* Why nothing can be added now (an invoice waiting, one overdue, the plan stopping): said once, from whichever answered. */
  const waiting = [selfServe, selfApps].find((x) => x && ['OPEN', 'OVERDUE', 'STOPPING'].includes(x.code)) || null;
  const addApp = () => {
    setMenu(false);
    setAddingApp(true);
  };

  const body = (
    <>
      <p className="ws-card-blurb">Apps on this plan: {owned.length ? owned.map((a) => (added.has(a) ? `${appName(a)} (added)` : appName(a))).join(', ') : 'none'}.</p>
      {selfServe?.eligible ? (
        <div className="grid gap-2">
          <p className="ws-card-blurb">This plan is paid for {heads(selfServe.unit, selfServe.quantity)}. Add more and they work at once; the extra for the rest of this period comes as an invoice.</p>
          <div>
            <button type="button" className="ws-btn ws-btn--quiet" onClick={addSeats}>
              Add {selfServe.unit === 'EMPLOYEE' ? 'employees' : 'users'}
            </button>
          </div>
        </div>
      ) : null}
      {canAddApp ? (
        <div className="grid gap-2">
          <p className="ws-card-blurb">Add {orList(selfApps.options.map((o) => o.appName))} to this plan. It works at once; the rest of this period comes as an invoice, and each renewal after carries it.</p>
          <div>
            <button type="button" className="ws-btn ws-btn--quiet" onClick={addApp}>
              Add an app
            </button>
          </div>
        </div>
      ) : null}
      {waiting ? (
        <p className="ws-card-blurb">
          {waiting.reason}
          {waiting.invoiceId && onInvoice ? (
            <>
              {' '}
              <button type="button" className="ws-link" onClick={() => openInvoice(waiting.invoiceId)}>
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
            <button type="button" className="ws-link" disabled={resuming} aria-busy={resuming || undefined} onClick={keep}>
              {resuming ? 'Keeping the plan…' : 'Keep the plan'}
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
            <WsDrawer open onClose={() => setMenu(false)} title="Change the plan" description={selfServe?.eligible || canAddApp ? `Add ${[selfServe?.eligible ? (selfServe.unit === 'EMPLOYEE' ? 'employees' : 'users') : null, canAddApp ? 'an app' : null].filter(Boolean).join(' or ') || 'to the plan'} yourself here. For anything else, CLOR sales replies by email with the price.` : 'CLOR sales replies by email with the new price. Nothing changes until you agree.'}>
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
      {addingApp && canAddApp ? (
        <AddAppDrawer
          apps={selfApps}
          onClose={() => setAddingApp(false)}
          onDone={(r) => {
            setAddingApp(false);
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
          setQuoteError(`${errorWords(e, 'work out the price')} Nothing was charged.`);
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
      setError(`${errorWords(err, 'make the change')} Nothing was charged.`);
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
          <Button plain className="ws-btn ws-btn--primary" loading={busy} disabled={!ready} type="submit" form="ws-add-seats">
            {ready ? `Add ${heads(seats.unit, n)} · pay ${inr(quote.total)}` : valid ? `Add ${heads(seats.unit, n)}` : `Add ${word}`}
          </Button>
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

const unitWords = (unit) => (unit === 'EMPLOYEE' ? 'employees' : unit === 'USER' ? 'users' : null);

function AddAppDrawer({ apps, onClose, onDone }) {
  const options = apps.options;
  const [appCode, setAppCode] = useState(options[0].appCode);
  const option = options.find((o) => o.appCode === appCode) || options[0];
  const [planCode, setPlanCode] = useState(option.plans[0].code);
  const plan = option.plans.find((p) => p.code === planCode) || option.plans[0];
  const [count, setCount] = useState(String(plan.startAt));
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const word = unitWords(plan.unit);
  const n = word ? Number(count) : 1;
  const valid = Number.isInteger(n) && n >= 1 && n <= 5000;

  const pickApp = (code) => {
    const o = options.find((x) => x.appCode === code);
    setAppCode(code);
    setPlanCode(o.plans[0].code);
    setCount(String(o.plans[0].startAt));
  };
  const pickPlan = (code) => {
    const p = option.plans.find((x) => x.code === code);
    setPlanCode(code);
    setCount(String(p.startAt));
  };

  useEffect(() => {
    if (!valid) return undefined;
    let live = true;
    const t = setTimeout(() => {
      apiFetch(`/billing/apps/quote?plan=${encodeURIComponent(plan.code)}&quantity=${n}`)
        .then((r) => {
          if (!live) return;
          setQuote(r?.quote || null);
          setQuoteError('');
        })
        .catch((e) => {
          if (!live) return;
          setQuote(null);
          setQuoteError(`${errorWords(e, 'work out the price')} Nothing was charged.`);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [plan.code, n, valid]);

  const ready = valid && quote && quote.planCode === plan.code && quote.quantity === n;
  const add = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await apiFetch('/billing/apps', { method: 'POST', body: { plan: plan.code, quantity: n, total: quote.total } });
      notify.success(r.invoice ? `${option.appName} added. Invoice ${r.invoice.number} is open to pay.` : `${option.appName} added.`);
      onDone(r);
    } catch (err) {
      setError(`${errorWords(err, 'make the change')} Nothing was charged.`);
      setBusy(false);
    }
  };

  return (
    <WsDrawer
      open
      onClose={onClose}
      title="Add an app"
      description={`It works as soon as you add it. Pay the invoice within ${apps.payDays} days, or the app comes off the plan again. Your data in it stays.`}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Cancel</button>
          <Button plain className="ws-btn ws-btn--primary" loading={busy} disabled={!ready} type="submit" form="ws-add-app">
            {ready ? `Add ${option.appName} · pay ${inr(quote.total)}` : `Add ${option.appName}`}
          </Button>
        </>
      }
    >
      <form id="ws-add-app" className="grid gap-5" onSubmit={add}>
        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}
        <fieldset className="grid gap-2">
          <legend>App</legend>
          {options.map((o) => (
            <label key={o.appCode} className="flex items-center gap-2">
              <input type="radio" name="ws-add-app-app" value={o.appCode} checked={o.appCode === appCode} onChange={() => pickApp(o.appCode)} />
              <span>{o.appName}</span>
            </label>
          ))}
        </fieldset>
        {option.plans.length > 1 ? (
          <fieldset className="grid gap-2">
            <legend>Plan</legend>
            {option.plans.map((p) => (
              <label key={p.code} className="flex items-start gap-2">
                <input type="radio" name="ws-add-app-plan" value={p.code} checked={p.code === plan.code} onChange={() => pickPlan(p.code)} />
                <span>
                  {p.name}
                  {p.description ? <span className="ui-caption block">{p.description}</span> : null}
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="ws-card-blurb">
            {plan.name}
            {plan.description ? `: ${plan.description}` : ''}
          </p>
        )}
        {word ? (
          <label className="grid">
            <span>How many {word}</span>
            <input className="ui-input" type="number" inputMode="numeric" min={1} max={5000} value={count} onChange={(e) => setCount(e.target.value)} aria-describedby="ws-add-app-hint" />
            <span id="ws-add-app-hint" className="ui-caption">
              {valid ? `${inr(plan.basePrice)} each ${apps.period} covers ${heads(plan.unit, plan.includedUnits)}; ${inr(plan.extraUnitPrice)} for each one more.` : 'A whole number from 1. For more than 5,000, ask CLOR.'}
            </span>
          </label>
        ) : null}
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
              <dd className="tabular-nums">{inr(quote.perPeriod)}, before GST</dd>
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
      setError(errorWords(err, 'send it to CLOR'));
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
          <Button plain className="ws-btn ws-btn--primary" loading={busy} disabled={!valid} type="submit" form="ws-plan-change">
            Send to CLOR
          </Button>
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
          <span>Anything sales should know <span className="ui-caption">(optional)</span></span>
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
      setError(errorWords(err, 'stop the renewal'));
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
          <Button plain className="ws-btn ws-btn--danger" loading={busy} onClick={stop}>
            {trial ? 'Stop after the trial' : 'Stop renewing'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}
        <label className="grid">
          <span>Why are you stopping? <span className="ui-caption">(optional)</span></span>
          <textarea className="ui-input" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
        </label>
      </div>
    </WsDrawer>
  );
}
