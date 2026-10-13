import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { snapshotPerson } from '../services/payroll/payment.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { levelFor, resolveAccess } from '../services/access.js';

/**
 * Payslips, and the reasoning behind every figure on them.
 *
 * A payslip is read long after the payroll that produced it, by somebody who
 * was not there — an employee checking an allowance, an accountant tying a
 * month back to the books, an auditor two years later. So it is served from its
 * own snapshot rather than from today's configuration: the employee's details,
 * the structure, the days and the engine version were all captured when it was
 * calculated, and reopening it reads those.
 *
 * The calculation trace is what makes this worth building rather than printing
 * a table of numbers. "Why is my HRA that?" is the most common question payroll
 * receives, and the answer comes from the payslip itself — the base it started
 * from, the rule applied, the proration, the rounding — rather than from
 * somebody rebuilding the arithmetic by hand and hoping they match.
 */
export const payrollSlipsRouter = Router();
payrollSlipsRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.slips;
/** The level that has to be granted before a whole PAN or bank account is sent. */
const SENSITIVE_LEVEL = 1;

const maskTail = (value: string | null | undefined, keep = 4) => {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.length <= keep) return '•'.repeat(s.length);
  return `${'•'.repeat(Math.min(6, s.length - keep))}${s.slice(-keep)}`;
};

const maskPan = (value: string | null | undefined) => {
  const s = String(value || '').trim().toUpperCase();
  if (!s) return '';
  if (s.length <= 4) return '•'.repeat(s.length);
  return `${s.slice(0, 3)}${'•'.repeat(Math.max(3, s.length - 4))}${s.slice(-1)}`;
};

const parse = (json: string | null, fallback: unknown = {}) => {
  try {
    return JSON.parse(String(json || '')) ?? fallback;
  } catch {
    return fallback;
  }
};

const summary = (s: any) => ({
  id: s.id,
  number: s.number,
  runId: s.runId,
  employeeId: s.employeeId,
  periodId: s.periodId,
  payrollDate: s.payrollDate,
  grossEarnings: Number(s.grossEarnings),
  totalDeductions: Number(s.totalDeductions),
  employerContributions: Number(s.employerContributions),
  netPay: Number(s.netPay),
  employerCost: Number(s.employerCost),
  previousNetPay: s.previousNetPay == null ? null : Number(s.previousNetPay),
  variancePercent: s.variancePercent == null ? null : Number(s.variancePercent),
  status: s.status,
  paymentStatus: s.paymentStatus,
  engineVersion: s.engineVersion || null,
});

payrollSlipsRouter.get(
  '/orgs/:orgId/payroll/slips',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const slips = await payrollPrisma.salarySlip.findMany({
      where: {
        accountId,
        orgId,
        ...(String(req.query.runId || '').trim() ? { runId: String(req.query.runId) } : {}),
        ...(String(req.query.employeeId || '').trim() ? { employeeId: String(req.query.employeeId) } : {}),
        ...(String(req.query.periodId || '').trim() ? { periodId: String(req.query.periodId) } : {}),
        ...(String(req.query.paymentStatus || '').trim() ? { paymentStatus: String(req.query.paymentStatus) } : {}),
      },
      orderBy: [{ payrollDate: 'desc' }, { number: 'asc' }],
      take: Math.min(500, Math.max(1, Number(req.query.limit || 200))),
    });

    /* Names and periods once, not once per payslip. */
    const [employees, periods] = await Promise.all([
      peoplePrisma.employee.findMany({
        where: { orgId, id: { in: [...new Set(slips.map((s) => s.employeeId))] } },
        select: { id: true, name: true, code: true, designation: true, department: true },
      }),
      payrollPrisma.payrollPeriod.findMany({
        where: { orgId, id: { in: [...new Set(slips.map((s) => s.periodId))] } },
        select: { id: true, name: true, startDate: true, endDate: true },
      }),
    ]);
    const byEmployee = new Map(employees.map((e) => [e.id, e]));
    const byPeriod = new Map(periods.map((p) => [p.id, p]));

    /*
     * A payslip names who it paid, even after they leave.
     *
     * The directory is the better name while somebody is in it — a corrected
     * spelling, a married name. It is the worse one afterwards: a person who
     * has been removed still has payslips, and a list of them reading
     * "Unknown" is a list nobody can reconcile. The payslip recorded who they
     * were, which is what the snapshot is for.
     */
    const named = (s: (typeof slips)[number]) => {
      const live = byEmployee.get(s.employeeId);
      if (live) return live;
      const snap = snapshotPerson(s.employeeSnapshotJson);
      if (!snap.name) return null;
      return { id: s.employeeId, name: snap.name, code: snap.code, designation: null, department: null };
    };

    res.json({
      slips: slips.map((s) => ({
        ...summary(s),
        employee: named(s),
        period: byPeriod.get(s.periodId) || null,
      })),
    });
  }
);

/**
 * One payslip, as a document.
 *
 * Everything comes from the payslip's own snapshot. The employee's name and
 * designation are the ones recorded at the time, not today's — somebody who has
 * since been promoted still has last March's payslip showing last March's job.
 */
