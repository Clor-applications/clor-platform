import { describe, expect, it } from 'vitest';
import { buildCatalogReport } from './reportCatalogModel';

const companyId = 1;
const range = { start: '2026-10-01', end: '2026-10-31' };
const db = {
  items: [{ id: 10, companyId, type: 'goods', code: 'ITEM-10', name: 'Router', unit: 'Nos', openingQty: 5, openingWarehouseId: 1, purchasePrice: 100, reorderLevel: 10 }],
  branches: [{ id: 11, companyId, name: 'Head Office' }, { id: 12, companyId, name: 'North' }],
  warehouses: [{ id: 1, companyId, branchId: 11, name: 'Main Store' }, { id: 2, companyId, branchId: 12, name: 'North Store' }],
  bills: [{ id: 21, companyId, date: '2026-10-05', number: 'B-21', status: 'posted', warehouseId: 1, items: [{ itemId: 10, quantity: 4, rate: 80 }] }],
  invoices: [{ id: 22, companyId, date: '2026-10-08', number: 'I-22', status: 'posted', warehouseId: 2, items: [{ itemId: 10, quantity: 2, rate: 150 }] }],
};

describe('inventory catalog reports', () => {
  it('uses report-specific columns and stock movements', () => {
    const movement = buildCatalogReport(db, companyId, 'Item Movement', range);
    expect(movement.columns.map(column => column.label)).toContain('Sales Returns');
    expect(movement.rows[0]).toMatchObject({ code: 'ITEM-10', purchases: 4, sales: 2, closing: 7 });
    const ledger = buildCatalogReport(db, companyId, 'Stock Ledger', range);
    expect(ledger.columns.map(column => column.label)).toContain('Voucher No.');
    expect(ledger.rows.map(row => row.number)).toEqual(['B-21', 'I-22']);
    expect(ledger.rows.map(row => row.balance)).toEqual([9, 7]);
    const register = buildCatalogReport(db, companyId, 'Inventory Register', range);
    expect(register.columns.map(column => column.label)).toEqual(['Date', 'Voucher No.', 'Movement Type', 'Branch', 'Warehouse', 'Item Code', 'Item Name', 'Quantity', 'Amount']);
    expect(register.rows).toEqual([
      expect.objectContaining({ number: 'B-21', type: 'Purchase Bill', branch: 'Head Office', warehouse: 'Main Store', quantity: 4, amount: 320 }),
      expect.objectContaining({ number: 'I-22', type: 'Sales Invoice', branch: 'North', warehouse: 'North Store', quantity: -2, amount: 300 }),
    ]);
    expect(buildCatalogReport(db, companyId, 'Reorder Level Report', range).rows[0]).toMatchObject({ closing: 7, shortfall: 3 });
    expect(buildCatalogReport(db, companyId, 'Negative Stock', range).rows).toContainEqual(expect.objectContaining({ code: 'ITEM-10', warehouse: 'North Store', closing: -2 }));
  });

  it('uses remaining batch quantities and the selected expiry window', () => {
    const batchesDb = {
      ...db,
      batches: [
        { id: 31, companyId, itemId: 10, batchNo: 'NEAR', qtyIn: 8, expiryDate: '2026-10-15', createdAt: '2026-09-01' },
        { id: 32, companyId, itemId: 10, batchNo: 'EXPIRED', qtyIn: 4, expiryDate: '2026-09-20', createdAt: '2026-09-01' },
      ],
      invoices: [{ id: 33, companyId, date: '2026-09-10', number: 'I-33', status: 'posted', items: [{ itemId: 10, batchId: 31, quantity: 3 }] }],
    };
    const pastRange = { start: '2026-09-01', end: '2026-09-30' };
    expect(buildCatalogReport(batchesDb, companyId, 'Batch-wise Report', pastRange).rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ batch: 'NEAR', received: 8, issued: 3, remaining: 5 }),
      expect.objectContaining({ batch: 'EXPIRED', remaining: 4 }),
    ]));
    expect(buildCatalogReport(batchesDb, companyId, 'Near Expiry', pastRange, { expiryDays: 30 }).rows.map(row => row.batch)).toEqual(['NEAR']);
    expect(buildCatalogReport(batchesDb, companyId, 'Expired Stock', pastRange).rows.map(row => row.batch)).toEqual(['EXPIRED']);
  });

  it('groups closing stock by the warehouse and branch where movements occurred', () => {
    const warehouses = buildCatalogReport(db, companyId, 'Warehouse-wise Stock', range).rows;
    expect(warehouses).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Main Store', quantity: 9 }),
      expect.objectContaining({ name: 'North Store', quantity: -2 }),
    ]));
    const branches = buildCatalogReport(db, companyId, 'Branch-wise Stock', range).rows;
    expect(branches).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Head Office', quantity: 9 }),
      expect.objectContaining({ name: 'North', quantity: -2 }),
    ]));
  });
});
