import type { Request, Response, NextFunction } from 'express';

import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';

/**
 * CLOR's own operators: the people at CLOR who may act on a customer's account
 * from outside it — the operator console (W-8.2) and setting a subscription by
 * hand for a free grant or an offline/invoice deal.
 *
 * Being an owner or admin of a company says nothing about this. Every customer
 * has one, and their roles live inside their own account, so no role a customer
 * can hold — or grant themselves — reaches here.
 *
 * Two sources, both outside any customer account:
 * - CLOR_OPERATOR_USER_IDS, a comma-separated list of platform user ids: the
 *   bootstrap super admins. Ids, not emails: an id cannot be changed or claimed
 *   by somebody else. Read per request so a removal takes effect without a code
 *   change. Unset or empty means nobody.
 * - PlatformOperator rows, which a super admin adds and removes in the console.
 *
 * - OperatorInvite rows: an address an owner invited before it had a login.
 *   The first time somebody signs in with that address, confirmed, and opens
 *   the console, the invite becomes their PlatformOperator row.
 *
 * Every operator must sign in with an authenticator app; without one they are
 * refused before anything is read.
 *
 * Roles (the console names them Owner, Sales, Support, Finance, Read-only):
 * - SUPER_ADMIN, Owner: everything, and the only one who manages staff, email
 *   wording and senders, and the app catalogue.
 * - SALES: demo requests, Explore links, trials (extend), making an account.
 * - SUPPORT: customers' users (invites, reset links, sign out), suspend and
 *   resume, demo requests, Explore links, the email log.
 * - BILLING, Finance: subscriptions, plans, trials, pricing, payments, tax,
 *   suspend and resume.
 * - READ_ONLY: sees what the others see, changes nothing (refused here, for
 *   every write, whatever the route says).
 */
export type OperatorRole = 'SUPER_ADMIN' | 'SALES' | 'SUPPORT' | 'BILLING' | 'READ_ONLY';
export const OPERATOR_ROLES: OperatorRole[] = ['SUPER_ADMIN', 'SALES', 'SUPPORT', 'BILLING', 'READ_ONLY'];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * An invite for this user's confirmed address becomes their operator row.
 * Confirmed only: anybody can sign up with an address, so an unconfirmed one
 * proves nothing about who holds the mailbox.
 */
async function claimOperatorInvite(userId: string): Promise<OperatorRole | null> {
  return outsideTenant('operator: claim an invite', async () => {
    const user = await platformPrisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, isActive: true } });
    if (!user?.isActive || !user.emailVerifiedAt) return null;
    const invite = await platformPrisma.operatorInvite.findUnique({ where: { email: user.email.toLowerCase() } });
    if (!invite || invite.claimedAt || invite.revokedAt || !OPERATOR_ROLES.includes(invite.role as OperatorRole)) return null;
    const claimed = await platformPrisma.operatorInvite.updateMany({ where: { id: invite.id, claimedAt: null, revokedAt: null }, data: { claimedAt: new Date(), claimedByUserId: userId } });
    if (!claimed.count) return null;
    await platformPrisma.platformOperator.upsert({
      where: { userId },
      create: { userId, role: invite.role, note: invite.note, createdByUserId: invite.invitedByUserId },
      update: { role: invite.role, active: true },
    });
    await platformPrisma.operatorAuditEvent.create({ data: { operatorUserId: userId, action: 'OPERATOR_INVITE_ACCEPTED', targetUserId: userId, detail: { email: user.email, role: invite.role, invitedBy: invite.invitedByUserId } } });
    return invite.role as OperatorRole;
  });
}

export function operatorUserIds(): Set<string> {
  return new Set(
    String(process.env.CLOR_OPERATOR_USER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** The operator role of a user, or null for everybody who is not Clor staff. */
export async function operatorRole(userId: string | undefined | null): Promise<OperatorRole | null> {
  if (!userId) return null;
  if (operatorUserIds().has(userId)) return 'SUPER_ADMIN';
  const row = await outsideTenant('operator: who is one', () =>
    platformPrisma.platformOperator.findUnique({ where: { userId }, select: { role: true, active: true } }),
  );
  return row?.active && OPERATOR_ROLES.includes(row.role as OperatorRole) ? (row.role as OperatorRole) : null;
}

/**
 * Any operator, signed in with an authenticator. Puts the role on
 * `res.locals.operatorRole` for the routes that narrow it further.
 */
export async function requireOperator(req: Request, res: Response, next: NextFunction) {
  const role = (await operatorRole(req.auth?.userId)) || (req.auth?.userId ? await claimOperatorInvite(req.auth.userId) : null);
  if (!role) return res.status(403).json({ error: 'This is for CLOR staff only.', code: 'OPERATOR_ONLY' });
  const user = await platformPrisma.user.findUnique({ where: { id: req.auth!.userId }, select: { totpEnabledAt: true, isActive: true } });
  if (!user?.isActive) return res.status(403).json({ error: 'This is for CLOR staff only.', code: 'OPERATOR_ONLY' });
  if (!user.totpEnabledAt) {
    return res.status(403).json({ error: 'CLOR operators must sign in with an authenticator app. Set one up in My profile first.', code: 'TWO_FACTOR_SETUP_REQUIRED' });
  }
  /* Read-only looks and changes nothing, on every route, whatever that route's own check says. */
  if (role === 'READ_ONLY' && !READS.has(req.method)) {
    return res.status(403).json({ error: 'Your role is read-only: you can look, not change anything. Ask the owner if you need to.', code: 'OPERATOR_ROLE' });
  }
  res.locals.operatorRole = role;
  return next();
}

/**
 * Any operator who has not set up an authenticator yet: only for the two
 * routes that set one up (routes/ops.ts). Everything requireOperator checks
 * except the authenticator itself — that is what they are here to add.
 */
export async function requireOperatorToEnrol(req: Request, res: Response, next: NextFunction) {
  const role = (await operatorRole(req.auth?.userId)) || (req.auth?.userId ? await claimOperatorInvite(req.auth.userId) : null);
  if (!role) return res.status(403).json({ error: 'This is for CLOR staff only.', code: 'OPERATOR_ONLY' });
  const user = await platformPrisma.user.findUnique({ where: { id: req.auth!.userId }, select: { isActive: true, totpEnabledAt: true } });
  if (!user?.isActive) return res.status(403).json({ error: 'This is for CLOR staff only.', code: 'OPERATOR_ONLY' });
  if (user.totpEnabledAt) return res.status(409).json({ error: 'An authenticator is already set up.', code: 'ALREADY_ENABLED' });
  res.locals.operatorRole = role;
  return next();
}

/** Only these operator roles (after requireOperator). */
export const requireOperatorRole =
  (...roles: OperatorRole[]) =>
  (_req: Request, res: Response, next: NextFunction) => {
    const role = res.locals.operatorRole as OperatorRole | undefined;
    if (role && (role === 'SUPER_ADMIN' || roles.includes(role))) return next();
    return res.status(403).json({ error: 'Your role does not allow this. Ask the owner if you need to.', code: 'OPERATOR_ROLE' });
  };
