// GSTIN validation helpers
// - Format: 15 chars
// - First 2 digits: state code
// - 15th char: checksum (GSTIN check digit)

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function badRequest(message: string): Error {
  const err: any = new Error(message);
  err.status = 400;
  return err;
}

export function gstinStateCode(gstin: string): string {
  const g = String(gstin || '').trim().toUpperCase();
  return g.slice(0, 2);
}

export function isValidGstinFormat(gstin: string): boolean {
  const g = String(gstin || '').trim().toUpperCase();
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(g);
}

function charToValue(ch: string): number {
  const idx = GSTIN_CHARS.indexOf(ch);
  return idx;
}

function valueToChar(v: number): string {
  return GSTIN_CHARS[v] || '';
}

// GSTIN checksum algorithm (mod 36)
export function isValidGstinChecksum(gstin: string): boolean {
  const g = String(gstin || '').trim().toUpperCase();
  if (!isValidGstinFormat(g)) return false;

  const payload = g.slice(0, 14);
  const check = g.slice(14, 15);

  let factor = 2;
  let sum = 0;
  const mod = 36;

  for (let i = payload.length - 1; i >= 0; i--) {
    const codePoint = charToValue(payload[i]);
    if (codePoint < 0) return false;

    let addend = factor * codePoint;
    factor = factor === 2 ? 1 : 2;

    addend = Math.floor(addend / mod) + (addend % mod);
    sum += addend;
  }

  const remainder = sum % mod;
  const checkCodePoint = remainder === 0 ? 0 : mod - remainder;
  return valueToChar(checkCodePoint) === check;
}

export function validateGstinOrThrow(gstin: string, addressState: string): void {
  const g = String(gstin || '').trim().toUpperCase();
  if (!g) return; // optional GSTIN allowed for Unregistered

  if (!isValidGstinFormat(g)) {
    throw badRequest('Invalid GSTIN format');
  }
  if (!isValidGstinChecksum(g)) {
    throw badRequest('Invalid GSTIN checksum');
  }

  // State match check is done using state code. Your UI can use state names; backend compares code.
  const gstState = gstinStateCode(g);
  const stateCodeFromAddress = deriveStateCodeFromInput(addressState);
  if (stateCodeFromAddress && gstState !== stateCodeFromAddress) {
    throw badRequest(`GSTIN state code (${gstState}) does not match address state (${stateCodeFromAddress})`);
  }
}

// Accept either state code "29" or state name "Karnataka".
export function deriveStateCodeFromInput(state: string): string {
  const s = String(state || '').trim();
  if (!s) return '';
  if (/^[0-9]{2}$/.test(s)) return s;
  const key = s.toLowerCase();
  return STATE_NAME_TO_CODE.get(key) || '';
}

// Minimal mapping; extend as needed.
// Production apps should keep this in a single authoritative table.
const STATE_NAME_TO_CODE = new Map<string, string>([
  ['jammu and kashmir', '01'],
  ['himachal pradesh', '02'],
  ['punjab', '03'],
  ['chandigarh', '04'],
  ['uttarakhand', '05'],
  ['haryana', '06'],
  ['delhi', '07'],
  ['rajasthan', '08'],
  ['uttar pradesh', '09'],
  ['bihar', '10'],
  ['sikkim', '11'],
  ['arunachal pradesh', '12'],
  ['nagaland', '13'],
  ['manipur', '14'],
  ['mizoram', '15'],
  ['tripura', '16'],
  ['meghalaya', '17'],
  ['assam', '18'],
  ['west bengal', '19'],
  ['jharkhand', '20'],
  ['odisha', '21'],
  ['orissa', '21'],
  ['chhattisgarh', '22'],
  ['madhya pradesh', '23'],
  ['gujarat', '24'],
  ['dadra and nagar haveli and daman and diu', '26'],
  ['maharashtra', '27'],
  ['karnataka', '29'],
  ['goa', '30'],
  ['lakshadweep', '31'],
  ['kerala', '32'],
  ['tamil nadu', '33'],
  ['puducherry', '34'],
  ['pondicherry', '34'],
  ['andaman and nicobar islands', '35'],
  ['telangana', '36'],
  ['andhra pradesh', '37'],
  ['ladakh', '38'],
  ['other territory', '97'],
]);
