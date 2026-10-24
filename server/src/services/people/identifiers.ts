/**
 * Format checks for Indian identifiers (docs/people/02-PRD.md CORE-04). A
 * wrong shape is refused with the shape it should have; nothing here says
 * a number is real, only that it could be.
 */
export const FORMATS = {
  pan: { re: /^[A-Z]{5}\d{4}[A-Z]$/, example: 'ABCDE1234F' },
  uan: { re: /^\d{12}$/, example: '12 digits' },
  esic: { re: /^\d{10}(\d{7})?$/, example: '10 or 17 digits' },
  ifsc: { re: /^[A-Z]{4}0[A-Z0-9]{6}$/, example: 'HDFC0001234' },
  aadhaarLast4: { re: /^\d{4}$/, example: 'the last 4 digits only' },
  passportNumber: { re: /^[A-Z][0-9]{7}$/, example: 'A1234567' },
  workPermitNumber: { re: /^[A-Z0-9/-]{4,30}$/, example: 'letters, digits, / and -' },
} as const;

export type IdentifierKind = keyof typeof FORMATS;

/** Null when fine, otherwise the message to show. */
export function checkIdentifier(kind: IdentifierKind, value: string | null | undefined): string | null {
  const v = String(value || '').trim();
  if (!v) return null;
  const { re, example } = FORMATS[kind];
  return re.test(v) ? null : `${LABELS[kind]} looks like ${example}.`;
}

export const LABELS: Record<IdentifierKind, string> = {
  pan: 'PAN', uan: 'UAN', esic: 'ESIC number', ifsc: 'IFSC', aadhaarLast4: 'Aadhaar', passportNumber: 'Passport number', workPermitNumber: 'Work permit number',
};

/** Masked for display: the last `keep` characters, the rest starred; never more than eight stars. */
export const maskTail = (v: string | null | undefined, keep = 4) => {
  const s = String(v || '').trim();
  if (!s) return '';
  return s.length <= keep ? '*'.repeat(s.length) : `${'*'.repeat(Math.min(8, s.length - keep))}${s.slice(-keep)}`;
};
