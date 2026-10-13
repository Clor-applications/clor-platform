/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it } from 'vitest';
import { bookState, setupSteps, BOOK_NEW, BOOK_SETUP, BOOK_RUNNING } from './bookState';

const co = { id: 1, state: 'Karnataka', gstin: '' };
const empty = { customers: [], items: [], invoices: [], bills: [], vendors: [] };

describe('what state the book is in', () => {
  it('a book with nothing in it is new', () => {
    expect(bookState(empty, co)).toBe(BOOK_NEW);
  });

  /*
   * The case from the screenshot: bills and stock entered, nothing billed.
   * Home used to call this "every invoice is settled".
   */
  it('purchases entered and nothing billed is mid-setup, not running', () => {
    const db = { ...empty, bills: [{ companyId: 1 }], items: [{ companyId: 1 }] };
    expect(bookState(db, co)).toBe(BOOK_SETUP);
  });

  /* A draft is an intention. It does not make a book operational. */
  it('a draft invoice alone does not count as billed', () => {
    const db = { ...empty, invoices: [{ companyId: 1, status: 'Draft' }] };
    expect(bookState(db, co)).toBe(BOOK_SETUP);
  });

  it('a posted invoice puts the book in use', () => {
    const db = { ...empty, invoices: [{ companyId: 1, status: 'Unpaid' }] };
    expect(bookState(db, co)).toBe(BOOK_RUNNING);
  });

  it('reads another company as its own book', () => {
    const db = { ...empty, invoices: [{ companyId: 99, status: 'Paid' }] };
    expect(bookState(db, co)).toBe(BOOK_NEW);
  });
});

describe('the setup list', () => {
  it('ticks what is done and leaves the rest', () => {
    const db = { ...empty, customers: [{ companyId: 1 }] };
    const steps = setupSteps(db, co);
    const by = Object.fromEntries(steps.map((s) => [s.key, s.done]));
    expect(by.company).toBe(true);   // state is set
    expect(by.customer).toBe(true);
    expect(by.item).toBe(false);
    expect(by.invoice).toBe(false);
  });

  it('marks GSTIN optional, because not every business has one', () => {
    const step = setupSteps(empty, co).find((s) => s.key === 'gstin');
    expect(step.optional).toBe(true);
    expect(step.done).toBe(false);
  });

  it('every step says where it goes', () => {
    expect(setupSteps(empty, co).every((s) => s.go && s.cta)).toBe(true);
  });
});
