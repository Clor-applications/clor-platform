import { BookOpen, Briefcase, CalendarClock, Wallet } from 'lucide-react';

import { accountingApp } from '../../apps/accounting/manifest.jsx';
import { payrollApp } from '../../apps/payroll/manifest.jsx';
import { attendanceApp } from '../../apps/attendance/manifest.jsx';
import { peopleApp } from '../../apps/people/manifest.jsx';
import { adminApp } from '../../apps/admin/manifest.jsx';

/**
 * The applications Clor is made of.
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
 */
export const subscribedApps = (subscriptions) =>
  APPS.filter((a) => a.available && (a.platform || subscriptions.includes(a.id)));

/** The products it has not (the platform workspace is never for sale). */
export const availableApps = (subscriptions) =>
  APPS.filter((a) => !a.platform && !subscriptions.includes(a.id));

/**
 * Where somebody lands.
 *
 * One app means that app — a company that bought Clor for Payroll should not
 * arrive in a ledger it does not keep. Several means Accounting, because that
 * is where the day starts for the companies that have both.
 */
export const landingApp = (subscriptions) => {
  /* A product, never the admin workspace: on an app's own address that app opens, and only the front door opens the workspace. */
  const mine = subscribedApps(subscriptions).filter((a) => !a.platform);
  if (mine.length === 1) return mine[0];
  return mine.find((a) => a.id === 'accounting') || mine[0] || null;
};

export { BookOpen, Wallet };
