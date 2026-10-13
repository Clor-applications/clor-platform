import React from 'react';

import { usePermissions } from './usePermissions';

/**
 * Telling somebody they cannot do a thing *before* they do it.
 *
 * The server enforces a hundred and nine permission checks across create,
 * edit, delete, export and approve. The interface checked none of them — it
 * only ever asked about VIEW, and only to decide what appears in the sidebar.
 *
 * So a user without SALES::Invoices::CREATE saw the New Invoice button, opened
 * the form, chose a customer, entered six lines, pressed Create, and was
 * refused. The work was real; the permission to keep it never existed.
 *
 * The rule this file settles, because it was never decided:
 *
 *   VIEW      → hide. A screen you cannot open should not be in the rail; the
 *               nav already does this.
 *   Everything else → show it, disable it, and say what is missing.
 *
 * Hiding an action teaches nothing. The user cannot tell a missing feature
 * from a withheld one, and their admin cannot be asked for something nobody
 * can name. A disabled button that reads "You need Sales · Invoices · Create"
 * turns a dead end into a sentence somebody can forward.
 */

/** "SALES::Invoices::CREATE" → "Sales · Invoices · Create" */
export const describePermission = (key) => {
  const parts = String(key || '').split('::');
  if (parts.length !== 3) return String(key || '');
  const title = (t) =>
    String(t)
      .toLowerCase()
      .replace(/(^|[\s/&-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  return `${title(parts[0])} · ${parts[1]} · ${title(parts[2])}`;
};

/**
 * Wrap an action in the permission it needs.
 *
 * Renders `children(allowed, reason)`. The caller decides how to express it —
 * a button takes `disabled`, a menu item may prefer to dim — but the reason
 * text is written once, here, so every refusal in the product says the same
 * kind of thing.
 */
export const ActionGuard = ({ permission, children }) => {
  const { can, loading, permissions, error } = usePermissions();

  /**
   * Fails open, deliberately.
   *
   * An empty permission set means "we do not know", not "you may do nothing".
   * It happens while the request is in flight, when the endpoint errors, and
   * in deployments where the permission service is not wired up at all.
   *
   * Failing open here is safe because this guard is a courtesy, not the
   * enforcement. The server holds a hundred and nine route checks and never
   * fails open. The worst case of guessing "allowed" wrongly is the behaviour
   * that shipped before this file existed: the user tries, and the server
   * refuses. The worst case of guessing "denied" wrongly is a locked-out
   * customer who cannot invoice.
   */
  const known = !loading && !error && permissions && permissions.size > 0;
  const allowed = !permission || !known || can(permission);
  const reason = allowed ? '' : `You need ${describePermission(permission)} to do this. Ask an administrator.`;
  return children(allowed, reason);
};

/**
 * The common case: a button that refuses politely.
 *
 * `title` carries the reason so it survives hover and screen readers, and
 * aria-disabled marks it without removing it from the tab order — a control
 * you cannot reach is a control you cannot ask about.
 */
export const PermissionButton = ({ permission, className = '', children, onClick, ...rest }) => (
  <ActionGuard permission={permission}>
    {(allowed, reason) => (
      <button
        type="button"
        {...rest}
        onClick={allowed ? onClick : undefined}
        aria-disabled={allowed ? undefined : true}
        title={allowed ? rest.title : reason}
        className={`${className}${allowed ? '' : ' ui-not-allowed'}`}
      >
        {children}
      </button>
    )}
  </ActionGuard>
);

export default ActionGuard;
