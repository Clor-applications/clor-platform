import { describe, expect, it } from 'vitest';

import { payrollApp } from '../apps/payroll/manifest.jsx';

/* Sentence case in every app's menu (DESIGN.md Do's; design audit 19 Nov 2026): Payroll alone said "Pay Runs", "Salary Slips". */
describe('Payroll navigation', () => {
  it('uses sentence case for every menu label', () => {
    const NAMES = new Set(['PF', 'ESI', 'TDS', 'PT', 'CLOR']);
    for (const item of payrollApp.nav.filter((i) => i.key)) {
      const [first, ...rest] = item.label.split(' ');
      expect(/^[A-Z]/.test(first), item.label).toBe(true);
      expect(rest.filter((w) => /^[A-Z]/.test(w) && !NAMES.has(w)), item.label).toEqual([]);
    }
  });
});