payrollSlipsRouter.get(
  '/orgs/:orgId/payroll/slips/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId, branchId } = req.tenant!;

    const slip = await payrollPrisma.salarySlip.findFirst({
      where: { id: String(req.params.id), accountId, orgId },
      include: {
        lines: { orderBy: { displayOrder: 'asc' } },
        traces: { orderBy: { displayOrder: 'asc' } },
      },
    });
    if (!slip) return res.status(404).json({ error: 'No such payslip.' });

    const access = await resolveAccess(accountId, orgId, req.auth!.userId, branchId);
    const reveal = levelFor(access, PAYROLL_MODULE, PAYROLL_RESOURCE.profile, PermissionAction.VIEW) >= SENSITIVE_LEVEL;

    const [period, run, profile] = await Promise.all([
      payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: slip.periodId } }),
      payrollPrisma.payrollRun.findFirst({ where: { orgId, id: slip.runId }, select: { number: true, status: true } }),
      payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId, employeeId: slip.employeeId } }),
    ]);

    const employeeSnapshot: any = parse(slip.employeeSnapshotJson);
    const assignmentSnapshot: any = parse(slip.assignmentSnapshotJson);
    const inputSnapshot: any = parse(slip.inputSnapshotJson);
    const adjustmentSnapshot: any = parse(slip.adjustmentSnapshotJson, []);

    const lines = slip.lines.map((l) => ({
      componentId: l.componentId,
      code: l.componentCode,
      name: l.componentName,
      type: l.type,
      amount: Number(l.amount),
      fullAmount: l.fullAmount == null ? null : Number(l.fullAmount),
      isTaxable: !!l.isTaxable,
      displayOrder: l.displayOrder,
    }));

    res.json({
      slip: {
        ...summary(slip),
        run,
        period,
        /* The person as they were, from the snapshot. */
        employee: {
          name: employeeSnapshot.name || '',
          code: employeeSnapshot.code || '',
          designation: employeeSnapshot.designation || '',
          department: employeeSnapshot.department || '',
          dateOfJoining: employeeSnapshot.dateOfJoining || null,
          taxRegime: employeeSnapshot.taxRegime || null,
          /* Masked for everybody but a caller holding the level. A payslip is
             the document most likely to be forwarded by email. */
          pan: reveal ? profile?.pan || '' : maskPan(profile?.pan),
          bankAccountNumber: reveal ? profile?.bankAccountNumber || '' : maskTail(profile?.bankAccountNumber),
          bankName: profile?.bankName || '',
          masked: !reveal,
        },
        earnings: lines.filter((l) => l.type === 'EARNING'),
        deductions: lines.filter((l) => l.type === 'DEDUCTION'),
        employerContributions: lines.filter((l) => l.type === 'EMPLOYER_CONTRIBUTION'),
        days: {
          workingDays: Number(inputSnapshot.workingDays ?? 0),
          payableDays: Number(inputSnapshot.payableDays ?? 0),
          lwpDays: Number(inputSnapshot.lwpDays ?? 0),
          periodDays: Number(inputSnapshot.periodDays ?? 0),
        },
        ctc: {
          annual: Number(assignmentSnapshot.annualCtc ?? 0),
          monthly: Number(assignmentSnapshot.monthlyCtc ?? 0),
        },
        adjustments: Array.isArray(adjustmentSnapshot) ? adjustmentSnapshot : [],
        /* How each figure was reached — the answer to "why is my HRA that?". */
        calculation: slip.traces.map((t) => ({
          code: t.componentCode,
          componentId: t.componentId,
          baseLabel: t.baseLabel,
          baseAmount: t.baseAmount == null ? null : Number(t.baseAmount),
          ruleText: t.ruleText || '',
          formula: t.formula,
          computedAmount: Number(t.computedAmount),
          prorationFactor: t.prorationFactor == null ? null : Number(t.prorationFactor),
          roundingApplied: t.roundingApplied == null ? null : Number(t.roundingApplied),
          statutoryRuleVersion: t.statutoryRuleVersion,
        })),
      },
    });
  }
);

/**
 * What one person has earned so far, for the detailed payslip.
 *
 * Year to date is read from the payslips themselves rather than stored on any
 * of them: a figure stored per payslip would go stale the moment an earlier
 * month was corrected, and there would be no way to tell which copy was right.
 */
payrollSlipsRouter.get(
  '/orgs/:orgId/payroll/slips/:id/year-to-date',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const slip = await payrollPrisma.salarySlip.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!slip) return res.status(404).json({ error: 'No such payslip.' });

    /* The Indian financial year the payslip falls in: April to March. */
    const [y, m] = slip.payrollDate.split('-').map(Number);
    const fyStart = `${m >= 4 ? y : y - 1}-04-01`;

    const slips = await payrollPrisma.salarySlip.findMany({
      where: {
        orgId,
        employeeId: slip.employeeId,
        payrollDate: { gte: fyStart, lte: slip.payrollDate },
        status: { in: ['CALCULATED', 'APPROVED', 'LOCKED', 'PAID'] },
      },
      select: { grossEarnings: true, totalDeductions: true, netPay: true, employerContributions: true },
    });

    const sum = (pick: (s: (typeof slips)[number]) => unknown) =>
      Math.round(slips.reduce((t, s) => t + Number(pick(s) || 0), 0) * 100) / 100;

    res.json({
      yearToDate: {
        financialYearFrom: fyStart,
        payslips: slips.length,
        grossEarnings: sum((s) => s.grossEarnings),
        totalDeductions: sum((s) => s.totalDeductions),
        netPay: sum((s) => s.netPay),
        employerContributions: sum((s) => s.employerContributions),
      },
    });
  }
);
