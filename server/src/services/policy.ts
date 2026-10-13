import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

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
};

export const DEFAULT_POLICY: Policy = {
  maxFailedLogins: Number(process.env.MAX_FAILED_LOGINS || 8),
  lockoutMinutes: Number(process.env.LOCKOUT_MINUTES || 15),
  sessionDays: Number(process.env.REFRESH_TOKEN_DAYS || 30),
  accessTokenMinutes: 15,
  passwordMinLength: 8,
  passwordRequireMixedCase: false,
  passwordRequireNumber: false,
  passwordRequireSymbol: false,
  requireVerifiedEmail: false,
  allowedEmailDomains: null,
};

export async function getAuthPolicy(accountId: string, orgId: string): Promise<Policy> {
  const row = await platformPrisma.authPolicy.findUnique({ where: { orgId } });
  if (!row) return { ...DEFAULT_POLICY };
  return {
    maxFailedLogins: row.maxFailedLogins,
    lockoutMinutes: row.lockoutMinutes,
    sessionDays: row.sessionDays,
    accessTokenMinutes: row.accessTokenMinutes,
    passwordMinLength: row.passwordMinLength,
    passwordRequireMixedCase: row.passwordRequireMixedCase,
    passwordRequireNumber: row.passwordRequireNumber,
    passwordRequireSymbol: row.passwordRequireSymbol,
    requireVerifiedEmail: row.requireVerifiedEmail,
    allowedEmailDomains: row.allowedEmailDomains,
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
  if (!rows.length) return { ...DEFAULT_POLICY };

  return rows.reduce<Policy>(
    (strictest, r) => ({
      maxFailedLogins: Math.min(strictest.maxFailedLogins, r.maxFailedLogins),
      lockoutMinutes: Math.max(strictest.lockoutMinutes, r.lockoutMinutes),
      sessionDays: Math.min(strictest.sessionDays, r.sessionDays),
      accessTokenMinutes: Math.min(strictest.accessTokenMinutes, r.accessTokenMinutes),
      passwordMinLength: Math.max(strictest.passwordMinLength, r.passwordMinLength),
      passwordRequireMixedCase: strictest.passwordRequireMixedCase || r.passwordRequireMixedCase,
      passwordRequireNumber: strictest.passwordRequireNumber || r.passwordRequireNumber,
      passwordRequireSymbol: strictest.passwordRequireSymbol || r.passwordRequireSymbol,
      requireVerifiedEmail: strictest.requireVerifiedEmail || r.requireVerifiedEmail,
      allowedEmailDomains: strictest.allowedEmailDomains || r.allowedEmailDomains,
    }),
    { ...DEFAULT_POLICY, maxFailedLogins: 999, sessionDays: 999, accessTokenMinutes: 999, lockoutMinutes: 0 }
  );
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
  return null;
}

export function describePasswordRules(policy: Policy) {
  const rules = [`at least ${policy.passwordMinLength} characters`];
  if (policy.passwordRequireMixedCase) rules.push('upper and lower case');
  if (policy.passwordRequireNumber) rules.push('a number');
  if (policy.passwordRequireSymbol) rules.push('a symbol');
  return rules;
}

/** Whether an address may be invited, given the org's domain restriction. */
export function emailAllowed(email: string, policy: Policy) {
  const list = String(policy.allowedEmailDomains || '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  if (!list.length) return true;
  const domain = String(email || '').split('@')[1]?.toLowerCase() || '';
  return list.includes(domain);
}
