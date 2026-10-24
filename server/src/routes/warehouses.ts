import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { validateGstinOrThrow } from '../utils/gstin.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { forgetWarehouseAccess } from '../services/integrity/crossStore.js';

export const warehousesRouter = Router();
warehousesRouter.use(requireAuth, requireTenantContext);

const warehouseSchema = z.object({
  branchId: z.string().min(1),
  code: z.string().min(1).max(20).optional(),
  name: z.string().min(1).max(200),
  addressLine1: z.string().max(250).optional().nullable(),
  addressLine2: z.string().max(250).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  gstin: z.string().max(15).optional().nullable(),
  gstRegistrationType: z.enum(['REGULAR', 'COMPOSITION', 'UNREGISTERED']).default('UNREGISTERED'),
  contactPerson: z.string().max(100).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email().optional().nullable(),
  isActive: z.boolean().optional(),
});

// Reference data, not administration: every document form (invoice, transfer,
// stock entry) needs the branch and warehouse lists to render its location
// pickers. Gating the READ behind MASTERS::Company/Branch setup meant any role
// without that grant saw empty mandatory dropdowns and could not raise a
// document at all. Creating or editing a branch/warehouse is still gated
// below; membership already limits which rows a user may act on.
warehousesRouter.get('/orgs/:orgId/warehouses', async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const rows = await prisma.warehouse.findMany({
    where: { accountId, orgId },
    orderBy: [{ name: 'asc' }],
  });

  res.json({ warehouses: rows });
});

warehousesRouter.post('/orgs/:orgId/warehouses', requirePermission('MASTERS', PermissionAction.CREATE, 'Company/Branch setup'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const userId = req.auth!.userId;
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const body = warehouseSchema.parse(req.body);

  const branch = await platformPrisma.branch.findFirst({ where: { accountId, orgId, id: body.branchId } });
  if (!branch) return res.status(400).json({ error: 'Invalid branch' });

  if (body.gstRegistrationType !== 'UNREGISTERED' && body.gstin) {
    validateGstinOrThrow(String(body.gstin), body.state || branch.state);
  }

  const created = await prisma.warehouse.create({
    data: {
      accountId,
      orgId,
      branchId: body.branchId,
      code: String(body.code || `WH-${Date.now().toString(36).toUpperCase()}`).slice(0, 20),
      name: body.name,
      addressLine1: body.addressLine1 ?? null,
      addressLine2: body.addressLine2 ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      country: body.country ?? null,
      gstin: body.gstin ? String(body.gstin).toUpperCase() : null,
      gstRegistrationType: body.gstRegistrationType as any,
      contactPerson: body.contactPerson ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      isActive: body.isActive ?? true,
      createdByUserId: userId,
    },
  });

  res.status(201).json({ warehouse: created });
});

warehousesRouter.patch('/orgs/:orgId/warehouses/:warehouseId', requirePermission('MASTERS', PermissionAction.EDIT, 'Company/Branch setup'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const userId = req.auth!.userId;
  const warehouseId = String(req.params.warehouseId);
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const body = warehouseSchema.partial().parse(req.body);

  const existing = await prisma.warehouse.findFirst({ where: { accountId, orgId, id: warehouseId } });
  if (!existing) return res.status(404).json({ error: 'Warehouse not found' });

  const nextBranchId = body.branchId ?? existing.branchId;
  const branch = await platformPrisma.branch.findFirst({ where: { accountId, orgId, id: nextBranchId } });
  if (!branch) return res.status(400).json({ error: 'Invalid branch' });

  const nextState = body.state ?? existing.state ?? branch.state;
  const nextGstin = body.gstin ?? existing.gstin;
  const nextReg = body.gstRegistrationType ?? existing.gstRegistrationType;
  if (nextReg !== 'UNREGISTERED' && nextGstin) {
    validateGstinOrThrow(String(nextGstin), nextState || '');
  }

  const updated = await prisma.warehouse.update({
    where: { id: warehouseId },
    data: {
      ...('branchId' in body ? { branchId: body.branchId } : {}),
      // A warehouse code is an accounting identity. It is assigned once and
      // deliberately excluded from updates.
      ...('name' in body ? { name: body.name! } : {}),
      ...('addressLine1' in body ? { addressLine1: body.addressLine1 ?? null } : {}),
      ...('addressLine2' in body ? { addressLine2: body.addressLine2 ?? null } : {}),
      ...('city' in body ? { city: body.city ?? null } : {}),
      ...('state' in body ? { state: body.state ?? null } : {}),
      ...('country' in body ? { country: body.country ?? null } : {}),
      ...('gstin' in body ? { gstin: body.gstin ? String(body.gstin).toUpperCase() : null } : {}),
      ...('gstRegistrationType' in body ? { gstRegistrationType: body.gstRegistrationType as any } : {}),
      ...('contactPerson' in body ? { contactPerson: body.contactPerson ?? null } : {}),
      ...('phone' in body ? { phone: body.phone ?? null } : {}),
      ...('email' in body ? { email: body.email ?? null } : {}),
      ...('isActive' in body ? { isActive: body.isActive } : {}),
      createdByUserId: existing.createdByUserId || userId,
    },
  });

  res.json({ warehouse: updated });
});

warehousesRouter.delete('/orgs/:orgId/warehouses/:warehouseId', requirePermission('MASTERS', PermissionAction.DELETE, 'Company/Branch setup'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const warehouseId = String(req.params.warehouseId);
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const existing = await prisma.warehouse.findFirst({ where: { accountId, orgId, id: warehouseId } });
  if (!existing) return res.status(404).json({ error: 'Warehouse not found' });

  const transactionCounts = await Promise.all([
    prisma.invoice.count({ where: { accountId, orgId, warehouseId } }),
    prisma.bill.count({ where: { accountId, orgId, warehouseId } }),
    prisma.purchaseOrderDoc.count({ where: { accountId, orgId, warehouseId } }),
    prisma.salesOrderDoc.count({ where: { accountId, orgId, warehouseId } }),
    prisma.deliveryChallan.count({ where: { accountId, orgId, warehouseId } }),
    prisma.expense.count({ where: { accountId, orgId, warehouseId } }),
    prisma.creditNote.count({ where: { accountId, orgId, warehouseId } }),
    prisma.debitNote.count({ where: { accountId, orgId, warehouseId } }),
    prisma.inventoryAdjustment.count({ where: { accountId, orgId, warehouseId } }),
    prisma.interBranchTransfer.count({ where: { accountId, orgId, OR: [{ sourceWarehouseId: warehouseId }, { targetWarehouseId: warehouseId }] } }),
  ]);
  if (transactionCounts.some((count) => count > 0)) {
    return res.status(409).json({ error: 'This warehouse cannot be deleted because transactions are associated with it. Mark it inactive instead.' });
  }

  try {
    await prisma.warehouse.delete({ where: { id: warehouseId } });
  } catch (error: any) {
    if (error?.code === 'P2003') {
      return res.status(409).json({ error: 'This warehouse cannot be deleted because records are associated with it. Mark it inactive instead.' });
    }
    throw error;
  }
  /* GAP-010: the access people had to it lives in the platform database. */
  await forgetWarehouseAccess({ accountId, orgId }, warehouseId);
  res.json({ ok: true });
});
