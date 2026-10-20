import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * "Require two-factor sign-in for owners and admins" (SX-09).
 *
 * An admin of a company is the person who created it, or anyone holding a
 * role of type ADMIN in it. When the company's policy asks for it and such a
 * person has no authenticator, they may sign in but reach only their own
 * two-factor set-up until it is done — the rest of the company's data waits.
 */
export async function isOrgAdmin(userId: string, orgId: string): Promise<boolean> {
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { createdByUserId: true } });
  if (org?.createdByUserId === userId) return true;
  const admin = await platformPrisma.userRoleAssignment.findFirst({
    where: { userId, orgId, role: { roleType: 'ADMIN' } },
    select: { id: true },
  });
  return Boolean(admin);
}

/** Whether this person must set up an authenticator before using this company. */
export async function adminTwoFactorMissing(userId: string, orgId: string): Promise<boolean> {
  const policy = await platformPrisma.authPolicy.findUnique({ where: { orgId }, select: { requireAdminTwoFactor: true } });
  if (!policy?.requireAdminTwoFactor) return false;
  const user = await platformPrisma.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true } });
  if (user?.totpEnabledAt) return false;
  return isOrgAdmin(userId, orgId);
}

/**
 * The only routes such a person may use: their own two-factor set-up, their
 * sessions and password, and the company's policy page (to see why).
 */
export const TWO_FACTOR_SETUP_PATHS = /\/security\/(two-factor|my-sessions|change-password)(\/|$)/;
