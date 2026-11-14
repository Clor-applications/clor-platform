import {
  AppsListColor,
  ArrowSquareDownColor,
  ArrowSyncColor,
  BriefcaseColor,
  BuildingColor,
  BuildingMultipleColor,
  BuildingStoreColor,
  CheckboxPersonColor,
  DatabaseColor,
  DismissCircleColor,
  DocumentTextColor,
  HeadsetColor,
  HistoryColor,
  HomeColor,
  LockClosedColor,
  LockShieldColor,
  MailAlertColor,
  MailColor,
  PeopleListColor,
  PeopleTeamColor,
  PersonAddColor,
  PersonColor,
  PersonKeyColor,
  PhoneLaptopColor,
  PuzzlePieceColor,
  QuestionCircleColor,
  ReceiptColor,
  SettingsColor,
  ShieldCheckmarkColor,
  TextBulletListSquareColor,
} from '@fluentui/react-icons';

import { colorIcon } from '@ui/components/ui/colorIcon';
import { memberDirectory } from '@platform/admin/account';
import { listBranches } from '@platform/admin/admin';
import { listOutsideAccess } from '@platform/admin/outsideAccess';
import { orgId as platformOrgId } from '@platform/context';

import { ICON } from './src/screens/wsKit.jsx';
import SetupGuide from './src/screens/SetupGuide.jsx';

import { lazyScreens } from '@ui/utils/lazyScreens';

/* Screens load as one file the first time the workspace opens. */
const screen = lazyScreens(() => import('./src/screens.jsx'));
const AdminHome = screen('AdminHome');
const CompanyProfile = screen('CompanyProfile');
const SettingsBranches = screen('SettingsBranches');
const SettingsUsers = screen('SettingsUsers');
const SettingsRoles = screen('SettingsRoles');
const RolePermissionManager = screen('RolePermissionManager');
const SecuritySettings = screen('SecuritySettings');
const SsoSettings = screen('SsoSettings');
const Credentials = screen('Credentials');
const OutsideAccess = screen('OutsideAccess');
const SupportAccess = screen('SupportAccess');
const Invitations = screen('Invitations');
const Members = screen('Members');
const AccountActivity = screen('AccountActivity');
const Companies = screen('Companies');
const NotificationSettings = screen('NotificationSettings');
const Automations = screen('Automations');
const AccessHome = screen('AccessHome');
const SecurityHome = screen('SecurityHome');
const DataHome = screen('DataHome');
const AuditTrail = screen('AuditTrail');
const AccountOverview = screen('AccountOverview');
const BillingPreview = screen('BillingPreview');
const DataBackup = screen('DataBackup');
const CloseCompany = screen('CloseCompany');
const Support = screen('Support');
const Inbox = screen('Inbox');
const Integrations = screen('Integrations');
const Apps = screen('Apps');
const Invoices = screen('Invoices');

