import { GST_STATE_BY_CODE } from './gst';

/**
 * GSTR-1 and GSTR-3B as portal-schema JSON.
 *
 * The on-screen reports answer "what would I file"; these files are the
 * filing. Both are checked in tests against GSTN's own request schemas from
 * developer.gst.gov.in: "GSTR1 – Save GSTR1 data" v4.1 (the shape the GST
 * Offline Tool writes and the portal's offline upload takes) and "GSTR3B –
 * Save GSTR3B data" v7.1 (gstrSchemas.test.js).
 *
 * GSTR-1 carries b2b (registered, SEZ and deemed-export buyers), b2cl,
 * b2cs, exp, cdnr, cdnur, nil (Table 8), hsn (Table 12) and doc_issue
 * (Table 13). GSTR-3B carries 3.1 (a)–(e), 3.2 and 4 (A), (B), (C) — every
 * box worked out from the same classification as GSTR-1, so the two returns
 * cannot disagree about what a sale was. Sections with nothing in them are
 * left out; the portal reads an absent section as empty.
 */

const STATE_CODE_BY_NAME = Object.fromEntries(
  Object.entries(GST_STATE_BY_CODE).map(([code, name]) => [String(name).toLowerCase(), code])
);

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const text = (v) => String(v ?? '').trim();

/** "2026-08-18" → "18-08-2026", the portal's date format. */
const portalDate = (iso) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-');
  return d && m && y ? `${d}-${m}-${y}` : '';
};

/** Place of supply as the 2-digit code the portal wants. */
const posCode = (stateName, fallbackGstin) => {
  const raw = text(stateName);
  const lead = raw.match(/^(\d{2})\b/);
  if (lead && (GST_STATE_BY_CODE[lead[1]] || lead[1] === '96' || lead[1] === '97')) return lead[1];
  const byName = STATE_CODE_BY_NAME[raw.toLowerCase()];
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
  const slabs = [0, 0.25, 3, 5, 12, 18, 28, 40];
  return slabs.reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best), 0);
};

/** period is "MMYYYY"; compared as YYYYMM. */
const periodKey = (fp) => `${String(fp).slice(2)}${String(fp).slice(0, 2)}`;

const inPeriod = (doc, period) => {
  const d = String(doc.date || '').slice(0, 10);
  return d.slice(5, 7) === period.slice(0, 2) && d.slice(0, 4) === period.slice(2);
};

const issued = (d) => !['draft', 'cancelled'].includes(String(d.status || '').toLowerCase());
const isCancelled = (d) => String(d.status || '').toLowerCase() === 'cancelled';

/**
 * B2CL limit: an inter-state invoice to an unregistered buyer above this goes
 * invoice-wise into Table 5. ₹2.5 lakh until July 2024; ₹1 lakh for return
 * periods from August 2024 (Notification 12/2024–CT, rule 59; the Offline
 * Tool's B2CL_MIN_VAL_STR_PRD "082024" draws the line by return period too).
 */
export const B2CL_LIMIT_RULES = [
  { fromPeriod: '082024', limit: 100000 },
  { fromPeriod: '072017', limit: 250000 },
];
export const b2clLimitFor = (period) =>
  (B2CL_LIMIT_RULES.find((r) => periodKey(period) >= periodKey(r.fromPeriod)) || B2CL_LIMIT_RULES.at(-1)).limit;

/** Table 12 is split into B2B and B2C rows for return periods from May 2025. */
const HSN_SPLIT_FROM = '052025';

