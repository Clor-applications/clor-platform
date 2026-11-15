import { describe, expect, it } from 'vitest';
import { buildBalanceSheet } from './balanceSheetModel';

describe('Balance Sheet model', () => {
  it('groups balance sheet ledgers and calculates totals as at each date', () => {
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
    const result = buildBalanceSheet(db, 1, { start: '2026-10-01', end: '2026-10-31' }, { start: '2026-09-01', end: '2026-09-30' });
    expect(result.sections.assets[0]).toMatchObject({ name: 'Cash', group: 'Cash & Bank', current: 1000 });
    expect(result.sections.liabilities[0]).toMatchObject({ name: 'Loan', group: 'Current Liabilities', current: 400 });
    expect(result.current.assets).toBe(1000);
    expect(result.current.liabilitiesAndEquity).toBe(400);
    expect(result.current.difference).toBe(600);
  });
  it('retains the chart of accounts parent hierarchy and newly created empty groups', () => {
    const db = {
      accountTypes: [{ id: 1, companyId: 1, main: 'Balance Sheet', accountClass: 'Asset' }],
      accountGroups: [
        { id: 10, companyId: 1, typeId: 1, name: 'Current Assets' },
        { id: 11, companyId: 1, typeId: 1, parentGroupId: 10, name: 'Bank Accounts' },
        { id: 12, companyId: 1, typeId: 1, parentGroupId: 10, name: 'New Group' },
      ],
      chartOfAccounts: [
        { id: 100, companyId: 1, groupId: 10, name: 'Cash', type: 'Asset', openingBalance: 100 },
        { id: 101, companyId: 1, groupId: 11, name: 'Savings Bank', type: 'Asset', openingBalance: 200 },
      ],
      items: [], customers: [], vendors: [], invoices: [], bills: [], expenses: [], payments: [], receipts: [], journalEntries: [], bankTransactions: [], creditNotes: [], debitNotes: [],
    };
    const result = buildBalanceSheet(db, 1, { start: '2026-10-01', end: '2026-10-31' }, { start: '2026-09-01', end: '2026-09-30' });
    expect(result.groups.assets).toEqual([
      { id: '10', name: 'Current Assets', parentGroupId: null },
      { id: '11', name: 'Bank Accounts', parentGroupId: '10' },
      { id: '12', name: 'New Group', parentGroupId: '10' },
    ]);
    expect(result.sections.assets.find(row => row.name === 'Savings Bank').groupPath).toEqual(['10', '11']);
    expect(result.current.assets).toBe(300);
  });
});
