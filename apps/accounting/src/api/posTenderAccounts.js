import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Where this branch's counter takings post.
 *
 * The server decides which accounts are eligible and returns them with the
 * configuration, so the picker offers exactly what a save would accept. It is
 * not the screen's job to work that rule out — a client that filtered for
 * itself would be a second copy of a rule about where money lands.
 */

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}/pos/tender-accounts`;

// Branch, not warehouse: these accounts belong to a counter, and sending the
// warehouse header makes the server refuse the call for users without one.
const opts = { skipWarehouseHeader: true };

/** The configuration for the branch currently in context, plus what it may choose. */
export async function getPosTenderAccounts() {
  const data = await apiFetch(base(), opts);
  return {
    branchId: data?.branchId || '',
    tenders: data?.tenders || {},
    eligibleAccounts: Array.isArray(data?.eligibleAccounts) ? data.eligibleAccounts : [],
  };
}

export async function setPosTenderAccount({ tender, ledgerAccountId }) {
  const data = await apiFetch(base(), { method: 'PUT', body: { tender, ledgerAccountId }, ...opts });
  return data?.tenders || {};
}

export async function clearPosTenderAccount(tender) {
  const data = await apiFetch(`${base()}/${encodeURIComponent(tender)}`, { method: 'DELETE', ...opts });
  return data?.tenders || {};
}
