import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

/**
 * One-off earnings and deductions: a bonus, an arrear, a fine.
 *
 * An adjustment belongs to a period, is approved before it is paid, and becomes
 * a record the moment a payroll pays it.
 */

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll/adjustments`;
const opts = { skipWarehouseHeader: true };

export async function listPayrollAdjustments({ periodId = '', employeeId = '', status = '' } = {}) {
  const query = new URLSearchParams();
  if (periodId) query.set('periodId', periodId);
  if (employeeId) query.set('employeeId', employeeId);
  if (status) query.set('status', status);
  const suffix = query.toString() ? `?${query}` : '';
  const { adjustments } = await apiFetch(`${base()}${suffix}`, opts);
  return Array.isArray(adjustments) ? adjustments : [];
}

export async function createPayrollAdjustment(payload) {
  const { adjustment } = await apiFetch(base(), { ...opts, method: 'POST', body: payload });
  return adjustment;
}

export async function updatePayrollAdjustment(id, payload) {
  const { adjustment } = await apiFetch(`${base()}/${encodeURIComponent(id)}`, { ...opts, method: 'PUT', body: payload });
  return adjustment;
}

export async function approvePayrollAdjustment(id) {
  const { adjustment } = await apiFetch(`${base()}/${encodeURIComponent(id)}/approve`, { ...opts, method: 'POST' });
  return adjustment;
}

/** A carried deduction (money still owed) is cancelled only with a reason. */
export async function cancelPayrollAdjustment(id, reason) {
  const { adjustment } = await apiFetch(`${base()}/${encodeURIComponent(id)}/cancel`, { ...opts, method: 'POST', ...(reason ? { body: { reason } } : {}) });
  return adjustment;
}

export const deletePayrollAdjustment = (id) => apiFetch(`${base()}/${encodeURIComponent(id)}`, { ...opts, method: 'DELETE' });

export const listLeaveEncashments = () => apiFetch(`/orgs/${encodeURIComponent(orgId())}/payroll/leave-encashments`, opts).then((r) => r.encashments);
