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

export const listRates = (code) =>
  apiFetch(`${base()}/exchange-rates${code ? `?code=${encodeURIComponent(code)}` : ''}`, opts).then(
    (d) => d?.rates || []
  );

export const saveRate = ({ code, date, rate }) =>
  apiFetch(`${base()}/exchange-rates`, { method: 'POST', body: { code, date, rate }, ...opts });

/**
 * The rate a document would actually post at.
 *
 * Used by forms to show the rate before saving, so the total cannot change
 * underneath the operator after the server recomputes it.
 */
export const resolveRate = (code, date) =>
  apiFetch(
    `${base()}/exchange-rates/resolve?code=${encodeURIComponent(code)}&date=${encodeURIComponent(date)}`,
    opts
  ).then((d) => Number(d?.rate ?? 0));
