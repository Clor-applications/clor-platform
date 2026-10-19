import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { cachedAccess } from '../utils/accessCache.js';
import { runInTenant } from '../utils/tenantScope.js';

export type TenantContext = {
  accountId: string;
  orgId: string;
  branchId: string;
  allowedBranchIds: string[];
  /** The warehouse the caller may use, when one was supplied and permitted. */
  warehouseId?: string;
  /** What the client asked for, permitted or not. */
  requestedWarehouseId?: string;
  allowedWarehouseIds?: string[];
};

declare module 'express-serve-static-core' {
  interface Request {
    tenant?: TenantContext;
  }
}

// Enforces the CRITICAL isolation rule:
// - user must belong to org
// - user must belong to branch
// - accountId must match everywhere
//
// You can choose token-bound org/branch, or header-bound org/branch.
// This implementation uses headers so user can switch org/branch without re-login:
//   x-org-id, x-branch-id
export async function requireTenantContext(req: Request, res: Response, next: NextFunction) {
  /*
   * The account comes from the MEMBERSHIP, not from the token.
   *
   * A user signs up once and may then be given access to a company owned by
   * somebody else — a client invites their accountant, a group invites an
   * auditor. The token carries the account the person signed up under, which is
   * their home, not a boundary on what they may reach. Matching membership on
   * the token's account made a membership in anyone else's organisation
   * unmatchable by construction, so the invitation could be written and would
   * never work.
   *
   * Everything downstream reads `req.tenant.accountId`, which is now the
   * account that owns the organisation being worked in — which is the account
   * every row of that organisation's data actually carries. For a user working
   * in their own company the two are the same value, which is why this changes
   * nothing for anybody who exists today.
   */
  const homeAccountId = String(req.auth?.accountId || '').trim();
  const userId = String(req.auth?.userId || '').trim();
  const orgId = String(req.headers['x-org-id'] || '').trim();
  const branchId = String(req.headers['x-branch-id'] || '').trim();
  const warehouseId = String(req.headers['x-warehouse-id'] || '').trim();

  if (!homeAccountId || !userId) return res.status(401).json({ error: 'Missing auth context' });
  if (!orgId) return res.status(400).json({ error: 'Missing x-org-id' });
  if (!branchId) return res.status(400).json({ error: 'Missing x-branch-id' });

  const result = await cachedAccess(
    `tenant|${userId}|${orgId}|${branchId}|${warehouseId}`,
    () => resolveTenant(userId, orgId, branchId, warehouseId),
    (r) => 'tenant' in r // cache grants only; a denial is re-checked every time
  );
  if (!('tenant' in result)) return res.status(result.status).json({ error: result.error });
  req.tenant = { ...result.tenant }; // the cached object is shared between requests

  /* From here on every query this request makes names its company to the database (utils/tenantScope.ts). */
  runInTenant(req.tenant.orgId, () => next());
}

type TenantResult = { tenant: TenantContext } | { status: number; error: string };

/**
 * The membership checks behind requireTenantContext, as a pure lookup so the
 * answer can be cached for a few seconds (see utils/accessCache.ts).
 */
