import { describe, it, expect } from 'vitest';

import { calculateStructure, ENGINE_VERSION, type EngineComponent, type EngineInput } from '../services/payroll/engine/calculator.js';

/**
 * What a salary structure works out to.
 *
 * Every figure on a payslip comes from here, so these are written as the
 * questions somebody would actually dispute: why is my HRA that number, why did
 * it drop when I took unpaid leave, what happens when the allowances add up to
 * more than the CTC. A regression in this file is a regression in somebody's
 * pay.
 *
 * The fixtures are deliberately a real Indian salary shape — Basic as a share
 * of CTC, HRA as a share of Basic, a special allowance taking the remainder —
 * because that is the arrangement whose ordering is easiest to get wrong.
 */

const component = (over: Partial<EngineComponent> & Pick<EngineComponent, 'code' | 'name' | 'type'>): EngineComponent => ({
  componentId: `id-${over.code}`,
  calculationMethod: 'FIXED',
  amount: 0,
  percentage: 0,
  formula: null,
  calculationBase: null,
  rounding: 'NEAREST',
  isTaxable: true,
  prorate: true,
  includeInPfWage: false,
  includeInEsiWage: false,
  includeInGratuityWage: false,
  includeInGross: over.type === 'EARNING',
  includeInNetPay: over.type !== 'EMPLOYER_CONTRIBUTION',
  isVariable: false,
  isBalancing: false,
  displayOrder: 0,
  ...over,
});

const BASIC = component({
  code: 'BASIC', name: 'Basic', type: 'EARNING',
  calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC',
  includeInPfWage: true, includeInEsiWage: true, includeInGratuityWage: true, displayOrder: 1,
});

const HRA = component({
  code: 'HRA', name: 'House Rent Allowance', type: 'EARNING',
  calculationMethod: 'FORMULA', formula: 'BASIC * 0.4',
  includeInEsiWage: true, displayOrder: 2,
});

const SPECIAL = component({
  code: 'SPECIAL', name: 'Special Allowance', type: 'EARNING',
  calculationMethod: 'BALANCING', isBalancing: true, displayOrder: 3,
});

const input = (over: Partial<EngineInput> = {}): EngineInput => ({
  annualCtc: 1_200_000,
  periodsPerYear: 12,
  workingDays: 30,
  payableDays: 30,
  lwpDays: 0,
  ...over,
});

describe('a salary written in terms of itself', () => {
  it('works out Basic from CTC, HRA from Basic, and the allowance from what is left', () => {
    /* ₹12,00,000 a year is ₹1,00,000 a month. Basic 50% = 50,000; HRA 40% of
       Basic = 20,000; the special allowance takes the remaining 30,000. */
    const r = calculateStructure([BASIC, HRA, SPECIAL], input());
    const amount = (code: string) => r.lines.find((l) => l.code === code)?.amount;

    expect(amount('BASIC')).toBe(50000);
    expect(amount('HRA')).toBe(20000);
    expect(amount('SPECIAL')).toBe(30000);
    expect(r.grossEarnings).toBe(100000);
    expect(r.netPay).toBe(100000);
    expect(r.errors).toEqual([]);
  });

  it('does not care what order the components are given in', () => {
    /* Ordering is the computer's job. Somebody inserting a line should not have
       to know which other lines depend on it. */
    const forwards = calculateStructure([BASIC, HRA, SPECIAL], input());
    const backwards = calculateStructure([SPECIAL, HRA, BASIC], input());
    const shuffled = calculateStructure([HRA, SPECIAL, BASIC], input());

    const totals = (r: typeof forwards) => [r.grossEarnings, r.netPay, r.employerCost];
    expect(totals(backwards)).toEqual(totals(forwards));
    expect(totals(shuffled)).toEqual(totals(forwards));
  });

  it('resolves a component that depends on gross, once gross is actually true', () => {
    /* A percentage of gross cannot be known until every earning that makes up
       gross has settled. It must not quietly read gross as zero. */
    const bonus = component({
      code: 'PERF', name: 'Performance pay', type: 'EARNING',
      calculationMethod: 'PERCENTAGE', percentage: 10, calculationBase: 'GROSS',
      displayOrder: 4,
    });
    const r = calculateStructure([BASIC, HRA, bonus], input());
    /* Basic 50,000 + HRA 20,000 = gross of 70,000 before this line, so 10%
       is 7,000 — not zero, and not 10% of a gross that includes itself. */
    expect(r.lines.find((l) => l.code === 'PERF')?.amount).toBe(7000);
    expect(r.errors).toEqual([]);
  });
});

