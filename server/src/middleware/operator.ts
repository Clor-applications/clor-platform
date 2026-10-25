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
 * Every operator must sign in with an authenticator app; without one they are
 * refused before anything is read.
 */
export type OperatorRole = 'SUPER_ADMIN' | 'SUPPORT' | 'BILLING';
export const OPERATOR_ROLES: OperatorRole[] = ['SUPER_ADMIN', 'SUPPORT', 'BILLING'];

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

/** Kept for the subscription route's callers: true for any operator. */
export async function isOperator(userId: string | undefined | null): Promise<boolean> {
  return (await operatorRole(userId)) !== null;
}

/**
 * Any operator, signed in with an authenticator. Puts the role on
 * `res.locals.operatorRole` for the routes that narrow it further.
 */
export async function requireOperator(req: Request, res: Response, next: NextFunction) {
  const role = await operatorRole(req.auth?.userId);
  if (!role) return res.status(403).json({ error: 'This is for Clor staff only.', code: 'OPERATOR_ONLY' });
  const user = await platformPrisma.user.findUnique({ where: { id: req.auth!.userId }, select: { totpEnabledAt: true, isActive: true } });
  if (!user?.isActive) return res.status(403).json({ error: 'This is for Clor staff only.', code: 'OPERATOR_ONLY' });
  if (!user.totpEnabledAt) {
    return res.status(403).json({ error: 'Clor operators must sign in with an authenticator app. Set one up in My profile first.', code: 'TWO_FACTOR_SETUP_REQUIRED' });
  }
  res.locals.operatorRole = role;
  return next();
}

/** Only these operator roles (after requireOperator). */
export const requireOperatorRole =
  (...roles: OperatorRole[]) =>
  (_req: Request, res: Response, next: NextFunction) => {
    const role = res.locals.operatorRole as OperatorRole | undefined;
    if (role && (role === 'SUPER_ADMIN' || roles.includes(role))) return next();
    return res.status(403).json({ error: 'Your operator role does not allow this.', code: 'OPERATOR_ROLE' });
  };
