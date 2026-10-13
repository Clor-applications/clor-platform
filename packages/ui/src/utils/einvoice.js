import { GST_STATE_BY_CODE } from './gst';

/**
 * e-Invoice (INV-01) and e-Way Bill (EWB-01) payloads in the NIC schema.
 *
 * Two ways to use these: today, download the JSON and upload it through the
 * NIC portal's bulk-generation tool — no GSP account needed; later, the same
 * payload posts to a GSP's IRP endpoint once credentials exist (the payload
 * is the hard part, the transport is a POST).
 *
 * Schema: e-Invoice 1.1 (IRN generation), e-Way Bill JSON as accepted by the
 * ewaybillgst portal's bulk tool. Only sections this product has data for are
 * emitted; the bulk tools treat absent optional sections as empty.
 */

const STATE_CODE_BY_NAME = Object.fromEntries(
  Object.entries(GST_STATE_BY_CODE).map(([code, name]) => [String(name).toLowerCase(), code])
);

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const stateCode = (name, gstin) => {
  const byName = STATE_CODE_BY_NAME[String(name || '').trim().toLowerCase()];
  if (byName) return byName;
  const g = String(gstin || '').slice(0, 2);
  return /^\d\d$/.test(g) ? g : '';
};

/** "2026-08-18" → "18/08/2026" — NIC's date format. */
const nicDate = (iso) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : '';
};

const itemList = (invoice, isIntra) => {
  const items = Array.isArray(invoice.items) && invoice.items.length ? invoice.items : null;
  const rows = items || [
    {
      description: 'As per invoice',
      quantity: 1,
      rate: Number(invoice.subtotal ?? 0),
      gstRate:
        Number(invoice.subtotal ?? 0) > 0
          ? Math.round((Number(invoice.gstTotal ?? 0) / Number(invoice.subtotal)) * 100)
          : 0,
    },
  ];

  return rows.map((line, i) => {
    const qty = Number(line.quantity ?? 1) || 1;
    const taxable = Number.isFinite(Number(line.taxableAmount))
      ? Number(line.taxableAmount)
      : qty * Number(line.rate ?? 0);
    const rt = Number(line.gstRate ?? 0);
    const gst = r2((taxable * rt) / 100);
    return {
      SlNo: String(i + 1),
      PrdDesc: String(line.description || line.itemName || 'Item'),
      IsServc: 'N',
      HsnCd: String(line.hsnSac || '9989'),
      Qty: qty,
      Unit: 'NOS',
      UnitPrice: r2(line.rate ?? taxable / qty),
      TotAmt: r2(taxable),
      AssAmt: r2(taxable),
      GstRt: rt,
      IgstAmt: isIntra ? 0 : gst,
      CgstAmt: isIntra ? r2(gst / 2) : 0,
      SgstAmt: isIntra ? r2(gst / 2) : 0,
      CesAmt: 0,
      TotItemVal: r2(taxable + gst),
    };
  });
};

export function buildEInvoicePayload({ invoice, company, customer = {} }) {
  const sellerState = stateCode(company.state, company.gstin);
  const buyerGstin = String(invoice.customerGstin || customer.gstin || '').trim();
  const buyerState = stateCode(invoice.placeOfSupplyState || customer.state, buyerGstin) || sellerState;
  const isIntra = Number(invoice.igstTotal ?? 0) <= 0.004;

  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: buyerGstin ? 'B2B' : 'B2C', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: 'INV', No: String(invoice.number || ''), Dt: nicDate(invoice.date) },
    SellerDtls: {
      Gstin: String(company.gstin || '').trim(),
      LglNm: String(company.name || ''),
      Addr1: String(company.address || company.addressLine1 || '-'),
      Loc: String(company.city || company.state || '-'),
      Pin: Number(String(company.pincode || '000000').replace(/\D/g, '')) || 0,
      Stcd: sellerState,
    },
    BuyerDtls: {
      Gstin: buyerGstin || 'URP',
      LglNm: String(invoice.customerName || customer.name || 'Customer'),
      Pos: buyerState,
      Addr1: String(customer.billingAddress?.line1 || customer.address || '-'),
      Loc: String(customer.billingAddress?.city || invoice.placeOfSupplyState || '-'),
      Pin: Number(String(customer.billingAddress?.pincode || '000000').replace(/\D/g, '')) || 0,
      Stcd: buyerState,
    },
    ItemList: itemList(invoice, isIntra),
    ValDtls: {
      AssVal: r2(invoice.subtotal ?? invoice.taxableTotal ?? 0),
      IgstVal: r2(invoice.igstTotal ?? 0),
      CgstVal: r2(invoice.cgstTotal ?? 0),
      SgstVal: r2(invoice.sgstTotal ?? 0),
      CesVal: 0,
      TotInvVal: r2(invoice.total ?? 0),
    },
  };
}

export function buildEwayBillPayload({ invoice, company, customer = {}, transport = {}, docType = 'INV', subSupplyType = '1' }) {
  const sellerState = stateCode(company.state, company.gstin);
  const buyerGstin = String(invoice.customerGstin || customer.gstin || '').trim();
  const buyerState = stateCode(invoice.placeOfSupplyState || customer.state, buyerGstin) || sellerState;
  const isIntra = Number(invoice.igstTotal ?? 0) <= 0.004;

  return {
    version: '1.0.0621',
    billLists: [
      {
        userGstin: String(company.gstin || '').trim(),
        supplyType: 'O',
        subSupplyType: String(subSupplyType || '1'),
        docType: String(docType || 'INV'),
        docNo: String(invoice.number || ''),
        docDate: nicDate(invoice.date),
        fromGstin: String(company.gstin || '').trim(),
        fromTrdName: String(company.name || ''),
        fromStateCode: Number(sellerState) || 0,
        actualFromStateCode: Number(sellerState) || 0,
        fromPincode: Number(String(company.pincode || '0').replace(/\D/g, '')) || 0,
        toGstin: buyerGstin || 'URP',
        toTrdName: String(invoice.customerName || customer.name || 'Customer'),
        toStateCode: Number(buyerState) || 0,
        actualToStateCode: Number(buyerState) || 0,
        toPincode: Number(String(customer.billingAddress?.pincode || '0').replace(/\D/g, '')) || 0,
        totalValue: r2(invoice.subtotal ?? 0),
        cgstValue: isIntra ? r2(invoice.cgstTotal ?? 0) : 0,
        sgstValue: isIntra ? r2(invoice.sgstTotal ?? 0) : 0,
        igstValue: isIntra ? 0 : r2(invoice.igstTotal ?? 0),
        cessValue: 0,
        totInvValue: r2(invoice.total ?? 0),
        transMode: String(transport.mode || '1'),
        transDistance: String(transport.distanceKm || '0'),
        transporterName: String(transport.transporterName || ''),
        transporterId: String(transport.transporterId || ''),
        transDocNo: String(transport.transDocNo || ''),
        transDocDate: transport.transDocDate ? nicDate(transport.transDocDate) : '',
        vehicleNo: String(transport.vehicleNo || ''),
        vehicleType: 'R',
        itemList: itemList(invoice, isIntra).map((it) => ({
          productName: it.PrdDesc,
          hsnCode: Number(it.HsnCd) || 0,
          quantity: it.Qty,
          qtyUnit: it.Unit,
          taxableAmount: it.AssAmt,
          sgstRate: isIntra ? it.GstRt / 2 : 0,
          cgstRate: isIntra ? it.GstRt / 2 : 0,
          igstRate: isIntra ? 0 : it.GstRt,
          cessRate: 0,
        })),
      },
    ],
  };
}
