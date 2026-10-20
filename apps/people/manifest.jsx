import { Briefcase, Building2, IdCard, LayoutDashboard, Network, Shapes, Tag, UserRound, Users } from 'lucide-react';

import { lazyScreens } from '@ui/utils/lazyScreens';

/* Screens load as one file the first time the app opens (WX-03). */
const screen = lazyScreens(() => import('./src/screens.js'));
const PeopleOverview = screen('PeopleOverview');
const Employees = screen('Employees');
const OrgChart = screen('OrgChart');
const Tags = screen('Tags');
const Departments = screen('Departments');
const EmployeeTypes = screen('EmployeeTypes');
const JobPositions = screen('JobPositions');
const JobRoles = screen('JobRoles');
const WorkTypes = screen('WorkTypes');

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
    { key: 'overview', label: 'Overview', icon: LayoutDashboard, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'employees', label: 'Employees', icon: Users, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'orgChart', label: 'Org chart', icon: Network, permission: 'PEOPLE::Org Structure::VIEW' },
    { section: 'Settings' },
    { key: 'departments', label: 'Departments', icon: Building2, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'jobPositions', label: 'Job positions', icon: Briefcase, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'jobRoles', label: 'Job roles', icon: IdCard, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'employeeTypes', label: 'Employee types', icon: Shapes, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'workTypes', label: 'Work types', icon: Shapes, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'tags', label: 'Tags', icon: Tag, permission: 'PEOPLE::Org Structure::VIEW' },
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
