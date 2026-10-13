import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';

/**
 * The POS day close — the Z report.
 *
 * It lived in the browser, which is the one place a cash control cannot live:
 * the over/short figure is what the owner reviews, and the cashier cannot be
 * the only person holding it. On any other machine the day looked never
 * closed, and clearing site data erased the count.
 *
 * One row per branch per day, enforced by the database. Closing a day twice
 * would double-count the till, and a second attempt is answered with the close
 * that already exists rather than an error — the cashier pressed the button
 * twice, which is not a failure.
 */
export const posDayCloseRouter = Router();
posDayCloseRouter.use(requireAuth, requireTenantContext);

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

const VIEW = requirePermission('SALES', PermissionAction.VIEW, 'POS Day Close');
const CLOSE = requirePermission('SALES', PermissionAction.CREATE, 'POS Day Close');

const dec = (v: number | null | undefined) => new Prisma.Decimal(Number(v || 0).toFixed(2));

const closeSchema = z.object({
  date: z.string().min(1),
  invoices: z.number().int().min(0).optional(),
  cash: z.number().optional(),
  upi: z.number().optional(),
  card: z.number().optional(),
  total: z.number().optional(),
  countedCash: z.number().optional(),
  overShort: z.number().optional(),
  /** Note or coin value to how many were counted. */
  denomCounts: z.record(z.number()).optional(),
});

const out = (r: any) => {
  let denomCounts: Record<string, number> = {};
  try {
    const parsed = JSON.parse(r.denomJson || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) denomCounts = parsed;
  } catch {
    // A count that cannot be parsed still has its totals, and those are what
    // the owner reviews.
  }
  return {
    id: r.id,
    date: r.date,
    invoices: r.invoices,
    cash: Number(r.cash),
    upi: Number(r.upi),
    card: Number(r.card),
    total: Number(r.total),
    countedCash: Number(r.countedCash),
    overShort: Number(r.overShort),
    denomCounts,
    closedAt: r.closedAt,
  };
};

posDayCloseRouter.get('/orgs/:orgId/pos-day-closes', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await prisma.posDayClose.findMany({
    where: { accountId, orgId },
    orderBy: [{ date: 'desc' }],
    take: Math.min(1000, Math.max(1, Number(req.query.limit) || 400)),
  });
  res.json({ dayCloses: rows.map(out) });
});

posDayCloseRouter.post('/orgs/:orgId/pos-day-closes', CLOSE, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId, branchId } = req.tenant!;
  const body = closeSchema.parse(req.body);
  const date = String(body.date).slice(0, 10);

  const existing = await prisma.posDayClose.findFirst({
    where: { accountId, orgId, branchId: branchId || null, date },
  });
  // The day is already closed. Answering with the close that stands is the
  // truthful reply, and it keeps a double press from counting the till twice.
  if (existing) return res.status(200).json({ dayClose: out(existing), alreadyClosed: true });

  const row = await prisma.posDayClose.create({
    data: {
      accountId,
      orgId,
      branchId: branchId || null,
      date,
      invoices: body.invoices ?? 0,
      cash: dec(body.cash),
      upi: dec(body.upi),
      card: dec(body.card),
      total: dec(body.total),
      countedCash: dec(body.countedCash),
      overShort: dec(body.overShort),
      denomJson: JSON.stringify(body.denomCounts || {}),
      closedByUserId: req.auth!.userId,
    },
  });
  res.status(201).json({ dayClose: out(row) });
});
