import React, { useCallback, useEffect, useRef, useState } from 'react';

import { notify } from '@ui/components/ui/notify';
import { PageHead, WsDrawer } from '../../apps/admin/src/screens/wsKit';
import { opsActivateProvider, opsPaymentAccounts, opsPaymentEvents, opsPayments, opsProviderMode, opsRecordPayment, opsRetryPaymentEvent, opsSaveProvider, opsTestProvider } from './api';
import { inr, toPaise } from './money';

/**
 * Payments (server: routes/opsPayments.ts, billing/providers.ts). How
 * customers pay CLOR, set up here and nowhere else: Cashfree, Razorpay, or
 * manual UPI and bank transfer; Test or Live; which one is active. Keys are
 * typed here once and never shown again, only their last four characters.
 * The Payments log lists every payment event with what became of it, and
 * Record a payment marks a UPI or bank transfer as paid.
 */
const may = (role, ...roles) => role === 'SUPER_ADMIN' || roles.includes(role);
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const Err = ({ children }) =>
  children ? (
    <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>
      {children}
    </p>
  ) : null;
const Problems = ({ list }) =>
  list?.length ? (
    <ul role="alert" className="text-sm grid gap-1" style={{ color: 'rgb(var(--ws-danger))' }}>
      {list.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  ) : null;
function Field({ id, label, hint, children }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <span className="ws-card-blurb">{hint}</span> : null}
    </div>
  );
}
const errorOf = (e) => ({ message: String(e?.message || e), problems: e?.data?.problems || [] });

/* Where each key is found in the provider's own dashboard. */
const HELP = {
  cashfree: {
    lines: 'Cashfree checkout, UPI, cards and netbanking.',
    idLabel: 'App ID',
    secrets: { secretKey: 'Secret key' },
    id: 'In the Cashfree dashboard: Payment Gateway, Developers, API Keys. Switch the dashboard to Test for test keys, or to Live for live keys.',
    secretKey: 'On the same page as the App ID. Cashfree shows it once; if it is lost, generate a new pair there.',
    webhook:
      'In the Cashfree dashboard: Payment Gateway, Developers, Webhooks, Add webhook endpoint. Paste this address. Cashfree signs its events with the secret key above, so there is no separate webhook secret.',
  },
  razorpay: {
    lines: 'Razorpay checkout, UPI, cards and netbanking.',
    idLabel: 'Key ID',
    secrets: { keySecret: 'Key secret', webhookSecret: 'Webhook secret' },
    id: 'In the Razorpay dashboard: Account & Settings, API keys. Test keys start rzp_test_, live keys start rzp_live_.',
    keySecret: 'Shown once, when the key is generated. If it is lost, regenerate the key there and enter both again.',
    webhookSecret: 'A secret you choose when you add the webhook in Razorpay (Account & Settings, Webhooks). Type the same secret here.',
    webhook:
      'In the Razorpay dashboard: Account & Settings, Webhooks, Add new webhook. Paste this address, type a secret of your own and enter the same secret above. Tick payment.captured, payment.failed and the subscription events.',
  },
  manual: { lines: 'Customers pay by UPI or bank transfer; you mark each payment as paid.' },
};

function StatusPill({ p }) {
  if (p.active) return <span className="ws-pill ws-pill--ok">Active</span>;
  if (p.enabled) return <span className="ws-pill">On</span>;
  return <span className="ws-pill ws-pill--off">Off</span>;
}
const ModePill = ({ mode }) => (mode === 'LIVE' ? <span className="ws-pill ws-pill--warn">Live</span> : <span className="ws-pill">Test</span>);
function LastTest({ t }) {
  if (!t) return <span className="ws-item-sub">Not tested yet</span>;
  return (
    <span className="text-sm" style={{ color: t.ok ? 'rgb(var(--ws-ok))' : 'rgb(var(--ws-danger))' }}>
      {t.message}
    </span>
  );
}

