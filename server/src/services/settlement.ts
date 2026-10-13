import { Prisma } from '@prisma/client';

import { prisma } from '../utils/prisma.js';
import type { DbClient } from '../utils/dbClient.js';

/**
 * How much of a document has been settled, and what that makes it.
 *
 * Settlement used to be worked out in the browser. `paymentService.js` added a
 * receipt's allocations to whatever `paidAmount` the browser was holding and
 * wrote the answer into local storage; the server stored the allocations, the
 * ledger, and an `Invoice.paidAmount` that no payment ever touched. So an
 * invoice of 118,000 with a 50,000 receipt against it reported 118,000
 * outstanding on every screen that read the column, 68,000 on the screens that
 * read the allocations, and AR on the ledger was right — three answers, and
 * the audited one was the one nobody looked at.
 *
 * This is the one place that answers it now, and it answers from the rows that
 * are actually persisted:
 *
 *   validAllocated = Σ allocation.amount  where the payment is not REVERSED
 *   paidAmount     = validAllocated
 *   outstanding    = max(0, total - validAllocated)
 *
 * Derived, never accumulated. There is no `paid = paid + amount` anywhere in
 * here, which is what makes two receipts landing on one invoice at the same
 * moment safe: each recalculation reads every allocation that exists at that
 * point, so the later one cannot lose the earlier one's work.
 *
 * Money is compared in integer paise for the same reason the posting engine
 * does it — `0.1 + 0.2` is not 0.3, and "is this invoice settled" must not
 * depend on how the last division happened to round.
 */

