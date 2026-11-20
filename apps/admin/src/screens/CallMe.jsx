import React, { useState } from 'react';
import { Phone } from 'lucide-react';

import { openTicket } from '@platform/admin/account';
import { errorWords } from '@ui/utils/errorWords';

/**
 * Round 35 pick kickoff B (owner, 18 Nov 2026): setting up is helped by a
 * "Call me" button. It opens an ordinary support ticket (server: POST
 * /support/tickets) with the number to ring, so CLOR staff see it in the Ops
 * tickets queue and call within a working day. Shown under the setup steps on
 * Workspace home while setup is not finished.
 */
const MOBILE = /^(?:\+?91)?[6-9]\d{9}$/;
export const phoneOk = (s) => MOBILE.test(String(s || '').replace(/[\s-]/g, ''));

export function callTicket(phone) {
  const n = String(phone).replace(/[\s-]/g, '');
  return {
    subject: 'Please call me about setting up CLOR',
    body: `I would like a call to help set up CLOR. Please call me on ${n}.`,
    category: 'QUESTION',
    app: 'workspace',
    requestId: null,
    urgent: false,
  };
}

export function CallMe() {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');

  if (done) {
    return (
      <p className="ws-call-me-done" role="status">
        Asked as ticket {done}. CLOR will call you within one working day.
      </p>
    );
  }
  if (!open) {
    return (
      <div className="ws-call-me">
        <span className="ui-caption">Stuck on a step?</span>
        <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setOpen(true)}>
          <Phone size={14} aria-hidden="true" /> Call me
        </button>
      </div>
    );
  }
  const send = async (e) => {
    e.preventDefault();
    if (!phoneOk(phone) || busy) return;
    setBusy(true);
    setError('');
    try {
      const t = await openTicket(callTicket(phone));
      setDone(t?.code || 'sent');
    } catch (err) {
      setError(errorWords(err, 'ask for the call'));
      setBusy(false);
    }
  };
  return (
    <form className="ws-call-me" onSubmit={send}>
      <label className="grid">
        <span className="ui-caption">Mobile number to call</span>
        <input className="ui-input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98450 12345" />
      </label>
      <button type="submit" className="ws-btn ws-btn--quiet ws-btn--small" disabled={!phoneOk(phone) || busy}>
        {busy ? 'Sending…' : 'Ask for a call'}
      </button>
      <button type="button" className="ws-link" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error ? <p role="alert" className="ui-caption ws-call-me-err">{error}</p> : null}
    </form>
  );
}