describe('when the structure cannot be worked out', () => {
  it('reports a cycle instead of quietly paying zero', () => {
    const a = component({
      code: 'A', name: 'A', type: 'EARNING',
      calculationMethod: 'FORMULA', formula: 'B * 2',
    });
    const b = component({
      code: 'B', name: 'B', type: 'EARNING',
      calculationMethod: 'FORMULA', formula: 'A * 2',
    });
    const r = calculateStructure([a, b], input());
    expect(r.errors.some((e) => e.code === 'CIRCULAR_COMPONENT')).toBe(true);
  });

  it('refuses two components both claiming the balance of CTC', () => {
    const second = component({ code: 'OTHER', name: 'Other', type: 'EARNING', isBalancing: true });
    const r = calculateStructure([BASIC, SPECIAL, second], input());
    expect(r.errors.some((e) => e.code === 'MULTIPLE_BALANCING')).toBe(true);
  });

  it('says so when the components already cost more than the CTC', () => {
    /* A structure whose fixed allowances exceed the CTC leaves the balancing
       component nothing, and the honest answer is an error rather than a
       negative allowance on a payslip. */
    const fat = component({ code: 'FAT', name: 'Large allowance', type: 'EARNING', calculationMethod: 'FIXED', amount: 200000 });
    const r = calculateStructure([BASIC, fat, SPECIAL], input());
    expect(r.errors.some((e) => e.code === 'CTC_EXCEEDED')).toBe(true);
    expect(r.lines.find((l) => l.code === 'SPECIAL')?.amount).toBe(0);
  });

  it('flags a payslip that would come out negative', () => {
    const huge = component({
      code: 'RECOVERY', name: 'Recovery', type: 'DEDUCTION',
      calculationMethod: 'FIXED', amount: 999999, includeInGross: false,
    });
    const r = calculateStructure([BASIC, huge], input());
    expect(r.errors.some((e) => e.code === 'NEGATIVE_NET_PAY')).toBe(true);
  });

  it('keeps going when one component fails, rather than losing the whole payroll', () => {
    /* A run of six hundred people must not stop because one structure has a
       bad line. The line reports zero and names itself. */
    const broken = component({
      code: 'BROKEN', name: 'Broken line', type: 'EARNING',
      calculationMethod: 'FORMULA', formula: 'BASIC / 0',
    });
    const r = calculateStructure([BASIC, broken], input());
    expect(r.errors.some((e) => e.message.includes('Broken line'))).toBe(true);
    expect(r.lines.find((l) => l.code === 'BASIC')?.amount).toBe(50000);
  });
});

describe('proration', () => {
  it('pays for the days worked', () => {
    /* Six days of unpaid leave in a thirty-day month: 24/30 of everything that
       prorates. */
    const r = calculateStructure([BASIC, HRA], input({ payableDays: 24, lwpDays: 6 }));
    expect(r.lines.find((l) => l.code === 'BASIC')?.amount).toBe(40000);
    expect(r.lines.find((l) => l.code === 'HRA')?.amount).toBe(16000);
  });

  it('leaves alone what does not prorate', () => {
    /* A fixed reimbursement is not earned by the day. */
    const reimb = component({
      code: 'REIMB', name: 'Phone reimbursement', type: 'EARNING',
      calculationMethod: 'FIXED', amount: 1000, prorate: false,
    });
    const r = calculateStructure([BASIC, reimb], input({ payableDays: 15 }));
    expect(r.lines.find((l) => l.code === 'REIMB')?.amount).toBe(1000);
    expect(r.lines.find((l) => l.code === 'BASIC')?.amount).toBe(25000);
  });

  it('keeps the full amount beside the prorated one, so the difference can be shown', () => {
    const r = calculateStructure([BASIC], input({ payableDays: 15 }));
    const basic = r.lines.find((l) => l.code === 'BASIC');
    expect(basic?.amount).toBe(25000);
    expect(basic?.fullAmount).toBe(50000);
  });

  it('never pays more than a full period, and says when it was asked to', () => {
    const r = calculateStructure([BASIC], input({ payableDays: 40 }));
    expect(r.lines.find((l) => l.code === 'BASIC')?.amount).toBe(50000);
    expect(r.warnings.some((w) => w.code === 'PAYABLE_EXCEEDS_WORKING')).toBe(true);
  });

  it('does not divide by zero when nobody said how long the period is', () => {
    const r = calculateStructure([BASIC], input({ workingDays: 0, payableDays: 0 }));
    expect(Number.isFinite(r.netPay)).toBe(true);
    expect(r.lines.find((l) => l.code === 'BASIC')?.amount).toBe(50000);
  });
});

