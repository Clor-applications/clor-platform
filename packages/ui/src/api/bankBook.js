import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};
const base = () => `/orgs/${encodeURIComponent(orgId())}`;
const opts = { skipWarehouseHeader: true };

/**
 * The cash and bank book.
 *
 * These are the account's own movements — a bank charge, interest, a transfer
 * between two of your own accounts — as opposed to a payment, which is a
 * voucher against a party.
 */
export const listBankBook = (ledgerAccountId) =>
  apiFetch(`${base()}/bank-book${ledgerAccountId ? `?ledgerAccountId=${encodeURIComponent(ledgerAccountId)}` : ''}`, opts);

export const createBankBookEntry = (entry) =>
  apiFetch(`${base()}/bank-book`, { method: 'POST', body: entry, ...opts });

export const updateBankBookEntry = (id, patch) =>
  apiFetch(`${base()}/bank-book/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, ...opts });

export const deleteBankBookEntry = (id) =>
  apiFetch(`${base()}/bank-book/${encodeURIComponent(id)}`, { method: 'DELETE', ...opts });

export const reconcileBankBookEntry = (id, { reconciled, bankDate, statementRef } = {}) =>
  apiFetch(`${base()}/bank-book/${encodeURIComponent(id)}/reconcile`, {
    method: 'PATCH',
    body: { reconciled: Boolean(reconciled), bankDate: bankDate ?? null, statementRef: statementRef ?? null },
    ...opts,
  });
