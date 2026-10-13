import type { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Only accept traffic that came through the api.clor.in Worker.
 *
 * Cloud Run's run.app address is public and cannot be switched off without a
 * load balancer. The Worker adds `x-clor-edge: <EDGE_SECRET>` to every request
 * it forwards; anything that reaches the service without it went around
 * Cloudflare (and around the X-Forwarded-For overwrite the rate limiter relies
 * on), so it is refused. /health stays open for uptime checks.
 *
 * Unset EDGE_SECRET (dev, tests, on-prem) disables the check. Both sides are
 * hashed before comparing so the compare is constant-time regardless of length.
 */
export const EDGE_HEADER = 'x-clor-edge';

const digest = (s: string) => createHash('sha256').update(s).digest();

export function edgeGuard(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.EDGE_SECRET;
  if (!secret || req.path === '/health') return next();
  const got = req.get(EDGE_HEADER);
  if (got && timingSafeEqual(digest(got), digest(secret))) return next();
  return res.status(403).json({ error: 'Use https://api.clor.in', code: 'EDGE_REQUIRED' });
}
