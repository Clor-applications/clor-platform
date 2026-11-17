import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Download, ShieldCheck } from '@ui/components/ui/lineIcons';

import { enableSmsTwoFactor, enableTwoFactor, getTwoFactor, startSmsTwoFactor, startTwoFactor } from '@ui/profile/twoFactorApi';
import GatePage, { GateStep } from './GatePage';
import { useSession } from './session';

/**
 * The one screen an owner or admin sees when their company requires two-factor
 * sign-in and they have no authenticator yet (SX-09). The API refuses
 * everything else for them until it is set up, so the app is not drawn at all.
 *
 * Three steps, in order, each one open only when it is the next thing to do:
 * the password (so a stolen session cannot add the thief's phone), the QR code
 * and a code from it, then the recovery codes. Continue is the last step's
 * button and is only offered once there is something to continue to.
 *
 * Where CLOR's SMS sender is set up, step one also asks how the code should
 * come: from an authenticator app (first, and the safer one) or by text
 * message to an Indian mobile number. Step two then shows the QR code or asks
 * for the texted code.
 */
export default function TwoFactorGate() {
  const { user, recheckTwoFactor, signOut } = useSession();
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  /* 'APP' or 'SMS'; SMS is offered only when the server says it can send. */
  const [method, setMethod] = useState('APP');
  const [smsOffered, setSmsOffered] = useState(false);
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [wait, setWait] = useState(0);
  const smsPassword = useRef('');

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  /* Set up already (another tab, another device): straight to Continue. */
  useEffect(() => {
    getTwoFactor()
      .then((s) => {
        if (s?.enabled || s?.sms?.enabled) {
          setStep(2);
          setSaved(true);
        }
        setSmsOffered(Boolean(s?.sms?.available));
      })
      .catch(() => {});
  }, []);

  const act = async (fn) => {
    setBusy(true);
    setNote('');
    try {
      await fn();
    } catch (e) {
      setNote(String(e?.message || 'That did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const textCode = async (pw) => {
    const r = await startSmsTwoFactor(pw, phone);
    setSentTo(r.phone);
    setWait(r.resendIn || 30);
  };
  const begin = (e) => {
    e.preventDefault();
    act(async () => {
      if (method === 'SMS') {
        await textCode(password);
        /* Kept for "Send a new code" only, in memory, until the number is confirmed. */
        smsPassword.current = password;
        setPassword('');
        setStep(1);
        return;
      }
      const r = await startTwoFactor(password);
      setPassword('');
      setSetup(r);
      setQr(await QRCode.toDataURL(r.uri, { margin: 1, width: 176 }));
      setStep(1);
    });
  };
  const turnOn = (e) => {
    e.preventDefault();
    act(async () => {
      const r = method === 'SMS' ? await enableSmsTwoFactor(code.trim()) : await enableTwoFactor(code.trim());
      smsPassword.current = '';
      setCodes(r.recoveryCodes || []);
      setCode('');
      setStep(2);
    });
  };
  const carryOn = () =>
    act(async () => {
      const still = await recheckTwoFactor();
      if (still) setNote('Two-step sign-in is not on yet. Go back a step and enter the code.');
    });

  const codesText = (codes || []).join('\n');
  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(codesText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNote('Copying is blocked in this browser. Download the codes instead.');
    }
  };
  const downloadCodes = () => {
    const blob = new Blob([`CLOR recovery codes\n${user?.email || ''}\nEach code works once.\n\n${codesText}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'clor-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const stateOf = (i) => (i < step ? 'done' : i === step ? 'current' : 'next');

  return (
    <GatePage
      icon={ShieldCheck}
      eyebrow="Security"
      title="Set up two-factor sign-in"
      subtitle={smsOffered ? 'Your company asks owners and admins for a code as well as the password: from an authenticator app, or by text message. It takes about a minute.' : 'Your company asks owners and admins for a code from an authenticator app as well as the password. It takes about a minute.'}
      who={user?.email || user?.fullName}
      onSignOut={signOut}
    >
      <ol className="ui-gate-steps">
        <GateStep n={1} title={smsOffered ? 'Choose how to get your code' : 'Confirm your password'} state={stateOf(0)} summary={smsOffered ? (method === 'SMS' ? 'By text message.' : 'From an authenticator app.') : 'Confirmed.'}>
          <form onSubmit={begin} className="grid gap-3">
            {smsOffered ? (
              <fieldset className="grid gap-2">
                <legend className="sr-only">How to get your code</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="gate-method" className="mt-0.5" checked={method === 'APP'} onChange={() => setMethod('APP')} />
                  <span>
                    <span className="font-medium">Authenticator app</span>
                    <span className="ui-caption block">Google Authenticator, Microsoft Authenticator or similar. Safer, and works without signal.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="gate-method" className="mt-0.5" checked={method === 'SMS'} onChange={() => setMethod('SMS')} />
                  <span>
                    <span className="font-medium">Text message</span>
                    <span className="ui-caption block">A code texted to your Indian mobile number each time you sign in.</span>
                  </span>
                </label>
              </fieldset>
            ) : null}
            {method === 'SMS' ? (
              <label className="grid gap-1.5">
                <span className="ui-label">Mobile number</span>
                <input className="ui-input tabular-nums h-10 w-full" inputMode="tel" autoComplete="tel-national" maxLength={16} placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} required />
              </label>
            ) : null}
            <label className="grid gap-1.5">
              <span className="ui-label">Password for {user?.email || 'this account'}</span>
              <input type="password" className="ui-input h-10 w-full" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
            </label>
            <div>
              <button type="submit" className="ui-btn ui-btn-primary" disabled={busy || !password || (method === 'SMS' && phone.replace(/\D/g, '').length < 10)}>{busy ? 'Checking…' : method === 'SMS' ? 'Text me a code' : 'Continue'}</button>
            </div>
          </form>
        </GateStep>

        <GateStep n={2} title={method === 'SMS' ? 'Type the code we texted you' : 'Scan the code with your authenticator app'} state={stateOf(1)} summary={codes && method === 'SMS' ? 'Codes by text message switched on.' : codes ? 'Authenticator switched on.' : 'Two-step sign-in is on.'}>
          {method === 'SMS' ? (
            <form onSubmit={turnOn} className="grid gap-3">
              <p className="text-sm">We texted a 6-digit code to <span className="ui-mono">{sentTo}</span>. It works for 5 minutes.</p>
              <label className="grid gap-1.5">
                <span className="ui-label">Code from the text message</span>
                <input className="ui-input ui-num h-10 w-40 text-center tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus required />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" className="ui-btn ui-btn-primary" disabled={busy || code.trim().length !== 6}>{busy ? 'Checking…' : 'Turn on'}</button>
                <button type="button" className="ui-btn ui-btn-ghost" disabled={busy || wait > 0} onClick={() => act(() => textCode(smsPassword.current))}>
                  {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
                </button>
                <button type="button" className="ui-btn ui-btn-ghost" disabled={busy} onClick={() => { smsPassword.current = ''; setCode(''); setNote(''); setStep(0); }}>
                  Change number or use an app
                </button>
              </div>
            </form>
          ) : (
          <form onSubmit={turnOn} className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
            {qr ? (
              <img src={qr} alt="QR code to scan with your authenticator app" width={176} height={176} className="rounded-xl" style={{ border: '1px solid rgb(229 229 229)' }} />
            ) : null}
            <div className="grid gap-3 min-w-0">
              <p className="text-sm">Open Google Authenticator, Microsoft Authenticator or similar, add an account, and scan this. Then type the six-digit code it shows.</p>
              {setup?.secret ? (
                <p className="ui-caption">Can’t scan? Enter this key: <span className="ui-mono break-all" style={{ color: 'rgb(var(--fg))' }}>{setup.secret}</span></p>
              ) : null}
              <label className="grid gap-1.5">
                <span className="ui-label">Code from the app</span>
                <input className="ui-input ui-num h-10 w-40 text-center tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus required />
              </label>
              <div>
                <button type="submit" className="ui-btn ui-btn-primary" disabled={busy || code.trim().length !== 6}>{busy ? 'Checking…' : 'Turn on'}</button>
              </div>
            </div>
          </form>
          )}
        </GateStep>

        <GateStep n={3} title="Save your recovery codes" state={stateOf(2)} last>
          <div className="grid gap-4">
            {codes ? (
              <>
                <p className="text-sm">If you lose your phone, each of these signs you in once. They are not shown again.</p>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl p-4 sm:grid-cols-3" style={{ border: '1px solid rgb(229 229 229)' }} aria-label="Recovery codes">
                  {codes.map((c) => (
                    <li key={c} className="ui-mono text-sm">{c}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={copyCodes}>
                    <Copy size={14} aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={downloadCodes}>
                    <Download size={14} aria-hidden="true" /> Download
                  </button>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                  I have saved these codes somewhere safe
                </label>
              </>
            ) : (
              <p className="text-sm">Two-step sign-in is already on for this account.</p>
            )}
            <div>
              <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !saved} onClick={carryOn}>{busy ? 'Opening…' : 'Continue to CLOR'}</button>
            </div>
          </div>
        </GateStep>
      </ol>
      {note ? <p role="alert" className="mt-6 text-sm" style={{ color: 'rgb(var(--neg))' }}>{note}</p> : null}
    </GatePage>
  );
}
