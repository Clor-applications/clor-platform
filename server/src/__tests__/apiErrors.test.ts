import { describe, expect, it } from 'vitest';

/**
 * Failed requests (500s) are noted for CLOR staff, and enough of them together
 * raise one urgent alert. The note never holds the error's message.
 */
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { errorHandler } = await import('../middleware/errors.js');
const { apiErrorsSince, noteApiError, resetApiErrorWindow, routeShape } = await import('../services/ops/apiErrors.js');
const { collectFindings, RULES } = await import('../services/ops/alerts.js');

const db = <T>(fn: () => Promise<T>) => outsideTenant('test: api errors', fn);
const MIN = 60_000;
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = (s: number) => { r.statusCode = s; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
};
const until = async <T>(fn: () => Promise<T | null | undefined>) => {
  for (let i = 0; i < 50; i += 1) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 40));
  }
  return null;
};

describe('the route kept for a failed request', () => {
  it('has ids and tokens taken out, and no query string', () => {
    expect(routeShape('/api/orgs/ckx81k2j0000/invoices/42?search=Asha+Traders')).toBe('/api/orgs/:id/invoices/:id');
    expect(routeShape('/api/share/abcdefghijklmnopqrstuvwxyzABCDEF')).toBe('/api/share/:id');
    expect(routeShape('/api/account/overview')).toBe('/api/account/overview');
  });
});

describe('a request the API fails', () => {
  it('is noted with its request id, route and error class, and never its message', async () => {
    resetApiErrorWindow();
    const requestId = `req-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const req: any = { id: requestId, method: 'POST', originalUrl: '/api/orgs/ckx81k2j0000/invoices?draft=1', url: '/x', headers: {} };
    const r = res();
    errorHandler(new TypeError('Cannot read properties of undefined (customer Asha Traders, PAN ABCDE1234F)'), req, r, () => {});
    expect(r.statusCode).toBe(500);
    const row = await until(() => db(() => platformPrisma.apiError.findFirst({ where: { requestId } })));
    expect(row).toMatchObject({ method: 'POST', route: '/api/orgs/:id/invoices', errorName: 'TypeError' });
    expect(JSON.stringify(row)).not.toMatch(/Asha|ABCDE1234F|Cannot read/);
  });

  it('is not noted for a refusal that is the caller’s own doing (a 400 or 404)', async () => {
    resetApiErrorWindow();
    const requestId = `req-400-${Date.now()}`;
    const r = res();
    errorHandler(Object.assign(new Error('Missing field'), { status: 400 }), { id: requestId, method: 'POST', originalUrl: '/api/x', headers: {} } as any, r, () => {});
    await new Promise((x) => setTimeout(x, 200));
    expect(await db(() => platformPrisma.apiError.count({ where: { requestId } }))).toBe(0);
  });

  it('stops noting after 60 in a minute from one instance, so a storm of failures is not a storm of writes', async () => {
    resetApiErrorWindow();
    const tag = `storm-${Date.now()}`;
    const t0 = 5_000_000;
    for (let i = 0; i < 75; i += 1) noteApiError(new Error('x'), { id: `${tag}-${i}`, method: 'GET', originalUrl: '/api/storm', headers: {} } as any, t0 + i);
    await until(async () => ((await db(() => platformPrisma.apiError.count({ where: { requestId: { startsWith: tag } } }))) >= 60 ? true : null));
    await new Promise((x) => setTimeout(x, 300));
    expect(await db(() => platformPrisma.apiError.count({ where: { requestId: { startsWith: tag } } }))).toBe(60);
    resetApiErrorWindow();
  });
});

describe('the alert when failures pile up', () => {
  /* A time of its own, far ahead, so rows other tests note are never inside this window. */
  const now = Date.UTC(2090, 0, 1, 12, 0, 0);
  const add = (n: number, route: string, agoMin: number) =>
    db(() => platformPrisma.apiError.createMany({ data: Array.from({ length: n }, () => ({ method: 'GET', route, errorName: 'Error', createdAt: new Date(now - agoMin * MIN) })) }));

  it('stays quiet below the threshold, and counts only the last 15 minutes', async () => {
    await add(RULES.apiErrorsPerQuarterHour - 1, '/api/orgs/:id/payroll/runs', 5);
    await add(20, '/api/old', 40);
    const f = await db(() => collectFindings(now));
    expect(f.find((x) => x.key === 'api-errors')).toBeUndefined();
  }, 60_000);

  it('is one urgent alert for support that names the route failing most', async () => {
    await add(2, '/api/orgs/:id/invoices', 3);
    const f = await db(() => collectFindings(now));
    const a = f.find((x) => x.key === 'api-errors')!;
    expect(a).toMatchObject({ kind: 'errors', severity: 'critical', audience: 'SUPPORT', link: { page: 'health' } });
    expect(a.title).toBe(`CLOR failed ${RULES.apiErrorsPerQuarterHour + 1} requests in the last 15 minutes`);
    expect(a.detail).toMatch(/GET \/api\/orgs\/:id\/payroll\/runs \(4 times\)/);
  }, 60_000);

  it('drops notes older than 14 days', async () => {
    const old = await db(() => platformPrisma.apiError.create({ data: { method: 'GET', route: '/api/ancient', errorName: 'Error', createdAt: new Date(now - 15 * 24 * 60 * MIN) } }));
    await db(() => apiErrorsSince(new Date(now - 15 * MIN), now));
    expect(await db(() => platformPrisma.apiError.findUnique({ where: { id: old.id } }))).toBeNull();
  });
});
