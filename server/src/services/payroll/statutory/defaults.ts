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
 * PF and ESI are accurate as of the 2025-26 Indian financial year; TDS for
 * 2025-26 and 2026-27, each version citing the law it follows.
 * Professional tax and Labour Welfare Fund come from CLOR's state-by-state
 * research of 2 Nov 2026 (statePt.ts and stateLwf.ts), each rule's note naming
 * its source and how sure it is. Verify before relying on them for a live
 * payroll — they are a starting point, and the law moves.
 */

import { PT_SEEDS } from './statePt.js';
import { LWF_SEEDS } from './stateLwf.js';

export type SeedRule = {
  scheme: 'PF' | 'ESI' | 'PT' | 'TDS' | 'LWF';
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
    scheme: 'TDS',
    jurisdiction: 'IN',
    version: '2025-04-01',
    effectiveFrom: '2025-04-01',
    employeeRate: 0,
    employerRate: 0,
    wageCeiling: null,
    eligibilityThreshold: null,
    rounding: 'NEAREST',
    /*
     * As first seeded, and left as it was: companies hold copies of it. The
     * figures it lacks (old regime slabs by age, surcharge, employer NPS, the
     * no-PAN rate) are the engine's fallbacks, the same as the 2026-04-01
     * version below (statutory/engine.ts incomeTax).
     */
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
      /* Just over ₹12 lakh, tax is capped at the income above it. */
      marginalRelief: true,
      cessRate: 4,
      /* The old regime's own deduction and rebate (section 87A). */
      oldRegime: { standardDeduction: 50000, rebateUpTo: 500000, rebateMax: 12500, marginalRelief: false },
    },
    note: 'Income tax withheld from salary for 2025-26 (Income-tax Act 1961, Finance Act 2025), new regime by default.',
  },
  {
    scheme: 'TDS',
    jurisdiction: 'IN',
    version: '2026-04-01',
    effectiveFrom: '2026-04-01',
    employeeRate: 0,
    employerRate: 0,
    wageCeiling: null,
    eligibilityThreshold: null,
    rounding: 'NEAREST',
    /*
     * Tax year 2026-27, the first under the Income-tax Act 2025 (as amended by
     * the Finance Act 2026; ICAI's text of April 2026). The Finance Act 2026
     * kept 2025-26's figures; this version writes every one of them down, with
     * where it comes from, rather than leaving any to the engine.
     */
    config: {
      /* Section 19(1) Table Sl. No. 2(a): ₹75,000 under section 202(1). */
      standardDeduction: 75000,
      /* Section 202(1) Table. */
      newRegimeBands: [
        { upTo: 400000, rate: 0 },
        { upTo: 800000, rate: 5 },
        { upTo: 1200000, rate: 10 },
        { upTo: 1600000, rate: 15 },
        { upTo: 2000000, rate: 20 },
        { upTo: 2400000, rate: 25 },
        { upTo: null, rate: 30 },
      ],
      /* Finance Act 2026, First Schedule Part III Paragraph A(I): under 60. */
      oldRegimeBands: [
        { upTo: 250000, rate: 0 },
        { upTo: 500000, rate: 5 },
        { upTo: 1000000, rate: 20 },
        { upTo: null, rate: 30 },
      ],
      /* Section 156(2): rebate up to ₹60,000 on income up to ₹12 lakh, with marginal relief above. */
      rebateUpTo: 1200000,
      rebateMax: 60000,
      marginalRelief: true,
      /* Finance Act 2026 section 3(12)(b) Table Sl. No. 10: section 202 income, capped at 25%. */
      surcharge: [
        { over: 5000000, rate: 10 },
        { over: 10000000, rate: 15 },
        { over: 20000000, rate: 25 },
      ],
      /* Section 124(2): 14% of salary under section 202(1). */
      employerNpsRate: 14,
      /* Health and Education Cess, 4% of tax and surcharge (Finance Act 2026 section 3). */
      cessRate: 4,
      /* Section 397(2)(b)(i)(C): 20% where no valid PAN is furnished. */
      noPanRate: 20,
      oldRegime: {
        /* Section 19(1) Table Sl. No. 2(b). */
        standardDeduction: 50000,
        /* Section 156(1): up to ₹12,500 on income up to ₹5 lakh, no marginal relief. */
        rebateUpTo: 500000,
        rebateMax: 12500,
        marginalRelief: false,
        /* Part III Paragraph A(II), resident 60 to 79 at any time in the year. */
        seniorBands: [
          { upTo: 300000, rate: 0 },
          { upTo: 500000, rate: 5 },
          { upTo: 1000000, rate: 20 },
          { upTo: null, rate: 30 },
        ],
        /* Part III Paragraph A(III), resident 80 or over. */
        superSeniorBands: [
          { upTo: 500000, rate: 0 },
          { upTo: 1000000, rate: 20 },
          { upTo: null, rate: 30 },
        ],
        /* Part III Paragraph F Table 1 Sl. No. 1, with marginal relief under Table 2. */
        surcharge: [
          { over: 5000000, rate: 10 },
          { over: 10000000, rate: 15 },
          { over: 20000000, rate: 25 },
          { over: 50000000, rate: 37 },
        ],
        /* Section 124(1)(b): 10% of salary, an employer other than a government. */
        employerNpsRate: 10,
      },
    },
    note: 'Income tax withheld from salary for 2026-27 (Income-tax Act 2025 section 392, Finance Act 2026), new regime by default. Same figures as 2025-26.',
  },
  ...PT_SEEDS,
  ...LWF_SEEDS,
];

/**
 * Bumped whenever the rules above change, so every company that has seeded
 * before is topped up once (resolve.ts `ensureStatutoryCatalogue`).
 */
export const SEED_CATALOGUE_VERSION = '2026-11-06.1';

/**
 * Rules CLOR seeded once and has since corrected under a new version, kept so
 * that a company's untouched copy is still recognised as CLOR's (and replaced)
 * rather than mistaken for one the company wrote.
 */
export const LEGACY_SEEDS: Array<Pick<SeedRule, 'scheme' | 'jurisdiction' | 'version' | 'config'>> = [
  {
    scheme: 'PT',
    jurisdiction: 'MAHARASHTRA',
    version: '2023-04-01',
    config: {
      slabs: [
        { from: 0, to: 7500, amount: 0 },
        { from: 7500.01, to: 10000, amount: 175 },
        { from: 10000.01, to: null, amount: 200, months: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
        { from: 10000.01, to: null, amount: 300, months: [2] },
      ],
    },
  },
  {
    scheme: 'PT',
    jurisdiction: 'KARNATAKA',
    version: '2023-04-01',
    config: { slabs: [{ from: 0, to: 24999.99, amount: 0 }, { from: 25000, to: null, amount: 200 }] },
  },
  {
    scheme: 'PT',
    jurisdiction: 'WEST BENGAL',
    version: '2023-04-01',
    config: {
      slabs: [
        { from: 0, to: 10000, amount: 0 },
        { from: 10000.01, to: 15000, amount: 110 },
        { from: 15000.01, to: 25000, amount: 130 },
        { from: 25000.01, to: 40000, amount: 150 },
        { from: 40000.01, to: null, amount: 200 },
      ],
    },
  },
];

export const SCHEME_NAMES: Record<string, string> = {
  PF: 'Provident Fund',
  ESI: 'Employee State Insurance',
  PT: 'Professional Tax',
  TDS: 'Income Tax (TDS)',
  LWF: 'Labour Welfare Fund',
};