/* --------------------------------------------------------------- the page */
export function Payments({ role }) {
  const [tab, setTab] = useState('providers');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [recording, setRecording] = useState(false);
  const [logKey, setLogKey] = useState(0);
  const load = useCallback(() => {
    opsPayments()
      .then((r) => (setData(r), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);
  const mayChange = may(role, 'BILLING');
  if (!data) return error ? <Err>{error}</Err> : <p className="ws-card-blurb">Loading…</p>;
  const active = data.providers.find((p) => p.active);
  const open = data.providers.find((p) => p.code === editing);

  return (
    <>
      <PageHead
        crumbs={['Operator']}
        title="Payments"
        meta={active ? `Customers pay through ${active.name}${active.mode === 'LIVE' ? ', live' : active.code === 'manual' ? '' : ', in test mode'}` : 'No provider is active: subscriptions are set by hand'}
        actions={
          mayChange ? (
            <button type="button" className="ws-btn ws-btn--primary" onClick={() => setRecording(true)}>
              Record a payment
            </button>
          ) : null
        }
      />
      <div className="ws-tabs" role="tablist" aria-label="Payments">
        {[
          ['providers', 'Providers'],
          ['log', 'Payments log'],
        ].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className="ws-tab" onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'providers' ? (
        <>
          <p className="ws-notice">When Cashfree or Razorpay is the active provider, customers can pay each invoice online on its page (card, UPI or netbanking), and its webhook marks the invoice paid. Nothing is charged on its own: there is no saved card and no automatic charge.</p>
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="sr-only">Payment providers</caption>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Mode</th>
                  <th>Last test</th>
                  <th>
                    <span className="sr-only">Set up</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.providers.map((p) => (
                  <tr key={p.code}>
                    <td style={{ whiteSpace: 'normal' }}>
                      <button type="button" className="ws-name-link" onClick={() => setEditing(p.code)}>
                        {p.name}
                      </button>
                      <div className="ws-item-sub">{HELP[p.code].lines}</div>
                    </td>
                    <td>
                      <StatusPill p={p} />
                    </td>
                    <td>{p.code === 'manual' ? <span className="ws-item-sub">—</span> : <ModePill mode={p.mode} />}</td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 360 }}>
                      <LastTest t={p.lastTest} />
                    </td>
                    <td>
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setEditing(p.code)}>
                        {mayChange ? 'Set up' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <PaymentsLog key={logKey} mayChange={mayChange} />
      )}
      {open ? <ProviderDrawer key={open.code} p={open} mayChange={mayChange} onClose={() => setEditing(null)} onChanged={(r) => (r?.providers ? setData((d) => ({ ...d, providers: r.providers })) : load())} /> : null}
      {recording ? (
        <RecordPayment
          onClose={() => setRecording(false)}
          onDone={() => {
            setRecording(false);
            setTab('log');
            setLogKey((k) => k + 1);
          }}
        />
      ) : null}
    </>
  );
}

/* ----------------------------------------------------- one provider's setup */
function SecretField({ id, label, hint, saved, value, onChange, disabled }) {
  const [replacing, setReplacing] = useState(!saved);
  return (
    <Field id={id} label={label} hint={hint}>
      {replacing ? (
        <input id={id} className="ui-input" type="password" autoComplete="off" spellCheck={false} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder={saved ? `Saved, ends in ${saved}` : ''} />
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm">
            Saved, ends in <span className="ui-mono">{saved}</span>
          </span>
          {disabled ? null : (
            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setReplacing(true)}>
              Replace
            </button>
          )}
        </div>
      )}
    </Field>
  );
}

function CopyField({ id, label, value, hint }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      notify.success('Webhook address copied.');
    } catch {
      notify.error('Could not copy. Select the address and copy it instead.');
    }
  };
  return (
    <Field id={id} label={label} hint={hint}>
      <div className="flex gap-2">
        <input id={id} className="ui-input" readOnly value={value} onFocus={(e) => e.target.select()} />
        <button type="button" className="ws-btn ws-btn--quiet" onClick={copy}>
          Copy
        </button>
      </div>
    </Field>
  );
}

const idField = (code) => (code === 'cashfree' ? 'appId' : 'keyId');
const emptyKeys = (p, m) => ({ id: p[m]?.[idField(p.code)] || '', secrets: {} });

