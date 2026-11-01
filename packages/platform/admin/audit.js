import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

const base = () => `/orgs/${encodeURIComponent(orgId())}`;
const opts = { skipWarehouseHeader: true };

/**
 * Reading the audit trail. There is deliberately no writer here — the trail is
 * written by the routes that change things, and a trail its own product can
 * edit is evidence of nothing.
 */
export const listAudit = (filters = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    const s = String(v ?? '').trim();
    if (s) q.set(k, s);
  }
  const qs = q.toString();
  return apiFetch(`${base()}/audit${qs ? `?${qs}` : ''}`, opts);
};

export const listAuditFacets = () => apiFetch(`${base()}/audit/facets`, opts);
