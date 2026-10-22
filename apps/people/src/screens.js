/**
 * Every screen People shows, in one place, so the manifest can load
 * them as one file the first time the app opens (WX-03). The manifest names
 * them; nothing else should import from here.
 */
export { default as PeopleOverview } from './screens/PeopleOverview';
export { default as Employees } from '@ui/personnel/Employees';
export { default as OrgChart } from './screens/OrgChart';
export { default as Tags } from './screens/Tags';
export { DataHealth } from './screens/DataHealth';
export { default as Checklists } from '@ui/personnel/Checklists';
export { default as ComplianceCalendar } from '@ui/personnel/ComplianceCalendar';
export { Departments, EmployeeTypes, JobPositions, JobRoles, WorkTypes } from '@ui/personnel/StructureList';
export { default as WorkspaceList } from './screens/WorkspaceList';
export { default as PeopleReports } from './screens/PeopleReports';
export { default as PeopleDocuments } from './screens/PeopleDocuments';
export { default as Holidays } from '../../attendance/src/screens/Holidays';
export { default as PortalAccess } from '../../attendance/src/screens/PortalAccess';
export { default as SalaryRevisions } from '../../payroll/src/screens/SalaryRevisions';
export { default as LeaveRequests } from '../../attendance/src/screens/LeaveRequests';
export { default as LeaveBalances } from '../../attendance/src/screens/LeaveBalances';
export { default as LeaveTypes } from '../../attendance/src/screens/LeaveTypes';
export { default as MyLeave } from '../../attendance/src/screens/MyLeave';
export { default as DataImport } from '../../attendance/src/screens/DataImport';