/* README §4: the rail and the panel wear Fluent colour icons; controls keep the line set. */
const RAIL = {
  home: colorIcon(HomeColor, 'Home', 24),
  apps: colorIcon(AppsListColor, 'AppsList', 24),
  access: colorIcon(PeopleTeamColor, 'PeopleTeam', 24),
  plan: colorIcon(ReceiptColor, 'Receipt', 24),
  security: colorIcon(ShieldCheckmarkColor, 'ShieldCheckmark', 24),
  settings: colorIcon(SettingsColor, 'Settings', 24),
};
const NAV = {
  home: colorIcon(HomeColor, 'Home'),
  activity: colorIcon(HistoryColor, 'History'),
  inbox: colorIcon(MailColor, 'Mail'),
  support: colorIcon(QuestionCircleColor, 'QuestionCircle'),
  companies: colorIcon(BuildingMultipleColor, 'BuildingMultiple'),
  branches: colorIcon(BuildingStoreColor, 'BuildingStore'),
  company: colorIcon(BuildingColor, 'Building'),
  apps: colorIcon(AppsListColor, 'AppsList'),
  integrations: colorIcon(PuzzlePieceColor, 'PuzzlePiece'),
  automations: colorIcon(ArrowSyncColor, 'ArrowSync'),
  notifications: colorIcon(MailAlertColor, 'MailAlert'),
  members: colorIcon(PeopleTeamColor, 'PeopleTeam'),
  roles: colorIcon(PersonKeyColor, 'PersonKey'),
  outsideAccess: colorIcon(BriefcaseColor, 'Briefcase'),
  users: colorIcon(PersonColor, 'Person'),
  invitations: colorIcon(PersonAddColor, 'PersonAdd'),
  permissions: colorIcon(CheckboxPersonColor, 'CheckboxPerson'),
  supportAccess: colorIcon(HeadsetColor, 'Headset'),
  accessHome: colorIcon(PeopleListColor, 'PeopleList'),
  billing: colorIcon(ReceiptColor, 'Receipt'),
  invoices: colorIcon(DocumentTextColor, 'DocumentText'),
  sso: colorIcon(LockShieldColor, 'LockShield'),
  sessions: colorIcon(PhoneLaptopColor, 'PhoneLaptop'),
  auditLog: colorIcon(TextBulletListSquareColor, 'TextBulletListSquare'),
  credentials: colorIcon(LockClosedColor, 'LockClosed'),
  securityHome: colorIcon(ShieldCheckmarkColor, 'ShieldCheckmark'),
  settings: colorIcon(SettingsColor, 'Settings'),
  data: colorIcon(DatabaseColor, 'Database'),
  export: colorIcon(ArrowSquareDownColor, 'ArrowSquareDown'),
  close: colorIcon(DismissCircleColor, 'DismissCircle'),
};

/**
 * Workspace: the company's own administration, not any one app's (ADR-010).
 *
 * Who works here and what they may do, how they sign in, what the company is
 * and what it pays for are the same answer in Accounting, Payroll, People and
 * Attendance. They lived inside Accounting's settings, so a company that had
 * bought only Payroll could not manage its own users, and People and
 * Attendance borrowed Accounting's screens to fill the gap.
 *
 * Here they are one place, opened before any app — app.clor.in lands on it —
 * and reachable from every app's switcher. An app keeps the settings that are
 * genuinely its own (GST and TDS in Accounting, pay setup in Payroll, shifts
 * in Attendance) and links back here for people and roles.
 *
 * `platform: true` keeps it out of the subscription filter: administering the
 * company is not something a company buys. What a person sees is still decided
 * by the permission on each item, so somebody who manages nothing here does not
 * see it at all.
 */
