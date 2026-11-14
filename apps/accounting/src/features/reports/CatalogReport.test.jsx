import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CatalogReport from './CatalogReport';

describe('Ledger Summary report', () => {
  it('keeps inventory search, warehouse, period and export in the compact header', () => {
    const onBack = vi.fn();
    const { container } = render(<CatalogReport title="Inventory Register" db={{ warehouses: [{ id: 1, companyId: 1, name: 'Main Store' }] }} currentCompany={{ id: 1, name: 'Neev' }} onBack={onBack} />);
    const header = screen.getByRole('heading', { name: 'Inventory Register' }).closest('header');
    expect(header).toHaveClass('inventory-register-toolbar');
    expect(header).toContainElement(screen.getByRole('textbox', { name: 'Search this report' }));
    expect(header).toContainElement(screen.getByRole('combobox', { name: 'Warehouse' }));
    expect(header).toContainElement(screen.getByRole('button', { name: /Export/i }));
    expect(container.querySelector('.inventory-register-table')).toBeInTheDocument();
    expect(container.querySelector('.inventory-report-table tbody tr')).not.toHaveClass('border-t');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Inventory Reports' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
  it('offers a near-expiry window in the report header', () => {
    render(<CatalogReport title="Near Expiry" db={{}} currentCompany={{ id: 1, name: 'Neev' }} />);
    expect(screen.getByRole('combobox', { name: 'Expiry window' })).toHaveValue('30');
    fireEvent.change(screen.getByRole('combobox', { name: 'Expiry window' }), { target: { value: '60' } });
    expect(screen.getByRole('combobox', { name: 'Expiry window' })).toHaveValue('60');
  });
  it.each(['Ledger Summary', 'Ledger Group Summary'])('provides a Back button for %s', title => {
    const onBack = vi.fn();
    render(<CatalogReport title={title} db={{}} currentCompany={{ id: 1, name: 'Neev' }} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Ledgers' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
  it('uses the Sales-style header and column filters while allowing a column to be resized', () => {
    const db = {
      accountTypes: [{ id: 1, companyId: 1, main: 'Balance Sheet', accountClass: 'Asset' }],
      accountGroups: [{ id: 10, companyId: 1, typeId: 1, name: 'Bank Accounts' }],
      chartOfAccounts: [{ id: 100, companyId: 1, groupId: 10, name: 'Savings Bank', code: '1100', type: 'Asset', openingBalance: 100 }],
    };
    const { container } = render(<CatalogReport title="Ledger Summary" db={db} currentCompany={{ id: 1, name: 'Neev' }} />);
    const header = screen.getByRole('heading', { name: 'Ledger Summary' }).closest('header');
    expect(header).toHaveClass('ui-page-heading');
    expect(header).toContainElement(screen.getByRole('textbox', { name: 'Search this report' }));
    expect(header).toContainElement(screen.getByRole('button', { name: 'Layout' }));
    expect(container.querySelector('.catalog-report-print-area')).not.toHaveTextContent('rows');
    expect(screen.getByRole('button', { name: 'Sort and filter Ledger' }).closest('th')).toHaveTextContent('Ledger');
    fireEvent.click(screen.getByRole('button', { name: 'Sort and filter Group' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Text Filters');
    const table = container.querySelector('.ledger-summary-table');
    expect(table.querySelector('tbody tr')).not.toHaveClass('border-t');
    const before = Number(table.querySelector('col').style.width.replace('px', ''));
    fireEvent.pointerDown(screen.getByRole('separator', { name: 'Resize Code column' }), { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 130 });
    fireEvent.pointerUp(window);
    expect(Number(table.querySelector('col').style.width.replace('px', ''))).toBe(before + 30);
  });

  it('opens a group into its ledgers with a complete-entries export option', () => {
    const db = {
      accountTypes: [{ id: 1, companyId: 1, main: 'Balance Sheet', accountClass: 'Asset' }],
      accountGroups: [{ id: 10, companyId: 1, typeId: 1, name: 'Bank Accounts' }],
      chartOfAccounts: [{ id: 100, companyId: 1, groupId: 10, name: 'Savings Bank', code: '1100', type: 'Asset', openingBalance: 100 }],
    };
    const { container } = render(<CatalogReport title="Ledger Group Summary" db={db} currentCompany={{ id: 1, name: 'Neev' }} />);
    expect(container.querySelector('.ledger-summary-table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sort and filter Group' }).closest('th')).toHaveTextContent('Group');
    expect(container.querySelector('.catalog-report-print-area')).not.toHaveTextContent('rows');
    fireEvent.click(screen.getByRole('button', { name: 'Bank Accounts' }));
    expect(screen.getByRole('heading', { name: 'Bank Accounts' })).toBeInTheDocument();
    expect(container.querySelector('.ledger-summary-table')).toHaveTextContent('Savings Bank');
    fireEvent.click(screen.getByRole('button', { name: /Export/i }));
    expect(screen.getByRole('button', { name: 'Complete entries' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Savings Bank' }));
    expect(screen.getByRole('heading', { name: 'Savings Bank' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sort and filter Voucher No.' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to group ledgers' }));
    expect(screen.getByRole('heading', { name: 'Bank Accounts' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Ledger Group Summary' }));
    expect(screen.getByRole('heading', { name: 'Ledger Group Summary' })).toBeInTheDocument();
  });

  it('opens a ledger statement from Ledger Summary and preserves the selected period', () => {
    const db = {
      accountTypes: [{ id: 1, companyId: 1, main: 'Balance Sheet', accountClass: 'Asset' }],
      accountGroups: [{ id: 10, companyId: 1, typeId: 1, name: 'Bank Accounts' }],
      chartOfAccounts: [{ id: 100, companyId: 1, groupId: 10, name: 'Savings Bank', code: '1100', type: 'Asset', openingBalance: 100 }],
    };
    render(<CatalogReport title="Ledger Summary" db={db} currentCompany={{ id: 1, name: 'Neev' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'This month' }));
    fireEvent.click(screen.getByRole('button', { name: 'All periods' }));
    fireEvent.click(screen.getByRole('button', { name: 'Savings Bank' }));
    expect(screen.getByRole('heading', { name: 'Savings Bank' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All periods' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sort and filter Voucher No.' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Ledger Summary' }));
    expect(screen.getByRole('heading', { name: 'Ledger Summary' })).toBeInTheDocument();
  });

  it.each(['Outstanding Receivables', 'Outstanding Payables'])('uses the compact report header and borderless rows for %s', title => {
    const { container } = render(<CatalogReport title={title} db={{}} currentCompany={{ id: 1, name: 'Neev' }} />);
    const header = screen.getByRole('heading', { name: title }).closest('header');
    expect(header).toHaveClass('ui-page-heading');
    expect(header).toContainElement(screen.getByRole('textbox', { name: 'Search this report' }));
    expect(header).toContainElement(screen.getByRole('button', { name: 'Layout' }));
    expect(screen.getByRole('button', { name: 'Sort and filter Document No.' })).toBeInTheDocument();
    expect(container.querySelector('.catalog-report-print-area')).not.toHaveTextContent('rows');
  });

  it.each([
    ['GST Sales Register', 'Document No.', 'GST'],
    ['TDS Payable Register', 'TDS Section', 'TDS'],
    ['TCS Ledger Summary', 'TCS Ledger', 'TCS'],
  ])('uses the compact statutory layout for %s', (title, column, category) => {
    const onBack = vi.fn();
    const { container } = render(<CatalogReport title={title} db={{}} currentCompany={{ id: 1, name: 'Neev' }} onBack={onBack} />);
    const header = screen.getByRole('heading', { name: title }).closest('header');
    expect(header).toContainElement(screen.getByRole('textbox', { name: 'Search this report' }));
    expect(header).toContainElement(screen.getByRole('button', { name: 'Layout' }));
    expect(header).toContainElement(screen.getByRole('button', { name: /Export/i }));
    expect(header).toContainElement(screen.getByRole('button', { name: 'Print' }));
    expect(screen.getByRole('button', { name: `Sort and filter ${column}` })).toBeInTheDocument();
    expect(container.querySelector('.ledger-summary-table')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Back to ${category} reports` }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
