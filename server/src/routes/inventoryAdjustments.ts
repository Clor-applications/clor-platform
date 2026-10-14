import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { userMayUseBranch, userMayUseWarehouse } from '../middleware/tenantContext.js';

export const inventoryAdjustmentsRouter = Router();
inventoryAdjustmentsRouter.use(requireAuth, requireTenantContext);

const adjustmentSchema = z.object({
  branchId: z.string().min(1),
  warehouseId: z.string().min(1),
  itemId: z.string().min(1),
  qtyDelta: z.number().nonnegative().or(z.number().negative()),
  reason: z.string().min(1).max(200),
});

inventoryAdjustmentsRouter.get('/orgs/:orgId/adjustments', requirePermission('INVENTORY', PermissionAction.VIEW, 'Stock Adjustment'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const rows = await prisma.inventoryAdjustment.findMany({
    where: { accountId, orgId, branchId: req.tenant!.branchId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ adjustments: rows });
});

inventoryAdjustmentsRouter.post('/orgs/:orgId/adjustments', requirePermission('INVENTORY', PermissionAction.CREATE, 'Stock Adjustment'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const userId = req.auth!.userId;
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const body = adjustmentSchema.parse(req.body);

  // Access check to branch/warehouse
  if (!(await userMayUseBranch(accountId, orgId, userId, body.branchId))) return res.status(403).json({ error: 'No access to branch' });
  if (!(await userMayUseWarehouse(accountId, orgId, userId, body.warehouseId))) return res.status(403).json({ error: 'No access to warehouse' });
  const wh = await prisma.warehouse.findFirst({ where: { id: body.warehouseId, accountId, orgId, branchId: body.branchId }, select: { id: true } });
  if (!wh) return res.status(400).json({ error: 'That warehouse is not in that branch' });

  const item = await prisma.item.findFirst({ where: { accountId, orgId, id: body.itemId } });
  if (!item) return res.status(400).json({ error: 'Invalid item' });

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const sb = await tx.stockBalance.upsert({
      where: { orgId_branchId_warehouseId_itemId: { orgId, branchId: body.branchId, warehouseId: body.warehouseId, itemId: body.itemId } },
      update: {},
      create: {
        accountId,
        orgId,
        branchId: body.branchId,
        warehouseId: body.warehouseId,
        itemId: body.itemId,
        qtyOnHand: 0,
        createdByUserId: userId,
      },
    });

    await tx.stockBalance.update({
      where: { id: sb.id },
      data: { qtyOnHand: { increment: body.qtyDelta } },
    });

    await tx.inventoryAdjustment.create({
      data: {
        accountId,
        orgId,
        branchId: body.branchId,
        warehouseId: body.warehouseId,
        itemId: body.itemId,
        qtyDelta: body.qtyDelta,
        reason: body.reason,
        createdByUserId: userId,
      },
    });
  });

  res.status(201).json({ ok: true });
});
