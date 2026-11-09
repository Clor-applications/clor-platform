import {
  ArrowsClockwise as PArrowsClockwise,
  ArrowsLeftRight as PArrowsLeftRight,
  BookOpen as PBookOpen,
  Briefcase as PBriefcase,
  Buildings as PBuildings,
  CalendarBlank as PCalendarBlank,
  CalendarCheck as PCalendarCheck,
  CalendarDots as PCalendarDots,
  CalendarPlus as PCalendarPlus,
  CalendarX as PCalendarX,
  ChartBar as PChartBar,
  ChartLineUp as PChartLineUp,
  ClipboardText as PClipboardText,
  Clock as PClock,
  ClockCounterClockwise as PClockCounterClockwise,
  Cpu as PCpu,
  Crosshair as PCrosshair,
  DeviceMobile as PDeviceMobile,
  DownloadSimple as PDownloadSimple,
  FileText as PFileText,
  Fingerprint as PFingerprint,
  Gavel as PGavel,
  GearSix as PGearSix,
  HandTap as PHandTap,
  HardHat as PHardHat,
  Heartbeat as PHeartbeat,
  Key as PKey,
  LinkSimple as PLinkSimple,
  ListChecks as PListChecks,
  Lock as PLock,
  MapPin as PMapPin,
  NotePencil as PNotePencil,
  PiggyBank as PPiggyBank,
  Plug as PPlug,
  Question as PQuestion,
  Repeat as PRepeat,
  ScanSmiley as PScanSmiley,
  SealCheck as PSealCheck,
  ShieldCheck as PShieldCheck,
  ShieldWarning as PShieldWarning,
  SquaresFour as PSquaresFour,
  Table as PTable,
  Timer as PTimer,
  Trash as PTrash,
  UploadSimple as PUploadSimple,
  UserCheck as PUserCheck,
  UserMinus as PUserMinus,
  UsersThree as PUsersThree,
} from '@phosphor-icons/react';

import { duo } from '@ui/components/ui/duoIcon';

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

/* People's icon family (owner, 9 Nov 2026: "use same icons which is used in people everywhere except books"):
   Phosphor two-tone marks, under the names the nav below already uses. Attendance's amber stays its own. */
