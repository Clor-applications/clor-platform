import { createHash, randomBytes } from 'crypto';
import { signInEntry } from './signInRules.js';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { isDevOrTest } from '../utils/devMode.js';
import { sessionPolicyFor } from './policy.js';

/**
 * Session and credential handling.
 *
 * Two token types, deliberately different:
 *  - an access token: a short-lived JWT, never stored server-side, checked on
 *    every request;
 *  - a refresh token: a long random string, stored only as a SHA-256 hash, and
 *    rotated on every use so a stolen one becomes detectable.
 *
 * Logout and "revoke this device" work because the refresh side is stateful.
 * The access token still lives out its few minutes, which is the trade for not
 * hitting the database on every request.
 */

export const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRES_IN || '15m';
export const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS || 30);

export const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS || 8);
export const LOCKOUT_MINUTES = Number(process.env.LOCKOUT_MINUTES || 15);

export function getJwtSecret() {
  return process.env.JWT_SECRET || (isDevOrTest() ? 'dev-secret' : '');
}

/**
 * `minutes` is the access-token lifetime the person's companies ask for
 * (AuthPolicy.accessTokenMinutes, the strictest of them — services/policy.ts
 * sessionPolicyFor). Absent, the deployment's JWT_EXPIRES_IN.
 */
/** `xp`: the Explore pass an Explore session came from (services/explore.ts); its holder may only read (middleware/exploreReadOnly.ts). */
export function signAccessToken(payload: { userId: string; accountId: string; sid?: string; xp?: string }, minutes?: number) {
  const secret = getJwtSecret();
  if (!secret) throw new Error('Server misconfigured: JWT_SECRET missing');
  return jwt.sign(payload, secret, {
    expiresIn: (minutes && minutes > 0 ? minutes * 60 : ACCESS_TOKEN_TTL) as any,
    issuer: process.env.JWT_ISSUER || 'accounting',
    audience: process.env.JWT_AUDIENCE || 'accounting-web',
  });
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * A new session. `days` is how long the person's companies let a sign-in
 * last (AuthPolicy.sessionDays); `notAfter` caps it, so a rotated session
 * keeps the end its sign-in was given instead of starting a fresh 30 days.
 */
export async function createSession(opts: {
  accountId: string;
  userId: string;
  ip?: string;
  userAgent?: string;
  days?: number;
  notAfter?: Date;
  /** An Explore session: the pass it came from, carried through every rotation. */
  explorePassId?: string | null;
}) {
  const refreshToken = randomBytes(48).toString('base64url');
  const days = opts.days && opts.days > 0 ? opts.days : REFRESH_TOKEN_DAYS;
  let expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  if (opts.notAfter && opts.notAfter < expiresAt) expiresAt = opts.notAfter;

  const session = await platformPrisma.session.create({
    data: {
      accountId: opts.accountId,
      userId: opts.userId,
      refreshTokenHash: sha256(refreshToken),
      ip: opts.ip || null,
      userAgent: opts.userAgent ? String(opts.userAgent).slice(0, 300) : null,
      expiresAt,
      ...(opts.explorePassId ? { explorePassId: opts.explorePassId } : {}),
    },
  });

  return { session, refreshToken };
}

export class AuthError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 401, code?: string) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    if (code) this.code = code;
  }
}

/** How long after a rotation a second presentation of the old token is a race between tabs, not theft. */
const ROTATION_GRACE_MS = 10_000;

/**
 * Exchanges a refresh token for a new pair, rotating the session.
 *
 * If a token that has already been rotated is presented, every session for that
 * user is revoked: either the token was stolen, or the real user's was. Ending
 * all sessions is the safe response to an ambiguous signal.
 */
