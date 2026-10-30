import type { Request } from 'express';

import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { round2 } from '../../utils/money.js';
import { authorize } from '../../middleware/rbac.js';
import { PermissionAction } from '../../constants/enums.js';
import { isFeatureEnabled } from '../features.js';
import { isAppEntitled } from '../subscriptions.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE } from '../payroll/guards.js';
import { forLiveEmployee } from '../payroll/employeeLock.js';
import { today as todayIst } from './days.js';

/**
 * Leave paid out, valued and handed to Payroll (time depth, gap 19).
 *
 * The leave policy says what a paid-out day is worth: a month's basic and
 * dearness allowance (the gratuity wage), or gross wages, divided by 26 or 30.
 * The month is the last approved payslip's, at full rate (a month cut short
 * by leave is not the rate) — the same reading the full and final settlement
 * uses (services/payroll/finalSettlement.ts).
 *
 * Payroll's contract is its adjustment: a draft earning for the open month of
 * today (or the next), keyed `leave-encash:<id>` so the leave debit and the
 * payslip line stay linked both ways, and approved in Payroll like any other
 * (money added to a payslip with nobody else looking at it is the easiest
 * payroll fraud there is). Only someone who may add payroll adjustments sends
 * it; otherwise it waits in Payroll's list with the amount worked out.
 */

/**
 * BASIC_DA: the wage gratuity is worked on — components marked "counts for
 * gratuity" in Payroll (basic and dearness allowance), the same rule as the
 * full and final settlement. GROSS: the fixed components of the person's
 * salary structure only; a bonus, an arrear or an earlier encashment on the
 * slip is not a month's wage. (BASIC alone is read as BASIC_DA: Payroll
 * marks no component as basic by itself, and a name is no rule.)
 */
export type EncashBase = 'BASIC_DA' | 'GROSS';
export const BASE_WORDS: Record<EncashBase, string> = { BASIC_DA: 'basic and DA', GROSS: 'gross wages' };
const baseOf = (b: unknown): EncashBase => (b === 'GROSS' ? 'GROSS' : 'BASIC_DA');

/** One month's wages on the policy's base, from the person's last approved payslip, at the full month's rate. */
export async function monthlyWagesOn(orgId: string, employeeId: string, base: EncashBase) {
  const runs = await payrollPrisma.payrollRun.findMany({ where: { orgId, status: { in: ['APPROVED', 'LOCKED', 'PAID', 'POSTED'] } }, select: { id: true }, orderBy: { payrollDate: 'desc' }, take: 60 });
  if (!runs.length) return { wage: null as number | null, slip: null as string | null };
  const slip = await payrollPrisma.salarySlip.findFirst({ where: { orgId, employeeId, runId: { in: runs.map((r) => r.id) } }, orderBy: { createdAt: 'desc' }, select: { id: true, number: true, payrollDate: true } });
  if (!slip) return { wage: null, slip: null };
  const lines = await payrollPrisma.salarySlipLine.findMany({ where: { slipId: slip.id, type: 'EARNING' }, select: { componentId: true, amount: true, fullAmount: true } });
  let counted: Set<string>;
  if (base === 'BASIC_DA') {
    counted = new Set((await payrollPrisma.salaryComponent.findMany({ where: { orgId, id: { in: lines.map((l) => l.componentId) }, includeInGratuityWage: true }, select: { id: true } })).map((c) => c.id));
  } else {
    /* The structure the person was on that month, and its components that are not variable pay. */
    const assignment = await payrollPrisma.salaryAssignment.findFirst({
      where: { orgId, employeeId, status: { in: ['ACTIVE', 'SUPERSEDED'] }, effectiveFrom: { lte: slip.payrollDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: slip.payrollDate } }] },
      orderBy: { effectiveFrom: 'desc' },
      select: { structureId: true },
    });
    const onStructure = assignment ? (await payrollPrisma.salaryStructureComponent.findMany({ where: { orgId, structureId: assignment.structureId }, select: { componentId: true } })).map((c) => c.componentId) : [];
    counted = new Set((await payrollPrisma.salaryComponent.findMany({ where: { orgId, id: { in: onStructure }, isVariable: false }, select: { id: true } })).map((c) => c.id));
  }
  return { wage: round2(lines.filter((l) => counted.has(l.componentId)).reduce((t, l) => t + Number(l.fullAmount ?? l.amount), 0)), slip: slip.number };
}

/** What `days` paid out are worth for this person under this type's policy, and how that was worked out. */
export async function encashmentValue(orgId: string, employeeId: string, type: { encashBase?: string | null; encashDivisor?: number | null }, days: number) {
  const base = baseOf(type.encashBase);
  const divisor = type.encashDivisor === 30 ? 30 : 26;
  const { wage, slip } = await monthlyWagesOn(orgId, employeeId, base);
  if (wage == null || !slip) return { amount: null, base, divisor, rate: null, explanation: `No approved payslip yet, so the amount is ${days} days × a day's ${BASE_WORDS[base]} (a month ÷ ${divisor}); Payroll enters it.` };
  if (!wage) return { amount: null, base, divisor, rate: null, explanation: `Payslip ${slip} has no ${BASE_WORDS[base]} line, so Payroll enters the amount.` };
  /* Rounded once, on the total: rounding the day's rate first drifts by paise per day. */
  const rate = round2(wage / divisor);
  return { amount: round2((wage * days) / divisor), base, divisor, rate, explanation: `${days} days × ${BASE_WORDS[base]} ₹${wage.toLocaleString('en-IN')} ÷ ${divisor} (about ₹${rate.toLocaleString('en-IN')} a day; payslip ${slip}).` };
}

