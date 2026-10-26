import React from 'react';
import {
  AppsListColor,
  ArrowSyncColor,
  BeachColor,
  BookOpenLightbulbColor,
  BookmarkColor,
  BriefcaseColor,
  BuildingColor,
  CalendarCheckmarkColor,
  CalendarClockColor,
  CalendarColor,
  CalendarDataBarColor,
  CalendarEditColor,
  CalendarPeopleColor,
  ChatBubblesQuestionColor,
  ClipboardTaskColor,
  CoinMultipleColor,
  DatabaseColor,
  DataPieColor,
  ContactCardColor,
  DataBarVerticalAscendingColor,
  DocumentAddColor,
  DocumentTextColor,
  DocumentFolderColor,
  GiftColor,
  GlobeShieldColor,
  HistoryColor,
  LockClosedColor,
  LocationRippleColor,
  HomeColor,
  LinkMultipleColor,
  RibbonStarColor,
  SettingsColor,
  ShieldColor,
  TableColor,
  ClockColor,
  ArrowSquareDownColor,
  LaptopColor,
  MegaphoneLoudColor,
  OrgColor,
  PeopleAddColor,
  PeopleColor,
  PeopleListColor,
  PersonAvailableColor,
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
const Employees = screen('Workforce');
const EmployeeRecord = screen('EmployeeRecord');
const AddEmployee = screen('AddEmployee');
const ImportEmployees = screen('ImportEmployees');
const Approvals = screen('Approvals');
const Policies = screen('Policies');
const ApprovalRules = screen('ApprovalRules');
const HelpDesk = screen('HelpDesk');
const PrivateCases = screen('PrivateCases');
const HelpDeskSettings = screen('HelpDeskSettings');
const OrgChart = screen('OrgChart');
const Tags = screen('Tags');
const Departments = screen('Departments');
const EmployeeTypes = screen('EmployeeTypes');
const JobPositions = screen('JobPositions');
const JobRoles = screen('JobRoles');
const WorkTypes = screen('WorkTypes');
const DataHealth = screen('DataHealth');
const Checklists = screen('Checklists');
const LetterTemplates = screen('LetterTemplates');
const CustomFieldsSettings = screen('CustomFieldsSettings');
const SelfServiceSettings = screen('SelfServiceSettings');
const ComplianceCalendar = screen('ComplianceCalendar');
const Compliance = screen('Compliance');
const Privacy = screen('Privacy');
const AuditEvidence = screen('AuditEvidence');
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
const LeaveCalendar = screen('LeaveCalendar');
const LeaveRegister = screen('LeaveRegister');
const TeamAttendance = screen('TeamAttendance');
const MyDays = screen('MyDays');
const DataImport = screen('DataImport');
const AuditLogs = screen('AuditLogs');
const PeopleSettings = screen('PeopleSettings');
const PeopleModules = screen('PeopleModules');
const CompanyDetails = screen('CompanyDetails');
const BusinessUnits = screen('BusinessUnits');
const LegalEntities = screen('LegalEntities');
const Establishments = screen('Establishments');
const Teams = screen('Teams');
const Seats = screen('Seats');
const Grades = screen('Grades');
const CostCentres = screen('CostCentres');
const Locations = screen('Locations');
const Integrations = screen('Integrations');
const DataExport = screen('DataExport');
const RecycleBin = screen('RecycleBin');
const DataProtection = screen('DataProtection');
const DataRequests = screen('DataRequests');
const SsoSettings = screen('SsoSettings');
const RolesAccess = screen('RolesAccess');

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
  calendar: colorIcon(CalendarDataBarColor, 'CalendarDataBar'),
  register: colorIcon(TableColor, 'Table'),
  attendance: colorIcon(PersonAvailableColor, 'PersonAvailable'),
  myDays: colorIcon(ClockColor, 'Clock'),
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
  settings: colorIcon(SettingsColor, 'Settings'),
  modules: colorIcon(AppsListColor, 'AppsList'),
  company: colorIcon(BuildingColor, 'Building'),
  unit: colorIcon(DataPieColor, 'DataPie'),
  grade: colorIcon(RibbonStarColor, 'RibbonStar'),
  costCentre: colorIcon(DatabaseColor, 'Database'),
  location: colorIcon(LocationRippleColor, 'LocationRipple'),
  integrations: colorIcon(LinkMultipleColor, 'LinkMultiple'),
  export: colorIcon(ArrowSquareDownColor, 'ArrowSquareDown'),
  bin: colorIcon(HistoryColor, 'History'),
  privacy: colorIcon(ShieldColor, 'Shield'),
  requests: colorIcon(GlobeShieldColor, 'GlobeShield'),
  sso: colorIcon(LockClosedColor, 'LockClosed'),
  sync: colorIcon(ArrowSyncColor, 'ArrowSync'),
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
  /* People's own accent, Burnished Rose, on Accounting's graphite chrome and layout (owner, 24 Oct 2026;
     docs/people/08-DECISIONS-AND-RISKS.md D-01). The shared palette lives in packages/ui/src/index.css;
     the colour icons stay. */
  palette: 'rose',
  /* The phone's tab bar (spec v1 §6): what employees and managers reach for; the rest is behind Menu. */
  mobileTabs: ['overview', 'employees', 'approvals', 'leaveRequests'],
  iconSet: 'color',

  /* The sidebar holds the day's work; everything set up once lives on one Settings page (PeopleSettings), its pages marked `parent: 'settings'`. */
  modules: [
    { key: 'overview', label: 'Home', items: ['overview', 'approvals'] },
    /* Workforce package (owner, 26 Oct 2026): the visible module is Workforce; screen keys stay `employees` so old links keep working. */
    { key: 'employees', label: 'Workforce', groups: [
      { label: 'Directory', items: ['employees', 'orgChart', 'documents'] },
      { label: 'Help', items: ['helpdesk', 'policies', 'privateCases'] },
      { label: 'Joining & Leaving', items: ['checklists', 'assets'] },
      { label: 'Pay & Benefits', items: ['compensation', 'benefits'] },
    ] },
    /* Leave and holidays are HR's; Attendance reads the same records (founder, 22 Oct 2026). */
    { key: 'leave', label: 'Leave & Attendance', short: 'Time', groups: [
      { label: 'Leave', items: ['leaveRequests', 'leaveCalendar', 'leaveBalances', 'leaveRegister'] },
      { label: 'Attendance', items: ['attendance'] },
      { label: 'Me', items: ['myLeave', 'myDays'] },
    ] },
    { key: 'hiring', label: 'Hiring', items: ['recruitment', 'candidates'] },
    { key: 'growth', label: 'Performance', items: ['performance', 'learning'] },
    { key: 'workplace', label: 'Engage', items: ['announcements', 'events'] },
    { key: 'reports', label: 'Insights', items: ['reports', 'dataHealth', 'compliance', 'complianceCalendar', 'privacy', 'auditEvidence'] },
    { key: 'settings', label: 'Settings', items: ['settings'] },
  ],

  /* `permission`: what the screen's data needs; the shell hides what this user cannot open. */
  nav: [
    { key: 'overview', label: 'Home', icon: I.home, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'approvals', label: 'Approvals', icon: I.checklist, permission: 'PEOPLE::Requests::VIEW' },
    { key: 'employees', label: 'Employees', icon: I.people, permission: 'PEOPLE::Employees::VIEW' },
    /* Pages inside Workforce (profile, add, import): reached from the directory, never their own sidebar entries; the shell shows "← Workforce". */
    { key: 'employee', label: 'Employee', icon: I.people, permission: 'PEOPLE::Employees::VIEW', parent: 'employees' },
    { key: 'employeeNew', label: 'Add Employee', icon: I.people, permission: 'PEOPLE::Employees::CREATE', parent: 'employees' },
    { key: 'employeeImport', label: 'Import Employees', icon: I.import, permission: 'PEOPLE::Employees::CREATE', parent: 'employees' },
    { key: 'orgChart', label: 'Org Chart', icon: I.org, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'documents', label: 'Documents', icon: I.folder, permission: 'PEOPLE::Documents::VIEW' },
    { key: 'policies', label: 'Policies', icon: I.policy, permission: 'PEOPLE::Policies::VIEW' },
    { key: 'checklists', label: 'Onboarding & Exit', icon: I.checklist, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'selfService', label: 'Employee Portal Access', icon: I.key, permission: 'ATTENDANCE::Employee Portal::VIEW', parent: 'settings' },
    { key: 'letterTemplates', label: 'Letters', icon: I.policy, permission: 'PEOPLE::Documents::VIEW', parent: 'settings' },
    { key: 'customFields', label: 'Custom Fields', icon: I.tag, permission: 'PEOPLE::Org Structure::EDIT', parent: 'settings' },
    { key: 'selfServiceChanges', label: 'Employee Self-Edits', icon: I.key, permission: 'PEOPLE::Org Structure::EDIT', parent: 'settings' },
    { key: 'approvalRules', label: 'Approval Rules', icon: I.checklist, permission: 'PEOPLE::Approvals::VIEW', parent: 'settings' },
    { key: 'leaveRequests', label: 'Leave Applications', icon: I.leave, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveBalances', label: 'Leave Balances', icon: I.balance, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveRegister', label: 'Leave Register', icon: I.register, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveCalendar', label: 'Leave Calendar', icon: I.calendar, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'attendance', label: 'Attendance', icon: I.attendance, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'myDays', label: 'My Attendance', icon: I.myDays, permission: 'ATTENDANCE::My Attendance::VIEW' },
    { key: 'myLeave', label: 'My Leave', icon: I.myLeave, permission: 'ATTENDANCE::My Attendance::VIEW' },
    { key: 'leaveTypes', label: 'Leave Policy', icon: I.policy, permission: 'ATTENDANCE::Leave Types::VIEW', parent: 'settings' },
    { key: 'holidays', label: 'Holidays', icon: I.holiday, permission: 'ATTENDANCE::Holidays::VIEW', parent: 'settings' },
    { key: 'recruitment', label: 'Jobs', icon: I.job, permission: 'PEOPLE::Recruitment::VIEW', feature: 'peopleHiring' },
    { key: 'candidates', label: 'Candidates', icon: I.candidate, permission: 'PEOPLE::Recruitment::VIEW', feature: 'peopleHiring' },
    { key: 'performance', label: 'Goals & Feedback', icon: I.goal, permission: 'PEOPLE::Performance::VIEW', feature: 'peoplePerformance' },
    { key: 'learning', label: 'Training', icon: I.training, permission: 'PEOPLE::Learning::VIEW', feature: 'peoplePerformance' },
    { key: 'announcements', label: 'Announcements', icon: I.news, permission: 'PEOPLE::Announcements::VIEW', feature: 'peopleEngage' },
    { key: 'events', label: 'Events', icon: I.event, permission: 'PEOPLE::Events::VIEW', feature: 'peopleEngage' },
    { key: 'helpdesk', label: 'Help Desk', icon: I.hrCase, permission: 'PEOPLE::HR Cases::VIEW' },
    { key: 'privateCases', label: 'Private Cases', icon: I.privacy, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'helpDeskSettings', label: 'Help Desk Settings', icon: I.hrCase, permission: 'PEOPLE::HR Cases::EDIT', parent: 'settings' },
    { key: 'assets', label: 'Assets', icon: I.asset, permission: 'PEOPLE::Assets::VIEW', feature: 'peopleBenefits' },
    { key: 'benefits', label: 'Benefits', icon: I.benefit, permission: 'PEOPLE::Benefits::VIEW', feature: 'peopleBenefits' },
    { key: 'compensation', label: 'Salary Revisions', icon: I.salary, permission: 'PAYROLL::Salary Revisions::VIEW', feature: 'peopleBenefits' },
    { key: 'reports', label: 'Workforce Report', icon: I.report, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'dataHealth', label: 'Data Health', icon: I.health, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'compliance', label: 'Compliance', icon: I.compliance, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'complianceCalendar', label: 'Compliance Calendar', icon: I.compliance, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'privacy', label: 'Privacy', icon: I.privacy, permission: 'PEOPLE::Privacy::VIEW' },
    /* The external auditor's own list: what a live grant names (PRV-06). */
    { key: 'auditEvidence', label: 'Audit Evidence', icon: I.audit, permission: 'SETTINGS::Audit trail::VIEW' },
    { key: 'departments', label: 'Departments', icon: I.department, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'teams', label: 'Teams', icon: I.people, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'seats', label: 'Positions', icon: I.org, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'jobPositions', label: 'Designations', icon: I.designation, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'jobRoles', label: 'Job Roles', icon: I.role, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'employeeTypes', label: 'Employment Types', icon: I.type, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'workTypes', label: 'Work Modes', icon: I.workType, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'tags', label: 'Tags', icon: I.tag, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'dataImport', label: 'Import Data', icon: I.import, permission: 'PEOPLE::Employees::CREATE', parent: 'settings' },
    { key: 'settings', label: 'Settings', icon: I.settings, hub: true },
    /* Founder, 22 Oct 2026: modules switch on and off, within what the subscription carries. */
    { key: 'modules', label: 'Modules & Apps', icon: I.modules, permission: 'SETTINGS::Company Profile::VIEW', parent: 'settings' },
    { key: 'companyDetails', label: 'Company Details', icon: I.company, permission: 'SETTINGS::Company Profile::VIEW', parent: 'settings' },
    { key: 'legalEntities', label: 'Company (legal)', icon: I.company, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'establishments', label: 'Work Sites', icon: I.location, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'businessUnits', label: 'Business Units', icon: I.unit, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'areas', label: 'Locations', icon: I.location, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'grades', label: 'Grades', icon: I.grade, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'costCentres', label: 'Cost Centres', icon: I.costCentre, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'sso', label: 'Users & Security', icon: I.sso, permission: 'SETTINGS::Users::VIEW', parent: 'settings' },
    { key: 'rolesAccess', label: 'Roles & Access', icon: I.sso, permission: 'SETTINGS::Roles::VIEW', parent: 'settings' },
    { key: 'integrations', label: 'Integrations', icon: I.integrations, permission: 'ATTENDANCE::Attendance Integrations::VIEW', parent: 'settings' },
    { key: 'dataExport', label: 'Export Data', icon: I.export, permission: 'ATTENDANCE::Attendance Records::VIEW', parent: 'settings' },
    { key: 'recycleBin', label: 'Recycle Bin', icon: I.bin, permission: 'ATTENDANCE::Attendance Records::VIEW', parent: 'settings' },
    { key: 'dataProtection', label: 'Data Protection', icon: I.privacy, permission: 'ATTENDANCE::Employee Portal::VIEW', parent: 'settings' },
    { key: 'dataRequests', label: 'Data Requests', icon: I.requests, permission: 'PEOPLE::Employees::VIEW', parent: 'settings' },
    { key: 'auditLogs', label: 'Audit Logs', icon: I.audit, permission: 'SETTINGS::Audit trail::VIEW', parent: 'settings' },
  ],

  screens: {
    overview: PeopleOverview,
    approvals: Approvals,
    policies: Policies,
    employees: Employees,
    employee: EmployeeRecord,
    employeeNew: AddEmployee,
    employeeImport: ImportEmployees,
    orgChart: OrgChart,
    documents: PeopleDocuments,
    checklists: Checklists,
    letterTemplates: LetterTemplates,
    customFields: CustomFieldsSettings,
    selfServiceChanges: SelfServiceSettings,
    approvalRules: ApprovalRules,
    selfService: PortalAccess,
    leaveRequests: LeaveRequests,
    leaveBalances: LeaveBalances,
    myLeave: MyLeave,
    leaveTypes: LeaveTypes,
    holidays: Holidays,
    leaveCalendar: LeaveCalendar,
    leaveRegister: LeaveRegister,
    attendance: TeamAttendance,
    myDays: MyDays,
    recruitment: register('recruitment'),
    candidates: register('candidates'),
    performance: register('performance'),
    learning: register('learning'),
    announcements: register('announcements'),
    events: register('events'),
    helpdesk: HelpDesk,
    privateCases: PrivateCases,
    helpDeskSettings: HelpDeskSettings,
    assets: register('assets'),
    benefits: register('benefits'),
    compensation: SalaryRevisions,
    reports: PeopleReports,
    dataHealth: DataHealth,
    compliance: Compliance,
    complianceCalendar: ComplianceCalendar,
    privacy: Privacy,
    auditEvidence: AuditEvidence,
    departments: Departments,
    teams: Teams,
    seats: Seats,
    jobPositions: JobPositions,
    jobRoles: JobRoles,
    employeeTypes: EmployeeTypes,
    workTypes: WorkTypes,
    tags: Tags,
    dataImport: DataImport,
    auditLogs: AuditLogs,
    settings: PeopleSettings,
    modules: PeopleModules,
    companyDetails: CompanyDetails,
    legalEntities: LegalEntities,
    establishments: Establishments,
    businessUnits: BusinessUnits,
    areas: Locations,
    grades: Grades,
    costCentres: CostCentres,
    sso: SsoSettings,
    rolesAccess: RolesAccess,
    integrations: Integrations,
    dataExport: DataExport,
    recycleBin: RecycleBin,
    dataProtection: DataProtection,
    dataRequests: DataRequests,
  },
};
