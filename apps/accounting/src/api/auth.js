import { apiFetch } from '@platform/http';

export async function getMyAuthContext() {
  return apiFetch('/auth/me', {
    method: 'GET',
    skipBranchHeader: true,
    skipWarehouseHeader: true,
  });
}

/**
 * Add a company to this account.
 *
 * The same endpoint the signup wizard uses. It creates an org, its head-office
 * branch and a Main Store warehouse, and grants the caller membership of all
 * three — which is why a company must be created through it rather than
 * appended to the local store. A company that exists only in the browser has no
 * `backendCompanyId`, so every server call made under it falls back to
 * `activeOrgId` and silently reads and writes the *first* company's branches,
 * warehouses and documents.
 *
 * @returns {Promise<{ company: { id: string, name: string, orgId: string }, branch: { id: string } }>}
 */
export async function createCompany({ companyName, state, gstin = null }) {
  return apiFetch('/auth/setup-company', {
    method: 'POST',
    body: { companyName, state, gstin: gstin || null },
    skipBranchHeader: true,
    skipWarehouseHeader: true,
  });
}
