/* Money in the operator console: paise in, rupees out, never through a float on the way in. */

/** ₹1,23,456.50 the Indian way; whole rupees drop the paise. */
export function inr(paise) {
  if (paise == null || Number.isNaN(Number(paise))) return '—';
  const n = Number(paise);
  const abs = Math.abs(n);
  const s = String(Math.floor(abs / 100));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const fraction = abs % 100;
  return `${n < 0 ? '−' : ''}₹${rest ? `${rest},` : ''}${last3}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}`;
}

/** What a person typed in rupees ("1,250.5") as paise (125050), or null when it is not an amount. */
export function toPaise(text) {
  const t = String(text ?? '').replace(/[₹,\s]/g, '');
  if (t === '') return null;
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}

/** Paise as the rupees to put back in an input: 125050 -> "1250.50", 30000 -> "300". */
export function rupeesText(paise) {
  if (paise == null) return '';
  const whole = Math.floor(paise / 100);
  const f = paise % 100;
  return f ? `${whole}.${String(f).padStart(2, '0')}` : String(whole);
}
