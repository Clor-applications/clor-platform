import { returnQuarter } from './engine';
import { natureByCode } from './ruleMaster';

/**
 * What the TDS register answers.
 *
 * Every figure here is read from the normalized TDS events — the compliance
 * records written beside the bill, the payment and the receipt — and never
 * recomputed from a document. That is the point of having written them: a
 * report that re-derived the tax from today's rules would disagree with the
 * challan already paid against last quarter's.
 *
 * These are plain functions over rows so that the screens, the exceptions list
 * and the quarter validation all read the same numbers.
 */

const safeArray = (v) => (Array.isArray(v) ? v : []);
const day = (v) => String(v || '').slice(0, 10);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const lower = (s) => String(s || '').trim().toLowerCase();

/** A posted event is one that counts; draft and reversed ones do not. */
export const isLive = (e) => lower(e?.status) === 'posted';

/**
 * The events in scope, newest first.
 *
 * Filters are all optional and all narrow: a report of everything is the same
 * call with nothing passed.
 */
export const tdsEvents = (db, companyId, filter = {}) => {
  const cid = Number(companyId);
  const { from = '', to = '', partyId = '', natureCode = '', side = '', quarter = '', status = '', branchId = '', ledgerId = '' } = filter;
  return safeArray(db?.tdsTransactions)
    .filter((e) => Number(e?.companyId) === cid)
    .filter((e) => (status ? lower(e.status) === lower(status) : true))
    .filter((e) => (side ? String(e.side || '').toUpperCase() === String(side).toUpperCase() : true))
    .filter((e) => (partyId === '' || partyId === null ? true : String(e.partyId) === String(partyId)))
    .filter((e) => (natureCode ? String(e.natureCode || '') === String(natureCode) : true))
    .filter((e) => (branchId ? String(e.branchId || '') === String(branchId) : true))
    .filter((e) => (ledgerId ? String(e.ledgerId || '') === String(ledgerId) : true))
    .filter((e) => (quarter ? String(e.returnQuarter || '') === String(quarter) : true))
    .filter((e) => (from ? day(e.transactionDate) >= day(from) : true))
    .filter((e) => (to ? day(e.transactionDate) <= day(to) : true))
    .slice()
    .sort((a, b) => {
      const da = day(a.transactionDate);
      const dbb = day(b.transactionDate);
      if (da !== dbb) return da < dbb ? 1 : -1;
      return Number(b.id || 0) - Number(a.id || 0);
    });
};

/** Deducted, paid against challans, and what is still owed. */
export const payableSummary = (db, companyId, filter = {}) => {
  const rows = tdsEvents(db, companyId, { ...filter, side: 'PAYABLE' }).filter(isLive);
  const deducted = r2(rows.reduce((t, e) => t + Number(e.tdsAmount || 0), 0));
  const allocated = r2(allocationsByEvent(db, companyId).totalFor(rows.map((e) => e.id)));
  return { deducted, allocated, outstanding: r2(deducted - allocated), count: rows.length };
};

/** What customers have withheld and are expected to deposit against our PAN. */
export const receivableSummary = (db, companyId, filter = {}) => {
  const rows = tdsEvents(db, companyId, { ...filter, side: 'RECEIVABLE' }).filter(isLive);
  return {
    deducted: r2(rows.reduce((t, e) => t + Number(e.tdsAmount || 0), 0)),
    count: rows.length,
  };
};

/**
 * Challan allocations, indexed by the event they were allocated to.
 *
 * A challan pays several deductions and a deduction may be met by more than
 * one challan, so the link is its own row rather than a field on either side.
 */
export const allocationsByEvent = (db, companyId) => {
  const cid = Number(companyId);
  const byEvent = new Map();
  for (const a of safeArray(db?.tdsChallanAllocations)) {
    if (Number(a?.companyId) !== cid) continue;
    const key = String(a.tdsTransactionId);
    byEvent.set(key, r2((byEvent.get(key) || 0) + Number(a.amount || 0)));
  }
  return {
    for: (eventId) => byEvent.get(String(eventId)) || 0,
    totalFor: (eventIds) => r2(safeArray(eventIds).reduce((t, id) => t + (byEvent.get(String(id)) || 0), 0)),
  };
};

/**
 * When a deduction must reach the department: the 7th of the following
 * month — except March, whose deposits get until 30 April.
 */
