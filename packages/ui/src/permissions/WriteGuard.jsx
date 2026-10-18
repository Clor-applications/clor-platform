import React, { useCallback, useMemo } from 'react';
import { Lock } from 'lucide-react';

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

/** The write permissions behind a VIEW permission, or [] when the key is not of that shape. */
export const writeKeysOf = (viewPermission) => {
  const m = /^([^:]+)::([^:]*)::VIEW$/.exec(String(viewPermission || ''));
  if (!m) return [];
  return WRITE_ACTIONS.map((a) => `${m[1]}::${m[2]}::${a}`);
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
  const reason = useMemo(() => {
    const edit = writeKeysOf(permission)[0];
    return edit ? `View only: you need ${describePermission(edit)} to change anything here. Ask an administrator.` : '';
  }, [permission]);

  /* Capture phase, so the screen's own handler never runs. Links and plain navigation are untouched. */
  const stop = useCallback(
    (e) => {
      if (!readOnly) return;
      const el = e.target?.closest?.(WRITE_SELECTOR);
      if (!el || el.closest('[data-write-allowed]')) return;
      e.preventDefault();
      e.stopPropagation();
      notify.error(reason);
    },
    [readOnly, reason],
  );

  if (!readOnly) return children;
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
