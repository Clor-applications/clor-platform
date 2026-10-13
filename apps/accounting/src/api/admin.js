import { apiFetch } from '@platform/http';

// Branches
export function listBranches(orgId) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/branches`, { skipWarehouseHeader: true });
}

export function createBranch(orgId, payload) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/branches`, { method: 'POST', body: payload, skipWarehouseHeader: true });
}

export function updateBranch(orgId, branchId, payload) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/branches/${encodeURIComponent(branchId)}`, { method: 'PATCH', body: payload, skipWarehouseHeader: true });
}

export function deleteBranch(orgId, branchId) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/branches/${encodeURIComponent(branchId)}`, { method: 'DELETE', skipWarehouseHeader: true });
}

// Roles
export function listRoles(orgId) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/roles`, { skipWarehouseHeader: true });
}

export function createRole(orgId, payload) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/roles`, { method: 'POST', body: payload, skipWarehouseHeader: true });
}

export function updateRole(orgId, roleId, payload) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/roles/${encodeURIComponent(roleId)}`, { method: 'PATCH', body: payload, skipWarehouseHeader: true });
}

export function deleteRole(orgId, roleId) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE', skipWarehouseHeader: true });
}

// Users
export function listUsers(orgId) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/users`, { skipWarehouseHeader: true });
}

export function createUser(payload) {
  return apiFetch(`/users`, { method: 'POST', body: payload, skipWarehouseHeader: true });
}

export function deleteUser(orgId, userId) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}`, { method: 'DELETE', skipWarehouseHeader: true });
}

export function updateUser(orgId, userId, payload) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: payload, skipWarehouseHeader: true });
}

export function setUserPrimaryRole(orgId, userId, roleId) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}/role`, {
    method: 'PUT',
    body: { roleId: roleId || null },
    skipWarehouseHeader: true,
  });
}

export function changeUserPassword(orgId, userId, password) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}/password`, {
    method: 'POST',
    body: { password },
    skipWarehouseHeader: true,
  });
}

export function assignUserBranches(orgId, userId, branchIds) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}/branches`, {
    method: 'POST',
    body: { branchIds },
    skipWarehouseHeader: true,
  });
}

export function getUserBranches(orgId, userId) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}/branches`, {
    skipWarehouseHeader: true,
  });
}

export function assignUserRole(orgId, userId, roleId, branchId = null) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}/roles`, {
    method: 'POST',
    body: { roleId, branchId },
    skipWarehouseHeader: true,
  });
}

// Warehouses
const warehouseLoads = new Map();

export function listWarehouses(orgId) {
  const key = String(orgId || '').trim();
  if (warehouseLoads.has(key)) return warehouseLoads.get(key);

  const request = apiFetch(`/orgs/${encodeURIComponent(key)}/warehouses`, { skipWarehouseHeader: true })
    .finally(() => warehouseLoads.delete(key));
  warehouseLoads.set(key, request);
  return request;
}

export function createWarehouse(orgId, payload) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/warehouses`, { method: 'POST', body: payload, skipWarehouseHeader: true });
}

export function updateWarehouse(orgId, warehouseId, payload) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/warehouses/${encodeURIComponent(warehouseId)}`, {
    method: 'PATCH',
    body: payload,
    skipWarehouseHeader: true,
  });
}

export function deleteWarehouse(orgId, warehouseId) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/warehouses/${encodeURIComponent(warehouseId)}`, {
    method: 'DELETE',
    skipWarehouseHeader: true,
  });
}

export function assignUserWarehouses(orgId, userId, warehouseIds) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}/warehouses`, {
    method: 'POST',
    body: { warehouseIds },
    skipWarehouseHeader: true,
  });
}

/**
 * Which companies one person can work in.
 *
 * Access used to be granted a company at a time — switch company, invite the
 * same email, pick a role — which made "what can this person see?" a question
 * you could only answer by visiting every company and looking.
 */
export function getUserCompanies(userId) {
  return apiFetch(`/users/${encodeURIComponent(userId)}/companies`, { skipWarehouseHeader: true });
}

/** The complete set. A company left out of the list is access taken away. */
export function setUserCompanies(userId, orgIds) {
  return apiFetch(`/users/${encodeURIComponent(userId)}/companies`, {
    method: 'PUT',
    body: { orgIds },
    skipWarehouseHeader: true,
  });
}

/**
 * The account, above any one company.
 *
 * Everything else in this product is scoped to a company, which is right for
 * doing the work and wrong for running the business that does it.
 */
export function getAccountOverview() {
  return apiFetch('/account/overview', { skipWarehouseHeader: true });
}
