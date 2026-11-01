import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

const base = () => `/orgs/${encodeURIComponent(orgId())}/security`;
const opts = { skipWarehouseHeader: true };

export const getPolicy = () => apiFetch(`${base()}/policy`, opts);
export const savePolicy = (policy) => apiFetch(`${base()}/policy`, { method: 'PUT', body: policy, ...opts });

export const getProviders = () => apiFetch(`${base()}/providers`, opts);
export const createProvider = (provider) =>
  apiFetch(`${base()}/providers`, { method: 'POST', body: provider, ...opts });
export const updateProvider = (id, provider) =>
  apiFetch(`${base()}/providers/${encodeURIComponent(id)}`, { method: 'PATCH', body: provider, ...opts });
export const deleteProvider = (id) =>
  apiFetch(`${base()}/providers/${encodeURIComponent(id)}`, { method: 'DELETE', ...opts });

export const verifyProviderDomains = (id) => apiFetch(`${base()}/providers/${encodeURIComponent(id)}/verify-domains`, { method: 'POST', ...opts });
export const getScim = () => apiFetch(`${base()}/scim`, opts);
export const createScimToken = (defaultRoleId) => apiFetch(`${base()}/scim`, { method: 'POST', body: { defaultRoleId: defaultRoleId || null }, ...opts });
export const revokeScimToken = (id) => apiFetch(`${base()}/scim/${encodeURIComponent(id)}`, { method: 'DELETE', ...opts });

export const getMySessions = () => apiFetch(`${base()}/my-sessions`, opts);
export const revokeMySessions = () => apiFetch(`${base()}/my-sessions/revoke-all`, { method: 'POST', ...opts });

export const changePassword = (currentPassword, newPassword) =>
  apiFetch(`${base()}/change-password`, { method: 'POST', body: { currentPassword, newPassword }, ...opts });

export const getAuthEvents = (params = '') => apiFetch(`${base()}/events${params}`, opts);

