import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { ensureDefaultSeries, peekNumber } from '../services/numbering.js';

/** Item master, and the numbering series administration that sits beside it. */
export const itemsRouter = Router();
itemsRouter.use(requireAuth, requireTenantContext);

const VIEW = requirePermission('MASTERS', PermissionAction.VIEW, 'Items');
const CREATE = requirePermission('MASTERS', PermissionAction.CREATE, 'Items');
const EDIT = requirePermission('MASTERS', PermissionAction.EDIT, 'Items');
const DELETE = requirePermission('MASTERS', PermissionAction.DELETE, 'Items');

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

const itemSchema = z.object({
  code: z.string().max(40).optional().nullable(),
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional().nullable(),
  itemType: z.enum(['STOCK', 'SERVICE']).optional(),
  unit: z.string().max(20).optional(),
  hsnSac: z.string().max(10).optional().nullable(),
  gstRate: z.number().min(0).max(100).optional(),
  salePrice: z.number().min(0).optional(),
  purchasePrice: z.number().min(0).optional(),
  openingQty: z.number().optional(),
  reorderLevel: z.number().min(0).optional(),
  trackBy: z.enum(['NONE', 'BATCH', 'SERIAL']).optional(),
  isActive: z.boolean().optional(),
});

const dec = (v: number | undefined, fallback = 0) => new Prisma.Decimal(Number(v ?? fallback).toFixed(4));

const validItemCode = (itemType: string, code: string) =>
  itemType === 'SERVICE' ? /^1\d{4}$/.test(code) : /^[2-9]\d{4}$/.test(code);

async function nextItemCode(accountId: string, orgId: string, itemType: string) {
  const start = itemType === 'SERVICE' ? 10000 : 20000;
  const end = itemType === 'SERVICE' ? 19999 : 99999;

  /* The highest code in this range, not every code in the org — see the same
     change in routes/parties.ts for why reading them all was refused, and why
     a `take` would have been the wrong way to quieten it. */
  const highest = await prisma.itemMaster.findFirst({
    where: { accountId, orgId, code: { gte: String(start), lte: String(end) } },
    select: { code: true },
    orderBy: { code: 'desc' },
  });

  const last = Number(highest?.code);
  const next = Number.isFinite(last) && last >= start ? last + 1 : start;
  if (next > end) {
    throw new Error(`No ${itemType === 'SERVICE' ? 'service' : 'goods'} item codes remain in the configured range`);
  }
  return String(next);
}

const normalize = (row: any) => ({
  ...row,
  gstRate: Number(row.gstRate),
  salePrice: Number(row.salePrice),
  purchasePrice: Number(row.purchasePrice),
  openingQty: Number(row.openingQty),
  reorderLevel: Number(row.reorderLevel),
});

itemsRouter.get('/orgs/:orgId/items', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const search = String(req.query.search || '').trim();

  const rows = await prisma.itemMaster.findMany({
    where: {
      accountId,
      orgId,
      ...(String(req.query.includeInactive || '') === 'true' ? {} : { isActive: true }),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { code: { contains: search } },
              { hsnSac: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    take: Math.min(500, Number(req.query.limit || 200)),
  });

  res.json({ items: rows.map(normalize) });
});

itemsRouter.post('/orgs/:orgId/items', CREATE, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const body = itemSchema.parse(req.body);
  const itemType = body.itemType || 'STOCK';
  const requestedCode = String(body.code || '').trim();
  if (requestedCode && !validItemCode(itemType, requestedCode)) {
    return res.status(400).json({
      error: itemType === 'SERVICE'
        ? 'Service item code must be 5 digits and start with 1'
        : 'Goods item code must be 5 digits and start with 2 through 9',
    });
  }
  const itemCode = requestedCode || (await nextItemCode(accountId, orgId, itemType));
  const duplicateCode = await prisma.itemMaster.findFirst({ where: { accountId, orgId, code: itemCode }, select: { id: true } });
  if (duplicateCode) return res.status(409).json({ error: `Item code ${itemCode} is already in use` });

  // Batch and serial tracking only makes sense for something that moves.
  if (body.trackBy && body.trackBy !== 'NONE' && (body.itemType || 'STOCK') === 'SERVICE') {
    return res.status(400).json({ error: 'A service item cannot be tracked by batch or serial number' });
  }

  try {
    const created = await prisma.itemMaster.create({
      data: {
        accountId,
        orgId,
        code: itemCode,
        name: body.name.trim(),
        description: body.description ?? null,
        itemType,
        unit: body.unit || 'Pcs',
        hsnSac: body.hsnSac ?? null,
        gstRate: dec(body.gstRate),
        salePrice: dec(body.salePrice),
        purchasePrice: dec(body.purchasePrice),
        openingQty: dec(body.openingQty),
        reorderLevel: dec(body.reorderLevel),
        trackBy: body.trackBy || 'NONE',
        isActive: body.isActive ?? true,
        createdByUserId: req.auth!.userId,
      },
    });
    res.status(201).json({ item: normalize(created) });
  } catch (err: any) {
    if (String(err?.code || '') === 'P2002') {
      return res.status(409).json({ error: 'An item with that name and unit already exists' });
    }
    throw err;
  }
});

