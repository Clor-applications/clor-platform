import React, { useEffect, useState } from 'react';

import { api } from './api';
import Gate from './Gate';
import { Loading, Notice } from './kit';

/* First sign-in: an authenticator app is set up before anything can be read. */
export default function Enrol({ me, onDone }) {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.setupAuthenticator().then(setSetup, (e) => setError(e.message));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.enableAuthenticator(code);
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Gate title="Set up your authenticator" subtitle={`Signed in as ${me.name}. Every change in the Console asks for a code from an authenticator app.`}>
      {!setup && !error ? <Loading /> : null}
      {setup ? (
        <form onSubmit={submit} className="space-y-5">
          <ol className="con-steps">
            <li>
              Scan this with your authenticator app.
              <img className="con-qr" src={setup.qr} width="220" height="220" alt="QR code for your authenticator app" />
              <span className="ui-caption">Or type this key: <code className="con-key">{setup.secret}</code></span>
            </li>
            <li>
              <label className="ui-label" htmlFor="con-enrol-code">Enter the six-digit code it shows</label>
              <input id="con-enrol-code" className="ui-input h-11 w-full con-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </li>
          </ol>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <button type="submit" className="ui-btn ui-btn-brand ui-btn-lg w-full" disabled={busy || code.length !== 6}>Finish</button>
        </form>
      ) : error ? <Notice tone="bad">{error}</Notice> : null}
    </Gate>
  );
}
