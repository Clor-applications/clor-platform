import type { SeedRule } from './defaults.js';

/**
 * Labour Welfare Fund, every state that collects it, as researched on 2 Nov
 * 2026 (CLOR's PT and LWF research; where sources disagreed, the value it
 * recommends). Seed data: a company corrects any of these with a new version.
 *
 * How a rule reads (engine.ts `computeLwf`):
 *
 *   employeeAmount / employerAmount   rupees each time it is collected, or
 *   employeeRate / employerRate       (the rule's rates) % of gross, capped by
 *                                     employeeCap / employerCap
 *   months                            the payroll months it is deducted in
 *                                     (none: every month)
 *   minEmployees                      the establishment size it starts at;
 *                                     read against the people in payroll in
 *                                     that state unless the company says it is
 *                                     covered anyway (Payroll settings)
 *   excludesManagers                  managers and supervisors are left out;
 *   supervisorWageAbove               ... those earning above this a month,
 *                                     where the Act sets a limit. Who counts
 *                                     is the company's list of designations.
 *   employerMinimumPerEstablishment   the least the employer pays per
 *                                     establishment each collection (the
 *                                     return shows any top-up)
 *   funds                             a state with two funds (Kerala): each
 *                                     with its own amounts and months
 *   needsCheck                        CLOR could not confirm the figures; a
 *                                     run warns until HR confirms them
 */

const lwf = (
  jurisdiction: string,
  effectiveFrom: string,
  config: Record<string, unknown>,
  note: string,
  over: Partial<SeedRule> = {}
): SeedRule => ({
  scheme: 'LWF',
  jurisdiction,
  version: effectiveFrom,
  effectiveFrom,
  employeeRate: 0,
  employerRate: 0,
  wageCeiling: null,
  eligibilityThreshold: null,
  rounding: 'NEAREST',
  config,
  note,
  ...over,
});

const JUNE_DECEMBER = [6, 12];

