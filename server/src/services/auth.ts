import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

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
  return process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-secret');
}

export function signAccessToken(payload: { userId: string; accountId: string; sid?: string }) {
  const secret = getJwtSecret();
  if (!secret) throw new Error('Server misconfigured: JWT_SECRET missing');
  return jwt.sign(payload, secret, {
    expiresIn: ACCESS_TOKEN_TTL as any,
    issuer: process.env.JWT_ISSUER || 'accounting',
    audience: process.env.JWT_AUDIENCE || 'accounting-web',
  });
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Constant-time comparison, so a wrong token cannot be found byte by byte. */
export function safeEquals(a: string, b: string) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function createSession(opts: {
  accountId: string;
  userId: string;
  ip?: string;
  userAgent?: string;
}) {
  const refreshToken = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  const session = await platformPrisma.session.create({
    data: {
      accountId: opts.accountId,
      userId: opts.userId,
      refreshTokenHash: sha256(refreshToken),
      ip: opts.ip || null,
      userAgent: opts.userAgent ? String(opts.userAgent).slice(0, 300) : null,
      expiresAt,
    },
  });

  return { session, refreshToken };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

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
    await platformPrisma.session.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
    });
    await recordAuthEvent({
      accountId: session.accountId,
      userId: session.userId,
      eventType: 'SESSION_REVOKED',
      detail: 'Refresh token reuse detected; all sessions revoked',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    throw new AuthError('Session is no longer valid. Please sign in again.');
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw new AuthError('Session expired. Please sign in again.');
  }

  const user = await platformPrisma.user.findFirst({
    where: { id: session.userId, isActive: true },
    select: { id: true, accountId: true },
  });
  if (!user) throw new AuthError('Account is no longer active');

  const next = await createSession({
    accountId: session.accountId,
    userId: session.userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  await platformPrisma.session.update({
    where: { id: session.id },
    data: {
      revokedAt: new Date(),
      revokedReason: 'ROTATED',
      replacedBySessionId: next.session.id,
      lastSeenAt: new Date(),
    },
  });

  return {
    accessToken: signAccessToken({ userId: user.id, accountId: user.accountId, sid: next.session.id }),
    refreshToken: next.refreshToken,
    session: next.session,
  };
}

export async function revokeSession(refreshToken: string, reason = 'LOGOUT') {
  const hash = sha256(String(refreshToken || ''));
  const session = await platformPrisma.session.findUnique({ where: { refreshTokenHash: hash } });
  if (!session || session.revokedAt) return null;
  return platformPrisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export async function revokeAllSessions(userId: string, reason: string) {
  return platformPrisma.session.updateMany({
    where: { userId, revokedAt: null },
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

export async function issuePasswordResetToken(user: { id: string; accountId: string }, ip?: string) {
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
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      requestedIp: ip || null,
    },
  });

  return token;
}

export async function consumePasswordResetToken(token: string) {
  const row = await platformPrisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(String(token || '')) } });
  if (!row) throw new AuthError('Invalid or expired reset link', 400);
  if (row.usedAt) throw new AuthError('That reset link has already been used', 400);
  if (row.expiresAt.getTime() < Date.now()) throw new AuthError('That reset link has expired', 400);

  await platformPrisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
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

  await platformPrisma.emailVerificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
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

export const clientIp = (req: any) =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || undefined;
