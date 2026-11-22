/**
 * Strings in the employee app's code that a person never reads, so no language
 * file needs them: CSS selectors and values, header names, error class names,
 * key names, placeholders that are patterns, and the amount-in-words speller
 * (utils/money.js), which the employee app imports for rupee formatting but
 * never shows. `scripts/i18n-strings.mjs --missing` leaves these out.
 */
export const NOT_SHOWN = new Set([
  'ABCD-EFGH', /* activation code pattern */
  'XXXX XXXX {}', /* a masked number */
  'Bearer {}',
  'Content-Disposition',
  'NotAllowedError',
  'SignedOut',
  'PageDown',
  'PageUp',
  'Missing active org. Please select an organization.', /* @platform/http, CLOR users only */
  'Non-JSON {} response from the API:',
  '[hidden], [aria-hidden="true"]',
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  'input, select, textarea, [role="combobox"]',
  '(prefers-reduced-motion: reduce)', /* a media query */
  'font-medium {}',
  'truncate {}',
  'noopener noreferrer',
  'repeat({}, minmax(0, 1fr))',
  'translate3d(0, {}px, 0)',
  'Files', /* the type a dragged file carries (FileDrop.jsx) */
  '[data-file-drop], input[type="file"]',
  /* utils/money.js amount in words */
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty', 'Thirty', 'Forty',
  'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety', 'Thousand', 'Million', 'Billion', '{} Hundred{}', '{}{} {}{} Only',
  'Rupees', 'Paise', 'Dollars', 'Cents', 'Euros', 'Pounds', 'Pence', 'Dirhams', 'Fils', 'minor units',
]);
