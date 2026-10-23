/**
 * The company in the address: /o/KAVE-C100/… (A-26, GAP-014).
 *
 * Which company a tab shows used to come from one browser-wide store, the
 * company any tab had used last. A reload, a new tab or a link somebody sent
 * opened whichever that was — the same link showed one company to the person
 * who sent it and another to whoever opened it. Zoho Books carries the
 * organisation in the address for this reason, and so does this.
 *
 * The code is the company's own (Org.code: KAVE-C100), never its database id:
 * it is what people read on the screen, it never changes, and it says nothing
 * a stranger could use. It names a company; it grants nothing. The server
 * still decides access on every request, and a code that is not one of the
 * person's companies shows "no access" rather than quietly opening another.
 *
 * Pure functions, so the rules can be tested without a browser.
 */

const ORG_PATH = /^\/o\/([A-Za-z0-9][A-Za-z0-9-]{0,39})(?=\/|$)/;

/** The company code in this path, upper-cased, or '' when there is none. */
export const orgCodeFromPath = (pathname = '') => {
  const m = ORG_PATH.exec(String(pathname || ''));
  return m ? m[1].toUpperCase() : '';
};

/** The path without its /o/<code> prefix; always starts with '/'. */
export const withoutOrgPath = (pathname = '') => {
  const rest = String(pathname || '').replace(ORG_PATH, '');
  return rest.startsWith('/') ? rest : `/${rest}`;
};

/** The same path under another company's code (or none, when `code` is empty). */
export const withOrgPath = (pathname = '', code = '') => {
  const rest = withoutOrgPath(pathname);
  if (!code) return rest;
  return `/o/${encodeURIComponent(String(code).toUpperCase())}${rest}`;
};

/**
 * Which company this tab opens, in order:
 *   1. the address (a link, a bookmark, a reload);
 *   2. this tab's own last choice (sessionStorage — another tab switching
 *      company does not move this one);
 *   3. the company last used in this browser (a new tab with no address);
 *   4. what the server suggests, then the first company.
 *
 * Returns `{ tenant, denied }`. `denied` is the code from the address when it
 * is not one of `tenants`: the shell shows "no access" and opens nothing. It
 * never falls through to another company — that silent switch is the bug this
 * exists to end.
 */
export function chooseTenant({ tenants = [], urlCode = '', tabChoice = '', lastUsed = '', suggested = '', preferSuggested = false }) {
  const byId = (id) => (id ? tenants.find((t) => t.id === id) : null);
  if (preferSuggested && byId(suggested)) return { tenant: byId(suggested), denied: '' };
  if (urlCode) {
    const code = String(urlCode).toUpperCase();
    const hit = tenants.find((t) => String(t.code || '').toUpperCase() === code);
    return hit ? { tenant: hit, denied: '' } : { tenant: null, denied: code };
  }
  return { tenant: byId(tabChoice) || byId(lastUsed) || byId(suggested) || tenants[0] || null, denied: '' };
}

/**
 * Another app's address for this company (A-25): `//payroll.clor.in/o/KAVE-C100/?open=…`.
 * Browser storage is per address, so without the code in the path the other
 * host opened whichever company it had seen last.
 */
export const appAddress = ({ protocol = 'https:', host, code = '', search = '', hash = '' }) =>
  `${protocol}//${host}${withOrgPath('/', code)}${search}${hash}`;

/**
 * Where the front door sends a signed-in visitor (A-25): the app's own host,
 * keeping the company, ?open= and #/screen. It used to keep only the #/screen.
 * A code already in the address wins over the company the session chose.
 */
export const frontDoorForward = ({ protocol = 'https:', host, pathname = '/', search = '', hash = '', code = '' }) =>
  `${protocol}//${host}${withOrgPath(pathname, orgCodeFromPath(pathname) || code)}${search}${hash}`;

/** Storage keys: this tab's choice, and this browser's last-used company, per signed-in person. */
export const tabChoiceKey = (userId) => `clor.tab.tenant.${userId}`;
export const lastUsedKey = (userId) => `clor.tenant.${userId}`;
