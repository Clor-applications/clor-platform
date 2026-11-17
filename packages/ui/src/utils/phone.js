/**
 * Show an Indian phone number the way people read it aloud: +91 98765 43210.
 * Anything that is not a ten-digit Indian mobile (landlines, foreign numbers,
 * half-typed values) comes back as it was given, so nothing is ever lost.
 */
export function formatPhone(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  const digits = raw.replace(/\D/g, '');
  let local = null;
  if (digits.length === 10) local = digits;
  else if (digits.length === 12 && digits.startsWith('91')) local = digits.slice(2);
  if (!local || !/^[6-9]/.test(local)) return raw;
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}
