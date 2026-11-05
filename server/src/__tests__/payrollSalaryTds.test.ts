import { describe, it, expect } from 'vitest';

import { ageBandFor, computeStatutory, incomeTax, type StatutoryRuleInput } from '../services/payroll/statutory/engine.js';
import { SEED_RULES } from '../services/payroll/statutory/defaults.js';
import { isEmployerNps, taxablePayOf } from '../services/payroll/taxablePay.js';

/**
 * Salary TDS on the right amount: taxable pay only, professional tax and
 * employer NPS off it, the old regime's slabs by age, surcharge with marginal
 * relief, a previous employer's salary and tax (Form 12B), and 20% without a
 * PAN (section 206AA).
 *
 * Every figure is worked by hand in the comment beside it, from the FY 2025-26
 * and 2026-27 rates (Income-tax Act 1961 / Finance Act 2025; Income-tax Act
 * 2025 / Finance Act 2026 — the same figures). Each rule is tested at its edge:
 * the last rupee that does not trigger it and the first that does.
 */

const tdsRule = (version: string): StatutoryRuleInput => {
  const seed = SEED_RULES.find((r) => r.scheme === 'TDS' && r.version === version)!;
  return {
    id: `rule-TDS-${version}`,
    scheme: 'TDS',
    version: seed.version,
    jurisdiction: seed.jurisdiction,
    employeeRate: 0,
    employerRate: 0,
    wageCeiling: null,
    eligibilityThreshold: null,
    rounding: seed.rounding,
    config: seed.config as Record<string, any>,
  };
};
/* 2026-27 writes every figure down; 2025-26 leaves the new ones to the engine. Both must agree. */
const RULES = [tdsRule('2026-04-01'), tdsRule('2025-04-01')];
const rule = RULES[0];

const employee = (over: Record<string, unknown> = {}) => ({
  pfApplicable: false,
  esiApplicable: false,
  ptApplicable: false,
  taxRegime: 'NEW' as const,
  ...over,
});
const year = { month: 4, monthsRemaining: 12, taxAlreadyDeducted: 0 };
const pay = (annualTaxable: number, over: Record<string, unknown> = {}) => ({ pfWage: 0, esiWage: 0, gross: 0, annualTaxable, ...over });

/* Taxable income in, after the standard deduction: the new regime's ₹75,000 or the old one's ₹50,000. */
const NEW_SD = 75_000;
const OLD_SD = 50_000;

describe('the seed rules', () => {
  it('has a 2026-27 version under the Income-tax Act 2025 with the same figures as 2025-26', () => {
    const [y26, y25] = RULES;
    expect(y26.config.newRegimeBands).toEqual(y25.config.newRegimeBands);
    expect(y26.config.oldRegimeBands).toEqual(y25.config.oldRegimeBands);
    expect(y26.config.standardDeduction).toBe(75_000);
    expect(y26.config.rebateUpTo).toBe(1_200_000);
    expect(y26.config.oldRegime.rebateUpTo).toBe(500_000);
    expect(y26.config.noPanRate).toBe(20);
  });
});

describe('taxable pay, not gross', () => {
  it('leaves out components that are not taxable and counts employer NPS', () => {
    const p = taxablePayOf([
      { type: 'EARNING', code: 'BASIC', amount: 50_000, isTaxable: true, employerNps: false },
      { type: 'EARNING', code: 'HRA', amount: 20_000, isTaxable: true, employerNps: false },
      /* Reimbursed against bills: paid, never taxed. */
      { type: 'EARNING', code: 'REIMB', amount: 5_000, isTaxable: false, employerNps: false },
      /* Not in gross, but salary for tax (17(1)(viii)). */
      { type: 'EMPLOYER_CONTRIBUTION', code: 'ER_NPS', amount: 5_000, isTaxable: false, employerNps: true },
      { type: 'EMPLOYER_CONTRIBUTION', code: 'ER_PF', amount: 1_800, isTaxable: false, employerNps: false },
      { type: 'DEDUCTION', code: 'EPF', amount: 1_800, isTaxable: false, employerNps: false },
    ]);
    /* 50,000 + 20,000 + 5,000 of NPS. */
    expect(p).toEqual({ taxable: 75_000, employerNps: 5_000, basicDa: 50_000 });
  });

  it('knows employer NPS by its mark or by a usual code', () => {
    expect(isEmployerNps({ taxSection: 'EMPLOYER_NPS', code: 'PENSION_CO' })).toBe(true);
    expect(isEmployerNps({ code: 'er_nps' })).toBe(true);
    expect(isEmployerNps({ code: 'NPS' })).toBe(false);
    expect(isEmployerNps(null)).toBe(false);
  });
});

