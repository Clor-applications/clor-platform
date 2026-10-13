import { Prisma } from '@prisma/client';

import { prisma } from '../utils/prisma.js';
import { livePostingsFor } from './postingState.js';
import { validAllocatedPaise } from './settlement.js';

/**
 * What may still be changed on an invoice that is already in the books.
 *
 * An invoice posted at 118,000 and then edited to 40,000 left the document at
 * 40,000 and the ledger at 118,000 — no reversal, no adjustment, and nothing
 * anywhere that said the two disagreed. The edit route never posted, so the
 * books simply kept the first answer.
 *
 * The rule now is the one the rest of the product already follows. Bills,
 * credit notes, debit notes, expenses, payments and journal entries have no
 * edit route at all; the delete route already refuses to destroy an issued
 * invoice, citing the serial number a return has seen. So an invoice that has
 * reached the books stops being financially editable too, and an amendment
 * goes through cancellation or a credit note — the paths that already reverse
 * correctly.
 *
 * What stays editable is everything that never reached the ledger: notes,
 * terms, the address it ships to, the reference it quotes, when it falls due.
 * Those change the document, not the accounting.
 *
 * Deliberately NOT reverse-and-repost. That needs the posting engine to accept
 * a caller's transaction, which it does not, and it would mean writing
 * client-supplied totals into the ledger a second time while the server still
 * computes none of its own. Both are separate pieces of work.
 */

const paise = (v: Prisma.Decimal | number | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

const text = (v: unknown) => String(v ?? '').trim();

export class MutationBlocked extends Error {
  status = 409;
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'MutationBlocked';
    this.field = field;
  }
}

/**
 * The line economics that decide what an invoice is worth.
 *
 * Compared semantically rather than as JSON text: a client that re-sends the
 * same lines with keys in a different order, or numbers as strings, has not
 * changed the invoice and must not be refused for it. Presentation-only keys
 * (description, HSN) are not part of this — they do not move money.
 *
 * The server does not yet derive totals from these lines; it stores the totals
 * the client sends. Protecting the lines anyway is what stops a later change
 * of that (audit P0-3) from discovering that line economics had been edited
 * underneath a ledger that never moved.
 */
const lineEconomics = (raw: unknown) => {
  const items = Array.isArray(raw) ? raw : [];
  return items.map((l: any) => [
    text(l?.itemId),
    text(l?.name ?? l?.description),
    paise(l?.quantity ?? 0),
    paise(l?.rate ?? 0),
    paise(l?.discountAmount ?? 0),
    paise(l?.discountPct ?? 0),
    paise(l?.gstRate ?? 0),
    paise(l?.amount ?? l?.taxableAmount ?? 0),
  ]);
};

const sameEconomics = (a: unknown, b: unknown) => JSON.stringify(lineEconomics(a)) === JSON.stringify(lineEconomics(b));

export type InvoiceRow = {
  id: string;
  accountId: string;
  orgId: string;
  branchId: string;
  number: string;
  date: string;
  customerId: string | null;
  customerName: string;
  customerGstin: string | null;
  placeOfSupplyState: string | null;
  taxType: string | null;
  reverseCharge: boolean;
  warehouseId: string | null;
  subtotal: Prisma.Decimal;
  cgstTotal: Prisma.Decimal;
  sgstTotal: Prisma.Decimal;
  igstTotal: Prisma.Decimal;
  total: Prisma.Decimal;
  status: string;
  itemsJson: string;
};

/**
 * Decide whether a requested edit may proceed.
 *
 * `sent` is the set of keys the caller actually supplied, so an omitted field
 * is never compared and never treated as a change — that is what keeps this a
 * PATCH. A supplied field that matches what is stored is not a change either:
 * re-sending an invoice unaltered is not an amendment.
 *
 * Throws `MutationBlocked` with the field that caused it. Nothing is written.
 */
