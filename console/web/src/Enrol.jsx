import React, { useEffect, useState } from 'react';

import ClorMark from '@ui/components/brand/ClorMark';

import { api } from './api';
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
    <main className="con-gate">
      <div className="con-gate-box">
        <ClorMark size={36} />
        <h1 className="con-title">Set up your authenticator</h1>
        <p className="con-lede">Signed in as {me.name}. Every change in the Console asks for a code from an authenticator app.</p>
        {!setup && !error ? <Loading /> : null}
        {setup ? (
          <form onSubmit={submit} className="con-form">
            <ol className="con-steps">
              <li>
                Scan this with your authenticator app.
                <img className="con-qr" src={setup.qr} width="220" height="220" alt="QR code for your authenticator app" />
                <span className="con-quiet">Or type this key: <code className="con-key">{setup.secret}</code></span>
              </li>
              <li>
                <label className="con-label" htmlFor="con-enrol-code">Enter the six-digit code it shows</label>
                <input id="con-enrol-code" className="con-input con-input--code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </li>
            </ol>
            {error ? <Notice tone="bad">{error}</Notice> : null}
            <button type="submit" className="ui-btn con-btn-primary con-gate-btn" disabled={busy || code.length !== 6}>Finish</button>
          </form>
        ) : error ? <Notice tone="bad">{error}</Notice> : null}
      </div>
    </main>
  );
}
