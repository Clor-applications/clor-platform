import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { onHand, onHandByWarehouse } from '../services/stockLedger.js';

/**
 * Stock on hand, as the server counts it — see services/stockLedger.ts.
 *
 * Open to anyone who can see items: a salesperson needs to know what can be
 * sold, not only a store keeper.
 */
export const stockLedgerRouter = Router();
stockLedgerRouter.use(requireAuth, requireTenantContext);

const VIEW = requirePermission('MASTERS', PermissionAction.VIEW, 'Items');

const idsOf = (v: unknown) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 500);

/** ?warehouseId= (optional, else company-wide) &itemIds=a,b (optional, else all). */
stockLedgerRouter.get('/orgs/:orgId/stock/on-hand', VIEW, async (req, res) => {
  const orgId = req.tenant!.orgId;
  if (String(req.params.orgId) !== orgId) return res.status(403).json({ error: 'orgId mismatch' });
  const warehouseId = String(req.query.warehouseId || '').trim() || null;
  const totals = await onHand(prisma, orgId, { itemIds: idsOf(req.query.itemIds), warehouseId });
  res.json({ warehouseId, onHand: [...totals].map(([itemId, qty]) => ({ itemId, qty })) });
});

/** Every item in every warehouse; `warehouseId: null` is stock that names none. */
stockLedgerRouter.get('/orgs/:orgId/stock/on-hand/by-warehouse', VIEW, async (req, res) => {
  const orgId = req.tenant!.orgId;
  if (String(req.params.orgId) !== orgId) return res.status(403).json({ error: 'orgId mismatch' });
  res.json({ rows: await onHandByWarehouse(prisma, orgId, idsOf(req.query.itemIds)) });
});
