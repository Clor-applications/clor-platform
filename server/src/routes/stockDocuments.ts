import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext, userMayUseWarehouse } from '../middleware/tenantContext.js';
import { authorize } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';

/**
 * Stock documents — adjustments and inter-branch transfers — on the server.
 *
 * They lived only in the browser that raised them: clear the browser, or open
 * the company on another machine, and the stock movements were gone, while
 * every invoice and bill beside them had long been server-backed. The browser
 * keeps computing stock from its documents, as it does from invoices; these
 * routes make the documents shared and durable, and check what the server can
 * check: who may raise them, in which warehouses, and on which dates.
 *
 * The older /adjustments and /transfers routes maintain a StockBalance table
 * that no screen uses and that never sees invoices or bills, so it cannot be
 * a stock figure. Nothing here writes it.
 */

export const stockDocumentsRouter = Router();
stockDocumentsRouter.use(requireAuth, requireTenantContext);

const KINDS = {
  ADJUSTMENT: { resource: 'Stock Adjustment' },
  TRANSFER: { resource: 'Stock Transfer' },
} as const;
type Kind = keyof typeof KINDS;
const isKind = (k: string): k is Kind => Object.prototype.hasOwnProperty.call(KINDS, k);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UID = /^[A-Za-z0-9._:-]{6,80}$/;
/** A document's payload is a screen's record, not a file store. */
const MAX_PAYLOAD_CHARS = 200_000;

const docSchema = z.object({
  number: z.string().trim().max(60).optional().nullable(),
  date: z.string().regex(ISO_DATE, 'date must be YYYY-MM-DD'),
  status: z.string().trim().max(40).optional().nullable(),
  warehouseId: z.string().trim().min(1).optional().nullable(),
  targetWarehouseId: z.string().trim().min(1).optional().nullable(),
  payload: z.record(z.any()),
});

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

