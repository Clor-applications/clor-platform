import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Payslips, and the reasoning behind every figure on them.
 *
 * A payslip is served from its own snapshot, so what comes back is what was
 * true when it was calculated — the job title held then, the structure used
 * then, the engine version that produced it. Nothing here re-derives anything.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll/slips`;
const opts = { skipWarehouseHeader: true };

export async function listSalarySlips({ runId = '', employeeId = '', periodId = '', paymentStatus = '' } = {}) {
  const q = new URLSearchParams();
  if (runId) q.set('runId', runId);
  if (employeeId) q.set('employeeId', employeeId);
  if (periodId) q.set('periodId', periodId);
  if (paymentStatus) q.set('paymentStatus', paymentStatus);
  const { slips } = await apiFetch(`${base()}${q.toString() ? `?${q}` : ''}`, opts);
  return Array.isArray(slips) ? slips : [];
}

/** One payslip as a document, with the trace behind each figure. */
export async function getSalarySlip(id) {
  const { slip } = await apiFetch(`${base()}/${encodeURIComponent(id)}`, opts);
  return slip;
}

/** Read from the payslips themselves, never stored — a stored figure goes stale. */
export async function getSlipYearToDate(id) {
  const { yearToDate } = await apiFetch(`${base()}/${encodeURIComponent(id)}/year-to-date`, opts);
  return yearToDate;
}
