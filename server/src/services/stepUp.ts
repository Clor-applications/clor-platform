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
