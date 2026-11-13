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
  /** An Explore session (the read-only sample company): the pass it came from. Writes are refused (middleware/exploreReadOnly.ts). */
  explorePassId?: string;
  /** Set on a single sign-on session: the only company it opens. */
  ssoOrgId?: string;
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
/** The longest a session's "still signed in" answer is reused on one instance (A-08). */
export const SESSION_LIVENESS_TTL_MS = 5_000;

/** How many refreshes a still-unexpired access token may sit behind (at most a few in its 15 minutes). */
const MAX_ROTATIONS_FOLLOWED = 25;

/**
 * The live session a token's session has become, or null when it has ended.
 *
 * Every CLOR app (people., payroll., attendance. …) keeps its own access token
 * but they share one refresh cookie, so a refresh in one app rotates the session
 * the others' tokens name. Rotation is not an ending: treating it as one meant
 * each app's refresh 401'd every other open app, they refreshed in turn, and
 * the pile-up of races signed the person out (seen in production, 3 Nov 2026).
 * A rotated session is followed to the one it was rotated into; the token lives
 * while that one does, so a sign-out, a password change or reuse detection —
 * which all end the live end of the chain — still end it.
 */
async function liveSessionFor(sid: string, userId: string): Promise<string | null> {
  let id: string | null = sid;
  for (let hop = 0; id && hop <= MAX_ROTATIONS_FOLLOWED; hop += 1) {
    const session: { revokedAt: Date | null; revokedReason: string | null; replacedBySessionId: string | null; expiresAt: Date; userId: string } | null =
      await platformPrisma.session.findUnique({
        where: { id },
        select: { revokedAt: true, revokedReason: true, replacedBySessionId: true, expiresAt: true, userId: true },
      });
    if (!session || session.userId !== userId) return null;
    if (!session.revokedAt) return session.expiresAt > new Date() ? id : null;
    if (session.revokedReason !== 'ROTATED') return null;
    id = session.replacedBySessionId;
  }
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = String(req.headers.authorization || '').trim();
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) return res.status(401).json({ error: 'Missing token' });

  let userId = '';
  let accountId = '';
  let sid = '';
  let xp = '';
  let so = '';
  try {
    const secret = getJwtSecret();
    if (!secret) return res.status(500).json({ error: 'Server misconfigured: JWT_SECRET missing' });
    const payload = jwt.verify(token, secret, {
      issuer: process.env.JWT_ISSUER || 'accounting',
      audience: process.env.JWT_AUDIENCE || 'accounting-web',
      /* Only the algorithm CLOR signs with (A-10). */
      algorithms: ['HS256'],
    }) as any;

    userId = String(payload?.userId || '').trim();
    accountId = String(payload?.accountId || '').trim();
    sid = String(payload?.sid || '').trim();
    xp = String(payload?.xp || '').trim();
    so = String(payload?.so || '').trim();
    if (!userId || !accountId) return res.status(401).json({ error: 'Invalid token' });
  } catch {
    return res.status(401).json({ error: 'Invalid/expired token' });
  }

  try {
    const answer = await cachedAccess(`auth:${userId}:${sid}`, async () => {
      const user = await platformPrisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
      if (!user || !user.isActive) return { state: 'inactive' as const };
      if (!sid) return { state: 'ok' as const };
      const live = await liveSessionFor(sid, userId);
      return live ? { state: 'ok' as const, live } : { state: 'ended' as const };
      /*
       * A-08: this cache lives in each API instance and only the instance that
       * handled a sign-out clears it, so a revoked session or a switched-off
       * person kept working for up to 30 s on the others. Liveness is held for
       * at most 5 s; the heavier permission answers keep the longer cache.
       */
    }, undefined, SESSION_LIVENESS_TTL_MS);
    if (answer.state === 'inactive') return res.status(401).json({ error: 'This account is no longer active', code: 'inactive' });
    if (answer.state === 'ended') {
      return res.status(401).json({ error: 'This session has ended. Please sign in again.', code: 'session_ended' });
    }
    /* The caller's session is the live one: "sign out everywhere else" keeps it, step-up binds to it. */
    if ('live' in answer && answer.live) sid = answer.live;
  } catch (e) {
    return next(e);
  }

  req.auth = sid ? { userId, accountId, sessionId: sid } : { userId, accountId };
  if (xp) req.auth.explorePassId = xp;
  if (so) req.auth.ssoOrgId = so;
  next();
}
