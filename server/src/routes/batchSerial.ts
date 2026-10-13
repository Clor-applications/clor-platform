import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext, requireWarehouse } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { isFeatureEnabled } from '../services/features.js';

/**
 * Batch (lot) and serial number tracking — requirement 11.
 *
 * Which of the two applies is a property of the item (`ItemMaster.trackBy`),
 * not of the screen: an item tracked by batch cannot be received without a lot
 * number, and a serial-tracked item cannot have two units sharing one serial.
 * Enforcing that here rather than in the browser is the difference between a
 * recall you can act on and a spreadsheet.
 */
export const batchSerialRouter = Router();
batchSerialRouter.use(requireAuth, requireTenantContext);

const VIEW = requirePermission('INVENTORY', PermissionAction.VIEW, 'Stock Adjustment');
const CREATE = requirePermission('INVENTORY', PermissionAction.CREATE, 'Stock Adjustment');
const EDIT = requirePermission('INVENTORY', PermissionAction.EDIT, 'Stock Adjustment');

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

/** Every route here is dead weight for a business that does not track lots. */
const featureOn = async (req: any, res: any) => {
  const { accountId, orgId } = req.tenant!;
  if (await isFeatureEnabled(accountId, orgId, 'batchSerial')) return true;
  res.status(400).json({ error: 'Batch and serial tracking is switched off for this company' });
  return false;
};

const num = (v: Prisma.Decimal | number | null) => (v === null ? 0 : Number(v));

const normalizeBatch = (row: any) => ({ ...row, qtyOnHand: num(row.qtyOnHand) });

/** Loads the item and confirms it is tracked the way the caller assumes. */
async function requireTrackedItem(req: any, res: any, itemId: string, expected: 'BATCH' | 'SERIAL') {
  const { accountId, orgId } = req.tenant!;
  const item = await prisma.itemMaster.findFirst({ where: { id: itemId, accountId, orgId } });
  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return null;
  }
  if (item.trackBy !== expected) {
    res.status(400).json({
      error: `${item.name} is not tracked by ${expected.toLowerCase()} (it is set to ${item.trackBy})`,
    });
    return null;
  }
  return item;
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

const batchSchema = z.object({
  itemId: z.string().min(1),
  batchNo: z.string().min(1).max(60),
  mfgDate: z.string().max(10).optional().nullable(),
  expiryDate: z.string().max(10).optional().nullable(),
  qty: z.number().positive(),
  notes: z.string().max(300).optional().nullable(),
});

/**
 * Batches in stock, soonest expiry first.
 *
 * FEFO (first expired, first out) is the order stock should actually be
 * issued in, so it is the order the list arrives in — leaving the caller to
 * sort invites the one mistake batch tracking exists to prevent.
 */
batchSerialRouter.get('/orgs/:orgId/batches', VIEW, requireWarehouse, async (req, res) => {
  if (!orgOk(req, res)) return;
  if (!(await featureOn(req, res))) return;
  const { accountId, orgId, branchId, warehouseId } = req.tenant!;

  const rows = await prisma.batch.findMany({
    where: {
      accountId,
      orgId,
      branchId,
      warehouseId: warehouseId!,
      isActive: true,
      ...(req.query.itemId ? { itemId: String(req.query.itemId) } : {}),
      ...(String(req.query.inStock || '') === 'true' ? { qtyOnHand: { gt: 0 } } : {}),
    },
    orderBy: [{ expiryDate: 'asc' }, { batchNo: 'asc' }],
    take: Math.min(500, Number(req.query.limit || 200)),
  });

  res.json({ batches: rows.map(normalizeBatch) });
});

/** Receives stock into a lot, creating it or adding to it. */
batchSerialRouter.post('/orgs/:orgId/batches', CREATE, requireWarehouse, async (req, res) => {
  if (!orgOk(req, res)) return;
  if (!(await featureOn(req, res))) return;
  const { accountId, orgId, branchId, warehouseId } = req.tenant!;
  const userId = req.auth!.userId;
  const body = batchSchema.parse(req.body);

  if (!(await requireTrackedItem(req, res, body.itemId, 'BATCH'))) return;

  if (body.mfgDate && body.expiryDate && body.expiryDate < body.mfgDate) {
    return res.status(400).json({ error: 'Expiry date cannot be before the manufacturing date' });
  }

  // Receiving the same lot twice adds to it. The alternative — a second row
  // with the same number — makes the on-hand figure for that lot a lie.
  const existing = await prisma.batch.findFirst({
    where: { orgId, itemId: body.itemId, warehouseId: warehouseId!, batchNo: body.batchNo },
  });

  const saved = existing
    ? await prisma.batch.update({
        where: { id: existing.id },
        data: {
          qtyOnHand: new Prisma.Decimal(num(existing.qtyOnHand) + body.qty),
          isActive: true,
          mfgDate: body.mfgDate ?? existing.mfgDate,
          expiryDate: body.expiryDate ?? existing.expiryDate,
        },
      })
    : await prisma.batch.create({
        data: {
          accountId,
          orgId,
          branchId,
          warehouseId: warehouseId!,
          itemId: body.itemId,
          batchNo: body.batchNo,
          mfgDate: body.mfgDate ?? null,
          expiryDate: body.expiryDate ?? null,
          qtyOnHand: new Prisma.Decimal(body.qty),
          notes: body.notes ?? null,
          createdByUserId: userId,
        },
      });

  res.status(201).json({ batch: normalizeBatch(saved) });
});

