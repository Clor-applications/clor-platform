import React, { useState } from 'react';

import { api } from './api';
import Gate from './Gate';
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
    <Gate title="Enter your code" subtitle={`Signed in as ${me.name}. Open your authenticator app and type the 6-digit code for CLOR Console.`}>
      <form className="space-y-5" onSubmit={submit}>
        <div className="space-y-2">
          <label className="ui-label" htmlFor="con-signin-code">Six-digit code</label>
          <input id="con-signin-code" className="ui-input h-11 w-full con-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </div>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <button type="submit" className="ui-btn ui-btn-brand ui-btn-lg w-full" disabled={busy || code.length !== 6}>Continue</button>
        <p className="text-sm text-center"><button type="button" className="ui-link font-medium" onClick={() => api.signOut().finally(() => window.location.assign('/'))}>Sign out</button></p>
      </form>
    </Gate>
  );
}
