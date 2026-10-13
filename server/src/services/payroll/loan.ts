import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { round2 } from '../../utils/money.js';

/**
 * Money lent to somebody, and taken back out of their pay.
 *
 * A loan is a schedule, not a balance. The schedule is written once when the
 * loan is approved and then lived in: each payroll recovers the installment
 * that falls in its period, marks it recovered, and says which payslip did it.
 * Keeping a schedule rather than a running total is what lets somebody answer
 * "when does this finish" and "which month was missed" without arithmetic.
 *
 * ## Two rules the arithmetic obeys
 *
 * **Nobody pays the company to work.** A recovery is capped at what is left
 * after everything else has come off. Somebody on unpaid leave for most of a
 * month takes home less than their installment, and taking the whole
 * installment would hand them a negative payslip. What is not recovered stays
 * owed and moves on.
 *
 * **The schedule adds up exactly.** Installments are rounded to the rupee and
 * the last one absorbs the difference, so the sum of the schedule is the amount
 * lent (plus interest) to the paise — never a few rupees adrift that nobody can
 * account for at the end.
 */


export class PayrollLoanError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = 'PayrollLoanError';
    this.code = code;
    this.status = status;
  }
}

export type ScheduleRow = { sequence: number; dueAmount: number; principalAmount: number; interestAmount: number };

/**
 * The repayment schedule for a loan.
 *
 * Flat interest on the whole principal over the term — the common shape for a
 * staff loan, and the one somebody can check in their head. A reducing-balance
 * loan is a different product and would need its own method rather than a
 * different constant here.
 */
export function buildSchedule(opts: { principal: number; annualInterestRate: number; installmentCount: number }): ScheduleRow[] {
  const principal = round2(opts.principal);
  const count = Math.floor(opts.installmentCount);

  if (!(principal > 0)) throw new PayrollLoanError('NO_PRINCIPAL', 'A loan of nothing has nothing to recover.', 400);
  if (!(count > 0)) throw new PayrollLoanError('NO_INSTALMENTS', 'Say how many instalments this is recovered over.', 400);

  const years = count / 12;
  const interest = round2((principal * (Number(opts.annualInterestRate) || 0) * years) / 100);

  const rows: ScheduleRow[] = [];
  /* Rounded down per instalment so the remainder lands on the last one, rather
     than rounding up and asking for more than was lent. */
  const perPrincipal = Math.floor((principal / count) * 100) / 100;
  const perInterest = Math.floor((interest / count) * 100) / 100;

  for (let i = 1; i <= count; i += 1) {
    const last = i === count;
    const p = last ? round2(principal - perPrincipal * (count - 1)) : perPrincipal;
    const n = last ? round2(interest - perInterest * (count - 1)) : perInterest;
    rows.push({ sequence: i, principalAmount: p, interestAmount: n, dueAmount: round2(p + n) });
  }

  return rows;
}

/**
 * The periods a schedule falls in, from the one recovery starts in.
 *
 * Periods are looked up rather than dates computed, because a company's payroll
 * calendar is its own: a schedule that assumed calendar months would drift for
 * anybody on a weekly or fortnightly cycle.
 */
