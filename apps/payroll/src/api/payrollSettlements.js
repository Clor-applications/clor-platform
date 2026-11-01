import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

/** Full and final settlements for people who have left. */

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll/settlements`;
const opts = { skipWarehouseHeader: true };
const one = (r) => r?.settlement;

export const listSettlements = () => apiFetch(base(), opts).then((r) => ({ settlements: r?.settlements || [], waiting: r?.waiting || [], you: r?.you || null }));
export const startSettlement = (employeeId) => apiFetch(base(), { ...opts, method: 'POST', body: { employeeId } }).then(one);
export const updateSettlement = (id, body) => apiFetch(`${base()}/${encodeURIComponent(id)}`, { ...opts, method: 'PUT', body }).then(one);
const act = (id, what, body) => apiFetch(`${base()}/${encodeURIComponent(id)}/${what}`, { ...opts, method: 'POST', body }).then(one);
export const recalculateSettlement = (id) => act(id, 'recalculate');
export const approveSettlement = (id) => act(id, 'approve');
export const markSettlementPaid = (id, reference) => act(id, 'paid', { reference });
export const cancelSettlement = (id) => act(id, 'cancel');
/** Lift an absconding case's hold, with a reason; recorded in People and here. */
export const releaseSettlementHold = (id, reason) => act(id, 'release-hold', { reason });
/** Finish closing People's advances and claims for a paid settlement, after a failure part-way. */
export const closeSettlementSources = (id) => act(id, 'close-sources');
