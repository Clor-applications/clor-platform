import { apiFetch } from '@platform/http';
import { requireOrgId } from '@platform/context';

/**
 * Stock on hand as the server counts it — see server/src/routes/stockLedger.ts.
 * It sees every user's sales, not only the documents this browser has loaded.
 */
const base = () => `/orgs/${encodeURIComponent(requireOrgId())}/stock`;
const opts = { skipWarehouseHeader: true };

export const getStockOnHand = ({ warehouseId = '', itemIds = [] } = {}) => {
  const params = new URLSearchParams();
  if (warehouseId) params.set('warehouseId', warehouseId);
  if (itemIds.length) params.set('itemIds', itemIds.join(','));
  const q = params.toString();
  return apiFetch(`${base()}/on-hand${q ? `?${q}` : ''}`, opts);
};
