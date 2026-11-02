/**
 * Professional Tax and Labour Welfare Fund, state by state: what each state's
 * return is called, when it is due, and in which months LWF is collected.
 *
 * Plain facts with no database behind them, shared by Payroll (the returns
 * screen) and the compliance calendar, so the two cannot name different due
 * dates for the same return. The rates themselves are NOT here: those are
 * versioned statutory rules (services/payroll/statutory/defaults.ts), because
 * a rate is something a company may correct and a payslip records.
 *
 * Source: CLOR's PT and LWF research of 2 Nov 2026. Where it gave no due
 * date, the last day of the following month is used and `dueKnown` is false,
 * so the screen says to confirm it with the state. CLOR does not produce the
 * government upload files: each return is filed on the state's own portal.
 */

/** Two-letter and older spellings, to the names the statutory rules use. */
const STATE_ALIASES: Record<string, string> = {
  AP: 'ANDHRA PRADESH', AR: 'ARUNACHAL PRADESH', AS: 'ASSAM', BR: 'BIHAR', CG: 'CHHATTISGARH', CT: 'CHHATTISGARH', CH: 'CHANDIGARH',
  DL: 'DELHI', GA: 'GOA', GJ: 'GUJARAT', HR: 'HARYANA', HP: 'HIMACHAL PRADESH', JK: 'JAMMU AND KASHMIR', JH: 'JHARKHAND', KA: 'KARNATAKA',
  KL: 'KERALA', LA: 'LADAKH', MP: 'MADHYA PRADESH', MH: 'MAHARASHTRA', MN: 'MANIPUR', ML: 'MEGHALAYA', MZ: 'MIZORAM', NL: 'NAGALAND',
  OD: 'ODISHA', OR: 'ODISHA', PB: 'PUNJAB', PY: 'PUDUCHERRY', RJ: 'RAJASTHAN', SK: 'SIKKIM', TN: 'TAMIL NADU', TS: 'TELANGANA', TG: 'TELANGANA',
  TR: 'TRIPURA', UP: 'UTTAR PRADESH', UK: 'UTTARAKHAND', UT: 'UTTARAKHAND', WB: 'WEST BENGAL',
  ORISSA: 'ODISHA', PONDICHERRY: 'PUDUCHERRY', TAMILNADU: 'TAMIL NADU', CHATTISGARH: 'CHHATTISGARH', 'NCT OF DELHI': 'DELHI', 'NEW DELHI': 'DELHI',
  'JAMMU & KASHMIR': 'JAMMU AND KASHMIR', WESTBENGAL: 'WEST BENGAL',
  AN: 'ANDAMAN AND NICOBAR', 'ANDAMAN & NICOBAR': 'ANDAMAN AND NICOBAR', 'ANDAMAN AND NICOBAR ISLANDS': 'ANDAMAN AND NICOBAR', 'ANDAMAN & NICOBAR ISLANDS': 'ANDAMAN AND NICOBAR',
  LD: 'LAKSHADWEEP', DN: 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU', DD: 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU', DH: 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU',
  'DADRA & NAGAR HAVELI AND DAMAN & DIU': 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU', 'DADRA AND NAGAR HAVELI': 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU', 'DAMAN AND DIU': 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU',
};

/**
 * One spelling of a state: "Karnataka", "KA", "IN-KA" and "karnataka " are the
 * same place. A rule is found by the state on somebody's payroll profile, and
 * a profile written "KA" must not miss the rule written "KARNATAKA".
 */
export function canonicalState(state: string | null | undefined): string {
  const s = String(state || '').trim().toUpperCase().replace(/^IN-/, '').replace(/\s+/g, ' ');
  if (!s) return '';
  return STATE_ALIASES[s] || STATE_ALIASES[s.replace(/[^A-Z&]/g, '')] || s;
}

/** "WEST BENGAL" → "West Bengal", for the screen. */
export const stateLabel = (state: string) =>
  canonicalState(state)
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bAnd\b/g, 'and');

/** When a return is due, as a rule a calendar can expand. */
export type DueRule =
  /** The `day` of the month after the payroll month. */
  | { kind: 'MONTHLY'; day: number }
  /** Once per listed period: payroll months `months`, due `due` (month and day; `nextYear` when it falls in the following calendar year). */
  | { kind: 'PERIODS'; periods: CollectionPeriod[] };

/** Payroll months collected together, and when they are paid. `spansYear`: the period runs across New Year (October to March). */
export type CollectionPeriod = { label: string; months: number[]; due: { month: number; day: number; nextYear?: boolean }; spansYear?: boolean };

