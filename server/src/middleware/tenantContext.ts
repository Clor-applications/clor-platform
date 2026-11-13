import { isArchived } from '../services/companyArchive.js';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { cachedAccess } from '../utils/accessCache.js';
import { outsideTenant, runInTenant } from '../utils/tenantScope.js';
import { TWO_FACTOR_SETUP_PATHS, adminTwoFactorMissing } from '../services/twoFactorPolicy.js';
import { userIsAdmin } from '../services/roleGuards.js';
import { outsideAccessFor } from '../services/outsideAccess.js';
import { operatorRole } from './operator.js';
import { liveGrantFor, recordGrantUse } from '../services/supportGrants.js';
import { fullPath, supportGrantLimits } from './supportGrantLimits.js';
import { companyEntryRefusal } from '../services/signInRules.js';
import { auditBefore } from './auditMutations.js';

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
  /** GAP-006: for a person from another account, the apps the company let them use here (null = all it has). */
  outsideApps?: string[] | null;
  /** The support grant this request came in on, when it is CLOR staff looking (docs/workspace/SUPPORT_GRANTS.md). */
  supportGrant?: { id: string; scope: 'READ_ONLY' | 'READ_WRITE' };
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
const ARCHIVED_STILL_ALLOWED = /^\/account\/|\/closure$|\/notifications(\/|$)|\/security\/two-factor/;

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

  /*
   * A single sign-on session was vouched for by one company's identity
   * provider, so it opens that company and no other (audit 11 Nov 2026): the
   * person's other companies never agreed to trust that provider, and their
   * own two-factor rule would be skipped. A password sign-in opens the rest.
   */
  const ssoOrgId = String(req.auth?.ssoOrgId || '').trim();
  if (ssoOrgId && ssoOrgId !== orgId) {
    return res.status(403).json({
      error: 'You signed in through one company\'s single sign-on, which opens that company only. Sign out and sign in with your password to open this one.',
      code: 'SSO_OTHER_COMPANY',
    });
  }

  const result = await cachedAccess(
    `tenant|${userId}|${orgId}|${branchId}|${warehouseId}`,
    /* Is this person a member of this company at all: asked before the company is in scope (A-35). */
    () => outsideTenant('tenant context: membership of the company asked for', () => resolveTenant(userId, orgId, branchId, warehouseId)),
    (r) => 'tenant' in r // cache grants only; a denial is re-checked every time
  );
  if (!('tenant' in result)) return res.status(result.status).json({ error: result.error, ...(result.code ? { code: result.code } : {}) });
  req.tenant = { ...result.tenant }; // the cached object is shared between requests

  /*
   * An archived company is read-only (services/companyArchive.ts): every write
   * is refused, reading and exporting are not. Still allowed: scheduling or
   * cancelling its closure, marking notifications read, and a person's own
   * authenticator. Reactivating is an account route, outside this middleware.
   */
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !ARCHIVED_STILL_ALLOWED.test(req.path) && (await isArchived(req.tenant.orgId))) {
    return res.status(403).json({ error: 'This company is archived, so it is read-only. An account owner or admin can reactivate it in Workspace → Companies.', code: 'COMPANY_ARCHIVED' });
  }

  /*
   * A company that requires two-factor sign-in for its owners and admins
   * (SX-09): until this person sets up an authenticator, only their own
   * two-factor set-up is open to them here.
   */
  const mustSetUp = await cachedAccess(`2fa|${userId}|${orgId}`, () => runInTenant(orgId, () => adminTwoFactorMissing(userId, orgId)));
  if (mustSetUp && !TWO_FACTOR_SETUP_PATHS.test(req.path)) {
    return res.status(403).json({ error: 'This company asks owners and admins to sign in with an authenticator app. Set one up under My profile → Security first.', code: 'TWO_FACTOR_SETUP_REQUIRED' });
  }

  /*
   * What CLOR staff may do on a grant, decided here rather than in each router:
   * every route that resolves a tenant comes through this line, so a read-only
   * session cannot write and salary, documents and bank details stay shut.
   * A request that is not on a grant passes straight through.
   */
  let allowed = false;
  supportGrantLimits(req, res, () => {
    allowed = true;
  });
  if (!allowed) return undefined; /* it has already answered 403 */
  if (req.tenant.supportGrant) {
    recordGrantUse({ accountId: req.tenant.accountId, orgId: req.tenant.orgId, grantId: req.tenant.supportGrant.id, userId: req.auth!.userId, method: req.method, path: fullPath(req) });
  }

  /* From here on every query this request makes names its company to the database (utils/tenantScope.ts).
     A change the edit log records is read as it was first, before the handler (middleware/auditMutations.ts). */
  return runInTenant(req.tenant.orgId, () => auditBefore(req, res, next));
}