export const tdsDueDate = (transactionDate) => {
  const d = day(transactionDate);
  if (!d) return '';
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  if (m === 3) return `${y}-04-30`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-07`;
};

/**
 * What is due and what is late, as of a date. A deduction counts here only
 * for the part no challan has met — derived from the events and the
 * allocation links, never from a kept balance.
 */
export const dueSummary = (db, companyId, asOf) => {
  const today = day(asOf) || day(new Date().toISOString());
  const rows = tdsEvents(db, companyId, { side: 'PAYABLE' }).filter(isLive);
  const paid = allocationsByEvent(db, companyId);
  let due = 0;
  let overdue = 0;
  let overdueCount = 0;
  for (const e of rows) {
    const open = r2(Number(e.tdsAmount || 0) - paid.for(e.id));
    if (open <= 0.005) continue;
    due = r2(due + open);
    if (tdsDueDate(e.transactionDate) < today) {
      overdue = r2(overdue + open);
      overdueCount += 1;
    }
  }
  return { due, overdue, overdueCount };
};

/** One row per party: what was deducted from them, and under what. */
export const partyWise = (db, companyId, filter = {}) => {
  const rows = tdsEvents(db, companyId, filter).filter(isLive);
  const by = new Map();
  for (const e of rows) {
    const key = `${e.side}:${e.partyId}`;
    const at = by.get(key) || {
      partyId: e.partyId,
      partyName: e.partyName || '',
      pan: e.panSnapshot || '',
      side: e.side,
      tdsAmount: 0,
      baseAmount: 0,
      count: 0,
    };
    at.tdsAmount = r2(at.tdsAmount + Number(e.tdsAmount || 0));
    at.baseAmount = r2(at.baseAmount + Number(e.baseAmount || 0));
    at.count += 1;
    by.set(key, at);
  }
  return [...by.values()].sort((a, b) => b.tdsAmount - a.tdsAmount);
};

/** One row per nature, with the statutory reference those deductions carried. */
export const natureWise = (db, companyId, filter = {}) => {
  const rows = tdsEvents(db, companyId, filter).filter(isLive);
  const by = new Map();
  for (const e of rows) {
    const key = `${e.side}:${e.natureCode}`;
    const at = by.get(key) || {
      natureCode: e.natureCode,
      natureName: natureByCode(e.natureCode)?.name || e.natureCode,
      /* The reference the events themselves carried — not today's. A quarter
         either side of April 2026 legitimately shows both. */
      references: new Set(),
      side: e.side,
      tdsAmount: 0,
      baseAmount: 0,
      count: 0,
    };
    if (e.sectionReference) at.references.add(String(e.sectionReference));
    at.tdsAmount = r2(at.tdsAmount + Number(e.tdsAmount || 0));
    at.baseAmount = r2(at.baseAmount + Number(e.baseAmount || 0));
    at.count += 1;
    by.set(key, at);
  }
  return [...by.values()]
    .map((r) => ({ ...r, references: [...r.references].sort() }))
    .sort((a, b) => b.tdsAmount - a.tdsAmount);
};

/** Deducted by month, for the period bar on the dashboard. */
/** One row per month, both sides — derived from the events, like everything. */
export const monthWise = (db, companyId, filter = {}) => {
  const rows = tdsEvents(db, companyId, filter).filter(isLive);
  const by = new Map();
  for (const e of rows) {
    const key = `${String(e.transactionDate || '').slice(0, 7)}:${e.side}`;
    const at = by.get(key) || {
      month: String(e.transactionDate || '').slice(0, 7),
      side: e.side,
      baseAmount: 0,
      tdsAmount: 0,
      count: 0,
    };
    at.baseAmount = r2(at.baseAmount + Number(e.baseAmount || 0));
    at.tdsAmount = r2(at.tdsAmount + Number(e.tdsAmount || 0));
    at.count += 1;
    by.set(key, at);
  }
  return [...by.values()].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.side.localeCompare(b.side)));
};

export const quarterWise = (db, companyId, filter = {}) => {
  const rows = tdsEvents(db, companyId, filter).filter(isLive);
  const by = new Map();
  for (const e of rows) {
    const key = String(e.returnQuarter || returnQuarter(e.transactionDate));
    if (!key) continue;
    const at = by.get(key) || { quarter: key, tdsAmount: 0, count: 0 };
    at.tdsAmount = r2(at.tdsAmount + Number(e.tdsAmount || 0));
    at.count += 1;
    by.set(key, at);
  }
  return [...by.values()].sort((a, b) => (a.quarter < b.quarter ? -1 : 1));
};

/** Challans, with what has been allocated off each one. */
export const challanRegister = (db, companyId, filter = {}) => {
  const cid = Number(companyId);
  const { from = '', to = '' } = filter;
  const allocated = new Map();
  for (const a of safeArray(db?.tdsChallanAllocations)) {
    if (Number(a?.companyId) !== cid) continue;
    const key = String(a.challanId);
    allocated.set(key, r2((allocated.get(key) || 0) + Number(a.amount || 0)));
  }
  return safeArray(db?.tdsChallans)
    .filter((c) => Number(c?.companyId) === cid)
    .filter((c) => (from ? day(c.paymentDate) >= day(from) : true))
    .filter((c) => (to ? day(c.paymentDate) <= day(to) : true))
    .map((c) => {
      const total = r2(
        Number(c.taxAmount || 0) + Number(c.interest || 0) + Number(c.lateFee || 0) + Number(c.otherAmount || 0)
      );
      const used = allocated.get(String(c.id)) || 0;
      /*
       * The full ladder, decided from the figures rather than typed by hand —
       * a status somebody can set independently of the facts is a status
       * that can lie. Unpaid: created, no payment date yet. Paid: money went
       * to the department, nothing allocated. Partially / Fully allocated:
       * the tax component covered. Mismatch: allocated past it. Reconciled:
       * fully allocated AND a person confirmed it against the bank / 26Q.
       */
      const tax = Number(c.taxAmount || 0);
      const status = !String(c.paymentDate || '').trim()
        ? 'Unpaid'
        : used > tax + 0.005
          ? 'Mismatch'
          : used >= tax - 0.005 && tax > 0
            ? c.reconciled === true
              ? 'Reconciled'
              : 'Fully allocated'
            : used > 0.005
              ? 'Partially allocated'
              : 'Paid';
      return {
        ...c,
        totalAmount: total,
        allocated: used,
        unallocated: r2(total - used),
        status,
      };
    })
    .sort((a, b) => (day(a.paymentDate) < day(b.paymentDate) ? 1 : -1));
};

/**
 * What would stop a quarter being filed.
 *
 * §22's severities: a BLOCK cannot be filed around, a WARNING can be filed
 * with and explained, an INFO is a note. Each row names the event so the list
 * is a worklist rather than a verdict.
 */
export const tdsExceptions = (db, companyId, filter = {}) => {
  const rows = tdsEvents(db, companyId, filter);
  const allocations = allocationsByEvent(db, companyId);
  const out = [];

  for (const e of rows) {
    if (!isLive(e)) continue;
    if (!String(e.panSnapshot || '').trim()) {
      out.push({
        severity: 'WARNING',
        code: 'PAN_MISSING',
        eventId: e.id,
        party: e.partyName,
        message: 'No PAN was on file when this was deducted — the return cannot be filed without one.',
      });
    }
    if (!String(e.ledgerId || '').trim()) {
      out.push({
        severity: 'BLOCK',
        code: 'NO_LEDGER',
        eventId: e.id,
        party: e.partyName,
        message: 'This deduction has no ledger — it is not in the books anywhere.',
      });
    }
    if (!String(e.ruleVersionId || '').trim() && String(e.side).toUpperCase() === 'PAYABLE') {
      out.push({
        severity: 'BLOCK',
        code: 'NO_RULE',
        eventId: e.id,
        party: e.partyName,
        message: 'No rule version was recorded, so the section it was deducted under cannot be proved.',
      });
    }
    /* The stored figures must reconcile with each other: the amount IS the
       rate on the base, to the paisa-and-a-bit a rounding step allows. A row
       where they disagree was corrupted somewhere and cannot be proved. */
    {
      const expected = r2((Number(e.baseAmount || 0) * Number(e.rate || 0)) / 100);
      if (Number(e.rate || 0) > 0 && Math.abs(Number(e.tdsAmount || 0) - expected) > 0.02) {
        out.push({
          severity: 'BLOCK',
          code: 'CALC_MISMATCH',
          eventId: e.id,
          party: e.partyName,
          message: `The recorded deduction (${e.tdsAmount}) does not reconcile with ${e.rate}% on ${e.baseAmount}.`,
        });
      }
    }
    if (String(e.side).toUpperCase() === 'PAYABLE') {
      const paid = allocations.for(e.id);
      if (paid < Number(e.tdsAmount || 0) - 0.005) {
        out.push({
          severity: paid <= 0 ? 'WARNING' : 'INFO',
          code: 'CHALLAN_SHORT',
          eventId: e.id,
          party: e.partyName,
          message:
            paid <= 0
              ? 'Deducted but not yet paid to the department.'
              : 'Only part of this deduction has been allocated to a challan.',
        });
      }
    }
  }

  /* Two events for one obligation is the one thing the engine exists to stop,
     so it is checked again here — against what was actually written. */
  const seen = new Map();
  /* Oldest first, so the one flagged is the one written second — the first is
     the deduction the challan and the return already know about. */
  const byAge = rows.filter(isLive).slice().sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  for (const e of byAge) {
    const key = `${e.sourceType}:${e.sourceId}:${e.natureCode}`;
    if (seen.has(key)) {
      out.push({
        severity: 'BLOCK',
        code: 'DUPLICATE',
        eventId: e.id,
        party: e.partyName,
        message: `The same obligation was deducted twice (also event ${seen.get(key)}).`,
      });
    } else {
      seen.set(key, e.id);
    }
  }

  /*
   * Expected customer TDS that never arrived: the invoice said the customer
   * would deduct, the invoice is settled, and no receipt against it recorded
   * a deduction. The expectation was informational; its non-arrival is the
   * compliance fact worth chasing (a 26AS that will not show the credit).
   */
  const receipts = safeArray(db?.payments).filter(
    (pmt) => Number(pmt?.companyId) === Number(companyId) && lower(pmt?.voucherType) === 'receipt'
  );
  for (const inv of safeArray(db?.invoices)) {
    if (Number(inv?.companyId) !== Number(companyId)) continue;
    const expected = Number(inv?.tdsExpectedAmount ?? 0);
    if (expected <= 0.005) continue;
    if (lower(inv?.status) !== 'paid') continue;
    const received = receipts.some(
      (pmt) =>
        Number(pmt?.tdsAmount || 0) > 0.005 &&
        safeArray(pmt?.allocations).some((a) => String(a?.voucherId) === String(inv.id))
    );
    if (!received) {
      out.push({
        severity: 'WARNING',
        code: 'EXPECTED_TDS_NOT_RECEIVED',
        eventId: null,
        party: String(inv?.customerName || ''),
        message: `Invoice ${inv?.number || inv?.id}: expected TDS of ${expected} was never recorded on a receipt.`,
      });
    }
  }

  /* A quarter with live deductions and no filing record is work not yet
     started — a note, never a bar. */
  const filings = safeArray(db?.tdsFilings).filter((f) => Number(f?.companyId) === Number(companyId));
  const quartersWithWork = new Set(
    rows.filter((e) => isLive(e) && String(e.side).toUpperCase() === 'PAYABLE').map((e) => String(e.returnQuarter || '')).filter(Boolean)
  );
  for (const q of [...quartersWithWork].sort()) {
    if (!filings.some((f) => String(f.quarter) === q)) {
      out.push({
        severity: 'INFO',
        code: 'RETURN_NOT_PREPARED',
        eventId: null,
        party: '',
        message: `${q}: deductions exist and the return has not been prepared.`,
      });
    }
  }

  return out;
};

/**
 * Does the register agree with the ledgers and the challans?
 *
 * Three figures that must reconcile: what the events say was deducted, what
 * the mapped ledgers actually moved, and what the challans paid. Where they
 * differ, one of them is wrong and the difference is the amount to chase.
 */
export const tdsReconciliation = (db, companyId, filter = {}) => {
  const events = tdsEvents(db, companyId, { ...filter, side: 'PAYABLE' }).filter(isLive);
  const register = r2(events.reduce((t, e) => t + Number(e.tdsAmount || 0), 0));
  const allocations = allocationsByEvent(db, companyId);
  const paid = r2(allocations.totalFor(events.map((e) => e.id)));

  /* What the ledgers themselves hold, by ledger, so a difference can be
     pointed at rather than merely announced. */
  const byLedger = new Map();
  for (const e of events) {
    const key = String(e.ledgerId || '');
    const at = byLedger.get(key) || { ledgerId: key, name: '', deducted: 0, allocated: 0 };
    at.deducted = r2(at.deducted + Number(e.tdsAmount || 0));
    at.allocated = r2(at.allocated + allocations.for(e.id));
    byLedger.set(key, at);
  }
  const accounts = safeArray(db?.chartOfAccounts);
  const ledgers = [...byLedger.values()].map((l) => ({
    ...l,
    name: accounts.find((a) => String(a.id) === l.ledgerId)?.name || '(unmapped)',
    outstanding: r2(l.deducted - l.allocated),
  }));

  return { register, paid, outstanding: r2(register - paid), ledgers };
};

/**
 * A nature somebody deducts under with no ledger mapped to it.
 *
 * The dashboard's "Unmapped TDS" card: it is a setup fault rather than a
 * transaction fault, and it is found before somebody meets it mid-bill.
 */
export const unmappedNatures = (db, companyId) => {
  const cid = Number(companyId);
  const parties = [...safeArray(db?.vendors), ...safeArray(db?.customers)].filter(
    (p) => Number(p?.companyId) === cid
  );
  const wanted = new Set(
    parties.map((p) => String(p?.tdsNatureCode || '').trim()).filter(Boolean)
  );
  const mapped = new Set(
    safeArray(db?.chartOfAccounts)
      .filter((a) => Number(a?.companyId) === cid && a?.isActive !== false)
      .map((a) => String(a?.tdsNatureCode || '').trim())
      .filter(Boolean)
  );
  return [...wanted]
    .filter((code) => !mapped.has(code))
    .map((code) => ({ natureCode: code, natureName: natureByCode(code)?.name || code }));
};
