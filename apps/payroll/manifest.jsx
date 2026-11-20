import {
  ArrowUpRight, Banknote, BarChart3, BookOpen, CalendarDays, FileSignature, HandCoins, Handshake, HardHat, KeyRound, Landmark,
  Gift, Layers, LayoutGrid, ListChecks, Mail, PlusCircle, Receipt, ScrollText, SlidersHorizontal, TrendingUp, Users,
  UsersRound, Wallet,
} from '@ui/components/ui/navEmoji';
import { Wallet as AppWallet } from 'lucide-react';

import { lazyScreens } from '@ui/utils/lazyScreens';

/* Screens load as one file the first time the app opens (WX-03). */
const screen = lazyScreens(() => import('./src/screens.js'));
const PayrollOverview = screen('PayrollOverview');
const PayRuns = screen('PayRuns');
const SalarySlips = screen('SalarySlips');
const PayrollPayments = screen('PayrollPayments');
const PayrollAdjustments = screen('PayrollAdjustments');
const SalaryStructures = screen('SalaryStructures');
const SalaryAssignments = screen('SalaryAssignments');
const SalaryRevisions = screen('SalaryRevisions');
const PayrollLoans = screen('PayrollLoans');
const PayrollCompliance = screen('PayrollCompliance');
const PayrollReports = screen('PayrollReports');
const PayrollLedgerMapping = screen('PayrollLedgerMapping');
const SalaryComponents = screen('SalaryComponents');
const PayGroups = screen('PayGroups');
const PayrollPeriods = screen('PayrollPeriods');
const PayrollSetup = screen('PayrollSetup');
const BankChanges = screen('BankChanges');
const FinalSettlements = screen('FinalSettlements');
const TaxDeclarations = screen('TaxDeclarations');
const StatutoryBonus = screen('StatutoryBonus');
const WeeklyWages = screen('WeeklyWages');
const RolesAccess = screen('RolesAccess');
const EmailNotifications = screen('EmailNotifications');

/* Lucide, one family (redesign §7); the concept map's glyphs where it names one: pay run banknote, payslip
   scroll-text, payment arrow-up-right, ledger book-open. */
