/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it } from 'vitest';

import { cashBankTotals, cashBankTransactions } from './transactions';

/**
 * The cash book, read from what actually happened.
 *
 * Nothing here is stored twice: a row exists because a payment, a journal or
 * an imported statement line exists, and the account it belongs to is decided
 * by the chart of accounts rather than by a field somebody typed.
 */

const db = {
  accountGroups: [
    { id: 1, companyId: 1, name: 'Bank Accounts', parentGroupId: null },
    { id: 2, companyId: 1, name: 'Cash-in-Hand', parentGroupId: null },
    { id: 3, companyId: 1, name: 'Sundry Creditors', parentGroupId: null },
  ],
  chartOfAccounts: [
    { id: 11, companyId: 1, name: 'HDFC Bank - Current A/c', groupId: 1, serverLedgerAccountId: 'srv-hdfc' },
    { id: 12, companyId: 1, name: 'Petty Cash', groupId: 2, serverLedgerAccountId: 'srv-cash' },
    { id: 21, companyId: 1, name: 'ABC Traders', groupId: 3 },
  ],
  payments: [
    { id: 1, companyId: 1, date: '2026-09-12', voucherType: 'payment', ledgerAccountId: 'srv-hdfc', amount: 100000, partyName: 'ABC Traders', number: 'PAY-0012' },
    { id: 2, companyId: 1, date: '2026-09-13', voucherType: 'receipt', ledgerAccountId: 'srv-hdfc', amount: 50000, partyName: 'ABC Industries', number: 'RCPT-0045', reconciled: true },
    /* Paid from a ledger that is neither cash nor bank — not a cash-book row. */
    { id: 3, companyId: 1, date: '2026-09-14', voucherType: 'payment', ledgerAccountId: 'srv-none', amount: 900, partyName: 'Nobody' },
    /* Another company's books. */
    { id: 4, companyId: 2, date: '2026-09-14', voucherType: 'payment', ledgerAccountId: 'srv-hdfc', amount: 700, partyName: 'Theirs' },
  ],
  journalEntries: [
    {
      id: 7, companyId: 1, date: '2026-09-15', number: 'CON-0011',
      lines: [
        { accountId: '12', debit: 25000, credit: 0 },
        { accountId: '11', debit: 0, credit: 25000 },
      ],
    },
    /* One cash leg only: a payment written as a journal, not a contra. */
    {
      id: 8, companyId: 1, date: '2026-09-16',
      lines: [
        { accountId: '21', debit: 4000, credit: 0 },
        { accountId: '11', debit: 0, credit: 4000 },
      ],
    },
  ],
  bankTransactions: [
    { id: 31, companyId: 1, date: '2026-09-17', cashBankAccountId: '11', amount: 12450, direction: 'IN', description: 'Interest credit', refNo: 'UTR900' },
  ],
};

describe('what appears in the cash book', () => {
  it('is payments, receipts, contras and imported lines', () => {
    const rows = cashBankTransactions(db, 1);
    expect(rows.map((r) => `${r.type}:${r.amount}`)).toEqual([
      'Receipt:12450',
      'Contra:25000',
      'Receipt:50000',
      'Payment:100000',
    ]);
  });

  it('leaves out a payment made from a ledger that is not cash or bank', () => {
    expect(cashBankTransactions(db, 1).some((r) => r.ledgerName === 'Nobody')).toBe(false);
  });

  it('never crosses companies', () => {
    expect(cashBankTransactions(db, 1).some((r) => r.ledgerName === 'Theirs')).toBe(false);
  });

  /* A journal with one cash leg is a payment by another name; counting it as a
     contra would double the money moved between the company's own accounts. */
  it('counts a journal as a contra only when both legs are cash or bank', () => {
    const contras = cashBankTransactions(db, 1).filter((r) => r.type === 'Contra');
    expect(contras).toHaveLength(1);
    expect(contras[0].number).toBe('CON-0011');
  });

  it('names the other side of a contra as the ledger', () => {
    const contra = cashBankTransactions(db, 1).find((r) => r.type === 'Contra');
    /* Out of HDFC, into Petty Cash. */
    expect(contra.accountName).toBe('HDFC Bank - Current A/c');
    expect(contra.ledgerName).toBe('Petty Cash');
  });

  it('shows a contra from whichever account is being looked at', () => {
    const fromCash = cashBankTransactions(db, 1, { accountId: '12' }).find((r) => r.type === 'Contra');
    expect(fromCash.accountName).toBe('Petty Cash');
    expect(fromCash.ledgerName).toBe('HDFC Bank - Current A/c');
  });

  it('narrows to one account', () => {
    expect(cashBankTransactions(db, 1, { accountId: '12' }).map((r) => r.type)).toEqual(['Contra']);
  });

  it('narrows to a period, inclusive at both ends', () => {
    const rows = cashBankTransactions(db, 1, { from: '2026-09-13', to: '2026-09-15' });
    expect(rows.map((r) => r.date)).toEqual(['2026-09-15', '2026-09-13']);
  });

  it('shows receipts and payments saved with legacy or backend account fields', () => {
    const compatibleDb = {
      accountGroups: [],
      chartOfAccounts: [
        { id: 91, companyId: 1, name: 'ICICI Current Account', controlKind: 'BANK', backendLedgerId: 'backend-icici' },
      ],
      payments: [
        { id: 81, companyId: 1, date: '2026-09-20', voucherType: 'receipt', ledgerAccountId: 'backend-icici', amount: 1200, customerName: 'Customer A' },
        { id: 82, companyId: 1, date: '2026-09-21', voucherType: 'payment', cashBankAccountId: 91, amount: 400, vendorName: 'Vendor A' },
        { id: 83, companyId: 1, date: '2026-09-22', voucherType: 'receipt', amount: 300, customerName: 'Legacy Customer' },
      ],
    };

    expect(cashBankTransactions(compatibleDb, 1).map((row) => `${row.type}:${row.amount}`)).toEqual([
      'Receipt:300',
      'Payment:400',
      'Receipt:1200',
    ]);
  });

  it('is newest first', () => {
    const dates = cashBankTransactions(db, 1).map((r) => r.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe('status', () => {
  /* §5: an imported line is nobody's accounting entry until it is allocated. */
  it('leaves an imported line uncategorised', () => {
    const row = cashBankTransactions(db, 1).find((r) => r.kind === 'statement');
    expect(row.status).toBe('Uncategorised');
  });

  it('keeps reconciliation separate from categorisation', () => {
    const row = cashBankTransactions(db, 1).find((r) => r.number === 'RCPT-0045');
    expect(row.status).toBe('Categorised');
    expect(row.reconciled).toBe(true);
  });
});

describe('the figures above the list', () => {
  it('total each type separately and count the rows', () => {
    expect(cashBankTotals(cashBankTransactions(db, 1))).toEqual({
      payments: 100000,
      receipts: 62450,
      contra: 25000,
      count: 4,
    });
  });

  it('answers zero for an empty book rather than throwing', () => {
    expect(cashBankTotals([])).toEqual({ payments: 0, receipts: 0, contra: 0, count: 0 });
  });
});
