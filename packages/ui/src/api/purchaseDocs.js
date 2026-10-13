import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Bills, credit notes, debit notes and expenses — the server's unified
 * purchase-document surface. Same shape as the invoices API: create returns
 * the stored document (with its allocated number), delete reverses the GL
 * posting server-side.
 */

const requireOrgId = () => {
  const orgId = String(platformOrgId() || '').trim();
  if (!orgId) throw new Error('Missing active org. Please select an organization.');
  return orgId;
};

/** True when this session can reach the API at all — mirrors the invoice guard. */
export const hasApiSession = () =>
  Boolean(String(localStorage.getItem('token') || '').trim() && String(platformOrgId() || '').trim());

const PATHS = {
  bill: 'bills',
  creditNote: 'credit-notes',
  debitNote: 'debit-notes',
  expense: 'expenses',
  estimate: 'estimates',
  purchaseOrder: 'purchase-orders',
  salesOrder: 'sales-orders',
};

const pathFor = (kind) => {
  const p = PATHS[kind];
  if (!p) throw new Error(`Unknown document kind: ${kind}`);
  return p;
};

export async function listDocsApi(kind) {
  const data = await apiFetch(`/orgs/${requireOrgId()}/${pathFor(kind)}`);
  return Array.isArray(data?.documents) ? data.documents : [];
}

export async function createDocApi(kind, payload) {
  try {
    const data = await apiFetch(`/orgs/${requireOrgId()}/${pathFor(kind)}`, { method: 'POST', body: payload });
    return data?.document || null;
  } catch (err) {
    // The server's unique-constraint handler answers a bare "Already exists" —
    // name the actual conflict so the user knows what to change.
    if (/already exists/i.test(String(err?.message || '')) && payload?.number) {
      throw new Error(`Number "${payload.number}" is already used by another document. Change the number and save again.`);
    }
    throw err;
  }
}

export async function deleteDocApi(kind, docId) {
  const data = await apiFetch(`/orgs/${requireOrgId()}/${pathFor(kind)}/${encodeURIComponent(docId)}`, {
    method: 'DELETE',
  });
  return Boolean(data?.ok);
}

export async function updateDocApi(kind, docId, payload) {
  const data = await apiFetch(`/orgs/${requireOrgId()}/${pathFor(kind)}/${encodeURIComponent(docId)}`, {
    method: 'PATCH',
    body: payload,
  });
  return data?.document || null;
}

/**
 * Record which documents an on-account note has been knocked off against.
 *
 * No amount moves, so nothing posts: the note's own entry already shifted the
 * party's control account. This writes the sub-ledger detail — which bills or
 * invoices that value answers — so a second browser sees the same picture.
 */
export async function saveSettlementApi(kind, docId, settlement) {
  const data = await apiFetch(
    `/orgs/${requireOrgId()}/${pathFor(kind)}/${encodeURIComponent(docId)}/settlement`,
    { method: 'PATCH', body: settlement }
  );
  return data?.document || null;
}
