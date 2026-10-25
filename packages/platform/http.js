// In dev, Vite proxies `/api` to the backend (see vite.config.js).
// Use a relative default to avoid CORS/mixed-content issues that often show up as "Failed to fetch".
// Exported so callers that must bypass apiFetch — a file download, where the
// response is CSV rather than JSON — still hit the same origin.
export const API_BASE = import.meta.env?.VITE_API_BASE || '/api';

/*
 * Which company a call is for comes from the platform context, which the shell
 * sets. The transport does not read it from a browser store, because a store is
 * shared by every app on the origin and a contract is not.
 */
import { orgId as contextOrgId, branchId as contextBranchId, warehouseId as contextWarehouseId } from './context';

function getToken() {
  return String(localStorage.getItem('token') || '').trim();
}


/**
 * Exchanges the refresh token for a new pair.
 *
 * Concurrent 401s must not each start their own refresh: the first rotation
 * would invalidate the token the others are holding, which the server treats as
 * theft and responds to by ending every session. One in-flight promise is
 * shared by all callers.
 */
let refreshInFlight = null;

async function refreshSession() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      /*
       * No token in the body: the refresh token is an HttpOnly cookie and
       * `credentials: 'include'` is what makes the browser send it. There is
       * nothing here for a script on the page to read or to steal.
       */
      const ask = () =>
        fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
      let res = await ask();
      /*
       * Another tab refreshed with the same cookie a moment earlier and won.
       * Its response has already given this browser the new cookie, so one
       * more try succeeds; giving up here would sign this tab out for nothing.
       */
      if (res.status === 409) res = await ask();
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.token) return null;
      localStorage.setItem('token', data.token);
      /*
       * The refresh token is not in this response and must not be stored. The
       * server sets it as an HttpOnly cookie; storing a copy anywhere a script
       * can read it would give back exactly what the cookie was for.
       */
      return data.token;
    } catch {
      return null;
    } finally {
      // Cleared on the next tick so callers awaiting this promise all see it.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

function endSession(message) {
  try {
    localStorage.removeItem('token');
    // Left over from before the cookie: remove it so no tab keeps sending one.
    localStorage.removeItem('refreshToken');
  } catch {
    // ignore
  }
  const err = new Error(message || 'Your session has expired. Please sign in again.');
  err.status = 401;
  err.sessionExpired = true;
  window.dispatchEvent(new CustomEvent('auth:session-expired'));
  return err;
}

const getOrgId = () => contextOrgId();
const getBranchId = () => contextBranchId();
const getWarehouseId = () => contextWarehouseId();

/**
 * What to tell someone when the reply is not JSON.
 *
 * A failure that never reaches the server comes back as somebody else's error
 * page — Cloudflare's, a proxy's — and the first 300 characters of it used to
 * be handed to the user as the message. Trying to save a purchase order and
 * being shown `<!doctype html> <!--[if lt IE 7]>` says nothing about the order
 * and nothing about what to do next.
 *
 * The page body is still logged for whoever is debugging; it is just not the
 * thing on screen.
 */
function describeHttpFailure(status, text) {
  const raw = String(text || '').trim();
  const isHtml = /^\s*<(!doctype|html|head|body)/i.test(raw);

  if (isHtml || !raw) {
    if (raw) console.error(`Non-JSON ${status} response from the API:`, raw.slice(0, 500));
    if (status === 502 || status === 503 || status === 504) {
      return `The server could not be reached (${status}). It may be restarting — try again in a moment.`;
    }
    if (status >= 500) return `The server could not complete that (${status}). Nothing was saved.`;
    return `Request failed (${status}).`;
  }

  return raw.slice(0, 300);
}

/*
 * Step-up (server: services/stepUp.ts). Where a company asks for it, an action
 * that moves money answers 403 STEP_UP_REQUIRED; the person is asked for the
 * code from their authenticator app, it is exchanged for a fifteen-minute
 * token, and the action is sent again with it. The token is kept in memory
 * only — a new tab or a reload asks again.
 */
let stepUp = null;
const stepUpHeader = () => (stepUp && stepUp.expiresAt > Date.now() + 5000 ? { 'x-step-up': stepUp.token } : {});

/** Asks for a code through the app's dialog (Toaster listens), or the browser's prompt. */
function askForCode(message) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(null);
    if (window.__clorStepUpHost) {
      window.dispatchEvent(new CustomEvent('clor:step-up', { detail: { message, resolve } }));
    } else {
      const v = window.prompt(`${message}\n\nCode from your authenticator app:`);
      resolve(v ? v.trim() : null);
    }
  });
}

async function stepUpAndRetry(path, opts, data) {
  let message = data?.error || 'Enter the code from your authenticator app to continue.';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = await askForCode(message);
    if (!code) {
      const err = new Error('Not done: no authenticator code was given.');
      err.status = 403;
      err.code = 'STEP_UP_REQUIRED';
      throw err;
    }
    try {
      /* The operator console has no company to ask through: it has its own step-up. */
      const where = String(path).startsWith('/ops/') ? '/ops/step-up' : `/orgs/${encodeURIComponent(getOrgId())}/security/step-up`;
      const r = await apiFetch(where, { method: 'POST', body: { code }, stepUpRetried: true });
      stepUp = { token: r.token, expiresAt: new Date(r.expiresAt).getTime() };
      return apiFetch(path, { ...opts, stepUpRetried: true });
    } catch (e) {
      if (e?.code !== 'BAD_CODE') throw e;
      message = e.message;
    }
  }
  const err = new Error('Not done: the authenticator code was not accepted.');
  err.status = 403;
  throw err;
}

