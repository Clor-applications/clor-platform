import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { round2 } from '../utils/money.js';

/**
 * The state of payroll, in one request.
 *
 * Written as a single route rather than assembled from six on the client,
 * because the question a payroll manager has on the first of the month is one
 * question — "where is this month, and what is in my way" — and answering it in
 * six round trips makes the screen flicker into existence a piece at a time.
 *
 * Everything here is derived. Nothing on this route decides anything, and no
 * figure is stored: the moment an overview keeps its own copy of a total is the
 * moment it can disagree with the payslips underneath it.
 */
export const payrollOverviewRouter = Router();
payrollOverviewRouter.use(requireAuth, requireTenantContext);


/** What still has to happen before this payroll is finished. */
const STAGE: Record<string, string> = {
  DRAFT: 'Not calculated yet',
  CALCULATED: 'Waiting to be checked',
  REVIEW: 'In review',
  APPROVED: 'Approved, not paid',
  LOCKED: 'Locked, not paid',
  PAID: 'Paid',
  POSTED: 'In the books',
  CANCELLED: 'Cancelled',
};

payrollOverviewRouter.get(
  '/orgs/:orgId/payroll/overview',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, PAYROLL_RESOURCE.runs),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const today = new Date().toISOString().slice(0, 10);

    const [periods, runs, profiles, openAdjustments, activeLoans, openRevisions] = await Promise.all([
      payrollPrisma.payrollPeriod.findMany({ where: { orgId }, orderBy: { startDate: 'desc' }, take: 24 }),
      payrollPrisma.payrollRun.findMany({
        where: { accountId, orgId, status: { not: 'CANCELLED' } },
        orderBy: { payrollDate: 'desc' },
        take: 12,
      }),
      payrollPrisma.employeePayrollProfile.findMany({ where: { orgId }, select: { employeeId: true, payrollStatus: true } }),
      payrollPrisma.payrollAdjustment.findMany({
        where: { orgId, status: { in: ['DRAFT', 'APPROVED'] } },
        select: { id: true, status: true, type: true, amount: true, periodId: true },
      }),
      payrollPrisma.payrollLoan.findMany({ where: { orgId, status: 'ACTIVE' }, select: { id: true, outstandingBalance: true } }),
      payrollPrisma.salaryRevision.findMany({
        where: { orgId, status: { in: ['DRAFT', 'REVIEWED', 'APPROVED'] } },
        select: { id: true, status: true, effectiveFrom: true },
      }),
    ]);

    /* The month payroll is for: the open period covering today, or the most
       recent open one if today falls between periods. */
    const open = periods.filter((p) => !p.isLocked);
    const current = open.find((p) => p.startDate <= today && p.endDate >= today) || open[0] || null;

    const byPeriod = new Map(periods.map((p) => [p.id, p]));
    const currentRun = current ? runs.find((r) => r.periodId === current.id) || null : null;

    /*
     * People in payroll, counted from their payroll profile rather than from
     * the staff directory: somebody can be employed and not in payroll — a
     * contractor, somebody on hold — and the two numbers differ for good
     * reasons.
     *
     * But only for people who are still in the directory. A profile whose
     * person has been removed counts for nothing, and counting it produced
     * "4 in payroll of 2 on the books" — a pair of numbers that cannot both be
     * true, which is worse than either being wrong on its own.
     */
    const directory = await peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, status: true } });
    const known = new Set(directory.map((e) => e.id));
    const headcount = directory.filter((e) => e.status === 'ACTIVE').length;

    const realProfiles = profiles.filter((p) => known.has(p.employeeId));
    const orphaned = profiles.length - realProfiles.length;

    const inPayroll = realProfiles.filter((p) => p.payrollStatus === 'IN_PAYROLL').length;
    const onHold = realProfiles.filter((p) => p.payrollStatus === 'ON_HOLD').length;

    const peopleIds = realProfiles.map((p) => p.employeeId);
    const withoutSalary = peopleIds.length
      ? peopleIds.length -
        (
          await payrollPrisma.salaryAssignment.findMany({
            where: { orgId, employeeId: { in: peopleIds }, status: 'ACTIVE' },
            select: { employeeId: true },
            distinct: ['employeeId'],
          })
        ).length
      : 0;

    /* Twelve months of cost, oldest first, from runs that produced payslips. */
    const trend = runs
      .filter((r) => ['CALCULATED', 'REVIEW', 'APPROVED', 'LOCKED', 'PAID', 'POSTED'].includes(r.status))
      .slice(0, 12)
      .reverse()
      .map((r) => ({
        runId: r.id,
        number: r.number,
        periodName: byPeriod.get(r.periodId)?.name || '',
        payrollDate: r.payrollDate,
        employeeCount: r.employeeCount,
        gross: Number(r.grossTotal),
        deductions: Number(r.deductionTotal),
        net: Number(r.netTotal),
        employerCost: Number(r.employerCostTotal),
      }));

    /*
     * What is in the way, in the order somebody would act on it. A payroll
     * that cannot be run at all comes before a bonus nobody has approved.
     */
    const blockers: { code: string; message: string; count?: number }[] = [];

    if (!open.length) {
      blockers.push({ code: 'NO_OPEN_PERIOD', message: 'There is no open payroll period, so payroll cannot be run for any month.' });
    }
    if (orphaned > 0) {
      /* Payroll details for somebody the staff directory no longer has. Their
         bank account and PAN are still sitting here, and no payroll will ever
         pick them up. */
      blockers.push({
        code: 'ORPHANED_PAYROLL_PROFILES',
        message: `${orphaned} payroll ${orphaned === 1 ? 'record belongs' : 'records belong'} to somebody who is no longer in the staff directory.`,
        count: orphaned,
      });
    }
    if (withoutSalary > 0) {
      blockers.push({
        code: 'PEOPLE_WITHOUT_SALARY',
        message: `${withoutSalary} ${withoutSalary === 1 ? 'person has' : 'people have'} no salary assigned, so payroll would skip them.`,
        count: withoutSalary,
      });
    }
    const unapproved = openAdjustments.filter((a) => a.status === 'DRAFT');
    if (unapproved.length) {
      blockers.push({
        code: 'ADJUSTMENTS_UNAPPROVED',
        message: `${unapproved.length} ${unapproved.length === 1 ? 'adjustment is' : 'adjustments are'} waiting for approval, and payroll will not pay them until they are.`,
        count: unapproved.length,
      });
    }
    const readyToApply = openRevisions.filter((r) => r.status === 'APPROVED' && r.effectiveFrom <= today);
    if (readyToApply.length) {
      blockers.push({
        code: 'REVISIONS_NOT_APPLIED',
        message: `${readyToApply.length} approved salary ${readyToApply.length === 1 ? 'revision has' : 'revisions have'} reached their date but have not been put into effect.`,
        count: readyToApply.length,
      });
    }
    if (currentRun && ['APPROVED', 'LOCKED'].includes(currentRun.status)) {
      blockers.push({ code: 'RUN_NOT_POSTED', message: `${currentRun.number} is approved but is not in the books yet.` });
    }

    const approvedAdjustments = openAdjustments.filter((a) => a.status === 'APPROVED');
    const pendingAdjustmentValue = round2(
      approvedAdjustments.reduce((t, a) => t + (a.type === 'DEDUCTION' ? -Number(a.amount) : Number(a.amount)), 0)
    );

    res.json({
      overview: {
        currentPeriod: current
          ? { id: current.id, name: current.name, startDate: current.startDate, endDate: current.endDate, paymentDate: current.paymentDate }
          : null,
        currentRun: currentRun
          ? {
              id: currentRun.id,
              number: currentRun.number,
              status: currentRun.status,
              stage: STAGE[currentRun.status] || currentRun.status,
              employeeCount: currentRun.employeeCount,
              gross: Number(currentRun.grossTotal),
              deductions: Number(currentRun.deductionTotal),
              net: Number(currentRun.netTotal),
              employerCost: Number(currentRun.employerCostTotal),
            }
          : null,
        people: { headcount, inPayroll, onHold, withoutSalary, orphaned },
        /* Last month's cost, for comparison against this one. */
        previous: trend.length > 1 ? trend[trend.length - 2] : null,
        latest: trend.length ? trend[trend.length - 1] : null,
        trend,
        pending: {
          adjustments: approvedAdjustments.length,
          adjustmentValue: pendingAdjustmentValue,
          unapprovedAdjustments: unapproved.length,
          loans: activeLoans.length,
          loanOutstanding: round2(activeLoans.reduce((t, l) => t + Number(l.outstandingBalance), 0)),
          revisions: openRevisions.length,
        },
        blockers,
      },
    });
  }
);