export async function rotateSession(refreshToken: string, ctx: { ip?: string; userAgent?: string }) {
  const hash = sha256(String(refreshToken || ''));
  const session = await platformPrisma.session.findUnique({ where: { refreshTokenHash: hash } });

  if (!session) throw new AuthError('Invalid session');

  if (session.revokedAt) {
    if (session.revokedReason === 'ROTATED' && Date.now() - session.revokedAt.getTime() < ROTATION_GRACE_MS) {
      throw new AuthError('This session was just refreshed in another tab.', 409, 'refresh_raced');
    }
    /*
     * Only a token that was rotated says someone else holds a copy. A session
     * ended for any other reason (signed out, password changed, left) is over
     * already, and its own browser still sends the cookie for a moment: a page
     * that signs out while other requests are in flight gets 401s back, and
     * each one tries a refresh with the cookie the sign-out has not cleared
     * yet. Treating that as theft signed the person out on every other device
     * (seen in CI: Kavya's other sessions all ended a second after B3 signed
     * out one of hers).
     */
    if (session.revokedReason !== 'ROTATED') await refuseEnded(session, session.revokedReason, ctx);
    await revokeFamily(session, ctx);
    throw new AuthError('Session is no longer valid. Please sign in again.');
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw new AuthError('Session expired. Please sign in again.');
  }

  const user = await platformPrisma.user.findFirst({
    where: { id: session.userId, isActive: true },
    select: { id: true, accountId: true, email: true, emailVerifiedAt: true },
  });
  if (!user) throw new AuthError('Account is no longer active');

  /* An Explore session lives only while its pass does: an operator's End access, or the pass running out, ends it here too. */
  if (session.explorePassId) {
    const pass = await platformPrisma.explorePass.findUnique({ where: { id: session.explorePassId }, select: { revokedAt: true, expiresAt: true } });
    if (!pass || pass.revokedAt || pass.expiresAt.getTime() < Date.now()) throw new AuthError('This link has ended.', 401, 'EXPLORE_ENDED');
  }

  /* Review N5: a refresh is a sign-in without the password; if no company's rules let the person in now, it is refused like one. */
  const entry = await signInEntry(user.id, user);
  if (entry.refusal) throw new AuthError(entry.refusal.error, 403, entry.refusal.code);

  /*
   * A-06: claim the old session before issuing the next one. Reading
   * "not revoked" and then revoking were two steps, so two refreshes with the
   * same token both passed and forked the session past reuse detection.
   * Exactly one claim can succeed now.
   */
  const claimed = await platformPrisma.session.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'ROTATED', lastSeenAt: new Date() },
  });
  if (claimed.count !== 1) {
    const now = await platformPrisma.session.findUnique({ where: { id: session.id }, select: { revokedAt: true, revokedReason: true } });
    /* Two tabs refreshing together share one cookie: the loser is told to try again with the new one, not treated as a thief. */
    if (now?.revokedReason === 'ROTATED' && now.revokedAt && Date.now() - now.revokedAt.getTime() < ROTATION_GRACE_MS) {
      throw new AuthError('This session was just refreshed in another tab.', 409, 'refresh_raced');
    }
    /* Signed out (or ended otherwise) between the read and the claim: refused, nothing else ended (see above). */
    if (now?.revokedReason !== 'ROTATED') await refuseEnded(session, now?.revokedReason ?? null, ctx);
    await revokeFamily(session, ctx);
    throw new AuthError('Session is no longer valid. Please sign in again.');
  }

  /*
   * #4: the next session keeps the end its sign-in was given, and the
   * companies' rule as it stands now may only bring that closer: a session
   * no longer gains another 30 days on every refresh, and shortening "Stay
   * signed in for" reaches sessions already open at their next refresh.
   */
  const policy = await sessionPolicyFor(session.userId);
  const next = await createSession({
    accountId: session.accountId,
    userId: session.userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    days: policy.sessionDays,
    notAfter: session.expiresAt,
    explorePassId: session.explorePassId,
  });
  await platformPrisma.session.update({ where: { id: session.id }, data: { replacedBySessionId: next.session.id } });

  return {
    accessToken: signAccessToken({ userId: user.id, accountId: user.accountId, sid: next.session.id, ...(session.explorePassId ? { xp: session.explorePassId } : {}) }, policy.accessTokenMinutes),
    refreshToken: next.refreshToken,
    session: next.session,
  };
}

type SessionRow = { id: string; accountId: string; userId: string };

/**
 * A rotated token presented again, past the tab-race grace: someone else holds
 * a copy (or the real person's copy was taken). Every session the person has
 * ends, and the audit log says why.
 */
