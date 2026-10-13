import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};
const base = () => `/orgs/${encodeURIComponent(orgId())}`;
const opts = { skipWarehouseHeader: true };

// Approvals
export const getApprovals = (status = 'PENDING') =>
  apiFetch(`${base()}/approvals?status=${encodeURIComponent(status)}`, opts);
export const decideApproval = (requestId, approve, comment) =>
  apiFetch(`${base()}/approvals/${encodeURIComponent(requestId)}/decide`, {
    method: 'POST',
    body: { approve, comment },
    ...opts,
  });

// Approval rules
export const getApprovalRules = () => apiFetch(`${base()}/approval-rules`, opts);
export const createApprovalRule = (rule) =>
  apiFetch(`${base()}/approval-rules`, { method: 'POST', body: rule, ...opts });
export const deleteApprovalRule = (id) =>
  apiFetch(`${base()}/approval-rules/${encodeURIComponent(id)}`, { method: 'DELETE', ...opts });

// Role profiles
export const getRoleProfiles = () => apiFetch(`${base()}/role-profiles`, opts);
export const createRoleProfile = (profile) =>
  apiFetch(`${base()}/role-profiles`, { method: 'POST', body: profile, ...opts });
export const deleteRoleProfile = (id) =>
  apiFetch(`${base()}/role-profiles/${encodeURIComponent(id)}`, { method: 'DELETE', ...opts });
export const assignRoleProfiles = (userId, profileIds) =>
  apiFetch(`${base()}/users/${encodeURIComponent(userId)}/role-profiles`, {
    method: 'POST',
    body: { profileIds },
    ...opts,
  });

// Document restrictions
export const getUserRestrictions = (userId) =>
  apiFetch(`${base()}/users/${encodeURIComponent(userId)}/permissions`, opts);
export const addUserRestriction = (userId, entityType, entityId, label) =>
  apiFetch(`${base()}/users/${encodeURIComponent(userId)}/permissions`, {
    method: 'POST',
    body: { entityType, entityId, label },
    ...opts,
  });
export const removeUserRestriction = (userId, id) =>
  apiFetch(`${base()}/users/${encodeURIComponent(userId)}/permissions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    ...opts,
  });