export type PtFiling = {
  form: string;
  due: DueRule;
  /** False where the research found no due date: the screen says to confirm it. */
  dueKnown: boolean;
  /** How it is paid and returned, in a sentence. */
  how: string;
};

const LAST = 31;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const monthly = (day: number, form: string, how: string, dueKnown = true): PtFiling => ({ form, due: { kind: 'MONTHLY', day }, dueKnown, how });
const halfYears = (form: string, how: string, h1: { month: number; day: number }, h2: { month: number; day: number }, months: [number[], number[]], dueKnown = true): PtFiling => ({
  form,
  dueKnown,
  how,
  due: {
    kind: 'PERIODS',
    periods: [
      { label: 'Apr–Sep', months: months[0], due: h1 },
      { label: 'Oct–Mar', months: months[1], due: h2, spansYear: true },
    ],
  },
});

/** Professional tax return and due date, per levying state. */
export const PT_FILINGS: Record<string, PtFiling> = {
  MAHARASHTRA: monthly(15, 'Form IIIB (PTRC), paid by MTR-6 challan', 'Due on the 15th of the following month since the rule change of 28 Feb 2026. Smaller employers file once a year, by 15 March; check which applies to you.'),
  KARNATAKA: monthly(20, 'Form 5A monthly statement; Form 5 annual return', 'Pay by the 20th of the following month on e-Prerana. The annual return is due within 60 days of the year end.'),
  'WEST BENGAL': monthly(21, 'Monthly payment; one annual return by 30 April', 'Pay within 21 days of the month end. Quarterly returns ended in 2022-23.'),
  GUJARAT: monthly(15, 'Form 5', 'Monthly, within 15 days of the month end. Employers with 20 or fewer staff may file once a year in Form 5-AA.'),
  TELANGANA: monthly(10, 'Form V', 'Monthly, by the 10th of the following month.'),
  'ANDHRA PRADESH': monthly(10, 'Form V', 'Monthly, by the 10th, online through the Commercial Taxes Department.'),
  'TAMIL NADU': halfYears('Half-yearly payment to the local body', 'Taken once each half-year and paid to the corporation or municipality by 30 September and 31 March.', { month: 9, day: 30 }, { month: 3, day: 31 }, [[9], [2]]),
  KERALA: halfYears('Half-yearly remittance to the local body', 'Taken once each half-year (August and February) and remitted within 10 days of collecting.', { month: 9, day: 10 }, { month: 3, day: 10 }, [[8], [2]]),
  'MADHYA PRADESH': monthly(10, 'Monthly payment; annual return by 30 June', 'Pay within 10 days of the month end.'),
  ASSAM: monthly(28, 'Form III', 'Pay by the 28th of the following month; the monthly return is due by the month end.'),
  BIHAR: {
    form: 'Annual payment and statement',
    dueKnown: true,
    how: 'Taken once a year, in September. Deposit by 15 November; the statement is due by 30 November.',
    due: { kind: 'PERIODS', periods: [{ label: 'Year', months: [9], due: { month: 11, day: 15 } }] },
  },
  JHARKHAND: {
    form: 'Quarterly return',
    dueKnown: true,
    how: 'Quarterly, due 15 May, 15 August, 15 November and 15 February.',
    due: {
      kind: 'PERIODS',
      periods: [
        { label: 'Jan–Mar', months: [1, 2, 3], due: { month: 5, day: 15 } },
        { label: 'Apr–Jun', months: [4, 5, 6], due: { month: 8, day: 15 } },
        { label: 'Jul–Sep', months: [7, 8, 9], due: { month: 11, day: 15 } },
        { label: 'Oct–Dec', months: [10, 11, 12], due: { month: 2, day: 15, nextYear: true } },
      ],
    },
  },
  MEGHALAYA: monthly(LAST, 'Monthly payment', 'CLOR could not find the due date; the last day of the following month is shown.', false),
  TRIPURA: monthly(LAST, 'Monthly payment', 'CLOR could not find the due date; the last day of the following month is shown.', false),
  SIKKIM: monthly(LAST, 'Monthly payment', 'Pay by the last day of the following month.'),
  MANIPUR: monthly(LAST, 'Monthly payment', 'CLOR could not find the due date; the last day of the following month is shown.', false),
  MIZORAM: monthly(LAST, 'Monthly payment', 'CLOR could not find the due date; the last day of the following month is shown.', false),
  NAGALAND: monthly(LAST, 'Monthly payment', 'CLOR could not find the due date; the last day of the following month is shown.', false),
  PUDUCHERRY: halfYears('Half-yearly payment to the municipality', 'Taken once each half-year. CLOR could not find the due date; the month end after collection is shown.', { month: 9, day: 30 }, { month: 3, day: 31 }, [[9], [2]], false),
  PUNJAB: monthly(LAST, 'Punjab State Development Tax: monthly deposit, annual return', 'Deposit by the end of the following month.'),
};

