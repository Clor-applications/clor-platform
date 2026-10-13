import { compileFormula, FormulaError } from '../formula.js';
import { round2 } from '../../../utils/money.js';

/**
 * What a salary structure works out to.
 *
 * This is the core of payroll. The pay run will call it once per employee, and
 * the structure screen calls it on every keystroke to show what a structure
 * pays before anybody saves it. Everything it needs is passed in — it reads no
 * database, holds no state, and knows nothing about React or Express — so the
 * same inputs always produce the same numbers, which is what makes a payslip
 * defensible six months later.
 *
 * ## Resolution order is discovered, not declared
 *
 * Salary is written in terms of itself: HRA is a share of Basic, a special
 * allowance is whatever is left of CTC, and an employer's PF is a share of PF
 * wages which are a sum of other components. Asking whoever configures payroll
 * to also order the components correctly would be asking them to do the
 * computer's job, and would break the first time somebody inserted a line.
 *
 * So components are resolved in passes: anything whose inputs are known is
 * computed, which makes more inputs known, until nothing moves. What is left
 * unresolved after that is a genuine cycle — Basic as a share of Gross while
 * Gross counts Basic — and is reported as an error against the components
 * involved rather than silently becoming zero.
 *
 * GROSS is the interesting case. It is the sum of earnings that count towards
 * gross, so it cannot be known until those are, yet components legitimately
 * depend on it. It becomes available only once every non-GROSS-dependent
 * earning has settled, which is exactly the point at which it is true.
 *
 * ## Every number carries its reasoning
 *
 * Each line comes back with a trace: what it started from, the rule applied,
 * the proration, the rounding. That is not decoration — an employee asking why
 * their HRA changed is the most common question payroll receives, and the
 * answer has to come from the calculation rather than from somebody rebuilding
 * it by hand.
 */

export const ENGINE_VERSION = '1.0.0';

export type ComponentType = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION';
export type CalculationMethod = 'FIXED' | 'PERCENTAGE' | 'FORMULA' | 'VARIABLE' | 'STATUTORY' | 'BALANCING';
export type Rounding = 'NONE' | 'NEAREST' | 'UP' | 'DOWN';

/** A component as the engine needs it: the component's settings plus any structure override. */
export type EngineComponent = {
  componentId: string;
  code: string;
  name: string;
  type: ComponentType;
  calculationMethod: CalculationMethod;
  amount: number;
  percentage: number;
  formula: string | null;
  calculationBase: string | null;
  rounding: Rounding;
  statutoryScheme?: string | null;
  isTaxable: boolean;
  prorate: boolean;
  includeInPfWage: boolean;
  includeInEsiWage: boolean;
  includeInGratuityWage: boolean;
  includeInGross: boolean;
  includeInNetPay: boolean;
  isVariable: boolean;
  isBalancing: boolean;
  /*
   * A threshold, and a ceiling.
   *
   * Both live here rather than in the eligibility service beside the other
   * rules about who gets a component, and the split is the point: eligibility
   * answers "does this apply to this person" from facts about the person, and
   * can be decided before any arithmetic. These two are questions about a
   * number this engine has not produced yet — is basic over 25,000, is the
   * result past its cap — so they are answered here, beside the number, where
   * the trace that explains them is already being written.
   */
  thresholdBase?: string | null;
  /** GT | GE | LT | LE | EQ | NE | RANGE */
  thresholdOperator?: string | null;
  thresholdAmount?: number;
  thresholdRangeEnd?: number;
  hasMaxLimit?: boolean;
  maximumAmount?: number;
  /** CAP — pay the maximum. EXCLUDE — pay nothing past it. */
  exceedBehaviour?: string | null;
  displayOrder: number;
  expenseLedgerId?: string | null;
  liabilityLedgerId?: string | null;
};

