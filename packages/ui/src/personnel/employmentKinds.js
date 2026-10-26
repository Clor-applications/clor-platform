/**
 * What an employee type counts as (server/src/services/people/employmentKinds.ts).
 * The company names its own types; the kind decides which dates are asked for.
 * Probation is a period on the record, not a type; hours are a separate field.
 */
export const KIND_WORDS = {
  PERMANENT: 'Permanent',
  FIXED_TERM: 'Fixed-term contract',
  TRAINEE: 'Trainee',
  INTERN: 'Intern',
  CONSULTANT: 'Consultant, not on payroll',
  AGENCY: 'Agency worker, not on payroll',
};

export const HOURS_WORDS = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time' };

/** The kind of the chosen type, or null when no type is set. */
export const kindOf = (types, typeId) => (types || []).find((t) => t.id === typeId)?.category || null;

/**
 * Which end dates a kind has. No type yet: both, so nothing is hidden from
 * someone who has not set types up.
 */
export function datesFor(kind) {
  switch (kind) {
    case 'PERMANENT':
    case 'TRAINEE':
      return { probation: true, contract: false, contractLabel: 'Contract ends' };
    case 'FIXED_TERM':
      return { probation: true, contract: true, contractLabel: 'Contract ends' };
    case 'INTERN':
      return { probation: false, contract: true, contractLabel: 'Internship ends' };
    case 'CONSULTANT':
    case 'AGENCY':
      return { probation: false, contract: true, contractLabel: 'Contract ends' };
    default:
      return { probation: true, contract: true, contractLabel: 'Contract ends' };
  }
}

/**
 * Probation until confirmed in writing: 'ON' before the end date, 'OVER' once
 * it has passed with nothing decided (the more urgent case, never dropped).
 */
export function probationState(person, today) {
  if (!person?.probationEndDate || person.confirmedOn || person.status === 'LEFT') return null;
  return String(person.probationEndDate).slice(0, 10) >= today ? 'ON' : 'OVER';
}
