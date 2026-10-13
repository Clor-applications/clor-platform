/**
 * Who a salary component applies to.
 *
 * Until now a component reached an employee exactly one way: somebody put it
 * on the structure that employee was assigned to. That is right for the spine
 * of a salary — basic, HRA, PF — and wrong for everything conditional. A
 * transport allowance for one office, a hardship allowance for one grade, a
 * festival bonus for everyone this March: each of those meant forking a
 * structure, and a forked structure is a second thing to keep in step for the
 * rest of its life. Two structures that differ by one allowance drift within a
 * year, and the drift shows up as two people on the same grade being paid
 * differently for a reason nobody can name.
 *
 * So a component can also say who it is for. Three ways, in one field:
 *
 *   STRUCTURE      as before — only where a structure lists it
 *   ALL_EMPLOYEES  everybody being paid
 *   CONDITIONS     everybody who matches, all conditions having to hold
 *
 * ## Why AND only
 *
 * Several conditions on one component are ANDed, with no OR and no brackets.
 * That is a limit chosen rather than one not yet lifted: an engine with both
 * needs precedence, and precedence in a form whose shape nobody can see
 * produces rules whose own authors cannot say what they mean. Two populations
 * are two components, each with a name that says which — and a payslip line
 * named "Chennai transport" explains itself where "Transport (rule 4)" does
 * not.
 *
 * ## Why naming a person beats every rule
 *
 * An exclusion wins over an inclusion, and both win over the conditions.
 * Somebody named has been thought about; a rule that overrides a decision made
 * by hand is a rule people work around by editing the rule, and then the rule
 * means something else for everybody.
 *
 * ## What this file will not do
 *
 * It answers "does this apply to this person", from facts about the person. It
 * does not answer "how much", and it never reads computed pay — a threshold on
 * basic pay is a question about a number the engine has not produced yet, so
 * it lives in the calculator, beside the number. Keeping the two apart is what
 * lets this be a pure function over a small object, and therefore testable
 * without a payroll run.
 */

/** A person, as the rules are allowed to see them. */
export type EligibilityFacts = {
  employeeId: string;
  /** From the People record. */
  department?: string | null;
  designation?: string | null;
  status?: string | null;
  branchId?: string | null;
  dateOfJoining?: string | null;
  /** From the payroll profile. */
  payrollStatus?: string | null;
  payGroupId?: string | null;
  costCenterId?: string | null;
  taxRegime?: string | null;
  professionalTaxState?: string | null;
  pfApplicable?: boolean | null;
  esiApplicable?: boolean | null;
  ptApplicable?: boolean | null;
  /** From the active assignment. */
  annualCtc?: number | null;
  monthlyCtc?: number | null;
  structureId?: string | null;
  /** Derived, because "over a year of service" is the rule people actually write. */
  monthsOfService?: number | null;
};

export type ConditionOperator =
  | 'EQ' | 'NE' | 'GT' | 'GE' | 'LT' | 'LE'
  | 'IN' | 'NOT_IN' | 'CONTAINS' | 'IS_SET' | 'IS_NOT_SET';

export type Condition = {
  field: string;
  operator: string;
  value?: string | null;
};

export type ComponentTargeting = {
  appliesTo?: string | null;
  oneTimeDate?: string | null;
  conditions?: Condition[];
  /** Named people: `mode` is INCLUDE or EXCLUDE. */
  employeeTargets?: Array<{ employeeId: string; mode: string }>;
};

/**
 * The fields a rule may test, and what each one is.
 *
 * Exported because the screen offers exactly this list. A catalogue in the
 * browser and a reader on the server drift the day somebody adds a field to
 * one of them, and the symptom is a rule that saves cleanly and matches
 * nobody — silently, because an unknown field has no value to compare.
 */
