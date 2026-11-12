import React from 'react';
import OpenInCompanyAdmin from '@ui/company/OpenInCompanyAdmin';
/**
 * Every screen People shows, in one place, so the manifest can load
 * them as one file the first time the app opens (WX-03). The manifest names
 * them; nothing else should import from here.
 */
export { default as PeopleOverview } from './screens/PeopleOverview';
/* Workforce (People design v1, Module 01). */
export { default as Workforce } from './workforce/Directory';
export { default as EmployeeRecord } from './workforce/EmployeeRecord';
export { default as AddEmployee } from './workforce/AddEmployee';
export { default as ImportEmployees } from './workforce/ImportEmployees';
export { default as Offers } from './workforce/Offers';
/* Expenses, advances and salary advances (WORKFLOW-GAP-RESEARCH 4.1, 4.2). */
export { default as Expenses } from './money/Expenses';
export { default as Approvals } from './screens/Approvals';
export { default as Policies } from './screens/Policies';
export { default as ApprovalRules } from './screens/ApprovalRules';
/* Request types HR sets up, their report, shift swaps and My requests (FEATURE-UI-AUDIT gaps 24, 25). */
export { default as RequestForms } from './screens/RequestForms';
export { default as RequestsReport } from './screens/RequestsReport';
export { default as ShiftSwaps } from './screens/ShiftSwaps';
export { default as MyRequests } from './screens/MyRequests';
/* Attendance rules: late marks, absences and night-work consent (WORKFLOW-GAP-RESEARCH 4.4, 4.6, B19). */
export { default as AttendanceRulesSettings } from './time/AttendanceRules';
export { default as LateMarks } from './time/LateMarks';
export { default as Absences } from './time/Absences';
export { default as NightWork } from './time/NightWork';
/* Ready-made automations and the exit interview's questions (WORKFLOW-GAP-RESEARCH 4.7, 4.9). */
export { default as Automations } from './screens/Automations';
export { default as ExitQuestions } from './screens/ExitQuestions';
export { default as HelpDesk } from './screens/HelpDesk';
export { default as PrivateCases } from './screens/PrivateCases';
export { default as HelpDeskSettings } from './screens/HelpDeskSettings';
export { default as OrgChart } from './screens/OrgChart';
/* Organization (docs/people/design-v1/ORGANIZATION-DECISIONS.md): the company's shape, its places and its changes. */
export { default as OrganizationOverview } from './organization/Overview';
export { default as Branches } from './organization/Branches';
export { default as OrgChanges } from './organization/Changes';
export { OrgDepartments, OrgDesignations, OrgJobRoles, OrgTeams, OrgPositions, OrgLocations, OrgWorkSites, OrgBusinessUnits, OrgGrades, OrgCostCentres, OrgEmploymentTypes, OrgWorkModes, OrgLegalEntities } from './organization/lists';
export { default as Tags } from './screens/Tags';
export { DataHealth } from './screens/DataHealth';
export { default as LifecycleTasks } from '@ui/lifecycle/Tasks';
export { default as Joiners } from '@ui/lifecycle/Joining';
export { default as LifecycleChanges } from '@ui/lifecycle/Changes';
export { default as Leavers } from '@ui/lifecycle/Leaving';
export { default as JourneySteps } from '@ui/lifecycle/Steps';
export { default as LetterTemplates } from '@ui/personnel/LetterTemplates';
export { default as CustomFieldsSettings } from '@ui/personnel/CustomFieldsSettings';
export { default as SelfServiceSettings } from '@ui/personnel/SelfServiceSettings';
export { default as Compliance } from './screens/Compliance';
export { default as Privacy } from './screens/Privacy';
export { default as AuditEvidence } from './screens/AuditEvidence';
export { default as WorkspaceList } from './screens/WorkspaceList';
/* Talent (docs/people/design-v1/TALENT-DECISIONS.md): its own records on /people/talent/*, not the register. */
export { default as TalentOpenings } from './talent/Openings';
export { default as TalentCandidates } from './talent/Candidates';
export { default as TalentInterviews } from './talent/Interviews';
export { default as TalentGoals } from './talent/Goals';
export { default as TalentReviews } from './talent/Reviews';
export { default as TalentPlans } from './talent/Plans';
export { default as TalentOneOnOnes } from './talent/OneOnOnes';
export { default as TalentTrainings } from './talent/Trainings';
export { default as TalentReferrals } from './talent/Referrals';
export { default as TalentReferSomeone } from './talent/ReferSomeone';
export { default as PeopleReports } from './screens/PeopleReports';
export { default as ReportsHome } from './screens/ReportsHome';
export { default as HrReport } from './screens/HrReport';
export { default as Registers, LeaveSummaryReport } from './screens/Registers';
export { default as PeopleDocuments } from './screens/PeopleDocuments';
export { default as Holidays } from '../../attendance/src/screens/Holidays';
export { default as PortalAccess } from '../../attendance/src/screens/PortalAccess';
/* Payroll's screen for Payroll's people; HR reads a read-only list when the owner allows it (Company choices). */
export { default as SalaryRevisions } from './money/SalaryRevisionsRead';
export { default as CompanyChoices } from './screens/CompanyChoices';
/* Leave is HR's (founder, 22 Oct 2026): People's own screens over the same records Attendance reads. */
export { default as LeaveRequests } from '@ui/timeOff/LeaveRequests';
export { default as TimeOverview } from '@ui/timeOff/TimeOverview';
export { default as WorkingWeek } from '@ui/timeOff/WorkingWeek';
export { default as LeaveBalances } from '@ui/timeOff/LeaveBalances';
export { default as LeaveTypes } from '@ui/timeOff/LeavePolicy';
export { default as LeaveCalendar } from '@ui/timeOff/LeaveCalendar';
export { default as LeaveRegister } from '@ui/timeOff/LeaveRegister';
export { default as TeamAttendance } from '@ui/timeOff/TeamAttendance';
export { default as LeaveYearEnd } from '@ui/timeOff/YearEnd';
/* Delegates: leave delegates and People approval stand-ins on one screen (FEATURE-UI-AUDIT gap 9); Attendance keeps the leave-only list. */
export { default as StandIns } from './screens/Delegates';
export { default as LeaveBlocks } from '@ui/timeOff/LeaveBlocks';
export { default as MyDays } from '@ui/timeOff/MyDays';
/* Attendance requests of four kinds (missed punch, work from home, on duty, permission) and their rules. */
export { default as AttendanceRequests } from '@ui/timeOff/AttendanceRequests';
export { default as RequestRules } from '@ui/timeOff/RequestRules';
export { default as MyLeave } from '../../attendance/src/screens/MyLeave';
/* Shifts, readers, overtime and the month's close are People's too (owner, 11 Nov 2026): the Attendance app's own
   screens over the same records, so a company on People never has to switch apps to run its time. */
