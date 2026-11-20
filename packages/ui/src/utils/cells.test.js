import { describe, expect, it } from 'vitest';

import { dateWords } from './dates';
import { moneyCell } from './money';

/* The shared table-cell helpers from the design audit (S7, S8, G5). */
describe('dateWords', () => {
  it('writes a calendar date in words', () => {
    expect(dateWords('2026-12-09')).toBe('9 Dec 2026');
    expect(dateWords('2026-09-30')).toBe('30 Sep 2026');
  });
  it('shows a timestamp as its day in India', () => {
    expect(dateWords('2026-11-19T20:00:00Z')).toBe('20 Nov 2026');
    expect(dateWords(new Date('2026-01-01T10:00:00Z'))).toBe('1 Jan 2026');
  });
  it('shows a dash, or the given empty text, for nothing', () => {
    expect(dateWords('')).toBe('—');
    expect(dateWords(null)).toBe('—');
    expect(dateWords('not a date')).toBe('—');
    expect(dateWords(undefined, '')).toBe('');
  });
});

describe('moneyCell', () => {
  it('has rupees, Indian grouping and two decimals', () => {
    expect(moneyCell(112000)).toBe('₹1,12,000.00');
    expect(moneyCell('1234.5')).toBe('₹1,234.50');
  });
  it('uses a true minus', () => {
    expect(moneyCell(-2500)).toBe('−₹2,500.00');
  });
  it('is a dash at zero unless it is a balance', () => {
    expect(moneyCell(0)).toBe('—');
    expect(moneyCell(null)).toBe('—');
    expect(moneyCell(0.001)).toBe('—');
    expect(moneyCell(0, { zero: true })).toBe('₹0.00');
  });
});
