import React from 'react';
import {
  ApprovalsApp20Color,
  AppsList20Color,
  ArrowClockwiseDashes20Color,
  ArrowSquareDown20Color,
  ArrowSync20Color,
  ArrowTrendingLines20Color,
  Beach20Color,
  Book20Color,
  BookOpenLightbulb20Color,
  Bookmark20Color,
  BotSparkle20Color,
  Briefcase20Color,
  Briefcase24Color,
  Building20Color,
  BuildingGovernment20Color,
  BuildingHome20Color,
  BuildingMultiple20Color,
  BuildingStore20Color,
  Calendar20Color,
  CalendarCancel20Color,
  CalendarCheckmark20Color,
  CalendarCheckmark24Color,
  CalendarClock20Color,
  CalendarDataBar20Color,
  CalendarEdit20Color,
  CalendarPeople20Color,
  ChartMultiple20Color,
  ChatMultiple20Color,
  CheckboxPerson20Color,
  CheckmarkCircle20Color,
  ClipboardTask20Color,
  ClipboardTextEdit20Color,
  Clock20Color,
  ClockAlarm20Color,
  Cloud20Color,
  CoinMultiple20Color,
  ContactCard20Color,
  DataBarVerticalAscending24Color,
  DataPie20Color,
  DataTrending20Color,
  Database20Color,
  DocumentAdd20Color,
  DocumentFolder20Color,
  DocumentLock20Color,
  DocumentText20Color,
  Drafts20Color,
  Edit20Color,
  Flag20Color,
  Form20Color,
  Gift20Color,
  Headset20Color,
  History20Color,
  Home20Color,
  Home24Color,
  Laptop20Color,
  LinkMultiple20Color,
  LocationRipple20Color,
  LockClosed20Color,
  LockShield20Color,
  Mail20Color,
  MegaphoneLoud20Color,
  MegaphoneLoud24Color,
  Notebook20Color,
  NumberSymbolSquare20Color,
  Options20Color,
  Org20Color,
  People20Color,
  People24Color,
  PeopleAdd20Color,
  PeopleChat20Color,
  PeopleCommunity20Color,
  PeopleList20Color,
  PeopleSync20Color,
  PeopleTeam20Color,
  PersonAdd20Color,
  PersonAvailable20Color,
  PersonFeedback20Color,
  PersonHeart20Color,
  PersonKey20Color,
  PersonStarburst20Color,
  PersonTentative20Color,
  PersonWarning20Color,
  Phone20Color,
  PhoneLaptop20Color,
  Pin20Color,
  Poll20Color,
  QuestionCircle20Color,
  Receipt20Color,
  Ribbon20Color,
  RibbonStar20Color,
  Savings20Color,
  ScanPerson20Color,
  Send20Color,
  Settings20Color,
  Settings24Color,
  Shield20Color,
  ShieldCheckmark20Color,
  Shifts20Color,
  Table20Color,
  TextBulletListSquare20Color,
  Toolbox20Color,
  Trophy24Color,
  Warning20Color,
  WeatherSnowflake20Color,
  Wifi20Color,
  WifiWarning20Color,
  CalendarSync20Color,
  Globe20Color,
  SearchVisual20Color,
  CodeBlock20Color,
  Lightbulb20Color,
  ArrowSquare20Color,
} from '@fluentui/react-icons';
import { UsersThree } from '@phosphor-icons/react';
import { lazyScreens } from '@ui/utils/lazyScreens';
import { duo } from '@ui/components/ui/duoIcon';
import { colorIcon } from '@ui/components/ui/colorIcon';
import { withSidePanel } from '@ui/components/list/SidePanel';
import { SETTINGS_GROUPS } from './src/settingsGroups';

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
/* Reports home and People's own reports, each full page (platform audit, 11 Nov 2026). */
const ReportsHome = screen('ReportsHome');
const HrReport = screen('HrReport');
const Registers = screen('Registers');
const LeaveSummaryReport = screen('LeaveSummaryReport');
const PeopleDocuments = screen('PeopleDocuments');
const Holidays = screen('Holidays');
const PortalAccess = screen('PortalAccess');
const SalaryRevisions = screen('SalaryRevisions');
const CompanyChoices = screen('CompanyChoices');
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
const EmailNotifications = screen('EmailNotifications');
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
/* Attendance's screens inside People's Time (owner, 11 Nov 2026): shifts, readers, overtime, month end. */
const AttendanceRecords = screen('AttendanceRecords');
const Exceptions = screen('Exceptions');
const ScheduleCalendar = screen('ScheduleCalendar');
const Shifts = screen('Shifts');
const ShiftAssignments = screen('ShiftAssignments');
const DepartmentSchedule = screen('DepartmentSchedule');
const TemporarySchedule = screen('TemporarySchedule');
const Rotations = screen('Rotations');
const OvertimeRequests = screen('OvertimeRequests');
const MonthConfirmations = screen('MonthConfirmations');
const MonthClose = screen('MonthClose');
const PayrollReadiness = screen('PayrollReadiness');
const AttendanceDevices = screen('AttendanceDevices');
const ReaderHealth = screen('ReaderHealth');
const ReaderSync = screen('ReaderSync');
const DeviceLogs = screen('DeviceLogs');
const Enrolments = screen('Enrolments');
const UnmatchedPunches = screen('UnmatchedPunches');
const IdMapping = screen('IdMapping');
const PhonePunches = screen('PhonePunches');
const Geofences = screen('Geofences');
const SiteCheck = screen('SiteCheck');
const WeeklyOffPolicy = screen('WeeklyOffPolicy');
const OvertimePolicy = screen('OvertimePolicy');
const ShiftPolicy = screen('ShiftPolicy');
const Contractors = screen('Contractors');
const AttendanceReports = screen('AttendanceReports');
const MonthSummary = screen('MonthSummary');
const AttendanceRegister = screen('AttendanceRegister');
const Transactions = screen('Transactions');
/* The punch log under the name People's menu gives it. */
const PunchLog = (props) => <Transactions {...props} title="Punches" />;
PunchLog.displayName = 'PunchLog';
/* Opened from the reports home on one report (`report` in the address); from the menu, on the catalogue. */
const AttendanceReportsAt = (props) => <AttendanceReports {...props} initialReport={props.params?.report || ''} />;
AttendanceReportsAt.displayName = 'AttendanceReportsAt';
/* A named attendance report as its own entry: the Reports screen opened on that report. */
const attendanceReport = (id) => {
  const NamedReport = (props) => <AttendanceReports {...props} initialReport={id} />;
  NamedReport.displayName = `Report(${id})`;
  return NamedReport;
};
const LateMarks = screen('LateMarks');
const Absences = screen('Absences');
const NightWork = screen('NightWork');

