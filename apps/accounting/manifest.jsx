import { BookOpen } from 'lucide-react';

import AccountingRoot from './src/App';

/**
 * Everything the shell knows about Accounting.
 *
 * Accounting is the oldest and largest application in Clor, and until now it
 * was also the host: the shell, the navigation and every other app's routes
 * lived inside its own App.jsx. Here it is one app among four, with no special
 * standing — the platform bar above it is the same bar Payroll gets.
 *
 * It declares `Root` rather than a nav and a screen map. An app may hand the
 * shell a list of screens and let the shell arrange them, as Payroll does, or
 * it may take the area under the platform bar and draw its own navigation —
 * which is what an application with a hundred screens, grouped menus, a
 * command palette and its own editors actually needs. Both are manifests; the
 * shell does not care which, and neither reaches into the other.
 *
 * Nothing of the application was left behind in the move. What was removed is
 * only what the shell now owns: the login gate, and the token watching that
 * went with it.
 */
export const accountingApp = {
  id: 'accounting',
  name: 'Accounting',
  icon: BookOpen,
  blurb: 'Invoices, bills, GST, and a double-entry ledger that balances itself.',
  available: true,
  database: 'accounting.db',

  /** The app draws everything under the platform bar. */
  Root: AccountingRoot,
};
