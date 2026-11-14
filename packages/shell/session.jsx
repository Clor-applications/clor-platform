import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { SWITCH_COMPANY_EVENT, setPlatformContext } from '@platform/context';
import {
  APP_FEATURE,
  appsFromFeatures,
  billingFor,
  featuresFor,
  login as apiLogin,
  loginTwoFactor as apiLoginTwoFactor,
  logout as apiLogout,
  me as apiMe,
  setFeature,
  setupCompany,
  signup as apiSignup,
  visibleApps,
} from '@platform/auth';

import { appFromHost } from './appHosts';
import { chooseTenant, codeNames, lastUsedKey, orgCodeFromPath, tabChoiceKey, withOrgPath } from './orgUrl';
import { isExplorePath } from './exploreLink';

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

/* Explore (the read-only sample company): this tab's session came from an Explore link, so its end is "This link has ended", not the sign-in page. */
const EXPLORE_KEY = 'clor.explore';
const markExplore = (on) => {
  try {
    if (on) sessionStorage.setItem(EXPLORE_KEY, '1');
    else sessionStorage.removeItem(EXPLORE_KEY);
  } catch {
    /* storage unavailable: the sign-in page shows instead */
  }
};
const wasExplore = () => {
  try {
    return sessionStorage.getItem(EXPLORE_KEY) === '1';
  } catch {
    return false;
  }
};

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
  /* The company's own code (4831920657): what the address carries (A-26). */
  code: membership.org?.code || membership.code || null,
  /* The code it had before the numbers (KAVE-C100): old links still find it. */
  legacyCode: membership.org?.legacyCode || null,
  /* Archived (read-only): listed apart in the picker, with a banner inside. */
  archivedAt: membership.org?.archivedAt || null,
  /* CLOR staff on a support grant: { scope, expiresAt }. Shown so they always know whose company this is; the server enforces it. */
  supportGrant: membership.supportGrant || null,
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

/*
 * The branch and warehouse chosen in each company are kept per company
 * (`clor.sel.<org>.<what>`, platform/context.js), not per person. Signing in
 * or out forgets them, so the next person on this browser does not send the
 * last person's branch and meet "No access to branch".
 */