describe('what the employee takes home and what the company spends', () => {
  const EPF = component({
    code: 'EPF', name: 'Employee PF', type: 'DEDUCTION',
    calculationMethod: 'FORMULA', formula: 'MIN(BASIC * 0.12, 1800)',
    includeInGross: false, isTaxable: false, displayOrder: 10,
  });
  const ERPF = component({
    code: 'ER_PF', name: 'Employer PF', type: 'EMPLOYER_CONTRIBUTION',
    calculationMethod: 'FORMULA', formula: 'MIN(BASIC * 0.12, 1800)',
    includeInGross: false, includeInNetPay: false, isTaxable: false, displayOrder: 20,
  });

  it('takes the employee’s deductions out of pay and leaves the employer’s alone', () => {
    /*
     * CTC is what the company spends, so the employer's own PF comes out of it
     * before anything reaches the employee: ₹1,00,000 of monthly cost is
     * ₹98,200 of gross pay plus ₹1,800 the company puts into the fund. The
     * balancing allowance is what absorbs that, which is exactly how an Indian
     * CTC is put together.
     */
    const r = calculateStructure([BASIC, HRA, SPECIAL, EPF, ERPF], input());
    expect(r.grossEarnings).toBe(98200);
    expect(r.totalDeductions).toBe(1800);
    expect(r.netPay).toBe(96400);
    expect(r.employerContributions).toBe(1800);
  });

  it('counts the employer’s contribution as company cost, not as pay', () => {
    const r = calculateStructure([BASIC, HRA, SPECIAL, EPF, ERPF], input());
    /* Back to the CTC it started from — the test that the model closes. */
    expect(r.employerCost).toBe(100000);
    expect(r.netPay).toBe(96400);
  });

  it('adds up the wage bases the statutory engine will need', () => {
    const r = calculateStructure([BASIC, HRA, SPECIAL], input());
    expect(r.pfWage).toBe(50000);
    expect(r.esiWage).toBe(70000);
    expect(r.gratuityWage).toBe(50000);
  });

  it('pays an earning that is outside gross but still money', () => {
    /* A reimbursement is not part of gross for tax, and is still paid. */
    const reimb = component({
      code: 'REIMB', name: 'Reimbursement', type: 'EARNING',
      calculationMethod: 'FIXED', amount: 2000, includeInGross: false, isTaxable: false,
    });
    const r = calculateStructure([BASIC, reimb], input());
    expect(r.grossEarnings).toBe(50000);
    expect(r.netPay).toBe(52000);
  });
});

describe('rounding', () => {
  it('rounds to the rupee by default', () => {
    const odd = component({
      code: 'ODD', name: 'Odd', type: 'EARNING',
      calculationMethod: 'FORMULA', formula: 'MONTHLY_CTC * 0.03333',
    });
    const r = calculateStructure([odd], input());
    expect(r.lines.find((l) => l.code === 'ODD')?.amount).toBe(3333);
  });

  it('rounds up, down or not at all when told to', () => {
    /* A figure with a real fraction — 3,333.30 — so the three modes differ. */
    const base = { name: 'Odd', type: 'EARNING' as const, calculationMethod: 'FORMULA' as const, formula: 'MONTHLY_CTC * 0.033333' };
    const up = calculateStructure([component({ ...base, code: 'UP', rounding: 'UP' })], input());
    const down = calculateStructure([component({ ...base, code: 'DOWN', rounding: 'DOWN' })], input());
    const none = calculateStructure([component({ ...base, code: 'NONE', rounding: 'NONE' })], input());
    expect(up.lines[0].amount).toBe(3334);
    expect(down.lines[0].amount).toBe(3333);
    expect(none.lines[0].amount).toBe(3333.3);
  });
});