/** Portal UQC codes for common item units; anything unknown files as OTH. */
const UQC_MAP = {
  pcs: 'PCS', pc: 'PCS', piece: 'PCS', pieces: 'PCS', nos: 'NOS', no: 'NOS', number: 'NOS', numbers: 'NOS',
  kg: 'KGS', kgs: 'KGS', kilogram: 'KGS', g: 'GMS', gm: 'GMS', gms: 'GMS', gram: 'GMS',
  l: 'LTR', ltr: 'LTR', litre: 'LTR', liter: 'LTR', ml: 'MLT',
  m: 'MTR', mtr: 'MTR', meter: 'MTR', metre: 'MTR', cm: 'CMS', sqft: 'SQF', sqm: 'SQM',
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

const lineValue = (l) => Number(l.taxableAmount) || Number(l.amount) || Number(l.quantity) * Number(l.rate) || 0;

const EXPORT_TYPES = new Set(['EXPWP', 'EXPWOP']);
const SEZ_TYPES = new Set(['SEZWP', 'SEZWOP']);

/**
 * What a sales document is, for both returns.
 *
 * kind: EXP (Table 6A), SEZ (6B), DE (6C deemed export), B2B (4A/4B),
 * B2CL (5), B2CS (7). The document's own supply type wins; otherwise the
 * buyer master decides (SEZ unit, overseas, composition dealer).
 */
function classify(doc, ctx) {
  const party = ctx.partyOf(doc);
  const ctin = text(doc.customerGstin || doc.partyGstin).toUpperCase();
  const reg = `${text(party?.gstRegistrationType)} ${text(party?.gstRegistration)} ${text(party?.gstTaxpayerType)}`.toUpperCase();
  const country = text(party?.billingAddress?.country || party?.country || party?.billingCountry);
  const chosen = text(doc.supplyType).toUpperCase();
  const igst = Number(doc.igstTotal ?? 0) > 0.004;
  const pos = posCode(doc.placeOfSupplyState, ctin) || ctx.companyState;

  let kind;
  if (EXPORT_TYPES.has(chosen) || /export/i.test(text(doc.taxTreatment)) || /OVERSEAS/.test(reg) || (country && !/^(india|in|ind)$/i.test(country)) || pos === '96') kind = 'EXP';
  else if (ctin && (SEZ_TYPES.has(chosen) || /\bSEZ\b/.test(reg))) kind = 'SEZ';
  else if (ctin && chosen === 'DEXP') kind = 'DE';
  else if (ctin) kind = 'B2B';
  else kind = null; // B2CL or B2CS, decided by the caller with the invoice value

  const inter = kind === 'EXP' || kind === 'SEZ' || igst || (pos && pos !== ctx.companyState);
  return {
    kind,
    ctin,
    pos,
    inter,
    withPay: igst,
    rchrg: doc.reverseCharge ? 'Y' : 'N',
    composition: /COMPOSITION/.test(reg),
    uin: /\bUIN\b|UN BODY|EMBASSY/.test(reg),
  };
}

/**
 * A document's lines split by how Table 8 and the rest see them: taxable
 * lines (any rate, including 0% on zero-rated supplies) and nil / exempt /
 * non-GST lines. Totals-only documents become one line at the implied rate.
 */
function splitLines(doc, ctx, zeroRated) {
  const lines = docLines(doc);
  const rows = lines.length
    ? lines.map((l) => {
        const master = ctx.itemById.get(String(l.itemId));
        return {
          rt: Number(l.gstRate) || 0,
          txval: lineValue(l),
          taxability: text(l.taxability || master?.taxability || 'Taxable'),
          hsn: text(l.hsnSac || master?.hsnSac),
          desc: text(l.description || master?.name),
          uqc: uqcFor(master?.unit || l.unit),
          qty: Number(l.quantity) || 0,
        };
      })
    : [{ rt: impliedRate(doc), txval: Number(doc.subtotal ?? doc.taxableTotal ?? 0), taxability: 'Taxable', hsn: '', desc: '', uqc: 'OTH', qty: 0 }];

  const taxable = [];
  const nil = { nil: 0, exempt: 0, nongst: 0 };
  for (const row of rows) {
    const t = row.taxability.toLowerCase();
    if (!zeroRated && /non[\s-]?gst/.test(t)) nil.nongst += row.txval;
    else if (!zeroRated && /exempt/.test(t)) nil.exempt += row.txval;
    else if (!zeroRated && (/nil/.test(t) || row.rt === 0)) nil.nil += row.txval;
    else taxable.push(row);
  }
  return { rows, taxable, nil };
}

/** Tax on one rate group, split the way the supply is charged. */
const taxOf = (txval, rt, inter, withPay = true) => {
  const tax = r2((txval * rt) / 100);
  if (!inter) return { iamt: 0, camt: r2(tax / 2), samt: r2(tax / 2) };
  return { iamt: withPay ? tax : 0, camt: 0, samt: 0 };
};

/** Rate-wise item rows: { num, itm_det: { rt, txval, iamt | camt+samt, csamt } }. */
const rateItems = (rows, inter, withPay = true) => {
  const byRate = new Map();
  for (const r of rows) byRate.set(r.rt, (byRate.get(r.rt) || 0) + r.txval);
  return [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rt, txvalRaw], i) => {
      const txval = r2(txvalRaw);
      const { iamt, camt, samt } = taxOf(txval, rt, inter, withPay);
      return { num: i + 1, itm_det: { rt, txval, ...(inter ? { iamt } : { camt, samt }), csamt: 0 } };
    });
};

