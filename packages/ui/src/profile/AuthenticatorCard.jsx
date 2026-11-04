import React, { useEffect, useState } from 'react';
import { KeyRound } from '@ui/components/ui/lineIcons';
import QRCode from 'qrcode';

import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

const base = () => `/orgs/${encodeURIComponent(String(orgId() || ''))}/security`;
const opts = { skipWarehouseHeader: true };
const getTwoFactor = () => apiFetch(`${base()}/two-factor`, opts);
const startTwoFactor = () => apiFetch(`${base()}/two-factor/setup`, { method: 'POST', ...opts });
const enableTwoFactor = (code) => apiFetch(`${base()}/two-factor/enable`, { method: 'POST', body: { code }, ...opts });
const disableTwoFactor = (password, code) => apiFetch(`${base()}/two-factor/disable`, { method: 'POST', body: { password, code }, ...opts });

/**
 * The signed-in person's authenticator app: set up by scanning a QR code and
 * typing a code from it, shown recovery codes once, turned off with their
 * password and a current code (or a recovery code) — a password alone could
 * otherwise strip the second factor. Where the company asks (Policy), payroll approvals need a code.
 */
export default function AuthenticatorCard() {
  const [state, setState] = useState(null);
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [password, setPassword] = useState('');
  const [offCode, setOffCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = () => getTwoFactor().then(setState).catch(() => setState(null));
  useEffect(() => {
    load();
  }, []);

  const act = async (fn) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setNote({ ok: false, text: String(e?.message || 'Not done.') });
    } finally {
      setBusy(false);
    }
  };
  const begin = () =>
    act(async () => {
      const r = await startTwoFactor();
      setSetup(r);
      setQr(await QRCode.toDataURL(r.uri, { margin: 1, width: 192 }));
    });
  const confirm = (e) => {
    e.preventDefault();
    act(async () => {
      const r = await enableTwoFactor(code.trim());
      setCodes(r.recoveryCodes);
      setSetup(null);
      setCode('');
      load();
    });
  };
  const turnOff = (e) => {
    e.preventDefault();
    act(async () => {
      await disableTwoFactor(password, offCode.trim());
      setPassword('');
      setOffCode('');
      setCodes(null);
      setNote({ ok: true, text: 'Authenticator turned off.' });
      load();
    });
  };

  if (!state) return null;
  return (
    <section className="ui-card p-5 space-y-3" aria-labelledby="totp-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="totp-heading" className="ui-t-sec">Authenticator app</h2>
        <span className={`ui-pill ${state.enabled ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{state.enabled ? 'On' : 'Off'}</span>
      </div>
      <p className="ui-caption">
        A code from an app on your phone (Google Authenticator, Microsoft Authenticator…), asked for every time you sign in once it is on
        {state.payrollStepUp ? `, and again before payroll approvals and payments (good for ${state.stepUpMinutes} minutes).` : '.'}
      </p>

      {codes ? (
        <div className="space-y-2">
          <p className="text-sm">Recovery codes — each works once if you lose your phone. Keep them somewhere safe; they are not shown again.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {codes.map((c) => (
              <span key={c} className="ui-mono rounded-lg px-2 py-1 text-sm" style={{ background: 'rgb(var(--surface-2))' }}>{c}</span>
            ))}
          </div>
        </div>
      ) : null}

      {state.enabled ? (
        <form onSubmit={turnOff} className="flex flex-wrap items-end gap-2">
          <span className="ui-caption w-full">Set up {new Date(state.enabledAt).toLocaleDateString()} · {state.recoveryCodesLeft} recovery codes left.</span>
          <input type="password" className="ui-input" placeholder="Your password" aria-label="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <input className="ui-input ui-num w-44 text-center tracking-widest" inputMode="text" autoComplete="one-time-code" maxLength={9} placeholder="Code or recovery code" aria-label="Code from the app, or a recovery code" value={offCode} onChange={(e) => setOffCode(e.target.value)} required />
          <button type="submit" className="ui-btn ui-btn-secondary" disabled={busy || !password || !offCode.trim()}>Turn off</button>
        </form>
      ) : setup ? (
        <form onSubmit={confirm} className="flex flex-wrap items-start gap-4">
          {qr ? <img src={qr} alt="QR code to scan with your authenticator app" width={192} height={192} className="rounded-lg" /> : null}
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm">Scan this with your authenticator app, then type the six-digit code it shows.</p>
            <p className="ui-caption">Can’t scan? Enter this key: <span className="ui-mono break-all">{setup.secret}</span></p>
            <div className="flex flex-wrap gap-2">
              <input className="ui-input ui-num w-36 text-center tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" aria-label="Code from the app" value={code} onChange={(e) => setCode(e.target.value)} required />
              <button type="submit" className="ui-btn ui-btn-primary" disabled={busy || code.trim().length !== 6}>Turn on</button>
            </div>
          </div>
        </form>
      ) : (
        <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={begin}>
          <KeyRound size={14} aria-hidden="true" /> Set up an authenticator app
        </button>
      )}
      {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
    </section>
  );
}
