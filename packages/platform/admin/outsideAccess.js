import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/** Company admin → Outside access (GAP-006). */
const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};
const base = () => `/orgs/${encodeURIComponent(orgId())}/outside-access`;
const opts = { skipWarehouseHeader: true };
const act = (id, what, body = {}) => apiFetch(`${base()}/${encodeURIComponent(id)}/${what}`, { method: 'POST', body, ...opts });

export const listOutsideAccess = () => apiFetch(base(), opts);
export const changeOutsideAccess = (id, patch) => apiFetch(`${base()}/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, ...opts });
export const pauseOutsideAccess = (id, reason) => act(id, 'suspend', { reason });
export const resumeOutsideAccess = (id) => act(id, 'resume');
export const endOutsideAccess = (id, reason) => act(id, 'revoke', { reason });
