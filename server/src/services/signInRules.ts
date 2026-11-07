import jwt from 'jsonwebtoken';

import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { getJwtSecret } from './auth.js';
import { domainRefusalText, emailDomainAllowed } from './policy.js';

/**
 * #4: two of a company's sign-in rules decide who may open it at all —
 * "Require a confirmed email address" and "Allowed email domains". They were
 * saved and shown, and nothing read them.
 *
 * Both are the company's rule, not the person's: someone who belongs to two
 * companies and is refused by one still opens the other. So they are checked
 * per company — when the companies offered at sign-in are listed, and on
 * every request into a company (middleware/tenantContext.ts) — and a sign-in
 * is refused only when no company the person belongs to would let them in.
 */

export type EntryRefusal = { status: 403; error: string; code: 'EMAIL_NOT_CONFIRMED' | 'EMAIL_DOMAIN_NOT_ALLOWED' };
type Rules = { requireVerifiedEmail: boolean; allowedEmailDomains: string | null } | null | undefined;
type Person = { email: string | null; emailVerifiedAt: Date | null };

export const NOT_CONFIRMED_TEXT = 'This company asks everyone to confirm their email address before signing in. Open the link CLOR sent you, or ask for a new one.';

/** Why this company's rules keep this person out, or null. */
export function entryRefusal(rules: Rules, who: Person): EntryRefusal | null {
  if (!rules) return null;
  if (!emailDomainAllowed(String(who.email || ''), rules.allowedEmailDomains)) {
    return { status: 403, error: domainRefusalText(rules.allowedEmailDomains), code: 'EMAIL_DOMAIN_NOT_ALLOWED' };
  }
  if (rules.requireVerifiedEmail && !who.emailVerifiedAt) return { status: 403, error: NOT_CONFIRMED_TEXT, code: 'EMAIL_NOT_CONFIRMED' };
  return null;
}

/** The same check for one company, reading its rules (the request middleware). */
export async function companyEntryRefusal(userId: string, orgId: string): Promise<EntryRefusal | null> {
  const [rules, who] = await Promise.all([
    platformPrisma.authPolicy.findUnique({ where: { orgId }, select: { requireVerifiedEmail: true, allowedEmailDomains: true } }),
    platformPrisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } }),
  ]);
  return who ? entryRefusal(rules, who) : null;
}

/**
 * At sign-in: which of the person's companies their rules close to them, and
 * the refusal to give when that is every one of them.
 */
export async function signInEntry(userId: string, who: Person): Promise<{ closed: Set<string>; refusal: EntryRefusal | null }> {
  return outsideTenant('sign-in: each company’s rules on who may open it', async () => {
    const memberships = await platformPrisma.userOrgMembership.findMany({ where: { userId }, select: { orgId: true } });
    if (!memberships.length) return { closed: new Set<string>(), refusal: null };
    const rows = await platformPrisma.authPolicy.findMany({
      where: { orgId: { in: memberships.map((m) => m.orgId) } },
      select: { orgId: true, requireVerifiedEmail: true, allowedEmailDomains: true },
    });
    const byOrg = new Map(rows.map((r) => [r.orgId, r]));
    const closed = new Set<string>();
    const reasons: EntryRefusal[] = [];
    for (const m of memberships) {
      const r = entryRefusal(byOrg.get(m.orgId), who);
      if (r) {
        closed.add(m.orgId);
        reasons.push(r);
      }
    }
    if (closed.size < memberships.length) return { closed, refusal: null };
    /* Confirming the address is something the person can do now; say that first. */
    return { closed, refusal: reasons.find((r) => r.code === 'EMAIL_NOT_CONFIRMED') || reasons[0] };
  });
}

/*
 * A refused sign-in for an unconfirmed address comes back with a short-lived
 * token that asks for a new link. It is given only after the right password,
 * so it tells nobody probing the form whether an address has a login.
 */
const RESEND_AUDIENCE = 'clor-verify-resend';
const RESEND_TTL_S = 15 * 60;

export const resendChallengeFor = (userId: string) => jwt.sign({ typ: 'verify-resend', uid: userId }, getJwtSecret(), { expiresIn: RESEND_TTL_S, audience: RESEND_AUDIENCE });

export function resendChallengeUser(raw: string): string | null {
  try {
    const c: any = jwt.verify(String(raw || ''), getJwtSecret(), { audience: RESEND_AUDIENCE, algorithms: ['HS256'] });
    return c?.typ === 'verify-resend' && c.uid ? String(c.uid) : null;
  } catch {
    return null;
  }
}
