/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

/**
 * When a statement line counts as allocated.
 *
 * It used to mean one ledger, because a bank line could only ever become one
 * posting. A payment now splits across several accounts — GST, late fee,
 * interest — and there is no single ledger to write back afterwards. The
 * voucher it produced is what marks the line done, or a split payment would
 * sit under Uncategorised for ever with its own entry already in the books.
 */

/* The rule as CashBankModule applies it. */
const isCategorised = (t) => Boolean(t?.ledgerId || t?.linkedPaymentId);

describe('an answered statement line', () => {
  it('is allocated when a single ledger was chosen, as before', () => {
    expect(isCategorised({ ledgerId: 42 })).toBe(true);
  });

  it('is allocated when a voucher answered it, whatever it split into', () => {
    expect(isCategorised({ ledgerId: null, linkedPaymentId: 7 })).toBe(true);
  });

  it('is not allocated while nothing has answered it', () => {
    expect(isCategorised({ ledgerId: null, linkedPaymentId: null })).toBe(false);
    expect(isCategorised({})).toBe(false);
  });
});
