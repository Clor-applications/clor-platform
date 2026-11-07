import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { isCommonPassword } from './commonPasswords.js';
import { outsideTenant } from '../utils/tenantScope.js';

/**
 * The security policy an organisation enforces.
 *
 * Environment variables remain the fallback so a deployment without any stored
 * policy still behaves sensibly, but the stored row wins: in a multi-tenant
 * product one customer's lockout rule cannot be another's.
 */
export type Policy = {
  maxFailedLogins: number;
  lockoutMinutes: number;
  sessionDays: number;
  accessTokenMinutes: number;
  passwordMinLength: number;
  passwordRequireMixedCase: boolean;
  passwordRequireNumber: boolean;
  passwordRequireSymbol: boolean;
  requireVerifiedEmail: boolean;
  allowedEmailDomains: string | null;
  requirePayrollStepUp: boolean;
  requireAdminTwoFactor: boolean;
  /** A-13: who may approve their own work — 'AUTO' | 'STRICT' | 'ALLOW'. */
  makerChecker: string;
};

/** JWT_EXPIRES_IN ('15m', '12h', '900') in minutes; 15 when unset or unreadable. */
export function envAccessMinutes(raw = process.env.JWT_EXPIRES_IN): number {
  const m = /^\s*(\d+)\s*([smhd]?)\s*$/i.exec(String(raw || ''));
  if (!m) return 15;
  const n = Number(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  const minutes = unit === 's' ? n / 60 : unit === 'm' ? n : unit === 'h' ? n * 60 : n * 1440;
  return minutes >= 1 ? Math.round(minutes) : 15;
}

/**
 * The longest a sign-in may last: the refresh token's own lifetime. A saved
 * "Stay signed in for" above it (the form used to allow 365) is read as this.
 */
export const SESSION_DAYS_CAP = Number(process.env.REFRESH_TOKEN_DAYS || 30);
const capDays = (d: number) => Math.min(d, SESSION_DAYS_CAP);

export const DEFAULT_POLICY: Policy = {
  maxFailedLogins: Number(process.env.MAX_FAILED_LOGINS || 8),
  lockoutMinutes: Number(process.env.LOCKOUT_MINUTES || 15),
  sessionDays: SESSION_DAYS_CAP,
  accessTokenMinutes: envAccessMinutes(),
  passwordMinLength: 8,
  passwordRequireMixedCase: false,
  passwordRequireNumber: false,
  passwordRequireSymbol: false,
  requireVerifiedEmail: false,
  allowedEmailDomains: null,
  requirePayrollStepUp: false,
  requireAdminTwoFactor: false,
  makerChecker: 'AUTO',
};

export async function getAuthPolicy(accountId: string, orgId: string): Promise<Policy> {
  const row = await platformPrisma.authPolicy.findUnique({ where: { orgId } });
  if (!row) return { ...DEFAULT_POLICY };
  return {
    maxFailedLogins: row.maxFailedLogins,
    lockoutMinutes: row.lockoutMinutes,
    sessionDays: capDays(row.sessionDays),
    accessTokenMinutes: row.accessTokenMinutes,
    passwordMinLength: row.passwordMinLength,
    passwordRequireMixedCase: row.passwordRequireMixedCase,
    passwordRequireNumber: row.passwordRequireNumber,
    passwordRequireSymbol: row.passwordRequireSymbol,
    requireVerifiedEmail: row.requireVerifiedEmail,
    allowedEmailDomains: row.allowedEmailDomains,
    requirePayrollStepUp: row.requirePayrollStepUp,
    requireAdminTwoFactor: row.requireAdminTwoFactor,
    makerChecker: ['AUTO', 'STRICT', 'ALLOW'].includes(row.makerChecker) ? row.makerChecker : 'AUTO',
  };
}

/**
 * Finds the policy for a user without knowing which org is active: a login
 * happens before an org is chosen, so the strictest policy across the user's
 * organisations applies.
 */
export async function policyForUser(accountId: string, userId: string): Promise<Policy> {
  const memberships = await platformPrisma.userOrgMembership.findMany({
    where: { accountId, userId },
    select: { orgId: true },
  });
  if (!memberships.length) return { ...DEFAULT_POLICY };

  const rows = await platformPrisma.authPolicy.findMany({
    where: { orgId: { in: memberships.map((m) => m.orgId) } },
  });
  return strictestOf(rows);
}

type PolicyRow = Omit<Policy, 'makerChecker'> & { makerChecker: string };

/** The strictest of several companies' rules; the product's defaults where none has a row. */
export function strictestOf(rows: PolicyRow[]): Policy {
  if (!rows.length) return { ...DEFAULT_POLICY };
  return rows.reduce<Policy>(
    (strictest, r) => ({
      maxFailedLogins: Math.min(strictest.maxFailedLogins, r.maxFailedLogins),
      lockoutMinutes: Math.max(strictest.lockoutMinutes, r.lockoutMinutes),
      sessionDays: Math.min(strictest.sessionDays, capDays(r.sessionDays)),
      accessTokenMinutes: Math.min(strictest.accessTokenMinutes, r.accessTokenMinutes),
      passwordMinLength: Math.max(strictest.passwordMinLength, r.passwordMinLength),
      passwordRequireMixedCase: strictest.passwordRequireMixedCase || r.passwordRequireMixedCase,
      passwordRequireNumber: strictest.passwordRequireNumber || r.passwordRequireNumber,
      passwordRequireSymbol: strictest.passwordRequireSymbol || r.passwordRequireSymbol,
      requireVerifiedEmail: strictest.requireVerifiedEmail || r.requireVerifiedEmail,
      allowedEmailDomains: strictest.allowedEmailDomains || r.allowedEmailDomains,
      requirePayrollStepUp: strictest.requirePayrollStepUp || r.requirePayrollStepUp,
      requireAdminTwoFactor: strictest.requireAdminTwoFactor || r.requireAdminTwoFactor,
      /* Strictest across companies: STRICT over AUTO over ALLOW. */
      makerChecker: [strictest.makerChecker, r.makerChecker].includes('STRICT') ? 'STRICT' : [strictest.makerChecker, r.makerChecker].includes('AUTO') ? 'AUTO' : 'ALLOW',
    }),
    { ...DEFAULT_POLICY, maxFailedLogins: 999, sessionDays: SESSION_DAYS_CAP, accessTokenMinutes: 999, lockoutMinutes: 0, makerChecker: 'ALLOW' }
  );
}

/** The strictest rules of the given companies (an invitation into several). Reads across companies. */
export async function policyForOrgs(orgIds: string[]): Promise<Policy> {
  const ids = [...new Set(orgIds.filter(Boolean))];
  if (!ids.length) return { ...DEFAULT_POLICY };
  const rows = await outsideTenant('policy: the strictest rules of the companies an invitation names', () => platformPrisma.authPolicy.findMany({ where: { orgId: { in: ids } } }));
  return strictestOf(rows);
}

/**
 * The rules a sign-in session follows (#4): how long it lasts, how long each
 * access token lives, whether the address must be confirmed. One session opens
 * every company the person belongs to, in every account, so the strictest of
 * all of them applies — not only those of the person's home account, which is
 * what `policyForUser` reads for lockouts.
 */
export async function sessionPolicyFor(userId: string): Promise<Policy> {
  return outsideTenant('policy: a session opens every company the person belongs to', async () => {
    const memberships = await platformPrisma.userOrgMembership.findMany({ where: { userId }, select: { orgId: true } });
    if (!memberships.length) return { ...DEFAULT_POLICY };
    return strictestOf(await platformPrisma.authPolicy.findMany({ where: { orgId: { in: memberships.map((m) => m.orgId) } } }));
  });
}

/** "yourcompany.com, @group.com" → ['yourcompany.com', 'group.com']. */
export const domainList = (raw: string | null | undefined): string[] =>
  String(raw || '')
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);

