/**
 * Today and offsets as YYYY-MM-DD, for form defaults.
 *
 * Hoisted out of component initializers: a `Date.now()` written inline in a
 * lazy useState reads as an impure render to the React compiler, and the same
 * two lines were pasted into every document form anyway.
 *
 * India's date (UTC+05:30), the server's `todayIst` rule. It was the UTC date,
 * so from 00:00 to 05:30 IST a new invoice was dated yesterday, its due date
 * a day short, and the TDS rule "in force today" looked up for yesterday.
 */
const IST_MS = 330 * 60 * 1000;
const istDate = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);

export const todayIso = () => istDate(Date.now());

export const plusDaysIso = (days) => istDate(Date.now() + days * 24 * 60 * 60 * 1000);

/** Today in India: the name the People, Attendance and portal screens use (the same as `todayIso`). */
export const todayIst = todayIso;

/**
 * A server timestamp's day in India. `createdAt` is UTC; slicing it would put
 * an evening request on the day before.
 */
export const istDay = (at) => istDate(new Date(at).getTime());

/** A calendar date `n` days on (or back), as YYYY-MM-DD. */
export const addDaysIso = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

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
 * `todayIso()` is India's date, which is what a form default wants — it has to
 * match the day the server will store. This is for a date a person reads: "As of …"
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
