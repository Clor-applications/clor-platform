import React from 'react';
import OpenInCompanyAdmin from '@ui/company/OpenInCompanyAdmin';
/**
 * Every screen People shows, in one place, so the manifest can load
 * them as one file the first time the app opens (WX-03). The manifest names
 * them; nothing else should import from here.
 */
export { default as PeopleOverview } from './screens/PeopleOverview';
export { Employees } from './screens/EmployeesList';
export { default as OrgChart } from './screens/OrgChart';
export { default as Tags } from './screens/Tags';
export { DataHealth } from './screens/DataHealth';
export { default as Checklists } from '@ui/personnel/Checklists';
export { default as ComplianceCalendar } from '@ui/personnel/ComplianceCalendar';
export { Departments, EmployeeTypes, JobRoles, WorkTypes } from '@ui/personnel/StructureList';
export { JobPositions } from './screens/Designations';
export { default as WorkspaceList } from './screens/WorkspaceList';
export { default as PeopleReports } from './screens/PeopleReports';
export { default as PeopleDocuments } from './screens/PeopleDocuments';
export { default as Holidays } from '../../attendance/src/screens/Holidays';
export { default as PortalAccess } from '../../attendance/src/screens/PortalAccess';
export { default as SalaryRevisions } from '../../payroll/src/screens/SalaryRevisions';
/* Leave is HR's (founder, 22 Oct 2026): People's own screens over the same records Attendance reads. */
export { default as LeaveRequests } from './timeOff/LeaveRequests';
export { default as LeaveBalances } from './timeOff/LeaveBalances';
export { default as LeaveTypes } from './timeOff/LeavePolicy';
export { default as LeaveCalendar } from './timeOff/LeaveCalendar';
export { default as LeaveRegister } from './timeOff/LeaveRegister';
export { default as TeamAttendance } from './timeOff/TeamAttendance';
export { default as MyDays } from './timeOff/MyDays';
export { default as MyLeave } from '../../attendance/src/screens/MyLeave';
export { default as DataImport } from '../../attendance/src/screens/DataImport';
export { default as AuditLogs } from '../../attendance/src/screens/AuditLogs';
/* Settings (People → Settings): the hub, company master data, and the shared screens it opens. */
export { default as PeopleSettings } from './screens/PeopleSettings';
export { default as PeopleModules } from './screens/PeopleModules';
export { default as CompanyDetails } from '@ui/company/CompanyDetails';
export { BusinessUnits, Grades, CostCentres } from '@ui/personnel/StructureList';
export { Areas as Locations } from '../../attendance/src/screens/OrgLists';
export { default as Integrations } from '../../attendance/src/screens/Integrations';
export { default as DataExport } from '../../attendance/src/screens/DataExport';
export { default as RecycleBin } from '../../attendance/src/screens/RecycleBin';
export { default as DataProtection } from '../../attendance/src/screens/DataProtection';
export { default as DataRequests } from '../../attendance/src/screens/DataRequests';
/* Sign-in, SSO, users and roles are the company's: they live in Company admin (ADR-010), and this entry opens it. */
export const SsoSettings = () => React.createElement(OpenInCompanyAdmin, { title: 'Users & Security', screen: 'sso' });
/* This app's roles and permissions, in Company admin's one role editor, opened on People's share (ADR-010). */
export const RolesAccess = () => React.createElement(OpenInCompanyAdmin, { title: 'Roles & Access', screen: 'permissions', forApp: 'people' });

