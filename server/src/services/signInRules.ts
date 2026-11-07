import jwt from 'jsonwebtoken';

import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { getJwtSecret } from './auth.js';
import { domainRefusalFor, domainRefusalText, emailDomainAllowed } from './policy.js';
import { adminUserIds } from './roleGuards.js';

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

/**
 * Who the rules never shut out, or only partly:
 * - an account owner (review S3): the person who pays for the account cannot
 *   be locked out of their own companies by a company setting;
 * - someone let in by an outside engagement, such as an accountant or an
 *   auditor (review S2): they work at their own firm's domain by definition,
 *   so the domain rule does not apply to them. A confirmed address still does.
 */
export type Standing = { owner?: boolean; outsider?: boolean };

/** Why this company's rules keep this person out, or null. */
export function entryRefusal(rules: Rules, who: Person, standing: Standing = {}): EntryRefusal | null {
  if (!rules || standing.owner) return null;
  if (!standing.outsider && !emailDomainAllowed(String(who.email || ''), rules.allowedEmailDomains)) {
    return { status: 403, error: domainRefusalText(rules.allowedEmailDomains), code: 'EMAIL_DOMAIN_NOT_ALLOWED' };
  }
  if (rules.requireVerifiedEmail && !who.emailVerifiedAt) return { status: 403, error: NOT_CONFIRMED_TEXT, code: 'EMAIL_NOT_CONFIRMED' };
  return null;
}

/** The person's standing in one account: its owner, and whether they come from another account. */
export async function standingIn(userId: string, accountId: string): Promise<Standing> {
  return outsideTenant('sign-in rules: owner or outsider', async () => {
    const [user, m] = await Promise.all([
      platformPrisma.user.findUnique({ where: { id: userId }, select: { accountId: true } }),
      platformPrisma.accountMembership.findUnique({ where: { accountId_userId: { accountId, userId } }, select: { role: true, status: true } }),
    ]);
    return { owner: m?.role === 'OWNER' && m.status === 'ACTIVE', outsider: !!user && user.accountId !== accountId };
  });
}

/** The same check for one company, reading its rules (the request middleware). */
export async function companyEntryRefusal(userId: string, orgId: string, accountId: string): Promise<EntryRefusal | null> {
  const [rules, who] = await Promise.all([
    platformPrisma.authPolicy.findUnique({ where: { orgId }, select: { requireVerifiedEmail: true, allowedEmailDomains: true } }),
    platformPrisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } }),
  ]);
  if (!who || !rules) return null;
  return entryRefusal(rules, who, await standingIn(userId, accountId));
}

/**
 * At sign-in: which of the person's companies their rules close to them, and
 * the refusal to give when that is every one of them.
 */
export async function signInEntry(userId: string, who: Person): Promise<{ closed: Set<string>; refusal: EntryRefusal | null }> {
  return outsideTenant('sign-in: each company’s rules on who may open it', async () => {
    const memberships = await platformPrisma.userOrgMembership.findMany({ where: { userId }, select: { orgId: true, accountId: true } });
    if (!memberships.length) return { closed: new Set<string>(), refusal: null };
    const [rows, user, owned] = await Promise.all([
      platformPrisma.authPolicy.findMany({
        where: { orgId: { in: memberships.map((m) => m.orgId) } },
        select: { orgId: true, requireVerifiedEmail: true, allowedEmailDomains: true },
      }),
      platformPrisma.user.findUnique({ where: { id: userId }, select: { accountId: true } }),
      platformPrisma.accountMembership.findMany({ where: { userId, role: 'OWNER', status: 'ACTIVE' }, select: { accountId: true } }),
    ]);
    const byOrg = new Map(rows.map((r) => [r.orgId, r]));
    const owns = new Set(owned.map((o) => o.accountId));
    const closed = new Set<string>();
    const reasons: EntryRefusal[] = [];
    for (const m of memberships) {
      const r = entryRefusal(byOrg.get(m.orgId), who, { owner: owns.has(m.accountId), outsider: !!user && user.accountId !== m.accountId });
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

/**
 * The domain check when adding a person who may already have a login (review
 * S2, S3): an owner of the account, or someone from another account let in by
 * an engagement, is not held to the company's domain list.
 */
export async function domainRefusalForPerson(userId: string | null | undefined, accountId: string, orgIds: string[], email: string): Promise<string | null> {
  if (userId) {
    const s = await standingIn(userId, accountId);
    if (s.owner || s.outsider) return null;
  }
  return domainRefusalFor(orgIds, email);
}

export type KeptOut = { userId: string; email: string; fullName: string | null; code: EntryRefusal['code']; admin: boolean };

/**
 * Everyone in this company these rules would keep out (owners and outsiders
 * exempt as above), and whether each administers it. Used before saving, so a
 * company cannot be closed to the people who run it, and after, to say how
 * many it now keeps out.
 */
export async function whoRulesKeepOut(accountId: string, orgId: string, rules: NonNullable<Rules>): Promise<KeptOut[]> {
  return outsideTenant('sign-in rules: who a company policy would keep out', async () => {
    const [members, owners, admins] = await Promise.all([
      platformPrisma.userOrgMembership.findMany({
        where: { accountId, orgId },
        select: { user: { select: { id: true, email: true, fullName: true, emailVerifiedAt: true, isActive: true, accountId: true } } },
      }),
      platformPrisma.accountMembership.findMany({ where: { accountId, role: 'OWNER', status: 'ACTIVE' }, select: { userId: true } }),
      adminUserIds(platformPrisma, accountId, orgId),
    ]);
    const ownerIds = new Set(owners.map((o) => o.userId));
    const out: KeptOut[] = [];
    for (const { user: u } of members) {
      if (!u.isActive) continue;
      const r = entryRefusal(rules, u, { owner: ownerIds.has(u.id), outsider: u.accountId !== accountId });
      if (r) out.push({ userId: u.id, email: u.email, fullName: u.fullName, code: r.code, admin: admins.has(u.id) });
    }
    return out;
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
