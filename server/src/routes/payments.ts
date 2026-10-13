import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize } from '../middleware/rbac.js';
import { ownDocsWhere } from '../services/access.js';
import { PermissionAction } from '../constants/enums.js';
import { ensureLedgerSetup, postEntry, reverseEntry } from '../services/ledger.js';
import { allocateNumber, ensureDefaultSeries } from '../services/numbering.js';
import { receiptAccountsFor } from '../services/receiptAccounts.js';
import { isFeatureEnabled } from '../services/features.js';
import { baseCurrencyFor, isBase, rateFor, round2, toBase } from '../services/fx.js';
import {
  OverAllocationError,
  assertAllocationsFit,
  recalcDocumentSettlement,
  recalcSettlementForPayment,
} from '../services/settlement.js';

/**
 * Receipts and payments.
 *
 * One record regardless of which screen created it. The alternative — a
 * voucher screen and a bank-book screen writing separate rows — is how the same
 * receipt ends up in the books twice, which is the duplicate problem bank
 * reconciliation is usually asked to clean up afterwards.
 */
export const paymentsRouter = Router();
paymentsRouter.use(requireAuth, requireTenantContext);

const RECEIPT = { module: 'SALES', resource: 'Receipts' } as const;
const PAYMENT = { module: 'PURCHASE', resource: 'Payments' } as const;

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

const paymentSchema = z.object({
  direction: z.enum(['RECEIPT', 'PAYMENT']),
  number: z.string().min(1).optional(),
  date: z.string().min(1),
  partyType: z.enum(['CUSTOMER', 'VENDOR']).optional().nullable(),
  partyId: z.string().optional().nullable(),
  partyName: z.string().max(200).optional().nullable(),
  /** Requirement 14: the mode is a real cash or bank ledger, not a free label. */
  ledgerAccountId: z.string().min(1),
  /** Omit for the base currency. */
  currency: z.string().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
  instrumentRef: z.string().max(100).optional().nullable(),
  instrumentDate: z.string().max(20).optional().nullable(),
  amount: z.number().positive(),
  notes: z.string().max(500).optional().nullable(),
  allocations: z
    .array(z.object({ docType: z.enum(['INVOICE', 'BILL']), docId: z.string().min(1), amount: z.number().positive() }))
    .optional(),
  /*
   * What settled the document without reaching the bank.
   *
   * `amount` stays the cash that actually moved, so bank balances and
   * reconciliation are unaffected by this. A deduction is an additional debit —
   * tax the customer withheld against our PAN, or what the bank took on the way
   * through — and the party is credited with the sum of the two, because that
   * is how much of the invoice is now settled.
   */
  deductions: z
    .array(
      z.object({
        kind: z.enum(['TDS', 'BANK_CHARGES', 'OTHER']),
        amount: z.number().positive(),
        note: z.string().max(120).optional().nullable(),
      })
    )
    .optional(),
});

const normalize = (row: any) => ({
  ...row,
  amount: Number(row.amount),
  allocations: (row.allocations || []).map((a: any) => ({ ...a, amount: Number(a.amount) })),
});

const permsFor = (direction: string) => (direction === 'RECEIPT' ? RECEIPT : PAYMENT);

/** The cash and bank ledgers a payment may be made through. */
paymentsRouter.get('/orgs/:orgId/payment-modes', async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId, branchId } = req.tenant!;
  await ensureLedgerSetup(accountId, orgId, req.auth!.userId);

  // Only the cash and bank accounts somebody actually opened. Setup creates a
  // Cash-in-Hand and a Bank Accounts control account for every org so that
  // postings resolve, and those were being offered here as though the user had
  // set them up — a business with no ledgers of its own was invited to receive
  // money into an account it had never heard of. They stay in the chart and
  // keep taking the postings; they are just not choices.
  /* The rule lives in one place now, because POS needs the same answer when it
     validates where a tender posts, and two copies of a rule about where money
     may land would drift. */
  const accounts = await receiptAccountsFor(prisma, { orgId, branchId });
  const modes = accounts.map(({ id, code, name, controlKind }) => ({ id, code, name, controlKind }));

  res.json({ modes });
});

