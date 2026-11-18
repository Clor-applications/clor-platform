import { describe, it, expect } from 'vitest';

import { payDayCheck, wagesCheck, ordinal } from '../services/payroll/labourCodes.js';
import { esiPeriodOf } from '../services/payroll/run.js';
import { gratuityFor, GRATUITY_DEFAULTS } from '../services/payroll/finalSettlement.js';
import { computeStatutory, type StatutoryRuleInput } from '../services/payroll/statutory/engine.js';
import { SEED_RULES } from '../services/payroll/statutory/defaults.js';

/**
 * Round 66: labour codes and statutory pay rules. The plain rules a company
 * breaks without noticing: wages under half of pay, salary after the 7th,
 * ESI stopped the month a raise arrives, and fixed-term staff denied gratuity.
 */

describe('wages at least half of pay', () => {
  it('counts the gap back as wages when basic and DA are under half', () => {
    const r = wagesCheck(20000, 50000)!;
    expect(r.belowHalf).toBe(true);
    expect(r.share).toBe(40);
    expect(r.countedWages).toBe(25000);
    expect(r.addedBack).toBe(5000);
    expect(r.explanation).toMatch(/at least half/);
  });

  it('is content at exactly half, and says nothing without pay', () => {
    expect(wagesCheck(25000, 50000)!.belowHalf).toBe(false);
    expect(wagesCheck(25000, 50000)!.addedBack).toBe(0);
    expect(wagesCheck(0, 0)).toBeNull();
  });
});

describe('pay by the 7th', () => {
  it('warns after the 7th, and after the 10th for 1,000 or more people', () => {
    expect(payDayCheck(7)).toBeNull();
    expect(payDayCheck(10)!.message).toBe('Pay day is the 10th. The law asks for salary by the 7th of the next month.');
    expect(payDayCheck(10, 1200)).toBeNull();
    expect(payDayCheck(12, 1200)!.limit).toBe(10);
    expect(payDayCheck(null)).toBeNull();
  });

  it('says ordinals as read', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 31].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '31st']);
  });
});

describe('ESI contribution periods', () => {
  it('runs April to September and October to March', () => {
    expect(esiPeriodOf('2026-04-01')).toEqual({ start: '2026-04-01', ends: '30 Sep 2026' });
    expect(esiPeriodOf('2026-09-01')).toEqual({ start: '2026-04-01', ends: '30 Sep 2026' });
    expect(esiPeriodOf('2026-11-01')).toEqual({ start: '2026-10-01', ends: '31 Mar 2027' });
    expect(esiPeriodOf('2027-02-01')).toEqual({ start: '2026-10-01', ends: '31 Mar 2027' });
  });

  const seed = SEED_RULES.find((r) => r.scheme === 'ESI')!;
  const rule: StatutoryRuleInput = {
    id: 'rule-ESI',
    scheme: seed.scheme,
    version: seed.version,
    jurisdiction: seed.jurisdiction,
    employeeRate: seed.employeeRate,
    employerRate: seed.employerRate,
    wageCeiling: seed.wageCeiling,
    eligibilityThreshold: seed.eligibilityThreshold,
    rounding: seed.rounding,
    config: seed.config as Record<string, any>,
  };
  const employee = (over: Record<string, unknown> = {}) => ({ pfApplicable: true, esiApplicable: true, ptApplicable: true, professionalTaxState: 'KARNATAKA', taxRegime: 'NEW' as const, ...over });
  const context = { month: 8, monthsRemaining: 8, taxAlreadyDeducted: 0 };

  it('keeps ESI after a raise until the period ends, then explains why', () => {
    const stopped = computeStatutory(rule, { pfWage: 0, esiWage: 23000, gross: 23000 }, employee(), context);
    expect(stopped.exemptReason).toBe('ABOVE_THRESHOLD');

    const continuing = computeStatutory(rule, { pfWage: 0, esiWage: 23000, gross: 23000 }, employee({ esiContinuesUntil: '30 Sep 2026' }), context);
    expect(continuing.exemptReason).toBeFalsy();
    expect(continuing.employee).toBeGreaterThan(0);
    expect(continuing.explanation).toMatch(/continues until the contribution period ends on 30 Sep 2026/);
  });
});

describe('fixed-term gratuity', () => {
  it('is owed after one year for fixed-term staff, five for others', () => {
    const regular = gratuityFor(26000, '2025-01-01', '2026-06-30');
    expect(regular.amount).toBe(0);
    const fixed = gratuityFor(26000, '2025-01-01', '2026-06-30', { ...GRATUITY_DEFAULTS, minimumYears: 1 });
    /* 1 year 5 months rounds to 1 year: 15/26 × 26,000 × 1. */
    expect(fixed.amount).toBe(15000);
  });
});
