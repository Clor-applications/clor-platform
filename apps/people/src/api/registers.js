import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';
import { queryString as query } from '@platform/query';

/* Inspection registers (server: routes/peopleCompliance.ts): each answers { title?, columns: string[], rows: string[][], totals?, notes?, establishment, generatedOn }. */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people/compliance/registers`;
const opts = { skipWarehouseHeader: true };

export const employeeRegister = (establishmentId) => apiFetch(`${base()}/employees${query({ establishmentId })}`, opts);
export const leaveRegister = (from, to, establishmentId) => apiFetch(`${base()}/leave${query({ from, to, establishmentId })}`, opts);
export const musterRoll = (month, establishmentId) => apiFetch(`${base()}/muster${query({ month, establishmentId })}`, opts);
export const leaveSummary = (from, to, establishmentId) => apiFetch(`${base()}/leave-summary${query({ from, to, establishmentId })}`, opts);
export const listEstablishments = () => apiFetch(`/orgs/${encodeURIComponent(orgId())}/people/structure/establishments`, opts).then((r) => r?.items || []).catch(() => []);