/** Whether an address may be added to, or open, a company with this allowed-domain list (empty: any). */
export function emailDomainAllowed(email: string, allowed: string | null | undefined): boolean {
  const list = domainList(allowed);
  if (!list.length) return true;
  const domain = String(email || '').trim().toLowerCase().split('@').pop() || '';
  return list.includes(domain);
}

/** The plain refusal for an address outside a company's allowed domains. */
export const domainRefusalText = (allowed: string | null | undefined) =>
  `This company only lets in people with an email address at ${domainList(allowed).join(', ')}.`;

/**
 * Why `email` may not be added to these companies, or null. Each company's
 * own list applies, not a merged one: the address must be allowed by every
 * company it is being added to.
 */
export async function domainRefusalFor(orgIds: string[], email: string): Promise<string | null> {
  const ids = [...new Set(orgIds.filter(Boolean))];
  if (!ids.length) return null;
  const rows = await outsideTenant('policy: allowed email domains of the companies a person is added to', () =>
    platformPrisma.authPolicy.findMany({ where: { orgId: { in: ids } }, select: { allowedEmailDomains: true } })
  );
  for (const r of rows) if (!emailDomainAllowed(email, r.allowedEmailDomains)) return domainRefusalText(r.allowedEmailDomains);
  return null;
}

/** Returns a human-readable problem, or null when the password is acceptable. */
export function validatePassword(password: string, policy: Policy) {
  const value = String(password || '');
  if (value.length < policy.passwordMinLength) {
    return `Password must be at least ${policy.passwordMinLength} characters`;
  }
  if (policy.passwordRequireMixedCase && !(/[a-z]/.test(value) && /[A-Z]/.test(value))) {
    return 'Password must contain both upper and lower case letters';
  }
  if (policy.passwordRequireNumber && !/[0-9]/.test(value)) {
    return 'Password must contain a number';
  }
  if (policy.passwordRequireSymbol && !/[^A-Za-z0-9]/.test(value)) {
    return 'Password must contain a symbol';
  }
  if (isCommonPassword(value)) {
    return 'That password is too common. Choose one that is harder to guess';
  }
  return null;
}

export function describePasswordRules(policy: Policy) {
  const rules = [`at least ${policy.passwordMinLength} characters`];
  if (policy.passwordRequireMixedCase) rules.push('upper and lower case');
  if (policy.passwordRequireNumber) rules.push('a number');
  if (policy.passwordRequireSymbol) rules.push('a symbol');
  return rules;
}
