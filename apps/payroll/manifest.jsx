import { ArrowUpRight, BadgePercent, Banknote, BarChart3, CalendarClock, FileText, Handshake, Landmark, Layers, ListChecks, Percent, Receipt, RefreshCw, SlidersHorizontal, Table2, Users, Wallet } from 'lucide-react';

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
import BankChanges from './src/screens/BankChanges';
import FinalSettlements from './src/screens/FinalSettlements';
import TaxDeclarations from './src/screens/TaxDeclarations';

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

  /** The phone tab bar: what a payroll admin opens most. */
  mobileTabs: ['overview', 'runs', 'slips', 'payments'],
  /* The split sidebar: modules on a rail, the open module's screens grouped (see Attendance). */
  modules: [
    { key: 'overview', label: 'Overview', items: ['overview'] },
    { key: 'runs', label: 'Pay runs', groups: [
      { label: 'Each month', items: ['runs', 'slips', 'payments'] },
      { label: 'Before the run', items: ['adjustments', 'bankChanges'] },
    ] },
    { key: 'people', label: 'Salaries', groups: [
      { label: 'Per employee', items: ['assignments', 'revisions', 'loans', 'taxDeclarations'] },
      { label: 'Leaving', items: ['settlements'] },
    ] },
    { key: 'reports', label: 'Reports', items: ['reports'] },
    { key: 'settings', label: 'Settings', groups: [
      { label: 'Setup', items: ['setup', 'periods', 'payGroups'] },
      { label: 'Salary design', items: ['components', 'structures'] },
      { label: 'Statutory', items: ['compliance', 'ledgers'] },
    ] },
  ],
  nav: [
    { key: 'overview', label: 'Overview', icon: BarChart3 },
    { key: 'runs', label: 'Pay Runs', icon: CalendarClock },
    { key: 'slips', label: 'Salary Slips', icon: FileText },
    { key: 'payments', label: 'Payments', icon: ArrowUpRight },
    { key: 'bankChanges', label: 'Bank changes', icon: Banknote },
    { key: 'adjustments', label: 'Adjustments', icon: Percent },
    { key: 'assignments', label: 'Salary Assignments', icon: Users },
    { key: 'revisions', label: 'Salary Revisions', icon: RefreshCw },
    { key: 'loans', label: 'Loans & Advances', icon: Landmark },
    { key: 'settlements', label: 'Full & final', icon: Handshake },
    { key: 'taxDeclarations', label: 'Tax declarations', icon: Receipt },
    { key: 'reports', label: 'Reports', icon: Table2 },
    /*
     * What payroll is configured with, apart from the month's work: the setup
     * checklist, the calendar and groups a run happens in, what a salary is
     * made of, the statutory rates it deducts under, and where it posts.
     */
    { section: 'Settings' },
    { key: 'setup', label: 'Setup', icon: ListChecks },
    { key: 'periods', label: 'Pay Calendar', icon: CalendarClock },
    { key: 'payGroups', label: 'Pay Groups', icon: Users },
    { key: 'components', label: 'Salary Components', icon: SlidersHorizontal },
    { key: 'structures', label: 'Salary Structures', icon: Layers },
    { key: 'compliance', label: 'Compliance', icon: BadgePercent },
    { key: 'ledgers', label: 'Ledger mapping', icon: Landmark },
  ],

  screens: {
    overview: PayrollOverview,
    runs: PayRuns,
    slips: SalarySlips,
    payments: PayrollPayments,
    bankChanges: BankChanges,
    adjustments: PayrollAdjustments,
    structures: SalaryStructures,
    assignments: SalaryAssignments,
    revisions: SalaryRevisions,
    loans: PayrollLoans,
    settlements: FinalSettlements,
    taxDeclarations: TaxDeclarations,
    compliance: PayrollCompliance,
    reports: PayrollReports,
    ledgers: PayrollLedgerMapping,
    components: SalaryComponents,
    periods: PayrollPeriods,
    payGroups: PayGroups,
    setup: PayrollSetup,
  },
};