export const CONDITION_FIELDS = [
  { field: 'department', label: 'Department', kind: 'text' },
  { field: 'designation', label: 'Designation', kind: 'text' },
  { field: 'status', label: 'Employment status', kind: 'choice', choices: ['ACTIVE', 'ON_NOTICE', 'LEFT', 'SUSPENDED'] },
  { field: 'branchId', label: 'Branch', kind: 'branch' },
  { field: 'payGroupId', label: 'Pay group', kind: 'payGroup' },
  { field: 'costCenterId', label: 'Cost centre', kind: 'costCentre' },
  { field: 'payrollStatus', label: 'Payroll status', kind: 'choice', choices: ['IN_PAYROLL', 'EXCLUDED', 'ON_HOLD'] },
  { field: 'taxRegime', label: 'Tax regime', kind: 'choice', choices: ['OLD', 'NEW'] },
  { field: 'professionalTaxState', label: 'Professional tax state', kind: 'text' },
  { field: 'pfApplicable', label: 'PF applicable', kind: 'boolean' },
  { field: 'esiApplicable', label: 'ESI applicable', kind: 'boolean' },
  { field: 'ptApplicable', label: 'PT applicable', kind: 'boolean' },
  { field: 'annualCtc', label: 'Annual CTC', kind: 'number' },
  { field: 'monthlyCtc', label: 'Monthly CTC', kind: 'number' },
  { field: 'monthsOfService', label: 'Months of service', kind: 'number' },
] as const;

const FIELD_NAMES: Set<string> = new Set(CONDITION_FIELDS.map((f) => f.field));

export const OPERATORS: Array<{ operator: ConditionOperator; label: string; needsValue: boolean }> = [
  { operator: 'EQ', label: 'is', needsValue: true },
  { operator: 'NE', label: 'is not', needsValue: true },
  { operator: 'GT', label: 'is more than', needsValue: true },
  { operator: 'GE', label: 'is at least', needsValue: true },
  { operator: 'LT', label: 'is less than', needsValue: true },
  { operator: 'LE', label: 'is at most', needsValue: true },
  { operator: 'IN', label: 'is one of', needsValue: true },
  { operator: 'NOT_IN', label: 'is none of', needsValue: true },
  { operator: 'CONTAINS', label: 'contains', needsValue: true },
  { operator: 'IS_SET', label: 'is filled in', needsValue: false },
  { operator: 'IS_NOT_SET', label: 'is blank', needsValue: false },
];

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

