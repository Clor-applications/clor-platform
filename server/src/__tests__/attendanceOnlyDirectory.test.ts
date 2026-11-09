import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * People plan, 8 Nov 2026: a company that bought Attendance and not People
 * keeps its staff list in Attendance (its People section). The directory
 * routes it uses answered 402 "People is not on this account's subscription",
 * so the Employees screen never loaded. The shared directory now opens to
 * either app; everything else under /people stays People's.
 */
const state = { apps: new Set<string>(), features: new Set<string>() };
vi.mock('../services/subscriptions.js', () => ({ isAppEntitled: async (_a: string, code: string) => state.apps.has(code) }));
vi.mock('../services/features.js', () => ({ isFeatureEnabled: async (_a: string, _o: string, key: string) => state.features.has(key) }));

const { peopleRouteOk, isSharedDirectoryRoute } = await import('../services/people/guards.js');

const call = async (path: string) => {
  const out: { status?: number; body?: any } = {};
  const res = { status: (s: number) => ({ json: (b: any) => { out.status = s; out.body = b; } }) };
  const req = { params: { orgId: 'org-1' }, tenant: { accountId: 'acc-1', orgId: 'org-1' }, route: { path } };
  const ok = await peopleRouteOk(req as any, res as any);
  return { ok, ...out };
};

describe('Attendance bought without People', () => {
  beforeEach(() => {
    state.apps = new Set(['attendance']);
    state.features = new Set(['attendance']);
  });

  it.each([
    '/orgs/:orgId/people/employees',
    '/orgs/:orgId/people/employees/:id',
    '/orgs/:orgId/people/employees/import',
    '/orgs/:orgId/people/employees/counts',
    '/orgs/:orgId/people/structure/:kind',
    '/orgs/:orgId/people/structure/:kind/:id',
    '/orgs/:orgId/people/contractors',
    '/orgs/:orgId/people/employees/:id/resign',
    '/orgs/:orgId/people/employees/transfer',
    '/orgs/:orgId/people/suggestions',
  ])('opens the shared directory route %s', async (path) => {
    expect((await call(path)).ok).toBe(true);
  });

  it.each([
    '/orgs/:orgId/people/recruitment/openings',
    '/orgs/:orgId/people/employees/:id/probation/decide',
    '/orgs/:orgId/people/home',
    '/orgs/:orgId/people/inbox',
  ])('still answers 402 for People-only route %s', async (path) => {
    const r = await call(path);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('APP_NOT_SUBSCRIBED');
  });

  it('a directory route on an account with neither app answers 402', async () => {
    state.apps = new Set();
    expect((await call('/orgs/:orgId/people/employees')).status).toBe(402);
  });

  it('a directory route with Attendance bought but switched off answers 403', async () => {
    state.features = new Set();
    const r = await call('/orgs/:orgId/people/employees');
    expect(r.status).toBe(403);
  });

  it('knows its shared set without a request', () => {
    expect(isSharedDirectoryRoute('/orgs/:orgId/people/employees/:id/history')).toBe(true);
    expect(isSharedDirectoryRoute('/orgs/:orgId/people/letters')).toBe(false);
  });
});
