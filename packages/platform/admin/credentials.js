import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

/** Workspace → Credentials (Batch 5). */
const base = () => `/orgs/${encodeURIComponent(orgId())}/credentials`;
const opts = { skipWarehouseHeader: true };
const act = (id, what, body = {}) => apiFetch(`${base()}/${encodeURIComponent(id)}/${what}`, { method: 'POST', body, ...opts });

export const listCredentials = ({ revoked = false } = {}) => apiFetch(`${base()}${revoked ? '?revoked=1' : ''}`, opts);
export const createApiKey = (body) => apiFetch(`${base()}/api-keys`, { method: 'POST', body, ...opts });
export const suspendCredential = (id, reason) => act(id, 'suspend', { reason });
export const resumeCredential = (id) => act(id, 'resume');
export const extendCredential = (id, expiresAt) => act(id, 'extend', { expiresAt });
export const rotateCredential = (id, reason) => act(id, 'rotate', { reason });
export const revokeCredential = (id, reason) => act(id, 'revoke', { reason });
export const markCredentialReviewed = (id) => act(id, 'review');
