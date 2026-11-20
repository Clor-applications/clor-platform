import React, { useState } from 'react';
import { ArrowRight } from '@ui/components/ui/lineIcons';

import AuthLayout from './AuthLayout';
import { resetPassword } from '../platform/auth';
import PasswordInput from '@ui/components/ui/PasswordInput';
import { FieldError, FieldErrorAnnounce } from '@ui/components/ui/Primitives';
import { useFieldErrors } from '@ui/components/ui/useFieldErrors';

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

  const rules = {
    password: () => (password.length >= 8 ? '' : 'Use at least 8 characters.'),
    confirm: () => (password === confirm ? '' : 'The two passwords do not match.'),
  };
  const v = useFieldErrors('reset', rules);
  const submit = async (e) => {
    e.preventDefault();
    v.reset();
    v.check('password', !rules.password(), rules.password());
    v.check('confirm', !rules.confirm(), rules.confirm());
    if (v.failed()) {
      setError('');
      return;
    }
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
    <AuthLayout scene="reset"
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
              strength
              className="ui-input h-11 w-full"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              autoComplete="new-password"
              autoFocus
              {...v.props('password')}
            />
            <FieldError error={v.error('password')} id={v.errorId('password')} />
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
              {...v.props('confirm')}
            />
            <FieldError error={v.error('confirm')} id={v.errorId('confirm')} />
          </div>
          <FieldErrorAnnounce errors={v.errors} />
          {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
          <button type="submit" className="ui-btn ui-btn-brand ui-btn-lg w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Save new password'} <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
