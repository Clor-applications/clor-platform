import { ShieldCheck } from '@phosphor-icons/react';

import { duo } from '@ui/components/ui/duoIcon';

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
  icon: duo(ShieldCheck, 'ShieldCheck'),
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

  modules: [
    { key: 'home', label: 'Overview', icon: ICON.home, items: ['home', 'inbox', 'support'] },
    { key: 'company', label: 'Company', icon: ICON.company, items: ['companies', 'company', 'branches', 'notifications', 'automations'] },
    { key: 'access', label: 'Access', icon: ICON.people, groups: [
      { label: null, items: ['accessHome'] },
      { label: 'Who', items: ['members', 'users', 'invitations', 'outsideAccess'] },
      { label: 'What they may do', items: ['roles', 'permissions'] },
    ] },
    { key: 'security', label: 'Security', icon: ICON.security, items: ['securityHome', 'security', 'sso', 'credentials', 'audit', 'accountActivity'] },
    { key: 'plan', label: 'Plan & billing', short: 'Plan', icon: ICON.plan, items: ['account', 'billing'] },
    { key: 'data', label: 'Data', icon: ICON.data, groups: [
      { label: null, items: ['dataHome', 'export'] },
      /* Closing a company is not an ordinary destination beside an export: it sits apart, under its own heading. */
      { label: 'Danger zone', items: ['close'] },
    ] },
  ],
  /* `permission`: the shell shows an item only to somebody who holds it, and read-only to somebody who cannot change it. */
  nav: [
    { key: 'home', label: 'Overview', icon: ICON.home },
    /* Workspace plan P1: what waits on this person in every app; the server shows each only what they may decide (routes/workspaceWaiting.ts). */
    { key: 'inbox', label: 'Inbox', icon: ICON.inbox },
    /* Everyone may ask CLOR for help; what each sees is the server's (their own tickets, or the account's). */
    { key: 'support', label: 'Help and support', icon: ICON.chat },
    { key: 'companies', label: 'Companies', icon: ICON.companies, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'company', label: 'Company profile', icon: ICON.company, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'branches', label: 'Branches', icon: ICON.companies, permission: 'MASTERS::Company/Branch setup::VIEW' },
    /* B5: every app's switchable emails, for the apps the company has on; the server's own gate (routes/email.ts). */
    { key: 'notifications', label: 'Email notifications', icon: ICON.mail, permission: 'SETTINGS::Company Profile::VIEW' },
    /* What Workspace sends on its own for this company; the server's gate is the company profile's (routes/automations.ts). */
    { key: 'automations', label: 'Automations', icon: ICON.automation, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'accessHome', label: 'Overview', short: 'Access', icon: ICON.people, permission: 'SETTINGS::Users::VIEW' },
    /* W-4: the account's people, every company at once; the server lets only owners and administrators in. */
    { key: 'members', label: 'Members', icon: ICON.people, permission: 'SETTINGS::Users::VIEW' },
    { key: 'users', label: 'Users', icon: ICON.person, permission: 'SETTINGS::Users::VIEW' },
    /* W-3: shown with Users; the server lets only the account's owners and administrators invite. */
    { key: 'invitations', label: 'Invitations', icon: ICON.mail, permission: 'SETTINGS::Users::VIEW' },
    { key: 'outsideAccess', label: 'Outside access', icon: ICON.team, permission: 'SETTINGS::Users::VIEW' },
    { key: 'roles', label: 'Roles', icon: ICON.secure, permission: 'SETTINGS::Roles::VIEW' },
    { key: 'permissions', label: 'Permissions', icon: ICON.settings, permission: 'SETTINGS::Roles::VIEW' },
    { key: 'securityHome', label: 'Overview', short: 'Security', icon: ICON.security, permission: 'SETTINGS::Users::VIEW' },
    { key: 'security', label: 'Sign-in and sessions', icon: ICON.secure, permission: 'SETTINGS::Users::VIEW' },
    { key: 'sso', label: 'Single sign-on', icon: ICON.team, permission: 'SETTINGS::Users::VIEW' },
    { key: 'credentials', label: 'Credentials', icon: ICON.settings, permission: 'SETTINGS::Credentials::VIEW' },
    { key: 'audit', label: 'Audit trail', icon: ICON.history, permission: 'SETTINGS::Audit trail::VIEW' },
    /* W-7.2: the account's own audit; the server shows it to the account's owners and administrators. */
    { key: 'accountActivity', label: 'Account activity', icon: ICON.history, permission: 'SETTINGS::Audit trail::VIEW' },
    { key: 'account', label: 'Subscription', icon: ICON.plan, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'billing', label: 'Billing', icon: ICON.plan, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'dataHome', label: 'Overview', short: 'Data', icon: ICON.data, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'export', label: 'Data export', icon: ICON.data, permission: 'SETTINGS::Company data::EXPORT' },
    { key: 'close', label: 'Close company', icon: ICON.warning, permission: 'SETTINGS::Company Profile::VIEW' },
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
  },
};
