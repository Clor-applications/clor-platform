import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Stock adjustments and transfers kept on the server — see
 * server/src/routes/stockDocuments.ts. The browser owns the record's shape;
 * the server stores it and checks warehouses, permissions and closed periods.
 */

const base = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return `/orgs/${encodeURIComponent(id)}/stock-documents`;
};
const opts = { skipWarehouseHeader: true };

export const listStockDocuments = (kinds = ['ADJUSTMENT', 'TRANSFER']) =>
  apiFetch(`${base()}?kind=${encodeURIComponent(kinds.join(','))}`, opts);

export const putStockDocument = (kind, uid, doc) =>
  apiFetch(`${base()}/${encodeURIComponent(kind)}/${encodeURIComponent(uid)}`, { method: 'PUT', body: doc, ...opts });

export const deleteStockDocument = (kind, uid) =>
  apiFetch(`${base()}/${encodeURIComponent(kind)}/${encodeURIComponent(uid)}`, { method: 'DELETE', ...opts });
