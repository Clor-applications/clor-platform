import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import InventoryRegisterReport from './InventoryRegisterReport';

const today = new Date();
const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-05`;
const company = { id: 91, name: 'Neev' };
const db = {
  items: [{ id: 1, companyId: 91, type: 'Goods', name: 'Router', code: 'R-1', purchasePrice: 100 }],
  branches: [{ id: 3, companyId: 91, name: 'Head Office' }],
  warehouses: [{ id: 4, companyId: 91, branchId: 3, name: 'Main Store' }],
  bills: [{ id: 11, companyId: 91, number: 'B-11', date, status: 'Posted', warehouseId: 4, items: [{ itemId: 1, quantity: 2, rate: 80 }] }],
  invoices: [{ id: 12, companyId: 91, number: 'I-12', date, status: 'Posted', warehouseId: 4, items: [{ itemId: 1, quantity: 1, rate: 150 }] }],
};

describe('Inventory Register report', () => {
  beforeEach(() => { localStorage.removeItem('inventory-register-columns:91'); localStorage.removeItem('inventory-register-saved-layouts:91'); });

  it('keeps period and actions in the top bar and search and filters in the table header', () => {
    render(<InventoryRegisterReport db={db} currentCompany={company} />);
    const header = screen.getByRole('heading', { name: 'Inventory Register' }).closest('header');
    expect(header).toContainElement(screen.getByRole('combobox', { name: 'Report period' }));
    expect(header).toContainElement(screen.getByRole('button', { name: /Layout/i }));
    expect(header).not.toContainElement(screen.getByRole('button', { name: 'Sort and filter Voucher No.' }));
    expect(header.querySelector('select[aria-label="Warehouse"]')).toBeNull();
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Date', 'Voucher No.', 'Movement Type', 'Branch', 'Warehouse', 'Item Code', 'Item Name', 'Quantity', 'Amount']);
    fireEvent.click(screen.getByRole('button', { name: 'Sort and filter Voucher No.' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Text filters');
    expect(screen.getByPlaceholderText('Search values')).toBeInTheDocument();
    expect(screen.getByText('(Select All)')).toBeInTheDocument();
  });

  it('customizes and saves visible columns', () => {
    const { unmount } = render(<InventoryRegisterReport db={db} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: /Layout/i }));
    fireEvent.click(screen.getByRole('button', { name: /Create new layout/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Amount' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Qty In' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Qty In' })).toBeInTheDocument();
    unmount();
    render(<InventoryRegisterReport db={db} currentCompany={company} />);
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Qty In' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Layout/i }));
    expect(screen.getByRole('button', { name: /^New layout/ })).toBeInTheDocument();
  });
});