export async function assertInvoiceMutationAllowed(opts: {
  existing: InvoiceRow;
  body: Record<string, any>;
  sent: Set<string>;
}): Promise<{ live: boolean; changedFinancialFields: string[] }> {
  const { existing, body, sent } = opts;
  const accountId = existing.accountId;
  const orgId = existing.orgId;

  const supplied = (key: string) => sent.has(key) && body[key] !== undefined;

  /* Branch is immutable, posted or not: a journal entry belongs to one
     branch's hash chain, and moving a document between chains is not a thing
     this product can express. Re-sending the same branch is fine. */
  if (supplied('branchId') && text(body.branchId) && text(body.branchId) !== text(existing.branchId)) {
    throw new MutationBlocked('branchId', 'An invoice cannot be moved to another branch.');
  }

  /* Lifecycle transitions belong to the status route, because that is the
     route that reverses the posting. Allowing one here would cancel the
     document in the list and leave its posting live in the books. */
  if (supplied('status') && text(body.status) && text(body.status) !== text(existing.status)) {
    throw new MutationBlocked(
      'status',
      `Use the cancel action to change an invoice from ${existing.status} to ${text(body.status)}.`
    );
  }

  const financial: Array<[string, () => boolean]> = [
    ['subtotal', () => paise(body.subtotal) !== paise(existing.subtotal)],
    ['cgstTotal', () => paise(body.cgstTotal) !== paise(existing.cgstTotal)],
    ['sgstTotal', () => paise(body.sgstTotal) !== paise(existing.sgstTotal)],
    ['igstTotal', () => paise(body.igstTotal) !== paise(existing.igstTotal)],
    ['total', () => paise(body.total) !== paise(existing.total)],
    ['customerId', () => text(body.customerId) !== text(existing.customerId)],
    ['date', () => text(body.date) !== text(existing.date)],
    ['number', () => text(body.number) !== text(existing.number)],
    ['items', () => !sameEconomics(body.items, JSON.parse(existing.itemsJson || '[]'))],
    /*
     * The customer's name is narrative on a posting — the AR line is owned by
     * `customerId`. Except when there is no customerId: a walk-in billed by
     * name alone has nothing else identifying them, and then the name IS the
     * counterparty. Protected in that case, free to be corrected otherwise.
     */
    ['customerName', () => !text(existing.customerId) && text(body.customerName) !== text(existing.customerName)],

    /*
     * How the supply was taxed, and to whom it was attributed.
     *
     * The GSTIN is not a printed decoration. It is the counterparty's CTIN in
     * GSTR-1, and whether it is present is what sorts the invoice into B2B or
     * B2C (`gstrExport.js`); it becomes `BuyerDtls.Gstin` and decides `SupTyp`
     * in the INV-01 payload, and `toGstin` on the e-way bill
     * (`utils/einvoice.js`). An invoice that has been registered keeps the
     * signed payload it was registered with, so editing the GSTIN afterwards
     * would leave the document disagreeing with its own IRN.
     *
     * Place of supply and tax type decide CGST+SGST against IGST — the tax
     * accounts already credited. Reverse charge decides who pays the tax at
     * all. None of them may drift from the entry that was posted.
     *
     * The warehouse is inventory attribution. Server stock authority is still
     * unresolved (audit P0-5), so re-attributing a posted sale to another
     * warehouse would add a second document-versus-stock inconsistency on top
     * of the one that already exists.
     */
    ['customerGstin', () => text(body.customerGstin) !== text(existing.customerGstin)],
    ['placeOfSupplyState', () => text(body.placeOfSupplyState) !== text(existing.placeOfSupplyState)],
    ['taxType', () => text(body.taxType) !== text(existing.taxType)],
    ['reverseCharge', () => Boolean(body.reverseCharge) !== Boolean(existing.reverseCharge)],
    ['warehouseId', () => text(body.warehouseId) !== text(existing.warehouseId)],
  ];

  const changedFinancialFields = financial.filter(([key, changed]) => supplied(key) && changed()).map(([key]) => key);

  const live = (
    await livePostingsFor(prisma, { accountId, orgId, sourceDocType: 'INVOICE', sourceDocId: existing.id })
  ).length > 0;

  if (live && changedFinancialFields.length) {
    throw new MutationBlocked(
      changedFinancialFields[0],
      'This invoice has been issued and its amounts can no longer be edited. ' +
        'Cancel it and raise a new one, or issue a credit note against it.'
    );
  }

  /*
   * An invoice may not be reduced below what has already been received
   * against it. There is nowhere for the difference to go: receipts have no
   * customer-credit document to absorb it, and clamping outstanding at zero
   * would report a 40,000 invoice as fully paid by 50,000.
   *
   * Checked even when nothing has been posted, because a receipt can be
   * allocated to an invoice that is still a draft.
   */
  if (supplied('total') && paise(body.total) !== paise(existing.total)) {
    const allocated = await validAllocatedPaise(prisma, {
      accountId,
      orgId,
      docType: 'INVOICE',
      docId: existing.id,
    });
    if (paise(body.total) < allocated) {
      throw new MutationBlocked(
        'total',
        `This invoice has ${(allocated / 100).toFixed(2)} received against it and cannot be reduced below that. ` +
          'Reverse the receipt first.'
      );
    }
  }

  return { live, changedFinancialFields };
}
