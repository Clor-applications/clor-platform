import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * A counter sale, rung up by the server.
 *
 * The till used to raise an invoice through the ordinary route and then write
 * its own receipt into browser storage. That receipt was the only record the
 * money was ever taken: the ledger showed the sale as still owed, and the
 * invoice said Paid on the strength of the till saying so. One call now does
 * the whole thing — invoice, sale posting, receipt, allocation, receipt
 * posting, settlement — or none of it.
 */

const requireOrgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

/**
 * The id for one checkout ATTEMPT, which a retry must reuse.
 *
 * `randomUUID` needs a secure context and is missing on older Safari, so there
 * is a fallback — but it has to be as unguessable as the real thing, because
 * two tills colliding on one id would mean one of them silently taking the
 * other's sale as its own.
 */
export function newCheckoutId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  return `pos-${Date.now()}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * Ring up the sale.
 *
 * Resolves with the server's own record of it — invoice id and number, payment
 * id and number, what it settled to. `replayed` is true when this attempt had
 * already been committed and the server handed back the sale that exists
 * rather than taking the money twice.
 */
export async function posCheckoutApi(payload) {
  const orgId = requireOrgId();
  return apiFetch(`/orgs/${orgId}/pos/checkout`, { method: 'POST', body: payload });
}

/** The code on a refusal, when the server named one. */
export const checkoutErrorCode = (err) => String(err?.data?.code || '');
