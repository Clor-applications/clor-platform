import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

/**
 * Whether payroll is ready to run, and what is left to do.
 *
 * Answers for an organisation that has never switched payroll on, because that
 * is exactly who needs it — the setup screen has to be able to ask "where am I"
 * before the app is in use.
 */

export async function getPayrollSetup() {
  const { setup } = await apiFetch(`/orgs/${encodeURIComponent(orgId())}/payroll/setup`, { skipWarehouseHeader: true });
  return setup;
}

/**
 * Paying before the month ends: whether the days after a cut-off are counted
 * as present (and corrected the next month), and the cut-off day.
 * `{ enabled, cutoffDay, attendance }`.
 */
export const getProvisionalDays = () =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/payroll/settings/provisional-days`, { skipWarehouseHeader: true });

export const saveProvisionalDays = ({ enabled, cutoffDay }) =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/payroll/settings/provisional-days`, {
    method: 'PUT',
    body: { enabled, cutoffDay },
    skipWarehouseHeader: true,
  });

/**
 * The share of wages deductions may take in a pay run, and whether statutory
 * deductions count toward it. `{ percent, countsStatutory }`.
 */
export const getDeductionCap = () =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/payroll/settings/deduction-cap`, { skipWarehouseHeader: true });

export const saveDeductionCap = ({ percent, countsStatutory, countsPenalties }) =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/payroll/settings/deduction-cap`, {
    method: 'PUT',
    body: { percent, countsStatutory, countsPenalties },
    skipWarehouseHeader: true,
  });

/** How much of a leaver's final wages loans and advances may take in a full and final: `{ percent, canEdit }`. Owner or admin changes it. */
export const getFnfRecoveryCap = () =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/payroll/settings/fnf-recovery`, { skipWarehouseHeader: true });

export const saveFnfRecoveryCap = ({ percent }) =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/payroll/settings/fnf-recovery`, {
    method: 'PUT',
    body: { percent },
    skipWarehouseHeader: true,
  });
