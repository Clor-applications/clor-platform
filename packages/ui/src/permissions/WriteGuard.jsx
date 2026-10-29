import React, { useCallback, useMemo } from 'react';
import { Lock } from '@ui/components/ui/lineIcons';

import { notify } from '../components/ui/notify';
import { usePermissions } from './usePermissions';
import { describePermission } from './ActionGuard';

/**
 * A screen-wide write guard, driven by the app manifest.
 *
 * Every screen in the shell's menu names the permission its data needs
 * (`MODULE::Resource::VIEW`). This takes the same resource and asks whether
 * the person may change anything on it (EDIT, CREATE, DELETE, APPROVE). If
 * not, the screen is shown read-only: a banner says so once, in the same
 * words every refusal uses, and clicks on the controls that would change
 * something (primary and danger buttons, form submits, anything marked
 * data-write) are stopped with that reason instead of a round trip ending in
 * a 403.
 *
 * Fails open like ActionGuard: an unknown permission set is "we do not know",
 * not "you may do nothing". The server is the enforcement; this is courtesy
 * and consistency across the four apps.
 */
export const WRITE_ACTIONS = ['EDIT', 'CREATE', 'DELETE', 'APPROVE'];

const WRITE_SELECTOR = 'button.ui-btn-primary, button.ui-btn-danger, button[type="submit"], [data-write], .ui-btn-danger, input[type="submit"]';
/** A decision, not an edit: needs APPROVE on the screen's resource (or the control's own data-permission). */
const DECISION = /^(approve|reject|decline|sign off)\b/i;
const decisionText = (el) => String(el.getAttribute('aria-label') || el.textContent || '').trim();

/** The write permissions behind a VIEW permission, or [] when the key is not of that shape. */
export const writeKeysOf = (viewPermission) => {
  const m = /^([^:]+)::([^:]*)::VIEW$/.exec(String(viewPermission || ''));
  if (!m) return [];
  return WRITE_ACTIONS.map((a) => `${m[1]}::${m[2]}::${a}`);
};

/**
 * The thing a VIEW permission is about, as a person reads it:
 * "ATTENDANCE::My Attendance::VIEW" is "My attendance (Attendance)". Not an
 * action: resources differ in which write rights they have (My attendance has
 * Create and no Edit), and naming one it does not have sent people to ask for a
 * right no administrator can give (People audit, 30 Oct 2026).
 */
export const resourceWords = (viewPermission) => {
  const m = /^([^:]+)::([^:]*)::VIEW$/.exec(String(viewPermission || ''));
  if (!m) return '';
  const word = (w, i) => (i === 0 || /^[A-Z0-9&-]{2,}$/.test(w) ? w : w.toLowerCase());
  const thing = m[2].split(' ').map(word).join(' ');
  const app = m[1].charAt(0) + m[1].slice(1).toLowerCase();
  return `${thing} (${app})`;
};

/** Whether this screen is read-only for the person, given what the shell knows. */
export const readOnlyFor = (viewPermission, { permissions, loading, error, isAdmin }) => {
  const keys = writeKeysOf(viewPermission);
  if (!keys.length || isAdmin) return false;
  const known = !loading && !error && permissions && permissions.size > 0;
  if (!known) return false;
  return !keys.some((k) => permissions.has(k));
};

export const WriteGuard = ({ permission, children }) => {
  const perms = usePermissions();
  const readOnly = useMemo(() => readOnlyFor(permission, perms), [permission, perms]);
  const known = !perms.loading && !perms.error && perms.permissions && perms.permissions.size > 0 && !perms.isAdmin;
  const approveKey = useMemo(() => writeKeysOf(permission).find((k) => k.endsWith('::APPROVE')) || null, [permission]);
  const reason = useMemo(() => {
    const what = writeKeysOf(permission).length ? resourceWords(permission) : '';
    return what ? `View only: your roles let you see ${what} but not change it. Ask an administrator for a role that can.` : '';
  }, [permission]);

  /* Capture phase, so the screen's own handler never runs. Links and plain navigation are untouched. */
  const stop = useCallback(
    (e) => {
      /* Approve / reject: allowed only with APPROVE, whatever else the person may change here. */
      const btn = known ? e.target?.closest?.('button, [role="button"]') : null;
      if (btn && DECISION.test(decisionText(btn)) && !btn.closest('[data-write-allowed]')) {
        const need = btn.getAttribute('data-permission') || approveKey;
        if (need && !perms.permissions.has(need)) {
          e.preventDefault();
          e.stopPropagation();
          notify.error(`You need ${describePermission(need)} to do this. Ask an administrator.`);
          return;
        }
      }
      if (!readOnly) return;
      const el = e.target?.closest?.(WRITE_SELECTOR);
      if (!el || el.closest('[data-write-allowed]')) return;
      e.preventDefault();
      e.stopPropagation();
      notify.error(reason);
    },
    [readOnly, reason, known, approveKey, perms.permissions],
  );

  if (!readOnly) return known && approveKey ? <div style={{ display: 'contents' }} onClickCapture={stop}>{children}</div> : children;
  return (
    <div data-readonly="true" onClickCapture={stop} onSubmitCapture={stop}>
      <div className="ui-card mb-4 flex items-start gap-3 p-3 text-sm" role="status" style={{ borderColor: 'rgb(var(--warn, 234 88 12))' }}>
        <Lock size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>{reason}</span>
      </div>
      {children}
    </div>
  );
};

export default WriteGuard;
