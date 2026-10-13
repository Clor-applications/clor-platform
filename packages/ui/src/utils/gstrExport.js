import { GST_STATE_BY_CODE } from './gst';

/**
 * GSTR-1 and GSTR-3B as portal-schema JSON.
 *
 * The on-screen reports answer "what would I file"; these files are the
 * filing. Shapes follow the GST portal's offline-tool JSON: GSTR-1 carries
 * b2b (registered buyers, invoice-wise), b2cs (unregistered, aggregated by
 * place-of-supply and rate) and cdnr (credit notes to registered buyers);
 * GSTR-3B carries table 3.1(a) outward supplies and table 4(A)(5) all-other
 * ITC. Sections this product has no data for (exports, nil-rated, advances)
 * are omitted — the portal treats absent sections as empty, and inventing
 * zeros risks contradicting data filed from elsewhere.
 */

const STATE_CODE_BY_NAME = Object.fromEntries(
  Object.entries(GST_STATE_BY_CODE).map(([code, name]) => [String(name).toLowerCase(), code])
);

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** "2026-08-18" → "18-08-2026", the portal's date format. */
const portalDate = (iso) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-');
  return d && m && y ? `${d}-${m}-${y}` : '';
};

/** Place of supply as the 2-digit code the portal wants. */
const posCode = (stateName, fallbackGstin) => {
  const byName = STATE_CODE_BY_NAME[String(stateName || '').trim().toLowerCase()];
  if (byName) return byName;
  const fromGstin = String(fallbackGstin || '').slice(0, 2);
  return /^\d\d$/.test(fromGstin) ? fromGstin : '';
};

/** Whole-document rate when line detail is missing: GST over taxable, snapped to a slab. */
const impliedRate = (doc) => {
  const taxable = Number(doc.subtotal ?? doc.taxableTotal ?? 0);
  const gst = Number(doc.gstTotal ?? 0);
  if (!taxable || !gst) return 0;
  const raw = (gst / taxable) * 100;
  const slabs = [0, 0.25, 3, 5, 12, 18, 28];
  return slabs.reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best), 0);
};

const inPeriod = (doc, period) => {
  // period is "MMYYYY"
  const d = String(doc.date || '').slice(0, 10);
  return d.slice(5, 7) === period.slice(0, 2) && d.slice(0, 4) === period.slice(2);
};

const taxSplit = (doc, rate, taxable) => {
  const igst = Number(doc.igstTotal ?? 0);
  const isInter = igst > 0.004;
  const tax = r2((taxable * rate) / 100);
  return isInter
    ? { iamt: tax, camt: 0, samt: 0 }
    : { iamt: 0, camt: r2(tax / 2), samt: r2(tax / 2) };
};

/** Portal UQC codes for common item units; anything unknown files as OTH. */
const UQC_MAP = {
  pcs: 'PCS', pc: 'PCS', piece: 'PCS', pieces: 'PCS', nos: 'NOS', no: 'NOS', number: 'NOS', numbers: 'NOS',
  kg: 'KGS', kgs: 'KGS', kilogram: 'KGS', g: 'GMS', gm: 'GMS', gms: 'GMS', gram: 'GMS',
  l: 'LTR', ltr: 'LTR', litre: 'LTR', liter: 'LTR', ml: 'MLT',
  m: 'MTR', mtr: 'MTR', meter: 'MTR', metre: 'MTR', cm: 'CMS', ft: 'FTS', sqft: 'SQF', sqm: 'SQM',
  box: 'BOX', set: 'SET', sets: 'SET', pack: 'PAC', pkt: 'PAC', dozen: 'DOZ', doz: 'DOZ',
  pair: 'PRS', pairs: 'PRS', roll: 'ROL', bag: 'BAG', btl: 'BTL', bottle: 'BTL', can: 'CAN',
  ton: 'TON', tonne: 'TON', qtl: 'QTL', bundle: 'BDL', bdl: 'BDL', unit: 'UNT', units: 'UNT',
};
const uqcFor = (unit) => UQC_MAP[String(unit || '').trim().toLowerCase()] || 'OTH';

/** Usable line rows on a document, or empty when only totals exist. */
const docLines = (doc) =>
  (Array.isArray(doc.items) ? doc.items : []).filter(
    (l) => Number(l?.amount) || (Number(l?.quantity) && Number(l?.rate))
  );

/**
 * itms for one invoice. When line detail exists, group by actual GST rate —
 * a 5%+18% invoice files as two itm_det rows instead of one snapped slab.
 * Totals-only documents fall back to the implied whole-document rate.
 */
