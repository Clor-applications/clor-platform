// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { b2clLimitFor, buildGstr1Json, buildGstr3bJson } from './gstrExport';

/**
 * GSTR-1 and GSTR-3B JSON, validated against GSTN's own request schemas
 * (__fixtures__/gstn/README.md says where they come from), with the numbers
 * each section should carry checked by hand.
 */

const schema = (name) => JSON.parse(readFileSync(new URL(`./__fixtures__/gstn/${name}`, import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false, multipleOfPrecision: 2 });
const gstr1Valid = ajv.compile(schema('gstr1-save-v4.1-schema.json'));
const gstr3bValid = ajv.compile(schema('gstr3b-save-v7.1-schema.json'));
const errorsOf = (validate, data) => (validate(data) ? [] : validate.errors.map((e) => `${e.instancePath} ${e.message}`));

const company = { gstin: '29ABCDE1234F1ZW', state: 'Karnataka' };
const items = [
  { id: 'rice', name: 'Basmati rice', hsnSac: '10063020', unit: 'Kg', taxability: 'Taxable' },
  { id: 'repair', name: 'Machine repair', hsnSac: '998719', unit: '', taxability: 'Taxable' },
  { id: 'milk', name: 'Fresh milk', hsnSac: '04011000', unit: 'Ltr', taxability: 'Exempt' },
  { id: 'petrol', name: 'Petrol', hsnSac: '27101241', unit: 'Ltr', taxability: 'Non-GST' },
];
const customers = [
  { id: 'reg', gstRegistration: 'Registered', billingAddress: { country: 'India' } },
  { id: 'sez', gstRegistrationType: 'SEZ', billingAddress: { country: 'India' } },
  { id: 'comp', gstRegistration: 'Registered', gstTaxpayerType: 'Composition', billingAddress: { country: 'India' } },
  { id: 'abroad', billingAddress: { country: 'United Arab Emirates' } },
];
const vendors = [{ id: 'overseas-vendor', billingAddress: { country: 'China' } }];

let seq = 0;
const line = (itemId, quantity, rate, gstRate) => ({ itemId, quantity, rate, amount: quantity * rate, gstRate });
/** A sales document whose totals agree with its lines. */
const doc = (over) => {
  const lines = over.items || [];
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const gst = lines.reduce((s, l) => s + (l.amount * l.gstRate) / 100, 0);
  const inter = over.inter;
  seq += 1;
  return {
    id: `d${seq}`,
    number: `INV-${String(seq).padStart(4, '0')}`,
    status: 'Unpaid',
    date: '2026-10-05',
    placeOfSupplyState: 'Karnataka',
    subtotal,
    gstTotal: gst,
    igstTotal: inter ? gst : 0,
    cgstTotal: inter ? 0 : gst / 2,
    sgstTotal: inter ? 0 : gst / 2,
    total: subtotal + gst,
    ...over,
  };
};

const period = '102026';
const invoices = [
  // b2b, intra, two rates and an exempt line (Table 8, B2B intra)
  doc({ customerId: 'reg', customerGstin: '29AWGPV7107B1ZF', items: [line('rice', 10, 100, 5), line('repair', 1, 800, 18), line('milk', 20, 50, 0)] }),
  // b2b to a composition dealer in Tamil Nadu: inter-state, feeds 3.2 comp_details
  doc({ customerId: 'comp', customerGstin: '33AWGPV7107B1ZQ', placeOfSupplyState: 'Tamil Nadu', inter: true, items: [line('rice', 100, 100, 5)] }),
  // SEZ without payment (under LUT)
  doc({ customerId: 'sez', customerGstin: '29AWGPV7107B1ZF', items: [line('repair', 1, 50000, 18)], gstTotal: 0, igstTotal: 0, cgstTotal: 0, sgstTotal: 0, total: 50000 }),
  // export without payment
  doc({ customerId: 'abroad', placeOfSupplyState: '', items: [line('rice', 1000, 120, 0)], shippingBillNo: '1234567', shippingBillDate: '2026-10-06', portCode: 'INMAA1' }),
  // export with payment
  doc({ customerId: 'abroad', placeOfSupplyState: '', inter: true, items: [line('rice', 100, 100, 5)] }),
  // B2CL: inter-state, unregistered, ₹1.5 lakh (over ₹1 lakh)
  doc({ customerName: 'Walk-in', placeOfSupplyState: 'Kerala', inter: true, items: [line('repair', 1, 127119, 18)] }),
  // B2CS inter (₹50,000, under the limit) and intra, plus a non-GST line
  doc({ customerName: 'Walk-in', placeOfSupplyState: 'Kerala', inter: true, items: [line('repair', 1, 40000, 18)] }),
  doc({ customerName: 'Walk-in', items: [line('rice', 5, 100, 5), line('petrol', 10, 100, 0)] }),
  // a reverse-charge sale: taxable value in 3.1(a), no tax
  doc({ customerId: 'reg', customerGstin: '29AWGPV7107B1ZF', reverseCharge: true, items: [line('repair', 1, 1000, 18)], gstTotal: 0, cgstTotal: 0, sgstTotal: 0, total: 1000 }),
  // cancelled: Table 13 counts it, nothing else does
  doc({ customerName: 'Walk-in', status: 'Cancelled', items: [line('rice', 1, 100, 5)] }),
  // a draft is not a document issued
  doc({ customerName: 'Walk-in', status: 'Draft', items: [line('rice', 1, 100, 5)] }),
  // another month
  doc({ customerName: 'Walk-in', date: '2026-09-30', items: [line('rice', 1, 100, 5)] }),
];
const [b2bInv, , , expWop, , b2clInv, b2csInter] = invoices;
const creditNotes = [
  { ...doc({ customerId: 'reg', customerGstin: '29AWGPV7107B1ZF', items: [line('rice', 2, 100, 5)] }), number: 'CN-0001', againstDocId: b2bInv.id },
  { ...doc({ customerName: 'Walk-in', placeOfSupplyState: 'Kerala', inter: true, items: [line('repair', 1, 10000, 18)] }), number: 'CN-0002', againstDocId: b2clInv.id },
  { ...doc({ customerId: 'abroad', placeOfSupplyState: '', items: [line('rice', 10, 120, 0)] }), number: 'CN-0003', againstDocId: expWop.id },
  { ...doc({ customerName: 'Walk-in', placeOfSupplyState: 'Kerala', inter: true, items: [line('repair', 1, 5000, 18)] }), number: 'CN-0004', againstDocId: b2csInter.id },
];

const bills = [
  { id: 'b1', status: 'Unpaid', date: '2026-10-07', subtotal: 10000, igstTotal: 0, cgstTotal: 900, sgstTotal: 900 },
  { id: 'b2', status: 'Unpaid', date: '2026-10-08', subtotal: 5000, reverseCharge: true, placeOfSupplyState: 'Karnataka', items: [{ amount: 5000, gstRate: 18 }], igstTotal: 0, cgstTotal: 0, sgstTotal: 0 },
  { id: 'b3', status: 'Unpaid', date: '2026-10-09', subtotal: 2000, igstTotal: 360, cgstTotal: 0, sgstTotal: 0, vendorId: 'overseas-vendor' },
  { id: 'b4', status: 'Unpaid', date: '2026-10-10', subtotal: 1000, igstTotal: 0, cgstTotal: 90, sgstTotal: 90, itcEligible: false },
];
const debitNotes = [{ id: 'dn1', status: 'Open', date: '2026-10-12', subtotal: 1000, igstTotal: 0, cgstTotal: 90, sgstTotal: 90 }];
const journalEntries = [
  { id: 'j1', date: '2026-10-20', lines: [{ ledgerName: 'Input CGST', credit: 50 }, { ledgerName: 'Input SGST', credit: 50 }, { ledgerName: 'Office expenses', debit: 100 }] },
];

describe('B2CL limit', () => {
  it('is ₹2.5 lakh for periods before August 2024 and ₹1 lakh from then', () => {
    expect(b2clLimitFor('072024')).toBe(250000);
    expect(b2clLimitFor('032018')).toBe(250000);
    expect(b2clLimitFor('082024')).toBe(100000);
    expect(b2clLimitFor('102026')).toBe(100000);
  });

  it('files a ₹1.5 lakh inter-state B2C invoice as B2CL now, and as B2CS in July 2024', () => {
    const inv = [doc({ customerName: 'Walk-in', placeOfSupplyState: 'Kerala', inter: true, date: '2024-07-10', items: [line('repair', 1, 127119, 18)] })];
    const july = buildGstr1Json({ invoices: inv, items, company, period: '072024' });
    expect(july.b2cl).toBeUndefined();
    expect(july.b2cs[0]).toMatchObject({ sply_ty: 'INTER', pos: '32', txval: 127119 });
    const aug = buildGstr1Json({ invoices: [{ ...inv[0], date: '2024-08-10' }], items, company, period: '082024' });
    expect(aug.b2cl[0].pos).toBe('32');
  });
});

describe('GSTR-1 JSON', () => {
  const json = buildGstr1Json({ invoices, creditNotes, items, customers, company, period });

  it("passes GSTN's GSTR-1 save schema", () => {
    expect(errorsOf(gstr1Valid, json)).toEqual([]);
  });

  it('is checked by a schema that does refuse wrong shapes', () => {
    // The shape this builder used to write: Table 12 as `data`, B2CS typ "B2C", no inv_typ on notes.
    const wrong = { ...json, hsn: { data: json.hsn.hsn_b2b }, b2cs: [{ ...json.b2cs[0], typ: 'B2C' }] };
    expect(errorsOf(gstr1Valid, wrong).length).toBeGreaterThan(0);
    expect(errorsOf(gstr1Valid, { ...json, fp: '132026' }).length).toBeGreaterThan(0);
  });

  it('files registered, SEZ and reverse-charge sales in b2b with their invoice type', () => {
    const all = json.b2b.flatMap((g) => g.inv.map((i) => ({ ctin: g.ctin, ...i })));
    expect(all.map((i) => [i.ctin, i.inv_typ, i.rchrg])).toEqual([
      ['29AWGPV7107B1ZF', 'R', 'N'],
      ['29AWGPV7107B1ZF', 'SEWOP', 'N'],
      ['29AWGPV7107B1ZF', 'R', 'Y'],
      ['33AWGPV7107B1ZQ', 'R', 'N'],
    ]);
    // The exempt milk line is not in the invoice's b2b items; it is in Table 8.
    expect(all[0].itms.map((x) => x.itm_det)).toEqual([
      { rt: 5, txval: 1000, camt: 25, samt: 25, csamt: 0 },
      { rt: 18, txval: 800, camt: 72, samt: 72, csamt: 0 },
    ]);
    expect(all[1].itms[0].itm_det).toEqual({ rt: 18, txval: 50000, iamt: 0, csamt: 0 });
  });

  it('files exports in exp, by with and without payment', () => {
    const byType = Object.fromEntries(json.exp.map((e) => [e.exp_typ, e.inv]));
    expect(byType.WOPAY[0]).toMatchObject({ sbnum: '1234567', sbdt: '06-10-2026', sbpcode: 'INMAA1', itms: [{ txval: 120000, rt: 0, iamt: 0, csamt: 0 }] });
    expect(byType.WPAY[0].itms).toEqual([{ txval: 10000, rt: 5, iamt: 500, csamt: 0 }]);
  });

  it('files the large inter-state B2C invoice in b2cl and the rest in b2cs, net of their notes', () => {
    expect(json.b2cl).toEqual([{ pos: '32', inv: [expect.objectContaining({ inum: b2clInv.number, itms: [{ num: 1, itm_det: { rt: 18, txval: 127119, iamt: 22881.42, csamt: 0 } }] })] }]);
    const kerala = json.b2cs.find((r) => r.pos === '32');
    expect(kerala).toEqual({ sply_ty: 'INTER', pos: '32', typ: 'OE', rt: 18, txval: 35000, iamt: 6300, csamt: 0 });
    expect(json.b2cs.find((r) => r.pos === '29')).toMatchObject({ sply_ty: 'INTRA', rt: 5, txval: 500, camt: 12.5, samt: 12.5 });
  });

  it('files notes: registered in cdnr, B2CL and export notes in cdnur', () => {
    expect(json.cdnr[0].nt[0]).toMatchObject({ ntty: 'C', nt_num: 'CN-0001', inv_typ: 'R', itms: [{ num: 1, itm_det: { rt: 5, txval: 200, camt: 5, samt: 5, csamt: 0 } }] });
    expect(json.cdnur.map((n) => [n.typ, n.nt_num, n.pos])).toEqual([
      ['B2CL', 'CN-0002', '32'],
      ['EXPWOP', 'CN-0003', undefined],
    ]);
  });

  it('files nil-rated, exempt and non-GST supplies in Table 8', () => {
    expect(json.nil.inv).toEqual(
      expect.arrayContaining([
        { sply_ty: 'INTRAB2B', nil_amt: 0, expt_amt: 1000, ngsup_amt: 0 },
        { sply_ty: 'INTRAB2C', nil_amt: 0, expt_amt: 0, ngsup_amt: 1000 },
      ])
    );
  });

  it('splits Table 12 into B2B and B2C, services with NA and no quantity', () => {
    expect(json.hsn.hsn_b2b.find((h) => h.hsn_sc === '998719' && h.rt === 18)).toMatchObject({ uqc: 'NA', qty: 0 });
    expect(json.hsn.hsn_b2b.find((h) => h.hsn_sc === '10063020')).toMatchObject({ uqc: 'KGS', qty: 108, txval: 10800 });
    expect(json.hsn.hsn_b2c.find((h) => h.hsn_sc === '27101241')).toMatchObject({ txval: 1000, rt: 0 });
  });

  it('counts every document issued in Table 13, cancelled included and drafts not', () => {
    expect(json.doc_issue.doc_det).toEqual([
      { doc_num: 1, doc_typ: 'Invoices for outward supply', docs: [{ num: 1, from: 'INV-0001', to: 'INV-0010', totnum: 10, cancel: 1, net_issue: 9 }] },
      { doc_num: 5, doc_typ: 'Credit Note', docs: [{ num: 1, from: 'CN-0001', to: 'CN-0004', totnum: 4, cancel: 0, net_issue: 4 }] },
    ]);
  });

  it('keeps Table 12 as one list for periods before May 2025', () => {
    const old = buildGstr1Json({ invoices: [{ ...b2bInv, date: '2025-04-10' }], items, customers, company, period: '042025' });
    expect(old.hsn.data.length).toBeGreaterThan(0);
    expect(old.hsn.hsn_b2b).toBeUndefined();
  });
});

describe('GSTR-3B JSON', () => {
  const json = buildGstr3bJson({ invoices, creditNotes, bills, debitNotes, journalEntries, items, customers, vendors, company, period });

  it("passes GSTN's GSTR-3B save schema", () => {
    expect(errorsOf(gstr3bValid, json)).toEqual([]);
  });

  it('3.1(a): taxable outward supplies net of notes; reverse-charge sales add value only', () => {
    // b2b 1800 + comp 10000 + b2cl 127119 + b2cs 40000 + 500 + rcm 1000 − notes (200 + 10000 + 5000)
    expect(json.sup_details.osup_det).toEqual({ txval: 165219, iamt: 500 + 22881.42 + 7200 - 1800 - 900, camt: 97 + 12.5 - 5, samt: 97 + 12.5 - 5, csamt: 0 });
  });

  it('3.1(b): exports and SEZ supplies, net of the export note', () => {
    expect(json.sup_details.osup_zero).toEqual({ txval: 50000 + 120000 + 10000 - 1200, iamt: 500, csamt: 0 });
  });

  it('3.1(c) nil and exempt, 3.1(e) non-GST', () => {
    expect(json.sup_details.osup_nil_exmp).toEqual({ txval: 1000 });
    expect(json.sup_details.osup_nongst).toEqual({ txval: 1000 });
  });

  it('3.1(d): inward supplies on reverse charge, tax worked out when the bill charged none', () => {
    expect(json.sup_details.isup_rev).toEqual({ txval: 5000, iamt: 0, camt: 450, samt: 450, csamt: 0 });
  });

  it('3.2: inter-state supplies to unregistered persons and composition dealers', () => {
    expect(json.inter_sup.unreg_details).toEqual([{ pos: '32', txval: 127119 + 40000 - 10000 - 5000, iamt: 22881.42 + 7200 - 1800 - 900 }]);
    expect(json.inter_sup.comp_details).toEqual([{ pos: '33', txval: 10000, iamt: 500 }]);
    expect(json.inter_sup.uin_details).toEqual([]);
  });

  it('4(A): imports, reverse charge and all other ITC; 4(B): blocked credit and journal reversals; 4(C): net', () => {
    const avl = Object.fromEntries(json.itc_elg.itc_avl.map((r) => [r.ty, r]));
    expect(avl.IMPG).toMatchObject({ iamt: 360, camt: 0, samt: 0 });
    expect(avl.ISRC).toMatchObject({ camt: 450, samt: 450 });
    expect(avl.OTH).toMatchObject({ iamt: 0, camt: 900 + 90 - 90, samt: 900 + 90 - 90 });
    const rev = Object.fromEntries(json.itc_elg.itc_rev.map((r) => [r.ty, r]));
    expect(rev.RUL).toMatchObject({ camt: 90, samt: 90 });
    expect(rev.OTH).toMatchObject({ camt: 50, samt: 50 });
    expect(json.itc_elg.itc_net).toEqual({ iamt: 360, camt: 900 + 450 - 90 - 50, samt: 900 + 450 - 90 - 50, csamt: 0 });
  });

  it('is all zeros, and still valid, for an empty month', () => {
    const empty = buildGstr3bJson({ company, period: '012026' });
    expect(errorsOf(gstr3bValid, empty)).toEqual([]);
    expect(empty.sup_details.osup_zero).toEqual({ txval: 0, iamt: 0, csamt: 0 });
  });
});
