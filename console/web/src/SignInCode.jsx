import React, { useState } from 'react';

import ClorMark from '@ui/components/brand/ClorMark';

import { api } from './api';
import { Notice } from './kit';

/*
 * After signing in with a password or a CLOR login: the Console's own
 * authenticator code, once, before anything is shown.
 */
export default function SignInCode({ me, onDone }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.stepUp(code);
      await onDone();
    } catch (err) {
      setError(err.message);
      setCode('');
      setBusy(false);
    }
  };
  return (
    <main className="con-gate">
      <form className="con-gate-box con-form" onSubmit={submit}>
        <ClorMark size={36} />
        <h1 className="con-title">Enter your authenticator code</h1>
        <p className="con-lede">Signed in as {me.name}. The Console asks for its authenticator code before it shows anything.</p>
        <label className="con-label" htmlFor="con-signin-code">Six-digit code</label>
        <input id="con-signin-code" className="con-input con-input--code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <button type="submit" className="ui-btn con-btn-primary con-gate-btn" disabled={busy || code.length !== 6}>Continue</button>
        <button type="button" className="ui-btn ui-btn-ghost con-gate-btn" onClick={() => api.signOut().finally(() => window.location.assign('/'))}>Sign out</button>
      </form>
    </main>
  );
}