const invoiceItems = (doc) => {
  const isInter = Number(doc.igstTotal ?? 0) > 0.004;
  const lines = docLines(doc);
  if (lines.length) {
    const byRate = new Map();
    for (const l of lines) {
      const rt = Number(l.gstRate) || 0;
      const txval = Number(l.amount) || Number(l.quantity) * Number(l.rate) || 0;
      byRate.set(rt, (byRate.get(rt) || 0) + txval);
    }
    return [...byRate.entries()]
      .sort(([a], [b]) => a - b)
      .map(([rt, txvalRaw], i) => {
        const txval = r2(txvalRaw);
        const tax = r2((txval * rt) / 100);
        return {
          num: i + 1,
          itm_det: {
            rt,
            txval,
            ...(isInter ? { iamt: tax } : { camt: r2(tax / 2), samt: r2(tax / 2) }),
            csamt: 0,
          },
        };
      });
  }
  const taxable = Number(doc.subtotal ?? doc.taxableTotal ?? 0);
  const rate = impliedRate(doc);
  const { iamt, camt, samt } = taxSplit(doc, rate, taxable);
  return [
    {
      num: 1,
      itm_det: {
        rt: rate,
        txval: r2(taxable),
        ...(iamt ? { iamt } : { camt, samt }),
        csamt: 0,
      },
    },
  ];
};

/** B2CL threshold: inter-state invoices to unregistered buyers above this file invoice-wise. */
const B2CL_LIMIT = 250000;

export function buildGstr1Json({ invoices = [], creditNotes = [], items = [], company = {}, period }) {
  const active = (d) => !['draft', 'cancelled'].includes(String(d.status || '').toLowerCase());
  const inv = invoices.filter((d) => active(d) && inPeriod(d, period));
  const cdn = creditNotes.filter((d) => active(d) && inPeriod(d, period));

  const companyGstin = String(company.gstin || '').trim();
  const itemById = new Map(items.map((it) => [String(it.id), it]));

  // b2b: registered buyers, grouped by their GSTIN, invoice-wise
  const byCtin = new Map();
  const b2csAgg = new Map();
  // b2cl: inter-state to unregistered buyers above ₹2.5L — invoice-wise by POS
  const b2clByPos = new Map();
  // hsn: table 12 summary over all outward invoices, keyed hsn|rate|uqc
  const hsnAgg = new Map();

  for (const d of inv) {
    const ctin = String(d.customerGstin || d.partyGstin || '').trim();
    const isInter = Number(d.igstTotal ?? 0) > 0.004;
    const rchrg = d.reverseCharge ? 'Y' : 'N';

    // Table 12 HSN summary accumulates for every outward invoice.
    for (const l of docLines(d)) {
      const master = itemById.get(String(l.itemId));
      const hsn = String(l.hsnSac || master?.hsnSac || '').trim();
      if (!hsn) continue;
      const rt = Number(l.gstRate) || 0;
      const uqc = uqcFor(master?.unit);
      const key = `${hsn}|${rt}|${uqc}`;
      const txval = Number(l.amount) || Number(l.quantity) * Number(l.rate) || 0;
      const tax = (txval * rt) / 100;
      const prev = hsnAgg.get(key) || {
        hsn_sc: hsn,
        desc: String(l.description || master?.name || '').slice(0, 30),
        uqc, rt, qty: 0, txval: 0, iamt: 0, camt: 0, samt: 0,
      };
      prev.qty += Number(l.quantity) || 0;
      prev.txval += txval;
      if (isInter) prev.iamt += tax;
      else { prev.camt += tax / 2; prev.samt += tax / 2; }
      hsnAgg.set(key, prev);
    }

    if (ctin) {
      if (!byCtin.has(ctin)) byCtin.set(ctin, []);
      byCtin.get(ctin).push({
        inum: d.number,
        idt: portalDate(d.date),
        val: r2(d.total),
        pos: posCode(d.placeOfSupplyState, ctin) || companyGstin.slice(0, 2),
        rchrg,
        inv_typ: 'R',
        itms: invoiceItems(d),
      });
    } else if (isInter && Number(d.total) > B2CL_LIMIT) {
      const pos = posCode(d.placeOfSupplyState, '') || companyGstin.slice(0, 2);
      if (!b2clByPos.has(pos)) b2clByPos.set(pos, []);
      b2clByPos.get(pos).push({
        inum: d.number,
        idt: portalDate(d.date),
        val: r2(d.total),
        itms: invoiceItems(d),
      });
    } else {
      const pos = posCode(d.placeOfSupplyState, '') || companyGstin.slice(0, 2);
      const rate = impliedRate(d);
      const key = `${pos}|${rate}`;
      const taxable = Number(d.subtotal ?? d.taxableTotal ?? 0);
      const prev = b2csAgg.get(key) || { pos, rt: rate, txval: 0, iamt: 0, camt: 0, samt: 0, inter: Number(d.igstTotal ?? 0) > 0.004 };
      const { iamt, camt, samt } = taxSplit(d, rate, taxable);
      prev.txval = r2(prev.txval + taxable);
      prev.iamt = r2(prev.iamt + iamt);
      prev.camt = r2(prev.camt + camt);
      prev.samt = r2(prev.samt + samt);
      b2csAgg.set(key, prev);
    }
  }

  const cdnr = new Map();
  for (const d of cdn) {
    const ctin = String(d.customerGstin || d.partyGstin || '').trim();
    if (!ctin) continue;
    if (!cdnr.has(ctin)) cdnr.set(ctin, []);
    cdnr.get(ctin).push({
      ntty: 'C',
      nt_num: d.number,
      nt_dt: portalDate(d.date),
      pos: posCode(d.placeOfSupplyState, ctin) || companyGstin.slice(0, 2),
      rchrg: d.reverseCharge ? 'Y' : 'N',
      val: r2(d.total),
      itms: invoiceItems(d),
    });
  }

  const out = {
    gstin: companyGstin,
    fp: period,
    version: 'GST3.1',
    hash: 'hash',
    b2b: [...byCtin.entries()].map(([ctin, invs]) => ({ ctin, inv: invs })),
    b2cs: [...b2csAgg.values()].map(({ pos, rt, txval, iamt, camt, samt, inter }) => ({
      sply_ty: inter ? 'INTER' : 'INTRA',
      pos,
      typ: 'OE',
      rt,
      txval,
      ...(inter ? { iamt } : { camt, samt }),
      csamt: 0,
    })),
    cdnr: [...cdnr.entries()].map(([ctin, notes]) => ({ ctin, nt: notes })),
  };
  if (b2clByPos.size) {
    out.b2cl = [...b2clByPos.entries()].map(([pos, invs]) => ({ pos, inv: invs }));
  }
  if (hsnAgg.size) {
    out.hsn = {
      data: [...hsnAgg.values()].map((h, i) => ({
        num: i + 1,
        hsn_sc: h.hsn_sc,
        desc: h.desc,
        uqc: h.uqc,
        rt: h.rt,
        qty: r2(h.qty),
        txval: r2(h.txval),
        iamt: r2(h.iamt),
        camt: r2(h.camt),
        samt: r2(h.samt),
        csamt: 0,
      })),
    };
  }
  return out;
}

