/**
 * Today and offsets as YYYY-MM-DD, for form defaults.
 *
 * Hoisted out of component initializers: a `Date.now()` written inline in a
 * lazy useState reads as an impure render to the React compiler, and the same
 * two lines were pasted into every document form anyway.
 */
export const todayIso = () => new Date().toISOString().split('T')[0];

export const plusDaysIso = (days) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

/**
 * A date as this country writes it: 12/09/2026, not 2026-09-12.
 *
 * Every date in the product was rendered as the ISO string it is stored as,
 * which is the right shape for storage, for sorting and for an API — and the
 * wrong one to read. An Indian book-keeper reads 09/12 as the ninth of
 * December; the returns, the challans and the vouchers are all dd/mm/yyyy.
 *
 * Storage does not move: this formats on the way out, and anything that
 * compares or sorts still sees the ISO value.
 */
export const formatDateIn = (value) => {
  const iso = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/**
 * The calendar date where the reader is, as YYYY-MM-DD.
 *
 * `todayIso()` is UTC, which is what a form default wants — it has to match
 * the day the server will store. This is for a date a person reads: "As of …"
 * on a report header, "Last signed in …" beside a user. East of UTC those two
 * disagree for the first hours of the day, and a trial balance headed with
 * yesterday at 2am is simply wrong.
 *
 * Also the safe way in from a timestamp: slicing an ISO datetime to ten
 * characters gives the UTC date, which is a different day from the one the
 * reader just lived through.
 */
export const localDateIso = (value = new Date()) => {
  /* `new Date(null)` is the epoch, not an invalid date, so a missing value
     would render as 01/01/1970 rather than as nothing. Refuse it up front. */
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The reverse, for anything that takes typing: 12/09/2026 → 2026-09-12. */
export const parseDateIn = (text) => {
  const raw = String(text || '').trim();
  const m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
  const [, d, mo, y] = m;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
