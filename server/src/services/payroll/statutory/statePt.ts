import type { SeedRule } from './defaults.js';

/**
 * Professional tax, every state that levies it on salaries, as researched on
 * 2 Nov 2026 (CLOR's PT and LWF research; where sources disagreed, the value
 * that research recommends). Seed data: a company corrects any of these with
 * a new version from a date, never by editing.
 *
 * How a slab reads (engine.ts `computePt`):
 *
 *   from / to       the band, inclusive; `to: null` is open-ended. Rupees and
 *                   paise, so "₹7,501 to ₹10,000" is 7500.01 to 10000.
 *   amount          rupees per month, or per year / half-year where the rule's
 *                   `basis` says so
 *   monthAmounts    a different amount in a named month: {"2": 300} is ₹300
 *                   in February
 *   gender          FEMALE, or MALE (which also covers anybody not recorded
 *                   as a woman): Maharashtra's women's bands
 *
 * And the rule's config around them:
 *
 *   basis           MONTHLY (default), ANNUAL or HALF_YEARLY: what the bands
 *                   and amounts are measured in. Pay is read as this month's
 *                   gross × 12 or × 6.
 *   collectMonths   for ANNUAL and HALF_YEARLY: the months the whole amount is
 *                   taken in. Without it, an annual amount is spread over
 *                   twelve months with the balance in `balanceMonth` (March).
 *   annualCap       ₹2,500, the Constitution's limit (Article 276(2)); no
 *                   deduction takes a person past it in a financial year.
 *   notLevied       the state charges no professional tax from this date.
 *   needsCheck      CLOR could not confirm these figures from an official
 *                   notice: a run that uses them warns until HR confirms.
 *   localBody       for states that levy through corporations and
 *                   municipalities: whose rates these are.
 */

type Band = [upTo: number | null, amount: number, extra?: Record<string, unknown>];

/**
 * Bands written as the research tables are: each "to" and its amount, the
 * "from" being a paisa above the band before. A table whose next band starts
 * on a round figure (₹24,999 then ₹25,000) is written with a to of 24999.99.
 */
function bands(rows: Band[], gender?: 'FEMALE' | 'MALE') {
  let from = 0;
  return rows.map(([to, amount, extra]) => {
    const slab = { from, to, amount, ...(gender ? { gender } : {}), ...(extra || {}) };
    from = to == null ? from : Math.round((to + 0.01) * 100) / 100;
    return slab;
  });
}

const FEBRUARY_300 = { monthAmounts: { '2': 300 } };

const pt = (jurisdiction: string, effectiveFrom: string, config: Record<string, unknown>, note: string, version = effectiveFrom): SeedRule => ({
  scheme: 'PT',
  jurisdiction,
  version,
  effectiveFrom,
  employeeRate: 0,
  employerRate: 0,
  wageCeiling: null,
  eligibilityThreshold: null,
  rounding: 'NEAREST',
  config: { annualCap: 2500, ...config },
  note,
});

