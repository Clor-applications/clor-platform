/**
 * Round 34 picks (owner, 18 Nov 2026), the small rules that need no screen of
 * their own.
 *
 * fyLabel     — the financial year reads "FY 2026–27" (fylabel A): the form the
 *               Income Tax site uses, with an en dash, everywhere it is shown.
 * waitingSaid — what a screen reader hears after a "Waiting" status: the word
 *               and how long (srlabel C), "2 days", "less than a day".
 * returnPath  — where a sign-in through the company's provider comes back to
 *               (deeplink A): the page the person was opening, not Home.
 */

/** "2026-27" or "2026-2027" → "FY 2026–27". Anything else is returned as given, prefixed. */
export function fyLabel(fy) {
  const s = String(fy ?? '').trim();
  const m = s.match(/^(\d{4})\s*[-–]\s*(\d{2}|\d{4})$/);
  if (!m) return s ? `FY ${s}` : '';
  return `FY ${m[1]}–${m[2].slice(-2)}`;
}

/** How long a request has waited, said after its status word: "2 days", "1 day", "less than a day". */
export function waitingSaid(since, now = Date.now()) {
  const at = new Date(since).getTime();
  if (!Number.isFinite(at)) return '';
  const days = Math.max(0, Math.floor((now - at) / 86_400_000));
  if (days === 0) return 'less than a day';
  return days === 1 ? '1 day' : `${days} days`;
}

/** The current page as a same-site return path, without a provider's error note. */
export function returnPath(loc = typeof window !== 'undefined' ? window.location : null) {
  if (!loc) return '/';
  const q = new URLSearchParams(loc.search || '');
  q.delete('sso_error');
  const search = q.toString();
  const path = `${loc.pathname || '/'}${search ? `?${search}` : ''}${loc.hash || ''}`;
  return path.startsWith('/') && !path.startsWith('//') ? path : '/';
}
