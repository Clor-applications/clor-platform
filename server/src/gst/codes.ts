/**
 * GST code lists the e-invoice payload needs: state codes and units of
 * quantity (UQC).
 */

export const GST_STATE_BY_CODE: Record<string, string> = {
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
  '97': 'Other Territory',
};

/** NIC's state code for a supply to a place outside India. */
export const OUTSIDE_INDIA = '96';

const squash = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\band\b/g, '&')
    .replace(/[^a-z&]/g, '');

const CODE_BY_NAME = new Map(Object.entries(GST_STATE_BY_CODE).map(([code, name]) => [squash(name), code]));
CODE_BY_NAME.set(squash('Dadra and Nagar Haveli and Daman and Diu'), '26');
CODE_BY_NAME.set(squash('Orissa'), '21');
CODE_BY_NAME.set(squash('Pondicherry'), '34');
CODE_BY_NAME.set(squash('Jammu and Kashmir'), '01');

/** A state's two-digit GST code, from its name or a code typed as the name ("29", "29-Karnataka"). */
export function stateCodeOf(nameOrCode: unknown): string {
  const raw = String(nameOrCode ?? '').trim();
  const lead = raw.match(/^(\d{1,2})\b/);
  if (lead) {
    const code = lead[1].padStart(2, '0');
    if (GST_STATE_BY_CODE[code] || code === OUTSIDE_INDIA) return code;
  }
  return CODE_BY_NAME.get(squash(raw)) || '';
}

/** The GST portal's unit-of-quantity codes. */
export const UQC_CODES = new Set([
  'BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN', 'DOZ', 'DRM', 'GGK',
  'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS', 'NOS', 'OTH', 'PAC', 'PCS', 'PRS', 'QTL',
  'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM', 'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS',
]);

/** Everyday unit names as people type them on an item, to their UQC. */
const UQC_BY_NAME: Record<string, string> = {
  pc: 'PCS', pcs: 'PCS', piece: 'PCS', pieces: 'PCS', no: 'NOS', nos: 'NOS', number: 'NOS', numbers: 'NOS',
  kg: 'KGS', kgs: 'KGS', kilogram: 'KGS', kilograms: 'KGS', g: 'GMS', gm: 'GMS', gms: 'GMS', gram: 'GMS', grams: 'GMS',
  l: 'LTR', ltr: 'LTR', ltrs: 'LTR', litre: 'LTR', litres: 'LTR', liter: 'LTR', liters: 'LTR', ml: 'MLT',
  m: 'MTR', mtr: 'MTR', mtrs: 'MTR', meter: 'MTR', metre: 'MTR', meters: 'MTR', metres: 'MTR', cm: 'CMS', km: 'KME',
  sqft: 'SQF', sqm: 'SQM', sqyd: 'SQY', yd: 'YDS', yard: 'YDS', yards: 'YDS',
  box: 'BOX', boxes: 'BOX', set: 'SET', sets: 'SET', pack: 'PAC', packs: 'PAC', pkt: 'PAC', packet: 'PAC',
  dozen: 'DOZ', doz: 'DOZ', pair: 'PRS', pairs: 'PRS', roll: 'ROL', rolls: 'ROL', bag: 'BAG', bags: 'BAG',
  btl: 'BTL', bottle: 'BTL', bottles: 'BTL', can: 'CAN', cans: 'CAN', carton: 'CTN', cartons: 'CTN', drum: 'DRM',
  ton: 'TON', tons: 'TON', tonne: 'MTS', tonnes: 'MTS', mt: 'MTS', qtl: 'QTL', quintal: 'QTL',
  bundle: 'BDL', bundles: 'BDL', bdl: 'BDL', unit: 'UNT', units: 'UNT', tube: 'TUB', tubes: 'TUB',
};

/** The UQC for an item's unit, or '' when the item has no unit. Units that match nothing file as OTH (others). */
export function uqcOf(unit: unknown): string {
  const raw = String(unit ?? '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (UQC_CODES.has(upper)) return upper;
  return UQC_BY_NAME[raw.toLowerCase().replace(/[.\s]/g, '')] || 'OTH';
}

/** SAC codes (services) all sit in chapter 99 of the HSN. */
export const isSacCode = (code: unknown) => /^99\d{2,6}$/.test(String(code ?? '').trim());
