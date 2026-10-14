import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Stock on hand as the server counts it — see server/src/routes/stockLedger.ts.
 * It sees every user's sales, not only the documents this browser has loaded.
 */
const base = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return `/orgs/${encodeURIComponent(id)}/stock`;
};
const opts = { skipWarehouseHeader: true };

export const getStockOnHand = ({ warehouseId = '', itemIds = [] } = {}) => {
  const params = new URLSearchParams();
  if (warehouseId) params.set('warehouseId', warehouseId);
  if (itemIds.length) params.set('itemIds', itemIds.join(','));
  const q = params.toString();
  return apiFetch(`${base()}/on-hand${q ? `?${q}` : ''}`, opts);
};
