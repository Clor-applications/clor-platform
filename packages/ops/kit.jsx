import React, { useEffect, useId, useRef, useState } from 'react';

import { WsDrawer } from '../../apps/admin/src/screens/wsKit';
import Modal from '@ui/components/ui/Modal';
import { enumWords, errorWords } from '@ui/utils/errorWords';
import { Button } from '@ui/components/ui/Primitives';

export { errorWords };

/* A subscription's status in the console's words ("Overdue" for past_due, as on Accounts). */
const SUB_WORD = { active: 'Active', trialing: 'Trial', past_due: 'Overdue', overdue: 'Overdue', paused: 'Paused', cancelled: 'Cancelled', canceled: 'Cancelled' };
export const subWord = (status) => SUB_WORD[String(status || '').toLowerCase()] || enumWords(status);

/**
 * Small pieces every operator screen shares: dates in Indian English, the
 * role names staff read, a plain error line, tabs, and the one way any change
 * is confirmed — a dialog (a side panel when it carries fields) that says what will happen and asks why.
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

/* Each refusal reason in a few words, for tiles, filters and table cells (Access refused). */
export const REASON_SHORT = {
  APP_NOT_SUBSCRIBED: 'App not on their plan',
  SUBSCRIPTION_LAPSED: 'Subscription lapsed',
  NO_ROLE_GRANT: 'Role does not allow it',
  NO_MEMBERSHIP: 'Not a member of the company',
  MODULE_OFF: 'Feature switched off',
  TEAM_SCOPED: 'Own team only',
  APP_NOT_IN_ENGAGEMENT: 'Outside accountant, app not covered',
  SUPPORT_GRANT_CLOSED: 'CLOR support access ended',
  OPERATOR_ONLY: 'Not CLOR staff',
  COMPANY_ARCHIVED: 'Company archived',
  USER_LIMIT: 'User limit reached',
};
export const reasonShort = (code) => REASON_SHORT[code] || String(code || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** A count line that drops zero clauses: countLine([[3, 'open'], [0, 'urgent']]) → "3 open". `empty` when every clause is zero. */
export const countLine = (parts, empty = null, sep = ' · ') => {
  const kept = parts.filter(([n]) => Number(n) > 0).map(([n, words]) => (typeof words === 'function' ? words(n) : `${Number(n).toLocaleString('en-IN')} ${words}`));
  return kept.length ? kept.join(sep) : empty;
};

/* What each refusal reason code means (Access refused; server: services/ops/denials.ts). */
export const REASON = {
  APP_NOT_SUBSCRIBED: 'The app is not on the account’s subscription. An upsell signal.',
  SUBSCRIPTION_LAPSED: 'The account owns the app, but the subscription has lapsed.',
  NO_ROLE_GRANT: 'The person’s role in that company does not allow it.',
  NO_MEMBERSHIP: 'The person is not a member of that company or branch.',
  MODULE_OFF: 'The feature is switched off for the company or the account.',
  TEAM_SCOPED: 'The person sees only their own team.',
  APP_NOT_IN_ENGAGEMENT: 'An outside accountant whose engagement does not cover the app.',
  SUPPORT_GRANT_CLOSED: 'CLOR support access ended.',
  OPERATOR_ONLY: 'Someone who is not CLOR staff asked for the staff console.',
  COMPANY_ARCHIVED: 'The company is archived, so it is read-only.',
  USER_LIMIT: 'The account is at its user limit.',
};

/** An error line. With `onRetry` (a load that failed) it carries a Try again button, so a failure never looks like an empty list. */
export const Err = ({ children, onRetry = null }) => {
  if (!children) return null;
  if (!onRetry) return <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{children}</p>;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <p className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{children}</p>
      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={onRetry}>Try again</button>
    </div>
  );
};
export const Loading = ({ label = 'Loading…' }) => <p className="ws-card-blurb" role="status" aria-live="polite">{label}</p>;

/** Tell the console a change was made, so the menu counts (open tickets, approvals waiting) are read again. */
export const countsChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ops:changed'));
};

/**
 * While a request runs, its dialog stays open: Escape and the close button do nothing until it answers,
 * so nobody closes a confirm believing they stopped a change that is still going through.
 * Render it inside the dialog: a child's effect runs before its parent's, so this listener is in place
 * before the dialog's own and can stop the key first.
 */
export function HoldOpen({ active }) {
  const on = useRef(active);
  const mark = useRef(null);
  useEffect(() => { on.current = active; }, [active]);
  useEffect(() => {
    const stop = (e) => { e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault(); };
    /* Only this dialog's own keys and close button: the authenticator code prompt raised on top
       of it during the request keeps its Escape. */
    const mine = (target) => {
      const box = mark.current?.closest?.('[role="dialog"]');
      return Boolean(box) && (box.contains(target) || target === document.body || target === document.documentElement);
    };
    const key = (e) => { if (on.current && e.key === 'Escape' && mine(e.target)) stop(e); };
    const click = (e) => {
      if (!on.current) return;
      const b = e.target?.closest?.('button[aria-label="Close"]');
      if (b && mine(b)) stop(e);
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('click', click, true);
    };
  }, []);
  return <span ref={mark} hidden />;
}

/**
 * Every problem with a form at once, above its fields. It takes the focus when it appears, so the
 * keyboard and a screen reader land on it; each line names the field. `errors`: { field: message }.
 */
