/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it } from 'vitest';

import { applyPaymentReversal } from './paymentService';

/**
 * Reversing a voucher: kept on record, settlement given back, TDS answered
 * by its lineage pair — the same unwinding the server does to its posting.
 */

const db0 = {
  payments: [
    {
      id: 5,
      companyId: 1,
      voucherType: 'payment',
      number: 'PAY-0005',
      amount: 116000,
      tdsAmount: 2000,
      allocations: [{ voucherType: 'bill', voucherId: 71, amount: 116000 }],
    },
  ],
  bills: [
    { id: 71, companyId: 1, number: 'BILL-71', total: 118000, tdsAmount: 2000, paidAmount: 116000, status: 'Paid' },
  ],
  expenses: [],
  invoices: [],
  tdsTransactions: [
    { id: 9, companyId: 1, sourceType: 'payment', sourceId: 5, side: 'PAYABLE', status: 'Posted', baseAmount: 100000, rate: 2, tdsAmount: 2000, reversalOfId: null },
  ],
};

describe('reversing a payment', () => {
  it('unwinds the settlement at the net target and pairs out the TDS event', () => {
    const next = applyPaymentReversal(db0, 1, 5, { by: 'suresh@neev.one', reason: 'Wrong vendor' });

    /* The voucher stays, marked. */
    const pmt = next.payments.find((p) => p.id === 5);
    expect(pmt.status).toBe('Reversed');
    expect(pmt.reversedBy).toBe('suresh@neev.one');

    /* The bill is outstanding again — Unpaid, not deleted history. */
    const bill = next.bills.find((b) => b.id === 71);
    expect(bill).toMatchObject({ paidAmount: 0, status: 'Unpaid' });

    /* The payment-stage event: Reversed original + Reversal row, net zero. */
    const original = next.tdsTransactions.find((e) => e.id === 9);
    const pair = next.tdsTransactions.find((e) => e.reversalOfId === 9);
    expect(original.status).toBe('Reversed');
    expect(pair).toMatchObject({ status: 'Reversal', tdsAmount: -2000, reversalReason: 'Wrong vendor' });
  });

  it('reversing twice is a no-op', () => {
    const once = applyPaymentReversal(db0, 1, 5, {});
    const twice = applyPaymentReversal(once, 1, 5, {});
    expect(twice).toBe(once);
  });
});
