import jwt from 'jsonwebtoken';

import { getJwtSecret } from './auth.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';

/**
 * "Stop these emails" (round 55 pick): every optional email carries a link at
 * its foot that turns off just that kind, for just that address. The link is
 * signed (address + kind, a year), so nobody can stop somebody else's mail by
 * guessing; mail that has to arrive (sign-in, invitations, invoices) is
 * transactional and has no link.
 */
const AUDIENCE = 'clor-email-stop';
const issuer = () => process.env.JWT_ISSUER || 'accounting';
const norm = (email: string) => String(email || '').trim().toLowerCase();

export function emailStopToken(email: string, templateKey: string) {
  return jwt.sign({ typ: 'email-stop', e: norm(email), k: templateKey }, getJwtSecret(), { expiresIn: '365d', issuer: issuer(), audience: AUDIENCE });
}

export function readEmailStopToken(token: string): { email: string; templateKey: string } | null {
  try {
    const p = jwt.verify(token, getJwtSecret(), { issuer: issuer(), audience: AUDIENCE, algorithms: ['HS256'] }) as any;
    return p?.typ === 'email-stop' && p.e && p.k ? { email: String(p.e), templateKey: String(p.k) } : null;
  } catch {
    return null;
  }
}

const apiBase = () => (process.env.API_PUBLIC_URL || process.env.PUBLIC_API_URL || 'https://api.clor.in').replace(/\/$/, '');

/** The link at the foot of the email. */
export const emailStopLink = (email: string, templateKey: string) => `${apiBase()}/api/public/email/stop/${emailStopToken(email, templateKey)}`;

/** The words added at the foot of an optional email. */
export const emailStopFooter = (email: string, templateKey: string) => `\n\n—\nStop these emails: ${emailStopLink(email, templateKey)}`;

/** Has this address stopped this kind? Never throws: a missing table means nobody has. */
export async function emailStopped(email: string, templateKey: string): Promise<boolean> {
  try {
    const row = await outsideTenant('email: stopped?', () => platformPrisma.emailOptOut.findUnique({ where: { email_templateKey: { email: norm(email), templateKey } }, select: { id: true } }));
    return Boolean(row);
  } catch {
    return false;
  }
}

export async function setEmailStopped(email: string, templateKey: string, stopped: boolean) {
  const e = norm(email);
  return outsideTenant('email: stop or start', async () => {
    if (stopped) await platformPrisma.emailOptOut.upsert({ where: { email_templateKey: { email: e, templateKey } }, create: { email: e, templateKey }, update: {} });
    else await platformPrisma.emailOptOut.deleteMany({ where: { email: e, templateKey } });
  });
}
