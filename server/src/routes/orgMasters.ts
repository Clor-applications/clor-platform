import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';

/**
 * The masters that were only ever in the browser.
 *
 * A fixed asset appears on the balance sheet and a salesman is the axis of the
 * Sales by Salesman report — so holding either in one machine's localStorage
 * did not make a feature incomplete, it made the same company show different
 * figures on different machines.
 *
 * That argument was written as the reason cost centres and discount rules could
 * stay in the browser, and it was wrong on the facts: Cost Centers is a report
 * — P&L by branch or project — and a price list decides what rate lands on an
 * invoice. All six now have a table, through the generic OrgMaster below.
 */
export const orgMastersRouter = Router();
orgMastersRouter.use(requireAuth, requireTenantContext);

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

const dec = (v: number | null | undefined) =>
  v === null || v === undefined ? null : new Prisma.Decimal(Number(v).toFixed(2));

/* ------------------------------------------------------------------ salesmen */

const salesmanSchema = z.object({
  code: z.string().max(40).optional().nullable(),
  name: z.string().min(1).max(120),
  email: z.string().max(200).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  commissionRate: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(1000).optional().nullable(),
});

const SALESMAN_VIEW = requirePermission('MASTERS', PermissionAction.VIEW, 'Salesmen');
const SALESMAN_EDIT = requirePermission('MASTERS', PermissionAction.CREATE, 'Salesmen');

orgMastersRouter.get('/orgs/:orgId/salesmen', SALESMAN_VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await prisma.salesman.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } });
  res.json({ salesmen: rows.map((r) => ({ ...r, commissionRate: Number(r.commissionRate) })) });
});

orgMastersRouter.post('/orgs/:orgId/salesmen', SALESMAN_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const body = salesmanSchema.parse(req.body);
  try {
    const row = await prisma.salesman.create({
      data: {
        accountId,
        orgId,
        code: body.code ?? null,
        name: body.name.trim(),
        email: body.email ?? null,
        phone: body.phone ?? null,
        commissionRate: dec(body.commissionRate ?? 0)!,
        isActive: body.isActive ?? true,
        notes: body.notes ?? null,
        createdByUserId: req.auth!.userId,
      },
    });
    res.status(201).json({ salesman: { ...row, commissionRate: Number(row.commissionRate) } });
  } catch (e: any) {
    if (String(e?.code) === 'P2002') return res.status(409).json({ error: 'A salesman with that name already exists' });
    throw e;
  }
});

orgMastersRouter.patch('/orgs/:orgId/salesmen/:id', SALESMAN_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await prisma.salesman.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'Salesman not found' });

  const body = salesmanSchema.partial().parse(req.body);
  const row = await prisma.salesman.update({
    where: { id: existing.id },
    data: {
      ...(body.code !== undefined ? { code: body.code ?? null } : {}),
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.email !== undefined ? { email: body.email ?? null } : {}),
      ...(body.phone !== undefined ? { phone: body.phone ?? null } : {}),
      ...(body.commissionRate !== undefined ? { commissionRate: dec(body.commissionRate)! } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
    },
  });
  res.json({ salesman: { ...row, commissionRate: Number(row.commissionRate) } });
});

/*
 * Deactivated, never deleted: documents already carry the salesman, and
 * removing the row would leave those documents pointing at nothing and the
 * commission history unexplainable.
 */
orgMastersRouter.delete('/orgs/:orgId/salesmen/:id', SALESMAN_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await prisma.salesman.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'Salesman not found' });
  const row = await prisma.salesman.update({ where: { id: existing.id }, data: { isActive: false } });
  res.json({ salesman: { ...row, commissionRate: Number(row.commissionRate) }, deactivated: true });
});

/* -------------------------------------------------------------- fixed assets */

