import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BalanceSheetReport from './BalanceSheetReport';

describe('BalanceSheetReport comparisons', () => {
  it('shows liabilities before assets with separate totals and equity beneath liabilities', () => {
    const db = {
      accountTypes: [
        { id: 1, companyId: 1, main: 'Balance Sheet', accountClass: 'Asset' },
        { id: 2, companyId: 1, main: 'Balance Sheet', accountClass: 'Liability' },
      ],
      accountGroups: [
        { id: 10, companyId: 1, typeId: 1, name: 'Cash & Bank' },
        { id: 20, companyId: 1, typeId: 2, name: 'Current Liabilities' },
      ],
      chartOfAccounts: [
        { id: 100, companyId: 1, groupId: 10, name: 'Cash', type: 'Asset', openingBalance: 1000 },
        { id: 200, companyId: 1, groupId: 20, name: 'Loan', type: 'Liability', openingBalance: 400 },
      ],
      items: [], customers: [], vendors: [], invoices: [], bills: [], expenses: [], payments: [], receipts: [], journalEntries: [], bankTransactions: [], creditNotes: [], debitNotes: [],
    };
    const { container } = render(<BalanceSheetReport db={db} currentCompany={{ id: 1, name: 'Neev' }} />);
    const rows = [...container.querySelectorAll('.pnl-report-table tbody tr')];
    const label = row => row.querySelector('td')?.textContent?.trim();
    const labels = rows.map(label);

    expect(labels.indexOf('Liabilities')).toBeLessThan(labels.indexOf('Assets'));
    expect(labels.indexOf('Equity')).toBeLessThan(labels.indexOf('Assets'));
    expect(labels.indexOf('Total Liabilities')).toBeLessThan(labels.indexOf('Assets'));
    expect(labels.indexOf('Total Liabilities & Equity')).toBeLessThan(labels.indexOf('Assets'));
    expect(labels.indexOf('Total Assets')).toBeGreaterThan(labels.indexOf('Assets'));
    expect(rows.find(row => label(row) === 'Total Liabilities').querySelectorAll('td')[1]).toHaveTextContent('400');
    expect(rows.find(row => label(row) === 'Total Assets').querySelectorAll('td')[1]).toHaveTextContent('1,000');
    expect(rows.find(row => label(row) === 'Liabilities').querySelectorAll('td')[1]).toHaveTextContent('');
    expect(rows.find(row => label(row) === 'Assets').querySelectorAll('td')[1]).toHaveTextContent('');
    expect(rows.find(row => label(row) === 'Assets')).toHaveClass('balance-sheet-section');
    expect(rows.find(row => label(row) === 'Assets').previousElementSibling).toHaveClass('balance-sheet-gap');
  });

  it('uses the compact header and adds dated amount columns for three previous periods', () => {
    const { container } = render(<BalanceSheetReport db={{}} currentCompany={{ id: 1, name: 'Neev' }} />);
    const header = screen.getByRole('heading', { name: 'Balance Sheet' }).parentElement;
    expect(header).toContainElement(screen.getByRole('button', { name: 'Current Period' }));
    expect(header).toContainElement(screen.getByRole('button', { name: 'Compare with' }));

    fireEvent.click(screen.getByRole('button', { name: 'Compare with' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Number of comparison periods' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('button', { name: 'Compare with' })).toHaveTextContent('3 periods');
    expect(screen.getAllByRole('columnheader', { name: 'Amount (₹)' })).toHaveLength(4);
    expect(screen.queryByRole('columnheader', { name: 'Variance' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '% of Total' })).toBeNull();
    expect(container.querySelectorAll('.pnl-report-table thead .pnl-period-heading')).toHaveLength(4);
    expect(container.querySelector('.pnl-report-table tbody')).not.toHaveTextContent('₹');
  });
  it('expands chart of accounts groups into nested groups and their ledgers', () => {
    const db = {
      accountTypes: [{ id: 1, companyId: 1, main: 'Balance Sheet', accountClass: 'Asset' }],
      accountGroups: [
        { id: 10, companyId: 1, typeId: 1, name: 'Current Assets' },
        { id: 11, companyId: 1, typeId: 1, parentGroupId: 10, name: 'Bank Accounts' },
        { id: 12, companyId: 1, typeId: 1, parentGroupId: 10, name: 'New Group' },
      ],
      chartOfAccounts: [{ id: 100, companyId: 1, groupId: 11, name: 'Savings Bank', type: 'Asset', openingBalance: 200 }],
      items: [], customers: [], vendors: [], invoices: [], bills: [], expenses: [], payments: [], receipts: [], journalEntries: [], bankTransactions: [], creditNotes: [], debitNotes: [],
    };
    render(<BalanceSheetReport db={db} currentCompany={{ id: 1, name: 'Neev' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Current Assets' }));
    expect(screen.getByRole('button', { name: 'Bank Accounts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Group' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bank Accounts' }));
    expect(screen.getByRole('button', { name: 'Savings Bank' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Current Assets' }).closest('tr')).toHaveTextContent('200');
  });
});
