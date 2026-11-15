import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/api/purchaseDocs', () => ({
  createDocApi: vi.fn(async () => ({})),
  hasApiSession: () => false,
}));

import InventoryModule from './InventoryModule';
import StockAdjustments from './StockAdjustments';
import ReorderAlerts from './ReorderAlerts';
import BatchStock from './BatchStock';
import { StockTransfersList } from './StockTransferModule';

const COMPANY = { id: 1, name: 'Neev Steels', state: 'Karnataka' };
const warehouses = [
  { id: 1, companyId: 1, name: 'Main Store', branchId: 1 },
  { id: 2, companyId: 1, name: 'Yard', branchId: 1 },
];
const branches = [{ id: 1, companyId: 1, branchCode: 'HO', branchName: 'Head Office' }];

const db = {
  companies: [COMPANY],
  branches,
  warehouses,
  items: [
    { id: 11, companyId: 1, name: 'MS Angle 50mm', code: 'ANG50', type: 'Goods', unit: 'Nos', purchasePrice: 850, reorderLevel: 20, trackInventory: true },
    { id: 12, companyId: 1, name: 'Welding Rod 3.2mm', code: 'WR32', type: 'Goods', unit: 'Kg', purchasePrice: 220, reorderLevel: 50, trackInventory: true },
  ],
  bills: [
    { id: 1, companyId: 1, number: 'BILL-1', vendorId: 9, vendorName: 'Steel Depot', date: '2026-08-20', status: 'Unpaid', warehouseId: 1, items: [{ itemId: 11, quantity: 40, rate: 850 }] },
  ],
  invoices: [
    { id: 1, companyId: 1, number: 'INV-1', date: '2026-09-02', status: 'Unpaid', warehouseId: 1, items: [{ itemId: 11, quantity: 25, rate: 1200 }] },
  ],
  stockAdjustments: [
    { id: 1, companyId: 1, number: 'ADJ-1', date: '2026-09-03', warehouseId: 1, branchId: 1, itemId: 11, qtyDelta: -2, valueDelta: -1700, reason: 'Damaged' },
    { id: 2, companyId: 1, number: 'ADJ-2', date: '2026-09-05', warehouseId: 2, branchId: 1, itemId: 12, qtyDelta: 5, valueDelta: 1100, reason: 'Count found extra' },
  ],
  stockTransfers: [
    { id: 1, companyId: 1, number: 'TRF-1', date: '2026-09-02', sourceWarehouseId: 1, targetWarehouseId: 2, sourceWarehouseName: 'Main Store', targetWarehouseName: 'Yard', status: 'Transferred Out', lines: [{ itemId: 11, qty: 10 }] },
    { id: 2, companyId: 1, number: 'TRF-2', date: '2026-09-04', sourceWarehouseId: 2, targetWarehouseId: 1, sourceWarehouseName: 'Yard', targetWarehouseName: 'Main Store', status: 'Transfer In', lines: [{ itemId: 12, qty: 8, receivedQty: 8 }] },
  ],
  vendors: [{ id: 9, companyId: 1, name: 'Steel Depot', displayName: 'Steel Depot' }],
  debitNotes: [], creditNotes: [], purchaseOrders: [], expenses: [], payments: [], customers: [], uoms: [], gstRates: [],
};

const noop = () => {};

/*
 * The six inventory screens, held to the layout every other list follows.
 *
 * They were the least consistent group in the product: Inventory kept its
 * figures as a line of small text above the heading and its search at the far
 * right of a filter row, Stock Adjustments and Batch Stock had no search at
 * all, and the transfers list wore a heading with two loose buttons beside it.
 */
