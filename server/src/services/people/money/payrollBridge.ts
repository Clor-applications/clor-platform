import { payrollPrisma } from '../../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { round2 } from '../../../utils/money.js';
import { isFeatureEnabled } from '../../features.js';
import { isAppEntitled } from '../../subscriptions.js';
import { forLiveEmployee } from '../../payroll/employeeLock.js';
import { approveLoan } from '../../payroll/loan.js';
import { usersWithPermission } from '../../notifications.js';
import { todayIst } from '../../../utils/istDate.js';
export { todayIst };

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


export async function payrollOn(accountId: string, orgId: string) {
  return (await isAppEntitled(accountId, 'payroll')) && (await isFeatureEnabled(accountId, orgId, 'payroll'));
}

/** The open month containing today, or else the next one to open. */
export async function periodToPayIn(orgId: string, today = todayIst(), employeeId?: string) {
  /*
   * The month in progress, else the next. Never one whose payroll is already
   * approved or paid: nothing would take what is sent there, and the money
   * would wait, unseen, in a closed month (QA of #82, F5).
   */
  /* Only the person's own payroll counts: a run for the company as a whole, or for their pay group, not another group's (re-review of #82). */
  const group = employeeId ? (await payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId, employeeId }, select: { payGroupId: true } }))?.payGroupId ?? null : null;
  const done = await payrollPrisma.payrollRun.findMany({ where: { orgId, status: { in: ['APPROVED', 'LOCKED', 'PAID', 'POSTED'] }, OR: [{ payGroupId: null }, ...(group ? [{ payGroupId: group }] : [])] }, select: { periodId: true } });
  const open = { orgId, isLocked: false, status: 'OPEN', id: { notIn: [...new Set(done.map((r) => r.periodId))] } };
  return (await payrollPrisma.payrollPeriod.findFirst({ where: { ...open, startDate: { lte: today }, endDate: { gte: today } }, orderBy: { startDate: 'asc' }, select: { id: true, name: true } }))
    || payrollPrisma.payrollPeriod.findFirst({ where: { ...open, startDate: { gt: today } }, orderBy: { startDate: 'asc' }, select: { id: true, name: true } });
}

/**
 * The component to put it on: an active one of this type whose code is
 * exactly one of the codes, else whose code or name carries one of the words,
 * in that order of preference.
 */
async function componentFor(orgId: string, type: 'EARNING' | 'DEDUCTION', codes: string[], words: string[]) {
  const select = { id: true, name: true, isTaxable: true };
  for (const code of codes) {
    const c = await payrollPrisma.salaryComponent.findFirst({ where: { orgId, type, isActive: true, code: { equals: code, mode: 'insensitive' } }, orderBy: { createdAt: 'asc' }, select });
    if (c) return c;
  }
  for (const w of words) {
    const c = await payrollPrisma.salaryComponent.findFirst({
      where: { orgId, type, isActive: true, OR: [{ code: { contains: w, mode: 'insensitive' } }, { name: { contains: w, mode: 'insensitive' } }] },
      orderBy: { createdAt: 'asc' },
      select,
    });
    if (c) return c;
  }
  return null;
}

/** The reimbursement earning a claim paid with salary goes on (code REIMB first), and whether Payroll taxes it. */
export async function reimbursementComponent(orgId: string) {
  return componentFor(orgId, 'EARNING', ['REIMB', 'REIMBURSEMENT'], ['REIMB']);
}

export type Handed = { sent: true; adjustmentId: string; periodId: string; periodName: string; amount: number } | { sent: false; why: string };

/** Where a keyed payroll adjustment stands: DRAFT | APPROVED | CONSUMED | CANCELLED, or GONE when it was deleted in Payroll. */
export async function adjustmentState(orgId: string, id: string) {
  const a = await payrollPrisma.payrollAdjustment.findFirst({ where: { orgId, id }, select: { status: true, amount: true } });
  return a ? { status: a.status, amount: Number(a.amount) } : { status: 'GONE', amount: 0 };
}

/**
 * A draft payroll adjustment for one person, keyed so it is made once. An
 * earning pays a reimbursement with salary; a deduction recovers an advance.
 * A key ending in `:<period>` gets the open month's id in its place, so one
 * key is one month's line and a retry finds it.
 */
