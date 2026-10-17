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
} from 'lucide-react';

import Employees from '@ui/personnel/Employees';
import { Areas, Departments, JobPositions } from '@ui/personnel/StructureList';
import AttendanceToday from './src/screens/AttendanceToday';
import MyAttendance from './src/screens/MyAttendance';
import AttendanceRecords from './src/screens/AttendanceRecords';
import AttendanceRequests from './src/screens/AttendanceRequests';
import MonthSummary from './src/screens/MonthSummary';
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
import EmployeePortal from './src/portal/EmployeePortal';

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
  mobileTabs: ['today', 'records', 'leaveRequests', 'requests'],
  /*
   * The split sidebar (ClorTime's MainLayout): a rail of modules, and the
   * open module's screens grouped under plain headings. Keys are nav keys;
   * a module with one screen and no groups has no panel.
   */
  modules: [
    { key: 'today', label: 'Today', items: ['today'] },
    { key: 'personnel', label: 'Personnel', groups: [
      { label: 'Organization', items: ['departments', 'positions', 'areas'] },
      { label: 'Employees', items: ['employees', 'contractors', 'resignations', 'transfer'] },
    ] },
    { key: 'device', label: 'Readers', groups: [
      { label: 'Readers', items: ['readerHealth', 'readers', 'readerSync'] },
      { label: 'Data', items: ['transactions', 'enrolments', 'unmatched', 'deviceLogs'] },
    ] },
    { key: 'attendance', label: 'Attendance', groups: [
      { label: 'Daily', items: ['records', 'requests', 'leaveRequests'] },
      { label: 'Reports', items: ['summary', 'reports'] },
      { label: 'Schedule', items: ['scheduleCalendar', 'shifts', 'shiftAssignments', 'departmentSchedule', 'temporarySchedule', 'rotations'] },
      { label: 'Rules', items: ['holidays', 'rules'] },
      { label: 'Leave setup', items: ['leaveTypes', 'leaveBalances'] },
    ] },
    { key: 'system', label: 'System', groups: [
      { label: 'Employee portal', items: ['portalAccess', 'sites', 'siteCheck'] },
      { label: 'Integrations', items: ['integrations'] },
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
    me: MyAttendance,
    myLeave: MyLeave,
  },
  /** For people who are not CLOR users, at #/<key>; the shell routes, the app draws. */
  publicPages: {
    portal: EmployeePortal,
  },
};
