import { platformPrisma } from '../utils/platformPrisma.js';
import { permKey } from '../constants/permissionCatalog.js';
import { RoleType } from '../constants/enums.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { COMPANY_WIDE, resolveAccess } from './access.js';

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

/**
 * What the caller may hand out, and where (A-19).
 *
 * `req.permissions` is resolved for the branch the request is working in, so
 * it includes roles the caller holds for that branch alone. Bounding a grant
 * by it let somebody who manages users in one branch hand out company-wide
 * roles — to themselves too — and so carry their one-branch access across the
 * company. A grant is bounded by what the caller holds where the grant
 * applies: a company-wide assignment, and any change to a role or profile
 * (which reaches every holder wherever they work), by what the caller holds
 * company-wide; an assignment for one branch by what they hold in that branch.
 *
 * `gate` is the permission the route itself asks for; it too must be held
 * where the grant applies.
 */
export type Authority = { isAdmin: boolean; permissions: Set<string> };
type Refusal = { status: number; body: Record<string, unknown> };

export async function grantAuthority(
  req: { tenant?: { accountId: string; orgId: string }; auth?: { userId: string } },
  branchId: string | null,
  gate: string
): Promise<{ authority: Authority; refusal: null } | { authority: null; refusal: Refusal }> {
  const { accountId, orgId } = req.tenant!;
  const access = await resolveAccess(accountId, orgId, req.auth!.userId, branchId ?? COMPANY_WIDE);
  const authority = { isAdmin: access.isAdmin, permissions: access.permissions };
  if (authority.isAdmin || authority.permissions.has(gate)) return { authority, refusal: null };
  return {
    authority: null,
    refusal: {
      status: 403,
      body: branchId
        ? { error: 'You do not manage this in that branch.', code: 'not_in_branch' }
        : {
            error: 'You manage this for one branch only. Company-wide roles are changed by somebody who manages them across the company.',
            code: 'not_company_wide',
          },
    },
  };
}

/** Nobody but an administrator changes their own access: somebody else has to. */
export const OWN_ACCESS_ERROR = {
  error: 'You cannot change your own access. Ask another administrator.',
  code: 'own_access',
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

type Db = Pick<typeof platformPrisma, 'role' | 'roleProfileRole' | 'userRoleProfile' | 'userRoleAssignment' | 'user' | 'userOrgMembership'>;

/**
 * Every active member who administers the organisation.
 *
 * An administrator is anybody holding an ADMIN-type role company-wide —
 * directly, or through a role profile that contains one. This used to count
 * direct assignments only, so an organisation whose administrators all came
 * through a profile looked adminless (refusing harmless changes), and one
 * whose last direct admin was removed while a profile admin remained was
 * judged correctly only by luck.
 *
 * Takes a client so it can be asked inside a transaction, after a change and
 * before it commits.
 */
export async function adminUserIds(db: Db, accountId: string, orgId: string): Promise<Set<string>> {
  const adminRoles = await db.role.findMany({
    where: { accountId, orgId, roleType: RoleType.ADMIN, branchId: null },
    select: { id: true },
  });
  const adminRoleIds = adminRoles.map((r) => r.id);
  if (!adminRoleIds.length) return new Set();

  const direct = await db.userRoleAssignment.findMany({
    where: { accountId, orgId, branchId: null, roleId: { in: adminRoleIds } },
    select: { userId: true },
  });

  const links = await db.roleProfileRole.findMany({
    where: { accountId, orgId, roleId: { in: adminRoleIds } },
    select: { profileId: true },
  });
  const viaProfile = links.length
    ? await db.userRoleProfile.findMany({
        where: { accountId, orgId, branchId: null, profileId: { in: [...new Set(links.map((l) => l.profileId))] } },
        select: { userId: true },
      })
    : [];

  const candidates = [...new Set([...direct, ...viaProfile].map((r) => r.userId))];
  if (!candidates.length) return new Set();

  // Still in the company, and still able to sign in.
  const members = await db.userOrgMembership.findMany({
    where: { accountId, orgId, userId: { in: candidates } },
    select: { userId: true },
  });
  const active = await db.user.findMany({
    where: { id: { in: members.map((m) => m.userId) }, isActive: true },
    select: { id: true },
  });
  return new Set(active.map((u) => u.id));
}

/** True when the user administers the organisation, directly or through a profile. */
export async function userIsAdmin(accountId: string, orgId: string, userId: string) {
  return (await adminUserIds(platformPrisma, accountId, orgId)).has(userId);
}

/**
 * May `callerId` change `targetId`'s sign-in identity — email, password, or
 * whether they can sign in at all?
 *
 * All three are global: one User signs in to every company they belong to.
 * Being an administrator (or holding Users EDIT) in the company at hand used
 * to be enough, so the admin of company X could move the email of somebody
 * who owns company Y in the same account, then sign in as them there (A-01).
 *
 * The rule now: you may change somebody's identity only if you could manage
 * them in every company they work in — Users EDIT in each, and administrator
 * in each where they are an administrator. Returns the first company that
 * blocks it, or null when every one allows it. Reads across companies, so it
 * runs outside the request's tenant setting.
 */
export async function identityBlockedIn(callerId: string, targetId: string): Promise<{ orgId: string; reason: 'not_manager' | 'admin_target' } | null> {
  return outsideTenant('identity change: the target must be manageable in every company they belong to', async () => {
    const memberships = await platformPrisma.userOrgMembership.findMany({ where: { userId: targetId }, select: { accountId: true, orgId: true } });
    for (const m of memberships) {
      const caller = await resolveAccess(m.accountId, m.orgId, callerId);
      if (!caller.isAdmin && !caller.permissions.has(permKey('SETTINGS', 'Users', 'EDIT'))) return { orgId: m.orgId, reason: 'not_manager' as const };
      if (!caller.isAdmin && (await adminUserIds(platformPrisma, m.accountId, m.orgId)).has(targetId)) return { orgId: m.orgId, reason: 'admin_target' as const };
    }
    return null;
  });
}

/**
 * Whether taking this person out entirely — removed, deactivated, or their
 * access to the company withdrawn — would leave nobody administering it.
 */
export async function wouldRemoveLastAdmin(accountId: string, orgId: string, userId: string) {
  const admins = await adminUserIds(platformPrisma, accountId, orgId);
  return admins.has(userId) && admins.size === 1;
}

export class LastAdminError extends Error {
  constructor() {
    super(LAST_ADMIN_ERROR.error);
  }
}

/**
 * Called inside a transaction after a change to roles, assignments or
 * profiles: throws — rolling the change back — when nobody would be left
 * administering the organisation. Checking the state after the change, rather
 * than predicting it before, keeps one rule for every route that can cause it.
 */
export async function assertAnAdminRemains(db: Db, accountId: string, orgId: string) {
  if ((await adminUserIds(db, accountId, orgId)).size === 0) throw new LastAdminError();
}
