import { Router } from 'express';

import { exploreLimiter } from '../middleware/rateLimit.js';
import { clientIp } from '../services/auth.js';
import { ExploreEnded, openExploreSession } from '../services/explore.js';
import { setRefreshCookie } from '../utils/refreshCookie.js';

/**
 * Explore (roadmap item 6): the link from the demo request's mail lands on the
 * app's /explore page, which posts its token here. A pass still running is
 * traded for an ordinary session (the refresh cookie and an access token, as
 * a sign-in gives) as the sample company's read-only viewer
 * (services/explore.ts). Public: the token is the credential. exploreLimiter
 * caps attempts per address and per token.
 */
export const exploreRouter = Router();

exploreRouter.post('/explore/exchange', ...exploreLimiter, async (req, res) => {
  try {
    const opened = await openExploreSession(String(req.body?.token || ''), {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });
    /* As at sign-in: the refresh token only in the HttpOnly cookie, never in the body. */
    setRefreshCookie(res, opened.refreshToken, opened.session.expiresAt);
    return res.json({
      token: opened.accessToken,
      activeOrgId: opened.company.orgId,
      app: opened.pass.app,
      expiresAt: opened.pass.expiresAt,
    });
  } catch (e) {
    if (e instanceof ExploreEnded) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
});
