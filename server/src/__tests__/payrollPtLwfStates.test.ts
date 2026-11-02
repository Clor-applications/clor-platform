import { describe, it, expect } from 'vitest';

import { computeStatutory, ruleInForce, type PtContext, type StatutoryRuleInput } from '../services/payroll/statutory/engine.js';
import { SEED_RULES } from '../services/payroll/statutory/defaults.js';
import { canonicalState, ptDueFor, lwfDueFor, NO_PT_STATES, KERALA_SHOPS_FUND } from '../constants/stateLevies.js';

/**
 * Professional tax and Labour Welfare Fund for every state that levies them,
 * read through the seeded rules exactly as a payroll run reads them: the rule
 * in force on the payroll date for the person's state, then the engine.
 *
 * Each state is tested at its band edges — a rupee (or a paisa) either side
 * of every boundary — because an off-by-one there is a wrong deduction for
 * everybody on that salary.
 */

/* The seeded rows, shaped as the database holds them, so ruleInForce picks among them. */
const rows = SEED_RULES.map((s, i) => ({
  id: `seed-${i}`,
  scheme: s.scheme,
  jurisdiction: s.jurisdiction,
  version: s.version,
  effectiveFrom: s.effectiveFrom,
  effectiveTo: null as string | null,
  status: 'ACTIVE',
  seed: s,
}));
/* As the seed step leaves them: each older version closed the day before the next. */
for (const r of rows) {
  const next = rows
    .filter((o) => o.scheme === r.scheme && o.jurisdiction === r.jurisdiction && o.effectiveFrom > r.effectiveFrom)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
  if (next) {
    const d = new Date(`${next.effectiveFrom}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    r.effectiveTo = d.toISOString().slice(0, 10);
    r.status = 'SUPERSEDED';
  }
}

const ruleFor = (scheme: 'PT' | 'LWF', state: string, onDate: string): StatutoryRuleInput | null => {
  const row = ruleInForce(rows.filter((r) => r.scheme === scheme), onDate, state);
  if (!row) return null;
  const s = row.seed;
  return {
    id: row.id,
    scheme: s.scheme,
    version: s.version,
    jurisdiction: s.jurisdiction,
    employeeRate: s.employeeRate,
    employerRate: s.employerRate,
    wageCeiling: s.wageCeiling,
    eligibilityThreshold: s.eligibilityThreshold,
    rounding: s.rounding,
    config: s.config as Record<string, any>,
  };
};

const person = (state: string, over: Record<string, unknown> = {}) => ({
  pfApplicable: false,
  esiApplicable: false,
  ptApplicable: true,
  professionalTaxState: state,
  taxRegime: 'NEW' as const,
  ...over,
});

/** PT on a monthly gross in a month (2026-27 unless the date says otherwise). */
const pt = (state: string, gross: number, onDate = '2026-11-30', over: Record<string, unknown> = {}, already = 0, ctx: PtContext = {}) => {
  const rule = ruleFor('PT', state, onDate);
  if (!rule) return null;
  return computeStatutory(rule, { pfWage: 0, esiWage: 0, gross }, person(state, over), {
    month: Number(onDate.slice(5, 7)),
    monthsRemaining: 1,
    taxAlreadyDeducted: 0,
    pt: { yearToDate: already, ...ctx },
  });
};
const ptAmount = (state: string, gross: number, onDate?: string, over?: Record<string, unknown>) => pt(state, gross, onDate, over)?.employee ?? null;

type Case = [gross: number, expected: number, onDate?: string];
const bandEdges: Record<string, Case[]> = {
  MAHARASHTRA: [[7500, 0], [7500.01, 175], [10000, 175], [10000.01, 200], [50000, 200], [10000.01, 300, '2027-02-28']],
  KARNATAKA: [[24999.99, 0], [25000, 200], [80000, 200], [25000, 300, '2027-02-28'], [24999.99, 0, '2027-02-28']],
  'WEST BENGAL': [[20000, 0], [20000.01, 100], [30000, 100], [30000.01, 140], [50000, 140], [50000.01, 170], [100000, 170], [100000.01, 208]],
  GUJARAT: [[12000, 0], [12000.01, 200], [12000.01, 200, '2027-02-28']],
  TELANGANA: [[15000, 0], [15000.01, 150], [20000, 150], [20000.01, 200]],
  'ANDHRA PRADESH': [[15000, 0], [15000.01, 150], [20000, 150], [20000.01, 200]],
  /* Half-yearly, on six months' pay, taken in September and February. */
  'TAMIL NADU': [
    [3500, 0, '2026-09-30'], [3500.01, 180, '2026-09-30'], [5000, 180, '2026-09-30'], [5000.01, 425, '2026-09-30'], [7500, 425, '2026-09-30'],
    [7500.01, 930, '2026-09-30'], [10000, 930, '2026-09-30'], [10000.01, 1025, '2026-09-30'], [12500, 1025, '2026-09-30'], [12500.01, 1250, '2027-02-28'],
    [50000, 0, '2026-10-31'],
  ],
  /* Half-yearly, taken in August and February. */
  KERALA: [
    [1999.99, 0, '2026-08-31'], [2000, 320, '2026-08-31'], [2999.99, 320, '2026-08-31'], [3000, 450, '2026-08-31'], [5000, 600, '2026-08-31'],
    [7500, 750, '2026-08-31'], [16666.67, 1000, '2026-08-31'], [20833.33, 1000, '2026-08-31'], [20833.34, 1250, '2027-02-28'], [50000, 0, '2026-09-30'],
  ],
  /* Yearly bands, spread monthly, the balance in March. */
  'MADHYA PRADESH': [
    [18750, 0], [18750.01, 125], [25000, 125], [25000.01, 166], [25000.01, 174, '2027-03-31'], [33333.33, 166], [33333.34, 208], [33333.34, 212, '2027-03-31'],
  ],
  ASSAM: [[15000, 0], [15000.01, 180], [24999.99, 180], [25000, 208]],
  /* Yearly, taken once in September. */
  BIHAR: [[25000, 0, '2026-09-30'], [25000.01, 1000, '2026-09-30'], [41666.67, 2000, '2026-09-30'], [83333.34, 2500, '2026-09-30'], [83333.34, 0, '2026-10-31']],
  JHARKHAND: [[25000, 0], [25000.01, 100], [41666.67, 150], [66666.67, 175], [83333.34, 208], [83333.34, 212, '2027-03-31']],
  MEGHALAYA: [[4166.66, 0], [4166.67, 16], [4166.67, 24, '2027-03-31'], [41666.67, 208], [41666.67, 212, '2027-03-31']],
  TRIPURA: [[7500, 0], [7500.01, 150], [15000, 150], [15000.01, 208]],
  SIKKIM: [[20000, 0], [20000.01, 125], [30000, 125], [30000.01, 150], [40000, 150], [40000.01, 200]],
  MANIPUR: [[4166.66, 0], [4166.67, 100], [6250.01, 166], [6250.01, 174, '2027-03-31'], [8333.34, 200], [10416.67, 208], [10416.67, 212, '2027-03-31']],
  MIZORAM: [[5000, 0], [5000.01, 75], [8000.01, 120], [10000.01, 150], [12000.01, 180], [15000.01, 195], [20000, 195], [20000.01, 208], [15000.01, 208, '2024-06-30']],
  NAGALAND: [[4000, 0], [4000.01, 35], [5000.01, 75], [7000.01, 110], [9000.01, 180], [12000, 180], [12000.01, 208]],
  PUDUCHERRY: [
    [16666.66, 0, '2026-09-30'], [16666.67, 250, '2026-09-30'], [33333.34, 500, '2026-09-30'], [50000.01, 750, '2026-09-30'], [66666.67, 1000, '2026-09-30'], [83333.34, 1250, '2027-02-28'],
  ],
  PUNJAB: [[20833.33, 0], [20833.34, 200]],
};

describe('professional tax, state by state, at the band edges', () => {
  for (const [state, cases] of Object.entries(bandEdges)) {
    it(`${state.toLowerCase()}`, () => {
      for (const [gross, expected, onDate] of cases) {
        expect({ gross, onDate: onDate || '2026-11-30', amount: ptAmount(state, gross, onDate) }).toEqual({ gross, onDate: onDate || '2026-11-30', amount: expected });
      }
    });
  }

  it('has a rule for every state the research lists as levying PT', () => {
    const levying = ['MAHARASHTRA', 'KARNATAKA', 'WEST BENGAL', 'GUJARAT', 'TELANGANA', 'ANDHRA PRADESH', 'TAMIL NADU', 'KERALA', 'MADHYA PRADESH', 'ASSAM', 'BIHAR', 'JHARKHAND', 'MEGHALAYA', 'TRIPURA', 'SIKKIM', 'MANIPUR', 'MIZORAM', 'NAGALAND', 'PUDUCHERRY', 'PUNJAB'];
    for (const state of levying) expect(ruleFor('PT', state, '2026-11-30'), state).not.toBeNull();
    expect(Object.keys(bandEdges).sort()).toEqual([...levying].sort());
  });

  it('keeps every year within ₹2,500 for a full-year earner on the top band', () => {
    const top: Record<string, number> = { MAHARASHTRA: 60000, KARNATAKA: 60000, 'WEST BENGAL': 200000, 'MADHYA PRADESH': 60000, JHARKHAND: 90000, MEGHALAYA: 50000, MANIPUR: 20000, ASSAM: 60000 };
    for (const [state, gross] of Object.entries(top)) {
      let year = 0;
      for (const ym of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']) {
        year += pt(state, gross, `${ym}-28`, {}, year)!.employee;
      }
      expect({ state, year: year <= 2500 }).toEqual({ state, year: true });
    }
    /* Maharashtra and Karnataka reach exactly ₹2,500 through February. */
    let mh = 0;
    for (const ym of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']) mh += ptAmount('MAHARASHTRA', 60000, `${ym}-28`)!;
    expect(mh).toBe(2500);
  });
});

describe('February', () => {
  it('charges ₹300 in February in Karnataka from April 2025, and ₹200 in every other month', () => {
    expect(ptAmount('KARNATAKA', 40000, '2027-02-28')).toBe(300);
    expect(ptAmount('KARNATAKA', 40000, '2027-01-31')).toBe(200);
    expect(ptAmount('KARNATAKA', 40000, '2027-03-31')).toBe(200);
  });

  it('charged ₹200 in Karnataka’s February before the 2025 amendment', () => {
    expect(ptAmount('KARNATAKA', 40000, '2025-02-28')).toBe(200);
  });

  it('charges ₹300 in February in Maharashtra, for women above ₹25,000 too', () => {
    expect(ptAmount('MAHARASHTRA', 40000, '2027-02-28')).toBe(300);
    expect(ptAmount('MAHARASHTRA', 40000, '2027-02-28', { gender: 'FEMALE' })).toBe(300);
  });

  it('says why February differs', () => {
    expect(pt('KARNATAKA', 40000, '2027-02-28')!.explanation).toMatch(/February/);
  });
});

describe('Maharashtra’s women’s bands', () => {
  it('charges a woman nothing up to ₹25,000, with no ₹175 band', () => {
    expect(ptAmount('MAHARASHTRA', 9000, undefined, { gender: 'FEMALE' })).toBe(0);
    expect(ptAmount('MAHARASHTRA', 25000, undefined, { gender: 'FEMALE' })).toBe(0);
    expect(ptAmount('MAHARASHTRA', 25000.01, undefined, { gender: 'FEMALE' })).toBe(200);
  });

  it('charges a man on the same pay ₹175 and ₹200', () => {
    expect(ptAmount('MAHARASHTRA', 9000, undefined, { gender: 'MALE' })).toBe(175);
    expect(ptAmount('MAHARASHTRA', 25000, undefined, { gender: 'MALE' })).toBe(200);
  });

  it('reads anybody not recorded as a woman on the men’s bands', () => {
    expect(ptAmount('MAHARASHTRA', 9000)).toBe(175);
    expect(ptAmount('MAHARASHTRA', 9000, undefined, { gender: 'OTHER' })).toBe(175);
  });

  it('says it used the women’s bands', () => {
    expect(pt('MAHARASHTRA', 30000, undefined, { gender: 'FEMALE' })!.explanation).toMatch(/women/);
  });

  it('makes no difference in a state without women’s bands', () => {
    expect(ptAmount('KARNATAKA', 30000, undefined, { gender: 'FEMALE' })).toBe(200);
  });
});

describe('the balance month, read from the payslips', () => {
  /* Madhya Pradesh above ₹4 lakh: ₹2,500 a year, ₹208 a month. */
  it('takes what is left of the year in that state in March', () => {
    expect(pt('MADHYA PRADESH', 40000, '2027-03-31', {}, 2288, { inState: 2288, monthsInState: 11 })!.employee).toBe(212);
  });

  it('trues up a band change during the year', () => {
    /* Six months at ₹125 and five at ₹166 before a raise into the ₹2,000 band: ₹1,580 taken, ₹420 left. */
    expect(pt('MADHYA PRADESH', 30000, '2027-03-31', {}, 1580, { inState: 1580, monthsInState: 11 })!.employee).toBe(420);
  });

  it('charges somebody who joined in October only their part of the year', () => {
    /* Five months at ₹208 = ₹1,040; six months of ₹2,500 is ₹1,250, so March takes ₹210. */
    expect(pt('MADHYA PRADESH', 40000, '2027-03-31', {}, 1040, { inState: 1040, monthsInState: 5, monthsEmployed: 6 })!.employee).toBe(210);
  });

  it('charges a full-year employee the full year, nil-band months included', () => {
    /* Six months on ₹15,000 (nil) and five on ₹40,000 (₹208): ₹1,040 taken. Year's pay ₹3,30,000 → the ₹2,000 band. */
    const r = pt('MADHYA PRADESH', 40000, '2027-03-31', {}, 1040, { inState: 1040, monthsInState: 11, grossInState: 6 * 15000 + 5 * 40000, monthsEmployed: 12 })!;
    expect(r.employee).toBe(960);
  });

  it('reads the band from the year’s pay, not March’s', () => {
    /* ₹30,000 until a December raise to ₹40,000: the year is ₹3,90,000 — the ₹2,000 band, not March's ₹4,80,000 (₹2,500). */
    const r = pt('MADHYA PRADESH', 40000, '2027-03-31', {}, 1826, { inState: 1826, monthsInState: 11, grossInState: 8 * 30000 + 3 * 40000, monthsEmployed: 12 })!;
    expect(r.employee).toBe(174);
    expect(r.explanation).toMatch(/for the year/);
  });

  it('takes nothing when the year is already paid in full', () => {
    expect(pt('MADHYA PRADESH', 40000, '2027-03-31', {}, 2500, { inState: 2500, monthsInState: 11 })!.employee).toBe(0);
  });

  it('counts only this state: tax paid in another state is not this state’s balance', () => {
    /* Moved from Karnataka in October: ₹1,000 there, ₹1,040 here; the cap still counts both. */
    expect(pt('MADHYA PRADESH', 40000, '2027-03-31', {}, 2040, { inState: 1040, monthsInState: 5, monthsEmployed: 6 })!.employee).toBe(210);
  });
});

describe('somebody who moved state during the year', () => {
  it('owes the new state only the months paid there', async () => {
    const { applyStatutory } = await import('../services/payroll/statutory/resolve.js');
    const rules = new Map([['PT', rows.filter((r) => r.scheme === 'PT').map((r) => ({ ...r, configJson: JSON.stringify(r.seed.config), scheme: 'PT' }))]]) as any;
    const out = (byState: Map<string, any>) =>
      applyStatutory({
        rules,
        onDate: '2027-03-31',
        wages: { pfWage: 0, esiWage: 0, gross: 40000 },
        employee: person('MADHYA PRADESH'),
        components: [{ code: 'PT', statutoryScheme: 'PT', type: 'DEDUCTION' }],
        monthsRemaining: 1,
        taxAlreadyDeducted: 0,
        ptSoFar: { yearToDate: [...byState.values()].reduce((t, v) => t + v.amount, 0), thisMonth: 0, byState },
        ptMonthsEmployed: 12,
      }).amounts.PT;
    /* Six months in Karnataka, then Oct–Feb in Madhya Pradesh at ₹208: March takes six months' share (₹1,250) less ₹1,040. */
    const moved = new Map([['KARNATAKA', { amount: 1200, months: 6, gross: 240000 }], ['MADHYA PRADESH', { amount: 1040, months: 5, gross: 200000 }]]);
    expect(out(moved)).toBe(210);
    /* All year in Madhya Pradesh: the full year. */
    expect(out(new Map([['MADHYA PRADESH', { amount: 2288, months: 11, gross: 440000 }]]))).toBe(212);
  });
});

describe('months employed in the financial year', () => {
  it('counts from joining to leaving inside the year, else the whole year', async () => {
    const { monthsEmployedInYear } = await import('../services/payroll/run.js');
    expect(monthsEmployedInYear('2027-03-01', '2020-01-01', null)).toBe(12);
    expect(monthsEmployedInYear('2027-03-01', '2026-10-15', null)).toBe(6);
    expect(monthsEmployedInYear('2026-12-01', '2026-04-01', '2026-12-10')).toBe(9);
    expect(monthsEmployedInYear('2027-03-01', '2027-03-02', null)).toBe(1);
  });
});

describe('once a month', () => {
  it('takes nothing for a month another run already taxed', () => {
    const r = pt('KARNATAKA', 40000, '2026-11-30', {}, 1400, { thisMonth: 200 })!;
    expect(r.employee).toBe(0);
    expect(r.exemptReason).toBe('ALREADY_THIS_MONTH');
  });
});

describe('the ₹2,500 a year', () => {
  it('holds the last deduction to what is left of ₹2,500', () => {
    const r = pt('KARNATAKA', 40000, '2027-02-28', {}, 2400)!;
    expect(r.employee).toBe(100);
    expect(r.explanation).toMatch(/2,500/);
  });

  it('deducts nothing once ₹2,500 has been taken', () => {
    const r = pt('KARNATAKA', 40000, '2027-03-31', {}, 2500)!;
    expect(r.employee).toBe(0);
    expect(r.exemptReason).toBe('ANNUAL_CAP');
  });

  it('leaves an ordinary month alone', () => {
    expect(pt('KARNATAKA', 40000, '2026-11-30', {}, 1400)!.employee).toBe(200);
  });
});

describe('West Bengal’s new slabs from 1 October 2026', () => {
  it('uses the old slabs for September and the new ones from October', () => {
    expect(ruleFor('PT', 'WEST BENGAL', '2026-09-30')!.version).toBe('2023-04-01');
    expect(ruleFor('PT', 'WEST BENGAL', '2026-10-01')!.version).toBe('2026-10-01');
    /* ₹18,000: ₹130 under the old slabs, nil under the new. */
    expect(ptAmount('WEST BENGAL', 18000, '2026-09-30')).toBe(130);
    expect(ptAmount('WEST BENGAL', 18000, '2026-10-31')).toBe(0);
    /* ₹45,000: ₹200 old, ₹140 new. */
    expect(ptAmount('WEST BENGAL', 45000, '2026-09-30')).toBe(200);
    expect(ptAmount('WEST BENGAL', 45000, '2026-10-31')).toBe(140);
  });

  it('keeps the old slabs’ own edges for back-period runs', () => {
    expect(ptAmount('WEST BENGAL', 10000, '2026-06-30')).toBe(0);
    expect(ptAmount('WEST BENGAL', 10000.01, '2026-06-30')).toBe(110);
    expect(ptAmount('WEST BENGAL', 40000.01, '2026-06-30')).toBe(200);
  });
});

describe('states with no professional tax', () => {
  it('charges nothing in Odisha from 1 April 2026, and says so', () => {
    const r = pt('ODISHA', 50000, '2026-04-30')!;
    expect(r.employee).toBe(0);
    expect(r.exemptReason).toBe('NOT_LEVIED');
    expect(pt('ODISHA', 50000, '2027-01-31')!.employee).toBe(0);
  });

  it('has no Odisha rule of CLOR’s for the months before', () => {
    expect(ruleFor('PT', 'ODISHA', '2026-03-31')).toBeNull();
  });

  it('charges nothing in Chhattisgarh', () => {
    expect(pt('CHHATTISGARH', 50000)!.exemptReason).toBe('NOT_LEVIED');
  });

  it('has no PT rule at all for Delhi or Haryana', () => {
    expect(ruleFor('PT', 'DELHI', '2026-11-30')).toBeNull();
    expect(ruleFor('PT', 'HARYANA', '2026-11-30')).toBeNull();
  });
});

describe('Labour Welfare Fund, state by state', () => {
  const lwf = (state: string, gross: number, onDate: string, over: Record<string, unknown> = {}, ctx: { headcount?: number | null; coverage?: 'ALWAYS' | 'BY_HEADCOUNT' } = { headcount: 100 }) => {
    const rule = ruleFor('LWF', state, onDate);
    if (!rule) return null;
    return computeStatutory(rule, { pfWage: 0, esiWage: 0, gross }, person(state, over), { month: Number(onDate.slice(5, 7)), monthsRemaining: 1, taxAlreadyDeducted: 0, lwf: ctx });
  };
  const pair = (r: ReturnType<typeof lwf>) => (r ? [r.employee, r.employer] : null);

  const collections: Record<string, Array<[onDate: string, employee: number, employer: number]>> = {
    MAHARASHTRA: [['2026-06-30', 25, 75], ['2026-12-31', 25, 75], ['2026-07-31', 0, 0]],
    KARNATAKA: [['2026-12-31', 50, 100], ['2026-06-30', 0, 0]],
    'TAMIL NADU': [['2026-12-31', 20, 40], ['2026-06-30', 0, 0]],
    /* Both funds in June and December, only the shops fund in other months. */
    KERALA: [['2026-06-30', 95, 95], ['2026-07-31', 50, 50]],
    'ANDHRA PRADESH': [['2026-12-31', 30, 70], ['2026-11-30', 0, 0]],
    TELANGANA: [['2026-12-31', 2, 5]],
    GUJARAT: [['2026-06-30', 6, 12], ['2026-12-31', 6, 12], ['2026-05-31', 0, 0]],
    GOA: [['2026-06-30', 60, 180], ['2026-12-31', 60, 180]],
    'MADHYA PRADESH': [['2026-06-30', 10, 50], ['2026-12-31', 10, 50]],
    CHHATTISGARH: [['2026-06-30', 15, 45]],
    /* 0.2% of pay, capped at ₹35 / ₹70 from 2026 (₹34 / ₹68 in 2025), every month. */
    HARYANA: [['2026-03-31', 20, 40], ['2026-11-30', 35, 70], ['2025-11-30', 34, 68]],
    PUNJAB: [['2026-08-31', 5, 20], ['2026-11-30', 5, 20]],
    CHANDIGARH: [['2026-08-31', 5, 20]],
    DELHI: [['2026-06-30', 0.75, 2.25], ['2026-12-31', 0.75, 2.25], ['2026-08-31', 0, 0]],
    'WEST BENGAL': [['2026-06-30', 3, 30], ['2023-12-31', 3, 15]],
    ODISHA: [['2026-06-30', 10, 20], ['2026-12-31', 10, 20], ['2026-09-30', 0, 0]],
  };

  for (const [state, cases] of Object.entries(collections)) {
    it(`${state.toLowerCase()}`, () => {
      for (const [onDate, employee, employer] of cases) {
        const gross = state === 'HARYANA' && onDate === '2026-03-31' ? 10000 : 60000;
        expect({ onDate, amounts: pair(lwf(state, gross, onDate)) }).toEqual({ onDate, amounts: [employee, employer] });
      }
    });
  }

  it('says which months a state collects in', () => {
    expect(lwf('MAHARASHTRA', 30000, '2026-07-31')!.explanation).toMatch(/June and December/);
  });

  it('has no LWF rule for a state that does not collect it', () => {
    expect(ruleFor('LWF', 'RAJASTHAN', '2026-06-30')).toBeNull();
    expect(ruleFor('LWF', 'BIHAR', '2026-06-30')).toBeNull();
  });

  it('collects nothing below a state’s establishment size, unless the company says it is covered', () => {
    /* Karnataka: 10 or more from 7 Jan 2026. */
    expect(lwf('KARNATAKA', 30000, '2026-12-31', {}, { headcount: 9 })!.exemptReason).toBe('BELOW_SIZE');
    expect(pair(lwf('KARNATAKA', 30000, '2026-12-31', {}, { headcount: 10 }))).toEqual([50, 100]);
    expect(pair(lwf('KARNATAKA', 30000, '2026-12-31', {}, { headcount: 9, coverage: 'ALWAYS' }))).toEqual([50, 100]);
    /* More than 50 before the 2025 amendment. */
    expect(lwf('KARNATAKA', 30000, '2025-12-31', {}, { headcount: 30 })!.exemptReason).toBe('BELOW_SIZE');
    /* Goa has no threshold at all. */
    expect(pair(lwf('GOA', 30000, '2026-06-30', {}, { headcount: 1 }))).toEqual([60, 180]);
  });

  it('with no headcount to read, collects (the safe side)', () => {
    expect(pair(lwf('KARNATAKA', 30000, '2026-12-31', {}, {}))).toEqual([50, 100]);
  });

  it('always leaves out a manager, whatever they earn', () => {
    expect(lwf('MAHARASHTRA', 30000, '2026-06-30', { lwfRole: 'MANAGER' })!.exemptReason).toBe('MANAGER_EXCLUDED');
    expect(lwf('MAHARASHTRA', 3000, '2026-06-30', { lwfRole: 'MANAGER' })!.exemptReason).toBe('MANAGER_EXCLUDED');
    expect(lwf('ANDHRA PRADESH', 1000, '2026-12-31', { lwfRole: 'MANAGER' })!.exemptReason).toBe('MANAGER_EXCLUDED');
    /* Karnataka's Act leaves nobody out. */
    expect(pair(lwf('KARNATAKA', 30000, '2026-12-31', { lwfRole: 'MANAGER' }))).toEqual([50, 100]);
  });

  it('leaves out a supervisor only above the state’s pay limit', () => {
    /* ₹3,500 is Maharashtra's supervisory limit. */
    expect(pair(lwf('MAHARASHTRA', 3000, '2026-06-30', { lwfRole: 'SUPERVISOR' }))).toEqual([25, 75]);
    expect(lwf('MAHARASHTRA', 3500.01, '2026-06-30', { lwfRole: 'SUPERVISOR' })!.exemptReason).toBe('SUPERVISOR_EXCLUDED');
    /* Tamil Nadu: ₹15,000. */
    expect(pair(lwf('TAMIL NADU', 15000, '2026-12-31', { lwfRole: 'SUPERVISOR' }))).toEqual([20, 40]);
    expect(lwf('TAMIL NADU', 15000.01, '2026-12-31', { lwfRole: 'SUPERVISOR' })!.exemptReason).toBe('SUPERVISOR_EXCLUDED');
    /* Andhra Pradesh deleted its supervisory limit: supervisors contribute at any pay. */
    expect(pair(lwf('ANDHRA PRADESH', 90000, '2026-12-31', { lwfRole: 'SUPERVISOR' }))).toEqual([30, 70]);
  });

  it('keeps Kerala’s two funds apart', () => {
    const june = lwf('KERALA', 30000, '2026-06-30')!;
    expect(june.funds).toEqual([
      { name: 'Kerala Labour Welfare Fund', employee: 45, employer: 45 },
      { name: KERALA_SHOPS_FUND, employee: 50, employer: 50 },
    ]);
    expect(lwf('KERALA', 30000, '2026-07-31')!.funds).toEqual([{ name: KERALA_SHOPS_FUND, employee: 50, employer: 50 }]);
  });

  it('marks the rules CLOR could not confirm', () => {
    expect(lwf('MADHYA PRADESH', 30000, '2026-06-30')!.needsCheck).toBe(true);
    expect(lwf('MAHARASHTRA', 30000, '2026-06-30')!.needsCheck).toBe(false);
    expect(pt('MEGHALAYA', 30000)!.needsCheck).toBe(true);
    expect(pt('KARNATAKA', 30000)!.needsCheck).toBe(false);
  });
});

describe('state names and due dates', () => {
  it('lists the Union Territories with no professional tax', () => {
    for (const ut of ['Andaman & Nicobar Islands', 'Lakshadweep', 'Dadra and Nagar Haveli and Daman and Diu', 'DN', 'Daman and Diu']) {
      expect(NO_PT_STATES, ut).toContain(canonicalState(ut));
    }
  });

  it('reads a two-letter code, an old name and any case as the same state', () => {
    expect(canonicalState('KA')).toBe('KARNATAKA');
    expect(canonicalState(' karnataka ')).toBe('KARNATAKA');
    expect(canonicalState('IN-WB')).toBe('WEST BENGAL');
    expect(canonicalState('Orissa')).toBe('ODISHA');
    expect(canonicalState('Pondicherry')).toBe('PUDUCHERRY');
    expect(ptAmount('KA', 30000)).toBe(200);
  });

  it('puts each state’s PT return on its date', () => {
    expect(ptDueFor('Karnataka', 2026, 9)!.dueDate).toBe('2026-10-20');
    expect(ptDueFor('Maharashtra', 2026, 9)!.dueDate).toBe('2026-10-15');
    expect(ptDueFor('West Bengal', 2026, 9)!.dueDate).toBe('2026-10-21');
    expect(ptDueFor('Telangana', 2026, 12)!.dueDate).toBe('2027-01-10');
    /* Jharkhand files by quarter: July to September is one return, due 15 November. */
    expect(ptDueFor('Jharkhand', 2026, 7)).toEqual(ptDueFor('Jharkhand', 2026, 9));
    expect(ptDueFor('Jharkhand', 2026, 8)!.dueDate).toBe('2026-11-15');
    expect(ptDueFor('Jharkhand', 2026, 11)!.dueDate).toBe('2027-02-15');
    /* Tamil Nadu: September's deduction is due 30 September; February's by 31 March. */
    expect(ptDueFor('Tamil Nadu', 2026, 9)!.dueDate).toBe('2026-09-30');
    expect(ptDueFor('Tamil Nadu', 2027, 2)!.dueDate).toBe('2027-03-31');
  });

  it('puts each LWF collection on its date', () => {
    expect(lwfDueFor('Maharashtra', 2026, 6)!.dueDate).toBe('2026-07-15');
    expect(lwfDueFor('Maharashtra', 2026, 12)!.dueDate).toBe('2027-01-15');
    expect(lwfDueFor('Maharashtra', 2026, 7)).toBeNull();
    expect(lwfDueFor('Karnataka', 2026, 12)!.dueDate).toBe('2027-01-15');
    expect(lwfDueFor('Tamil Nadu', 2026, 12)!.dueDate).toBe('2027-01-31');
    /* Punjab accrues monthly and pays half-yearly: April to September by 15 October. */
    expect(lwfDueFor('Punjab', 2026, 4)).toEqual(lwfDueFor('Punjab', 2026, 9));
    expect(lwfDueFor('Punjab', 2026, 6)!.dueDate).toBe('2026-10-15');
    expect(lwfDueFor('Punjab', 2027, 2)!.dueDate).toBe('2027-04-15');
    expect(lwfDueFor('Punjab', 2026, 11)).toEqual(lwfDueFor('Punjab', 2027, 2));
    /* Kerala's shops fund: every month, by the 5th of the next. */
    expect(lwfDueFor('Kerala', 2026, 11, KERALA_SHOPS_FUND)!.dueDate).toBe('2026-12-05');
    expect(lwfDueFor('Kerala', 2026, 12, KERALA_SHOPS_FUND)!.dueDate).toBe('2027-01-05');
    expect(lwfDueFor('Kerala', 2026, 12)!.dueDate).toBe('2027-01-15');
  });
});