const PAGES = [
  {
    name: 'Inventory',
    heading: /^Inventory$/i,
    search: /Search items/i,
    render: () => <InventoryModule db={db} setDb={noop} currentCompany={COMPANY} warehouses={warehouses} />,
  },
  {
    name: 'Stock Adjustments',
    heading: /Stock Adjustments/i,
    search: /Search adjustments/i,
    filterInHeader: true,
    filterLabel: 'Adjustment filter',
    render: () => <StockAdjustments db={db} setDb={noop} currentCompany={COMPANY} warehouses={warehouses} branches={branches} />,
  },
  {
    name: 'Reorder Alerts',
    heading: /Reorder Alerts/i,
    search: /Search items/i,
    render: () => <ReorderAlerts db={db} setDb={noop} currentCompany={COMPANY} />,
  },
  {
    name: 'Batch Stock',
    heading: /Batch Stock & Expiry/i,
    search: /Search batches/i,
    filterInHeader: true,
    filterLabel: 'Batch filter',
    render: () => <BatchStock db={db} currentCompany={COMPANY} />,
  },
  {
    name: 'Warehouse Transfers',
    heading: /Warehouse Transfers/i,
    search: /Search transfers/i,
    render: () => (
      <StockTransfersList db={db} setDb={noop} currentCompany={COMPANY} openModal={noop} branches={branches} warehouses={warehouses} mode="warehouse" />
    ),
  },
  {
    name: 'Branch Transfers',
    heading: /Branch Transfers/i,
    search: /Search transfers/i,
    render: () => (
      <StockTransfersList db={db} setDb={noop} currentCompany={COMPANY} openModal={noop} branches={branches} warehouses={warehouses} mode="branch" />
    ),
  },
];

