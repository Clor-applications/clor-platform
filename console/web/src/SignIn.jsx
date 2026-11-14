import React, { useEffect, useState } from 'react';

import ClorMark from '@ui/components/brand/ClorMark';

import { api, clorSignInUrl, signInUrl } from './api';
import { Loading, Notice } from './kit';

const NOTE = {
  'not-a-member': 'That account is not a member of the Console. Ask an owner to add you.',
  failed: 'You were not signed in. Try again.',
  'clor-off': 'Sign-in with CLOR is not set up for the Console.',
  'github-off': 'Sign-in with GitHub is not set up for the Console.',
};

/*
 * The ways in are whatever the Console has switched on (GET /auth/options):
 * an email address and password, a CLOR staff login, GitHub. None is built
 * in. Whichever is used, the Console's own authenticator code comes next.
 */
export default function SignIn({ onDone }) {
  /* Read once, then taken off the address: a note about one failed try must not sit there on every later visit. */
  const [note] = useState(() => {
    const key = new URLSearchParams(window.location.search).get('signin');
    if (key) {
      try {
        window.history.replaceState(null, '', window.location.pathname);
      } catch {
        /* no history */
      }
    }
    return NOTE[key];
  });
  const [options, setOptions] = useState(null);
  const [mode, setMode] = useState('in');
  const [form, setForm] = useState({ email: '', password: '', code: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.signInOptions().then(setOptions, (e) => setError(e.message));
  }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'in') await api.passwordSignIn(form.email, form.password);
      else await api.passwordSetup(form.email, form.code, form.password);
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const others = options ? [options.clor && ['Sign in with CLOR', clorSignInUrl], options.github && ['Sign in with GitHub', signInUrl]].filter(Boolean) : [];
  const none = options && !options.password && others.length === 0;

  return (
    <main className="con-gate">
      <div className="con-gate-box">
        <ClorMark size={36} />
        <h1 className="con-title">CLOR Console</h1>
        <p className="con-lede">Releases, pull requests and the state of the platform. For CLOR engineering only.</p>
        {note ? <Notice>{note}</Notice> : null}
        {!options && !error ? <Loading /> : null}
        {none ? <Notice>No way to sign in is set up for the Console yet.</Notice> : null}
        {options?.password ? (
          <form onSubmit={submit} className="con-form">
            <label className="con-label" htmlFor="si-email">Email address</label>
            <input id="si-email" className="con-input" type="email" autoComplete="username" required spellCheck={false} autoCapitalize="none" value={form.email} onChange={set('email')} />
            {mode === 'setup' ? (
              <>
                <label className="con-label" htmlFor="si-code">Setup code</label>
                <input id="si-code" className="con-input" autoComplete="off" required spellCheck={false} value={form.code} onChange={set('code')} aria-describedby="si-code-help" />
                <p id="si-code-help" className="con-quiet">The long one-time code you were given (20 characters or more). It is not your authenticator code.</p>
              </>
            ) : null}
            <label className="con-label" htmlFor="si-password">{mode === 'setup' ? 'New password' : 'Password'}</label>
            <input id="si-password" className="con-input" type="password" autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} required minLength={mode === 'setup' ? 12 : 1} value={form.password} onChange={set('password')} aria-describedby={mode === 'setup' ? 'si-password-help' : undefined} />
            {mode === 'setup' ? <p id="si-password-help" className="con-quiet">12 characters or more.</p> : null}
            {error ? <Notice tone="bad">{error}</Notice> : null}
            {error && mode === 'in' ? <p className="con-quiet">First time here? You have no password yet: choose "I have a setup code" below.</p> : null}
            <button type="submit" className="ui-btn con-btn-primary con-gate-btn" disabled={busy}>{mode === 'setup' ? 'Set password and sign in' : 'Sign in'}</button>
            <button type="button" className="ui-btn ui-btn-ghost con-gate-btn" onClick={() => { setMode(mode === 'in' ? 'setup' : 'in'); setError(''); }}>
              {mode === 'in' ? 'I have a setup code' : 'I already have a password'}
            </button>
          </form>
        ) : error ? <Notice tone="bad">{error}</Notice> : null}
        {others.length ? (
          <>
            {options.password ? <p className="con-or">or</p> : null}
            {others.map(([label, href], i) => <a key={href} className={`ui-btn ${!options.password && i === 0 ? 'con-btn-primary' : 'ui-btn-secondary'} con-gate-btn`} href={href}>{label}</a>)}
          </>
        ) : null}
      </div>
    </main>
  );
}