const I = {
  app: Wallet, overview: LayoutGrid, runs: Banknote, slips: ScrollText, payments: ArrowUpRight, bank: Landmark,
  adjustments: PlusCircle, assignments: Users, revisions: TrendingUp, loans: HandCoins, settlements: Handshake,
  tax: Receipt, reports: BarChart3, setup: ListChecks, calendar: CalendarDays, groups: UsersRound,
  components: SlidersHorizontal, structures: Layers, compliance: FileSignature, ledgers: BookOpen, roles: KeyRound,
  mail: Mail, bonus: Gift, weekly: HardHat,
};

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
  /* The app's identity mark stays a line glyph on its colour tile; navigation draws in emoji. */
  icon: AppWallet,
  blurb: 'Salaries, statutory deductions, payslips, and the journal they post.',
  available: true,
  database: 'payroll.db',
  home: 'overview',
  /* No palette: one accent for every app (§6.3). Identity is the glyph hue, --app-payroll. */

  /** The phone tab bar: what a payroll admin opens most. */
  mobileTabs: ['overview', 'runs', 'slips', 'payments'],
  /* Pages edge to edge on the white column, the way Accounting's are. */
  flush: true,
  /* The split sidebar: modules on a rail, the open module's screens grouped (see Attendance). */
  modules: [
    { key: 'overview', label: 'Overview', items: ['overview'] },
    { key: 'runs', label: 'Pay runs', groups: [
      { label: 'Each month', items: ['runs', 'slips', 'payments'] },
      { label: 'Each week', items: ['weeklyWages'] },
      { label: 'Before the run', items: ['adjustments', 'bankChanges'] },
    ] },
    { key: 'people', label: 'Salaries', groups: [
      { label: 'Per employee', items: ['assignments', 'revisions', 'loans', 'taxDeclarations'] },
      { label: 'Once a year', items: ['bonus'] },
      { label: 'Leaving', items: ['settlements'] },
    ] },
    { key: 'reports', label: 'Reports', items: ['reports'] },
    { key: 'settings', label: 'Settings', groups: [
      { label: 'Setup', items: ['setup', 'periods', 'payGroups'] },
      { label: 'Salary design', items: ['components', 'structures'] },
      { label: 'Statutory', items: ['compliance', 'ledgers'] },
      { label: 'Access', items: ['rolesAccess', 'emailNotifications'] },
    ] },
  ],
  /* `permission`: what the screen's data needs (server routes); the shell hides what this user cannot open and shows read-only what they cannot change. */
  nav: [
    { key: 'overview', label: 'Overview', icon: I.overview, permission: 'PAYROLL::Payroll Runs::VIEW' },
    { key: 'runs', label: 'Pay runs', icon: I.runs, permission: 'PAYROLL::Payroll Runs::VIEW' },
    { key: 'slips', label: 'Payslips', icon: I.slips, permission: 'PAYROLL::Salary Slips::VIEW' },
    { key: 'payments', label: 'Payments', icon: I.payments, permission: 'PAYROLL::Payroll Payments::VIEW' },
    /* Round 66: workers paid by the day, every week or fortnight. */
    { key: 'weeklyWages', label: 'Weekly wages', icon: I.weekly, permission: 'PAYROLL::Payroll Runs::VIEW' },
    { key: 'bankChanges', label: 'Bank changes', icon: I.bank, permission: 'PAYROLL::Employee Payroll Profile::VIEW' },
    { key: 'adjustments', label: 'Adjustments', icon: I.adjustments, permission: 'PAYROLL::Payroll Adjustments::VIEW' },
    { key: 'assignments', label: 'Salary assignments', icon: I.assignments, permission: 'PAYROLL::Salary Assignments::VIEW' },
    { key: 'revisions', label: 'Salary revisions', icon: I.revisions, permission: 'PAYROLL::Salary Revisions::VIEW' },
    { key: 'loans', label: 'Loans & advances', icon: I.loans, permission: 'PAYROLL::Payroll Loans::VIEW' },
    { key: 'settlements', label: 'Full & final', icon: I.settlements, permission: 'PAYROLL::Payroll Runs::VIEW' },
    { key: 'taxDeclarations', label: 'Tax declarations', icon: I.tax, permission: 'PAYROLL::Employee Payroll Profile::VIEW' },
    { key: 'bonus', label: 'Statutory bonus', icon: I.bonus, permission: 'PAYROLL::Payroll Adjustments::VIEW' },
    { key: 'reports', label: 'Reports', icon: I.reports, permission: 'PAYROLL::Payroll Reports::VIEW' },
    /*
     * What payroll is configured with, apart from the month's work: the setup
     * checklist, the calendar and groups a run happens in, what a salary is
     * made of, the statutory rates it deducts under, and where it posts.
     */
    { section: 'Settings' },
    { key: 'setup', label: 'Setup', icon: I.setup, permission: 'PAYROLL::Payroll Settings::VIEW' },
    { key: 'periods', label: 'Pay calendar', icon: I.calendar, permission: 'PAYROLL::Payroll Settings::VIEW' },
    { key: 'payGroups', label: 'Pay groups', icon: I.groups, permission: 'PAYROLL::Payroll Settings::VIEW' },
    { key: 'components', label: 'Salary components', icon: I.components, permission: 'PAYROLL::Salary Structures::VIEW' },
    { key: 'structures', label: 'Salary structures', icon: I.structures, permission: 'PAYROLL::Salary Structures::VIEW' },
    { key: 'compliance', label: 'Compliance', icon: I.compliance, permission: 'PAYROLL::Payroll Settings::VIEW' },
    { key: 'ledgers', label: 'Ledger mapping', icon: I.ledgers, permission: 'PAYROLL::Payroll Posting::VIEW' },
    /* Payroll's roles live in Workspace's one role editor; this opens it on Payroll (ADR-010). */
    { key: 'rolesAccess', label: 'Roles & access', icon: I.roles, permission: 'SETTINGS::Roles::VIEW' },
    { key: 'emailNotifications', label: 'Email notifications', icon: I.mail, permission: 'SETTINGS::Company Profile::VIEW' },
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
    bonus: StatutoryBonus,
    weeklyWages: WeeklyWages,
    compliance: PayrollCompliance,
    reports: PayrollReports,
    ledgers: PayrollLedgerMapping,
    components: SalaryComponents,
    periods: PayrollPeriods,
    payGroups: PayGroups,
    setup: PayrollSetup,
    rolesAccess: RolesAccess,
    emailNotifications: EmailNotifications,
  },
};
