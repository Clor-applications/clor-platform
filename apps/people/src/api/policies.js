import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

const base = () => `/orgs/${encodeURIComponent(orgId())}/people`;
const opts = { skipWarehouseHeader: true };
const send = (path, method, body) => apiFetch(`${base()}${path}`, { ...opts, method, body });

/* Policies (POL-01..06): the library, versions, who each applies to, publishing, acceptance. */
export const listPolicies = (q, category) => apiFetch(`${base()}/policies?q=${encodeURIComponent(q || '')}&category=${encodeURIComponent(category || '')}`, opts);
export const getPolicy = (id) => apiFetch(`${base()}/policies/${encodeURIComponent(id)}`, opts).then((r) => r?.policy);
export const createPolicy = (body) => send('/policies', 'POST', body);
export const updatePolicy = (id, body) => send(`/policies/${encodeURIComponent(id)}`, 'PUT', body);
export const addPolicyVersion = (id, body) => send(`/policies/${encodeURIComponent(id)}/versions`, 'POST', body);
export const updatePolicyVersion = (id, v, body) => send(`/policies/${encodeURIComponent(id)}/versions/${v}`, 'PUT', body);
export const submitPolicyVersion = (id, v) => send(`/policies/${encodeURIComponent(id)}/versions/${v}/submit`, 'POST', {});
export const retirePolicyVersion = (id, v, effectiveTo) => send(`/policies/${encodeURIComponent(id)}/versions/${v}/retire`, 'POST', effectiveTo ? { effectiveTo } : {});
export const policyAcknowledgements = (id, v) => apiFetch(`${base()}/policies/${encodeURIComponent(id)}/versions/${v}/acknowledgements`, opts);
export const remindPolicyVersion = (id, v) => send(`/policies/${encodeURIComponent(id)}/versions/${v}/remind`, 'POST', {});
export const policyScope = (appliesTo) => send('/policies/scope', 'POST', { appliesTo });
export const policyConflicts = (asOf) => apiFetch(`${base()}/policies/conflicts${asOf ? `?asOf=${asOf}` : ''}`, opts).then((r) => r?.conflicts || []);
export const structureList = (kind) => apiFetch(`${base()}/structure/${kind}`, opts).then((r) => r?.items || []);
export const getNoticeLanguages = () => apiFetch(`${base()}/policies/notice-languages`, opts);
export const saveNoticeLanguages = (languages) => send('/policies/notice-languages', 'PUT', { languages });