paymentsRouter.get('/orgs/:orgId/payments', async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId, branchId } = req.tenant!;
  const direction = String(req.query.direction || 'RECEIPT') === 'PAYMENT' ? 'PAYMENT' : 'RECEIPT';

  // Receipts and payments are two resources; the query says which is asked for.
  // Deciding it here also records whether the caller is limited to their own
  // documents, which the filter below reads.
  const perms = permsFor(direction);
  const refusal = await authorize(req, perms.module, PermissionAction.VIEW, perms.resource);
  if (refusal) return res.status(refusal.status).json(refusal.body);

  const rows = await prisma.payment.findMany({
    where: {
      accountId,
      orgId,
      branchId,
      direction,
      ...ownDocsWhere(req),
      ...(String(req.query.unreconciled || '') === 'true' ? { reconciled: false } : {}),
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: Math.min(200, Number(req.query.limit || 100)),
    include: { allocations: true },
  });

  res.json({ payments: rows.map(normalize) });
});

paymentsRouter.post('/orgs/:orgId/payments', async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId, branchId } = req.tenant!;
  const userId = req.auth!.userId;
  const body = paymentSchema.parse(req.body);

  // Permission depends on the direction, so it is checked here rather than as
  // route middleware.
  const perms = permsFor(body.direction);
  if (await authorize(req, perms.module, PermissionAction.CREATE, perms.resource)) {
    return res.status(403).json({ error: `You do not have permission to create ${perms.resource.toLowerCase()}` });
  }

  const mode = await prisma.ledgerAccount.findFirst({
    where: { id: body.ledgerAccountId, orgId, isActive: true, controlKind: { in: ['CASH', 'BANK'] } },
  });
  if (!mode) return res.status(400).json({ error: 'Choose a cash or bank account for this payment' });

  const deductionTotal = round2((body.deductions || []).reduce((sum, d) => sum + d.amount, 0));
  // What the document was settled by: the cash, plus everything deducted from
  // it on the way. Allocations are measured against this, not against the cash.
  const settledTotal = round2(body.amount + deductionTotal);

  const allocationTotal = (body.allocations || []).reduce((sum, a) => sum + a.amount, 0);
  if (allocationTotal > settledTotal + 0.005) {
    return res.status(400).json({ error: 'Allocated amount is more than the payment' });
  }

  // Requirement 8. The ledger is kept in the base currency, so the rate is
  // resolved before anything is written — a payment whose rate cannot be found
  // must not reach the books at a wrong number.
  const baseCurrency = await baseCurrencyFor(accountId, orgId);
  const multiCurrencyOn = await isFeatureEnabled(accountId, orgId, 'multiCurrency');
  const payCurrency = multiCurrencyOn ? String(body.currency || baseCurrency).toUpperCase() : baseCurrency;
  let payRate = 1;
  try {
    payRate = isBase(payCurrency, baseCurrency) ? 1 : Number(body.exchangeRate || 0);
    if (!isBase(payCurrency, baseCurrency) && !(payRate > 0)) throw new Error(`Enter the conversion rate from ${payCurrency} to ${baseCurrency}`);
  } catch (e: any) {
    return res.status(400).json({ error: String(e?.message || e) });
  }

  // Each allocated invoice was booked at its own rate. Settling it at a
  // different one is a realised gain or loss, and it belongs in its own account
  // rather than quietly adjusting revenue or the bank.
  const invoiceIds = (body.allocations || []).filter((a) => a.docType === 'INVOICE').map((a) => a.docId);
  const bookedRates = new Map<string, number>();
  if (invoiceIds.length) {
    // An IN list built by hand needs one placeholder per id, and those
    // placeholders are SQLite's. Prisma builds the list for whatever the
    // datasource is.
    const rows = await prisma.invoice.findMany({
      where: { orgId, id: { in: invoiceIds } },
      select: { id: true, exchangeRate: true },
    });
    for (const r of rows) bookedRates.set(String(r.id), Number(r.exchangeRate) || 1);
  }

  // Positive is a gain: more base currency came in than the receivable was
  // carried at. Summing per allocation is what makes the entry balance —
  // the difference is exactly bank-side minus party-side.
  const fxDifference = round2(
    (body.allocations || []).reduce((sum, a) => {
      const booked = bookedRates.get(String(a.docId));
      if (!booked) return sum;
      return sum + (toBase(a.amount, payRate) - toBase(a.amount, booked));
    }, 0)
  );

  await ensureDefaultSeries({ accountId, orgId, branchId, docType: body.direction, userId });

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
    /*
     * The balance check and the allocation write happen in one transaction, so
     * two receipts racing for the same invoice cannot each read a balance that
     * the other is about to consume.
     */
    await assertAllocationsFit(tx, {
      accountId,
      orgId,
      allocations: (body.allocations || []) as Array<{ docType: 'INVOICE' | 'BILL'; docId: string; amount: number }>,
    });

    const number =
      String(body.number || '').trim() ||
      (
        await allocateNumber(tx, {
          accountId,
          orgId,
          branchId,
          docType: body.direction,
          userId,
          date: body.date,
        })
      ).number;

    const payment = await tx.payment.create({
      data: {
        accountId,
        orgId,
        branchId,
        direction: body.direction,
        number,
        date: body.date,
        partyType: body.partyType ?? null,
        partyId: body.partyId ?? null,
        partyName: body.partyName ?? null,
        ledgerAccountId: body.ledgerAccountId,
        instrumentRef: body.instrumentRef ?? null,
        instrumentDate: body.instrumentDate ?? null,
        amount: new Prisma.Decimal(body.amount.toFixed(2)),
        currency: payCurrency,
        exchangeRate: new Prisma.Decimal(String(payRate)),
        notes: body.notes ?? null,
        createdByUserId: userId,
        allocations: {
          create: (body.allocations || []).map((a) => ({
            accountId,
            orgId,
            branchId,
            docType: a.docType,
            docId: a.docId,
            amount: new Prisma.Decimal(a.amount.toFixed(2)),
          })),
        },
      },
      include: { allocations: true },
    });

    /*
     * Settlement is derived here, from the allocations this transaction has
     * just written, and never accumulated onto whatever the document was
     * carrying. It is the same transaction on purpose: a receipt that is saved
     * while the invoice it settles still reads Unpaid is the defect this
     * exists to remove.
     */
    const settlements = await recalcSettlementForPayment(tx, { accountId, orgId, paymentId: payment.id });

    return Object.assign(payment, { settlements });
    });
  } catch (e: any) {
    if (e instanceof OverAllocationError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  // A receipt debits the bank and credits the customer; a payment is the
  // mirror. Posting fails loudly: the payment row is removed so the books and
  // the list cannot disagree.
  try {
    await postEntry({
      accountId,
      orgId,
      branchId,
      userId,
      date: body.date,
      journalCode: mode.controlKind === 'BANK' ? 'BNK' : 'CSH',
      narration: `${body.direction === 'RECEIPT' ? 'Receipt' : 'Payment'} ${created.number}${
        body.partyName ? ` - ${body.partyName}` : ''
      }`,
      sourceDocType: body.direction,
      sourceDocId: created.id,
      lines:
        body.direction === 'RECEIPT'
          ? [
              // Cash side at the payment's own rate; party side at the rate the
              // receivable was carried at, with the difference taken to
              // exchange gain/loss. The three always foot to zero because the
              // difference is defined as the gap between the first two.
              { ledgerAccountId: mode.id, debit: toBase(body.amount, payRate), description: 'Money received' },
              /*
               * Each deduction is its own debit, at the payment's own rate.
               * TDS is an asset — tax already paid on our behalf, claimed
               * against the year's liability. Bank and other charges are
               * expenses. Neither reached the bank, and both settled the
               * invoice, which is why the credit below is the sum.
               */
              ...(body.deductions || []).map((d) => ({
                controlKind:
                  d.kind === 'TDS'
                    ? ('TDS_RECEIVABLE' as const)
                    : d.kind === 'BANK_CHARGES'
                      ? ('BANK_CHARGES' as const)
                      : ('EXPENSES' as const),
                debit: toBase(d.amount, payRate),
                description:
                  d.note ||
                  (d.kind === 'TDS' ? 'TDS deducted by customer' : d.kind === 'BANK_CHARGES' ? 'Bank charges' : 'Other charges'),
              })),
              {
                controlKind: 'AR',
                credit: round2(toBase(settledTotal, payRate) - fxDifference),
                partyType: 'CUSTOMER',
                partyId: body.partyId || null,
                description: `From ${body.partyName || 'customer'}`,
              },
              ...(fxDifference === 0
                ? []
                : [
                    fxDifference > 0
                      ? { controlKind: 'FX_GAIN_LOSS' as const, credit: fxDifference, description: 'Exchange gain on settlement' }
                      : { controlKind: 'FX_GAIN_LOSS' as const, debit: -fxDifference, description: 'Exchange loss on settlement' },
                  ]),
            ]
          : [
              /*
               * The vendor is debited with what the bill was SETTLED by, not
               * with the cash that left the bank.
               *
               * This branch used to debit `body.amount` and emit no deduction
               * lines at all, while the allocation check above measured against
               * `settledTotal`. So a 1,00,000 bill paid as 90,000 with 10,000
               * TDS was knocked off in full in the payments module and reduced
               * Accounts Payable by 90,000 in the ledger — the party ledger and
               * its control account disagreed by the deduction on every such
               * payment, permanently, and the tax owed to the government was
               * recorded nowhere. The receipt branch above always did this
               * correctly; this one did not.
               */
              {
                controlKind: 'AP',
                debit: round2(toBase(settledTotal, payRate) - fxDifference),
                partyType: 'VENDOR',
                partyId: body.partyId || null,
                description: `To ${body.partyName || 'vendor'}`,
              },
              { ledgerAccountId: mode.id, credit: toBase(body.amount, payRate), description: 'Money paid' },
              /*
               * Each deduction is its own credit. TDS we withhold is a
               * liability until the challan is paid; anything else the payment
               * was settled by without cash moving is credited to the same
               * place its receipt-side twin debits.
               */
              ...(body.deductions || []).map((d) => ({
                controlKind:
                  d.kind === 'TDS'
                    ? ('TDS_PAYABLE' as const)
                    : d.kind === 'BANK_CHARGES'
                      ? ('BANK_CHARGES' as const)
                      : ('EXPENSES' as const),
                credit: toBase(d.amount, payRate),
                description:
                  d.note ||
                  (d.kind === 'TDS' ? 'TDS deducted from vendor' : d.kind === 'BANK_CHARGES' ? 'Bank charges' : 'Other deduction'),
              })),
              ...(fxDifference === 0
                ? []
                : [
                    fxDifference > 0
                      ? { controlKind: 'FX_GAIN_LOSS' as const, credit: fxDifference, description: 'Exchange gain on settlement' }
                      : { controlKind: 'FX_GAIN_LOSS' as const, debit: -fxDifference, description: 'Exchange loss on settlement' },
                  ]),
            ],
    });
  } catch (e: any) {
    /* The payment is removed, so every document it settled has to be
       recomputed without it — otherwise a failed posting leaves an invoice
       marked Paid by a receipt that no longer exists. */
    const touched = created.allocations.map((a) => ({ docType: String(a.docType) === 'BILL' ? ('BILL' as const) : ('INVOICE' as const), docId: String(a.docId) }));
    await prisma.payment.delete({ where: { id: created.id } });
    for (const t of touched) {
      await recalcDocumentSettlement(prisma, { accountId, orgId, docType: t.docType, docId: t.docId });
    }
    return res.status(Number(e?.status || 400)).json({ error: `Not saved: ${String(e?.message || e)}` });
  }

  /* The settled documents travel back with the receipt, so a browser holding
     its own copy can take the server's numbers instead of recomputing them. */
  res.status(201).json({ payment: normalize(created), settlements: (created as any).settlements ?? [] });
});

