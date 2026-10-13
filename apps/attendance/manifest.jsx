import { Fingerprint, Activity, Cpu, FileText } from 'lucide-react';

import AttendanceOverview from './src/screens/AttendanceOverview';
import AttendanceDevices from './src/screens/AttendanceDevices';
import AttendanceRegisters from './src/screens/AttendanceRegisters';

/**
 * Everything the shell knows about Attendance.
 *
 * Attendance is different from Accounting and Payroll in one way that matters:
 * its backend is a separate Clor application (readers, ADMS, its own Postgres),
 * run as one instance per customer, not a set of tables in the platform's
 * database. So this app is a thin UI in the shell that reaches that company's
 * own attendance instance through a single adapter — the same boundary Payroll
 * uses to reach Accounting. Single sign-on and per-company routing are the next
 * steps; until then these screens say plainly that they are not yet connected.
 */
export const attendanceApp = {
  id: 'attendance',
  name: 'Attendance',
  icon: Fingerprint,
  blurb: 'Live attendance, statutory registers and payroll input from your biometric readers.',
  available: true,
  home: 'overview',

  nav: [
    { key: 'overview', label: 'Overview', icon: Activity },
    { key: 'readers', label: 'Readers', icon: Cpu },
    { key: 'registers', label: 'Registers', icon: FileText },
  ],
  screens: {
    overview: AttendanceOverview,
    readers: AttendanceDevices,
    registers: AttendanceRegisters,
  },
};
