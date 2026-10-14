import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { ownDocsWhere } from '../services/access.js';
import { PermissionAction } from '../constants/enums.js';
import { isFeatureEnabled } from '../services/features.js';
import { ensureDefaultSeries, allocateNumber } from '../services/numbering.js';
import { refuseUnknownLineItems } from '../services/lineItems.js';

/**
 * Quote-stage documents: estimates and purchase orders.
 *
 * Deliberately simpler than the purchase-docs surface — these are intentions,
 * not liabilities, so there is no ledger posting, no FX translation and no
 * reversal machinery. What they need from the server is the same thing the
 * money documents needed: to survive the browser profile.
 */
export const quoteDocsRouter = Router();
// Explicit, not inherited: until now this router relied on being mounted
// after purchaseDocs (whose router-level requireAuth ran first on /api).
quoteDocsRouter.use(requireAuth, requireTenantContext);

type QuoteKind = 'ESTIMATE' | 'PURCHASE_ORDER' | 'SALES_ORDER' | 'DELIVERY_CHALLAN';

const CONFIG: Record<
  QuoteKind,
  {
    path: string;
    model: 'estimate' | 'purchaseOrderDoc' | 'salesOrderDoc' | 'deliveryChallan';
    module: string;
    resource: string;
    feature: string;
  }
> = {
  ESTIMATE: { path: 'estimates', model: 'estimate', module: 'SALES', resource: 'Estimates', feature: 'estimates' },
  PURCHASE_ORDER: {
    path: 'purchase-orders',
    model: 'purchaseOrderDoc',
    module: 'PURCHASE',
    resource: 'Purchase Orders',
    feature: 'purchaseOrders',
  },
  SALES_ORDER: {
    path: 'sales-orders',
    model: 'salesOrderDoc',
    module: 'SALES',
    resource: 'Sales Orders',
    feature: 'salesOrders',
  },
  /*
   * A challan is not really a quote-stage document, but it is the same shape —
   * a numbered header, a party, lines, and a status that says whether it has
   * been billed. Giving it its own file would have duplicated the numbering,
   * the permission wiring and the extras handling to no end.
   */
  DELIVERY_CHALLAN: {
    path: 'delivery-challans',
    model: 'deliveryChallan',
    module: 'SALES',
    resource: 'Delivery Challans',
    feature: 'deliveryChallans',
  },
};

const bodySchema = z.object({
  number: z.string().min(1).optional(),
  date: z.string().min(1),
  validUntil: z.string().optional().nullable(),
  expectedDate: z.string().optional().nullable(),
  partyId: z.string().optional().nullable(),
  partyName: z.string().min(1),
  partyGstin: z.string().optional().nullable(),
  warehouseId: z.string().optional().nullable(),
  subtotal: z.number().optional(),
  gstTotal: z.number().optional(),
  total: z.number().optional(),
  status: z.string().optional(),
  notes: z.string().optional().nullable(),
  items: z.array(z.any()).default([]),
  /* Challan only. */
  purpose: z.string().max(30).optional().nullable(),
  ewayBillNo: z.string().max(40).optional().nullable(),
  convertedInvoiceId: z.string().optional().nullable(),
});

const num = (v: any) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const KNOWN_BODY_KEYS = Object.keys(bodySchema.shape);

/**
 * Fields an entry form collects that the document has no column for.
 * Without this the request schema silently dropped them and a browser that
 * had never seen the document rebuilt it incomplete — the same class of loss
 * that lost batch numbers on bills.
 */
const extrasOf = (body: any) => {
  const known = new Set(KNOWN_BODY_KEYS);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (known.has(k)) continue;
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
};

