import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { validateGstinOrThrow } from '../utils/gstin.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';

export const branchesRouter = Router();

// Uses tenant context headers for isolation.
branchesRouter.use(requireAuth, requireTenantContext);

const branchSchema = z.object({
  branchCode: z.string().min(1).max(20),
  branchName: z.string().min(1).max(200),
  addressLine1: z.string().min(1).max(250),
  addressLine2: z.string().max(250).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().min(1).max(100),
  country: z.string().min(1).max(100).default('India'),
  gstin: z.string().max(15).optional().nullable(),
  gstRegistrationType: z.enum(['REGULAR', 'COMPOSITION', 'UNREGISTERED']).default('UNREGISTERED'),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email().optional().nullable(),
  contactPerson: z.string().max(100).optional().nullable(),
  isActive: z.boolean().optional(),
  parentBranchId: z.string().optional().nullable(),
  shareHeadOfficeSettings: z.boolean().optional().default(false),
});

// Reference data, not administration: every document form (invoice, transfer,
// stock entry) needs the branch and warehouse lists to render its location
// pickers. Gating the READ behind MASTERS::Company/Branch setup meant any role
// without that grant saw empty mandatory dropdowns and could not raise a
// document at all. Creating or editing a branch/warehouse is still gated
// below; membership already limits which rows a user may act on.
branchesRouter.get('/orgs/:orgId/branches', async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);

  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const rows = await platformPrisma.branch.findMany({
    where: { accountId, orgId },
    orderBy: [{ branchCode: 'asc' }],
  });

  res.json({ branches: rows });
});

branchesRouter.post('/orgs/:orgId/branches', requirePermission('MASTERS', PermissionAction.CREATE, 'Company/Branch setup'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const userId = req.auth!.userId;
  const orgId = String(req.params.orgId);

  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const body = branchSchema.parse(req.body);

  // GST rules
  if (body.gstRegistrationType !== 'UNREGISTERED') {
    validateGstinOrThrow(String(body.gstin || ''), body.state);
  }

  /*
   * Creating a branch also joins you to it.
   *
   * It did not, so the person who had just added a branch got 403 "No access
   * to branch" the moment they switched to it — the warehouses under it would
   * not list, and no document could be raised there. A branch you cannot enter
   * is not a branch, and the creator is the one person certain to want in.
   *
   * Both writes or neither: a branch with no membership is the broken state
   * this is fixing, so it must not be reachable by a half-failed create.
   */
  const created = await platformPrisma.$transaction(async (tx) => {
    const branch = await tx.branch.create({
    data: {
      accountId,
      orgId,
      branchCode: body.branchCode,
      branchName: body.branchName,
      addressLine1: body.addressLine1,
      addressLine2: body.addressLine2 ?? null,
      city: body.city ?? null,
      state: body.state,
      country: body.country,
      gstin: body.gstin ? String(body.gstin).toUpperCase() : null,
      gstRegistrationType: body.gstRegistrationType as any,
      phone: body.phone ?? null,
      email: body.email ?? null,
      contactPerson: body.contactPerson ?? null,
      isActive: body.isActive ?? true,
      parentBranchId: body.parentBranchId ?? null,
      shareHeadOfficeSettings: Boolean(body.shareHeadOfficeSettings),
      createdByUserId: userId,
    } as any,
    });

    await tx.userBranchMembership.create({
      data: { accountId, orgId, branchId: branch.id, userId },
    });

    return branch;
  });

  res.status(201).json({ branch: created });
});

