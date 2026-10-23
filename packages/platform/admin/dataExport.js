import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

/**
 * A copy of this company's own books.
 *
 * Not the server backup: that is the whole multi-tenant database and belongs to
 * whoever runs the service. This is one company's data, for the people whose
 * data it is.
 */
/**
 * @param scope 'data' — what the business did: parties, documents, the ledger.
 *              'configuration' — how the company is set up: branches, the chart
 *              of accounts, numbering, roles, tax rates, the reference lists.
 *              'all' — both.
 */
export const exportCompanyData = (scope = 'all') =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/export?scope=${encodeURIComponent(scope)}`, {
    skipWarehouseHeader: true,
  });
