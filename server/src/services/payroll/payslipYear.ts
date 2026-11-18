import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { round2 } from '../../utils/money.js';

/**
 * Read-only figures for the employee's own payslips: what this financial year
 * came to so far, the pension share of the company's PF, and the PF saved in
 * CLOR's payroll records.
 *
 * Nothing here calculates pay. Every figure is a sum of what payslips already
 * say: deduction lines carrying the TDS or PF scheme, and the PF split each
 * payslip recorded in its statutory snapshot when it was made.
 */

/** A payslip is counted once its payroll is final: locked, paid or posted. */
export const FINAL_RUN = ['LOCKED', 'PAID', 'POSTED'];

/** The Indian financial year a date falls in starts on 1 April. */
export const financialYearStart = (isoDate: string) => {
  const [y, m] = String(isoDate).split('-').map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
};

type SlipLine = { componentId: string; type: string; amount: unknown };
type SlipLike = { grossEarnings: unknown; netPay: unknown; statutorySnapshotJson?: string | null; lines: SlipLine[] };

/** Which components carry the TDS or PF scheme, by id. */
export async function schemeComponents(orgId: string) {
  const rows = await payrollPrisma.salaryComponent.findMany({
    where: { orgId, statutoryScheme: { in: ['TDS', 'PF'] } },
    select: { id: true, statutoryScheme: true },
  });
  return new Map(rows.map((r) => [r.id, String(r.statutoryScheme)]));
}

/** One payslip's tax, the employee's PF, and the company's PF split into pension (EPS) and fund (EPF). */
export function slipParts(slip: SlipLike, schemes: Map<string, string>) {
  let tax = 0;
  let pfEmployee = 0;
  for (const l of slip.lines || []) {
    if (l.type !== 'DEDUCTION') continue;
    const scheme = schemes.get(l.componentId);
    if (scheme === 'TDS') tax += Number(l.amount) || 0;
    if (scheme === 'PF') pfEmployee += Number(l.amount) || 0;
  }
  let pension = 0;
  let pfEmployer = 0;
  let snap: { results?: Array<{ scheme: string; employer?: number; employerSplit?: { EPS?: number; EPF?: number } | null }> } = {};
  try { snap = JSON.parse(slip.statutorySnapshotJson || '{}'); } catch { /* an old payslip without one */ }
  for (const r of snap.results || []) {
    if (r.scheme !== 'PF') continue;
    const eps = Number(r.employerSplit?.EPS) || 0;
    pension += eps;
    pfEmployer += r.employerSplit ? Number(r.employerSplit.EPF) || 0 : Math.max(0, (Number(r.employer) || 0) - eps);
  }
  return { tax: round2(tax), pfEmployee: round2(pfEmployee), pension: round2(pension), pfEmployer: round2(pfEmployer) };
}

async function finalRunIds(orgId: string) {
  return (await payrollPrisma.payrollRun.findMany({ where: { orgId, status: { in: FINAL_RUN } }, select: { id: true } })).map((r) => r.id);
}

async function ownFinalSlips(orgId: string, employeeId: string, range?: { from: string; to: string }) {
  const runs = await finalRunIds(orgId);
  if (!runs.length) return [];
  return payrollPrisma.salarySlip.findMany({
    where: {
      orgId,
      employeeId,
      runId: { in: runs },
      status: { not: 'CANCELLED' },
      ...(range ? { payrollDate: { gte: range.from, lte: range.to } } : {}),
    },
    select: { payrollDate: true, grossEarnings: true, netPay: true, statutorySnapshotJson: true, lines: { select: { componentId: true, type: true, amount: true } } },
    orderBy: { payrollDate: 'asc' },
  });
}

/** This financial year up to and including one payslip's date: pay, tax, PF and take-home. */
export async function sinceApril(orgId: string, employeeId: string, payrollDate: string) {
  const from = financialYearStart(payrollDate);
  const [slips, schemes] = await Promise.all([ownFinalSlips(orgId, employeeId, { from, to: payrollDate }), schemeComponents(orgId)]);
  const total = { from, payslips: slips.length, gross: 0, tax: 0, pf: 0, net: 0 };
  for (const s of slips) {
    const p = slipParts(s, schemes);
    total.gross += Number(s.grossEarnings) || 0;
    total.net += Number(s.netPay) || 0;
    total.tax += p.tax;
    total.pf += p.pfEmployee;
  }
  return { ...total, gross: round2(total.gross), tax: round2(total.tax), pf: round2(total.pf), net: round2(total.net) };
}

/**
 * PF put by in CLOR's payroll records: the employee's share, the company's
 * share to the fund, and the company's share to the pension. Only payslips
 * made here; PF from before CLOR, or the interest the fund adds, is not known.
 */
export async function pfSaved(orgId: string, employeeId: string) {
  const [slips, schemes] = await Promise.all([ownFinalSlips(orgId, employeeId), schemeComponents(orgId)]);
  let employee = 0;
  let employer = 0;
  let pension = 0;
  let counted = 0;
  let since: string | null = null;
  for (const s of slips) {
    const p = slipParts(s, schemes);
    if (!p.pfEmployee && !p.pfEmployer && !p.pension) continue;
    counted += 1;
    if (!since) since = s.payrollDate;
    employee += p.pfEmployee;
    employer += p.pfEmployer;
    pension += p.pension;
  }
  if (!counted) return null;
  return {
    since,
    payslips: counted,
    employee: round2(employee),
    employer: round2(employer),
    pension: round2(pension),
    /* The fund holds the two PF shares; the pension is a separate scheme paid out by its own rules. */
    fund: round2(employee + employer),
  };
}
