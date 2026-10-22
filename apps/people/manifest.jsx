import React from 'react';
import { Archive, BarChart3, BadgeCheck, Banknote, Briefcase, Building2, CalendarCheck, CalendarDays, ClipboardCheck, FileCheck2, FileText, IdCard, LayoutDashboard, LifeBuoy, Megaphone, Network, PartyPopper, Shapes, ShieldCheck, Tag, UserRound, Users, UserPlus, WalletCards } from 'lucide-react';

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
const DataHealth = screen('DataHealth');
const Checklists = screen('Checklists');
const ComplianceCalendar = screen('ComplianceCalendar');
const WorkspaceList = screen('WorkspaceList');
const PeopleReports = screen('PeopleReports');
const PeopleDocuments = screen('PeopleDocuments');
const Holidays = screen('Holidays');
const PortalAccess = screen('PortalAccess');
const SalaryRevisions = screen('SalaryRevisions');
const LeaveRequests = screen('LeaveRequests');
const LeaveBalances = screen('LeaveBalances');
const LeaveTypes = screen('LeaveTypes');
const MyLeave = screen('MyLeave');
const DataImport = screen('DataImport');

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

  /* Match Attendance and Payroll: a module rail with grouped screens. */
  modules: [
    { key: 'overview', label: 'Overview', items: ['overview'] },
    { key: 'employees', label: 'Employees', groups: [
      { label: 'Directory', items: ['employees', 'orgChart', 'documents'] },
      { label: 'Changes', items: ['checklists', 'selfService'] },
    ] },
    { key: 'leave', label: 'Leave', items: ['leaveRequests', 'leaveBalances', 'leaveTypes', 'myLeave', 'holidays'] },
    { key: 'hiring', label: 'Hiring', items: ['recruitment', 'candidates'] },
    { key: 'growth', label: 'Growth', items: ['performance', 'learning'] },
    { key: 'workplace', label: 'Workplace', groups: [
      { label: 'Updates', items: ['announcements', 'events'] },
      { label: 'Support', items: ['helpdesk', 'assets', 'benefits', 'compensation'] },
    ] },
    { key: 'reports', label: 'Reports', items: ['reports', 'dataHealth', 'complianceCalendar'] },
    { key: 'settings', label: 'Settings', items: ['departments', 'jobPositions', 'jobRoles', 'employeeTypes', 'workTypes', 'tags'] },
  ],

  nav: [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'employees', label: 'Employees', icon: Users, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'orgChart', label: 'Org chart', icon: Network, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'checklists', label: 'Onboarding & exit', icon: ClipboardCheck, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'candidates', label: 'Candidates', icon: Users, permission: 'PEOPLE::Recruitment::VIEW' },
    { key: 'holidays', label: 'Holidays', icon: CalendarDays, permission: 'ATTENDANCE::Holidays::VIEW' },
    { key: 'recruitment', label: 'Jobs', icon: UserPlus, permission: 'PEOPLE::Recruitment::VIEW' },
    { key: 'performance', label: 'Goals & feedback', icon: BadgeCheck, permission: 'PEOPLE::Performance::VIEW' },
    { key: 'learning', label: 'Training', icon: FileCheck2, permission: 'PEOPLE::Learning::VIEW' },
    { key: 'helpdesk', label: 'HR cases', icon: LifeBuoy, permission: 'PEOPLE::HR Cases::VIEW' },
    { key: 'selfService', label: 'Portal access', icon: UserRound, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'compensation', label: 'Salary revisions', icon: Banknote, permission: 'PAYROLL::Salary Revisions::VIEW' },
    { key: 'benefits', label: 'Benefits', icon: WalletCards, permission: 'PEOPLE::Benefits::VIEW' },
    { key: 'assets', label: 'Assets', icon: Archive, permission: 'PEOPLE::Assets::VIEW' },
    { key: 'reports', label: 'Reports', icon: BarChart3, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'documents', label: 'Documents', icon: FileText, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'leaveRequests', label: 'Leave requests', icon: CalendarCheck, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveBalances', label: 'Leave balances', icon: WalletCards, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveTypes', label: 'Leave policy', icon: CalendarDays, permission: 'ATTENDANCE::Leave Types::VIEW' },
    { key: 'myLeave', label: 'My leave', icon: CalendarCheck, permission: 'ATTENDANCE::My Attendance::VIEW' },
    { key: 'announcements', label: 'Announcements', icon: Megaphone, permission: 'PEOPLE::Announcements::VIEW' },
    { key: 'events', label: 'Events', icon: PartyPopper, permission: 'PEOPLE::Events::VIEW' },
    { key: 'complianceCalendar', label: 'Compliance calendar', icon: CalendarCheck, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'dataHealth', label: 'Data health', icon: ShieldCheck, permission: 'PEOPLE::Employees::VIEW' },
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
    dataHealth: DataHealth,
    checklists: Checklists,
    complianceCalendar: ComplianceCalendar,
    departments: Departments,
    jobPositions: JobPositions,
    jobRoles: JobRoles,
    employeeTypes: EmployeeTypes,
    workTypes: WorkTypes,
    tags: Tags,
    recruitment: () => <WorkspaceList kind="recruitment" />,
    candidates: () => <WorkspaceList kind="candidates" />,
    performance: () => <WorkspaceList kind="performance" />,
    learning: () => <WorkspaceList kind="learning" />,
    helpdesk: () => <WorkspaceList kind="helpdesk" />,
    benefits: () => <WorkspaceList kind="benefits" />,
    assets: () => <WorkspaceList kind="assets" />,
    announcements: () => <WorkspaceList kind="announcements" />,
    events: () => <WorkspaceList kind="events" />,
    reports: PeopleReports,
    documents: PeopleDocuments,
    selfService: PortalAccess,
    compensation: SalaryRevisions,
    holidays: Holidays,
    leaveRequests: LeaveRequests,
    leaveBalances: LeaveBalances,
    leaveTypes: LeaveTypes,
    myLeave: MyLeave,
    dataImport: DataImport,
  },
};
