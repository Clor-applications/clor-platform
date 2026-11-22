import { describe, expect, it } from 'vitest';

import { costViews } from './PayrollOverview';

/* Payroll → Overview: what payroll has cost as one figure, four views (owner, 22 Nov 2026, style H). */
describe('costViews', () => {
  const trend = [
    { runId: 'r1', number: 'PR-1', periodName: 'September 2026', payrollDate: '2026-09-30', employeeCount: 10, gross: 500000, net: 420000, employerCost: 560000 },
    { runId: 'r2', number: 'PR-2', periodName: 'October 2026', payrollDate: '2026-10-31', employeeCount: 12, gross: 600000, net: 500000, employerCost: 616000 },
  ];

  it('gives four views, each the newest run with its history as columns', () => {
    const v = costViews(trend);
    expect(v.map((x) => x.label)).toEqual(['Company pays', 'Gross', 'Net pay', 'People']);
    expect(v[0].note).toBe('Up 10% on September 2026');
    expect(v[0].points.map((p) => [p.label, p.value])).toEqual([['Sept', 560000], ['Oct', 616000]].map(([l, n]) => [expect.stringMatching(new RegExp(`^${l.slice(0, 3)}`)), n]));
    expect(v[3].value).toBe('12 people');
  });

  it('has nothing to show before a run, and no change with one run', () => {
    expect(costViews([])).toEqual([]);
    expect(costViews(trend.slice(0, 1))[1].note).toBe('September 2026');
  });
});
