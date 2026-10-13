import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PermissionContext } from './context';
import { usePermissions } from './usePermissions';
import { getMyPermissions } from '../api/permissions';

/**
 * Holds the signed-in user's effective permissions for the active org/branch.
 *
 * The server is always the authority: every route re-checks on each request.
 * This exists so the UI does not offer actions that will only fail with a 403.
 */
export const PermissionProvider = ({ children, enabled = true, reloadKey = 0 }) => {
  const [state, setState] = useState({
    loading: enabled,
    error: '',
    permissions: new Set(),
    roles: [],
    isAdmin: false,
    ownDocumentsOnly: false,
    restrictions: { branchIds: [], warehouseIds: [] },
  });

  const load = useCallback(() => {
    if (!enabled) return;
    // Deferred deliberately: getMyPermissions() throws synchronously when there
    // is no active org, and a synchronous setState from an effect cascades an
    // extra render. Starting from a resolved promise keeps both paths async.
    Promise.resolve()
      .then(getMyPermissions)
      .then((data) =>
        setState({
          loading: false,
          error: '',
          permissions: new Set(Array.isArray(data?.permissions) ? data.permissions : []),
          roles: Array.isArray(data?.roles) ? data.roles : [],
          // Holds an ADMIN-type role. Only an administrator may create or
          // hand out Administrator roles; the server refuses everyone else.
          isAdmin: Boolean(data?.isAdmin),
          // The server only returns documents this user created.
          ownDocumentsOnly: Boolean(data?.ownDocumentsOnly),
          restrictions: data?.restrictions || { branchIds: [], warehouseIds: [] },
        })
      )
      .catch((e) =>
        setState({
          loading: false,
          error: String(e?.message || e),
          permissions: new Set(),
          roles: [],
          isAdmin: false,
          ownDocumentsOnly: false,
          restrictions: { branchIds: [], warehouseIds: [] },
        })
      );
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const value = useMemo(() => {
    // With no session there is nothing to fetch, so never report "loading":
    // consumers would hide every gated element forever.
    const resolved = enabled ? state : { ...state, loading: false };
    const { permissions } = resolved;

    // Keys are "MODULE::Resource::ACTION".
    const can = (key) => permissions.has(String(key || ''));
    const canAny = (keys) => (Array.isArray(keys) ? keys : [keys]).some((k) => permissions.has(String(k)));
    // Any permission inside a module is enough to show its navigation entry.
    const canModule = (moduleKey) => {
      const prefix = `${moduleKey}::`;
      for (const p of permissions) if (p.startsWith(prefix)) return true;
      return false;
    };

    return { ...resolved, can, canAny, canModule, reload: load };
  }, [state, load, enabled]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
};

/**
 * Renders children only when the permission is held.
 *
 *   <Can permission="SALES::Invoices::CREATE"><NewInvoiceButton /></Can>
 *   <Can anyOf={['A::B::VIEW', 'A::C::VIEW']} fallback={<NoAccess />}>…</Can>
 */
export const Can = ({ permission, anyOf, children, fallback = null }) => {
  const { can, canAny, loading } = usePermissions();
  if (loading) return null;
  const allowed = anyOf ? canAny(anyOf) : can(permission);
  return allowed ? <>{children}</> : fallback;
};