const sumItems = (itms) =>
  itms.reduce(
    (s, { itm_det: d }) => ({
      txval: s.txval + d.txval,
      iamt: s.iamt + (d.iamt || 0),
      camt: s.camt + (d.camt || 0),
      samt: s.samt + (d.samt || 0),
    }),
    { txval: 0, iamt: 0, camt: 0, samt: 0 }
  );

function context({ items = [], customers = [], company = {}, invoices = [] }) {
  const companyGstin = text(company.gstin).toUpperCase();
  const itemById = new Map(items.map((it) => [String(it.id), it]));
  items.forEach((it) => it.backendItemId && itemById.set(String(it.backendItemId), it));
  // Documents read back from the server name the party by its server id.
  const partyById = new Map(customers.map((c) => [String(c.id), c]));
  customers.forEach((c) => c.backendPartyId && partyById.set(String(c.backendPartyId), c));
  const invoiceById = new Map(invoices.map((d) => [String(d.id), d]));
  invoices.forEach((d) => d.backendInvoiceId && invoiceById.set(String(d.backendInvoiceId), d));
  const invoiceByNumber = new Map(invoices.map((d) => [text(d.number), d]));
  return {
    companyGstin,
    companyState: companyGstin.slice(0, 2) || posCode(company.state, ''),
    itemById,
    partyOf: (doc) => partyById.get(String(doc.customerId ?? doc.partyId ?? '')),
    originalOf: (note) =>
      invoiceById.get(String(note.againstDocId ?? note.againstInvoiceId ?? note.sourceInvoiceId ?? '')) ||
      invoiceByNumber.get(text(note.againstInvoiceNumber || note.refNo)),
  };
}

/** Whether an unregistered sale is B2CL: inter-state and above the limit for the period. */
const isB2cl = (doc, c, limit) => !c.kind && c.inter && Number(doc.total) > limit;

/** Invoice-number series for Table 13: "INV/26-27/0042" → prefix "INV/26-27/", number 42. */
const seriesOf = (num) => {
  const m = text(num).match(/^(.*?)(\d+)$/);
  return m ? { prefix: m[1], n: Number(m[2]) } : { prefix: text(num), n: 0 };
};

function docSeries(docs) {
  const groups = new Map();
  for (const d of docs) {
    const { prefix, n } = seriesOf(d.number);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push({ number: text(d.number), n, cancelled: isCancelled(d) });
  }
  return [...groups.values()].map((rows, i) => {
    rows.sort((a, b) => a.n - b.n || a.number.localeCompare(b.number));
    const cancel = rows.filter((r) => r.cancelled).length;
    return { num: i + 1, from: rows[0].number, to: rows.at(-1).number, totnum: rows.length, cancel, net_issue: rows.length - cancel };
  });
}

/**
 * Everything both returns need, worked out once per period: each outward
 * document classified and split into its taxable and Table 8 parts.
 */
