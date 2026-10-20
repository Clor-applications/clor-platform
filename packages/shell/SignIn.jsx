import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';

import AuthLayout from './AuthLayout';
import { useSession } from './session';
import { API_BASE, apiFetch } from '@platform/http';
import PasswordInput from '@ui/components/ui/PasswordInput';

/**
 * One sign-in for the platform, not for an application.
 *
 * This is the whole reason identity sits in the shell. A company that bought
 * only Payroll signs in here and lands in Payroll; a company with three apps
 * signs in here and lands in Accounting. Neither passes through the other's
 * product to reach its own.
 *
 * It posts to the platform API and gets back a token and the companies this
 * person belongs to. Which company they land in, and therefore which app, is
 * decided from that — not from anything an application told us.
 */
export default function SignIn({ onHome, onSignUp, onForgot }) {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => {
    /* Back from a provider that could not finish: the API sends the reason in the address. */
    try {
      const msg = new URLSearchParams(window.location.search).get('sso_error');
      if (msg) window.history.replaceState({}, '', window.location.pathname + window.location.hash);
      return msg || '';
    } catch {
      return '';
    }
  });
  /* Single sign-on: once the e-mail's domain is known, ask which provider (if any) owns it. */
  const [providers, setProviders] = useState([]);
  useEffect(() => {
    const at = email.indexOf('@');
    if (at < 1 || email.length - at < 4) {
      setProviders([]);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      apiFetch(`/auth/sso/lookup?email=${encodeURIComponent(email.trim())}`, { skipAuth: true })
        .then((r) => live && setProviders(r?.providers || []))
        .catch(() => live && setProviders([]));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [email]);
  const continueWith = (p) => {
    window.location.assign(`${API_BASE}/auth/sso/${encodeURIComponent(p.id)}/start?return=${encodeURIComponent('/')}&hint=${encodeURIComponent(email.trim())}`);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return setError('Enter your email or username.');
    if (!password) return setError('Enter your password.');

    setBusy(true);
    setError('');
    try {
      await signIn({ email: email.trim(), password });
    } catch (err) {
      /* The server is deliberately vague about which half was wrong, and so
         is this: saying "no such account" tells somebody probing which
         addresses are registered. */
      setError(String(err?.message || 'Could not sign you in.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Sign in"
      subtitle="One door into every app this company has."
      onHome={onHome}
      footer={
        <span className="ui-muted">
          No account yet?{' '}
          <button type="button" className="ui-link font-medium" onClick={onSignUp}>
            Start a company
          </button>
        </span>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="ui-label" htmlFor="signin-email">Email or username</label>
          {/* Text, not type="email": the server accepts a username too (set in
              My profile), and an email field refuses anything without an @. */}
          <input
            id="signin-email"
            type="text"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            className="ui-input h-11 w-full"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError('');
            }}
            autoComplete="username"
            autoFocus
          />
        </div>

        {providers.length ? (
          <div className="space-y-2">
            {providers.map((p) => (
              <button key={p.id} type="button" className="ui-btn ui-btn-secondary ui-btn-lg w-full" onClick={() => continueWith(p)}>
                Continue with {p.name}
              </button>
            ))}
            <p className="ui-caption text-center">Your company signs in through {providers[0].name}. A password still works below.</p>
          </div>
        ) : null}

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label className="ui-label" htmlFor="signin-password">Password</label>
            {onForgot ? (
              <button type="button" className="ui-link text-sm" onClick={onForgot}>
                Forgot password?
              </button>
            ) : null}
          </div>
          <PasswordInput
            id="signin-password"
            className="ui-input h-11 w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p>
        ) : null}

        <button type="submit" className="ui-btn ui-btn-brand ui-btn-lg w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={16} aria-hidden="true" />
        </button>
      </form>
    </AuthLayout>
  );
}
