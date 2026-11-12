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
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null);
const appName = (code) => APPS.find(([k]) => k === code)?.[1] || code;

export default function PlanChange() {
  const [state, setState] = useState(null);
  const [asking, setAsking] = useState(null);
  const [stopping, setStopping] = useState(false);

  const load = () =>
    apiFetch('/billing/subscription')
      .then((r) => setState(r && Array.isArray(r.ownedApps) ? r : false))
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

  return (
    <>
      <Panel title="Change the plan">
        <p className="ws-card-blurb">Apps on this plan: {owned.length ? owned.map(appName).join(', ') : 'none'}.</p>
        {state.mayChangePlan && attendanceOnly ? (
          <div className="grid gap-2">
            <p className="ws-card-blurb">People adds hiring, performance, learning, assets, expenses and the rest of HR. Everything in Attendance stays, and Attendance comes off the bill.</p>
            <div>
              <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setAsking('UPGRADE_PEOPLE')}>
                Move to People
              </button>
            </div>
          </div>
        ) : null}
        {state.mayChangePlan ? (
          <p className="ws-card-blurb">
            <button type="button" className="ws-link" onClick={() => setAsking('ADD_APP')}>
              Ask for another change
            </button>
            . CLOR sales replies by email with the price; nothing changes until you agree.
          </p>
        ) : null}
        {state.mayStopPlan && running ? (
          sub.cancelAtPeriodEnd ? (
            <p className="ws-card-blurb">
              This plan will not renew{endsOn ? `; it stops on ${endsOn}` : ''}.{' '}
              <button type="button" className="ws-link" onClick={resume}>
                Keep the plan
              </button>
            </p>
          ) : (
            <p className="ws-card-blurb">
              <button type="button" className="ws-link" onClick={() => setStopping(true)}>
                Stop renewing
              </button>
            </p>
          )
        ) : null}
      </Panel>
      {asking ? <AskDrawer first={asking} owned={owned} onClose={() => setAsking(null)} /> : null}
      {stopping ? <StopDrawer endsOn={endsOn} trial={sub?.status === 'trialing'} onClose={() => setStopping(false)} onDone={load} /> : null}
    </>
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
