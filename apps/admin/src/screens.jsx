import React from 'react';

import CloseCompanyPage from './screens/CloseCompanyPage';
import BillingPreviewScreen from './screens/BillingPreview';
import DataBackupScreen from './screens/DataBackup';
import AccountOverviewScreen from './screens/AccountOverview';
import { SettingsUsers as SettingsUsersScreen } from './screens/SettingsUsers';
import { SettingsRoles as SettingsRolesScreen } from './screens/SettingsRoles';
import { SettingsBranches as SettingsBranchesScreen } from './screens/SettingsBranches';
import { orgId as platformOrgId } from '@platform/context';
import RolePermissionManagerScreen from './screens/RolePermissionManager';
import SecuritySettingsScreen from './screens/SecuritySettings';
import SsoSettingsScreen from './screens/SsoSettings';
import CredentialsScreen from './screens/Credentials';
import AuditTrailScreen from './screens/AuditTrail';
import { WsFrame } from './screens/wsKit';

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
export { default as OutsideAccess } from './screens/OutsideAccess';
export { default as Invitations } from './screens/Invitations';
export { default as Members } from './screens/Members';
export { default as AccountActivity } from './screens/AccountActivity';
export { default as Companies } from './screens/Companies';
export { AccessHome, SecurityHome, DataHome } from './screens/Landings';

const companyOf = (tenant) => ({ name: tenant?.name || '', profile: tenant?.profile || {} });

export { default as CompanyProfile } from './screens/CompanyProfile';
export const CloseCompany = ({ tenant }) => <CloseCompanyPage companyName={tenant?.name || ''} />;
export const BillingPreview = ({ tenant }) => <BillingPreviewScreen currentCompany={companyOf(tenant)} />;
export const DataBackup = ({ tenant }) => <DataBackupScreen currentCompany={companyOf(tenant)} />;
export const AccountOverview = ({ tenant }) => <AccountOverviewScreen currentCompany={companyOf(tenant)} />;
export const SettingsUsers = () => <WsFrame crumbs={['Access', 'Users']}><SettingsUsersScreen orgId={platformOrgId()} /></WsFrame>;
export const SettingsRoles = () => <WsFrame crumbs={['Access', 'Roles']}><SettingsRolesScreen orgId={platformOrgId()} /></WsFrame>;
export const SettingsBranches = ({ tenant }) => <SettingsBranchesScreen orgId={platformOrgId()} company={companyOf(tenant)} />;
export const RolePermissionManager = (props) => <WsFrame crumbs={['Access', 'Permissions']}><RolePermissionManagerScreen {...props} /></WsFrame>;
export const SecuritySettings = (props) => <WsFrame crumbs={['Security', 'Sign-in and sessions']}><SecuritySettingsScreen {...props} /></WsFrame>;
export const SsoSettings = (props) => <WsFrame crumbs={['Security', 'Single sign-on']}><SsoSettingsScreen {...props} /></WsFrame>;
export const Credentials = (props) => <WsFrame crumbs={['Security', 'Credentials']}><CredentialsScreen {...props} /></WsFrame>;
export const AuditTrail = (props) => <WsFrame crumbs={['Security', 'Audit trail']}><AuditTrailScreen {...props} /></WsFrame>;
