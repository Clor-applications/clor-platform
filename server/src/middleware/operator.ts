import type { Request, Response, NextFunction } from 'express';

/**
 * CLOR's own operators: the people at CLOR who may act on a customer's account
 * from outside it (today, setting a subscription by hand for a free grant or an
 * offline/invoice deal).
 *
 * Being an owner or admin of a company says nothing about this. Every customer
 * has one, and their roles live inside their own account, so no role a customer
 * can hold — or grant themselves — reaches here.
 *
 * CLOR_OPERATOR_USER_IDS is a comma-separated list of platform user ids. Ids,
 * not emails: an id cannot be changed or claimed by somebody else. Read per
 * request so a removal takes effect without a code change. Unset or empty means
 * nobody, in every environment. Runs after requireAuth, so the person is active
 * and their session live.
 */
export function operatorUserIds(): Set<string> {
  return new Set(
    String(process.env.CLOR_OPERATOR_USER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isOperator(userId: string | undefined | null): boolean {
  return !!userId && operatorUserIds().has(userId);
}

export function requireOperator(req: Request, res: Response, next: NextFunction) {
  if (isOperator(req.auth?.userId)) return next();
  return res.status(403).json({ error: 'Only CLOR can change a subscription by hand.', code: 'OPERATOR_ONLY' });
}