/** States with no professional tax on salaries (research section 2). Odisha from 1 Apr 2026. */
export const NO_PT_STATES = [
  'ODISHA', 'CHHATTISGARH', 'GOA', 'DELHI', 'HARYANA', 'UTTAR PRADESH', 'RAJASTHAN', 'UTTARAKHAND', 'HIMACHAL PRADESH', 'JAMMU AND KASHMIR', 'LADAKH',
  'ARUNACHAL PRADESH', 'CHANDIGARH', 'ANDAMAN AND NICOBAR', 'LAKSHADWEEP', 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU',
];

export type LwfFiling = {
  form: string;
  /** Each collection: the payroll months it is deducted in, and when it is paid. */
  periods: CollectionPeriod[];
  dueKnown: boolean;
  how: string;
  /** Other funds in the same state with a return of their own, by the fund's name in the rule. */
  funds?: Record<string, LwfFiling>;
};

/** Kerala's second fund, named as the LWF rule names it. */
export const KERALA_SHOPS_FUND = 'Shops and Commercial Establishments Workers Welfare Fund';

/** Twelve one-month collections, each due on `day` of the month after. */
const monthlyPeriods = (day: number): CollectionPeriod[] =>
  MONTH_NAMES.map((name, i) => ({ label: name, months: [i + 1], due: i === 11 ? { month: 1, day, nextYear: true } : { month: i + 2, day } }));

const JUNE_DEC = (form: string, how: string, due = 15): LwfFiling => ({
  form,
  dueKnown: true,
  how,
  periods: [
    { label: 'Jan–Jun', months: [6], due: { month: 7, day: due } },
    { label: 'Jul–Dec', months: [12], due: { month: 1, day: due, nextYear: true } },
  ],
});
const DECEMBER = (form: string, how: string, due: { month: number; day: number }): LwfFiling => ({
  form,
  dueKnown: true,
  how,
  periods: [{ label: 'Year', months: [12], due: { ...due, nextYear: true } }],
});
const MONTHLY_HALF_PAID = (form: string, how: string): LwfFiling => ({
  form,
  dueKnown: true,
  how,
  periods: [
    { label: 'Apr–Sep', months: [4, 5, 6, 7, 8, 9], due: { month: 10, day: 15 } },
    { label: 'Oct–Mar', months: [10, 11, 12, 1, 2, 3], due: { month: 4, day: 15 } },
  ],
});