/* People's icons (R&D hand-off, 14 Nov 2026): Fluent colour icons on the rail (24px) and in the panel (20px), through the
   shared colorIcon helper; the colour is the icon's own, so no kind colours are layered on. */
/* Each icon named after its Fluent glyph, so a glyph used twice shows as the same name (test/people-navigation). */
const fluent = (icons, size) => Object.fromEntries(Object.entries(icons).map(([key, Icon]) => [key, colorIcon(Icon, Icon.displayName || key, size)]));
const M = fluent({
  home: Home24Color,
  employees: People24Color,
  time: CalendarCheckmark24Color,
  hiring: Briefcase24Color,
  performance: Trophy24Color,
  engage: MegaphoneLoud24Color,
  insights: DataBarVerticalAscending24Color,
  settings: Settings24Color,
}, 24);
const I = fluent({
  home: Home20Color,
  approve: ApprovalsApp20Color,
  people: People20Color,
  orgChart: Org20Color,
  orgOverview: BuildingMultiple20Color,
  folder: DocumentFolder20Color,
  joiner: PersonAdd20Color,
  offer: DocumentText20Color,
  change: PeopleSync20Color,
  leaver: PersonTentative20Color,
  task: ClipboardTask20Color,
  salary: CoinMultiple20Color,
  expense: Receipt20Color,
  benefit: Gift20Color,
  asset: Laptop20Color,
  leave: Beach20Color,
  calendar: CalendarPeople20Color,
  balance: Savings20Color,
  register: Table20Color,
  away: CalendarCancel20Color,
  attendance: PersonAvailable20Color,
  records: TextBulletListSquare20Color,
  exceptions: Warning20Color,
  attRequest: ClipboardTextEdit20Color,
  overtime: ClockAlarm20Color,
  lateMarks: Clock20Color,
  absences: PersonWarning20Color,
  night: WeatherSnowflake20Color,
  shiftCalendar: CalendarClock20Color,
  shifts: Shifts20Color,
  shiftPeople: PeopleList20Color,
  tempShift: CalendarEdit20Color,
  shiftSwap: ArrowSync20Color,
  readers: ScanPerson20Color,
  readerHealth: Wifi20Color,
  punches: History20Color,
  unmatched: WifiWarning20Color,
  readiness: CheckmarkCircle20Color,
  confirm: CheckboxPerson20Color,
  monthClose: LockClosed20Color,
  myLeave: Beach20Color,
  myDays: Clock20Color,
  requests: Send20Color,
  job: Briefcase20Color,
  candidate: PeopleAdd20Color,
  interview: PeopleChat20Color,
  referral: PersonHeart20Color,
  referMe: PersonAdd20Color,
  goal: Flag20Color,
  review: RibbonStar20Color,
  oneOnOne: ChatMultiple20Color,
  plan: ArrowTrendingLines20Color,
  training: BookOpenLightbulb20Color,
  news: MegaphoneLoud20Color,
  event: Calendar20Color,
  hrCase: Headset20Color,
  privateCase: LockShield20Color,
  policy: Book20Color,
  report: DataPie20Color,
  headcount: DataTrending20Color,
  summary: CalendarDataBar20Color,
  attReports: ChartMultiple20Color,
  requestsReport: Poll20Color,
  statutory: Notebook20Color,
  leaveSummary: CalendarDataBar20Color,
  dataCheck: ShieldCheckmark20Color,
  compliance: CalendarCheckmark20Color,
  settings: Settings20Color,
  office: Building20Color,
  legal: BuildingGovernment20Color,
  branch: BuildingStore20Color,
  department: BuildingMultiple20Color,
  designation: ContactCard20Color,
  history: History20Color,
  mailOut: Mail20Color,
  site: BuildingHome20Color,
  location: LocationRipple20Color,
  team: PeopleTeam20Color,
  seat: Pin20Color,
  unit: DataPie20Color,
  grade: Ribbon20Color,
  costCentre: Database20Color,
  role: PersonStarburst20Color,
  field: Form20Color,
  type: PeopleCommunity20Color,
  workType: Clock20Color,
  tag: Bookmark20Color,
  letter: Drafts20Color,
  steps: TextBulletListSquare20Color,
  exit: QuestionCircle20Color,
  key: Edit20Color,
  phone: PhoneLaptop20Color,
  leavePolicy: CalendarEdit20Color,
  holiday: Calendar20Color,
  blockDates: CalendarCancel20Color,
  workingWeek: CalendarClock20Color,
  yearEnd: ArrowSquare20Color,
  attRules: ClockAlarm20Color,
  attTypes: Options20Color,
  shiftPolicy: Shifts20Color,
  weeklyOff: CalendarSync20Color,
  overtimeRule: CoinMultiple20Color,
  deptShift: CalendarPeople20Color,
  rotation: ArrowSync20Color,
  punchArea: Globe20Color,
  areaCheck: SearchVisual20Color,
  phonePunch: Phone20Color,
  enrol: ScanPerson20Color,
  readerId: NumberSymbolSquare20Color,
  readerSync: Cloud20Color,
  readerLog: CodeBlock20Color,
  contractor: Toolbox20Color,
  checklist: CheckboxPerson20Color,
  requestType: ClipboardTextEdit20Color,
  delegate: PeopleSync20Color,
  automation: BotSparkle20Color,
  choices: Lightbulb20Color,
  import: DocumentAdd20Color,
  export: ArrowSquareDown20Color,
  privacy: LockShield20Color,
  consent: Shield20Color,
  dataRequests: PersonFeedback20Color,
  trash: ArrowClockwiseDashes20Color,
  audit: DocumentText20Color,
  evidence: DocumentLock20Color,
  sso: LockClosed20Color,
  roles: PersonKey20Color,
  modules: AppsList20Color,
  integrations: LinkMultiple20Color,
  health: ShieldCheckmark20Color,
}, 20);

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
  icon: duo(UsersThree, 'UsersThree'),
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
  /* A rail tap opens the module's first screen with its panel (People plan, 8 Nov 2026: a click opens a screen, not only a panel). */
  railOpensHome: true,
  /* Counts beside rail entries: what waits in the Inbox (src/api/railCounts.js). */
  railCounts: () => import('./src/api/railCounts.js').then((m) => m.peopleRailCounts()),
  /* Counts beside panel items (R&D shell): employees, open jobs and what waits in each inbox (src/api/railCounts.js). {} on failure. */
  panelCounts: (ctx) => import('./src/api/railCounts.js').then((m) => m.peoplePanelCounts(ctx)).catch(() => ({})),
  /* Search (People plan, 8 Nov 2026): people by name, code or email; and jobs by the words people use for them. */
  searchRecords: (q) => import('@ui/personnel/search').then((m) => m.findPeople(q)),
  searchActions: [
    { label: 'Probation ending', screen: 'employees', params: { prob: 'on' }, keywords: ['probation', 'confirm', 'confirmation'] },
    { label: 'Add an employee', screen: 'employeeNew', keywords: ['new joiner', 'onboard', 'hire', 'add'] },
    { label: 'Fix a punch', screen: 'attendanceRequests', keywords: ['punch', 'missed punch', 'regularise'] },
    { label: 'Shifts', screen: 'shifts', keywords: ['shift', 'roster', 'timing', 'weekly off'] },
    { label: 'Add a reader', screen: 'readers', keywords: ['reader', 'biometric', 'device', 'machine', 'fingerprint', 'face'] },
    { label: 'Month close', screen: 'monthClose', keywords: ['month close', 'close the month', 'lock attendance'] },
    { label: 'Payslips', appId: 'payroll', screen: 'slips', keywords: ['payslip', 'salary slip', 'pay slip'] },
    { label: 'Final settlement', appId: 'payroll', screen: 'settlements', keywords: ['final settlement', 'full and final', 'fnf', 'f&f'] },
    { label: 'Run payroll', appId: 'payroll', screen: 'runs', keywords: ['payroll', 'pay run', 'salary'] },
  ],

  /* The rail by section (R&D hand-off, 14 Nov 2026): Home, Employees, Leave & attendance, Hiring, Performance, Engage,
     Insights and Settings, each section's pages in the panel beside it. Every screen keeps its key, so old links work;
     the Inbox sits under Home, where its count is. */
  modules: [
    { key: 'overview', label: 'Home', icon: M.home, groups: [
      { label: '', items: ['overview', 'approvals'] },
      /* A person's own pages (also under My profile). */
      { label: 'Me', items: ['myLeave', 'myDays', 'myRequests'] },
    ] },
    { key: 'employees', label: 'Employees', icon: M.employees, groups: [
      { label: 'Directory', items: ['employees', 'orgChart', 'documents'] },
      /* `checklists` keeps its key (old links); it is Tasks. */
      { label: 'Joining & leaving', items: ['joiners', 'offers', 'lifecycleChanges', 'leavers', 'checklists', 'assets'] },
      { label: 'Pay & benefits', items: ['compensation', 'benefits', 'expenses'] },
    ] },
    /* Leave and attendance in one section; shifts, readers and the month's close live here too (owner, 11 Nov 2026). */
    { key: 'leave', label: 'Leave & attendance', short: 'Time', icon: M.time, groups: [
      { label: 'Leave', items: ['leaveRequests', 'leaveCalendar', 'leaveBalances', 'leaveRegister', 'timeOverview'] },
      { label: 'Attendance', items: ['attendance', 'records', 'exceptions', 'attendanceRequests', 'overtime', 'lateMarks', 'absences', 'nightWork'] },
      { label: 'Shifts', items: ['scheduleCalendar', 'shifts', 'shiftAssignments', 'temporarySchedule', 'shiftSwaps'] },
      { label: 'Readers', items: ['readers', 'readerHealth', 'transactions', 'unmatched'] },
      { label: 'Month end', items: ['payrollReadiness', 'confirmations', 'monthClose'] },
      { label: 'Me', items: ['myLeave', 'myDays'] },
    ] },
    /* Refer someone is the primary action on Referrals, not a menu entry. */
    { key: 'hiring', label: 'Hiring', icon: M.hiring, groups: [
      { label: '', items: ['recruitment', 'candidates', 'interviews', 'referrals'] },
    ] },
    { key: 'performance', label: 'Performance', icon: M.performance, groups: [
      { label: '', items: ['performance', 'reviews', 'oneOnOnes', 'plans', 'learning'] },
    ] },
    { key: 'workplace', label: 'Engage', icon: M.engage, groups: [
      { label: '', items: ['announcements', 'events', 'helpdesk', 'privateCases', 'policies'] },
    ] },
    /* Reports, and the checks HR watches: data check and the compliance calendar. */
    { key: 'reports', label: 'Insights', icon: M.insights, groups: [
      { label: '', items: ['reportsHome', 'reports', 'dataHealth', 'compliance'] },
      { label: 'Time', items: ['summary', 'register', 'attendanceReports', 'requestsReport'] },
      { label: 'Statutory', items: ['registers'] },
    ] },
    /* Every Settings page in the panel, in the Settings page's own groups; the panel folds every group but the open one (people.css). */
    { key: 'settings', label: 'Settings', icon: M.settings, groups: [
      { label: '', items: ['settings'] },
      ...SETTINGS_GROUPS.map((g) => ({ label: g.title, items: g.items.map(([key]) => key) })),
    ] },
  ],

  /* `permission`: what the screen's data needs; the shell hides what this user cannot open. A list means any
     one of them, where the route takes several; `access` above adds the grant- and membership-based keys.
     `feature: 'peopleDetailed'`: hidden in simple mode (PRODUCT-VIEW §6; server: services/features.ts). Since
     the People audit (30 Oct 2026, gap 4) simple mode trims organisation-structure detail only: year end,
     delegates, policies, compliance, privacy and the like are always shown, as a small business needs them. */
  nav: [
    { key: 'overview', label: 'Home', icon: I.home, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'approvals', label: 'Inbox', keywords: ['approve', 'pending', 'waiting', 'requests'], icon: I.approve, permission: 'PEOPLE::Requests::VIEW' },
    { key: 'employees', label: 'Employees', keywords: ['staff', 'employee', 'directory', 'team', 'worker'], icon: I.people, permission: 'PEOPLE::Employees::VIEW' },
    /* Pages inside Workforce (profile, add, import): reached from the directory, never their own sidebar entries; the shell shows "← Workforce". */
    { key: 'employee', label: 'Employee', icon: I.people, permission: 'PEOPLE::Employees::VIEW', parent: 'employees' },
    { key: 'employeeNew', label: 'Add employee', icon: I.people, permission: 'PEOPLE::Employees::CREATE', parent: 'employees' },
    { key: 'employeeImport', label: 'Import employees', icon: I.import, permission: 'PEOPLE::Employees::CREATE', parent: 'employees' },
    { key: 'orgChart', label: 'Org chart', keywords: ['organisation', 'organization', 'hierarchy', 'reporting line'], icon: I.orgChart, permission: 'PEOPLE::Employees::VIEW' },
    /* The old Organisation overview: off the menu (People plan, 8 Nov 2026), still at its address for links that name it. */
    { key: 'organization', label: 'Organisation overview', keywords: ['organisation', 'organization'], icon: I.orgOverview, permission: 'PEOPLE::Employees::VIEW', parent: 'orgChart' },
    { key: 'branches', label: 'Branches', keywords: ['organisation', 'office'], icon: I.branch, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'orgChanges', label: 'Org changes', keywords: ['change history', 'organisation', 'history'], icon: I.history, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'documents', label: 'Documents', keywords: ['id proof', 'aadhaar', 'pan card', 'certificate'], icon: I.folder, permission: 'PEOPLE::Documents::VIEW' },
    { key: 'policies', label: 'Policies', icon: I.policy, permission: 'PEOPLE::Policies::VIEW' },
    { key: 'joiners', label: 'Joining', keywords: ['onboarding', 'new joiner', 'induction', 'joining & leaving'], icon: I.joiner, permission: 'PEOPLE::Employees::VIEW' },
    /* Offers sent with an accept link: status and withdraw (FEATURE-UI-AUDIT gap 7). */
    { key: 'offers', label: 'Offers', icon: I.offer, permission: 'PEOPLE::Documents::VIEW' },
    { key: 'lifecycleChanges', label: 'Job changes', icon: I.change, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'leavers', label: 'Leaving', keywords: ['exit', 'resignation', 'offboarding', 'notice period', 'relieving'], icon: I.leaver, permission: 'PEOPLE::Employees::VIEW' },
    /* Anyone with a task on their name opens Tasks (their own only); the server decides what each sees. */
    { key: 'checklists', label: 'Tasks', icon: I.task },
    { key: 'journeySteps', label: 'Joining & leaving steps', icon: I.steps, permission: 'PEOPLE::Employees::VIEW', parent: 'settings' },
    { key: 'selfService', label: 'Employee app', icon: I.phone, permission: 'ATTENDANCE::Employee Portal::VIEW', parent: 'settings' },
    { key: 'letterTemplates', label: 'Letters', keywords: ['offer letter', 'appointment letter', 'experience letter', 'relieving letter'], icon: I.letter, permission: 'PEOPLE::Documents::VIEW', parent: 'settings' },
    { key: 'customFields', label: 'Custom fields', icon: I.field, permission: 'PEOPLE::Org Structure::EDIT', parent: 'settings' },
    { key: 'selfServiceChanges', label: 'Self-service edits', icon: I.key, permission: 'PEOPLE::Org Structure::EDIT', parent: 'settings' },
    { key: 'approvalRules', label: 'Approval rules', icon: I.checklist, permission: 'PEOPLE::Approvals::VIEW', parent: 'settings' },
    /* The decisions HR and the owner make for the company (docs/people/workflow-engine/SPEC.md 3). */
    { key: 'companyChoices', label: 'Who decides & who sees', keywords: ['company choices', 'choices', 'who decides', 'who sees'], icon: I.choices, permission: 'PEOPLE::Employees::VIEW', parent: 'settings' },
    { key: 'requestForms', label: 'Request types', icon: I.requestType, permission: 'PEOPLE::Approvals::VIEW', parent: 'settings' },
    { key: 'requestsReport', label: 'Requests report', icon: I.requestsReport, permission: 'PEOPLE::Approvals::VIEW' },
    /* Swaps asked in the employee app; HR sees all, a manager their team (the server decides). */
    { key: 'shiftSwaps', label: 'Shift swaps', icon: I.shiftSwap, permission: 'PEOPLE::Requests::VIEW' },
    { key: 'lateMarks', label: 'Late marks', icon: I.lateMarks, permission: 'ATTENDANCE::Attendance Requests::VIEW' },
    /* Absent working day after working day with no leave and no word (Absences.jsx): the label says so. */
    { key: 'absences', label: 'Absent without leave', keywords: ['absences', 'absconding', 'no show', 'missing'], icon: I.absences, permission: 'PEOPLE::Employees::VIEW' },
    /* Women's consent to night work (OSH Code s.43), recorded here; Time › Attendance. */
    { key: 'nightWork', label: 'Night work', keywords: ['night shift', 'consent', 'women'], icon: I.night, permission: 'PEOPLE::Employees::VIEW' },
    { key: 'attendanceRules', label: 'Attendance rules', icon: I.attRules, permission: 'ATTENDANCE::Attendance Requests::VIEW', parent: 'settings' },
    /* Attendance inside People (owner, 11 Nov 2026): the Attendance app's keys, so its screens' links to one another work here. */
    { key: 'records', label: 'All attendance records', keywords: ['attendance records', 'days', 'present', 'absent'], icon: I.records, permission: 'ATTENDANCE::Attendance Records::VIEW', feature: 'attendance' },
    { key: 'exceptions', label: 'Days to check', keywords: ['exceptions', 'missing punch', 'odd days'], icon: I.exceptions, permission: 'ATTENDANCE::Attendance Records::VIEW', feature: 'attendance' },
    { key: 'overtime', label: 'Overtime & comp-off', keywords: ['overtime', 'ot', 'comp off', 'extra hours'], icon: I.overtime, permission: 'ATTENDANCE::Attendance Records::VIEW', feature: 'attendance' },
    { key: 'scheduleCalendar', label: 'Shift calendar', keywords: ['roster', 'schedule'], icon: I.shiftCalendar, permission: 'ATTENDANCE::Shifts::VIEW', feature: 'attendance' },
    { key: 'shifts', label: 'Shifts', keywords: ['shift', 'timing', 'weekly off'], icon: I.shifts, permission: 'ATTENDANCE::Shifts::VIEW', feature: 'attendance' },
    { key: 'shiftAssignments', label: 'Who is on which shift', keywords: ['shift assignments', 'assign shift', 'roster'], icon: I.shiftPeople, permission: 'ATTENDANCE::Shifts::VIEW', feature: 'attendance' },
    { key: 'temporarySchedule', label: 'Temporary shifts', keywords: ['temporary schedule', 'cover'], icon: I.tempShift, permission: 'ATTENDANCE::Shifts::VIEW', feature: 'attendance' },
    { key: 'readers', label: 'Readers', keywords: ['biometric', 'device', 'machine', 'fingerprint', 'face', 'essl', 'zkteco'], icon: I.readers, permission: 'ATTENDANCE::Attendance Devices::VIEW', feature: 'attendance' },
    { key: 'readerHealth', label: 'Reader health', keywords: ['offline', 'reader status'], icon: I.readerHealth, permission: 'ATTENDANCE::Attendance Devices::VIEW', feature: 'attendance' },
    { key: 'transactions', label: 'Punches', keywords: ['punch log', 'transactions', 'in out'], icon: I.punches, permission: 'ATTENDANCE::Attendance Devices::VIEW', feature: 'attendance' },
    { key: 'unmatched', label: 'Punches with no employee', keywords: ['unmatched punches', 'unknown id'], icon: I.unmatched, permission: 'ATTENDANCE::Attendance Devices::VIEW', feature: 'attendance' },
    { key: 'payrollReadiness', label: 'Ready for payroll?', keywords: ['payroll readiness', 'month end'], wholeCompany: true, icon: I.readiness, permission: 'ATTENDANCE::Attendance Records::VIEW', feature: 'attendance' },
    { key: 'confirmations', label: 'Employee confirmations', keywords: ['confirm month', 'sign off'], icon: I.confirm, permission: 'ATTENDANCE::Attendance Records::VIEW', feature: 'attendance' },
    { key: 'monthClose', label: 'Month close', keywords: ['lock attendance', 'close the month'], icon: I.monthClose, permission: 'ATTENDANCE::Attendance Records::VIEW', feature: 'attendance' },
    { key: 'summary', label: 'Monthly attendance', icon: I.summary, permission: 'ATTENDANCE::Attendance Records::VIEW', feature: 'attendance' },
    { key: 'register', label: 'Daily attendance register', wholeCompany: true, icon: I.register, permission: 'ATTENDANCE::Attendance Records::VIEW', feature: 'attendance' },
    { key: 'attendanceReports', label: 'All attendance reports', keywords: ['late', 'early', 'absent', 'overtime report', 'timecard'], wholeCompany: true, icon: I.attReports, permission: 'ATTENDANCE::Attendance Records::VIEW', feature: 'attendance' },
    { key: 'shiftPolicy', label: 'Default shift & late rule', icon: I.shiftPolicy, permission: 'ATTENDANCE::Shifts::VIEW', parent: 'settings', feature: 'attendance' },
    { key: 'weeklyOffPolicy', label: 'Weekly off', icon: I.weeklyOff, permission: 'ATTENDANCE::Shifts::VIEW', parent: 'settings', feature: 'attendance' },
    { key: 'overtimePolicy', label: 'Overtime rules', icon: I.overtimeRule, permission: 'ATTENDANCE::Attendance Records::VIEW', parent: 'settings', feature: 'attendance' },
    { key: 'departmentSchedule', label: 'Department shifts', icon: I.deptShift, permission: 'ATTENDANCE::Shifts::VIEW', parent: 'settings', feature: 'attendance' },
    { key: 'rotations', label: 'Shift rotations', icon: I.rotation, permission: 'ATTENDANCE::Shifts::VIEW', parent: 'settings', feature: 'attendance' },
    { key: 'sites', label: 'Punch areas', icon: I.punchArea, permission: 'ATTENDANCE::Employee Portal::VIEW', parent: 'settings', feature: 'attendance' },
    { key: 'siteCheck', label: 'Punch area check', icon: I.areaCheck, permission: 'ATTENDANCE::Employee Portal::VIEW', parent: 'settings', feature: 'attendance' },
    { key: 'phonePunches', label: 'Phone punches', icon: I.phonePunch, permission: 'ATTENDANCE::Attendance Devices::VIEW', parent: 'settings', feature: 'attendance' },
    { key: 'enrolments', label: 'Fingerprint & face enrolment', icon: I.enrol, permission: 'ATTENDANCE::Attendance Devices::VIEW', parent: 'settings', feature: 'attendance' },
    { key: 'idMapping', label: 'Reader numbers', icon: I.readerId, permission: 'ATTENDANCE::Attendance Devices::VIEW', parent: 'settings', feature: 'attendance' },
    { key: 'readerSync', label: 'Reader sync', icon: I.readerSync, permission: 'ATTENDANCE::Attendance Devices::VIEW', parent: 'settings', feature: 'attendance' },
    { key: 'deviceLogs', label: 'Reader logs', icon: I.readerLog, permission: 'ATTENDANCE::Attendance Devices::VIEW', parent: 'settings', feature: 'attendance' },
    { key: 'contractors', label: 'Contractors', icon: I.contractor, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings', feature: 'attendance' },
    { key: 'automations', label: 'Automations', icon: I.automation, permission: 'PEOPLE::Employees::VIEW', parent: 'settings' },
    { key: 'exitQuestions', label: 'Exit interview', icon: I.exit, permission: 'PEOPLE::Employees::VIEW', parent: 'settings' },
    { key: 'myRequests', label: 'My requests', icon: I.requests, permission: 'ATTENDANCE::My Attendance::VIEW' },
    { key: 'timeOverview', label: "Who's away", keywords: ['who is away', 'on leave today', 'absent today'], icon: I.away, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveRequests', label: 'Leave requests', keywords: ['leave', 'time off', 'approve leave', 'absence request'], short: 'Leave', icon: I.leave, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveBalances', label: 'Leave balances', keywords: ['leave balance', 'remaining leave'], icon: I.balance, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveRegister', label: 'Leave register', icon: I.register, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    { key: 'leaveCalendar', label: 'Leave calendar', icon: I.calendar, permission: 'ATTENDANCE::Leave Requests::VIEW' },
    /* Who decides for an absent approver: set up once, so Settings › Requests & approvals (People plan, 8 Nov 2026). */
    { key: 'standIns', label: 'Delegates', keywords: ['stand-in', 'stand in', 'away', 'hand on approvals'], icon: I.delegate, permission: 'ATTENDANCE::Leave Requests::VIEW', parent: 'settings' },
    { key: 'attendanceRequests', label: 'Attendance fixes', keywords: ['attendance requests', 'punch', 'missed punch', 'regularise', 'regularize', 'fix punch'], short: 'Fixes', icon: I.attRequest, permission: 'ATTENDANCE::Attendance Requests::VIEW' },
    { key: 'attendance', label: 'Daily attendance', keywords: ['who is in', 'absent', 'present', 'late', 'today'], icon: I.attendance, permission: 'ATTENDANCE::Attendance Records::VIEW' },
    { key: 'myDays', label: 'My attendance', icon: I.myDays, permission: 'ATTENDANCE::My Attendance::VIEW' },
    { key: 'myLeave', label: 'My leave', icon: I.myLeave, permission: 'ATTENDANCE::My Attendance::VIEW' },
    { key: 'leaveTypes', label: 'Leave policy', icon: I.leavePolicy, permission: 'ATTENDANCE::Leave Types::VIEW', parent: 'settings' },
    { key: 'holidays', label: 'Holidays', keywords: ['holiday list', 'festival'], icon: I.holiday, permission: 'ATTENDANCE::Holidays::VIEW', parent: 'settings' },
    { key: 'leaveBlocks', label: 'Leave block dates', icon: I.blockDates, permission: 'ATTENDANCE::Leave Types::VIEW', parent: 'settings' },
    { key: 'workingWeek', label: 'Working week', icon: I.workingWeek, permission: 'ATTENDANCE::Leave Types::VIEW', parent: 'settings' },
    { key: 'leaveYearEnd', label: 'Leave year end', icon: I.yearEnd, permission: 'ATTENDANCE::Leave Requests::EDIT', parent: 'settings' },
    { key: 'requestRules', label: 'Attendance request types', icon: I.attTypes, permission: 'ATTENDANCE::Attendance Requests::APPROVE', parent: 'settings' },
    /* Talent. Interviews and one-on-ones need no right of their own: anyone can sit on an interview or
       manage someone, and the server shows each person only their own. Goals, reviews and plans are not
       read-only without Performance Edit (`writeGuard: false`): a manager acts on their own team there, and
       the server decides who may. Screen keys stay, so old links work. */
    { key: 'recruitment', label: 'Job openings', icon: I.job, permission: 'PEOPLE::Recruitment::VIEW', feature: 'peopleHiring' },
    { key: 'candidates', label: 'Candidates', icon: I.candidate, permission: 'PEOPLE::Recruitment::VIEW', feature: 'peopleHiring' },
    { key: 'interviews', label: 'Interviews', icon: I.interview, feature: 'peopleHiring' },
    /* Referrals (A20): HR's list and report with Recruitment; Refer someone for anyone who works here (the server finds their record from the session). */
    { key: 'referrals', label: 'Referrals', icon: I.referral, permission: 'PEOPLE::Recruitment::VIEW', feature: 'peopleHiring' },
    /* Off the menu: the primary action on Referrals opens it, and notices still name it. */
    { key: 'referMe', label: 'Refer someone', keywords: ['referral', 'refer'], icon: I.referMe, feature: 'peopleHiring', writeGuard: false, parent: 'referrals' },
    { key: 'performance', label: 'Goals', icon: I.goal, permission: 'PEOPLE::Performance::VIEW', feature: 'peoplePerformance', writeGuard: false },
    { key: 'reviews', label: 'Reviews', icon: I.review, permission: 'PEOPLE::Performance::VIEW', feature: 'peoplePerformance', writeGuard: false },
    { key: 'oneOnOnes', label: 'One-on-ones', icon: I.oneOnOne, feature: 'peoplePerformance' },
    { key: 'plans', label: 'Improvement plans', icon: I.plan, permission: 'PEOPLE::Performance::VIEW', feature: 'peoplePerformance', writeGuard: false },
    { key: 'learning', label: 'Training', icon: I.training, permission: 'PEOPLE::Learning::VIEW', feature: 'peoplePerformance' },
    { key: 'announcements', label: 'Announcements', icon: I.news, permission: 'PEOPLE::Announcements::VIEW', feature: 'peopleEngage' },
    { key: 'events', label: 'Events', icon: I.event, permission: 'PEOPLE::Events::VIEW', feature: 'peopleEngage' },
    { key: 'helpdesk', label: 'Help desk', keywords: ['ticket', 'query', 'complaint'], icon: I.hrCase, permission: 'PEOPLE::HR Cases::VIEW' },
    /* Who the case routes let in (gap 5): the grant to take cases in and set committees, or a seat on a case or committee. */
    { key: 'privateCases', label: 'Confidential cases', keywords: ['posh', 'grievance', 'harassment', 'icc'], icon: I.privateCase, permission: ['PEOPLE::Private Cases::VIEW', 'PEOPLE::Private Cases::CREATE', 'PEOPLE::Case committee::VIEW'] },
    { key: 'helpDeskSettings', label: 'Help desk settings', icon: I.hrCase, permission: 'PEOPLE::HR Cases::EDIT', parent: 'settings' },
    { key: 'assets', label: 'Assets', keywords: ['laptop', 'phone', 'sim', 'company property', 'asset'], icon: I.asset, permission: 'PEOPLE::Assets::VIEW', feature: 'peopleBenefits' },
    { key: 'benefits', label: 'Benefits', icon: I.benefit, permission: 'PEOPLE::Benefits::VIEW', feature: 'peopleBenefits' },
    { key: 'compensation', label: 'Salary revisions', keywords: ['salary', 'hike', 'increment', 'raise', 'revision'], icon: I.salary, permission: ['PAYROLL::Salary Revisions::VIEW', 'PEOPLE::Salary revisions read::VIEW'], feature: 'peopleBenefits' },
    /* Claims approved in Approvals, paid here; advances and salary advances (WORKFLOW-GAP-RESEARCH 4.1, 4.2). */
    { key: 'expenses', label: 'Expenses', keywords: ['claim', 'reimbursement', 'advance', 'bill'], icon: I.expense, permission: 'PEOPLE::Expenses::VIEW' },
    /* The home opens to anyone who may read one kind of report; each row on it is still checked on its own. */
    { key: 'reportsHome', label: 'All reports', keywords: ['reports', 'report list', 'headcount', 'tenure', 'age', 'gender', 'probation', 'contract end', 'document expiry'], icon: I.report, permission: ['PEOPLE::Employees::VIEW', 'ATTENDANCE::Attendance Records::VIEW', 'ATTENDANCE::Leave Requests::VIEW', 'PEOPLE::Approvals::VIEW'] },
    /* One People report, full page: reached from the home, never its own menu entry. */
    { key: 'hrReport', label: 'Report', icon: I.report, permission: 'PEOPLE::Employees::VIEW', parent: 'reportsHome' },
    { key: 'reports', label: 'Headcount & attrition', keywords: ['people report', 'headcount', 'attrition', 'joiners', 'leavers'], icon: I.report, permission: 'PEOPLE::Employees::VIEW' },
    /* What an inspector asks for (HR view audit, gap 4), and leave taken by department and type (gap 9). */
    { key: 'registers', label: 'Statutory registers', keywords: ['muster roll', 'statutory form', 'form', 'leave summary', 'leave taken'], icon: I.statutory, permission: 'PEOPLE::Employees::VIEW' },
    /* Leave summary is a tab of Statutory registers; its own address stays for links, not the menu (People plan, 8 Nov 2026). */
    { key: 'leaveSummary', label: 'Leave summary', keywords: ['leave taken'], icon: I.leaveSummary, permission: 'PEOPLE::Employees::VIEW', parent: 'registers' },
    { key: 'dataHealth', label: 'Data check', keywords: ['data health', 'missing details'], icon: I.dataCheck, permission: 'PEOPLE::Employees::VIEW' },
    /* Statutory deadlines and the rules behind them: set up and watched from Settings › Company. */
    { key: 'compliance', label: 'Compliance calendar', keywords: ['compliance', 'deadline', 'statutory', 'due date'], icon: I.compliance, permission: 'PEOPLE::Employees::VIEW' },
    /* The old compliance calendar, retired into Compliance (gap 10): a link or notice that still names it opens Compliance. */
    { key: 'complianceCalendar', label: 'Compliance calendar', icon: I.compliance, permission: 'PEOPLE::Employees::VIEW', parent: 'compliance' },
    { key: 'privacy', label: 'Privacy controls', icon: I.privacy, permission: 'PEOPLE::Privacy::VIEW', parent: 'settings' },
    /* The external auditor's own list: what a live grant names (PRV-06). Settings › Data & privacy. */
    { key: 'auditEvidence', label: 'Audit evidence', icon: I.evidence, permission: ['PEOPLE::Audit grant::VIEW'], parent: 'settings' },
    /* The company's shape, set up once: Settings › Company; the detailed lists under More structure, in detailed mode only. */
    { key: 'departments', label: 'Departments', keywords: ['organisation', 'structure'], icon: I.department, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'teams', label: 'Teams', icon: I.team, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail', parent: 'settings' },
    { key: 'seats', label: 'Positions', icon: I.seat, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail', parent: 'settings' },
    { key: 'jobPositions', label: 'Designations', keywords: ['organisation', 'title', 'job title'], icon: I.designation, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'jobRoles', label: 'Job roles', icon: I.role, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail', parent: 'settings' },
    { key: 'employeeTypes', label: 'Employment types', icon: I.type, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'workTypes', label: 'Work modes', icon: I.workType, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'tags', label: 'Tags', icon: I.tag, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings' },
    { key: 'dataImport', label: 'Import data', icon: I.import, permission: 'PEOPLE::Employees::CREATE', parent: 'settings' },
    { key: 'settings', label: 'All settings', icon: I.settings, hub: true },
    /* Founder, 22 Oct 2026: modules switch on and off, within what the subscription carries. */
    { key: 'modules', label: 'Modules & apps', keywords: ['features', 'features & apps'], icon: I.modules, permission: 'SETTINGS::Company Profile::VIEW', parent: 'settings' },
    { key: 'companyDetails', label: 'Company details', icon: I.office, permission: 'SETTINGS::Company Profile::VIEW', parent: 'settings' },
    { key: 'legalEntities', label: 'Legal entity', icon: I.legal, permission: 'PEOPLE::Org Structure::VIEW', parent: 'settings', feature: 'peopleDetailed' },
    { key: 'establishments', label: 'Work sites', icon: I.site, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail', parent: 'settings' },
    { key: 'businessUnits', label: 'Business units', icon: I.unit, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail', parent: 'settings' },
    { key: 'areas', label: 'Locations', icon: I.location, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail', parent: 'settings' },
    { key: 'grades', label: 'Grades', icon: I.grade, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail', parent: 'settings' },
    { key: 'costCentres', label: 'Cost centres', icon: I.costCentre, permission: 'PEOPLE::Org Structure::VIEW', feature: 'peopleOrgDetail', parent: 'settings' },
    { key: 'sso', label: 'Users & security', icon: I.sso, permission: 'SETTINGS::Users::VIEW', parent: 'settings' },
    { key: 'rolesAccess', label: 'Roles & permissions', icon: I.roles, permission: 'SETTINGS::Roles::VIEW', parent: 'settings' },
    { key: 'emailNotifications', label: 'Email notifications', icon: I.mailOut, permission: 'SETTINGS::Company Profile::VIEW', parent: 'settings' },
    /* Its routes answer only where Attendance is on (attendanceRouteOk). */
    { key: 'integrations', label: 'Integrations', icon: I.integrations, permission: 'ATTENDANCE::Attendance Integrations::VIEW', parent: 'settings', feature: 'attendance' },
    /* Any one read behind its datasets (DataExport.jsx `need`); the screen lists only those this person holds. */
    { key: 'dataExport', label: 'Export data', icon: I.export, permission: ['ATTENDANCE::Attendance Records::VIEW', 'ATTENDANCE::Attendance Devices::VIEW', 'ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Attendance Requests::VIEW', 'ATTENDANCE::Holidays::VIEW', 'ATTENDANCE::Shifts::VIEW'], parent: 'settings' },
    /* Each kind in the bin opens to whoever may delete it (server/src/services/recycleBin.ts BIN_KINDS). */
    { key: 'recycleBin', label: 'Recycle bin', icon: I.trash, permission: ['PEOPLE::Employees::DELETE', 'PEOPLE::Employee Notes::DELETE', 'PEOPLE::Documents::DELETE', 'PEOPLE::Org Structure::DELETE', 'ATTENDANCE::Holidays::DELETE', 'ATTENDANCE::Leave Types::DELETE', 'ATTENDANCE::Shifts::DELETE', 'ATTENDANCE::Attendance Records::DELETE'], parent: 'settings' },
    { key: 'dataProtection', label: 'Data protection', icon: I.consent, permission: 'ATTENDANCE::Employee Portal::VIEW', parent: 'settings' },
    { key: 'dataRequests', label: 'Data requests', icon: I.dataRequests, permission: 'PEOPLE::Employees::VIEW', parent: 'settings' },
    { key: 'auditLogs', label: 'Audit logs', icon: I.audit, permission: 'SETTINGS::Audit trail::VIEW', parent: 'settings' },
  ],

  /* Side panels stay only where they carry data the list lacks (People plan 8 Nov 2026, §3 rule 3): the date, quick
     links and "nothing pending" columns on Inbox, Documents, Who's away, the request lists, the registers are gone. */
  screens: {
    overview: PeopleOverview,
    approvals: Approvals,
    policies: Policies,
    /* Employees draws its own figures and charts (PEOPLE-02); a side panel would repeat them. */
    employees: Employees,
    employee: EmployeeRecord,
    employeeNew: AddEmployee,
    employeeImport: ImportEmployees,
    orgChart: OrgChart,
    organization: OrganizationOverview,
    branches: withSidePanel(Branches, panel('BranchesPanel')),
    orgChanges: withSidePanel(OrgChanges, panel('ChangesPanel')),
    documents: PeopleDocuments,
    checklists: withSidePanel(LifecycleTasks, panel('ChecklistsPanel')),
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
    records: AttendanceRecords,
    exceptions: Exceptions,
    overtime: OvertimeRequests,
    scheduleCalendar: ScheduleCalendar,
    shifts: Shifts,
    shiftAssignments: ShiftAssignments,
    temporarySchedule: TemporarySchedule,
    departmentSchedule: DepartmentSchedule,
    rotations: Rotations,
    readers: AttendanceDevices,
    readerHealth: ReaderHealth,
    readerSync: ReaderSync,
    deviceLogs: DeviceLogs,
    enrolments: Enrolments,
    transactions: PunchLog,
    unmatched: UnmatchedPunches,
    idMapping: IdMapping,
    phonePunches: PhonePunches,
    sites: Geofences,
    siteCheck: SiteCheck,
    shiftPolicy: ShiftPolicy,
    /* The Attendance app's key for the same page: its screens link to it by this name. */
    rules: ShiftPolicy,
    weeklyOffPolicy: WeeklyOffPolicy,
    overtimePolicy: OvertimePolicy,
    contractors: Contractors,
    payrollReadiness: PayrollReadiness,
    confirmations: MonthConfirmations,
    monthClose: MonthClose,
    summary: MonthSummary,
    register: AttendanceRegister,
    attendanceReports: AttendanceReportsAt,
    reportLateEarly: attendanceReport('late-early'),
    reportAbsent: attendanceReport('absent'),
    reportOvertime: attendanceReport('overtime'),
    companyChoices: CompanyChoices,
    automations: Automations,
    exitQuestions: ExitQuestions,
    myRequests: MyRequests,
    selfService: PortalAccess,
    timeOverview: TimeOverview,
    workingWeek: WorkingWeek,
    leaveYearEnd: LeaveYearEnd,
    standIns: StandIns,
    leaveBlocks: LeaveBlocks,
    attendanceRequests: statusFromTab(AttendanceRequests),
    requestRules: RequestRules,
    leaveRequests: statusFromTab(LeaveRequests),
    leaveBalances: LeaveBalances,
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
    announcements: register('announcements'),
    events: register('events'),
    helpdesk: withSidePanel(HelpDesk, panel('HelpDeskPanel')),
    privateCases: PrivateCases,
    helpDeskSettings: HelpDeskSettings,
    assets: register('assets'),
    benefits: register('benefits'),
    compensation: SalaryRevisions,
    expenses: Expenses,
    reportsHome: ReportsHome,
    hrReport: HrReport,
    reports: PeopleReports,
    registers: Registers,
    leaveSummary: LeaveSummaryReport,
    dataHealth: DataHealth,
    compliance: Compliance,
    complianceCalendar: Compliance,
    privacy: Privacy,
    auditEvidence: AuditEvidence,
    departments: OrgDepartments,
    teams: OrgTeams,
    seats: OrgPositions,
    jobPositions: OrgDesignations,
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
    emailNotifications: EmailNotifications,
    integrations: Integrations,
    dataExport: DataExport,
    recycleBin: RecycleBin,
    dataProtection: DataProtection,
    dataRequests: DataRequests,
  },
};