export function buildGstr3bJson({ invoices = [], creditNotes = [], bills = [], expenses = [], debitNotes = [], company = {}, period }) {
  const active = (d) => !['draft', 'cancelled'].includes(String(d.status || '').toLowerCase());
  const pick = (rows) => rows.filter((d) => active(d) && inPeriod(d, period));

  const sum = (rows, field) => r2(rows.reduce((s, d) => s + Number(d[field] ?? 0), 0));

  const inv = pick(invoices);
  const cn = pick(creditNotes);
  const inward = [...pick(bills), ...pick(expenses)];
  const dn = pick(debitNotes);

  // Outward = invoices net of credit notes (table 3.1a)
  const osup = {
    txval: r2(sum(inv, 'subtotal') + sum(inv, 'taxableTotal') - sum(cn, 'subtotal') - sum(cn, 'taxableTotal')),
    iamt: r2(sum(inv, 'igstTotal') - sum(cn, 'igstTotal')),
    camt: r2(sum(inv, 'cgstTotal') - sum(cn, 'cgstTotal')),
    samt: r2(sum(inv, 'sgstTotal') - sum(cn, 'sgstTotal')),
    csamt: 0,
  };

  // ITC "all other" = inward documents net of debit notes (table 4A5)
  const itc = {
    ty: 'OTH',
    iamt: r2(sum(inward, 'igstTotal') - sum(dn, 'igstTotal')),
    camt: r2(sum(inward, 'cgstTotal') - sum(dn, 'cgstTotal')),
    samt: r2(sum(inward, 'sgstTotal') - sum(dn, 'sgstTotal')),
    csamt: 0,
  };

  return {
    gstin: String(company.gstin || '').trim(),
    ret_period: period,
    sup_details: {
      osup_det: osup,
      osup_zero: { txval: 0, iamt: 0, csamt: 0 },
      osup_nil_exmp: { txval: 0 },
      isup_rev: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      osup_nongst: { txval: 0 },
    },
    itc_elg: {
      itc_avl: [itc],
      itc_rev: [],
      itc_net: itc,
      itc_inelg: [],
    },
  };
}

export function downloadJson(fileName, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