const assetSchema = z.object({
  code: z.string().max(40).optional().nullable(),
  name: z.string().min(1).max(160),
  category: z.string().max(80).optional().nullable(),
  purchaseDate: z.string().min(1),
  cost: z.number().nonnegative(),
  salvageValue: z.number().nonnegative().optional(),
  depreciationMethod: z.enum(['SLM', 'WDV']).optional(),
  depreciationRate: z.number().min(0).max(100).optional(),
  usefulLifeYears: z.number().int().min(0).max(100).optional().nullable(),
  accumulatedDepreciation: z.number().nonnegative().optional(),
  status: z.enum(['ACTIVE', 'DISPOSED', 'WRITTEN_OFF']).optional(),
  disposalDate: z.string().optional().nullable(),
  disposalValue: z.number().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

const ASSET_VIEW = requirePermission('ACCOUNTING', PermissionAction.VIEW, 'Ledger');
const ASSET_EDIT = requirePermission('ACCOUNTING', PermissionAction.CREATE, 'Ledger');

const outAsset = (r: any) => ({
  ...r,
  cost: Number(r.cost),
  salvageValue: Number(r.salvageValue),
  depreciationRate: Number(r.depreciationRate),
  accumulatedDepreciation: Number(r.accumulatedDepreciation),
  disposalValue: r.disposalValue === null ? null : Number(r.disposalValue),
  /* What the balance sheet carries it at. Derived, never stored. */
  netBlock: Number(r.cost) - Number(r.accumulatedDepreciation),
});

orgMastersRouter.get('/orgs/:orgId/fixed-assets', ASSET_VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await prisma.fixedAsset.findMany({ where: { accountId, orgId }, orderBy: { purchaseDate: 'desc' } });
  res.json({ assets: rows.map(outAsset) });
});

orgMastersRouter.post('/orgs/:orgId/fixed-assets', ASSET_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId, branchId } = req.tenant!;
  const body = assetSchema.parse(req.body);
  const row = await prisma.fixedAsset.create({
    data: {
      accountId,
      orgId,
      branchId,
      code: body.code ?? null,
      name: body.name.trim(),
      category: body.category ?? null,
      purchaseDate: body.purchaseDate,
      cost: dec(body.cost)!,
      salvageValue: dec(body.salvageValue ?? 0)!,
      depreciationMethod: body.depreciationMethod || 'SLM',
      depreciationRate: dec(body.depreciationRate ?? 0)!,
      usefulLifeYears: body.usefulLifeYears ?? null,
      accumulatedDepreciation: dec(body.accumulatedDepreciation ?? 0)!,
      status: body.status || 'ACTIVE',
      disposalDate: body.disposalDate ?? null,
      disposalValue: dec(body.disposalValue ?? null),
      notes: body.notes ?? null,
      createdByUserId: req.auth!.userId,
    },
  });
  res.status(201).json({ asset: outAsset(row) });
});

orgMastersRouter.patch('/orgs/:orgId/fixed-assets/:id', ASSET_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await prisma.fixedAsset.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'Asset not found' });

  const b = assetSchema.partial().parse(req.body);
  const row = await prisma.fixedAsset.update({
    where: { id: existing.id },
    data: {
      ...(b.code !== undefined ? { code: b.code ?? null } : {}),
      ...(b.name !== undefined ? { name: b.name.trim() } : {}),
      ...(b.category !== undefined ? { category: b.category ?? null } : {}),
      ...(b.purchaseDate !== undefined ? { purchaseDate: b.purchaseDate } : {}),
      ...(b.cost !== undefined ? { cost: dec(b.cost)! } : {}),
      ...(b.salvageValue !== undefined ? { salvageValue: dec(b.salvageValue)! } : {}),
      ...(b.depreciationMethod !== undefined ? { depreciationMethod: b.depreciationMethod } : {}),
      ...(b.depreciationRate !== undefined ? { depreciationRate: dec(b.depreciationRate)! } : {}),
      ...(b.usefulLifeYears !== undefined ? { usefulLifeYears: b.usefulLifeYears ?? null } : {}),
      ...(b.accumulatedDepreciation !== undefined
        ? { accumulatedDepreciation: dec(b.accumulatedDepreciation)! }
        : {}),
      ...(b.status !== undefined ? { status: b.status } : {}),
      ...(b.disposalDate !== undefined ? { disposalDate: b.disposalDate ?? null } : {}),
      ...(b.disposalValue !== undefined ? { disposalValue: dec(b.disposalValue ?? null) } : {}),
      ...(b.notes !== undefined ? { notes: b.notes ?? null } : {}),
    },
  });
  res.json({ asset: outAsset(row) });
});

/* ---------------------------------------------------- the six reference lists */

/**
 * Units, item categories, price lists, discount rules, cost centres, account
 * groups and GST rates, through one endpoint.
 *
 * They share a table because they share a life: small lists, read whole, whose
 * only difference is the shape of what hangs off a name. Pricing an invoice
 * reads an entire price list rather than one row of it, so nothing is gained by
 * giving each of them columns, and six near-identical routes would have to be
 * kept in step by hand.
 */