const paise = (v: Prisma.Decimal | number | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const rupees = (p: number) => Math.round(p) / 100;

/**
 * Statuses that say where a document is in its life rather than how much of it
 * has been paid. Settlement never overwrites one of these: a cancelled invoice
 * that happens to carry an allocation is still cancelled, and a draft is still
 * a draft. Their amounts are kept accurate regardless, so that reinstating one
 * does not reinstate a stale number with it.
 */
export const LIFECYCLE_STATUSES = new Set([
  'draft',
  'cancelled',
  'canceled',
  'void',
  'pending approval',
  'rejected',
]);

/** A payment in this state has no accounting effect and settles nothing. */
export const INERT_PAYMENT_STATUSES = new Set(['REVERSED', 'CANCELLED']);

export type SettlementResult = {
  docType: 'INVOICE' | 'BILL';
  docId: string;
  total: number;
  paidAmount: number;
  outstanding: number;
  status: string;
  previousPaidAmount: number;
  previousStatus: string;
  changed: boolean;
};

/**
 * The settlement status for a total and an amount paid.
 *
 * `Overdue` is deliberately preserved when nothing has been paid: it is
 * `Unpaid` that has passed its due date, so recomputing it as plain `Unpaid`
 * would throw away the only signal the list screens colour red. Anything paid
 * against it moves it onto the settlement scale like any other document.
 */
export function deriveSettlementStatus(opts: {
  totalPaise: number;
  paidPaise: number;
  current: string | null | undefined;
}): string {
  const current = String(opts.current ?? '').trim();
  const key = current.toLowerCase();

  if (LIFECYCLE_STATUSES.has(key)) return current;
  // A zero-value document has nothing to settle; leave whatever it carries.
  if (opts.totalPaise <= 0) return current || 'Unpaid';

  const outstanding = opts.totalPaise - opts.paidPaise;
  if (outstanding <= 0) return 'Paid';
  if (opts.paidPaise > 0) return 'Partially Paid';
  return key === 'overdue' ? current : 'Unpaid';
}

/**
 * What a document has actually been settled by, in paise, from persisted
 * allocations — reversed payments excluded.
 */
export async function validAllocatedPaise(
  tx: DbClient,
  opts: { accountId: string; orgId: string; docType: 'INVOICE' | 'BILL'; docId: string }
): Promise<number> {
  const rows = await tx.paymentAllocation.findMany({
    where: { accountId: opts.accountId, orgId: opts.orgId, docType: opts.docType, docId: opts.docId },
    select: { amount: true, payment: { select: { status: true } } },
  });

  return rows.reduce((sum, r) => {
    const status = String(r.payment?.status ?? '').toUpperCase();
    if (INERT_PAYMENT_STATUSES.has(status)) return sum;
    return sum + paise(r.amount);
  }, 0);
}

/**
 * Recalculate one document's settlement and write it back.
 *
 * Idempotent: running it twice on unchanged allocations writes the same values
 * and reports `changed: false` the second time.
 */
export async function recalcDocumentSettlement(
  tx: DbClient,
  opts: { accountId: string; orgId: string; docType: 'INVOICE' | 'BILL'; docId: string }
): Promise<SettlementResult | null> {
  const { accountId, orgId, docType, docId } = opts;

  const doc =
    docType === 'INVOICE'
      ? await tx.invoice.findFirst({ where: { id: docId, accountId, orgId }, select: { id: true, total: true, paidAmount: true, status: true } })
      : await tx.bill.findFirst({ where: { id: docId, accountId, orgId }, select: { id: true, total: true, settledAmount: true, status: true } });

  if (!doc) return null;

  const totalPaise = paise(doc.total);
  const paidPaise = await validAllocatedPaise(tx, opts);
  const previousPaidPaise = paise(docType === 'INVOICE' ? (doc as any).paidAmount : (doc as any).settledAmount);
  const previousStatus = String(doc.status ?? '');
  const status = deriveSettlementStatus({ totalPaise, paidPaise, current: previousStatus });

  const changed = previousPaidPaise !== paidPaise || previousStatus !== status;

  if (changed) {
    const amount = new Prisma.Decimal(rupees(paidPaise).toFixed(2));
    if (docType === 'INVOICE') {
      await tx.invoice.update({ where: { id: docId }, data: { paidAmount: amount, status } });
    } else {
      await tx.bill.update({ where: { id: docId }, data: { settledAmount: amount, status } });
    }
  }

  return {
    docType,
    docId,
    total: rupees(totalPaise),
    paidAmount: rupees(paidPaise),
    outstanding: rupees(Math.max(0, totalPaise - paidPaise)),
    status,
    previousPaidAmount: rupees(previousPaidPaise),
    previousStatus,
    changed,
  };
}

/**
 * Recalculate every document a payment touches. Used when a payment is
 * created, reversed, or removed — in each case the payment's own allocations
 * name exactly the documents whose settlement can have moved.
 */
export async function recalcSettlementForPayment(
  tx: DbClient,
  opts: { accountId: string; orgId: string; paymentId: string }
): Promise<SettlementResult[]> {
  const allocations = await tx.paymentAllocation.findMany({
    where: { accountId: opts.accountId, orgId: opts.orgId, paymentId: opts.paymentId },
    select: { docType: true, docId: true },
  });

  const seen = new Set<string>();
  const out: SettlementResult[] = [];
  for (const a of allocations) {
    const docType = String(a.docType) === 'BILL' ? 'BILL' : 'INVOICE';
    const key = `${docType}:${a.docId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const result = await recalcDocumentSettlement(tx, {
      accountId: opts.accountId,
      orgId: opts.orgId,
      docType,
      docId: String(a.docId),
    });
    if (result) out.push(result);
  }
  return out;
}

export class OverAllocationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'OverAllocationError';
  }
}

/**
 * Refuse to allocate more to a document than it still owes.
 *
 * The product has no customer-credit entity for receipts — excess money is
 * held by leaving it unallocated on the receipt, which the existing rule
 * already permits (allocations may total less than the payment). Letting an
 * allocation exceed the balance would need somewhere for the excess to live,
 * and inventing that is a different decision from this one. So it is refused,
 * with the balance named.
 *
 * `excludePaymentId` lets an edit ignore its own earlier allocations, so
 * re-saving a receipt does not read as a double allocation.
 */
export async function assertAllocationsFit(
  tx: DbClient,
  opts: {
    accountId: string;
    orgId: string;
    allocations: Array<{ docType: 'INVOICE' | 'BILL'; docId: string; amount: number }>;
    excludePaymentId?: string | null;
  }
): Promise<void> {
  const wanted = new Map<string, { docType: 'INVOICE' | 'BILL'; docId: string; paise: number }>();
  for (const a of opts.allocations || []) {
    const key = `${a.docType}:${a.docId}`;
    const prev = wanted.get(key);
    if (prev) prev.paise += paise(a.amount);
    else wanted.set(key, { docType: a.docType, docId: a.docId, paise: paise(a.amount) });
  }

  for (const { docType, docId, paise: wantPaise } of wanted.values()) {
    const doc =
      docType === 'INVOICE'
        ? await tx.invoice.findFirst({ where: { id: docId, accountId: opts.accountId, orgId: opts.orgId }, select: { total: true, number: true } })
        : await tx.bill.findFirst({ where: { id: docId, accountId: opts.accountId, orgId: opts.orgId }, select: { total: true, number: true } });
    if (!doc) throw new OverAllocationError(`Cannot allocate to a ${docType.toLowerCase()} that does not exist`);

    const rows = await tx.paymentAllocation.findMany({
      where: { accountId: opts.accountId, orgId: opts.orgId, docType, docId },
      select: { amount: true, paymentId: true, payment: { select: { status: true } } },
    });
    const alreadyPaise = rows.reduce((sum, r) => {
      if (opts.excludePaymentId && r.paymentId === opts.excludePaymentId) return sum;
      if (INERT_PAYMENT_STATUSES.has(String(r.payment?.status ?? '').toUpperCase())) return sum;
      return sum + paise(r.amount);
    }, 0);

    const remaining = paise(doc.total) - alreadyPaise;
    // Half a paisa of slack, the same tolerance the allocation-versus-payment
    // check upstream already uses.
    if (wantPaise > remaining) {
      throw new OverAllocationError(
        `${docType === 'INVOICE' ? 'Invoice' : 'Bill'} ${doc.number} has ${rupees(Math.max(0, remaining)).toFixed(2)} outstanding; ` +
          `cannot allocate ${rupees(wantPaise).toFixed(2)} to it`
      );
    }
  }
}

/**
 * Read-only: every document whose stored settlement disagrees with its
 * allocations. Nothing is written — this is the report that decides whether a
 * backfill is warranted, not the backfill.
 */
export async function settlementDiscrepancies(opts: { accountId?: string; orgId?: string } = {}) {
  const where: any = {};
  if (opts.accountId) where.accountId = opts.accountId;
  if (opts.orgId) where.orgId = opts.orgId;

  const rows: Array<{
    docType: 'INVOICE' | 'BILL';
    id: string;
    number: string;
    total: number;
    storedPaidAmount: number;
    validAllocated: number;
    expectedPaidAmount: number;
    storedStatus: string;
    expectedStatus: string;
    paidDifference: number;
    statusDiffers: boolean;
  }> = [];

  const invoices = await prisma.invoice.findMany({
    where,
    select: { id: true, accountId: true, orgId: true, number: true, total: true, paidAmount: true, status: true },
  });
  const bills = await prisma.bill.findMany({
    where,
    select: { id: true, accountId: true, orgId: true, number: true, total: true, settledAmount: true, status: true },
  });

  const consider = async (
    docType: 'INVOICE' | 'BILL',
    doc: { id: string; accountId: string; orgId: string; number: string; total: any; status: string },
    storedPaise: number
  ) => {
    const validPaise = await validAllocatedPaise(prisma, {
      accountId: doc.accountId,
      orgId: doc.orgId,
      docType,
      docId: doc.id,
    });
    const totalPaise = paise(doc.total);
    const expectedStatus = deriveSettlementStatus({ totalPaise, paidPaise: validPaise, current: doc.status });
    const paidDiffers = storedPaise !== validPaise;
    const statusDiffers = String(doc.status ?? '') !== expectedStatus;
    if (!paidDiffers && !statusDiffers) return;
    rows.push({
      docType,
      id: doc.id,
      number: doc.number,
      total: rupees(totalPaise),
      storedPaidAmount: rupees(storedPaise),
      validAllocated: rupees(validPaise),
      expectedPaidAmount: rupees(validPaise),
      storedStatus: String(doc.status ?? ''),
      expectedStatus,
      paidDifference: rupees(validPaise - storedPaise),
      statusDiffers,
    });
  };

  for (const i of invoices) await consider('INVOICE', i as any, paise(i.paidAmount));
  for (const b of bills) await consider('BILL', b as any, paise((b as any).settledAmount));

  return {
    invoicesChecked: invoices.length,
    billsChecked: bills.length,
    disagreeing: rows.length,
    rows,
  };
}
