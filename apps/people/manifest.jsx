import React from 'react';
import {
  ArrowsClockwise,
  Briefcase,
  Buildings,
  CalendarCheck,
  CalendarDots,
  CalendarStar,
  ChartBar,
  ChatsCircle,
  ChartPie,
  ChartPieSlice,
  CheckCircle,
  ClipboardText,
  Clock,
  ClockClockwise,
  ClockCounterClockwise,
  Coins,
  Database,
  DownloadSimple,
  FileArrowUp,
  FileLock,
  FileText,
  FolderOpen,
  GearSix,
  Gift,
  GlobeSimple,
  GraduationCap,
  Handshake,
  Headset,
  House,
  IdentificationCard,
  Laptop,
  LinkSimple,
  ListChecks,
  LockKey,
  MapPin,
  Medal,
  Receipt,
  Megaphone,
  NotePencil,
  Notebook,
  PiggyBank,
  SealCheck,
  Shield,
  ShieldCheck,
  SquaresFour,
  Star,
  Table,
  Tag,
  Textbox,
  TreeStructure,
  TrendUp,
  Trophy,
  Umbrella,
  UserCheck,
  UserCircleGear,
  UserGear,
  UserPlus,
  UserSwitch,
  UsersFour,
  UsersThree,
  ArrowsLeftRight,
  ListNumbers,
  SignIn,
  SignOut,
  UserCirclePlus,
} from '@phosphor-icons/react';
import { lazyScreens } from '@ui/utils/lazyScreens';
import { withSidePanel } from '@ui/components/list/SidePanel';

/* Screens load as one file the first time the app opens (WX-03). */
const screen = lazyScreens(() => import('./src/screens.js'));
/* The lists' side panels (src/panels.jsx), loaded with the first list that draws one. */
const panel = lazyScreens(() => import('./src/panels.jsx'));
/* People's request lists drop the Status column on a tab that already names the status; the Attendance app keeps theirs as it is. */
const statusFromTab = (Screen) => {
  const Tabbed = (props) => <Screen {...props} statusFromTab />;
  Tabbed.displayName = Screen.displayName || Screen.name;
  return Tabbed;
};
const PeopleOverview = screen('PeopleOverview');
const Employees = screen('Workforce');
const EmployeeRecord = screen('EmployeeRecord');
const AddEmployee = screen('AddEmployee');
const ImportEmployees = screen('ImportEmployees');
const Offers = screen('Offers');
const Expenses = screen('Expenses');
const Approvals = screen('Approvals');
const Policies = screen('Policies');
const ApprovalRules = screen('ApprovalRules');
const HelpDesk = screen('HelpDesk');
const PrivateCases = screen('PrivateCases');
const HelpDeskSettings = screen('HelpDeskSettings');
const OrgChart = screen('OrgChart');
const OrganizationOverview = screen('OrganizationOverview');
const Branches = screen('Branches');
const OrgChanges = screen('OrgChanges');
const OrgDepartments = screen('OrgDepartments');
const OrgEmploymentTypes = screen('OrgEmploymentTypes');
const OrgWorkModes = screen('OrgWorkModes');
const OrgLegalEntities = screen('OrgLegalEntities');
const OrgDesignations = screen('OrgDesignations');
const OrgJobRoles = screen('OrgJobRoles');
const OrgTeams = screen('OrgTeams');
const OrgPositions = screen('OrgPositions');
const OrgLocations = screen('OrgLocations');
const OrgWorkSites = screen('OrgWorkSites');
const OrgBusinessUnits = screen('OrgBusinessUnits');
const OrgGrades = screen('OrgGrades');
const OrgCostCentres = screen('OrgCostCentres');
const Tags = screen('Tags');
const DataHealth = screen('DataHealth');
const LifecycleTasks = screen('LifecycleTasks');
const LifecycleOverview = screen('LifecycleOverview');
const Joiners = screen('Joiners');
const LifecycleChanges = screen('LifecycleChanges');
const Leavers = screen('Leavers');
const JourneySteps = screen('JourneySteps');
const LetterTemplates = screen('LetterTemplates');
const CustomFieldsSettings = screen('CustomFieldsSettings');
const SelfServiceSettings = screen('SelfServiceSettings');
const Compliance = screen('Compliance');
const Privacy = screen('Privacy');
const AuditEvidence = screen('AuditEvidence');
const WorkspaceList = screen('WorkspaceList');
/* Talent (TALENT-DECISIONS.md): hiring and growth on their own records, /people/talent/*. */
const TalentOpenings = screen('TalentOpenings');
const TalentCandidates = screen('TalentCandidates');
const TalentInterviews = screen('TalentInterviews');
const TalentGoals = screen('TalentGoals');
const TalentReviews = screen('TalentReviews');
const TalentPlans = screen('TalentPlans');
const TalentOneOnOnes = screen('TalentOneOnOnes');
const TalentTrainings = screen('TalentTrainings');
const TalentReferrals = screen('TalentReferrals');
const TalentReferSomeone = screen('TalentReferSomeone');
const PeopleReports = screen('PeopleReports');
const Registers = screen('Registers');
const LeaveSummaryReport = screen('LeaveSummaryReport');
const PeopleDocuments = screen('PeopleDocuments');
const Holidays = screen('Holidays');
const PortalAccess = screen('PortalAccess');
const SalaryRevisions = screen('SalaryRevisions');
const LeaveRequests = screen('LeaveRequests');
const TimeOverview = screen('TimeOverview');
const WorkingWeek = screen('WorkingWeek');
const LeaveYearEnd = screen('LeaveYearEnd');
const StandIns = screen('StandIns');
const LeaveBlocks = screen('LeaveBlocks');
const AttendanceRequests = screen('AttendanceRequests');
const RequestRules = screen('RequestRules');
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
const Integrations = screen('Integrations');
const DataExport = screen('DataExport');
const RecycleBin = screen('RecycleBin');
const DataProtection = screen('DataProtection');
const DataRequests = screen('DataRequests');
const SsoSettings = screen('SsoSettings');
const RolesAccess = screen('RolesAccess');
/* Request types HR sets up, their report, shift swaps and a person's own requests (FEATURE-UI-AUDIT gaps 24, 25). */
const RequestForms = screen('RequestForms');
const RequestsReport = screen('RequestsReport');
const ShiftSwaps = screen('ShiftSwaps');
const MyRequests = screen('MyRequests');
/* Attendance rules: late marks, absences, night-work consent (WORKFLOW-GAP-RESEARCH 4.4, 4.6, B19). */
const AttendanceRulesSettings = screen('AttendanceRulesSettings');
/* Settings → Automations and Exit interview (WORKFLOW-GAP-RESEARCH 4.7, 4.9). */
const Automations = screen('Automations');
const ExitQuestions = screen('ExitQuestions');
const LateMarks = screen('LateMarks');
const Absences = screen('Absences');
const NightWork = screen('NightWork');

