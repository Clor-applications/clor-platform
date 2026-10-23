import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * A-15: every app answers in one order — not bought (402 APP_NOT_SUBSCRIBED)
 * before switched off (403 *_DISABLED). The guards asked "switched on?"
 * first, and removing an app from the subscription also switches it off, so
 * an unowned app read as a company setting rather than as not bought.
 */
const state = { entitled: false, enabled: false };
vi.mock('../services/subscriptions.js', () => ({ isAppEntitled: async () => state.entitled }));
vi.mock('../services/features.js', () => ({ isFeatureEnabled: async () => state.enabled }));

const { attendanceRouteOk } = await import('../services/attendance/guards.js');
const { payrollRouteOk } = await import('../services/payroll/guards.js');
const { peopleRouteOk } = await import('../services/people/guards.js');

const call = async (guard: (req: any, res: any) => Promise<boolean>) => {
  const out: { status?: number; body?: any } = {};
  const res = { status: (s: number) => ({ json: (b: any) => { out.status = s; out.body = b; } }) };
  const req = { params: { orgId: 'org-1' }, tenant: { accountId: 'acc-1', orgId: 'org-1' } };
  const ok = await guard(req, res);
  return { ok, ...out };
};

describe.each([
  ['attendance', attendanceRouteOk],
  ['payroll', payrollRouteOk],
  ['people', peopleRouteOk],
])('%s', (_name, guard) => {
  beforeEach(() => {
    state.entitled = false;
    state.enabled = false;
  });

  it('says "not on the subscription" for an app the account has not bought, even though it is also switched off', async () => {
    const r = await call(guard as any);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('APP_NOT_SUBSCRIBED');
  });

  it('says "switched off" for an app that is bought but turned off', async () => {
    state.entitled = true;
    const r = await call(guard as any);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.body.code).toMatch(/_DISABLED$/);
  });

  it('lets a bought, switched-on app through', async () => {
    state.entitled = true;
    state.enabled = true;
    expect((await call(guard as any)).ok).toBe(true);
  });
});