describe('the reasoning behind each number', () => {
  it('explains a percentage in the words the payslip would use', () => {
    const r = calculateStructure([BASIC, HRA, SPECIAL], input());
    const basic = r.trace.find((t) => t.code === 'BASIC');
    expect(basic?.ruleText).toBe('50% of MONTHLY_CTC');
    expect(basic?.baseLabel).toBe('MONTHLY_CTC');
    expect(basic?.baseAmount).toBe(100000);
    expect(basic?.computedAmount).toBe(50000);
  });

  it('shows the formula that produced a line', () => {
    const r = calculateStructure([BASIC, HRA], input());
    const hra = r.trace.find((t) => t.code === 'HRA');
    expect(hra?.formula).toBe('BASIC * 0.4');
    expect(hra?.computedAmount).toBe(20000);
  });

  it('records the proration that reduced a line, and nothing when it did not', () => {
    const full = calculateStructure([BASIC], input());
    expect(full.trace.find((t) => t.code === 'BASIC')?.prorationFactor).toBeNull();

    const part = calculateStructure([BASIC], input({ payableDays: 15 }));
    expect(part.trace.find((t) => t.code === 'BASIC')?.prorationFactor).toBe(0.5);
  });

  it('explains the balancing component as the remainder it is', () => {
    const r = calculateStructure([BASIC, HRA, SPECIAL], input());
    const special = r.trace.find((t) => t.code === 'SPECIAL');
    expect(special?.baseLabel).toBe('MONTHLY_CTC');
    expect(special?.ruleText).toMatch(/left of the period/i);
  });

  it('traces every line it calculated', () => {
    const r = calculateStructure([BASIC, HRA, SPECIAL], input());
    expect(r.trace.map((t) => t.code).sort()).toEqual(['BASIC', 'HRA', 'SPECIAL']);
  });
});

