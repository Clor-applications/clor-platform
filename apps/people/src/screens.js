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