describe.each(PAGES)('$name, laid out like every other list', (page) => {
  it('names itself in a page heading', () => {
    render(page.render());
    expect(screen.getByRole('heading', { name: page.heading })).toBeTruthy();
  });

  it('puts search in the header', () => {
    render(page.render());
    expect(screen.getByLabelText(page.search)).toBeTruthy();
  });

  it('carries five figures across the top', () => {
    render(page.render());
    expect(screen.getByRole('region', { name: /Summary/i }).children).toHaveLength(5);
  });

  it('offers its filters as tabs with counts', () => {
    render(page.render());
    if (page.filterInHeader) {
      const filter = screen.getByRole('combobox', { name: page.filterLabel });
      expect(filter).toBeTruthy();
      expect(within(filter).getAllByRole('option').length).toBeGreaterThanOrEqual(3);
      expect(filter.value).toBe('ALL');
      return;
    }
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('keeps page-level actions behind More', () => {
    render(page.render());
    expect(screen.getByRole('button', { name: /^More$/i })).toBeTruthy();
  });

  it('puts the rows in one card, not a card inside a card', () => {
    const { container } = render(page.render());
    const card = container.querySelector('table.ui-table').closest('.ui-card');
    expect(card).toBeTruthy();
    expect(card.parentElement.closest('.ui-card')).toBeNull();
  });
});

describe('what the inventory screens count', () => {
  it('counts stock from the documents, not a stored figure', () => {
    // 40 bought, 25 sold, 10 transferred out, 2 adjusted away — every one of
    // those is a document, and closing is what they add up to.
    render(<InventoryModule db={db} setDb={noop} currentCompany={COMPANY} warehouses={warehouses} />);
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'thisYear' } });
    fireEvent.click(screen.getByRole('button', { name: 'Warehouse' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Main Store' }));
    const cells = [...screen.getByText('MS Angle 50mm').closest('tr').querySelectorAll('td')].map((td) => td.textContent);
    expect(cells[4]).toMatch(/40/);
    expect(cells[5]).toMatch(/37/);
    expect(cells[8]).toMatch(/\b3\b/);
  });

  it('combines selected warehouses and limits them by branch', () => {
    const otherWarehouse = { id: 3, companyId: 1, name: 'North Store', branchId: 2 };
    const scopedDb = {
      ...db,
      branches: [...branches, { id: 2, companyId: 1, branchName: 'North Branch' }],
      stockAdjustments: [...db.stockAdjustments, { id: 3, companyId: 1, date: '2026-09-06', warehouseId: 3, itemId: 11, qtyDelta: 7 }],
    };
    render(<InventoryModule db={scopedDb} setDb={noop} currentCompany={COMPANY} warehouses={[...warehouses, otherWarehouse]} />);
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'thisYear' } });
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Head Office' }));
    fireEvent.click(screen.getByRole('button', { name: 'Warehouse' }));
    expect(screen.queryByRole('checkbox', { name: 'North Store' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'North Branch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Warehouse' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Main Store' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'North Store' }));
    expect(screen.getByRole('button', { name: 'Warehouse' })).toHaveTextContent('2 warehouses');
    const row = screen.getByText('MS Angle 50mm').closest('tr');
    expect(row.querySelectorAll('td')[8].textContent).toMatch(/\b10\b/);
  });

  it('shows newly loaded server locations even before local company ids are attached', () => {
    const serverBranches = branches.map(({ companyId: _companyId, ...branch }) => branch);
    const serverWarehouses = warehouses.map(({ companyId: _companyId, ...warehouse }) => warehouse);
    render(<InventoryModule db={{ ...db, branches: serverBranches }} setDb={noop} currentCompany={COMPANY} warehouses={serverWarehouses} />);
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    expect(screen.getByRole('checkbox', { name: 'Head Office' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Warehouse' }));
    expect(screen.getByRole('checkbox', { name: 'Main Store' })).toBeInTheDocument();
  });

  it('puts each transfer label over the column it filters', () => {
    // They were shifted by one: filtering "From" filtered by date, and the
    // Date column filtered by destination.
    const { container } = render(
      <StockTransfersList db={db} setDb={noop} currentCompany={COMPANY} openModal={noop} branches={branches} warehouses={warehouses} mode="warehouse" />
    );
    const heads = [...container.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    // Column names from the Books redesign of the transfer list.
    expect(heads.slice(0, 4)).toEqual(['Transfer No.', 'Transfer Date', 'From Branch / Warehouse', 'To Branch / Warehouse']);
    expect(heads).toContain('Status');
    const row = [...container.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('TRF-1'));
    const cells = [...row.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells[2]).toMatch(/Main Store/);
    expect(cells[3]).toMatch(/Yard/);
    /* Read as this country writes it; the ISO value stays on the element. */
    expect(cells[1]).toMatch(/02\/09\/2026/);

    // And the filter behind the label reaches the same column the label names.
    // Reading the header text alone cannot see the mistake: the labels were in
    // the right order and each one filtered its neighbour's data.
    fireEvent.click(screen.getByRole('button', { name: /Sort and filter From/i }));
    const panel = screen.getAllByLabelText(/Filter From/i).find((el) => el.querySelectorAll('label').length);
    const values = [...panel.querySelectorAll('label')].map((l) => l.textContent.trim());
    expect(values).toContain('Main Store');
    expect(values.some((v) => /2026-09/.test(v))).toBe(false);
  });

  it('counts units in transit, which belong to neither end', () => {
    render(
      <StockTransfersList db={db} setDb={noop} currentCompany={COMPANY} openModal={noop} branches={branches} warehouses={warehouses} mode="warehouse" />
    );
    const summary = screen.getByRole('region', { name: /Summary/i });
    const card = [...summary.children].find((c) => c.textContent.includes('Units in transit'));
    expect(card.textContent).toMatch(/10/);
  });
});

describe('the inventory filter band', () => {
  it('keeps its three controls on one line', () => {
    /*
     * View, Warehouse and Period do the same job and belong at the same
     * height. The Period group wrapped inside itself, so at most widths the
     * word "Period" took its own line and pushed its select a row below the
     * other two — one control visibly lower than its neighbours.
     *
     * jsdom has no layout, so the check is structural: the label and its
     * select share a parent that cannot wrap, and the custom dates are a
     * sibling of that group rather than sitting inside it.
     */
    const { container } = render(<InventoryModule db={db} setDb={noop} currentCompany={COMPANY} warehouses={warehouses} />);
    for (const id of ['inv-view', 'inv-period']) {
      const group = container.querySelector(`#${id}`).parentElement;
      expect(group.className).toContain('flex items-center');
      expect(group.className).not.toContain('flex-wrap');
      expect(group.querySelector('label')).toBeTruthy();
    }
  });

  it('lets the custom dates wrap without taking the Period label with them', () => {
    const { container } = render(<InventoryModule db={db} setDb={noop} currentCompany={COMPANY} warehouses={warehouses} />);
    fireEvent.change(container.querySelector('#inv-period'), { target: { value: 'custom' } });

    const periodGroup = container.querySelector('#inv-period').parentElement;
    expect(periodGroup.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByLabelText(/^From$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^To$/i)).toBeTruthy();
  });
});
