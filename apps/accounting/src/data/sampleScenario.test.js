import { describe, expect, it } from 'vitest';
import { initEmptyDB, normalizeDB } from './db';
import { addInventoryReportSamples, addSampleScenario } from './sampleScenario';
import { computeInventorySummaryByItemId } from '@ui/utils/inventory';
import { buildCatalogReport } from '../features/reports/reportCatalogModel';

describe('linked sample scenario', () => {
  it('adds twelve months of balanced, connected entries once without changing the source book', () => {
    const company = { id: 7, name: 'Test Company' };
    const source = normalizeDB({ ...initEmptyDB(), companies: [company] });
    const { db, added } = addSampleScenario(source, company, new Date(2026, 9, 23), { branchId: '2', warehouseId: '3' });
    expect(added).toBe(true);
    expect(source.invoices).toHaveLength(0);
    expect(db.salesOrders).toHaveLength(12);
    expect(db.invoices).toHaveLength(24);
    expect(db.purchaseOrders).toHaveLength(24);
    expect(db.bills).toHaveLength(24);
    expect(db.creditNotes).toHaveLength(12);
    expect(db.debitNotes).toHaveLength(24);
    expect(db.expenses).toHaveLength(12);
    expect(db.journalEntries).toHaveLength(36);
    expect(db.tdsTransactions).toHaveLength(36);
    expect(new Set(db.invoices.map((invoice) => invoice.date.slice(0, 7))).size).toBe(12);
    for (const invoice of db.invoices.filter((row) => row.sourceSalesOrderId)) {
      expect(db.salesOrders.some((order) => order.id === invoice.sourceSalesOrderId)).toBe(true);
      expect(db.creditNotes.some((note) => note.originalInvoiceId === invoice.id)).toBe(true);
      expect(db.payments.some((payment) => payment.allocations?.some((allocation) => allocation.voucherId === invoice.id))).toBe(true);
      expect(invoice.total - invoice.paidAmount).toBeGreaterThan(0);
    }
    for (const bill of db.bills) {
      expect(db.purchaseOrders.some((order) => order.id === bill.sourcePurchaseOrderId)).toBe(true);
      expect(db.debitNotes.some((note) => note.originalBillId === bill.id)).toBe(true);
      expect(bill.total - bill.paidAmount).toBeGreaterThan(0);
    }
    for (const entry of db.journalEntries) {
      expect(entry.lines.reduce((sum, line) => sum + line.debit, 0)).toBe(entry.lines.reduce((sum, line) => sum + line.credit, 0));
    }
    const router = db.items.find((item) => item.code === 'SMP-ROUTER');
    const stock = computeInventorySummaryByItemId({ db, companyId: company.id, fromDate: '2026-10-01', toDate: '2026-10-31' }).get(String(router.id));
    expect(stock.closingQty).toBe(stock.openingQty + stock.purchasesQty - stock.salesQty - stock.debitNoteQty + stock.creditNoteQty);
    expect(addSampleScenario(db, company, new Date(2026, 9, 23)).added).toBe(false);
  });
});

describe('inventory report examples', () => {
  it('populates every inventory report bucket and remains idempotent', () => {
    const company = { id: 7, name: 'Test Company' };
    const source = normalizeDB({ ...initEmptyDB(), companies: [company] });
    const now = new Date(2026, 9, 25);
    const first = addInventoryReportSamples(source, company, now, { branchId: '2', warehouseId: '3' });
    expect(first.added).toBe(true);
    expect(source.items).toHaveLength(0);
    const range = { start: '2026-10-01', end: '2026-10-25' };
    for (const title of ['Inventory Register', 'Batch-wise Report', 'Reorder Level Report', 'Near Expiry', 'Expired Stock', 'Negative Stock']) {
      expect(buildCatalogReport(first.db, company.id, title, range).rows.length, title).toBeGreaterThan(0);
    }
    expect(buildCatalogReport(first.db, company.id, 'Batch-wise Report', range).rows)
      .toContainEqual(expect.objectContaining({ code: 'SMP-EXP-NEAR', received: 12, issued: 3, remaining: 9 }));
    expect(buildCatalogReport(first.db, company.id, 'Reorder Level Report', range).rows)
      .toContainEqual(expect.objectContaining({ code: 'SMP-REORDER', closing: 1, shortfall: 11 }));
    expect(buildCatalogReport(first.db, company.id, 'Negative Stock', range).rows)
      .toContainEqual(expect.objectContaining({ code: 'SMP-NEGATIVE', closing: -6 }));
    expect(addInventoryReportSamples(first.db, company, now).added).toBe(false);
    const repaired = addInventoryReportSamples(first.db, company, now, { branchId: 'active-branch', warehouseId: 'active-warehouse' });
    expect(repaired.repaired).toBe(true);
    expect(repaired.db.bills.find(row => row.sampleScenarioKey === first.key).warehouseId).toBe('active-warehouse');
    expect(repaired.db.invoices.find(row => row.sampleScenarioKey === first.key).branchId).toBe('active-branch');
    expect(addInventoryReportSamples(repaired.db, company, now, { branchId: 'active-branch', warehouseId: 'active-warehouse' }).added).toBe(false);
  });
});
