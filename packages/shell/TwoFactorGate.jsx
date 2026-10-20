import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import AuthenticatorCard from '@ui/profile/AuthenticatorCard';
import { useSession } from './session';

/**
 * The one screen an owner or admin sees when their company requires two-factor
 * sign-in and they have no authenticator yet (SX-09). The API refuses
 * everything else for them until it is set up, so the app is not drawn at all:
 * set it up here, keep the recovery codes, continue.
 */
export default function TwoFactorGate() {
  const { recheckTwoFactor, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const carryOn = async () => {
    setBusy(true);
    setNote('');
    try {
      const still = await recheckTwoFactor();
      if (still) setNote('An authenticator is not set up yet. Scan the code, enter a 6-digit code to switch it on, then continue.');
    } catch (e) {
      setNote(String(e?.message || 'Could not check. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main-content" className="mx-auto max-w-xl space-y-4 p-6">
      <div className="flex items-start gap-3">
        <ShieldCheck size={22} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div>
          <h1 className="ui-t-page">Set up two-factor sign-in</h1>
          <p className="ui-muted text-sm mt-1">Your company asks owners and admins to sign in with a code from an authenticator app as well as the password. Set one up to continue.</p>
        </div>
      </div>
      <AuthenticatorCard />
      {note ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{note}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={carryOn}>{busy ? 'Checking…' : 'I have saved my recovery codes, continue'}</button>
        <button type="button" className="ui-btn ui-btn-ghost" onClick={signOut}>Sign out</button>
      </div>
    </main>
  );
}
