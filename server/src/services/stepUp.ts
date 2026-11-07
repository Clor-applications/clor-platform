import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { platformPrisma } from '../utils/platformPrisma.js';
import { getJwtSecret } from './auth.js';

/**
 * Step-up: a fresh authenticator code before an action that moves money.
 *
 * Signing in proves who somebody was this morning; a stolen laptop or a
 * session left open is still signed in. Where an organisation asks for it
 * (AuthPolicy.requirePayrollStepUp), approving a pay run, a bank account
 * change, a settlement or a payment needs a code typed in the last fifteen
 * minutes. The code buys a short token, sent back as `X-Step-Up`; its audience
 * is not the access token's, so neither can stand in for the other.
 */

export const STEP_UP_MINUTES = 15;
const AUDIENCE = 'clor-step-up';
const issuer = () => process.env.JWT_ISSUER || 'accounting';

export function issueStepUp(userId: string, sid: string | undefined) {
  const expiresAt = new Date(Date.now() + STEP_UP_MINUTES * 60_000);
  const token = jwt.sign({ typ: 'stepup', userId, sid: sid || '' }, getJwtSecret(), { expiresIn: STEP_UP_MINUTES * 60, issuer: issuer(), audience: AUDIENCE });
  return { token, expiresAt };
}

function validFor(req: Request) {
  const raw = String(req.headers['x-step-up'] || '').trim();
  if (!raw) return false;
  try {
    const p = jwt.verify(raw, getJwtSecret(), { issuer: issuer(), audience: AUDIENCE, algorithms: ['HS256'] }) as any;
    return p?.typ === 'stepup' && p.userId === req.auth?.userId && (!p.sid || !req.auth?.sessionId || p.sid === req.auth.sessionId);
  } catch {
    return false;
  }
}

/** Whether this request carries a fresh step-up for the signed-in person (A-17 uses it outside any company). */
export const hasValidStepUp = (req: Request) => validFor(req);

/**
 * CLOR operators change any customer's subscription (A-17). That is too
 * much reach for a password alone: the operator must have an authenticator
 * and must have used it in the last few minutes (POST .../security/step-up
 * in any company they belong to), whatever any company's own policy says.
 */
export async function requireOperatorStepUp(req: Request, res: Response, next: NextFunction) {
  const refused = await stepUpRefusal(req, 'CLOR operators must sign in with an authenticator app. Set one up first.');
  return refused ? res.status(refused.status).json(refused.body) : next();
}

/**
 * Why an action that always needs a fresh authenticator code must wait, or
 * null when the code is there. Unlike payroll, not a company's choice: used
 * for acts nobody can undo (closing a company, A-21) or with reach beyond one
 * company (operators, A-17).
 */
export async function stepUpRefusal(req: Request, noAuthenticator: string) {
  const user = await platformPrisma.user.findUnique({ where: { id: req.auth!.userId }, select: { totpEnabledAt: true } });
  if (!user?.totpEnabledAt) return { status: 403, body: { error: noAuthenticator, code: 'TWO_FACTOR_SETUP_REQUIRED' } };
  if (!validFor(req)) return { status: 403, body: { error: 'Enter the code from your authenticator app to continue.', code: 'STEP_UP_REQUIRED' } };
  return null;
}

/**
 * W-5.2's rule for changes that hand out access in bulk — making someone an
 * administrator, single sign-on, directory sync: where the person making the
 * change has an authenticator, it takes a fresh code (the client asks and
 * retries). Someone with none is not stopped, as for an administrator grant;
 * the change is in the audit either way. Null when it may go ahead.
 */
export async function stepUpIfHeld(req: Request, message = 'Enter the code from your authenticator app to change this.') {
  const user = await platformPrisma.user.findUnique({ where: { id: req.auth!.userId }, select: { totpEnabledAt: true } });
  if (user?.totpEnabledAt && !validFor(req)) return { status: 403, body: { error: message, code: 'STEP_UP_REQUIRED' } };
  return null;
}

/** Route guard; passes straight through where the organisation has not switched it on. */
export async function requirePayrollStepUp(req: Request, res: Response, next: NextFunction) {
  const orgId = req.tenant?.orgId;
  if (!orgId || !req.auth?.userId) return next();
  const policy = await platformPrisma.authPolicy.findUnique({ where: { orgId }, select: { requirePayrollStepUp: true } });
  if (!policy?.requirePayrollStepUp || validFor(req)) return next();
  const user = await platformPrisma.user.findUnique({ where: { id: req.auth.userId }, select: { totpEnabledAt: true } });
  if (!user?.totpEnabledAt) {
    return res.status(403).json({
      error: 'Your company asks for an authenticator code for this. Set one up in your profile first (your name or picture, top right).',
      code: 'TWO_FACTOR_SETUP_REQUIRED',
    });
  }
  return res.status(403).json({ error: 'Enter the code from your authenticator app to continue.', code: 'STEP_UP_REQUIRED' });
}
