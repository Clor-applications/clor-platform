import { describe, expect, it } from 'vitest';
import { buildProfitLoss, monthBounds, offsetMonth, previousPeriod } from './profitLossModel';

describe('Profit & Loss grouping and comparison', () => {
  it('groups child ledgers and calculates Sales, COGS, Gross Profit and Net Profit from dated entries', () => {
    const groups = [
      [1, 1, 'Sales Accounts'], [2, 2, 'Purchase Accounts'], [3, 2, 'Direct Expenses'],
      [4, 1, 'Indirect Incomes'], [5, 2, 'Indirect Expenses'], [6, 2, 'Freight Inward', 3],
    ];
    const db = {
      accountTypes: [{ id: 1, companyId: 1, main: 'P&L', accountClass: 'Income' }, { id: 2, companyId: 1, main: 'P&L', accountClass: 'Expense' }],
      accountGroups: groups.map(([id, typeId, name, parentGroupId]) => ({ id, companyId: 1, typeId, name, parentGroupId })),
      chartOfAccounts: ['Sales Revenue','Purchases','Freight','Interest Income','Office Rent'].map((name, index) => ({ id: index + 1, companyId: 1, groupId: [1,2,6,4,5][index], type: [0,3].includes(index) ? 'Income' : 'Expense', name })),
      items: [{ id: 1, companyId: 1, type: 'goods', openingQty: 10, purchasePrice: 20 }],
      journalEntries: [
        { companyId: 1, date: '2026-09-12', lines: [{ accountId: 1, credit: 1000 }, { accountId: 2, debit: 400 }] },
        { companyId: 1, date: '2026-10-12', lines: [{ accountId: 1, credit: 1500 }, { accountId: 2, debit: 600 }, { accountId: 3, debit: 100 }, { accountId: 4, credit: 50 }, { accountId: 5, debit: 75 }] },
      ],
    };
    const report = buildProfitLoss(db, 1, monthBounds('2026-10'), monthBounds('2026-09'));
    expect(report.sections.directExpenses.map(row => row.name)).toEqual(['Freight']);
    expect(report.sections.indirectExpenses.map(row => row.name)).toEqual(['Office Rent']);
    expect(report.current.sales).toBe(1500);
    expect(report.current.openingStock).toBe(200);
    expect(report.current.closingStock).toBe(200);
    expect(report.current.cogs).toBe(700);
    expect(report.current.grossProfit).toBe(800);
    expect(report.current.netProfit).toBe(775);
    expect(report.previous.netProfit).toBe(600);
    expect(offsetMonth('2026-01', -1)).toBe('2025-12');
    expect(previousPeriod({ start: '2026-10-01', end: '2026-10-31' })).toEqual({ start: '2026-08-31', end: '2026-09-30' });
  });
});
