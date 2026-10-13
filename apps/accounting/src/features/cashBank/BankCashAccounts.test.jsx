import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => true }) }));

import BankCashAccounts, { cashBankAccounts } from './BankCashAccounts';

/**
 * Where the money is.
 *
 * The module had a transaction list and a reconciliation screen and no screen
 * for the accounts themselves — so "how much is in the HDFC current account"
 * had no answer short of opening its ledger. The answer had to come from the
 * ledger anyway: a balance kept here in its own right is a second set of books
 * waiting to disagree with the first.
 */

const COMPANY = { id: 1, name: 'Neev Steels' };

const db = {
  companies: [COMPANY],
  accountGroups: [
    { id: 1, companyId: 1, name: 'Bank Accounts', parentGroupId: null },
    { id: 2, companyId: 1, name: 'Cash-in-Hand', parentGroupId: null },
    { id: 3, companyId: 1, name: 'Current Accounts', parentGroupId: 1 },
    { id: 4, companyId: 1, name: 'Sundry Debtors', parentGroupId: null },
  ],
  accountTypes: [{ id: 1, companyId: 1, name: 'Asset' }],
  chartOfAccounts: [
    {
      id: 11, companyId: 1, name: 'HDFC Bank - Current A/c', groupId: 3, openingBalance: 845230, openingBalanceType: 'Dr',
      bankDetails: { bankName: 'HDFC Bank', accountNumber: '5020 0012 3456', branch: 'Bengaluru', accountType: 'Current Account' },
    },
    { id: 12, companyId: 1, name: 'Petty Cash', groupId: 2, openingBalance: 7850, openingBalanceType: 'Dr' },
    { id: 13, companyId: 1, name: 'Old Union Bank', groupId: 1, openingBalance: 0, isActive: false },
    {
      id: 15, companyId: 1, name: 'SBI Cash Credit', groupId: 1, openingBalance: 125000, openingBalanceType: 'Cr',
      bankDetails: { bankName: 'State Bank of India', accountType: 'Cash Credit' },
    },
    /* Not a place money sits — it must not appear here at all. */
    { id: 14, companyId: 1, name: 'ABC Traders', groupId: 4, openingBalance: 50000 },
  ],
  invoices: [], bills: [], payments: [], receipts: [], journalEntries: [], expenses: [],
};

describe('the accounts this module is about', () => {
  it('is the bank and cash ledgers, and nothing else', () => {
    expect(cashBankAccounts(db, 1).map((a) => a.name)).toEqual([
      'HDFC Bank - Current A/c',
      'Old Union Bank',
      'Petty Cash',
      'SBI Cash Credit',
    ]);
  });

  /* Which is which comes from the chart, not a flag typed twice. */
  it('reads bank or cash from the group, however deeply nested', () => {
    const byName = new Map(cashBankAccounts(db, 1).map((a) => [a.name, a]));
    expect(byName.get('HDFC Bank - Current A/c').type).toBe('Bank');
    expect(byName.get('Petty Cash').type).toBe('Cash');
    expect(byName.get('SBI Cash Credit').type).toBe('OD / Cash Credit');
  });

  it('takes the balance from the ledger rather than keeping its own', () => {
    const hdfc = cashBankAccounts(db, 1).find((a) => a.id === 11);
    expect(hdfc.balance).toBe(845230);
  });
});

describe('the screen', () => {
  const view = (props = {}) => render(<BankCashAccounts db={db} currentCompany={COMPANY} {...props} />);

  it('carries a row menu: open, edit, retire', async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    const edited = vi.fn();
    view({ onOpenAccount: opened, onEditAccount: edited, setDb: () => {} });

    await user.click(screen.getByRole('button', { name: 'Actions for HDFC Bank - Current A/c' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual([
      'Open ledger',
      'Edit account',
      'Mark inactive',
    ]);

    await user.click(within(menu).getByRole('menuitem', { name: 'Edit account' }));
    expect(edited).toHaveBeenCalledWith(11);
  });

  /* The flag lives on the chart row — the row IS a ledger — so every screen
     that reads the chart agrees about what is retired. */
  it('retires an account by flagging its ledger, nothing else', async () => {
    const user = userEvent.setup();
    let next = null;
    view({ setDb: (fn) => { next = typeof fn === 'function' ? fn(db) : fn; } });

    await user.click(screen.getByRole('button', { name: 'Actions for Petty Cash' }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark inactive' }));

    const row = next.chartOfAccounts.find((a) => a.id === 12);
    expect(row.isActive).toBe(false);
    expect(next.chartOfAccounts.filter((a) => a.id !== 12)).toEqual(
      db.chartOfAccounts.filter((a) => a.id !== 12)
    );
  });

  it('totals bank and cash separately, and counts what is live', () => {
    view();
    /* One card each, and the closed account counts in neither total. */
    const bankCard = screen.getByText('Bank balance').closest('div').parentElement;
    expect(within(bankCard).getByText(/9,70,230\.00/)).toBeInTheDocument();
    const cashCard = screen.getByText('Cash balance').closest('div').parentElement;
    expect(within(cashCard).getByText(/7,850\.00/)).toBeInTheDocument();
    const totalCard = screen.getByText('Accounts').closest('div').parentElement;
    const summaryRegion = screen.getByRole('region', { name: 'Summary' });
    const odCard = within(summaryRegion).getByText('OD / Cash Credit').closest('div').parentElement;
    expect(within(odCard).getByText(/1,25,000\.00/)).toBeInTheDocument();
    expect(within(totalCard).getByText('4')).toBeInTheDocument();
    const activeCard = screen.getByText('Active accounts').closest('div').parentElement;
    expect(within(activeCard).getByText('3')).toBeInTheDocument();
  });

  it('keeps a closed account out of the live list and under Inactive', async () => {
    const user = userEvent.setup();
    view();
    expect(screen.queryByText('Old Union Bank')).toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Accounts' }), 'inactive');
    expect(screen.getByText('Old Union Bank')).toBeInTheDocument();
    expect(screen.queryByText('Petty Cash')).toBeNull();
  });

  it('filters bank, cash and OD / Cash Credit from the header dropdown', async () => {
    const user = userEvent.setup();
    view();
    const filter = screen.getByRole('combobox', { name: 'Accounts' });
    await user.selectOptions(filter, 'cash');
    expect(screen.getByText('Petty Cash')).toBeInTheDocument();
    expect(screen.queryByText('HDFC Bank - Current A/c')).toBeNull();

    await user.selectOptions(filter, 'odcc');
    expect(screen.getByText('SBI Cash Credit')).toBeInTheDocument();
    expect(screen.queryByText('Petty Cash')).toBeNull();
  });

  it('shows the bank details the ledger already holds', () => {
    view();
    const row = screen.getByText('HDFC Bank - Current A/c').closest('tr');
    expect(within(row).getByText('HDFC Bank')).toBeInTheDocument();
    expect(within(row).getByText('5020 0012 3456')).toBeInTheDocument();
    expect(within(row).getByText('Bengaluru')).toBeInTheDocument();
  });

  it('opens the ledger behind an account', async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    view({ onOpenAccount: opened });
    await user.click(screen.getByRole('button', { name: 'HDFC Bank - Current A/c' }));
    expect(opened).toHaveBeenCalledWith(11);
  });
});
