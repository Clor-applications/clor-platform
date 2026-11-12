import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { nicInv01Schema, validateInv01 } from '../gst/nicSchema.js';
import { buildInv01, type Inv01Input } from '../gst/inv01.js';
import { uqcOf, stateCodeOf } from '../gst/codes.js';

/**
 * The INV-01 payload, checked against NIC's own published schema (version
 * 1.1, from the IRP sandbox's Generate IRN page) and NIC's own sample request.
 */

const nicSample = () => JSON.parse(readFileSync(new URL('./fixtures/nicInv01Sample.json', import.meta.url), 'utf8'));

/**
 * NIC's sample request with its placeholders ("37xxxxxxxxx", a null
 * e-commerce GSTIN and export duty) filled in with values of the right shape.
 * Everything else is NIC's text.
 */
const filledSample = () => {
  const s = nicSample();
  s.SellerDtls.Gstin = '37ABCDE1234F1ZZ';
  s.BuyerDtls.Gstin = '29AWGPV7107B1ZF';
  s.ShipDtls.Gstin = '29AWGPV7107B1ZF';
  delete s.TranDtls.EcmGstin;
  s.ExpDtls.ExpDuty = 0;
  s.EwbDtls.TransId = '12AWGPV7107B1ZU';
  return s;
};

describe("NIC's INV-01 schema", () => {
  it('reads as a JSON schema with NIC rules intact', () => {
    const schema: any = nicInv01Schema();
    expect(schema.required).toEqual(['Version', 'TranDtls', 'DocDtls', 'SellerDtls', 'BuyerDtls', 'ItemList', 'ValDtls']);
    expect(schema.properties.TranDtls.properties.SupTyp.enum).toEqual([
      'B2B', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP', 'RCMDOM', 'RCMIMP', 'SEZWPA', 'SEZWPNA',
    ]);
    expect(schema.properties.DocDtls.properties.Typ.enum).toEqual(['INV', 'CRN', 'DBN']);
    expect(schema.properties.ItemList.type).toBe('array');
    expect(schema.properties.ItemList.items.required).toContain('HsnCd');
    // The required list NIC misplaced among RefDtls's properties lands on PrecDocDtls.
    expect(schema.properties.RefDtls.properties.PrecDocDtls.items.required).toEqual(['InvNo', 'InvDt']);
    expect(schema.properties.RefDtls.properties.required).toBeUndefined();
  });

  it("accepts NIC's own sample request", () => {
    expect(validateInv01(filledSample())).toEqual([]);
  });

  it('refuses what the IRP refuses', () => {
    const s = filledSample();
    s.TranDtls.SupTyp = 'B2C';
    s.DocDtls.Typ = 'BIL';
    delete s.ItemList[0].HsnCd;
    s.ItemList[0].IsServc = 'X';
    s.BuyerDtls.Pos = '0';
    const fields = validateInv01(s).map((i) => i.field);
    expect(fields).toEqual(
      expect.arrayContaining(['TranDtls.SupTyp', 'DocDtls.Typ', 'ItemList[1].HsnCd', 'ItemList[1].IsServc', 'BuyerDtls.Pos'])
    );
  });
});

describe('codes', () => {
  it('maps item units to UQC', () => {
    expect(uqcOf('Pcs')).toBe('PCS');
    expect(uqcOf('kg')).toBe('KGS');
    expect(uqcOf('Litre')).toBe('LTR');
    expect(uqcOf('BOX')).toBe('BOX');
    expect(uqcOf('hour')).toBe('OTH');
    expect(uqcOf('')).toBe('');
  });
  it('reads state names and codes', () => {
    expect(stateCodeOf('Karnataka')).toBe('29');
    expect(stateCodeOf('Tamil Nadu')).toBe('33');
    expect(stateCodeOf('Jammu and Kashmir')).toBe('01');
    expect(stateCodeOf('29-Karnataka')).toBe('29');
    expect(stateCodeOf('')).toBe('');
  });
});

