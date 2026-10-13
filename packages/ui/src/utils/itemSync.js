import { createItem } from '../api/masters';
import { hasApiSession } from '../api/purchaseDocs';
import { notify } from '../components/ui/notify';

/**
 * Write-through for the item master.
 *
 * An item created from the Items screen was written to the browser and nowhere
 * else. The identical item created from the picker on an invoice line — the
 * "create it while typing" path — was written through, so whether a company's
 * catalogue survived a change of machine depended on which screen somebody
 * happened to use to add it.
 *
 * It is worse than a lost master. Hydration matches a server item to the local
 * one by `backendItemId`, so a browser-only item is invisible to it: the
 * catalogue on a second device comes back missing exactly the items the first
 * device typed into the Items screen, and an invoice line pointing at one of
 * them has no server item behind it.
 *
 * The rule is the one every other master follows: the row is kept locally
 * whatever the server says, so nothing typed is lost, and a refusal is
 * reported rather than swallowed.
 */
export const saveItemToServer = async (item) => {
  if (!hasApiSession()) return {};
  try {
    const saved = await createItem({
      code: String(item?.code || '').trim() || undefined,
      name: String(item?.name || '').trim(),
      itemType: String(item?.type || 'Goods') === 'Service' ? 'SERVICE' : 'STOCK',
      unit: String(item?.unit || 'Pcs'),
      hsnSac: String(item?.hsnSac || '').trim() || undefined,
      description: String(item?.description || '').trim() || undefined,
      gstRate: Number(item?.gstRate) || 0,
      salePrice: Number(item?.salePrice) || 0,
      purchasePrice: Number(item?.purchasePrice) || 0,
      openingQty: Number(item?.openingQty) || 0,
      reorderLevel: Number(item?.reorderLevel) > 0 ? Number(item.reorderLevel) : undefined,
    });
    const id = saved?.item?.id;
    return id ? { backendItemId: String(id) } : {};
  } catch (e) {
    notify.error(`Saved on this device only — the server refused it: ${String(e?.message || e)}`);
    return {};
  }
};

export default saveItemToServer;
