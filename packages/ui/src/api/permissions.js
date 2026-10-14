import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

export const getPermissionCatalog = () =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/permissions/catalog`, { skipWarehouseHeader: true });

export const getMyPermissions = () =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/permissions/me`, { skipWarehouseHeader: true });

export const getRolePermissions = (roleId) =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/roles/${encodeURIComponent(roleId)}/permissions`, {
    skipWarehouseHeader: true,
  });

/**
 * Replaces a role's grants. `levels` carries the field level of every grant
 * above 0: the server writes an absent level as 0, so a save that left them
 * out quietly took discount and amount-paid rights away from the role.
 */
export const setRolePermissions = (roleId, permissions, levels = {}) =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/roles/${encodeURIComponent(roleId)}/permissions`, {
    method: 'PUT',
    body: { permissions, levels },
    skipWarehouseHeader: true,
  });

export const expandPreset = (roleId, preset) =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/roles/${encodeURIComponent(roleId)}/permissions/preset`, {
    method: 'POST',
    body: { preset },
    skipWarehouseHeader: true,
  });