async function resolveTenant(userId: string, orgId: string, branchId: string, warehouseId: string): Promise<TenantResult> {
  const orgMember = await platformPrisma.userOrgMembership.findFirst({
    where: { orgId, userId },
    select: { accountId: true },
  });
  if (!orgMember) return { status: 403, error: 'No access to org' };

  // The owning account, established by the membership that just authorised it.
  const accountId = orgMember.accountId;

  let branchMember = await platformPrisma.userBranchMembership.findFirst({
    where: { accountId, orgId, branchId, userId },
    select: { id: true },
  });

  /*
   * The org creator reaches every branch in their own organisation — the
   * same safety net the warehouses carry below, for the same reason:
   * membership is only ever granted by an administrator assigning it to
   * somebody else, so the creator of a brand-new branch had none and every
   * route 403ed with no way to grant it to themselves. Narrow on purpose:
   * the creator of THIS org, a branch that really is in it, nobody else.
   * The membership row is written so the grant is visible and permanent
   * rather than re-derived on every request.
   */
  if (!branchMember) {
    const org = await platformPrisma.org.findFirst({
      where: { accountId, id: orgId },
      select: { createdByUserId: true },
    });
    if (org?.createdByUserId === userId) {
      const inOrg = await platformPrisma.branch.findFirst({
        where: { id: branchId, accountId, orgId },
        select: { id: true },
      });
      if (inOrg) {
        branchMember = await platformPrisma.userBranchMembership.create({
          data: { accountId, orgId, branchId, userId },
          select: { id: true },
        });
      }
    }
  }
  if (!branchMember) return { status: 403, error: 'No access to branch' };

  const allowed = await platformPrisma.userBranchMembership.findMany({
    where: { accountId, orgId, userId },
    select: { branchId: true },
  });

  // Warehouse is resolved but NOT enforced here.
  //
  // The header is sent by the client on almost every request, including ones
  // that have nothing to do with stock — the ledger, approvals, settings.
  // Rejecting those because the user lacks access to whichever warehouse
  // happened to be selected produced 'No access to warehouse' on a trial
  // balance. Routes that genuinely act on a warehouse call requireWarehouse
  // below, which is where the check belongs.
  let allowedWarehouseIds: string[] = [];
  let resolvedWarehouseId: string | undefined;

  if (warehouseId) {
    const allWh = await platformPrisma.userWarehouseAccess.findMany({
      where: { accountId, orgId, userId },
      select: { warehouseId: true },
    });
    allowedWarehouseIds = allWh.map((x: { warehouseId: string }) => x.warehouseId);

    // The org creator reaches every warehouse in their own organisation.
    //
    // Warehouse access is only ever granted by an administrator assigning it to
    // somebody else, so the creator of a brand-new company had none: they could
    // create a warehouse and then be told 'No access to warehouse' by every
    // stock route, with no way to grant it to themselves. This mirrors the
    // permission safety net in rbac.ts, and is deliberately narrow — it applies
    // to the creator of this org and to nobody else.
    if (!allowedWarehouseIds.includes(warehouseId)) {
      const org = await platformPrisma.org.findFirst({
        where: { accountId, id: orgId },
        select: { createdByUserId: true },
      });
      if (org?.createdByUserId === userId) {
        const inOrg = await prisma.warehouse.findFirst({
          where: { id: warehouseId, accountId, orgId },
          select: { id: true },
        });
        if (inOrg) allowedWarehouseIds = [...allowedWarehouseIds, warehouseId];
      }
    }

    // Only treat it as the active warehouse when the user may actually use it.
    if (allowedWarehouseIds.includes(warehouseId)) resolvedWarehouseId = warehouseId;
  }

  const tenant: TenantContext = {
    accountId,
    orgId,
    branchId,
    allowedBranchIds: allowed.map((x: { branchId: string }) => x.branchId),
    warehouseId: resolvedWarehouseId,
    requestedWarehouseId: warehouseId || undefined,
    allowedWarehouseIds: allowedWarehouseIds.length ? allowedWarehouseIds : undefined,
  };
  return { tenant };

}

const isOrgCreator = async (accountId: string, orgId: string, userId: string) => {
  const org = await platformPrisma.org.findFirst({ where: { accountId, id: orgId }, select: { createdByUserId: true } });
  return org?.createdByUserId === userId;
};

/**
 * Whether this person may act in this branch / warehouse, for routes that
 * name one in the body rather than the header.
 *
 * The same rule the header path above applies — an explicit grant, or the
 * org's creator reaching anything that is really in their org — in one place.
 * Stock adjustments and inter-branch transfers read the grant tables
 * directly, so the creator of a company was told "No access to warehouse"
 * there and nowhere else.
 */
export async function userMayUseBranch(accountId: string, orgId: string, userId: string, branchId: string) {
  const m = await platformPrisma.userBranchMembership.findFirst({ where: { accountId, orgId, branchId, userId }, select: { id: true } });
  if (m) return true;
  if (!(await isOrgCreator(accountId, orgId, userId))) return false;
  return Boolean(await platformPrisma.branch.findFirst({ where: { id: branchId, accountId, orgId }, select: { id: true } }));
}

export async function userMayUseWarehouse(accountId: string, orgId: string, userId: string, warehouseId: string) {
  const m = await platformPrisma.userWarehouseAccess.findFirst({ where: { accountId, orgId, warehouseId, userId }, select: { id: true } });
  if (m) return true;
  if (!(await isOrgCreator(accountId, orgId, userId))) return false;
  return Boolean(await prisma.warehouse.findFirst({ where: { id: warehouseId, accountId, orgId }, select: { id: true } }));
}

/**
 * Enforces warehouse access, for routes that actually operate on stock.
 *
 * Kept separate from requireTenantContext so a stray header cannot break
 * unrelated requests, while a stock movement still cannot be posted into a
 * warehouse the user has no rights to.
 */
export function requireWarehouse(req: Request, res: Response, next: NextFunction) {
  const requested = req.tenant?.requestedWarehouseId;
  if (!requested) return res.status(400).json({ error: 'Missing x-warehouse-id' });
  if (!req.tenant?.warehouseId) return res.status(403).json({ error: 'No access to warehouse' });
  return next();
}
