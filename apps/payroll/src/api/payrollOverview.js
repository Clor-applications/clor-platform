import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Where payroll is this month, in one request.
 *
 * Everything the overview shows is derived on the server from runs, payslips
 * and the open items behind them — nothing here is a stored total that could
 * drift from what it summarises.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

export async function getPayrollOverview() {
  const { overview } = await apiFetch(`/orgs/${encodeURIComponent(orgId())}/payroll/overview`, { skipWarehouseHeader: true });
  return overview;
}
