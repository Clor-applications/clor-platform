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

/**
 * Leave paid out, valued and handed to Payroll (time depth, gap 19).
 *
 * The leave policy says what a paid-out day is worth: a month's basic, basic
 * and dearness allowance, or gross wages, divided by 26 working days or 30.
 * The month is the last approved payslip's, at full rate (a month cut short
 * by leave is not the rate) — the same reading the full and final settlement
 * uses (services/payroll/finalSettlement.ts).
 *
 * Payroll's contract is its adjustment: a draft earning for the next open
 * period, keyed `leave-encash:<adjustment id>` so the leave debit and the
 * payslip line stay linked both ways, and approved in Payroll like any other
 * (money added to a payslip with nobody else looking at it is the easiest
 * payroll fraud there is). Only someone who may add payroll adjustments sends
 * it; otherwise it waits in Payroll's list with the amount worked out.
 */

export type EncashBase = 'BASIC' | 'BASIC_DA' | 'GROSS';
export const BASE_WORDS: Record<EncashBase, string> = { BASIC: 'basic', BASIC_DA: 'basic and DA', GROSS: 'gross wages' };

const isBasic = (c: { code: string; name: string }) => /^basic$/i.test(c.code.trim()) || /^basic( pay| salary)?$/i.test(c.name.trim());
const isDa = (c: { code: string; name: string }) => /^da$/i.test(c.code.trim()) || /dearness/i.test(c.name);

/** One month's wages on the policy's base, from the person's last approved payslip. */
export async function monthlyWagesOn(orgId: string, employeeId: string, base: EncashBase) {
  const runs = await payrollPrisma.payrollRun.findMany({ where: { orgId, status: { in: ['APPROVED', 'LOCKED', 'PAID', 'POSTED'] } }, select: { id: true }, orderBy: { payrollDate: 'desc' }, take: 60 });
  if (!runs.length) return { wage: null as number | null, slip: null as string | null };
  const slip = await payrollPrisma.salarySlip.findFirst({ where: { orgId, employeeId, runId: { in: runs.map((r) => r.id) } }, orderBy: { createdAt: 'desc' }, select: { id: true, number: true } });
  if (!slip) return { wage: null, slip: null };
  const lines = await payrollPrisma.salarySlipLine.findMany({ where: { slipId: slip.id, type: 'EARNING' }, select: { componentId: true, amount: true, fullAmount: true } });
  const comps = new Map((await payrollPrisma.salaryComponent.findMany({ where: { orgId, id: { in: lines.map((l) => l.componentId) } }, select: { id: true, code: true, name: true } })).map((c) => [c.id, c]));
  const counted = lines.filter((l) => {
    if (base === 'GROSS') return true;
    const c = comps.get(l.componentId);
    return Boolean(c && (isBasic(c) || (base === 'BASIC_DA' && isDa(c))));
  });
  return { wage: round2(counted.reduce((t, l) => t + Number(l.fullAmount ?? l.amount), 0)), slip: slip.number };
}

/** What `days` paid out are worth for this person under this type's policy, and how that was worked out. */
export async function encashmentValue(orgId: string, employeeId: string, type: { encashBase?: string | null; encashDivisor?: number | null }, days: number) {
  const base = (['BASIC', 'BASIC_DA', 'GROSS'].includes(String(type.encashBase)) ? type.encashBase : 'BASIC_DA') as EncashBase;
  const divisor = type.encashDivisor === 30 ? 30 : 26;
  const { wage, slip } = await monthlyWagesOn(orgId, employeeId, base);
  if (wage == null || !slip) return { amount: null, base, divisor, rate: null, explanation: `No approved payslip yet, so the amount is ${days} days × a day's ${BASE_WORDS[base]} (a month ÷ ${divisor}); Payroll enters it.` };
  if (!wage) return { amount: null, base, divisor, rate: null, explanation: `Payslip ${slip} has no ${BASE_WORDS[base]} line, so Payroll enters the amount.` };
  const rate = round2(wage / divisor);
  return { amount: round2(rate * days), base, divisor, rate, explanation: `${days} days × ₹${rate.toLocaleString('en-IN')} a day (${BASE_WORDS[base]} ₹${wage.toLocaleString('en-IN')} on payslip ${slip}, ÷ ${divisor}).` };
}

type Sent = { amount: number | null; explanation: string; sent: boolean; why?: string; periodName?: string; adjustmentId?: string };

/**
 * Hand one encashment (a LeaveAdjustment of kind ENCASH) to Payroll as a draft
 * earning. Never throws for a reason Payroll gives: the leave debit is already
 * recorded, and what did not reach Payroll stays in its list to pick up.
 */
export async function sendEncashmentToPayroll(req: Request, row: { id: string; employeeId: string; days: number; leaveTypeId: string }, type: { name: string; encashBase?: string | null; encashDivisor?: number | null }): Promise<Sent> {
  const { accountId, orgId, branchId } = req.tenant!;
  const days = Math.abs(row.days);
  const value = await encashmentValue(orgId, row.employeeId, type, days);
  const stay = (why: string): Sent => ({ amount: value.amount, explanation: value.explanation, sent: false, why });
  if (!(await isAppEntitled(accountId, 'payroll')) || !(await isFeatureEnabled(accountId, orgId, 'payroll'))) return stay('This company does not run payroll in CLOR.');
  if (await authorize(req, PAYROLL_MODULE, PermissionAction.CREATE as any, PAYROLL_RESOURCE.adjustments)) return stay('Payroll adds it: you may not add payroll adjustments.');
  if (value.amount == null || value.amount <= 0) return stay('Payroll enters the amount.');
  const [component, period] = await Promise.all([
    payrollPrisma.salaryComponent.findFirst({ where: { orgId, type: 'EARNING', isActive: true, OR: [{ code: { contains: 'ENCASH', mode: 'insensitive' } }, { name: { contains: 'encash', mode: 'insensitive' } }] }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
    payrollPrisma.payrollPeriod.findFirst({ where: { orgId, isLocked: false, status: 'OPEN' }, orderBy: { startDate: 'asc' }, select: { id: true, name: true } }),
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
      return tx.payrollAdjustment.create({ data: { id, accountId, orgId, branchId: branchId || null, employeeId: row.employeeId, createdByUserId: req.auth!.userId, ...data } });
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
  const out = new Map<string, { amount: number | null; explanation: string; leaveType: string | null }>();
  for (const r of rows) {
    const t = types.get(r.leaveTypeId);
    const v = await encashmentValue(orgId, r.employeeId, t || {}, Math.abs(r.days));
    out.set(r.id, { amount: v.amount, explanation: v.explanation, leaveType: t?.name || null });
  }
  return out;
}
