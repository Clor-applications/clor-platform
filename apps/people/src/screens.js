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
export { default as Approvals } from './screens/Approvals';
export { default as Policies } from './screens/Policies';
export { default as ApprovalRules } from './screens/ApprovalRules';
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
export { default as LifecycleOverview } from '@ui/lifecycle/Overview';
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
export { default as PeopleReports } from './screens/PeopleReports';
export { default as Registers, LeaveSummaryReport } from './screens/Registers';
export { default as PeopleDocuments } from './screens/PeopleDocuments';
export { default as Holidays } from '../../attendance/src/screens/Holidays';
export { default as PortalAccess } from '../../attendance/src/screens/PortalAccess';
export { default as SalaryRevisions } from '../../payroll/src/screens/SalaryRevisions';
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

