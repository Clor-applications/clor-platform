import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/* Compliance (server: routes/peopleCompliance.ts): obligations with owner, proof and checked; the rule library; work-site registrations. */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people/compliance`;
const opts = { skipWarehouseHeader: true };
const send = (path, method, body) => apiFetch(`${base()}${path}`, { ...opts, method, body });

export const listObligations = () => apiFetch(`${base()}/obligations`, opts).then((r) => r?.obligations || []);
export const addObligation = (body) => send('/obligations', 'POST', body).then((r) => r?.obligation);
export const updateObligation = (id, body) => send(`/obligations/${encodeURIComponent(id)}`, 'PATCH', body).then((r) => r?.obligation);
export const addProof = (id, body) => send(`/obligations/${encodeURIComponent(id)}/proofs`, 'POST', body).then((r) => r?.proof);
export const openProof = (id, proofId) => apiFetch(`${base()}/obligations/${encodeURIComponent(id)}/proofs/${encodeURIComponent(proofId)}`, opts).then((r) => r?.proof);
export const removeProof = (id, proofId) => send(`/obligations/${encodeURIComponent(id)}/proofs/${encodeURIComponent(proofId)}`, 'DELETE');
export const listOwners = () => apiFetch(`${base()}/owners`, opts).then((r) => ({ users: r?.users || [], names: r?.names || [] })).catch(() => ({ users: [], names: [] }));
export const listRegistrations = () => apiFetch(`${base()}/registrations`, opts).then((r) => ({ types: r?.types || [], sites: r?.sites || [] }));
export const listRules = () => apiFetch(`${base()}/rules?all=1`, opts).then((r) => r?.rules || []);
export const saveRule = (body) => send('/rules', 'POST', body).then((r) => r?.rule);
export const checkRule = (ruleId, version) => send(`/rules/${encodeURIComponent(ruleId)}/versions/${version}/check`, 'POST', {}).then((r) => r?.rule);
