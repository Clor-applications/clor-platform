/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it } from 'vitest';

import { allocationJournalLines, allocationSummary, partyForLedger, validateAllocation } from './allocations';

/**
 * The parent/child rule of statement allocation.
 *
 * The bank transaction is immutable evidence; the allocation rows say what
 * the money was. Everything here is derived from the two together — a stored
 * status or total could disagree with the rows it summarises.
 */

const TXN_OUT = { id: 31, cashBankAccountId: '502', direction: 'OUT', amount: 10000, date: '2026-09-01' };

describe('the three figures', () => {
  it('bank, allocated, difference — from the rows, not a stored field', () => {
    const rows = [
      { ledgerId: '610', amount: 8000 },
      { ledgerId: '620', amount: 2000 },
    ];
    expect(allocationSummary(TXN_OUT, rows)).toEqual({
      bankAmount: 10000,
      allocated: 10000,
      difference: 0,
      status: 'Allocated',
    });
  });

  it('reads partial as partial and empty as unallocated', () => {
    expect(allocationSummary(TXN_OUT, [{ ledgerId: '610', amount: 8000 }]).status).toBe('Partially allocated');
    expect(allocationSummary(TXN_OUT, []).status).toBe('Unallocated');
  });
});

describe('what may be saved, and what may be posted', () => {
  it('saves a partial split but refuses to post it', () => {
    const check = validateAllocation(TXN_OUT, [{ ledgerId: '610', amount: 8000 }]);
    expect(check.canSave).toBe(true);
    expect(check.canPost).toBe(false);
  });

  it('posts only when allocated equals the bank amount', () => {
    const check = validateAllocation(TXN_OUT, [
      { ledgerId: '610', amount: 8000 },
      { ledgerId: '620', amount: 2000 },
    ]);
    expect(check.canPost).toBe(true);
  });

  it('refuses to allocate more than the bank amount', () => {
    const check = validateAllocation(TXN_OUT, [{ ledgerId: '610', amount: 12000 }]);
    expect(check.canSave).toBe(false);
    expect(check.problems).toContain('Allocated more than the bank amount.');
  });

  it('demands a ledger on every row', () => {
    const check = validateAllocation(TXN_OUT, [{ ledgerId: '', amount: 5000 }]);
    expect(check.canSave).toBe(false);
  });
});

describe('the journal a full allocation becomes', () => {
  it('credits the bank and debits the split for money out', () => {
    const lines = allocationJournalLines(TXN_OUT, [
      { ledgerId: '610', amount: 8000 },
      { ledgerId: '620', amount: 2000 },
    ]);
    expect(lines).toEqual([
      { accountId: '502', debit: 0, credit: 10000 },
      { accountId: '610', debit: 8000, credit: 0 },
      { accountId: '620', debit: 2000, credit: 0 },
    ]);
  });

  it('debits the bank and credits the split for money in', () => {
    const lines = allocationJournalLines({ ...TXN_OUT, direction: 'IN' }, [{ ledgerId: '410', amount: 10000 }]);
    expect(lines).toEqual([
      { accountId: '502', debit: 10000, credit: 0 },
      { accountId: '410', debit: 0, credit: 10000 },
    ]);
  });

  /* Balanced by construction — the engine would refuse it otherwise, but a
     builder that relies on downstream refusal is a builder that ships bugs. */
  it('is balanced whatever the split', () => {
    const lines = allocationJournalLines(TXN_OUT, [
      { ledgerId: '610', amount: 3333.33 },
      { ledgerId: '620', amount: 6666.67 },
    ]);
    const dr = lines.reduce((t, l) => t + l.debit, 0);
    const cr = lines.reduce((t, l) => t + l.credit, 0);
    expect(Math.round((dr - cr) * 100)).toBe(0);
  });
});

describe('party ledgers', () => {
  const db = {
    customers: [{ id: 3, companyId: 1, name: 'ABC Industries', accountId: 410 }],
    vendors: [{ id: 7, companyId: 1, name: 'Sharp Contractors', accountId: 610 }],
  };

  it('finds the vendor or customer behind a chart row', () => {
    expect(partyForLedger(db, 1, '610')).toMatchObject({ kind: 'vendor', party: { id: 7 } });
    expect(partyForLedger(db, 1, '410')).toMatchObject({ kind: 'customer', party: { id: 3 } });
  });

  it('an ordinary ledger belongs to nobody', () => {
    expect(partyForLedger(db, 1, '620')).toBeNull();
    expect(partyForLedger(db, 1, '')).toBeNull();
    /* Another company's vendor is not this company's party. */
    expect(partyForLedger(db, 2, '610')).toBeNull();
  });
});

describe('rows the payment engine already settled', () => {
  /*
   * A row with a paymentId went through the disbursement/receipt form: its
   * voucher posted the bank movement, the party leg and the bill knock-off.
   * The closing journal must not repeat any of it — its bank leg covers only
   * the plain rows.
   */
  it('excludes engine rows from the journal, bank leg included', () => {
    const lines = allocationJournalLines(TXN_OUT, [
      { ledgerId: '610', amount: 8000, paymentId: 12 },
      { ledgerId: '620', amount: 2000 },
    ]);
    expect(lines).toEqual([
      { accountId: '502', debit: 0, credit: 2000 },
      { accountId: '620', debit: 2000, credit: 0 },
    ]);
  });

  it('still counts engine rows toward the three figures', () => {
    const s = allocationSummary(TXN_OUT, [
      { ledgerId: '610', amount: 8000, paymentId: 12 },
      { ledgerId: '620', amount: 2000 },
    ]);
    expect(s).toMatchObject({ allocated: 10000, difference: 0, status: 'Allocated' });
  });

  it('a fully engine-settled transaction needs no journal at all', () => {
    const lines = allocationJournalLines(TXN_OUT, [{ ledgerId: '610', amount: 10000, paymentId: 12 }]);
    expect(lines).toEqual([{ accountId: '502', debit: 0, credit: 0 }]);
  });
});

describe('decimal-safe money', () => {
  /*
   * Equality is decided in integer paise, never by float comparison. The sum
   * below is 9999.999999999998 in doubles — a float-equality engine calls it
   * Partially allocated and blocks a post the book-keeper can see is whole.
   */
  it('calls a float-imprecise full allocation fully allocated', () => {
    const rows = [
      { ledgerId: '610', amount: 1000.1 },
      { ledgerId: '611', amount: 2000.2 },
      { ledgerId: '620', amount: 6999.7 },
    ];
    const s = allocationSummary(TXN_OUT, rows);
    expect(s.status).toBe('Allocated');
    expect(s.difference).toBe(0);
    expect(validateAllocation(TXN_OUT, rows).canPost).toBe(true);
  });

  /* The specification's own example. */
  it('₹10,000 less ₹8,000 allocated is a ₹2,000 difference, Partially allocated', () => {
    const s = allocationSummary(TXN_OUT, [{ ledgerId: '610', amount: 8000 }]);
    expect(s).toMatchObject({ bankAmount: 10000, allocated: 8000, difference: 2000, status: 'Partially allocated' });
    expect(validateAllocation(TXN_OUT, [{ ledgerId: '610', amount: 8000 }]).canPost).toBe(false);
  });

  it('one paisa short is not fully allocated', () => {
    const rows = [{ ledgerId: '610', amount: 9999.99 }];
    expect(allocationSummary(TXN_OUT, rows).status).toBe('Partially allocated');
    expect(validateAllocation(TXN_OUT, rows).canPost).toBe(false);
  });
});