function ProviderDrawer({ p, mayChange, onClose, onChanged }) {
  const keyed = p.code !== 'manual';
  const [enabled, setEnabled] = useState(p.enabled);
  const [keys, setKeys] = useState(() => (keyed ? { test: emptyKeys(p, 'test'), live: emptyKeys(p, 'live') } : null));
  const [manual, setManual] = useState(() => (keyed ? null : { upiId: p.manual?.upiId || '', payeeName: p.manual?.payeeName || '', qrImage: p.manual?.qrImage || '', instructions: p.manual?.instructions || '', bank: { accountName: '', accountNumber: '', ifsc: '', bankName: '', branch: '', ...(p.manual?.bank || {}) } }));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [live, setLive] = useState(false);
  const fileRef = useRef(null);
  const h = HELP[p.code];

  const touch = (fn) => (...a) => (setDirty(true), fn(...a));
  const setKey = (m, field, isSecret) =>
    touch((v) => setKeys((k) => ({ ...k, [m]: isSecret ? { ...k[m], secrets: { ...k[m].secrets, [field]: v } } : { ...k[m], id: v } })));
  const setM = (field) => touch((e) => setManual((x) => ({ ...x, [field]: e.target.value })));
  const setB = (field) => touch((e) => setManual((x) => ({ ...x, bank: { ...x.bank, [field]: e.target.value } })));

  const run = async (what, fn, ok) => {
    setBusy(what);
    setError(null);
    try {
      const r = await fn();
      if (ok) notify.success(typeof ok === 'function' ? ok(r) : ok);
      onChanged(r);
      return r;
    } catch (e) {
      setError(errorOf(e));
      return null;
    } finally {
      setBusy('');
    }
  };
  const save = () =>
    run('save', () => opsSaveProvider(p.code, keyed ? { enabled, test: keys.test, live: keys.live } : { enabled, manual }), `${p.name} saved.`).then((r) => {
      if (r) {
        setDirty(false);
        if (keyed) setKeys((k) => ({ test: { ...k.test, secrets: {} }, live: { ...k.live, secrets: {} } }));
      }
    });
  const test = () => run('test', () => opsTestProvider(p.code));
  const activate = () => run('activate', () => opsActivateProvider(p.code), `Customers now pay through ${p.name}.`);
  const toTest = () => run('mode', () => opsProviderMode(p.code, 'TEST'), `${p.name} is in Test mode.`);

  const onQr = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > 300_000) {
      setError({ message: 'The QR image must be a PNG or JPEG under 300 KB.', problems: [] });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => touch(() => setManual((x) => ({ ...x, qrImage: String(reader.result) })))();
    reader.readAsDataURL(file);
  };

  const modeKeys = (m) => (
    <fieldset className="grid gap-4" key={m}>
      <legend className="text-sm font-medium" style={{ marginBottom: 8 }}>
        {m === 'test' ? 'Test keys' : 'Live keys'}
        {p.mode === m.toUpperCase() ? <span className="ws-item-sub"> · in use now</span> : null}
      </legend>
      <Field id={`pay-${p.code}-${m}-id`} label={h.idLabel} hint={h.id}>
        <input id={`pay-${p.code}-${m}-id`} className="ui-input" autoComplete="off" spellCheck={false} value={keys[m].id} disabled={!mayChange} onChange={(e) => setKey(m, 'id')(e.target.value.trim())} />
      </Field>
      {Object.entries(h.secrets).map(([field, label]) => (
        <SecretField key={`${field}-${p[m]?.saved?.[field] || ""}`} id={`pay-${p.code}-${m}-${field}`} label={label} hint={h[field]} saved={p[m]?.saved?.[field]} value={keys[m].secrets[field] || ''} disabled={!mayChange} onChange={setKey(m, field, true)} />
      ))}
    </fieldset>
  );

  return (
    <>
      <WsDrawer
        open
        onClose={onClose}
        title={p.name}
        description={keyed ? 'Keys are saved encrypted. After saving, only their last four characters are shown.' : 'What customers paying by hand are shown. You record each payment when it reaches CLOR’s account.'}
        actions={
          <>
            <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>
              Close
            </button>
            {mayChange ? (
              <>
                <button type="button" className="ws-btn ws-btn--quiet" disabled={Boolean(busy) || dirty} title={dirty ? 'Save first' : undefined} onClick={test}>
                  {busy === 'test' ? 'Testing…' : keyed ? 'Test connection' : 'Check details'}
                </button>
                <button type="button" className="ws-btn ws-btn--primary" disabled={Boolean(busy) || !dirty} onClick={save}>
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : null}
          </>
        }
      >
        <div className="grid gap-6">
          <section className="grid gap-2" aria-label="Status">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill p={p} />
              {keyed ? <ModePill mode={p.mode} /> : null}
            </div>
            <LastTest t={p.lastTest} />
            {dirty ? <span className="ws-item-sub">Save before testing: the test uses the saved keys.</span> : null}
          </section>

          <label className="flex gap-2 items-start">
            <input type="checkbox" checked={enabled} disabled={!mayChange} onChange={touch((e) => setEnabled(e.target.checked))} />
            <span>
              {p.name} is on
              <span className="ws-card-blurb" style={{ display: 'block' }}>
                {keyed ? 'Off: its webhooks are refused and it cannot be the active provider.' : 'Off: it cannot be the active provider, and customers are not shown these details.'}
              </span>
            </span>
          </label>

          {keyed ? (
            <>
              <section className="grid gap-2" aria-label="Mode">
                <span className="text-sm font-medium">Mode</span>
                <p className="ws-card-blurb">
                  {p.mode === 'LIVE' ? 'Live: the live keys are in use. Real money moves once checkout is built.' : 'Test: the test keys are in use, against the provider’s sandbox. No real money moves.'}
                </p>
                {mayChange && p.active ? (
                  <p className="ws-card-blurb">
                    Customers pay through {p.name} now, so its mode cannot change. Make another provider active, or turn {p.name} off, then switch it.
                  </p>
                ) : mayChange ? (
                  <div>
                    {p.mode === 'LIVE' ? (
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={Boolean(busy)} onClick={toTest}>
                        Go back to Test mode
                      </button>
                    ) : (
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={Boolean(busy)} onClick={() => setLive(true)}>
                        Switch to Live mode…
                      </button>
                    )}
                  </div>
                ) : null}
              </section>
              {modeKeys('test')}
              {modeKeys('live')}
              <CopyField id={`pay-${p.code}-hook`} label="Webhook address" value={p.webhookUrl} hint={h.webhook} />
            </>
          ) : (
            <>
              <Field id="pay-manual-upi" label="UPI ID" hint="CLOR’s UPI ID, like clor@okaxis. In your bank’s or UPI app’s profile. A QR to scan is made from it.">
                <input id="pay-manual-upi" className="ui-input" autoComplete="off" spellCheck={false} value={manual.upiId} disabled={!mayChange} onChange={setM('upiId')} />
              </Field>
              <Field id="pay-manual-payee" label="Name shown when paying" hint="The name customers see in their UPI app.">
                <input id="pay-manual-payee" className="ui-input" value={manual.payeeName} disabled={!mayChange} onChange={setM('payeeName')} />
              </Field>
              <div className="grid gap-2">
                <span className="text-sm font-medium">Your own QR image (optional)</span>
                <span className="ws-card-blurb">The QR your bank gave you, as a PNG or JPEG under 300 KB. Without one, CLOR draws a QR from the UPI ID.</span>
                <div className="flex flex-wrap items-center gap-3">
                  {manual.qrImage ? <img src={manual.qrImage} alt="CLOR’s payment QR" width={96} height={96} style={{ borderRadius: 8, border: '1px solid rgb(var(--ws-line))' }} /> : null}
                  {mayChange ? (
                    <>
                      <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={onQr} aria-label="QR image" />
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => fileRef.current?.click()}>
                        {manual.qrImage ? 'Replace QR' : 'Upload QR'}
                      </button>
                      {manual.qrImage ? (
                        <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={touch(() => setManual((x) => ({ ...x, qrImage: '' })))}>
                          Remove
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
              <fieldset className="grid gap-4">
                <legend className="text-sm font-medium" style={{ marginBottom: 8 }}>
                  Bank account for transfers
                </legend>
                <Field id="pay-bank-name" label="Name on the account" hint="Exactly as the bank has it, so NEFT and IMPS transfers go through.">
                  <input id="pay-bank-name" className="ui-input" value={manual.bank.accountName || ''} disabled={!mayChange} onChange={setB('accountName')} />
                </Field>
                <Field id="pay-bank-number" label="Account number" hint="On a cheque leaf or the bank’s app.">
                  <input id="pay-bank-number" className="ui-input tabular-nums" inputMode="numeric" value={manual.bank.accountNumber || ''} disabled={!mayChange} onChange={setB('accountNumber')} />
                </Field>
                <Field id="pay-bank-ifsc" label="IFSC code" hint="11 characters, printed on a cheque leaf, like HDFC0001234.">
                  <input id="pay-bank-ifsc" className="ui-input" value={manual.bank.ifsc || ''} disabled={!mayChange} onChange={setB('ifsc')} />
                </Field>
                <Field id="pay-bank-bank" label="Bank">
                  <input id="pay-bank-bank" className="ui-input" value={manual.bank.bankName || ''} disabled={!mayChange} onChange={setB('bankName')} />
                </Field>
                <Field id="pay-bank-branch" label="Branch">
                  <input id="pay-bank-branch" className="ui-input" value={manual.bank.branch || ''} disabled={!mayChange} onChange={setB('branch')} />
                </Field>
              </fieldset>
              <Field id="pay-manual-notes" label="Note for customers (optional)" hint="Shown with the payment details, for example: put your client ID in the payment note.">
                <textarea id="pay-manual-notes" className="ui-input" rows={2} value={manual.instructions} disabled={!mayChange} onChange={setM('instructions')} />
              </Field>
            </>
          )}

          <section className="grid gap-2" aria-label="Active provider">
            <span className="text-sm font-medium">Customers pay through</span>
            {p.active ? (
              <p className="ws-card-blurb">{p.name}. It is the active provider.</p>
            ) : (
              <>
                <p className="ws-card-blurb">Only one provider is active at a time. Making {p.name} active stops the one before it.</p>
                {p.missing?.length ? <Problems list={p.missing} /> : null}
                {mayChange ? (
                  <div>
                    <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={Boolean(busy) || dirty || Boolean(p.missing?.length)} onClick={activate}>
                      {busy === 'activate' ? 'Making it active…' : `Make ${p.name} the active provider`}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
          {mayChange ? <p className="ws-card-blurb">Saving, switching mode and making a provider active ask for a code from your authenticator app, and go on the operator log.</p> : null}
          {error ? (
            <>
              <Err>{error.message}</Err>
              <Problems list={error.problems} />
            </>
          ) : null}
        </div>
      </WsDrawer>
      {live ? <LiveConfirm p={p} onClose={() => setLive(false)} onDone={(r) => (setLive(false), onChanged(r))} /> : null}
    </>
  );
}

/** The second confirmation for Live: the word typed out. */
function LiveConfirm({ p, onClose, onDone }) {
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await opsProviderMode(p.code, 'LIVE', word.trim().toUpperCase());
      notify.success(`${p.name} is in Live mode.`);
      onDone(r);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WsDrawer
      open
      onClose={onClose}
      title={`Switch ${p.name} to Live mode?`}
      description="Live keys are real. Once checkout is built, customers’ money goes through them into CLOR’s account. Test the live keys after switching."
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ws-btn ws-btn--primary" disabled={busy || word.trim().toUpperCase() !== 'LIVE'} onClick={go}>
            {busy ? 'Switching…' : 'Switch to Live'}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field id="pay-live-word" label="Type LIVE to confirm">
          <input id="pay-live-word" className="ui-input" autoComplete="off" value={word} onChange={(e) => setWord(e.target.value)} />
        </Field>
        <p className="ws-card-blurb">You will be asked for a code from your authenticator app. It goes on the operator log.</p>
        <Err>{error}</Err>
      </div>
    </WsDrawer>
  );
}

/* --------------------------------------------------------- Payments log */
const EVENT_STATUS = {
  APPLIED: ['Applied', 'ws-pill ws-pill--ok'],
  RECORDED: ['Recorded', 'ws-pill'],
  FAILED: ['Failed', 'ws-pill ws-pill--danger'],
  REJECTED: ['Refused', 'ws-pill ws-pill--warn'],
};
const GATEWAY = { cashfree: 'Cashfree', razorpay: 'Razorpay', manual: 'By hand' };

function PaymentsLog({ mayChange }) {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const fetchPage = useCallback((before) => opsPaymentEvents({ status, before }), [status]);
  useEffect(() => {
    let live = true;
    fetchPage()
      .then((r) => live && (setRows(r.events), setNext(r.next), setError('')))
      .catch((e) => live && setError(String(e?.message || e)));
    return () => {
      live = false;
    };
  }, [fetchPage]);
  const more = () => fetchPage(next).then((r) => (setRows((x) => [...x, ...r.events]), setNext(r.next)));
  const retry = async (ev) => {
    setBusy(ev.id);
    try {
      const r = await opsRetryPaymentEvent(ev.id);
      if (r.status === 'APPLIED') notify.success('Applied.');
      else notify.error(r.detail || 'Still not applied.');
      setRows((x) => x.map((e) => (e.id === ev.id ? { ...e, status: r.status, detail: r.detail, canRetry: r.status !== 'APPLIED' } : e)));
    } catch (e) {
      notify.error(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field id="pay-log-status" label="Show">
          <select id="pay-log-status" className="ui-input" value={status} onChange={(e) => (setRows(null), setStatus(e.target.value))}>
            <option value="">Everything</option>
            <option value="APPLIED">Applied</option>
            <option value="RECORDED">Recorded, nothing changed</option>
            <option value="FAILED">Failed</option>
            <option value="REJECTED">Refused</option>
          </select>
        </Field>
      </div>
      <Err>{error}</Err>
      {!rows ? (
        <p className="ws-card-blurb">Loading…</p>
      ) : !rows.length ? (
        <div className="ws-empty">
          <p>No payment events{status ? ' of this kind' : ''} yet. Provider webhooks and payments recorded by hand show here.</p>
        </div>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Payment events, newest first</caption>
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th className="hidden sm:table-cell">Account</th>
                <th className="num hidden sm:table-cell">Amount</th>
                <th className="hidden sm:table-cell">Status</th>
                <th>
                  <span className="sr-only">Retry</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="tabular-nums">
                    {when(e.at)}
                    <div className="ws-item-sub">{GATEWAY[e.gateway] || e.gateway}</div>
                  </td>
                  <td style={{ whiteSpace: 'normal', minWidth: 220 }}>
                    {e.what}
                    {e.reference ? <div className="ws-item-sub ui-mono">{e.reference}</div> : null}
                    {e.detail ? <div className="ws-item-sub">{e.detail}</div> : null}
                    {/* On a phone the three columns after this one fold in here. */}
                    <div className="sm:hidden flex flex-wrap items-center gap-2" style={{ marginTop: 6 }}>
                      <span className={EVENT_STATUS[e.status]?.[1] || 'ws-pill'}>{EVENT_STATUS[e.status]?.[0] || e.status}</span>
                      {e.amount != null ? <span className="tabular-nums">{inr(e.amount)}</span> : null}
                      {e.accountName ? <span className="ws-item-sub">{e.accountName}</span> : null}
                    </div>
                  </td>
                  <td className="hidden sm:table-cell" style={{ whiteSpace: 'normal' }}>
                    {e.accountName || (e.accountId ? <span className="ui-mono">{e.accountId}</span> : '—')}
                  </td>
                  <td className="num hidden sm:table-cell">{e.amount != null ? inr(e.amount) : '—'}</td>
                  <td className="hidden sm:table-cell">
                    <span className={EVENT_STATUS[e.status]?.[1] || 'ws-pill'}>{EVENT_STATUS[e.status]?.[0] || e.status}</span>
                  </td>
                  <td>
                    {mayChange && e.canRetry ? (
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={busy === e.id} onClick={() => retry(e)}>
                        {busy === e.id ? 'Retrying…' : 'Retry'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next ? (
        <div>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={more}>
            Show older
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------- Record a payment (Mark paid) */
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

function RecordPayment({ onClose, onDone }) {
  const [search, setSearch] = useState('');
  const [found, setFound] = useState([]);
  const [account, setAccount] = useState(null);
  const [f, setF] = useState({ amount: '', reference: '', paidOn: today(), months: '1', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (account) return undefined;
    let live = true;
    const t = setTimeout(() => {
      opsPaymentAccounts(search.trim())
        .then((r) => live && setFound(r.accounts))
        .catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [search, account]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const amount = toPaise(f.amount);
  const save = async () => {
    setError('');
    if (!account) return setError('Choose the customer account.');
    if (!amount || amount <= 0) return setError('Enter the amount received, in rupees.');
    setBusy(true);
    try {
      const r = await opsRecordPayment({ accountId: account.id, amount, reference: f.reference.trim(), paidOn: f.paidOn, months: Number(f.months), note: f.note.trim() || null });
      notify.success(r.paidUntil ? `Recorded. ${account.name} is paid until ${day(r.paidUntil)}.` : 'Recorded.');
      onDone();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WsDrawer
      open
      onClose={onClose}
      title="Record a payment"
      description="A UPI or bank transfer that reached CLOR’s account. The account’s subscription becomes active for the months it pays for."
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ws-btn ws-btn--primary" disabled={busy} onClick={save}>
            {busy ? 'Recording…' : 'Record payment'}
          </button>
        </>
      }
    >
      <div className="grid gap-5">
        {account ? (
          <div className="grid gap-1">
            <span className="text-sm font-medium">Customer account</span>
            <div className="flex items-center gap-3">
              <span>
                {account.name}
                <span className="ws-item-sub" style={{ display: 'block' }}>
                  {account.subscription ? `Subscription ${account.subscription.status}${account.subscription.currentPeriodEnd ? `, paid until ${day(account.subscription.currentPeriodEnd)}` : ''}` : 'No subscription yet: the payment is recorded only.'}
                </span>
              </span>
              <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setAccount(null)}>
                Change
              </button>
            </div>
          </div>
        ) : (
          <Field id="pay-rec-search" label="Customer account" hint="Type the account’s name or client ID.">
            <input id="pay-rec-search" className="ui-input" autoComplete="off" value={search} onChange={(e) => setSearch(e.target.value)} />
            {found.length ? (
              <ul className="grid gap-1" aria-label="Matching accounts">
                {found.map((a) => (
                  <li key={a.id}>
                    <button type="button" className="ws-name-link" onClick={() => setAccount(a)}>
                      {a.name}
                    </button>
                    {a.code ? <span className="ws-item-sub ui-mono"> {a.code}</span> : null}
                  </li>
                ))}
              </ul>
            ) : search.trim() ? (
              <span className="ws-item-sub">No account matches.</span>
            ) : null}
          </Field>
        )}
        <Field id="pay-rec-amount" label="Amount received, ₹" hint={amount ? inr(amount) : 'As it shows on the bank statement.'}>
          <input id="pay-rec-amount" className="ui-input ui-num" inputMode="decimal" value={f.amount} onChange={set('amount')} />
        </Field>
        <Field id="pay-rec-ref" label="UTR or bank reference" hint="The 12-digit UTR from the UPI app or the bank statement. The same reference cannot be recorded twice.">
          <input id="pay-rec-ref" className="ui-input" autoComplete="off" spellCheck={false} value={f.reference} onChange={set('reference')} />
        </Field>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
          <Field id="pay-rec-date" label="Money arrived on">
            <input id="pay-rec-date" className="ui-input" type="date" max={today()} value={f.paidOn} onChange={set('paidOn')} />
          </Field>
          <Field id="pay-rec-months" label="It pays for">
            <select id="pay-rec-months" className="ui-input" value={f.months} onChange={set('months')}>
              {[1, 3, 6, 12].map((m) => (
                <option key={m} value={m}>
                  {m === 1 ? '1 month' : `${m} months`}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id="pay-rec-note" label="Note (optional)">
          <input id="pay-rec-note" className="ui-input" value={f.note} onChange={set('note')} />
        </Field>
        <p className="ws-card-blurb">Recording asks for a code from your authenticator app. It goes on the operator log.</p>
        <Err>{error}</Err>
      </div>
    </WsDrawer>
  );
}
