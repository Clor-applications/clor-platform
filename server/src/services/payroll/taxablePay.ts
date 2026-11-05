import { round2 } from '../../utils/money.js';

/**
 * What of a payslip is salary for income tax.
 *
 * Gross pay is the wrong measure: a reimbursement against bills is paid but
 * not taxed, and the component's "taxable" switch is what says so. The
 * employer's NPS contribution is the other way round — not in gross, but
 * salary all the same (section 17(1)(viii); 17(1) of the Income-tax Act 2025),
 * and then deducted up to a limit under 80CCD(2) (124). So it is counted here
 * and taken off again in the tax calculation (statutory/engine.ts incomeTax).
 *
 * Shared by the payroll run, which projects the year from this month, and Form
 * 16, which adds up the year's payslips, so the two agree on what was taxed.
 */

/* Codes a company is likely to have used for employer NPS before components could be marked. */
const EMPLOYER_NPS_CODES = ['EMPLOYER_NPS', 'ER_NPS', 'NPS_ER', 'NPS_EMPLOYER'];

export const isEmployerNps = (c: { taxSection?: string | null; code?: string | null } | null | undefined) =>
  !!c && (c.taxSection === 'EMPLOYER_NPS' || EMPLOYER_NPS_CODES.includes(String(c.code || '').toUpperCase()));

export type TaxableLine = { type: string; amount: unknown; isTaxable: boolean; code: string; employerNps: boolean };

/** Taxable salary (employer NPS included), employer NPS on its own, and Basic plus DA for the NPS limit. */
export function taxablePayOf(lines: TaxableLine[]) {
  let earnings = 0;
  let employerNps = 0;
  let basicDa = 0;
  for (const l of lines) {
    const amount = Number(l.amount) || 0;
    if (l.employerNps) {
      if (l.type === 'EARNING' || l.type === 'EMPLOYER_CONTRIBUTION') employerNps += amount;
      continue;
    }
    if (l.type !== 'EARNING') continue;
    if (l.isTaxable) earnings += amount;
    if (['BASIC', 'DA'].includes(l.code.toUpperCase())) basicDa += amount;
  }
  return { taxable: round2(earnings + employerNps), employerNps: round2(employerNps), basicDa: round2(basicDa) };
}
