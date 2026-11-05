import { round2 } from '../../../utils/money.js';
import { canonicalState } from '../../../constants/stateLevies.js';
/**
 * The statutory deductions: provident fund, ESI, professional tax, income tax.
 *
 * These are the amounts a company does not get to decide. They are set by law,
 * they change on dates somebody else picks, and getting one wrong is a penalty
 * rather than an apology. That shapes everything here.
 *
 * ## Rules are versioned, never edited
 *
 * A PF ceiling that moves in October must not change what April computed. So a
 * rule is a dated, versioned row, and a payslip records which version produced
 * each figure. Editing a live rate in place — the obvious design — would
 * silently restate every payslip that had used it, and there would be no way to
 * tell what the old answer had been.
 *
 * ## Nothing is hard-coded to one state or one year
 *
 * Professional tax is a different set of slabs in every state that levies it,
 * and the defaults below are seed data, not the engine. The engine reads slabs;
 * the slabs come from a rule. A company operating in two states deducts each
 * correctly because the employee carries the state, not the code.
 *
 * ## Every figure comes back with its reasoning
 *
 * Each result carries the wage it applied to, the rate, the ceiling if one
 * bound it, and the rule version — because "why is my PF 1,800 when I earn
 * 60,000?" has a real answer, and the answer is the ceiling.
 */

export type StatutoryScheme = 'PF' | 'ESI' | 'PT' | 'TDS' | 'LWF';

export type StatutoryRuleInput = {
  id: string;
  scheme: StatutoryScheme;
  version: string;
  jurisdiction: string | null;
  employeeRate: number;
  employerRate: number;
  wageCeiling: number | null;
  eligibilityThreshold: number | null;
  rounding: 'NONE' | 'NEAREST' | 'UP' | 'DOWN';
  /** Everything the shape of the scheme needs: EPS splits, PT slabs, TDS bands. */
  config: Record<string, any>;
};

export type StatutoryWages = {
  /** Wages that count for PF — basic and dearness allowance, normally. */
  pfWage: number;
  /** Wages that count for ESI — very nearly gross. */
  esiWage: number;
  /** Gross pay for the period, which is what PT slabs read. */
  gross: number;
  /** The year's taxable pay from this employer: taxable earnings only, employer NPS included. */
  annualTaxable?: number;
  /** Old regime only: the year's deductions from a tax declaration (services/payroll/taxDeclaration.ts). */
  taxDeductions?: { total: number; note: string };
  /** The year's professional tax, here and at a previous employer (deductible under the old regime). */
  professionalTax?: number;
  /** The year's employer NPS contribution, deductible within a share of `npsWage`. */
  employerNps?: number;
  /** The year's Basic and DA, for the employer NPS limit. */
  npsWage?: number;
  /** Form 12B: taxable salary from an earlier employer this year, and the tax they withheld. */
  previousEmployer?: { income: number; tds: number } | null;
};

export type StatutoryEmployee = {
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
  /** Where this person is taxed for professional tax. */
  professionalTaxState?: string | null;
  taxRegime?: 'OLD' | 'NEW';
  /** A voluntary higher contribution, where somebody has one. */
  overrideEmployeeRate?: number | null;
  overrideEmployerRate?: number | null;
  /** MALE | FEMALE | OTHER, from the People record: Maharashtra's PT has women's bands. */
  gender?: string | null;
  /**
   * LWF: MANAGER (a designation on the company's managers list: always left
   * out where a state's Act leaves managers out) or SUPERVISOR (on the
   * supervisors list: left out only above the state's pay limit).
   */
  lwfRole?: 'MANAGER' | 'SUPERVISOR' | null;
  /** Old regime: 60 to 79, or 80 and over, at any time in the financial year (ageBandFor). */
  ageBand?: AgeBand;
  /** false when there is no valid PAN on file: TDS at 20% (section 206AA). Left out, a PAN is assumed. */
  hasPan?: boolean;
};

export type StatutoryAmount = {
  scheme: StatutoryScheme;
  /** What the employee has withheld. */
  employee: number;
  /** What the company pays on top. */
  employer: number;
  /** Where the employer's share is split further — EPS and EPF, for instance. */
  employerSplit?: Record<string, number>;
  ruleId: string;
  ruleVersion: string;
  /** In the words a payslip would use. */
  explanation: string;
  wageApplied: number;
  rateApplied: number;
  ceilingApplied: number | null;
  /** Why nothing was deducted, when nothing was. */
  exemptReason?: string;
  /** The state, for PT and LWF: which return the figure belongs on. */
  jurisdiction?: string | null;
  /** The rule's figures were not confirmed from an official notice. */
  needsCheck?: boolean;
  /** LWF: each fund's share, where a state has more than one. */
  funds?: Array<{ name: string; employee: number; employer: number }>;
  /** TDS: withheld at this rate because there is no PAN (section 206AA). */
  noPanRate?: number;
};


const applyRounding = (value: number, mode: StatutoryRuleInput['rounding']): number => {
  if (mode === 'UP') return Math.ceil(value);
  if (mode === 'DOWN') return Math.floor(value);
  if (mode === 'NEAREST') return Math.round(value);
  return round2(value);
};

