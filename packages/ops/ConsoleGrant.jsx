import React, { useState } from 'react';

import { opsConsoleGrant } from './api';

/*
 * The Engineering Console's "Sign in with CLOR" lands here
 * (ops.clor.in/?console_grant=<its sign-in attempt>). Staff confirm, the API
 * makes a one-minute pass for that attempt, and the browser goes back to the
 * Console with it. The address to go back to comes from the API, never from
 * this page's own address, so a made-up link cannot send a pass elsewhere.
 *
 * The attempt is read once, when the page loads, so it survives signing in to
 * Ops first.
 */
export const consoleGrantState = (() => {
  try {
    const state = new URLSearchParams(window.location.search).get('console_grant') || '';
    return /^[0-9a-f]{32}$/.test(state) ? state : '';
  } catch {
    return '';
  }
})();

export function ConsoleGrant({ state, me, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const { redirectTo } = await opsConsoleGrant(state);
      window.location.assign(redirectTo);
    } catch (e) {
      setError(e?.message || 'That did not work. Start again from the Console sign-in page.');
      setBusy(false);
    }
  };
  return (
    <main className="ws-admin" style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
      <h1 className="ws-title">Open the Engineering Console</h1>
      <p className="ws-lede">You are signed in as {me.user?.email}. The Console will ask for its own authenticator code next.</p>
      {error ? <p className="ui-alert ui-alert-neg" role="alert">{error}</p> : null}
      <div className="ws-actions" style={{ marginTop: 16 }}>
        <button type="button" className="ws-btn ws-btn--primary" onClick={go} disabled={busy}>Continue to the Console</button>
        <button type="button" className="ws-btn ws-btn--quiet" onClick={onCancel} disabled={busy}>Stay in Ops</button>
      </div>
    </main>
  );
}
