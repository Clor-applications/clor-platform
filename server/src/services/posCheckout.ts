import { Prisma } from '@prisma/client';

import { prisma } from '../utils/prisma.js';
import type { DbClient } from '../utils/dbClient.js';
import { ensureLedgerSetup, invoicePostingLines, postEntry } from './ledger.js';
import { allocateNumber, ensureDefaultSeries } from './numbering.js';
import { INERT_PAYMENT_STATUSES, assertAllocationsFit, recalcSettlementForPayment } from './settlement.js';
import { TENDER_CONTROL_KIND, isPosTender, type PosTender } from './receiptAccounts.js';

/**
 * A counter sale, as one transaction.
 *
 * A POS sale is six writes that are only ever right together: the invoice, the
 * sale posting, the receipt, its allocation, the receipt posting, and the
 * settlement derived from them. Until now the till did none of it. It created
 * an invoice through the ordinary route carrying `status: 'Paid'`, appended a
 * receipt to browser storage, and stopped — so the ledger held a debit to
 * receivables that nothing ever cleared, the till's money reached no cash or
 * bank account, and the invoice said Paid while `paidAmount` stayed at zero.
 * Three books, three answers, and the audited one said the customer still owed
 * the money.
 *
 * So the money is recorded where it was taken, by the server, in one
 * `$transaction`. Either the whole sale is in the books or none of it is: a
 * failure anywhere leaves no invoice, no payment, no allocation and no journal
 * entry, and the operator is told the sale did not go through rather than
 * handed a receipt for it.
 *
 * Three things this deliberately does NOT do. It does not compute tax — the
 * client's economics are carried through unchanged, because server-side
 * calculation authority is its own piece of work and guessing at it here would
 * silently restate live invoices. It does not decide settlement from what the
 * client claims — `status` is never read from the request; `paidAmount` comes
 * from the allocation this transaction wrote. And it does not touch stock:
 * inventory authority is still unresolved, and a POS sale does not move server
 * stock today any more than it did before.
 */

export const POS_SOURCE_SYSTEM = 'POS';

/** Refusals a till can act on, rather than a stack trace. */
export type PosCheckoutCode =
  /** This branch has no usable ledger account for the chosen tender. */
  | 'POS_TENDER_UNCONFIGURED'
  /** The key names a checkout that exists in a state this code cannot have written. */
  | 'POS_CHECKOUT_CONFLICT'
  /** Another document already wears the number this sale was given. */
  | 'POS_NUMBER_TAKEN'
  /** Paid at the counter: the ordinary cancellation would only half-reverse it. */
  | 'POS_REFUND_REQUIRED'
  | 'POS_INVALID_SALE';

export class PosCheckoutError extends Error {
  code: PosCheckoutCode;
  status: number;
  constructor(code: PosCheckoutCode, message: string, status = 409) {
    super(message);
    this.name = 'PosCheckoutError';
    this.code = code;
    this.status = status;
  }
}

export type PosCheckoutInput = {
  /**
   * The till's identity for this checkout ATTEMPT, stable across retries.
   *
   * Not the invoice number, the total, or the time: each of those is either
   * allocated per attempt or shared by two genuine sales, and neither answers
   * "is this the same sale coming back, or another customer buying the same
   * thing?".
   */
  checkoutId: string;
  tender: PosTender;
  date: string;
  /** Optional: omitted, the server allocates from the POS series. */
  number?: string | null;
  customerId?: string | null;
  customerName: string;
  customerMobile?: string | null;
  warehouseId?: string | null;
  taxType?: string | null;
  placeOfSupplyState?: string | null;
  subtotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  gstTotal: number;
  total: number;
  items: unknown[];
};

export type PosCheckoutContext = {
  accountId: string;
  orgId: string;
  branchId: string;
  userId: string;
};

export type PosCheckoutResult = {
  /** True when this call found the sale already committed and returned it. */
  replayed: boolean;
  invoice: {
    id: string;
    number: string;
    date: string;
    total: number;
    paidAmount: number;
    outstanding: number;
    status: string;
  };
  payment: { id: string; number: string; amount: number; status: string; ledgerAccountId: string };
  allocation: { id: string; amount: number };
  journalEntryIds: { sale: string; receipt: string };
};

