import React from 'react';

import CompanyDetails from '@ui/company/CompanyDetails';
import CloseCompanyScreen from '@ui/company/CloseCompany';
import BillingPreviewScreen from './screens/BillingPreview';
import DataBackupScreen from './screens/DataBackup';
import AccountOverviewScreen from './screens/AccountOverview';
import { SettingsUsers as SettingsUsersScreen } from './screens/SettingsUsers';
import { SettingsRoles as SettingsRolesScreen } from './screens/SettingsRoles';
import { SettingsBranches as SettingsBranchesScreen } from './screens/SettingsBranches';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Every screen the Workspace shows, in one place, so the
 * manifest loads them as one file (WX-03). The manifest names them; nothing
 * else should import from here.
 *
 * Several were written for Accounting and took the company from its working
 * copy. Here the shell hands each screen the tenant it is looking at, and the
 * thin wrappers below pass on what the screen used — the name, the server's
 * company id — so the screens themselves did not have to change to move.
 */
export { default as AdminHome } from './screens/AdminHome';
export { default as RolePermissionManager } from './screens/RolePermissionManager';
export { default as SecuritySettings } from './screens/SecuritySettings';
export { default as SsoSettings } from './screens/SsoSettings';
export { default as Credentials } from './screens/Credentials';
export { default as OutsideAccess } from './screens/OutsideAccess';
export { default as AuditTrail } from './screens/AuditTrail';
export { default as Invitations } from './screens/Invitations';
export { default as Members } from './screens/Members';
export { default as AccountActivity } from './screens/AccountActivity';

const companyOf = (tenant) => ({ name: tenant?.name || '', profile: tenant?.profile || {} });

export const CompanyProfile = () => <CompanyDetails />;
export const CloseCompany = ({ tenant }) => <CloseCompanyScreen companyName={tenant?.name || ''} />;
export const BillingPreview = ({ tenant }) => <BillingPreviewScreen currentCompany={companyOf(tenant)} />;
export const DataBackup = ({ tenant }) => <DataBackupScreen currentCompany={companyOf(tenant)} />;
export const AccountOverview = ({ tenant }) => <AccountOverviewScreen currentCompany={companyOf(tenant)} />;
export const SettingsUsers = () => <SettingsUsersScreen orgId={platformOrgId()} />;
export const SettingsRoles = () => <SettingsRolesScreen orgId={platformOrgId()} />;
export const SettingsBranches = ({ tenant }) => <SettingsBranchesScreen orgId={platformOrgId()} company={companyOf(tenant)} />;