function outward({ invoices = [], creditNotes = [], items = [], customers = [], company = {}, period }) {
  const ctx = context({ items, customers, company, invoices });
  const limit = b2clLimitFor(period);
  const inv = invoices.filter((d) => issued(d) && inPeriod(d, period)).map((d) => {
    const c = classify(d, ctx);
    const kind = c.kind || (isB2cl(d, c, limit) ? 'B2CL' : 'B2CS');
    const zeroRated = kind === 'EXP' || kind === 'SEZ';
    return { doc: d, ...c, kind, zeroRated, ...splitLines(d, ctx, zeroRated) };
  });
  const cdn = creditNotes.filter((d) => issued(d) && inPeriod(d, period)).map((d) => {
    const original = ctx.originalOf(d);
    const own = classify(d, ctx);
    const base = original ? classify(original, ctx) : own;
    // A note follows the invoice it corrects: a note against a B2CL invoice is a B2CL note.
    const kind = base.kind || (original ? (isB2cl(original, base, b2clLimitFor(period)) ? 'B2CL' : 'B2CS') : isB2cl(d, own, limit) ? 'B2CL' : 'B2CS');
    const zeroRated = kind === 'EXP' || kind === 'SEZ';
    return { doc: d, ...own, kind, zeroRated, withPay: own.withPay, ...splitLines(d, ctx, zeroRated) };
  });
  return { ctx, inv, cdn, limit };
}

/**
 * The GSTR-1 table each sales invoice falls in, by the same rules as the
 * portal JSON, so a screen listing the sections agrees with the export.
 * B2CL is judged against the limit of the invoice's own month.
 */
export function gstr1Classifier({ invoices = [], items = [], customers = [], company = {} }) {
  const ctx = context({ items, customers, company, invoices });
  return (doc) => {
    const c = classify(doc, ctx);
    if (c.kind) return c.kind;
    const period = `${text(doc.date).slice(5, 7)}${text(doc.date).slice(0, 4)}`;
    return isB2cl(doc, c, b2clLimitFor(period)) ? 'B2CL' : 'B2CS';
  };
}

const invTyp = (e) => (e.kind === 'SEZ' ? (e.withPay ? 'SEWP' : 'SEWOP') : e.kind === 'DE' ? 'DE' : 'R');
const sTyp = (inter, b2b) => `${inter ? 'INTR' : 'INTRA'}${b2b ? 'B2B' : 'B2C'}`;

