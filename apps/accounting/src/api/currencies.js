import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

/** Currencies and dated exchange rates — requirement 8. */

const base = () => `/orgs/${encodeURIComponent(orgId())}`;
const opts = { skipWarehouseHeader: true };

export const listCurrencies = () => apiFetch(`${base()}/currencies`, opts);

export const createCurrency = (currency) =>
  apiFetch(`${base()}/currencies`, { method: 'POST', body: currency, ...opts });