export const LWF_SEEDS: SeedRule[] = [
  lwf(
    'MAHARASHTRA',
    '2024-03-18',
    { employeeAmount: 25, employerAmount: 75, months: JUNE_DECEMBER, minEmployees: 5, excludesManagers: true, supervisorWageAbove: 3500 },
    'Maharashtra, from 18 Mar 2024 (Act 25 of 2024): ₹25 from pay and ₹75 from the employer in June and December, for establishments of 5 or more. Managers, and supervisors on more than ₹3,500, are left out. Form A-1 still prints the old slabs. Fairly sure.'
  ),
  lwf(
    'KARNATAKA',
    '2024-12-01',
    { employeeAmount: 50, employerAmount: 100, months: [12], minEmployees: 51 },
    'Karnataka, from the December 2024 collection (LWF Amendment Act 2024): ₹50 and ₹100 once a year from December pay, for establishments of more than 50. Sure of the rates.'
  ),
  lwf(
    'KARNATAKA',
    '2026-01-07',
    { employeeAmount: 50, employerAmount: 100, months: [12], minEmployees: 10 },
    'Karnataka, from 7 Jan 2026 (LWF Amendment Act 2025): the same ₹50 and ₹100, now for establishments of 10 or more. Fairly sure of the new threshold.'
  ),
  lwf(
    'TAMIL NADU',
    '2022-12-01',
    { employeeAmount: 20, employerAmount: 40, months: [12], minEmployees: 5, excludesManagers: true, supervisorWageAbove: 15000 },
    'Tamil Nadu: ₹20 and ₹40 a year, deducted in December and paid by 31 January, for establishments of 5 or more. Managers, and supervisors on more than ₹15,000, are left out. Sure of the amounts; one source reads the due date as 31 July.'
  ),
  lwf(
    'KERALA',
    '2022-09-01',
    {
      needsCheck: true,
      funds: [
        { name: 'Kerala Labour Welfare Fund', employeeAmount: 45, employerAmount: 45, months: JUNE_DECEMBER, minEmployees: 2, excludesManagers: true },
        { name: 'Shops and Commercial Establishments Workers Welfare Fund', employeeAmount: 50, employerAmount: 50 },
      ],
    },
    'Kerala has two funds and a shop or office can owe both: the Labour Welfare Fund, ₹45 and ₹45 each half-year (June and December) from 16 Jan 2020, and the Shops and Commercial Establishments Workers Welfare Fund, ₹50 and ₹50 a month from 1 Sep 2022. A factory owes only the first: correct the rule if so. Fairly sure.'
  ),
  lwf(
    'ANDHRA PRADESH',
    '2015-01-01',
    { employeeAmount: 30, employerAmount: 70, months: [12], minEmployees: 20, excludesManagers: true },
    'Andhra Pradesh (LWF Amendment Act 2015): ₹30 and ₹70 a year, on the register at 31 December, for establishments of 20 or more; managers left out. Dated from the start of 2015, as the exact day was not found. Sure of it.'
  ),
  lwf(
    'TELANGANA',
    '2014-06-02',
    { employeeAmount: 2, employerAmount: 5, months: [12], minEmployees: 20, excludesManagers: true, supervisorWageAbove: 1600 },
    'Telangana: ₹2 and ₹5 a year, on the register at 31 December, for establishments of 20 or more (the old Andhra Pradesh rates, carried over). Fairly sure.'
  ),
  lwf(
    'GUJARAT',
    '2016-12-01',
    { employeeAmount: 6, employerAmount: 12, months: JUNE_DECEMBER, minEmployees: 10, excludesManagers: true, supervisorWageAbove: 3500 },
    'Gujarat, from the December 2016 revision: ₹6 and ₹12 in June and December, for establishments of 10 or more. Sure of it.'
  ),
  lwf(
    'GOA',
    '2015-08-28',
    { employeeAmount: 60, employerAmount: 180, months: JUNE_DECEMBER, excludesManagers: true, supervisorWageAbove: 1600 },
    'Goa (LWF Amendment Act 2015): ₹120 and ₹360 a year, collected as half in June and half in December. No size threshold. Fairly sure.'
  ),
  lwf(
    'MADHYA PRADESH',
    '2026-01-30',
    { employeeAmount: 10, employerAmount: 50, months: JUNE_DECEMBER, minEmployees: 10, excludesManagers: true, supervisorWageAbove: 1600, employerMinimumPerEstablishment: 2500, needsCheck: true },
    'Madhya Pradesh, from 30 Jan 2026 (Notification F. LAB-8-0003-2025): ₹10 and ₹50 each half-year, the employer paying at least ₹2,500 per establishment. One publisher, read from a photo of the gazette; the board’s own page still shows ₹30. Not sure — confirm with the MP Shram Kalyan Mandal.'
  ),
  lwf(
    'CHHATTISGARH',
    '2000-01-01',
    { employeeAmount: 15, employerAmount: 45, months: JUNE_DECEMBER, minEmployees: 10, excludesManagers: true, supervisorWageAbove: 1600, employerMinimumPerEstablishment: 1500 },
    'Chhattisgarh: ₹15 and ₹45 each half-year, the employer paying at least ₹1,500 per establishment. No start date was found; it is dated early so older months find it. Fairly sure.'
  ),
  lwf(
    'HARYANA',
    '2025-01-01',
    { employeeCap: 34, employerCap: 68, minEmployees: 10 },
    'Haryana in 2025: 0.2% of monthly pay, at most ₹34, and twice that from the employer, at most ₹68. Every month, for establishments of 10 or more. Sure of it.',
    { employeeRate: 0.2, employerRate: 0.4 }
  ),
  lwf(
    'HARYANA',
    '2026-01-01',
    { employeeCap: 35, employerCap: 70, minEmployees: 10 },
    'Haryana from 1 Jan 2026 (Notification of 8 May 2026, backdated): 0.2% of monthly pay, at most ₹35, and twice that from the employer, at most ₹70. Sure of the rate and cap; the monthly due date is not confirmed.',
    { employeeRate: 0.2, employerRate: 0.4 }
  ),
  lwf(
    'PUNJAB',
    '2014-12-15',
    { employeeAmount: 5, employerAmount: 20, minEmployees: 21 },
    'Punjab, from 15 Dec 2014 (Act 32 of 2014): ₹5 and ₹20 every month, paid half-yearly, for factories and establishments of more than 20. Fairly sure.'
  ),
  lwf(
    'CHANDIGARH',
    '2018-04-10',
    { employeeAmount: 5, employerAmount: 20, minEmployees: 21, needsCheck: true },
    'Chandigarh, from 10 Apr 2018 (Punjab’s Act applied): ₹5 and ₹20 every month. Whether it starts at more than 20 people or at 10 is not settled. Not sure of the threshold.'
  ),
  lwf(
    'DELHI',
    '1986-12-15',
    { employeeAmount: 0.75, employerAmount: 2.25, months: JUNE_DECEMBER, minEmployees: 5, excludesManagers: true, supervisorWageAbove: 1600 },
    'Delhi, unchanged since 1986: 75 paise and ₹2.25 in June and December, for establishments of 5 or more. Supervisors on more than ₹1,600 are left out (the board uses ₹2,500). Fairly sure.',
    { rounding: 'NONE' }
  ),
  lwf(
    'WEST BENGAL',
    '2000-01-01',
    { employeeAmount: 3, employerAmount: 15, months: JUNE_DECEMBER, minEmployees: 10, excludesManagers: true },
    'West Bengal before 2024: ₹3 and ₹15 in June and December. Kept for older months; dated early as its start date is not known.'
  ),
  lwf(
    'WEST BENGAL',
    '2024-01-01',
    { employeeAmount: 3, employerAmount: 30, months: JUNE_DECEMBER, minEmployees: 10, excludesManagers: true },
    'West Bengal, from 1 Jan 2024 (Notification of 19 Nov 2024, backdated): ₹3 and ₹30 in June and December, for establishments of 10 or more; managers left out. Fairly sure.'
  ),
  lwf(
    'ODISHA',
    '2017-05-01',
    { employeeAmount: 10, employerAmount: 20, months: JUNE_DECEMBER, minEmployees: 20, excludesManagers: true, needsCheck: true },
    'Odisha, from 1 May 2017: ₹20 and ₹40 a year in two instalments (₹10 and ₹20 in June and December), for establishments of 20 or more. Sources disagree on the amounts. Not sure.'
  ),
];
