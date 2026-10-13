import { BookOpen, Briefcase, UserRound, Wallet } from 'lucide-react';

import { accountingApp } from '../../apps/accounting/manifest.jsx';
import { payrollApp } from '../../apps/payroll/manifest.jsx';
import { attendanceApp } from '../../apps/attendance/manifest.jsx';

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
  accountingApp,
  payrollApp,
  attendanceApp,
  planned('people', 'People', UserRound, 'The staff directory every other app refers to.'),
  planned('projects', 'Projects', Briefcase, 'Projects, time, and what each of them cost.'),
];

export const appById = (id) => APPS.find((a) => a.id === id) || null;

/** The apps this tenant has bought. */
export const subscribedApps = (subscriptions) =>
  APPS.filter((a) => a.available && subscriptions.includes(a.id));

/** The apps it has not. */
export const availableApps = (subscriptions) =>
  APPS.filter((a) => !subscriptions.includes(a.id));

/**
 * Where somebody lands.
 *
 * One app means that app — a company that bought Clor for Payroll should not
 * arrive in a ledger it does not keep. Several means Accounting, because that
 * is where the day starts for the companies that have both.
 */
export const landingApp = (subscriptions) => {
  const mine = subscribedApps(subscriptions);
  if (mine.length === 1) return mine[0];
  return mine.find((a) => a.id === 'accounting') || mine[0] || null;
};

export { BookOpen, Wallet };
