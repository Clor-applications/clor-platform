import { exploreExchange } from '@platform/auth';

/* Explore's link and words (Explore.jsx): kept apart from the components. */

export const KNOWN_APPS = new Set(['accounting', 'payroll', 'people', 'attendance']);
export const EXPLORE_TEXT = 'You’re looking at a sample company. Nothing you change is saved.';

/** Is this the /explore page? */
export const isExplorePath = (pathname = typeof window === 'undefined' ? '' : window.location.pathname) => /^\/explore\/?$/.test(String(pathname || ''));

/** The link's token and app, read once; the address loses the token straight away. */
function readLink() {
  try {
    const q = new URLSearchParams(window.location.search);
    const token = String(q.get('t') || '').trim();
    const app = String(q.get('app') || '').trim();
    window.history.replaceState(null, '', '/explore');
    return { token, app: KNOWN_APPS.has(app) ? app : '' };
  } catch {
    return { token: '', app: '' };
  }
}

/* One exchange per token, however many times the page's effect runs (React's strict mode runs it twice). */
const exchanges = new Map();
export const exchangeOnce = (token) => {
  if (!exchanges.has(token)) exchanges.set(token, exploreExchange(token));
  return exchanges.get(token);
};

let linkOnce = null;
/** The link, read once per page load: the first read takes the token out of the address. */
export const readLinkOnce = () => {
  if (!linkOnce) linkOnce = readLink();
  return linkOnce;
};
