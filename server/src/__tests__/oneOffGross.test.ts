import { describe, expect, it } from 'vitest';
import { oneOffWagesOf } from '../services/payroll/run.js';

/*
 * Audit, 17 Nov 2026: professional tax read the structure's gross only, so arrears, a bonus or leave encashment
 * added to a run never moved a person into a higher PT band. The month's one-off earnings now count in gross.
 */
describe('one-off earnings in a run', () => {
  const components = new Map<string, any>([
    ['arr', { type: 'EARNING', includeInPfWage: true, includeInEsiWage: true }],
    ['bonus', { type: 'EARNING' }],
    ['reimb', { type: 'EARNING', includeInGross: false }],
    ['fine', { type: 'DEDUCTION' }],
  ]);
  it('adds every earning paid this month to gross, and only wage components to PF and ESI wages', () => {
    const out = oneOffWagesOf({ components }, [
      { componentId: 'arr', amount: 2000 },
      { componentId: 'bonus', amount: 5000 },
      { componentId: 'reimb', amount: 900 },
      { componentId: 'fine', amount: 300, type: 'DEDUCTION' },
    ]);
    expect(out).toEqual({ pfWage: 2000, esiWage: 2000, gross: 7000 });
  });
});
