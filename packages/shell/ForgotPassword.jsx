import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';

import AuthLayout from './AuthLayout';
import { forgotPassword } from '../platform/auth';

/**
 * Asks for a reset link.
 *
 * The answer is the same whether or not the address has an account: telling a
 * stranger "no such user" tells them which addresses are registered. The server
 * already replies generically; this screen does not undo that.
 */
export default function ForgotPassword({ onHome, onSignIn }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return setError('Enter the email you signed up with.');
    setBusy(true);
    setError('');
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(String(err?.message || 'Could not send the link. Try again in a minute.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle={sent ? 'Check your inbox.' : 'We will email you a link to choose a new one.'}
      onHome={onHome}
      footer={
        <span className="ui-muted">
          Remembered it?{' '}
          <button type="button" className="ui-link font-medium" onClick={onSignIn}>
            Sign in
          </button>
        </span>
      }
    >
      {sent ? (
        <div className="space-y-3 text-sm" role="status">
          <p>
            If <strong>{email.trim()}</strong> has a Clor account, a reset link is on its way. It works once and
            expires in 30 minutes.
          </p>
          <p className="ui-muted">Nothing arrived after a few minutes? Check spam, or send it again.</p>
          <button type="button" className="ui-link font-medium" onClick={() => setSent(false)}>
            Send it again
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className="ui-label" htmlFor="forgot-email">Email address</label>
            <input
              id="forgot-email"
              type="email"
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
          {error ? <p className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
          <button type="submit" className="ui-btn ui-btn-brand ui-btn-lg w-full" disabled={busy}>
            {busy ? 'Sending…' : 'Email me a reset link'} <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