describe('professional tax under section 16(iii)', () => {
  it.each(RULES)('comes off salary under the old regime (%#)', (r) => {
    /* ₹10,00,000 − 50,000 − 2,400 = 9,47,600: 12,500 + 20% of 4,47,600 = 1,02,020, cess 4,080.80. */
    const y = incomeTax(r, 'OLD', 1_000_000, 0, { professionalTax: 2_400 })!;
    expect(y.professionalTax).toBe(2_400);
    expect(y.taxable).toBe(947_600);
    expect(y.total).toBe(106_100.8);
  });

  it('is held to ₹2,500 a year, the Constitution’s limit', () => {
    expect(incomeTax(rule, 'OLD', 1_000_000, 0, { professionalTax: 3_000 })!.professionalTax).toBe(2_500);
  });

  it('is not deducted under the new regime, which allows only the standard deduction', () => {
    const y = incomeTax(rule, 'NEW', 1_500_000, 0, { professionalTax: 2_400 })!;
    expect(y.professionalTax).toBe(0);
    expect(y.taxable).toBe(1_500_000 - NEW_SD);
  });

  it('reaches monthly TDS through the wages', () => {
    const r = computeStatutory(rule, pay(1_000_000, { professionalTax: 2_400 }), employee({ taxRegime: 'OLD' }), year);
    expect(r.employee).toBe(Math.round(106_100.8 / 12));
    expect(r.explanation).toMatch(/professional tax/);
  });
});

describe('the old regime’s slabs by age', () => {
  it.each(RULES)('taxes a senior and a very senior citizen on their own slabs (%#)', (r) => {
    const at = (age: 'SENIOR' | 'SUPER_SENIOR' | null, taxable: number) => incomeTax(r, 'OLD', taxable + OLD_SD, 0, { ageBand: age })!;
    /* ₹10 lakh taxable: 1,12,500 under 60, 1,10,000 at 60, 1,00,000 at 80. */
    expect(at(null, 1_000_000).slabTax).toBe(112_500);
    expect(at('SENIOR', 1_000_000).slabTax).toBe(110_000);
    expect(at('SUPER_SENIOR', 1_000_000).slabTax).toBe(100_000);
  });

  it('starts a senior’s tax at ₹3 lakh, not ₹2.5 lakh', () => {
    const at = (taxable: number) => incomeTax(rule, 'OLD', taxable + OLD_SD, 0, { ageBand: 'SENIOR' })!;
    expect(at(300_000).slabTax).toBe(0);
    expect(at(310_000).slabTax).toBe(500);
    expect(incomeTax(rule, 'OLD', 310_000 + OLD_SD)!.slabTax).toBe(3_000);
  });

  it('starts a very senior citizen’s tax at ₹5 lakh, and at 20%', () => {
    const at = (taxable: number) => incomeTax(rule, 'OLD', taxable + OLD_SD, 0, { ageBand: 'SUPER_SENIOR' })!;
    expect(at(500_000).total).toBe(0);
    /* 20% of 10,000, no 87A rebate above ₹5 lakh, plus cess. */
    expect(at(510_000).total).toBe(2_080);
  });

  it('gives the new regime one set of slabs for everybody', () => {
    const senior = incomeTax(rule, 'NEW', 2_000_000, 0, { ageBand: 'SUPER_SENIOR' })!;
    expect(senior.ageBand).toBeNull();
    expect(senior.total).toBe(incomeTax(rule, 'NEW', 2_000_000)!.total);
  });

  it('counts somebody as 60 if they are 60 at any time in the year', () => {
    /* A person attains an age the day before the birthday: born 1 April 1966, 60 on 31 March 2026. */
    expect(ageBandFor('1966-04-01', '2025-09-30')).toBe('SENIOR');
    expect(ageBandFor('1966-04-02', '2025-09-30')).toBeNull();
    expect(ageBandFor('1966-04-02', '2026-04-30')).toBe('SENIOR');
    expect(ageBandFor('1946-04-01', '2025-04-30')).toBe('SUPER_SENIOR');
    expect(ageBandFor('1946-04-02', '2026-03-31')).toBe('SENIOR');
    expect(ageBandFor(null, '2026-04-30')).toBeNull();
    expect(ageBandFor('not a date', '2026-04-30')).toBeNull();
  });
});