export type EngineInput = {
  annualCtc: number;
  /** Periods in a year — 12 monthly, 52 weekly. Decides MONTHLY_CTC. */
  periodsPerYear: number;
  workingDays: number;
  payableDays: number;
  lwpDays: number;
  /** Amounts entered for this period, keyed by component code. */
  variableAmounts?: Record<string, number>;
  /** What the statutory engine produced, keyed by component code. Phase 4. */
  statutoryAmounts?: Record<string, number>;
};

export type TraceStep = {
  code: string;
  componentId: string;
  baseLabel: string | null;
  baseAmount: number | null;
  ruleText: string;
  formula: string | null;
  computedAmount: number;
  prorationFactor: number | null;
  roundingApplied: number | null;
};

export type EngineLine = {
  componentId: string;
  code: string;
  name: string;
  type: ComponentType;
  amount: number;
  /** What it would have been without proration, when the two differ. */
  fullAmount: number;
  isTaxable: boolean;
  displayOrder: number;
  expenseLedgerId: string | null;
  liabilityLedgerId: string | null;
};

export type EngineResult = {
  engineVersion: string;
  lines: EngineLine[];
  grossEarnings: number;
  totalDeductions: number;
  employerContributions: number;
  netPay: number;
  /** What the company spends: gross plus what it contributes on top. */
  employerCost: number;
  pfWage: number;
  esiWage: number;
  gratuityWage: number;
  trace: TraceStep[];
  errors: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
};


const applyRounding = (value: number, mode: Rounding): number => {
  if (mode === 'UP') return Math.ceil(value);
  if (mode === 'DOWN') return Math.floor(value);
  if (mode === 'NEAREST') return Math.round(value);
  return round2(value);
};

/**
 * Which names a component's value depends on.
 *
 * A percentage depends on its base; a formula depends on whatever it mentions.
 * Everything else depends on nothing, which is what lets the first pass start.
 */
function dependenciesOf(c: EngineComponent, codes: Set<string>): string[] {
  /* A threshold is read before the component settles, so whatever it is
     measured against has to have settled first. Left out of this list, a
     component gated on GROSS was tested against a GROSS of zero and never
     paid — the component resolved early, correctly, on a base that was not
     true yet. */
  const gate = thresholdBaseOf(c);
  const withGate = (deps: string[]) => (gate ? [...deps, gate] : deps);

  if (c.calculationMethod === 'PERCENTAGE') {
    const base = String(c.calculationBase || '').trim().toUpperCase();
    return withGate(base ? [base] : []);
  }
  if (c.calculationMethod === 'FORMULA' && c.formula) {
    try {
      return withGate(compileFormula(c.formula, codes).variables);
    } catch {
      /* An unreadable formula is reported when it is evaluated, not here —
         a dependency scan is not the place to raise it. */
      return withGate([]);
    }
  }
  return withGate([]);
}

/** The name a component's threshold is measured against, if it has one. */
function thresholdBaseOf(c: EngineComponent): string | null {
  const op = String(c.thresholdOperator || '').trim().toUpperCase();
  if (!op) return null;
  const base = String(c.thresholdBase || '').trim().toUpperCase();
  return base || null;
}

/**
 * Whether a component's threshold is met, and the sentence that says so.
 *
 * Returns null where there is no threshold — which is most components, and is
 * not the same as a threshold that passed. A trace should say "only paid over
 * 25,000, and basic is 31,000" where that is why the line is there, and say
 * nothing at all where no such rule exists.
 */