const money = (v: number | Prisma.Decimal | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const paise = (v: number | Prisma.Decimal | null | undefined) => Math.round(money(v) * 100);
const dec = (v: number) => new Prisma.Decimal(v.toFixed(2));

/**
 * The ledger account this branch has said the tender lands in.
 *
 * Fail closed, every time. No mapping, a mapping whose account has since been
 * deactivated, moved to another branch or had its kind changed — all of them
 * are UNCONFIGURED, because a till that reaches for "any cash account" when it
 * cannot find the right one is how money ends up in an account nobody opened.
 * There is no fallback to receivables either: recording a counter sale as
 * credit is the bug this whole piece of work exists to remove.
 */
export async function resolveTenderAccount(
  db: DbClient,
  opts: { orgId: string; branchId: string; tender: PosTender }
): Promise<{ id: string; code: string; name: string; controlKind: 'CASH' | 'BANK' }> {
  if (!isPosTender(opts.tender)) {
    throw new PosCheckoutError('POS_INVALID_SALE', `${String(opts.tender)} is not a tender this counter takes.`, 400);
  }
  const wanted = TENDER_CONTROL_KIND[opts.tender];

  const mapping = await db.posTenderAccount.findUnique({
    where: { orgId_branchId_tender: { orgId: opts.orgId, branchId: opts.branchId, tender: opts.tender } },
    select: {
      ledgerAccount: { select: { id: true, code: true, name: true, controlKind: true, branchId: true, isActive: true } },
    },
  });

  const acc = mapping?.ledgerAccount;
  const usable =
    acc && acc.isActive && acc.controlKind === wanted && (acc.branchId === null || acc.branchId === opts.branchId);

  if (!usable) {
    throw new PosCheckoutError(
      'POS_TENDER_UNCONFIGURED',
      `${opts.tender} has no ${wanted === 'CASH' ? 'cash' : 'bank'} account set for this branch. ` +
        'Set one under Settings → Finance → POS Payment Accounts before taking this tender.'
    );
  }
  return { id: acc!.id, code: acc!.code, name: acc!.name, controlKind: wanted };
}

/**
 * The sale this key already bought, if it bought one.
 *
 * Returns null when the key is unknown. Throws when the key names something
 * this code could not have written — an invoice with no payment, a payment
 * with no allocation — because the honest answer there is "a human should look
 * at this", not a second sale on top of a broken one.
 */
async function findCommittedCheckout(
  db: DbClient,
  ctx: PosCheckoutContext,
  checkoutId: string
): Promise<PosCheckoutResult | null> {
  const invoice = await db.invoice.findFirst({
    where: { orgId: ctx.orgId, sourceSystem: POS_SOURCE_SYSTEM, sourceKey: checkoutId },
  });
  if (!invoice) return null;

  const payment = await db.payment.findFirst({
    where: { orgId: ctx.orgId, sourceSystem: POS_SOURCE_SYSTEM, sourceKey: checkoutId },
    include: { allocations: true },
  });
  const allocation = payment?.allocations.find((a) => a.docType === 'INVOICE' && a.docId === invoice.id);

  const entries = await db.journalEntry.findMany({
    where: {
      orgId: ctx.orgId,
      status: 'POSTED',
      OR: [
        { sourceDocType: 'INVOICE', sourceDocId: invoice.id },
        ...(payment ? [{ sourceDocType: 'RECEIPT', sourceDocId: payment.id }] : []),
      ],
    },
    select: { id: true, sourceDocType: true },
  });
  const sale = entries.find((e) => e.sourceDocType === 'INVOICE');
  const receipt = entries.find((e) => e.sourceDocType === 'RECEIPT');

  if (!payment || !allocation || !sale || !receipt) {
    throw new PosCheckoutError(
      'POS_CHECKOUT_CONFLICT',
      `Checkout ${checkoutId} is recorded in a state this till cannot complete: ` +
        `invoice ${invoice.number}${payment ? '' : ', no payment'}${allocation ? '' : ', no allocation'}` +
        `${sale ? '' : ', no sale posting'}${receipt ? '' : ', no receipt posting'}. ` +
        'It has not been changed. Report it rather than retrying.'
    );
  }

  return {
    replayed: true,
    invoice: {
      id: invoice.id,
      number: invoice.number,
      date: invoice.date,
      total: money(invoice.total),
      paidAmount: money(invoice.paidAmount),
      outstanding: Math.max(0, money(invoice.total) - money(invoice.paidAmount)),
      status: invoice.status,
    },
    payment: {
      id: payment.id,
      number: payment.number,
      amount: money(payment.amount),
      status: payment.status,
      ledgerAccountId: payment.ledgerAccountId,
    },
    allocation: { id: allocation.id, amount: money(allocation.amount) },
    journalEntryIds: { sale: sale.id, receipt: receipt.id },
  };
}

/**
 * A number for the sale.
 *
 * Server-allocated, from a POS series of its own, because two terminals each
 * counting their own local POS invoices reach POS-3 at the same moment and one
 * of them loses the sale to a duplicate-number error. Numbers already taken are
 * stepped over rather than collided with: an organisation that has been running
 * the old browser-numbered till already holds POS-1..POS-n, and a fresh series
 * would otherwise start underneath them.
 */
async function allocatePosNumber(tx: Prisma.TransactionClient, ctx: PosCheckoutContext, date: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { number } = await allocateNumber(tx, {
      accountId: ctx.accountId,
      orgId: ctx.orgId,
      branchId: ctx.branchId,
      docType: 'POS',
      userId: ctx.userId,
      date,
    });
    const taken = await tx.invoice.findFirst({ where: { orgId: ctx.orgId, number }, select: { id: true } });
    if (!taken) return number;
  }
  throw new PosCheckoutError('POS_NUMBER_TAKEN', 'Could not find a free POS number for this sale.');
}

