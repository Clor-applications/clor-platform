/**
 * Time & Leave screens are shared by People and Attendance (TIME-LEAVE-DECISIONS.md,
 * "One engine, two doors"): one set of screens over one API, so the two apps
 * never show the same request differently. What differs per app lives here.
 */

/** A grant the signed-in user holds (admins hold all). The server checks again; this only hides what would be refused. */
export const can = (perms, key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));

const APP_NAME = { people: 'People', attendance: 'Attendance' };

/** The app these screens are open in: the shell marks the document with it. */
export const activeApp = () => (typeof document !== 'undefined' && document.documentElement.getAttribute('data-app')) || 'people';

/** The page header's crumbs: the app, then the module, named the same in both apps. */
export const homeCrumbs = () => [{ label: APP_NAME[activeApp()] || 'People' }, { label: 'Time & Leave' }];
