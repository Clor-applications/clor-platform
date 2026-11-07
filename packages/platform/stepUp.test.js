import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * Review S1: an operator action takes only the operator console's step-up,
 * and a company's step-up token is never sent with one (server: services/stepUp.ts).
 */
vi.mock('./context', () => ({ orgId: () => 'org-1', branchId: () => 'br-1', warehouseId: () => '' }));

const calls = [];
const reply = (status, body) => ({ ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body, text: async () => JSON.stringify(body) });

beforeEach(() => {
  calls.length = 0;
  localStorage.setItem('token', 'access-token');
  window.prompt = vi.fn(() => '123456');
});

describe('step-up', () => {
  it('asks the operator console for an operator action, and keeps the company token for company actions', async () => {
    const steppedUp = new Set();
    globalThis.fetch = vi.fn(async (url, opts) => {
      const path = String(url).replace(/^\/api/, '');
      const stepUp = opts.headers['x-step-up'];
      calls.push({ path, stepUp });
      if (path === '/orgs/org-1/security/step-up') return reply(200, { token: 'company-token', expiresAt: new Date(Date.now() + 900_000).toISOString() });
      if (path === '/ops/step-up') return reply(200, { token: 'operator-token', expiresAt: new Date(Date.now() + 900_000).toISOString() });
      const want = path.startsWith('/billing/accounts/') ? 'operator-token' : 'company-token';
      if (stepUp !== want) return reply(403, { code: 'STEP_UP_REQUIRED', error: 'Enter the code.' });
      steppedUp.add(path);
      return reply(200, { ok: true });
    });
    const { apiFetch } = await import('./http');

    await apiFetch('/orgs/org-1/payroll/runs/r1/approve', { method: 'POST', body: {} });
    await apiFetch('/billing/accounts/acc-9/subscription', { method: 'POST', body: { apps: [] } });

    expect(calls.map((c) => c.path)).toEqual([
      '/orgs/org-1/payroll/runs/r1/approve',
      '/orgs/org-1/security/step-up',
      '/orgs/org-1/payroll/runs/r1/approve',
      '/billing/accounts/acc-9/subscription',
      '/ops/step-up',
      '/billing/accounts/acc-9/subscription',
    ]);
    /* The company token went nowhere near the operator action. */
    expect(calls.find((c) => c.path === '/billing/accounts/acc-9/subscription').stepUp).toBeUndefined();
    expect(steppedUp.size).toBe(2);
  });
});
