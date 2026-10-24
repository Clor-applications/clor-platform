import { apiFetch } from '@platform/http';

/** Workspace → the account itself (W-1): the caller's account role, its members, role changes. */
const opts = { skipWarehouseHeader: true };

export const getAccountMe = () => apiFetch('/account/me', opts);
export const listAccountMembers = () => apiFetch('/account/members', opts);
export const setAccountRole = (userId, role, stepUpToken) =>
  apiFetch(`/account/members/${encodeURIComponent(userId)}/role`, {
    method: 'PUT',
    body: { role },
    ...(stepUpToken ? { headers: { 'x-step-up': stepUpToken } } : {}),
    ...opts,
  });

/* W-3: invitations, from the account's side. */
export const listInvitations = () => apiFetch('/account/invitations', opts);
export const createInvitation = (body) => apiFetch('/account/invitations', { method: 'POST', body, ...opts });
export const resendInvitation = (id) => apiFetch(`/account/invitations/${encodeURIComponent(id)}/resend`, { method: 'POST', body: {}, ...opts });
export const revokeInvitation = (id) => apiFetch(`/account/invitations/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: {}, ...opts });

/* W-3: the invited person's side, before they belong to any company (no company headers). */
export const previewInvitation = (token) => apiFetch('/invitations/preview', { method: 'POST', body: { token }, skipAuth: true });
export const acceptInvitationNew = (token, fullName, password) => apiFetch('/invitations/accept', { method: 'POST', body: { token, fullName, password }, skipAuth: true });
export const acceptInvitationSignedIn = (token) => apiFetch('/invitations/accept-signed-in', { method: 'POST', body: { token }, skipAuth: true });

/* W-4: the account's people. */
export const memberDirectory = () => apiFetch('/account/members/directory', opts);
export const memberAccess = (userId) => apiFetch(`/account/members/${encodeURIComponent(userId)}/access`, opts);
export const suspendMember = (userId) => apiFetch(`/account/members/${encodeURIComponent(userId)}/suspend`, { method: 'POST', body: {}, ...opts });
export const reinstateMember = (userId) => apiFetch(`/account/members/${encodeURIComponent(userId)}/reinstate`, { method: 'POST', body: {}, ...opts });
export const removeMemberFromCompany = (userId, orgId) =>
  apiFetch(`/account/members/${encodeURIComponent(userId)}/companies/${encodeURIComponent(orgId)}`, { method: 'DELETE', ...opts });