/**
 * Ring up one sale.
 *
 * Everything below the tender check happens inside a single transaction, and
 * nothing inside it opens another: `postEntry`, `allocateNumber`,
 * `assertAllocationsFit` and `recalcSettlementForPayment` all take the client
 * they are given.
 */
export async function checkoutPosSale(
  input: PosCheckoutInput,
  ctx: PosCheckoutContext
): Promise<PosCheckoutResult> {
  const checkoutId = String(input.checkoutId || '').trim();
  if (!checkoutId) throw new PosCheckoutError('POS_INVALID_SALE', 'This checkout has no id.', 400);

  const totalPaise = paise(input.total);
  if (totalPaise <= 0) {
    throw new PosCheckoutError('POS_INVALID_SALE', 'A counter sale has to be for more than nothing.', 400);
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new PosCheckoutError('POS_INVALID_SALE', 'A counter sale has to have something in it.', 400);
  }

  // Already rung up? Hand back the sale that exists rather than taking the
  // money twice. Checked before the tender, so a till retrying a sale that
  // succeeded is not refused because an admin has since cleared the mapping.
  const already = await findCommittedCheckout(prisma, ctx, checkoutId);
  if (already) return already;

  const tenderAccount = await resolveTenderAccount(prisma, {
    orgId: ctx.orgId,
    branchId: ctx.branchId,
    tender: input.tender,
  });

  // Setup and series live outside the sale's transaction: they are shared,
  // idempotent, and holding them inside would make one till's first sale of the
  // day contend with every other write.
  await ensureLedgerSetup(ctx.accountId, ctx.orgId, ctx.userId);
  await ensureDefaultSeries({
    accountId: ctx.accountId,
    orgId: ctx.orgId,
    branchId: ctx.branchId,
    docType: 'POS',
    userId: ctx.userId,
  });
  await ensureDefaultSeries({
    accountId: ctx.accountId,
    orgId: ctx.orgId,
    branchId: ctx.branchId,
    docType: 'RECEIPT',
    userId: ctx.userId,
  });

  const total = Math.round(totalPaise) / 100;
  const buyer = String(input.customerName || '').trim() || 'Walk-in Customer';

  try {
    return await prisma.$transaction(async (tx) => {
      const number = String(input.number || '').trim() || (await allocatePosNumber(tx, ctx, input.date));

      const invoice = await tx.invoice.create({
        data: {
          accountId: ctx.accountId,
          orgId: ctx.orgId,
          branchId: ctx.branchId,
          warehouseId: String(input.warehouseId || '').trim() || null,
          number,
          date: input.date,
          dueDate: input.date,
          customerId: String(input.customerId || '').trim() || null,
          customerName: buyer,
          placeOfSupplyState: String(input.placeOfSupplyState || '').trim() || null,
          taxType: String(input.taxType || '').trim() || null,
          subtotal: dec(money(input.subtotal)),
          cgstTotal: dec(money(input.cgstTotal)),
          sgstTotal: dec(money(input.sgstTotal)),
          igstTotal: dec(money(input.igstTotal)),
          gstTotal: dec(money(input.gstTotal)),
          total: dec(total),
          baseTotal: dec(total),
          /*
           * Unpaid, and not for a moment Paid.
           *
           * The till used to send `status: 'Paid'` and the server wrote it down.
           * Settlement is not a claim a client gets to make — it is what the
           * allocations say, and there are none yet. `Draft` would be worse
           * still: settlement never overwrites a lifecycle status, so the sale
           * would have stayed a draft forever.
           */
          status: 'Unpaid',
          paidAmount: dec(0),
          itemsJson: JSON.stringify(input.items),
          /* The same three keys the invoice route stores, in the same shape,
             so a hydrated POS sale is indistinguishable from one the browser
             wrote — the day close reads `posSale` and `tender` off it. Absent
             stays absent rather than becoming null, as it does there. */
          extrasJson: JSON.stringify({
            posSale: true,
            tender: input.tender,
            ...(String(input.customerMobile || '').trim()
              ? { customerMobile: String(input.customerMobile).trim() }
              : {}),
          }),
          sourceSystem: POS_SOURCE_SYSTEM,
          sourceKey: checkoutId,
          createdByUserId: ctx.userId,
        },
      });

      const saleEntry = await postEntry(
        {
          accountId: ctx.accountId,
          orgId: ctx.orgId,
          branchId: ctx.branchId,
          userId: ctx.userId,
          date: input.date,
          journalCode: 'SAL',
          narration: `POS ${number} - ${buyer}`,
          sourceDocType: 'INVOICE',
          sourceDocId: invoice.id,
          /* The same lines an ordinary invoice posts. POS is a way of selling,
             not a different kind of sale. */
          lines: invoicePostingLines({
            customerId: invoice.customerId,
            customerName: buyer,
            subtotal: money(input.subtotal),
            cgstTotal: money(input.cgstTotal),
            sgstTotal: money(input.sgstTotal),
            igstTotal: money(input.igstTotal),
            total,
          }),
        },
        tx
      );

      const receiptNumber = (
        await allocateNumber(tx, {
          accountId: ctx.accountId,
          orgId: ctx.orgId,
          branchId: ctx.branchId,
          docType: 'RECEIPT',
          userId: ctx.userId,
          date: input.date,
        })
      ).number;

      // The same guard an ordinary receipt passes, against the invoice this
      // transaction has just written.
      await assertAllocationsFit(tx, {
        accountId: ctx.accountId,
        orgId: ctx.orgId,
        allocations: [{ docType: 'INVOICE', docId: invoice.id, amount: total }],
      });

      const payment = await tx.payment.create({
        data: {
          accountId: ctx.accountId,
          orgId: ctx.orgId,
          branchId: ctx.branchId,
          direction: 'RECEIPT',
          number: receiptNumber,
          date: input.date,
          partyType: invoice.customerId ? 'CUSTOMER' : null,
          partyId: invoice.customerId,
          partyName: buyer,
          ledgerAccountId: tenderAccount.id,
          instrumentRef: input.tender,
          amount: dec(total),
          notes: `POS sale ${number}`,
          sourceSystem: POS_SOURCE_SYSTEM,
          sourceKey: checkoutId,
          createdByUserId: ctx.userId,
          allocations: {
            create: [
              {
                accountId: ctx.accountId,
                orgId: ctx.orgId,
                branchId: ctx.branchId,
                docType: 'INVOICE',
                docId: invoice.id,
                amount: dec(total),
              },
            ],
          },
        },
        include: { allocations: true },
      });

      /*
       * The money, into the account this branch named for this tender.
       *
       * Receivables are credited, not sales: the sale posting above already
       * took the revenue and the tax. Crediting sales again here would book the
       * same money twice and leave AR outstanding forever, which is the shape
       * of the bug this replaces.
       */
      const receiptEntry = await postEntry(
        {
          accountId: ctx.accountId,
          orgId: ctx.orgId,
          branchId: ctx.branchId,
          userId: ctx.userId,
          date: input.date,
          journalCode: tenderAccount.controlKind === 'BANK' ? 'BNK' : 'CSH',
          narration: `POS receipt ${receiptNumber} - ${buyer} (${input.tender})`,
          sourceDocType: 'RECEIPT',
          sourceDocId: payment.id,
          lines: [
            { ledgerAccountId: tenderAccount.id, debit: total, description: `${input.tender} taken at the counter` },
            {
              controlKind: 'AR',
              credit: total,
              partyType: invoice.customerId ? 'CUSTOMER' : null,
              partyId: invoice.customerId,
              description: `From ${buyer}`,
            },
          ],
        },
        tx
      );

      const [settlement] = await recalcSettlementForPayment(tx, {
        accountId: ctx.accountId,
        orgId: ctx.orgId,
        paymentId: payment.id,
      });

      /*
       * And prove it, before committing.
       *
       * A sale that reaches this line having settled to anything other than
       * paid-in-full has a defect behind it, and the safe thing to do with a
       * defect is to not write it down. Rolling back here costs the customer a
       * second tap; committing it costs somebody an afternoon with the ledger.
       */
      if (!settlement || paise(settlement.paidAmount) !== totalPaise || settlement.status !== 'Paid') {
        throw new PosCheckoutError(
          'POS_CHECKOUT_CONFLICT',
          `POS ${number} did not settle: ${settlement ? `${settlement.status} ${settlement.paidAmount}` : 'no settlement'} against ${total}.`
        );
      }

      return {
        replayed: false,
        invoice: {
          id: invoice.id,
          number,
          date: invoice.date,
          total,
          paidAmount: settlement.paidAmount,
          outstanding: settlement.outstanding,
          status: settlement.status,
        },
        payment: {
          id: payment.id,
          number: receiptNumber,
          amount: total,
          status: payment.status,
          ledgerAccountId: tenderAccount.id,
        },
        allocation: { id: payment.allocations[0].id, amount: total },
        journalEntryIds: { sale: saleEntry.id, receipt: receiptEntry.id },
      } satisfies PosCheckoutResult;
    });
  } catch (e: any) {
    if (String(e?.code) === 'P2002') {
      /*
       * Which index was hit, decided by looking rather than by asking.
       *
       * This used to read `e.meta.target` for the word "sourceKey". SQLite
       * fills that in; PostgreSQL reports "Unique constraint failed on the
       * (not available)", so the check silently stopped matching and a second
       * tap at the till was answered with "that number is already used"
       * instead of the receipt it had just produced. The same sale, reported
       * as a numbering error.
       *
       * So: if this checkout key already has a committed sale, that sale is
       * the answer, whatever the driver chose to say about the index. Only
       * when there is no such sale is this really a clash over a number.
       */
      const committed = await findCommittedCheckout(prisma, ctx, checkoutId);
      if (committed) return committed;

      const target = String(e?.meta?.target ?? '');
      if (target.includes('sourceKey')) {
        throw new PosCheckoutError(
          'POS_CHECKOUT_CONFLICT',
          `Checkout ${checkoutId} collided with itself but left nothing behind. Report it rather than retrying.`
        );
      }
      throw new PosCheckoutError(
        'POS_NUMBER_TAKEN',
        'That number is already used. Numbers are unique across every branch.'
      );
    }
    throw e;
  }
}

