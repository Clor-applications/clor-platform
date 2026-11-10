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

/* W-7.2: the account's own audit. */
export const accountAudit = (filters = {}) => {
  const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  return apiFetch(`/account/audit${q.toString() ? `?${q}` : ''}`, opts);
};
export const signOutMember = (userId) => apiFetch(`/account/members/${encodeURIComponent(userId)}/sign-out`, { method: 'POST', body: {}, ...opts });

/* W-7.3: the account's own name. */
export const renameAccount = (name) => apiFetch('/account', { method: 'PATCH', body: { name }, ...opts });

/* Help and support (Ops plan P1): this person's tickets to CLOR, or the whole account's for owners and admins. */
export const listTickets = () => apiFetch('/support/tickets', { skipWarehouseHeader: true });
export const getTicket = (id) => apiFetch(`/support/tickets/${encodeURIComponent(id)}`, { skipWarehouseHeader: true }).then((r) => r?.ticket);
export const openTicket = (body) => apiFetch('/support/tickets', { method: 'POST', body, skipWarehouseHeader: true }).then((r) => r?.ticket);
export const replyTicket = (id, body) => apiFetch(`/support/tickets/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { body }, skipWarehouseHeader: true }).then((r) => r?.ticket);
export const ticketSolved = (id) => apiFetch(`/support/tickets/${encodeURIComponent(id)}/solved`, { method: 'POST', body: {}, skipWarehouseHeader: true }).then((r) => r?.ticket);
