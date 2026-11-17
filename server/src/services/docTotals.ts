/**
 * Do a document's totals agree with its own lines?
 *
 * The browser works out a document's taxable value, tax and total and sends
 * them; the server used to store and post whatever arrived (audit, 17 Nov
 * 2026). A browser with a fault, or anything else that can reach the API,
 * could save an invoice whose total is not the sum of its lines, or whose tax
 * is not its rate, and the ledger and the GST returns took the figures as
 * given.
 *
 * The owner's rule (17 Nov 2026): refuse a mismatch; never quietly change what
 * somebody typed. So this checks and says what disagrees. It does not redo the
 * form's arithmetic for discounts, which the lines already carry: a line's
 * taxable value may be less than quantity × rate (a discount), never more.
 *
 * What is checked, in rupees and paise:
 *   - no amount is negative;
 *   - each line: taxable value ≤ quantity × rate, and its tax = taxable × rate %;
 *   - each other charge likewise;
 *   - taxable total = the lines' taxable values;
 *   - tax total = the lines' and charges' tax;
 *   - CGST + SGST + IGST = tax total, CGST = SGST, and never IGST with CGST;
 *   - total = taxable total + other charges + tax.
 *
 * Rounding: the form rounds each line to the paisa and halves tax per line, so
 * a sum may sit a paisa a line away from the total. That much is allowed and
 * no more.
 */

export type TotalsProblem = { field: string; sent: number; worked: number; message: string };

type Line = { quantity?: unknown; rate?: unknown; gstRate?: unknown; taxableAmount?: unknown; gstAmount?: unknown; cgstAmount?: unknown; sgstAmount?: unknown; igstAmount?: unknown };
type Charge = { label?: unknown; amount?: unknown; gstRate?: unknown; taxableAmount?: unknown; gstAmount?: unknown };

export type TotalsInput = {
  items?: Line[] | null;
  otherCharges?: Charge[] | null;
  otherChargesTotal?: unknown;
  invoiceDiscountApplied?: unknown;
  subtotal?: unknown;
  cgstTotal?: unknown;
  sgstTotal?: unknown;
  igstTotal?: unknown;
  gstTotal?: unknown;
  total?: unknown;
};

