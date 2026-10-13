import { round2 } from '../../../utils/money.js';
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
  /** Annual taxable pay, for income tax. */
  annualTaxable?: number;
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

export type PtSlab = { from: number; to: number | null; amount: number; months?: number[] };

/**
 * Professional tax.
 *
 * A state levy, and every state that charges it does so differently — different
 * slabs, different amounts, and in some states a different amount in one month
 * of the year. So the engine reads slabs and the slabs come from a rule; there
 * is no state named anywhere in this function.
 */
function computePt(
  rule: StatutoryRuleInput,
  wages: StatutoryWages,
  employee: StatutoryEmployee,
  month: number
): StatutoryAmount {
  const base = {
    scheme: 'PT' as const,
    ruleId: rule.id,
    ruleVersion: rule.version,
    wageApplied: wages.gross,
    rateApplied: 0,
    ceilingApplied: null,
  };

  if (!employee.ptApplicable) {
    return { ...base, employee: 0, employer: 0, explanation: 'Professional tax does not apply to this person.', exemptReason: 'NOT_APPLICABLE' };
  }

  const slabs: PtSlab[] = Array.isArray(rule.config?.slabs) ? rule.config.slabs : [];
  if (!slabs.length) {
    return {
      ...base,
      employee: 0,
      employer: 0,
      explanation: `No professional tax slabs are set for ${rule.jurisdiction || 'this state'}.`,
      exemptReason: 'NO_SLABS',
    };
  }

  const slab = slabs.find(
    (s) =>
      wages.gross >= s.from &&
      (s.to == null || wages.gross <= s.to) &&
      /* Some states charge a different amount in one month of the year. */
      (!Array.isArray(s.months) || s.months.includes(month))
  );

  if (!slab) {
    return { ...base, employee: 0, employer: 0, explanation: `No slab covers ${money(wages.gross)}.`, exemptReason: 'NO_SLAB_MATCH' };
  }

  return {
    ...base,
    employee: applyRounding(slab.amount, rule.rounding),
    employer: 0,
    explanation: `${rule.jurisdiction || 'State'} professional tax on ${money(wages.gross)}: ${money(slab.amount)} a month.`,
  };
}

export type TaxBand = { upTo: number | null; rate: number };

/** Old-regime deduction and rebate, for TDS rules seeded without `config.oldRegime`. */
const OLD_REGIME_TERMS = { standardDeduction: 50000, rebateUpTo: 500000, rebateMax: 12500, marginalRelief: false };

/**
 * Income tax withheld from salary.
 *
 * Deliberately the foundation rather than the whole of it. What is here is the
 * spine every TDS calculation shares: project the year's taxable pay, work the
 * tax on it, subtract what has already been withheld, and spread the rest over
 * the months that remain. Declarations, investment proofs, house property
 * losses and perquisites all attach to `annualTaxable` — they change what is
 * taxed, not how it is spread — so they can be added without this being rewritten.
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
  const bands: TaxBand[] = Array.isArray(rule.config?.[regime === 'OLD' ? 'oldRegimeBands' : 'newRegimeBands'])
    ? rule.config[regime === 'OLD' ? 'oldRegimeBands' : 'newRegimeBands']
    : [];
  if (!bands.length) {
    return { ...base, employee: 0, employer: 0, explanation: 'No income tax bands are set.', exemptReason: 'NO_BANDS' };
  }

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

  const annual = Number(wages.annualTaxable ?? 0);
  const standardDeduction = Number(terms.standardDeduction ?? 0);
  const taxable = Math.max(0, annual - standardDeduction);

  /* Slab by slab, each rate applying only to the part of income inside it. */
  let tax = 0;
  let previous = 0;
  for (const band of bands) {
    const ceiling = band.upTo ?? Infinity;
    if (taxable <= previous) break;
    const inBand = Math.min(taxable, ceiling) - previous;
    if (inBand > 0) tax += (inBand * band.rate) / 100;
    previous = ceiling;
    if (!Number.isFinite(ceiling)) break;
  }

  /* A rebate wipes the tax out entirely below a threshold rather than reducing
     it — somebody just under the line pays nothing at all. */
  const rebateUpTo = Number(terms.rebateUpTo ?? 0);
  const rebateMax = Number(terms.rebateMax ?? 0);
  if (rebateUpTo && taxable <= rebateUpTo) tax = Math.max(0, tax - rebateMax);
  /* Marginal relief (new regime): just over the rebate line, the tax may not
     exceed the income above the line, or earning ₹1,000 more would cost
     ₹60,000 in tax. */
  else if (rebateUpTo && terms.marginalRelief) tax = Math.min(tax, taxable - rebateUpTo);

  const cessRate = Number(rule.config?.cessRate ?? 0);
  const withCess = round2(tax * (1 + cessRate / 100));

  const remaining = Math.max(0, round2(withCess - Number(opts.taxAlreadyDeducted || 0)));
  const months = Math.max(1, opts.monthsRemaining);
  const monthly = applyRounding(remaining / months, rule.rounding);

  return {
    ...base,
    employee: monthly,
    employer: 0,
    wageApplied: taxable,
    explanation:
      withCess <= 0
        ? `No tax is due on ${money(taxable)} of taxable pay under the ${regime.toLowerCase()} regime.`
        : `${money(withCess)} of tax on ${money(taxable)} for the year, less ${money(
            opts.taxAlreadyDeducted || 0
          )} already deducted, spread over ${months} month${months === 1 ? '' : 's'}.`,
  };
}

/** Everything a scheme needs, beyond the wages themselves. */
export type StatutoryContext = {
  /** 1–12, for states whose professional tax differs in one month. */
  month: number;
  monthsRemaining: number;
  taxAlreadyDeducted: number;
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
      return computePt(rule, wages, employee, context.month);
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
export function ruleInForce<T extends { effectiveFrom: string; effectiveTo: string | null; jurisdiction: string | null; status: string }>(
  rules: T[],
  onDate: string,
  jurisdiction?: string | null
): T | null {
  const wanted = String(jurisdiction || '').trim().toUpperCase();
  const candidates = rules
    .filter((r) => r.status === 'ACTIVE')
    .filter((r) => r.effectiveFrom <= onDate && (!r.effectiveTo || r.effectiveTo >= onDate))
    .filter((r) => {
      const j = String(r.jurisdiction || '').trim().toUpperCase();
      /* A rule with no jurisdiction applies everywhere; one with a jurisdiction
         applies only there. A state rule beats the general one. */
      return !j || !wanted || j === wanted;
    })
    .sort((a, b) => {
      const aj = a.jurisdiction ? 1 : 0;
      const bj = b.jurisdiction ? 1 : 0;
      if (aj !== bj) return bj - aj;
      return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
    });
  return candidates[0] || null;
}
