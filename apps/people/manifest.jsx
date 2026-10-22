import React from 'react';
import {
  BeachColor,
  BookOpenLightbulbColor,
  BookmarkColor,
  BriefcaseColor,
  BuildingColor,
  CalendarCheckmarkColor,
  CalendarClockColor,
  CalendarColor,
  CalendarEditColor,
  CalendarPeopleColor,
  ChatBubblesQuestionColor,
  ClipboardTaskColor,
  CoinMultipleColor,
  ContactCardColor,
  DataBarVerticalAscendingColor,
  DocumentAddColor,
  DocumentTextColor,
  DocumentFolderColor,
  GiftColor,
  HomeColor,
  LaptopColor,
  MegaphoneLoudColor,
  OrgColor,
  PeopleAddColor,
  PeopleColor,
  PeopleListColor,
  PersonKeyColor,
  PersonStarburstColor,
  SavingsColor,
  ShieldCheckmarkColor,
  ShiftsColor,
  TrophyColor,
} from '@fluentui/react-icons';
import { UserRound } from 'lucide-react';

import { colorIcon } from '@ui/components/ui/iconSet';
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
const AuditLogs = screen('AuditLogs');

/* Full-colour icons, the same family as Attendance (packages/ui/src/components/ui/iconSet.jsx). */
const I = {
  home: colorIcon(HomeColor, 'Home'),
  people: colorIcon(PeopleColor, 'People'),
  org: colorIcon(OrgColor, 'Org'),
  folder: colorIcon(DocumentFolderColor, 'DocumentFolder'),
  checklist: colorIcon(ClipboardTaskColor, 'ClipboardTask'),
  key: colorIcon(PersonKeyColor, 'PersonKey'),
  leave: colorIcon(CalendarCheckmarkColor, 'CalendarCheckmark'),
  balance: colorIcon(SavingsColor, 'Savings'),
  policy: colorIcon(CalendarEditColor, 'CalendarEdit'),
  myLeave: colorIcon(BeachColor, 'Beach'),
  holiday: colorIcon(CalendarColor, 'Calendar'),
  job: colorIcon(BriefcaseColor, 'Briefcase'),
  candidate: colorIcon(PeopleAddColor, 'PeopleAdd'),
  goal: colorIcon(TrophyColor, 'Trophy'),
  training: colorIcon(BookOpenLightbulbColor, 'BookOpenLightbulb'),
  hrCase: colorIcon(ChatBubblesQuestionColor, 'ChatBubblesQuestion'),
  asset: colorIcon(LaptopColor, 'Laptop'),
  benefit: colorIcon(GiftColor, 'Gift'),
  salary: colorIcon(CoinMultipleColor, 'CoinMultiple'),
  news: colorIcon(MegaphoneLoudColor, 'MegaphoneLoud'),
  event: colorIcon(CalendarPeopleColor, 'CalendarPeople'),
  report: colorIcon(DataBarVerticalAscendingColor, 'DataBarVerticalAscending'),
  health: colorIcon(ShieldCheckmarkColor, 'ShieldCheckmark'),
  compliance: colorIcon(CalendarClockColor, 'CalendarClock'),
  department: colorIcon(BuildingColor, 'Building'),
  designation: colorIcon(ContactCardColor, 'ContactCard'),
  role: colorIcon(PersonStarburstColor, 'PersonStarburst'),
  type: colorIcon(PeopleListColor, 'PeopleList'),
  workType: colorIcon(ShiftsColor, 'Shifts'),
  tag: colorIcon(BookmarkColor, 'Bookmark'),
  import: colorIcon(DocumentAddColor, 'DocumentAdd'),
  audit: colorIcon(DocumentTextColor, 'DocumentText'),
};

/* One register screen per kind, with the shell's props (openScreen, params). */
const register = (kind) => {
  const Register = (props) => <WorkspaceList {...props} kind={kind} />;
  Register.displayName = `Register(${kind})`;
  return Register;
};

/**
 * Everything the shell knows about People.
 *
 * Every HR job, in plain words and at most two clicks from Home (founder,
 * 22 Oct 2026: all the features, simpler than the apps on the market). The
 * staff directory every other app refers to: Payroll pays these people,
 * Attendance records their days. Workflows follow Horilla HRMS as a
 * reference only; its LGPL code is not copied.
 */