describe('the rebate lines', () => {
  it('stops the new regime’s rebate at ₹12 lakh, with marginal relief above', () => {
    expect(incomeTax(rule, 'NEW', 1_200_000 + NEW_SD)!.total).toBe(0);
    /* ₹10 above the line: tax 60,001, held to 10, plus cess. */
    expect(incomeTax(rule, 'NEW', 1_200_010 + NEW_SD)!.total).toBe(10.4);
  });

  it('stops the old regime’s rebate at ₹5 lakh, with no marginal relief', () => {
    expect(incomeTax(rule, 'OLD', 500_000 + OLD_SD)!.total).toBe(0);
    /* 12,500 + 20% of 10 = 12,502, plus 500.08 cess. */
    expect(incomeTax(rule, 'OLD', 500_010 + OLD_SD)!.total).toBe(13_002.08);
  });
});

describe('surcharge, with marginal relief', () => {
  /* New regime slab tax on ₹50 lakh: 20,000 + 40,000 + 60,000 + 80,000 + 1,00,000 + 30% of 26 lakh = 10,80,000. */
  const NEW_AT_50L = 1_080_000;

  it.each(RULES)('charges none on ₹50 lakh exactly (%#)', (r) => {
    const y = incomeTax(r, 'NEW', 5_000_000 + NEW_SD)!;
    expect(y.surcharge).toBe(0);
    expect(y.total).toBe(NEW_AT_50L * 1.04);
  });

  it.each(RULES)('just over ₹50 lakh, adds no more than the income above the line (%#)', (r) => {
    /* 10,83,000 tax + 10% = 11,91,300, but at most 10,80,000 + 10,000: surcharge 7,000. */
    const y = incomeTax(r, 'NEW', 5_010_000 + NEW_SD)!;
    expect(y.surchargeRate).toBe(10);
    expect(y.surcharge).toBe(7_000);
    expect(y.surchargeRelief).toBe(101_300);
    expect(y.total).toBe(1_133_600);
  });

  it('stops the relief once the full surcharge costs less than the income above the line', () => {
    /* ₹52 lakh: 11,40,000 + 1,14,000 = 12,54,000, under the 12,80,000 ceiling. */
    const y = incomeTax(rule, 'NEW', 5_200_000 + NEW_SD)!;
    expect(y.surcharge).toBe(114_000);
    expect(y.surchargeRelief).toBe(0);
    expect(y.total).toBe(1_304_160);
  });

  it('keeps 10% on ₹1 crore exactly, and relieves the step to 15% just above', () => {
    /* ₹1 crore: 10,80,000 + 30% of 50 lakh = 25,80,000; surcharge 10% = 2,58,000. */
    const at = incomeTax(rule, 'NEW', 10_000_000 + NEW_SD)!;
    expect(at.surchargeRate).toBe(10);
    expect(at.surcharge).toBe(258_000);
    /* ₹1,00,10,000: 25,83,000 + 15% would be 29,70,450; at most 25,80,000 + 2,58,000 + 10,000. */
    const over = incomeTax(rule, 'NEW', 10_010_000 + NEW_SD)!;
    expect(over.surchargeRate).toBe(15);
    expect(over.surcharge).toBe(265_000);
  });

  it.each(RULES)('caps the new regime at 25% and takes the old to 37% above ₹5 crore (%#)', (r) => {
    /* ₹6 crore new: 10,80,000 at ₹50 lakh + 30% of 5.5 crore = 1,75,80,000; 25% = 43,95,000. */
    const neu = incomeTax(r, 'NEW', 60_000_000 + NEW_SD)!;
    expect(neu.surchargeRate).toBe(25);
    expect(neu.surcharge).toBe(4_395_000);
    /* ₹6 crore old: 1,12,500 + 30% of 5.9 crore = 1,78,12,500; 37% = 65,90,625. */
    const old = incomeTax(r, 'OLD', 60_000_000 + OLD_SD)!;
    expect(old.surchargeRate).toBe(37);
    expect(old.surcharge).toBe(6_590_625);
  });

  it('relieves the old regime’s step from 25% to 37%', () => {
    /* ₹5,00,10,000: tax 1,48,15,500; at most 1,48,12,500 × 1.25 + 10,000 = 1,85,25,625, so surcharge 37,10,125. */
    const y = incomeTax(rule, 'OLD', 50_010_000 + OLD_SD)!;
    expect(y.surchargeRate).toBe(37);
    expect(y.surcharge).toBe(3_710_125);
  });

  it('puts cess on the surcharge too', () => {
    const y = incomeTax(rule, 'NEW', 5_200_000 + NEW_SD)!;
    expect(y.cess).toBe(Math.round((y.tax + y.surcharge) * 0.04 * 100) / 100);
  });
});

