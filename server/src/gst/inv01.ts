import { GST_STATE_BY_CODE, OUTSIDE_INDIA, isSacCode, stateCodeOf, uqcOf } from './codes.js';
import { validateInv01, type SchemaIssue } from './nicSchema.js';

/**
 * The NIC e-invoice (INV-01, schema 1.1) payload for one sales document.
 *
 * Built here, from what the server holds, rather than in the browser: the
 * payload is a legal filing, so it is made from the stored document and the
 * item and party masters, then checked against NIC's own schema before it
 * goes anywhere. Anything the IRP would refuse is refused here first, with a
 * message that says what to fix.
 *
 * Pure: the caller loads the rows, this shapes and checks them.
 */

export type Inv01DocType = 'INV' | 'CRN' | 'DBN';

/** Supply types this product issues. RCM and import types are the buyer's to report, not the seller's. */
export const SUPPLY_TYPES = ['B2B', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP'] as const;
export type SupplyType = (typeof SUPPLY_TYPES)[number];

export type Inv01Line = {
  itemId?: string | null;
  description?: string | null;
  quantity?: number | null;
  rate?: number | null;
  gstRate?: number | null;
  hsnSac?: string | null;
  amount?: number | null;
  taxableAmount?: number | null;
  cgstAmount?: number | null;
  sgstAmount?: number | null;
  igstAmount?: number | null;
};

export type Inv01Item = { name?: string | null; hsnSac?: string | null; unit?: string | null; itemType?: string | null };

export type Inv01Input = {
  docType: Inv01DocType;
  doc: {
    number: string;
    date: string; // ISO yyyy-mm-dd
    partyGstin?: string | null;
    partyName?: string | null;
    placeOfSupplyState?: string | null;
    reverseCharge?: boolean | null;
    igstTotal?: number | null;
    total?: number | null;
    currency?: string | null;
    /** Explicit supply type chosen on the document; otherwise worked out from the buyer. */
    supplyType?: string | null;
    otherChargesTotal?: number | null;
    lines: Inv01Line[];
    /** The invoice a credit or debit note corrects. */
    original?: { number: string; date: string } | null;
  };
  seller: {
    gstin?: string | null;
    legalName?: string | null;
    tradeName?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    pincode?: string | null;
    state?: string | null;
  };
  buyer: {
    gstin?: string | null;
    legalName?: string | null;
    /** REGULAR | COMPOSITION | UNREGISTERED | SEZ | OVERSEAS */
    registrationType?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    pincode?: string | null;
    state?: string | null;
    country?: string | null;
  };
  /** Item master rows by id, for HSN/SAC, unit and goods-or-service. */
  items: Map<string, Inv01Item>;
};

export type Inv01Result =
  | { ok: true; payload: Record<string, unknown>; supplyType: SupplyType }
  /** `b2c`: the buyer is an unregistered domestic customer, so the sale is not e-invoiced at all. */
  | { ok: false; issues: string[]; b2c: boolean; payload?: Record<string, unknown> };

const GSTIN = /^[0-9]{2}[0-9A-Z]{13}$/;
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n: unknown) => Math.round((Number(n) || 0) * 1000) / 1000;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const text = (v: unknown) => String(v ?? '').trim();
/** NIC's free-text fields refuse double quotes and backslashes. */
const clean = (v: unknown, max: number) => text(v).replace(/["\\]/g, '').replace(/\s+/g, ' ').slice(0, max);
const pin = (v: unknown) => {
  const digits = text(v).replace(/\D/g, '');
  return /^[1-9]\d{5}$/.test(digits) ? Number(digits) : null;
};
/** "2026-08-18" → "18/08/2026". */
const nicDate = (iso: string) => {
  const [y, m, d] = text(iso).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : '';
};
const isIndia = (country: unknown) => !text(country) || /^(india|in|ind|bharat)$/i.test(text(country));

/** A two-letter country code NIC accepts, when the name is one we know. */
const COUNTRY_CODES: Record<string, string> = {
  'united states': 'US', usa: 'US', us: 'US', 'united kingdom': 'GB', uk: 'GB', 'united arab emirates': 'AE', uae: 'AE',
  singapore: 'SG', germany: 'DE', france: 'FR', australia: 'AU', canada: 'CA', japan: 'JP', china: 'CN',
  netherlands: 'NL', 'saudi arabia': 'SA', nepal: 'NP', bangladesh: 'BD', 'sri lanka': 'LK', bhutan: 'BT',
  malaysia: 'MY', qatar: 'QA', oman: 'OM', kuwait: 'KW', bahrain: 'BH', italy: 'IT', spain: 'ES', switzerland: 'CH',
};
const countryCode = (country: unknown) => {
  const c = text(country);
  if (/^[A-Za-z]{2}$/.test(c)) return c.toUpperCase();
  return COUNTRY_CODES[c.toLowerCase()] || '';
};

/** Plain-words names for the fields NIC's schema checks most often fail on. */
const FIELD_LABELS: Record<string, string> = {
  'DocDtls.No': 'Document number (NIC allows up to 16 letters, digits, / and -, not starting with 0)',
  'DocDtls.Dt': 'Document date',
  'SellerDtls.Gstin': 'Company GSTIN',
  'SellerDtls.LglNm': 'Company legal name (at least 3 characters)',
  'SellerDtls.Addr1': 'Company address',
  'SellerDtls.Loc': 'Company city (at least 3 characters)',
  'SellerDtls.Pin': 'Company PIN code',
  'SellerDtls.Stcd': 'Company state',
  'BuyerDtls.Gstin': 'Buyer GSTIN',
  'BuyerDtls.LglNm': 'Buyer name (at least 3 characters)',
  'BuyerDtls.Addr1': 'Buyer address',
  'BuyerDtls.Loc': 'Buyer city (at least 3 characters)',
  'BuyerDtls.Pin': 'Buyer PIN code',
  'BuyerDtls.Pos': 'Place of supply',
  'BuyerDtls.Stcd': 'Buyer state',
};

const describeIssue = ({ field, message }: SchemaIssue) => {
  const line = field.match(/^ItemList\[(\d+)\]\.(\w+)$/);
  if (line) return `Line ${line[1]}: ${line[2]} ${message}.`;
  return `${FIELD_LABELS[field] || field} ${message}.`;
};

function pickSupplyType(input: Inv01Input, buyerGstin: string, withPayment: boolean): SupplyType | null {
  const chosen = text(input.doc.supplyType).toUpperCase();
  if ((SUPPLY_TYPES as readonly string[]).includes(chosen)) return chosen as SupplyType;
  const reg = text(input.buyer.registrationType).toUpperCase();
  if (reg === 'SEZ') return withPayment ? 'SEZWP' : 'SEZWOP';
  const pos = stateCodeOf(input.doc.placeOfSupplyState);
  if (reg === 'OVERSEAS' || !isIndia(input.buyer.country) || pos === OUTSIDE_INDIA) return withPayment ? 'EXPWP' : 'EXPWOP';
  return buyerGstin ? 'B2B' : null;
}

export function buildInv01(input: Inv01Input): Inv01Result {
  const { doc, seller, buyer, docType } = input;
  const issues: string[] = [];

  const sellerGstin = text(seller.gstin).toUpperCase();
  if (!GSTIN.test(sellerGstin)) issues.push('Company GSTIN is missing or malformed — set it in Settings → Tax & Compliance.');
  const sellerState = sellerGstin.slice(0, 2);
  const sellerPin = pin(seller.pincode);
  if (!sellerPin) issues.push('Company PIN code is missing — add it to the company address.');
  if (!text(seller.address1)) issues.push('Company address is missing — add it in Company Profile.');

  const buyerGstin = text(doc.partyGstin || buyer.gstin).toUpperCase();
  const withPayment = Number(doc.igstTotal ?? 0) > 0.004;
  const supplyType = pickSupplyType(input, buyerGstin, withPayment);
  const isExport = supplyType === 'EXPWP' || supplyType === 'EXPWOP';

  if (!supplyType) {
    issues.push('The buyer has no GSTIN. Sales to unregistered buyers (B2C) are not e-invoiced — only B2B, SEZ and export supplies are registered on the IRP.');
  } else if (!isExport) {
    if (!buyerGstin) issues.push(`A ${supplyType} e-invoice needs the buyer's GSTIN.`);
    else if (!GSTIN.test(buyerGstin)) issues.push(`Buyer GSTIN "${buyerGstin}" is malformed.`);
  }
  if ((supplyType === 'SEZWP' || supplyType === 'EXPWP') && !withPayment) {
    issues.push(`${supplyType} means IGST is paid on the supply, but this document charges no IGST.`);
  }
  if ((supplyType === 'SEZWOP' || supplyType === 'EXPWOP') && withPayment) {
    issues.push(`${supplyType} means supply under LUT without IGST, but this document charges IGST.`);
  }

  // Place of supply: the document's, else the buyer GSTIN's state. Exports are always 96.
  const pos = isExport ? OUTSIDE_INDIA : stateCodeOf(doc.placeOfSupplyState) || buyerGstin.slice(0, 2);
  if (!isExport && !GST_STATE_BY_CODE[pos]) issues.push('Place of supply is missing — set it on the document.');
  const buyerState = isExport ? OUTSIDE_INDIA : buyerGstin.slice(0, 2) || stateCodeOf(buyer.state);
  const buyerPin = isExport ? 999999 : pin(buyer.pincode);
  if (!isExport && !buyerPin) issues.push("Buyer PIN code is missing — add it to the customer's billing address.");
  if (!text(buyer.address1)) issues.push("Buyer address is missing — add it to the customer's billing address.");
  if (!text(buyer.city)) issues.push("Buyer city is missing — add it to the customer's billing address.");

  const lines = (doc.lines || []).filter((l) => num(l.amount) || num(l.taxableAmount) || (num(l.quantity) && num(l.rate)));
  if (!lines.length) issues.push('The document has no lines with an amount.');

  const isInter = withPayment || isExport || supplyType === 'SEZWOP' || supplyType === 'SEZWP' || pos !== sellerState;
  let assVal = 0;
  let igstVal = 0;
  let cgstVal = 0;
  let sgstVal = 0;

  const itemList = lines.map((l, i) => {
    const master = l.itemId ? input.items.get(String(l.itemId)) : undefined;
    const label = clean(l.description || master?.name, 300) || 'item';
    const hsn = text(l.hsnSac || master?.hsnSac).replace(/\s/g, '');
    if (!hsn) issues.push(`Line ${i + 1} (${label}) has no HSN/SAC code — add it to the item or the line.`);
    else if (!/^(?!0+$)(\d{4}|\d{6}|\d{8})$/.test(hsn)) issues.push(`Line ${i + 1} (${label}): HSN/SAC "${hsn}" must be 4, 6 or 8 digits.`);

    const service = isSacCode(hsn) || (!hsn && text(master?.itemType).toUpperCase() === 'SERVICE');
    const qty = num(l.quantity) ?? 1;
    const unitPrice = num(l.rate) ?? 0;
    const gross = r2(qty * unitPrice);
    const assessable = r2(num(l.taxableAmount) ?? num(l.amount) ?? gross);
    const discount = r2(Math.max(0, gross - assessable));
    const rt = num(l.gstRate) ?? 0;
    const tax = r2((assessable * rt) / 100);
    const igst = isInter ? (withPayment ? r2(num(l.igstAmount) ?? tax) : 0) : 0;
    const cgst = isInter ? 0 : r2(num(l.cgstAmount) ?? tax / 2);
    const sgst = isInter ? 0 : r2(num(l.sgstAmount) ?? tax / 2);
    assVal += assessable;
    igstVal += igst;
    cgstVal += cgst;
    sgstVal += sgst;

    const unit = uqcOf(master?.unit) || (service ? '' : 'OTH');
    return {
      SlNo: String(i + 1),
      PrdDesc: label.length >= 3 ? label : `${label} item`.slice(0, 300),
      IsServc: service ? 'Y' : 'N',
      HsnCd: hsn,
      Qty: r3(qty),
      ...(unit ? { Unit: unit } : {}),
      UnitPrice: r3(unitPrice || (qty ? assessable / qty : assessable)),
      TotAmt: Math.max(gross, assessable),
      ...(discount ? { Discount: discount } : {}),
      AssAmt: assessable,
      GstRt: rt,
      IgstAmt: igst,
      CgstAmt: cgst,
      SgstAmt: sgst,
      CesAmt: 0,
      TotItemVal: r2(assessable + igst + cgst + sgst),
    };
  });

  const othChrg = r2(num(doc.otherChargesTotal) ?? 0);
  const computed = r2(assVal + igstVal + cgstVal + sgstVal + othChrg);
  const total = r2(num(doc.total) ?? computed);
  const roundOff = r2(total - computed);
  if (Math.abs(roundOff) > 99.99) {
    issues.push(`The lines add up to ₹${computed.toFixed(2)} but the document total is ₹${total.toFixed(2)}. Re-save the document so its lines and total agree.`);
  }

  const docNo = text(doc.number);
  const payload: Record<string, unknown> = {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: supplyType || 'B2B',
      RegRev: doc.reverseCharge ? 'Y' : 'N',
      IgstOnIntra: supplyType === 'B2B' && withPayment && pos === sellerState ? 'Y' : 'N',
    },
    DocDtls: { Typ: docType, No: docNo, Dt: nicDate(doc.date) },
    SellerDtls: {
      Gstin: sellerGstin,
      LglNm: clean(seller.legalName, 100),
      ...(text(seller.tradeName) && text(seller.tradeName) !== text(seller.legalName) ? { TrdNm: clean(seller.tradeName, 100) } : {}),
      Addr1: clean(seller.address1, 100),
      ...(text(seller.address2).length >= 3 ? { Addr2: clean(seller.address2, 100) } : {}),
      Loc: clean(seller.city || seller.state, 50),
      Pin: sellerPin ?? 0,
      Stcd: sellerState,
    },
    BuyerDtls: {
      Gstin: isExport ? 'URP' : buyerGstin,
      LglNm: clean(buyer.legalName || doc.partyName, 100),
      Pos: pos,
      Addr1: clean(buyer.address1, 100),
      ...(text(buyer.address2).length >= 3 ? { Addr2: clean(buyer.address2, 100) } : {}),
      Loc: clean(buyer.city, 100),
      ...(buyerPin ? { Pin: buyerPin } : {}),
      Stcd: buyerState,
    },
    ItemList: itemList,
    ValDtls: {
      AssVal: r2(assVal),
      CgstVal: r2(cgstVal),
      SgstVal: r2(sgstVal),
      IgstVal: r2(igstVal),
      CesVal: 0,
      ...(othChrg ? { OthChrg: othChrg } : {}),
      ...(roundOff && Math.abs(roundOff) <= 99.99 ? { RndOffAmt: roundOff } : {}),
      TotInvVal: total,
    },
  };

  if (docType !== 'INV' && doc.original?.number) {
    payload.RefDtls = { PrecDocDtls: [{ InvNo: text(doc.original.number), InvDt: nicDate(doc.original.date) }] };
  }
  if (isExport) {
    const cnt = countryCode(buyer.country);
    const cur = text(doc.currency).toUpperCase();
    payload.ExpDtls = {
      ...(cnt ? { CntCode: cnt } : {}),
      ...(cur && cur !== 'INR' ? { ForCur: cur } : {}),
    };
  }

  // Schema check last: business-rule messages above say more than a pattern failure would.
  if (!issues.length) issues.push(...validateInv01(payload).map(describeIssue));
  if (issues.length) return { ok: false, issues: [...new Set(issues)], b2c: !supplyType, payload };
  return { ok: true, payload, supplyType: supplyType as SupplyType };
}