const spreadExtras = (row: any) => {
  try {
    const parsed = JSON.parse(String(row?.extrasJson || 'null'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const normalize = (row: any) => ({
  ...row,
  ...spreadExtras(row),
  extrasJson: undefined,
  subtotal: num(row.subtotal),
  gstTotal: num(row.gstTotal),
  total: num(row.total),
  items: (() => {
    try {
      const parsed = JSON.parse(String(row.itemsJson || '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })(),
  itemsJson: undefined,
});

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

function register(kind: QuoteKind) {
  const cfg = CONFIG[kind];
  const table = () => (prisma as any)[cfg.model];

  const featureOn = async (req: any, res: any) => {
    const { accountId, orgId } = req.tenant!;
    if (await isFeatureEnabled(accountId, orgId, cfg.feature)) return true;
    res.status(400).json({ error: `${cfg.resource} are switched off for this company` });
    return false;
  };

  quoteDocsRouter.get(
    `/orgs/:orgId/${cfg.path}`,
    requirePermission(cfg.module, PermissionAction.VIEW, cfg.resource),
    async (req, res) => {
      if (!orgOk(req, res)) return;
      const { accountId, orgId, branchId } = req.tenant!;
      const rows = await table().findMany({
        where: { accountId, orgId, branchId, ...ownDocsWhere(req) },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: Math.min(500, Number(req.query.limit || 200)),
      });
      res.json({ documents: rows.map(normalize) });
    }
  );

  quoteDocsRouter.post(
    `/orgs/:orgId/${cfg.path}`,
    requirePermission(cfg.module, PermissionAction.CREATE, cfg.resource),
    async (req, res) => {
      if (!orgOk(req, res)) return;
      if (!(await featureOn(req, res))) return;
      const { accountId, orgId, branchId } = req.tenant!;
      const userId = req.auth!.userId;
      const body = bodySchema.parse(req.body);
      if (await refuseUnknownLineItems(res, req.tenant!.accountId, req.tenant!.orgId, body.items)) return;

      await ensureDefaultSeries({ accountId, orgId, branchId, docType: kind, userId });

      const created = await prisma.$transaction(async (tx) => {
        const number =
          String(body.number || '').trim() ||
          (await allocateNumber(tx as any, { accountId, orgId, branchId, docType: kind, userId, date: body.date }))
            .number;
        return (tx as any)[cfg.model].create({
          data: {
            accountId,
            orgId,
            branchId,
            number,
            date: body.date,
            ...(kind === 'ESTIMATE' ? { validUntil: body.validUntil ?? null } : {}),
            ...(kind === 'PURCHASE_ORDER' || kind === 'SALES_ORDER'
              ? { expectedDate: body.expectedDate ?? null, warehouseId: body.warehouseId ?? null }
              : {}),
            ...(kind === 'DELIVERY_CHALLAN'
              ? {
                  warehouseId: body.warehouseId ?? null,
                  purpose: body.purpose || 'SUPPLY',
                  ewayBillNo: body.ewayBillNo ?? null,
                  convertedInvoiceId: body.convertedInvoiceId ?? null,
                }
              : {}),
            partyId: body.partyId ?? null,
            partyName: body.partyName,
            partyGstin: body.partyGstin ?? null,
            subtotal: new Prisma.Decimal(num(body.subtotal).toFixed(2)),
            gstTotal: new Prisma.Decimal(num(body.gstTotal).toFixed(2)),
            total: new Prisma.Decimal(num(body.total).toFixed(2)),
            status: body.status || (kind === 'DELIVERY_CHALLAN' ? 'Open' : 'Draft'),
            notes: body.notes ?? null,
            itemsJson: JSON.stringify(body.items || []),
            extrasJson: extrasOf(req.body),
            createdByUserId: userId,
          },
        });
      });

      res.status(201).json({ document: normalize(created) });
    }
  );

  quoteDocsRouter.patch(
    `/orgs/:orgId/${cfg.path}/:docId`,
    requirePermission(cfg.module, PermissionAction.EDIT, cfg.resource),
    async (req, res) => {
      if (!orgOk(req, res)) return;
      const { accountId, orgId } = req.tenant!;
      const doc = await table().findFirst({ where: { id: String(req.params.docId), accountId, orgId, ...ownDocsWhere(req) } });
      if (!doc) return res.status(404).json({ error: `${cfg.resource} not found` });
      const body = bodySchema.partial().parse(req.body);
      if (body.items !== undefined && (await refuseUnknownLineItems(res, req.tenant!.accountId, req.tenant!.orgId, body.items))) return;

      const updated = await table().update({
        where: { id: doc.id },
        data: {
          ...(body.date !== undefined ? { date: body.date } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.partyName !== undefined ? { partyName: body.partyName } : {}),
          ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
          ...(body.subtotal !== undefined ? { subtotal: new Prisma.Decimal(num(body.subtotal).toFixed(2)) } : {}),
          ...(body.gstTotal !== undefined ? { gstTotal: new Prisma.Decimal(num(body.gstTotal).toFixed(2)) } : {}),
          ...(body.total !== undefined ? { total: new Prisma.Decimal(num(body.total).toFixed(2)) } : {}),
          ...(body.items !== undefined ? { itemsJson: JSON.stringify(body.items || []) } : {}),
          /*
           * The challan's own fields. `convertedInvoiceId` matters most: it is
           * what stops the same consignment being billed twice, and holding it
           * only in the browser meant the guard vanished on another device.
           */
          ...(kind === 'DELIVERY_CHALLAN'
            ? {
                ...(body.purpose !== undefined ? { purpose: body.purpose || 'SUPPLY' } : {}),
                ...(body.ewayBillNo !== undefined ? { ewayBillNo: body.ewayBillNo ?? null } : {}),
                ...(body.convertedInvoiceId !== undefined
                  ? { convertedInvoiceId: body.convertedInvoiceId ?? null }
                  : {}),
              }
            : {}),
          extrasJson: extrasOf(req.body),
        },
      });
      res.json({ document: normalize(updated) });
    }
  );

  quoteDocsRouter.delete(
    `/orgs/:orgId/${cfg.path}/:docId`,
    requirePermission(cfg.module, PermissionAction.DELETE, cfg.resource),
    async (req, res) => {
      if (!orgOk(req, res)) return;
      const { accountId, orgId } = req.tenant!;
      const doc = await table().findFirst({ where: { id: String(req.params.docId), accountId, orgId, ...ownDocsWhere(req) } });
      if (!doc) return res.status(404).json({ error: `${cfg.resource} not found` });
      await table().delete({ where: { id: doc.id } });
      res.json({ ok: true });
    }
  );
}

(['ESTIMATE', 'PURCHASE_ORDER', 'SALES_ORDER', 'DELIVERY_CHALLAN'] as QuoteKind[]).forEach(register);
