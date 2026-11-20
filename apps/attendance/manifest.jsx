import {
  AlarmClock,
  ArchiveRestore,
  ArrowRightLeft,
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  CalendarPlus,
  CalendarRange,
  CalendarX,
  CheckCheck,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Clock3,
  Coins,
  Database,
  Download,
  FileClock,
  FileCode,
  FileLock,
  FilePen,
  FileText,
  Fingerprint,
  Globe,
  HardHat,
  Hash,
  History,
  House,
  IdCard,
  KeyRound,
  LayoutGrid,
  Link2,
  List,
  ListChecks,
  Lock,
  LockKeyhole,
  Mail,
  MapPin,
  MessageSquareWarning,
  PiggyBank,
  RefreshCw,
  Repeat,
  RotateCcw,
  ScanSearch,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Table2,
  TrendingUp,
  TriangleAlert,
  Upload,
  UserCog,
  UserMinus,
  UserPlus,
  UserRound,
  UserRoundCheck,
  UserX,
  Users,
  UsersRound,
  Wifi,
  WifiOff,
} from '@ui/components/ui/navEmoji';
import { Clock as AppClock } from 'lucide-react';

import { lazy } from 'react';
import { lazyScreens } from '@ui/utils/lazyScreens';

/* Screens load as one file the first time the app opens (WX-03). */
const screen = lazyScreens(() => import('./src/screens.js'));
const Employees = screen('Employees');
const Areas = screen('Areas');
const Departments = screen('Departments');
const JobPositions = screen('JobPositions');
const AttendanceToday = screen('AttendanceToday');
const MyAttendance = screen('MyAttendance');
const AttendanceRecords = screen('AttendanceRecords');
const AttendanceRequests = screen('AttendanceRequests');
const MonthSummary = screen('MonthSummary');
const AttendanceRegister = screen('AttendanceRegister');
const AttendanceCalendar = screen('AttendanceCalendar');
const Shifts = screen('Shifts');
const ShiftAssignments = screen('ShiftAssignments');
const Holidays = screen('Holidays');
const MyLeave = screen('MyLeave');
const LeaveRequests = screen('LeaveRequests');
const LeaveBalances = screen('LeaveBalances');
const LeaveTypes = screen('LeaveTypes');
const TimeOverview = screen('TimeOverview');
const LeaveCalendar = screen('LeaveCalendar');
const LeaveRegister = screen('LeaveRegister');
const StandIns = screen('StandIns');
const WorkingWeek = screen('WorkingWeek');
const LeaveYearEnd = screen('LeaveYearEnd');
const RequestRules = screen('RequestRules');
const AttendanceDevices = screen('AttendanceDevices');
const ReaderHealth = screen('ReaderHealth');
const ReaderSync = screen('ReaderSync');
const UnmatchedPunches = screen('UnmatchedPunches');
const Enrolments = screen('Enrolments');
const Transactions = screen('Transactions');
const Punches = screen('Punches');
const AuditLogs = screen('AuditLogs');
const DataHealth = screen('DataHealth');
const PayrollReadiness = screen('PayrollReadiness');
const LifecycleTasks = screen('LifecycleTasks');
const JourneySteps = screen('JourneySteps');
/* The old calendar retired into People's Compliance (People audit gap 10): one place for deadlines, owners and proof. */
const ComplianceCalendar = lazy(() => import('../people/src/screens/Compliance'));
const RecycleBin = screen('RecycleBin');
const DeviceLogs = screen('DeviceLogs');
const AttendanceReports = screen('AttendanceReports');
const Integrations = screen('Integrations');
const Contractors = screen('Contractors');
const Resignations = screen('Resignations');
const Transfer = screen('Transfer');
const DepartmentSchedule = screen('DepartmentSchedule');
const TemporarySchedule = screen('TemporarySchedule');
const Rotations = screen('Rotations');
const ScheduleCalendar = screen('ScheduleCalendar');
const AttendanceRules = screen('AttendanceRules');
const PortalAccess = screen('PortalAccess');
const Geofences = screen('Geofences');
const SiteCheck = screen('SiteCheck');
const DataImport = screen('DataImport');
const DataExport = screen('DataExport');
const CloseCompany = screen('CloseCompany');
const ReportInsights = screen('ReportInsights');
const DataRequests = screen('DataRequests');
const DataProtection = screen('DataProtection');
const SsoSettings = screen('SsoSettings');
const RolesAccess = screen('RolesAccess');
const EmailNotifications = screen('EmailNotifications');
const Automations = screen('Automations');
const Exceptions = screen('Exceptions');
const MonthClose = screen('MonthClose');
const OvertimeRequests = screen('OvertimeRequests');
const MonthConfirmations = screen('MonthConfirmations');
const PhonePunches = screen('PhonePunches');
const IdMapping = screen('IdMapping');
const AttendanceSetup = screen('AttendanceSetup');
const WeeklyOffPolicy = screen('WeeklyOffPolicy');
const OvertimePolicy = screen('OvertimePolicy');
/* The employee portal is its own file: a phone at the gate needs nothing else. */
const EmployeePortal = lazy(() => import('./src/portal/EmployeePortal'));

