import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { ensureLedgerSetup, postEntry } from '../services/ledger.js';
import { isFeatureEnabled } from '../services/features.js';
import { FxError, baseCurrencyFor, rateFor, round2, toBase } from '../services/fx.js';

/**
 * Period-end revaluation of open foreign balances — requirement 8.
 *
 * A receivable in USD was brought into the books at the rate on its invoice
 * date. If the rate has moved by the reporting date, the balance sheet still
 * shows the old number, which overstates or understates the asset. Revaluation
 * restates what is still open and books the difference as an unrealised gain
 * or loss.
 *
 * Unrealised, deliberately: nothing has been collected. The realised gain or
 * loss is posted separately when the invoice is actually settled (see
 * routes/payments.ts), so this entry is normally reversed at the start of the
 * next period to avoid counting the same movement twice.
 */
export const revaluationRouter = Router();
revaluationRouter.use(requireAuth, requireTenantContext);

const VIEW = requirePermission('ACCOUNTING', PermissionAction.VIEW, 'Ledger');
const CREATE = requirePermission('ACCOUNTING', PermissionAction.CREATE, 'Ledger');

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

const featureOn = async (req: any, res: any) => {
  const { accountId, orgId } = req.tenant!;
  if (await isFeatureEnabled(accountId, orgId, 'multiCurrency')) return true;
  res.status(400).json({ error: 'Multi-currency is switched off for this company' });
  return false;
};

/**
 * Open foreign invoices, with what they are worth now.
 *
 * "Open" means an outstanding balance, so a fully-paid invoice is left alone —
 * its gain or loss was realised at settlement and revaluing it again would
 * double count.
 */
async function openForeignPositions(accountId: string, orgId: string, branchId: string, asOf: string) {
  const baseCurrency = await baseCurrencyFor(accountId, orgId);

  /*
   * bounded: every open foreign-currency position, deliberately.
   *
   * This is a revaluation, not a list — it restates what is outstanding at
   * today's rate, so a page of it would be a wrong answer rather than a partial
   * one. It is filtered to unsettled non-base-currency invoices on one branch,
   * which is a small set even on large books.
   */
  const rows = await prisma.invoice.findMany({
    where: {
      accountId,
      orgId,
      branchId,
      currency: { not: baseCurrency },
      status: { not: 'Cancelled' },
    },
    select: { id: true, number: true, currency: true, exchangeRate: true, total: true, paidAmount: true, date: true },
  });

  const positions: Array<{
    invoiceId: string;
    number: string;
    currency: string;
    outstanding: number;
    bookedRate: number;
    currentRate: number;
    bookedBase: number;
    currentBase: number;
    difference: number;
  }> = [];

  const rateCache = new Map<string, number>();

  for (const r of rows) {
    const outstanding = round2(Number(r.total || 0) - Number(r.paidAmount || 0));
    if (outstanding <= 0) continue;

    const code = String(r.currency).toUpperCase();
    if (!rateCache.has(code)) {
      rateCache.set(code, await rateFor({ accountId, orgId, currency: code, date: asOf, baseCurrency }));
    }
    const currentRate = rateCache.get(code)!;
    const bookedRate = Number(r.exchangeRate) || 1;

    const bookedBase = toBase(outstanding, bookedRate);
    const currentBase = toBase(outstanding, currentRate);
    const difference = round2(currentBase - bookedBase);
    if (difference === 0) continue;

    positions.push({
      invoiceId: String(r.id),
      number: String(r.number),
      currency: code,
      outstanding,
      bookedRate,
      currentRate,
      bookedBase,
      currentBase,
      difference,
    });
  }

  return { baseCurrency, positions };
}

/** What revaluation would do, without doing it. */
revaluationRouter.get('/orgs/:orgId/fx/revaluation-preview', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  if (!(await featureOn(req, res))) return;
  const { accountId, orgId, branchId } = req.tenant!;
  const asOf = String(req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);

  try {
    const { baseCurrency, positions } = await openForeignPositions(accountId, orgId, branchId, asOf);
    const net = round2(positions.reduce((s, p) => s + p.difference, 0));
    res.json({ asOf, baseCurrency, positions, net });
  } catch (e: any) {
    if (e instanceof FxError) return res.status(400).json({ error: e.message });
    throw e;
  }
});

const runSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/**
 * Posts the revaluation.
 *
 * One entry for the whole run rather than one per invoice: the movement is a
 * property of the position at a date, and a hundred single-line entries would
 * bury the ledger without telling anyone more.
 */
revaluationRouter.post('/orgs/:orgId/fx/revalue', CREATE, async (req, res) => {
  if (!orgOk(req, res)) return;
  if (!(await featureOn(req, res))) return;
  const { accountId, orgId, branchId } = req.tenant!;
  const userId = req.auth!.userId;
  const body = runSchema.parse(req.body);

  await ensureLedgerSetup(accountId, orgId, userId);

  let positions;
  let baseCurrency;
  try {
    ({ positions, baseCurrency } = await openForeignPositions(accountId, orgId, branchId, body.date));
  } catch (e: any) {
    if (e instanceof FxError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const net = round2(positions.reduce((s, p) => s + p.difference, 0));
  if (net === 0) {
    return res.json({ posted: false, net: 0, positions, message: 'Nothing to revalue at that date' });
  }

  // A gain increases the receivable and credits exchange gain/loss; a loss is
  // the mirror.
  const entry = await postEntry({
    accountId,
    orgId,
    branchId,
    userId,
    date: body.date,
    journalCode: 'JV',
    narration: `Revaluation of open foreign balances as at ${body.date}`,
    sourceDocType: 'FX_REVALUATION',
    sourceDocId: `${orgId}:${body.date}`,
    lines:
      net > 0
        ? [
            { controlKind: 'AR', debit: net, description: 'Revaluation of receivables' },
            { controlKind: 'FX_GAIN_LOSS', credit: net, description: 'Unrealised exchange gain' },
          ]
        : [
            { controlKind: 'FX_GAIN_LOSS', debit: -net, description: 'Unrealised exchange loss' },
            { controlKind: 'AR', credit: -net, description: 'Revaluation of receivables' },
          ],
  });

  res.json({ posted: true, net, baseCurrency, positions, entryId: (entry as any)?.id || null });
});
