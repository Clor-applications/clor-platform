import { describe, expect, it } from 'vitest';
import { allocationLedgerOptions } from './allocationLedgerOptions';

describe('receipt and payment categorization ledgers', () => {
  it('shows active chart ledgers for the company while excluding the cash or bank account', () => {
    const accounts = [
      { id: 1, companyId: 7, name: 'Cash', code: 'CASH' },
      { id: 2, companyId: 7, name: 'Office Expense', code: 'EXP' },
      { id: 3, companyId: 7, name: 'Sales', code: 'SALE' },
      { id: 4, companyId: 8, name: 'Other company' },
      { id: 5, companyId: 7, name: 'Retired', isActive: false },
    ];

    expect(allocationLedgerOptions(accounts, 7, 1)).toEqual([accounts[1], accounts[2]]);
  });
});