/** A report from the catalogue as a sidebar entry: the Reports screen, opened on that report. */
const reportScreen = (id) => {
  const NamedReport = (props) => <AttendanceReports {...props} initialReport={id} />;
  NamedReport.displayName = `Report(${id})`;
  return NamedReport;
};

/* Lucide, one family (redesign §7): rail (M) and panel (I) icons; the shell sets their size. */
const M = {
  home: LayoutGrid,
  people: Users,
  readers: Fingerprint,
  attendance: CalendarCheck,
  reports: BarChart3,
  settings: Settings,
  me: UserRound,
};
const I = {
  today: House,
  employees: Users,
  contractor: HardHat,
  leaver: UserMinus,
  transfer: ArrowRightLeft,
  department: Building2,
  designation: IdCard,
  location: MapPin,
  portal: Smartphone,
  readerHealth: Wifi,
  readerSync: RefreshCw,
  readerLog: FileCode,
  readers: Fingerprint,
  enrol: UserPlus,
  transactions: Database,
  punches: Clock,
  unmatched: WifiOff,
  readerId: Hash,
  phonePunch: Smartphone,
  records: List,
  exceptions: TriangleAlert,
  attRequest: FilePen,
  shiftCalendar: CalendarClock,
  shifts: Clock3,
  shiftPeople: UsersRound,
  deptShift: CalendarRange,
  tempShift: CalendarPlus,
  rotation: Repeat,
  away: CalendarX,
  leave: CalendarDays,
  calendarPeople: CalendarRange,
  balance: PiggyBank,
  register: Table2,
  delegate: UserCog,
  overtime: AlarmClock,
  confirm: UserRoundCheck,
  monthClose: Lock,
  readiness: CheckCheck,
  insights: TrendingUp,
  summary: CalendarRange,
  calendar: Calendar,
  lateMarks: Clock,
  absences: UserX,
  history: History,
  catalogue: BarChart3,
  setup: Settings,
  punchArea: Globe,
  areaCheck: ScanSearch,
  attRules: BookOpen,
  weeklyOff: CalendarOff,
  overtimeRule: Coins,
  leavePolicy: FileText,
  workingWeek: CalendarClock,
  yearEnd: RotateCcw,
  requestType: SlidersHorizontal,
  automation: Bot,
  integrations: Link2,
  sso: ShieldCheck,
  roles: KeyRound,
  mail: Mail,
  import: Upload,
  export: Download,
  closeCompany: FileLock,
  compliance: ClipboardCheck,
  task: ClipboardList,
  steps: ListChecks,
  health: ShieldCheck,
  audit: FileClock,
  trash: ArchiveRestore,
  privacy: LockKeyhole,
  dataRequests: MessageSquareWarning,
  myDays: CalendarCheck,
  myLeave: CalendarDays,
};

/**
 * Everything the shell knows about Attendance.
 *
 * A complete product on its own, laid out like the on-premise ClorTime
 * (Personnel · Device · Attendance · System): a company that buys only
 * Attendance keeps its staff here. The employee list is the one People and
 * Payroll use, so buying those too adds to it rather than duplicating it.
 *
 * Biometric readers (ZKTeco / eSSL) push punches to /iclock — ClorTime's
 * protocol; e-Time Office and the /v1 API bring in everything else. Staff
 * without a CLOR user use the employee portal (#/portal): their days, leave,
 * and punching from a phone inside a work site.
 */