const base = (over: Partial<Inv01Input['doc']> = {}, buyer: Partial<Inv01Input['buyer']> = {}): Inv01Input => ({
  docType: 'INV',
  doc: {
    number: 'INV/26-27/0042',
    date: '2026-08-18',
    partyGstin: '29AWGPV7107B1ZF',
    partyName: 'Vyas Traders',
    placeOfSupplyState: 'Karnataka',
    igstTotal: 0,
    total: 1994,
    lines: [
      { itemId: 'rice', description: 'Basmati rice', quantity: 10, rate: 100, gstRate: 5 },
      { itemId: 'repair', description: 'Machine repair', quantity: 1, rate: 800, gstRate: 18 },
    ],
    ...over,
  },
  seller: {
    gstin: '29ABCDE1234F1ZW',
    legalName: 'Kaveri Foods Private Limited',
    address1: '12, 3rd Cross, Jayanagar',
    city: 'Bengaluru',
    pincode: '560011',
    state: 'Karnataka',
  },
  buyer: {
    legalName: 'Vyas Traders',
    registrationType: 'REGULAR',
    address1: '44 Market Road',
    city: 'Mysuru',
    pincode: '570001',
    state: 'Karnataka',
    country: 'India',
    ...buyer,
  },
  items: new Map([
    ['rice', { name: 'Basmati rice', hsnSac: '10063020', unit: 'Kg', itemType: 'STOCK' }],
    ['repair', { name: 'Machine repair', hsnSac: '998719', unit: '', itemType: 'SERVICE' }],
  ]),
});

const okPayload = (input: Inv01Input) => {
  const r = buildInv01(input);
  if (!r.ok) throw new Error(r.issues.join('\n'));
  expect(validateInv01(r.payload)).toEqual([]);
  return r.payload as any;
};