const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/**
 * Provident fund.
 *
 * The employee contributes a percentage of PF wages, and the company matches
 * it — but the company's share is split: part goes to the pension scheme (EPS)
 * and the rest to the fund itself. EPS has its own ceiling, which is why an
 * employer's contribution on a large salary is not simply a percentage.
 *
 * The wage ceiling is the thing most often misunderstood. Above it, the
 * contribution stops growing — somebody on ₹60,000 and somebody on ₹1,50,000
 * contribute the same ₹1,800, unless the company has chosen to contribute on
 * the full wage.
 */
function computePf(rule: StatutoryRuleInput, wages: StatutoryWages, employee: StatutoryEmployee): StatutoryAmount {
  const base = {
    scheme: 'PF' as const,
    ruleId: rule.id,
    ruleVersion: rule.version,
    wageApplied: 0,
    rateApplied: rule.employeeRate,
    ceilingApplied: rule.wageCeiling,
  };

  if (!employee.pfApplicable) {
    return { ...base, employee: 0, employer: 0, explanation: 'Provident fund does not apply to this person.', exemptReason: 'NOT_APPLICABLE' };
  }

  /* Contribute on the ceiling, or on the whole wage where the company has
     chosen to. Both are legal; which one applies is configuration. */
  const contributeOnFullWage = Boolean(rule.config?.contributeOnFullWage);
  const ceiling = rule.wageCeiling;
  const applicableWage =
    ceiling != null && !contributeOnFullWage ? Math.min(wages.pfWage, ceiling) : wages.pfWage;

  const employeeRate = employee.overrideEmployeeRate ?? rule.employeeRate;
  const employerRate = employee.overrideEmployerRate ?? rule.employerRate;

  const employeeAmount = applyRounding((applicableWage * employeeRate) / 100, rule.rounding);
  const employerTotal = applyRounding((applicableWage * employerRate) / 100, rule.rounding);

  /* The pension share, on its own ceiling. What is left of the employer's
     contribution goes to the fund. */
  const epsRate = Number(rule.config?.epsRate ?? 8.33);
  const epsCeiling = Number(rule.config?.epsWageCeiling ?? ceiling ?? applicableWage);
  const epsWage = Math.min(applicableWage, epsCeiling);
  const eps = applyRounding((epsWage * epsRate) / 100, rule.rounding);
  const epf = round2(Math.max(0, employerTotal - eps));

  const capped = ceiling != null && !contributeOnFullWage && wages.pfWage > ceiling;

  return {
    ...base,
    employee: employeeAmount,
    employer: employerTotal,
    employerSplit: { EPS: eps, EPF: epf },
    wageApplied: applicableWage,
    rateApplied: employeeRate,
    explanation: capped
      ? `${employeeRate}% of ${money(applicableWage)}, the PF ceiling — wages above it do not increase the contribution.`
      : `${employeeRate}% of ${money(applicableWage)} of PF wages.`,
  };
}

/**
 * Employee State Insurance.
 *
 * Unlike PF, ESI has a threshold rather than a ceiling: earn under it and the
 * whole wage is contributed on; earn over it and the scheme does not apply at
 * all. Which makes the boundary consequential — a small raise can end somebody's
 * ESI cover, and payroll should not discover that by accident.
 */
function computeEsi(rule: StatutoryRuleInput, wages: StatutoryWages, employee: StatutoryEmployee): StatutoryAmount {
  const base = {
    scheme: 'ESI' as const,
    ruleId: rule.id,
    ruleVersion: rule.version,
    wageApplied: 0,
    rateApplied: rule.employeeRate,
    ceilingApplied: rule.eligibilityThreshold,
  };

  if (!employee.esiApplicable) {
    return { ...base, employee: 0, employer: 0, explanation: 'ESI does not apply to this person.', exemptReason: 'NOT_APPLICABLE' };
  }

  const threshold = rule.eligibilityThreshold;
  if (threshold != null && wages.esiWage > threshold) {
    return {
      ...base,
      employee: 0,
      employer: 0,
      explanation: `ESI wages of ${money(wages.esiWage)} are above the ${money(threshold)} threshold, so ESI does not apply.`,
      exemptReason: 'ABOVE_THRESHOLD',
    };
  }

  const employeeRate = employee.overrideEmployeeRate ?? rule.employeeRate;
  const employerRate = employee.overrideEmployerRate ?? rule.employerRate;

  return {
    ...base,
    employee: applyRounding((wages.esiWage * employeeRate) / 100, rule.rounding),
    employer: applyRounding((wages.esiWage * employerRate) / 100, rule.rounding),
    wageApplied: wages.esiWage,
    rateApplied: employeeRate,
    explanation: `${employeeRate}% of ${money(wages.esiWage)} of ESI wages.`,
  };
}

export type PtSlab = {
  from: number;
  to: number | null;
  amount: number;
  /** Only in these months (the older way of writing a February amount). */
  months?: number[];
  /** A different amount in a named month: {"2": 300}. */
  monthAmounts?: Record<string, number>;
  /** FEMALE, or MALE — which also covers anybody not recorded as a woman. */
  gender?: 'FEMALE' | 'MALE';
};

/** Labour Welfare Fund rules have a headcount and a company setting behind them. */
export type LwfContext = {
  /** People in payroll in this person's state, for a state's size threshold. Unknown: no size test. */
  headcount?: number | null;
  /** BY_HEADCOUNT (default) reads the headcount; ALWAYS treats every establishment as covered. */
  coverage?: 'BY_HEADCOUNT' | 'ALWAYS';
};

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthList = (months: number[]) => {
  const names = months.map((m) => MONTHS[m - 1] || String(m));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '';
};

