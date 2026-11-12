/**
 * Each app on its own address: books.clor.in opens Books (the accounting
 * app; accounting.clor.in still opens it, for old links and bookmarks),
 * payroll.clor.in opens Payroll. app.clor.in stays the front door (sign-in,
 * sign-up, email links) and sends a signed-in visitor on to their app.
 *
 * All of them serve the same build. The address only decides which app opens;
 * the session carries across because the refresh cookie belongs to the API
 * host, which every one of these addresses calls as the same site.
 *
 * Anywhere else — localhost, a Pages preview — there are no app addresses and
 * switching apps happens in place, as before.
 */

/**
 * Apps that have their own subdomain. attendance.clor.in used to serve the
 * old ClorTime cloud screen; from 16 Oct 2026 it opens CLOR Attendance (with
 * the employee portal at attendance.clor.in/#/portal).
 */
export const APP_HOST_IDS = ['accounting', 'payroll', 'attendance', 'people'];

/** The address label an app lives at when it differs from its id: the accounting app is Books (10 Nov 2026). */
const HOST_OF = { accounting: 'books' };
/** Address label to app: every app's own label, plus each app's old one. */
const APP_OF_LABEL = Object.fromEntries([...APP_HOST_IDS.map((id) => [id, id]), ...Object.entries(HOST_OF).map(([id, label]) => [label, id])]);

/** The workspace that lives on the front door (apps/admin). */
export const ADMIN_APP_ID = 'admin';

/** The front door's first label. */
const FRONT_DOOR = 'app';

const labels = (hostname) => String(hostname || '').toLowerCase().split('.').filter(Boolean);

/** The app this address is for, or null (front door, localhost, previews). */
/**
 * The native wrapper (mobile/<app>, Capacitor) serves the build from its own
 * origin, so no hostname can say which app it is; the build is pinned to one
 * at build time instead (VITE_MOBILE_APP=attendance).
 */
export const PINNED_APP = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_MOBILE_APP) || null;

export const appFromHost = (hostname = globalThis.location?.hostname) => {
  if (PINNED_APP) return PINNED_APP;
  const [first, ...rest] = labels(hostname);
  return rest.length >= 2 && APP_OF_LABEL[first] ? APP_OF_LABEL[first] : null;
};

/** Whether this address is the front door, app.<domain>. */
export const isFrontDoor = (hostname = globalThis.location?.hostname) => {
  const [first, ...rest] = labels(hostname);
  return rest.length >= 2 && first === FRONT_DOOR;
};

/**
 * The address an app lives at, seen from this one; null when the app has no
 * address of its own or this host is not part of the scheme (open in place).
 */
export const hostForApp = (id, hostname = globalThis.location?.hostname) => {
  if (PINNED_APP) return null;
  /* Workspace is the front door's own workspace (ADR-010): from any app's address it opens on app.<domain>. */
  if (id !== ADMIN_APP_ID && !APP_HOST_IDS.includes(id)) return null;
  const target = id === ADMIN_APP_ID ? FRONT_DOOR : HOST_OF[id] || id;
  const [first, ...rest] = labels(hostname);
  if (rest.length < 2) return null;
  if (first !== FRONT_DOOR && !APP_OF_LABEL[first]) return null;
  return [target, ...rest].join('.');
};
