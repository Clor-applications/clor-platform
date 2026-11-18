import { describe, expect, it } from 'vitest';
import { countAmount, countWords, earlierNoteTitle, plural, splitLines } from './payLines.js';

describe('pay lines (server picks batch 2)', () => {
  it('says a count × rate line in words', () => {
    expect(countWords({ quantity: 22, rate: 30, unit: 'meal' })).toBe('22 meals × ₹30');
    expect(countWords({ quantity: 1, rate: 150, unit: 'night' })).toBe('1 night × ₹150');
    expect(countWords({ quantity: 340, rate: 4.5, unit: 'piece' })).toBe('340 pieces × ₹4.5');
    expect(countWords({ quantity: 3, rate: 10 })).toBe('3 × ₹10');
    expect(countWords({ amount: 500 })).toBe('');
  });

  it('makes plurals', () => {
    expect(plural('batch', 2)).toBe('batches');
    expect(plural('delivery', 2)).toBe('deliveries');
    expect(plural('day', 2)).toBe('days');
  });

  it('works out the amount to the paisa', () => {
    expect(countAmount(22, 30)).toBe(660);
    expect(countAmount(3, 33.333)).toBe(100);
    expect(countAmount(0, 30)).toBe(0);
  });

  it('splits a salary change by days', () => {
    expect(splitLines(null)).toEqual([]);
    expect(splitLines([{ from: '2026-04-01', days: 10, monthly: 50000 }, { from: '2026-04-11', days: 20, monthly: 60000 }])).toEqual([
      '10 days from 1 Apr at ₹50,000 a month',
      '20 days from 11 Apr at ₹60,000 a month',
    ]);
  });

  it('titles the earlier note', () => {
    expect(earlierNoteTitle({ period: 'March 2026', runNumber: 'PR-0003' })).toBe('From March 2026’s payroll (PR-0003)');
    expect(earlierNoteTitle(null)).toBe('');
  });
});