export function ErrorSummary({ errors, label = 'Fix these first' }) {
  const box = useRef(null);
  const list = Object.entries(errors || {}).filter(([, m]) => m);
  const sig = list.map(([k, m]) => `${k}:${m}`).join('|');
  useEffect(() => {
    if (sig) box.current?.focus();
  }, [sig]);
  if (!list.length) return null;
  return (
    <div ref={box} tabIndex={-1} role="alert" className="ws-notice" style={{ color: 'rgb(var(--ws-danger))' }}>
      <p className="text-sm font-semibold">{label}</p>
      <ul className="text-sm" style={{ listStyle: 'disc', paddingInlineStart: 18 }}>
        {list.map(([k, m]) => <li key={k}>{m}</li>)}
      </ul>
    </div>
  );
}

/** The props that tie a field to its error line: aria-invalid and aria-describedby. */
export const fieldErr = (errors, key, idBase = 'f') => (errors?.[key] ? { 'aria-invalid': true, 'aria-describedby': `${idBase}-${key}-err` } : {});
/** The error line under a field, with the id fieldErr points at. */
export const FieldMsg = ({ errors, k, idBase = 'f' }) =>
  errors?.[k] ? <span id={`${idBase}-${k}-err`} className="text-xs" style={{ color: 'rgb(var(--ws-danger))' }}>{errors[k]}</span> : null;

/**
 * A busy flag per row (Withdraw, Close, Take over): only the row being worked on is disabled,
 * and the same row cannot be sent twice. `run(id, fn)` returns fn's result; `busy(id)` is true while it runs.
 */
export function useRowBusy() {
  const [rows, setRows] = useState(() => new Set());
  const live = useRef(new Set());
  const run = async (id, fn) => {
    if (live.current.has(id)) return undefined;
    live.current.add(id);
    setRows(new Set(live.current));
    try {
      return await fn();
    } finally {
      live.current.delete(id);
      setRows(new Set(live.current));
    }
  };
  return { busy: (id) => rows.has(id), run };
}
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
 * `what` says the consequence in full: the amount, the customer, how many, live or test.
 * `dirty`: fields of its own hold edits, so closing asks first.
 */
export function ReasonDrawer({ open, title, what, confirmLabel, cancelLabel = 'Cancel', tone = 'primary', onClose, onConfirm, children, ready = true, reasonOptional = false, dirty = false, modal = !children, wide = false }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const hintId = useId();
  useEffect(() => {
    if (open) {
      setReason('');
      setError('');
      setTried(false);
    }
  }, [open]);
  const okReason = reasonOptional || reason.trim().length >= 3;
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!okReason) {
      setTried(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
      countsChanged();
    } catch (err) {
      setError(errorWords(err, 'make the change'));
    } finally {
      setBusy(false);
    }
  };
  /* Cancel, Escape and the close button wait while the request runs (HoldOpen). */
  const close = () => { if (!busy) onClose?.(); };
  const actions = (
    <>
      <button type="button" className="ws-btn ws-btn--quiet" onClick={close} disabled={busy}>{cancelLabel}</button>
      <Button plain className={tone === 'danger' ? 'ws-btn ws-btn--danger' : 'ws-btn ws-btn--primary'} loading={busy} disabled={!okReason || !ready} type="submit" form="ops-reason">
        {confirmLabel}
      </Button>
    </>
  );
  const hintBad = tried && !okReason;
  const form = (
      <form id="ops-reason" className="grid gap-5" onSubmit={submit}>
        <HoldOpen active={busy} />
        {what ? <p className="ws-notice">{what}</p> : null}
        {children}
        <div className="grid gap-1">
          <label htmlFor={`${hintId}-why`} className="text-sm font-semibold">Why</label>
          <textarea
            id={`${hintId}-why`}
            className="ui-input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => reason && setTried(true)}
            placeholder="One sentence, for the Staff audit log"
            aria-describedby={hintId}
            aria-invalid={hintBad || undefined}
          />
          <span id={hintId} className="text-xs" style={{ color: hintBad ? 'rgb(var(--ws-danger))' : 'rgb(var(--fg-muted))' }}>
            {reasonOptional ? 'Optional' : 'Reason required (3+ characters)'}
          </span>
        </div>
        <p className="ws-card-blurb">You will be asked for a code from your authenticator app. The change goes in the Staff audit log{reasonOptional ? '' : ' with your reason'}.</p>
        <Err>{error}</Err>
      </form>
  );
  /* A confirmation is a 420px dialog (DESIGN.md "Dialogs"); only one that carries fields of its own
     (children: a date, an amount, a choice) keeps the side panel, where a form belongs. `modal` keeps
     a confirmation that only shows things (a list of price changes) a dialog; `wide` gives it room. */
  if (modal) {
    return open ? (
      <Modal title={title} onClose={close} showCloseIcon={!busy} busy={busy} dirty={dirty} maxWidthClass={wide ? 'max-w-[640px]' : 'max-w-[420px]'} footer={<div className="flex justify-end gap-2">{actions}</div>}>
        {form}
      </Modal>
    ) : null;
  }
  return (
    <WsDrawer open={open} onClose={close} title={title} actions={actions} dirty={busy || dirty}>
      {form}
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
