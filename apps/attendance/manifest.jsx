import {
  ArrowsClockwise as PhArrowsClockwise,
  ArrowsLeftRight as PhArrowsLeftRight,
  Briefcase as PhBriefcase,
  Buildings as PhBuildings,
  Calendar as PhCalendar,
  CalendarBlank as PhCalendarBlank,
  CalendarCheck as PhCalendarCheck,
  CalendarDots as PhCalendarDots,
  CalendarSlash as PhCalendarSlash,
  ChartBar as PhChartBar,
  Clipboard as PhClipboard,
  ClipboardText as PhClipboardText,
  Clock as PhClock,
  ClockCounterClockwise as PhClockCounterClockwise,
  Cpu as PhCpu,
  Crosshair as PhCrosshair,
  DeviceMobile as PhDeviceMobile,
  DownloadSimple as PhDownloadSimple,
  Fingerprint as PhFingerprint,
  Gavel as PhGavel,
  GridNine as PhGridNine,
  HardHat as PhHardHat,
  Heartbeat as PhHeartbeat,
  Key as PhKey,
  LinkSimple as PhLinkSimple,
  ListChecks as PhListChecks,
  Lock as PhLock,
  MapPin as PhMapPin,
  Plug as PhPlug,
  Question as PhQuestion,
  Repeat as PhRepeat,
  Scales as PhScales,
  ScanSmiley as PhScanSmiley,
  SealCheck as PhSealCheck,
  ShieldCheck as PhShieldCheck,
  ShieldWarning as PhShieldWarning,
  SquaresFour as PhSquaresFour,
  Tag as PhTag,
  Timer as PhTimer,
  Tray as PhTray,
  UploadSimple as PhUploadSimple,
  UserCheck as PhUserCheck,
  UserMinus as PhUserMinus,
  Users as PhUsers,
} from '@phosphor-icons/react';

import { duotone } from '@ui/components/ui/iconSet';

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
const AttendanceDevices = screen('AttendanceDevices');
const ReaderHealth = screen('ReaderHealth');
const ReaderSync = screen('ReaderSync');
const UnmatchedPunches = screen('UnmatchedPunches');
const Enrolments = screen('Enrolments');
const Transactions = screen('Transactions');
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
const DataRequests = screen('DataRequests');
const DataProtection = screen('DataProtection');
const SsoSettings = screen('SsoSettings');
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

/* Duotone icons (Phosphor), under the names the nav below already uses: the
   Blaze palette tints their fill layer orange. Attendance opts into this set
   with `iconSet: 'duotone'`; other apps keep the line icons. */
