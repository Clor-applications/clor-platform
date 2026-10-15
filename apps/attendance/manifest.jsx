import { ArrowRightLeft, BarChart3, CalendarCheck, CalendarDays, CalendarOff, CircleHelp, ClipboardCheck, Clock3, Cpu, FileText, Fingerprint, History, ScanFace, Inbox, LayoutDashboard, Plug, ListChecks, Scale, Tags, UserRoundCheck, Users } from 'lucide-react';

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
import AttendanceRegisters from './src/screens/AttendanceRegisters';
import UnmatchedPunches from './src/screens/UnmatchedPunches';
import Enrolments from './src/screens/Enrolments';
import Transactions from './src/screens/Transactions';
import DeviceLogs from './src/screens/DeviceLogs';
import AttendanceReports from './src/screens/AttendanceReports';
import Integrations from './src/screens/Integrations';

/**
 * Everything the shell knows about Attendance.
 *
 * Native attendance on the People database: clock in/out, shifts, holidays,
 * corrections, validation and overtime approval, basic leave (types,
 * balances, requests), and a month summary of payable days for Payroll. Modules and operations follow Horilla HRMS's
 * attendance app (reference only; LGPL code is not copied).
 *
 * Biometric readers (ZKTeco / eSSL) push punches to /iclock, the same
 * protocol the on-premise ClorTime server speaks; a company claims a reader by
 * its serial number under Readers.
 */
export const attendanceApp = {
  id: 'attendance',
  name: 'Attendance',
  icon: Fingerprint,
  blurb: 'Clock in and out, shifts, holidays, leave, corrections and payable days for payroll.',
  available: true,
  database: 'people.db',
  home: 'today',

  nav: [
    { key: 'today', label: 'Today', icon: LayoutDashboard },
    { key: 'me', label: 'My attendance', icon: UserRoundCheck },
    { key: 'records', label: 'Records', icon: ListChecks },
    { key: 'requests', label: 'Requests', icon: Inbox },
    { key: 'summary', label: 'Month summary', icon: ClipboardCheck },
    { key: 'reports', label: 'Reports', icon: BarChart3 },
    { section: 'Leave' },
    { key: 'myLeave', label: 'My leave', icon: CalendarOff },
    { key: 'leaveRequests', label: 'Leave requests', icon: CalendarCheck },
    { key: 'leaveBalances', label: 'Leave balances', icon: Scale },
    { section: 'Settings' },
    { key: 'shifts', label: 'Shifts', icon: Clock3 },
    { key: 'shiftAssignments', label: 'Shift assignments', icon: Users },
    { key: 'holidays', label: 'Holidays', icon: CalendarDays },
    { key: 'leaveTypes', label: 'Leave types', icon: Tags },
    { key: 'integrations', label: 'Integrations', icon: Plug },
    { section: 'Biometric readers' },
    { key: 'readers', label: 'Readers', icon: Cpu },
    { key: 'transactions', label: 'Transactions', icon: ArrowRightLeft },
    { key: 'enrolments', label: 'Enrolments', icon: ScanFace },
    { key: 'unmatched', label: 'Unmatched punches', icon: CircleHelp },
    { key: 'deviceLogs', label: 'Reader logs', icon: History },
    { key: 'registers', label: 'Registers', icon: FileText },
  ],
  screens: {
    today: AttendanceToday,
    me: MyAttendance,
    records: AttendanceRecords,
    requests: AttendanceRequests,
    summary: MonthSummary,
    reports: AttendanceReports,
    shifts: Shifts,
    shiftAssignments: ShiftAssignments,
    holidays: Holidays,
    myLeave: MyLeave,
    leaveRequests: LeaveRequests,
    leaveBalances: LeaveBalances,
    leaveTypes: LeaveTypes,
    integrations: Integrations,
    readers: AttendanceDevices,
    transactions: Transactions,
    enrolments: Enrolments,
    deviceLogs: DeviceLogs,
    unmatched: UnmatchedPunches,
    registers: AttendanceRegisters,
  },
};
