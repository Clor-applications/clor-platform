import { describe, expect, it } from 'vitest';

import { signupViews } from './Home';


describe('signupViews', () => {
  it('gives nothing without sign-ups', () => {
    expect(signupViews([])).toEqual([]);
  });

  it('counts the month day by day and in weeks back from today', () => {
    const series = Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.UTC(2026, 9, 24 + i)).toISOString().slice(0, 10), count: i % 3 === 0 ? 2 : 0 }));
    const [byDay, byWeek] = signupViews(series);
    expect(byDay.points).toHaveLength(30);
    expect(byDay.value).toBe('20 new accounts');
    expect(byWeek.points).toHaveLength(5);
    expect(byWeek.points.reduce((s, p) => s + p.value, 0)).toBe(20);
    /* The last week is the seven days to today; the first is the two left over. */
    expect(byWeek.points[4].label).toBe('16 Nov to 22 Nov');
    expect(byWeek.points[0].label).toBe('24 Oct to 25 Oct');
    expect(byWeek.short).toBe(`${byWeek.points[4].value} this week`);
  });
});
