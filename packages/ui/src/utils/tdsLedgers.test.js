/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it } from 'vitest';

import { isTdsPayableGroup, tdsLedgerLabel, tdsLedgerRate, tdsPayableLedgers } from './tdsLedgers';

/**
 * Which ledgers a purchase may be deducted against.
 *
 * The company already decided this when it built its chart of accounts: one
 * ledger under TDS Payable per section it deducts under. The bill reads that
 * decision rather than asking somebody to pick a section out of the Act again.
 */

const GROUPS = [
  { id: 10, companyId: 1, name: 'Duties & Taxes', parentGroupId: null },
  { id: 11, companyId: 1, name: 'TDS Payable', parentGroupId: 10 },
  { id: 12, companyId: 1, name: 'TDS Receivable', parentGroupId: 10 },
  { id: 13, companyId: 1, name: 'Bank Accounts', parentGroupId: null },
  /* Another company's chart, which must never leak into this one's. */
  { id: 90, companyId: 2, name: 'TDS Payable', parentGroupId: null },
];

const LEDGERS = [
  { id: 1, companyId: 1, name: 'TDS on Contractors', groupId: 11, tdsSection: '194C' },
  { id: 2, companyId: 1, name: 'TDS on Professional Fees', groupId: 11, tdsSection: '194J(b)' },
  { id: 3, companyId: 1, name: 'TDS Receivable 194C', groupId: 12, tdsSection: '194C' },
  { id: 4, companyId: 1, name: 'HDFC Current', groupId: 13 },
  { id: 5, companyId: 1, name: 'TDS on Rent (closed)', groupId: 11, tdsSection: '194I(b)', isActive: false },
  { id: 6, companyId: 2, name: 'Their TDS', groupId: 90, tdsSection: '194C' },
];

const db = { accountGroups: GROUPS, chartOfAccounts: LEDGERS };

describe('which group counts', () => {
  it('takes a TDS group and one nested under Duties & Taxes', () => {
    expect(isTdsPayableGroup(GROUPS, 11)).toBe(true);
  });

  /* The other side of the same tax: an asset, and no business reducing what a
     vendor is paid. */
  it('refuses the receivable side', () => {
    expect(isTdsPayableGroup(GROUPS, 12)).toBe(false);
  });

  it('refuses a group that is nothing to do with TDS', () => {
    expect(isTdsPayableGroup(GROUPS, 13)).toBe(false);
    expect(isTdsPayableGroup(GROUPS, 10)).toBe(false);
    expect(isTdsPayableGroup(GROUPS, null)).toBe(false);
  });
});

describe('the ledgers a bill may deduct against', () => {
  it('offers this company’s payable TDS ledgers, by name', () => {
    expect(tdsPayableLedgers(db, 1).map((l) => l.name)).toEqual([
      'TDS on Contractors',
      'TDS on Professional Fees',
    ]);
  });

  it('leaves out a retired ledger', () => {
    expect(tdsPayableLedgers(db, 1).map((l) => l.id)).not.toContain(5);
  });

  it('never crosses companies', () => {
    expect(tdsPayableLedgers(db, 2).map((l) => l.name)).toEqual(['Their TDS']);
  });

  it('is empty where no such ledger exists, rather than guessing one', () => {
    expect(tdsPayableLedgers({ accountGroups: [], chartOfAccounts: [] }, 1)).toEqual([]);
  });
});

describe('the rate that follows from the ledger', () => {
  it('comes from the section master', () => {
    expect(tdsLedgerRate({ tdsSection: '194C' })).toBe(2);
    expect(tdsLedgerRate({ tdsSection: '194J(b)' })).toBe(10);
  });

  /* 194C is 1% for an individual or HUF and 2% for everyone else — the app
     charged 2% for all of them once, and it is the payee that decides. */
  it('follows the payee where the section says it should', () => {
    expect(tdsLedgerRate({ tdsSection: '194C' }, 'INDIVIDUAL')).toBe(1);
  });

  /* Where a company holds a certificate under section 197, or the vendor has
     no PAN, the ledger carries the rate and it wins. */
  it('lets the ledger’s own rate override the section', () => {
    expect(tdsLedgerRate({ tdsSection: '194J(b)', tdsRate: 2 })).toBe(2);
    expect(tdsLedgerRate({ tdsSection: '194C', tdsRate: 20 })).toBe(20);
  });

  it('is zero for a ledger that names no section', () => {
    expect(tdsLedgerRate({ name: 'TDS misc' })).toBe(0);
  });
});

describe('how a ledger reads in the picker', () => {
  it('says the ledger, the section and the rate', () => {
    expect(tdsLedgerLabel({ name: 'TDS on Contractors', tdsSection: '194C' })).toBe(
      'TDS on Contractors · 194C — Contractor / sub-contractor @ 2%'
    );
  });

  it('falls back to the plain name where there is no section', () => {
    expect(tdsLedgerLabel({ name: 'TDS suspense' })).toBe('TDS suspense');
  });
});
