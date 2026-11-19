import React, { useEffect, useState } from 'react';
import { MessageSquare } from '@ui/components/ui/lineIcons';

import { disableSmsTwoFactor, enableSmsTwoFactor, sendSmsOffCode, startSmsTwoFactor } from './twoFactorApi';

/**
 * Codes by text message: the second way to do the second step of a sign-in,
 * beside the authenticator app. Shown only where CLOR's SMS sender is set up
 * (or it is already on for this person, so they can turn it off).
 *
 * Turned on with the password and an Indian mobile number, then the code sent
 * to it; turned off with the password and a code just texted, a code from the
 * app, or a recovery code. `sms` comes from GET security/two-factor.
 */
export default function TextCodesCard({ sms, appOn = false, payrollStepUp = false, onChange }) {
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  if (!sms || (!sms.enabled && !sms.available)) return null;

  const act = async (fn) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      if (e?.code === 'SMS_HELD' && e?.data?.retryAfter <= 60) setWait(e.data.retryAfter);
      setNote({ ok: false, text: String(e?.message || 'Not done.') });
    } finally {
      setBusy(false);
    }
  };

  const begin = (e) => {
    e?.preventDefault();
    act(async () => {
      const r = await startSmsTwoFactor(password, phone);
      setSentTo(r.phone);
      setWait(r.resendIn || 30);
      setCode('');
    });
  };
  const confirm = (e) => {
    e.preventDefault();
    act(async () => {
      const r = await enableSmsTwoFactor(code.trim());
      setCodes(r.recoveryCodes || null);
      setPassword('');
      setPhone('');
      setSentTo('');
      setCode('');
      setWait(0);
      setNote({ ok: true, text: `Codes by text message are on, to ${r.phone}.` });
      onChange?.();
    });
  };
  const textOffCode = () =>
    act(async () => {
      const r = await sendSmsOffCode();
      setWait(r.resendIn || 30);
      setNote({ ok: true, text: `We texted a code to ${r.phone}.` });
    });
  const turnOff = (e) => {
    e.preventDefault();
    act(async () => {
      await disableSmsTwoFactor(password, code.trim());
      setPassword('');
      setCode('');
      setCodes(null);
      setNote({ ok: true, text: 'Codes by text message turned off.' });
      onChange?.();
    });
  };

  const resendLabel = wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code';

  return (
    <section className="ui-card p-5 space-y-3" aria-labelledby="sms-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sms-heading" className="ui-t-sec">Codes by text message</h2>
        <span className={`ui-pill ${sms.enabled ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{sms.enabled ? 'On' : 'Off'}</span>
      </div>
      <p className="ui-caption">
        A six-digit code texted to your Indian mobile number when you sign in{appOn ? ', as another way beside your authenticator app' : ''}. An authenticator app is safer and works
        without signal{payrollStepUp ? '; payroll approvals and payments still ask for the app' : ''}.
      </p>

      {codes ? (
        <div className="space-y-2">
          <p className="text-sm">Recovery codes: each works once if you lose your phone. Keep them somewhere safe; they are not shown again.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {codes.map((c) => (
              <span key={c} className="ui-mono rounded-lg px-2 py-1 text-sm" style={{ border: '1px solid rgb(var(--border))' }}>{c}</span>
            ))}
          </div>
        </div>
      ) : null}

      {sms.enabled ? (
        <form onSubmit={turnOff} className="flex flex-wrap items-end gap-2">
          <span className="ui-caption w-full">
            Codes go to <span className="ui-mono">{sms.phone}</span>
            {sms.enabledAt ? ` · on since ${new Date(sms.enabledAt).toLocaleDateString()}` : ''}. To use another number, turn this off and on again.
          </span>
          <input type="password" className="ui-input" placeholder="Your password" aria-label="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <input className="ui-input ui-num w-44 text-center tracking-widest" inputMode="text" autoComplete="one-time-code" maxLength={9} placeholder="Code" aria-label="A texted code, a code from the app, or a recovery code" value={code} onChange={(e) => setCode(e.target.value)} required />
          <button type="submit" className="ui-btn ui-btn-secondary" disabled={busy || !password || !code.trim()}>Turn off</button>
          <button type="button" className="ui-btn ui-btn-ghost" disabled={busy || wait > 0} onClick={textOffCode}>
            {wait > 0 ? `Text me a code in ${wait}s` : 'Text me a code'}
          </button>
          <span className="ui-caption w-full">The code can be one we text you now{appOn ? ', one from your authenticator app' : ''} or a recovery code.</span>
        </form>
      ) : sentTo ? (
        <form onSubmit={confirm} className="space-y-2">
          <p className="text-sm">We texted a code to <span className="ui-mono">{sentTo}</span>. Type it here within 5 minutes.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input className="ui-input ui-num w-36 text-center tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" aria-label="Code from the text message" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus required />
            <button type="submit" className="ui-btn ui-btn-primary" disabled={busy || code.length !== 6}>Turn on</button>
            <button type="button" className="ui-btn ui-btn-ghost" disabled={busy || wait > 0} onClick={() => begin()}>{resendLabel}</button>
            <button type="button" className="ui-btn ui-btn-ghost" disabled={busy} onClick={() => { setSentTo(''); setCode(''); setNote(null); }}>Change number</button>
          </div>
        </form>
      ) : (
        <form onSubmit={begin} className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="text-sm font-medium">Your password</span>
            <input type="password" className="ui-input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Mobile number</span>
            <input className="ui-input tabular-nums w-44" inputMode="tel" autoComplete="tel-national" maxLength={16} placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </label>
          <button type="submit" className="ui-btn ui-btn-secondary" disabled={busy || !password || phone.replace(/\D/g, '').length < 10}>
            <MessageSquare size={14} aria-hidden="true" /> Text me a code
          </button>
        </form>
      )}
      {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
    </section>
  );
}