const paise = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const given = (v: unknown) => v !== undefined && v !== null && v !== '';
const rupees = (p: number) => p / 100;
const words = (p: number) => `₹${rupees(p).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const problem = (field: string, sent: number, worked: number, message: string): TotalsProblem => ({ field, sent: rupees(sent), worked: rupees(worked), message });

/** The first thing that does not add up, or null when the document agrees with itself. */
export function checkDocTotals(doc: TotalsInput): TotalsProblem | null {
  const items = Array.isArray(doc.items) ? doc.items : [];
  const charges = (Array.isArray(doc.otherCharges) ? doc.otherCharges : []).filter((c) => paise(c?.taxableAmount ?? c?.amount) > 0);

  const head = { subtotal: paise(doc.subtotal), cgstTotal: paise(doc.cgstTotal), sgstTotal: paise(doc.sgstTotal), igstTotal: paise(doc.igstTotal), gstTotal: paise(doc.gstTotal), total: paise(doc.total) };
  const NAMES: Record<string, string> = { subtotal: 'The taxable total', cgstTotal: 'CGST', sgstTotal: 'SGST', igstTotal: 'IGST', gstTotal: 'The tax total', total: 'The total' };
  for (const [k, v] of Object.entries(head)) {
    if (Number.isNaN(v)) return problem(k, 0, 0, `${NAMES[k]} is not a number.`);
    if (v < 0) return problem(k, v, 0, `${NAMES[k]} cannot be less than zero.`);
  }

  /* ---- Each line, and each other charge. ---- */
  let lineTaxable = 0;
  let lineGross = 0;
  let tax = 0;
  let statedTaxable = false;
  for (const [i, l] of items.entries()) {
    const n = i + 1;
    const qty = Number(l?.quantity ?? 1);
    const rate = Number(l?.rate ?? 0);
    const gstRate = Number(l?.gstRate ?? 0);
    if (![qty, rate, gstRate].every(Number.isFinite)) return problem(`items.${i}`, 0, 0, `Line ${n} has a quantity, rate or GST rate that is not a number.`);
    if (gstRate < 0 || gstRate > 100) return problem(`items.${i}.gstRate`, paise(gstRate), 0, `Line ${n} has a GST rate of ${gstRate}%.`);
    const gross = Math.round(qty * rate * 100);
    const taxable = given(l?.taxableAmount) ? paise(l.taxableAmount) : gross;
    if (Number.isNaN(taxable) || taxable < 0) return problem(`items.${i}.taxableAmount`, 0, 0, `Line ${n} has a taxable value that is not an amount.`);
    if (given(l?.taxableAmount)) statedTaxable = true;
    /* A discount takes the taxable value below quantity × rate; nothing takes it above. */
    if (gross >= 0 && taxable > gross + 1) return problem(`items.${i}.taxableAmount`, taxable, gross, `Line ${n}: the taxable value ${words(taxable)} is more than quantity × rate, ${words(gross)}.`);
    const due = Math.round((taxable * gstRate) / 100);
    const stated = given(l?.gstAmount) ? paise(l.gstAmount) : due;
    if (Number.isNaN(stated) || Math.abs(stated - due) > 2) return problem(`items.${i}.gstAmount`, stated, due, `Line ${n}: GST at ${gstRate}% on ${words(taxable)} is ${words(due)}, not ${words(stated)}.`);
    lineTaxable += taxable;
    lineGross += gross;
    tax += stated;
  }
  let chargeTaxable = 0;
  for (const [i, c] of charges.entries()) {
    const label = String(c?.label || 'Other charges');
    const gstRate = Number(c?.gstRate ?? 0);
    const taxable = paise(c?.taxableAmount ?? c?.amount);
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100 || Number.isNaN(taxable)) return problem(`otherCharges.${i}`, 0, 0, `${label} has an amount or GST rate that is not a number.`);
    const due = Math.round((taxable * gstRate) / 100);
    const stated = given(c?.gstAmount) ? paise(c.gstAmount) : due;
    if (Number.isNaN(stated) || Math.abs(stated - due) > 2) return problem(`otherCharges.${i}.gstAmount`, stated, due, `${label}: GST at ${gstRate}% on ${words(taxable)} is ${words(due)}, not ${words(stated)}.`);
    chargeTaxable += taxable;
    tax += stated;
  }
  if (given(doc.otherChargesTotal) && charges.length) {
    const sent = paise(doc.otherChargesTotal);
    if (Number.isNaN(sent) || Math.abs(sent - chargeTaxable) > charges.length) return problem('otherChargesTotal', sent, chargeTaxable, `Other charges add up to ${words(chargeTaxable)}, not ${words(sent)}.`);
  }
  /* Charges named only by their total (no rows sent): taken as stated. */
  if (!charges.length && given(doc.otherChargesTotal)) {
    const sent = paise(doc.otherChargesTotal);
    if (Number.isNaN(sent) || sent < 0) return problem('otherChargesTotal', 0, 0, 'Other charges are not an amount.');
    chargeTaxable = sent;
  }

  /* One paisa a row for rounding, and one for the total itself. */
  const slack = items.length + charges.length + 1;

  /* ---- The totals against the lines. A document with no lines has only its own totals to agree with. ---- */
  if (items.length) {
    /* Lines that state no taxable value are at quantity × rate; a discount on the whole document then comes off the total of them. */
    const discount = !statedTaxable && given(doc.invoiceDiscountApplied) ? Math.max(0, paise(doc.invoiceDiscountApplied) || 0) : 0;
    const worked = lineTaxable - Math.min(discount, lineTaxable);
    if (Math.abs(head.subtotal - worked) > slack) return problem('subtotal', head.subtotal, worked, `The lines add up to a taxable value of ${words(worked)}, not ${words(head.subtotal)}.`);
    /* Tax on lines discounted as a whole cannot be read off the lines; the split below still has to add up. */
    if (!discount && Math.abs(head.gstTotal - tax) > slack) return problem('gstTotal', head.gstTotal, tax, `GST on the lines comes to ${words(tax)}, not ${words(head.gstTotal)}.`);
  }

  /* ---- CGST + SGST or IGST. ---- */
  const split = head.cgstTotal + head.sgstTotal + head.igstTotal;
  if (head.gstTotal > 0 || split > 0) {
    if (Math.abs(split - head.gstTotal) > 1) return problem('gstTotal', head.gstTotal, split, `CGST, SGST and IGST add up to ${words(split)}, not the tax total ${words(head.gstTotal)}.`);
    if (head.igstTotal > 0 && (head.cgstTotal > 0 || head.sgstTotal > 0)) return problem('igstTotal', head.igstTotal, 0, 'A document carries either CGST and SGST, or IGST, never both.');
    if (Math.abs(head.cgstTotal - head.sgstTotal) > slack) return problem('sgstTotal', head.sgstTotal, head.cgstTotal, `CGST ${words(head.cgstTotal)} and SGST ${words(head.sgstTotal)} must be equal.`);
  }

  /* ---- The total. ---- */
  const total = head.subtotal + chargeTaxable + head.gstTotal;
  if (Math.abs(head.total - total) > 2) return problem('total', head.total, total, `Taxable value, other charges and GST add up to ${words(total)}, not ${words(head.total)}.`);

  return null;
}

export const TOTALS_MISMATCH = 'TOTALS_MISMATCH';
/** The 422 a route answers with. */
export const totalsRefusal = (p: TotalsProblem) => ({ error: `Not saved: the figures do not add up. ${p.message}`, code: TOTALS_MISMATCH, field: p.field, sent: p.sent, worked: p.worked });
