import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';

import AuthLayout from './AuthLayout';
import { useSession } from './session';

/**
 * Creating an account, and nothing else.
 *
 * This asked for the company here as well — its name, its GSTIN, its state —
 * and then asked again in the setup that runs on the way in, because a company
 * is not something an account has one of. An accountant has several. A group
 * has one per entity. Asking at sign-up made the first company a property of
 * the person, which is the shape the platform spent this whole restructure
 * getting away from.
 *
 * So sign-up is who you are. What you keep books for is the next screen, and
 * it is the same screen you use to add the second company.
 */
export default function SignUp({ onHome, onSignIn }) {
  const { signUp } = useSession();

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Tell us who you are.');
    if (!form.email.trim()) return setError('An email address, so you can be signed back in.');
    if (form.password.length < 8) return setError('A password of at least eight characters.');

    setBusy(true);
    setError('');
    try {
      await signUp({
        fullName: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
    } catch (err) {
      setError(String(err?.message || 'Could not create that account.'));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Then you will set up your first company — it takes about a minute."
      onHome={onHome}
      footer={
        <span className="ui-muted">
          Already have an account?{' '}
          <button type="button" className="ui-link font-medium" onClick={onSignIn}>
            Sign in
          </button>
        </span>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="ui-label" htmlFor="signup-name">Your name</label>
          <input
            id="signup-name"
            className="ui-input h-11 w-full"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            autoComplete="name"
            autoFocus
          />
        </div>

        <div>
          <label className="ui-label" htmlFor="signup-email">Email address</label>
          <input
            id="signup-email"
            type="email"
            className="ui-input h-11 w-full"
            value={form.email}
            onChange={(e) => set({ email: e.target.value })}
            autoComplete="username"
          />
        </div>

        <div>
          <label className="ui-label" htmlFor="signup-password">Password</label>
          <input
            id="signup-password"
            type="password"
            className="ui-input h-11 w-full"
            value={form.password}
            onChange={(e) => set({ password: e.target.value })}
            autoComplete="new-password"
          />
          <p className="ui-caption mt-1">At least eight characters.</p>
        </div>

        {error ? <p className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

        <button type="submit" className="ui-btn ui-btn-brand ui-btn-lg w-full" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'} <ArrowRight size={16} aria-hidden="true" />
        </button>
      </form>
    </AuthLayout>
  );
}
