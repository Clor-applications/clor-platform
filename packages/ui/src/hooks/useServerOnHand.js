import { useEffect, useMemo, useState } from 'react';
import { getStockOnHand } from '../api/stockLedger';
import { hasApiSession } from '../api/purchaseDocs';

/**
 * The server's on-hand for these items in this warehouse.
 *
 * A browser counts stock from the documents it has loaded, so a sale rung up
 * at the next counter a minute ago is invisible to it. The server's count is
 * not. Returns a Map of itemId to quantity once loaded — an item absent from
 * it has none — or null while loading, offline, or with no session; callers
 * fall back to their own count then. Refreshed when the items or warehouse
 * change and when the window regains focus.
 */
export const useServerOnHand = (itemIds, warehouseId) => {
  const key = useMemo(
    () => [...new Set((itemIds || []).map((x) => String(x || '').trim()).filter(Boolean))].sort().join(','),
    [itemIds]
  );
  const wh = String(warehouseId || '').trim();
  const [state, setState] = useState({ key: '', map: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onFocus = () => setTick((t) => t + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  useEffect(() => {
    if (!key || !hasApiSession()) return undefined;
    let live = true;
    getStockOnHand({ warehouseId: wh, itemIds: key.split(',') })
      .then((res) => {
        if (!live) return;
        const map = new Map((Array.isArray(res?.onHand) ? res.onHand : []).map((r) => [String(r.itemId), Number(r.qty) || 0]));
        setState({ key: `${key}|${wh}`, map });
      })
      .catch(() => {
        /* Offline, or no right to see items: the local count stands. */
      });
    return () => {
      live = false;
    };
  }, [key, wh, tick]);

  return state.key === `${key}|${wh}` ? state.map : null;
};

export default useServerOnHand;