const issueSchema = z.object({ qty: z.number().positive() });

/** Issues stock out of a lot. Refuses to go negative. */
batchSerialRouter.post('/orgs/:orgId/batches/:batchId/issue', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  if (!(await featureOn(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const body = issueSchema.parse(req.body);

  const batch = await prisma.batch.findFirst({ where: { id: String(req.params.batchId), accountId, orgId } });
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  const remaining = num(batch.qtyOnHand) - body.qty;
  if (remaining < 0) {
    return res.status(400).json({
      error: `Only ${num(batch.qtyOnHand)} left in batch ${batch.batchNo}`,
    });
  }

  const saved = await prisma.batch.update({
    where: { id: batch.id },
    data: { qtyOnHand: new Prisma.Decimal(remaining) },
  });
  res.json({ batch: normalizeBatch(saved) });
});

// ---------------------------------------------------------------------------
// Serial numbers
// ---------------------------------------------------------------------------

const serialSchema = z.object({
  itemId: z.string().min(1),
  serialNos: z.array(z.string().min(1).max(80)).min(1).max(500),
  batchId: z.string().optional().nullable(),
  notes: z.string().max(300).optional().nullable(),
});

batchSerialRouter.get('/orgs/:orgId/serials', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  if (!(await featureOn(req, res))) return;
  const { accountId, orgId, branchId } = req.tenant!;

  const rows = await prisma.serialNumber.findMany({
    where: {
      accountId,
      orgId,
      branchId,
      ...(req.query.itemId ? { itemId: String(req.query.itemId) } : {}),
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(req.query.serialNo ? { serialNo: String(req.query.serialNo) } : {}),
    },
    orderBy: [{ serialNo: 'asc' }],
    take: Math.min(1000, Number(req.query.limit || 200)),
  });

  res.json({ serials: rows });
});

/**
 * Registers units into stock.
 *
 * All or nothing: a partially accepted batch of scanned serials leaves the
 * operator with no way of knowing which ones landed.
 */
batchSerialRouter.post('/orgs/:orgId/serials', CREATE, requireWarehouse, async (req, res) => {
  if (!orgOk(req, res)) return;
  if (!(await featureOn(req, res))) return;
  const { accountId, orgId, branchId, warehouseId } = req.tenant!;
  const userId = req.auth!.userId;
  const body = serialSchema.parse(req.body);

  if (!(await requireTrackedItem(req, res, body.itemId, 'SERIAL'))) return;

  const trimmed = body.serialNos.map((s) => s.trim()).filter(Boolean);
  const unique = [...new Set(trimmed)];
  if (unique.length !== trimmed.length) {
    return res.status(400).json({ error: 'The same serial number appears twice in this request' });
  }

  const clashes = await prisma.serialNumber.findMany({
    where: { orgId, itemId: body.itemId, serialNo: { in: unique } },
    select: { serialNo: true },
  });
  if (clashes.length) {
    return res.status(409).json({
      error: `Already registered: ${clashes.map((c) => c.serialNo).join(', ')}`,
    });
  }

  const created = await prisma.$transaction(
    unique.map((serialNo) =>
      prisma.serialNumber.create({
        data: {
          accountId,
          orgId,
          branchId,
          warehouseId: warehouseId!,
          itemId: body.itemId,
          batchId: body.batchId || null,
          serialNo,
          notes: body.notes ?? null,
          createdByUserId: userId,
        },
      })
    )
  );

  res.status(201).json({ serials: created, count: created.length });
});

const serialIssueSchema = z.object({
  serialNos: z.array(z.string().min(1)).min(1),
  docType: z.string().max(30).optional().nullable(),
  docId: z.string().max(60).optional().nullable(),
  status: z.enum(['SOLD', 'SCRAPPED']).optional(),
});

/** Takes units out of stock, recording what took them. */
batchSerialRouter.post('/orgs/:orgId/serials/issue', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  if (!(await featureOn(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const body = serialIssueSchema.parse(req.body);

  const rows = await prisma.serialNumber.findMany({
    where: { accountId, orgId, serialNo: { in: body.serialNos } },
  });

  const found = new Set(rows.map((r) => r.serialNo));
  const missing = body.serialNos.filter((s) => !found.has(s));
  if (missing.length) return res.status(404).json({ error: `Not registered: ${missing.join(', ')}` });

  // Selling the same unit twice is the failure serial tracking exists to catch,
  // so it is refused rather than silently overwritten.
  const alreadyOut = rows.filter((r) => r.status !== 'IN_STOCK');
  if (alreadyOut.length) {
    return res.status(409).json({
      error: `Not in stock: ${alreadyOut.map((r) => `${r.serialNo} (${r.status})`).join(', ')}`,
    });
  }

  const updated = await prisma.serialNumber.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: {
      status: body.status || 'SOLD',
      issuedDocType: body.docType ?? null,
      issuedDocId: body.docId ?? null,
      issuedAt: new Date(),
      warehouseId: null,
    },
  });

  res.json({ updated: updated.count });
});
