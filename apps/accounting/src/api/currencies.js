import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/** Currencies and dated exchange rates — requirement 8. */

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}`;
const opts = { skipWarehouseHeader: true };

export const listCurrencies = () => apiFetch(`${base()}/currencies`, opts);

export const createCurrency = (currency) =>
  apiFetch(`${base()}/currencies`, { method: 'POST', body: currency, ...opts });
