import {
  ArrowClockwiseDashesColor,
  ArrowSquareDownColor,
  ArrowSyncColor,
  BoardColor,
  BookmarkColor,
  BriefcaseColor,
  BuildingColor,
  BuildingMultipleColor,
  CalendarCancelColor,
  CalendarCheckmarkColor,
  CalendarClockColor,
  CalendarColor,
  CalendarDataBarColor,
  CheckboxPersonColor,
  ClipboardTaskColor,
  ClipboardTextEditColor,
  ClockAlarmColor,
  ClockColor,
  DataBarVerticalAscendingColor,
  DataTrendingColor,
  DataPieColor,
  DocumentAddColor,
  DocumentEditColor,
  DocumentFolderColor,
  DocumentTextColor,
  GaugeColor,
  HistoryColor,
  LinkColor,
  LinkMultipleColor,
  LocationRippleColor,
  LockClosedColor,
  MailColor,
  PeopleColor,
  PeopleSyncColor,
  PersonAddColor,
  PersonAvailableColor,
  PersonKeyColor,
  PersonWarningColor,
  PhoneColor,
  QuestionCircleColor,
  RibbonStarColor,
  ScanPersonColor,
  SettingsColor,
  ShieldCheckmarkColor,
  TableColor,
  TextBulletListSquareColor,
  WarningColor,
  WrenchScrewdriverColor,
} from '@fluentui/react-icons';

import { colorIcon } from '@ui/components/ui/iconSet';

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

/* Full-colour icons (Microsoft Fluent), under the names the nav below already
   uses. Attendance opts into this set with `iconSet: 'color'`; other apps keep
   the line icons. */
