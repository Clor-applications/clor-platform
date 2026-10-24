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
