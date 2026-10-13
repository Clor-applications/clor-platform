/**
 * GSTR-2B reconciliation.
 *
 * GSTR-2B is the auto-drafted ITC statement the GST portal publishes every
 * month: every B2B invoice your suppliers filed against your GSTIN. This
 * module parses the portal's JSON download and matches it against the bills
 * in the books.
 *
 * Match identity: supplier GSTIN + their invoice number (normalised:
 * uppercase, no spaces/leading zeros). Amount agreement within ₹1 counts as
 * matched; a found pair with a bigger gap is an "amount mismatch" — usually a
 * data-entry slip worth fixing before claiming ITC.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const normGstin = (g) => String(g || '').trim().toUpperCase();
/** Invoice numbers arrive in every style — compare them stripped down. */
const normInum = (s) =>
  String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^0+/, '');

/** dd-mm-yyyy (portal) → yyyy-mm-dd; passes through anything else. */
const isoDate = (d) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(d || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(d || '');
};

/**
 * Flatten the portal JSON to rows. Handles the official shape
 * (data.docdata.b2b[].inv[], taxes per-invoice or summed from items) and a
 * few gateway re-wraps.
 */
export function parseGstr2b(json) {
  const root = json?.data || json || {};
  const doc = root.docdata || root.docData || {};
  const b2b = Array.isArray(doc.b2b) ? doc.b2b : Array.isArray(root.b2b) ? root.b2b : [];
  const rows = [];
  for (const supplier of b2b) {
    const ctin = normGstin(supplier.ctin);
    const trdnm = String(supplier.trdnm || supplier.name || '');
    for (const inv of Array.isArray(supplier.inv) ? supplier.inv : []) {
      let txval = num(inv.txval);
      let igst = num(inv.igst);
      let cgst = num(inv.cgst);
      let sgst = num(inv.sgst);
      let cess = num(inv.cess);
      if (!txval && Array.isArray(inv.items)) {
        for (const it of inv.items) {
          txval += num(it.txval);
          igst += num(it.igst);
          cgst += num(it.cgst);
          sgst += num(it.sgst);
          cess += num(it.cess);
        }
      }
      rows.push({
        ctin,
        trdnm,
        inum: String(inv.inum || '').trim(),
        date: isoDate(inv.dt),
        taxable: txval,
        igst,
        cgst,
        sgst,
        cess,
        total: num(inv.val) || txval + igst + cgst + sgst + cess,
        itcAvailable: String(inv.itcavl || 'Y').toUpperCase() !== 'N',
        reason: String(inv.rsn || ''),
      });
    }
  }
  return {
    gstin: normGstin(root.gstin),
    period: String(root.rtnprd || root.ret_period || ''),
    rows,
  };
}

/**
 * Reconcile 2B rows against the company's bills.
 * A bill's supplier invoice number is its refNo; falls back to the bill
 * number for books kept without the vendor's number.
 */
export function reconcileGstr2b(rows, bills) {
  const keyOf = (gstin, inum) => `${normGstin(gstin)}|${normInum(inum)}`;

  const billIndex = new Map();
  for (const b of bills) {
    const st = String(b.status || '').toLowerCase();
    if (st === 'cancelled' || st === 'draft') continue;
    const gstin = normGstin(b.vendorGstin);
    if (!gstin) continue;
    const inum = String(b.refNo || '').trim() || String(b.number || '').trim();
    billIndex.set(keyOf(gstin, inum), b);
  }

  const matched = [];
  const amountMismatch = [];
  const onlyIn2B = [];
  const usedBillKeys = new Set();

  for (const r of rows) {
    const key = keyOf(r.ctin, r.inum);
    const bill = billIndex.get(key);
    if (!bill) {
      onlyIn2B.push(r);
      continue;
    }
    usedBillKeys.add(key);
    const diff = Math.abs(num(bill.total) - num(r.total));
    if (diff <= 1) matched.push({ ...r, bill, diff });
    else amountMismatch.push({ ...r, bill, diff });
  }

  const onlyInBooks = [];
  for (const [key, bill] of billIndex) {
    if (!usedBillKeys.has(key)) onlyInBooks.push(bill);
  }

  const itc = (list) => ({
    igst: list.reduce((s, r) => s + num(r.igst), 0),
    cgst: list.reduce((s, r) => s + num(r.cgst), 0),
    sgst: list.reduce((s, r) => s + num(r.sgst), 0),
  });
  const claimableRows = matched.filter((r) => r.itcAvailable);
  const missingRows = onlyIn2B.filter((r) => r.itcAvailable);

  return {
    matched,
    amountMismatch,
    onlyIn2B,
    onlyInBooks,
    summary: {
      claimable: itc(claimableRows),
      missingFromBooks: itc(missingRows),
      atRiskBills: onlyInBooks.length,
      counts: {
        matched: matched.length,
        amountMismatch: amountMismatch.length,
        onlyIn2B: onlyIn2B.length,
        onlyInBooks: onlyInBooks.length,
      },
    },
  };
}