export const adminApp = {
  id: 'admin',
  name: 'Workspace',
  icon: colorIcon(ShieldCheckmarkColor, 'ShieldCheckmark'),
  blurb: 'People, roles, sign-in, billing and the audit trail — for every app.',
  available: true,
  platform: true,
  home: 'home',
  flush: true,
  /** The phone tab bar: what an administrator opens most. */
  mobileTabs: ['home', 'companies', 'members', 'securityHome'],

  /* W-R3: a rail tap opens the module's own landing page; the content follows the sidebar, never the Overview left behind. */
  railOpensHome: true,
  /* The rail's foot: how far setup has got (owners and admins, until it is done), then Help, which leaves the bar. */
  railFoot: { Component: SetupGuide, helpIcon: ICON.help },
  /* People's icon family (owner, 9 Nov 2026): two-tone marks, and Fluent line icons on buttons and actions. */
  iconSet: 'duo',
  lineIcons: 'fluent',

  /*
   * R&D hand-off (clor-rnd/README.md §1/§4, 14 Nov 2026): six rail stops with
   * Fluent colour icons, and the panel grouped as the design draws it. Every
   * screen the Workspace had is still here, in the closest group.
   */
  /*
   * Counts beside panel items (R&D shell): companies, members, branches and
   * outside grants from the APIs the screens read; apps from the plan. A count
   * that cannot be read is left out, never shown as nought.
   */
  panelCounts: async ({ tenant }) => {
    const settle = (fn) => Promise.resolve().then(fn).catch(() => null);
    const org = platformOrgId();
    const [dir, branches, outside] = await Promise.all([
      settle(memberDirectory),
      org ? settle(() => listBranches(org)) : null,
      settle(listOutsideAccess),
    ]);
    const counts = {};
    const apps = (tenant?.subscriptions || []).filter((a) => a !== 'admin');
    if (apps.length) counts.apps = apps.length;
    if (Array.isArray(dir?.companies)) counts.companies = dir.companies.length;
    if (Array.isArray(dir?.members)) counts.members = dir.members.length;
    if (Array.isArray(branches?.branches)) counts.branches = branches.branches.length;
    if (Array.isArray(outside?.outsideAccess)) counts.outsideAccess = outside.outsideAccess.length;
    return counts;
  },
  modules: [
    { key: 'home', label: 'Home', icon: RAIL.home, groups: [
      { label: null, items: ['home', 'audit', 'inbox', 'support'] },
      { label: 'Companies', items: ['companies', 'branches', 'company'] },
    ] },
    { key: 'apps', label: 'Apps', icon: RAIL.apps, items: ['apps', 'integrations', 'automations', 'notifications'] },
    { key: 'access', label: 'People & access', short: 'People', icon: RAIL.access, groups: [
      { label: null, items: ['members', 'roles', 'outsideAccess'] },
      { label: 'More', items: ['users', 'invitations', 'permissions', 'supportAccess', 'accessHome'] },
    ] },
    { key: 'plan', label: 'Plan', icon: RAIL.plan, items: ['billing', 'invoices'] },
    { key: 'security', label: 'Security', icon: RAIL.security, items: ['sso', 'security', 'accountActivity', 'credentials', 'securityHome'] },
    { key: 'settings', label: 'Settings', icon: RAIL.settings, groups: [
      { label: null, items: ['account', 'dataHome', 'export'] },
      /* Closing a company is not an ordinary destination beside an export: it sits apart, under its own heading. */
      { label: 'Danger zone', items: ['close'] },
    ] },
  ],
  /* `permission`: the shell shows an item only to somebody who holds it, and read-only to somebody who cannot change it. */
  nav: [
    { key: 'home', label: 'Home', icon: NAV.home },
    /* The company's audit trail: what happened in every app, record by record. */
    { key: 'audit', label: 'Activity', icon: NAV.activity, permission: 'SETTINGS::Audit trail::VIEW' },
    /* Workspace plan P1: what waits on this person in every app; the server shows each only what they may decide (routes/workspaceWaiting.ts). */
    { key: 'inbox', label: 'Inbox', icon: NAV.inbox },
    /* Everyone may ask CLOR for help; what each sees is the server's (their own tickets, or the account's). */
    { key: 'support', label: 'Help and support', icon: NAV.support },
    { key: 'companies', label: 'Companies', icon: NAV.companies, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'branches', label: 'Branches', icon: NAV.branches, permission: 'MASTERS::Company/Branch setup::VIEW' },
    { key: 'company', label: 'Company profile', icon: NAV.company, permission: 'SETTINGS::Company Profile::VIEW' },
    /* Every CLOR app: what is in the plan, how many use it, and the way in. */
    { key: 'apps', label: 'Apps', icon: NAV.apps },
    /* Workspace plan P2: readers, connectors, webhooks, sign-on, keys and mail, and whether they work; the server's gate is the company profile's (routes/workspaceWaiting.ts). */
    { key: 'integrations', label: 'Integrations', icon: NAV.integrations, permission: 'SETTINGS::Company Profile::VIEW' },
    /* What Workspace sends on its own for this company; the server's gate is the company profile's (routes/automations.ts). */
    { key: 'automations', label: 'Automations', icon: NAV.automations, permission: 'SETTINGS::Company Profile::VIEW' },
    /* B5: every app's switchable emails, for the apps the company has on; the server's own gate (routes/email.ts). */
    { key: 'notifications', label: 'Email notifications', icon: NAV.notifications, permission: 'SETTINGS::Company Profile::VIEW' },
    /* W-4: the account's people, every company at once; the server lets only owners and administrators in. */
    { key: 'members', label: 'Members', icon: NAV.members, permission: 'SETTINGS::Users::VIEW' },
    { key: 'roles', label: 'Roles', icon: NAV.roles, permission: 'SETTINGS::Roles::VIEW' },
    /* Accountants and other outside firms let into a company, for a time. */
    { key: 'outsideAccess', label: 'Accountant access', icon: NAV.outsideAccess, permission: 'SETTINGS::Users::VIEW' },
    { key: 'users', label: 'Users in this company', short: 'Users', icon: NAV.users, permission: 'SETTINGS::Users::VIEW' },
    /* W-3: shown with Users; the server lets only the account's owners and administrators invite. */
    { key: 'invitations', label: 'Invitations', icon: NAV.invitations, permission: 'SETTINGS::Users::VIEW' },
    { key: 'permissions', label: 'Permissions', icon: NAV.permissions, permission: 'SETTINGS::Roles::VIEW' },
    /* CLOR staff asking to look, and the ones let in: approved here, never on the console (docs/workspace/SUPPORT_GRANTS.md). */
    { key: 'supportAccess', label: 'CLOR support access', icon: NAV.supportAccess, permission: 'SETTINGS::Users::VIEW' },
    { key: 'accessHome', label: 'Access overview', short: 'Access', icon: NAV.accessHome, permission: 'SETTINGS::Users::VIEW' },
    { key: 'billing', label: 'Billing & seats', icon: NAV.billing, permission: 'SETTINGS::Company Profile::VIEW' },
    /* CLOR's tax invoices to this account (routes/billing.ts GET /billing/invoices). */
    { key: 'invoices', label: 'Invoices', icon: NAV.invoices, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'sso', label: 'Single sign-on', icon: NAV.sso, permission: 'SETTINGS::Users::VIEW' },
    { key: 'security', label: 'Sessions', icon: NAV.sessions, permission: 'SETTINGS::Users::VIEW' },
    /* W-7.2: the account's own audit — members, roles, plan, security; the server shows it to the account's owners and administrators. */
    { key: 'accountActivity', label: 'Audit log', icon: NAV.auditLog, permission: 'SETTINGS::Audit trail::VIEW' },
    { key: 'credentials', label: 'Credentials', icon: NAV.credentials, permission: 'SETTINGS::Credentials::VIEW' },
    { key: 'securityHome', label: 'Security overview', short: 'Security', icon: NAV.securityHome, permission: 'SETTINGS::Users::VIEW' },
    /* The account itself: its name, its companies and people, and the plan it is on. */
    { key: 'account', label: 'Workspace settings', icon: NAV.settings, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'dataHome', label: 'Data', icon: NAV.data, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'export', label: 'Data export', icon: NAV.export, permission: 'SETTINGS::Company data::EXPORT' },
    { key: 'close', label: 'Close company', icon: NAV.close, permission: 'SETTINGS::Company Profile::VIEW' },
  ],

  screens: {
    home: AdminHome,
    companies: Companies,
    accessHome: AccessHome,
    securityHome: SecurityHome,
    dataHome: DataHome,
    company: CompanyProfile,
    branches: SettingsBranches,
    notifications: NotificationSettings,
    automations: Automations,
    users: SettingsUsers,
    roles: SettingsRoles,
    permissions: RolePermissionManager,
    security: SecuritySettings,
    sso: SsoSettings,
    credentials: Credentials,
    outsideAccess: OutsideAccess,
    supportAccess: SupportAccess,
    invitations: Invitations,
    members: Members,
    accountActivity: AccountActivity,
    audit: AuditTrail,
    account: AccountOverview,
    billing: BillingPreview,
    export: DataBackup,
    close: CloseCompany,
    support: Support,
    inbox: Inbox,
    integrations: Integrations,
    apps: Apps,
    invoices: Invoices,
  },
};
