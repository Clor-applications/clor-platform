import { apiFetch } from '@platform/http';
import { orgId as platformOrgId, requireOrgId } from '@platform/context';

export const hasEInvoiceApiSession = () =>
  Boolean(String(localStorage.getItem('token') || '').trim() && String(platformOrgId() || '').trim());

export async function getEInvoiceSettingsApi() {
  const data = await apiFetch(`/orgs/${requireOrgId()}/einvoice/settings`);
  return data?.settings || null;
}

export async function saveEInvoiceSettingsApi(payload) {
  const data = await apiFetch(`/orgs/${requireOrgId()}/einvoice/settings`, { method: 'PUT', body: payload });
  return data?.settings || null;
}

export async function testEInvoiceConnectionApi() {
  return apiFetch(`/orgs/${requireOrgId()}/einvoice/test`, { method: 'POST', body: {} });
}

/**
 * Registers one invoice on the IRP. The server builds and checks the INV-01
 * payload from the stored invoice; a 422 carries `err.data.issues`.
 */
export async function registerEInvoiceApi(backendInvoiceId) {
  return apiFetch(`/orgs/${requireOrgId()}/invoices/${encodeURIComponent(backendInvoiceId)}/einvoice`, {
    method: 'POST',
    body: {},
  });
}

/**
 * The INV-01 JSON the server would register, for preview and the NIC bulk
 * tool. `docs` is 'invoices' or 'credit-notes'. When the document cannot be
 * e-invoiced the call throws and `err.data.issues` lists what to fix.
 */
export async function getEInvoicePayloadApi(backendDocId, docs = 'invoices') {
  return apiFetch(`/orgs/${requireOrgId()}/${docs}/${encodeURIComponent(backendDocId)}/einvoice/payload`);
}

/** What to show for a failed e-invoice call: the server's list of fixes, else its message. */
export const eInvoiceIssues = (err) => {
  const issues = err?.data?.issues;
  return Array.isArray(issues) && issues.length ? issues.map(String) : [String(err?.message || 'The e-invoice could not be built.')];
};

/** Full stored e-invoice record (IRN, ack, signed invoice/QR, payload, cancel state). */
export async function getEInvoiceDetailsApi(backendInvoiceId) {
  return apiFetch(`/orgs/${requireOrgId()}/invoices/${encodeURIComponent(backendInvoiceId)}/einvoice`);
}

/** Cancels a registered IRN (24-hour window). reason: '1'..'4'. */
export async function cancelEInvoiceApi(backendInvoiceId, { reason, remarks }) {
  return apiFetch(`/orgs/${requireOrgId()}/invoices/${encodeURIComponent(backendInvoiceId)}/einvoice/cancel`, {
    method: 'POST',
    body: { reason, remarks },
  });
}

/** Generates an e-Way Bill from the invoice's IRN (NIC provider). */
export async function generateEwaybillApi(backendInvoiceId, transport = {}) {
  return apiFetch(`/orgs/${requireOrgId()}/invoices/${encodeURIComponent(backendInvoiceId)}/ewaybill`, {
    method: 'POST',
    body: transport,
  });
}