function thresholdVerdict(
  c: EngineComponent,
  read: (name: string) => number | null
): { met: boolean; text: string } | null {
  const operator = String(c.thresholdOperator || '').trim().toUpperCase();
  if (!operator) return null;

  const base = thresholdBaseOf(c);
  const actual = base ? read(base) : null;
  const amount = Number(c.thresholdAmount) || 0;
  const rangeEnd = Number(c.thresholdRangeEnd) || 0;

  /*
   * A threshold measured against something this structure does not have is not
   * met. Paying it instead would make a typo in a base name — HRA against
   * `BASIC_PAY` where the code is `BASIC` — pay everybody unconditionally,
   * which is the expensive way round and the one nobody checks.
   */
  if (actual === null) {
    return { met: false, text: `Only paid when ${base || 'a base'} is known, and it is not` };
  }

  const met = (() => {
    switch (operator) {
      case 'GT': return actual > amount;
      case 'GE': return actual >= amount;
      case 'LT': return actual < amount;
      case 'LE': return actual <= amount;
      case 'EQ': return actual === amount;
      case 'NE': return actual !== amount;
      case 'RANGE': return actual >= amount && actual <= rangeEnd;
      default: return false;
    }
  })();

  const phrase: Record<string, string> = {
    GT: `over ${amount}`, GE: `at least ${amount}`,
    LT: `under ${amount}`, LE: `at most ${amount}`,
    EQ: `exactly ${amount}`, NE: `anything but ${amount}`,
    RANGE: `between ${amount} and ${rangeEnd}`,
  };
  const rule = phrase[operator] || `${operator} ${amount}`;
  return {
    met,
    text: met
      ? `Paid because ${base} (${actual}) is ${rule}`
      : `Not paid: ${base} (${actual}) is not ${rule}`,
  };
}