describe('buildInv01', () => {
  it('builds a B2B intra-state invoice that passes the schema', () => {
    const p = okPayload(base());
    expect(p.TranDtls).toMatchObject({ TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' });
    expect(p.DocDtls).toEqual({ Typ: 'INV', No: 'INV/26-27/0042', Dt: '18/08/2026' });
    expect(p.BuyerDtls).toMatchObject({ Gstin: '29AWGPV7107B1ZF', Pos: '29', Stcd: '29', Pin: 570001 });
    expect(p.ItemList[0]).toMatchObject({ IsServc: 'N', HsnCd: '10063020', Unit: 'KGS', AssAmt: 1000, CgstAmt: 25, SgstAmt: 25 });
    expect(p.ValDtls).toMatchObject({ AssVal: 1800, CgstVal: 97, SgstVal: 97, IgstVal: 0, TotInvVal: 1994 });
    expect(p.ValDtls.RndOffAmt).toBeUndefined();
  });

  it('marks SAC lines as services and leaves Unit off when the service has none', () => {
    const p = okPayload(base());
    expect(p.ItemList[1].IsServc).toBe('Y');
    expect(p.ItemList[1].Unit).toBeUndefined();
  });

  it('calls a line a service from its SAC even when the item says stock', () => {
    const input = base();
    input.items.set('repair', { name: 'Machine repair', hsnSac: '998719', unit: 'Nos', itemType: 'STOCK' });
    const p = okPayload(input);
    expect(p.ItemList[1]).toMatchObject({ IsServc: 'Y', Unit: 'NOS' });
  });

  it('refuses a line with no HSN instead of inventing one', () => {
    const input = base();
    input.items.set('rice', { name: 'Basmati rice', hsnSac: '', unit: 'Kg', itemType: 'STOCK' });
    const r = buildInv01(input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.join(' ')).toMatch(/Line 1 \(Basmati rice\) has no HSN\/SAC code/);
    expect(JSON.stringify(r.payload)).not.toContain('9989');
  });

  it('never sends B2C: an unregistered domestic buyer is refused', () => {
    const r = buildInv01(base({ partyGstin: '' }, { registrationType: 'UNREGISTERED' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]).toMatch(/not e-invoiced/);
    expect((r.payload as any).TranDtls.SupTyp).not.toBe('B2C');
  });

  it('uses IGST and the buyer state for an inter-state sale', () => {
    const p = okPayload(base({ placeOfSupplyState: 'Tamil Nadu', partyGstin: '33AWGPV7107B1ZQ', igstTotal: 194 }, { state: 'Tamil Nadu', pincode: '600001' }));
    expect(p.BuyerDtls).toMatchObject({ Pos: '33', Stcd: '33' });
    expect(p.ItemList[0]).toMatchObject({ IgstAmt: 50, CgstAmt: 0, SgstAmt: 0 });
    expect(p.ValDtls.IgstVal).toBe(194);
  });

  it('files a sale to an SEZ unit as SEZWP or SEZWOP', () => {
    const withIgst = okPayload(base({ igstTotal: 194 }, { registrationType: 'SEZ' }));
    expect(withIgst.TranDtls.SupTyp).toBe('SEZWP');
    expect(withIgst.ValDtls.IgstVal).toBe(194);
    const underLut = okPayload(base({ total: 1800 }, { registrationType: 'SEZ' }));
    expect(underLut.TranDtls.SupTyp).toBe('SEZWOP');
    expect(underLut.ValDtls).toMatchObject({ IgstVal: 0, CgstVal: 0, SgstVal: 0, TotInvVal: 1800 });
  });

  it('files an export as EXPWOP with URP, place of supply 96 and the country', () => {
    const p = okPayload(
      base(
        { partyGstin: '', placeOfSupplyState: '', total: 1800, currency: 'USD' },
        { registrationType: 'OVERSEAS', country: 'United Arab Emirates', pincode: '', state: '', city: 'Dubai' }
      )
    );
    expect(p.TranDtls.SupTyp).toBe('EXPWOP');
    expect(p.BuyerDtls).toMatchObject({ Gstin: 'URP', Pos: '96', Stcd: '96', Pin: 999999 });
    expect(p.ExpDtls).toEqual({ CntCode: 'AE', ForCur: 'USD' });
  });

  it('takes an explicit deemed-export supply type from the document', () => {
    const p = okPayload(base({ supplyType: 'DEXP', igstTotal: 194, placeOfSupplyState: 'Tamil Nadu', partyGstin: '33AWGPV7107B1ZQ' }, { state: 'Tamil Nadu', pincode: '600001' }));
    expect(p.TranDtls.SupTyp).toBe('DEXP');
  });

  it('refuses a with-payment type on a document that charges no IGST', () => {
    const r = buildInv01(base({ supplyType: 'EXPWP', total: 1800 }));
    expect(r.ok).toBe(false);
  });

  it('builds a credit note as CRN pointing at the original invoice', () => {
    const input = base({ number: 'CN-7', original: { number: 'INV/26-27/0042', date: '2026-08-18' } });
    input.docType = 'CRN';
    const p = okPayload(input);
    expect(p.DocDtls.Typ).toBe('CRN');
    expect(p.RefDtls).toEqual({ PrecDocDtls: [{ InvNo: 'INV/26-27/0042', InvDt: '18/08/2026' }] });
  });

  it('builds a debit note as DBN', () => {
    const input = base({ number: 'DN-3' });
    input.docType = 'DBN';
    expect(okPayload(input).DocDtls.Typ).toBe('DBN');
  });

  it('sets the reverse-charge flag', () => {
    expect(okPayload(base({ reverseCharge: true })).TranDtls.RegRev).toBe('Y');
  });

  it('puts small rounding into RndOffAmt and refuses totals that disagree', () => {
    expect(okPayload(base({ total: 1994.4 })).ValDtls).toMatchObject({ RndOffAmt: 0.4, TotInvVal: 1994.4 });
    const r = buildInv01(base({ total: 5000 }));
    expect(r.ok).toBe(false);
  });

  it('lists every missing company and buyer detail at once', () => {
    const input = base({}, { pincode: '', address1: '' });
    input.seller.pincode = '';
    const r = buildInv01(input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Company PIN code/),
        expect.stringMatching(/Buyer PIN code/),
        expect.stringMatching(/Buyer address/),
      ])
    );
  });

  it('turns a schema failure into plain words', () => {
    const r = buildInv01(base({ number: '0INV-1' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]).toMatch(/^Document number/);
  });
});
