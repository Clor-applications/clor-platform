/* The /start page's address (Start.jsx): kept apart from the components so the shell can route on it. */

/** The site's product slugs and the shell's app ids, both accepted. */
const APP_OF = { books: 'accounting', accounting: 'accounting', people: 'people', attendance: 'attendance', payroll: 'payroll' };
export const appOf = (v) => APP_OF[String(v || '').toLowerCase()] || '';

/** Is this the /start page? */
export const isStartPath = (pathname = typeof window === 'undefined' ? '' : window.location.pathname) => /^\/start\/?$/.test(String(pathname || ''));

/**
 * What the address says: the link's token (`t`, from the mail), the app the
 * pricing button named (`app`) and the plan (`plan`). The token leaves the
 * address at once, so a reload or a shared screenshot does not carry it.
 */
function readLink() {
  try {
    const q = new URLSearchParams(window.location.search);
    const token = String(q.get('t') || '').trim();
    const app = appOf(q.get('app'));
    const plan = String(q.get('plan') || '').trim().toLowerCase();
    if (token) {
      const keep = new URLSearchParams();
      if (app) keep.set('app', app);
      if (plan) keep.set('plan', plan);
      window.history.replaceState(null, '', `/start${keep.toString() ? `?${keep}` : ''}`);
    }
    return { token, app, plan };
  } catch {
    return { token: '', app: '', plan: '' };
  }
}

let linkOnce = null;
/** The link, read once per page load. */
export const readStartLinkOnce = () => {
  if (!linkOnce) linkOnce = readLink();
  return linkOnce;
};
/* Tests only: the next read looks at the address again. */
export const forgetStartLink = () => {
  linkOnce = null;
};
