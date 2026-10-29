import { activeApp } from '@ui/utils/activeApp';
import { usePermissions } from '@ui/permissions/usePermissions';

/**
 * Time & Leave screens are shared by People and Attendance (TIME-LEAVE-DECISIONS.md,
 * "One engine, two doors"): one set of screens over one API, so the two apps
 * never show the same request differently. What differs per app lives here.
 */

/** A grant the signed-in user holds (admins hold all). The server checks again; this only hides what would be refused. */
export const can = (perms, key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));

/** What asking for leave, checking in and changing one's own requests need (server: `can(CREATE, R.self)`). */
export const SELF_ACT = 'ATTENDANCE::My Attendance::CREATE';

/**
 * Whether the signed-in person may act on their own days, so nobody sees a
 * button the server refuses (People audit, 30 Oct 2026, gap 3). Fails open
 * while the permissions are loading or could not be read: the server decides.
 */
export const useCanActForSelf = () => {
  const perms = usePermissions();
  if (!perms || perms.loading || perms.error) return true;
  return can(perms, SELF_ACT);
};

const APP_NAME = { people: 'People', attendance: 'Attendance' };

/* The app these screens are open in lives with the general helpers; re-exported so older imports keep working. */
export { activeApp };

/** The page header's crumbs: the app, then the module, named the same in both apps. */
export const homeCrumbs = () => [{ label: APP_NAME[activeApp()] || 'People' }, { label: activeApp() === 'attendance' ? 'Time & Leave' : 'Time' }];

/** A server timestamp's day in India (createdAt is UTC; slicing it would put an evening request on the day before). */
export const istDay = (at) => new Date(new Date(at).getTime() + 330 * 60_000).toISOString().slice(0, 10);
