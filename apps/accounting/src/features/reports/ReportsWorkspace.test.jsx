import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ReportsWorkspace, { expandReportRowsForExport, normalizedReportRows, reportSidebarItems } from './ReportsWorkspace';

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

  it('shows only the retained receipt reports', () => {
    render(<ReportsWorkspace db={{}} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Receipts' }));
    for (const name of ['Receipt Register', 'Customer/Ledger-wise Receipts', 'Advance Receipts']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    for (const name of ['Bank-wise Receipts', 'Cash Receipts', 'Invoice-adjusted Receipts', 'TDS-deducted Receipts']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('shows only the retained payment reports', () => {
    render(<ReportsWorkspace db={{}} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Payments' }));
    for (const name of ['Payment Register', 'Vendor/Ledger-wise Payments', 'Advance Payments']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    for (const name of ['Bank-wise Payments', 'Cash Payments', 'Bill-adjusted Payments', 'TDS Payments']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('groups receivables and payables in Outstanding Registers', () => {
    const { container } = render(<ReportsWorkspace db={{}} currentCompany={company} />);
    expect(screen.getByRole('button', { name: 'Outstanding Registers' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Receivables' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Payables' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Outstanding Registers' }));
    expect(screen.getByRole('button', { name: 'Outstanding Receivables' })).toHaveClass('min-h-9');
    expect(screen.getByRole('button', { name: 'Outstanding Payables' })).toHaveClass('min-h-9');
    expect(container.querySelector('main > .grid')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Customer Outstanding' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Outstanding Receivables' }));
    expect(screen.getByRole('heading', { name: 'Outstanding Receivables' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sort and filter Outstanding (₹)' })).toBeInTheDocument();
  });

  it('shows the Ledger Statement reports in a compact invoice-style page', () => {
    render(<ReportsWorkspace db={{}} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ledger Statement' }));
    expect(screen.getByRole('heading', { name: 'Ledger Statement' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ledger Summary' })).toHaveClass('min-h-9');
    expect(screen.getByRole('button', { name: 'Ledger Group Summary' })).toHaveClass('min-h-9');
    fireEvent.click(screen.getByRole('button', { name: 'Ledger Summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Ledgers' }));
    expect(screen.getByRole('button', { name: 'Ledger Group Summary' })).toBeInTheDocument();
  });

  it('shows the requested business and statutory report navigation only', () => {
    const items = reportSidebarItems();
    const labels = items.map(item => item.label);
    expect(labels).toEqual(expect.arrayContaining(['Business Reports', 'Ledger Statement', 'Outstanding Registers', 'Statutory Reports', 'GST', 'TDS', 'TCS']));
    for (const removed of ['Accounting Reports', 'Journal & Voucher Reports', 'Cash & Bank', 'Cash & Bank Reports', 'Analysis', 'Branch Reports', 'Cost Centre Reports']) {
      expect(labels).not.toContain(removed);
    }
    render(<ReportsWorkspace db={{}} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'TCS' }));
    fireEvent.click(screen.getByRole('button', { name: 'TCS Ledger Summary' }));
    expect(screen.getByRole('button', { name: 'Sort and filter TCS Ledger' })).toBeInTheDocument();
  });

  it.each([['GST', 'GST Sales Register'], ['TDS', 'TDS Payable Register'], ['TCS', 'TCS Ledger Summary']])('shows a compact statutory report list for %s', (category, report) => {
    const { container } = render(<ReportsWorkspace db={{}} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: category }));
    expect(screen.getByRole('heading', { name: category })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: report })).toHaveClass('min-h-9');
    expect(container.querySelector('main > .grid')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Search reports' })).toBeNull();
  });

  it('shows one compact Inventory list under Business Reports', () => {
    const labels = reportSidebarItems().map(item => item.label);
    expect(labels.slice(0, 5)).toEqual(['Business Reports', 'Sales', 'Purchases', 'Inventory', 'Expenses']);
    const { container } = render(<ReportsWorkspace db={{}} currentCompany={company} />);
    expect(screen.queryByRole('button', { name: 'Stock Reports' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Item Reports' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Warehouse Reports' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Inventory' }));
    for (const name of ['Inventory Register', 'Batch-wise Report', 'Reorder Level Report', 'Near Expiry', 'Expired Stock', 'Negative Stock']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-9');
    }
    expect(container.querySelector('main > .grid')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Inventory Register' }));
    expect(screen.getByRole('button', { name: /Layout/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sort and filter Voucher No.' })).toBeInTheDocument();
  });

  it('opens financial statements in their dedicated report view', () => {
    const onNavigate = vi.fn();
    render(<ReportsWorkspace db={{}} currentCompany={company} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Profit & Loss' }));
    expect(screen.getByRole('heading', { name: 'Profit & Loss Account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('shows purchase-specific columns instead of voucher fallback columns', () => {
    render(<ReportsWorkspace db={{ bills: [] }} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Purchases' }));
    fireEvent.click(screen.getByRole('button', { name: 'Purchase Register' }));
    expect(screen.getByRole('heading', { name: 'Purchase Register' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Taxable Amount \(₹\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Voucher Type' })).toBeNull();
    const header = screen.getByRole('heading', { name: 'Purchase Register' }).parentElement.parentElement.parentElement;
    expect(header.querySelector('input[aria-label="Search report"]')).toBeInTheDocument();
    expect(header.querySelector('select[aria-label="Report period"]')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Branch|Warehouse/ })).toBeNull();
  });

  it('shows debit notes rather than bills in Purchase Return Register', () => {
    const db = {
      bills: [{ id: 1, companyId: 1, number: 'BILL-1', date: '2026-09-10', vendorName: 'Metro Supplies', total: 118 }],
      debitNotes: [{ id: 2, companyId: 1, number: 'DN-1', date: '2026-09-11', vendorName: 'Metro Supplies', originalBillNumber: 'BILL-1', subtotal: 20, gstTotal: 3.6, total: 23.6 }],
    };
    render(<ReportsWorkspace db={db} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Purchases' }));
    fireEvent.click(screen.getByRole('button', { name: 'Purchase Return Register' }));
    expect(screen.getByRole('columnheader', { name: /Debit Note No/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Original Bill No/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DN-1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'BILL-1' })).toBeNull();
  });

  it.each([
    ['Vendor-wise Purchase', 'Metro Supplies', 'Vendor Name', 'Bill Count'],
    ['Item-wise Purchase', 'Router', 'Item Name', 'Qty Purchased'],
    ['Category-wise Purchase', 'Electronics', 'Category', 'Items'],
    ['Monthly Purchase Summary', '2026-09', 'Month', 'Bills'],
  ])('summarizes and drills into %s bills', (reportName, groupName, groupHeading, countHeading) => {
    const db = {
      vendors: [{ id: 7, name: 'Metro Supplies', gstin: '29ABCDE1234F1Z5' }],
      items: [{ id: 3, code: 'E-3', name: 'Router', category: 'Electronics' }, { id: 4, code: 'O-4', name: 'Desk', category: 'Office' }],
      bills: [
        { id: 11, companyId: 1, number: 'BILL-11', date: '2026-09-20', vendorId: 7, vendorName: 'Metro Supplies', subtotal: 100, gstTotal: 18, total: 118, items: [{ itemId: 3, quantity: 2, taxableAmount: 100, gstRate: 18 }] },
        { id: 12, companyId: 1, number: 'BILL-12', date: '2026-09-21', vendorId: 7, vendorName: 'Metro Supplies', subtotal: 200, gstTotal: 36, total: 236, items: [{ itemId: 3, quantity: 1, taxableAmount: 200, gstRate: 18 }] },
        { id: 13, companyId: 1, number: 'BILL-13', date: '2026-08-22', vendorId: 8, vendorName: 'Other Vendor', subtotal: 300, gstTotal: 54, total: 354, items: [{ itemId: 4, quantity: 1, taxableAmount: 300, gstRate: 18 }] },
      ],
      debitNotes: [], payments: [], purchaseOrders: [],
    };
    render(<ReportsWorkspace db={db} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Purchases' }));
    fireEvent.click(screen.getByRole('button', { name: reportName }));
    expect(screen.getByRole('columnheader', { name: new RegExp(groupHeading) })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: new RegExp(countHeading) })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Taxable Value/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /GST \(₹\)/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Amount \(₹\)/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: groupName }));
    expect(screen.getByRole('button', { name: 'BILL-11' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'BILL-12' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'BILL-13' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `Back to ${reportName}` }));
    expect(screen.getByRole('heading', { name: reportName })).toBeInTheDocument();
  });

  it('shows expense-specific columns in the compact Expense Register', () => {
    render(<ReportsWorkspace db={{ expenses: [] }} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }));
    expect(screen.queryByRole('button', { name: 'Expense Category-wise' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Branch-wise Expense' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cost Centre-wise Expense' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expense Register' }));
    expect(screen.getByRole('columnheader', { name: /Expense No/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Expense Category/i })).toBeInTheDocument();
    const header = screen.getByRole('heading', { name: 'Expense Register' }).parentElement.parentElement.parentElement;
    expect(header.querySelector('input[aria-label="Search report"]')).toBeInTheDocument();
    expect(header.querySelector('select[aria-label="Report period"]')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Branch|Warehouse/ })).toBeNull();
  });

  it.each([
    ['Expense Ledger-wise', 'Operating Expenses', 'Expense Ledger'],
    ['Vendor-wise Expense', 'Metro Supplies', 'Vendor Name'],
    ['Monthly Expense Analysis', '2026-09', 'Month'],
  ])('summarizes and drills into %s expenses', (reportName, groupName, groupHeading) => {
    const db = {
      vendors: [{ id: 7, name: 'Metro Supplies', gstin: '29ABCDE1234F1Z5' }],
      chartOfAccounts: [{ id: 9, name: 'Operating Expenses' }, { id: 10, name: 'Travel Expenses' }],
      branches: [{ id: 1, name: 'Head Office' }, { id: 2, name: 'North' }],
      costCenters: [{ id: 5, name: 'Operations' }, { id: 6, name: 'Sales' }],
      expenses: [
        { id: 11, companyId: 1, number: 'EXP-11', date: '2026-09-20', vendorId: 7, vendorName: 'Metro Supplies', category: 'Office services', ledgerId: 9, branchId: 1, costCenterId: 5, subtotal: 100, gstTotal: 18, total: 118, tdsAmount: 2, lines: [{ ledgerId: 9, amount: 100, gstRate: 18 }] },
        { id: 12, companyId: 1, number: 'EXP-12', date: '2026-09-21', vendorId: 7, vendorName: 'Metro Supplies', category: 'Office services', ledgerId: 9, branchId: 1, costCenterId: 5, subtotal: 200, gstTotal: 36, total: 236, tdsAmount: 4, lines: [{ ledgerId: 9, amount: 200, gstRate: 18 }] },
        { id: 13, companyId: 1, number: 'EXP-13', date: '2026-08-22', vendorId: 8, vendorName: 'Other Vendor', category: 'Travel', ledgerId: 10, branchId: 2, costCenterId: 6, subtotal: 300, gstTotal: 54, total: 354, tdsAmount: 6, lines: [{ ledgerId: 10, amount: 300, gstRate: 18 }] },
      ],
    };
    render(<ReportsWorkspace db={db} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }));
    fireEvent.click(screen.getByRole('button', { name: reportName }));
    expect(screen.getByRole('columnheader', { name: new RegExp(groupHeading) })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Expense Count/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Taxable Value/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /GST \(₹\)/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: groupName }));
    expect(screen.getByRole('button', { name: 'EXP-11' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EXP-12' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'EXP-13' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `Back to ${reportName}` }));
    expect(screen.getByRole('heading', { name: reportName })).toBeInTheDocument();
  });

  it.each([
    ['Receipts', 'Receipt Register', ['R-1', 'R-2', 'R-3'], ['P-1']],
    ['Payments', 'Payment Register', ['P-1', 'P-2', 'P-3'], ['R-1']],
    ['Receipts', 'Advance Receipts', ['R-2'], ['R-1', 'R-3']],
    ['Payments', 'Advance Payments', ['P-2'], ['P-1', 'P-3']],
  ])('shows the correct transactions in %s / %s', (category, reportName, included, excluded) => {
    const db = {
      chartOfAccounts: [{ id: 1, name: 'Current Bank' }, { id: 2, name: 'Cash' }],
      invoices: [{ id: 11, number: 'INV-11' }, { id: 12, number: 'INV-12' }],
      bills: [{ id: 21, number: 'BILL-21' }, { id: 22, number: 'BILL-22' }],
      payments: [
        { id: 1, companyId: 1, number: 'R-1', date: '2026-09-01', direction: 'IN', voucherType: 'receipt', customerName: 'Acme', mode: 'Bank', cashBankAccountId: 1, amount: 100, allocations: [{ voucherType: 'invoice', voucherId: 11, amount: 100 }] },
        { id: 2, companyId: 1, number: 'R-2', date: '2026-09-02', direction: 'IN', voucherType: 'receipt', customerName: 'Beta', mode: 'Cash', cashBankAccountId: 2, amount: 50, allocations: [] },
        { id: 3, companyId: 1, number: 'R-3', date: '2026-09-03', direction: 'IN', voucherType: 'receipt', customerName: 'Acme', mode: 'Bank', cashBankAccountId: 1, amount: 200, tdsAmount: 20, allocations: [{ voucherType: 'invoice', voucherId: 12, amount: 200 }] },
        { id: 4, companyId: 1, number: 'P-1', date: '2026-09-04', direction: 'OUT', voucherType: 'payment', vendorName: 'Metro', mode: 'Bank', cashBankAccountId: 1, amount: 110, allocations: [{ voucherType: 'bill', voucherId: 21, amount: 110 }] },
        { id: 5, companyId: 1, number: 'P-2', date: '2026-09-05', direction: 'OUT', voucherType: 'payment', vendorName: 'Other', mode: 'Cash', cashBankAccountId: 2, amount: 60, allocations: [] },
        { id: 6, companyId: 1, number: 'P-3', date: '2026-09-06', direction: 'OUT', voucherType: 'payment', vendorName: 'Metro', mode: 'Bank', cashBankAccountId: 1, amount: 220, tdsAmount: 22, allocations: [{ voucherType: 'bill', voucherId: 22, amount: 220 }] },
      ],
    };
    render(<ReportsWorkspace db={db} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: category }));
    fireEvent.click(screen.getByRole('button', { name: reportName }));
    expect(screen.getByRole('heading', { name: reportName })).toBeInTheDocument();
    for (const number of included) expect(screen.getByRole('button', { name: number })).toBeInTheDocument();
    for (const number of excluded) expect(screen.queryByRole('button', { name: number })).toBeNull();
  });

  it.each([
    ['Receipts', 'Customer/Ledger-wise Receipts', 'Acme', ['R-1', 'R-3'], 'R-2'],
    ['Payments', 'Vendor/Ledger-wise Payments', 'Metro', ['P-1', 'P-3'], 'P-2'],
  ])('drills into %s / %s', (category, reportName, groupName, included, excluded) => {
    const payments = [
      { id: 1, companyId: 1, number: 'R-1', date: '2026-09-01', direction: 'IN', voucherType: 'receipt', customerName: 'Acme', mode: 'Bank', cashBankAccountId: 1, amount: 100 },
      { id: 2, companyId: 1, number: 'R-2', date: '2026-09-02', direction: 'IN', voucherType: 'receipt', customerName: 'Beta', mode: 'Cash', cashBankAccountId: 2, amount: 50 },
      { id: 3, companyId: 1, number: 'R-3', date: '2026-09-03', direction: 'IN', voucherType: 'receipt', customerName: 'Acme', mode: 'Bank', cashBankAccountId: 1, amount: 200 },
      { id: 4, companyId: 1, number: 'P-1', date: '2026-09-04', direction: 'OUT', voucherType: 'payment', vendorName: 'Metro', mode: 'Bank', cashBankAccountId: 1, amount: 110 },
      { id: 5, companyId: 1, number: 'P-2', date: '2026-09-05', direction: 'OUT', voucherType: 'payment', vendorName: 'Other', mode: 'Cash', cashBankAccountId: 2, amount: 60 },
      { id: 6, companyId: 1, number: 'P-3', date: '2026-09-06', direction: 'OUT', voucherType: 'payment', vendorName: 'Metro', mode: 'Bank', cashBankAccountId: 1, amount: 220 },
    ];
    render(<ReportsWorkspace db={{ payments, chartOfAccounts: [{ id: 1, name: 'Current Bank' }, { id: 2, name: 'Cash' }] }} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: category }));
    fireEvent.click(screen.getByRole('button', { name: reportName }));
    expect(screen.getByRole('columnheader', { name: /Transactions/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: groupName }));
    for (const number of included) expect(screen.getByRole('button', { name: number })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: excluded })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `Back to ${reportName}` }));
    expect(screen.getByRole('heading', { name: reportName })).toBeInTheDocument();
  });

  it('keeps Sales Report search and period in its compact header without separate location filters', () => {
    render(<ReportsWorkspace db={{ invoices: [] }} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sales Register' }));
    const header = screen.getByRole('heading', { name: 'Sales Report' }).parentElement.parentElement.parentElement;
    expect(header.querySelector('input[aria-label="Search report"]')).toBeInTheDocument();
    expect(header.querySelector('select[aria-label="Report period"]')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Branch|Warehouse/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Layout/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
  });

  it('uses the same compact layout for Sales Return Register', () => {
    render(<ReportsWorkspace db={{ creditNotes: [] }} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sales Return Register' }));
    const header = screen.getByRole('heading', { name: 'Sales Return Register' }).parentElement.parentElement.parentElement;
    expect(header.querySelector('input[aria-label="Search report"]')).toBeInTheDocument();
    expect(header.querySelector('select[aria-label="Report period"]')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Branch|Warehouse/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Layout/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
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
      invoices: [
        { id: 11, companyId: 1, number: 'INV-11', date: '2026-09-20', customerId: 7, customerName: 'Acme Traders', subtotal: 1000, gstTotal: 180, total: 1180, paidAmount: 500, items: [{ itemId: 3, quantity: 2, rate: 500, taxableAmount: 1000, gstRate: 18 }] },
        { id: 12, companyId: 1, number: 'INV-12', date: '2026-09-21', customerId: 7, customerName: 'Acme Traders', subtotal: 200, gstTotal: 36, total: 236, items: [] },
        { id: 13, companyId: 1, number: 'INV-13', date: '2026-09-22', customerId: 8, customerName: 'Other Customer', subtotal: 300, gstTotal: 54, total: 354, items: [] },
      ],
      items: [{ id: 3, code: '20003', name: 'Steel Rod', hsn: '7214' }], payments: [], creditNotes: [], salesOrders: [],
    };
    render(<ReportsWorkspace db={db} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Customer-wise Sales' }));

    expect(screen.getByRole('columnheader', { name: /Customer Name/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /GSTIN/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Invoice Count/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Taxable Value/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /GST \(₹\)/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Amount \(₹\)/i })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Customer Code/i })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /Invoice No/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Acme Traders' }));
    expect(screen.getByRole('heading', { name: /Acme Traders — Sales Report/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Invoice No/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'INV-11' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'INV-12' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'INV-13' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Customer-wise Sales' }));
    expect(screen.getByRole('heading', { name: 'Customer-wise Sales' })).toBeInTheDocument();
  });

  it('uses item-focused columns for item-wise sales', () => {
    const db = {
      customers: [], payments: [], creditNotes: [], salesOrders: [],
      items: [{ id: 3, code: '20003', name: 'Steel Rod', hsn: '7214' }, { id: 4, code: '20004', name: 'Copper Wire', hsn: '7408' }],
      invoices: [
        { id: 11, companyId: 1, number: 'INV-11', date: '2026-09-20', customerId: 7, customerName: 'Acme Traders', subtotal: 1000, gstTotal: 180, total: 1180, items: [{ itemId: 3, quantity: 2, rate: 500, taxableAmount: 1000, gstRate: 18 }] },
        { id: 12, companyId: 1, number: 'INV-12', date: '2026-09-21', customerId: 7, customerName: 'Acme Traders', subtotal: 500, gstTotal: 90, total: 590, items: [{ itemId: 3, quantity: 1, rate: 500, taxableAmount: 500, gstRate: 18 }] },
        { id: 13, companyId: 1, number: 'INV-13', date: '2026-09-22', customerId: 7, customerName: 'Acme Traders', subtotal: 200, gstTotal: 36, total: 236, items: [{ itemId: 4, quantity: 1, rate: 200, taxableAmount: 200, gstRate: 18 }] },
      ],
    };
    render(<ReportsWorkspace db={db} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: 'Item-wise Sales' }));

    expect(screen.getByRole('columnheader', { name: /Item Code/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Item Name/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Qty Sold/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Taxable Value/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /GST \(₹\)/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Amount \(₹\)/i })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Average Rate/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Steel Rod' }));
    expect(screen.getByRole('heading', { name: /Steel Rod — Sales Report/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'INV-11' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'INV-12' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'INV-13' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Item-wise Sales' }));
    expect(screen.getByRole('heading', { name: 'Item-wise Sales' })).toBeInTheDocument();
  });

  it.each([
    ['Category-wise Sales', 'Electronics', 'Category', 'Items'],
    ['Salesperson-wise Sales', 'Anil', 'Salesperson', 'Customers'],
    ['Monthly Sales Summary', '2026-09', 'Month', 'Invoices'],
  ])('summarizes and drills into %s invoices', (reportName, groupName, groupHeading, countHeading) => {
    const db = {
      customers: [], payments: [], creditNotes: [], salesOrders: [],
      items: [{ id: 3, code: 'E-3', name: 'Router', category: 'Electronics' }, { id: 4, code: 'O-4', name: 'Desk', category: 'Office' }],
      invoices: [
        { id: 11, companyId: 1, number: 'INV-11', date: '2026-09-20', customerName: 'Acme', salespersonName: 'Anil', subtotal: 100, gstTotal: 18, total: 118, items: [{ itemId: 3, quantity: 2, taxableAmount: 100, gstRate: 18 }] },
        { id: 12, companyId: 1, number: 'INV-12', date: '2026-09-21', customerName: 'Beta', salespersonName: 'Anil', subtotal: 200, gstTotal: 36, total: 236, items: [{ itemId: 3, quantity: 1, taxableAmount: 200, gstRate: 18 }] },
        { id: 13, companyId: 1, number: 'INV-13', date: '2026-08-22', customerName: 'Gamma', salespersonName: 'Meera', subtotal: 300, gstTotal: 54, total: 354, items: [{ itemId: 4, quantity: 1, taxableAmount: 300, gstRate: 18 }] },
      ],
    };
    render(<ReportsWorkspace db={db} currentCompany={company} />);
    fireEvent.click(screen.getByRole('button', { name: reportName }));
    expect(screen.getByRole('columnheader', { name: new RegExp(groupHeading) })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: new RegExp(countHeading) })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Taxable Value/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /GST \(₹\)/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Amount \(₹\)/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: groupName }));
    expect(screen.getByRole('button', { name: 'INV-11' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'INV-12' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'INV-13' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `Back to ${reportName}` }));
    expect(screen.getByRole('heading', { name: reportName })).toBeInTheDocument();
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
