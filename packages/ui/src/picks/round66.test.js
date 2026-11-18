import { describe, it, expect } from 'vitest';
import { holdable, latePayNote, ordinal, payByDate, payDayWarning, wagesHalfWords } from './round66';

describe('round 66: labour codes on screen', () => {
  it('warns about a pay day after the 7th', () => {
    expect(payDayWarning(7)).toBe('');
    expect(payDayWarning(9)).toBe('Pay day is the 9th. The law asks for salary by the 7th of the next month.');
    expect(payDayWarning(9, 1500)).toBe('');
    expect(payDayWarning('')).toBe('');
    expect(ordinal(23)).toBe('23rd');
  });

  it('says a payroll paid late is late', () => {
    expect(payByDate('2026-12-31')).toBe('2027-01-07');
    expect(latePayNote({ period: { endDate: '2026-08-31' }, payrollDate: '2026-09-07' })).toBe('');
    expect(latePayNote({ period: { endDate: '2026-08-31' }, payrollDate: '2026-09-10' })).toMatch(/^This payroll is paid after 7 Sep\w* 2026\. The law asks for salary by the 7th of the next month\.$/);
    expect(latePayNote({})).toBe('');
  });

  it('splits held salaries from ones that could be held', () => {
    const { held, open } = holdable([
      { id: 'a', heldAt: '2026-09-01', paymentStatus: 'UNPAID', netPay: 100 },
      { id: 'b', heldAt: null, paymentStatus: 'UNPAID', netPay: 100 },
      { id: 'c', heldAt: null, paymentStatus: 'PAID', netPay: 100 },
      { id: 'd', heldAt: null, status: 'CANCELLED', netPay: 100 },
      { id: 'e', heldAt: null, paymentStatus: 'UNPAID', netPay: 0 },
    ]);
    expect(held.map((s) => s.id)).toEqual(['a']);
    expect(open.map((s) => s.id)).toEqual(['b']);
  });

  it('says wages under half of pay in a sentence', () => {
    expect(wagesHalfWords(null)).toBe('');
    expect(wagesHalfWords({ belowHalf: false })).toBe('');
    expect(wagesHalfWords({ belowHalf: true, share: 40, explanation: 'Wages are 40% of pay.' })).toBe('Wages are 40% of pay.');
    expect(wagesHalfWords({ belowHalf: true, share: 40 })).toMatch(/40% of pay/);
  });
});
