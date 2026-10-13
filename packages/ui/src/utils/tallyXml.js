/**
 * Tally XML export — the "give me Tally data" answer for the CA.
 *
 * Two files, imported into Tally (Gateway → Import Data) in this order:
 *   1. Masters.xml  — every ledger the vouchers reference, parented into
 *      Tally's stock groups (Sundry Debtors/Creditors, Sales/Purchase
 *      Accounts, Duties & Taxes, Cash-in-Hand/Bank Accounts).
 *   2. Vouchers.xml — Sales / Purchase / Credit Note / Debit Note /
 *      Receipt / Payment / Journal vouchers for the chosen date range.
 *
 * Tally's sign convention: a DEBIT is a NEGATIVE amount with
 * ISDEEMEDPOSITIVE=Yes; a CREDIT is positive with No. Every voucher's
 * amounts sum to zero — Tally refuses unbalanced imports, which doubles as
 * our own correctness check.
 */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round(num(v) * 100) / 100;
const tallyDate = (iso) => String(iso || '').slice(0, 10).replace(/-/g, '');

const inRange = (date, from, to) => {
  const d = String(date || '').slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
};

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------

const LEDGER = (name, parent, opening = 0) =>
  `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(name)}" ACTION="Create">` +
  `<NAME.LIST><NAME>${esc(name)}</NAME></NAME.LIST>` +
  `<PARENT>${esc(parent)}</PARENT>` +
  (opening ? `<OPENINGBALANCE>${r2(opening)}</OPENINGBALANCE>` : '') +
  `</LEDGER></TALLYMESSAGE>`;

const envelope = (report, inner) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>` +
  `<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>${report}</REPORTNAME>` +
  `<STATICVARIABLES><SVCURRENTCOMPANY></SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>` +
  `<REQUESTDATA>${inner}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

/** Standard books ledgers plus every party — the set the vouchers reference. */
export function buildTallyMastersXml(db, company) {
  const companyId = company.id;
  const msgs = [];

  const staples = [
    ['Sales', 'Sales Accounts'],
    ['Purchases', 'Purchase Accounts'],
    ['Output CGST', 'Duties & Taxes'],
    ['Output SGST', 'Duties & Taxes'],
    ['Output IGST', 'Duties & Taxes'],
    ['Input CGST', 'Duties & Taxes'],
    ['Input SGST', 'Duties & Taxes'],
    ['Input IGST', 'Duties & Taxes'],
    ['Other Charges', 'Indirect Incomes'],
    ['Round Off', 'Indirect Expenses'],
  ];
  for (const [name, parent] of staples) msgs.push(LEDGER(name, parent));

  // Cash/bank ledgers actually used by receipts/payments.
  for (const acc of (db.cashBankAccounts || []).filter((a) => a.companyId === companyId)) {
    const parent = /cash/i.test(String(acc.name || '')) ? 'Cash-in-Hand' : 'Bank Accounts';
    msgs.push(LEDGER(acc.name, parent));
  }
  if (!(db.cashBankAccounts || []).some((a) => a.companyId === companyId)) {
    msgs.push(LEDGER('Cash', 'Cash-in-Hand'));
  }

  for (const c of (db.customers || []).filter((x) => x.companyId === companyId)) {
    const name = c.displayName || c.name;
    if (name) msgs.push(LEDGER(name, 'Sundry Debtors', num(c.openingBalance) * (String(c.openingBalanceType) === 'Cr' ? 1 : -1)));
  }
  for (const v of (db.vendors || []).filter((x) => x.companyId === companyId)) {
    const name = v.displayName || v.name;
    if (name) msgs.push(LEDGER(name, 'Sundry Creditors'));
  }

  // Expense category + journal ledgers referenced by vouchers.
  const jeNames = new Set();
  for (const je of (db.journalEntries || []).filter((x) => x.companyId === companyId)) {
    for (const l of je.lines || []) if (l.accountName) jeNames.add(l.accountName);
  }
  for (const name of jeNames) msgs.push(LEDGER(name, 'Suspense A/c'));

  const cats = new Set(
    (db.expenses || []).filter((x) => x.companyId === companyId).map((x) => String(x.category || 'General Expenses').trim() || 'General Expenses')
  );
  for (const c of cats) msgs.push(LEDGER(c, 'Indirect Expenses'));

  return envelope('All Masters', msgs.join(''));
}

// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------

const ENTRY = (ledger, amount, isDebit) =>
  `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(ledger)}</LEDGERNAME>` +
  `<ISDEEMEDPOSITIVE>${isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>` +
  `<AMOUNT>${isDebit ? -r2(amount) : r2(amount)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;

const VOUCHER = ({ type, date, number, party, narration, entries }) => {
  // Balance check — Tally rejects anything that doesn't foot to zero.
  const sum = r2(entries.reduce((s, e) => s + (e.isDebit ? -num(e.amount) : num(e.amount)), 0));
  const withRounding =
    Math.abs(sum) > 0.004 ? [...entries, { ledger: 'Round Off', amount: Math.abs(sum), isDebit: sum > 0 }] : entries;
  return (
    `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${esc(type)}" ACTION="Create">` +
    `<DATE>${tallyDate(date)}</DATE><EFFECTIVEDATE>${tallyDate(date)}</EFFECTIVEDATE>` +
    `<VOUCHERTYPENAME>${esc(type)}</VOUCHERTYPENAME>` +
    `<VOUCHERNUMBER>${esc(number)}</VOUCHERNUMBER>` +
    (party ? `<PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>` : '') +
    (narration ? `<NARRATION>${esc(narration)}</NARRATION>` : '') +
    withRounding.filter((e) => Math.abs(num(e.amount)) > 0.004).map((e) => ENTRY(e.ledger, e.amount, e.isDebit)).join('') +
    `</VOUCHER></TALLYMESSAGE>`
  );
};

const gstEntries = (doc, dir) => {
  // dir 'out' credits Output GST (sales side); 'in' debits Input GST.
  const isOut = dir === 'out';
  return [
    { ledger: isOut ? 'Output CGST' : 'Input CGST', amount: num(doc.cgstTotal), isDebit: !isOut },
    { ledger: isOut ? 'Output SGST' : 'Input SGST', amount: num(doc.sgstTotal), isDebit: !isOut },
    { ledger: isOut ? 'Output IGST' : 'Input IGST', amount: num(doc.igstTotal), isDebit: !isOut },
  ];
};

