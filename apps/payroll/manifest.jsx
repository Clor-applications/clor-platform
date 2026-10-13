import { ArrowUpRight, BadgePercent, BarChart3, CalendarClock, FileText, Landmark, Layers, ListChecks, Percent, RefreshCw, SlidersHorizontal, Table2, Users, Wallet } from 'lucide-react';

import PayrollOverview from './src/screens/PayrollOverview';
import PayRuns from './src/screens/PayRuns';
import SalarySlips from './src/screens/SalarySlips';
import PayrollPayments from './src/screens/PayrollPayments';
import PayrollAdjustments from './src/screens/PayrollAdjustments';
import SalaryStructures from './src/screens/SalaryStructures';
import SalaryAssignments from './src/screens/SalaryAssignments';
import SalaryRevisions from './src/screens/SalaryRevisions';
import PayrollLoans from './src/screens/PayrollLoans';
import PayrollCompliance from './src/screens/PayrollCompliance';
import PayrollReports from './src/screens/PayrollReports';
import PayrollLedgerMapping from './src/screens/PayrollLedgerMapping';
import SalaryComponents from './src/screens/SalaryComponents';
import PayGroups from './src/screens/PayGroups';
import PayrollPeriods from './src/screens/PayrollPeriods';
import PayrollSetup from './src/screens/PayrollSetup';

/**
 * Everything the shell knows about Payroll.
 *
 * Its navigation, its screens, and where it opens. Nothing else — no route
 * table shared with another app, no entry in anybody else's sidebar. Deleting
 * this file removes Payroll from Clor without leaving a hole in Accounting,
 * which is the test of whether the boundary is real.
 *
 * Payroll owns payroll.db and reaches Accounting only through an adapter, so a
 * company that has Payroll and not Accounting still gets everything here
 * except the one thing that genuinely needs a ledger: posting.
 */
export const payrollApp = {
  id: 'payroll',
  name: 'Payroll',
  icon: Wallet,
  blurb: 'Salaries, statutory deductions, payslips, and the journal they post.',
  available: true,
  database: 'payroll.db',
  home: 'overview',

  nav: [
    { key: 'overview', label: 'Overview', icon: BarChart3 },
    { key: 'runs', label: 'Pay Runs', icon: CalendarClock },
    { key: 'slips', label: 'Salary Slips', icon: FileText },
    { key: 'payments', label: 'Payments', icon: ArrowUpRight },
    { key: 'adjustments', label: 'Adjustments', icon: Percent },
    /*
     * The four screens payroll is configured with.
     *
     * All four were built and none of them was listed here, so the components
     * a salary is made of, the groups a run is filtered by, the periods a run
     * happens in and the setup checklist that reports on all three were
     * reachable from nowhere at all — the app could be read but not set up.
     * A screen nobody can navigate to is a screen that does not exist.
     */
    { key: 'components', label: 'Salary Components', icon: SlidersHorizontal },
    { key: 'structures', label: 'Salary Structures', icon: Layers },
    { key: 'assignments', label: 'Salary Assignments', icon: Users },
    { key: 'revisions', label: 'Salary Revisions', icon: RefreshCw },
    { key: 'loans', label: 'Loans & Advances', icon: Landmark },
    { key: 'compliance', label: 'Compliance', icon: BadgePercent },
    { key: 'periods', label: 'Pay Calendar', icon: CalendarClock },
    { key: 'payGroups', label: 'Pay Groups', icon: Users },
    { key: 'reports', label: 'Reports', icon: Table2 },
    { key: 'ledgers', label: 'Ledger mapping', icon: Landmark },
    { key: 'setup', label: 'Setup', icon: ListChecks },
  ],

  screens: {
    overview: PayrollOverview,
    runs: PayRuns,
    slips: SalarySlips,
    payments: PayrollPayments,
    adjustments: PayrollAdjustments,
    structures: SalaryStructures,
    assignments: SalaryAssignments,
    revisions: SalaryRevisions,
    loans: PayrollLoans,
    compliance: PayrollCompliance,
    reports: PayrollReports,
    ledgers: PayrollLedgerMapping,
    components: SalaryComponents,
    periods: PayrollPeriods,
    payGroups: PayGroups,
    setup: PayrollSetup,
  },
};