const ArrowRightLeft = duotone(PhArrowsLeftRight, 'ArrowsLeftRight');
const BarChart3 = duotone(PhChartBar, 'ChartBar');
const CalendarClock = duotone(PhCalendarDots, 'CalendarDots');
const CalendarRange = duotone(PhCalendarBlank, 'CalendarBlank');
const Gavel = duotone(PhGavel, 'Gavel');
const Briefcase = duotone(PhBriefcase, 'Briefcase');
const Building2 = duotone(PhBuildings, 'Buildings');
const CalendarCheck = duotone(PhCalendarCheck, 'CalendarCheck');
const CalendarDays = duotone(PhCalendar, 'Calendar');
const CalendarOff = duotone(PhCalendarSlash, 'CalendarSlash');
const CircleHelp = duotone(PhQuestion, 'Question');
const ClipboardCheck = duotone(PhClipboardText, 'ClipboardText');
const Clock3 = duotone(PhClock, 'Clock');
const Cpu = duotone(PhCpu, 'Cpu');
const Fingerprint = duotone(PhFingerprint, 'Fingerprint');
const HardHat = duotone(PhHardHat, 'HardHat');
const HeartPulse = duotone(PhHeartbeat, 'Heartbeat');
const KeyRound = duotone(PhKey, 'Key');
const LocateFixed = duotone(PhCrosshair, 'Crosshair');
const History = duotone(PhClockCounterClockwise, 'ClockCounterClockwise');
const Inbox = duotone(PhTray, 'Tray');
const LayoutDashboard = duotone(PhSquaresFour, 'SquaresFour');
const ListChecks = duotone(PhListChecks, 'ListChecks');
const MapPin = duotone(PhMapPin, 'MapPin');
const Plug = duotone(PhPlug, 'Plug');
const Repeat = duotone(PhRepeat, 'Repeat');
const RefreshCcwDot = duotone(PhArrowsClockwise, 'ArrowsClockwise');
const Scale = duotone(PhScales, 'Scales');
const ScanFace = duotone(PhScanSmiley, 'ScanSmiley');
const Tags = duotone(PhTag, 'Tag');
const UserMinus = duotone(PhUserMinus, 'UserMinus');
const UserRoundCheck = duotone(PhUserCheck, 'UserCheck');
const Users = duotone(PhUsers, 'Users');
const Grid3x3 = duotone(PhGridNine, 'GridNine');
const Upload = duotone(PhUploadSimple, 'UploadSimple');
const Download = duotone(PhDownloadSimple, 'DownloadSimple');
const ShieldCheck = duotone(PhShieldCheck, 'ShieldCheck');
const ShieldAlert = duotone(PhShieldWarning, 'ShieldWarning');
const Lock = duotone(PhLock, 'Lock');
const Timer = duotone(PhTimer, 'Timer');
const BadgeCheck = duotone(PhSealCheck, 'SealCheck');
const Smartphone = duotone(PhDeviceMobile, 'DeviceMobile');
const Link2 = duotone(PhLinkSimple, 'LinkSimple');
const ClipboardList = duotone(PhClipboard, 'Clipboard');

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
  /** Shared duotone icons (packages/ui/src/components/ui/iconSet.jsx). */
  iconSet: 'duotone',
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
      { label: 'Employment Changes', items: ['resignations', 'transfer'] },
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
      { label: 'Daily Operations', items: ['records', 'exceptions', 'requests'] },
      { label: 'Scheduling', items: ['scheduleCalendar', 'shifts', 'shiftAssignments', 'departmentSchedule', 'temporarySchedule', 'rotations'] },
      { label: 'Leave', items: ['leaveRequests', 'leaveBalances'] },
      { label: 'Time Management', items: ['overtime'] },
      { label: 'Period Closing', items: ['confirmations', 'monthClose'] },
    ] },
    { key: 'reports', label: 'Reports', groups: [
      { label: 'Attendance', items: ['register', 'summary', 'calendar', 'reportLateEarly', 'reportAbsent'] },
      { label: 'Workforce', items: ['reportDepartment', 'reportTimecard'] },
      { label: 'Time & Leave', items: ['reportOvertime', 'reportLeave'] },
      { label: 'Devices', items: ['reportReaderPunches'] },
      { label: 'All Reports', items: ['reports'] },
    ] },
    { key: 'system', label: 'Settings', groups: [
      { label: 'Organization', items: ['setup', 'sites', 'siteCheck'] },
      /* Founder's Work Policy group (NV-02). Weekly off and overtime are views
         over the shifts' own fields and the company rules, not new rules. */
      { label: 'Work Policy', items: ['rules', 'weeklyOffPolicy', 'overtimePolicy', 'leaveTypes', 'holidays'] },
      { label: 'Integrations', items: ['integrations'] },
      { label: 'Access & Security', items: ['sso'] },
      { label: 'Data Management', items: ['dataImport', 'dataExport'] },
      { label: 'Privacy', items: ['dataProtection', 'dataRequests'] },
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
    { key: 'unmatched', label: 'Unmatched Punches', icon: CircleHelp, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'idMapping', label: 'Employee ID Mapping', icon: Link2, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'phonePunches', label: 'Mobile Punches', icon: Smartphone, permission: 'ATTENDANCE::Attendance Devices::VIEW' },

    { section: 'Attendance' },
    { key: 'records', label: 'Attendance Records', short: 'Records', icon: ListChecks, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'exceptions', label: 'Exceptions', icon: ShieldAlert, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'requests', label: 'Corrections', icon: Inbox, permission: 'ATTENDANCE::Attendance Requests::VIEW' },
    { key: 'scheduleCalendar', label: 'Schedule Calendar', icon: CalendarRange, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'shifts', label: 'Shifts', icon: Clock3, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'shiftAssignments', label: 'Shift Assignments', icon: Users, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'departmentSchedule', label: 'Department Schedules', icon: Building2, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'temporarySchedule', label: 'Temporary Schedules', icon: CalendarClock, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'rotations', label: 'Shift Rotations', icon: Repeat, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'leaveRequests', label: 'Leave Requests', icon: CalendarCheck, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveBalances', label: 'Leave Balances', icon: Scale, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'overtime', label: 'Overtime & Comp-Off', icon: Timer, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'confirmations', label: 'Employee Confirmations', icon: BadgeCheck, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'monthClose', label: 'Month Close', icon: Lock, permission: 'ATTENDANCE::Attendance Records::VIEW' },

    { section: 'Reports' },
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
    { key: 'sites', label: 'Work Sites', icon: LocateFixed, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'siteCheck', label: 'Work Site Check', icon: MapPin, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'rules', label: 'Attendance Policy', icon: Gavel, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'weeklyOffPolicy', label: 'Weekly Off Policy', icon: CalendarOff, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'overtimePolicy', label: 'Overtime Policy', icon: Timer, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'leaveTypes', label: 'Leave Policy', icon: Tags, permission: 'ATTENDANCE::Leave Types::VIEW' },
    { key: 'holidays', label: 'Holidays', icon: CalendarDays, permission: 'ATTENDANCE::Holidays::VIEW' },
    { key: 'integrations', label: 'Integrations', icon: Plug, permission: 'ATTENDANCE::Attendance Integrations::VIEW' },
    /* The same SSO set-up as Accounting's Settings → Single Sign-On: one per company, for every CLOR app. */
    { key: 'sso', label: 'Single Sign-On', icon: KeyRound, permission: 'SETTINGS::Users::VIEW' },
    { key: 'dataImport', label: 'Import Data', icon: Upload, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'dataExport', label: 'Export Data', icon: Download, permission: 'ATTENDANCE::Attendance Records::VIEW' },
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
    enrolments: Enrolments,
    unmatched: UnmatchedPunches,
    deviceLogs: DeviceLogs,
    records: AttendanceRecords,
    requests: AttendanceRequests,
    leaveRequests: LeaveRequests,
    summary: MonthSummary,
    register: AttendanceRegister,
    calendar: AttendanceCalendar,
    reports: AttendanceReports,
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
    dataProtection: DataProtection,
    sso: SsoSettings,
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
