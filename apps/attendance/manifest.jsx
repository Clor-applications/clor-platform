import {
  ArrowRightLeft,
  BarChart3,
  CalendarClock,
  CalendarRange,
  Gavel,
  Briefcase,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarOff,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Cpu,
  Fingerprint,
  HardHat,
  HeartPulse,
  KeyRound,
  LocateFixed,
  History,
  Inbox,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Plug,
  Repeat,
  RefreshCcwDot,
  Scale,
  ScanFace,
  Tags,
  UserMinus,
  UserRoundCheck,
  Users,
  Grid3x3,
  Upload,
  Download,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Timer,
  BadgeCheck,
  Smartphone,
  Link2,
  ClipboardList,
} from 'lucide-react';

import Employees from '@ui/personnel/Employees';
import { Areas, Departments, JobPositions } from '@ui/personnel/StructureList';
import AttendanceToday from './src/screens/AttendanceToday';
import MyAttendance from './src/screens/MyAttendance';
import AttendanceRecords from './src/screens/AttendanceRecords';
import AttendanceRequests from './src/screens/AttendanceRequests';
import MonthSummary from './src/screens/MonthSummary';
import AttendanceRegister from './src/screens/AttendanceRegister';
import AttendanceCalendar from './src/screens/AttendanceCalendar';
import Shifts from './src/screens/Shifts';
import ShiftAssignments from './src/screens/ShiftAssignments';
import Holidays from './src/screens/Holidays';
import MyLeave from './src/screens/MyLeave';
import LeaveRequests from './src/screens/LeaveRequests';
import LeaveBalances from './src/screens/LeaveBalances';
import LeaveTypes from './src/screens/LeaveTypes';
import AttendanceDevices from './src/screens/AttendanceDevices';
import ReaderHealth from './src/screens/ReaderHealth';
import ReaderSync from './src/screens/ReaderSync';
import UnmatchedPunches from './src/screens/UnmatchedPunches';
import Enrolments from './src/screens/Enrolments';
import Transactions from './src/screens/Transactions';
import DeviceLogs from './src/screens/DeviceLogs';
import AttendanceReports from './src/screens/AttendanceReports';
import Integrations from './src/screens/Integrations';
import Contractors from './src/screens/Contractors';
import Resignations from './src/screens/Resignations';
import Transfer from './src/screens/Transfer';
import DepartmentSchedule from './src/screens/DepartmentSchedule';
import TemporarySchedule from './src/screens/TemporarySchedule';
import Rotations from './src/screens/Rotations';
import ScheduleCalendar from './src/screens/ScheduleCalendar';
import AttendanceRules from './src/screens/AttendanceRules';
import PortalAccess from './src/screens/PortalAccess';
import Geofences from './src/screens/Geofences';
import SiteCheck from './src/screens/SiteCheck';
import DataImport from './src/screens/DataImport';
import DataExport from './src/screens/DataExport';
import DataRequests from './src/screens/DataRequests';
import DataProtection from './src/screens/DataProtection';
import SsoSettings from '../accounting/src/features/account/SsoSettings';
import EmployeePortal from './src/portal/EmployeePortal';
import Exceptions from './src/screens/Exceptions';
import MonthClose from './src/screens/MonthClose';
import OvertimeRequests from './src/screens/OvertimeRequests';
import MonthConfirmations from './src/screens/MonthConfirmations';
import PhonePunches from './src/screens/PhonePunches';
import IdMapping from './src/screens/IdMapping';
import AttendanceSetup from './src/screens/AttendanceSetup';

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
  /* The phone's tab bar; the rest is behind Menu (packages/shell/mobileTabs.js). */
  mobileTabs: ['today', 'me', 'records', 'requests'],
  /*
   * The split sidebar (ClorTime's MainLayout): a rail of modules, and the
   * open module's screens grouped under plain headings. Keys are nav keys;
   * a module with one screen and no groups has no panel.
   */
  /* Pages edge to edge on the white column, the way Accounting's are. */
  flush: true,
  modules: [
    { key: 'today', label: 'Today', items: ['today'] },
    { key: 'personnel', label: 'Personnel', groups: [
      { label: 'Organization', items: ['departments', 'positions', 'areas'] },
      { label: 'Employees', items: ['employees', 'contractors', 'resignations', 'transfer'] },
      { label: 'Privacy', items: ['dataProtection', 'dataRequests'] },
    ] },
    { key: 'device', label: 'Readers', groups: [
      { label: 'Readers', items: ['readerHealth', 'readers', 'readerSync'] },
      { label: 'Data', items: ['transactions', 'phonePunches', 'enrolments', 'unmatched', 'idMapping', 'deviceLogs'] },
    ] },
    { key: 'attendance', label: 'Attendance', groups: [
      { label: 'Daily', items: ['exceptions', 'records', 'requests', 'leaveRequests', 'overtime'] },
      { label: 'Reports', items: ['register', 'calendar', 'summary', 'confirmations', 'monthClose', 'reports'] },
      { label: 'Schedule', items: ['scheduleCalendar', 'shifts', 'shiftAssignments', 'departmentSchedule', 'temporarySchedule', 'rotations'] },
      { label: 'Rules', items: ['holidays', 'rules'] },
      { label: 'Leave setup', items: ['leaveTypes', 'leaveBalances'] },
    ] },
    { key: 'system', label: 'System', groups: [
      { label: 'Setup', items: ['setup'] },
      { label: 'Employee portal', items: ['portalAccess', 'sites', 'siteCheck'] },
      { label: 'Integrations', items: ['integrations'] },
      { label: 'Sign-in', items: ['sso'] },
      { label: 'Data', items: ['dataImport', 'dataExport'] },
    ] },
    { key: 'me', label: 'Me', groups: [
      { label: 'Mine', items: ['me', 'myLeave'] },
    ] },
  ],

  /* `permission`: what the screen's data needs (server routes); the shell hides what this user cannot open. */
  nav: [
    { key: 'today', label: 'Today', icon: LayoutDashboard, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { section: 'Personnel' },
    { key: 'employees', label: 'Employees', icon: Users, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'departments', label: 'Departments', icon: Building2, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'positions', label: 'Positions', icon: Briefcase, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'areas', label: 'Areas', icon: MapPin, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'contractors', label: 'Contractors', icon: HardHat, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'resignations', label: 'Resignations', icon: UserMinus, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'transfer', label: 'Transfer', icon: Repeat, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'dataProtection', label: 'Data protection', icon: ShieldCheck, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    /* The same SSO set-up as Accounting's Settings → Single Sign-On: one per company, for every CLOR app. */
    { key: 'sso', label: 'Single sign-on', icon: KeyRound, permission: 'SETTINGS::Users::VIEW' },
    { key: 'dataRequests', label: 'Data requests', icon: ShieldCheck, permission: 'PEOPLE::Employees::VIEW' },
    { section: 'Device' },
    { key: 'readerHealth', label: 'Reader health', icon: HeartPulse, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'readers', label: 'Readers', icon: Cpu, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'readerSync', label: 'Sync status', icon: RefreshCcwDot, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'transactions', label: 'Transactions', icon: ArrowRightLeft, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'enrolments', label: 'Enrolments', icon: ScanFace, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'unmatched', label: 'Unmatched punches', icon: CircleHelp, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'deviceLogs', label: 'Reader logs', icon: History, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { section: 'Attendance' },
    { key: 'records', label: 'Records', icon: ListChecks, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'requests', label: 'Corrections', icon: Inbox, permission: 'ATTENDANCE::Attendance Requests::VIEW' },
    { key: 'leaveRequests', label: 'Leave requests', icon: CalendarCheck, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'summary', label: 'Month summary', icon: ClipboardCheck, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'register', label: 'Register', icon: Grid3x3, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'calendar', label: 'Calendar', icon: CalendarRange, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'reports', label: 'Reports & registers', icon: BarChart3, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { section: 'Schedule' },
    { key: 'scheduleCalendar', label: 'Schedule calendar', icon: CalendarRange, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'shifts', label: 'Shifts', icon: Clock3, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'shiftAssignments', label: 'Employee schedule', icon: Users, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'departmentSchedule', label: 'Department schedule', icon: Building2, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'temporarySchedule', label: 'Temporary schedule', icon: CalendarClock, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'rotations', label: 'Rotations', icon: Repeat, permission: 'ATTENDANCE::Shifts::VIEW' },
    { key: 'holidays', label: 'Holidays', icon: CalendarDays, permission: 'ATTENDANCE::Holidays::VIEW' },
    { key: 'rules', label: 'Attendance rules', icon: Gavel, permission: 'ATTENDANCE::Shifts::VIEW' },
    { section: 'Leave setup' },
    { key: 'leaveTypes', label: 'Leave types', icon: Tags, permission: 'ATTENDANCE::Leave Types::VIEW' },
    { key: 'leaveBalances', label: 'Leave balances', icon: Scale, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { section: 'Employee portal' },
    { key: 'portalAccess', label: 'Portal access', icon: KeyRound, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'sites', label: 'Work sites', icon: LocateFixed, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'siteCheck', label: 'Site check', icon: LocateFixed, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { section: 'System' },
    { key: 'integrations', label: 'Integrations', icon: Plug, permission: 'ATTENDANCE::Attendance Integrations::VIEW' },
    { section: 'Data' },
    { key: 'dataImport', label: 'Import', icon: Upload, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'dataExport', label: 'Export', icon: Download, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'exceptions', label: 'Exceptions', icon: ShieldAlert, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'monthClose', label: 'Month close', icon: Lock, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'overtime', label: 'Overtime & comp-off', icon: Timer, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'confirmations', label: 'Employee confirmations', icon: BadgeCheck, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'phonePunches', label: 'Phone punches', icon: Smartphone, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'idMapping', label: 'ID mapping', icon: Link2, permission: 'ATTENDANCE::Attendance Devices::VIEW' },
    { key: 'setup', label: 'Setup', icon: ClipboardList, permission: 'ATTENDANCE::Attendance Records::VIEW' },
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
  },
  /** For people who are not CLOR users, at #/<key>; the shell routes, the app draws. */
  publicPages: {
    portal: EmployeePortal,
  },
};