/** Reversal, not deletion: a posted payment stays in the audit trail. */
paymentsRouter.post('/orgs/:orgId/payments/:paymentId/reverse', async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId, branchId } = req.tenant!;

  /*
   * Reversing is the payment's cancellation, so it needs DELETE on the
   * payment's own resource — the same right an invoice's cancellation asks
   * for. This route used to ask for nothing: anyone in the company, a
   * payroll clerk included, could reverse any receipt and its journal.
   *
   * The payment is read first because its direction decides the resource;
   * a caller limited to their own documents then gets the same 404 as for a
   * payment that does not exist.
   */
  const found = await prisma.payment.findFirst({
    where: { id: String(req.params.paymentId), accountId, orgId },
  });
  if (!found) return res.status(404).json({ error: 'Payment not found' });
  const perms = permsFor(found.direction);
  const refusal = await authorize(req, perms.module, PermissionAction.DELETE, perms.resource);
  if (refusal) return res.status(refusal.status).json(refusal.body);
  const payment = req.ownDocumentsOnly && found.createdByUserId !== req.auth!.userId ? null : found;
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status === 'REVERSED') return res.status(409).json({ error: 'Already reversed' });

  const entries = await prisma.journalEntry.findMany({
    where: { accountId, orgId, sourceDocType: payment.direction, sourceDocId: payment.id, status: 'POSTED' },
    select: { id: true },
  });
  for (const e of entries) {
    await reverseEntry({ accountId, orgId, branchId, userId: req.auth!.userId, entryId: e.id, narration: 'Payment reversed' });
  }

  /* Marking the payment and withdrawing its settlement are one change: a
     reversed receipt that leaves its invoice reading Paid is the other half of
     the defect this phase removes. */
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'REVERSED' },
      include: { allocations: true },
    });
    const settlements = await recalcSettlementForPayment(tx, { accountId, orgId, paymentId: payment.id });
    return Object.assign(row, { settlements });
  });
  res.json({
    payment: normalize(updated),
    reversedEntries: entries.length,
    settlements: (updated as any).settlements ?? [],
  });
});

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