branchesRouter.patch('/orgs/:orgId/branches/:branchId', requirePermission('MASTERS', PermissionAction.EDIT, 'Company/Branch setup'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const userId = req.auth!.userId;
  const orgId = String(req.params.orgId);
  const branchId = String(req.params.branchId);

  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const body = branchSchema.partial().parse(req.body);

  const existing = await platformPrisma.branch.findFirst({
    where: { accountId, orgId, id: branchId },
  });
  if (!existing) return res.status(404).json({ error: 'Branch not found' });

  const nextState = body.state ?? existing.state;
  const nextGstin = body.gstin ?? existing.gstin;
  const nextRegType = body.gstRegistrationType ?? existing.gstRegistrationType;

  if (nextRegType !== 'UNREGISTERED') {
    validateGstinOrThrow(String(nextGstin || ''), nextState);
  }

  const updated = await platformPrisma.branch.update({
    where: { id: branchId },
    data: {
      // Branch code is a permanent accounting identity after creation.
      ...('branchName' in body ? { branchName: body.branchName } : {}),
      ...('addressLine1' in body ? { addressLine1: body.addressLine1 } : {}),
      ...('addressLine2' in body ? { addressLine2: body.addressLine2 ?? null } : {}),
      ...('city' in body ? { city: body.city ?? null } : {}),
      ...('state' in body ? { state: body.state } : {}),
      ...('country' in body ? { country: body.country } : {}),
      ...('gstin' in body ? { gstin: body.gstin ? String(body.gstin).toUpperCase() : null } : {}),
      ...('gstRegistrationType' in body ? { gstRegistrationType: body.gstRegistrationType as any } : {}),
      ...('phone' in body ? { phone: body.phone ?? null } : {}),
      ...('email' in body ? { email: body.email ?? null } : {}),
      ...('contactPerson' in body ? { contactPerson: body.contactPerson ?? null } : {}),
      ...('isActive' in body ? { isActive: body.isActive } : {}),
      ...('parentBranchId' in body ? { parentBranchId: body.parentBranchId ?? null } : {}),
      ...('shareHeadOfficeSettings' in body ? { shareHeadOfficeSettings: Boolean(body.shareHeadOfficeSettings) } : {}),
      // update audit via updatedAt (Prisma @updatedAt)
      createdByUserId: existing.createdByUserId || userId,
    } as any,
  });

  res.json({ branch: updated });
});

branchesRouter.delete('/orgs/:orgId/branches/:branchId', requirePermission('MASTERS', PermissionAction.DELETE, 'Company/Branch setup'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const branchId = String(req.params.branchId);

  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const existing = await platformPrisma.branch.findFirst({ where: { accountId, orgId, id: branchId } });
  if (!existing) return res.status(404).json({ error: 'Branch not found' });

  const transactionCounts = await Promise.all([
    prisma.invoice.count({ where: { accountId, orgId, branchId } }),
    prisma.bill.count({ where: { accountId, orgId, branchId } }),
    prisma.estimate.count({ where: { accountId, orgId, branchId } }),
    prisma.purchaseOrderDoc.count({ where: { accountId, orgId, branchId } }),
    prisma.salesOrderDoc.count({ where: { accountId, orgId, branchId } }),
    prisma.deliveryChallan.count({ where: { accountId, orgId, branchId } }),
    prisma.expense.count({ where: { accountId, orgId, branchId } }),
    prisma.creditNote.count({ where: { accountId, orgId, branchId } }),
    prisma.debitNote.count({ where: { accountId, orgId, branchId } }),
    prisma.journalEntry.count({ where: { accountId, orgId, branchId } }),
    prisma.payment.count({ where: { accountId, orgId, branchId } }),
    prisma.inventoryAdjustment.count({ where: { accountId, orgId, branchId } }),
    prisma.interBranchTransfer.count({ where: { accountId, orgId, OR: [{ branchId }, { sourceBranchId: branchId }, { targetBranchId: branchId }] } }),
  ]);
  if (transactionCounts.some((count) => count > 0)) {
    return res.status(409).json({ error: 'This branch cannot be deleted because transactions are associated with it. Mark it inactive instead.' });
  }

  const childBranch = await platformPrisma.branch.findFirst({ where: { accountId, orgId, parentBranchId: branchId }, select: { id: true } });
  if (childBranch) {
    return res.status(409).json({ error: 'This branch cannot be deleted while another branch is linked below it.' });
  }

  try {
    await platformPrisma.branch.delete({ where: { id: branchId } });
  } catch (error: any) {
    if (error?.code === 'P2003') {
      return res.status(409).json({ error: 'This branch cannot be deleted because records are associated with it. Mark it inactive instead.' });
    }
    throw error;
  }
  res.json({ ok: true });
});
