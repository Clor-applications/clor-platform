import { describe, it, expect } from 'vitest';

import { computeStatutory, ruleInForce, type StatutoryRuleInput } from '../services/payroll/statutory/engine.js';
import { SEED_RULES } from '../services/payroll/statutory/defaults.js';

/**
 * The amounts a company does not get to decide.
 *
 * These are set by law, they change on dates somebody else picks, and getting
 * one wrong is a penalty rather than an apology. So the tests are written as
 * the real cases: the PF ceiling that makes two very different salaries
 * contribute the same amount, the ESI threshold that a small raise can push
 * somebody over, a professional tax that differs by state and in one case by
 * month, and a rate change that must not reach backwards.
 */

const rule = (scheme: string, over: Partial<StatutoryRuleInput> = {}): StatutoryRuleInput => {
  const seed = SEED_RULES.find((r) => r.scheme === scheme)!;
  return {
    id: `rule-${scheme}`,
    scheme: seed.scheme,
    version: seed.version,
    jurisdiction: seed.jurisdiction,
    employeeRate: seed.employeeRate,
    employerRate: seed.employerRate,
    wageCeiling: seed.wageCeiling,
    eligibilityThreshold: seed.eligibilityThreshold,
    rounding: seed.rounding,
    config: seed.config as Record<string, any>,
    ...over,
  };
};

