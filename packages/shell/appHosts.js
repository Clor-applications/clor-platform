/**
 * Each app on its own address: accounting.clor.in opens Accounting,
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

/** Apps that have their own subdomain. Attendance does not: attendance.clor.in is the on-prem licence host. */
export const APP_HOST_IDS = ['accounting', 'payroll'];

/** The front door's first label. */
const FRONT_DOOR = 'app';

const labels = (hostname) => String(hostname || '').toLowerCase().split('.').filter(Boolean);

/** The app this address is for, or null (front door, localhost, previews). */
export const appFromHost = (hostname = globalThis.location?.hostname) => {
  const [first, ...rest] = labels(hostname);
  return rest.length >= 2 && APP_HOST_IDS.includes(first) ? first : null;
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
  if (!APP_HOST_IDS.includes(id)) return null;
  const [first, ...rest] = labels(hostname);
  if (rest.length < 2) return null;
  if (first !== FRONT_DOOR && !APP_HOST_IDS.includes(first)) return null;
  return [id, ...rest].join('.');
};
