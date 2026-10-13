import { describe, expect, it } from 'vitest';

import { allocatedPaymentDate, daysAfter, estimateMsmeInterest, estimateMsmeInterestWithRates, msmeDueDate } from '@ui/utils/msmeCompliance';

describe('MSME compliance calculations', () => {
  it('uses 15 days without a written term and caps written terms at 45 days', () => {
    expect(msmeDueDate({ date: '2026-01-01' }).date).toBe('2026-01-16');
    expect(msmeDueDate({ date: '2026-01-01', dueDate: '2026-01-31' }).date).toBe('2026-01-31');
    expect(msmeDueDate({ date: '2026-01-01', dueDate: '2026-03-31' }).date).toBe('2026-02-15');
  });

  it('counts only days after the statutory due date', () => {
    expect(daysAfter('2026-01-16', '2026-01-16')).toBe(0);
    expect(daysAfter('2026-01-16', '2026-01-20')).toBe(4);
  });

  it('compounds the statutory rate with monthly rests', () => {
    expect(estimateMsmeInterest(100000, 365)).toBeGreaterThan(16500);
    expect(estimateMsmeInterest(100000, 0)).toBe(0);
  });

  it('applies later rates only from their effective dates', () => {
    const result = estimateMsmeInterestWithRates({
      principal: 100000,
      dueDate: '2026-01-01',
      endDate: '2026-03-01',
      rates: [
        { effectiveFrom: '2025-01-01', bankRate: 6 },
        { effectiveFrom: '2026-02-01', bankRate: 5 },
      ],
    });
    const allAtSix = estimateMsmeInterest(100000, 59, 6);
    const allAtFive = estimateMsmeInterest(100000, 59, 5);
    expect(result).toBeLessThan(allAtSix);
    expect(result).toBeGreaterThan(allAtFive);
  });

  it('finds the latest payment allocated to a bill', () => {
    const bill = { id: 7, number: 'B-7', companyId: 1 };
    const payments = [
      { companyId: 1, date: '2026-02-10', allocations: [{ voucherType: 'bill', voucherId: 7 }] },
      { companyId: 1, date: '2026-02-18', allocations: [{ voucherType: 'bill', documentNumber: 'B-7' }] },
    ];
    expect(allocatedPaymentDate(payments, bill)).toBe('2026-02-18');
  });
});