describe('employer NPS under section 80CCD(2)', () => {
  it.each(RULES)('allows up to 14% of Basic and DA under the new regime (%#)', (r) => {
    /* ₹12,84,000 including ₹1 lakh NPS, Basic ₹6 lakh: 84,000 off leaves 11,25,000 — under the rebate line. */
    const y = incomeTax(r, 'NEW', 1_284_000, 0, { employerNps: 100_000, npsWage: 600_000 })!;
    expect(y.employerNps).toBe(84_000);
    expect(y.taxable).toBe(1_125_000);
    expect(y.total).toBe(0);
    /* Without it: 12,09,000 taxable, held to 9,000 by marginal relief, plus cess. */
    expect(incomeTax(r, 'NEW', 1_284_000)!.total).toBe(9_360);
  });

  it.each(RULES)('allows up to 10% under the old regime (%#)', (r) => {
    expect(incomeTax(r, 'OLD', 1_284_000, 0, { employerNps: 100_000, npsWage: 600_000 })!.employerNps).toBe(60_000);
  });

  it('allows the whole contribution when it is within the limit', () => {
    expect(incomeTax(rule, 'NEW', 1_284_000, 0, { employerNps: 84_000, npsWage: 600_000 })!.employerNps).toBe(84_000);
    expect(incomeTax(rule, 'NEW', 1_284_000, 0, { employerNps: 50_000, npsWage: 600_000 })!.employerNps).toBe(50_000);
  });

  it('allows nothing with no Basic to measure it against', () => {
    expect(incomeTax(rule, 'NEW', 1_284_000, 0, { employerNps: 50_000 })!.employerNps).toBe(0);
  });
});

describe('a previous employer this year (Form 12B)', () => {
  it('taxes the whole year’s salary, less what that employer withheld', () => {
    /* ₹10 lakh here + ₹10 lakh there = ₹20 lakh: 19,25,000 taxable, 1,85,000 + cess = 1,92,400,
       less 50,000 withheld there, over 12 months. Here alone it would be nil (under the rebate line). */
    const r = computeStatutory(rule, pay(1_000_000, { previousEmployer: { income: 1_000_000, tds: 50_000 } }), employee(), year);
    expect(r.employee).toBe(Math.round(142_400 / 12));
    expect(r.explanation).toMatch(/previous employer/);
    expect(computeStatutory(rule, pay(1_000_000), employee(), year).employee).toBe(0);
  });

  it('never refunds through payroll when the previous employer withheld more', () => {
    const r = computeStatutory(rule, pay(1_000_000, { previousEmployer: { income: 1_000_000, tds: 500_000 } }), employee(), year);
    expect(r.employee).toBe(0);
  });
});

describe('no PAN: section 206AA', () => {
  const noPan = (over: Record<string, unknown> = {}) => employee({ hasPan: false, ...over });

  it.each(RULES)('withholds 20% when that is more than the slabs give (%#)', (r) => {
    /* ₹20 lakh: 19,25,000 taxable; the slabs give 1,92,400, 20% gives 3,85,000 — no cess on the 20%. */
    const t = computeStatutory(r, pay(2_000_000), noPan(), year);
    expect(t.noPanRate).toBe(20);
    expect(t.employee).toBe(Math.round(385_000 / 12));
    expect(t.explanation).toMatch(/no PAN/);
    expect(t.explanation).toMatch(/206AA/);
  });

  it('withholds nothing while income is within the taxable limit', () => {
    expect(computeStatutory(rule, pay(400_000 + NEW_SD), noPan(), year).employee).toBe(0);
    /* One rupee over ₹4 lakh, and 20% of it all: 80,000.20 for the year. */
    expect(computeStatutory(rule, pay(400_001 + NEW_SD), noPan(), year).employee).toBe(Math.round(80_000.2 / 12));
  });

  it('uses the senior’s own limit under the old regime', () => {
    expect(computeStatutory(rule, pay(300_000 + OLD_SD), noPan({ taxRegime: 'OLD', ageBand: 'SENIOR' }), year).employee).toBe(0);
    expect(computeStatutory(rule, pay(300_000 + OLD_SD), noPan({ taxRegime: 'OLD' }), year).employee).toBe(5_000);
  });

  it('keeps the slab rate where it is above 20%', () => {
    /* ₹1 crore: (25,80,000 + 2,58,000) × 1.04 = 29,51,520, more than 20% (20,00,000). */
    const t = computeStatutory(rule, pay(10_000_000 + NEW_SD), noPan(), year);
    expect(t.noPanRate).toBeUndefined();
    expect(t.employee).toBe(Math.round(2_951_520 / 12));
  });

  it('assumes a PAN when nobody says otherwise', () => {
    expect(computeStatutory(rule, pay(2_000_000), employee(), year).employee).toBe(Math.round(192_400 / 12));
  });
});
