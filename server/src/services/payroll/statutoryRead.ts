import { payrollPrisma } from '../../utils/payrollPrisma.js';

/**
 * Payroll's read interface for the identifiers it owns (docs/people/03
 * contract PI-01). PAN, UAN, ESIC and bank details live in Payroll and stay
 * there; People shows them masked and may reveal one value at a time to a
 * person with the right grant and a fresh authenticator code. People calls
 * these two functions and never the payroll client (AGENT_RULES rule 1).
 */

export const PAYROLL_STATUTORY_FIELDS = ['pan', 'uan', 'esic', 'account'] as const;
export type PayrollStatutoryField = (typeof PAYROLL_STATUTORY_FIELDS)[number];

const maskTail = (v: string | null | undefined, keep = 4) => {
  const s = String(v || '').trim();
  if (!s) return '';
  return s.length <= keep ? '*'.repeat(s.length) : `${'*'.repeat(Math.min(8, s.length - keep))}${s.slice(-keep)}`;
};

const column: Record<PayrollStatutoryField, 'pan' | 'uan' | 'esiNumber' | 'bankAccountNumber'> = { pan: 'pan', uan: 'uan', esic: 'esiNumber', account: 'bankAccountNumber' };

/** What People shows: masked identifiers and the flags, or that the person is not in Payroll yet. */
export async function maskedStatutory(orgId: string, employeeId: string) {
  const p = await payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId, employeeId } });
  if (!p) return { inPayroll: false as const };
  return {
    inPayroll: p.payrollStatus === 'IN_PAYROLL',
    pan: maskTail(p.pan),
    uan: maskTail(p.uan),
    esic: maskTail(p.esiNumber),
    bank: p.bankName || '',
    account: maskTail(p.bankAccountNumber),
    ifsc: p.bankIfsc || '',
    pf: p.pfApplicable,
    esi: p.esiApplicable,
    pt: p.ptApplicable ? p.professionalTaxState || 'on' : '',
    taxRegime: p.taxRegime,
  };
}

/** One value in clear. The caller has checked the grant and the step-up, and logs the reveal. */
export async function revealStatutory(orgId: string, employeeId: string, field: PayrollStatutoryField): Promise<string | null> {
  const p = await payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId, employeeId }, select: { [column[field]]: true } as any });
  return (p as any)?.[column[field]] ?? null;
}