/**
 * Labour Welfare Fund: a state levy like PT, collected by the state where
 * somebody works, usually as small fixed amounts in a few months of the year.
 * The rule says how much and when (config), never the engine:
 *
 *   employeeAmount / employerAmount   fixed rupees each time it is collected, or
 *   employeeRate / employerRate       % of gross, capped by employeeCap / employerCap
 *   months                            the months it is collected (default: every month)
 *   eligibleUpTo                      monthly gross above which it does not apply
 *   minEmployees                      the establishment size it starts at
 *   excludesManagers                  managers and supervisors are left out, those
 *   supervisorWageAbove               earning above this where the Act sets a limit
 *   funds                             several funds in one state (Kerala), each
 *                                     with its own amounts, months and threshold
 *
 * No state's figures are built in: they change, and must come from the state.
 */
function computeLwf(rule: StatutoryRuleInput, wages: StatutoryWages, employee: StatutoryEmployee, month: number, lwf: LwfContext = {}): StatutoryAmount {
  const c = rule.config || {};
  const base = {
    scheme: 'LWF' as const,
    ruleId: rule.id,
    ruleVersion: rule.version,
    wageApplied: wages.gross,
    rateApplied: 0,
    ceilingApplied: null,
    jurisdiction: rule.jurisdiction,
    needsCheck: Boolean(c.needsCheck),
  };
  const where = rule.jurisdiction ? titleCase(rule.jurisdiction) : 'This state';
  const funds: Record<string, any>[] = Array.isArray(c.funds) && c.funds.length ? c.funds : [c];

  const parts: Array<{ name: string; employee: number; employer: number }> = [];
  const reasons: Array<{ explanation: string; exemptReason: string }> = [];
  for (const f of funds) {
    const name = f.name || `${where} Labour Welfare Fund`;
    const months: number[] = Array.isArray(f.months) && f.months.length ? f.months.map(Number) : [];
    if (months.length && !months.includes(month)) {
      reasons.push({ explanation: `${where} collects LWF in ${monthList(months)}, not this month.`, exemptReason: 'NOT_THIS_MONTH' });
      continue;
    }
    const ceiling = Number(f.eligibleUpTo) || 0;
    if (ceiling && wages.gross > ceiling) {
      reasons.push({ explanation: `LWF applies up to ${money(ceiling)} a month; this is ${money(wages.gross)}.`, exemptReason: 'ABOVE_CEILING' });
      continue;
    }
    /* An establishment below the state's size does not contribute at all. */
    const minEmployees = Number(f.minEmployees ?? c.minEmployees) || 0;
    if (minEmployees && lwf.coverage !== 'ALWAYS' && lwf.headcount != null && lwf.headcount < minEmployees) {
      reasons.push({
        explanation: `${name} starts at ${minEmployees} people; payroll has ${lwf.headcount} in ${where}. If others work there too, say so in the LWF settings.`,
        exemptReason: 'BELOW_SIZE',
      });
      continue;
    }
    /*
     * Managers are not "employees" under most LWF Acts, whatever they earn.
     * Supervisors are left out only above the Act's wage limit; where a state
     * sets none (Andhra Pradesh deleted it in 2015), they contribute.
     */
    const excludes = f.excludesManagers ?? c.excludesManagers;
    const limit = Number(f.supervisorWageAbove ?? c.supervisorWageAbove) || 0;
    if (excludes && employee.lwfRole === 'MANAGER') {
      reasons.push({ explanation: `${name} leaves out managers, and this designation is on the company’s managers list.`, exemptReason: 'MANAGER_EXCLUDED' });
      continue;
    }
    if (excludes && employee.lwfRole === 'SUPERVISOR' && limit && wages.gross > limit) {
      reasons.push({ explanation: `${name} leaves out supervisors earning over ${money(limit)} a month, and this designation is on the company’s supervisors list.`, exemptReason: 'SUPERVISOR_EXCLUDED' });
      continue;
    }
    const part = (amount: unknown, rate: number, cap: unknown) => {
      if (amount !== undefined && amount !== null && amount !== '') return Number(amount) || 0;
      const v = (wages.gross * (Number(rate) || 0)) / 100;
      return Number(cap) ? Math.min(v, Number(cap)) : v;
    };
    const emp = applyRounding(part(f.employeeAmount, f.employeeRate ?? rule.employeeRate, f.employeeCap), rule.rounding);
    const er = applyRounding(part(f.employerAmount, f.employerRate ?? rule.employerRate, f.employerCap), rule.rounding);
    if (!emp && !er) {
      reasons.push({ explanation: `No LWF amounts are set for ${where}.`, exemptReason: 'NO_AMOUNTS' });
      continue;
    }
    parts.push({ name, employee: emp, employer: er });
  }

  if (!parts.length) {
    const first = reasons[0] || { explanation: `No LWF amounts are set for ${where}.`, exemptReason: 'NO_AMOUNTS' };
    return { ...base, employee: 0, employer: 0, explanation: first.explanation, exemptReason: first.exemptReason };
  }
  const employeeTotal = round2(parts.reduce((t, p) => t + p.employee, 0));
  const employerTotal = round2(parts.reduce((t, p) => t + p.employer, 0));
  return {
    ...base,
    employee: employeeTotal,
    employer: employerTotal,
    ...(parts.length > 1 ? { employerSplit: Object.fromEntries(parts.map((p) => [p.name, p.employer])) } : {}),
    /* Each fund on its own, so a state with two funds (Kerala) files two returns. */
    funds: parts,
    explanation:
      parts.length > 1
        ? `${parts.map((p) => `${p.name}: ${money(p.employee)} from pay, ${money(p.employer)} from the employer`).join('; ')}.`
        : `${parts[0].name}: ${money(employeeTotal)} from pay, ${money(employerTotal)} from the employer.`,
  };
}