export const peopleApp = {
  id: 'people',
  name: 'People',
  icon: UserRound,
  blurb: 'Every HR job in one place: people, time off, hiring, growth and the workplace.',
  available: true,
  database: 'people.db',
  home: 'overview',
  /* The shared Blaze palette and colour icons, as Attendance (packages/ui/src/index.css). */
  palette: 'blaze',
  iconSet: 'color',

  modules: [
    { key: 'overview', label: 'Home', items: ['overview'] },
    { key: 'employees', label: 'People', groups: [
      { label: 'Directory', items: ['employees', 'orgChart', 'documents'] },
      { label: 'Joining & Leaving', items: ['checklists'] },
      { label: 'Access', items: ['selfService'] },
    ] },
    { key: 'leave', label: 'Time Off', groups: [
      { label: 'Leave', items: ['leaveRequests', 'leaveBalances', 'myLeave'] },
      { label: 'Policy', items: ['leaveTypes', 'holidays'] },
    ] },
    { key: 'hiring', label: 'Hiring', items: ['recruitment', 'candidates'] },
    { key: 'growth', label: 'Growth', items: ['performance', 'learning'] },
    { key: 'workplace', label: 'Workplace', groups: [
      { label: 'Updates', items: ['announcements', 'events'] },
      { label: 'Support', items: ['helpdesk', 'assets', 'benefits', 'compensation'] },
    ] },
    { key: 'reports', label: 'Insights', groups: [
      { label: 'Reports', items: ['reports'] },
      { label: 'Checks', items: ['dataHealth', 'complianceCalendar'] },
    ] },
    { key: 'settings', label: 'Settings', groups: [
      { label: 'Organization', items: ['departments', 'jobPositions', 'jobRoles', 'employeeTypes', 'workTypes', 'tags'] },
      { label: 'Data', items: ['dataImport', 'auditLogs'] },
    ] },
  ],

  /* `permission`: what the screen's data needs; the shell hides what this user cannot open. */
  nav: [
    { key: 'overview', label: 'Home', icon: I.home, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'employees', label: 'Employees', icon: I.people, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'orgChart', label: 'Org Chart', icon: I.org, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'documents', label: 'Documents', icon: I.folder, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'checklists', label: 'Onboarding & Exit', icon: I.checklist, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'selfService', label: 'Employee Portal Access', icon: I.key, permission: 'ATTENDANCE::Employee Portal::VIEW' },
    { key: 'leaveRequests', label: 'Leave Requests', icon: I.leave, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveBalances', label: 'Leave Balances', icon: I.balance, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'myLeave', label: 'My Leave', icon: I.myLeave, permission: 'ATTENDANCE::My Attendance::VIEW' },
    { key: 'leaveTypes', label: 'Leave Policy', icon: I.policy, permission: 'ATTENDANCE::Leave Types::VIEW' },
    { key: 'holidays', label: 'Holidays', icon: I.holiday, permission: 'ATTENDANCE::Holidays::VIEW' },
    { key: 'recruitment', label: 'Jobs', icon: I.job, permission: 'PEOPLE::Recruitment::VIEW' },
    { key: 'candidates', label: 'Candidates', icon: I.candidate, permission: 'PEOPLE::Recruitment::VIEW' },
    { key: 'performance', label: 'Goals & Feedback', icon: I.goal, permission: 'PEOPLE::Performance::VIEW' },
    { key: 'learning', label: 'Training', icon: I.training, permission: 'PEOPLE::Learning::VIEW' },
    { key: 'announcements', label: 'Announcements', icon: I.news, permission: 'PEOPLE::Announcements::VIEW' },
    { key: 'events', label: 'Events', icon: I.event, permission: 'PEOPLE::Events::VIEW' },
    { key: 'helpdesk', label: 'HR Cases', icon: I.hrCase, permission: 'PEOPLE::HR Cases::VIEW' },
    { key: 'assets', label: 'Assets', icon: I.asset, permission: 'PEOPLE::Assets::VIEW' },
    { key: 'benefits', label: 'Benefits', icon: I.benefit, permission: 'PEOPLE::Benefits::VIEW' },
    { key: 'compensation', label: 'Salary Revisions', icon: I.salary, permission: 'PAYROLL::Salary Revisions::VIEW' },
    { key: 'reports', label: 'Workforce Report', icon: I.report, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'dataHealth', label: 'Data Health', icon: I.health, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'complianceCalendar', label: 'Compliance Calendar', icon: I.compliance, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'departments', label: 'Departments', icon: I.department, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'jobPositions', label: 'Designations', icon: I.designation, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'jobRoles', label: 'Job Roles', icon: I.role, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'employeeTypes', label: 'Employee Types', icon: I.type, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'workTypes', label: 'Work Types', icon: I.workType, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'tags', label: 'Tags', icon: I.tag, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'dataImport', label: 'Import Data', icon: I.import, permission: 'PEOPLE::Employees::CREATE' },
    { key: 'auditLogs', label: 'Audit Logs', icon: I.audit, permission: 'SETTINGS::Audit trail::VIEW' },
  ],

  screens: {
    overview: PeopleOverview,
    employees: Employees,
    orgChart: OrgChart,
    documents: PeopleDocuments,
    checklists: Checklists,
    selfService: PortalAccess,
    leaveRequests: LeaveRequests,
    leaveBalances: LeaveBalances,
    myLeave: MyLeave,
    leaveTypes: LeaveTypes,
    holidays: Holidays,
    recruitment: register('recruitment'),
    candidates: register('candidates'),
    performance: register('performance'),
    learning: register('learning'),
    announcements: register('announcements'),
    events: register('events'),
    helpdesk: register('helpdesk'),
    assets: register('assets'),
    benefits: register('benefits'),
    compensation: SalaryRevisions,
    reports: PeopleReports,
    dataHealth: DataHealth,
    complianceCalendar: ComplianceCalendar,
    departments: Departments,
    jobPositions: JobPositions,
    jobRoles: JobRoles,
    employeeTypes: EmployeeTypes,
    workTypes: WorkTypes,
    tags: Tags,
    dataImport: DataImport,
    auditLogs: AuditLogs,
  },
};