/** Labour Welfare Fund return and collection periods, per levying state. */
export const LWF_FILINGS: Record<string, LwfFiling> = {
  MAHARASHTRA: { ...JUNE_DEC('Form A-1', 'Deducted in June and December, paid by 15 July and 15 January; Form A-1 by 31 July and 31 January.') },
  KARNATAKA: DECEMBER('Form D', 'Deducted from December pay and paid once a year, by 15 January.', { month: 1, day: 15 }),
  'TAMIL NADU': DECEMBER('Form A', 'Deducted in December and paid with Form A by 31 January.', { month: 1, day: 31 }),
  KERALA: {
    form: 'Form A (Kerala Labour Welfare Fund)',
    dueKnown: true,
    how: 'The 1975 fund: ₹45 and ₹45 each half-year, paid by 15 July and 15 January.',
    periods: [
      { label: 'Jan–Jun', months: [1, 2, 3, 4, 5, 6], due: { month: 7, day: 15 } },
      { label: 'Jul–Dec', months: [7, 8, 9, 10, 11, 12], due: { month: 1, day: 15, nextYear: true } },
    ],
    /* A second fund with its own cycle: a shop or office owes both. */
    funds: {
      [KERALA_SHOPS_FUND]: {
        form: 'Monthly remittance to the Kerala Shops and Commercial Establishments Workers Welfare Fund Board',
        dueKnown: true,
        how: '₹50 from the worker and ₹50 from the employer every month, remitted by the 5th of the following month.',
        periods: monthlyPeriods(5),
      },
    },
  },
  'ANDHRA PRADESH': DECEMBER('Form F', 'On the register at 31 December, paid by 31 January.', { month: 1, day: 31 }),
  TELANGANA: DECEMBER('Form F', 'On the register at 31 December, paid by 31 January.', { month: 1, day: 31 }),
  GUJARAT: JUNE_DEC('Form A-1', 'Deducted in June and December, paid online by 15 July and 15 January.'),
  GOA: JUNE_DEC('Statement to the Goa Labour Welfare Board', 'Half the year’s amount in June and in December; statements by 31 July and 31 January.', 31),
  'MADHYA PRADESH': JUNE_DEC('Half-yearly return to the MP Shram Kalyan Mandal', 'Deducted in June and December, paid before 15 July and 15 January. The employer pays at least ₹2,500 per establishment each half-year.'),
  CHHATTISGARH: JUNE_DEC('Half-yearly return', 'Deducted in June and December, paid by 15 July and 15 January. The employer pays at least ₹1,500 per establishment.'),
  HARYANA: {
    form: 'Monthly deposit to the Haryana Labour Welfare Board',
    dueKnown: false,
    how: 'Collected and deposited every month. CLOR could not confirm the due date; the 15th of the following month is shown.',
    periods: MONTH_NAMES.map((_, i) => i + 1).map((m) => ({ label: MONTH_NAMES[m - 1], months: [m], due: m === 12 ? { month: 1, day: 15, nextYear: true } : { month: m + 1, day: 15 } })),
  },
  PUNJAB: MONTHLY_HALF_PAID('Half-yearly return to the Punjab Labour Welfare Board', 'Accrues every month; paid by 15 October for April–September and by 15 April for October–March.'),
  CHANDIGARH: MONTHLY_HALF_PAID('Half-yearly return (Punjab Act, as applied)', 'Accrues every month; paid by 15 October and 15 April.'),
  DELHI: JUNE_DEC('Form A, on the Delhi Labour Welfare Board portal', 'June and December wages, paid by 15 July and 15 January.'),
  'WEST BENGAL': JUNE_DEC('Half-yearly return', 'Deducted in June and December, paid by 15 July and 15 January.'),
  ODISHA: {
    form: 'Form F',
    dueKnown: true,
    how: 'The year’s amount in two instalments, before 15 January and 15 July.',
    periods: [
      { label: 'Jan–Jun', months: [6], due: { month: 7, day: 15 } },
      { label: 'Jul–Dec', months: [12], due: { month: 1, day: 15, nextYear: true } },
    ],
  },
};

const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(Math.min(d, lastDayOf(y, m)))}`;

/**
 * The collection a payroll month belongs to, and its due date. A half-year's
 * due date is in the calendar year its months end in, unless `nextYear`
 * (December's money is paid in January).
 */
export function collectionFor(periods: CollectionPeriod[], year: number, month: number) {
  const p = periods.find((x) => x.months.includes(month));
  if (!p) return null;
  /* A collection spanning New Year (Oct–Mar) belongs to the year it starts in. */
  const wraps = Boolean(p.spansYear) || p.months.some((m) => m < p.months[0]);
  /* Its January to March months belong to the period that began the October before. */
  const startYear = wraps && month < 7 ? year - 1 : year;
  const endYear = wraps ? startYear + 1 : startYear;
  const dueYear = endYear + (p.due.nextYear ? 1 : 0);
  const label = wraps ? `${p.label} ${startYear}-${String(endYear % 100).padStart(2, '0')}` : `${p.label} ${startYear}`;
  return { label, key: `${startYear}-${p.label}`, dueDate: isoDate(dueYear, p.due.month, p.due.day) };
}

/** A professional tax return's due date for a payroll month, or null where that month is not when it is paid. */
export function ptDueFor(state: string, year: number, month: number) {
  const f = PT_FILINGS[canonicalState(state)];
  if (!f) return null;
  if (f.due.kind === 'MONTHLY') {
    const [ny, nm] = month === 12 ? [year + 1, 1] : [year, month + 1];
    return { label: `${MONTH_NAMES[month - 1]} ${year}`, key: `${year}-${pad(month)}`, dueDate: isoDate(ny, nm, f.due.day) };
  }
  return collectionFor(f.due.periods, year, month);
}

/** A Labour Welfare Fund collection's due date for a payroll month. */
export function lwfDueFor(state: string, year: number, month: number, fund?: string | null) {
  const f = lwfFilingFor(state, fund);
  return f ? collectionFor(f.periods, year, month) : null;
}

/** A state's LWF return, or one of its other funds' (Kerala's shops fund). */
export function lwfFilingFor(state: string, fund?: string | null): LwfFiling | null {
  const f = LWF_FILINGS[canonicalState(state)];
  if (!f) return null;
  return (fund && f.funds?.[fund]) || f;
}