export function buildGstr1Json({ invoices = [], creditNotes = [], items = [], customers = [], company = {}, period }) {
  const { ctx, inv, cdn } = outward({ invoices, creditNotes, items, customers, company, period });

  const b2b = new Map();
  const b2cl = new Map();
  const b2cs = new Map();
  const exp = new Map();
  const nil = new Map();
  const hsnB2b = new Map();
  const hsnB2c = new Map();

  const addNil = (e, sign) => {
    const key = sTyp(e.inter, Boolean(e.ctin));
    const row = nil.get(key) || { sply_ty: key, nil_amt: 0, expt_amt: 0, ngsup_amt: 0 };
    row.nil_amt += sign * e.nil.nil;
    row.expt_amt += sign * e.nil.exempt;
    row.ngsup_amt += sign * e.nil.nongst;
    nil.set(key, row);
  };

  const addB2cs = (e, sign) => {
    for (const row of e.taxable) {
      const key = `${e.pos}|${row.rt}`;
      const prev = b2cs.get(key) || { sply_ty: e.inter ? 'INTER' : 'INTRA', pos: e.pos, typ: 'OE', rt: row.rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
      const tax = taxOf(row.txval, row.rt, e.inter);
      prev.txval += sign * row.txval;
      prev.iamt += sign * tax.iamt;
      prev.camt += sign * tax.camt;
      prev.samt += sign * tax.samt;
      b2cs.set(key, prev);
    }
  };

  const addHsn = (e, sign) => {
    const target = e.ctin ? hsnB2b : hsnB2c;
    for (const row of e.rows) {
      if (!row.hsn) continue;
      const service = /^99/.test(row.hsn);
      const uqc = service ? 'NA' : row.uqc;
      const key = `${row.hsn}|${row.rt}|${uqc}`;
      const prev = target.get(key) || { hsn_sc: row.hsn, desc: row.desc.slice(0, 30), uqc, rt: row.rt, qty: 0, txval: 0, iamt: 0, camt: 0, samt: 0 };
      const tax = taxOf(row.txval, row.rt, e.inter, !e.zeroRated || e.withPay);
      if (!service) prev.qty += sign * row.qty;
      prev.txval += sign * row.txval;
      prev.iamt += sign * tax.iamt;
      prev.camt += sign * tax.camt;
      prev.samt += sign * tax.samt;
      target.set(key, prev);
    }
  };

  for (const e of inv) {
    const d = e.doc;
    addHsn(e, 1);
    addNil(e, 1);
    if (!e.taxable.length) continue;
    const base = { inum: text(d.number), idt: portalDate(d.date), val: r2(d.total) };
    if (e.kind === 'EXP') {
      const typ = e.withPay ? 'WPAY' : 'WOPAY';
      if (!exp.has(typ)) exp.set(typ, []);
      const sb = {
        ...(/^\d{3,7}$/.test(text(d.shippingBillNo)) ? { sbnum: text(d.shippingBillNo) } : {}),
        ...(d.shippingBillDate ? { sbdt: portalDate(d.shippingBillDate) } : {}),
        ...(/^[A-Za-z0-9]{1,6}$/.test(text(d.portCode)) ? { sbpcode: text(d.portCode).toUpperCase() } : {}),
      };
      exp.get(typ).push({
        ...base,
        ...(sb.sbnum && sb.sbdt ? sb : sb.sbpcode ? { sbpcode: sb.sbpcode } : {}),
        itms: rateItems(e.taxable, true, e.withPay).map(({ itm_det: x }) => ({ txval: x.txval, rt: x.rt, iamt: x.iamt || 0, csamt: 0 })),
      });
    } else if (e.kind === 'B2CL') {
      if (!b2cl.has(e.pos)) b2cl.set(e.pos, []);
      b2cl.get(e.pos).push({ ...base, itms: rateItems(e.taxable, true) });
    } else if (e.kind === 'B2CS') {
      addB2cs(e, 1);
    } else {
      if (!b2b.has(e.ctin)) b2b.set(e.ctin, []);
      b2b.get(e.ctin).push({
        ...base,
        pos: e.pos,
        rchrg: e.rchrg,
        inv_typ: invTyp(e),
        itms: rateItems(e.taxable, e.inter, e.kind !== 'SEZ' || e.withPay),
      });
    }
  }

  const cdnr = new Map();
  const cdnur = [];
  for (const e of cdn) {
    const d = e.doc;
    addHsn(e, -1);
    addNil(e, -1);
    if (!e.taxable.length) continue;
    const note = { ntty: 'C', nt_num: text(d.number), nt_dt: portalDate(d.date), val: r2(d.total) };
    if (e.ctin && e.kind !== 'EXP') {
      if (!cdnr.has(e.ctin)) cdnr.set(e.ctin, []);
      cdnr.get(e.ctin).push({
        ...note,
        pos: e.pos,
        rchrg: e.rchrg,
        inv_typ: invTyp(e),
        itms: rateItems(e.taxable, e.inter, e.kind !== 'SEZ' || e.withPay),
      });
    } else if (e.kind === 'EXP') {
      cdnur.push({ typ: e.withPay ? 'EXPWP' : 'EXPWOP', ...note, itms: rateItems(e.taxable, true, e.withPay) });
    } else if (e.kind === 'B2CL') {
      cdnur.push({ typ: 'B2CL', ...note, pos: e.pos, itms: rateItems(e.taxable, true) });
    } else {
      // Notes on small B2C sales are not filed note-wise: they reduce Table 7.
      addB2cs(e, -1);
    }
  }

  const out = {
    gstin: ctx.companyGstin,
    fp: period,
    version: 'GST3.2.4',
    hash: 'hash',
  };
  if (b2b.size) out.b2b = [...b2b.entries()].map(([ctin, invs]) => ({ ctin, inv: invs }));
  if (b2cl.size) out.b2cl = [...b2cl.entries()].map(([pos, invs]) => ({ pos, inv: invs }));
  const b2csRows = [...b2cs.values()].filter((r) => r2(r.txval) !== 0);
  if (b2csRows.length) {
    out.b2cs = b2csRows.map(({ sply_ty, pos, typ, rt, txval, iamt, camt, samt }) => ({
      sply_ty, pos, typ, rt, txval: r2(txval),
      ...(sply_ty === 'INTER' ? { iamt: r2(iamt) } : { camt: r2(camt), samt: r2(samt) }),
      csamt: 0,
    }));
  }
  if (cdnr.size) out.cdnr = [...cdnr.entries()].map(([ctin, nt]) => ({ ctin, nt }));
  if (cdnur.length) out.cdnur = cdnur;
  if (exp.size) out.exp = [...exp.entries()].map(([exp_typ, invs]) => ({ exp_typ, inv: invs }));
  const nilRows = [...nil.values()].filter((r) => r.nil_amt || r.expt_amt || r.ngsup_amt);
  if (nilRows.length) {
    out.nil = { inv: nilRows.map((r) => ({ sply_ty: r.sply_ty, nil_amt: r2(r.nil_amt), expt_amt: r2(r.expt_amt), ngsup_amt: r2(r.ngsup_amt) })) };
  }

  const hsnRows = (m) =>
    [...m.values()].map((h, i) => ({
      num: i + 1,
      hsn_sc: h.hsn_sc,
      desc: h.desc,
      uqc: h.uqc,
      qty: r2(h.qty),
      rt: h.rt,
      txval: r2(h.txval),
      iamt: r2(h.iamt),
      camt: r2(h.camt),
      samt: r2(h.samt),
      csamt: 0,
    }));
  if (hsnB2b.size || hsnB2c.size) {
    if (periodKey(period) >= periodKey(HSN_SPLIT_FROM)) {
      out.hsn = { ...(hsnB2b.size ? { hsn_b2b: hsnRows(hsnB2b) } : {}), ...(hsnB2c.size ? { hsn_b2c: hsnRows(hsnB2c) } : {}) };
    } else {
      const all = new Map(hsnB2b);
      for (const [k, v] of hsnB2c) {
        const p = all.get(k);
        all.set(k, p ? { ...p, qty: p.qty + v.qty, txval: p.txval + v.txval, iamt: p.iamt + v.iamt, camt: p.camt + v.camt, samt: p.samt + v.samt } : v);
      }
      out.hsn = { data: hsnRows(all) };
    }
  }

  // Table 13: every document issued in the period, cancelled ones included; drafts were never issued.
  const notDraft = (d) => String(d.status || '').toLowerCase() !== 'draft' && inPeriod(d, period) && text(d.number);
  const docDet = [
    { doc_num: 1, doc_typ: 'Invoices for outward supply', docs: docSeries(invoices.filter(notDraft)) },
    { doc_num: 5, doc_typ: 'Credit Note', docs: docSeries(creditNotes.filter(notDraft)) },
  ].filter((g) => g.docs.length);
  if (docDet.length) out.doc_issue = { doc_det: docDet };

  return out;
}

/** Sum of one tax head over documents. */
const total = (rows, field) => rows.reduce((s, d) => s + Number(d[field] ?? 0), 0);

/**
 * A manual journal that credits an input-tax ledger takes back ITC already
 * claimed: Table 4(B)(2). Lines are read by ledger name.
 */
const INPUT_TAX = /input\s*(igst|cgst|sgst|utgst|gst)|\bitc\b/i;
function journalItcReversal(journals, period) {
  const out = { iamt: 0, camt: 0, samt: 0 };
  for (const j of journals) {
    if (!issued(j) || !inPeriod(j, period)) continue;
    for (const l of j.lines || []) {
      const name = text(l.ledgerName || l.accountName || l.description);
      if (!INPUT_TAX.test(name)) continue;
      const net = Number(l.credit || 0) - Number(l.debit || 0);
      if (/igst/i.test(name)) out.iamt += net;
      else if (/cgst/i.test(name)) out.camt += net;
      else if (/sgst|utgst/i.test(name)) out.samt += net;
    }
  }
  return out;
}

export function buildGstr3bJson({
  invoices = [],
  creditNotes = [],
  bills = [],
  expenses = [],
  debitNotes = [],
  journalEntries = [],
  items = [],
  customers = [],
  vendors = [],
  company = {},
  period,
}) {
  const { ctx, inv, cdn } = outward({ invoices, creditNotes, items, customers, company, period });

  const z = () => ({ txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
  const box = { a: z(), b: z(), c: z(), e: z() };
  const unreg = new Map();
  const comp = new Map();
  const uin = new Map();
  const add32 = (m, pos, txval, iamt) => {
    if (!/^(3[0-8]|[12][0-9]|0[1-9]|97)$/.test(pos)) return;
    const p = m.get(pos) || { pos, txval: 0, iamt: 0 };
    p.txval += txval;
    p.iamt += iamt;
    m.set(pos, p);
  };

  for (const [list, sign] of [[inv, 1], [cdn, -1]]) {
    for (const e of list) {
      box.c.txval += sign * (e.nil.nil + e.nil.exempt);
      box.e.txval += sign * e.nil.nongst;
      if (!e.taxable.length) continue;
      const s = sumItems(rateItems(e.taxable, e.inter, !e.zeroRated || e.withPay));
      if (e.zeroRated) {
        // 3.1(b): exports (6A) and SEZ supplies (6B).
        box.b.txval += sign * s.txval;
        box.b.iamt += sign * s.iamt;
        continue;
      }
      // 3.1(a): outward taxable. On a reverse-charge sale the buyer pays the tax (GSTR-1 4B: taxable value only).
      box.a.txval += sign * s.txval;
      if (e.rchrg !== 'Y') {
        box.a.iamt += sign * s.iamt;
        box.a.camt += sign * s.camt;
        box.a.samt += sign * s.samt;
      }
      // 3.2: inter-state supplies to unregistered persons, composition dealers and UIN holders (IGST only).
      if (e.inter && s.iamt) {
        if (e.kind === 'B2CL' || e.kind === 'B2CS') add32(unreg, e.pos, sign * s.txval, sign * s.iamt);
        else if (e.kind === 'B2B' && e.composition) add32(comp, e.pos, sign * s.txval, sign * s.iamt);
        else if (e.kind === 'B2B' && e.uin) add32(uin, e.pos, sign * s.txval, sign * s.iamt);
      }
    }
  }

  // Inward side.
  const pick = (rows) => rows.filter((d) => issued(d) && inPeriod(d, period));
  const vendorById = new Map(vendors.map((v) => [String(v.id), v]));
  const inward = [...pick(bills), ...pick(expenses)];
  const dn = pick(debitNotes);
  const rcm = inward.filter((d) => d.reverseCharge);
  const regular = inward.filter((d) => !d.reverseCharge);
  const overseas = (d) => {
    const v = vendorById.get(String(d.vendorId ?? d.partyId ?? ''));
    const country = text(v?.billingAddress?.country || v?.country);
    return Boolean(country) && !/^(india|in|ind)$/i.test(country);
  };
  const imports = regular.filter((d) => overseas(d) && Number(d.igstTotal) > 0);
  const domestic = regular.filter((d) => !imports.includes(d));
  // ITC the business has marked as not available (blocked credit, section 17(5)).
  const ineligible = (d) => d.itcEligible === false || d.itcBlocked === true;

  /** Tax on an RCM document: its own totals, or worked out from its lines when it charged none. */
  const rcmTax = (d) => {
    const own = { iamt: Number(d.igstTotal ?? 0), camt: Number(d.cgstTotal ?? 0), samt: Number(d.sgstTotal ?? 0) };
    if (own.iamt || own.camt || own.samt) return own;
    const pos = posCode(d.placeOfSupplyState, d.vendorGstin || d.partyGstin) || ctx.companyState;
    const inter = pos !== ctx.companyState;
    const lines = docLines(d);
    const rows = lines.length ? lines.map((l) => ({ rt: Number(l.gstRate) || 0, txval: lineValue(l) })) : [{ rt: impliedRate(d), txval: Number(d.subtotal ?? 0) }];
    return rows.reduce((s, r) => {
      const t = taxOf(r.txval, r.rt, inter);
      return { iamt: s.iamt + t.iamt, camt: s.camt + t.camt, samt: s.samt + t.samt };
    }, { iamt: 0, camt: 0, samt: 0 });
  };

  // 3.1(d): inward supplies liable to reverse charge.
  const isup = { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
  for (const d of rcm) {
    const t = rcmTax(d);
    isup.txval += Number(d.subtotal ?? d.taxableTotal ?? 0);
    isup.iamt += t.iamt;
    isup.camt += t.camt;
    isup.samt += t.samt;
  }

  const heads = (rows) => ({ iamt: total(rows, 'igstTotal'), camt: total(rows, 'cgstTotal'), samt: total(rows, 'sgstTotal') });
  const minus = (a, b) => ({ iamt: a.iamt - b.iamt, camt: a.camt - b.camt, samt: a.samt - b.samt });
  const plus = (a, b) => ({ iamt: a.iamt + b.iamt, camt: a.camt + b.camt, samt: a.samt + b.samt });
  const zero = { iamt: 0, camt: 0, samt: 0 };

  // 4(A): ITC available. Imports of goods carry IGST only; RCM inward credit is ISRC.
  const impg = { ...zero, iamt: total(imports, 'igstTotal') };
  const isrc = rcm.reduce((s, d) => plus(s, rcmTax(d)), zero);
  const oth = minus(heads(domestic), heads(dn));
  // 4(B)(1): blocked credit reversed (rules 38, 42, 43 and section 17(5)); 4(B)(2): other reversals made by journal.
  const rul = inward.filter(ineligible).reduce((s, d) => plus(s, d.reverseCharge ? rcmTax(d) : heads([d])), zero);
  const revOth = journalItcReversal(journalEntries, period);

  const row = (ty, t) => ({ ty, iamt: r2(t.iamt), camt: r2(t.camt), samt: r2(t.samt), csamt: 0 });
  const itcAvl = [row('IMPG', impg), row('IMPS', zero), row('ISRC', isrc), row('ISD', zero), row('OTH', oth)];
  const itcRev = [row('RUL', rul), row('OTH', { iamt: Math.max(0, revOth.iamt), camt: Math.max(0, revOth.camt), samt: Math.max(0, revOth.samt) })];
  const net = [impg, isrc, oth].reduce(plus, zero);
  const reversed = itcRev.reduce((s, r) => plus(s, r), zero);
  const itcNet = minus(net, reversed);

  const fin = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r2(v)]));
  const list32 = (m) => [...m.values()].filter((p) => r2(p.txval) || r2(p.iamt)).sort((a, b) => a.pos.localeCompare(b.pos)).map((p) => ({ pos: p.pos, txval: r2(p.txval), iamt: r2(p.iamt) }));

  return {
    gstin: ctx.companyGstin,
    ret_period: period,
    sup_details: {
      osup_det: fin(box.a),
      osup_zero: { txval: r2(box.b.txval), iamt: r2(box.b.iamt), csamt: 0 },
      osup_nil_exmp: { txval: r2(box.c.txval) },
      isup_rev: fin(isup),
      osup_nongst: { txval: r2(box.e.txval) },
    },
    inter_sup: {
      unreg_details: list32(unreg),
      comp_details: list32(comp),
      uin_details: list32(uin),
    },
    itc_elg: {
      itc_avl: itcAvl,
      itc_rev: itcRev,
      itc_net: { iamt: r2(itcNet.iamt), camt: r2(itcNet.camt), samt: r2(itcNet.samt), csamt: 0 },
      itc_inelg: [row('RUL', zero), row('OTH', zero)],
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
