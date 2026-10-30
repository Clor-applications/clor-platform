import { payrollPrisma } from '../../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { round2 } from '../../../utils/money.js';
import { isFeatureEnabled } from '../../features.js';
import { isAppEntitled } from '../../subscriptions.js';
import { forLiveEmployee } from '../../payroll/employeeLock.js';
import { approveLoan } from '../../payroll/loan.js';
import { usersWithPermission } from '../../notifications.js';

/**
 * People's money hands over to Payroll through Payroll's own records, the way
 * leave encashment does (services/attendance/leaveEncashment.ts):
 *
 *  - a reimbursement or a recovery is a payroll adjustment, a DRAFT for the
 *    open month, keyed by what it came from (`expense-claim:<id>`,
 *    `advance-recover:<id>`), so a retry never adds it twice and Payroll still
 *    approves it before it reaches a payslip;
 *  - a salary advance is a Payroll loan of type SALARY_ADVANCE, created as a
 *    draft the way Payroll's own route does, and approved (the schedule
 *    written) only by someone who may approve Payroll loans.
 *
 * Nothing here edits a Payroll screen or rule. When Payroll cannot take it
 * (not on, no open month, no component to put it on) the answer says why in
 * plain words and the People record keeps waiting.
 */

export const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export async function payrollOn(accountId: string, orgId: string) {
  return (await isAppEntitled(accountId, 'payroll')) && (await isFeatureEnabled(accountId, orgId, 'payroll'));
}

/** The open month containing today, or else the next one to open. */
export async function periodToPayIn(orgId: string, today = todayIst()) {
  const open = { orgId, isLocked: false, status: 'OPEN' };
  return (await payrollPrisma.payrollPeriod.findFirst({ where: { ...open, startDate: { lte: today }, endDate: { gte: today } }, orderBy: { startDate: 'asc' }, select: { id: true, name: true } }))
    || payrollPrisma.payrollPeriod.findFirst({ where: { ...open, startDate: { gt: today } }, orderBy: { startDate: 'asc' }, select: { id: true, name: true } });
}

