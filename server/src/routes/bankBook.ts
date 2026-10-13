import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';

/**
 * The cash and bank book.
 *
 * The last collection that lived only in a browser. Money moving through a bank
 * account was recorded here and nowhere else, so clearing site data lost the
 * cash book — and the reconciliation screen, which reads these for the book
 * side, could match a statement line against one and then had nothing to mark.
 *
 * Deliberately not Payment. A payment is a voucher against a party with
 * allocations behind it; these are the account's own movements — a bank charge,
 * interest, a transfer between two of your own accounts — which have no party
 * and settle nothing.
 */
export const bankBookRouter = Router();
bankBookRouter.use(requireAuth, requireTenantContext);

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

const VIEW = requirePermission('CASHBANK', PermissionAction.VIEW, 'Cash & Bank');
const EDIT = requirePermission('CASHBANK', PermissionAction.CREATE, 'Cash & Bank');

const dec = (v: number | null | undefined) =>
  v === null || v === undefined ? null : new Prisma.Decimal(Number(v).toFixed(2));

const entrySchema = z.object({
  ledgerAccountId: z.string().min(1),
  contraLedgerAccountId: z.string().optional().nullable(),
  direction: z.enum(['IN', 'OUT']),
  date: z.string().min(1),
  amount: z.number(),
  narration: z.string().max(500).optional().nullable(),
  reference: z.string().max(200).optional().nullable(),
  source: z.enum(['MANUAL', 'STATEMENT']).optional(),
  linkedPaymentId: z.string().optional().nullable(),
});

const out = (r: any) => ({
  ...r,
  amount: Number(r.amount),
});

bankBookRouter.get('/orgs/:orgId/bank-book', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const ledgerAccountId = String(req.query.ledgerAccountId || '').trim();

  const rows = await prisma.bankBookEntry.findMany({
    where: { accountId, orgId, ...(ledgerAccountId ? { ledgerAccountId } : {}) },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: Math.min(2000, Math.max(1, Number(req.query.limit) || 1000)),
  });
  res.json({ entries: rows.map(out) });
});

bankBookRouter.post('/orgs/:orgId/bank-book', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId, branchId } = req.tenant!;
  const body = entrySchema.parse(req.body);

  const row = await prisma.bankBookEntry.create({
    data: {
      accountId,
      orgId,
      branchId: branchId || null,
      ledgerAccountId: body.ledgerAccountId,
      contraLedgerAccountId: body.contraLedgerAccountId ?? null,
      direction: body.direction,
      date: body.date,
      // Stored as a magnitude; direction carries the sign. A negative amount
      // with direction OUT would mean money coming in, said twice and
      // contradicting itself.
      amount: dec(Math.abs(body.amount))!,
      narration: body.narration ?? null,
      reference: body.reference ?? null,
      source: body.source ?? 'MANUAL',
      linkedPaymentId: body.linkedPaymentId ?? null,
      createdByUserId: req.auth!.userId,
    },
  });
  res.status(201).json({ entry: out(row) });
});

bankBookRouter.patch('/orgs/:orgId/bank-book/:id', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await prisma.bankBookEntry.findFirst({
    where: { id: String(req.params.id), accountId, orgId },
  });
  if (!existing) return res.status(404).json({ error: 'Entry not found' });

  const body = entrySchema.partial().parse(req.body);
  const row = await prisma.bankBookEntry.update({
    where: { id: existing.id },
    data: {
      ...(body.ledgerAccountId !== undefined ? { ledgerAccountId: body.ledgerAccountId } : {}),
      ...(body.contraLedgerAccountId !== undefined ? { contraLedgerAccountId: body.contraLedgerAccountId ?? null } : {}),
      ...(body.direction !== undefined ? { direction: body.direction } : {}),
      ...(body.date !== undefined ? { date: body.date } : {}),
      ...(body.amount !== undefined ? { amount: dec(Math.abs(body.amount))! } : {}),
      ...(body.narration !== undefined ? { narration: body.narration ?? null } : {}),
      ...(body.reference !== undefined ? { reference: body.reference ?? null } : {}),
      ...(body.linkedPaymentId !== undefined ? { linkedPaymentId: body.linkedPaymentId ?? null } : {}),
    },
  });
  res.json({ entry: out(row) });
});

bankBookRouter.delete('/orgs/:orgId/bank-book/:id', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await prisma.bankBookEntry.findFirst({
    where: { id: String(req.params.id), accountId, orgId },
  });
  if (!existing) return res.status(404).json({ error: 'Entry not found' });
  await prisma.bankBookEntry.delete({ where: { id: existing.id } });
  res.json({ deleted: true, id: existing.id });
});

const reconcileSchema = z.object({
  reconciled: z.boolean(),
  bankDate: z.string().optional().nullable(),
  statementRef: z.string().max(120).optional().nullable(),
});

/**
 * Marking a book line against the statement.
 *
 * The same three columns a Payment carries, so the reconciliation screen can
 * tie off both sides of its list. Until this existed it could only save the
 * matches whose book side happened to be a receipt or a payment, and said so on
 * screen rather than quietly tying off half of what was on it.
 */
bankBookRouter.patch('/orgs/:orgId/bank-book/:id/reconcile', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await prisma.bankBookEntry.findFirst({
    where: { id: String(req.params.id), accountId, orgId },
  });
  if (!existing) return res.status(404).json({ error: 'Entry not found' });

  const body = reconcileSchema.parse(req.body);
  const row = await prisma.bankBookEntry.update({
    where: { id: existing.id },
    data: {
      reconciled: body.reconciled,
      bankDate: body.bankDate ? new Date(body.bankDate) : body.reconciled ? new Date() : null,
      statementRef: body.statementRef ?? null,
    },
  });
  res.json({ entry: out(row) });
});

export default bankBookRouter;
