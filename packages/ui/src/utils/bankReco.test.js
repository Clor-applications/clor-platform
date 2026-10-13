import { describe, expect, it } from 'vitest';
import { matchStatement, narrationScore, reconciliationSummary } from './bankReco';

const s = (id, date, direction, amount, narration = '') => ({ id, date, direction, amount, narration });

/*
 * What the product had was an import: statement rows became new transactions,
 * with a duplicate warning and an import anyway. For a book that already
 * records its receipts and payments that is the wrong operation — it doubles
 * the money. These cover the other one.
 */
describe('matching a statement against the book', () => {
  it('matches the same money on the same day', () => {
    const r = matchStatement({
      statement: [s('st1', '2026-09-01', 'IN', 5000, 'NEFT-ACME TRADERS-9921')],
      book: [s('bk1', '2026-09-01', 'IN', 5000, 'Acme Traders')],
    });
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].book.id).toBe('bk1');
    expect(r.matched[0].confident).toBe(true);
    expect(r.statementOnly).toHaveLength(0);
    expect(r.bookOnly).toHaveLength(0);
  });

  /*
   * ₹5,000 in and ₹5,000 out are not the same money at any tolerance, and
   * treating them as one hides two errors instead of finding them.
   */
  it('never matches across direction', () => {
    const r = matchStatement({
      statement: [s('st1', '2026-09-01', 'IN', 5000, 'Acme')],
      book: [s('bk1', '2026-09-01', 'OUT', 5000, 'Acme')],
    });
    expect(r.matched).toHaveLength(0);
    expect(r.statementOnly).toHaveLength(1);
    expect(r.bookOnly).toHaveLength(1);
  });

  /* Bank charges are their own line, not a rounding allowance on a payment. */
  it('will not match an amount that differs by a paisa', () => {
    const r = matchStatement({
      statement: [s('st1', '2026-09-01', 'OUT', 5000.01, 'Rent')],
      book: [s('bk1', '2026-09-01', 'OUT', 5000, 'Rent')],
    });
    expect(r.matched).toHaveLength(0);
  });

  /* A cheque is written the day it is handed over and clears when it clears. */
  it('allows a cheque to clear inside the window', () => {
    const r = matchStatement({
      statement: [s('st1', '2026-09-05', 'OUT', 12000, 'CHQ 400122')],
      book: [s('bk1', '2026-09-01', 'OUT', 12000, 'Cheque 400122 rent')],
    });
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].dayGap).toBe(4);
    // Offered, not assumed: it is not the same day, so somebody confirms it.
    expect(r.matched[0].confident).toBe(false);
  });

  it('stops at the edge of the window', () => {
    const args = {
      statement: [s('st1', '2026-09-20', 'OUT', 12000, 'CHQ 400122')],
      book: [s('bk1', '2026-09-01', 'OUT', 12000, 'Cheque 400122')],
    };
    expect(matchStatement(args).matched).toHaveLength(0);
    expect(matchStatement({ ...args, dateWindowDays: 30 }).matched).toHaveLength(1);
  });

  /*
   * The one that matters most: one payment must not silently reconcile three
   * statement lines. The difference would still come to zero and two of the
   * three would be money nobody ever recorded.
   */
  it('uses a book entry once and only once', () => {
    const r = matchStatement({
      statement: [
        s('st1', '2026-09-01', 'IN', 5000, 'Acme'),
        s('st2', '2026-09-01', 'IN', 5000, 'Acme'),
        s('st3', '2026-09-01', 'IN', 5000, 'Acme'),
      ],
      book: [s('bk1', '2026-09-01', 'IN', 5000, 'Acme')],
    });
    expect(r.matched).toHaveLength(1);
    expect(r.statementOnly).toHaveLength(2);
  });

  /* Two identical amounts in one week is ordinary. The nearest date wins. */
  it('prefers the nearer date when two entries could serve', () => {
    const r = matchStatement({
      statement: [s('st1', '2026-09-04', 'OUT', 3000, 'Rent')],
      book: [s('far', '2026-09-01', 'OUT', 3000, 'Rent'), s('near', '2026-09-03', 'OUT', 3000, 'Rent')],
    });
    expect(r.matched[0].book.id).toBe('near');
  });

  it('breaks a date tie on the narration', () => {
    const r = matchStatement({
      statement: [s('st1', '2026-09-04', 'OUT', 3000, 'NEFT LANDLORD PROPERTIES')],
      book: [
        s('other', '2026-09-03', 'OUT', 3000, 'Stationery supplies'),
        s('right', '2026-09-05', 'OUT', 3000, 'Landlord Properties rent'),
      ],
    });
    expect(r.matched[0].book.id).toBe('right');
  });

  /*
   * The same file must reconcile the same way on two machines, so nothing may
   * depend on the order rows happened to arrive in.
   */
  it('does not depend on the order of the rows', () => {
    const statement = [s('st1', '2026-09-02', 'IN', 900, 'X'), s('st2', '2026-09-01', 'IN', 900, 'X')];
    const book = [s('bk1', '2026-09-01', 'IN', 900, 'X'), s('bk2', '2026-09-02', 'IN', 900, 'X')];
    const a = matchStatement({ statement, book });
    const b = matchStatement({ statement: [...statement].reverse(), book: [...book].reverse() });
    const pairs = (r) => r.matched.map((m) => `${m.statement.id}->${m.book.id}`).sort();
    expect(pairs(a)).toEqual(pairs(b));
  });

  it('reports what is on neither side of the other', () => {
    const r = matchStatement({
      statement: [s('charge', '2026-09-30', 'OUT', 236, 'Bank charges')],
      book: [s('chq', '2026-09-28', 'OUT', 40000, 'Cheque 400130')],
    });
    expect(r.statementOnly.map((x) => x.id)).toEqual(['charge']);
    expect(r.bookOnly.map((x) => x.id)).toEqual(['chq']);
  });

  it('copes with nothing at all', () => {
    expect(matchStatement()).toEqual({ matched: [], statementOnly: [], bookOnly: [] });
  });
});

