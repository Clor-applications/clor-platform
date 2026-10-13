/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it } from 'vitest';

import {
  groupAllowsLedger,
  isDuplicateLedgerName,
  isValidGstin,
  isValidIfsc,
  isValidPan,
  ledgerHasPostings,
  openingTypeForNature,
  tdsLedgerNature,
  tdsSectionSummary,
  validateLedger,
} from './ledgerMaster';
import { tdsSection } from './tds';

describe('identifier formats', () => {
  it('accepts a real IFSC and rejects the near misses', () => {
    expect(isValidIfsc('HDFC0001234')).toBe(true);
    expect(isValidIfsc('hdfc0001234')).toBe(true);
    // The fifth character is a zero, always. A bank letter there is the
    // commonest typo and the transfer fails at the bank, not here.
    expect(isValidIfsc('HDFCO001234')).toBe(false);
    expect(isValidIfsc('HDFC000123')).toBe(false);
    expect(isValidIfsc('HDFC00012345')).toBe(false);
  });

  it('accepts a real PAN and rejects the near misses', () => {
    expect(isValidPan('AABCU9603R')).toBe(true);
    expect(isValidPan('AABCU96031')).toBe(false);
    expect(isValidPan('AABC9603R')).toBe(false);
  });

  it('accepts a real GSTIN and rejects the near misses', () => {
    expect(isValidGstin('29AABCU9603R1ZM')).toBe(true);
    // Z is fixed in the fourteenth position.
    expect(isValidGstin('29AABCU9603R1XM')).toBe(false);
    expect(isValidGstin('29AABCU9603R1Z')).toBe(false);
  });
});

describe('which side the opening balance falls on', () => {
  it('debits an asset or an expense', () => {
    expect(openingTypeForNature('Asset')).toBe('Dr');
    expect(openingTypeForNature('Expense')).toBe('Dr');
  });

  it('credits a liability, income or capital', () => {
    expect(openingTypeForNature('Liability')).toBe('Cr');
    expect(openingTypeForNature('Income')).toBe('Cr');
    expect(openingTypeForNature('Equity')).toBe('Cr');
  });
});

describe('a group that only holds groups', () => {
  it('refuses a ledger filed directly on it', () => {
    expect(groupAllowsLedger({ name: 'Primary' })).toBe(false);
    expect(groupAllowsLedger({ name: 'Duties & Taxes', allowLedger: false })).toBe(false);
    expect(groupAllowsLedger({ name: 'Bank Accounts' })).toBe(true);
  });
});

describe('duplicate names', () => {
  const ledgers = [
    { id: 1, companyId: 1, name: 'HDFC Bank - Current Account' },
    { id: 2, companyId: 2, name: 'Petty Cash' },
  ];

  it('catches the same name typed differently', () => {
    expect(isDuplicateLedgerName({ ledgers, companyId: 1, name: '  hdfc bank -  Current   Account ' })).toBe(true);
  });

  it('leaves another company alone', () => {
    expect(isDuplicateLedgerName({ ledgers, companyId: 1, name: 'Petty Cash' })).toBe(false);
  });

  it('does not report a ledger against itself while editing', () => {
    expect(isDuplicateLedgerName({ ledgers, companyId: 1, name: 'HDFC Bank - Current Account', ignoreId: 1 })).toBe(false);
  });
});

describe('postings', () => {
  const journalEntries = [
    { companyId: 1, lines: [{ accountId: '7' }, { accountId: '8' }] },
    { companyId: 2, lines: [{ accountId: '9' }] },
  ];

  it('sees an entry against the ledger', () => {
    expect(ledgerHasPostings({ journalEntries, companyId: 1, ledgerId: 8 })).toBe(true);
  });

  it('does not count another company book', () => {
    expect(ledgerHasPostings({ journalEntries, companyId: 1, ledgerId: 9 })).toBe(false);
  });
});

describe('validateLedger', () => {
  const bankGroup = { id: 10, name: 'Bank Accounts' };
  const base = { name: 'HDFC Bank - Current Account', bankName: 'HDFC Bank Limited', bankAccountNumber: '50100012345678', bankIfsc: 'HDFC0001234' };
  const run = (values, extra = {}) =>
    validateLedger({ values, group: bankGroup, ledgers: [], companyId: 1, ...extra });

  it('passes a complete bank ledger', () => {
    expect(run(base, { needsBank: true })).toBeNull();
  });

  it('requires the name first', () => {
    expect(run({ ...base, name: '' }, { needsBank: true })).toMatchObject({ field: 'name' });
  });

  it('requires IFSC on a bank ledger and checks its shape', () => {
    expect(run({ ...base, bankIfsc: '' }, { needsBank: true })).toMatchObject({ field: 'bankIfsc' });
    expect(run({ ...base, bankIfsc: 'HDFCX001234' }, { needsBank: true })).toMatchObject({ field: 'bankIfsc' });
  });

  it('does not ask a non-bank ledger for bank fields', () => {
    expect(validateLedger({ values: { name: 'Office Rent' }, group: { id: 11, name: 'Indirect Expenses' }, ledgers: [], companyId: 1 })).toBeNull();
  });

  it('checks PAN and GSTIN only when they are filled', () => {
    expect(run({ ...base, pan: '' }, { needsBank: true })).toBeNull();
    expect(run({ ...base, pan: 'NOPE' }, { needsBank: true })).toMatchObject({ field: 'pan' });
    expect(run({ ...base, gstin: '29AABCU9603R1ZM' }, { needsBank: true })).toBeNull();
    expect(run({ ...base, gstin: '29AABCU9603R1XM' }, { needsBank: true })).toMatchObject({ field: 'gstin' });
  });

  it('makes a TDS ledger name its section', () => {
    const tdsGroup = { id: 13, name: 'TDS Payable' };
    expect(validateLedger({ values: { name: 'TDS 194J' }, group: tdsGroup, ledgers: [], companyId: 1, needsTds: true })).toMatchObject({ field: 'tdsSection' });
    expect(validateLedger({ values: { name: 'TDS 194J', tdsSection: '194J(b)' }, group: tdsGroup, ledgers: [], companyId: 1, needsTds: true })).toBeNull();
  });

  it('refuses a group that only holds groups', () => {
    expect(validateLedger({ values: { name: 'Something' }, group: { id: 1, name: 'Primary' }, ledgers: [], companyId: 1 })).toMatchObject({ field: 'groupId' });
  });
});

describe('what the TDS tab reads from the section master', () => {
  it('states the rate, threshold and how the threshold behaves', () => {
    const s = tdsSectionSummary(tdsSection('194C'));
    expect(s.rate).toContain('2%');
    expect(s.rate).toContain('1%');
    expect(s.threshold).toContain('30,000');
    expect(s.threshold).toContain('1,00,000');
    expect(s.applicability).toMatch(/whole aggregate/i);
  });

  it('says when only the excess is deducted', () => {
    expect(tdsSectionSummary(tdsSection('194Q')).applicability).toMatch(/above the threshold/i);
  });

  it('carries the rule version the return will need', () => {
    expect(tdsSectionSummary(tdsSection('194J(b)')).version).toContain('393(1)');
  });

  it('takes the ledger nature from the group', () => {
    expect(tdsLedgerNature({ name: 'TDS Payable' })).toBe('Payable');
    expect(tdsLedgerNature({ name: 'TDS Receivable' })).toBe('Receivable');
  });
});