/* A Phosphor line mark, for the app's own tile in the bar (white on teal), where a full-colour icon would clash. */
const line = (Icon, name, tint) => {
  // eslint-disable-next-line no-unused-vars -- Lucide's strokeWidth and the old tint are taken off so neither reaches the svg
  const Line = ({ size = 16, strokeWidth, weight = 'duotone', className = '', ...rest }) => <Icon size={size} weight={weight} className={`ui-glyph ${className}`.trim()} {...rest} />;
  void tint;
  Line.displayName = `Line(${name})`;
  return Line;
};
/* People's icons in brand D (owner, 29 Oct 2026, option C of six): Phosphor's two-tone set, an indigo line over
   a lilac fill, and the fill turns marigold on the open module and screen (.ui-glyph in people.css). One family
   and three brand colours, where Fluent's full-colour set brought blue, teal, green and pink. */
const duo = (Icon, name) => {
  // eslint-disable-next-line no-unused-vars -- Lucide's strokeWidth is taken off so it is not passed to the svg
  const Duo = ({ size = 16, strokeWidth, className = '', ...rest }) => <Icon size={size} weight="duotone" className={`ui-glyph ${className}`.trim()} {...rest} />;
  Duo.displayName = `Duo(${name})`;
  return Duo;
};
const M = {
  home: duo(House, 'House'),
  workforce: duo(UsersThree, 'UsersThree'),
  org: duo(Buildings, 'Buildings'),
  time: duo(CalendarCheck, 'CalendarCheck'),
  insights: duo(ChartPieSlice, 'ChartPieSlice'),
  hiring: duo(Star, 'Star'),
  growth: duo(Trophy, 'Trophy'),
  engage: duo(Megaphone, 'Megaphone'),
  settings: duo(GearSix, 'GearSix'),
};
const I = {
  home: duo(House, 'House'),
  people: duo(UsersThree, 'UsersThree'),
  org: duo(TreeStructure, 'TreeStructure'),
  folder: duo(FolderOpen, 'FolderOpen'),
  checklist: duo(ClipboardText, 'ClipboardText'),
  approve: duo(CheckCircle, 'CheckCircle'),
  key: duo(UserGear, 'UserGear'),
  leave: duo(Umbrella, 'Umbrella'),
  balance: duo(PiggyBank, 'PiggyBank'),
  policy: duo(NotePencil, 'NotePencil'),
  myLeave: duo(Umbrella, 'Umbrella'),
  holiday: duo(CalendarStar, 'CalendarStar'),
  calendar: duo(CalendarDots, 'CalendarDots'),
  register: duo(Table, 'Table'),
  attendance: duo(UserCheck, 'UserCheck'),
  myDays: duo(Clock, 'Clock'),
  job: duo(Briefcase, 'Briefcase'),
  candidate: duo(UserPlus, 'UserPlus'),
  goal: duo(Trophy, 'Trophy'),
  training: duo(GraduationCap, 'GraduationCap'),
  interview: duo(Handshake, 'Handshake'),
  review: duo(SealCheck, 'SealCheck'),
  plan: duo(TrendUp, 'TrendUp'),
  oneOnOne: duo(ChatsCircle, 'ChatsCircle'),
  hrCase: duo(Headset, 'Headset'),
  asset: duo(Laptop, 'Laptop'),
  benefit: duo(Gift, 'Gift'),
  salary: duo(Coins, 'Coins'),
  expense: duo(Receipt, 'Receipt'),
  news: duo(Megaphone, 'Megaphone'),
  event: duo(CalendarStar, 'CalendarStar'),
  report: duo(ChartBar, 'ChartBar'),
  health: duo(ShieldCheck, 'ShieldCheck'),
  compliance: duo(ListChecks, 'ListChecks'),
  department: duo(Buildings, 'Buildings'),
  designation: duo(IdentificationCard, 'IdentificationCard'),
  role: duo(UserCircleGear, 'UserCircleGear'),
  type: duo(UsersFour, 'UsersFour'),
  workType: duo(ClockClockwise, 'ClockClockwise'),
  tag: duo(Tag, 'Tag'),
  import: duo(FileArrowUp, 'FileArrowUp'),
  audit: duo(FileText, 'FileText'),
  settings: duo(GearSix, 'GearSix'),
  modules: duo(SquaresFour, 'SquaresFour'),
  company: duo(Buildings, 'Buildings'),
  unit: duo(ChartPie, 'ChartPie'),
  grade: duo(Medal, 'Medal'),
  costCentre: duo(Database, 'Database'),
  location: duo(MapPin, 'MapPin'),
  integrations: duo(LinkSimple, 'LinkSimple'),
  export: duo(DownloadSimple, 'DownloadSimple'),
  bin: duo(ClockCounterClockwise, 'ClockCounterClockwise'),
  privacy: duo(Shield, 'Shield'),
  requests: duo(GlobeSimple, 'GlobeSimple'),
  sso: duo(LockKey, 'LockKey'),
  sync: duo(ArrowsClockwise, 'ArrowsClockwise'),
  away: duo(CalendarDots, 'CalendarDots'),
  delegate: duo(UserSwitch, 'UserSwitch'),
  attRequest: duo(ClipboardText, 'ClipboardText'),
  history: duo(ClockCounterClockwise, 'ClockCounterClockwise'),
  evidence: duo(FileLock, 'FileLock'),
  summary: duo(ChartBar, 'ChartBar'),
  statutory: duo(Notebook, 'Notebook'),
  orgOverview: duo(Buildings, 'Buildings'),
  orgChart: duo(TreeStructure, 'TreeStructure'),
  dataCheck: duo(ShieldCheck, 'ShieldCheck'),
  field: duo(Textbox, 'Textbox'),
  lifecycle: duo(UserCirclePlus, 'UserCirclePlus'),
  joiner: duo(SignIn, 'SignIn'),
  offer: duo(FileText, 'FileText'),
  leaver: duo(SignOut, 'SignOut'),
  change: duo(ArrowsLeftRight, 'ArrowsLeftRight'),
  task: duo(ListChecks, 'ListChecks'),
  steps: duo(ListNumbers, 'ListNumbers'),
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
  icon: line(UsersThree, 'UsersThree', 'sky'),
  blurb: 'Every HR job in one place: people, time off, hiring, growth and the workplace.',
  available: true,
  database: 'people.db',
  home: 'overview',
  /* People's own accent, lagoon teal #0E7C7B with Butter highlights (owner, 28 Oct 2026: not blue, unlike the rest of the industry; replaced Burnished Rose of 24 Oct, D-01).
     The shared palette lives in packages/ui/src/index.css. */
  palette: 'sky',
  /* Two-tone brand icons (see `duo` above); content icons that screens draw follow it through colorSwap. */
  iconSet: 'duo',
  /* Buttons and actions in Fluent's line set, the same family as the colour marks (owner, 28 Oct 2026). */
  lineIcons: 'fluent',
  /* The phone's tab bar (spec v1 §6): what employees and managers reach for; the rest is behind Menu. */
  mobileTabs: ['overview', 'employees', 'approvals', 'leaveRequests'],
  /* A person's own pages, opened from My profile rather than the admin menu (owner, 28 Oct 2026 audit). */
  profileLinks: ['myLeave', 'myDays', 'myRequests'],
  /* Grant- and membership-based access the shell merges with the person's permissions (src/api/access.js). */
  access: () => import('./src/api/access.js').then((m) => m.myPeopleAccess()),

  /* The sidebar holds the day's work; everything set up once lives on one Settings page (PeopleSettings), its pages marked `parent: 'settings'`. */
  modules: [
    { key: 'overview', label: 'Home', icon: M.home, items: ['overview', 'approvals'] },
    /* Menu by what the owner is trying to do (owner, 28 Oct 2026 audit): records about people here; the
       service staff come to (help desk, policies, news) under Workplace. Screen keys stay, so old links work. */
    { key: 'employees', label: 'People', icon: M.workforce, groups: [
      { label: 'People', items: ['employees', 'documents'] },
      /* Joining & leaving (JOINING-LEAVING-DECISIONS.md): who is joining or leaving, what is not done yet, and whose it is. `checklists` keeps its key (old links); it is now Tasks. */
      { label: 'Joining & leaving', items: ['lifecycle', 'joiners', 'offers', 'lifecycleChanges', 'leavers', 'checklists'] },
      { label: 'Pay, benefits & assets', items: ['compensation', 'expenses', 'benefits', 'assets'] },
    ] },
    /* Organisation: one flat list; headings over one item each only made it longer. The detailed lists
       (Detailed structure switch) follow under one heading. */
    { key: 'organization', label: 'Organisation', icon: M.org, groups: [
      { label: '', items: ['organization', 'departments', 'jobPositions', 'orgChart', 'branches', 'orgChanges'] },
      { label: 'Detailed structure', items: ['establishments', 'areas', 'teams', 'seats', 'businessUnits', 'grades', 'costCentres', 'jobRoles'] },
    ] },
    /* Time: leave and attendance in one module whose name fits the rail on one line. Your own leave and
       days live under My profile, not in the admin menu. Leave register is a statutory form: Reports. */
    { key: 'leave', label: 'Time', icon: M.time, groups: [
      { label: 'Leave', items: ['timeOverview', 'leaveRequests', 'leaveCalendar', 'leaveBalances', 'standIns'] },
      { label: 'Attendance', items: ['attendance', 'attendanceRequests', 'shiftSwaps', 'lateMarks', 'absences', 'nightWork'] },
    ] },
    /* Talent (owner, 28 Oct 2026): hiring and growing people, one module so the rail has room for what comes next. */
    { key: 'talent', label: 'Talent', icon: M.hiring, groups: [
      { label: 'Hiring', items: ['recruitment', 'candidates', 'interviews', 'referrals', 'referMe'] },
      { label: 'Growth', items: ['performance', 'reviews', 'oneOnOnes', 'plans', 'learning'] },
    ] },
    /* Workplace: what the company offers its staff, news to help. */
    { key: 'workplace', label: 'Workplace', icon: M.engage, groups: [
      { label: 'News', items: ['announcements', 'events'] },
      { label: 'Help', items: ['helpdesk', 'policies', 'privateCases'] },
    ] },
    /* Reports holds reports only (and the outside auditor's evidence); data checks, privacy and audit logs live once, in Settings. */
    { key: 'reports', label: 'Reports', icon: M.insights, items: ['reports', 'leaveSummary', 'leaveRegister', 'requestsReport', 'registers', 'compliance', 'auditEvidence'] },
    { key: 'settings', label: 'Settings', icon: M.settings, items: ['settings'] },
  ],

  /* `permission`: what the screen's data needs; the shell hides what this user cannot open. A list means any
     one of them, where the route takes several; `access` above adds the grant- and membership-based keys.
     `feature: 'peopleDetailed'`: hidden in simple mode (PRODUCT-VIEW §6; server: services/features.ts). Since
     the People audit (30 Oct 2026, gap 4) simple mode trims organisation-structure detail only: year end,
     delegates, policies, compliance, privacy and the like are always shown, as a small business needs them. */
  nav: [
    { key: 'overview', label: 'Home', icon: I.home, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'approvals', label: 'Approvals', icon: I.approve, permission: 'PEOPLE::Requests::VIEW' },
    { key: 'employees', label: 'Employees', icon: I.people, permission: 'PEOPLE::Employees::VIEW' },
    /* Pages inside Workforce (profile, add, import): reached from the directory, never their own sidebar entries; the shell shows "← Workforce". */
    { key: 'employee', label: 'Employee', icon: I.people, permission: 'PEOPLE::Employees::VIEW', parent: 'employees' },
    { key: 'employeeNew', label: 'Add employee', icon: I.people, permission: 'PEOPLE::Employees::CREATE', parent: 'employees' },
    { key: 'employeeImport', label: 'Import employees', icon: I.import, permission: 'PEOPLE::Employees::CREATE', parent: 'employees' },
    { key: 'orgChart', label: 'Org chart', icon: I.orgChart, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'organization', label: 'Overview', icon: I.orgOverview, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'branches', label: 'Branches', icon: I.location, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'orgChanges', label: 'Change history', icon: I.history, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'documents', label: 'Documents', icon: I.folder, permission: 'PEOPLE::Documents::VIEW' },
    { key: 'policies', label: 'Policies', icon: I.policy, permission: 'PEOPLE::Policies::VIEW' },
    { key: 'lifecycle', label: 'Joining & leaving', icon: I.lifecycle, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'joiners', label: 'Joining', icon: I.joiner, permission: 'PEOPLE::Employees::VIEW' },
    /* Offers sent with an accept link: status and withdraw (FEATURE-UI-AUDIT gap 7). */
    { key: 'offers', label: 'Offers', icon: I.offer, permission: 'PEOPLE::Documents::VIEW' },
    { key: 'lifecycleChanges', label: 'Job changes', icon: I.change, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'leavers', label: 'Leaving', icon: I.leaver, permission: 'PEOPLE::Employees::VIEW' },
    /* Anyone with a task on their name opens Tasks (their own only); the server decides what each sees. */
    { key: 'checklists', label: 'Tasks', icon: I.task },
    { key: 'journeySteps', label: 'Joining & leaving steps', icon: I.steps, permission: 'PEOPLE::Employees::VIEW', parent: 'settings' },
    { key: 'selfService', label: 'Employee app', icon: I.key, permission: 'ATTENDANCE::Employee Portal::VIEW', parent: 'settings' },
    { key: 'letterTemplates', label: 'Letters', icon: I.policy, permission: 'PEOPLE::Documents::VIEW', parent: 'settings' },
    { key: 'customFields', label: 'Custom fields', icon: I.field, permission: 'PEOPLE::Org Structure::EDIT', parent: 'settings' },
    { key: 'selfServiceChanges', label: 'Self-service edits', icon: I.key, permission: 'PEOPLE::Org Structure::EDIT', parent: 'settings' },
    { key: 'approvalRules', label: 'Approval rules', icon: I.checklist, permission: 'PEOPLE::Approvals::VIEW', parent: 'settings' },
    { key: 'requestForms', label: 'Request types', icon: I.policy, permission: 'PEOPLE::Approvals::VIEW', parent: 'settings' },
    { key: 'requestsReport', label: 'Requests report', icon: I.report, permission: 'PEOPLE::Approvals::VIEW' },
    /* Swaps asked in the employee app; HR sees all, a manager their team (the server decides). */
    { key: 'shiftSwaps', label: 'Shift swaps', icon: I.change, permission: 'PEOPLE::Requests::VIEW' },
    { key: 'lateMarks', label: 'Late marks', icon: I.myDays, permission: 'ATTENDANCE::Attendance Requests::VIEW' },
    { key: 'absences', label: 'Absences', icon: I.leaver, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'nightWork', label: 'Night work', icon: I.policy, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'attendanceRules', label: 'Attendance rules', icon: I.policy, permission: 'ATTENDANCE::Attendance Requests::VIEW', parent: 'settings' },
    { key: 'automations', label: 'Automations', icon: I.policy, permission: 'PEOPLE::Employees::VIEW', parent: 'settings' },
    { key: 'exitQuestions', label: 'Exit interview', icon: I.policy, permission: 'PEOPLE::Employees::VIEW', parent: 'settings' },
    { key: 'myRequests', label: 'My requests', icon: I.requests, permission: 'ATTENDANCE::My Attendance::VIEW' },
    { key: 'timeOverview', label: "Who's away", icon: I.away, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveRequests', label: 'Leave requests', short: 'Leave', icon: I.leave, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveBalances', label: 'Leave balances', icon: I.balance, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveRegister', label: 'Leave register', icon: I.register, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveCalendar', label: 'Leave calendar', icon: I.calendar, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'standIns', label: 'Delegates', icon: I.delegate, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'attendanceRequests', label: 'Attendance requests', short: 'Requests', icon: I.attRequest, permission: 'ATTENDANCE::Attendance Requests::VIEW' },
    { key: 'attendance', label: 'Daily attendance', icon: I.attendance, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'myDays', label: 'My attendance', icon: I.myDays, permission: 'ATTENDANCE::My Attendance::VIEW' },
    { key: 'myLeave', label: 'My leave', icon: I.myLeave, permission: 'ATTENDANCE::My Attendance::VIEW' },
    { key: 'leaveTypes', label: 'Leave policy', icon: I.policy, permission: 'ATTENDANCE::Leave Types::VIEW', parent: 'settings' },
    { key: 'holidays', label: 'Holidays', icon: I.holiday, permission: 'ATTENDANCE::Holidays::VIEW', parent: 'settings' },
    { key: 'leaveBlocks', label: 'Leave block dates', icon: I.holiday, permission: 'ATTENDANCE::Leave Types::VIEW', parent: 'settings' },
    { key: 'workingWeek', label: 'Working week', icon: I.calendar, permission: 'ATTENDANCE::Leave Types::VIEW', parent: 'settings' },
    { key: 'leaveYearEnd', label: 'Leave year end', icon: I.register, permission: 'ATTENDANCE::Leave Requests::EDIT', parent: 'settings' },
    { key: 'requestRules', label: 'Attendance request types', icon: I.policy, permission: 'ATTENDANCE::Attendance Requests::APPROVE', parent: 'settings' },
    /* Talent. Interviews and one-on-ones need no right of their own: anyone can sit on an interview or
       manage someone, and the server shows each person only their own. Goals, reviews and plans are not
       read-only without Performance Edit (`writeGuard: false`): a manager acts on their own team there, and
       the server decides who may. Screen keys stay, so old links work. */
    { key: 'recruitment', label: 'Job openings', icon: I.job, permission: 'PEOPLE::Recruitment::VIEW', feature: 'peopleHiring' },
    { key: 'candidates', label: 'Candidates', icon: I.candidate, permission: 'PEOPLE::Recruitment::VIEW', feature: 'peopleHiring' },
    { key: 'interviews', label: 'Interviews', icon: I.interview, feature: 'peopleHiring' },
    /* Referrals (A20): HR's list and report with Recruitment; Refer someone for anyone who works here (the server finds their record from the session). */
    { key: 'referrals', label: 'Referrals', icon: I.candidate, permission: 'PEOPLE::Recruitment::VIEW', feature: 'peopleHiring' },
    { key: 'referMe', label: 'Refer someone', icon: I.job, feature: 'peopleHiring', writeGuard: false },
    { key: 'performance', label: 'Goals', icon: I.goal, permission: 'PEOPLE::Performance::VIEW', feature: 'peoplePerformance', writeGuard: false },
    { key: 'reviews', label: 'Reviews', icon: I.review, permission: 'PEOPLE::Performance::VIEW', feature: 'peoplePerformance', writeGuard: false },
    { key: 'oneOnOnes', label: 'One-on-ones', icon: I.oneOnOne, feature: 'peoplePerformance' },
    { key: 'plans', label: 'Improvement plans', icon: I.plan, permission: 'PEOPLE::Performance::VIEW', feature: 'peoplePerformance', writeGuard: false },
    { key: 'learning', label: 'Training', icon: I.training, permission: 'PEOPLE::Learning::VIEW', feature: 'peoplePerformance' },
    { key: 'announcements', label: 'Announcements', icon: I.news, permission: 'PEOPLE::Announcements::VIEW', feature: 'peopleEngage' },
    { key: 'events', label: 'Events', icon: I.event, permission: 'PEOPLE::Events::VIEW', feature: 'peopleEngage' },
    { key: 'helpdesk', label: 'Help desk', icon: I.hrCase, permission: 'PEOPLE::HR Cases::VIEW' },
    /* Who the case routes let in (gap 5): the grant to take cases in and set committees, or a seat on a case or committee. */
    { key: 'privateCases', label: 'Confidential cases', icon: I.privacy, permission: ['PEOPLE::Private Cases::VIEW', 'PEOPLE::Private Cases::CREATE', 'PEOPLE::Case committee::VIEW'] },
    { key: 'helpDeskSettings', label: 'Help desk settings', icon: I.hrCase, permission: 'PEOPLE::HR Cases::EDIT', parent: 'settings' },
    { key: 'assets', label: 'Assets', icon: I.asset, permission: 'PEOPLE::Assets::VIEW', feature: 'peopleBenefits' },
    { key: 'benefits', label: 'Benefits', icon: I.benefit, permission: 'PEOPLE::Benefits::VIEW', feature: 'peopleBenefits' },
    { key: 'compensation', label: 'Salary revisions', icon: I.salary, permission: 'PAYROLL::Salary Revisions::VIEW', feature: 'peopleBenefits' },
    /* Claims approved in Approvals, paid here; advances and salary advances (WORKFLOW-GAP-RESEARCH 4.1, 4.2). */
    { key: 'expenses', label: 'Expenses', icon: I.expense, permission: 'PEOPLE::Expenses::VIEW' },
    { key: 'reports', label: 'People report', icon: I.report, permission: 'PEOPLE::Employees::VIEW' },
    /* What an inspector asks for (HR view audit, gap 4), and leave taken by department and type (gap 9). */
    { key: 'registers', label: 'Statutory registers', icon: I.statutory, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'leaveSummary', label: 'Leave summary', icon: I.summary, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'dataHealth', label: 'Data check', icon: I.dataCheck, permission: 'PEOPLE::Employees::VIEW', parent: 'settings' },
    { key: 'compliance', label: 'Compliance', icon: I.compliance, permission: 'PEOPLE::Employees::VIEW' },
    /* The old compliance calendar, retired into Compliance (gap 10): a link or notice that still names it opens Compliance. */
    { key: 'complianceCalendar', label: 'Compliance', icon: I.compliance, permission: 'PEOPLE::Employees::VIEW', parent: 'compliance' },
    { key: 'privacy', label: 'Privacy controls', icon: I.privacy, permission: 'PEOPLE::Privacy::VIEW', parent: 'settings' },
    /* The external auditor's own list: what a live grant names (PRV-06). */
    { key: 'auditEvidence', label: 'Audit evidence', icon: I.evidence, permission: ['PEOPLE::Audit grant::VIEW'] },
    { key: 'departments', label: 'Departments', icon: I.department, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'teams', label: 'Teams', icon: I.people, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail' },
    { key: 'seats', label: 'Positions', icon: I.org, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail' },
    { key: 'jobPositions', label: 'Designations', icon: I.designation, permission: 'PEOPLE::Org Structure::VIEW' },
    { key: 'jobRoles', label: 'Job roles', icon: I.role, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail' },
    { key: 'employeeTypes', label: 'Employment types', icon: I.type, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'workTypes', label: 'Work modes', icon: I.workType, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'tags', label: 'Tags', icon: I.tag, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'dataImport', label: 'Import data', icon: I.import, permission: 'PEOPLE::Employees::CREATE', parent: 'settings' },
    { key: 'settings', label: 'Settings', icon: I.settings, hub: true },
    /* Founder, 22 Oct 2026: modules switch on and off, within what the subscription carries. */
    { key: 'modules', label: 'Features & apps', icon: I.modules, permission: 'SETTINGS::Company Profile::VIEW', parent: 'settings' },
    { key: 'companyDetails', label: 'Company details', icon: I.company, permission: 'SETTINGS::Company Profile::VIEW', parent: 'settings' },
    { key: 'legalEntities', label: 'Legal entity', icon: I.company, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings', feature: 'peopleDetailed' },
    { key: 'establishments', label: 'Work sites', icon: I.location, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail' },
    { key: 'businessUnits', label: 'Business units', icon: I.unit, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail' },
    { key: 'areas', label: 'Locations', icon: I.location, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail' },
    { key: 'grades', label: 'Grades', icon: I.grade, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail' },
    { key: 'costCentres', label: 'Cost centres', icon: I.costCentre, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail' },
    { key: 'sso', label: 'Users & security', icon: I.sso, permission: 'SETTINGS::Users::VIEW', parent: 'settings' },
    { key: 'rolesAccess', label: 'Roles & permissions', icon: I.sso, permission: 'SETTINGS::Roles::VIEW', parent: 'settings' },
    /* Its routes answer only where Attendance is on (attendanceRouteOk). */
    { key: 'integrations', label: 'Integrations', icon: I.integrations, permission: 'ATTENDANCE::Attendance Integrations::VIEW', parent: 'settings', feature: 'attendance' },
    /* Any one read behind its datasets (DataExport.jsx `need`); the screen lists only those this person holds. */
    { key: 'dataExport', label: 'Export data', icon: I.export, permission: ['ATTENDANCE::Attendance Records::VIEW', 'ATTENDANCE::Attendance Devices::VIEW', 'ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Attendance Requests::VIEW', 'ATTENDANCE::Holidays::VIEW', 'ATTENDANCE::Shifts::VIEW'], parent: 'settings' },
    /* Each kind in the bin opens to whoever may delete it (server/src/services/recycleBin.ts BIN_KINDS). */
    { key: 'recycleBin', label: 'Recycle bin', icon: I.bin, permission: ['PEOPLE::Employees::DELETE', 'PEOPLE::Employee Notes::DELETE', 'PEOPLE::Documents::DELETE', 'PEOPLE::Org Structure::DELETE', 'ATTENDANCE::Holidays::DELETE', 'ATTENDANCE::Leave Types::DELETE', 'ATTENDANCE::Shifts::DELETE', 'ATTENDANCE::Attendance Records::DELETE'], parent: 'settings' },
    { key: 'dataProtection', label: 'Data protection', icon: I.privacy, permission: 'ATTENDANCE::Employee Portal::VIEW', parent: 'settings' },
    { key: 'dataRequests', label: 'Data requests', icon: I.requests, permission: 'PEOPLE::Employees::VIEW', parent: 'settings' },
    { key: 'auditLogs', label: 'Audit logs', icon: I.audit, permission: 'SETTINGS::Audit trail::VIEW', parent: 'settings' },
  ],

  screens: {
    overview: PeopleOverview,
    approvals: withSidePanel(Approvals, panel('ApprovalsPanel')),
    policies: Policies,
    employees: withSidePanel(Employees, panel('EmployeesPanel')),
    employee: EmployeeRecord,
    employeeNew: AddEmployee,
    employeeImport: ImportEmployees,
    orgChart: OrgChart,
    organization: OrganizationOverview,
    branches: withSidePanel(Branches, panel('BranchesPanel')),
    orgChanges: withSidePanel(OrgChanges, panel('ChangesPanel')),
    documents: withSidePanel(PeopleDocuments, panel('DocumentsPanel')),
    checklists: withSidePanel(LifecycleTasks, panel('ChecklistsPanel')),
    lifecycle: LifecycleOverview,
    joiners: Joiners,
    offers: Offers,
    lifecycleChanges: LifecycleChanges,
    leavers: Leavers,
    journeySteps: JourneySteps,
    letterTemplates: LetterTemplates,
    customFields: CustomFieldsSettings,
    selfServiceChanges: SelfServiceSettings,
    approvalRules: ApprovalRules,
    requestForms: RequestForms,
    requestsReport: RequestsReport,
    shiftSwaps: ShiftSwaps,
    lateMarks: LateMarks,
    absences: Absences,
    nightWork: NightWork,
    attendanceRules: AttendanceRulesSettings,
    automations: Automations,
    exitQuestions: ExitQuestions,
    myRequests: MyRequests,
    selfService: PortalAccess,
    timeOverview: withSidePanel(TimeOverview, panel('TimeOverviewPanel')),
    workingWeek: WorkingWeek,
    leaveYearEnd: LeaveYearEnd,
    standIns: StandIns,
    leaveBlocks: LeaveBlocks,
    attendanceRequests: withSidePanel(statusFromTab(AttendanceRequests), panel('AttendanceRequestsPanel')),
    requestRules: RequestRules,
    leaveRequests: withSidePanel(statusFromTab(LeaveRequests), panel('LeaveRequestsPanel')),
    leaveBalances: withSidePanel(LeaveBalances, panel('LeaveBalancesPanel')),
    myLeave: MyLeave,
    leaveTypes: LeaveTypes,
    holidays: Holidays,
    leaveCalendar: LeaveCalendar,
    leaveRegister: LeaveRegister,
    attendance: TeamAttendance,
    myDays: MyDays,
    recruitment: TalentOpenings,
    candidates: TalentCandidates,
    interviews: TalentInterviews,
    performance: TalentGoals,
    reviews: TalentReviews,
    oneOnOnes: TalentOneOnOnes,
    plans: TalentPlans,
    learning: TalentTrainings,
    referrals: TalentReferrals,
    referMe: TalentReferSomeone,
    announcements: withSidePanel(register('announcements'), panel('AnnouncementsPanel')),
    events: withSidePanel(register('events'), panel('EventsPanel')),
    helpdesk: withSidePanel(HelpDesk, panel('HelpDeskPanel')),
    privateCases: PrivateCases,
    helpDeskSettings: HelpDeskSettings,
    assets: withSidePanel(register('assets'), panel('AssetsPanel')),
    benefits: withSidePanel(register('benefits'), panel('BenefitsPanel')),
    compensation: withSidePanel(SalaryRevisions, panel('SalaryRevisionsPanel')),
    expenses: Expenses,
    reports: PeopleReports,
    registers: Registers,
    leaveSummary: LeaveSummaryReport,
    dataHealth: DataHealth,
    compliance: Compliance,
    complianceCalendar: Compliance,
    privacy: Privacy,
    auditEvidence: AuditEvidence,
    departments: withSidePanel(OrgDepartments, panel('DepartmentsPanel')),
    teams: OrgTeams,
    seats: OrgPositions,
    jobPositions: withSidePanel(OrgDesignations, panel('DesignationsPanel')),
    jobRoles: OrgJobRoles,
    employeeTypes: OrgEmploymentTypes,
    workTypes: OrgWorkModes,
    tags: Tags,
    dataImport: DataImport,
    auditLogs: AuditLogs,
    settings: PeopleSettings,
    modules: PeopleModules,
    companyDetails: CompanyDetails,
    legalEntities: OrgLegalEntities,
    establishments: OrgWorkSites,
    businessUnits: OrgBusinessUnits,
    areas: OrgLocations,
    grades: OrgGrades,
    costCentres: OrgCostCentres,
    sso: SsoSettings,
    rolesAccess: RolesAccess,
    integrations: Integrations,
    dataExport: DataExport,
    recycleBin: RecycleBin,
    dataProtection: DataProtection,
    dataRequests: DataRequests,
  },
};