describe('determinism', () => {
  it('gives the same answer for the same inputs, every time', () => {
    /* The property the whole audit story rests on: a payslip recalculated a
       year later must come out identical. */
    const once = calculateStructure([BASIC, HRA, SPECIAL], input({ payableDays: 22 }));
    const twice = calculateStructure([BASIC, HRA, SPECIAL], input({ payableDays: 22 }));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('stamps the engine version that produced the result', () => {
    const r = calculateStructure([BASIC], input());
    expect(r.engineVersion).toBe(ENGINE_VERSION);
  });

  it('reads no clock and no database', () => {
    /* Nothing here may depend on when it runs. Freezing time must not change
       a single figure. */
    const before = calculateStructure([BASIC, HRA, SPECIAL], input());
    const realNow = Date.now;
    Date.now = () => 0;
    try {
      const after = calculateStructure([BASIC, HRA, SPECIAL], input());
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    } finally {
      Date.now = realNow;
    }
  });
});

describe('a weekly structure', () => {
  it('divides the annual cost by the periods in a year, not by twelve', () => {
    const r = calculateStructure([BASIC], input({ periodsPerYear: 52, annualCtc: 520000 }));
    /* ₹5,20,000 over 52 weeks is ₹10,000 a week; Basic at 50% is ₹5,000. */
    expect(r.lines.find((l) => l.code === 'BASIC')?.amount).toBe(5000);
  });
});

/**
 * Thresholds and ceilings.
 *
 * Both were added when the eligibility rules arrived, and both deliberately
 * live here rather than beside those rules: they are questions about a number
 * this engine produces, and the engine is the only place that number exists.
 *
 * The trap each one hides is the same shape — a rule that silently pays, or
 * silently does not, with a payslip that looks ordinary either way.
 */
describe('a component that only applies over a threshold', () => {
  const gated = (over: Partial<EngineComponent> = {}) =>
    component({
      code: 'SUPP', name: 'Supplement', type: 'EARNING',
      calculationMethod: 'FIXED', amount: 2000,
      thresholdBase: 'BASIC', thresholdOperator: 'GT', thresholdAmount: 30000,
      displayOrder: 9,
      ...over,
    });

  const runWith = (extra: EngineComponent, input: Partial<EngineInput> = {}) =>
    calculateStructure([BASIC, HRA, extra], {
      annualCtc: 1_200_000, periodsPerYear: 12, workingDays: 30, payableDays: 30, lwpDays: 0,
      ...input,
    });

  it('pays it when the threshold is met, and says why', () => {
    /* Basic is 50% of a 100,000 monthly CTC = 50,000, which is over 30,000. */
    const result = runWith(gated());
    const line = result.lines.find((l) => l.code === 'SUPP');
    expect(line?.amount).toBe(2000);
    expect(result.trace.find((t) => t.code === 'SUPP')?.ruleText).toContain('over 30000');
  });

  it('does not pay it when the threshold is not met, and says why', () => {
    const result = runWith(gated({ thresholdAmount: 60000 }));
    expect(result.lines.find((l) => l.code === 'SUPP')?.amount).toBe(0);
    expect(result.trace.find((t) => t.code === 'SUPP')?.ruleText).toContain('is not over 60000');
  });

  it('honours a range on both sides', () => {
    const inside = runWith(gated({ thresholdOperator: 'RANGE', thresholdAmount: 40000, thresholdRangeEnd: 60000 }));
    expect(inside.lines.find((l) => l.code === 'SUPP')?.amount).toBe(2000);

    const outside = runWith(gated({ thresholdOperator: 'RANGE', thresholdAmount: 10000, thresholdRangeEnd: 20000 }));
    expect(outside.lines.find((l) => l.code === 'SUPP')?.amount).toBe(0);
  });

  it('waits for its base to settle before testing it', () => {
    /*
     * The ordering trap. A component gated on GROSS resolves in the first pass
     * if the threshold is not counted as a dependency — and at that point
     * GROSS is zero, so the gate fails and the component is never paid. The
     * bug pays nothing, on a payslip that shows nothing missing.
     */
    const onGross = gated({ thresholdBase: 'GROSS', thresholdOperator: 'GT', thresholdAmount: 50000 });
    const result = runWith(onGross);
    expect(result.lines.find((l) => l.code === 'SUPP')?.amount).toBe(2000);
  });

  it('refuses to pay when the base is not a thing this structure has', () => {
    /* A typo in a base name — BASIC_PAY where the code is BASIC — must not pay
       unconditionally. The permissive reading is the expensive one. */
    const result = runWith(gated({ thresholdBase: 'BASIC_PAY' }));
    expect(result.lines.find((l) => l.code === 'SUPP')?.amount).toBe(0);
  });

  it('tests the full salary, not a month shortened by unpaid leave', () => {
    /* "Only over 30,000" is a statement about the salary. Testing the prorated
       figure would switch the allowance off in the month somebody took leave,
       which is the month they would least expect it to change. */
    const result = runWith(gated({ thresholdAmount: 40000 }), { payableDays: 15 });
    expect(result.lines.find((l) => l.code === 'SUPP')?.amount).toBe(1000);
  });
});

describe('a component with a ceiling', () => {
  const capped = (over: Partial<EngineComponent> = {}) =>
    component({
      code: 'TRANSPORT', name: 'Transport', type: 'EARNING',
      calculationMethod: 'PERCENTAGE', percentage: 10, calculationBase: 'BASIC',
      hasMaxLimit: true, maximumAmount: 3000, displayOrder: 9,
      ...over,
    });

  const runWith = (extra: EngineComponent) =>
    calculateStructure([BASIC, HRA, extra], {
      annualCtc: 1_200_000, periodsPerYear: 12, workingDays: 30, payableDays: 30, lwpDays: 0,
    });

  it('pays the maximum rather than the calculated amount', () => {
    /* 10% of a 50,000 basic is 5,000, capped at 3,000. */
    const result = runWith(capped());
    expect(result.lines.find((l) => l.code === 'TRANSPORT')?.amount).toBe(3000);
    expect(result.trace.find((t) => t.code === 'TRANSPORT')?.ruleText).toContain('Capped at 3000');
  });

  it('leaves an amount under the ceiling alone', () => {
    const result = runWith(capped({ maximumAmount: 9000 }));
    expect(result.lines.find((l) => l.code === 'TRANSPORT')?.amount).toBe(5000);
    expect(result.trace.find((t) => t.code === 'TRANSPORT')?.ruleText).not.toContain('Capped');
  });

  it('pays nothing at all where the policy is to stop, not to cap', () => {
    /* Two real policies, and capping where somebody meant to stop overpays
       every senior employee by the cap, every month. */
    const result = runWith(capped({ exceedBehaviour: 'EXCLUDE' }));
    expect(result.lines.find((l) => l.code === 'TRANSPORT')?.amount).toBe(0);
    expect(result.trace.find((t) => t.code === 'TRANSPORT')?.ruleText).toContain('over the maximum');
  });

  it('caps the full amount and prorates afterwards', () => {
    /* Capping after proration would pay a full cap for half a month. */
    const result = calculateStructure([BASIC, HRA, capped()], {
      annualCtc: 1_200_000, periodsPerYear: 12, workingDays: 30, payableDays: 15, lwpDays: 15,
    });
    expect(result.lines.find((l) => l.code === 'TRANSPORT')?.amount).toBe(1500);
  });
});
