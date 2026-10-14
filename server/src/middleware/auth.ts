import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { platformPrisma } from '../utils/platformPrisma.js';
import { isDevOrTest } from '../utils/devMode.js';
import { cachedAccess } from '../utils/accessCache.js';

export type AuthUser = {
  userId: string;
  accountId: string;
  /** The session this access token was issued for (`sid`), when it has one. */
  sessionId?: string;
};

function getJwtSecret() {
  return process.env.JWT_SECRET || (isDevOrTest() ? 'dev-secret' : '');
}

declare global {
  // eslint-disable-next-line no-var
  var __authTypes: unknown;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthUser;
  }
}

/**
 * A token is a claim; the session and the person behind it are the truth.
 *
 * The JWT alone used to be enough, so signing out, a password reset, revoking
 * a device or deactivating somebody left their access token working until it
 * expired. Each request now also checks that the person is still active and,
 * when the token names its session, that the session has not been revoked or
 * run out. The answer is cached briefly (accessCache: 30 s in production,
 * cleared by any write), so this is one read per person per half-minute, not
 * one per request — users and sessions live in the platform database, whose
 * pool is small.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = String(req.headers.authorization || '').trim();
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) return res.status(401).json({ error: 'Missing token' });

  let userId = '';
  let accountId = '';
  let sid = '';
  try {
    const secret = getJwtSecret();
    if (!secret) return res.status(500).json({ error: 'Server misconfigured: JWT_SECRET missing' });
    const payload = jwt.verify(token, secret, {
      issuer: process.env.JWT_ISSUER || 'accounting',
      audience: process.env.JWT_AUDIENCE || 'accounting-web',
    }) as any;

    userId = String(payload?.userId || '').trim();
    accountId = String(payload?.accountId || '').trim();
    sid = String(payload?.sid || '').trim();
    if (!userId || !accountId) return res.status(401).json({ error: 'Invalid token' });
  } catch {
    return res.status(401).json({ error: 'Invalid/expired token' });
  }

  try {
    const state = await cachedAccess(`auth:${userId}:${sid}`, async () => {
      const user = await platformPrisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
      if (!user || !user.isActive) return 'inactive' as const;
      if (sid) {
        const session = await platformPrisma.session.findUnique({
          where: { id: sid },
          select: { revokedAt: true, expiresAt: true, userId: true },
        });
        if (!session || session.userId !== userId || session.revokedAt || session.expiresAt <= new Date()) {
          return 'ended' as const;
        }
      }
      return 'ok' as const;
    });
    if (state === 'inactive') return res.status(401).json({ error: 'This account is no longer active', code: 'inactive' });
    if (state === 'ended') {
      return res.status(401).json({ error: 'This session has ended. Please sign in again.', code: 'session_ended' });
    }
  } catch (e) {
    return next(e);
  }

  req.auth = sid ? { userId, accountId, sessionId: sid } : { userId, accountId };
  next();
}
