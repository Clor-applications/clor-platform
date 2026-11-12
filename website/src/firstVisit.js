/**
 * Where this visit started (platform audit, 11 Nov 2026: sales could not tell
 * which channel a demo request came from). The first page of a visit keeps its
 * utm_ tags, the referring site and the page itself in sessionStorage, so a
 * form filled three pages later still says where the visitor came from. No
 * cookie, nothing kept after the tab closes, nothing sent until a form is sent.
 */
const KEY = 'clor.firstVisit';
const cut = (v, n) => (v ? String(v).slice(0, n) : null);

export function keepFirstVisit() {
  try {
    if (window.sessionStorage.getItem(KEY)) return;
    const q = new URLSearchParams(window.location.search);
    const ref = document.referrer && !/^https?:\/\/([^/]+\.)?clor\.in(\/|$)/.test(document.referrer) ? document.referrer : null;
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        utm_source: cut(q.get('utm_source'), 120),
        utm_medium: cut(q.get('utm_medium'), 120),
        utm_campaign: cut(q.get('utm_campaign'), 160),
        /* The referring site's address without its query, which can carry someone's details. */
        referrer: ref ? cut(ref.split(/[?#]/)[0], 300) : null,
        landing: cut(window.location.pathname, 300),
      }),
    );
  } catch {
    /* Storage blocked: the form goes without a source. */
  }
}

export function firstVisit() {
  try {
    return JSON.parse(window.sessionStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}