const pt = (jurisdiction: string) => {
  const seed = SEED_RULES.find((r) => r.scheme === 'PT' && r.jurisdiction === jurisdiction)!;
  return {
    id: `rule-PT-${jurisdiction}`,
    scheme: 'PT' as const,
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

const employee = (over: Record<string, unknown> = {}) => ({
  pfApplicable: true,
  esiApplicable: true,
  ptApplicable: true,
  professionalTaxState: 'KARNATAKA',
  taxRegime: 'NEW' as const,
  ...over,
});

const context = { month: 9, monthsRemaining: 7, taxAlreadyDeducted: 0 };

describe('provident fund', () => {
  it('takes 12% of PF wages below the ceiling', async () => {
    const r = computeStatutory(rule('PF'), { pfWage: 12000, esiWage: 12000, gross: 12000 }, employee(), context);
    expect(r.employee).toBe(1440);
    expect(r.employer).toBe(1440);
  });

  it('stops growing at the ceiling, which is why two salaries contribute the same', async () => {
    /* The single most misunderstood figure in Indian payroll. */
    const modest = computeStatutory(rule('PF'), { pfWage: 60000, esiWage: 60000, gross: 60000 }, employee(), context);
    const large = computeStatutory(rule('PF'), { pfWage: 150000, esiWage: 150000, gross: 150000 }, employee(), context);

    expect(modest.employee).toBe(1800);
    expect(large.employee).toBe(1800);
    expect(modest.explanation).toMatch(/ceiling/i);
  });

  it('splits the employer share into pension and fund', async () => {
    /* The employer's 12% is not one payment: 8.33% goes to EPS, capped on its
       own ceiling, and the rest to EPF. */
    const r = computeStatutory(rule('PF'), { pfWage: 15000, esiWage: 15000, gross: 15000 }, employee(), context);
    expect(r.employer).toBe(1800);
    expect(r.employerSplit?.EPS).toBe(1250);
    expect(r.employerSplit?.EPF).toBe(550);
    expect(r.employerSplit!.EPS + r.employerSplit!.EPF).toBe(r.employer);
  });

  it('contributes on the whole wage where a company has chosen to', async () => {
    const full = rule('PF', { config: { ...(rule('PF').config as any), contributeOnFullWage: true } });
    const r = computeStatutory(full, { pfWage: 60000, esiWage: 60000, gross: 60000 }, employee(), context);
    expect(r.employee).toBe(7200);
  });

  it('deducts nothing from somebody it does not apply to', async () => {
    const r = computeStatutory(rule('PF'), { pfWage: 50000, esiWage: 50000, gross: 50000 }, employee({ pfApplicable: false }), context);
    expect(r.employee).toBe(0);
    expect(r.exemptReason).toBe('NOT_APPLICABLE');
  });

  it('honours a voluntary higher contribution', async () => {
    const r = computeStatutory(
      rule('PF'),
      { pfWage: 15000, esiWage: 15000, gross: 15000 },
      employee({ overrideEmployeeRate: 20 }),
      context
    );
    expect(r.employee).toBe(3000);
  });
});

describe('employee state insurance', () => {
  it('takes its share from somebody under the threshold', async () => {
    const r = computeStatutory(rule('ESI'), { pfWage: 15000, esiWage: 20000, gross: 20000 }, employee(), context);
    expect(r.employee).toBe(150);
    expect(r.employer).toBe(650);
  });

  it('does not apply above the threshold at all', async () => {
    /* A threshold, not a ceiling — so a small raise can end somebody's cover,
       and payroll should not discover that by accident. */
    const under = computeStatutory(rule('ESI'), { pfWage: 0, esiWage: 21000, gross: 21000 }, employee(), context);
    const over = computeStatutory(rule('ESI'), { pfWage: 0, esiWage: 21001, gross: 21001 }, employee(), context);

    expect(under.employee).toBeGreaterThan(0);
    expect(over.employee).toBe(0);
    expect(over.exemptReason).toBe('ABOVE_THRESHOLD');
    expect(over.explanation).toMatch(/threshold/i);
  });

  it('rounds up, as ESI is collected', async () => {
    const r = computeStatutory(rule('ESI'), { pfWage: 0, esiWage: 10001, gross: 10001 }, employee(), context);
    expect(Number.isInteger(r.employee)).toBe(true);
    expect(r.employee).toBe(Math.ceil((10001 * 0.75) / 100));
  });
});

describe('professional tax', () => {
  it('follows the slabs of the state somebody is taxed in', async () => {
    const low = computeStatutory(pt('KARNATAKA'), { pfWage: 0, esiWage: 0, gross: 20000 }, employee(), context);
    const high = computeStatutory(pt('KARNATAKA'), { pfWage: 0, esiWage: 0, gross: 30000 }, employee(), context);
    expect(low.employee).toBe(0);
    expect(high.employee).toBe(200);
  });

  it('charges different states differently on the same salary', async () => {
    const wages = { pfWage: 0, esiWage: 0, gross: 30000 };
    const karnataka = computeStatutory(pt('KARNATAKA'), wages, employee(), context);
    const bengal = computeStatutory(pt('WEST BENGAL'), wages, employee({ professionalTaxState: 'WEST BENGAL' }), context);
    expect(karnataka.employee).toBe(200);
    expect(bengal.employee).toBe(150);
  });

  it('charges the year’s balance in the month a state collects it', async () => {
    /* Maharashtra takes more in February, which is why a slab can name the
       months it applies to. */
    const wages = { pfWage: 0, esiWage: 0, gross: 30000 };
    const person = employee({ professionalTaxState: 'MAHARASHTRA' });
    const september = computeStatutory(pt('MAHARASHTRA'), wages, person, { ...context, month: 9 });
    const february = computeStatutory(pt('MAHARASHTRA'), wages, person, { ...context, month: 2 });
    expect(september.employee).toBe(200);
    expect(february.employee).toBe(300);
  });

  it('says so when a state has no slabs rather than deducting nothing quietly', async () => {
    const empty = { ...pt('KARNATAKA'), jurisdiction: 'GOA', config: {} };
    const r = computeStatutory(empty, { pfWage: 0, esiWage: 0, gross: 30000 }, employee({ professionalTaxState: 'GOA' }), context);
    expect(r.employee).toBe(0);
    expect(r.exemptReason).toBe('NO_SLABS');
    expect(r.explanation).toMatch(/GOA/);
  });
});

describe('income tax withheld from salary', () => {
  const year = { ...context, monthsRemaining: 12 };
  const pay = (annualTaxable: number) => ({ pfWage: 0, esiWage: 0, gross: 0, annualTaxable });

  it('uses the old regime’s own deduction and rebate for an old-regime employee', async () => {
    /* ₹10 lakh less ₹50,000 = ₹9.5 lakh: 12,500 + 20% of 4.5 lakh = 1,02,500,
       plus 4% cess = 1,06,600 a year. With the new regime's ₹75,000 and
       ₹60,000 rebate it came to 39,000. */
    const r = computeStatutory(rule('TDS'), pay(1_000_000), employee({ taxRegime: 'OLD' }), year);
    expect(r.employee).toBe(Math.round(106_600 / 12));
  });

  it('applies the old regime rebate only up to ₹5 lakh', async () => {
    const under = computeStatutory(rule('TDS'), pay(550_000), employee({ taxRegime: 'OLD' }), year);
    const over = computeStatutory(rule('TDS'), pay(800_000), employee({ taxRegime: 'OLD' }), year);
    expect(under.employee).toBe(0);
    /* ₹7.5 lakh taxable: 12,500 + 50,000 = 62,500 + cess = 65,000. It was 0. */
    expect(over.employee).toBe(Math.round(65_000 / 12));
  });

  it('falls back to the old regime figures for a rule seeded before they were stored', async () => {
    const legacy = rule('TDS');
    const { oldRegime: _dropped, ...config } = legacy.config;
    const r = computeStatutory({ ...legacy, config }, pay(1_000_000), employee({ taxRegime: 'OLD' }), year);
    expect(r.employee).toBe(Math.round(106_600 / 12));
  });

  it('caps the tax just over ₹12 lakh at the income above it (new regime)', async () => {
    /* ₹12.85 lakh less ₹75,000 = ₹12.1 lakh: band tax 61,500, but only ₹10,000
       is above the line, so 10,000 + cess = 10,400. */
    const r = computeStatutory(rule('TDS'), pay(1_285_000), employee(), year);
    expect(r.employee).toBe(Math.round(10_400 / 12));
  });

  it('charges nothing where the rebate covers it', async () => {
    /* A rebate wipes the tax out entirely below the threshold rather than
       reducing it, so somebody just under the line pays nothing. */
    const r = computeStatutory(
      rule('TDS'),
      { pfWage: 0, esiWage: 0, gross: 0, annualTaxable: 1_200_000 },
      employee(),
      context
    );
    expect(r.employee).toBe(0);
  });

  it('works the tax band by band, not at one rate', async () => {
    const r = computeStatutory(
      rule('TDS'),
      { pfWage: 0, esiWage: 0, gross: 0, annualTaxable: 2_000_000 },
      employee(),
      { ...context, monthsRemaining: 12 }
    );
    /* Taxable is 20,00,000 less the 75,000 standard deduction. Charged band by
       band and spread over twelve months, it is a real monthly figure rather
       than a flat percentage of pay. */
    expect(r.employee).toBeGreaterThan(0);
    expect(r.employee).toBeLessThan(2_000_000);
    expect(r.explanation).toMatch(/spread over 12 months/);
  });

  it('spreads what is left over the months that remain', async () => {
    /* Charging the whole year's tax in March is lawful and ruinous. */
    const twelve = computeStatutory(rule('TDS'), { pfWage: 0, esiWage: 0, gross: 0, annualTaxable: 2_000_000 }, employee(), {
      ...context,
      monthsRemaining: 12,
    });
    const three = computeStatutory(rule('TDS'), { pfWage: 0, esiWage: 0, gross: 0, annualTaxable: 2_000_000 }, employee(), {
      ...context,
      monthsRemaining: 3,
    });
    expect(three.employee).toBeGreaterThan(twelve.employee * 3);
  });

  it('subtracts what has already been withheld', async () => {
    const fresh = computeStatutory(rule('TDS'), { pfWage: 0, esiWage: 0, gross: 0, annualTaxable: 2_000_000 }, employee(), {
      ...context,
      monthsRemaining: 6,
      taxAlreadyDeducted: 0,
    });
    const partway = computeStatutory(rule('TDS'), { pfWage: 0, esiWage: 0, gross: 0, annualTaxable: 2_000_000 }, employee(), {
      ...context,
      monthsRemaining: 6,
      taxAlreadyDeducted: 100000,
    });
    expect(partway.employee).toBeLessThan(fresh.employee);
  });

  it('taxes the two regimes differently', async () => {
    const wages = { pfWage: 0, esiWage: 0, gross: 0, annualTaxable: 1_500_000 };
    const neu = computeStatutory(rule('TDS'), wages, employee({ taxRegime: 'NEW' }), { ...context, monthsRemaining: 12 });
    const old = computeStatutory(rule('TDS'), wages, employee({ taxRegime: 'OLD' }), { ...context, monthsRemaining: 12 });
    expect(neu.employee).not.toBe(old.employee);
  });
});

describe('which rule applied on a given day', () => {
  const rules = [
    { effectiveFrom: '2014-09-01', effectiveTo: '2026-03-31', jurisdiction: null, status: 'ACTIVE', version: 'old' },
    { effectiveFrom: '2026-04-01', effectiveTo: null, jurisdiction: null, status: 'ACTIVE', version: 'new' },
  ];

  it('finds the one in force, not the latest', async () => {
    /* The reason rules are dated rather than edited: a rate published in
       October must not change what April computed. */
    expect(ruleInForce(rules, '2025-09-30')?.version).toBe('old');
    expect(ruleInForce(rules, '2026-09-30')?.version).toBe('new');
  });

  it('answers the boundary days the way the dates read', async () => {
    expect(ruleInForce(rules, '2026-03-31')?.version).toBe('old');
    expect(ruleInForce(rules, '2026-04-01')?.version).toBe('new');
  });

  it('answers nothing for a day before any rule existed', async () => {
    expect(ruleInForce(rules, '2010-01-01')).toBeNull();
  });

  it('ignores a rule somebody has superseded', async () => {
    const withDead = [...rules, { effectiveFrom: '2026-01-01', effectiveTo: null, jurisdiction: null, status: 'SUPERSEDED', version: 'dead' }];
    expect(ruleInForce(withDead, '2026-09-30')?.version).toBe('new');
  });

  it('prefers a state rule over a general one', async () => {
    const mixed = [
      { effectiveFrom: '2020-01-01', effectiveTo: null, jurisdiction: null, status: 'ACTIVE', version: 'general' },
      { effectiveFrom: '2020-01-01', effectiveTo: null, jurisdiction: 'KARNATAKA', status: 'ACTIVE', version: 'karnataka' },
    ];
    expect(ruleInForce(mixed, '2026-09-30', 'KARNATAKA')?.version).toBe('karnataka');
    expect(ruleInForce(mixed, '2026-09-30', 'GOA')?.version).toBe('general');
  });
});

describe('the seeded rates', () => {
  it('carry a version and an effective date, so none of them can be edited in place', () => {
    for (const seed of SEED_RULES) {
      expect(seed.version).toBeTruthy();
      expect(seed.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('name no state inside the engine — the slabs come from the rule', () => {
    /* A company in three states deducts each correctly because the employee
       carries the state, not the code. */
    const states = SEED_RULES.filter((r) => r.scheme === 'PT').map((r) => r.jurisdiction);
    expect(states).toContain('KARNATAKA');
    expect(states).toContain('MAHARASHTRA');
    expect(states.length).toBeGreaterThan(1);
  });
});

describe('Labour Welfare Fund', () => {
  /* No state's figures are built in: these are made-up amounts for the arithmetic. */
  const lwf = (config: Record<string, unknown>, over: Partial<StatutoryRuleInput> = {}): StatutoryRuleInput => ({
    id: 'rule-lwf',
    scheme: 'LWF',
    version: 'test',
    jurisdiction: 'SOME STATE',
    employeeRate: 0,
    employerRate: 0,
    wageCeiling: null,
    eligibilityThreshold: null,
    rounding: 'NEAREST',
    config,
    ...over,
  });
  const pay = (gross: number) => ({ pfWage: 0, esiWage: 0, gross });

  it('collects fixed amounts in the months the state names, and nothing in the others', () => {
    const r = lwf({ employeeAmount: 25, employerAmount: 75, months: [6, 12] });
    expect(computeStatutory(r, pay(30000), employee(), { ...context, month: 6 })).toMatchObject({ employee: 25, employer: 75 });
    expect(computeStatutory(r, pay(30000), employee(), { ...context, month: 7 })).toMatchObject({ employee: 0, employer: 0, exemptReason: 'NOT_THIS_MONTH' });
  });

  it('stops above the pay ceiling a state sets', () => {
    const r = lwf({ employeeAmount: 10, employerAmount: 20, eligibleUpTo: 25000 });
    expect(computeStatutory(r, pay(30000), employee(), context)).toMatchObject({ employee: 0, exemptReason: 'ABOVE_CEILING' });
    expect(computeStatutory(r, pay(20000), employee(), context)).toMatchObject({ employee: 10, employer: 20 });
  });

  it('takes a capped percentage where a state charges one', () => {
    const r = lwf({ employeeCap: 34, employerCap: 68 }, { employeeRate: 0.2, employerRate: 0.4 });
    expect(computeStatutory(r, pay(10000), employee(), context)).toMatchObject({ employee: 20, employer: 40 });
    expect(computeStatutory(r, pay(50000), employee(), context)).toMatchObject({ employee: 34, employer: 68 });
  });

  it('says so when a state has no amounts set', () => {
    expect(computeStatutory(lwf({}), pay(30000), employee(), context)).toMatchObject({ employee: 0, exemptReason: 'NO_AMOUNTS' });
  });
});