export { default as AttendanceRecords } from '../../attendance/src/screens/AttendanceRecords';
export { default as Exceptions } from '../../attendance/src/screens/Exceptions';
export { default as ScheduleCalendar } from '../../attendance/src/screens/ScheduleCalendar';
export { default as Shifts } from '../../attendance/src/screens/Shifts';
export { default as ShiftAssignments } from '../../attendance/src/screens/ShiftAssignments';
export { default as DepartmentSchedule } from '../../attendance/src/screens/DepartmentSchedule';
export { default as TemporarySchedule } from '../../attendance/src/screens/TemporarySchedule';
export { default as Rotations } from '../../attendance/src/screens/Rotations';
export { default as OvertimeRequests } from '../../attendance/src/screens/OvertimeRequests';
export { default as MonthConfirmations } from '../../attendance/src/screens/MonthConfirmations';
export { default as MonthClose } from '../../attendance/src/screens/MonthClose';
export { default as PayrollReadiness } from '../../attendance/src/screens/PayrollReadiness';
export { default as AttendanceDevices } from '../../attendance/src/screens/AttendanceDevices';
export { default as ReaderHealth } from '../../attendance/src/screens/ReaderHealth';
export { default as ReaderSync } from '../../attendance/src/screens/ReaderSync';
export { default as DeviceLogs } from '../../attendance/src/screens/DeviceLogs';
export { default as Enrolments } from '../../attendance/src/screens/Enrolments';
export { default as UnmatchedPunches } from '../../attendance/src/screens/UnmatchedPunches';
export { default as IdMapping } from '../../attendance/src/screens/IdMapping';
export { default as PhonePunches } from '../../attendance/src/screens/PhonePunches';
export { default as Geofences } from '../../attendance/src/screens/Geofences';
export { default as SiteCheck } from '../../attendance/src/screens/SiteCheck';
export { default as WeeklyOffPolicy } from '../../attendance/src/screens/WeeklyOffPolicy';
export { default as OvertimePolicy } from '../../attendance/src/screens/OvertimePolicy';
export { default as ShiftPolicy } from '../../attendance/src/screens/AttendanceRules';
export { default as Contractors } from '../../attendance/src/screens/Contractors';
export { default as AttendanceReports } from '../../attendance/src/screens/AttendanceReports';
export { default as MonthSummary } from '../../attendance/src/screens/MonthSummary';
export { default as AttendanceRegister } from '../../attendance/src/screens/AttendanceRegister';
export { default as Transactions } from '../../attendance/src/screens/Transactions';
export { default as DataImport } from '../../attendance/src/screens/DataImport';
/* One audit trail for the company, in Workspace (ADR-010); this opens it on People and Attendance's share. */
export const AuditLogs = () => React.createElement(OpenInCompanyAdmin, { title: 'Audit Logs', screen: 'audit', forApp: 'attendance' });
/* Settings (People → Settings): the hub, company master data, and the shared screens it opens. */
export { default as PeopleSettings } from './screens/PeopleSettings';
export { default as PeopleModules } from './screens/PeopleModules';
export { default as CompanyDetails } from '@ui/company/CompanyDetails';
export { default as Integrations } from '../../attendance/src/screens/Integrations';
export { default as DataExport } from '../../attendance/src/screens/DataExport';
export { default as RecycleBin } from '../../attendance/src/screens/RecycleBin';
export { default as DataProtection } from '../../attendance/src/screens/DataProtection';
export { default as DataRequests } from '../../attendance/src/screens/DataRequests';
/* Sign-in, SSO, users and roles are the company's: they live in Workspace (ADR-010), and this entry opens it. */
export const SsoSettings = () => React.createElement(OpenInCompanyAdmin, { title: 'Users & Security', screen: 'sso' });
/* This app's roles and permissions, in Workspace's one role editor, opened on People's share (ADR-010). */
export const RolesAccess = () => React.createElement(OpenInCompanyAdmin, { title: 'Roles & Access', screen: 'permissions', forApp: 'people' });
/* Which of the company's emails go out is set once for every app, in Workspace (automations B5). */
export const EmailNotifications = () => React.createElement(OpenInCompanyAdmin, { title: 'Email notifications', screen: 'notifications' });

