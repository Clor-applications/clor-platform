import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Batch (lot) and serial number tracking — requirement 11.
 *
 * Batch calls carry the warehouse header because a lot is held in one
 * warehouse; serial reads do not, because a sold unit no longer sits in any.
 */

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}`;
const noWarehouse = { skipWarehouseHeader: true };

export const listBatches = ({ itemId, inStock } = {}) => {
  const params = new URLSearchParams();
  if (itemId) params.set('itemId', itemId);
  if (inStock) params.set('inStock', 'true');
  const qs = params.toString();
  return apiFetch(`${base()}/batches${qs ? `?${qs}` : ''}`).then((d) => d?.batches || []);
};

export const receiveBatch = (batch) =>
  apiFetch(`${base()}/batches`, { method: 'POST', body: batch }).then((d) => d?.batch || null);

export const issueBatch = (batchId, qty) =>
  apiFetch(`${base()}/batches/${encodeURIComponent(batchId)}/issue`, {
    method: 'POST',
    body: { qty },
    ...noWarehouse,
  }).then((d) => d?.batch || null);

export const listSerials = ({ itemId, status, serialNo } = {}) => {
  const params = new URLSearchParams();
  if (itemId) params.set('itemId', itemId);
  if (status) params.set('status', status);
  if (serialNo) params.set('serialNo', serialNo);
  const qs = params.toString();
  return apiFetch(`${base()}/serials${qs ? `?${qs}` : ''}`, noWarehouse).then((d) => d?.serials || []);
};

export const registerSerials = ({ itemId, serialNos, batchId }) =>
  apiFetch(`${base()}/serials`, { method: 'POST', body: { itemId, serialNos, batchId: batchId || null } });

export const issueSerials = ({ serialNos, docType, docId, status }) =>
  apiFetch(`${base()}/serials/issue`, {
    method: 'POST',
    body: { serialNos, docType: docType || null, docId: docId || null, status: status || 'SOLD' },
    ...noWarehouse,
  });
