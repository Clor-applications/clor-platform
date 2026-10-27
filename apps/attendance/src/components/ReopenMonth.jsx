import React, { useState } from 'react';

import Modal from '@ui/components/ui/Modal';
import { notify } from '@ui/components/ui/notify';
import { reopenMonth } from '../api/attendance';

/**
 * Reopening a closed month says why: the reason goes in the audit log beside
 * who closed it and when (server: routes/attendance.ts months/:month/reopen).
 */
export default function ReopenMonth({ month, label, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = reason.trim().length >= 5;
  const save = async (e) => {
    e?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      await reopenMonth(month, reason.trim());
      notify.success(`${label || month} reopened.`);
      onDone();
    } catch (err) {
      notify.error(String(err?.message || 'Not reopened.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Reopen ${label || month}?`}
      maxWidthClass="max-w-md"
      onClose={onClose}
      dirty={Boolean(reason.trim())}
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="reopen-month" className="ui-btn ui-btn-primary" disabled={!ready || busy}>{busy ? 'Reopening…' : 'Reopen'}</button>
      </>}
    >
      <form id="reopen-month" onSubmit={save} className="space-y-3">
        <p className="text-sm">Its days can change again. Payroll already run from it is not changed; closing again keeps a new snapshot.</p>
        <label className="block">
          <span className="ui-label">Why *</span>
          <textarea className="ui-input w-full" rows={3} maxLength={300} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) save(e); }} />
          <span className="ui-caption">Goes in the audit log with your name.</span>
        </label>
      </form>
    </Modal>
  );
}
