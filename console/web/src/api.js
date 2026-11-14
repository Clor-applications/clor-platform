/*
 * The Console's API, at /api on the page's own address (Cloudflare forwards it
 * to the service: functions/api/[[path]].js; on a laptop the dev server does).
 * VITE_CONSOLE_API points it elsewhere if ever needed. Every change carries
 * the X-Console header, which the API requires along with this page's origin.
 */
const BASE = (import.meta.env?.VITE_CONSOLE_API || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      credentials: 'include',
      headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-console': '1' },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    });
  } catch {
    throw new ApiError('The Console server is not answering. The page loaded, so your connection is fine; the server behind it is down or not set up yet.', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) throw new ApiError(data?.error || 'That did not work. Try again.', res.status, data?.code);
  return data;
}

export const signInUrl = `${BASE}/api/auth/github`;
export const clorSignInUrl = `${BASE}/api/auth/clor`;
/* Both need a code entered in the last five minutes; the API sends the browser back with ?signin=code-first otherwise. */
export const connectGithubUrl = `${BASE}/api/auth/github?connect=1`;
export const linkClorUrl = `${BASE}/api/auth/clor?link=1`;

export const api = {
  me: () => call('GET', '/me'),
  signInOptions: () => call('GET', '/auth/options'),
  signOut: () => call('POST', '/auth/sign-out'),
  setupAuthenticator: () => call('POST', '/two-factor/setup'),
  enableAuthenticator: (code) => call('POST', '/two-factor/enable', { code }),
  stepUp: (code) => call('POST', '/step-up', { code }),
  overview: () => call('GET', '/overview'),
  releases: () => call('GET', '/releases'),
  runSteps: (id) => call('GET', `/releases/runs/${id}`),
  runTests: () => call('POST', '/releases/tests'),
  stage: () => call('POST', '/releases/stage'),
  release: (reason) => call('POST', '/releases/go', { reason }),
  approve: (id) => call('POST', `/releases/runs/${id}/approve`),
  rollback: (revision, reason) => call('POST', '/releases/rollback', { revision, reason }),
  pulls: () => call('GET', '/pulls'),
  pullFullTests: (n) => call('POST', `/pulls/${n}/full-tests`),
  pullMerge: (n) => call('POST', `/pulls/${n}/merge`),
  pullClose: (n, reason) => call('POST', `/pulls/${n}/close`, { reason }),
  audit: (q = {}) => call('GET', `/audit?${new URLSearchParams(q)}`),
  members: () => call('GET', '/members'),
  addMember: (m) => call('POST', '/members', m),
  changeMember: (id, m) => call('PATCH', `/members/${id}`, m),
};
