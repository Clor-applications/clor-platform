import { describe, expect, it } from 'vitest';
import { buildCashFlow } from './cashFlowModel';

describe('cash flow statement', () => {
  it('classifies cash movements, excludes internal transfers, and reconciles to closing cash', () => {
    const db = {
      accountGroups: [
        { id: 1, companyId: 1, name: 'Cash-in-Hand' },
        { id: 2, companyId: 1, name: 'Bank Accounts' },
        { id: 3, companyId: 1, name: 'Sales Accounts' },
        { id: 4, companyId: 1, name: 'Fixed Assets' },
        { id: 5, companyId: 1, name: 'Capital Account' },
      ],
      chartOfAccounts: [
        { id: 10, companyId: 1, name: 'Cash', groupId: 1, type: 'Asset', openingBalance: 100, openingBalanceType: 'Dr' },
        { id: 11, companyId: 1, name: 'Bank', groupId: 2, type: 'Asset', openingBalance: 50, openingBalanceType: 'Dr' },
        { id: 20, companyId: 1, name: 'Sales Revenue', groupId: 3, type: 'Income' },
        { id: 21, companyId: 1, name: 'Equipment', groupId: 4, type: 'Asset' },
        { id: 22, companyId: 1, name: 'Owner Capital', groupId: 5, type: 'Equity' },
      ],
      journalEntries: [
        { id: 1, companyId: 1, date: '2026-10-05', lines: [{ accountId: 10, debit: 200 }, { accountId: 20, credit: 200 }] },
        { id: 2, companyId: 1, date: '2026-10-08', lines: [{ accountId: 21, debit: 40 }, { accountId: 11, credit: 40 }] },
        { id: 3, companyId: 1, date: '2026-10-10', lines: [{ accountId: 10, debit: 100 }, { accountId: 22, credit: 100 }] },
        { id: 4, companyId: 1, date: '2026-10-12', lines: [{ accountId: 11, debit: 20 }, { accountId: 10, credit: 20 }] },
      ],
    };
    const report = buildCashFlow(db, 1, { start: '2026-10-01', end: '2026-10-31' });
    expect(report.opening).toBe(150);
    expect(report.totals).toEqual({ operating: 200, investing: -40, financing: 100 });
    expect(report.net).toBe(260);
    expect(report.closing).toBe(410);
    expect(report.reconciliation).toBe(0);
    expect(report.entries).toHaveLength(3);
    expect(report.cashBalances).toEqual([
      { id: '10', name: 'Cash', opening: 100, closing: 380 },
      { id: '11', name: 'Bank', opening: 50, closing: 30 },
    ]);
    expect(report.sections.investing[0].ledgerId).toBe('21');
    expect(report.sectionLedgers.financing).toContainEqual({ id: '22', name: 'Owner Capital' });
  });
});
