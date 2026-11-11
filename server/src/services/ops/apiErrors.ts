import type { Request } from 'express';

import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant } from '../../utils/tenantScope.js';

/**
 * A note of each request the API failed (a 500), so CLOR staff hear when errors pile up
 * (services/ops/alerts.ts) and can find one by the request id a customer quotes.
 *
 * Kept: when, the method, the route with its ids taken out, the error's class name, the
 * request id. Never the message or the stack: those can carry a customer's data, and they
 * are already in Error Reporting under the same request id (utils/log.ts, reportError).
 */

/** /api/orgs/ck3f…/invoices/42?x=1 → /api/orgs/:id/invoices/:id. Tokens in a path never reach the table. */
export function routeShape(url: string): string {
  const path = String(url || '').split('?')[0].split('#')[0];
  return path
    .split('/')
    .map((seg) => (seg && (/\d/.test(seg) || seg.length > 24) ? ':id' : seg))
    .join('/')
    .slice(0, 200);
}

/* A storm of failures must not become a storm of writes: at most this many notes a minute from one instance. */
const PER_MINUTE = 60;
let windowStart = 0;
let inWindow = 0;

/** Fire and forget: the failed request is answered whether or not the note is written. */
export function noteApiError(err: unknown, req: Request, now = Date.now()): void {
  if (now - windowStart >= 60_000) {
    windowStart = now;
    inWindow = 0;
  }
  if (inWindow >= PER_MINUTE) return;
  inWindow += 1;
  const errorName = String((err as any)?.name || 'Error').slice(0, 80);
  const data = { requestId: (req as any).id ? String((req as any).id).slice(0, 80) : null, method: String(req.method || 'GET').slice(0, 10), route: routeShape(req.originalUrl || req.url || ''), errorName };
  void outsideTenant('ops: note an API error', () => platformPrisma.apiError.create({ data }))
    .then(() => undefined)
    .catch(() => undefined);
}

/** For tests: start the per-minute window afresh. */
export const resetApiErrorWindow = () => {
  windowStart = 0;
  inWindow = 0;
};

const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

/** How many requests failed since `since`, and the route that failed most. Also drops notes older than 14 days. */
export async function apiErrorsSince(since: Date, now = Date.now()): Promise<{ count: number; worst: { route: string; count: number } | null }> {
  await platformPrisma.apiError.deleteMany({ where: { createdAt: { lt: new Date(now - KEEP_MS) } } });
  const byRoute = await platformPrisma.apiError.groupBy({ by: ['method', 'route'], where: { createdAt: { gt: since } }, _count: { _all: true } });
  const count = byRoute.reduce((n, r) => n + r._count._all, 0);
  const top = byRoute.sort((a, b) => b._count._all - a._count._all)[0];
  return { count, worst: top ? { route: `${top.method} ${top.route}`, count: top._count._all } : null };
}
