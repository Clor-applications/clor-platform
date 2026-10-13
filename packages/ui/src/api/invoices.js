import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

const getOrgId = () => String(platformOrgId() || '').trim();

const requireOrgId = () => {
  const orgId = getOrgId();
  if (!orgId) throw new Error('Missing active org. Please select an organization.');
  return orgId;
};

export async function listInvoicesApi() {
  const orgId = requireOrgId();
  const data = await apiFetch(`/orgs/${orgId}/invoices`);
  return Array.isArray(data?.invoices) ? data.invoices : [];
}

export async function createInvoiceApi(payload) {
  const orgId = requireOrgId();
  try {
    const data = await apiFetch(`/orgs/${orgId}/invoices`, {
      method: 'POST',
      body: payload,
    });
    return data?.invoice || null;
  } catch (err) {
    // Server's unique-constraint handler answers a bare "Already exists".
    if (/already exists/i.test(String(err?.message || '')) && payload?.number) {
      throw new Error(`Invoice number "${payload.number}" is already used. Change the number and save again.`);
    }
    throw err;
  }
}

export async function updateInvoiceApi(invoiceId, payload) {
  const orgId = requireOrgId();
  const data = await apiFetch(`/orgs/${orgId}/invoices/${invoiceId}`, {
    method: 'PATCH',
    body: payload,
  });
  return data?.invoice || null;
}

export async function updateInvoiceStatusApi(invoiceId, payload) {
  const orgId = requireOrgId();
  const data = await apiFetch(`/orgs/${orgId}/invoices/${invoiceId}/status`, {
    method: 'PATCH',
    body: payload,
  });
  return data?.invoice || null;
}

export async function deleteInvoiceApi(invoiceId) {
  const orgId = requireOrgId();
  const data = await apiFetch(`/orgs/${orgId}/invoices/${invoiceId}`, {
    method: 'DELETE',
  });
  return Boolean(data?.ok);
}
