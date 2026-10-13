/**
 * The statutory rates a company starts with.
 *
 * Seed data, not the engine. Every figure here is a row somebody can supersede
 * with a new version from a new date, and none of it is read by the calculation
 * — the calculation reads whatever rule is in force. These exist so that a
 * company switching payroll on does not begin by typing the PF ceiling from
 * memory.
 *
 * They are dated from a deliberately early effective date so that any payroll
 * run finds them. When a rate changes, the answer is a NEW version from the day
 * it changes, never an edit here: a payslip records the version it used, and
 * editing a live rate would restate months that have already been filed.
 *
 * Accurate as of the 2025-26 Indian financial year. Verify before relying on
 * them for a live payroll — they are a starting point, and the law moves.
 */

export type SeedRule = {
  scheme: 'PF' | 'ESI' | 'PT' | 'TDS';
  jurisdiction: string | null;
  version: string;
  effectiveFrom: string;
  employeeRate: number;
  employerRate: number;
  wageCeiling: number | null;
  eligibilityThreshold: number | null;
  rounding: 'NONE' | 'NEAREST' | 'UP' | 'DOWN';
  config: Record<string, unknown>;
  note: string;
};

export const SEED_RULES: SeedRule[] = [
  {
    scheme: 'PF',
    jurisdiction: 'IN',
    version: '2014-09-01',
    effectiveFrom: '2014-09-01',
    employeeRate: 12,
    employerRate: 12,
    /* Above this, the contribution stops growing — which is why somebody on
       ₹60,000 and somebody on ₹1,50,000 both contribute ₹1,800. */
    wageCeiling: 15000,
    eligibilityThreshold: null,
    rounding: 'NEAREST',
    config: {
      /* The employer's 12% is not one payment: 8.33% goes to the pension
         scheme, capped on its own ceiling, and the rest to the fund. */
      epsRate: 8.33,
      epsWageCeiling: 15000,
      edliRate: 0.5,
      /* Some companies contribute on the whole wage rather than the ceiling.
         Both are lawful; this is the common choice. */
      contributeOnFullWage: false,
    },
    note: 'Employee and employer each 12% of PF wages, capped at a ₹15,000 wage ceiling. The employer share splits 8.33% to EPS and the remainder to EPF.',
  },
  {
    scheme: 'ESI',
    jurisdiction: 'IN',
    version: '2019-07-01',
    effectiveFrom: '2019-07-01',
    employeeRate: 0.75,
    employerRate: 3.25,
    wageCeiling: null,
    /* A threshold, not a ceiling: earn above it and the scheme does not apply
       at all, so a small raise can end somebody's cover. */
    eligibilityThreshold: 21000,
    rounding: 'UP',
    config: {},
    note: 'Employee 0.75% and employer 3.25% of ESI wages, for anybody earning up to ₹21,000 a month.',
  },
  {
    scheme: 'PT',
    jurisdiction: 'KARNATAKA',
    version: '2023-04-01',
    effectiveFrom: '2023-04-01',
    employeeRate: 0,
    employerRate: 0,
    wageCeiling: null,
    eligibilityThreshold: null,
    rounding: 'NEAREST',
    config: {
      slabs: [
        { from: 0, to: 24999.99, amount: 0 },
        { from: 25000, to: null, amount: 200 },
      ],
    },
    note: 'Karnataka: ₹200 a month once monthly salary reaches ₹25,000.',
  },
  {
    scheme: 'PT',
    jurisdiction: 'MAHARASHTRA',
    version: '2023-04-01',
    effectiveFrom: '2023-04-01',
    employeeRate: 0,
    employerRate: 0,
    wageCeiling: null,
    eligibilityThreshold: null,
    rounding: 'NEAREST',
    config: {
      slabs: [
        { from: 0, to: 7500, amount: 0 },
        { from: 7500.01, to: 10000, amount: 175 },
        /* February carries the year's balance in Maharashtra, which is why a
           slab can name the months it applies to. */
        { from: 10000.01, to: null, amount: 200, months: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
        { from: 10000.01, to: null, amount: 300, months: [2] },
      ],
    },
    note: 'Maharashtra: banded by salary, with the year’s balance collected in February.',
  },
  {
    scheme: 'PT',
    jurisdiction: 'WEST BENGAL',
    version: '2023-04-01',
    effectiveFrom: '2023-04-01',
    employeeRate: 0,
    employerRate: 0,
    wageCeiling: null,
    eligibilityThreshold: null,
    rounding: 'NEAREST',
    config: {
      slabs: [
        { from: 0, to: 10000, amount: 0 },
        { from: 10000.01, to: 15000, amount: 110 },
        { from: 15000.01, to: 25000, amount: 130 },
        { from: 25000.01, to: 40000, amount: 150 },
        { from: 40000.01, to: null, amount: 200 },
      ],
    },
    note: 'West Bengal: five bands from ₹10,000 upward.',
  },
  {
    scheme: 'TDS',
    jurisdiction: 'IN',
    version: '2025-04-01',
    effectiveFrom: '2025-04-01',
    employeeRate: 0,
    employerRate: 0,
    wageCeiling: null,
    eligibilityThreshold: null,
    rounding: 'NEAREST',
    config: {
      standardDeduction: 75000,
      /* Each rate applies only to the part of income inside its band. */
      newRegimeBands: [
        { upTo: 400000, rate: 0 },
        { upTo: 800000, rate: 5 },
        { upTo: 1200000, rate: 10 },
        { upTo: 1600000, rate: 15 },
        { upTo: 2000000, rate: 20 },
        { upTo: 2400000, rate: 25 },
        { upTo: null, rate: 30 },
      ],
      oldRegimeBands: [
        { upTo: 250000, rate: 0 },
        { upTo: 500000, rate: 5 },
        { upTo: 1000000, rate: 20 },
        { upTo: null, rate: 30 },
      ],
      /* A rebate wipes the tax out below the threshold rather than reducing
         it, so somebody just under the line pays nothing at all. */
      rebateUpTo: 1200000,
      rebateMax: 60000,
      cessRate: 4,
    },
    note: 'Income tax withheld from salary, new regime by default. Declarations and investment proofs are not modelled yet.',
  },
];

export const SCHEME_NAMES: Record<string, string> = {
  PF: 'Provident Fund',
  ESI: 'Employee State Insurance',
  PT: 'Professional Tax',
  TDS: 'Income Tax (TDS)',
  LWF: 'Labour Welfare Fund',
};
