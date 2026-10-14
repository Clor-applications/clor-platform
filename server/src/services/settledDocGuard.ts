import { prisma } from '../utils/prisma.js';
import { validAllocatedPaise } from './settlement.js';

/**
 * Whether a posted document can be cancelled or removed, given what else in
 * the books leans on it.
 *
 * Cancelling an invoice and deleting a bill, expense or note both reverse the
 * document's journal. Neither route asked what else pointed at the document,
 * so a paid invoice could be cancelled and a paid bill deleted: the sale or
 * purchase vanished from the ledger while the receipt or payment stayed,
 * allocated against nothing, and the customer or vendor balance went wrong by
 * exactly that amount. The invoice list checked this in the browser; the
 * server, which is what decides, did not.
 *
 * The rule is the one a bookkeeper follows: undo what depends on the
 * document first. Reverse the payment, delete or unapply the note, then
 * cancel. Each refusal says which.
 */

export class SettledDocument extends Error {
  status = 409;
  code = 'document_settled';
  constructor(message: string) {
    super(message);
  }
}

const num = (v: unknown) => Number(v ?? 0) || 0;

/** Notes (credit or debit) that name this document, or list it among their allocations. */
async function notesAgainst(accountId: string, orgId: string, docId: string) {
  const where = {
    accountId,
    orgId,
    OR: [{ againstDocId: docId }, { extrasJson: { contains: docId } }],
  };
  const [credit, debit] = await Promise.all([
    prisma.creditNote.findMany({ where, select: { number: true, status: true } }),
    prisma.debitNote.findMany({ where, select: { number: true, status: true } }),
  ]);
  return [...credit, ...debit].filter((n) => String(n.status || '').toLowerCase() !== 'cancelled');
}

const listed = (rows: Array<{ number: string | null }>) => {
  const names = rows.map((r) => r.number).filter(Boolean).slice(0, 3);
  return names.length ? ` (${names.join(', ')}${rows.length > 3 ? '…' : ''})` : '';
};

export async function assertInvoiceCancellable(opts: { accountId: string; orgId: string; invoice: { id: string; paidAmount?: unknown } }) {
  const { accountId, orgId, invoice } = opts;
  const allocated = await validAllocatedPaise(prisma, { accountId, orgId, docType: 'INVOICE', docId: invoice.id });
  if (allocated > 0 || num(invoice.paidAmount) > 0) {
    throw new SettledDocument('This invoice has been paid in whole or part. Reverse the receipt first, then cancel.');
  }
  const notes = await notesAgainst(accountId, orgId, invoice.id);
  if (notes.length) {
    throw new SettledDocument(`A credit note is raised against this invoice${listed(notes)}. Cancel the note first.`);
  }
}

export async function assertPurchaseDocRemovable(opts: {
  accountId: string;
  orgId: string;
  kind: 'BILL' | 'EXPENSE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  doc: { id: string; settledAmount?: unknown; extrasJson?: string | null };
  /** What is being refused, for the message: removing or changing. */
  verb?: 'delete' | 'change' | 'cancel';
}) {
  const { accountId, orgId, kind, doc } = opts;
  const verb = opts.verb || 'delete';
  const noun = { BILL: 'bill', EXPENSE: 'expense', CREDIT_NOTE: 'credit note', DEBIT_NOTE: 'debit note' }[kind];

  if (kind === 'BILL') {
    const allocated = await validAllocatedPaise(prisma, { accountId, orgId, docType: 'BILL', docId: doc.id });
    if (allocated > 0) throw new SettledDocument(`This bill has payments against it. Reverse the payment first, then ${verb} it.`);
  }
  if (num(doc.settledAmount) > 0) {
    throw new SettledDocument(`This ${noun} has been settled in whole or part. Undo the settlement first, then ${verb} it.`);
  }

  if (kind === 'BILL' || kind === 'EXPENSE') {
    const notes = await notesAgainst(accountId, orgId, doc.id);
    if (notes.length) throw new SettledDocument(`A debit note is raised against this ${noun}${listed(notes)}. Cancel the note first.`);
  } else {
    // A note that has been applied against invoices or bills is part of their settlement.
    let extras: any = {};
    try {
      extras = JSON.parse(doc.extrasJson || '{}');
    } catch {
      extras = {};
    }
    if (Array.isArray(extras.allocations) && extras.allocations.some((a: any) => num(a?.amount) > 0)) {
      throw new SettledDocument(`This ${noun} has been applied against other documents. Remove those allocations first.`);
    }
  }
}