const ArrowRightLeft = duo(PArrowsLeftRight, 'ArrowRightLeft');
const BarChart3 = duo(PChartBar, 'BarChart3');
const TrendChart = duo(PChartLineUp, 'TrendChart');
const CalendarClock = duo(PCalendarPlus, 'CalendarClock');
const CalendarRange = duo(PCalendarDots, 'CalendarRange');
const Gavel = duo(PGavel, 'Gavel');
const Briefcase = duo(PBriefcase, 'Briefcase');
const Building2 = duo(PBuildings, 'Building2');
const CalendarCheck = duo(PCalendarCheck, 'CalendarCheck');
const CalendarDays = duo(PCalendarBlank, 'CalendarDays');
const CalendarOff = duo(PCalendarX, 'CalendarOff');
const CircleHelp = duo(PQuestion, 'CircleHelp');
const ClipboardCheck = duo(PClipboardText, 'ClipboardCheck');
const Clock3 = duo(PClock, 'Clock3');
const Cpu = duo(PCpu, 'Cpu');
const Fingerprint = duo(PFingerprint, 'Fingerprint');
const HardHat = duo(PHardHat, 'HardHat');
const HeartPulse = duo(PHeartbeat, 'HeartPulse');
const KeyRound = duo(PKey, 'KeyRound');
const LocateFixed = duo(PCrosshair, 'LocateFixed');
const History = duo(PClockCounterClockwise, 'History');
const Inbox = duo(PNotePencil, 'Inbox');
const LayoutDashboard = duo(PSquaresFour, 'LayoutDashboard');
const ListChecks = duo(PListChecks, 'ListChecks');
const MapPin = duo(PMapPin, 'MapPin');
const Plug = duo(PPlug, 'Plug');
const Repeat = duo(PRepeat, 'Repeat');
const RefreshCcwDot = duo(PArrowsClockwise, 'RefreshCcwDot');
const Scale = duo(PPiggyBank, 'Scale');
const ScanFace = duo(PScanSmiley, 'ScanFace');
const Tags = duo(PBookOpen, 'Tags');
const UserMinus = duo(PUserMinus, 'UserMinus');
const UserRoundCheck = duo(PUserCheck, 'UserRoundCheck');
const Users = duo(PUsersThree, 'Users');
const Grid3x3 = duo(PTable, 'Grid3x3');
const Upload = duo(PUploadSimple, 'Upload');
const Download = duo(PDownloadSimple, 'Download');
const ShieldCheck = duo(PShieldCheck, 'ShieldCheck');
const ShieldAlert = duo(PShieldWarning, 'ShieldAlert');
const Lock = duo(PLock, 'Lock');
const Timer = duo(PTimer, 'Timer');
const BadgeCheck = duo(PSealCheck, 'BadgeCheck');
const Smartphone = duo(PDeviceMobile, 'Smartphone');
const Link2 = duo(PLinkSimple, 'Link2');
const ClipboardList = duo(PGearSix, 'ClipboardList');
const PunchIcon = duo(PHandTap, 'PunchIcon');
const AuditIcon = duo(PFileText, 'AuditIcon');
const BinIcon = duo(PTrash, 'BinIcon');

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
  icon: Fingerprint,
  blurb: 'Biometric readers, shifts, leave, corrections, registers and payable days — on its own or with People and Payroll.',
  available: true,
  database: 'people.db',
  home: 'today',
  /** The shared Blaze palette (packages/ui/src/index.css, [data-palette='blaze']). */
  palette: 'blaze',
  /** People's icon family: two-tone marks (duoIcon.jsx), and Fluent line icons on buttons and actions. */
  iconSet: 'duo',
  lineIcons: 'fluent',
  /* The phone's tab bar; the rest is behind Menu (packages/shell/mobileTabs.js). */
  /* In order of preference, among the screens this person may open: a manager
     gets Exceptions, their main to-do (UX-14); someone without it gets My attendance. */
  /* A rail tap opens the module's first screen with its panel (People plan, 8 Nov 2026). */
  railOpensHome: true,
  /* Search (People plan, 8 Nov 2026): a person opens in People where the company has it; jobs by the words people use. */
  searchRecords: (q, { apps = [] } = {}) => (apps.includes('people') ? import('@ui/personnel/search').then((m) => m.findPeople(q, { appId: 'people' })) : Promise.resolve([])),
  searchActions: [
    { label: 'Fix a punch', screen: 'requests', keywords: ['punch', 'missed punch', 'regularise', 'regularize'] },
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
    { key: 'today', label: 'Today', items: ['today'] },
    { key: 'personnel', label: 'People', groups: [
      { label: 'Directory', items: ['employees', 'contractors'] },
      { label: 'Employment changes', items: ['checklists', 'resignations', 'transfer'] },
      { label: 'Organization', items: ['departments', 'positions', 'areas'] },
      { label: 'Access', items: ['portalAccess'] },
    ] },
    { key: 'device', label: 'Readers', groups: [
      { label: 'Monitoring', items: ['readerHealth', 'readerSync', 'deviceLogs'] },
      { label: 'Devices', items: ['readers', 'enrolments'] },
      { label: 'Punch data', items: ['transactions', 'unmatched', 'idMapping'] },
      /* Punch sources other than a physical reader. API, middleware and local
         connectors live in Settings → Integrations; file imports in Settings → Import Data. */
      { label: 'Other punch sources', items: ['phonePunches'] },
    ] },
    { key: 'attendance', label: 'Attendance', groups: [
      { label: 'Daily operations', items: ['records', 'punches', 'exceptions', 'requests'] },
      { label: 'Scheduling', items: ['scheduleCalendar', 'shifts', 'shiftAssignments', 'departmentSchedule', 'temporarySchedule', 'rotations'] },
      /* Time & Leave (TIME-LEAVE-DECISIONS.md): the same screens People shows, over the same records. */
      { label: 'Leave', items: ['timeOverview', 'leaveRequests', 'leaveCalendar', 'leaveBalances', 'leaveRegister', 'standIns'] },
      { label: 'Time management', items: ['overtime'] },
      { label: 'Period closing', items: ['payrollReadiness', 'confirmations', 'monthClose'] },
    ] },
    { key: 'reports', label: 'Reports', groups: [
      { label: 'Overview', items: ['reportInsights'] },
      { label: 'Attendance', items: ['register', 'summary', 'calendar', 'reportLateEarly', 'reportAbsent'] },
      { label: 'Workforce', items: ['reportDepartment', 'reportTimecard'] },
      { label: 'Time & leave', items: ['reportOvertime', 'reportLeave'] },
      { label: 'Devices', items: ['reportReaderPunches'] },
      { label: 'All reports', items: ['reports'] },
    ] },
    { key: 'system', label: 'Settings', groups: [
      { label: 'Organization', items: ['setup', 'sites', 'siteCheck', 'journeySteps'] },
      /* Founder's Work Policy group (NV-02). Weekly off and overtime are views
         over the shifts' own fields and the company rules, not new rules. */
      { label: 'Work policy', items: ['rules', 'weeklyOffPolicy', 'overtimePolicy', 'leaveTypes', 'workingWeek', 'holidays', 'leaveYearEnd', 'requestRules'] },
      { label: 'Integrations', items: ['integrations'] },
      { label: 'Access & security', items: ['sso', 'rolesAccess'] },
      { label: 'Data management', items: ['dataHealth', 'dataImport', 'dataExport', 'closeCompany'] },
      { label: 'Compliance', items: ['complianceCalendar'] },
      { label: 'Privacy', items: ['dataProtection', 'dataRequests'] },
      /* Founder, 21 Oct 2026: what changed, and what was deleted by mistake. */
      { label: 'Audit & recovery', items: ['auditLogs', 'recycleBin'] },
    ] },
    { key: 'me', label: 'Me', groups: [
      { label: 'Self-Service', items: ['me', 'myLeave'] },
    ] },
  ],

  /* `permission`: what the screen's data needs (server routes); the shell hides what this user cannot open.
     `wholeCompany`: company-wide figures a team-only role (Team Manager) is refused; the shell does not offer them to it.
     It keeps its team's Dashboard, Records, Exceptions, Overtime, Month close and Monthly summary (audit 7 Nov 2026, #3).
     `short`: the label on the phone's bottom tab bar, where the full name does not fit. */
  nav: [
    { section: 'Overview' },
    { key: 'today', label: 'Today', icon: LayoutDashboard, permission: 'ATTENDANCE::Attendance Records::VIEW' },

    { section: 'People' },
    { key: 'employees', label: 'Employees', icon: Users, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'contractors', label: 'Contractors', icon: HardHat, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'resignations', label: 'Resignations', icon: UserMinus, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'transfer', label: 'Transfers', icon: ArrowRightLeft, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'departments', label: 'Departments', icon: Building2, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'positions', label: 'Designations', icon: Briefcase, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'areas', label: 'Locations & sites', icon: MapPin, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'portalAccess', label: 'Employee portal access', icon: KeyRound, permission: 'ATTENDANCE::Employee Portal::VIEW' },

    { section: 'Readers' },
    { key: 'readerHealth', label: 'Reader health', icon: HeartPulse, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'readerSync', label: 'Sync monitoring', icon: RefreshCcwDot, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'deviceLogs', label: 'Reader logs', icon: History, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'readers', label: 'All readers', icon: Cpu, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'enrolments', label: 'Device enrollment', icon: ScanFace, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'transactions', label: 'Punch transactions', icon: ArrowRightLeft, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    /* The same punch log, where attendance staff look for it (founder, 21 Oct 2026). */
    { key: 'punches', label: 'Punches', icon: PunchIcon, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'unmatched', label: 'Unmatched punches', icon: CircleHelp, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'idMapping', label: 'Employee ID mapping', icon: Link2, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'phonePunches', label: 'Mobile punches', icon: Smartphone, permission: 'ATTENDANCE::Attendance Devices::VIEW' },

    { section: 'Attendance' },
    { key: 'records', label: 'Attendance records', short: 'Records', icon: ListChecks, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'exceptions', label: 'Exceptions', icon: ShieldAlert, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    /* Missed punch, work from home, on duty, permission hours: one list, one approval (was Corrections). */
    { key: 'requests', label: 'Attendance fixes', keywords: ['attendance requests', 'missed punch', 'regularise'], short: 'Fixes', icon: Inbox, permission: 'ATTENDANCE::Attendance Requests::VIEW' },
    { key: 'scheduleCalendar', label: 'Schedule calendar', icon: CalendarRange, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'shifts', label: 'Shifts', icon: Clock3, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'shiftAssignments', label: 'Shift assignments', icon: Users, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'departmentSchedule', label: 'Department schedules', icon: Building2, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'temporarySchedule', label: 'Temporary schedules', icon: CalendarClock, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'rotations', label: 'Shift rotations', icon: Repeat, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'timeOverview', label: "Who's away", icon: LayoutDashboard, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveRequests', label: 'Leave requests', short: 'Leave', icon: CalendarCheck, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveCalendar', label: 'Leave calendar', icon: CalendarDays, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveBalances', label: 'Leave balances', icon: Scale, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveRegister', label: 'Leave register', icon: Grid3x3, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    /* Delegates, Leave Year End and Request Types show in simple mode too, as in People (People audit 30 Oct 2026, gap 4). */
    { key: 'standIns', label: 'Delegates', icon: Users, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'overtime', label: 'Overtime & comp-off', icon: Timer, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'confirmations', label: 'Employee confirmations', icon: BadgeCheck, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'monthClose', label: 'Month close', icon: Lock, permission: 'ATTENDANCE::Attendance Records::VIEW' },

    { section: 'Reports' },
    { key: 'reportInsights', label: 'Attendance insights', icon: TrendChart, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'register', label: 'Daily attendance register', icon: Grid3x3, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'summary', label: 'Monthly attendance summary', icon: ClipboardCheck, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'calendar', label: 'Attendance calendar', icon: CalendarDays, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'reportLateEarly', label: 'Late arrivals & early exits', icon: Clock3, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'reportAbsent', label: 'Absence report', icon: CalendarOff, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'reportDepartment', label: 'Department attendance', icon: Building2, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'reportTimecard', label: 'Employee attendance history', icon: UserRoundCheck, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'reportOvertime', label: 'Overtime report', icon: Timer, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'reportLeave', label: 'Leave report', icon: CalendarCheck, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'reportReaderPunches', label: 'Reader activity', icon: Cpu, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'reports', label: 'Report catalogue', icon: BarChart3, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },

    { section: 'Settings' },
    { key: 'setup', label: 'Attendance setup', icon: ClipboardList, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'sites', label: 'Punch areas', icon: LocateFixed, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'siteCheck', label: 'Punch area check', icon: MapPin, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'rules', label: 'Attendance policy', icon: Gavel, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'weeklyOffPolicy', label: 'Weekly off policy', icon: CalendarOff, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'overtimePolicy', label: 'Overtime policy', icon: Timer, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'leaveTypes', label: 'Leave policy', icon: Tags, permission: 'ATTENDANCE::Leave Types::VIEW' },
    /* Days off for anyone with no shift; with shifts, the shift decides (TIME-LEAVE-DECISIONS.md M2). */
    { key: 'workingWeek', label: 'Working week', icon: CalendarOff, permission: 'ATTENDANCE::Leave Types::VIEW' },
    { key: 'holidays', label: 'Holidays', icon: CalendarDays, permission: 'ATTENDANCE::Holidays::VIEW' },
    { key: 'leaveYearEnd', label: 'Leave year end', icon: ClipboardCheck, permission: 'ATTENDANCE::Leave Requests::EDIT' },
    { key: 'requestRules', label: 'Attendance request types', icon: Gavel, permission: 'ATTENDANCE::Attendance Requests::APPROVE' },
    { key: 'integrations', label: 'Integrations', icon: Plug, permission: 'ATTENDANCE::Attendance Integrations::VIEW' },
    /* The same SSO set-up as Accounting's Settings → Single Sign-On: one per company, for every CLOR app. */
    { key: 'sso', label: 'Users & security', icon: KeyRound, permission: 'SETTINGS::Users::VIEW' },
    { key: 'rolesAccess', label: 'Roles & access', icon: KeyRound, permission: 'SETTINGS::Roles::VIEW' },
    { key: 'dataImport', label: 'Import data', icon: Upload, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    { key: 'dataExport', label: 'Export data', icon: Download, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    /* LX-07: shared screen; the server lets only the company's owner ask or cancel. */
    { key: 'closeCompany', label: 'Close company', icon: Lock, permission: 'SETTINGS::Company data::VIEW' },
    /* HR research Phase 2: statutory and company deadlines with owners and evidence. */
    { key: 'complianceCalendar', label: 'Compliance', icon: CalendarCheck, permission: 'PEOPLE::Employees::VIEW' },
    /* HR research: joining and leaving checklists. */
    /* Joining & Leaving tasks and steps: the same screens People shows (JOINING-LEAVING-DECISIONS.md). */
    { key: 'checklists', label: 'Joining & leaving tasks', icon: ClipboardCheck, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'journeySteps', label: 'Joining & leaving steps', icon: ClipboardCheck, permission: 'PEOPLE::Employees::VIEW' },
    /* HR research Phase 1: the control tower for one month's payroll. */
    { key: 'payrollReadiness', label: 'Payroll readiness', icon: ClipboardCheck, permission: 'ATTENDANCE::Attendance Records::VIEW', wholeCompany: true },
    /* HR research Phase 1: the implementation auditor. */
    { key: 'dataHealth', label: 'Data health', icon: ShieldCheck, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'auditLogs', label: 'Audit logs', icon: AuditIcon, permission: 'SETTINGS::Audit trail::VIEW' },
    /* Each person sees only what they may delete (server: routes/recycleBin.ts). */
    { key: 'recycleBin', label: 'Recycle bin', icon: BinIcon, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'dataProtection', label: 'Data protection', icon: ShieldCheck, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'dataRequests', label: 'Data requests', icon: ShieldCheck, permission: 'PEOPLE::Employees::VIEW' },

    { section: 'Me' },
    { key: 'me', label: 'My attendance', icon: UserRoundCheck, permission: 'ATTENDANCE::My Attendance::VIEW' },
    { key: 'myLeave', label: 'My leave', icon: CalendarOff, permission: 'ATTENDANCE::My Attendance::VIEW' },
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
