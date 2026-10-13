import { describe, expect, it } from 'vitest';

import { allocate, balanceOf, fromPaise, moneyEquals, round2, sumMoney, toPaise } from '../utils/money.js';

/**
 * The rules the books depend on, written down as assertions.
 *
 * Every case here is one the two old `round2` implementations answered
 * differently, or one where float arithmetic answers differently from a
 * person with a pen.
 */

describe('rounding to the paisa', () => {
  it('rounds a half away from zero, which is what a person does', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(0.005)).toBe(0.01);
    expect(round2(-0.005)).toBe(-0.01);
  });

  it('is not fooled by binary representation', () => {
    /* 1.005 * 100 is 100.49999999999999, so the obvious implementation gives
       ₹1.00 — a paisa short, silently. */
    expect(Math.round(1.005 * 100) / 100).toBe(1);
    expect(round2(1.005)).toBe(1.01);
  });

  it('leaves an amount that is already exact alone', () => {
    for (const n of [0, 1, 99.99, 1234.56, -1234.56, 1e6]) {
      expect(round2(n)).toBe(n);
    }
  });

  it('treats nonsense as zero rather than as NaN', () => {
    expect(round2(undefined)).toBe(0);
    expect(round2(null)).toBe(0);
    expect(round2('')).toBe(0);
    expect(round2('abc')).toBe(0);
    expect(round2(Infinity)).toBe(0);
  });

  it('survives the round trip through paise', () => {
    for (const n of [0.01, 0.1, 12.34, 99999.99, -0.07]) {
      expect(fromPaise(toPaise(n))).toBe(n);
    }
  });
});

describe('totals', () => {
  it('adds without drift', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
  });

  it('holds over a long invoice', () => {
    const lines = Array.from({ length: 1000 }, () => 0.01);
    expect(sumMoney(lines)).toBe(10);
  });

  it('compares at the paisa rather than in binary', () => {
    expect(0.1 + 0.2 === 0.3).toBe(false);
    expect(moneyEquals(0.1 + 0.2, 0.3)).toBe(true);
  });
});

describe('splitting an amount', () => {
  it('gives back exactly what it was given', () => {
    const parts = allocate(10, [1, 1, 1]);
    expect(sumMoney(parts)).toBe(10);
    expect(parts).toEqual([3.34, 3.33, 3.33]);
  });

  it('splits by weight, still exactly', () => {
    const parts = allocate(100, [1, 2, 3]);
    expect(sumMoney(parts)).toBe(100);
  });

  it('holds for an awkward GST split', () => {
    /* 18% on ₹1,234.57 is ₹222.2226, halved into CGST and SGST. The two halves
       have to add to the tax, or the return will not tie to the ledger. */
    const tax = round2(1234.57 * 0.18);
    const [cgst, sgst] = allocate(tax, [1, 1]);
    expect(sumMoney([cgst, sgst])).toBe(tax);
  });

  it('refuses to guess when there is nothing to go on', () => {
    expect(allocate(10, [])).toEqual([]);
    expect(allocate(10, [0, 0])).toEqual([0, 0]);
    expect(allocate(0, [1, 1])).toEqual([0, 0]);
    expect(allocate(10, [-1, 1])).toEqual([0, 10]);
  });

  it('is the same split every time it is asked', () => {
    const once = allocate(100, [1, 1, 1, 1, 1, 1, 7]);
    const twice = allocate(100, [1, 1, 1, 1, 1, 1, 7]);
    expect(once).toEqual(twice);
    expect(sumMoney(once)).toBe(100);
  });
});

describe('balancing an entry', () => {
  it('reports zero when the two sides agree', () => {
    expect(balanceOf([100, 18], [118])).toBe(0);
  });

  it('reports the paise, not a boolean', () => {
    expect(balanceOf([100], [99.99])).toBe(1);
    expect(balanceOf([99.99], [100])).toBe(-1);
  });

  it('does not report a difference that is only binary error', () => {
    expect(balanceOf([0.1, 0.2], [0.3])).toBe(0);
  });
});
