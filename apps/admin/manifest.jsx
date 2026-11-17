import {
  BellRing,
  Boxes,
  Briefcase,
  Building,
  Building2,
  CircleHelp,
  CircleX,
  Database,
  Download,
  FileText,
  Headset,
  History,
  House,
  Inbox as InboxIcon,
  KeyRound,
  LayoutGrid,
  Lock,
  LockKeyhole,
  MonitorSmartphone,
  Puzzle,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Store,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
  UsersRound,
  Workflow,
} from '@ui/components/ui/navEmoji';
import { PageIconContext } from './src/screens/pageIcon.js';
import { ShieldCheck as AppShieldCheck } from 'lucide-react';
import { memberDirectory } from '@platform/admin/account';
import { listBranches } from '@platform/admin/admin';
import { listOutsideAccess } from '@platform/admin/outsideAccess';
import { orgId as platformOrgId } from '@platform/context';

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

/* Lucide, one family (redesign §7): rail and panel icons; the shell sets their size. */
const RAIL = {
  home: LayoutGrid,
  apps: Boxes,
  access: Users,
  plan: Receipt,
  security: ShieldCheck,
  settings: Settings,
};
const NAV = {
  home: House,
  activity: History,
  inbox: InboxIcon,
  support: CircleHelp,
  companies: Building2,
  branches: Store,
  company: Building,
  apps: Boxes,
  integrations: Puzzle,
  automations: Workflow,
  notifications: BellRing,
  members: Users,
  roles: KeyRound,
  outsideAccess: Briefcase,
  users: UserRound,
  invitations: UserPlus,
  permissions: UserCheck,
  supportAccess: Headset,
  accessHome: UsersRound,
  billing: Receipt,
  invoices: FileText,
  sso: LockKeyhole,
  sessions: MonitorSmartphone,
  auditLog: ScrollText,
  credentials: Lock,
  securityHome: ShieldCheck,
  settings: Settings,
  data: Database,
  export: Download,
  close: CircleX,
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
  /* The app's identity mark stays a line glyph on its colour tile; navigation draws in emoji. */
  icon: AppShieldCheck,
  blurb: 'People, roles, sign-in, billing and the audit trail — for every app.',
  available: true,
  platform: true,
  home: 'home',
  flush: true,
  /** The phone tab bar: what an administrator opens most. */
  mobileTabs: ['home', 'companies', 'members', 'securityHome'],

  /* W-R3: a rail tap opens the module's own landing page; the content follows the sidebar, never the Overview left behind. */
  railOpensHome: true,
  /* The rail's foot: how far setup has got (owners and admins, until it is done). Help is in the bar, as in every app. */
  railFoot: { Component: SetupGuide },

  /*
   * R&D hand-off (clor-rnd/README.md §1/§4, 14 Nov 2026): six rail stops with
   * Lucide icons (redesign §7), and the panel grouped as the design draws it. Every
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
  /* Search: people and companies by name, and jobs by the words an administrator uses for them (src/search.js). */
  searchRecords: (q) => import('./src/search.js').then((m) => m.findInWorkspace(q)),
  searchLabel: 'Search people, companies and settings',
  searchActions: [
    { label: 'Invite a person', screen: 'invitations', keywords: ['invite', 'add user', 'add member', 'new user', 'add person'] },
    { label: 'Add a company', screen: 'companies', keywords: ['add company', 'new company', 'second company', 'gstin'] },
    { label: 'Add a branch', screen: 'branches', keywords: ['branch', 'location', 'office', 'warehouse'] },
    { label: 'Change someone’s role', screen: 'users', keywords: ['change role', 'role', 'permission', 'access', 'make admin'] },
    { label: 'Remove or suspend a person', screen: 'members', keywords: ['remove user', 'suspend', 'offboard', 'left the company', 'deactivate', 'sign out'] },
    { label: 'Admins without an authenticator', screen: 'members', params: { risk: 'no2fa' }, keywords: ['two-factor', '2fa', 'authenticator', 'no 2fa'] },
    { label: 'Password and lockout rules', screen: 'security', keywords: ['password', 'password policy', 'lockout', 'two-factor', '2fa', 'session'] },
    { label: 'Create an API key', screen: 'credentials', keywords: ['api key', 'token', 'key', 'webhook secret'] },
    { label: 'Let an accountant in', screen: 'outsideAccess', keywords: ['accountant', 'ca', 'auditor', 'outside access', 'chartered'] },
    { label: 'Download CLOR invoices', screen: 'invoices', keywords: ['invoice', 'bill', 'receipt', 'download invoice', 'payment'] },
    { label: 'Change plan or seats', screen: 'billing', keywords: ['plan', 'upgrade', 'seats', 'subscription', 'renew', 'pricing'] },
    { label: 'Export data', screen: 'export', keywords: ['export', 'backup', 'download data'] },
    { label: 'Ask CLOR support', screen: 'support', keywords: ['support', 'ticket', 'help', 'contact'] },
  ],
  modules: [
    { key: 'home', label: 'Home', icon: RAIL.home, groups: [
      { label: null, items: ['home', 'audit', 'inbox', 'support'] },
      { label: 'Companies', items: ['companies', 'branches', 'company'] },
    ] },
    { key: 'apps', label: 'Apps', icon: RAIL.apps, items: ['apps', 'integrations', 'automations', 'notifications'] },
    /* "Users", not "People" (owner, 17 Nov 2026): People is the name of an app, and the two read as one thing. */
    { key: 'access', label: 'Users & access', short: 'Users', icon: RAIL.access, groups: [
      { label: null, items: ['members', 'roles', 'outsideAccess'] },
      /* Permissions is the same grid as Roles and is opened from a role, so it has no line of its own here (17 Nov 2026). */
      { label: 'More', items: ['users', 'invitations', 'supportAccess', 'accessHome'] },
    ] },
    { key: 'plan', label: 'Plan', icon: RAIL.plan, items: ['billing', 'invoices'] },
    { key: 'security', label: 'Security', icon: RAIL.security, /* The overview first: a tap on Security opens the summary, not single sign-on (17 Nov 2026). */
      items: ['securityHome', 'security', 'sso', 'accountActivity', 'credentials'] },
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
    /* Short names, so none is cut off in the 176px screens panel (17 Nov 2026): each page keeps its full title. */
    { key: 'outsideAccess', label: 'Accountants', icon: NAV.outsideAccess, permission: 'SETTINGS::Users::VIEW' },
    { key: 'users', label: 'Company users', short: 'Users', icon: NAV.users, permission: 'SETTINGS::Users::VIEW' },
    /* W-3: shown with Users; the server lets only the account's owners and administrators invite. */
    { key: 'invitations', label: 'Invitations', icon: NAV.invitations, permission: 'SETTINGS::Users::VIEW' },
    { key: 'permissions', label: 'Permissions', icon: NAV.permissions, permission: 'SETTINGS::Roles::VIEW' },
    /* CLOR staff asking to look, and the ones let in: approved here, never on the console (docs/workspace/SUPPORT_GRANTS.md). */
    { key: 'supportAccess', label: 'Support access', icon: NAV.supportAccess, permission: 'SETTINGS::Users::VIEW' },
    { key: 'accessHome', label: 'Access overview', short: 'Access', icon: NAV.accessHome, permission: 'SETTINGS::Users::VIEW' },
    { key: 'billing', label: 'Billing & seats', icon: NAV.billing, permission: 'SETTINGS::Company Profile::VIEW' },
    /* CLOR's tax invoices to this account (routes/billing.ts GET /billing/invoices). */
    { key: 'invoices', label: 'Invoices', icon: NAV.invoices, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'sso', label: 'Single sign-on', icon: NAV.sso, permission: 'SETTINGS::Users::VIEW' },
    /* The page holds the password, lockout and two-factor rules as well as devices; "Sessions" hid them (17 Nov 2026). */
    { key: 'security', label: 'Sign-in rules', icon: NAV.sessions, permission: 'SETTINGS::Users::VIEW', keywords: ['sessions', 'devices', 'password', 'password policy', 'lockout', 'two-factor', '2fa', 'authenticator', 'otp', 'allowed domains', 'sign-in activity', 'login'] },
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
    /* The screen, not its icon: `InboxIcon` here drew a 16px icon where the Inbox should be. */
    inbox: Inbox,
    integrations: Integrations,
    apps: Apps,
    invoices: Invoices,
  },
};

/*
 * Every Workspace page wears its menu item's colour icon beside its title (owner, 17 Nov 2026:
 * "icons are missing for headings"). Done once here, so a new screen gets it by being in the menu.
 */
for (const item of adminApp.nav) {
  const Screen = adminApp.screens[item.key];
  if (!Screen || !item.icon) continue;
  const Icon = item.icon;
  const WithPageIcon = (props) => (
    <PageIconContext.Provider value={Icon}>
      <Screen {...props} />
    </PageIconContext.Provider>
  );
  WithPageIcon.displayName = `WithPageIcon(${item.key})`;
  adminApp.screens[item.key] = WithPageIcon;
}
