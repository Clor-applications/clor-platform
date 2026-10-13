import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Payroll reports.
 *
 * Every figure is read from payslips, which do not change. A month nobody has
 * run comes back empty rather than estimated.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll/reports`;
const opts = { skipWarehouseHeader: true };

const get = (name, { periodId = '', from = '', to = '', threshold = '' } = {}) => {
  const query = new URLSearchParams();
  if (periodId) query.set('periodId', periodId);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  if (threshold !== '' && threshold != null) query.set('threshold', String(threshold));
  const suffix = query.toString() ? `?${query}` : '';
  return apiFetch(`${base()}/${name}${suffix}`, opts);
};

/** One row per person, one column per component — the register an auditor asks for. */
export const getSalaryRegister = (filters) => get('register', filters);
/** What is owed to each scheme, with the identifiers a return asks for. */
export const getStatutoryReport = (filters) => get('statutory', filters);
/** Who moved more than the threshold since last month, and every new joiner. */
export const getVarianceReport = (filters) => get('variance', filters);
/** What payroll cost, by department. */
export const getCostReport = (filters) => get('cost', filters);