export function buildTallyVouchersXml(db, company, { from = '', to = '', types = null } = {}) {
  const companyId = company.id;
  const on = (t) => !types || types.includes(t);
  const notDraft = (d) => {
    const st = String(d.status || '').toLowerCase();
    return st !== 'draft' && st !== 'cancelled';
  };
  const cashName = (id) =>
    (db.cashBankAccounts || []).find((a) => a.companyId === companyId && String(a.id) === String(id))?.name || 'Cash';

  const msgs = [];
  let counts = { Sales: 0, Purchase: 0, 'Credit Note': 0, 'Debit Note': 0, Receipt: 0, Payment: 0, Journal: 0 };

  if (on('Sales')) {
    for (const inv of (db.invoices || []).filter((d) => d.companyId === companyId && notDraft(d) && inRange(d.date, from, to))) {
      counts.Sales += 1;
      msgs.push(
        VOUCHER({
          type: 'Sales',
          date: inv.date,
          number: inv.number,
          party: inv.customerName,
          narration: `Invoice ${inv.number}`,
          entries: [
            { ledger: inv.customerName, amount: num(inv.total), isDebit: true },
            { ledger: 'Sales', amount: num(inv.subtotal), isDebit: false },
            ...(num(inv.otherChargesTotal) ? [{ ledger: 'Other Charges', amount: num(inv.otherChargesTotal), isDebit: false }] : []),
            ...gstEntries(inv, 'out'),
          ],
        })
      );
    }
  }

  if (on('Purchase')) {
    for (const bill of (db.bills || []).filter((d) => d.companyId === companyId && notDraft(d) && inRange(d.date, from, to))) {
      counts.Purchase += 1;
      msgs.push(
        VOUCHER({
          type: 'Purchase',
          date: bill.date,
          number: bill.number,
          party: bill.vendorName,
          narration: `Bill ${bill.number}${bill.refNo ? ` / ${bill.refNo}` : ''}`,
          entries: [
            { ledger: bill.vendorName, amount: num(bill.total), isDebit: false },
            { ledger: 'Purchases', amount: num(bill.subtotal), isDebit: true },
            ...gstEntries(bill, 'in').map((e) => ({ ...e, isDebit: true })),
          ],
        })
      );
    }
  }

  if (on('Credit Note')) {
    for (const cn of (db.creditNotes || []).filter((d) => d.companyId === companyId && inRange(d.date, from, to))) {
      counts['Credit Note'] += 1;
      msgs.push(
        VOUCHER({
          type: 'Credit Note',
          date: cn.date,
          number: cn.number,
          party: cn.customerName,
          narration: `Against ${cn.originalInvoiceNumber || ''}`,
          entries: [
            { ledger: 'Sales', amount: num(cn.subtotal), isDebit: true },
            ...gstEntries(cn, 'out').map((e) => ({ ...e, isDebit: true })),
            { ledger: cn.customerName, amount: num(cn.total), isDebit: false },
          ],
        })
      );
    }
  }

  if (on('Debit Note')) {
    for (const dn of (db.debitNotes || []).filter((d) => d.companyId === companyId && inRange(d.date, from, to))) {
      counts['Debit Note'] += 1;
      msgs.push(
        VOUCHER({
          type: 'Debit Note',
          date: dn.date,
          number: dn.number,
          party: dn.vendorName,
          narration: `Against ${dn.originalBillNumber || ''}`,
          entries: [
            { ledger: dn.vendorName, amount: num(dn.total), isDebit: true },
            { ledger: 'Purchases', amount: num(dn.subtotal), isDebit: false },
            ...gstEntries(dn, 'in'),
          ],
        })
      );
    }
  }

  const pays = (db.payments || []).filter((p) => p.companyId === companyId && inRange(p.date, from, to));
  if (on('Receipt')) {
    for (const rc of pays.filter((p) => p.voucherType === 'receipt')) {
      counts.Receipt += 1;
      msgs.push(
        VOUCHER({
          type: 'Receipt',
          date: rc.date,
          number: rc.receiptNo || `RCPT-${rc.id}`,
          party: rc.customerName,
          narration: rc.notes || '',
          entries: [
            { ledger: cashName(rc.cashBankAccountId), amount: num(rc.amount), isDebit: true },
            { ledger: rc.customerName || 'Suspense A/c', amount: num(rc.amount), isDebit: false },
          ],
        })
      );
    }
  }
  if (on('Payment')) {
    for (const py of pays.filter((p) => p.voucherType === 'payment')) {
      counts.Payment += 1;
      msgs.push(
        VOUCHER({
          type: 'Payment',
          date: py.date,
          number: py.paymentNo || `PAY-${py.id}`,
          party: py.vendorName,
          narration: py.notes || '',
          entries: [
            { ledger: py.vendorName || 'Suspense A/c', amount: num(py.amount), isDebit: true },
            { ledger: cashName(py.cashBankAccountId), amount: num(py.amount), isDebit: false },
          ],
        })
      );
    }
  }

  if (on('Journal')) {
    for (const je of (db.journalEntries || []).filter((d) => d.companyId === companyId && inRange(d.date, from, to))) {
      counts.Journal += 1;
      msgs.push(
        VOUCHER({
          type: 'Journal',
          date: je.date,
          number: je.number || `JE-${je.id}`,
          party: '',
          narration: je.narration || '',
          entries: (je.lines || []).map((l) => ({
            ledger: l.accountName || 'Suspense A/c',
            amount: num(l.debit) > 0 ? num(l.debit) : num(l.credit),
            isDebit: num(l.debit) > 0,
          })),
        })
      );
    }
  }

  return { xml: envelope('Vouchers', msgs.join('')), counts };
}