/** What payroll has already deducted, read from this financial year's payslips. */
export type PtContext = {
  /** Professional tax this financial year, every state: for the ₹2,500 cap. */
  yearToDate?: number;
  /** This financial year in this person's current state, for the balance month. Unknown: eleven twelfths assumed. */
  inState?: number | null;
  /** Earlier months this financial year with a payslip in this state, whatever PT it took (nil-band months count). */
  monthsInState?: number;
  /** Gross pay on those earlier payslips in this state: with this month's, the year's pay that picks the balance month's band. */
  grossInState?: number;
  /**
   * Months of this financial year the person is employed, from their joining
   * and leaving dates (12 for a full year). Only a real join or leave inside
   * the year prorates the year's tax. Unknown: the full year.
   */
  monthsEmployed?: number;
  /** Already deducted for this same month by another run (an off-cycle one): nothing more is taken. */
  thisMonth?: number;
};

/** The Constitution's limit on professional tax per person per year (Article 276(2)). */
export const PT_ANNUAL_CAP = 2500;

/**
 * Professional tax.
 *
 * A state levy, and every state that charges it does so differently — different
 * slabs, different amounts, in some states a different amount in February,
 * women's bands in Maharashtra, yearly or half-yearly bands elsewhere. So the
 * engine reads slabs and the slabs come from a rule; there is no state named
 * anywhere in this function. What it does know is the ₹2,500 a year nobody
 * may be charged beyond.
 */
function computePt(
  rule: StatutoryRuleInput,
  wages: StatutoryWages,
  employee: StatutoryEmployee,
  month: number,
  pt: PtContext = {}
): StatutoryAmount {
  const ptAlreadyDeducted = Number(pt.yearToDate) || 0;
  const c = rule.config || {};
  const base = {
    scheme: 'PT' as const,
    ruleId: rule.id,
    ruleVersion: rule.version,
    wageApplied: wages.gross,
    rateApplied: 0,
    ceilingApplied: null,
    jurisdiction: rule.jurisdiction,
    needsCheck: Boolean(c.needsCheck),
  };
  const where = rule.jurisdiction ? titleCase(rule.jurisdiction) : 'This state';
  const nil = (explanation: string, exemptReason: string) => ({ ...base, employee: 0, employer: 0, explanation, exemptReason });

  if (!employee.ptApplicable) return nil('Professional tax does not apply to this person.', 'NOT_APPLICABLE');
  if (c.notLevied) return nil(`${where} charges no professional tax on salaries.`, 'NOT_LEVIED');

  const slabs: PtSlab[] = Array.isArray(c.slabs) ? c.slabs : [];
  if (!slabs.length) return nil(`No professional tax slabs are set for ${rule.jurisdiction || 'this state'}.`, 'NO_SLABS');

  /* Yearly and half-yearly bands are read on this month's pay for the year or half-year. */
  const basis = String(c.basis || 'MONTHLY').toUpperCase();
  const factor = basis === 'ANNUAL' ? 12 : basis === 'HALF_YEARLY' ? 6 : 1;
  const collect: number[] = Array.isArray(c.collectMonths) ? c.collectMonths.map(Number) : [];
  if (factor > 1 && collect.length && !collect.includes(month)) {
    return nil(`${where} professional tax is taken in ${monthList(collect)}, not this month.`, 'NOT_THIS_MONTH');
  }
  /* Once a month: an off-cycle run in a month already taxed takes nothing more. */
  if ((Number(pt.thisMonth) || 0) > 0) {
    return nil(`${money(Number(pt.thisMonth))} of professional tax was already deducted for this month.`, 'ALREADY_THIS_MONTH');
  }
  /*
   * The balance month of a yearly spread (March) reads the band from the
   * year's pay — what this state's payslips paid so far plus this month,
   * over the months they cover, as a year — not March's pay × 12, so a
   * raise in December does not move somebody into a higher year's band.
   */
  const balanceMonthOfYear = factor === 12 && !collect.length && month === (Number(c.balanceMonth) || 3) && pt.inState != null && pt.grossInState != null;
  const measured = balanceMonthOfYear
    ? round2((((Number(pt.grossInState) || 0) + wages.gross) / Math.max(1, (Number(pt.monthsInState) || 0) + 1)) * 12)
    : round2(wages.gross * factor);
  const woman = String(employee.gender || '').toUpperCase() === 'FEMALE';

  const slab = slabs.find(
    (s) =>
      measured >= s.from &&
      (s.to == null || measured <= s.to) &&
      /* Some states charge a different amount in one month of the year. */
      (!Array.isArray(s.months) || s.months.includes(month)) &&
      (!s.gender || (s.gender === 'FEMALE' ? woman : !woman))
  );
  if (!slab) return nil(`No slab covers ${money(measured)}.`, 'NO_SLAB_MATCH');

  const special = slab.monthAmounts?.[String(month)];
  let amount = special != null ? Number(special) : Number(slab.amount);
  let how: string;
  if (factor === 1) {
    how = `${money(amount)} a month${special != null ? ` (the ${MONTHS[month - 1]} amount)` : ''}`;
  } else if (collect.length) {
    how = `${money(amount)} for the ${factor === 12 ? 'year' : 'half-year'}, taken this month`;
  } else {
    /* Spread: a twelfth (or sixth) each month, the balance in the last month so the period adds up. */
    const each = Math.floor(amount / factor);
    const balanceMonth = Number(c.balanceMonth) || 3;
    const last = factor === 12 ? month === balanceMonth : month === 9 || month === 3;
    const whole = amount;
    if (last && factor === 12 && pt.inState != null) {
      /*
       * The balance month takes what is left of the year's tax in this state,
       * read from the payslips — not eleven twelfths assumed. Somebody who
       * joined or left during the year owes the months they were employed.
       */
      const months = Math.min(12, Math.max(1, Number(pt.monthsEmployed) || 12));
      amount = Math.max(0, round2((whole * months) / 12 - (Number(pt.inState) || 0)));
    } else {
      amount = last ? whole - each * (factor - 1) : each;
    }
    how = `${money(whole)} a ${factor === 12 ? 'year' : 'half-year'}, ${money(amount)} this month`;
  }

  /* No more than ₹2,500 in a financial year, whatever the slabs say. */
  const cap = Number(c.annualCap ?? PT_ANNUAL_CAP) || PT_ANNUAL_CAP;
  const room = Math.max(0, round2(cap - Math.max(0, Number(ptAlreadyDeducted) || 0)));
  const capped = amount > room;
  if (capped) amount = room;

  const band = factor === 1 ? money(wages.gross) : balanceMonthOfYear ? `${money(measured)} for the year` : `${money(measured)} (${money(wages.gross)} × ${factor})`;
  const women = slab.gender === 'FEMALE' ? ' on the women’s bands' : '';
  return {
    ...base,
    employee: applyRounding(amount, rule.rounding),
    employer: 0,
    ...(capped ? { ceilingApplied: cap } : {}),
    ...(capped && amount <= 0 ? { exemptReason: 'ANNUAL_CAP' } : {}),
    explanation: capped
      ? `${where} professional tax on ${band}${women}: ${how}, held to ${money(amount)} so the year stays within ${money(cap)}.`
      : `${where} professional tax on ${band}${women}: ${how}.`,
  };
}

