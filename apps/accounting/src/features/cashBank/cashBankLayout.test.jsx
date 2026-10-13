import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/utils/bankBookSync', () => ({
  patchBankEntry: vi.fn(async () => ({})),
  removeBankEntry: vi.fn(async () => ({})),
  saveBankEntry: vi.fn(async () => ({})),
}));

import CashBankModule from './CashBankModule';

const COMPANY = { id: 1, name: 'Neev Steels', state: 'Karnataka' };

const db = {
  companies: [COMPANY],
  accountGroups: [
    { id: 21, companyId: 1, name: 'Bank Accounts', parentId: null },
    { id: 22, companyId: 1, name: 'Cash-in-Hand', parentId: null },
  ],
  chartOfAccounts: [
    { id: 501, companyId: 1, name: 'Cash', type: 'Asset', groupId: 22 },
    { id: 502, companyId: 1, name: 'HDFC Current A/c', type: 'Asset', groupId: 21 },
    { id: 610, companyId: 1, name: 'Bank Charges', type: 'Expense' },
  ],
  bankTransactions: [
    { id: 1, companyId: 1, cashBankAccountId: 501, date: '2026-09-02', description: 'Cash sale', direction: 'IN', amount: 5000, ledgerId: null },
    { id: 2, companyId: 1, cashBankAccountId: 501, date: '2026-09-03', description: 'Petrol', direction: 'OUT', amount: 800, ledgerId: 610 },
  ],
  customers: [], vendors: [], invoices: [], bills: [], payments: [], items: [], uoms: [], gstRates: [],
};

const noop = () => {};

/*
 * Cash & Bank, on the same layout as every other list.
 *
 * It carried four header buttons of equal weight — and the only one styled as
 * primary was disabled until an account existed, so a new company saw a row of
 * grey buttons and nothing to press. The account picker and the view select
 * sat in a panel of their own between the header and the rows, which is a
 * second toolbar for controls that belong with the first.
 */
describe('Cash & Bank, laid out like every other list', () => {
  it('names itself, and puts search in the header', () => {
    render(<CashBankModule db={db} setDb={noop} currentCompany={COMPANY} />);
    expect(screen.getByRole('heading', { name: /Cash & Bank/i })).toBeTruthy();
    expect(screen.getByLabelText(/Search transactions/i)).toBeTruthy();
  });

  it('carries five figures across the top', () => {
    render(<CashBankModule db={db} setDb={noop} currentCompany={COMPANY} />);
    expect(screen.getByRole('region', { name: /Summary/i }).children).toHaveLength(5);
  });

  it('offers the view as tabs with counts, not a dropdown', () => {
    render(<CashBankModule db={db} setDb={noop} currentCompany={COMPANY} />);
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent.replace(/\d+/g, '').trim())).toEqual([
      'Uncategorised',
      'Categorised',
      'All',
    ]);
    // The real counts, not zeroes: a strip of zeroes beside a table with rows
    // in it is worse than no counts at all.
    expect(tabs[0].textContent).toMatch(/1/);
    expect(tabs[1].textContent).toMatch(/1/);
    expect(tabs[2].textContent).toMatch(/2/);
  });

  it('keeps the account picker with the controls that govern the page', () => {
    render(<CashBankModule db={db} setDb={noop} currentCompany={COMPANY} />);
    const picker = screen.getByLabelText(/Cash\/bank account/i);
    expect(picker.tagName).toBe('SELECT');
    expect([...picker.options].map((o) => o.textContent)).toContain('HDFC Current A/c');
  });

  it('keeps template, upload and export behind More', () => {
    render(<CashBankModule db={db} setDb={noop} currentCompany={COMPANY} />);
    expect(screen.getByRole('button', { name: /^More$/i })).toBeTruthy();
    // Four equal-weight buttons in the header is what this replaced.
    expect(screen.queryByRole('button', { name: /Download Template/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Upload Statement/i })).toBeNull();
  });

  it('offers the one action that can actually be taken', () => {
    render(<CashBankModule db={db} setDb={noop} currentCompany={COMPANY} />);
    const primary = screen.getByRole('button', { name: /Add Transaction/i });
    expect(primary.className).toMatch(/ui-btn-primary/);
    expect(primary.disabled).toBe(false);
  });

  it('asks for an account first when there is none', () => {
    // Add Transaction cannot do anything without one, so it is not the offer.
    const empty = { ...db, chartOfAccounts: [], bankTransactions: [] };
    render(<CashBankModule db={empty} setDb={noop} currentCompany={COMPANY} />);
    const primary = screen.getByRole('button', { name: /New Account/i });
    expect(primary.className).toMatch(/ui-btn-primary/);
    expect(screen.queryByRole('button', { name: /Add Transaction/i })).toBeNull();
  });

  it('puts the rows in one card, not a card inside a card', () => {
    const { container } = render(<CashBankModule db={db} setDb={noop} currentCompany={COMPANY} />);
    const card = container.querySelector('table.ui-table').closest('.ui-card');
    expect(card).toBeTruthy();
    expect(card.parentElement.closest('.ui-card')).toBeNull();
  });
});