const ArrowRightLeft = colorIcon(ArrowSyncColor, 'ArrowSync');
const BarChart3 = colorIcon(DataBarVerticalAscendingColor, 'DataBarVerticalAscending');
const TrendChart = colorIcon(DataTrendingColor, 'DataTrending');
const CalendarClock = colorIcon(CalendarClockColor, 'CalendarClock');
const CalendarRange = colorIcon(CalendarDataBarColor, 'CalendarDataBar');
const Gavel = colorIcon(ClipboardTextEditColor, 'ClipboardTextEdit');
const Briefcase = colorIcon(BriefcaseColor, 'Briefcase');
const Building2 = colorIcon(BuildingColor, 'Building');
const CalendarCheck = colorIcon(CalendarCheckmarkColor, 'CalendarCheckmark');
const CalendarDays = colorIcon(CalendarColor, 'Calendar');
const CalendarOff = colorIcon(CalendarCancelColor, 'CalendarCancel');
const CircleHelp = colorIcon(QuestionCircleColor, 'QuestionCircle');
const ClipboardCheck = colorIcon(ClipboardTaskColor, 'ClipboardTask');
const Clock3 = colorIcon(ClockColor, 'Clock');
const Cpu = colorIcon(ScanPersonColor, 'ScanPerson');
const Fingerprint = colorIcon(ScanPersonColor, 'ScanPerson');
const HardHat = colorIcon(WrenchScrewdriverColor, 'WrenchScrewdriver');
const HeartPulse = colorIcon(GaugeColor, 'Gauge');
const KeyRound = colorIcon(PersonKeyColor, 'PersonKey');
const LocateFixed = colorIcon(LocationRippleColor, 'LocationRipple');
const History = colorIcon(HistoryColor, 'History');
const Inbox = colorIcon(DocumentEditColor, 'DocumentEdit');
const LayoutDashboard = colorIcon(BoardColor, 'Board');
const ListChecks = colorIcon(TextBulletListSquareColor, 'TextBulletListSquare');
const Mail = colorIcon(MailColor, 'Mail');
const MapPin = colorIcon(BuildingMultipleColor, 'BuildingMultiple');
const Plug = colorIcon(LinkMultipleColor, 'LinkMultiple');
const Repeat = colorIcon(ArrowClockwiseDashesColor, 'ArrowClockwiseDashes');
const RefreshCcwDot = colorIcon(PeopleSyncColor, 'PeopleSync');
const Scale = colorIcon(DataPieColor, 'DataPie');
const ScanFace = colorIcon(PersonAddColor, 'PersonAdd');
const Tags = colorIcon(BookmarkColor, 'Bookmark');
const UserMinus = colorIcon(PersonWarningColor, 'PersonWarning');
const UserRoundCheck = colorIcon(PersonAvailableColor, 'PersonAvailable');
const Users = colorIcon(PeopleColor, 'People');
const Grid3x3 = colorIcon(TableColor, 'Table');
const Upload = colorIcon(DocumentAddColor, 'DocumentAdd');
const Download = colorIcon(ArrowSquareDownColor, 'ArrowSquareDown');
const ShieldCheck = colorIcon(ShieldCheckmarkColor, 'ShieldCheckmark');
const ShieldAlert = colorIcon(WarningColor, 'Warning');
const Lock = colorIcon(LockClosedColor, 'LockClosed');
const Timer = colorIcon(ClockAlarmColor, 'ClockAlarm');
const BadgeCheck = colorIcon(RibbonStarColor, 'RibbonStar');
const Smartphone = colorIcon(PhoneColor, 'Phone');
const Link2 = colorIcon(LinkColor, 'Link');
const ClipboardList = colorIcon(SettingsColor, 'Settings');
const PunchIcon = colorIcon(CheckboxPersonColor, 'CheckboxPerson');
const AuditIcon = colorIcon(DocumentTextColor, 'DocumentText');
const BinIcon = colorIcon(DocumentFolderColor, 'DocumentFolder');

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
  /** Shared full-colour icons (packages/ui/src/components/ui/iconSet.jsx). */
  iconSet: 'color',
  /* The phone's tab bar; the rest is behind Menu (packages/shell/mobileTabs.js). */
  /* In order of preference, among the screens this person may open: a manager
     gets Exceptions, their main to-do (UX-14); someone without it gets My attendance. */
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
    { key: 'today', label: 'Overview', items: ['today'] },
    { key: 'personnel', label: 'People', groups: [
      { label: 'Directory', items: ['employees', 'contractors'] },
      { label: 'Employment Changes', items: ['checklists', 'resignations', 'transfer'] },
      { label: 'Organization', items: ['departments', 'positions', 'areas'] },
      { label: 'Access', items: ['portalAccess'] },
    ] },
    { key: 'device', label: 'Readers', groups: [
      { label: 'Monitoring', items: ['readerHealth', 'readerSync', 'deviceLogs'] },
      { label: 'Devices', items: ['readers', 'enrolments'] },
      { label: 'Punch Data', items: ['transactions', 'unmatched', 'idMapping'] },
      /* Punch sources other than a physical reader. API, middleware and local
         connectors live in Settings → Integrations; file imports in Settings → Import Data. */
      { label: 'Other Punch Sources', items: ['phonePunches'] },
    ] },
    { key: 'attendance', label: 'Attendance', groups: [
      { label: 'Daily Operations', items: ['records', 'punches', 'exceptions', 'requests'] },
      { label: 'Scheduling', items: ['scheduleCalendar', 'shifts', 'shiftAssignments', 'departmentSchedule', 'temporarySchedule', 'rotations'] },
      /* Time & Leave (TIME-LEAVE-DECISIONS.md): the same screens People shows, over the same records. */
      { label: 'Leave', items: ['timeOverview', 'leaveRequests', 'leaveCalendar', 'leaveBalances', 'leaveRegister', 'standIns'] },
      { label: 'Time Management', items: ['overtime'] },
      { label: 'Period Closing', items: ['payrollReadiness', 'confirmations', 'monthClose'] },
    ] },
    { key: 'reports', label: 'Reports', groups: [
      { label: 'Overview', items: ['reportInsights'] },
      { label: 'Attendance', items: ['register', 'summary', 'calendar', 'reportLateEarly', 'reportAbsent'] },
      { label: 'Workforce', items: ['reportDepartment', 'reportTimecard'] },
      { label: 'Time & Leave', items: ['reportOvertime', 'reportLeave'] },
      { label: 'Devices', items: ['reportReaderPunches'] },
      { label: 'All Reports', items: ['reports'] },
    ] },
    { key: 'system', label: 'Settings', groups: [
      { label: 'Organization', items: ['setup', 'sites', 'siteCheck', 'journeySteps'] },
      /* Founder's Work Policy group (NV-02). Weekly off and overtime are views
         over the shifts' own fields and the company rules, not new rules. */
      { label: 'Work Policy', items: ['rules', 'weeklyOffPolicy', 'overtimePolicy', 'leaveTypes', 'workingWeek', 'holidays', 'leaveYearEnd', 'requestRules'] },
      { label: 'Integrations', items: ['integrations'] },
      { label: 'Access & Security', items: ['sso', 'rolesAccess', 'emailNotifications'] },
      { label: 'Data Management', items: ['dataHealth', 'dataImport', 'dataExport', 'closeCompany'] },
      { label: 'Compliance', items: ['complianceCalendar'] },
      { label: 'Privacy', items: ['dataProtection', 'dataRequests'] },
      /* Founder, 21 Oct 2026: what changed, and what was deleted by mistake. */
      { label: 'Audit & Recovery', items: ['auditLogs', 'recycleBin'] },
    ] },
    { key: 'me', label: 'Me', groups: [
      { label: 'Self-Service', items: ['me', 'myLeave'] },
    ] },
  ],

  /* `permission`: what the screen's data needs (server routes); the shell hides what this user cannot open.
     `short`: the label on the phone's bottom tab bar, where the full name does not fit. */
  nav: [
    { section: 'Overview' },
    { key: 'today', label: 'Dashboard', icon: LayoutDashboard, permission: 'ATTENDANCE::Attendance Records::VIEW' },

    { section: 'People' },
    { key: 'employees', label: 'Employees', icon: Users, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'contractors', label: 'Contractors', icon: HardHat, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'resignations', label: 'Resignations', icon: UserMinus, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'transfer', label: 'Transfers', icon: ArrowRightLeft, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'departments', label: 'Departments', icon: Building2, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'positions', label: 'Designations', icon: Briefcase, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'areas', label: 'Locations & Sites', icon: MapPin, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'portalAccess', label: 'Employee Portal Access', icon: KeyRound, permission: 'ATTENDANCE::Employee Portal::VIEW' },

    { section: 'Readers' },
    { key: 'readerHealth', label: 'Reader Health', icon: HeartPulse, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'readerSync', label: 'Sync Monitoring', icon: RefreshCcwDot, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'deviceLogs', label: 'Reader Logs', icon: History, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'readers', label: 'All Readers', icon: Cpu, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'enrolments', label: 'Device Enrollment', icon: ScanFace, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'transactions', label: 'Punch Transactions', icon: ArrowRightLeft, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    /* The same punch log, where attendance staff look for it (founder, 21 Oct 2026). */
    { key: 'punches', label: 'Punches', icon: PunchIcon, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'unmatched', label: 'Unmatched Punches', icon: CircleHelp, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'idMapping', label: 'Employee ID Mapping', icon: Link2, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'phonePunches', label: 'Mobile Punches', icon: Smartphone, permission: 'ATTENDANCE::Attendance Devices::VIEW' },

    { section: 'Attendance' },
    { key: 'records', label: 'Attendance Records', short: 'Records', icon: ListChecks, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'exceptions', label: 'Exceptions', icon: ShieldAlert, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    /* Missed punch, work from home, on duty, permission hours: one list, one approval (was Corrections). */
    { key: 'requests', label: 'Attendance Requests', short: 'Requests', icon: Inbox, permission: 'ATTENDANCE::Attendance Requests::VIEW' },
    { key: 'scheduleCalendar', label: 'Schedule Calendar', icon: CalendarRange, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'shifts', label: 'Shifts', icon: Clock3, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'shiftAssignments', label: 'Shift Assignments', icon: Users, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'departmentSchedule', label: 'Department Schedules', icon: Building2, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'temporarySchedule', label: 'Temporary Schedules', icon: CalendarClock, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'rotations', label: 'Shift Rotations', icon: Repeat, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'timeOverview', label: "Who's Away", icon: LayoutDashboard, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveRequests', label: 'Leave Requests', short: 'Leave', icon: CalendarCheck, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveCalendar', label: 'Leave Calendar', icon: CalendarDays, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveBalances', label: 'Leave Balances', icon: Scale, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveRegister', label: 'Leave Register', icon: Grid3x3, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    /* Delegates, Leave Year End and Request Types show in simple mode too, as in People (People audit 30 Oct 2026, gap 4). */
    { key: 'standIns', label: 'Delegates', icon: Users, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'overtime', label: 'Overtime & Comp-Off', icon: Timer, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'confirmations', label: 'Employee Confirmations', icon: BadgeCheck, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'monthClose', label: 'Month Close', icon: Lock, permission: 'ATTENDANCE::Attendance Records::VIEW' },

    { section: 'Reports' },
    { key: 'reportInsights', label: 'Attendance Insights', icon: TrendChart, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'register', label: 'Daily Attendance Register', icon: Grid3x3, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'summary', label: 'Monthly Attendance Summary', icon: ClipboardCheck, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'calendar', label: 'Attendance Calendar', icon: CalendarDays, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'reportLateEarly', label: 'Late Arrivals & Early Exits', icon: Clock3, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'reportAbsent', label: 'Absence Report', icon: CalendarOff, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'reportDepartment', label: 'Department Attendance', icon: Building2, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'reportTimecard', label: 'Employee Attendance History', icon: UserRoundCheck, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'reportOvertime', label: 'Overtime Report', icon: Timer, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'reportLeave', label: 'Leave Report', icon: CalendarCheck, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'reportReaderPunches', label: 'Reader Activity', icon: Cpu, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'reports', label: 'Report Catalogue', icon: BarChart3, permission: 'ATTENDANCE::Attendance Records::VIEW' },

    { section: 'Settings' },
    { key: 'setup', label: 'Attendance Setup', icon: ClipboardList, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'sites', label: 'Punch Areas', icon: LocateFixed, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'siteCheck', label: 'Punch Area Check', icon: MapPin, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'rules', label: 'Attendance Policy', icon: Gavel, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'weeklyOffPolicy', label: 'Weekly Off Policy', icon: CalendarOff, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'overtimePolicy', label: 'Overtime Policy', icon: Timer, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'leaveTypes', label: 'Leave Policy', icon: Tags, permission: 'ATTENDANCE::Leave Types::VIEW' },
    /* Days off for anyone with no shift; with shifts, the shift decides (TIME-LEAVE-DECISIONS.md M2). */
    { key: 'workingWeek', label: 'Working Week', icon: CalendarOff, permission: 'ATTENDANCE::Leave Types::VIEW' },
    { key: 'holidays', label: 'Holidays', icon: CalendarDays, permission: 'ATTENDANCE::Holidays::VIEW' },
    { key: 'leaveYearEnd', label: 'Leave Year End', icon: ClipboardCheck, permission: 'ATTENDANCE::Leave Requests::EDIT' },
    { key: 'requestRules', label: 'Attendance Request Types', icon: Gavel, permission: 'ATTENDANCE::Attendance Requests::APPROVE' },
    { key: 'integrations', label: 'Integrations', icon: Plug, permission: 'ATTENDANCE::Attendance Integrations::VIEW' },
    /* The same SSO set-up as Accounting's Settings → Single Sign-On: one per company, for every CLOR app. */
    { key: 'sso', label: 'Users & Security', icon: KeyRound, permission: 'SETTINGS::Users::VIEW' },
    { key: 'rolesAccess', label: 'Roles & Access', icon: KeyRound, permission: 'SETTINGS::Roles::VIEW' },
    { key: 'emailNotifications', label: 'Email Notifications', icon: Mail, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'dataImport', label: 'Import Data', icon: Upload, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'dataExport', label: 'Export Data', icon: Download, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    /* LX-07: shared screen; the server lets only the company's owner ask or cancel. */
    { key: 'closeCompany', label: 'Close Company', icon: Lock, permission: 'SETTINGS::Company data::VIEW' },
    /* HR research Phase 2: statutory and company deadlines with owners and evidence. */
    { key: 'complianceCalendar', label: 'Compliance', icon: CalendarCheck, permission: 'PEOPLE::Employees::VIEW' },
    /* HR research: joining and leaving checklists. */
    /* Joining & Leaving tasks and steps: the same screens People shows (JOINING-LEAVING-DECISIONS.md). */
    { key: 'checklists', label: 'Joining & Leaving Tasks', icon: ClipboardCheck, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'journeySteps', label: 'Joining & Leaving Steps', icon: ClipboardCheck, permission: 'PEOPLE::Employees::VIEW' },
    /* HR research Phase 1: the control tower for one month's payroll. */
    { key: 'payrollReadiness', label: 'Payroll Readiness', icon: ClipboardCheck, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    /* HR research Phase 1: the implementation auditor. */
    { key: 'dataHealth', label: 'Data Health', icon: ShieldCheck, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'auditLogs', label: 'Audit Logs', icon: AuditIcon, permission: 'SETTINGS::Audit trail::VIEW' },
    /* Each person sees only what they may delete (server: routes/recycleBin.ts). */
    { key: 'recycleBin', label: 'Recycle Bin', icon: BinIcon, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'dataProtection', label: 'Data Protection', icon: ShieldCheck, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'dataRequests', label: 'Data Requests', icon: ShieldCheck, permission: 'PEOPLE::Employees::VIEW' },

    { section: 'Me' },
    { key: 'me', label: 'My Attendance', icon: UserRoundCheck, permission: 'ATTENDANCE::My Attendance::VIEW' },
    { key: 'myLeave', label: 'My Leave', icon: CalendarOff, permission: 'ATTENDANCE::My Attendance::VIEW' },
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