export function calculateStructure(components: EngineComponent[], input: EngineInput): EngineResult {
  const errors: EngineResult['errors'] = [];
  const warnings: EngineResult['warnings'] = [];
  const trace: TraceStep[] = [];

  const periods = input.periodsPerYear > 0 ? input.periodsPerYear : 12;
  const annualCtc = Number(input.annualCtc) || 0;
  const monthlyCtc = round2(annualCtc / periods);
  const workingDays = Number(input.workingDays) || 0;
  const payableDays = Number(input.payableDays) || 0;

  /*
   * Proration is payable days over working days, and it is 1 when nobody has
   * said otherwise. A zero working-day period would divide by zero, so it
   * prorates to nothing and says so rather than producing Infinity.
   */
  const proration = workingDays > 0 ? Math.min(1, payableDays / workingDays) : 1;
  if (workingDays > 0 && payableDays > workingDays) {
    warnings.push({
      code: 'PAYABLE_EXCEEDS_WORKING',
      message: `Payable days (${payableDays}) are more than working days (${workingDays}); paying a full period.`,
    });
  }

  const codes = new Set(components.map((c) => String(c.code || '').toUpperCase()));

  /**
   * Values available to formulas — always FULL period amounts, never prorated.
   *
   * HRA is 40% of Basic, and on a half month it should be 40% of a full Basic
   * and then halved once, not 40% of an already-halved Basic and halved again.
   * Reading prorated values here charged the reduction twice and quietly
   * underpaid everyone who took unpaid leave. Each component prorates its own
   * result exactly once, at the end.
   */
  const vars: Record<string, number> = {
    CTC: annualCtc,
    ANNUAL_CTC: annualCtc,
    MONTHLY_CTC: monthlyCtc,
    WORKING_DAYS: workingDays,
    PAYABLE_DAYS: payableDays,
    LWP_DAYS: Number(input.lwpDays) || 0,
    VARIABLE_PAY: Number(input.variableAmounts?.VARIABLE_PAY) || 0,
    OVERTIME: Number(input.variableAmounts?.OVERTIME) || 0,
  };

  const resolved = new Map<string, number>();
  /** Before proration, which is what a trace needs to explain the difference. */
  const fullAmounts = new Map<string, number>();

  const balancing = components.filter((c) => c.isBalancing || c.calculationMethod === 'BALANCING');
  if (balancing.length > 1) {
    errors.push({
      code: 'MULTIPLE_BALANCING',
      message: `Only one component can take the balance of CTC. ${balancing.map((c) => c.code).join(' and ')} both do.`,
    });
  }

  /** The full-period gross so far, over the components that have settled. */
  const grossOfResolved = () =>
    components
      .filter((c) => c.type === 'EARNING' && c.includeInGross && fullAmounts.has(c.code.toUpperCase()))
      .reduce((sum, c) => sum + (fullAmounts.get(c.code.toUpperCase()) || 0), 0);

  const pending = components.filter((c) => !c.isBalancing && c.calculationMethod !== 'BALANCING');

  /* GROSS becomes available only when every earning that does not itself depend
     on GROSS has settled — which is the moment it is actually true. */
  const grossDependent = new Set(
    pending
      .filter((c) => dependenciesOf(c, codes).includes('GROSS'))
      .map((c) => c.code.toUpperCase())
  );

  const compute = (c: EngineComponent): { value: number; step: Omit<TraceStep, 'prorationFactor' | 'roundingApplied'> } => {
    const code = c.code.toUpperCase();
    switch (c.calculationMethod) {
      case 'FIXED':
        return {
          value: c.amount,
          step: {
            code, componentId: c.componentId, baseLabel: null, baseAmount: null,
            ruleText: 'A fixed amount', formula: null, computedAmount: c.amount,
          },
        };
      case 'VARIABLE': {
        const entered = Number(input.variableAmounts?.[code]) || 0;
        return {
          value: entered,
          step: {
            code, componentId: c.componentId, baseLabel: null, baseAmount: null,
            ruleText: 'Entered for this period', formula: null, computedAmount: entered,
          },
        };
      }
      case 'STATUTORY': {
        /* Computed by the statutory engine, which is its own piece of work.
           Until it exists, a statutory line is whatever it was handed — and a
           zero nobody was warned about reads as a deliberate nil, so it says
           so rather than sitting quietly on the payslip. */
        const given = Number(input.statutoryAmounts?.[code]) || 0;
        if (input.statutoryAmounts?.[code] == null) {
          warnings.push({
            code: 'STATUTORY_NOT_COMPUTED',
            message: `${c.name} is worked out by the ${c.statutoryScheme || 'statutory'} rules, which are not set up yet, so it shows as nil.`,
          });
        }
        return {
          value: given,
          step: {
            code, componentId: c.componentId, baseLabel: null, baseAmount: null,
            ruleText: `${c.statutoryScheme || 'Statutory'} rule`, formula: null, computedAmount: given,
          },
        };
      }
      case 'PERCENTAGE': {
        const base = String(c.calculationBase || '').trim().toUpperCase();
        const baseAmount = vars[base] ?? fullAmounts.get(base) ?? 0;
        const value = (baseAmount * c.percentage) / 100;
        return {
          value,
          step: {
            code, componentId: c.componentId, baseLabel: base, baseAmount,
            ruleText: `${c.percentage}% of ${base}`, formula: null, computedAmount: value,
          },
        };
      }
      case 'FORMULA': {
        const value = compileFormula(String(c.formula || ''), codes).evaluate({ ...vars, ...Object.fromEntries(fullAmounts) });
        return {
          value,
          step: {
            code, componentId: c.componentId, baseLabel: null, baseAmount: null,
            ruleText: String(c.formula || ''), formula: String(c.formula || ''), computedAmount: value,
          },
        };
      }
      default:
        return {
          value: 0,
          step: {
            code, componentId: c.componentId, baseLabel: null, baseAmount: null,
            ruleText: 'Not calculated', formula: null, computedAmount: 0,
          },
        };
    }
  };

  const settle = (c: EngineComponent) => {
    const code = c.code.toUpperCase();
    let value = 0;
    let step: Omit<TraceStep, 'prorationFactor' | 'roundingApplied'>;
    try {
      const out = compute(c);
      value = out.value;
      step = out.step;
    } catch (e) {
      errors.push({
        code: 'COMPONENT_FAILED',
        message: `${c.name} (${c.code}) could not be calculated: ${e instanceof FormulaError ? e.message : 'unknown error'}`,
      });
      resolved.set(code, 0);
      fullAmounts.set(code, 0);
      vars[code] = 0;
      return;
    }

    /*
     * The threshold, before anything else is done with the number.
     *
     * It is read from FULL-period amounts, never prorated ones. "Only over
     * 25,000" is a statement about the salary, not about what a half month of
     * it comes to — testing the prorated figure would switch an allowance off
     * for anybody who took unpaid leave, which is the month they would least
     * expect their allowance to change.
     */
    const gate = thresholdVerdict(c, (name) => {
      const v = vars[name] ?? fullAmounts.get(name);
      return v === undefined ? null : Number(v);
    });
    if (gate && !gate.met) {
      resolved.set(code, 0);
      fullAmounts.set(code, 0);
      vars[code] = 0;
      trace.push({
        ...step,
        ruleText: gate.text,
        computedAmount: 0,
        prorationFactor: null,
        roundingApplied: null,
      });
      return;
    }

    let full = round2(Math.max(0, value));
    let capNote: string | null = null;

    /*
     * The ceiling, applied to the full amount for the same reason.
     *
     * Two behaviours, because both are real policies. CAP pays the maximum —
     * a transport allowance of 10% of basic, never more than 3,000. EXCLUDE
     * pays nothing at all once the figure is past it — a low-income supplement
     * that stops rather than tapering. Silently capping where somebody meant
     * to stop would overpay every senior employee by the cap, monthly.
     */
    if (c.hasMaxLimit) {
      const ceiling = Number(c.maximumAmount) || 0;
      if (full > ceiling) {
        const behaviour = String(c.exceedBehaviour || 'CAP').toUpperCase();
        if (behaviour === 'EXCLUDE') {
          capNote = `Not paid: ${round2(full)} is over the maximum of ${ceiling}`;
          full = 0;
        } else {
          capNote = `Capped at ${ceiling}, from ${round2(full)}`;
          full = round2(ceiling);
        }
      }
    }

    /* Proration is days worked over days expected, and only for components
       that say they shrink. A fixed reimbursement usually does not. */
    const factor = c.prorate ? proration : 1;
    const prorated = full * factor;
    const finalValue = applyRounding(prorated, c.rounding);

    resolved.set(code, finalValue);
    fullAmounts.set(code, full);
    /* The full amount, so anything depending on this prorates once of its own
       accord rather than inheriting a reduction that has already been made. */
    vars[code] = full;

    trace.push({
      ...step,
      /* The cap and the threshold both belong in the sentence, because both
         are the answer to "why is this line what it is". */
      ruleText: [step.ruleText, gate?.text, capNote].filter(Boolean).join(' · '),
      computedAmount: finalValue,
      prorationFactor: factor === 1 ? null : round2(factor),
      roundingApplied: round2(finalValue - prorated) || null,
    });
  };

  // ---- passes ------------------------------------------------------------
  const waiting = [...pending];
  let grossPublished = false;
  let moved = true;

  while (moved && waiting.length) {
    moved = false;

    for (let i = waiting.length - 1; i >= 0; i -= 1) {
      const c = waiting[i];
      const deps = dependenciesOf(c, codes);
      const ready = deps.every((d) => d in vars || fullAmounts.has(d));
      if (!ready) continue;
      settle(c);
      waiting.splice(i, 1);
      moved = true;
    }

    /* Everything that does not depend on GROSS has settled, so GROSS is now
       true and the components waiting on it can go. */
    if (!moved && !grossPublished) {
      const outstanding = waiting.filter((c) => !grossDependent.has(c.code.toUpperCase()));
      if (outstanding.length === 0) {
        vars.GROSS = round2(grossOfResolved());
        vars.PF_WAGE = round2(
          components
            .filter((c) => c.includeInPfWage && fullAmounts.has(c.code.toUpperCase()))
            .reduce((s, c) => s + (fullAmounts.get(c.code.toUpperCase()) || 0), 0)
        );
        vars.ESI_WAGE = round2(
          components
            .filter((c) => c.includeInEsiWage && fullAmounts.has(c.code.toUpperCase()))
            .reduce((s, c) => s + (fullAmounts.get(c.code.toUpperCase()) || 0), 0)
        );
        grossPublished = true;
        moved = true;
      }
    }
  }

  for (const c of waiting) {
    errors.push({
      code: 'CIRCULAR_COMPONENT',
      message: `${c.name} (${c.code}) depends on something that depends on it, so it cannot be worked out.`,
    });
    resolved.set(c.code.toUpperCase(), 0);
    fullAmounts.set(c.code.toUpperCase(), 0);
  }

  if (!grossPublished) vars.GROSS = round2(grossOfResolved());

  // ---- the balancing component, last, because it is the remainder --------
  for (const c of balancing) {
    const code = c.code.toUpperCase();
    /*
     * What is left of the period's CTC once everything else the company spends
     * has been counted. Earnings and employer contributions both consume CTC;
     * employee deductions come out of the employee's own gross and do not.
     */
    const spent = components
      .filter((x) => x !== c && (x.type === 'EARNING' || x.type === 'EMPLOYER_CONTRIBUTION'))
      .reduce((s, x) => s + (fullAmounts.get(x.code.toUpperCase()) || 0), 0);
    const remainder = monthlyCtc - spent;
    const full = round2(Math.max(0, remainder));
    /* It is a share of pay like any other, so unpaid leave reduces it too. */
    const factor = c.prorate ? proration : 1;
    const value = applyRounding(full * factor, c.rounding);

    if (remainder < 0) {
      errors.push({
        code: 'CTC_EXCEEDED',
        message: `The components already cost more than the CTC allows, so ${c.name} has nothing left to take.`,
      });
    }

    resolved.set(code, value);
    fullAmounts.set(code, full);
    vars[code] = full;
    trace.push({
      code,
      componentId: c.componentId,
      baseLabel: 'MONTHLY_CTC',
      baseAmount: monthlyCtc,
      ruleText: `Whatever is left of the period's CTC after the other components`,
      formula: null,
      computedAmount: value,
      prorationFactor: factor === 1 ? null : round2(factor),
      roundingApplied: null,
    });
  }

  // ---- totals ------------------------------------------------------------
  const lines: EngineLine[] = components
    .map((c) => {
      const code = c.code.toUpperCase();
      return {
        componentId: c.componentId,
        code: c.code,
        name: c.name,
        type: c.type,
        amount: resolved.get(code) ?? 0,
        fullAmount: fullAmounts.get(code) ?? 0,
        isTaxable: c.isTaxable,
        displayOrder: c.displayOrder,
        expenseLedgerId: c.expenseLedgerId ?? null,
        liabilityLedgerId: c.liabilityLedgerId ?? null,
      };
    })
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));

  const sumWhere = (fn: (c: EngineComponent) => boolean) =>
    round2(components.filter(fn).reduce((s, c) => s + (resolved.get(c.code.toUpperCase()) || 0), 0));

  const grossEarnings = sumWhere((c) => c.type === 'EARNING' && c.includeInGross);
  const totalDeductions = sumWhere((c) => c.type === 'DEDUCTION' && c.includeInNetPay);
  const employerContributions = sumWhere((c) => c.type === 'EMPLOYER_CONTRIBUTION');
  /* Earnings outside gross are still paid — a reimbursement, for instance — so
     net pay counts everything marked as part of net pay, not gross alone. */
  const paidEarnings = sumWhere((c) => c.type === 'EARNING' && c.includeInNetPay);
  const netPay = round2(paidEarnings - totalDeductions);

  if (netPay < 0) {
    errors.push({
      code: 'NEGATIVE_NET_PAY',
      message: 'The deductions come to more than the pay, so this would be a negative payslip.',
    });
  }

  return {
    engineVersion: ENGINE_VERSION,
    lines,
    grossEarnings,
    totalDeductions,
    employerContributions,
    netPay,
    employerCost: round2(paidEarnings + employerContributions),
    pfWage: sumWhere((c) => c.includeInPfWage),
    esiWage: sumWhere((c) => c.includeInEsiWage),
    gratuityWage: sumWhere((c) => c.includeInGratuityWage),
    trace: trace.sort((a, b) => {
      const ai = lines.findIndex((l) => l.code.toUpperCase() === a.code);
      const bi = lines.findIndex((l) => l.code.toUpperCase() === b.code);
      return ai - bi;
    }),
    errors,
    warnings,
  };
}