export type TaxBand = { upTo: number | null; rate: number };
/** A surcharge rate on the tax, for total income above `over`. */
export type SurchargeBand = { over: number; rate: number };
/** Old regime only: 60 to 79 (SENIOR) or 80 and over (SUPER_SENIOR) at any time in the year. */
export type AgeBand = 'SENIOR' | 'SUPER_SENIOR' | null;

/*
 * The figures below are the fallbacks for a TDS rule seeded before it carried
 * them, and match the seed (defaults.ts). Checked against:
 *
 *  - FY 2025-26: Income-tax Act 1961 as amended by the Finance Act 2025 —
 *    section 115BAC(1A) (new regime slabs), First Schedule Part III (old
 *    regime slabs by age, surcharge and its marginal relief), section 87A
 *    (rebate), section 16 (standard deduction, professional tax), section
 *    80CCD(2) (employer NPS) and section 206AA (no PAN).
 *  - FY 2026-27: Income-tax Act 2025 as amended by the Finance Act 2026 (ICAI's
 *    text, April 2026) — section 202(1) (new regime slabs), Finance Act 2026
 *    First Schedule Part III Paragraphs A and F (old regime slabs by age,
 *    surcharge, marginal relief) and section 3(12)(b) Table Sl. No. 10 (new
 *    regime surcharge, capped at 25%), section 156 (rebate), section 19(1)
 *    Table Sl. Nos. 1 and 2 (professional tax, standard deduction), section
 *    124(1)-(2) (employer NPS) and section 397(2)(b) (no PAN).
 *
 * The Finance Act 2026 kept every figure FY 2025-26 had, so one set serves both
 * years.
 */

/** Old-regime deduction and rebate, for TDS rules seeded without `config.oldRegime`. */
const OLD_REGIME_TERMS = { standardDeduction: 50000, rebateUpTo: 500000, rebateMax: 12500, marginalRelief: false };

/* Old regime, resident 60 to 79 at any time in the year: nil to ₹3 lakh. */
export const OLD_SENIOR_BANDS: TaxBand[] = [
  { upTo: 300000, rate: 0 },
  { upTo: 500000, rate: 5 },
  { upTo: 1000000, rate: 20 },
  { upTo: null, rate: 30 },
];
/* Old regime, resident 80 or over: nil to ₹5 lakh, then straight to 20%. */
export const OLD_SUPER_SENIOR_BANDS: TaxBand[] = [
  { upTo: 500000, rate: 0 },
  { upTo: 1000000, rate: 20 },
  { upTo: null, rate: 30 },
];

/* Surcharge on the tax once total income exceeds ₹50 lakh. The new regime
   stops at 25%; the old one goes to 37% above ₹5 crore. */
export const OLD_SURCHARGE: SurchargeBand[] = [
  { over: 5000000, rate: 10 },
  { over: 10000000, rate: 15 },
  { over: 20000000, rate: 25 },
  { over: 50000000, rate: 37 },
];
export const NEW_SURCHARGE: SurchargeBand[] = [
  { over: 5000000, rate: 10 },
  { over: 10000000, rate: 15 },
  { over: 20000000, rate: 25 },
];

