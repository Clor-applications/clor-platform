/**
 * What an employment type is, in words CLOR acts on (Workforce, 27 Oct 2026).
 * A company names its own types; each name maps to one kind, and the kind
 * decides which dates the forms ask for and whether payroll expects them.
 * Probation is not a kind: it is a period, from the probation and
 * confirmation dates. Full-time or part-time is not a kind either: it is
 * the employee's hours.
 */
export const EMPLOYMENT_KINDS = ['PERMANENT', 'FIXED_TERM', 'TRAINEE', 'INTERN', 'CONSULTANT', 'AGENCY'] as const;
export type EmploymentKind = (typeof EMPLOYMENT_KINDS)[number];

/* The list a company starts with; it renames, adds or switches off as it likes. */
export const DEFAULT_EMPLOYEE_TYPES: Array<[string, EmploymentKind]> = [
  ['Permanent', 'PERMANENT'],
  ['Fixed-term contract', 'FIXED_TERM'],
  ['Trainee', 'TRAINEE'],
  ['Intern', 'INTERN'],
  ['Consultant', 'CONSULTANT'],
];

/* Paid on an invoice, not through payroll: no salary, PF or ESI expected. */
export const OUTSIDE_PAYROLL: ReadonlySet<string> = new Set(['CONSULTANT', 'AGENCY']);
export const HOURS = ['FULL_TIME', 'PART_TIME'] as const;

/** The kind a type's own name plainly means (the same rules the migration used); otherwise permanent. */
export function guessKind(name: string): (typeof EMPLOYMENT_KINDS)[number] {
  const n = name.toLowerCase();
  if (/(agency|outsourc|third.party|manpower)/.test(n)) return 'AGENCY';
  if (/(consult|freelanc|retainer)/.test(n)) return 'CONSULTANT';
  if (/\bintern/.test(n)) return 'INTERN';
  if (/(trainee|apprentice)/.test(n)) return 'TRAINEE';
  if (/(fixed|contract)/.test(n)) return 'FIXED_TERM';
  return 'PERMANENT';
}
