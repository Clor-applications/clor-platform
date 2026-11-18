import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight } from '@ui/components/ui/lineIcons';

import { loginTwoFactorSms } from '@platform/auth';
import { useSession } from './session';
import { clockText, lockoutSeconds } from './lockoutWait';

/**
 * The second step of a sign-in, after a right password: a code from the
 * authenticator app, a code sent by text message, or a recovery code. Used by
 * the sign-in page and the invitation page, each in its own frame.
 *
 * `methods` says what this person has on (APP, SMS or both). With the app the
 * page opens on it and offers "Text me a code instead"; with text messages
 * only, a code is sent as the page opens. A text costs money and can be used
 * to pester a number, so the server holds back resends: the button counts
 * down the seconds it gave.
 *
 * `frame({ title, subtitle, children })` draws the page around the form.
 */
export default function SecondStep({ challenge, methods = ['APP'], phone, frame, onExpired, onCancel, onSignedIn, submitLabel = 'Sign in' }) {
  const { signInWithCode } = useSession();
  const hasApp = methods.includes('APP');
  const hasSms = methods.includes('SMS');
  const [mode, setMode] = useState(hasApp || !hasSms ? 'APP' : 'SMS');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [wait, setWait] = useState(0);
  const [locked, setLocked] = useState(0);
  const asked = useRef(false);

  useEffect(() => {
    if (locked <= 0) return undefined;
    const t = setTimeout(() => setLocked((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [locked]);

  const expired = useCallback((err) => err?.code === 'CHALLENGE_EXPIRED' || err?.status === 401, []);

  const sendText = useCallback(async () => {
    setSending(true);
    setError('');
    try {
      const r = await loginTwoFactorSms(challenge);
      setSentTo(r?.phone || phone || 'your phone');
      setWait(Number(r?.resendIn) || 30);
    } catch (err) {
      if (expired(err)) return onExpired?.(String(err?.message || ''));
      const held = Number(err?.data?.retryAfter) || 0;
      if (err?.code === 'SMS_HELD' && held > 0 && held <= 60) {
        /* One was sent seconds ago (a second tab, a double click): that text is the one to type. */
        setSentTo((s) => s || phone || 'your phone');
        setWait(held);
      } else {
        setError(String(err?.message || 'The code could not be sent.'));
      }
    } finally {
      setSending(false);
    }
    return undefined;
  }, [challenge, phone, onExpired, expired]);

  /* On text messages: send the first code without being asked, once. */
  useEffect(() => {
    if (mode !== 'SMS' || asked.current) return;
    asked.current = true;
    sendText();
  }, [mode, sendText]);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim()) return setError(mode === 'SMS' ? 'Enter the code from the text message.' : 'Enter the code from your authenticator app.');
    setBusy(true);
    setError('');
    try {
      await signInWithCode({ challenge, code: code.trim() });
      await onSignedIn?.();
    } catch (err) {
      if (expired(err)) return onExpired?.(String(err?.message || ''));
      const hold = lockoutSeconds(err);
      if (hold > 0) setLocked(hold);
      else setError(String(err?.message || 'That code did not work.'));
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const switchTo = (next) => {
    setMode(next);
    setCode('');
    setError('');
  };

  const subtitle =
    mode === 'SMS'
      ? sentTo
        ? `We texted a 6-digit code to ${sentTo}. It works for 5 minutes.`
        : sending
          ? 'Sending a code to your phone…'
          : 'A 6-digit code goes to your phone by text message.'
      : 'Open your authenticator app and type the 6-digit code for CLOR.';

  return frame({
    title: 'Enter your code',
    subtitle,
    children: (
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="ui-label" htmlFor="signin-code">Code</label>
          <input
            id="signin-code"
            className="ui-input ui-mono h-11 w-full text-lg tracking-widest"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={9}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError('');
            }}
          />
          <p className="ui-caption mt-1.5">Lost your phone? Type one of your recovery codes instead (like ABCD-EFGH).</p>
        </div>
        {locked > 0 ? (
          <div role="alert" className="ui-code-wait">
            <b>Too many tries</b>
            <span className="ui-caption">Try again in <span className="tabular-nums">{clockText(locked)}</span></span>
          </div>
        ) : error ? (
          <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p>
        ) : null}
        <button type="submit" className="ui-btn ui-btn-brand ui-btn-lg w-full" disabled={busy || locked > 0}>
          {busy ? 'Checking…' : submitLabel} <ArrowRight size={16} aria-hidden="true" />
        </button>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {mode === 'SMS' ? (
            <button type="button" className="ui-link text-sm" disabled={sending || wait > 0} onClick={sendText} style={sending || wait > 0 ? { opacity: 0.6, cursor: 'default' } : undefined}>
              {sending ? 'Sending…' : wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
            </button>
          ) : hasSms ? (
            <button type="button" className="ui-link text-sm" onClick={() => switchTo('SMS')}>
              Text me a code instead
            </button>
          ) : null}
          {mode === 'SMS' && hasApp ? (
            <button type="button" className="ui-link text-sm" onClick={() => switchTo('APP')}>
              Use my authenticator app
            </button>
          ) : null}
          <button type="button" className="ui-link text-sm" onClick={onCancel}>
            Use a different account
          </button>
        </div>
      </form>
    ),
  });
}
