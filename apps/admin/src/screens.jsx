import React from 'react';

import CloseCompanyScreen from '@ui/company/CloseCompany';
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
import OutsideAccessScreen from './screens/OutsideAccess';
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
export { default as Invitations } from './screens/Invitations';
export { default as Members } from './screens/Members';
export { default as AccountActivity } from './screens/AccountActivity';
export { default as Companies } from './screens/Companies';
export { AccessHome, SecurityHome, DataHome } from './screens/Landings';

const companyOf = (tenant) => ({ name: tenant?.name || '', profile: tenant?.profile || {} });

export { default as CompanyProfile } from './screens/CompanyProfile';
export const CloseCompany = ({ tenant }) => <WsFrame crumbs={['Data', 'Close company']}><CloseCompanyScreen companyName={tenant?.name || ''} /></WsFrame>;
export const BillingPreview = ({ tenant }) => <WsFrame crumbs={['Plan', 'Billing']}><BillingPreviewScreen currentCompany={companyOf(tenant)} /></WsFrame>;
export const DataBackup = ({ tenant }) => <WsFrame crumbs={['Data', 'Data export']}><DataBackupScreen currentCompany={companyOf(tenant)} /></WsFrame>;
export const AccountOverview = ({ tenant }) => <WsFrame crumbs={['Plan', 'Subscription']}><AccountOverviewScreen currentCompany={companyOf(tenant)} /></WsFrame>;
export const SettingsUsers = () => <WsFrame crumbs={['Access', 'Users']}><SettingsUsersScreen orgId={platformOrgId()} /></WsFrame>;
export const SettingsRoles = () => <WsFrame crumbs={['Access', 'Roles']}><SettingsRolesScreen orgId={platformOrgId()} /></WsFrame>;
export const SettingsBranches = ({ tenant }) => <WsFrame crumbs={['Company', 'Branches']}><SettingsBranchesScreen orgId={platformOrgId()} company={companyOf(tenant)} /></WsFrame>;
export const RolePermissionManager = (props) => <WsFrame crumbs={['Access', 'Permissions']}><RolePermissionManagerScreen {...props} /></WsFrame>;
export const SecuritySettings = (props) => <WsFrame crumbs={['Security', 'Sign-in and sessions']}><SecuritySettingsScreen {...props} /></WsFrame>;
export const SsoSettings = (props) => <WsFrame crumbs={['Security', 'Single sign-on']}><SsoSettingsScreen {...props} /></WsFrame>;
export const Credentials = (props) => <WsFrame crumbs={['Security', 'Credentials']}><CredentialsScreen {...props} /></WsFrame>;
export const OutsideAccess = (props) => <WsFrame crumbs={['Access', 'Outside access']}><OutsideAccessScreen {...props} /></WsFrame>;
export const AuditTrail = (props) => <WsFrame crumbs={['Security', 'Audit trail']}><AuditTrailScreen {...props} /></WsFrame>;
