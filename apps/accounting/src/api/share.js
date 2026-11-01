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

/**
 * The address a reminder carries, or why it carries none. A link that cannot
 * be made is left out of the message — a URL that will not open is worse than
 * none — and the reason is returned so the screen can say so (A-32: only
 * someone who can edit invoices makes a new link).
 */
export async function reminderLink(backendId) {
  if (!backendId) return { url: '', note: '' };
  try {
    const res = await createInvoiceShareLink(backendId);
    return { url: res?.token ? `${window.location.origin}/?share=${encodeURIComponent(res.token)}` : '', note: '' };
  } catch (e) {
    if (e?.code === 'SHARE_LINK_NEEDS_EDIT') return { url: '', note: 'Sent without a link to the invoice: it has none yet, and only someone who can edit invoices can make one.' };
    return { url: '', note: 'Sent without a link to the invoice: the link could not be made just now.' };
  }
}

/**
 * Following a link. No session, no org header — the customer has no account
 * here, which is the whole point of the token.
 */
export const fetchSharedInvoice = (token) =>
  apiFetch(`/public/invoice/${encodeURIComponent(token)}`, { ...opts, skipAuth: true });
