import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight } from '@ui/components/ui/lineIcons';

import AuthLayout from './AuthLayout';
import { verifyEmail } from '../platform/auth';

/**
 * Where the link in a verification email lands (`/?verify=<token>`).
 *
 * Confirms once on arrival. The ref stops React's development double-mount from
 * spending the single-use token twice and reporting the second attempt's
 * failure over the first one's success.
 */
export default function VerifyEmail({ token, onDone }) {
  const [state, setState] = useState({ status: 'checking', message: '' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    verifyEmail(token)
      .then((r) => setState({ status: 'ok', message: r?.email ? `${r.email} is confirmed.` : 'Your email is confirmed.' }))
      .catch((err) => setState({ status: 'failed', message: String(err?.message || 'This link no longer works.') }));
  }, [token]);

  const title = state.status === 'ok' ? 'Email confirmed' : state.status === 'failed' ? 'Link not valid' : 'Confirming your email…';
  const subtitle =
    state.status === 'failed'
      ? `${state.message} Verification links work once; sign in and ask for a new one.`
      : state.message || 'One moment.';

  return (
    <AuthLayout scene="verify" title={title} subtitle={subtitle} onHome={onDone}>
      {state.status === 'checking' ? null : (
        <button type="button" className="ui-btn ui-btn-brand ui-btn-lg w-full" onClick={onDone}>
          Continue to CLOR <ArrowRight size={16} aria-hidden="true" />
        </button>
      )}
    </AuthLayout>
  );
}
