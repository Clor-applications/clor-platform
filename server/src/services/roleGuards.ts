import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { permKey } from '../constants/permissionCatalog.js';
import { RoleType } from '../constants/enums.js';

/**
 * The two rules that keep role administration from turning against the
 * organisation that configured it.
 *
 * 1. Nobody hands out more than they hold. A person allowed to edit roles
 *    could otherwise write every permission in the catalogue onto their own
 *    role, and a person allowed to edit users could hand themselves the
 *    Administrator role. Both were one request away. A grant is now bounded
 *    by the grantor's own effective set, and anything typed ADMIN — the role
 *    type that bypasses field levels — is administered only by an
 *    administrator.
 *
 * 2. The organisation always keeps an administrator. Removing, deactivating
 *    or demoting the last active user who holds an org-wide ADMIN role, or
 *    stripping that role of the permissions needed to administer roles and
 *    users, is refused. The creator's role is repaired on the next load of
 *    /permissions/me, but a creator who has been removed from the company
 *    never loads it.
 */

/** Permissions an ADMIN role must always carry, or nobody can undo a mistake. */
export const ANTI_LOCKOUT_KEYS: readonly string[] = [
  permKey('SETTINGS', 'Roles', 'VIEW'),
  permKey('SETTINGS', 'Roles', 'EDIT'),
  permKey('SETTINGS', 'Users', 'VIEW'),
  permKey('SETTINGS', 'Users', 'EDIT'),
];

export const LAST_ADMIN_ERROR = {
  error: 'This would leave the organisation without an administrator',
  code: 'last_admin',
};

export const ADMIN_ONLY_ERROR = {
  error: 'Only an administrator may administer an Administrator role',
  code: 'admin_only',
};

/** Every permission key a role currently grants. */
export async function rolePermissionKeys(roleId: string): Promise<Set<string>> {
  const rows = await platformPrisma.rolePermission.findMany({
    where: { roleId, allowed: true },
    select: { permission: { select: { module: true, subModule: true, action: true } } },
  });
  return new Set(rows.map((r) => permKey(r.permission.module, r.permission.subModule, r.permission.action)));
}

/** The keys in `wanted` that the caller does not hold. Empty for an administrator. */
export function unheldGrants(
  caller: { isAdmin?: boolean; permissions?: Set<string> },
  wanted: Iterable<string>
): string[] {
  if (caller.isAdmin) return [];
  const held = caller.permissions || new Set<string>();
  const missing: string[] = [];
  for (const k of wanted) if (!held.has(k)) missing.push(k);
  return missing;
}

export function cannotGrantError(missing: string[]) {
  return {
    error: 'You cannot grant a permission you do not hold',
    code: 'cannot_grant_unheld',
    permissions: missing.slice(0, 20),
  };
}

/** True when the user holds an org-wide assignment to an ADMIN-type role. */
export async function userIsAdmin(accountId: string, orgId: string, userId: string) {
  const n = await platformPrisma.userRoleAssignment.count({
    where: { accountId, orgId, userId, branchId: null, role: { roleType: RoleType.ADMIN } },
  });
  return n > 0;
}

/**
 * Active users who hold an org-wide ADMIN role, other than the exclusions.
 *
 * `excludeUserId` asks "how many administrators would be left without this
 * person"; `excludeRoleId` asks the same of a role about to be deleted or
 * changed to a non-admin type.
 */
export async function countOtherAdmins(
  accountId: string,
  orgId: string,
  exclude: { userId?: string | null; roleId?: string | null } = {}
): Promise<number> {
  const rows = await platformPrisma.userRoleAssignment.findMany({
    where: {
      accountId,
      orgId,
      branchId: null,
      role: { roleType: RoleType.ADMIN },
      user: { isActive: true },
      ...(exclude.userId ? { NOT: { userId: exclude.userId } } : {}),
      ...(exclude.roleId ? { NOT: { roleId: exclude.roleId } } : {}),
    },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId)).size;
}

/**
 * Whether the org would still have an administrator if `userId` lost their
 * org-wide roles (or was removed or deactivated).
 */
export async function wouldRemoveLastAdmin(accountId: string, orgId: string, userId: string) {
  if (!(await userIsAdmin(accountId, orgId, userId))) return false;
  return (await countOtherAdmins(accountId, orgId, { userId })) === 0;
}