export const attendanceApp = {
  id: 'attendance',
  name: 'Attendance',
  /* The app's identity mark stays a line glyph on its colour tile; navigation draws in emoji. */
  icon: AppClock,
  blurb: 'Biometric readers, shifts, leave, corrections, registers and payable days — on its own or with People and Payroll.',
  available: true,
  database: 'people.db',
  home: 'today',
  /* No palette: one accent for every app (§6.3). Identity is the glyph hue, --app-attendance. */
  /* The phone's tab bar; the rest is behind Menu (packages/shell/mobileTabs.js). */
  /* In order of preference, among the screens this person may open: a manager
     gets Exceptions, their main to-do (UX-14); someone without it gets My attendance. */
  /* A rail tap opens the module's first screen with its panel (People plan, 8 Nov 2026). */
  railOpensHome: true,
  /* Search (People plan, 8 Nov 2026): a person opens in People where the company has it; jobs by the words people use. */
  searchRecords: (q, { apps = [] } = {}) => (apps.includes('people') ? import('@ui/personnel/search').then((m) => m.findPeople(q, { appId: 'people' })) : Promise.resolve([])),
  searchActions: [
    { label: 'Correct a punch', screen: 'requests', keywords: ['punch', 'missed punch', 'fix a punch', 'regularise', 'regularize'] },
    { label: 'Month close', screen: 'monthClose', keywords: ['month close', 'close the month', 'lock attendance', 'payroll cut-off'] },
    { label: 'Shifts', screen: 'shifts', keywords: ['shift', 'roster', 'timing', 'weekly off'] },
    { label: 'Who is late today', screen: 'today', keywords: ['late', 'absent', 'who is in'] },
    { label: 'Probation ending', appId: 'people', screen: 'employees', params: { prob: 'on' }, keywords: ['probation', 'confirm'] },
    { label: 'Payslips', appId: 'payroll', screen: 'slips', keywords: ['payslip', 'salary slip'] },
  ],
  mobileTabs: ['today', 'exceptions', 'records', 'requests', 'me'],
  /*
   * The split sidebar (ClorTime's MainLayout): a rail of modules, and the
   * open module's screens grouped under plain headings. Keys are nav keys;
   * a module with one screen and no groups has no panel.
   */
  /* Pages edge to edge on the white column, the way Accounting's are. */
  flush: true,
  modules: [
    /* Six business modules (founder's navigation brief, 21 Oct 2026), then Me,
       the person's own self-service, apart at the foot of the rail. Module
       keys and screen keys are unchanged where a screen already existed, so
       old links (?open=records) and permissions keep working. */
    { key: 'today', label: 'Today', icon: M.home, items: ['today'] },
    { key: 'personnel', label: 'People', icon: M.people, groups: [
      { label: 'Directory', items: ['employees', 'contractors'] },
      { label: 'Employment changes', items: ['checklists', 'resignations', 'transfer'] },
      { label: 'Organisation', items: ['departments', 'positions', 'areas'] },
      { label: 'Access', items: ['portalAccess'] },
    ] },
    { key: 'device', label: 'Readers', icon: M.readers, groups: [
      { label: 'Monitoring', items: ['readerHealth', 'readerSync', 'deviceLogs'] },
      { label: 'Devices', items: ['readers', 'enrolments'] },
      { label: 'Punch data', items: ['transactions', 'unmatched', 'idMapping'] },
      /* Punch sources other than a physical reader. API, middleware and local
         connectors live in Settings → Integrations; file imports in Settings → Import Data. */
      { label: 'Other punch sources', items: ['phonePunches'] },
    ] },
    { key: 'attendance', label: 'Attendance', icon: M.attendance, groups: [
      { label: 'Daily operations', items: ['records', 'exceptions', 'requests'] },
      { label: 'Scheduling', items: ['scheduleCalendar', 'shifts', 'shiftAssignments', 'departmentSchedule', 'temporarySchedule', 'rotations'] },
      /* Time & Leave (TIME-LEAVE-DECISIONS.md): the same screens People shows, over the same records. */
      { label: 'Leave', items: ['timeOverview', 'leaveRequests', 'leaveCalendar', 'leaveBalances', 'leaveRegister', 'standIns'] },
      { label: 'Time management', items: ['overtime'] },
      { label: 'Period closing', items: ['payrollReadiness', 'confirmations', 'monthClose'] },
    ] },
    { key: 'reports', label: 'Reports', icon: M.reports, groups: [
      { label: 'Overview', items: ['reportInsights'] },
      { label: 'Attendance', items: ['register', 'summary', 'calendar', 'reportLateEarly', 'reportAbsent'] },
      { label: 'Workforce', items: ['reportDepartment', 'reportTimecard'] },
      { label: 'Time & leave', items: ['reportOvertime', 'reportLeave'] },
      { label: 'Devices', items: ['reportReaderPunches'] },
      { label: 'All reports', items: ['reports'] },
    ] },
    { key: 'system', label: 'Settings', icon: M.settings, groups: [
      { label: 'Organisation', items: ['setup', 'sites', 'siteCheck', 'journeySteps'] },
      /* Founder's Work Policy group (NV-02). Weekly off and overtime are views
         over the shifts' own fields and the company rules, not new rules. */
      { label: 'Work policy', items: ['rules', 'weeklyOffPolicy', 'overtimePolicy', 'leaveTypes', 'workingWeek', 'holidays', 'leaveYearEnd', 'requestRules', 'automations'] },
      { label: 'Integrations', items: ['integrations'] },
      { label: 'Access & security', items: ['sso', 'rolesAccess', 'emailNotifications'] },
      { label: 'Data management', items: ['dataHealth', 'dataImport', 'dataExport', 'closeCompany'] },
      { label: 'Compliance', items: ['complianceCalendar'] },
      { label: 'Privacy', items: ['dataProtection', 'dataRequests'] },
      /* Founder, 21 Oct 2026: what changed, and what was deleted by mistake. */
      { label: 'Audit & recovery', items: ['auditLogs', 'recycleBin'] },
    ] },
    { key: 'me', label: 'Me', icon: M.me, groups: [
      { label: 'Self-service', items: ['me', 'myLeave'] },
    ] },
  ],

  /* `permission`: what the screen's data needs (server routes); the shell hides what this user cannot open.
     `wholeCompany`: company-wide figures a team-only role (Team Manager) is refused; the shell does not offer them to it.
     It keeps its team's Dashboard, Records, Exceptions, Overtime, Month close and Monthly summary (audit 7 Nov 2026, #3).
     `short`: the label on the phone's bottom tab bar, where the full name does not fit. */
  nav: [
    { section: 'Overview' },
    { key: 'today', label: 'Today', icon: I.today, permission: 'ATTENDANCE::Attendance Records::VIEW' },

    { section: 'People' },
    { key: 'employees', label: 'Employees', icon: I.employees, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'contractors', label: 'Contractors', icon: I.contractor, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'resignations', label: 'Resignations', icon: I.leaver, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'transfer', label: 'Transfers', icon: I.transfer, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'departments', label: 'Departments', icon: I.department, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'positions', label: 'Designations', icon: I.designation, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'areas', label: 'Locations & sites', icon: I.location, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'portalAccess', label: 'Employee portal access', icon: I.portal, permission: 'ATTENDANCE::Employee Portal::VIEW' },

    { section: 'Readers' },
    { key: 'readerHealth', label: 'Reader health', icon: I.readerHealth, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'readerSync', label: 'Sync monitoring', icon: I.readerSync, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'deviceLogs', label: 'Reader logs', icon: I.readerLog, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'readers', label: 'All readers', icon: I.readers, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'enrolments', label: 'Reader enrolment', icon: I.enrol, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'transactions', label: 'Punches', icon: I.transactions, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    /* One menu item for the punch log (UX copy audit, 20 Nov 2026): `punches` stays a screen so old links open it. */
    { key: 'unmatched', label: 'Unmatched punches', icon: I.unmatched, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'idMapping', label: 'Employee ID mapping', icon: I.readerId, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'phonePunches', label: 'Phone punches', icon: I.phonePunch, permission: 'ATTENDANCE::Attendance Devices::VIEW' },

    { section: 'Attendance' },
    { key: 'records', label: 'Attendance records', short: 'Records', icon: I.records, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'exceptions', label: 'Exceptions', icon: I.exceptions, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    /* Missed punch, work from home, on duty, permission hours: one list, one approval (was Corrections). */
    { key: 'requests', label: 'Attendance corrections', keywords: ['attendance requests', 'attendance fixes', 'missed punch', 'regularise'], short: 'Corrections', icon: I.attRequest, permission: 'ATTENDANCE::Attendance Requests::VIEW' },
    { key: 'scheduleCalendar', label: 'Schedule calendar', icon: I.shiftCalendar, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'shifts', label: 'Shifts', icon: I.shifts, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'shiftAssignments', label: 'Shift assignments', icon: I.shiftPeople, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'departmentSchedule', label: 'Department schedules', icon: I.deptShift, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'temporarySchedule', label: 'Temporary schedules', icon: I.tempShift, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'rotations', label: 'Shift rotations', icon: I.rotation, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'timeOverview', label: "Who's away", icon: I.away, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveRequests', label: 'Leave requests', short: 'Leave', icon: I.leave, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveCalendar', label: 'Leave calendar', icon: I.calendarPeople, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveBalances', label: 'Leave balances', icon: I.balance, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveRegister', label: 'Leave register', icon: I.register, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    /* Delegates, Leave Year End and Request Types show in simple mode too, as in People (People audit 30 Oct 2026, gap 4). */
    { key: 'standIns', label: 'Delegates', icon: I.delegate, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'overtime', label: 'Overtime & comp-off', icon: I.overtime, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'confirmations', label: 'Employee confirmations', icon: I.confirm, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'monthClose', label: 'Month close', icon: I.monthClose, permission: 'ATTENDANCE::Attendance Records::VIEW' },

    { section: 'Reports' },
    { key: 'reportInsights', label: 'Attendance insights', icon: I.insights, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'register', label: 'Daily attendance register', icon: I.register, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'summary', label: 'Monthly attendance summary', icon: I.summary, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'calendar', label: 'Attendance calendar', icon: I.calendar, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'reportLateEarly', label: 'Late arrivals & early exits', icon: I.lateMarks, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'reportAbsent', label: 'Absence report', icon: I.absences, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'reportDepartment', label: 'Department attendance', icon: I.department, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'reportTimecard', label: 'Employee attendance history', icon: I.history, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'reportOvertime', label: 'Overtime report', icon: I.overtime, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'reportLeave', label: 'Leave report', icon: I.leave, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'reportReaderPunches', label: 'Reader activity', icon: I.readers, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'reports', label: 'Report catalogue', icon: I.catalogue, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },

    { section: 'Settings' },
    { key: 'setup', label: 'Attendance setup', icon: I.setup, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'sites', label: 'Punch areas', icon: I.punchArea, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'siteCheck', label: 'Punch area check', icon: I.areaCheck, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'rules', label: 'Attendance policy', icon: I.attRules, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'weeklyOffPolicy', label: 'Weekly off policy', icon: I.weeklyOff, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'overtimePolicy', label: 'Overtime policy', icon: I.overtimeRule, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'leaveTypes', label: 'Leave policy', icon: I.leavePolicy, permission: 'ATTENDANCE::Leave Types::VIEW' },
    /* Days off for anyone with no shift; with shifts, the shift decides (TIME-LEAVE-DECISIONS.md M2). */
    { key: 'workingWeek', label: 'Working week', icon: I.workingWeek, permission: 'ATTENDANCE::Leave Types::VIEW' },
    { key: 'holidays', label: 'Holidays', icon: I.calendar, permission: 'ATTENDANCE::Holidays::VIEW' },
    { key: 'leaveYearEnd', label: 'Leave year end', icon: I.yearEnd, permission: 'ATTENDANCE::Leave Requests::EDIT' },
    { key: 'requestRules', label: 'Attendance request types', icon: I.requestType, permission: 'ATTENDANCE::Attendance Requests::APPROVE' },
    /* What Attendance sends on its own: read with the rules' right, changed with their edit (routes/automations.ts). */
    { key: 'automations', label: 'Automations', icon: I.automation, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'integrations', label: 'Integrations', icon: I.integrations, permission: 'ATTENDANCE::Attendance Integrations::VIEW' },
    /* The same SSO set-up as Accounting's Settings → Single Sign-On: one per company, for every CLOR app. */
    { key: 'sso', label: 'Users & security', icon: I.sso, permission: 'SETTINGS::Users::VIEW' },
    { key: 'rolesAccess', label: 'Roles & access', icon: I.roles, permission: 'SETTINGS::Roles::VIEW' },
    { key: 'emailNotifications', label: 'Email notifications', icon: I.mail, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'dataImport', label: 'Import data', icon: I.import, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'dataExport', label: 'Export data', icon: I.export, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    /* LX-07: shared screen; the server lets only the company's owner ask or cancel. */
    { key: 'closeCompany', label: 'Close company', icon: I.closeCompany, permission: 'SETTINGS::Company data::VIEW' },
    /* HR research Phase 2: statutory and company deadlines with owners and evidence. */
    { key: 'complianceCalendar', label: 'Compliance', icon: I.compliance, permission: 'PEOPLE::Employees::VIEW' },
    /* HR research: joining and leaving checklists. */
    /* Joining & Leaving tasks and steps: the same screens People shows (JOINING-LEAVING-DECISIONS.md). */
    { key: 'checklists', label: 'Joining & leaving tasks', icon: I.task, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'journeySteps', label: 'Joining & leaving steps', icon: I.steps, permission: 'PEOPLE::Employees::VIEW' },
    /* HR research Phase 1: the control tower for one month's payroll. */
    { key: 'payrollReadiness', label: 'Payroll readiness', icon: I.readiness, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    /* HR research Phase 1: the implementation auditor. */
    { key: 'dataHealth', label: 'Data health', icon: I.health, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'auditLogs', label: 'Audit logs', icon: I.audit, permission: 'SETTINGS::Audit trail::VIEW' },
    /* Each person sees only what they may delete (server: routes/recycleBin.ts). */
    { key: 'recycleBin', label: 'Recycle bin', icon: I.trash, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'dataProtection', label: 'Data protection', icon: I.privacy, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'dataRequests', label: 'Data requests', icon: I.dataRequests, permission: 'PEOPLE::Employees::VIEW' },

    { section: 'Me' },
    { key: 'me', label: 'My attendance', icon: I.myDays, permission: 'ATTENDANCE::My Attendance::VIEW' },
    { key: 'myLeave', label: 'My leave', icon: I.myLeave, permission: 'ATTENDANCE::My Attendance::VIEW' },
  ],
  screens: {
    today: AttendanceToday,
    employees: Employees,
    departments: Departments,
    positions: JobPositions,
    areas: Areas,
    contractors: Contractors,
    resignations: Resignations,
    transfer: Transfer,
    readerHealth: ReaderHealth,
    readers: AttendanceDevices,
    readerSync: ReaderSync,
    transactions: Transactions,
    punches: Punches,
    enrolments: Enrolments,
    unmatched: UnmatchedPunches,
    deviceLogs: DeviceLogs,
    records: AttendanceRecords,
    requests: AttendanceRequests,
    leaveRequests: LeaveRequests,
    timeOverview: TimeOverview,
    leaveCalendar: LeaveCalendar,
    leaveRegister: LeaveRegister,
    standIns: StandIns,
    workingWeek: WorkingWeek,
    leaveYearEnd: LeaveYearEnd,
    requestRules: RequestRules,
    summary: MonthSummary,
    register: AttendanceRegister,
    calendar: AttendanceCalendar,
    reports: AttendanceReports,
    reportInsights: ReportInsights,
    /* Named reports: the Reports screen opened on that report (same screen, same permission). */
    reportLateEarly: reportScreen('late-early'),
    reportAbsent: reportScreen('absent'),
    reportDepartment: reportScreen('department'),
    reportTimecard: reportScreen('timecard'),
    reportOvertime: reportScreen('overtime'),
    reportLeave: reportScreen('leave'),
    reportReaderPunches: reportScreen('reader-punches'),
    shifts: Shifts,
    shiftAssignments: ShiftAssignments,
    holidays: Holidays,
    scheduleCalendar: ScheduleCalendar,
    departmentSchedule: DepartmentSchedule,
    temporarySchedule: TemporarySchedule,
    rotations: Rotations,
    rules: AttendanceRules,
    leaveTypes: LeaveTypes,
    leaveBalances: LeaveBalances,
    integrations: Integrations,
    portalAccess: PortalAccess,
    sites: Geofences,
    siteCheck: SiteCheck,
    dataImport: DataImport,
    dataExport: DataExport,
    closeCompany: CloseCompany,
    auditLogs: AuditLogs,
    dataHealth: DataHealth,
    payrollReadiness: PayrollReadiness,
    checklists: LifecycleTasks,
    journeySteps: JourneySteps,
    complianceCalendar: ComplianceCalendar,
    recycleBin: RecycleBin,
    dataProtection: DataProtection,
    sso: SsoSettings,
    rolesAccess: RolesAccess,
    emailNotifications: EmailNotifications,
    automations: Automations,
    dataRequests: DataRequests,
    me: MyAttendance,
    myLeave: MyLeave,
    exceptions: Exceptions,
    monthClose: MonthClose,
    overtime: OvertimeRequests,
    confirmations: MonthConfirmations,
    phonePunches: PhonePunches,
    idMapping: IdMapping,
    setup: AttendanceSetup,
    weeklyOffPolicy: WeeklyOffPolicy,
    overtimePolicy: OvertimePolicy,
  },
  /** For people who are not CLOR users, at #/<key>; the shell routes, the app draws. */
  publicPages: {
    portal: EmployeePortal,
  },
};
