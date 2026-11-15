import { describe, expect, it } from 'vitest';
import { ensureBranchAccounts } from './branchAccounts';
import { buildLedgerStatement } from '../../data/db';

describe('internal branch clearing', () => {
  const companyId = 1;
  const branches = [{ id: 'a', branchCode: 'A', branchName: 'A' }, { id: 'b', branchCode: 'B', branchName: 'B' }];
  const base = { accountTypes: [{ id: 1, companyId, accountClass: 'Asset', main: 'Balance Sheet' }], accountGroups: [], chartOfAccounts: [], stockTransfers: [] };

  it('creates one ledger per branch without duplicating it', () => {
    const db = ensureBranchAccounts(base, companyId, branches);
    expect(db.chartOfAccounts).toHaveLength(2);
    expect(ensureBranchAccounts(db, companyId, branches)).toBe(db);
  });

  it('records opposite branch balances and ignores warehouse movements', () => {
    const db = ensureBranchAccounts(base, companyId, branches);
    db.stockTransfers = [
      { id: 'x', companyId, number: 'BT-1', date: '2026-10-28', status: 'Transferred Out', sourceBranchId: 'a', targetBranchId: 'b', total: 1180 },
      { id: 'y', companyId, number: 'WT-1', date: '2026-10-28', status: 'Transferred Out', sourceBranchId: 'a', targetBranchId: 'a', total: 500 },
    ];
    const balances = db.chartOfAccounts.map(account => buildLedgerStatement(db, companyId, account.id).rows.at(-1)?.runningBalance || 0);
    expect(balances).toEqual([1180, -1180]);
    expect(balances.reduce((sum, amount) => sum + amount, 0)).toBe(0);
  });
});
