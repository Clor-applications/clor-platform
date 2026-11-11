import React, { useEffect, useState } from 'react';

import { acceptInvitationNew, acceptInvitationSignedIn, previewInvitation } from '@platform/admin/account';
import AuthLayout from './AuthLayout';
import { useSession } from './session';

/**
 * The invited person's door (Workspace W-3): app.clor.in/invite?token=...
 *
 * Shows who invited them and to what, then one of three things:
 *  - no CLOR login for that address yet: their name and a password they
 *    choose, and they are in;
 *  - a login exists and they are signed in as that address: accept;
 *  - a login exists and they are not (or are someone else): sign in with
 *    that address first.
 * The token stays in this page; the server checks everything again.
 */
const ROLE = { ADMIN: 'an administrator', BILLING_ADMIN: 'a billing administrator', MEMBER: 'a member' };

export default function InviteAccept({ token, onHome, onSignIn }) {
  const { user, signIn, signOut } = useSession();
  const [invite, setInvite] = useState(null);
  const [failure, setFailure] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    previewInvitation(token)
      .then(setInvite)
      .catch((e) => setFailure(String(e?.message || 'This invitation link is not valid.')));
  }, [token]);

  const done = () => window.location.replace('/');
  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(String(e?.message || 'That did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (failure) {
    return (
      <AuthLayout scene="invite" title="This invitation can’t be used" subtitle={failure} onHome={onHome}>
        <button type="button" className="ui-btn ui-btn-secondary w-full" onClick={onSignIn}>
          Go to sign in
        </button>
      </AuthLayout>
    );
  }
  if (!invite) {
    return (
      <AuthLayout scene="invite" title="Opening your invitation…" onHome={onHome}>
        <p className="ui-caption" role="status">
          Checking the link.
        </p>
      </AuthLayout>
    );
  }

  const where = invite.companies?.length ? ` (${invite.companies.join(', ')})` : '';
  const subtitle = `${invite.invitedBy || 'Someone'} invited ${invite.email} to join ${invite.accountName}${where} as ${ROLE[invite.accountRole] || 'a member'}.`;
  const signedInAsInvited = user && String(user.email || '').toLowerCase() === String(invite.email).toLowerCase();

  if (user && !signedInAsInvited) {
    return (
      <AuthLayout scene="invite" title="Accept your invitation" subtitle={subtitle} onHome={onHome}>
        <p className="text-sm">
          You are signed in as {user.email}. This invitation is for {invite.email}: sign out, then open the link again.
        </p>
        <button type="button" className="ui-btn ui-btn-secondary w-full mt-4" onClick={() => signOut()}>
          Sign out
        </button>
      </AuthLayout>
    );
  }

  if (signedInAsInvited) {
    return (
      <AuthLayout scene="invite" title="Accept your invitation" subtitle={subtitle} onHome={onHome}>
        <button type="button" className="ui-btn ui-btn-primary w-full" disabled={busy} onClick={() => run(async () => { await acceptInvitationSignedIn(token); done(); })}>
          {busy ? 'Joining…' : `Join ${invite.accountName}`}
        </button>
        {error ? <p role="alert" className="mt-3 text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      </AuthLayout>
    );
  }

  /* Not signed in. */
  return (
    <AuthLayout scene="invite" title="Accept your invitation" subtitle={subtitle} onHome={onHome}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            if (invite.hasLogin) {
              const r = await signIn({ email: invite.email, password });
              /* An authenticator code is asked on the normal sign-in page; the link still works afterwards. */
              if (r?.twoFactorRequired) throw new Error('Your login asks for an authenticator code. Sign in first, then open the link again.');
              await acceptInvitationSignedIn(token);
            } else {
              await acceptInvitationNew(token, name.trim(), password);
              await signIn({ email: invite.email, password });
            }
            done();
          });
        }}
      >
        <label className="grid gap-1">
          <span className="text-sm font-medium">Email</span>
          <input className="ui-input" value={invite.email} readOnly autoComplete="username" />
        </label>
        {invite.hasLogin ? null : (
          <label className="grid gap-1">
            <span className="text-sm font-medium">Your name</span>
            <input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} />
          </label>
        )}
        <div className="grid gap-1">
          <label htmlFor="invite-password" className="text-sm font-medium">{invite.hasLogin ? 'Your password' : 'Choose a password'}</label>
          <input
            id="invite-password"
            aria-describedby={invite.hasLogin ? undefined : 'invite-password-help'}
            className="ui-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={invite.hasLogin ? 'current-password' : 'new-password'}
            required
            minLength={8}
          />
          {invite.hasLogin ? null : <span id="invite-password-help" className="ui-caption">At least eight characters, and not a common one.</span>}
        </div>
        <button type="submit" className="ui-btn ui-btn-primary w-full" disabled={busy}>
          {busy ? 'Joining…' : invite.hasLogin ? 'Sign in and join' : 'Create my login and join'}
        </button>
        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      </form>
    </AuthLayout>
  );
}