export async function draftAdjustment(o: { accountId: string; orgId: string; userId: string; employeeId: string; key: string; type: 'EARNING' | 'DEDUCTION'; amount: number; reason: string; recoveryBase?: number }): Promise<Handed> {
  if (!(await payrollOn(o.accountId, o.orgId))) return { sent: false, why: 'This company does not run payroll in CLOR: pay it by hand and mark it paid now.' };
  const [component, period, person] = await Promise.all([
    o.type === 'EARNING' ? reimbursementComponent(o.orgId) : componentFor(o.orgId, 'DEDUCTION', ['ADVREC', 'ADVANCE'], ['ADVANCE', 'RECOVER']),
    periodToPayIn(o.orgId, undefined, o.employeeId),
    peoplePrisma.employee.findFirst({ where: { orgId: o.orgId, id: o.employeeId }, select: { branchId: true } }),
  ]);
  if (!component) {
    return { sent: false, why: o.type === 'EARNING'
      ? 'Payroll has no reimbursement earning yet. Add one in Payroll → Salary components (an earning with the code REIMB, not taxed), then pay again.'
      : 'Payroll has no advance recovery deduction yet. Add one in Payroll → Salary components (a deduction named "Advance recovery"), then try again.' };
  }
  if (!period) return { sent: false, why: 'Payroll has no open month to put it in. Open the next month in Payroll, then try again.' };
  const id = o.key.replace(/:<period>$/, `:${period.id}`);
  const made = await forLiveEmployee(o.orgId, o.employeeId, async (tx) => {
    const prior = await tx.payrollAdjustment.findUnique({ where: { id } });
    if (prior && prior.status !== 'CANCELLED') return prior;
    /* A recovery records what the advance had already recovered (recoveryChain.ts), so People's figures come from the rows alone. */
    const data = { componentId: component.id, periodId: period.id, type: o.type, amount: round2(o.amount), reason: o.reason.slice(0, 240), reference: id, status: 'DRAFT', approvedAt: null, approvedByUserId: null, consumedByRunId: null, ...(o.recoveryBase !== undefined ? { recoveryBase: round2(o.recoveryBase) } : {}) };
    if (prior) return tx.payrollAdjustment.update({ where: { id }, data });
    return tx.payrollAdjustment.create({ data: { id, accountId: o.accountId, orgId: o.orgId, branchId: person?.branchId || null, employeeId: o.employeeId, createdByUserId: o.userId, ...data } });
  });
  return { sent: true, adjustmentId: made.id, periodId: period.id, periodName: period.name, amount: Number(made.amount) };
}

/** A month's pay on the person's salary structure, worked out by Payroll's own engine: the earnings, not the CTC. */
async function structureGross(orgId: string, employeeId: string) {
  const a = await payrollPrisma.salaryAssignment.findFirst({ where: { orgId, employeeId, status: 'ACTIVE', effectiveFrom: { lte: todayIst() } }, orderBy: { effectiveFrom: 'desc' }, select: { structureId: true, annualCtc: true, monthlyCtc: true } });
  if (!a) return null;
  const { offerBreakdown } = await import('../../payroll/offerBreakdown.js');
  const b = await offerBreakdown(orgId, a.structureId, Number(a.annualCtc)).catch(() => null);
  const gross = b?.monthlyGross && b.monthlyGross > 0 ? b.monthlyGross : Number(a.monthlyCtc);
  return gross > 0 ? gross : null;
}

/**
 * What more can come off this person's pay in the open month: half their
 * wages (Code on Wages 2019 s.18; Payment of Wages Act s.7 before it), less
 *  - the regular deductions on their last final payslip (PF, tax, …),
 *  - every deduction already added for the open month and not cancelled (a
 *    recovery waiting in Payroll counts as much as one approved), and what
 *    earlier runs carried forward and no payslip has taken yet,
 *  - and the monthly instalment of every loan being recovered or still a draft.
 * Wages are that payslip's gross; with no payslip yet, the monthly earnings of
 * their salary structure, which is approximate. Null when Payroll knows
 * nothing of their pay.
 */
