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

export const setRolePermissions = (roleId, permissions) =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/roles/${encodeURIComponent(roleId)}/permissions`, {
    method: 'PUT',
    body: { permissions },
    skipWarehouseHeader: true,
  });

export const expandPreset = (roleId, preset) =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/roles/${encodeURIComponent(roleId)}/permissions/preset`, {
    method: 'POST',
    body: { preset },
    skipWarehouseHeader: true,
  });
