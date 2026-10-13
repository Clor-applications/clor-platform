/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it } from 'vitest';

import {
  CASH_RECEIPT_LIMIT,
  cashPaymentWarning,
  cashReceiptWarning,
  negativeCashWarning,
} from './cashLimits';

/**
 * Neither limit was checked anywhere in the product, and both carry a real
 * cost: 40A(3) disallows the whole expense, and 271DA penalises a 269ST breach
 * by the entire amount received.
 */

describe('40A(3) — paying cash', () => {
  it('says nothing at the limit, and warns above it', () => {
    expect(cashPaymentWarning({ amount: 10000 })).toBeNull();
    expect(cashPaymentWarning({ amount: 10001 })?.section).toBe('40A(3)');
  });

  /* Per person per day: two payments under the limit can still breach it. */
  it('counts what the same party was already paid in cash today', () => {
    expect(cashPaymentWarning({ amount: 6000, alreadyToday: 0 })).toBeNull();
    expect(cashPaymentWarning({ amount: 6000, alreadyToday: 6000 })).not.toBeNull();
  });

  it('gives a transporter the higher ceiling', () => {
    expect(cashPaymentWarning({ amount: 30000, isTransporter: true })).toBeNull();
    expect(cashPaymentWarning({ amount: 30000, isTransporter: false })).not.toBeNull();
    expect(cashPaymentWarning({ amount: 36000, isTransporter: true })).not.toBeNull();
  });

  /* Rule 6DD exceptions exist and only the person entering it knows. */
  it('warns rather than blocking', () => {
    expect(cashPaymentWarning({ amount: 50000 })?.severity).toBe('warn');
  });
});

describe('269ST — receiving cash', () => {
  /*
   * The threshold is inclusive. "Two lakh or more" catches exactly two lakh,
   * which is the boundary a business will actually hit.
   */
  it('catches exactly two lakh, and clears one rupee below', () => {
    expect(cashReceiptWarning({ amount: CASH_RECEIPT_LIMIT })).not.toBeNull();
    expect(cashReceiptWarning({ amount: CASH_RECEIPT_LIMIT - 1 })).toBeNull();
  });

  it('counts the rest of the day with the same party', () => {
    expect(cashReceiptWarning({ amount: 100000, alreadyToday: 100000 })).not.toBeNull();
  });

  /* No exception a business can rely on, and the penalty is the full amount. */
  it('blocks rather than warning', () => {
    const w = cashReceiptWarning({ amount: 250000 });
    expect(w?.severity).toBe('block');
    expect(w?.section).toBe('269ST');
  });
});

describe('cash on hand', () => {
  it('refuses to go negative', () => {
    expect(negativeCashWarning({ balanceAfter: 0 })).toBeNull();
    expect(negativeCashWarning({ balanceAfter: -1 })?.severity).toBe('block');
  });
});
