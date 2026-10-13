import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction, TransferStatus } from '../constants/enums.js';

export const transfersRouter = Router();
transfersRouter.use(requireAuth, requireTenantContext);

const createTransferSchema = z.object({
  sourceBranchId: z.string().min(1),
  sourceWarehouseId: z.string().min(1),
  targetBranchId: z.string().min(1),
  targetWarehouseId: z.string().min(1),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qty: z.number().positive(),
      })
    )
    .min(1),
});

async function ensureUserHasBranch(accountId: string, orgId: string, userId: string, branchId: string) {
  const m = await platformPrisma.userBranchMembership.findFirst({ where: { accountId, orgId, userId, branchId } });
  return Boolean(m);
}

async function ensureUserHasWarehouse(accountId: string, orgId: string, userId: string, warehouseId: string) {
  const m = await platformPrisma.userWarehouseAccess.findFirst({ where: { accountId, orgId, userId, warehouseId } });
  return Boolean(m);
}

async function nextTransferNo(orgId: string): Promise<string> {
  // In production use a dedicated counter table with row-level lock.
  const count = await prisma.interBranchTransfer.count({ where: { orgId } });
  return `TRF-${String(count + 1).padStart(6, '0')}`;
}

transfersRouter.get('/orgs/:orgId/transfers', requirePermission('INVENTORY', PermissionAction.VIEW, 'Inter-branch transfer'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  // Secure isolation: always filter by account + org, then restrict to allowed branches.
  const transfers = await prisma.interBranchTransfer.findMany({
    where: {
      accountId,
      orgId,
      OR: [{ sourceBranchId: { in: req.tenant!.allowedBranchIds } }, { targetBranchId: { in: req.tenant!.allowedBranchIds } }],
    },
    include: { lines: true },
    orderBy: [{ createdAt: 'desc' }],
  });

  res.json({ transfers });
});

transfersRouter.post('/orgs/:orgId/transfers', requirePermission('INVENTORY', PermissionAction.CREATE, 'Inter-branch transfer'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const userId = req.auth!.userId;

  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const body = createTransferSchema.parse(req.body);

  const ok = await ensureUserHasBranch(accountId, orgId, userId, body.sourceBranchId);
  if (!ok) return res.status(403).json({ error: 'No access to source branch' });
  const okWh = await ensureUserHasWarehouse(accountId, orgId, userId, body.sourceWarehouseId);
  if (!okWh) return res.status(403).json({ error: 'No access to source warehouse' });

  const [src, dst, srcWh, dstWh] = await Promise.all([
    platformPrisma.branch.findFirst({ where: { accountId, orgId, id: body.sourceBranchId } }),
    platformPrisma.branch.findFirst({ where: { accountId, orgId, id: body.targetBranchId } }),
    prisma.warehouse.findFirst({ where: { accountId, orgId, id: body.sourceWarehouseId, branchId: body.sourceBranchId } }),
    prisma.warehouse.findFirst({ where: { accountId, orgId, id: body.targetWarehouseId, branchId: body.targetBranchId } }),
  ]);
  if (!src || !dst) return res.status(400).json({ error: 'Invalid branches' });
  if (!srcWh) return res.status(400).json({ error: 'Invalid source warehouse' });
  if (!dstWh) return res.status(400).json({ error: 'Invalid target warehouse' });

  const transferNo = await nextTransferNo(orgId);

  const transfer = await prisma.interBranchTransfer.create({
    data: {
      accountId,
      orgId,
      branchId: body.sourceBranchId,
      sourceBranchId: body.sourceBranchId,
      sourceWarehouseId: body.sourceWarehouseId,
      targetBranchId: body.targetBranchId,
      targetWarehouseId: body.targetWarehouseId,
      transferNo,
      status: TransferStatus.DRAFT,
      initiatedByUserId: userId,
      createdByUserId: userId,
      lines: {
        create: body.lines.map((l) => ({
          accountId,
          orgId,
          branchId: body.sourceBranchId,
          warehouseId: body.sourceWarehouseId,
          itemId: l.itemId,
          qty: l.qty,
          createdByUserId: userId,
        })),
      },
    },
    include: { lines: true },
  });

  res.status(201).json({ transfer });
});