const forgetSelections = () => {
  for (const store of [localStorage, sessionStorage]) {
    try {
      for (const key of Object.keys(store)) if (key.startsWith('clor.sel.')) store.removeItem(key);
    } catch {
      /* storage unavailable: nothing was kept */
    }
  }
};

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenants, setTenants] = useState([]);
  /* W-2.1: the accounts this person reaches (home first), with their account role in each. */
  const [accounts, setAccounts] = useState([]);
  const [tenantId, setTenantIdState] = useState('');
  /* A company code from the address that is not one of this person's (A-26): "no access", never another company. */
  const [deniedCode, setDeniedCode] = useState('');
  const setTenantId = useCallback((id) => {
    setTenantIdState(id);
    setDeniedCode('');
    // Remembered twice: for this tab (sessionStorage, so another tab switching
    // company does not move this one) and as this browser's last-used company
    // (a new tab with no address). Scoped to the signed-in user and checked
    // against current memberships again on restore. Neither grants access.
    try { if (user?.id && id) sessionStorage.setItem(tabChoiceKey(user.id), id); } catch { /* storage unavailable */ }
    try { if (user?.id && id) localStorage.setItem(lastUsedKey(user.id), id); } catch { /* storage unavailable */ }
  }, [user?.id]);
  /* A company here requires an authenticator of this owner or admin, who has none yet (SX-09). */
  const [twoFactorSetupRequired, setTwoFactorSetupRequired] = useState(false);
  /* Explore: { daysLeft, expiresAt, app } while this is the sample company's read-only session; null otherwise. */
  const [explore, setExplore] = useState(null);
  /* An Explore session ran out or was ended: the shell says so instead of offering a sign-in. */
  const [exploreEnded, setExploreEnded] = useState(false);
  /* True until the token in this browser has been checked against the server.
     Rendering the public page first would flash it at somebody already signed
     in, on every reload. */
  const [restoring, setRestoring] = useState(() => Boolean(readToken()) || Boolean(appFromHost()));

  /* No silent fallback to the first company while the address names one this person cannot open (A-26). */
  const tenant = useMemo(
    () => (deniedCode ? null : tenants.find((t) => t.id === tenantId) || tenants[0] || null),
    [tenants, tenantId, deniedCode]
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
    apps: user && tenant ? tenant.subscriptions || [] : [],
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
      /* The switches too: the shell hides a module the company switched off (nav items carry `feature`). */
      setTenants((list) => list.map((t) => (t.id === orgId ? { ...t, subscriptions: apps, billing, features } : t)));
    } catch {
      /* A company whose features cannot be read still has its books. */
      setTenants((list) =>
        list.map((t) => (t.id === orgId && !t.subscriptions ? { ...t, subscriptions: ['accounting'] } : t))
      );
    }
  }, []);

  const adopt = useCallback((payload, preferRequested = false) => {
    const list = (payload?.orgs || []).map(toTenant).filter((t) => t.id);
    setTenants(list);
    setAccounts(Array.isArray(payload?.accounts) ? payload.accounts : []);
    setUser(payload?.user || null);
    setTwoFactorSetupRequired(Boolean(payload?.twoFactorSetupRequired));
    setExplore(payload?.explore || null);
    markExplore(Boolean(payload?.explore));
    const userId = payload?.user?.id;
    const read = (store, key) => {
      try { return String(store.getItem(key) || ''); } catch { return ''; }
    };
    /* The address, this tab, this browser, the server — in that order (A-26). */
    const { tenant: chosen, denied } = chooseTenant({
      tenants: list,
      urlCode: typeof window === 'undefined' ? '' : orgCodeFromPath(window.location.pathname),
      tabChoice: userId ? read(sessionStorage, tabChoiceKey(userId)) : '',
      lastUsed: userId ? read(localStorage, lastUsedKey(userId)) : '',
      suggested: String(payload?.activeOrgId || '').trim(),
      preferSuggested: preferRequested,
    });
    setTenantIdState(chosen?.id || '');
    setDeniedCode(denied);
    if (chosen && userId) {
      try { sessionStorage.setItem(tabChoiceKey(userId), chosen.id); } catch { /* storage unavailable */ }
    }
    return chosen;
  }, []);

  /*
   * The address follows the company (A-26). Opening one with no code in the
   * address writes it in place; switching company is a new history entry, so
   * Back returns to the company before. A code the person cannot open is left
   * where it is, under the "no access" screen, so they can see what they
   * followed.
   */
  const tenantCode = user && tenant && !deniedCode ? tenant.code || '' : '';
  const tenantLegacyCode = tenantCode ? tenant.legacyCode || '' : '';
  useEffect(() => {
    if (!tenantCode || typeof window === 'undefined') return;
    /* Explore's landing page trades its link for the sample company's session; no company code belongs on it. */
    if (isExplorePath()) return;
    const current = orgCodeFromPath(window.location.pathname);
    if (current === tenantCode.toUpperCase()) return;
    const url = `${withOrgPath(window.location.pathname, tenantCode)}${window.location.search}${window.location.hash}`;
    /* An old code for this same company is corrected in place, not a new history entry. */
    if (current && current !== tenantLegacyCode.toUpperCase()) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, [tenantCode, tenantLegacyCode]);

  /* An app's own company menu asks; the shell switches (A-27). Only a company this person has. */
  useEffect(() => {
    const onAsk = (e) => {
      const id = String(e?.detail?.orgId || '');
      if (tenants.some((t) => t.id === id)) setTenantId(id);
    };
    window.addEventListener(SWITCH_COMPANY_EVENT, onAsk);
    return () => window.removeEventListener(SWITCH_COMPANY_EVENT, onAsk);
  }, [tenants, setTenantId]);

  /* Back and Forward between companies: the address decides, as on a reload. */
  useEffect(() => {
    if (!user) return undefined;
    const onPop = () => {
      const code = orgCodeFromPath(window.location.pathname);
      if (!code) return;
      const hit = tenants.find((t) => codeNames(t, code));
      if (hit) {
        setTenantIdState(hit.id);
        setDeniedCode('');
        try { sessionStorage.setItem(tabChoiceKey(user.id), hit.id); } catch { /* storage unavailable */ }
      } else setDeniedCode(code);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [user, tenants]);

  /* A token in the browser is a claim, not a session: the server decides.
     On an app's own address (accounting.clor.in) there may be no token yet
     even though the person signed in at app.clor.in: the access token is per
     address, the refresh cookie is not. Asking anyway lets the transport's
     silent refresh pick the session up from the cookie. */
  useEffect(() => {
    /* Back from single sign-on: no token in this browser yet, only the refresh cookie the API just set. */
    let fromSso = false;
    try {
      const q = new URLSearchParams(window.location.search);
      fromSso = q.get('sso') === 'ok';
      if (fromSso) {
        q.delete('sso');
        window.history.replaceState({}, '', `${window.location.pathname}${q.toString() ? `?${q}` : ''}${window.location.hash}`);
      }
    } catch {
      /* no window to read */
    }
    if (!readToken() && !appFromHost() && !fromSso) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiMe();
        if (cancelled) return;
        const next = adopt(data);
        if (next) loadApps(next.id, next.branchId);
      } catch {
        if (!cancelled) {
          writeToken('');
          if (wasExplore()) setExploreEnded(true);
        }
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

  /* A screen that changed the switches (People → Settings → Modules) asks for them again, so the menu follows at once. */
  useEffect(() => {
    if (!tenant) return undefined;
    const reload = () => loadApps(tenant.id, tenant.branchId);
    window.addEventListener('clor:features-changed', reload);
    return () => window.removeEventListener('clor:features-changed', reload);
  }, [tenant, loadApps]);

  /* My profile saved a new name or photo: the bar shows it at once, not on the next sign-in. */
  useEffect(() => {
    const onProfile = (e) => {
      const next = e?.detail || {};
      setUser((u) => (u ? { ...u, ...next } : u));
    };
    window.addEventListener('clor:profile-changed', onProfile);
    return () => window.removeEventListener('clor:profile-changed', onProfile);
  }, []);

  /* An app signing out, or the platform giving up on a refresh, ends the
     session here too. Otherwise the shell keeps a signed-in frame around an
     app that no longer has a session. */
  useEffect(() => {
    const onEnded = () => {
      writeToken('');
      forgetSelections();
      if (wasExplore()) {
        markExplore(false);
        setExploreEnded(true);
      }
      setExplore(null);
      setUser(null);
      setTenants([]);
      setAccounts([]);
      setTenantIdState('');
    };
    window.addEventListener('auth:session-expired', onEnded);
    return () => window.removeEventListener('auth:session-expired', onEnded);
  }, []);

  const finishSignIn = useCallback(
    async (res) => {
      forgetSelections();
      writeToken(res.token);
      const data = await apiMe();
      const next = adopt({ ...data, activeOrgId: res.activeOrgId });
      if (next) loadApps(next.id, next.branchId);
      return next;
    },
    [adopt, loadApps]
  );

  /* With an authenticator set up, the password alone returns a challenge, not a session: the caller asks for the code. */
  const signIn = useCallback(
    async ({ email, password }) => {
      const res = await apiLogin({ email, password });
      if (res?.twoFactorRequired) return { twoFactorRequired: true, challenge: res.challenge };
      return finishSignIn(res);
    },
    [finishSignIn]
  );

  const signInWithCode = useCallback(async ({ challenge, code }) => finishSignIn(await apiLoginTwoFactor({ challenge, code })), [finishSignIn]);

  /* After setting up an authenticator: ask again whether anything still requires one. */
  const recheckTwoFactor = useCallback(async () => {
    const data = await apiMe();
    setTwoFactorSetupRequired(Boolean(data?.twoFactorSetupRequired));
    return Boolean(data?.twoFactorSetupRequired);
  }, []);

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
    async ({ fullName, email, password, noticeVersion }) => {
      const res = await apiSignup({ email, password, fullName, noticeVersion });
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
   *
   * The apps picked go with the company, and the server switches on exactly
   * those: a trial owns every app, and switching the picked ones on after the
   * fact left the rest on too (People on with only Attendance picked, which
   * then sent Attendance to People).
   */
  const createCompany = useCallback(
    async ({ name, gstin, state, apps = [] }) => {
      await setupCompany({
        companyName: name,
        ...(gstin ? { gstin } : {}),
        ...(state ? { state } : {}),
        apps,
      });

      const data = await apiMe();
      /* The company just created, not whichever one sorts first. */
      const made = (data?.orgs || []).find((m) => String(m.org?.name || '') === String(name));
      const next = adopt({ ...data, activeOrgId: made?.orgId || data?.activeOrgId }, true);

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
    markExplore(false);
    setExplore(null);
    setUser(null);
    setTenants([]);
    setAccounts([]);
    setTenantIdState('');
    setDeniedCode('');
    /* Signing out leaves no company in the address for whoever signs in next. */
    try { window.history.replaceState(null, '', `${withOrgPath(window.location.pathname, '')}${window.location.search}${window.location.hash}`); } catch { /* no window */ }
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
    () => ({ user, tenant, tenants, accounts, deniedCode, restoring, signIn, signInWithCode, twoFactorSetupRequired, recheckTwoFactor, signUp, createCompany, signOut, setTenantId, addApp, explore, exploreEnded }),
    [user, tenant, tenants, accounts, deniedCode, restoring, signIn, signInWithCode, twoFactorSetupRequired, recheckTwoFactor, signUp, createCompany, signOut, setTenantId, addApp, explore, exploreEnded]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
};
