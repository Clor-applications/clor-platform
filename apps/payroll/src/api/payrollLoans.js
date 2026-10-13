import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Loans and salary advances.
 *
 * A loan is a schedule. It is drafted, previewed, approved — and approving is
 * what writes the schedule and starts taking money out of somebody's pay.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll/loans`;
const opts = { skipWarehouseHeader: true };

export async function listPayrollLoans({ employeeId = '', status = '' } = {}) {
  const query = new URLSearchParams();
  if (employeeId) query.set('employeeId', employeeId);
  if (status) query.set('status', status);
  const suffix = query.toString() ? `?${query}` : '';
  const { loans } = await apiFetch(`${base()}${suffix}`, opts);
  return Array.isArray(loans) ? loans : [];
}

export async function getPayrollLoan(id) {
  const { loan } = await apiFetch(`${base()}/${encodeURIComponent(id)}`, opts);
  return loan;
}

/** The schedule a loan would have, before one exists. */
export const previewLoanSchedule = (terms) => apiFetch(`${base()}/schedule-preview`, { ...opts, method: 'POST', body: terms });

export async function createPayrollLoan(payload) {
  const { loan } = await apiFetch(base(), { ...opts, method: 'POST', body: payload });
  return loan;
}

export async function updatePayrollLoan(id, payload) {
  const { loan } = await apiFetch(`${base()}/${encodeURIComponent(id)}`, { ...opts, method: 'PUT', body: payload });
  return loan;
}

export async function approvePayrollLoan(id) {
  const { loan } = await apiFetch(`${base()}/${encodeURIComponent(id)}/approve`, { ...opts, method: 'POST' });
  return loan;
}

/** `action` is SKIP (still owed, runs a month longer), WAIVE (forgiven) or RESTORE. */
export async function setInstallmentAction(loanId, installmentId, action) {
  const { loan } = await apiFetch(
    `${base()}/${encodeURIComponent(loanId)}/installments/${encodeURIComponent(installmentId)}`,
    { ...opts, method: 'POST', body: { action } }
  );
  return loan;
}

export async function cancelPayrollLoan(id) {
  const { loan } = await apiFetch(`${base()}/${encodeURIComponent(id)}/cancel`, { ...opts, method: 'POST' });
  return loan;
}
