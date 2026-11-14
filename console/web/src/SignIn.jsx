import React, { useEffect, useState } from 'react';

import { api, clorSignInUrl, signInUrl } from './api';
import Gate from './Gate';
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
  const [usePassword, setUsePassword] = useState(false);
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
  const none = options && !options.password && !options.clor && !options.github;

  const clorFirst = Boolean(options?.clor);
  /* One primary action on the page: with the CLOR login on, the password form waits behind a link. */
  const formShown = Boolean(options?.password) && (!clorFirst || usePassword);

  return (
    <Gate title="Sign in to the Console" subtitle="CLOR staff only. Releases, pull requests and the state of the platform.">
      <div className="space-y-5">
        {note ? <Notice>{note}</Notice> : null}
        {!options && !error ? <Loading /> : null}
        {none ? <Notice>No way to sign in is set up for the Console yet.</Notice> : null}
        {/* The CLOR login is the everyday way in, the same account as Ops, so it leads when it is on. */}
        {clorFirst ? <a className="ui-btn ui-btn-brand ui-btn-lg w-full" href={clorSignInUrl}>Sign in with CLOR</a> : null}
        {clorFirst && options.password && !formShown ? (
          <p className="text-sm text-center"><button type="button" className="ui-link font-medium" onClick={() => setUsePassword(true)}>Use a Console password instead</button></p>
        ) : null}
        {formShown ? (
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-2">
              <label className="ui-label" htmlFor="si-email">Email address</label>
              <input id="si-email" className="ui-input h-11 w-full" type="email" autoComplete="username" required spellCheck={false} autoCapitalize="none" value={form.email} onChange={set('email')} />
            </div>
            {mode === 'setup' ? (
              <div className="space-y-2">
                <label className="ui-label" htmlFor="si-code">Setup code</label>
                <input id="si-code" className="ui-input h-11 w-full" autoComplete="off" required spellCheck={false} value={form.code} onChange={set('code')} aria-describedby="si-code-help" />
                <p id="si-code-help" className="ui-caption">The long one-time code you were given (20 characters or more). It is not your authenticator code.</p>
              </div>
            ) : null}
            <div className="space-y-2">
              <label className="ui-label" htmlFor="si-password">{mode === 'setup' ? 'New password' : 'Password'}</label>
              <input id="si-password" className="ui-input h-11 w-full" type="password" autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} required minLength={mode === 'setup' ? 12 : 1} value={form.password} onChange={set('password')} aria-describedby={mode === 'setup' ? 'si-password-help' : undefined} />
              {mode === 'setup' ? <p id="si-password-help" className="ui-caption">12 characters or more.</p> : null}
            </div>
            {error ? <Notice tone="bad">{error}</Notice> : null}
            {error && mode === 'in' ? <p className="ui-caption">First time here? You have no password yet: choose "I have a setup code" below.</p> : null}
            <button type="submit" className="ui-btn ui-btn-brand ui-btn-lg w-full" disabled={busy}>{mode === 'setup' ? 'Set password and sign in' : 'Sign in'}</button>
            <p className="text-sm text-center">
              <button type="button" className="ui-link font-medium" onClick={() => { setMode(mode === 'in' ? 'setup' : 'in'); setError(''); }}>
                {mode === 'in' ? 'I have a setup code' : 'I already have a password'}
              </button>
            </p>
          </form>
        ) : error && !options ? <Notice tone="bad">{error}</Notice> : null}
        {options?.github ? <a className={`ui-btn ${!options.password && !clorFirst ? 'ui-btn-brand ui-btn-lg' : 'ui-btn-secondary'} w-full`} href={signInUrl}>Sign in with GitHub</a> : null}
        <p className="ui-caption text-center">The Console asks for its authenticator code next.</p>
      </div>
    </Gate>
  );
}
