/**
 * TDS 194Q / TCS 206C(1H) — the goods-trade siblings.
 *
 * 194Q: a buyer deducts TDS (default 0.1%) on the value of goods PURCHASED
 * from one seller beyond ₹50 lakh in a financial year.
 * 206C(1H): a seller collects TCS (default 0.1%) on payments RECEIVED from
 * one buyer beyond ₹50 lakh in a financial year. (Not collected when the
 * buyer is already deducting 194Q — flag per customer.)
 *
 * Everything is computed from documents per FY — cumulative per party, the
 * excess over the threshold, and the tax on that excess.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round(num(v) * 100) / 100;

/** Indian FY containing `date`: 1 Apr – 31 Mar. */
export const fyRange = (date = new Date().toISOString().slice(0, 10)) => {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return { from: `${y}-04-01`, to: `${y + 1}-03-31`, label: `FY ${y}-${String(y + 1).slice(2)}` };
};

export const DEFAULT_CONFIG = { threshold: 5000000, rate: 0.1, tdsEnabled: true, tcsEnabled: true };

export const getTdsConfig = (db, companyId) => {
  const stored = (db?.tdsConfigs || []).find((c) => c.companyId === companyId);
  return { ...DEFAULT_CONFIG, ...(stored || {}) };
};

const inFy = (date, fy) => {
  const d = String(date || '').slice(0, 10);
  return d >= fy.from && d <= fy.to;
};

/**
 * 194Q — per-vendor purchase accumulation and TDS on the excess.
 * Base = non-draft, non-cancelled bill totals in the FY.
 */
export function tds194qRows(db, companyId, config, fy) {
  const byVendor = new Map();
  for (const b of db?.bills || []) {
    if (b.companyId !== companyId) continue;
    const st = String(b.status || '').toLowerCase();
    if (st === 'draft' || st === 'cancelled') continue;
    if (!inFy(b.date, fy)) continue;
    const key = String(b.vendorName || 'Unknown vendor');
    const slot = byVendor.get(key) || { party: key, gstin: b.vendorGstin || '', docs: 0, cumulative: 0 };
    slot.docs += 1;
    slot.cumulative = r2(slot.cumulative + num(b.total));
    if (!slot.gstin && b.vendorGstin) slot.gstin = b.vendorGstin;
    byVendor.set(key, slot);
  }
  return [...byVendor.values()]
    .map((v) => {
      const excess = Math.max(0, r2(v.cumulative - num(config.threshold)));
      return { ...v, excess, tax: r2((excess * num(config.rate)) / 100) };
    })
    .sort((a, b) => b.cumulative - a.cumulative);
}

/**
 * 206C(1H) — per-customer RECEIPT accumulation and TCS on the excess.
 * Base = receipt vouchers in the FY (collection happens on receipt, not
 * billing). Customers flagged buyerDeducts194Q are exempt.
 */
export function tcs206cRows(db, companyId, config, fy) {
  const customersById = new Map((db?.customers || []).filter((c) => c.companyId === companyId).map((c) => [String(c.id), c]));
  const byCustomer = new Map();
  for (const p of db?.payments || []) {
    if (p.companyId !== companyId) continue;
    if (p.voucherType !== 'receipt') continue;
    if (!inFy(p.date, fy)) continue;
    const key = String(p.customerName || 'Unknown customer');
    const cust = p.customerId != null ? customersById.get(String(p.customerId)) : null;
    const slot = byCustomer.get(key) || { party: key, gstin: cust?.gstin || '', exempt: Boolean(cust?.buyerDeducts194Q), docs: 0, cumulative: 0 };
    slot.docs += 1;
    slot.cumulative = r2(slot.cumulative + num(p.amount));
    byCustomer.set(key, slot);
  }
  return [...byCustomer.values()]
    .map((c) => {
      const excess = c.exempt ? 0 : Math.max(0, r2(c.cumulative - num(config.threshold)));
      return { ...c, excess, tax: r2((excess * num(config.rate)) / 100) };
    })
    .sort((a, b) => b.cumulative - a.cumulative);
}
