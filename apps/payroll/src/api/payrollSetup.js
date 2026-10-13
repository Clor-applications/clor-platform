import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Whether payroll is ready to run, and what is left to do.
 *
 * Answers for an organisation that has never switched payroll on, because that
 * is exactly who needs it — the setup screen has to be able to ask "where am I"
 * before the app is in use.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

export async function getPayrollSetup() {
  const { setup } = await apiFetch(`/orgs/${encodeURIComponent(orgId())}/payroll/setup`, { skipWarehouseHeader: true });
  return setup;
}