/* Employer NPS deductible up to this share of salary (Basic and DA): 10% for a
   private employer under the old regime, 14% under the new. */
const EMPLOYER_NPS_RATE = { OLD: 10, NEW: 14 };

/* Section 206AA (397(2) from April 2026): without a PAN, the higher of the rate
   in force and 20%. */
export const NO_PAN_RATE = 20;

/**
 * Whether somebody is a senior (60) or very senior (80) citizen for a
 * financial year: aged that "at any time during the year". A person attains an
 * age the day before the birthday, so somebody born on 1 April 1966 is 60 on
 * 31 March 2026 and a senior for 2025-26.
 */
export function ageBandFor(dateOfBirth: string | null | undefined, anyDateInYear: string): AgeBand {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}/.test(dateOfBirth)) return null;
  const y = Number(anyDateInYear.slice(0, 4));
  const start = Number(anyDateInYear.slice(5, 7)) >= 4 ? y : y - 1;
  const dayAfterYear = `${start + 1}-04-01`;
  const birthday = (age: number) => `${Number(dateOfBirth.slice(0, 4)) + age}${dateOfBirth.slice(4, 10)}`;
  if (birthday(80) <= dayAfterYear) return 'SUPER_SENIOR';
  if (birthday(60) <= dayAfterYear) return 'SENIOR';
  return null;
}

/** Slab by slab, each rate applying only to the part of income inside it. */
function slabTaxOn(bands: TaxBand[], income: number) {
  let tax = 0;
  let previous = 0;
  for (const band of bands) {
    const ceiling = band.upTo ?? Infinity;
    if (income <= previous) break;
    const inBand = Math.min(income, ceiling) - previous;
    if (inBand > 0) tax += (inBand * band.rate) / 100;
    previous = ceiling;
    if (!Number.isFinite(ceiling)) break;
  }
  return tax;
}

/** The surcharge band total income falls in ("exceeds", so ₹50 lakh exactly has none). */
const surchargeBandOf = (bands: SurchargeBand[], income: number) =>
  [...bands].sort((a, b) => b.over - a.over).find((b) => income > b.over) || null;

/** What, beyond declarations, comes off salary before the slabs. All annual. */
export type TaxAdjustments = {
  /** Professional tax paid in the year: deductible under the old regime only. */
  professionalTax?: number;
  /** The employer's NPS contribution, already counted in the income. */
  employerNps?: number;
  /** Basic and DA for the year, which the NPS limit is a share of. */
  npsWage?: number;
  ageBand?: AgeBand;
};

/**
 * The year's income tax on a year's salary, under one regime: standard
 * deduction, professional tax (old regime), employer NPS, declared deductions
 * (old regime only), slabs by age, rebate, surcharge with marginal relief and
 * cess. Shared by monthly TDS and Form 16, so the certificate and the payslips
 * cannot disagree about how tax was worked out.
 */