const reconcileSchema = z.object({
  reconciled: z.boolean(),
  bankDate: z.string().optional().nullable(),
  statementRef: z.string().max(120).optional().nullable(),
});

/**
 * Marks a payment against the bank statement.
 *
 * Gated on the bankReconciliation feature: a business that does not reconcile
 * never sees this, and entry is unaffected either way.
 */
paymentsRouter.patch('/orgs/:orgId/payments/:paymentId/reconcile', async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;

  // Matching against the bank statement is bank work, whichever direction
  // the money went.
  const refusal = await authorize(req, 'CASHBANK', PermissionAction.EDIT, 'Bank Transactions');
  if (refusal) return res.status(refusal.status).json(refusal.body);

  if (!(await isFeatureEnabled(accountId, orgId, 'bankReconciliation'))) {
    return res.status(400).json({ error: 'Bank reconciliation is switched off for this company' });
  }

  const payment = await prisma.payment.findFirst({
    where: { id: String(req.params.paymentId), accountId, orgId, ...ownDocsWhere(req) },
  });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  const body = reconcileSchema.parse(req.body);
  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      reconciled: body.reconciled,
      bankDate: body.bankDate ? new Date(body.bankDate) : body.reconciled ? new Date() : null,
      statementRef: body.statementRef ?? null,
    },
    include: { allocations: true },
  });

  res.json({ payment: normalize(updated) });
});
