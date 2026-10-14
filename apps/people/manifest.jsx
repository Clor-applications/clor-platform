import { Briefcase, Building2, IdCard, LayoutDashboard, Network, Shapes, Tag, UserRound, Users } from 'lucide-react';

import PeopleOverview from './src/screens/PeopleOverview';
import Employees from './src/screens/Employees';
import OrgChart from './src/screens/OrgChart';
import Tags from './src/screens/Tags';
import { Departments, EmployeeTypes, JobPositions, JobRoles, WorkTypes } from './src/screens/StructureList';

/**
 * Everything the shell knows about People.
 *
 * The staff directory every other app refers to: Payroll pays these people,
 * Attendance will record their days. Modules and operations follow Horilla
 * HRMS's employee app (reference only; LGPL code is not copied).
 */
export const peopleApp = {
  id: 'people',
  name: 'People',
  icon: UserRound,
  blurb: 'The staff directory every other app refers to.',
  available: true,
  database: 'people.db',
  home: 'overview',

  nav: [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'employees', label: 'Employees', icon: Users },
    { key: 'orgChart', label: 'Org chart', icon: Network },
    { section: 'Settings' },
    { key: 'departments', label: 'Departments', icon: Building2 },
    { key: 'jobPositions', label: 'Job positions', icon: Briefcase },
    { key: 'jobRoles', label: 'Job roles', icon: IdCard },
    { key: 'employeeTypes', label: 'Employee types', icon: Shapes },
    { key: 'workTypes', label: 'Work types', icon: Shapes },
    { key: 'tags', label: 'Tags', icon: Tag },
  ],

  screens: {
    overview: PeopleOverview,
    employees: Employees,
    orgChart: OrgChart,
    departments: Departments,
    jobPositions: JobPositions,
    jobRoles: JobRoles,
    employeeTypes: EmployeeTypes,
    workTypes: WorkTypes,
    tags: Tags,
  },
};