export async function payCap(orgId: string, employeeId: string) {
  const runs = await payrollPrisma.payrollRun.findMany({ where: { orgId, status: { in: ['APPROVED', 'LOCKED', 'PAID', 'POSTED'] } }, select: { id: true }, orderBy: { payrollDate: 'desc' }, take: 24 });
  const slip = runs.length
    ? await payrollPrisma.salarySlip.findFirst({ where: { orgId, employeeId, runId: { in: runs.map((r) => r.id) }, status: { not: 'CANCELLED' } }, orderBy: { payrollDate: 'desc' }, select: { id: true, number: true, periodId: true, grossEarnings: true, totalDeductions: true, adjustmentSnapshotJson: true } })
    : null;
  let wages = 0;
  let other = 0;
  let basis = '';
  let approximate = false;
  /* The payslip's own month not yet over (QA of #82, F4): its fines and other one-offs are still this month's, and count. */
  let slipMonthOpen: string | null = null;
  if (slip) {
    const p = await payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: slip.periodId }, select: { endDate: true } });
    if (p && p.endDate >= todayIst()) slipMonthOpen = slip.periodId;
    const recovered = await payrollPrisma.payrollLoanInstallment.findMany({ where: { orgId, slipId: slip.id, status: 'RECOVERED' }, select: { dueAmount: true } });
    /* That month's one-off deductions belonged to that month, not to every month. */
    let oneOff = 0;
    try {
      const adj = JSON.parse(slip.adjustmentSnapshotJson || '[]');
      if (Array.isArray(adj)) oneOff = adj.filter((x: any) => x?.type === 'DEDUCTION').reduce((t: number, x: any) => t + (Number(x.amount) || 0), 0);
    } catch { /* an old payslip without the snapshot */ }
    wages = Number(slip.grossEarnings);
    other = Math.max(0, Number(slip.totalDeductions) - recovered.reduce((t, i) => t + Number(i.dueAmount), 0) - (slipMonthOpen ? 0 : oneOff));
    basis = `payslip ${slip.number}`;
  } else {
    const gross = await structureGross(orgId, employeeId);
    if (!gross) return null;
    wages = gross;
    basis = 'salary structure, approximate';
    approximate = true;
  }
  if (!(wages > 0)) return null;
  const period = await periodToPayIn(orgId, undefined, employeeId);
  const [loans, pending] = await Promise.all([
    payrollPrisma.payrollLoan.findMany({ where: { orgId, employeeId, status: { in: ['ACTIVE', 'DRAFT', 'APPROVED'] } }, select: { status: true, principal: true, installmentCount: true, installmentAmount: true, interestRate: true, outstandingBalance: true } }),
    /* This month's deductions, and what earlier runs carried and nobody has taken yet: the next payslip takes those first. */
    payrollPrisma.payrollAdjustment.findMany({
      where: { orgId, employeeId, type: 'DEDUCTION', OR: [...(period ? [{ periodId: period.id, status: { not: 'CANCELLED' } }] : []), { carriedByRunId: { not: null }, status: 'APPROVED', ...(period ? { periodId: { not: period.id } } : {}) }] },
      select: { amount: true, periodId: true, status: true },
    }),
  ]);
  /* A draft loan has no instalment written yet: its principal over its months. */
  const instalmentOf = (l: (typeof loans)[number]) => (l.status === 'ACTIVE' ? Number(l.installmentAmount) : l.installmentCount > 0 ? Number(l.principal) / l.installmentCount : Number(l.principal));
  const loanInstalments = round2(loans.reduce((t, l) => t + instalmentOf(l), 0));
  /* Those the open payslip already took are in `other` above; not counted twice. */
  const thisMonth = round2(pending.filter((a) => !(slipMonthOpen && a.periodId === slipMonthOpen && a.status === 'CONSUMED')).reduce((t, a) => t + Number(a.amount), 0));
  const interestFreeOwed = round2(loans.filter((l) => Number(l.interestRate) === 0).reduce((t, l) => t + (l.status === 'ACTIVE' ? Number(l.outstandingBalance) : Number(l.principal)), 0));
  /* The company's share of wages (Payroll setup), not a fixed half: the same limit the run holds deductions to. */
  const { capSetting } = await import('../../payroll/deductionCap.js');
  const share = (await capSetting(orgId)).percent / 100;
  const room = Math.max(0, round2(wages * share - other - loanInstalments - thisMonth));
  return { wages: round2(wages), percent: Math.round(share * 100), limit: round2(wages * share), otherDeductions: round2(other + thisMonth), loanInstalments, room, basis, approximate, interestFreeOwed };
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
export async function makeSalaryAdvanceLoan(o: { accountId: string; orgId: string; userId: string; employeeId: string; askId: string; amount: number; months: number; notes: string }): Promise<LoanMade> {
  if (!(await payrollOn(o.accountId, o.orgId))) return { made: false, why: 'This company does not run payroll in CLOR: pay the advance and take it back by hand.' };
  /* One ask is one loan: its id is the ask's, so a retry finds the loan made before instead of making another. */
  const id = `salary-advance:${o.askId}`;
  const existing = await payrollPrisma.payrollLoan.findFirst({ where: { orgId: o.orgId, id }, select: { id: true, number: true, status: true } });
  if (existing && existing.status !== 'CANCELLED') return { made: true, loanId: existing.id, number: existing.number, status: existing.status };
  if (existing) return { made: false, why: `Payroll cancelled loan ${existing.number} for this advance. Ask the person to ask again.` };
  const [component, period, person] = await Promise.all([
    componentFor(o.orgId, 'DEDUCTION', ['SALADV', 'LOAN'], ['ADVANCE', 'LOAN']),
    periodToPayIn(o.orgId, undefined, o.employeeId),
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
        const made = await tx.payrollLoan.findUnique({ where: { id }, select: { id: true, number: true, status: true } });
        if (made) return made;
        return tx.payrollLoan.create({
          data: {
            id, accountId: o.accountId, orgId: o.orgId, branchId: person?.branchId || null, number, employeeId: o.employeeId, type: 'SALARY_ADVANCE',
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

export type SalaryDrafted = { made: true; revisionId: string; structureName: string; existed: boolean } | { made: false; why: string };

/**
 * The pay in an accepted offer, handed to Payroll as a draft salary revision
 * for the new employee (People plan 8 Nov 2026, step 4): the offer's structure
 * and CTC from the joining date, waiting in Payroll › Salary revisions for
 * someone there to review, approve and apply. Applying writes the salary
 * assignment, the one way a salary is written in CLOR, and ticks the joining
 * step "Assign the salary structure". People never writes a salary itself.
 *
 * One offer is one draft: its id is the offer's, so a retry finds the draft
 * made before. An open revision for the person from elsewhere is left alone.
 */
export async function draftSalaryFromOffer(o: { accountId: string; orgId: string; userId: string; employeeId: string; structureId: string; annualCtc: number; effectiveFrom: string; offerId: string }): Promise<SalaryDrafted> {
  if (!(await payrollOn(o.accountId, o.orgId))) return { made: false, why: 'This company does not run payroll in CLOR.' };
  const structure = await payrollPrisma.salaryStructure.findFirst({ where: { orgId: o.orgId, id: o.structureId }, select: { id: true, name: true, status: true } });
  if (!structure) return { made: false, why: 'The salary structure in the offer is no longer in Payroll. Set their salary there by hand.' };
  if (structure.status === 'ARCHIVED') return { made: false, why: `${structure.name}, the structure in the offer, is archived in Payroll. Set their salary there by hand.` };
  const id = `offer-salary:${o.offerId}`;
  const prior = await payrollPrisma.salaryRevision.findFirst({ where: { orgId: o.orgId, id }, select: { id: true, status: true } });
  if (prior) return prior.status === 'REJECTED' ? { made: false, why: 'Payroll turned down the salary drafted from the offer. Set their salary there by hand.' } : { made: true, revisionId: prior.id, structureName: structure.name, existed: true };
  const open = await payrollPrisma.salaryRevision.findFirst({ where: { orgId: o.orgId, employeeId: o.employeeId, status: { in: ['DRAFT', 'REVIEWED', 'APPROVED'] } }, select: { id: true } });
  if (open) return { made: false, why: 'Payroll already has a salary revision open for them. Finish that one there.' };
  const current = await payrollPrisma.salaryAssignment.findFirst({ where: { orgId: o.orgId, employeeId: o.employeeId, status: 'ACTIVE' }, orderBy: { effectiveFrom: 'desc' }, select: { id: true, structureId: true, annualCtc: true } });
  const row: { id: string } = await forLiveEmployee(o.orgId, o.employeeId, (tx) => tx.salaryRevision.create({
    data: {
      id, accountId: o.accountId, orgId: o.orgId, employeeId: o.employeeId,
      currentAssignmentId: current?.id ?? null, currentStructureId: current?.structureId ?? null, currentAnnualCtc: Number(current?.annualCtc ?? 0),
      proposedStructureId: structure.id, proposedAnnualCtc: round2(o.annualCtc), incrementPercent: 0,
      effectiveFrom: o.effectiveFrom, reason: 'From the accepted offer', notes: 'Drafted by People when the candidate was hired. Review, approve and apply it to put them on this salary.',
      status: 'DRAFT', createdByUserId: o.userId,
    },
    select: { id: true },
  }));
  return { made: true, revisionId: row.id, structureName: structure.name, existed: false };
}

/** A loan's state for the screens: what is left to repay and the next instalment. */
export async function loanState(orgId: string, loanId: string) {
  const l = await payrollPrisma.payrollLoan.findFirst({ where: { orgId, id: loanId }, select: { id: true, number: true, status: true, principal: true, installmentAmount: true, installmentCount: true, outstandingBalance: true } });
  if (!l) return null;
  return { id: l.id, number: l.number, status: l.status, principal: Number(l.principal), instalment: Number(l.installmentAmount), instalments: l.installmentCount, outstanding: Number(l.outstandingBalance) };
}