const out = (row: any) => {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.payloadJson || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed;
  } catch {
    /* A row whose payload cannot be parsed still has its columns. */
  }
  return {
    id: row.id,
    kind: row.kind,
    uid: row.uid,
    number: row.number,
    date: row.date,
    status: row.status,
    branchId: row.branchId,
    warehouseId: row.warehouseId,
    targetBranchId: row.targetBranchId,
    targetWarehouseId: row.targetWarehouseId,
    payload,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

/**
 * The period lock covering a date, if any: a lock means "nothing on or before
 * this date", whichever fiscal year holds it — the rule the ledger applies.
 */
async function lockCovering(accountId: string, orgId: string, date: string) {
  return prisma.fiscalYear.findFirst({
    where: { accountId, orgId, lockedThrough: { gte: date } },
    orderBy: { lockedThrough: 'desc' },
    select: { lockedThrough: true, updatedAt: true },
  });
}

const lockedError = (lockedThrough: string | null) => ({
  error: `Books are locked through ${lockedThrough}. Stock on or before that date cannot change.`,
  code: 'period_locked',
});

/** The branch a warehouse belongs to, when it is really in this org. */
async function branchOfWarehouse(accountId: string, orgId: string, warehouseId: string | null | undefined) {
  if (!warehouseId) return null;
  const wh = await prisma.warehouse.findFirst({ where: { id: warehouseId, accountId, orgId }, select: { branchId: true } });
  return wh ? wh.branchId : undefined; // undefined: named, but not ours
}

stockDocumentsRouter.get('/orgs/:orgId/stock-documents', async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const requested = String(req.query.kind || 'ADJUSTMENT,TRANSFER')
    .split(',')
    .map((k) => k.trim().toUpperCase())
    .filter(isKind);
  if (!requested.length) return res.status(400).json({ error: 'No known kind requested' });

  // Each kind is read under its own permission; a kind the caller may not
  // view is left out rather than failing the whole list.
  const allowed: Kind[] = [];
  let lastRefusal: any = null;
  for (const kind of requested) {
    const refusal = await authorize(req, 'INVENTORY', PermissionAction.VIEW, KINDS[kind].resource);
    if (refusal) lastRefusal = refusal;
    else allowed.push(kind);
  }
  if (!allowed.length) return res.status(lastRefusal?.status || 403).json(lastRefusal?.body || { error: 'Permission denied' });

  // The branches this person works in; a transfer is visible from either end.
  const branches = req.tenant!.allowedBranchIds || [];
  const rows = await prisma.stockDocument.findMany({
    where: {
      accountId,
      orgId,
      kind: { in: allowed },
      ...(req.isAdmin ? {} : { OR: [{ branchId: { in: branches } }, { targetBranchId: { in: branches } }, { branchId: null }] }),
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 5000,
  });
  res.json({ documents: rows.map(out) });
});

stockDocumentsRouter.put('/orgs/:orgId/stock-documents/:kind/:uid', async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const userId = req.auth!.userId;
  const kind = String(req.params.kind || '').toUpperCase();
  const uid = String(req.params.uid || '');
  if (!isKind(kind)) return res.status(404).json({ error: 'Unknown stock document kind' });
  if (!UID.test(uid)) return res.status(400).json({ error: 'Malformed document uid' });

  const body = docSchema.parse(req.body);
  const payloadJson = JSON.stringify(body.payload);
  if (payloadJson.length > MAX_PAYLOAD_CHARS) return res.status(413).json({ error: 'That document is too large to store' });

  const existing = await prisma.stockDocument.findFirst({ where: { accountId, orgId, kind, uid } });
  const refusal = await authorize(req, 'INVENTORY', existing ? PermissionAction.EDIT : PermissionAction.CREATE, KINDS[kind].resource);
  if (refusal) return res.status(refusal.status).json(refusal.body);

  // Warehouses: really in this org, and usable by this person. A transfer is
  // worked on from both ends, so either end is enough to touch it.
  const branchId = await branchOfWarehouse(accountId, orgId, body.warehouseId);
  const targetBranchId = await branchOfWarehouse(accountId, orgId, body.targetWarehouseId);
  if (branchId === undefined || targetBranchId === undefined) {
    return res.status(400).json({ error: 'That warehouse is not in this company' });
  }
  if (kind === 'ADJUSTMENT' && !body.warehouseId) return res.status(400).json({ error: 'An adjustment names its warehouse' });
  const ends = [body.warehouseId, body.targetWarehouseId].filter(Boolean) as string[];
  let mayUse = ends.length === 0;
  for (const w of ends) if (await userMayUseWarehouse(accountId, orgId, userId, w)) mayUse = true;
  if (!mayUse) return res.status(403).json({ error: 'No access to warehouse' });

  /*
   * Closed periods. Changing a document on or before a lock is refused, and
   * so is moving one onto such a date. A first upload of a document the
   * browser raised BEFORE the books were closed is accepted — the stock moved
   * while the period was open; only the copy is late — which is what lets
   * every browser's existing documents reach the server.
   */
  const newLock = await lockCovering(accountId, orgId, body.date);
  const oldLock = existing ? await lockCovering(accountId, orgId, existing.date) : null;
  if (existing && (newLock || oldLock)) {
    const same = existing.payloadJson === payloadJson && existing.date === body.date && (existing.status || null) === (body.status || null);
    if (!same) return res.status(409).json(lockedError((newLock || oldLock)!.lockedThrough));
  }
  if (!existing && newLock) {
    const raisedAt = Date.parse(String((body.payload as any)?.createdAt || ''));
    // Strictly before: a document stamped the same millisecond as the close cannot claim to predate it.
    const predatesClose = Number.isFinite(raisedAt) && raisedAt < newLock.updatedAt.getTime();
    if (!predatesClose) return res.status(409).json(lockedError(newLock.lockedThrough));
  }

  const data = {
    number: body.number ?? null,
    date: body.date,
    status: body.status ?? null,
    branchId,
    warehouseId: body.warehouseId ?? null,
    targetBranchId,
    targetWarehouseId: body.targetWarehouseId ?? null,
    payloadJson,
    updatedByUserId: userId,
  };
  try {
    const row = existing
      ? await prisma.stockDocument.update({ where: { id: existing.id }, data })
      : await prisma.stockDocument.create({ data: { ...data, accountId, orgId, kind, uid, createdByUserId: userId } });
    res.status(existing ? 200 : 201).json({ document: out(row) });
  } catch (e: any) {
    // Two devices uploading the same new document at once: the second is an update.
    if (String(e?.code) === 'P2002') return res.status(409).json({ error: 'Saved by another device a moment ago — reload and retry', code: 'conflict' });
    throw e;
  }
});

stockDocumentsRouter.delete('/orgs/:orgId/stock-documents/:kind/:uid', async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const kind = String(req.params.kind || '').toUpperCase();
  if (!isKind(kind)) return res.status(404).json({ error: 'Unknown stock document kind' });

  const existing = await prisma.stockDocument.findFirst({ where: { accountId, orgId, kind, uid: String(req.params.uid || '') } });
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const refusal = await authorize(req, 'INVENTORY', PermissionAction.DELETE, KINDS[kind].resource);
  if (refusal) return res.status(refusal.status).json(refusal.body);

  const ends = [existing.warehouseId, existing.targetWarehouseId].filter(Boolean) as string[];
  let mayUse = ends.length === 0;
  for (const w of ends) if (await userMayUseWarehouse(accountId, orgId, req.auth!.userId, w)) mayUse = true;
  if (!mayUse) return res.status(403).json({ error: 'No access to warehouse' });

  const lock = await lockCovering(accountId, orgId, existing.date);
  if (lock) return res.status(409).json(lockedError(lock.lockedThrough));

  await prisma.stockDocument.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});
