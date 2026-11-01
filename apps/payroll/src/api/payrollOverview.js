import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

/**
 * Where payroll is this month, in one request.
 *
 * Everything the overview shows is derived on the server from runs, payslips
 * and the open items behind them — nothing here is a stored total that could
 * drift from what it summarises.
 */

export async function getPayrollOverview() {
  const { overview } = await apiFetch(`/orgs/${encodeURIComponent(orgId())}/payroll/overview`, { skipWarehouseHeader: true });
  return overview;
}
