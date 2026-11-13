import React from 'react';
import OpenInCompanyAdmin from '@ui/company/OpenInCompanyAdmin';
import AutomationsList from '@ui/automations/AutomationsList';
/**
 * Every screen Attendance shows, in one place, so the manifest can load
 * them as one file the first time the app opens (WX-03). The manifest names
 * them; nothing else should import from here.
 */
export { default as Employees } from '@ui/personnel/Employees';
export { Departments } from '@ui/personnel/StructureList';
export { Areas, DataHealth, JobPositions } from './screens/OrgLists';
export { default as AttendanceToday } from './screens/AttendanceToday';
export { default as MyAttendance } from './screens/MyAttendance';
export { default as AttendanceRecords } from './screens/AttendanceRecords';
/* Time & Leave (TIME-LEAVE-DECISIONS.md): the screens People shows, over the same records; one build for both apps. */
export { default as AttendanceRequests } from '@ui/timeOff/AttendanceRequests';
export { default as RequestRules } from '@ui/timeOff/RequestRules';
export { default as MonthSummary } from './screens/MonthSummary';
export { default as AttendanceRegister } from './screens/AttendanceRegister';
export { default as AttendanceCalendar } from './screens/AttendanceCalendar';
export { default as Shifts } from './screens/Shifts';
export { default as ShiftAssignments } from './screens/ShiftAssignments';
export { default as Holidays } from './screens/Holidays';
export { default as MyLeave } from './screens/MyLeave';
export { default as TimeOverview } from '@ui/timeOff/TimeOverview';
export { default as LeaveRequests } from '@ui/timeOff/LeaveRequests';
export { default as LeaveCalendar } from '@ui/timeOff/LeaveCalendar';
export { default as LeaveBalances } from '@ui/timeOff/LeaveBalances';
export { default as LeaveRegister } from '@ui/timeOff/LeaveRegister';
export { default as StandIns } from '@ui/timeOff/StandIns';
export { default as LeaveTypes } from '@ui/timeOff/LeavePolicy';
export { default as WorkingWeek } from '@ui/timeOff/WorkingWeek';
export { default as LeaveYearEnd } from '@ui/timeOff/YearEnd';
export { default as AttendanceDevices } from './screens/AttendanceDevices';
export { default as ReaderHealth } from './screens/ReaderHealth';
export { default as ReaderSync } from './screens/ReaderSync';
export { default as UnmatchedPunches } from './screens/UnmatchedPunches';
export { default as Enrolments } from './screens/Enrolments';
export { default as Transactions, Punches } from './screens/Transactions';
/* One audit trail for the company, in Workspace (ADR-010); this opens it on People and Attendance's share. */
export const AuditLogs = () => React.createElement(OpenInCompanyAdmin, { title: 'Audit Logs', screen: 'audit', forApp: 'attendance' });
export { default as PayrollReadiness } from './screens/PayrollReadiness';
export { default as LifecycleTasks } from '@ui/lifecycle/Tasks';
export { default as JourneySteps } from '@ui/lifecycle/Steps';
export { default as RecycleBin } from './screens/RecycleBin';
export { default as DeviceLogs } from './screens/DeviceLogs';
export { default as AttendanceReports } from './screens/AttendanceReports';
export { default as Integrations } from './screens/Integrations';
export { default as Contractors } from './screens/Contractors';
export { default as Resignations } from './screens/Resignations';
export { default as Transfer } from './screens/Transfer';
export { default as DepartmentSchedule } from './screens/DepartmentSchedule';
export { default as TemporarySchedule } from './screens/TemporarySchedule';
export { default as Rotations } from './screens/Rotations';
export { default as ScheduleCalendar } from './screens/ScheduleCalendar';
export { default as AttendanceRules } from './screens/AttendanceRules';
export { default as PortalAccess } from './screens/PortalAccess';
export { default as Geofences } from './screens/Geofences';
export { default as SiteCheck } from './screens/SiteCheck';
export { default as DataImport } from './screens/DataImport';
export { default as DataExport } from './screens/DataExport';
export { default as DataRequests } from './screens/DataRequests';
export { default as DataProtection } from './screens/DataProtection';
/* Sign-in, SSO, users and roles are the company's: they live in Workspace (ADR-010), and this entry opens it. */
export const SsoSettings = () => React.createElement(OpenInCompanyAdmin, { title: 'Users & Security', screen: 'sso' });
export { default as Exceptions } from './screens/Exceptions';
export { default as MonthClose } from './screens/MonthClose';
export { default as OvertimeRequests } from './screens/OvertimeRequests';
export { default as MonthConfirmations } from './screens/MonthConfirmations';
export { default as PhonePunches } from './screens/PhonePunches';
export { default as IdMapping } from './screens/IdMapping';
export { default as WeeklyOffPolicy } from './screens/WeeklyOffPolicy';
export { default as OvertimePolicy } from './screens/OvertimePolicy';
export { default as AttendanceSetup } from './screens/AttendanceSetup';
export { default as ReportInsights } from './screens/ReportInsights';
export { default as CloseCompany } from '@ui/company/CloseCompany';
/* This app's roles and permissions, in Workspace's one role editor, opened on Attendance's share (ADR-010). */
export const RolesAccess = () => React.createElement(OpenInCompanyAdmin, { title: 'Roles & Access', screen: 'permissions', forApp: 'attendance' });
/* Settings → Automations: Attendance's own recipes on the shared list (server: services/attendance/automations.ts). */
export const Automations = ({ openScreen }) => React.createElement(AutomationsList, { module: 'attendance', openScreen, readOnlyNote: 'Whoever sets attendance rules changes these.' });
/* Which of the company's emails go out is set once for every app, in Workspace (automations B5). */
export const EmailNotifications = () => React.createElement(OpenInCompanyAdmin, { title: 'Email Notifications', screen: 'notifications' });