export function incomeTax(rule: StatutoryRuleInput, regime: 'OLD' | 'NEW', annualIncome: number, deductions = 0, adjust: TaxAdjustments = {}) {
  /*
   * The standard deduction and the rebate are not the same in both regimes:
   * new ₹75,000 and a rebate up to ₹12 lakh (at most ₹60,000), old ₹50,000 and
   * up to ₹5 lakh (at most ₹12,500). The top-level figures are the new
   * regime's; `config.oldRegime` holds the old. Applying the new figures to an
   * old-regime employee withheld nothing up to about ₹8 lakh and too little
   * above it (₹39,000 instead of ₹1,06,600 on ₹10 lakh). A rule seeded before
   * `oldRegime` existed falls back to the old regime's own figures.
   */
  const terms =
    regime === 'OLD' ? { ...OLD_REGIME_TERMS, ...(rule.config?.oldRegime || {}) } : rule.config || {};

  /* The old regime's slabs move with age; the new regime has one set for everybody. */
  const ageBand = regime === 'OLD' ? adjust.ageBand || null : null;
  const listed = (v: unknown): TaxBand[] | null => (Array.isArray(v) && v.length ? (v as TaxBand[]) : null);
  const bands: TaxBand[] =
    (ageBand === 'SUPER_SENIOR' && (listed(terms.superSeniorBands) || OLD_SUPER_SENIOR_BANDS)) ||
    (ageBand === 'SENIOR' && (listed(terms.seniorBands) || OLD_SENIOR_BANDS)) ||
    listed(rule.config?.[regime === 'OLD' ? 'oldRegimeBands' : 'newRegimeBands']) ||
    [];
  if (!bands.length) return null;

  const income = Math.max(0, annualIncome);
  const standardDeduction = Math.min(income, Number(terms.standardDeduction ?? 0));
  /* Tax on employment (section 16(iii); 19(1) Sl. No. 1 from April 2026), at
     most ₹2,500 a year under the Constitution (article 276(2)). The new regime
     allows only the standard deduction against salary (115BAC(2); 202(2)). */
  const professionalTax = regime === 'OLD' ? Math.min(PT_ANNUAL_CAP, Math.max(0, Number(adjust.professionalTax) || 0)) : 0;
  /* Employer NPS (80CCD(2); 124(1)-(2)): allowed in both regimes, up to a share of Basic and DA. */
  const npsRate = Number(terms.employerNpsRate ?? EMPLOYER_NPS_RATE[regime]);
  const employerNps = round2(Math.min(Math.max(0, Number(adjust.employerNps) || 0), (Math.max(0, Number(adjust.npsWage) || 0) * npsRate) / 100));
  const declared = regime === 'OLD' ? Math.max(0, deductions) : 0;
  const taxable = Math.max(0, income - standardDeduction - professionalTax - employerNps - declared);

  const slabTax = slabTaxOn(bands, taxable);

  /* A rebate wipes the tax out entirely below a threshold rather than reducing
     it — somebody just under the line pays nothing at all. */
  let tax = slabTax;
  const rebateUpTo = Number(terms.rebateUpTo ?? 0);
  const rebateMax = Number(terms.rebateMax ?? 0);
  if (rebateUpTo && taxable <= rebateUpTo) tax = Math.max(0, tax - rebateMax);
  /* Marginal relief (new regime): just over the rebate line, the tax may not
     exceed the income above the line, or earning ₹1,000 more would cost
     ₹60,000 in tax. */
  else if (rebateUpTo && terms.marginalRelief) tax = Math.min(tax, taxable - rebateUpTo);

  /*
   * Surcharge, a share of the tax once income passes ₹50 lakh — with its own
   * marginal relief: crossing a line may not cost more in tax and surcharge
   * than the income above the line. Without it ₹50,00,100 would owe about
   * ₹1.3 lakh more than ₹50,00,000.
   */
  const surchargeBands: SurchargeBand[] = Array.isArray(terms.surcharge) ? terms.surcharge : regime === 'OLD' ? OLD_SURCHARGE : NEW_SURCHARGE;
  const band = surchargeBandOf(surchargeBands, taxable);
  let surcharge = band ? (tax * band.rate) / 100 : 0;
  let surchargeRelief = 0;
  if (band) {
    const atLine = slabTaxOn(bands, band.over);
    const below = surchargeBandOf(surchargeBands, band.over);
    const ceiling = atLine + (below ? (atLine * below.rate) / 100 : 0) + (taxable - band.over);
    if (tax + surcharge > ceiling) {
      surchargeRelief = Math.min(surcharge, tax + surcharge - ceiling);
      surcharge -= surchargeRelief;
    }
  }

  const cessRate = Number(rule.config?.cessRate ?? 0);
  const cess = round2((tax + surcharge) * (cessRate / 100));
  return {
    standardDeduction,
    professionalTax,
    employerNps,
    deductions: declared,
    taxable,
    ageBand,
    /* Income up to here owes nothing whatever else applies: the first nil band. */
    exemptionLimit: bands[0]?.rate === 0 ? Number(bands[0].upTo ?? Infinity) : 0,
    slabTax: round2(slabTax),
    rebate: round2(slabTax - tax),
    tax: round2(tax),
    surchargeRate: band?.rate ?? 0,
    surcharge: round2(surcharge),
    surchargeRelief: round2(surchargeRelief),
    cess,
    total: round2(tax + surcharge + cess),
  };
}

/**
 * Income tax withheld from salary.
 *
 * Project the year's taxable pay (this employer's, and a previous employer's
 * from Form 12B), work the tax on it, subtract what has already been withheld
 * here and there, and spread the rest over the months that remain.
 *
 * Spreading matters: charging the whole year's tax in March is legal and
 * ruinous for the person receiving it.
 */
function computeTds(
  rule: StatutoryRuleInput,
  wages: StatutoryWages,
  employee: StatutoryEmployee,
  opts: { monthsRemaining: number; taxAlreadyDeducted: number }
): StatutoryAmount {
  const base = {
    scheme: 'TDS' as const,
    ruleId: rule.id,
    ruleVersion: rule.version,
    wageApplied: 0,
    rateApplied: 0,
    ceilingApplied: null,
  };

  const regime = employee.taxRegime || 'NEW';
  const declared = regime === 'OLD' ? Math.max(0, Number(wages.taxDeductions?.total) || 0) : 0;
  const previous = wages.previousEmployer || null;
  const income = Number(wages.annualTaxable ?? 0) + Math.max(0, Number(previous?.income) || 0);
  const year = incomeTax(rule, regime, income, declared, {
    professionalTax: wages.professionalTax,
    employerNps: wages.employerNps,
    npsWage: wages.npsWage,
    ageBand: employee.ageBand,
  });
  if (!year) {
    return { ...base, employee: 0, employer: 0, explanation: 'No income tax bands are set.', exemptReason: 'NO_BANDS' };
  }
  const { taxable } = year;

  /*
   * No PAN: the higher of the tax in force and 20% of the income (section
   * 206AA; 397(2)(b) from April 2026). CBDT's salary circulars read this as
   * the average rate against 20%, with no cess on the 20%, and nothing to
   * withhold while the income is below the taxable limit.
   */
  let due = year.total;
  let noPanRate: number | undefined;
  if (employee.hasPan === false && taxable > year.exemptionLimit) {
    const rate = Number(rule.config?.noPanRate ?? NO_PAN_RATE);
    const flat = round2((taxable * rate) / 100);
    if (flat > due) {
      due = flat;
      noPanRate = rate;
    }
  }

  const previousTds = Math.max(0, Number(previous?.tds) || 0);
  const already = Math.max(0, Number(opts.taxAlreadyDeducted) || 0) + previousTds;
  const remaining = Math.max(0, round2(due - already));
  const months = Math.max(1, opts.monthsRemaining);
  const monthly = applyRounding(remaining / months, rule.rounding);

  const off = [
    year.professionalTax ? `${money(year.professionalTax)} of professional tax` : '',
    year.employerNps ? `${money(year.employerNps)} of employer NPS` : '',
    declared ? `${money(declared)} of ${wages.taxDeductions?.note || 'declared deductions'}` : '',
  ].filter(Boolean);
  const how = noPanRate
    ? `${money(due)} of tax at ${noPanRate}% of ${money(taxable)} for the year, because there is no PAN on file (section 206AA)`
    : `${money(due)} of tax on ${money(taxable)} for the year${off.length ? ` (after ${off.join(', ')})` : ''}${
        year.surcharge ? `, including ${money(year.surcharge)} of surcharge${year.surchargeRelief ? ' after marginal relief' : ''}` : ''
      }`;
  const prior = previousTds
    ? `less ${money(opts.taxAlreadyDeducted || 0)} already deducted here and ${money(previousTds)} by a previous employer`
    : `less ${money(opts.taxAlreadyDeducted || 0)} already deducted`;

  return {
    ...base,
    employee: monthly,
    employer: 0,
    wageApplied: taxable,
    ...(noPanRate ? { rateApplied: noPanRate, noPanRate } : {}),
    explanation:
      due <= 0
        ? `No tax is due on ${money(taxable)} of taxable pay under the ${regime.toLowerCase()} regime.`
        : `${how}${previous?.income ? `, counting ${money(previous.income)} paid by a previous employer` : ''}, ${prior}, spread over ${months} month${months === 1 ? '' : 's'}.`,
  };
}

