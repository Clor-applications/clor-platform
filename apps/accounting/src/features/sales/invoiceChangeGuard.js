/**
 * Why an invoice may not be edited, cancelled or deleted right now, or ''.
 *
 * Shared by the list and the form: the form's own "Cancel invoice" checked
 * the paid amount only, so an invoice with a credit note against it could be
 * cancelled from inside the form while the list refused it.
 */
export const invoiceChangeBlockReason = (db, currentCompany, invoice, verb) => {
  const safeArray = (v) => (Array.isArray(v) ? v : []);
  const paid = Number(invoice?.paidAmount || 0);
  const receipts = safeArray(db.payments).filter(
    (p) =>
      p.companyId === currentCompany.id &&
      ((String(p.voucherType) === 'invoice' && Number(p.voucherId) === Number(invoice?.id)) ||
        safeArray(p.allocations).some((a) => String(a?.voucherType) === 'invoice' && Number(a?.voucherId) === Number(invoice?.id))) &&
      p.status !== 'Reversed'
  );
  const notes = safeArray(db.creditNotes).filter(
    (n) =>
      n.companyId === currentCompany.id &&
      String(n?.status || '').toLowerCase() !== 'cancelled' &&
      (String(n?.originalInvoiceId ?? '') === String(invoice?.id) ||
        safeArray(n?.allocations).some((a) => String(a?.docId ?? a?.voucherId ?? '') === String(invoice?.id)))
  );
  if (receipts.length) {
    return `${invoice?.number || 'This invoice'} has ${receipts.length} receipt(s) against it — reverse ${
      receipts.length === 1 ? 'it' : 'them'
    } from the Receipts list before you ${verb} the invoice.`;
  }
  if (notes.length) {
    return `${invoice?.number || 'This invoice'} has ${notes.length} credit note(s) against it — cancel ${
      notes.length === 1 ? 'it' : 'them'
    } before you ${verb} the invoice.`;
  }
  if (paid > 0.005) {
    return `${invoice?.number || 'This invoice'} carries ₹${paid.toLocaleString('en-IN')} of settlement — undo it before you ${verb} the invoice.`;
  }
  return '';
};
