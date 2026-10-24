/**
 * The salary question journey (docs/people/02-PRD.md TRACE-04, section 8.1).
 * People never computes pay. It asks the owning apps, through their read
 * interfaces, for what they are willing to show this person, puts it side by
 * side, and routes a correction to the owner. Payroll's payslip interface
 * (PI-01) and Attendance's days interface belong to the cross-app fix; until
 * one registers, People says plainly which evidence it cannot get.
 */

export type PayslipLine = { code: string; label: string; amount: number; kind: 'EARNING' | 'DEDUCTION'; ruleVersion?: string | null; basis?: string | null };
export type PayslipRead = { month: string; net: number; lines: PayslipLine[]; ruleSet: string; ruleVersion: string };
export type DaysRead = { month: string; payableDays: number; lopDays: number; absences: Array<{ date: string; reason: string }> };

type PayslipInterface = (args: { orgId: string; employeeId: string; month: string }) => Promise<PayslipRead | null>;
type DaysInterface = (args: { orgId: string; employeeId: string; month: string }) => Promise<DaysRead | null>;

const registry: { payslip: PayslipInterface | null; days: DaysInterface | null } = { payslip: null, days: null };

/** Payroll registers PI-01, Attendance registers its days read; a null clears it (tests). */
export function registerPayslipInterface(fn: PayslipInterface | null) { registry.payslip = fn; }
export function registerDaysInterface(fn: DaysInterface | null) { registry.days = fn; }

export async function salaryQuestion(orgId: string, employeeId: string, month: string) {
  const missing: Array<{ evidence: string; owner: string; why: string }> = [];
  let payslip: PayslipRead | null = null;
  let days: DaysRead | null = null;
  if (registry.payslip) payslip = await registry.payslip({ orgId, employeeId, month });
  else missing.push({ evidence: 'The payslip and its deductions', owner: 'Payroll', why: 'Payroll does not offer its payslip read (PI-01) to People yet.' });
  if (registry.days) days = await registry.days({ orgId, employeeId, month });
  else missing.push({ evidence: 'Payable days, loss-of-pay days and the absences behind them', owner: 'Attendance', why: 'Attendance does not offer its days read to People yet.' });
  if (registry.payslip && !payslip) missing.push({ evidence: `The payslip for ${month}`, owner: 'Payroll', why: 'Payroll has no payslip for this month that this person may see.' });
  if (registry.days && !days) missing.push({ evidence: `Attendance for ${month}`, owner: 'Attendance', why: 'Attendance has no days recorded for this month.' });
  return {
    month,
    payslip,
    days,
    deductions: payslip ? payslip.lines.filter((l) => l.kind === 'DEDUCTION') : [],
    missing,
    /* The correction goes to the app that owns the number, never edited here. */
    correction: { category: 'PAYROLL', queue: 'Payroll', note: 'People shows these figures as Payroll and Attendance gave them; a correction is made by the owner.' },
  };
}
