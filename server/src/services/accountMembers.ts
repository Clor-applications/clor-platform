import type { Request } from 'express';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../utils/tenantScope.js';
import { resolveAccess } from './access.js';
import { adminUserIds } from './roleGuards.js';
import { appsForModule } from '../middleware/rbac.js';
import { clearAccessCache } from '../utils/accessCache.js';
import { ACCOUNT_ADMINS, AccountMembershipError, accountRoleOf, recordAccountEvent } from './accountMembership.js';

/**
 * Workspace W-4: the account's people — who they are, where they can go, and
 * the separate things an administrator can do about it (spec §9):
 *
 *   suspend / reinstate in the account   (every company of it, at once)
 *   remove from one company              (that company's memberships and roles)
 *
 * Changing an account role is W-1 (accountMembership.setAccountRole). Taking
 * one app's roles away is done in that company's Roles. Deleting a person's
 * global login is not offered here: it is theirs, and they may belong to
 * other accounts.
 *
 * "Effective access" is computed, not remembered: the roles a person holds in
 * each company (directly or through a role profile) resolved to permissions,
 * and those permissions to the apps they open — the same resolveAccess every
 * request uses, so this page cannot disagree with what the server allows.
 */

const SENSITIVE = /^(PAYROLL|PEOPLE)::|Salary|Bank|Payslip|Statutory|Document/i;

/** The apps a set of permission keys (MODULE::Sub::ACTION) opens. */
export function appsOfPermissions(permissions: Iterable<string>, isAdmin = false): string[] {
  if (isAdmin) return ['accounting', 'payroll', 'people', 'attendance'];
  const apps = new Set<string>();
  for (const key of permissions) for (const a of appsForModule(String(key).split('::')[0]) || []) apps.add(a);
  return [...apps].sort();
}

