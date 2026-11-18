import { payrollPrisma } from '../../utils/payrollPrisma.js';

/**
 * An employee asking, from the employee app, to skip one loan or salary
 * advance instalment (picks round 54). Asking changes nothing on its own:
 * the instalment stays due until HR skips it on Payroll › Loans (it is still
 * owed and moves out of the way) or declines, which clears the ask.
 */

export class SkipAskError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

type Who = { orgId: string; employeeId: string; userId?: string | null };

/** The next instalment of a loan still to be taken: the lowest sequence pending in a month not yet closed. */
async function nextInstalment(orgId: string, loanId: string) {
  const rows = await payrollPrisma.payrollLoanInstallment.findMany({
    where: { orgId, loanId, status: 'PENDING', periodId: { not: null } },
    orderBy: { sequence: 'asc' },
    take: 6,
  });
  if (!rows.length) return null;
  const periods = await payrollPrisma.payrollPeriod.findMany({ where: { orgId, id: { in: rows.map((r) => r.periodId!) } }, select: { id: true, name: true, isLocked: true } });
  const byId = new Map(periods.map((p) => [p.id, p]));
  const row = rows.find((r) => !byId.get(r.periodId!)?.isLocked);
  return row ? { row, period: byId.get(row.periodId!)! } : null;
}

/** For the employee app: each active loan's next instalment, and whether a skip was asked. */
export async function nextInstalments(orgId: string, loanIds: string[]) {
  const out = new Map<string, { id: string; amount: number; period: string; skipAsked: boolean; skipAskedAt: Date | null }>();
  for (const loanId of loanIds) {
    const next = await nextInstalment(orgId, loanId);
    if (next) out.set(loanId, { id: next.row.id, amount: Number(next.row.dueAmount), period: next.period.name, skipAsked: Boolean(next.row.skipAskedAt), skipAskedAt: next.row.skipAskedAt });
  }
  return out;
}

/** Ask to skip one of my own instalments: only the next one, once, with a reason. */
export async function askSkip(who: Who, installmentId: string, reasonIn: unknown) {
  const reason = String(reasonIn ?? '').trim().slice(0, 300);
  if (reason.length < 3) throw new SkipAskError(400, 'Say why you want to skip this month.', 'REASON_NEEDED');
  const inst = await payrollPrisma.payrollLoanInstallment.findFirst({ where: { orgId: who.orgId, id: installmentId } });
  const loan = inst ? await payrollPrisma.payrollLoan.findFirst({ where: { orgId: who.orgId, id: inst.loanId }, select: { id: true, employeeId: true, status: true } }) : null;
  /* Somebody else's instalment reads as not there. */
  if (!inst || !loan || loan.employeeId !== who.employeeId) throw new SkipAskError(404, 'No such instalment.');
  if (loan.status !== 'ACTIVE') throw new SkipAskError(409, 'This loan is not being repaid now.', 'LOAN_NOT_ACTIVE');
  const next = await nextInstalment(who.orgId, loan.id);
  if (!next || next.row.id !== inst.id) throw new SkipAskError(409, 'Only the next instalment can be skipped.', 'NOT_NEXT');
  if (inst.skipAskedAt) throw new SkipAskError(409, 'You have already asked to skip this one. HR decides.', 'ALREADY_ASKED');
  const moved = await payrollPrisma.payrollLoanInstallment.updateMany({
    where: { id: inst.id, status: 'PENDING', skipAskedAt: null },
    data: { skipAskedAt: new Date(), skipAskedReason: reason, skipAskedByUserId: who.userId ?? null },
  });
  if (!moved.count) throw new SkipAskError(409, 'This instalment has just changed. Reload.', 'CHANGED');
  return { id: inst.id, skipAsked: true, period: next.period.name };
}

/** HR declines an ask: the instalment stays due as it was. */
export async function declineSkip(orgId: string, installmentId: string) {
  const moved = await payrollPrisma.payrollLoanInstallment.updateMany({
    where: { orgId, id: installmentId, skipAskedAt: { not: null } },
    data: { skipAskedAt: null, skipAskedReason: null, skipAskedByUserId: null },
  });
  if (!moved.count) throw new SkipAskError(404, 'No ask to skip on this instalment.');
}
