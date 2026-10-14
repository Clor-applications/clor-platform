import { CalendarCheck, CalendarDays, CalendarOff, ClipboardCheck, Clock3, Cpu, FileText, Fingerprint, Inbox, LayoutDashboard, ListChecks, Scale, Tags, UserRoundCheck, Users } from 'lucide-react';

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

/**
 * Everything the shell knows about Attendance.
 *
 * Native attendance on the People database: clock in/out, shifts, holidays,
 * corrections, validation and overtime approval, basic leave (types,
 * balances, requests), and a month summary of payable days for Payroll. Modules and operations follow Horilla HRMS's
 * attendance app (reference only; LGPL code is not copied).
 *
 * Biometric readers stay a separate on-prem Clor application, one instance
 * per customer; its screens are kept under "Biometric (on-prem)" until single
 * sign-on and per-company routing to that instance land.
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
    { section: 'Leave' },
    { key: 'myLeave', label: 'My leave', icon: CalendarOff },
    { key: 'leaveRequests', label: 'Leave requests', icon: CalendarCheck },
    { key: 'leaveBalances', label: 'Leave balances', icon: Scale },
    { section: 'Settings' },
    { key: 'shifts', label: 'Shifts', icon: Clock3 },
    { key: 'shiftAssignments', label: 'Shift assignments', icon: Users },
    { key: 'holidays', label: 'Holidays', icon: CalendarDays },
    { key: 'leaveTypes', label: 'Leave types', icon: Tags },
    { section: 'Biometric (on-prem)' },
    { key: 'readers', label: 'Readers', icon: Cpu },
    { key: 'registers', label: 'Registers', icon: FileText },
  ],
  screens: {
    today: AttendanceToday,
    me: MyAttendance,
    records: AttendanceRecords,
    requests: AttendanceRequests,
    summary: MonthSummary,
    shifts: Shifts,
    shiftAssignments: ShiftAssignments,
    holidays: Holidays,
    myLeave: MyLeave,
    leaveRequests: LeaveRequests,
    leaveBalances: LeaveBalances,
    leaveTypes: LeaveTypes,
    readers: AttendanceDevices,
    registers: AttendanceRegisters,
  },
};
