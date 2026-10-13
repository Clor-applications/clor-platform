import type { Request, Response, NextFunction } from 'express';
import { isAppEntitled } from '../services/subscriptions.js';

/**
 * Gate a route on owning an app. Complements requirePermission (which asks "may
 * this user do this action") with "did this account buy this app at all".
 * 402 Payment Required is deliberate: it is a commercial block, not an auth one,
 * so the client can show an upgrade path rather than a login or a forbidden.
 */
export function requireApp(appCode: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const accountId = String(req.tenant?.accountId || req.auth?.accountId || '').trim();
    if (!accountId) return res.status(401).json({ error: 'No tenant context' });
    if (await isAppEntitled(accountId, appCode)) return next();
    return res.status(402).json({ error: `The ${appCode} app is not on this account's subscription.`, app: appCode, code: 'APP_NOT_SUBSCRIBED' });
  };
}
