import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * One-off earnings and deductions: a bonus, an arrear, a fine.
 *
 * An adjustment belongs to a period, is approved before it is paid, and becomes
 * a record the moment a payroll pays it.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

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

export async function cancelPayrollAdjustment(id) {
  const { adjustment } = await apiFetch(`${base()}/${encodeURIComponent(id)}/cancel`, { ...opts, method: 'POST' });
  return adjustment;
}

export const deletePayrollAdjustment = (id) => apiFetch(`${base()}/${encodeURIComponent(id)}`, { ...opts, method: 'DELETE' });