/** A comma-separated list, as somebody actually types one. */
const list = (v: unknown) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const numeric = (v: unknown) => {
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * One test, against one person.
 *
 * An unknown field is false, not true. The alternative — treating what the
 * engine cannot read as "condition satisfied" — means a typo in a field name
 * quietly pays an allowance to everybody, which is the more expensive of the
 * two mistakes and the harder one to notice on a payslip.
 */
export function evaluateCondition(condition: Condition, facts: EligibilityFacts): boolean {
  const field = String(condition.field || '').trim();
  if (!FIELD_NAMES.has(field)) return false;

  const actual = (facts as Record<string, unknown>)[field];
  const operator = String(condition.operator || '').trim().toUpperCase();

  if (operator === 'IS_SET') return actual !== null && actual !== undefined && String(actual) !== '';
  if (operator === 'IS_NOT_SET') return actual === null || actual === undefined || String(actual) === '';

  /*
   * A comparison against a value nobody has is false, whichever way it points.
   * "Department is not Sales" reads as true for somebody with no department at
   * all, and that reading pays allowances to records that are merely
   * incomplete — so a missing value matches nothing, and the incompleteness
   * shows up as an unpaid allowance somebody asks about.
   */
  if (actual === null || actual === undefined || String(actual) === '') return false;

  switch (operator) {
    case 'EQ':
      return norm(actual) === norm(condition.value);
    case 'NE':
      return norm(actual) !== norm(condition.value);
    case 'CONTAINS':
      return norm(actual).includes(norm(condition.value));
    case 'IN':
      return list(condition.value).includes(norm(actual));
    case 'NOT_IN':
      return !list(condition.value).includes(norm(actual));
    case 'GT':
    case 'GE':
    case 'LT':
    case 'LE': {
      const a = numeric(actual);
      const b = numeric(condition.value);
      if (a === null || b === null) return false;
      if (operator === 'GT') return a > b;
      if (operator === 'GE') return a >= b;
      if (operator === 'LT') return a < b;
      return a <= b;
    }
    default:
      /* An operator this version does not know is not a licence to pay. */
      return false;
  }
}

export type EligibilityVerdict = {
  applies: boolean;
  /** Why, in the words a payroll trace should carry. */
  reason: string;
};

/**
 * Whether a component applies to one person, in one period.
 *
 * `onStructure` is whether the employee's own structure lists the component —
 * the only route that existed before, and still the one that decides for a
 * STRUCTURE component.
 */
export function componentApplies(
  component: ComponentTargeting,
  facts: EligibilityFacts,
  context: { onStructure: boolean; periodStart?: string | null; periodEnd?: string | null }
): EligibilityVerdict {
  const targets = component.employeeTargets || [];
  const named = targets.filter((t) => t.employeeId === facts.employeeId);
  const excluded = named.some((t) => String(t.mode).toUpperCase() === 'EXCLUDE');
  const included = named.some((t) => String(t.mode).toUpperCase() === 'INCLUDE');

  /* Named out, and that is the end of it — before the one-time date, before
     the rules, before the structure. Somebody decided this by hand. */
  if (excluded) return { applies: false, reason: 'Excluded for this employee' };

  /*
   * A one-time component belongs to the period its date falls in.
   *
   * Checked for everyone, including a named inclusion: "March bonus, and
   * include Priya" means include Priya in March, not in every month after.
   */
  const oneTime = String(component.oneTimeDate || '').trim();
  if (oneTime) {
    const from = String(context.periodStart || '').trim();
    const to = String(context.periodEnd || '').trim();
    if (!from || !to) return { applies: false, reason: 'One-time component with no period to place it in' };
    if (oneTime < from || oneTime > to) {
      return { applies: false, reason: `One-time component dated ${oneTime}, outside this period` };
    }
  }

  if (included) return { applies: true, reason: 'Named for this employee' };

  const appliesTo = String(component.appliesTo || 'STRUCTURE').toUpperCase();

  if (appliesTo === 'ALL_EMPLOYEES') return { applies: true, reason: 'Applies to everybody' };

  if (appliesTo === 'CONDITIONS') {
    const conditions = component.conditions || [];
    /*
     * No conditions on a CONDITIONS component matches nobody.
     *
     * The empty rule set reads two ways — "everything" or "nothing" — and one
     * of them pays an allowance to the whole company because somebody deleted
     * the last row of a rule they were editing. ALL_EMPLOYEES is how you say
     * everybody, and it says so in the field somebody has to choose.
     */
    if (!conditions.length) return { applies: false, reason: 'Conditional component with no conditions set' };

    const failed = conditions.find((c) => !evaluateCondition(c, facts));
    if (failed) {
      return { applies: false, reason: `Does not meet: ${failed.field} ${failed.operator} ${failed.value ?? ''}`.trim() };
    }
    return { applies: true, reason: `Meets all ${conditions.length} condition${conditions.length === 1 ? '' : 's'}` };
  }

  return context.onStructure
    ? { applies: true, reason: 'On the assigned salary structure' }
    : { applies: false, reason: 'Not on the assigned salary structure' };
}

/** Whole months between joining and a date, for the service-length rules. */
export function monthsOfService(dateOfJoining?: string | null, asOf?: string | null): number | null {
  const from = String(dateOfJoining || '').trim();
  const to = String(asOf || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  /* Not a month until the day comes round: somebody who joined on the 20th has
     served no months on the 5th of the following month. */
  if (td < fd) months -= 1;
  return Math.max(0, months);
}