async function companiesOf(accountId: string) {
  return platformPrisma.org.findMany({ where: { accountId }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
}

/** One person's footprint in each company of the account they belong to: roles and the apps those open. */
async function footprint(accountId: string, userId: string, orgs: Array<{ id: string; name: string; code: string | null }>) {
  const memberOf = new Set(
    (await platformPrisma.userOrgMembership.findMany({ where: { accountId, userId, orgId: { in: orgs.map((o) => o.id) } }, select: { orgId: true } })).map((m) => m.orgId)
  );
  const out = [];
  for (const o of orgs) {
    if (!memberOf.has(o.id)) continue;
    const row = await runInTenant(o.id, async () => {
      const access = await resolveAccess(accountId, o.id, userId);
      const roles = access.roleIds.length ? await platformPrisma.role.findMany({ where: { id: { in: access.roleIds } }, select: { id: true, name: true, roleType: true } }) : [];
      return { orgId: o.id, name: o.name, code: o.code, isAdmin: access.isAdmin, roles: roles.map((r) => r.name), apps: appsOfPermissions(access.permissions, access.isAdmin) };
    });
    out.push(row);
  }
  return out;
}

/** GET /account/members/directory — everyone in the account, with companies, roles and apps. */
export async function memberDirectory(accountId: string) {
  return outsideTenant('account members: directory', async () => {
    const [rows, orgs] = await Promise.all([
      platformPrisma.accountMembership.findMany({ where: { accountId }, orderBy: { createdAt: 'asc' } }),
      companiesOf(accountId),
    ]);
    const people = await platformPrisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, fullName: true, email: true, isActive: true, lastLoginAt: true },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    const members = [];
    for (const r of rows) {
      const p = byId.get(r.userId);
      members.push({
        userId: r.userId,
        name: p?.fullName || null,
        email: p?.email || null,
        canSignIn: p?.isActive ?? false,
        lastSignInAt: p?.lastLoginAt || null,
        accountRole: r.role,
        status: r.status,
        companies: await footprint(accountId, r.userId, orgs),
      });
    }
    return { companies: orgs.map((o) => ({ orgId: o.id, name: o.name })), members };
  });
}

/**
 * GET /account/members/:userId/access — the spec's "member access detail":
 * account role, and per company: roles with who gave them and when, the apps
 * they open, branches, and which of their permissions are sensitive.
 */
export async function memberAccess(accountId: string, userId: string) {
  return outsideTenant('account members: one person’s access', async () => {
    const m = await platformPrisma.accountMembership.findUnique({ where: { accountId_userId: { accountId, userId } } });
    if (!m) throw new AccountMembershipError(404, 'This person does not belong to this account.', 'NOT_A_MEMBER');
    const user = await platformPrisma.user.findUnique({ where: { id: userId }, select: { fullName: true, email: true, lastLoginAt: true, totpEnabledAt: true } });
    const orgs = await companiesOf(accountId);
    const memberOf = new Set((await platformPrisma.userOrgMembership.findMany({ where: { accountId, userId }, select: { orgId: true } })).map((x) => x.orgId));
    const companies = [];
    for (const o of orgs) {
      if (!memberOf.has(o.id)) continue;
      companies.push(
        await runInTenant(o.id, async () => {
          const access = await resolveAccess(accountId, o.id, userId);
          const direct = await platformPrisma.userRoleAssignment.findMany({ where: { accountId, orgId: o.id, userId }, select: { roleId: true, branchId: true, createdAt: true, createdByUserId: true } });
          const profiles = await platformPrisma.userRoleProfile.findMany({ where: { accountId, orgId: o.id, userId }, select: { profile: { select: { name: true } }, createdAt: true } });
          const roles = access.roleIds.length ? await platformPrisma.role.findMany({ where: { id: { in: access.roleIds } }, select: { id: true, name: true, roleType: true } }) : [];
          const branchIds = (await platformPrisma.userBranchMembership.findMany({ where: { accountId, orgId: o.id, userId }, select: { branchId: true } })).map((b) => b.branchId);
          const branches = await platformPrisma.branch.findMany({ where: { accountId, orgId: o.id, id: { in: branchIds } }, select: { branchName: true } });
          const granters = await platformPrisma.user.findMany({ where: { id: { in: direct.map((d) => d.createdByUserId).filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
          const who = new Map(granters.map((g) => [g.id, g.fullName]));
          return {
            orgId: o.id,
            name: o.name,
            isAdmin: access.isAdmin,
            apps: appsOfPermissions(access.permissions, access.isAdmin),
            branches: branches.map((b) => b.branchName).filter(Boolean),
            roles: roles.map((r) => {
              const d = direct.find((x) => x.roleId === r.id);
              return {
                name: r.name,
                admin: r.roleType === 'ADMIN',
                /* Why it is held: given directly (by whom, when), or through a role profile. */
                via: d ? 'direct' : 'profile',
                grantedBy: d?.createdByUserId ? who.get(d.createdByUserId) || null : null,
                grantedAt: d?.createdAt || null,
                branchOnly: Boolean(d?.branchId),
              };
            }),
            profiles: profiles.map((p) => ({ name: p.profile?.name, since: p.createdAt })),
            sensitive: [...access.permissions].filter((k) => SENSITIVE.test(k)).sort(),
            permissionCount: access.permissions.size,
          };
        })
      );
    }
    return {
      userId,
      name: user?.fullName || null,
      email: user?.email || null,
      lastSignInAt: user?.lastLoginAt || null,
      authenticator: Boolean(user?.totpEnabledAt),
      accountRole: m.role,
      status: m.status,
      memberSince: m.createdAt,
      companies,
    };
  });
}

/** The caller may manage people in the account; an owner is touched only by an owner; nobody acts on themself. */
async function guard(req: Request, targetUserId: string, action: string) {
  const accountId = String(req.tenant?.accountId || '');
  const actorUserId = String(req.auth?.userId || '');
  const refuse = async (status: number, message: string, code: string) => {
    await recordAccountEvent({ accountId, actorUserId, action, targetType: 'AccountMembership', targetId: targetUserId, result: 'DENIED', message, metadata: { code } });
    throw new AccountMembershipError(status, message, code);
  };
  const actorRole = await accountRoleOf(accountId, actorUserId);
  if (!actorRole || !ACCOUNT_ADMINS.includes(actorRole)) await refuse(403, 'Only an owner or administrator of this account can do this.', 'ACCOUNT_ROLE_REQUIRED');
  if (targetUserId === actorUserId) await refuse(409, 'You cannot do this to yourself. Ask another owner or administrator.', 'SELF');
  const target = await outsideTenant('account members: the person', () => platformPrisma.accountMembership.findUnique({ where: { accountId_userId: { accountId, userId: targetUserId } } }));
  if (!target) await refuse(404, 'This person does not belong to this account.', 'NOT_A_MEMBER');
  if (target!.role === 'OWNER' && actorRole !== 'OWNER') await refuse(403, 'Only an owner of this account can do this to an owner.', 'ACCOUNT_OWNER_ONLY');
  return { accountId, actorUserId, target: target! };
}

/** Suspend or reinstate a person in the whole account. A suspended owner cannot be the last owner standing. */
export async function setMemberStatus(req: Request, targetUserId: string, status: 'ACTIVE' | 'SUSPENDED') {
  const action = status === 'SUSPENDED' ? 'MEMBER_SUSPENDED' : 'MEMBER_REINSTATED';
  const { accountId, actorUserId, target } = await guard(req, targetUserId, action);
  if (target.status === status) return { changed: false, status };
  await outsideTenant('account members: suspend or reinstate', () =>
    platformPrisma.$transaction(async (tx) => {
      if (status === 'SUSPENDED' && target.role === 'OWNER') {
        await tx.$executeRaw`SELECT 1 FROM "AccountMembership" WHERE "accountId" = ${accountId} AND "role" = 'OWNER' FOR UPDATE`;
        const others = await tx.accountMembership.count({ where: { accountId, role: 'OWNER', status: 'ACTIVE', NOT: { userId: targetUserId } } });
        if (!others) throw new AccountMembershipError(409, 'An account needs at least one active owner.', 'LAST_ACCOUNT_OWNER');
      }
      await tx.accountMembership.update({ where: { accountId_userId: { accountId, userId: targetUserId } }, data: { status } });
    })
  );
  /* Effective at once, not after the access cache's few seconds. */
  clearAccessCache();
  await recordAccountEvent({ accountId, actorUserId, action, targetType: 'AccountMembership', targetId: targetUserId, message: status === 'SUSPENDED' ? 'Suspended in the account' : 'Reinstated in the account' });
  return { changed: true, status };
}

/** Remove a person from one company: its membership, branches, roles and record restrictions — nothing elsewhere. */
export async function removeFromCompany(req: Request, targetUserId: string, orgId: string) {
  const { accountId, actorUserId } = await guard(req, targetUserId, 'MEMBER_REMOVED_FROM_COMPANY');
  const org = await outsideTenant('account members: the company', () => platformPrisma.org.findFirst({ where: { id: orgId, accountId }, select: { id: true, name: true } }));
  if (!org) throw new AccountMembershipError(404, 'No such company in this account.', 'FOREIGN_COMPANY');
  const removed = await runInTenant(orgId, async () => {
    const where = { accountId, orgId, userId: targetUserId };
    const member = await platformPrisma.userOrgMembership.findFirst({ where, select: { id: true } });
    if (!member) return false;
    /* The company keeps an administrator: removing its only one would leave nobody to manage it. */
    const admins = await adminUserIds(platformPrisma, accountId, orgId);
    if (admins.has(targetUserId) && admins.size === 1) throw new AccountMembershipError(409, 'This is the company’s only administrator. Make someone else an administrator there first.', 'LAST_COMPANY_ADMIN');
    await platformPrisma.$transaction([
      platformPrisma.userRoleAssignment.deleteMany({ where }),
      platformPrisma.userRoleProfile.deleteMany({ where }),
      platformPrisma.userPermission.deleteMany({ where }),
      platformPrisma.userWarehouseAccess.deleteMany({ where }),
      platformPrisma.userBranchMembership.deleteMany({ where }),
      platformPrisma.userOrgMembership.deleteMany({ where }),
    ]);
    return true;
  });
  if (!removed) throw new AccountMembershipError(404, 'This person is not in that company.', 'NOT_IN_COMPANY');
  clearAccessCache();
  await recordAccountEvent({ accountId, actorUserId, action: 'MEMBER_REMOVED_FROM_COMPANY', targetType: 'AccountMembership', targetId: targetUserId, message: `Removed from ${org.name}`, metadata: { orgId } });
  return { removed: true };
}
