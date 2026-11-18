import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

/**
 * Statutory bonus (Payment of Bonus Act): the Act's figures as company
 * settings, a run per financial year, approval into payroll earnings, and the
 * Form C register.
 */

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll`;
const opts = { skipWarehouseHeader: true };

export const getBonusSettings = () => apiFetch(`${base()}/bonus/settings`, opts);
export const saveBonusSettings = (rules) => apiFetch(`${base()}/bonus/settings`, { ...opts, method: 'PUT', body: rules });
/** The year's open run with its lines, and any cancelled ones. */
export const getBonusYear = (fy) => apiFetch(`${base()}/bonus-runs?fy=${encodeURIComponent(fy)}`, opts);
/** Works the year out at the rate; a draft is replaced. */
export const workOutBonus = (body) => apiFetch(`${base()}/bonus-runs`, { ...opts, method: 'POST', body });
export const approveBonus = (id, periodId) => apiFetch(`${base()}/bonus-runs/${encodeURIComponent(id)}/approve`, { ...opts, method: 'POST', body: { periodId } });
export const cancelBonus = (id, reason) => apiFetch(`${base()}/bonus-runs/${encodeURIComponent(id)}/cancel`, { ...opts, method: 'POST', body: { reason } });
export const getBonusRegister = (id) => apiFetch(`${base()}/bonus-runs/${encodeURIComponent(id)}/register`, opts);