/*
 * Writes that create money records carry an Idempotency-Key (server:
 * middleware/idempotency.ts). The same form sent again within a few seconds
 * (a double click, a resend after a timeout or a token refresh) reuses the
 * key, so the server answers it with the first result instead of making a
 * second invoice, receipt or payment. A different body is a new key.
 */
const GUARDED_WRITE = /^\/orgs\/[^/]+\/(invoices|payments|payments\/[^/]+\/reverse|ledger\/entries|bank-book|adjustments|transfers|fixed-assets|recurring\/run|pay-requests|payroll\/payments|payroll\/payments\/[^/]+\/(settle|post|cancel)|payroll\/runs|payroll\/settlements)\/?$/;
const recentWrites = new Map();
const REUSE_MS = 15_000;
const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
export function idempotencyKeyFor(method, path, body) {
  if (method !== 'POST' || !GUARDED_WRITE.test(String(path).split('?')[0])) return null;
  const now = Date.now();
  for (const [k, v] of recentWrites) if (now - v.at > REUSE_MS) recentWrites.delete(k);
  const sig = `${path}|${body ? JSON.stringify(body) : ''}`;
  const hit = recentWrites.get(sig);
  if (hit) return hit.key;
  const key = newKey();
  recentWrites.set(sig, { key, at: now });
  return key;
}

export async function apiFetch(
  path,
  {
    method = 'GET',
    body,
    headers,
    skipBranchHeader = false,
    skipWarehouseHeader = false,
    /*
     * For the routes a customer follows rather than a user calls.
     *
     * A shared invoice link is opened by somebody with no account here, and the
     * one thing that must not happen is a stale session in that browser turning
     * a public request into an authenticated one against a company they are
     * not in.
     */
    skipAuth = false,
    isRetry = false,
    transientRetryCount = 0,
    stepUpRetried = false,
    /* A file the server sends as text (a CSV export): returned as it came, not parsed. */
    asText = false,
  } = {}
) {
  const token = skipAuth ? '' : getToken();
  const orgId = getOrgId();
  const branchId = getBranchId();
  const warehouseId = getWarehouseId();

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      // The refresh cookie is scoped to /api/auth; including credentials is
      // what lets refresh and logout see it at all.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(!skipAuth && orgId ? { 'x-org-id': orgId } : {}),
        ...(!skipAuth && !skipBranchHeader && branchId ? { 'x-branch-id': branchId } : {}),
        ...(!skipAuth && !skipWarehouseHeader && warehouseId ? { 'x-warehouse-id': warehouseId } : {}),
        ...(!skipAuth ? stepUpHeader() : {}),
        ...(() => {
          const k = idempotencyKeyFor(method, path, body);
          return k ? { 'Idempotency-Key': k } : {};
        })(),
        ...(headers || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // Reads are safe to repeat. During local startup the web server can become
    // ready a moment before the API/SQLite connection; one brief retry avoids
    // turning that harmless race into a persistent dashboard error banner.
    if (method === 'GET' && transientRetryCount < 2) {
      await new Promise((resolve) => setTimeout(resolve, transientRetryCount === 0 ? 250 : 750));
      return apiFetch(path, {
        method, body, headers, skipBranchHeader, skipWarehouseHeader, skipAuth, isRetry, asText,
        transientRetryCount: transientRetryCount + 1,
      });
    }
    /* What a person can act on: their connection, and the fact that the
       work is not lost. The environment variable that used to be named here
       means nothing to whoever is looking at the screen — and this string is
       shown to them, not logged. The cause carries the technical detail. */
    const err = new Error('Could not reach the server. Check your connection — anything you have entered is still here.');
    err.cause = e;
    /* Screens tell "no connection" from a server that answered with an error (spec v1 §8). */
    err.network = true;
    throw err;
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.status === 401 && !isRetry) {
    // The access token is short-lived by design. Try one silent refresh before
    // treating this as a sign-out.
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiFetch(path, { method, body, headers, skipBranchHeader, skipWarehouseHeader, skipAuth, isRetry: true, transientRetryCount, asText });
    }
    throw endSession(data?.error);
  }

  if (res.status === 401) {
    throw endSession(data?.error);
  }

  if (res.status === 403 && data?.code === 'STEP_UP_REQUIRED' && !stepUpRetried && !skipAuth) {
    stepUp = null;
    return stepUpAndRetry(path, { method, body, headers, skipBranchHeader, skipWarehouseHeader, skipAuth, isRetry, transientRetryCount, asText }, data);
  }

  if (!res.ok) {
    if (method === 'GET' && transientRetryCount < 2 && [500, 502, 503, 504].includes(res.status)) {
      await new Promise((resolve) => setTimeout(resolve, transientRetryCount === 0 ? 250 : 750));
      return apiFetch(path, {
        method, body, headers, skipBranchHeader, skipWarehouseHeader, skipAuth, isRetry, asText,
        transientRetryCount: transientRetryCount + 1,
      });
    }
    const err = new Error(data?.error || describeHttpFailure(res.status, text));
    err.status = res.status;
    err.data = data;
    /* The reference a person can quote to support (spec v1 §8 "API unavailable"). */
    err.requestId = res.headers?.get?.('x-request-id') || null;
    /* 402 APP_NOT_SUBSCRIBED and friends: callers branch on the code, not the text. */
    err.code = data?.code || null;
    /* An account Clor has suspended: the shell replaces everything with one plain page (W-8.2). */
    if (res.status === 403 && err.code === 'ACCOUNT_SUSPENDED' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('clor:account-suspended', { detail: { message: data?.error || '' } }));
    }
    /* An app the account has not bought: the shell offers the way forward once, whichever screen asked. */
    if (res.status === 402 && err.code === 'APP_NOT_SUBSCRIBED' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('clor:app-not-subscribed', { detail: { app: data?.app || null, message: data?.error || '' } }));
    }
    throw err;
  }

  return asText ? text : data;
}
