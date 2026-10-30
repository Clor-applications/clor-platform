/**
 * A small client for the CLOR API, for SETTING UP test data only.
 *
 * TEAM.md: API calls may create what a scenario needs (a company, twelve
 * people, a pending leave request); they never check a result. Every
 * expectation in e2e/tests reads the browser.
 */
import { apiURL } from '../scripts/env.mjs';

export type Session = { token: string; orgId: string; branchId: string };

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, what: string) {
    super(`${what} → ${status} ${JSON.stringify(body).slice(0, 400)}`);
  }
}

async function call<T = any>(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; ok?: number[] } = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${apiURL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON: keep the text */
  }
  const ok = opts.ok || [200, 201, 202, 204];
  if (!ok.includes(res.status)) throw new ApiError(res.status, body, `${method} ${path}`);
  return { status: res.status, body };
}

const headersOf = (s: Partial<Session>) => ({
  ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}),
  ...(s.orgId ? { 'x-org-id': s.orgId } : {}),
  ...(s.branchId ? { 'x-branch-id': s.branchId } : {}),
});

/** Calls made as a signed-in CLOR user inside one company. */
export const as = (s: Partial<Session>) => ({
  get: <T = any>(path: string) => call<T>('GET', path, { headers: headersOf(s) }).then((r) => r.body),
  post: <T = any>(path: string, body: unknown = {}) => call<T>('POST', path, { body, headers: headersOf(s) }).then((r) => r.body),
  put: <T = any>(path: string, body: unknown = {}) => call<T>('PUT', path, { body, headers: headersOf(s) }).then((r) => r.body),
  del: <T = any>(path: string) => call<T>('DELETE', path, { headers: headersOf(s) }).then((r) => r.body),
});

export const auth = {
  signup: (email: string, password: string, name: string) => call('POST', '/auth/signup', { body: { email, password, name } }).then((r) => r.body as { token: string }),
  login: (email: string, password: string) => call('POST', '/auth/login', { body: { email, password } }).then((r) => r.body as { token: string }),
  setupCompany: (token: string, companyName: string, state: string) =>
    call('POST', '/auth/setup-company', { body: { companyName, state }, headers: { Authorization: `Bearer ${token}` } }).then((r) => r.body as { company: { orgId: string }; branch: { id: string } }),
  me: (token: string) => call('GET', '/auth/me', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.body),
};

/** The employee app (people without a CLOR user): company code + employee code + password. */
export const portal = {
  activate: (company: string, employeeCode: string, activationCode: string, password: string) =>
    call('POST', '/portal/activate', { body: { company, employeeCode, activationCode, password } }).then((r) => r.body as { token: string }),
  login: (company: string, employeeCode: string, password: string) =>
    call('POST', '/portal/login', { body: { company, employeeCode, password } }).then((r) => r.body as { token: string }),
  as: (token: string) => as({ token }),
};
