import { apiFetch } from './http';

/**
 * The platform's own API: who you are, and which companies you belong to.
 *
 * Separate from every app's client because it is the one set of calls no app
 * may make. An application asks the platform for the company it is running
 * for; it never signs anybody in, and it never changes which companies exist.
 *
 * `skipAuth` on sign-in and sign-up is not a convenience: a stale token in the
 * browser must not travel with a request whose whole purpose is to establish
 * which session this is.
 */

export const login = ({ email, password }) =>
  apiFetch('/auth/login', { method: 'POST', body: { email, password }, skipAuth: true });

/* The server calls it `name`; sending `fullName` was a silent 400. */
export const signup = ({ email, password, fullName, mobile }) =>
  apiFetch('/auth/signup', {
    method: 'POST',
    body: { email, password, name: fullName, ...(mobile ? { mobile } : {}) },
    skipAuth: true,
  });

/** The first company of a new account: name, state, and a chart of accounts. */
export const setupCompany = (payload) =>
  apiFetch('/auth/setup-company', { method: 'POST', body: payload, skipBranchHeader: true, skipWarehouseHeader: true });

/*
 * The three calls behind the links in Clor's emails. All public: the person
 * following a reset link is by definition not signed in, and a stale token in
 * this browser must not ride along with them.
 */
export const forgotPassword = (email) =>
  apiFetch('/auth/forgot-password', { method: 'POST', body: { email }, skipAuth: true });

export const resetPassword = ({ token, password }) =>
  apiFetch('/auth/reset-password', { method: 'POST', body: { token, password }, skipAuth: true });

export const verifyEmail = (token) =>
  apiFetch('/auth/verify-email', { method: 'POST', body: { token }, skipAuth: true });

export const me = () => apiFetch('/auth/me', { skipBranchHeader: true, skipWarehouseHeader: true });

export const logout = () => apiFetch('/auth/logout', { method: 'POST', skipAuth: true });

/* The signed-in person's own profile. Platform data, so every app shows the
   same page: Accounting in its settings, the shell for apps that use its menu. */
export const getProfile = () =>
  apiFetch('/auth/me', { skipBranchHeader: true, skipWarehouseHeader: true });

export const updateProfile = (patch) =>
  apiFetch('/auth/me', {
    method: 'PATCH',
    body: typeof patch === 'string' ? { fullName: patch } : patch,
    skipBranchHeader: true,
    skipWarehouseHeader: true,
  });

export const resendVerification = () =>
  apiFetch('/auth/resend-verification', { method: 'POST', skipBranchHeader: true, skipWarehouseHeader: true });

/**
 * Which apps a company has.
 *
 * Two layers, like plans and feature settings. The feature flag is the
 * company's preference: it has Accounting because it keeps books, and Payroll
 * when the payroll feature is switched on. The subscription is the ceiling
 * above it: which apps the account has bought (see billingFor/visibleApps).
 * Adding an app switches the feature on — and the server refuses that with a
 * 402 when the subscription does not own the app.
 */
/*
 * The branch is passed in, not read from the context.
 *
 * The shell asks this the moment it learns which companies exist, which is one
 * render before the context it publishes has reached the transport — so the
 * first call went out with no `x-branch-id` and came back 400. It was caught,
 * the company fell back to "accounting only", and a company that had bought
 * Payroll did not see it until the page was reloaded.
 */
const tenantHeaders = (orgId, branchId) => ({
  'x-org-id': orgId,
  ...(branchId ? { 'x-branch-id': branchId } : {}),
});

export const featuresFor = (orgId, branchId) =>
  apiFetch(`/orgs/${encodeURIComponent(orgId)}/features`, {
    headers: tenantHeaders(orgId, branchId),
    skipWarehouseHeader: true,
  });

export const setFeature = (orgId, branchId, key, enabled) =>
  apiFetch(`/orgs/${encodeURIComponent(orgId)}/features`, {
    method: 'PUT',
    body: { features: { [key]: enabled } },
    headers: tenantHeaders(orgId, branchId),
    skipWarehouseHeader: true,
  });

/**
 * The account's subscription, at the level of whole apps.
 *
 * `restricted: false` means no subscription has been assigned and nothing is
 * limited — every account that existed before billing. The shell treats a
 * failed call the same way, so a billing hiccup never costs a company its apps.
 */
export const billingFor = (orgId, branchId) =>
  apiFetch('/billing/subscription', {
    headers: tenantHeaders(orgId, branchId),
    skipWarehouseHeader: true,
  });

/** What a company sees: the apps it switched on, within the apps it owns. */
export const visibleApps = (flagApps, billing) =>
  billing?.restricted ? flagApps.filter((a) => (billing.ownedApps || []).includes(a)) : flagApps;

export const APP_FEATURE = { payroll: 'payroll' };

export const appsFromFeatures = (features) => {
  const on = features && typeof features === 'object' ? features : {};
  /* Accounting is not a feature flag: a company that keeps books has it, and
     every company on the platform keeps books today. */
  const apps = ['accounting'];
  if (on.payroll) apps.push('payroll');
  return apps;
};