export const PT_SEEDS: SeedRule[] = [
  pt(
    'MAHARASHTRA',
    '2023-04-01',
    {
      slabs: [
        ...bands([[7500, 0], [10000, 175], [null, 200, FEBRUARY_300]], 'MALE'),
        ...bands([[25000, 0], [null, 200, FEBRUARY_300]], 'FEMALE'),
      ],
    },
    /* Source: Maharashtra, from 1 Apr 2023: men nil to ₹7,500, ₹175 to ₹10,000, then ₹200 (₹300 in February); women nil to ₹25,000, then ₹200 (₹300 in February). Read in the state’s official rate schedule (mahagst.gov.in). Sure of it. */
    'Maharashtra: men pay nothing up to ₹7,500 a month, ₹175 up to ₹10,000, then ₹200 (₹300 in February). Women pay nothing up to ₹25,000, then ₹200 (₹300 in February). From 1 Apr 2023. Checked against the state’s official rate schedule.',
    /* Corrects the first seeded version, which had no women's bands. */
    '2023-04-01.2'
  ),
  pt(
    'KARNATAKA',
    '2023-04-01',
    { slabs: bands([[24999.99, 0], [null, 200]]) },
    /* Source: Karnataka before Apr 2025: ₹200 a month from ₹25,000, with no February change. Kept for months before the 2025 amendment. */
    'Karnataka: ₹200 a month from ₹25,000. Used for months before April 2025. Confirmed by several published sources.'
  ),
  pt(
    'KARNATAKA',
    '2025-04-01',
    { slabs: bands([[24999.99, 0], [null, 200, FEBRUARY_300]]) },
    /* Source: Karnataka, from 1 Apr 2025 (Act 33 of 2025): nil below ₹25,000, then ₹200 a month and ₹300 in February — ₹2,500 a year. Several payroll publishers agree (Lexplosion, greytHR, K S & K). Sure of the slab. */
    'Karnataka: ₹200 a month from ₹25,000, ₹300 in February. From 1 Apr 2025. Confirmed by several published sources.'
  ),
  pt(
    'WEST BENGAL',
    '2023-04-01',
    { slabs: bands([[10000, 0], [15000, 110], [25000, 130], [40000, 150], [null, 200]]) },
    /* Source: West Bengal until 30 Sep 2026: nil to ₹10,000, then ₹110, ₹130, ₹150 and ₹200. Kept for months before the new schedule. Sure of it. */
    'West Bengal: nothing up to ₹10,000 a month, then ₹110, ₹130, ₹150 and ₹200. Used for months up to September 2026. Confirmed by several published sources.'
  ),
  pt(
    'WEST BENGAL',
    '2026-10-01',
    { slabs: bands([[20000, 0], [30000, 100], [50000, 140], [100000, 170], [null, 208]]) },
    /* Source: West Bengal, from 1 Oct 2026 (Notification 1607-F.T. of 16 Sep 2026): nil to ₹20,000, then ₹100, ₹140, ₹170 and ₹208. Several publishers agree and cite the gazette, which CLOR could not open. Fairly sure. */
    'West Bengal: nothing up to ₹20,000 a month, then ₹100, ₹140, ₹170 and ₹208. From 1 Oct 2026. As commonly published; not yet checked against the state’s own notice.'
  ),
  pt(
    'GUJARAT',
    '2022-04-01',
    { slabs: bands([[12000, 0], [null, 200]]) },
    /* Source: Gujarat, from 1 Apr 2022: nil to ₹12,000, then ₹200 a month. greytHR and TankhaPay agree. Sure of the slab. */
    'Gujarat: ₹200 a month above ₹12,000. From 1 Apr 2022. Confirmed by several published sources.'
  ),
  pt(
    'TELANGANA',
    '2013-02-06',
    { slabs: bands([[15000, 0], [20000, 150], [null, 200]]) },
    /* Source: Telangana: nil to ₹15,000, ₹150 to ₹20,000, then ₹200. Unchanged since 2013. Sure of the slab. */
    'Telangana: nothing up to ₹15,000 a month, ₹150 up to ₹20,000, then ₹200. Confirmed by several published sources.'
  ),
  pt(
    'ANDHRA PRADESH',
    '2013-02-06',
    { slabs: bands([[15000, 0], [20000, 150], [null, 200]]) },
    /* Source: Andhra Pradesh: nil to ₹15,000, ₹150 to ₹20,000, then ₹200. In force before 2025; the start date shown is Telangana’s, as the exact one was not found. Sure of the slab. */
    'Andhra Pradesh: nothing up to ₹15,000 a month, ₹150 up to ₹20,000, then ₹200. Confirmed by several published sources.'
  ),
  pt(
    'TAMIL NADU',
    '2024-10-01',
    {
      basis: 'HALF_YEARLY',
      collectMonths: [9, 2],
      localBody: 'Greater Chennai Corporation',
      needsCheck: true,
      slabs: bands([[21000, 0], [30000, 180], [45000, 425], [60000, 930], [75000, 1025], [null, 1250]]),
    },
    /* Source: Tamil Nadu is levied by each corporation and municipality. These are the Greater Chennai Corporation’s half-yearly rates from 1 Oct 2024 (circular of 20 Jan 2025), taken in the September and February payroll on six months’ pay. Fairly sure of Chennai’s figures; other local bodies charge their own, so check yours. */
    'Tamil Nadu (Greater Chennai Corporation): ₹180 to ₹1,250 a half-year by six months’ pay, taken in the September and February payroll. From 1 Oct 2024. Other corporations and municipalities set their own rates. Not yet checked against the state’s own notice — confirm before use.'
  ),
  pt(
    'KERALA',
    '2024-10-01',
    {
      basis: 'HALF_YEARLY',
      collectMonths: [8, 2],
      /* Set by G.O. 1149/2024/LSGD. */
      localBody: 'Panchayats',
      needsCheck: true,
      slabs: bands([[11999.99, 0], [17999.99, 320], [29999.99, 450], [44999.99, 600], [99999.99, 750], [124999.99, 1000], [null, 1250]]),
    },
    /* Source: Kerala, from 1 Oct 2024 (G.O. 1149/2024/LSGD): half-yearly bands, taken in the August and February payroll on six months’ pay. One publisher (SGCMS) gives the full table; others confirm only the date. Not fully sure — and check that your municipality or corporation uses the same rates. */
    'Kerala: ₹320 to ₹1,250 a half-year by six months’ pay, taken in the August and February payroll. From 1 Oct 2024. Check your local body uses these rates. Not yet checked against the state’s own notice — confirm before use.'
  ),
  pt(
    'MADHYA PRADESH',
    '2018-04-01',
    { basis: 'ANNUAL', balanceMonth: 3, slabs: bands([[225000, 0], [300000, 1500], [400000, 2000], [null, 2500]]) },
    /* Source: Madhya Pradesh, from 1 Apr 2018: yearly bands on yearly pay — nil to ₹2.25 lakh, then ₹1,500, ₹2,000 and ₹2,500 a year, spread monthly with the balance in March (₹166 and ₹174; ₹208 and ₹212). greytHR and TankhaPay; one greytHR table disagrees on the ₹3–4 lakh band. Fairly sure. */
    'Madhya Pradesh: by yearly pay — nothing up to ₹2.25 lakh, then ₹1,500, ₹2,000 or ₹2,500 a year, taken monthly with the balance in March. From 1 Apr 2018. As commonly published; not yet checked against the state’s own notice.'
  ),
  pt(
    'ASSAM',
    '2025-04-01',
    { slabs: bands([[15000, 0], [24999.99, 180], [null, 208]]) },
    /* Source: Assam, from 1 Apr 2025: nil to ₹15,000, ₹180 to ₹24,999, then ₹208. Publishers differ on whether exactly ₹25,000 pays ₹180 or ₹208. Fairly sure. */
    'Assam: nothing up to ₹15,000 a month, ₹180 up to ₹24,999, then ₹208. From 1 Apr 2025. As commonly published; not yet checked against the state’s own notice.'
  ),
  pt(
    'BIHAR',
    '2011-04-01',
    { basis: 'ANNUAL', collectMonths: [9], slabs: bands([[300000, 0], [500000, 1000], [1000000, 2000], [null, 2500]]) },
    /* Source: Bihar (Act of 2011): yearly bands — nil to ₹3 lakh, then ₹1,000, ₹2,000 and ₹2,500 — taken once a year in September on twelve months’ pay. Payroll publishers only. Fairly sure. */
    'Bihar: by yearly pay — nothing up to ₹3 lakh, then ₹1,000, ₹2,000 or ₹2,500 a year, taken once in the September payroll. As commonly published; not yet checked against the state’s own notice.'
  ),
  pt(
    'JHARKHAND',
    '2012-04-01',
    { basis: 'ANNUAL', balanceMonth: 3, needsCheck: true, slabs: bands([[300000, 0], [500000, 1200], [800000, 1800], [1000000, 2100], [null, 2500]]) },
    /* Source: Jharkhand (Act 2 of 2012): yearly bands — nil to ₹3 lakh, then ₹1,200, ₹1,800, ₹2,100 and ₹2,500 — spread monthly. One publisher, which says its own figures are unconfirmed. Not sure. */
    'Jharkhand: by yearly pay — nothing up to ₹3 lakh, then ₹1,200 to ₹2,500 a year, taken monthly. Not yet checked against the state’s own notice — confirm before use.'
  ),
  pt(
    'MEGHALAYA',
    '2012-04-01',
    {
      basis: 'ANNUAL',
      balanceMonth: 3,
      needsCheck: true,
      slabs: bands([
        [50000, 0], [75000, 200], [100000, 300], [150000, 500], [200000, 750], [250000, 1000],
        [300000, 1250], [350000, 1500], [400000, 1800], [450000, 2100], [500000, 2400], [null, 2500],
      ]),
    },
    /* Source: Meghalaya, 2012 schedule: twelve yearly bands from nil to ₹50,000 up to ₹2,500 above ₹5 lakh, spread monthly. One publisher; another reports a ₹1.8 lakh exemption limit. Not sure. */
    'Meghalaya: by yearly pay — nothing up to ₹50,000, rising to ₹2,500 a year above ₹5 lakh, taken monthly. Not yet checked against the state’s own notice — confirm before use.'
  ),
  pt(
    'TRIPURA',
    '2018-07-25',
    { needsCheck: true, slabs: bands([[7500, 0], [15000, 150], [null, 208]]) },
    /* Source: Tripura, from the notification of 25 Jul 2018: nil to ₹7,500, ₹150 to ₹15,000, then ₹208. greytHR; the state’s site shows an older schedule. Not sure. */
    'Tripura: nothing up to ₹7,500 a month, ₹150 up to ₹15,000, then ₹208. From 25 Jul 2018. Not yet checked against the state’s own notice — confirm before use.'
  ),
  pt(
    'SIKKIM',
    '2006-04-01',
    { slabs: bands([[20000, 0], [30000, 125], [40000, 150], [null, 200]]) },
    /* Source: Sikkim (Act of 2006): nil to ₹20,000, then ₹125, ₹150 and ₹200. Publishers agree; no revision date found. Fairly sure. */
    'Sikkim: nothing up to ₹20,000 a month, then ₹125, ₹150 and ₹200. As commonly published; not yet checked against the state’s own notice.'
  ),
  pt(
    'MANIPUR',
    '2012-09-01',
    { basis: 'ANNUAL', balanceMonth: 3, slabs: bands([[50000, 0], [75000, 1200], [100000, 2000], [125000, 2400], [null, 2500]]) },
    /* Source: Manipur, from 1 Sep 2012: yearly bands — nil to ₹50,000, then ₹1,200, ₹2,000, ₹2,400 and ₹2,500 — spread monthly with the balance in March. greytHR. Fairly sure. */
    'Manipur: by yearly pay — nothing up to ₹50,000, then ₹1,200 to ₹2,500 a year, taken monthly. From 1 Sep 2012. As commonly published; not yet checked against the state’s own notice.'
  ),
  pt(
    'MIZORAM',
    '2000-04-01',
    { needsCheck: true, slabs: bands([[5000, 0], [8000, 75], [10000, 120], [12000, 150], [15000, 180], [null, 208]]) },
    /* Source: Mizoram before 11 Jul 2024: nil to ₹5,000, then ₹75, ₹120, ₹150, ₹180 and ₹208. Its start date is not known; it is dated early so older months find it. Not sure. */
    'Mizoram: nothing up to ₹5,000 a month, rising to ₹208 above ₹15,000. Used for months before 11 Jul 2024. Not yet checked against the state’s own notice — confirm before use.'
  ),
  pt(
    'MIZORAM',
    '2024-07-11',
    { needsCheck: true, slabs: bands([[5000, 0], [8000, 75], [10000, 120], [12000, 150], [15000, 180], [20000, 195], [null, 208]]) },
    /* Source: Mizoram, from 11 Jul 2024 (J.17011/1/2017-TAX): adds a ₹195 band for ₹15,001–20,000. The one source could not confirm the figures from the notification. Not sure. */
    'Mizoram: nothing up to ₹5,000 a month, rising to ₹195 up to ₹20,000, then ₹208. From 11 Jul 2024. Not yet checked against the state’s own notice — confirm before use.'
  ),
  pt(
    'NAGALAND',
    '2000-04-01',
    { needsCheck: true, slabs: bands([[4000, 0], [5000, 35], [7000, 75], [9000, 110], [12000, 180], [null, 208]]) },
    /* Source: Nagaland: nil to ₹4,000, then ₹35, ₹75, ₹110, ₹180 and ₹208. No start date was found; it is dated early so older months find it. Not sure. */
    'Nagaland: nothing up to ₹4,000 a month, rising to ₹208 above ₹12,000. Not yet checked against the state’s own notice — confirm before use.'
  ),
  pt(
    'PUDUCHERRY',
    '2017-07-04',
    { basis: 'HALF_YEARLY', collectMonths: [9, 2], localBody: 'Municipalities (minimum rates)', needsCheck: true, slabs: bands([[99999.99, 0], [200000, 250], [300000, 500], [400000, 750], [500000, 1000], [null, 1250]]) },
    /* Source: Puducherry, from 4 Jul 2017 (G.O.Ms.No.24/F3/2017): half-yearly bands on six months’ pay, taken in September and February (CLOR’s choice of months). These are minimum rates; a municipality may charge more. Not sure. */
    'Puducherry: ₹250 to ₹1,250 a half-year by six months’ pay, taken in the September and February payroll. A municipality may charge more. From 4 Jul 2017. Not yet checked against the state’s own notice — confirm before use.'
  ),
  pt(
    'PUNJAB',
    '2018-04-01',
    { needsCheck: true, slabs: bands([[20833.33, 0], [null, 200]]) },
    /* Source: Punjab State Development Tax, from Apr 2018: ₹200 a month on anybody liable to income tax, read here as more than ₹2.5 lakh a year (₹20,833 a month). The rate is sure; who is liable under the new tax regime is not settled. Ask a Punjab CA. */
    'Punjab (State Development Tax): ₹200 a month for anybody liable to income tax, taken here as pay above ₹2.5 lakh a year. Who is liable is not settled: ask your adviser. Not yet checked against the state’s own notice — confirm before use.'
  ),
  pt(
    'ODISHA',
    '2026-04-01',
    { notLevied: true, needsCheck: true, slabs: [] },
    /* Source: Odisha has no professional tax from 1 Apr 2026 (Repeal Ordinance 02 of 2026). An ordinance lapses unless an Act replaces it, and CLOR could not confirm that one has. Fairly sure. */
    'Odisha: no professional tax from 1 Apr 2026. Not yet checked against the state’s own notice — confirm before use.'
  ),
  pt(
    'CHHATTISGARH',
    '2011-04-01',
    { notLevied: true, slabs: [] },
    /* Source: Chhattisgarh exempts everybody from professional tax from 1 Apr 2011 (Notification of 31 Mar 2011). Some guides still print slabs; do not deduct. Fairly sure. */
    'Chhattisgarh: nobody pays professional tax, from 1 Apr 2011. As commonly published; not yet checked against the state’s own notice.'
  ),
];
