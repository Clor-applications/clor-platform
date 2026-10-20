import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';

import AuthLayout from './AuthLayout';
import { resetPassword } from '../platform/auth';
import PasswordInput from '@ui/components/ui/PasswordInput';

/**
 * Where the link in a reset email lands (`/?reset=<token>`).
 *
 * The token is single-use and expires in 30 minutes; a successful reset also
 * ends every session this person had, so they sign in fresh everywhere.
 */
export default function ResetPassword({ token, onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await resetPassword({ token, password });
      setDone(true);
    } catch (err) {
      setError(String(err?.message || 'This link no longer works. Ask for a new one.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={done ? 'Password changed' : 'Choose a new password'}
      subtitle={done ? 'Sign in with your new password.' : 'This link works once and expires 30 minutes after it was sent.'}
      onHome={onDone}
    >
      {done ? (
        <button type="button" className="ui-btn ui-btn-brand ui-btn-lg w-full" onClick={onDone}>
          Go to sign in <ArrowRight size={16} aria-hidden="true" />
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className="ui-label" htmlFor="reset-password">New password</label>
            <PasswordInput
              id="reset-password"
              className="ui-input h-11 w-full"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              autoComplete="new-password"
              autoFocus
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="reset-confirm">Type it again</label>
            <PasswordInput
              id="reset-confirm"
              className="ui-input h-11 w-full"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setError('');
              }}
              autoComplete="new-password"
            />
          </div>
          {error ? <p className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
          <button type="submit" className="ui-btn ui-btn-brand ui-btn-lg w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Save new password'} <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