async function revokeFamily(session: SessionRow, ctx: { ip?: string; userAgent?: string }) {
  const ended = await platformPrisma.session.updateMany({
    where: { userId: session.userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
  });
  await recordAuthEvent({
    accountId: session.accountId,
    userId: session.userId,
    eventType: 'SESSION_REVOKED',
    detail: `Refresh token reuse detected; all sessions revoked (${ended.count})`,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

/**
 * A token from a session that ended for a reason other than rotation:
 * refused, nothing else ended. A sign-out's own stragglers are normal and not
 * logged; anything else (password changed, signed out everywhere, left) is,
 * with the reason, so a token turning up after its session was ended on
 * purpose can be seen.
 */
async function refuseEnded(session: SessionRow, reason: string | null, ctx: { ip?: string; userAgent?: string }): Promise<never> {
  if (reason !== 'LOGOUT') {
    await recordAuthEvent({
      accountId: session.accountId,
      userId: session.userId,
      eventType: 'REFRESH_REFUSED',
      detail: reason || 'ended',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }
  throw new AuthError('Session is no longer valid. Please sign in again.');
}

export async function revokeSession(refreshToken: string, reason = 'LOGOUT', ctx: { ip?: string; userAgent?: string } = {}) {
  const hash = sha256(String(refreshToken || ''));
  const session = await platformPrisma.session.findUnique({ where: { refreshTokenHash: hash } });
  if (!session) return null;
  if (session.revokedAt) {
    if (session.revokedReason !== 'ROTATED') return null;
    /*
     * Signing out with a token that was already rotated. Within the grace this
     * is the same browser racing its own refresh: end the session it was
     * rotated into, so the sign-out still signs this browser out. Past it, the
     * rotated copy is in someone else's hands (the same signal as a refresh):
     * every session ends.
     */
    if (Date.now() - session.revokedAt.getTime() >= ROTATION_GRACE_MS) {
      await revokeFamily(session, ctx);
      return null;
    }
    let nextId = session.replacedBySessionId;
    for (let hops = 0; nextId && hops < 5; hops += 1) {
      const next = await platformPrisma.session.findUnique({ where: { id: nextId } });
      if (!next) return null;
      if (!next.revokedAt) {
        return platformPrisma.session.update({ where: { id: next.id }, data: { revokedAt: new Date(), revokedReason: reason } });
      }
      nextId = next.replacedBySessionId;
    }
    return null;
  }
  return platformPrisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

/**
 * Ends a person's sessions. `keepSessionId` spares the one making the request:
 * "sign out everywhere else" and a password change should not sign out the
 * device that asked (it used to, about fifteen minutes later, when its access
 * token ran out and the refresh was refused). A reset by email keeps none.
 */
export async function revokeAllSessions(userId: string, reason: string, keepSessionId?: string) {
  return platformPrisma.session.updateMany({
    where: { userId, revokedAt: null, ...(keepSessionId ? { NOT: { id: keepSessionId } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export async function listSessions(accountId: string, userId: string) {
  return platformPrisma.session.findMany({
    where: { accountId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
  });
}

// ---------------------------------------------------------------------------
// Lockout
// ---------------------------------------------------------------------------

export function lockoutRemainingMs(lockedUntil: Date | null | undefined) {
  if (!lockedUntil) return 0;
  return Math.max(0, lockedUntil.getTime() - Date.now());
}

export async function registerFailedLogin(
  userId: string,
  maxFailed = MAX_FAILED_LOGINS,
  lockoutMinutes = LOCKOUT_MINUTES
) {
  const user = await platformPrisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });

  if (user.failedLoginCount >= maxFailed) {
    await platformPrisma.user.update({
      where: { id: userId },
      data: {
        lockedUntil: new Date(Date.now() + lockoutMinutes * 60 * 1000),
        failedLoginCount: 0,
      },
    });
    return { locked: true };
  }
  return { locked: false, remaining: maxFailed - user.failedLoginCount };
}

export async function clearFailedLogins(userId: string) {
  await platformPrisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/** ttlMs: 30 minutes for a reset someone asked for; longer for the set-password link of an account made for them (services/accountProvisioning.ts). */
export async function issuePasswordResetToken(user: { id: string; accountId: string }, ip?: string, ttlMs = 30 * 60 * 1000) {
  // Any earlier token is spent: requesting a new link must invalidate the old.
  await platformPrisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = randomBytes(32).toString('base64url');
  await platformPrisma.passwordResetToken.create({
    data: {
      accountId: user.accountId,
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + ttlMs),
      requestedIp: ip || null,
    },
  });

  return token;
}

/** The reset link's row if it is still usable, without using it up; null otherwise. */
export async function peekPasswordResetToken(token: string) {
  const row = await platformPrisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(String(token || '')) } });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

export async function consumePasswordResetToken(token: string) {
  const row = await platformPrisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(String(token || '')) } });
  if (!row) throw new AuthError('Invalid or expired reset link', 400);
  if (row.usedAt) throw new AuthError('That reset link has already been used', 400);
  if (row.expiresAt.getTime() < Date.now()) throw new AuthError('That reset link has expired', 400);

  /* Used once: two requests with the same link cannot both pass (A-06). */
  const used = await platformPrisma.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) throw new AuthError('That reset link has already been used', 400);
  return row;
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function issueEmailVerificationToken(user: { id: string; accountId: string; email: string }) {
  await platformPrisma.emailVerificationToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = randomBytes(32).toString('base64url');
  await platformPrisma.emailVerificationToken.create({
    data: {
      accountId: user.accountId,
      userId: user.id,
      email: user.email,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

export async function consumeEmailVerificationToken(token: string) {
  const row = await platformPrisma.emailVerificationToken.findUnique({
    where: { tokenHash: sha256(String(token || '')) },
  });
  if (!row) throw new AuthError('Invalid or expired verification link', 400);
  if (row.usedAt) throw new AuthError('That link has already been used', 400);
  if (row.expiresAt.getTime() < Date.now()) throw new AuthError('That verification link has expired', 400);

  const used = await platformPrisma.emailVerificationToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) throw new AuthError('That link has already been used', 400);
  await platformPrisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
  return row;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function recordAuthEvent(e: {
  accountId?: string | null;
  userId?: string | null;
  email?: string | null;
  eventType: string;
  ip?: string;
  userAgent?: string;
  detail?: string;
}) {
  try {
    await platformPrisma.authEvent.create({
      data: {
        accountId: e.accountId ?? null,
        userId: e.userId ?? null,
        email: e.email ? String(e.email).toLowerCase() : null,
        eventType: e.eventType,
        ip: e.ip || null,
        userAgent: e.userAgent ? String(e.userAgent).slice(0, 300) : null,
        detail: e.detail || null,
      },
    });
  } catch {
    // Never let audit writing break a sign-in.
  }
}

/** The client's address, as `trust proxy` resolves it (app.ts) — never a raw header a client can write. */
export const clientIp = (req: any) => String(req.ip || '').trim() || undefined;
