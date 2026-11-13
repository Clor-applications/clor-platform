import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

/** Workspace → CLOR support access (docs/workspace/SUPPORT_GRANTS.md). */
const base = () => `/orgs/${encodeURIComponent(orgId())}/support-grants`;
const opts = { skipWarehouseHeader: true };

export const listSupportGrants = () => apiFetch(base(), opts);
export const approveSupportGrant = (id, { hours, scope } = {}) =>
  apiFetch(`${base()}/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { hours, scope }, ...opts });
/** Refuse a request, or end a grant that is open. */
export const endSupportGrant = (id, reason) => apiFetch(`${base()}/${encodeURIComponent(id)}/end`, { method: 'POST', body: { reason }, ...opts });