describe('how alike two narrations are', () => {
  /* A bank writes NEFT-ACME TRADERS-12345 where the book says Acme Traders. */
  it('sees through a bank reference', () => {
    expect(narrationScore('NEFT-ACME TRADERS-12345', 'Acme Traders')).toBe(1);
  });

  it('is zero for two unrelated narrations', () => {
    expect(narrationScore('Rent for September', 'Bank charges')).toBe(0);
  });

  it('is zero when there is nothing to compare', () => {
    expect(narrationScore('', 'Acme')).toBe(0);
    expect(narrationScore(null, undefined)).toBe(0);
  });
});

describe('the statement an accountant signs', () => {
  /*
   * Balance per the books, plus what the bank has not seen, less what the books
   * have not recorded, equals the balance per the statement.
   */
  it('reconciles an uncleared cheque', () => {
    const r = reconciliationSummary({
      bookBalance: 100000,
      statementBalance: 140000,
      bookOnly: [s('chq', '2026-09-28', 'OUT', 40000, 'Cheque')],
      statementOnly: [],
    });
    expect(r.unpresented).toBe(-40000);
    expect(r.expected).toBe(140000);
    expect(r.difference).toBe(0);
    expect(r.reconciled).toBe(true);
  });

  it('reconciles a bank charge the books have not seen', () => {
    const r = reconciliationSummary({
      bookBalance: 100000,
      statementBalance: 99764,
      bookOnly: [],
      statementOnly: [s('chg', '2026-09-30', 'OUT', 236, 'Charges')],
    });
    expect(r.unrecorded).toBe(-236);
    expect(r.difference).toBe(0);
  });

  /*
   * The number the exercise exists for. A difference that is not zero is the
   * unexplained amount, and it must be stated rather than rounded away.
   */
  it('states what cannot be explained', () => {
    const r = reconciliationSummary({ bookBalance: 100000, statementBalance: 97500, bookOnly: [], statementOnly: [] });
    expect(r.difference).toBe(-2500);
    expect(r.reconciled).toBe(false);
  });

  /* An uncleared receipt and an uncleared payment move it opposite ways. */
  it('signs each side by its direction', () => {
    const r = reconciliationSummary({
      bookBalance: 50000,
      statementBalance: 50000,
      bookOnly: [s('a', '2026-09-01', 'OUT', 1000), s('b', '2026-09-01', 'IN', 1000)],
      statementOnly: [],
    });
    expect(r.unpresented).toBe(0);
    expect(r.difference).toBe(0);
  });

  it('is reconciled at nothing at all', () => {
    expect(reconciliationSummary().reconciled).toBe(true);
  });
});
