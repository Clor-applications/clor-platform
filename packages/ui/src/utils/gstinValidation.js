const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function gstinError(value) {
  const gstin = String(value || '').trim().toUpperCase();
  if (!gstin) return '';
  if (gstin.length !== 15) return 'GSTIN must contain exactly 15 characters.';
  if (gstin[13] !== 'Z') return 'The 14th character of a GSTIN must be Z. Check the number on your GST registration certificate.';
  if (!FORMAT.test(gstin)) return 'Enter a 15-character GSTIN in the correct format.';
  let factor = 2;
  let sum = 0;
  for (let index = 13; index >= 0; index -= 1) {
    const product = factor * CHARS.indexOf(gstin[index]);
    sum += Math.floor(product / 36) + product % 36;
    factor = factor === 2 ? 1 : 2;
  }
  const expected = CHARS[(36 - sum % 36) % 36];
  return gstin[14] === expected ? '' : 'GSTIN checksum does not match. Check the number with your registration document.';
}
