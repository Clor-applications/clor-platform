import { Building, Building2, CreditCard, Fingerprint, HardDriveDownload, History, KeyRound, LayoutGrid, Shield, ShieldCheck, Users, XCircle } from 'lucide-react';

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
const AuditTrail = screen('AuditTrail');
const AccountOverview = screen('AccountOverview');
const BillingPreview = screen('BillingPreview');
const DataBackup = screen('DataBackup');
const CloseCompany = screen('CloseCompany');

/**
 * Company admin: the company's own workspace, not any one app's (ADR-010).
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
  name: 'Company admin',
  icon: ShieldCheck,
  blurb: 'People, roles, sign-in, billing and the audit trail — for every app.',
  available: true,
  platform: true,
  home: 'home',
  flush: true,
  /** The phone tab bar: what an administrator opens most. */
  mobileTabs: ['home', 'users', 'roles', 'security'],

  modules: [
    { key: 'home', label: 'Overview', items: ['home'] },
    { key: 'company', label: 'Company', items: ['company', 'branches'] },
    { key: 'access', label: 'Access', groups: [
      { label: 'Who', items: ['users'] },
      { label: 'What they may do', items: ['roles', 'permissions'] },
    ] },
    { key: 'security', label: 'Security', items: ['security', 'sso', 'audit'] },
    { key: 'plan', label: 'Plan & billing', items: ['account', 'billing'] },
    { key: 'data', label: 'Data', items: ['export', 'close'] },
  ],
  /* `permission`: the shell shows an item only to somebody who holds it, and read-only to somebody who cannot change it. */
  nav: [
    { key: 'home', label: 'Overview', icon: LayoutGrid },
    { key: 'company', label: 'Company profile', icon: Building, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'branches', label: 'Branches', icon: Building2, permission: 'MASTERS::Company/Branch setup::VIEW' },
    { key: 'users', label: 'Users', icon: Users, permission: 'SETTINGS::Users::VIEW' },
    { key: 'roles', label: 'Roles', icon: Shield, permission: 'SETTINGS::Roles::VIEW' },
    { key: 'permissions', label: 'Permissions', icon: KeyRound, permission: 'SETTINGS::Roles::VIEW' },
    { key: 'security', label: 'Login & security', icon: Fingerprint, permission: 'SETTINGS::Users::VIEW' },
    { key: 'sso', label: 'Single sign-on', icon: ShieldCheck, permission: 'SETTINGS::Users::VIEW' },
    { key: 'audit', label: 'Audit trail', icon: History, permission: 'SETTINGS::Audit trail::VIEW' },
    { key: 'account', label: 'Account & plan', icon: Building2, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'billing', label: 'Billing', icon: CreditCard, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'export', label: 'Data export', icon: HardDriveDownload, permission: 'SETTINGS::Company Profile::VIEW' },
    { key: 'close', label: 'Close company', icon: XCircle, permission: 'SETTINGS::Company Profile::VIEW' },
  ],

  screens: {
    home: AdminHome,
    company: CompanyProfile,
    branches: SettingsBranches,
    users: SettingsUsers,
    roles: SettingsRoles,
    permissions: RolePermissionManager,
    security: SecuritySettings,
    sso: SsoSettings,
    audit: AuditTrail,
    account: AccountOverview,
    billing: BillingPreview,
    export: DataBackup,
    close: CloseCompany,
  },
};