async function periodsFrom(orgId: string, startPeriodId: string, count: number) {
  const start = await payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: startPeriodId } });
  if (!start) throw new PayrollLoanError('NO_PERIOD', 'No such payroll period.', 404);

  const rows = await payrollPrisma.payrollPeriod.findMany({
    where: { orgId, startDate: { gte: start.startDate } },
    orderBy: { startDate: 'asc' },
    take: count,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Write the schedule and set the loan running.
 *
 * Done at approval rather than at creation: a loan somebody has asked for and
 * nobody has agreed to should not be sitting in next month's payroll waiting to
 * come out of their pay.
 */
export async function approveLoan(opts: { accountId: string; orgId: string; userId: string; loanId: string }) {
  const loan = await payrollPrisma.payrollLoan.findFirst({
    where: { accountId: opts.accountId, orgId: opts.orgId, id: opts.loanId },
    include: { installments: true },
  });
  if (!loan) throw new PayrollLoanError('NO_LOAN', 'No such loan.', 404);
  if (loan.status === 'CANCELLED') throw new PayrollLoanError('LOAN_CANCELLED', 'This loan was cancelled.');
  if (['ACTIVE', 'COMPLETED'].includes(loan.status)) {
    return loan;
  }
  if (!loan.recoveryComponentId) {
    throw new PayrollLoanError(
      'NO_RECOVERY_COMPONENT',
      'Say which deduction this appears as on a payslip, or the recovery has nowhere to show.'
    );
  }

  const schedule = buildSchedule({
    principal: Number(loan.principal),
    annualInterestRate: Number(loan.interestRate),
    installmentCount: loan.installmentCount,
  });

  const periodIds = loan.recoveryStartPeriodId ? await periodsFrom(opts.orgId, loan.recoveryStartPeriodId, schedule.length) : [];

  return payrollPrisma.$transaction(async (tx) => {
    await tx.payrollLoanInstallment.deleteMany({ where: { loanId: loan.id } });
    await tx.payrollLoanInstallment.createMany({
      data: schedule.map((row, i) => ({
        accountId: opts.accountId,
        orgId: opts.orgId,
        loanId: loan.id,
        /*
         * A schedule can outrun the calendar — a 24-month loan against a
         * calendar with 6 months in it. The instalments beyond it are written
         * with no period and picked up as periods are added, rather than the
         * loan being refused for a calendar somebody has not filled in yet.
         */
        periodId: periodIds[i] || null,
        sequence: row.sequence,
        dueAmount: row.dueAmount,
        principalAmount: row.principalAmount,
        interestAmount: row.interestAmount,
        status: 'PENDING',
      })),
    });

    return tx.payrollLoan.update({
      where: { id: loan.id },
      data: {
        status: 'ACTIVE',
        installmentAmount: schedule[0]?.dueAmount ?? 0,
        outstandingBalance: round2(schedule.reduce((t, r) => t + r.dueAmount, 0)),
        approvedByUserId: opts.userId,
        approvedAt: new Date(),
      },
      include: { installments: { orderBy: { sequence: 'asc' } } },
    });
  });
}

export type DueRecovery = {
  loanId: string;
  installmentId: string;
  employeeId: string;
  componentId: string;
  dueAmount: number;
};

/** Every loan instalment falling due in this period, for the people in the run. */
export async function recoveriesDue(orgId: string, periodId: string, employeeIds: string[]): Promise<DueRecovery[]> {
  if (!employeeIds.length) return [];

  const loans = await payrollPrisma.payrollLoan.findMany({
    where: { orgId, employeeId: { in: employeeIds }, status: 'ACTIVE' },
    include: { installments: { where: { periodId, status: { in: ['PENDING', 'RECOVERED'] } } } },
  });

  const due: DueRecovery[] = [];
  for (const loan of loans) {
    if (!loan.recoveryComponentId) continue;
    for (const installment of loan.installments) {
      due.push({
        loanId: loan.id,
        installmentId: installment.id,
        employeeId: loan.employeeId,
        componentId: loan.recoveryComponentId,
        dueAmount: Number(installment.dueAmount) || 0,
      });
    }
  }
  return due;
}

/**
 * How much of an instalment this payslip can actually take.
 *
 * Capped at what is left, because a recovery that drives net pay below zero
 * hands somebody a payslip saying they owe the company for having worked. The
 * shortfall is not written off — the instalment stays owed and is taken next
 * month.
 */
export function recoverable(dueAmount: number, netPayBefore: number) {
  if (dueAmount <= 0) return 0;
  if (netPayBefore <= 0) return 0;
  return round2(Math.min(dueAmount, netPayBefore));
}

/**
 * What a loan looks like now: what has been taken, what is left, what is next.
 *
 * Derived from the schedule rather than a stored counter, so it cannot drift
 * away from the instalments it is meant to summarise.
 */
export function summarise(loan: { principal: any; interestRate: any }, installments: { dueAmount: any; status: string; periodId: string | null }[]) {
  const total = round2(installments.reduce((t, i) => t + Number(i.dueAmount), 0));
  const recovered = round2(installments.filter((i) => i.status === 'RECOVERED').reduce((t, i) => t + Number(i.dueAmount), 0));
  const waived = round2(installments.filter((i) => i.status === 'WAIVED').reduce((t, i) => t + Number(i.dueAmount), 0));
  return {
    total,
    recovered,
    waived,
    outstanding: round2(total - recovered - waived),
    installmentsLeft: installments.filter((i) => i.status === 'PENDING').length,
  };
}