/** Everything a scheme needs, beyond the wages themselves. */
export type StatutoryContext = {
  /** 1–12, for states whose professional tax differs in one month. */
  month: number;
  monthsRemaining: number;
  taxAlreadyDeducted: number;
  /** Professional tax already deducted, for the cap, the balance month and once a month. */
  pt?: PtContext;
  /** Headcount and the company's LWF coverage setting. */
  lwf?: LwfContext;
};

/**
 * One scheme, one answer.
 *
 * The caller picks the rule — which is where the effective date and the
 * jurisdiction are resolved — and this works out what it says. Keeping rule
 * selection outside means the same arithmetic serves a payroll run, a
 * what-if on the structure screen, and a test with a rule written by hand.
 */
export function computeStatutory(
  rule: StatutoryRuleInput,
  wages: StatutoryWages,
  employee: StatutoryEmployee,
  context: StatutoryContext
): StatutoryAmount {
  switch (rule.scheme) {
    case 'PF':
      return computePf(rule, wages, employee);
    case 'ESI':
      return computeEsi(rule, wages, employee);
    case 'PT':
      return computePt(rule, wages, employee, context.month, context.pt);
    case 'LWF':
      return computeLwf(rule, wages, employee, context.month, context.lwf);
    case 'TDS':
      return computeTds(rule, wages, employee, {
        monthsRemaining: context.monthsRemaining,
        taxAlreadyDeducted: context.taxAlreadyDeducted,
      });
    default:
      return {
        scheme: rule.scheme,
        employee: 0,
        employer: 0,
        ruleId: rule.id,
        ruleVersion: rule.version,
        explanation: `${rule.scheme} is not computed yet.`,
        wageApplied: 0,
        rateApplied: 0,
        ceilingApplied: null,
        exemptReason: 'NOT_IMPLEMENTED',
      };
  }
}

/**
 * The rule in force for a scheme on a date.
 *
 * Latest effective date that has started and has not ended, narrowed to the
 * jurisdiction where one applies. A run for March finds March's rule however
 * many rates have been published since, which is the whole reason rules are
 * dated rather than edited.
 */
export function ruleInForce<T extends { effectiveFrom: string; effectiveTo: string | null; jurisdiction: string | null; status: string; version?: string }>(
  rules: T[],
  onDate: string,
  jurisdiction?: string | null
): T | null {
  const wanted = canonicalState(jurisdiction);
  const candidates = rules
    /*
     * In force: ACTIVE, or SUPERSEDED inside the window it was closed to. A
     * superseded version still answers for the months before its successor —
     * West Bengal's old slabs for September 2026, once October's are in — or
     * recomputing a past month would find nothing and deduct nil. One closed
     * with no end date was withdrawn, not replaced, and answers for nothing.
     */
    .filter((r) => r.status === 'ACTIVE' || (r.status === 'SUPERSEDED' && Boolean(r.effectiveTo)))
    .filter((r) => r.effectiveFrom <= onDate && (!r.effectiveTo || r.effectiveTo >= onDate))
    .filter((r) => {
      const j = canonicalState(r.jurisdiction);
      /* A rule with no jurisdiction applies everywhere; one with a jurisdiction
         applies only there. A state rule beats the general one. */
      return !j || !wanted || j === wanted;
    })
    .sort((a, b) => {
      const aj = a.jurisdiction ? 1 : 0;
      const bj = b.jurisdiction ? 1 : 0;
      if (aj !== bj) return bj - aj;
      if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
      /* Two versions from the same day: the later version (a correction) wins. */
      return String(a.version || '') < String(b.version || '') ? 1 : -1;
    });
  return candidates[0] || null;
}
