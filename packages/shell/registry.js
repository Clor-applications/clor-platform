import { BookOpen, Briefcase, CalendarClock, Wallet } from '@ui/components/ui/lineIcons';

import { accountingApp } from '../../apps/accounting/manifest.jsx';
import { payrollApp } from '../../apps/payroll/manifest.jsx';
import { attendanceApp } from '../../apps/attendance/manifest.jsx';
import { peopleApp } from '../../apps/people/manifest.jsx';
import { adminApp } from '../../apps/admin/manifest.jsx';
import { INCLUDED_IN, includedIn, resolveIncludedLink, shownApps } from '@platform/includedApps';

/**
 * The applications CLOR is made of.
 *
 * This is the whole of what the shell knows about any app: a manifest. The
 * shell never imports an app's screens, and an app never imports the shell's
 * internals — they meet here and nowhere else. That is the difference between
 * a platform with apps in it and one large program with sections.
 *
 * An app that has not been built yet still appears, marked. A company choosing
 * a platform is choosing where it is going, and a roadmap stated plainly is
 * worth more than a shorter list that looks complete.
 */

/** Not built. Listed so the shell can show it, and refuse to open it. */
const planned = (id, name, icon, blurb) => ({
  id,
  name,
  icon,
  blurb,
  available: false,
  nav: [],
  screens: {},
  home: null,
});

export const APPS = [
  adminApp,
  accountingApp,
  payrollApp,
  attendanceApp,
  peopleApp,
  planned('projects', 'Projects', Briefcase, 'Plan work, track tasks and see what each project costs.'),
  planned('timesheet', 'Timesheet', CalendarClock, 'Time logged against projects and clients, approved and billed.'),
];

export const appById = (id) => APPS.find((a) => a.id === id) || null;

/**
 * The apps this tenant has bought — and the platform's own workspace
 * (Workspace, ADR-010), which nobody buys and every company has. What a
 * person sees inside it is still decided item by item, by permission.
 *
 * An app the company has inside another is not listed apart: with People,
 * Attendance is People's Time menu (@platform/includedApps). `all` lists every
 * app as it is, for the sample company somebody is exploring.
 */
const listed = (subscriptions, all) => (all ? subscriptions || [] : shownApps(subscriptions || []));

export const subscribedApps = (subscriptions, { all = false } = {}) => {
  const mine = listed(subscriptions, all);
  return APPS.filter((a) => a.available && (a.platform || mine.includes(a.id)));
};

/** The products it has not (the platform workspace is never for sale), nor has inside another. */
export const availableApps = (subscriptions, { all = false } = {}) =>
  APPS.filter((a) => !a.platform && !(subscriptions || []).includes(a.id) && (all || !includedIn(a.id, subscriptions || [])));

/** The catalogue as this company is shown it: every app, less one it has inside another. */
export const catalogueFor = (subscriptions, { all = false } = {}) => (all ? APPS : APPS.filter((a) => !includedIn(a.id, subscriptions || [])));

/**
 * Where a link into an app lands for this company: Attendance's screens are
 * People's for a company on People. `{ app, screen, moved }`.
 */
export const landingFor = (link, subscriptions, { all = false } = {}) =>
  all ? { app: link.app, screen: link.screen || '', moved: false } : resolveIncludedLink(link, subscriptions || [], appById(INCLUDED_IN[link.app])?.screens || {});

/**
 * Where somebody lands.
 *
 * One app means that app — a company that bought CLOR for Payroll should not
 * arrive in a ledger it does not keep. Several means Accounting, because that
 * is where the day starts for the companies that have both.
 */
export const landingApp = (subscriptions, opts) => {
  /* A product, never the admin workspace: on an app's own address that app opens, and only the front door opens the workspace. */
  const mine = subscribedApps(subscriptions, opts).filter((a) => !a.platform);
  if (mine.length === 1) return mine[0];
  return mine.find((a) => a.id === 'accounting') || mine[0] || null;
};

export { BookOpen, Wallet };
