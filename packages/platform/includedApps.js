/**
 * People includes Attendance (owner, 9 Nov 2026).
 *
 * A company on People has every Attendance screen inside People's Time menu,
 * so it is not shown a second app with the same screens: no tile, no rail
 * entry, nothing under "More apps". The plan still carries Attendance and the
 * server still answers its routes; this is only about what is listed and
 * where a link lands. A company with Attendance alone sees no difference.
 *
 * Pure functions, so the shell and the Workspace can share them and the rules
 * can be tested without a browser.
 */

/** The app each included app is shown inside. */
export const INCLUDED_IN = { attendance: 'people' };

/** The app `id` is shown inside for a company with these apps, or null when it stands on its own. */
export const includedIn = (id, apps = []) => {
  const host = INCLUDED_IN[id];
  return host && (apps || []).includes(host) ? host : null;
};

/** The apps to list: an app shown inside another the company has is left out. */
export const shownApps = (apps = []) => (apps || []).filter((a) => !includedIn(a, apps));

/**
 * Attendance's screen keys that People names differently. People took most of
 * Attendance's keys as they are (apps/people/manifest.jsx), so only the ones
 * that differ are listed; '' is People's home, for a screen People has no
 * counterpart of. A key not listed opens the same key in People.
 */
const PEOPLE_SCREEN_OF = {
  today: 'attendance',
  me: 'myDays',
  requests: 'attendanceRequests',
  calendar: 'register',
  punches: 'transactions',
  devices: 'readers',
  positions: 'jobPositions',
  resignations: 'leavers',
  transfer: 'lifecycleChanges',
  portalAccess: 'selfService',
  setup: 'settings',
  /* People's own `reports` is its report list; Attendance's reports are a screen of their own there. */
  reports: 'attendanceReports',
  reportInsights: 'attendanceReports',
  reportDepartment: 'attendanceReports',
  reportTimecard: 'attendanceReports',
  reportLeave: 'leaveRegister',
  reportReaderPunches: 'transactions',
  /* Closing the company is the Workspace's job on a People plan. */
  closeCompany: '',
};

/**
 * Where a link into one app lands for a company with these apps.
 *
 * `{ app: 'attendance', screen: 'today' }` for a People company is
 * `{ app: 'people', screen: 'attendance' }`; a screen People has no match for
 * is People's home (`screen: ''`). Anything else comes back as it was.
 * `hostScreens` is the host app's screen table (its manifest's `screens`).
 */
export function resolveIncludedLink({ app, screen = '' }, apps = [], hostScreens = {}) {
  const host = includedIn(app, apps);
  if (!host) return { app, screen: screen || '', moved: false };
  if (!screen) return { app: host, screen: '', moved: true };
  const named = Object.prototype.hasOwnProperty.call(PEOPLE_SCREEN_OF, screen) ? PEOPLE_SCREEN_OF[screen] : screen;
  return { app: host, screen: named && hostScreens?.[named] ? named : '', moved: true };
}

/** The keys with a different name in People, for the test that checks each lands on a real screen. */
export const PEOPLE_SCREEN_ALIASES = PEOPLE_SCREEN_OF;
