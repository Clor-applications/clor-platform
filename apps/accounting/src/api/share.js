import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};
const base = () => `/orgs/${encodeURIComponent(orgId())}`;
const opts = { skipWarehouseHeader: true };

/** One live link per invoice: re-sending a reminder gives the same address. */
export const createInvoiceShareLink = (invoiceId) =>
  apiFetch(`${base()}/invoices/${encodeURIComponent(invoiceId)}/share`, { method: 'POST', ...opts });

export const revokeInvoiceShareLink = (invoiceId) =>
  apiFetch(`${base()}/invoices/${encodeURIComponent(invoiceId)}/share`, { method: 'DELETE', ...opts });

/**
 * Following a link. No session, no org header — the customer has no account
 * here, which is the whole point of the token.
 */
export const fetchSharedInvoice = (token) =>
  apiFetch(`/public/invoice/${encodeURIComponent(token)}`, { ...opts, skipAuth: true });
