/**
 * Round 43 picks (18 Nov 2026), the employee record.
 *
 *  - aadhaarmask A: only the last four digits of Aadhaar are ever shown, written
 *    as "XXXX XXXX 1234" so it reads as a masked number, not a short code.
 *    (CLOR keeps only the last four; the full number is never stored.)
 *  - maritalchange A: when someone changes their marital status themselves, the
 *    next thing to update (nominee, family cover) is asked straight after.
 */

/** "1234" → "XXXX XXXX 1234"; anything that is not four digits → "". */
export function maskedAadhaar(last4) {
  const d = String(last4 ?? '').replace(/\D/g, '');
  return d.length === 4 ? `XXXX XXXX ${d}` : '';
}

/**
 * The line shown after a marital status change, or null when it did not change.
 * Married: add the spouse as nominee and to the health cover. Divorced or widowed:
 * check the nominee and the cover still name the right people.
 */
export function maritalNextStep(before, after) {
  const was = String(before || '');
  const now = String(after || '');
  if (!now || now === was) return null;
  if (now === 'MARRIED') return 'Next: add your husband or wife as a nominee (Privacy, Name a nominee) and ask HR to add them to your health cover.';
  if (now === 'DIVORCED' || now === 'WIDOWED') return 'Next: check your nominee (Privacy, Name a nominee) and ask HR to update who your health cover includes.';
  return null;
}