const MASTER_KINDS = [
  'UOM',
  'ITEM_CATEGORY',
  'PRICE_LIST',
  'DISCOUNT_RULE',
  'COST_CENTER',
  'ACCOUNT_GROUP',
  'GST_RATE',
  /* The TDS compliance stores. Events, challans, allocation links and
     quarter filings were browser-local; each syncs here as (kind, uid,
     payload) so every device reads one register. The server stores and
     isolates; the client owns the shape. */
  'TDS_EVENT',
  'TDS_CHALLAN',
  'TDS_CHALLAN_ALLOC',
  'TDS_FILING',
] as const;
type MasterKind = (typeof MASTER_KINDS)[number];

const masterSchema = z.object({
  kind: z.enum(MASTER_KINDS),
  name: z.string().min(1).max(160),
  isActive: z.boolean().optional(),
  /** Whatever this kind carries. Stored verbatim; the browser owns its shape. */
  data: z.record(z.any()).optional(),
});

const MASTERS_VIEW = requirePermission('MASTERS', PermissionAction.VIEW, 'Masters');
const MASTERS_EDIT = requirePermission('MASTERS', PermissionAction.CREATE, 'Masters');

/** A stored row as the browser wants it: `data` unpacked, never a raw string. */
const outMaster = (row: { id: string; kind: string; name: string; isActive: boolean; dataJson: string; createdAt: Date; updatedAt: Date }) => {
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.dataJson || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    // A row whose payload cannot be parsed still has a name and a kind, and
    // returning those is better than failing the whole list.
  }
  return { id: row.id, kind: row.kind, name: row.name, isActive: row.isActive, data, createdAt: row.createdAt, updatedAt: row.updatedAt };
};

orgMastersRouter.get('/orgs/:orgId/masters', MASTERS_VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const kindParam = String(req.query.kind || '').trim();
  const kinds = kindParam
    ? kindParam.split(',').map((k) => k.trim()).filter((k): k is MasterKind => (MASTER_KINDS as readonly string[]).includes(k))
    : [...MASTER_KINDS];
  if (!kinds.length) return res.status(400).json({ error: 'No known master kind requested' });

  const rows = await prisma.orgMaster.findMany({
    where: { accountId, orgId, kind: { in: kinds } },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
  });
  res.json({ masters: rows.map(outMaster) });
});

orgMastersRouter.post('/orgs/:orgId/masters', MASTERS_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const body = masterSchema.parse(req.body);
  try {
    const row = await prisma.orgMaster.create({
      data: {
        accountId,
        orgId,
        kind: body.kind,
        name: body.name.trim(),
        isActive: body.isActive ?? true,
        dataJson: JSON.stringify(body.data ?? {}),
        createdByUserId: req.auth!.userId,
      },
    });
    res.status(201).json({ master: outMaster(row) });
  } catch (e: any) {
    if (String(e?.code) === 'P2002') return res.status(409).json({ error: `A ${body.kind.toLowerCase().replace(/_/g, ' ')} called "${body.name.trim()}" already exists` });
    throw e;
  }
});

orgMastersRouter.patch('/orgs/:orgId/masters/:id', MASTERS_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await prisma.orgMaster.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'Master not found' });

  const body = masterSchema.partial().omit({ kind: true }).parse(req.body);
  try {
    const row = await prisma.orgMaster.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.data !== undefined ? { dataJson: JSON.stringify(body.data) } : {}),
      },
    });
    res.json({ master: outMaster(row) });
  } catch (e: any) {
    if (String(e?.code) === 'P2002') return res.status(409).json({ error: 'Another master of this kind already has that name' });
    throw e;
  }
});

/**
 * Genuinely deleted, unlike a salesman.
 *
 * Nothing points at one of these by id: a document records the unit it was
 * entered in and the rate it was priced at, not a foreign key to the list the
 * value came from. Removing a unit therefore leaves no document dangling, and
 * keeping dead rows in a picker is worse than the alternative.
 */
orgMastersRouter.delete('/orgs/:orgId/masters/:id', MASTERS_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await prisma.orgMaster.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'Master not found' });
  await prisma.orgMaster.delete({ where: { id: existing.id } });
  res.json({ deleted: true, id: existing.id });
});

export default orgMastersRouter;