/** An active component of this type whose code or name carries one of the words, the first word preferred. */
async function componentFor(orgId: string, type: 'EARNING' | 'DEDUCTION', words: string[]) {
  for (const w of words) {
    const c = await payrollPrisma.salaryComponent.findFirst({
      where: { orgId, type, isActive: true, OR: [{ code: { contains: w, mode: 'insensitive' } }, { name: { contains: w, mode: 'insensitive' } }] },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    if (c) return c;
  }
  return null;
}

export type Handed = { sent: true; adjustmentId: string; periodName: string; amount: number } | { sent: false; why: string };

/**
 * A draft payroll adjustment for one person, keyed so it is made once. An
 * earning pays a reimbursement with salary; a deduction recovers an advance.
 */
export async function draftAdjustment(o: { accountId: string; orgId: string; userId: string; employeeId: string; key: string; type: 'EARNING' | 'DEDUCTION'; amount: number; reason: string }): Promise<Handed> {
  if (!(await payrollOn(o.accountId, o.orgId))) return { sent: false, why: 'This company does not run payroll in CLOR: pay it by hand and mark it paid now.' };
  const words = o.type === 'EARNING' ? ['REIMB'] : ['ADVANCE', 'RECOVER'];
  const [component, period, person] = await Promise.all([
    componentFor(o.orgId, o.type, words),
    periodToPayIn(o.orgId),
    peoplePrisma.employee.findFirst({ where: { orgId: o.orgId, id: o.employeeId }, select: { branchId: true } }),
  ]);
  if (!component) {
    return { sent: false, why: o.type === 'EARNING'
      ? 'Payroll has no reimbursement earning yet. Add one in Payroll → Salary components (an earning named "Reimbursement", not taxed), then pay again.'
      : 'Payroll has no advance recovery deduction yet. Add one in Payroll → Salary components (a deduction named "Advance recovery"), then try again.' };
  }
  if (!period) return { sent: false, why: 'Payroll has no open month to put it in. Open the next month in Payroll, then try again.' };
  const id = o.key;
  const made = await forLiveEmployee(o.orgId, o.employeeId, async (tx) => {
    const prior = await tx.payrollAdjustment.findUnique({ where: { id } });
    if (prior && prior.status !== 'CANCELLED') return prior;
    const data = { componentId: component.id, periodId: period.id, type: o.type, amount: round2(o.amount), reason: o.reason.slice(0, 240), reference: id, status: 'DRAFT', approvedAt: null, approvedByUserId: null, consumedByRunId: null };
    if (prior) return tx.payrollAdjustment.update({ where: { id }, data });
    return tx.payrollAdjustment.create({ data: { id, accountId: o.accountId, orgId: o.orgId, branchId: person?.branchId || null, employeeId: o.employeeId, createdByUserId: o.userId, ...data } });
  });
  return { sent: true, adjustmentId: made.id, periodName: period.name, amount: Number(made.amount) };
}

/**
 * What can come off this person's pay in a month: half their wages, less
 * the other deductions on their last final payslip and the loan instalments
 * they already repay (Code on Wages 2019 s.18; Payment of Wages Act s.7 before
 * it). Wages are that payslip's gross; with no payslip yet, the monthly pay
 * on their salary structure. Null when Payroll knows nothing of their pay.
 */
export async function payCap(orgId: string, employeeId: string) {
  const runs = await payrollPrisma.payrollRun.findMany({ where: { orgId, status: { in: ['APPROVED', 'LOCKED', 'PAID', 'POSTED'] } }, select: { id: true }, orderBy: { payrollDate: 'desc' }, take: 24 });
  const slip = runs.length
    ? await payrollPrisma.salarySlip.findFirst({ where: { orgId, employeeId, runId: { in: runs.map((r) => r.id) }, status: { not: 'CANCELLED' } }, orderBy: { payrollDate: 'desc' }, select: { id: true, number: true, grossEarnings: true, totalDeductions: true } })
    : null;
  let wages = 0;
  let other = 0;
  let basis = '';
  if (slip) {
    const recovered = await payrollPrisma.payrollLoanInstallment.findMany({ where: { orgId, slipId: slip.id, status: 'RECOVERED' }, select: { dueAmount: true } });
    wages = Number(slip.grossEarnings);
    other = Math.max(0, Number(slip.totalDeductions) - recovered.reduce((t, i) => t + Number(i.dueAmount), 0));
    basis = `payslip ${slip.number}`;
  } else {
    const today = todayIst();
    const a = await payrollPrisma.salaryAssignment.findFirst({ where: { orgId, employeeId, status: 'ACTIVE', effectiveFrom: { lte: today } }, orderBy: { effectiveFrom: 'desc' }, select: { monthlyCtc: true } });
    if (!a || !Number(a.monthlyCtc)) return null;
    wages = Number(a.monthlyCtc);
    basis = 'salary structure';
  }
  if (!(wages > 0)) return null;
  const loans = await payrollPrisma.payrollLoan.findMany({ where: { orgId, employeeId, status: 'ACTIVE' }, select: { installmentAmount: true, interestRate: true, outstandingBalance: true } });
  const loanInstalments = round2(loans.reduce((t, l) => t + Number(l.installmentAmount), 0));
  const interestFreeOwed = round2(loans.filter((l) => Number(l.interestRate) === 0).reduce((t, l) => t + Number(l.outstandingBalance), 0));
  const room = Math.max(0, round2(wages / 2 - other - loanInstalments));
  return { wages: round2(wages), otherDeductions: round2(other), loanInstalments, room, basis, interestFreeOwed };
}

/** Interest-free or cheap loans above this in total are a taxable perquisite (Income-tax Rules, rule 3(7)(i)); medical loans are exempt. */
export const PERQUISITE_LIMIT = 200_000;

export type LoanMade = { made: true; loanId: string; number: string; status: string } | { made: false; why: string };

/**
 * A salary advance as a Payroll loan: interest free, recovered from the open
 * month over `months` instalments. Drafted as Payroll's own route drafts one
 * (a race-safe number: a lock, then the next free one, again on a clash),
 * then approved when the person deciding may approve Payroll loans;
 * otherwise it waits in Payroll → Loans for someone who may.
 */
export async function makeSalaryAdvanceLoan(o: { accountId: string; orgId: string; userId: string; employeeId: string; amount: number; months: number; notes: string }): Promise<LoanMade> {
  if (!(await payrollOn(o.accountId, o.orgId))) return { made: false, why: 'This company does not run payroll in CLOR: pay the advance and take it back by hand.' };
  const [component, period, person] = await Promise.all([
    componentFor(o.orgId, 'DEDUCTION', ['ADVANCE', 'LOAN']),
    periodToPayIn(o.orgId),
    peoplePrisma.employee.findFirst({ where: { orgId: o.orgId, id: o.employeeId }, select: { branchId: true } }),
  ]);
  if (!component) return { made: false, why: 'Payroll has no deduction to recover it on. Add one in Payroll → Salary components (a deduction named "Salary advance"), then send it again.' };
  if (!period) return { made: false, why: 'Payroll has no open month to start recovery in. Open the next month in Payroll, then send it again.' };
  const today = todayIst();
  let loan: { id: string; number: string; status: string } | null = null;
  for (let attempt = 0; attempt < 4 && !loan; attempt += 1) {
    try {
      loan = await forLiveEmployee(o.orgId, o.employeeId, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll-loan-number:${o.orgId}`}))`;
        const year = today.slice(0, 4);
        let n = (await tx.payrollLoan.count({ where: { orgId: o.orgId } })) + 1 + attempt;
        let number = `LN-${year}-${String(n).padStart(4, '0')}`;
        while (await tx.payrollLoan.findFirst({ where: { orgId: o.orgId, number }, select: { id: true } })) {
          n += 1;
          number = `LN-${year}-${String(n).padStart(4, '0')}`;
        }
        return tx.payrollLoan.create({
          data: {
            accountId: o.accountId, orgId: o.orgId, branchId: person?.branchId || null, number, employeeId: o.employeeId, type: 'SALARY_ADVANCE',
            principal: round2(o.amount), interestRate: 0, startDate: today, recoveryStartPeriodId: period.id, installmentCount: o.months,
            recoveryComponentId: component.id, outstandingBalance: 0, status: 'DRAFT', notes: o.notes.slice(0, 500) || null, createdByUserId: o.userId,
          },
          select: { id: true, number: true, status: true },
        });
      });
    } catch (e: any) {
      /* Payroll's own route numbers without this lock: a clash on the number is taken again. */
      if (e?.code !== 'P2002') throw e;
    }
  }
  if (!loan) return { made: false, why: 'Payroll was busy numbering loans. Send it again.' };
  if ((await usersWithPermission(o.accountId, o.orgId, 'PAYROLL::Payroll Loans::APPROVE')).includes(o.userId)) {
    try {
      const approved = await approveLoan({ accountId: o.accountId, orgId: o.orgId, userId: o.userId, loanId: loan.id });
      return { made: true, loanId: loan.id, number: loan.number, status: approved.status };
    } catch (e) {
      /* The draft stands; Payroll approves it from its own list. */
      console.error('[people-money] salary advance loan left as a draft:', e instanceof Error ? e.message : e); // eslint-disable-line no-console
    }
  }
  return { made: true, loanId: loan.id, number: loan.number, status: loan.status };
}

/** A loan's state for the screens: what is left to repay and the next instalment. */
export async function loanState(orgId: string, loanId: string) {
  const l = await payrollPrisma.payrollLoan.findFirst({ where: { orgId, id: loanId }, select: { id: true, number: true, status: true, principal: true, installmentAmount: true, installmentCount: true, outstandingBalance: true } });
  if (!l) return null;
  return { id: l.id, number: l.number, status: l.status, principal: Number(l.principal), instalment: Number(l.installmentAmount), instalments: l.installmentCount, outstanding: Number(l.outstandingBalance) };
}
