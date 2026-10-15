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

  nav: [
    { key: 'today', label: 'Today', icon: LayoutDashboard },
    { section: 'Personnel' },
    { key: 'employees', label: 'Employees', icon: Users },
    { key: 'departments', label: 'Departments', icon: Building2 },
    { key: 'positions', label: 'Positions', icon: Briefcase },
    { key: 'areas', label: 'Areas', icon: MapPin },
    { key: 'contractors', label: 'Contractors', icon: HardHat },
    { key: 'resignations', label: 'Resignations', icon: UserMinus },
    { key: 'transfer', label: 'Transfer', icon: Repeat },
    { section: 'Device' },
    { key: 'readerHealth', label: 'Reader health', icon: HeartPulse },
    { key: 'readers', label: 'Readers', icon: Cpu },
    { key: 'readerSync', label: 'Sync status', icon: RefreshCcwDot },
    { key: 'transactions', label: 'Transactions', icon: ArrowRightLeft },
    { key: 'enrolments', label: 'Enrolments', icon: ScanFace },
    { key: 'unmatched', label: 'Unmatched punches', icon: CircleHelp },
    { key: 'deviceLogs', label: 'Reader logs', icon: History },
    { section: 'Attendance' },
    { key: 'records', label: 'Records', icon: ListChecks },
    { key: 'requests', label: 'Corrections', icon: Inbox },
    { key: 'leaveRequests', label: 'Leave requests', icon: CalendarCheck },
    { key: 'summary', label: 'Month summary', icon: ClipboardCheck },
    { key: 'reports', label: 'Reports & registers', icon: BarChart3 },
    { section: 'Schedule' },
    { key: 'scheduleCalendar', label: 'Schedule calendar', icon: CalendarRange },
    { key: 'shifts', label: 'Shifts', icon: Clock3 },
    { key: 'shiftAssignments', label: 'Employee schedule', icon: Users },
    { key: 'departmentSchedule', label: 'Department schedule', icon: Building2 },
    { key: 'temporarySchedule', label: 'Temporary schedule', icon: CalendarClock },
    { key: 'rotations', label: 'Rotations', icon: Repeat },
    { key: 'holidays', label: 'Holidays', icon: CalendarDays },
    { key: 'rules', label: 'Attendance rules', icon: Gavel },
    { section: 'Leave setup' },
    { key: 'leaveTypes', label: 'Leave types', icon: Tags },
    { key: 'leaveBalances', label: 'Leave balances', icon: Scale },
    { section: 'Employee portal' },
    { key: 'portalAccess', label: 'Portal access', icon: KeyRound },
    { key: 'sites', label: 'Work sites', icon: LocateFixed },
    { section: 'System' },
    { key: 'integrations', label: 'Integrations', icon: Plug },
    { section: 'Me' },
    { key: 'me', label: 'My attendance', icon: UserRoundCheck },
    { key: 'myLeave', label: 'My leave', icon: CalendarOff },
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
    me: MyAttendance,
    myLeave: MyLeave,
  },
  /** For people who are not CLOR users, at #/<key>; the shell routes, the app draws. */
  publicPages: {
    portal: EmployeePortal,
  },
};