/** amount and explanation are a person's pay: present only for a reader who may see payroll adjustments. */
type Sent = { amount: number | null; explanation: string | null; sent: boolean; why?: string; periodName?: string; adjustmentId?: string };

/** The open month containing today, or else the next one to open: never a stale month left open behind. */
async function periodToPayIn(orgId: string, today: string) {
  const open = { orgId, isLocked: false, status: 'OPEN' };
  return (await payrollPrisma.payrollPeriod.findFirst({ where: { ...open, startDate: { lte: today }, endDate: { gte: today } }, orderBy: { startDate: 'asc' }, select: { id: true, name: true } }))
    || payrollPrisma.payrollPeriod.findFirst({ where: { ...open, startDate: { gt: today } }, orderBy: { startDate: 'asc' }, select: { id: true, name: true } });
}

/**
 * Hand one encashment (a LeaveAdjustment of kind ENCASH) to Payroll as a draft
 * earning. Never throws for a reason Payroll gives: the leave debit is already
 * recorded, and what did not reach Payroll stays in its list to pick up.
 * Someone who may change leave but not see payroll adjustments is told only
 * that Payroll takes it from here, never what the person earns.
 */
export async function sendEncashmentToPayroll(req: Request, row: { id: string; employeeId: string; days: number; leaveTypeId: string }, type: { name: string; encashBase?: string | null; encashDivisor?: number | null }): Promise<Sent> {
  const { accountId, orgId } = req.tenant!;
  const days = Math.abs(row.days);
  if (!(await isAppEntitled(accountId, 'payroll')) || !(await isFeatureEnabled(accountId, orgId, 'payroll'))) return { amount: null, explanation: null, sent: false, why: 'This company does not run payroll in CLOR: pay the days out by hand.' };
  const [reads, creates] = await Promise.all([
    authorize(req, PAYROLL_MODULE, PermissionAction.VIEW as any, PAYROLL_RESOURCE.adjustments).then((r) => !r),
    authorize(req, PAYROLL_MODULE, PermissionAction.CREATE as any, PAYROLL_RESOURCE.adjustments).then((r) => !r),
  ]);
  if (!reads) return { amount: null, explanation: null, sent: false, why: 'Payroll values the days and adds them to a payslip.' };
  const value = await encashmentValue(orgId, row.employeeId, type, days);
  const stay = (why: string): Sent => ({ amount: value.amount, explanation: value.explanation, sent: false, why });
  if (!creates) return stay('Payroll adds it: you may not add payroll adjustments.');
  if (value.amount == null || value.amount <= 0) return stay('Payroll enters the amount.');
  const [component, period, person] = await Promise.all([
    payrollPrisma.salaryComponent.findFirst({ where: { orgId, type: 'EARNING', isActive: true, OR: [{ code: { contains: 'ENCASH', mode: 'insensitive' } }, { name: { contains: 'encash', mode: 'insensitive' } }] }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
    periodToPayIn(orgId, todayIst()),
    peoplePrisma.employee.findFirst({ where: { orgId, id: row.employeeId }, select: { branchId: true } }),
  ]);
  if (!component) return stay('Payroll has no leave encashment earning yet; add one in Payroll → Salary components.');
  if (!period) return stay('Payroll has no open month to pay it in.');
  const id = `leave-encash:${row.id}`;
  try {
    const made = await forLiveEmployee(orgId, row.employeeId, async (tx) => {
      const prior = await tx.payrollAdjustment.findUnique({ where: { id } });
      if (prior && prior.status !== 'CANCELLED') return prior;
      const data = { componentId: component.id, periodId: period.id, type: 'EARNING', amount: value.amount!, reason: `${type.name} paid out: ${days} days`.slice(0, 240), reference: id, status: 'DRAFT', approvedAt: null, approvedByUserId: null, consumedByRunId: null };
      if (prior) return tx.payrollAdjustment.update({ where: { id }, data });
      /* The person's own branch: Payroll's lists by branch find it where the person is. */
      return tx.payrollAdjustment.create({ data: { id, accountId, orgId, branchId: person?.branchId || null, employeeId: row.employeeId, createdByUserId: req.auth!.userId, ...data } });
    });
    return { amount: Number(made.amount), explanation: value.explanation, sent: true, periodName: period.name, adjustmentId: made.id };
  } catch (e) {
    console.error('[leave] encashment not sent to payroll:', e instanceof Error ? e.message : e); // eslint-disable-line no-console
    return stay('It could not reach Payroll just now; it waits in Payroll → Adjustments.');
  }
}

/** For Payroll's list of encashments still waiting for an earning: each one's amount, worked out the same way. */
export async function valueEncashments(orgId: string, rows: Array<{ id: string; employeeId: string; leaveTypeId: string; days: number }>) {
  const types = new Map((await peoplePrisma.leaveType.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.leaveTypeId))] } }, select: { id: true, name: true, encashBase: true, encashDivisor: true } })).map((t) => [t.id, t]));
  const out = new Map<string, { amount: number | null; explanation: string | null; leaveType: string | null }>();
  for (const r of rows) {
    const t = types.get(r.leaveTypeId);
    const v = await encashmentValue(orgId, r.employeeId, t || {}, Math.abs(r.days));
    out.set(r.id, { amount: v.amount, explanation: v.explanation, leaveType: t?.name || null });
  }
  return out;
}