type TenantResult = { tenant: TenantContext } | { status: number; error: string; code?: string };

/**
 * The membership checks behind requireTenantContext, as a pure lookup so the
 * answer can be cached for a few seconds (see utils/accessCache.ts).
 */
async function resolveTenant(userId: string, orgId: string, branchId: string, warehouseId: string): Promise<TenantResult> {
  const orgMember = await platformPrisma.userOrgMembership.findFirst({
    where: { orgId, userId },
    select: { accountId: true },
  });

  /*
   * CLOR staff hold no membership in a customer's company, so the line above
   * is where they are refused — and a live support grant is the one thing that
   * changes that (docs/workspace/SUPPORT_GRANTS.md).
   *
   * Two conditions, not one. The grant row says the customer agreed; being an
   * operator *now* says CLOR still employs them, so taking somebody off the
   * staff closes their open grants without anyone hunting for the rows.
   *
   * Like every other answer here this is cached for a few seconds, so ending a
   * grant takes effect within that window, as a suspension does.
   */
  let grant: { id: string; scope: 'READ_ONLY' | 'READ_WRITE' } | undefined;
  if (!orgMember) {
    const live = await liveGrantFor(userId, orgId);
    if (!live) return { status: 403, error: 'No access to org' };
    if (!(await operatorRole(userId))) return { status: 403, error: 'No access to org' };
    grant = { id: live.id, scope: live.scope as 'READ_ONLY' | 'READ_WRITE' };
  }

  // The owning account, established by the membership — or by the grant, which names it.
  const accountId = orgMember?.accountId ?? (await platformPrisma.org.findUnique({ where: { id: orgId }, select: { accountId: true } }))?.accountId;
  if (!accountId) return { status: 403, error: 'No access to org' };

  /*
   * A-09: and checked against the company itself. A membership row naming the
   * wrong account (nothing writes one today; the unique key would allow it)
   * would otherwise carry its account into every check that follows.
   */
  const owner = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { accountId: true } });
  if (!owner || owner.accountId !== accountId) return { status: 403, error: 'No access to org' };

  /* W-8.2: an account a Clor operator has suspended opens none of its companies, to anybody, until reinstated. */
  const acct = await platformPrisma.account.findUnique({ where: { id: accountId }, select: { suspendedAt: true } });
  if (acct?.suspendedAt) return { status: 403, error: 'This account has been suspended by CLOR. Contact support@clor.in.', code: 'ACCOUNT_SUSPENDED' };

  /*
   * #4: the company's own rules on who may open it — a confirmed address, an
   * allowed domain (services/signInRules.ts). These are about the people the
   * company employs. CLOR staff on a grant are not one of them, and the
   * customer already said yes to the person by name, so an allowed-domain rule
   * does not get to overrule that.
   */
  if (!grant) {
    const entry = await companyEntryRefusal(userId, orgId, accountId);
    if (entry) return entry;
  }

  /*
   * GAP-006: somebody from another account (an accountant, an auditor) is let
   * in by the company's own engagement — live, not paused, not past its end —
   * or not at all. Their membership alone opens nothing.
   */
  /* A grant is CLOR's own door, not an engagement: the customer never invited
     staff as an outside accountant, so there is no engagement to find. */
  const outside = grant ? ({ own: true } as const) : await outsideAccessFor(userId, orgId, accountId);
  if (!outside.own && 'refused' in outside && outside.refused) return { status: 403, error: outside.refused.error, code: outside.refused.code };
  const outsideApps = !outside.own && 'apps' in outside ? outside.apps ?? null : undefined;

  /*
   * W-4.3: a person suspended in their own account opens none of its
   * companies, whatever their company roles say. (An outside person is
   * governed by their engagement above.) Takes effect within the access
   * cache's few seconds, and at once where the suspension clears the cache.
   */
  if (outside.own && !grant) {
    const m = await platformPrisma.accountMembership.findUnique({ where: { accountId_userId: { accountId, userId } }, select: { status: true } });
    if (m?.status === 'SUSPENDED') return { status: 403, error: 'Your access to this account has been suspended. Ask an owner or administrator of the account.', code: 'ACCOUNT_MEMBER_SUSPENDED' };
  }

  let branchMember = await platformPrisma.userBranchMembership.findFirst({
    where: { accountId, orgId, branchId, userId },
    select: { id: true },
  });

  /*
   * An administrator of the whole company reaches every branch in it — the
   * same safety net the warehouses carry below, for the same reason:
   * membership is only ever granted by an administrator assigning it to
   * somebody else, so the administrator of a brand-new branch had none and
   * every route 403ed with no way to grant it to themselves. Narrow on
   * purpose: a company-wide administrator of THIS org, a branch that really
   * is in it. The membership row is written so the grant is visible and
   * permanent rather than re-derived on every request.
   *
   * A-24: this used to be the person who created the company, whatever their
   * role now — a creator an administrator had demoted still reached every
   * branch and warehouse, and a second administrator reached none.
   */
  if (!branchMember) {
    if (await reachesEverything(accountId, orgId, userId)) {
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
  /*
   * CLOR staff on a grant reach the company's branches without a membership
   * row, and no row is written for them: a grant ends, and nothing about the
   * customer's own membership list should change because support looked once.
   * The branch must really belong to this company, as it must for anybody.
   */
  let grantBranchIds: string[] | null = null;
  if (!branchMember && grant) {
    const branches = await platformPrisma.branch.findMany({ where: { accountId, orgId }, select: { id: true } });
    if (branches.some((b) => b.id === branchId)) grantBranchIds = branches.map((b) => b.id);
  }
  if (!branchMember && !grantBranchIds) return { status: 403, error: 'No access to branch' };

  const allowed = grantBranchIds
    ? grantBranchIds.map((branchId) => ({ branchId }))
    : await platformPrisma.userBranchMembership.findMany({
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

    // A company-wide administrator reaches every warehouse in the company.
    //
    // Warehouse access is only ever granted by an administrator assigning it to
    // somebody else, so the administrator of a brand-new company had none: they
    // could create a warehouse and then be told 'No access to warehouse' by
    // every stock route, with no way to grant it to themselves.
    if (!allowedWarehouseIds.includes(warehouseId)) {
      if (await reachesEverything(accountId, orgId, userId)) {
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
    ...(outsideApps !== undefined ? { outsideApps } : {}),
    /* Carried so the read-only rule and the audit trail know this was CLOR staff looking. */
    ...(grant ? { supportGrant: grant } : {}),
  };
  return { tenant };

}

/** Who reaches every branch and warehouse without a grant: a company-wide administrator (A-24). */
const reachesEverything = (accountId: string, orgId: string, userId: string) => userIsAdmin(accountId, orgId, userId);

/**
 * Whether this person may act in this branch / warehouse, for routes that
 * name one in the body rather than the header.
 *
 * The same rule the header path above applies — an explicit grant, or a
 * company-wide administrator reaching anything that is really in the company.
 * Stock adjustments and inter-branch transfers read the grant tables
 * directly, so the creator of a company was told "No access to warehouse"
 * there and nowhere else.
 */
export async function userMayUseBranch(accountId: string, orgId: string, userId: string, branchId: string) {
  const m = await platformPrisma.userBranchMembership.findFirst({ where: { accountId, orgId, branchId, userId }, select: { id: true } });
  if (m) return true;
  if (!(await reachesEverything(accountId, orgId, userId))) return false;
  return Boolean(await platformPrisma.branch.findFirst({ where: { id: branchId, accountId, orgId }, select: { id: true } }));
}

export async function userMayUseWarehouse(accountId: string, orgId: string, userId: string, warehouseId: string) {
  const m = await platformPrisma.userWarehouseAccess.findFirst({ where: { accountId, orgId, warehouseId, userId }, select: { id: true } });
  if (m) return true;
  if (!(await reachesEverything(accountId, orgId, userId))) return false;
  return Boolean(await prisma.warehouse.findFirst({ where: { id: warehouseId, accountId, orgId }, select: { id: true } }));
}

/**
 * Why a warehouse named in a document's body must be refused, or null (A-24).
 *
 * Invoices, bills, debit notes, orders and POS sales stored whatever
 * `warehouseId` the body carried — another company's, or one this person was
 * never given — and the stock check then read and moved stock there. Empty
 * means "no particular warehouse" and is allowed.
 */
export async function warehouseRefusal(req: Request, warehouseId: unknown) {
  const id = String(warehouseId ?? '').trim();
  if (!id) return null;
  const { accountId, orgId } = req.tenant!;
  const inOrg = await prisma.warehouse.findFirst({ where: { id, accountId, orgId }, select: { id: true } });
  if (!inOrg) return { status: 400, body: { error: 'That warehouse is not in this company.', code: 'WAREHOUSE_NOT_IN_COMPANY' } };
  if (!(await userMayUseWarehouse(accountId, orgId, req.auth!.userId, id))) {
    return { status: 403, body: { error: 'No access to warehouse', code: 'NO_WAREHOUSE_ACCESS' } };
  }
  return null;
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
