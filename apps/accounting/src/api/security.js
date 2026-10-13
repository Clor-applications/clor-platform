import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

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

export const getMySessions = () => apiFetch(`${base()}/my-sessions`, opts);
export const revokeMySessions = () => apiFetch(`${base()}/my-sessions/revoke-all`, { method: 'POST', ...opts });

export const changePassword = (currentPassword, newPassword) =>
  apiFetch(`${base()}/change-password`, { method: 'POST', body: { currentPassword, newPassword }, ...opts });

export const getAuthEvents = (params = '') => apiFetch(`${base()}/events${params}`, opts);
