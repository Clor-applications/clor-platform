/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import {
  allocationError,
  allocationJournalLines,
  allocationSummary,
} from './allocationLines';

/**
 * One payment, several accounts — the arithmetic that lets a GST payment be
 * one record instead of three.
 */

const gst = [
  { ledgerId: '10', amount: '10000', description: 'Output tax' },
  { ledgerId: '11', amount: '300', description: 'Late fee' },
  { ledgerId: '12', amount: '200', description: 'Interest' },
];

describe('what the allocation adds up to', () => {
  it('balances when the parts reach the payment', () => {
    const s = allocationSummary({ rows: gst, amount: 10500 });
    expect(s.allocated).toBe(10500);
    expect(s.unallocated).toBe(0);
    expect(s.balanced).toBe(true);
  });

  it('counts settled documents as part of the total, not beside it', () => {
    /* A receipt of 10,500 that clears 10,000 of invoices has 500 left to
       place — the invoices are an allocation to the customer's own account. */
    const s = allocationSummary({ rows: [], documentTotal: 10000, amount: 10500 });
    expect(s.allocated).toBe(10000);
    expect(s.unallocated).toBe(500);
    expect(s.balanced).toBe(false);

    const withRest = allocationSummary({
      rows: [{ ledgerId: '9', amount: '500' }],
      documentTotal: 10000,
      amount: 10500,
    });
    expect(withRest.balanced).toBe(true);
  });

  it('is decided in paise, so thirds of a rupee still balance', () => {
    const rows = [
      { ledgerId: '1', amount: '33.33' },
      { ledgerId: '2', amount: '33.33' },
      { ledgerId: '3', amount: '33.34' },
    ];
    expect(allocationSummary({ rows, amount: 100 }).balanced).toBe(true);
  });

  it('ignores a row with no ledger when totalling', () => {
    const rows = [...gst, { ledgerId: '', amount: '999' }];
    expect(allocationSummary({ rows, amount: 10500 }).allocated).toBe(10500);
  });
});

describe('what stops the save', () => {
  it('passes a balanced allocation', () => {
    expect(allocationError({ rows: gst, amount: 10500 })).toBeNull();
  });

  it('names the figure still to place rather than saying "mismatch"', () => {
    const err = allocationError({ rows: [{ ledgerId: '10', amount: '10000' }], amount: 10500 });
    expect(err).toMatch(/500\.00/);
    expect(err).toMatch(/unallocated/i);
  });

  it('says so when the allocation runs past the payment', () => {
    const err = allocationError({ rows: [{ ledgerId: '10', amount: '11000' }], amount: 10500 });
    expect(err).toMatch(/over by ₹500\.00/);
  });

  it('catches the half-finished row the total would silently drop', () => {
    const err = allocationError({ rows: [{ ledgerId: '', amount: '300' }], amount: 300 });
    expect(err).toMatch(/no account/i);
  });

  it('refuses a negative line', () => {
    const err = allocationError({ rows: [{ ledgerId: '10', amount: '-5' }, { ledgerId: '11', amount: '105' }], amount: 100 });
    expect(err).toMatch(/cannot be negative/i);
  });

  it('asks for the amount before the allocation', () => {
    expect(allocationError({ rows: [], amount: 0 })).toMatch(/amount first/i);
  });
});

describe('the journal it posts', () => {
  const nameOf = (id) => ({ 10: 'GST Payable', 11: 'GST Late Fee', 12: 'GST Interest', 99: 'HDFC Bank' }[id] || '');

  it('debits every allocated account and credits the bank once', () => {
    const lines = allocationJournalLines({ rows: gst, direction: 'OUT', bankLedgerId: '99', amount: 10500, nameOf });
    expect(lines).toHaveLength(4);
    expect(lines.slice(0, 3).map((l) => [l.accountName, l.debit])).toEqual([
      ['GST Payable', 10000],
      ['GST Late Fee', 300],
      ['GST Interest', 200],
    ]);
    const bank = lines[3];
    expect(bank).toMatchObject({ accountName: 'HDFC Bank', debit: 0, credit: 10500 });
    /* The entry balances, which is the only thing the ledger will accept. */
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
  });

  it('turns the entry round for money coming in', () => {
    const lines = allocationJournalLines({
      rows: [{ ledgerId: '10', amount: '10500' }],
      direction: 'IN',
      bankLedgerId: '99',
      amount: 10500,
      nameOf,
    });
    expect(lines[0]).toMatchObject({ debit: 0, credit: 10500 });
    expect(lines[1]).toMatchObject({ accountName: 'HDFC Bank', debit: 10500, credit: 0 });
  });

  it('posts nothing when no row is usable', () => {
    expect(allocationJournalLines({ rows: [{ ledgerId: '', amount: '5' }], direction: 'OUT', bankLedgerId: '99', amount: 5, nameOf })).toEqual([]);
  });
});

describe('an advance is not a gap', () => {
  it('lets money sit on a named party without a ledger row', () => {
    /* The product has always allowed a receipt on account: the money waits on
       the customer's own control ledger until an invoice claims it. */
    expect(allocationError({ rows: [], documentTotal: 0, amount: 5000, noun: 'receipt', hasParty: true })).toBeNull();
  });

  it('still refuses money with nobody to hold it', () => {
    /* A GST payment has no party account to sit on, so every rupee has to be
       placed by hand. */
    expect(allocationError({ rows: [], documentTotal: 0, amount: 5000, noun: 'payment', hasParty: false }))
      .toMatch(/at least one account/i);
  });

  it('still refuses an over-allocation, party or not', () => {
    expect(
      allocationError({ rows: [{ ledgerId: '1', amount: '6000' }], amount: 5000, hasParty: true })
    ).toMatch(/over by/i);
  });
});
