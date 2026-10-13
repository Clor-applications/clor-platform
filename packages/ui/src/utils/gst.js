import { round2 } from './money';

export const GST_STATE_BY_CODE = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman & Diu',
  '26': 'Dadra & Nagar Haveli',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

export const getGstStateFromGstin = (gstin) => {
  const code = String(gstin || '').trim().slice(0, 2);
  if (!/^[0-9]{2}$/.test(code)) return '';
  return GST_STATE_BY_CODE[code] || '';
};

export const normalizeState = (value) => String(value || '').trim().toLowerCase();

export const getCompanyGstProfile = (company) => {
  return {
    gstin: String(company?.gstin || '').trim(),
    state: String(company?.state || '').trim(),
    gstRegistration: company?.gstRegistration || 'Registered',
  };
};

export const getPartyGstProfile = (party) => {
  return {
    gstin: String(party?.gstin || '').trim(),
    state: String(party?.billingAddress?.state || party?.state || '').trim(),
    gstRegistration: party?.gstRegistration || 'Unregistered',
  };
};

export const isIntraStateSupply = ({ companyState, partyState }) => {
  const a = normalizeState(companyState);
  const b = normalizeState(partyState);
  if (!a || !b) return true;
  return a === b;
};

export const canDetermineSupplyType = ({ companyState, partyState }) => {
  const a = normalizeState(companyState);
  const b = normalizeState(partyState);
  return Boolean(a && b);
};

export const computeGstForLine = ({ quantity, rate, gstRate, isIntra, discountPct, discountAmount }) => {
  const qty = Number(quantity);
  const r = Number(rate);
  const gr = Number(gstRate);

  const gross = round2((Number.isFinite(qty) ? qty : 0) * (Number.isFinite(r) ? r : 0));
  // Per-line discount: percentage first, then a flat amount — both optional.
  const pct = Number(discountPct);
  const amt = Number(discountAmount);
  let discount = 0;
  if (Number.isFinite(pct) && pct > 0) discount += gross * (Math.min(pct, 100) / 100);
  if (Number.isFinite(amt) && amt > 0) discount += amt;
  discount = round2(Math.min(discount, gross));
  const taxable = round2(gross - discount);
  const gst = round2(taxable * ((Number.isFinite(gr) ? gr : 0) / 100));

  if (isIntra) {
    const half = round2(gst / 2);
    return {
      taxableAmount: taxable,
      grossAmount: gross,
      discountApplied: discount,
      gstAmount: gst,
      cgstAmount: half,
      sgstAmount: half,
      igstAmount: 0,
      lineTotal: round2(taxable + gst),
      taxType: 'CGST_SGST',
    };
  }

  return {
    taxableAmount: taxable,
    grossAmount: gross,
    discountApplied: discount,
    gstAmount: gst,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: gst,
    lineTotal: round2(taxable + gst),
    taxType: 'IGST',
  };
};

export const computeGstForLines = ({ lines, isIntra, invoiceDiscount, otherCharges }) => {
  const normalizedLines = Array.isArray(lines) ? lines : [];

  // Invoice-level discount is applied proportionally to every line's taxable
  // value BEFORE GST — the GST-correct treatment (discount known at supply).
  const grossSubtotal = round2(
    normalizedLines.reduce((sum, l) => {
      const line = computeGstForLine({
        quantity: Number(l.quantity ?? 1),
        rate: Number(l.rate ?? 0),
        gstRate: 0,
        isIntra,
        discountPct: l.discountPct,
        discountAmount: l.discountAmount,
      });
      return sum + line.taxableAmount;
    }, 0)
  );
  let invoiceDiscountValue = 0;
  if (invoiceDiscount && grossSubtotal > 0) {
    const v = Number(invoiceDiscount.value);
    if (Number.isFinite(v) && v > 0) {
      invoiceDiscountValue =
        String(invoiceDiscount.type) === 'pct' ? round2(grossSubtotal * (Math.min(v, 100) / 100)) : round2(Math.min(v, grossSubtotal));
    }
  }
  const scale = grossSubtotal > 0 ? (grossSubtotal - invoiceDiscountValue) / grossSubtotal : 1;

  const computedLines = normalizedLines.map((l) => {
    const quantity = Number(l.quantity ?? 1);
    const rate = Number(l.rate ?? 0);
    const gstRate = Number(l.gstRate ?? 0);
    const computed = computeGstForLine({
      quantity,
      rate: rate * scale,
      gstRate,
      isIntra,
      discountPct: l.discountPct,
      discountAmount: (Number(l.discountAmount) || 0) * scale,
    });

    return {
      ...l,
      quantity: Number.isFinite(quantity) ? quantity : 1,
      rate: Number.isFinite(rate) ? rate : 0,
      gstRate: Number.isFinite(gstRate) ? gstRate : 0,
      amount: computed.taxableAmount,
      taxableAmount: computed.taxableAmount,
      gstAmount: computed.gstAmount,
      cgstAmount: computed.cgstAmount,
      sgstAmount: computed.sgstAmount,
      igstAmount: computed.igstAmount,
      lineTotal: computed.lineTotal,
      taxType: computed.taxType,
    };
  });

  const subtotal = round2(computedLines.reduce((sum, l) => sum + (l.taxableAmount || 0), 0));
  const cgstTotal = round2(computedLines.reduce((sum, l) => sum + (l.cgstAmount || 0), 0));
  const sgstTotal = round2(computedLines.reduce((sum, l) => sum + (l.sgstAmount || 0), 0));
  let igstTotal = round2(computedLines.reduce((sum, l) => sum + (l.igstAmount || 0), 0));
  let cgstT = cgstTotal;
  let sgstT = sgstTotal;

  // Other charges (transport, packing, reimbursement…) are taxed like lines
  // but reported separately from the item table.
  const chargeRows = (Array.isArray(otherCharges) ? otherCharges : [])
    .filter((c) => Number(c?.amount) > 0)
    .map((c) => {
      const computed = computeGstForLine({ quantity: 1, rate: Number(c.amount), gstRate: Number(c.gstRate ?? 0), isIntra });
      return { label: String(c.label || 'Other charges'), amount: computed.taxableAmount, gstRate: Number(c.gstRate ?? 0), ...computed };
    });
  const otherChargesTotal = round2(chargeRows.reduce((s, c) => s + c.taxableAmount, 0));
  cgstT = round2(cgstT + chargeRows.reduce((s, c) => s + c.cgstAmount, 0));
  sgstT = round2(sgstT + chargeRows.reduce((s, c) => s + c.sgstAmount, 0));
  igstTotal = round2(igstTotal + chargeRows.reduce((s, c) => s + c.igstAmount, 0));

  const gstTotal = round2(cgstT + sgstT + igstTotal);
  const total = round2(subtotal + otherChargesTotal + gstTotal);

  return {
    lines: computedLines,
    subtotal,
    invoiceDiscount: invoiceDiscountValue,
    otherCharges: chargeRows,
    otherChargesTotal,
    cgstTotal: cgstT,
    sgstTotal: sgstT,
    igstTotal,
    gstTotal,
    total,
  };
};
