import { describe, expect, it } from 'vitest';
import { buildStockMovements, computeInventorySummaryByItemId } from '@ui/utils/inventory';

const transfer = {
  id: 'transfer-1',
  companyId: 1,
  number: 'BT-1',
  date: '2026-11-12',
  sourceBranchId: 'branch-a',
  targetBranchId: 'branch-b',
  sourceWarehouseId: 'warehouse-a',
  targetWarehouseId: 'warehouse-b',
  lines: [{ itemId: 'item-1', qty: 4, receivedQty: 4 }],
};
const withStatus = (status) => ({
  items: [{ id: 'item-1', companyId: 1, type: 'goods', openingQty: 10, openingWarehouseId: 'warehouse-a' }],
  stockTransfers: [{ ...transfer, status, receivedDate: '2026-11-13' }],
});
const closing = (db, warehouseId, toDate = '2026-11-13') =>
  computeInventorySummaryByItemId({ db, companyId: 1, warehouseId, toDate }).get('item-1')?.closingQty || 0;

describe('branch transfer inventory movement', () => {
  it('leaves drafts untouched, deducts on transfer out, and adds only on transfer in', () => {
    const draft = withStatus('Draft');
    expect(closing(draft, 'warehouse-a')).toBe(10);
    expect(closing(draft, 'warehouse-b')).toBe(0);

    const out = withStatus('Transferred Out');
    expect(closing(out, 'warehouse-a')).toBe(6);
    expect(closing(out, 'warehouse-b')).toBe(0);
    expect(computeInventorySummaryByItemId({ db: out, companyId: 1, warehouseId: 'warehouse-a', fromDate: '2026-11-01', toDate: '2026-11-13' }).get('item-1'))
      .toMatchObject({ inQty: 0, outQty: 4, transferOutQty: 4, closingQty: 6 });

    const received = withStatus('Transfer In');
    expect(closing(received, 'warehouse-a')).toBe(6);
    expect(closing(received, 'warehouse-b', '2026-11-12')).toBe(0);
    expect(closing(received, 'warehouse-b')).toBe(4);
    expect(computeInventorySummaryByItemId({ db: received, companyId: 1, warehouseId: 'warehouse-b', fromDate: '2026-11-01', toDate: '2026-11-13' }).get('item-1'))
      .toMatchObject({ inQty: 4, outQty: 0, transferInQty: 4, closingQty: 4 });
    expect(buildStockMovements({ db: received, companyId: 1 }).movements
      .filter((row) => row.voucherType === 'stockTransfer')
      .map((row) => [row.warehouseId, row.date, row.qtyIn, row.qtyOut]))
      .toEqual([
        ['warehouse-a', '2026-11-12', 0, 4],
        ['warehouse-b', '2026-11-13', 4, 0],
      ]);
  });
});
