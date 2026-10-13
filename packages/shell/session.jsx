import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { setPlatformContext } from '@platform/context';
import {
  APP_FEATURE,
  appsFromFeatures,
  billingFor,
  featuresFor,
  login as apiLogin,
  logout as apiLogout,
  me as apiMe,
  setFeature,
  setupCompany,
  signup as apiSignup,
  visibleApps,
} from '@platform/auth';

/**
 * Who is signed in, which company they are looking at, and which apps that
 * company has.
 *
 * All three belong to the shell, not to any app. That is the load-bearing
 * decision in this whole structure: identity used to live inside Accounting,
 * which meant a company that bought only Payroll still needed an accounting
 * database in order to log in. Here an app is handed a company and a user and
 * never asks where they came from.
 *
 * The access token lives in localStorage because the transport reads it from
 * there; the refresh token does not, and cannot — it is an HttpOnly cookie the
 * server sets, which is what stops a script on the page from stealing a
 * long-lived credential.
 */

const SessionContext = createContext(null);

const TOKEN_KEY = 'token';

const readToken = () => {
  try {
    return String(localStorage.getItem(TOKEN_KEY) || '').trim();
  } catch {
    return '';
  }
};

const writeToken = (token) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* A browser refusing storage can still hold a session for this tab. */
  }
};

/** The org records the platform API returns, as the shell wants them. */
const toTenant = (membership) => ({
  id: String(membership.orgId || membership.org?.id || ''),
  name: String(membership.org?.name || membership.name || 'Company'),
  accountId: membership.accountId || null,
  /* Every tenant-scoped route wants a branch as well as a company, and the
     route that lists branches wants one too — so the platform answers it. */
  branchId: membership.branchId || null,
  profile: membership.org?.profile || {},
  /* Filled in per company, on demand: one features call each, and only for the
     company actually being looked at. */
  subscriptions: null,
  /* The subscription as the server reports it; null until asked, or when the
     answer could not be had (which restricts nothing). */
  billing: null,
});

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState('');
  /* True until the token in this browser has been checked against the server.
     Rendering the public page first would flash it at somebody already signed
     in, on every reload. */
  const [restoring, setRestoring] = useState(() => Boolean(readToken()));

  const tenant = useMemo(
    () => tenants.find((t) => t.id === tenantId) || tenants[0] || null,
    [tenants, tenantId]
  );

  /*
   * Published during render, not from an effect.
   *
   * An app mounts with its children before this component's effects run, so an
   * effect here would hand over the company one render too late — and an app
   * that reads it in the meantime opens the wrong book. The call is
   * idempotent, which is what makes it safe to make during render.
   */
  setPlatformContext({
    user,
    orgId: user && tenant ? tenant.id : '',
    branchId: user && tenant ? tenant.branchId || '' : '',
  });

  /** Which apps a company has, asked once per company and then remembered. */
  const loadApps = useCallback(async (orgId, branchId) => {
    if (!orgId) return;
    try {
      /* Billing is asked alongside, and allowed to fail: an older server, or a
         hiccup, must not cost a company the apps it already uses. */
      const [{ features }, billing] = await Promise.all([
        featuresFor(orgId, branchId),
        billingFor(orgId, branchId).catch(() => null),
      ]);
      const apps = visibleApps(appsFromFeatures(features), billing);
      setTenants((list) => list.map((t) => (t.id === orgId ? { ...t, subscriptions: apps, billing } : t)));
    } catch {
      /* A company whose features cannot be read still has its books. */
      setTenants((list) =>
        list.map((t) => (t.id === orgId && !t.subscriptions ? { ...t, subscriptions: ['accounting'] } : t))
      );
    }
  }, []);

  const adopt = useCallback((payload) => {
    const list = (payload?.orgs || []).map(toTenant).filter((t) => t.id);
    setTenants(list);
    setUser(payload?.user || null);
    const wanted = String(payload?.activeOrgId || '').trim();
    const chosen = list.find((t) => t.id === wanted) || list[0] || null;
    setTenantId(chosen?.id || '');
    return chosen;
  }, []);

  /* A token in the browser is a claim, not a session: the server decides. */
  useEffect(() => {
    if (!readToken()) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiMe();
        if (cancelled) return;
        const next = adopt(data);
        if (next) loadApps(next.id, next.branchId);
      } catch {
        if (!cancelled) writeToken('');
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt, loadApps]);

  useEffect(() => {
    if (tenant && tenant.subscriptions === null) loadApps(tenant.id, tenant.branchId);
  }, [tenant, loadApps]);

  const signIn = useCallback(
    async ({ email, password }) => {
      const res = await apiLogin({ email, password });
      writeToken(res.token);
      const data = await apiMe();
      const next = adopt({ ...data, activeOrgId: res.activeOrgId });
      if (next) loadApps(next.id, next.branchId);
      return next;
    },
    [adopt, loadApps]
  );

  /**
   * A new account. Only that.
   *
   * It used to create the first company in the same breath, which made a
   * company something an account has one of — and then the wizard on the way
   * in asked for it a second time. An accountant has several companies and a
   * group has one per entity, so the two acts are separate: this one produces
   * somebody who is signed in with no books, which is a real state the shell
   * knows how to draw.
   */
  const signUp = useCallback(
    async ({ fullName, email, password }) => {
      const res = await apiSignup({ email, password, fullName });
      writeToken(res.token);
      const data = await apiMe();
      return adopt(data);
    },
    [adopt]
  );

  /**
   * A company, and the apps it starts with.
   *
   * The same call whether it is the first company on a new account or the
   * fourth on an old one — there is no such thing as a "first company" path,
   * because a second one created down a different route is a second set of
   * defaults to keep in step.
   *
   * The company arrives from the server with a chart of accounts already,
   * which is why Accounting needs no feature switch of its own.
   */
  const createCompany = useCallback(
    async ({ name, gstin, state, apps = [] }) => {
      await setupCompany({
        companyName: name,
        ...(gstin ? { gstin } : {}),
        ...(state ? { state } : {}),
      });

      const data = await apiMe();
      /* The company just created, not whichever one sorts first. */
      const made = (data?.orgs || []).find((m) => String(m.org?.name || '') === String(name));
      const next = adopt({ ...data, activeOrgId: made?.orgId || data?.activeOrgId });

      for (const app of apps) {
        const key = APP_FEATURE[app];
        if (key && next) await setFeature(next.id, next.branchId, key, true);
      }
      if (next) await loadApps(next.id, next.branchId);
      return next;
    },
    [adopt, loadApps]
  );

  const signOut = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      /* Losing the server's goodbye must not trap somebody in a session. */
    }
    writeToken('');
    setUser(null);
    setTenants([]);
    setTenantId('');
  }, []);

  /**
   * Adding an app to this company.
   *
   * It switches the feature on for the company — the same act, through the
   * same route, as an administrator turning it on in Settings. There is no
   * second record of what a company has bought, because a second record is a
   * second answer.
   */
  const addApp = useCallback(
    async (appId) => {
      const key = APP_FEATURE[appId];
      if (!key || !tenant) return;
      await setFeature(tenant.id, tenant.branchId, key, true);
      await loadApps(tenant.id, tenant.branchId);
    },
    [tenant, loadApps]
  );

  const value = useMemo(
    () => ({ user, tenant, tenants, restoring, signIn, signUp, createCompany, signOut, setTenantId, addApp }),
    [user, tenant, tenants, restoring, signIn, signUp, createCompany, signOut, addApp]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
};