itemsRouter.patch('/orgs/:orgId/items/:itemId', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await prisma.itemMaster.findFirst({
    where: { id: String(req.params.itemId), accountId, orgId },
  });
  if (!existing) return res.status(404).json({ error: 'Item not found' });

  const body = itemSchema.partial().parse(req.body);
  const nextType = body.itemType || existing.itemType;
  if (body.code != null && !validItemCode(nextType, String(body.code).trim())) {
    return res.status(400).json({
      error: nextType === 'SERVICE'
        ? 'Service item code must be 5 digits and start with 1'
        : 'Goods item code must be 5 digits and start with 2 through 9',
    });
  }
  if (body.code != null) {
    const code = String(body.code).trim();
    const duplicateCode = await prisma.itemMaster.findFirst({
      where: { accountId, orgId, code, id: { not: existing.id } },
      select: { id: true },
    });
    if (duplicateCode) return res.status(409).json({ error: `Item code ${code} is already in use` });
  }
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    if (['gstRate', 'salePrice', 'purchasePrice', 'openingQty', 'reorderLevel'].includes(k)) {
      data[k] = dec(v as number);
    } else if (k === 'name') data[k] = String(v).trim();
    else data[k] = v;
  }

  const updated = await prisma.itemMaster.update({ where: { id: existing.id }, data });
  res.json({ item: normalize(updated) });
});

itemsRouter.delete('/orgs/:orgId/items/:itemId', DELETE, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await prisma.itemMaster.findFirst({
    where: { id: String(req.params.itemId), accountId, orgId },
  });
  if (!existing) return res.status(404).json({ error: 'Item not found' });

  // An item named on a posted document is deactivated, not removed, so the
  // document keeps meaning what it meant.
  const used = await prisma.journalLine.findFirst({ where: { accountId, orgId, itemId: existing.id } });
  if (used) {
    const deactivated = await prisma.itemMaster.update({
      where: { id: existing.id },
      data: { isActive: false },
    });
    return res.json({ ok: true, deactivated: true, item: normalize(deactivated) });
  }

  await prisma.itemMaster.delete({ where: { id: existing.id } });
  res.json({ ok: true, deactivated: false });
});

// ---------------------------------------------------------------------------
// Number series
// ---------------------------------------------------------------------------

const SETTINGS_VIEW = requirePermission('SETTINGS', PermissionAction.VIEW, 'Document Numbering');
const SETTINGS_EDIT = requirePermission('SETTINGS', PermissionAction.EDIT, 'Document Numbering');

const seriesSchema = z.object({
  docType: z.string().min(1).max(30),
  name: z.string().min(1).max(60),
  prefix: z.string().max(20).optional(),
  suffix: z.string().max(20).optional(),
  padding: z.number().int().min(1).max(12).optional(),
  nextNumber: z.number().int().min(1).optional(),
  resetPolicy: z.enum(['NEVER', 'FISCAL_YEAR', 'MONTH']).optional(),
  allowManual: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  branchId: z.string().optional().nullable(),
});

itemsRouter.get('/orgs/:orgId/number-series', SETTINGS_VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const rows = await prisma.numberSeries.findMany({
    where: { accountId: req.tenant!.accountId, orgId: req.tenant!.orgId },
    orderBy: [{ docType: 'asc' }, { isDefault: 'desc' }],
  });
  res.json({ series: rows });
});

itemsRouter.post('/orgs/:orgId/number-series', SETTINGS_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const body = seriesSchema.parse(req.body);

  try {
    const created = await prisma.numberSeries.create({
      data: {
        accountId,
        orgId,
        branchId: body.branchId ?? null,
        docType: body.docType,
        name: body.name.trim(),
        prefix: body.prefix ?? '',
        suffix: body.suffix ?? '',
        padding: body.padding ?? 5,
        nextNumber: body.nextNumber ?? 1,
        resetPolicy: body.resetPolicy ?? 'FISCAL_YEAR',
        allowManual: body.allowManual ?? false,
        isDefault: body.isDefault ?? false,
        isActive: body.isActive ?? true,
        createdByUserId: req.auth!.userId,
      },
    });
    res.status(201).json({ series: created });
  } catch (err: any) {
    if (String(err?.code || '') === 'P2002') {
      return res.status(409).json({ error: 'A series with that name already exists for this document type' });
    }
    throw err;
  }
});

itemsRouter.patch('/orgs/:orgId/number-series/:seriesId', SETTINGS_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await prisma.numberSeries.findFirst({
    where: { id: String(req.params.seriesId), accountId, orgId },
  });
  if (!existing) return res.status(404).json({ error: 'Series not found' });

  const body = seriesSchema.partial().parse(req.body);
  const updated = await prisma.numberSeries.update({
    where: { id: existing.id },
    data: { ...body, branchId: body.branchId ?? existing.branchId, name: body.name?.trim() ?? existing.name },
  });
  res.json({ series: updated });
});

/** What the next number will be, for a blank form. */
itemsRouter.get('/orgs/:orgId/number-series/next/:docType', async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId, branchId } = req.tenant!;
  await ensureDefaultSeries({ accountId, orgId, branchId, docType: String(req.params.docType), userId: req.auth!.userId });
  const preview = await peekNumber({
    accountId,
    orgId,
    branchId,
    docType: String(req.params.docType),
    userId: req.auth!.userId,
    date: String(req.query.date || new Date().toISOString().slice(0, 10)),
  });
  res.json(preview);
});