/**
 * A settled counter sale cannot be cancelled by the ordinary route.
 *
 * That route reverses the sale posting and stops. On a credit invoice that is
 * the whole story; on a POS sale it is half of one — the receipt entry would
 * stay, the money would still be shown as taken, the allocation would still
 * point at a cancelled document, and the ledger would carry a cash debit
 * against nothing. Reversing both legs coherently is a refund, which is its
 * own piece of work with its own document and its own number.
 *
 * So this refuses, and refuses completely: nothing is reversed, nothing is
 * deleted, and no negative payment is invented to paper over it.
 */
export async function assertPosSaleCancellable(
  db: DbClient,
  opts: { accountId: string; orgId: string; invoiceId: string; invoiceNumber?: string | null }
): Promise<void> {
  const allocations = await db.paymentAllocation.findMany({
    where: { accountId: opts.accountId, orgId: opts.orgId, docType: 'INVOICE', docId: opts.invoiceId },
    select: { amount: true, payment: { select: { number: true, status: true, sourceSystem: true } } },
  });

  const live = allocations.filter(
    (a) =>
      a.payment &&
      a.payment.sourceSystem === POS_SOURCE_SYSTEM &&
      !INERT_PAYMENT_STATUSES.has(String(a.payment.status ?? '').toUpperCase()) &&
      paise(a.amount) > 0
  );
  if (!live.length) return;

  throw new PosCheckoutError(
    'POS_REFUND_REQUIRED',
    `${opts.invoiceNumber ? `POS sale ${opts.invoiceNumber}` : 'This POS sale'} has been paid at the counter ` +
      `(receipt ${live.map((l) => l.payment!.number).join(', ')}). Cancelling it here would reverse the sale and ` +
      'leave the money recorded as taken. It needs a POS refund, which reverses both halves together.'
  );
}
