import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ReportsWorkspace, { expandReportRowsForExport, normalizedReportRows } from './ReportsWorkspace';

const company = { id: 1, name: 'Neev' };

describe('ReportsWorkspace', () => {
  it('can return from the dedicated reports workspace to the application', () => {
    const onExit = vi.fn();
    render(<ReportsWorkspace db={{}} currentCompany={company} onExit={onExit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to application' }));

    expect(onExit).toHaveBeenCalledOnce();
  });

  it('opens with the category sidebar and the streamlined sales report list', () => {
    render(<ReportsWorkspace db={{ invoices: [] }} currentCompany={company} />);

    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Business Reports' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sales' })).toBeInTheDocument();
    for (const name of ['Sales Register', 'Sales Return Register', 'Customer-wise Sales', 'Item-wise Sales', 'Category-wise Sales', 'Salesperson-wise Sales', 'Monthly Sales Summary']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Sales Invoice Register' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'GST-wise Sales' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'HSN/SAC-wise Sales' })).toBeNull();
  });

  it('changes the report list when a sub-sidebar category is selected', () => {
    render(<ReportsWorkspace db={{}} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Purchases' }));

    expect(screen.getByRole('heading', { name: 'Purchases' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Purchase Register' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Purchase Return Register' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vendor-wise Purchase' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Item-wise Purchase' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Category-wise Purchase' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Monthly Purchase Summary' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Purchase Bill Register' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'GST-wise Purchase' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sales Register' })).toBeNull();
  });

  it('opens every report on the shared full-page report screen', () => {
    const onNavigate = vi.fn();
    render(<ReportsWorkspace db={{}} currentCompany={company} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Profit & Loss' }));
    expect(screen.getByRole('heading', { name: 'Profit & Loss' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Layout/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('hides reports for disabled branch, warehouse and cost-centre features', () => {
    render(<ReportsWorkspace db={{}} currentCompany={company} isEnabled={() => false} />);
    expect(screen.queryByRole('button', { name: 'Branch Reports' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Warehouse Reports' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cost Centre Reports' })).toBeNull();
  });

  it('offers linked sales, customer, payment, credit-note, GST and TDS fields in layout customization', () => {
    render(<ReportsWorkspace db={{ invoices: [], customers: [], payments: [], creditNotes: [], salesOrders: [] }} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sales Register' }));
    fireEvent.click(screen.getByRole('button', { name: /Layout/i }));
    fireEvent.click(screen.getByRole('button', { name: /Create new layout/i }));

    for (const label of ['Customer GSTIN', 'Sales Order No.', 'Paid Amount (₹)', 'Credit Note No.', 'CGST (₹)', 'TDS Amount (₹)']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('restores legacy saved Sales Register layouts on either Sales Report entry', () => {
    const legacyKey = 'report-saved-layouts:v2:Sales Register';
    const canonicalKey = 'report-saved-layouts:v3:group:sales';
    localStorage.removeItem(canonicalKey);
    localStorage.setItem(legacyKey, JSON.stringify([{ id: 'saved-sales', name: 'My Sales Export', columns: ['number', 'party', 'itemCodes'] }]));

    render(<ReportsWorkspace db={{ invoices: [] }} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sales Register' }));
    fireEvent.click(screen.getByRole('button', { name: /Layout/i }));

    expect(screen.getByText('My Sales Export')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(canonicalKey))).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'saved-sales' })]));
    localStorage.removeItem(legacyKey);
    localStorage.removeItem(canonicalKey);
  });

  it('shares compatible saved layouts across reports in the same category', () => {
    const sharedKey = 'report-saved-layouts:v3:group:sales';
    localStorage.setItem(sharedKey, JSON.stringify([{
      id: 'sales-common',
      name: 'Sales Common Layout',
      columns: ['party', 'customerCode', 'taxable', 'gst', 'amount', 'number'],
    }]));

    const first = render(<ReportsWorkspace db={{ invoices: [] }} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Customer-wise Sales' }));
    fireEvent.click(screen.getByRole('button', { name: /Layout/i }));
    expect(screen.getByText('Sales Common Layout')).toBeInTheDocument();
    expect(screen.getByText(/5 compatible columns/i)).toBeInTheDocument();
    first.unmount();

    render(<ReportsWorkspace db={{ invoices: [] }} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Item-wise Sales' }));
    fireEvent.click(screen.getByRole('button', { name: /Layout/i }));
    expect(screen.getByText('Sales Common Layout')).toBeInTheDocument();
    expect(screen.getByText(/3 compatible columns/i)).toBeInTheDocument();
    localStorage.removeItem(sharedKey);
  });

  it('changes the default columns and aggregates data for customer-wise sales', () => {
    const db = {
      customers: [{ id: 7, companyId: 1, name: 'Acme Traders', code: '200007', gstin: '29ABCDE1234F1Z5' }],
      invoices: [{ id: 11, companyId: 1, number: 'INV-11', date: '2026-09-20', customerId: 7, customerName: 'Acme Traders', subtotal: 1000, gstTotal: 180, total: 1180, paidAmount: 500, items: [{ itemId: 3, quantity: 2, rate: 500, taxableAmount: 1000, gstRate: 18 }] }],
      items: [{ id: 3, code: '20003', name: 'Steel Rod', hsn: '7214' }], payments: [], creditNotes: [], salesOrders: [],
    };
    render(<ReportsWorkspace db={db} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Customer-wise Sales' }));

    expect(screen.getByRole('columnheader', { name: /Customer Code/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Invoice Count/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Balance Amount/i })).toBeInTheDocument();
    expect(screen.getByText('Acme Traders')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Invoice No/i })).toBeNull();
  });

  it('uses item-focused columns for item-wise sales', () => {
    const db = {
      customers: [], payments: [], creditNotes: [], salesOrders: [],
      items: [{ id: 3, code: '20003', name: 'Steel Rod', hsn: '7214' }],
      invoices: [{ id: 11, companyId: 1, number: 'INV-11', date: '2026-09-20', customerId: 7, customerName: 'Acme Traders', subtotal: 1000, gstTotal: 180, total: 1180, items: [{ itemId: 3, quantity: 2, rate: 500, taxableAmount: 1000, gstRate: 18 }] }],
    };
    render(<ReportsWorkspace db={db} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Item-wise Sales' }));

    expect(screen.getByRole('columnheader', { name: /Item Code/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Total Quantity/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Average Rate/i })).toBeInTheDocument();
    expect(screen.getByText('Steel Rod')).toBeInTheDocument();
  });

  it('exports every document item on its own row without changing the screen row', () => {
    const displayRow = {
      id: 11,
      number: 'INV-11',
      party: 'Acme Traders',
      taxType: 'CGST_SGST',
      raw: {
        items: [
          { itemId: 3, quantity: 2, rate: 500, taxableAmount: 1000, gstRate: 18 },
          { itemId: 4, quantity: 1, rate: 250, taxableAmount: 250, gstRate: 12 },
        ],
      },
    };
    const db = { items: [{ id: 3, code: '20003', name: 'Steel Rod' }, { id: 4, code: '20004', name: 'Steel Sheet' }] };

    const result = expandReportRowsForExport([displayRow], db);

    expect(result.hasDetails).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.itemName)).toEqual(['Steel Rod', 'Steel Sheet']);
    expect(result.rows.map((row) => row.itemNames)).toEqual(['Steel Rod', 'Steel Sheet']);
    expect(result.rows.map((row) => row.itemCodes)).toEqual(['20003', '20004']);
    expect(result.rows.map((row) => row.itemDescriptions)).toEqual(['', '']);
    expect(result.rows.map((row) => row.quantity)).toEqual([2, 1]);
    expect(result.rows.map((row) => row.totalQuantity)).toEqual([2, 1]);
    expect(result.rows.map((row) => row.itemCount)).toEqual([1, 1]);
    expect(result.rows.map((row) => row.number)).toEqual(['INV-11', 'INV-11']);
    expect(displayRow.raw.items).toHaveLength(2);
  });

  it('exports resolved branch and warehouse names and uses company defaults when document ids are absent', () => {
    const db = {
      invoices: [
        { id: 1, companyId: 1, number: 'INV-1', branchId: 'b2', warehouseId: 'w2', total: 100 },
        { id: 2, companyId: 1, number: 'INV-2', total: 200 },
      ],
      branches: [{ id: 'b1', name: 'Head Office' }, { id: 'b2', name: 'Mysuru Branch' }],
      warehouses: [{ id: 'w1', name: 'Main Warehouse' }, { id: 'w2', name: 'Mysuru Warehouse' }],
      customers: [], items: [], payments: [], creditNotes: [], salesOrders: [],
    };

    const rows = normalizedReportRows(db, { source: 'sales' }, 'Sales Register', {
      companyId: 1,
      defaultBranchId: 'b1',
      defaultWarehouseId: 'w1',
    });

    expect(rows.find((row) => row.number === 'INV-1')).toMatchObject({ branch: 'Mysuru Branch', warehouse: 'Mysuru Warehouse' });
    expect(rows.find((row) => row.number === 'INV-2')).toMatchObject({ branch: 'Head Office', branchId: 'b1', warehouse: 'Main Warehouse', warehouseId: 'w1' });

    const lockedDefaultRows = normalizedReportRows(db, { source: 'sales' }, 'Sales Register', {
      companyId: 1,
      branch: 'b1',
      warehouse: 'w1',
      defaultBranchId: 'b1',
      defaultWarehouseId: 'w1',
    });
    expect(lockedDefaultRows.map((row) => row.number)).toContain('INV-2');
  });
});
