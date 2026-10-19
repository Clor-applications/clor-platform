import { Router } from 'express';

import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { entitlementFor } from '../services/entitlements.js';
import { outsideTenant } from '../utils/tenantScope.js';

/**
 * The account, above any one company.
 *
 * Everything in this product is scoped to a company, which is right for doing
 * the work and wrong for running the business that does it. A CA firm with
 * twenty clients had no screen that could answer "how many companies do we
 * have, who has access to them, and how close are we to the plan's limits" —
 * the only way to find out was to enter each company in turn.
 *
 * The figures are real. There is no mock here: the account, its companies and
 * its people all exist on the server already.
 */
export const accountRouter = Router();
accountRouter.use(requireAuth, requireTenantContext);

const ACCOUNT_VIEW = requirePermission('SETTINGS', PermissionAction.VIEW, 'Company Profile');

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

accountRouter.get('/account/overview', ACCOUNT_VIEW, (req, res) =>
  outsideTenant('account overview: every company on the account, each with its own figures', async () => {
  const { accountId } = req.tenant!;

  const [account, orgs, users, entitlement] = await Promise.all([
    platformPrisma.account.findFirst({ where: { id: accountId }, select: { id: true, code: true, name: true, createdAt: true } }),
    platformPrisma.org.findMany({
      where: { accountId },
      select: { id: true, name: true, slug: true, pan: true, createdAt: true },
      orderBy: { name: 'asc' },
    }),
    platformPrisma.user.findMany({
      where: { accountId },
      select: { id: true, fullName: true, email: true, isActive: true, lastLoginAt: true },
      orderBy: { fullName: 'asc' },
    }),
    entitlementFor(accountId),
  ]);

  const orgIds = orgs.map((o) => o.id);

  /*
   * Counted in one query each rather than per company. A practice with fifty
   * clients would otherwise make a hundred and fifty round trips to draw one
   * screen.
   */
  /*
   * The state and the GSTIN live on the head-office branch, not on the org.
   *
   * That is where setup-company writes them, and the state is worth showing
   * here because it decides whether every invoice the company raises splits
   * into CGST and SGST or lands as IGST.
   */
  const [headOffices, memberships, invoices] = await Promise.all([
    platformPrisma.branch.findMany({
      where: { accountId, orgId: { in: orgIds }, branchCode: 'HO' },
      select: { orgId: true, state: true, gstin: true },
    }),
    platformPrisma.userOrgMembership.groupBy({
      by: ['orgId'],
      where: { accountId, orgId: { in: orgIds } },
      _count: true,
    }),
    prisma.invoice.groupBy({
      by: ['orgId'],
      where: { accountId, orgId: { in: orgIds } },
      _count: true,
      _sum: { total: true, paidAmount: true },
    }),
  ]);

  const headByOrg = new Map(headOffices.map((b) => [b.orgId, b]));
  const peopleByOrg = new Map(memberships.map((m) => [m.orgId, Number(m._count) || 0]));
  const billedByOrg = new Map(
    invoices.map((i) => [i.orgId, { count: Number(i._count) || 0, billed: num(i._sum.total), settled: num(i._sum.paidAmount) }])
  );

  res.json({
    account: account ? { id: account.id, code: account.code || null, name: account.name, since: account.createdAt } : null,
    plan: {
      key: entitlement.planKey,
      name: entitlement.planName,
      status: entitlement.status,
      inGoodStanding: entitlement.inGoodStanding,
      limits: entitlement.limits,
    },
    usage: {
      companies: orgs.length,
      users: users.filter((u) => u.isActive).length,
    },
    companies: orgs.map((o) => {
      const billing = billedByOrg.get(o.id) || { count: 0, billed: 0, settled: 0 };
      const head = headByOrg.get(o.id);
      return {
        orgId: o.id,
        name: o.name,
        slug: o.slug || '',
        // The company master lives in a JSON column; the state is the one field
        // from it worth showing here, because it decides how every invoice the
        // company raises is taxed.
        state: head?.state || '',
        gstin: head?.gstin || '',
        pan: o.pan || '',
        since: o.createdAt,
        people: peopleByOrg.get(o.id) || 0,
        invoices: billing.count,
        billed: billing.billed,
        /* What is still owed. Never below zero: an overpayment is not a credit
           to the company's turnover. */
        outstanding: Math.max(0, Math.round((billing.billed - billing.settled) * 100) / 100),
      };
    }),
    users: users.map((u) => ({
      id: u.id,
      name: u.fullName,
      email: u.email,
      active: u.isActive,
      lastLoginAt: u.lastLoginAt,
    })),
  });
  }));

export default accountRouter;
