import React, { useEffect, useState } from 'react';

import { WsDrawer } from '../../apps/admin/src/screens/wsKit';

/**
 * Small pieces every operator screen shares: dates in Indian English, the
 * role names staff read, a plain error line, tabs, and the one way any change
 * is confirmed — a side panel that says what will happen and asks why.
 */

/* Staff roles as the console names them; the codes are the server's (middleware/operator.ts). */
export const ROLE = { SUPER_ADMIN: 'Owner', SALES: 'Sales', SUPPORT: 'Support', BILLING: 'Finance', READ_ONLY: 'Read-only' };
export const ROLE_ORDER = ['SUPER_ADMIN', 'SALES', 'SUPPORT', 'BILLING', 'READ_ONLY'];
export const ROLE_CAN = {
  SUPER_ADMIN: 'Everything, and the only one who manages staff, email wording and addresses, and the app catalogue.',
  SALES: 'Demo requests, Explore links, extending trials and making an account from a demo request.',
  SUPPORT: 'A customer’s users (reset links, invitations, signing out), suspending and resuming, demo requests, Explore links, resending email.',
  BILLING: 'Plans and apps, trials, cancelling, suspending and resuming, pricing, payments and tax.',
  READ_ONLY: 'Sees what the others see. Changes nothing.',
};
/** May this role do something open to these roles? The owner may do everything. */
export const may = (role, ...roles) => role === 'SUPER_ADMIN' || roles.includes(role);

export const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

/* clor.in's names for the apps a plan carries. */
export const APP_NAMES = { accounting: 'Books', payroll: 'Payroll', people: 'People', attendance: 'Attendance', projects: 'Projects' };
export const SELLABLE = ['accounting', 'people', 'attendance', 'payroll'];
/** App names in words. People carries Attendance, so a plan with People reads "People (with Attendance)" and Attendance is not listed twice. */
export const appsText = (codes = []) => {
  if (!codes.length) return '—';
  const people = codes.includes('people');
  return codes
    .filter((c) => !(people && c === 'attendance'))
    .map((c) => (c === 'people' ? 'People (with Attendance)' : APP_NAMES[c] || c))
    .join(', ');
};

export const Err = ({ children }) => (children ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{children}</p> : null);
export const Loading = () => <p className="ws-card-blurb">Loading…</p>;
export const Empty = ({ children }) => (
  <div className="ws-empty">
    <p>{children}</p>
  </div>
);

/** A row of tabs; the panel underneath is the caller's. */
export function Tabs({ label, tabs, value, onChange }) {
  return (
    <div className="ws-tabs" role="tablist" aria-label={label}>
      {tabs.map(([k, name]) => (
        <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={value === k} className="ws-tab" onClick={() => onChange(k)}>
          {name}
        </button>
      ))}
    </div>
  );
}

/**
 * Confirm a change: what will happen, a reason for the record, and the
 * button. The server asks for an authenticator code on the way (step-up).
 * `onConfirm(reason)` does the work; a thrown error is shown in the panel.
 */
export function ReasonDrawer({ open, title, what, confirmLabel, tone = 'primary', onClose, onConfirm, children, ready = true, reasonOptional = false }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setReason('');
      setError('');
    }
  }, [open]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };
  const okReason = reasonOptional || reason.trim().length >= 3;
  return (
    <WsDrawer
      open={open}
      onClose={onClose}
      title={title}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" form="ops-reason" className={tone === 'danger' ? 'ws-btn ws-btn--danger' : 'ws-btn ws-btn--primary'} disabled={busy || !okReason || !ready}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <form id="ops-reason" className="grid gap-5" onSubmit={submit}>
        {what ? <p className="ws-notice">{what}</p> : null}
        {children}
        <label className="grid gap-1">
          <span className="text-sm font-medium">Why</span>
          <textarea className="ui-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One sentence, for the audit log" />
        </label>
        <p className="ws-card-blurb">You will be asked for a code from your authenticator app. The change goes in the audit log{reasonOptional ? '' : ' with your reason'}.</p>
        <Err>{error}</Err>
      </form>
    </WsDrawer>
  );
}

/** Previous / Next under a long list. */
export function Pager({ page, pages, hasMore, onPage }) {
  const more = hasMore ?? page + 1 < pages;
  if (page === 0 && !more) return null;
  return (
    <nav className="flex items-center gap-2" aria-label="Pages">
      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button>
      {pages ? <span className="ws-head-meta">Page {page + 1} of {pages}</span> : null}
      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={!more} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  );
}
