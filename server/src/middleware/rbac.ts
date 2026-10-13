import type { Request, Response, NextFunction } from 'express';
import { type PermissionAction as PermissionActionType } from '../constants/enums.js';
import { flattenCatalog } from '../constants/permissionCatalog.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { resolveAccess } from '../services/access.js';

// DB-stored RBAC:
// - UserRoleAssignment can be org-wide (branchId null) or branch-scoped
// - RolePermission stores Permission rows (module/subModule/action)

declare module 'express-serve-static-core' {
  interface Request {
    permissions?: Set<string>;
    permissionLevels?: Map<string, number>;
    /** Whether the caller holds an ADMIN-type role in this org and branch. */
    isAdmin?: boolean;
    /** Reads of documents are limited to rows the caller created. */
    ownDocumentsOnly?: boolean;
  }
}

function permString(module: string, subModule: string | null, action: PermissionActionType): string {
  return `${module}::${subModule || ''}::${action}`;
}

async function bootstrapOwnerRoleIfCreator(accountId: string, orgId: string, userId: string) {
  const org = await platformPrisma.org.findFirst({ where: { accountId, id: orgId }, select: { createdByUserId: true } });
  if (!org || org.createdByUserId !== userId) return false;

  // Create a minimal owner role so the creator can proceed.
  const roleName = 'Owner';
  const role =
    (await platformPrisma.role.findFirst({ where: { accountId, orgId, branchId: null, name: roleName }, select: { id: true } })) ||
    (await platformPrisma.role.create({
      data: {
        accountId,
        orgId,
        branchId: null,
        name: roleName,
        description: 'Default owner role (auto-created)',
        roleType: 'ADMIN',
        createdByUserId: userId,
      },
      select: { id: true },
    }));

  // C-4: seed the FULL catalog, not a partial core set. The old partial seed
  // meant the Owner's effective grants depended on which endpoints they
  // happened to hit first (the lazy ensureOwnerPermissionForCreator patched
  // holes one request at a time). Seeding everything up front makes the
  // Owner's access deterministic; the lazy fallback stays for legacy orgs.
  const core: Array<{ module: string; subModule: string; action: string }> = flattenCatalog();

  const permissionIds: string[] = [];
  for (const p of core) {
    const existing = await platformPrisma.permission.findFirst({ where: { module: p.module, subModule: p.subModule, action: p.action }, select: { id: true } });
    if (existing) {
      permissionIds.push(existing.id);
      continue;
    }
    const created = await platformPrisma.permission.create({ data: { module: p.module, subModule: p.subModule, action: p.action }, select: { id: true } });
    permissionIds.push(created.id);
  }

  for (const permissionId of permissionIds) {
    try {
      await platformPrisma.rolePermission.create({
        data: { accountId, orgId, roleId: role.id, permissionId, allowed: true },
        select: { id: true },
      });
    } catch (err: any) {
      if (String(err?.name || '') === 'PrismaClientKnownRequestError' && String(err?.code || '') === 'P2002') continue;
      throw err;
    }
  }

  try {
    await platformPrisma.userRoleAssignment.create({
      data: { accountId, orgId, branchId: null, userId, roleId: role.id, createdByUserId: userId },
      select: { id: true },
    });
  } catch (err: any) {
    if (!(String(err?.name || '') === 'PrismaClientKnownRequestError' && String(err?.code || '') === 'P2002')) {
      throw err;
    }
  }

  return true;
}

export type Refusal = { status: number; body: Record<string, unknown> };

/**
 * Decides one permission for this request, and records the caller's effective
 * access on it either way.
 *
 * `requirePermission` is this as route middleware. A handler that only learns
 * which permission applies once it has read the request — a payment's
 * direction decides between Receipts and Payments — calls it directly.
 * Returns null when allowed, or the refusal to send.
 */
export async function authorize(
  req: Request,
  module: string,
  action: PermissionActionType,
  subModule?: string
): Promise<Refusal | null> {
  const m = String(module || '').trim();
  const sm = String(subModule || '').trim();
  /*
   * The account comes from the tenant context, not from the token.
   *
   * `req.tenant.accountId` is the account that owns the organisation being
   * worked in, established by the membership that authorised the request.
   * `req.auth.accountId` is where the person signed up, which for anyone
   * invited into somebody else's company is a different account entirely —
   * so roles were being looked for in the visitor's own account and never
   * found, and a correctly invited user with a correctly assigned role was
   * told "No roles assigned".
   *
   * For a person working in their own company the two are equal, which is
   * why this was invisible until invitations crossed an account.
   */
  const accountId = String(req.tenant?.accountId || '').trim();
  const userId = String(req.auth?.userId || '').trim();
  const orgId = String(req.tenant?.orgId || '').trim();
  const branchId = String(req.tenant?.branchId || '').trim();

  if (!accountId || !userId) return { status: 401, body: { error: 'Missing auth context' } };
  if (!orgId || !branchId) return { status: 400, body: { error: 'Missing tenant context' } };

  // Effective access resolves direct role assignments AND role profiles.
  let access = await resolveAccess(accountId, orgId, userId, branchId);

  if (access.roleIds.length === 0) {
    const bootstrapped = await bootstrapOwnerRoleIfCreator(accountId, orgId, userId);
    if (!bootstrapped) return { status: 403, body: { error: 'No roles assigned' } };
    access = await resolveAccess(accountId, orgId, userId, branchId);
    if (access.roleIds.length === 0) return { status: 403, body: { error: 'No roles assigned' } };
  }

  const allowed = access.permissions;
  req.permissions = allowed;
  req.permissionLevels = access.levels;
  req.isAdmin = access.isAdmin;
  req.ownDocumentsOnly = access.ownDocumentsOnly;

  const want = permString(m, sm || null, action);
  if (!allowed.has(want)) {
    /*
     * A denial is a denial.
     *
     * This used to repair itself: a creator who hit a permission their Owner
     * role did not carry had it created, granted and assigned, and the
     * request went through. Authorisation was writing to the permission
     * tables while deciding whether to authorise — so a refused request could
     * change security configuration, and effective access depended on which
     * endpoints somebody happened to visit first.
     *
     * New orgs are seeded with the whole catalogue at setup, and
     * `scripts/backfillOwnerPermissions.ts` tops up the ones created before
     * that. Neither happens here, while a request is being decided.
     */
    return { status: 403, body: { error: 'Permission denied', permission: { module: m, subModule: sm || null, action } } };
  }

  return null;
}

export function requirePermission(module: string, action: PermissionActionType, subModule?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const refusal = await authorize(req, module, action, subModule);
    if (refusal) return res.status(refusal.status).json(refusal.body);
    next();
  };
}