transfersRouter.post('/orgs/:orgId/transfers/:transferId/send', requirePermission('INVENTORY', PermissionAction.APPROVE, 'Inter-branch transfer'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const transferId = String(req.params.transferId);
  const userId = req.auth!.userId;

  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const transfer = await prisma.interBranchTransfer.findFirst({
    where: { accountId, orgId, id: transferId },
    include: { lines: true },
  });
  if (!transfer) return res.status(404).json({ error: 'Transfer not found' });
  if (transfer.status !== TransferStatus.DRAFT) return res.status(400).json({ error: 'Only DRAFT can be sent' });

  // user must have access to source
  const ok = await ensureUserHasBranch(accountId, orgId, userId, transfer.sourceBranchId);
  if (!ok) return res.status(403).json({ error: 'No access to source branch' });
  const okWh = await ensureUserHasWarehouse(accountId, orgId, userId, transfer.sourceWarehouseId);
  if (!okWh) return res.status(403).json({ error: 'No access to source warehouse' });

  // Stock reduction on send (configurable). Here: reduce on send.
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const line of transfer.lines) {
      const sb = await tx.stockBalance.upsert({
        where: { orgId_branchId_warehouseId_itemId: { orgId, branchId: transfer.sourceBranchId, warehouseId: transfer.sourceWarehouseId, itemId: line.itemId } },
        update: {},
        create: {
          accountId,
          orgId,
          branchId: transfer.sourceBranchId,
          warehouseId: transfer.sourceWarehouseId,
          itemId: line.itemId,
          qtyOnHand: 0,
          createdByUserId: userId,
        },
      });

      // NOTE: Decimal arithmetic is handled by Prisma Decimal internally.
      // For simplicity we do a numeric decrement via raw query.
      await tx.stockBalance.update({
        where: { id: sb.id },
        data: { qtyOnHand: { decrement: line.qty } },
      });
    }

    await tx.interBranchTransfer.update({
      where: { id: transfer.id },
      data: {
        status: TransferStatus.SENT,
        sentAt: new Date(),
        approvedByUserId: userId,
      },
    });
  });

  const updated = await prisma.interBranchTransfer.findUnique({ where: { id: transfer.id }, include: { lines: true } });
  res.json({ transfer: updated });
});

transfersRouter.post('/orgs/:orgId/transfers/:transferId/receive', requirePermission('INVENTORY', PermissionAction.APPROVE, 'Inter-branch transfer'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const transferId = String(req.params.transferId);
  const userId = req.auth!.userId;

  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const transfer = await prisma.interBranchTransfer.findFirst({
    where: { accountId, orgId, id: transferId },
    include: { lines: true },
  });
  if (!transfer) return res.status(404).json({ error: 'Transfer not found' });
  if (transfer.status !== TransferStatus.SENT) return res.status(400).json({ error: 'Only SENT can be received' });

  // receiver must have access to target
  const ok = await ensureUserHasBranch(accountId, orgId, userId, transfer.targetBranchId);
  if (!ok) return res.status(403).json({ error: 'No access to destination branch' });
  const okWh = await ensureUserHasWarehouse(accountId, orgId, userId, transfer.targetWarehouseId);
  if (!okWh) return res.status(403).json({ error: 'No access to destination warehouse' });

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const line of transfer.lines) {
      const sb = await tx.stockBalance.upsert({
        where: { orgId_branchId_warehouseId_itemId: { orgId, branchId: transfer.targetBranchId, warehouseId: transfer.targetWarehouseId, itemId: line.itemId } },
        update: {},
        create: {
          accountId,
          orgId,
          branchId: transfer.targetBranchId,
          warehouseId: transfer.targetWarehouseId,
          itemId: line.itemId,
          qtyOnHand: 0,
          createdByUserId: userId,
        },
      });

      await tx.stockBalance.update({
        where: { id: sb.id },
        data: { qtyOnHand: { increment: line.qty } },
      });
    }

    await tx.interBranchTransfer.update({
      where: { id: transfer.id },
      data: {
        status: TransferStatus.RECEIVED,
        receivedAt: new Date(),
      },
    });
  });

  const updated = await prisma.interBranchTransfer.findUnique({ where: { id: transfer.id }, include: { lines: true } });
  res.json({ transfer: updated });
});

transfersRouter.post('/orgs/:orgId/transfers/:transferId/reject', requirePermission('INVENTORY', PermissionAction.APPROVE, 'Inter-branch transfer'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const transferId = String(req.params.transferId);
  const userId = req.auth!.userId;
  const reason = String(req.body?.reason || '').trim();

  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const transfer = await prisma.interBranchTransfer.findFirst({
    where: { accountId, orgId, id: transferId },
  });
  if (!transfer) return res.status(404).json({ error: 'Transfer not found' });
  if (transfer.status !== TransferStatus.SENT && transfer.status !== TransferStatus.DRAFT) {
    return res.status(400).json({ error: 'Only DRAFT or SENT can be rejected' });
  }

  const ok = await ensureUserHasBranch(accountId, orgId, userId, transfer.targetBranchId);
  if (!ok) return res.status(403).json({ error: 'No access to destination branch' });

  const updated = await prisma.interBranchTransfer.update({
    where: { id: transfer.id },
    data: {
      status: TransferStatus.REJECTED,
      rejectedReason: reason || 'Rejected',
      approvedByUserId: userId,
    },
  });

  res.json({ transfer: updated });
});
