import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

/**
 * Minimum wages per state (round 66): the rates HR enters or imports from the
 * state's notification. CLOR ships none.
 */
const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll/minimum-wages`;
const opts = { skipWarehouseHeader: true };

/** `{ rates, reminder, columns }`. */
export const getMinimumWages = () => apiFetch(base(), opts);
export const addMinimumWage = (payload) => apiFetch(base(), { ...opts, method: 'POST', body: payload });
export const importMinimumWages = (csv) => apiFetch(`${base()}/import`, { ...opts, method: 'POST', body: { csv } });
export const removeMinimumWage = (id) => apiFetch(`${base()}/${encodeURIComponent(id)}`, { ...opts, method: 'DELETE' });
