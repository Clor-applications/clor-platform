import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { calculateRun, daysBetween, eligibleEmployees, validateRun } from '../services/payroll/run.js';

/**
 * A payroll run, from who is in it to payslips somebody can approve.
 *
 * The stages are deliberately separate calls rather than one "run payroll"
 * button, because each is a decision: who is included, what days they worked,
 * what the validation says, and only then the arithmetic. A single button would
 * collapse four decisions into one and produce payslips nobody chose.
 *
 * ## Status is the whole safety model
 *
 * DRAFT → CALCULATED → REVIEW → APPROVED → LOCKED → PAID → POSTED. Everything
 * that edits a run refuses once it is past REVIEW, because approving a payroll
 * is a statement about specific figures, and figures that can still move
 * afterwards make the approval meaningless. Corrections after that go through
 * an adjustment or a fresh run, never by editing in place.
 */
export const payrollRunsRouter = Router();
payrollRunsRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.runs;

/** Past this, a run's figures are somebody's decision and stop moving. */
const EDITABLE = ['DRAFT', 'CALCULATED', 'REVIEW'];

const shape = (row: any, extra: Record<string, unknown> = {}) => ({
  id: row.id,
  number: row.number,
  periodId: row.periodId,
  payGroupId: row.payGroupId || null,
  branchId: row.branchId || null,
  department: row.department || null,
  payrollDate: row.payrollDate,
  notes: row.notes || '',
  status: row.status,
  employeeCount: row.employeeCount,
  grossTotal: Number(row.grossTotal ?? 0),
  deductionTotal: Number(row.deductionTotal ?? 0),
  employerContributionTotal: Number(row.employerContributionTotal ?? 0),
  netTotal: Number(row.netTotal ?? 0),
  employerCostTotal: Number(row.employerCostTotal ?? 0),
  errorCount: row.errorCount,
  warningCount: row.warningCount,
  engineVersion: row.engineVersion || null,
  calculatedAt: row.calculatedAt,
  submittedAt: row.submittedAt,
  approvedAt: row.approvedAt,
  rejectedAt: row.rejectedAt,
  rejectionReason: row.rejectionReason || null,
  lockedAt: row.lockedAt,
  createdAt: row.createdAt,
  ...extra,
});

/** Loads a run, or answers for it. */
async function runOr404(req: any, res: any) {
  const { accountId, orgId } = req.tenant!;
  const run = await payrollPrisma.payrollRun.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!run) {
    res.status(404).json({ error: 'No such payroll run.' });
    return null;
  }
  return run;
}

const editable = (run: any, res: any) => {
  if (EDITABLE.includes(run.status)) return true;
  res.status(409).json({
    error: `This payroll is ${run.status.toLowerCase()} and can no longer be changed. Record an adjustment, or run a fresh payroll.`,
    code: 'RUN_NOT_EDITABLE',
  });
  return false;
};

// ---------------------------------------------------------------- listing

payrollRunsRouter.get(
  '/orgs/:orgId/payroll/runs',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const runs = await payrollPrisma.payrollRun.findMany({
      where: { accountId, orgId, ...(String(req.query.status || '').trim() ? { status: String(req.query.status) } : {}) },
      orderBy: [{ payrollDate: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(200, Math.max(1, Number(req.query.limit || 50))),
    });
    const periods = await payrollPrisma.payrollPeriod.findMany({
      where: { orgId, id: { in: [...new Set(runs.map((r) => r.periodId))] } },
      select: { id: true, name: true, startDate: true, endDate: true },
    });
    const byId = new Map(periods.map((p) => [p.id, p]));
    res.json({ runs: runs.map((r) => shape(r, { period: byId.get(r.periodId) || null })) });
  }
);

payrollRunsRouter.get(
  '/orgs/:orgId/payroll/runs/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { orgId } = req.tenant!;
    const run = await runOr404(req, res);
    if (!run) return;

    const [period, members, slips] = await Promise.all([
      payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: run.periodId } }),
      payrollPrisma.payrollRunEmployee.findMany({ where: { orgId, runId: run.id } }),
      payrollPrisma.salarySlip.findMany({ where: { orgId, runId: run.id }, orderBy: { number: 'asc' } }),
    ]);

    const employees = await peoplePrisma.employee.findMany({
      where: { orgId, id: { in: members.map((m) => m.employeeId) } },
      select: { id: true, name: true, code: true, designation: true, department: true },
    });
    const byEmployee = new Map(employees.map((e) => [e.id, e]));
    const inputs = await payrollPrisma.payrollInput.findMany({ where: { orgId, runId: run.id } });
    const inputByEmployee = new Map(inputs.map((i) => [i.employeeId, i]));

    res.json({
      run: shape(run, { period }),
      employees: members.map((m) => ({
        employeeId: m.employeeId,
        inclusion: m.inclusion,
        state: m.state,
        issues: JSON.parse(m.issuesJson || '[]'),
        employee: byEmployee.get(m.employeeId) || null,
        input: inputByEmployee.get(m.employeeId)
          ? {
              workingDays: Number(inputByEmployee.get(m.employeeId)!.workingDays),
              payableDays: Number(inputByEmployee.get(m.employeeId)!.payableDays),
              lwpDays: Number(inputByEmployee.get(m.employeeId)!.lwpDays),
              variablePay: Number(inputByEmployee.get(m.employeeId)!.variablePay),
              overtimeAmount: Number(inputByEmployee.get(m.employeeId)!.overtimeAmount),
            }
          : null,
      })),
      slips: slips.map((s) => ({
        id: s.id,
        number: s.number,
        employeeId: s.employeeId,
        grossEarnings: Number(s.grossEarnings),
        totalDeductions: Number(s.totalDeductions),
        employerContributions: Number(s.employerContributions),
        netPay: Number(s.netPay),
        employerCost: Number(s.employerCost),
        previousNetPay: s.previousNetPay == null ? null : Number(s.previousNetPay),
        variancePercent: s.variancePercent == null ? null : Number(s.variancePercent),
        status: s.status,
        paymentStatus: s.paymentStatus,
      })),
    });
  }
);

// ---------------------------------------------------------------- creating

const createSchema = z.object({
  periodId: z.string().trim().min(1, 'A payroll run needs a period.'),
  payGroupId: z.string().trim().optional().nullable(),
  branchId: z.string().trim().optional().nullable(),
  department: z.string().trim().optional().nullable(),
  payrollDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

payrollRunsRouter.post(
  '/orgs/:orgId/payroll/runs',
  requirePermission(PAYROLL_MODULE, PermissionAction.CREATE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payroll run.' });
    const body = parsed.data;

    const period = await payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: body.periodId } });
    if (!period) return res.status(400).json({ error: 'No such payroll period.' });
    if (period.isLocked) {
      return res.status(409).json({ error: `${period.name} is closed, so no payroll can be run for it.`, code: 'PERIOD_LOCKED' });
    }

    /* One payroll per population per period, which is what stops the same
       people being paid twice in a month. */
    const existing = await payrollPrisma.payrollRun.findFirst({
      where: {
        orgId,
        periodId: body.periodId,
        payGroupId: body.payGroupId || null,
        branchId: body.branchId || null,
        status: { not: 'CANCELLED' },
      },
      select: { id: true, number: true, status: true },
    });
    if (existing) {
      return res.status(409).json({
        error: `Payroll ${existing.number} already covers this period and population.`,
        code: 'RUN_EXISTS',
        runId: existing.id,
      });
    }

    const people = await eligibleEmployees(orgId, {
      periodStart: period.startDate,
      periodEnd: period.endDate,
      payGroupId: body.payGroupId,
      branchId: body.branchId,
      department: body.department,
    });

    const count = await payrollPrisma.payrollRun.count({ where: { orgId } });
    const number = `PR-${period.startDate.slice(0, 7).replace('-', '')}-${String(count + 1).padStart(3, '0')}`;

    const run = await payrollPrisma.$transaction(async (tx) => {
      const created = await tx.payrollRun.create({
        data: {
          accountId,
          orgId,
          branchId: body.branchId || null,
          number,
          periodId: body.periodId,
          payGroupId: body.payGroupId || null,
          department: body.department || null,
          payrollDate: body.payrollDate || period.paymentDate || period.endDate,
          notes: body.notes || null,
          status: 'DRAFT',
          employeeCount: people.length,
          createdByUserId: req.auth!.userId,
        },
      });
      if (people.length) {
        await tx.payrollRunEmployee.createMany({
          data: people.map((p) => ({
            accountId,
            orgId,
            runId: created.id,
            employeeId: p.employee.id,
            inclusion: 'INCLUDED',
            state: 'PENDING',
          })),
        });
      }
      return created;
    });

    res.status(201).json({
      run: shape(run, { period }),
      eligible: people.length,
      periodDays: daysBetween(period.startDate, period.endDate),
    });
  }
);

// ---------------------------------------------------------------- who is in

payrollRunsRouter.post(
  '/orgs/:orgId/payroll/runs/:id/employees',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { orgId } = req.tenant!;
    const run = await runOr404(req, res);
    if (!run) return;
    if (!editable(run, res)) return;

    const schema = z.object({ employeeId: z.string().trim().min(1), include: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Say which employee, and whether to include them.' });

    const member = await payrollPrisma.payrollRunEmployee.findFirst({
      where: { orgId, runId: run.id, employeeId: parsed.data.employeeId },
    });
    if (!member) return res.status(404).json({ error: 'That person is not part of this payroll.' });

    await payrollPrisma.payrollRunEmployee.update({
      where: { id: member.id },
      data: { inclusion: parsed.data.include ? 'INCLUDED' : 'EXCLUDED', state: 'PENDING' },
    });

    const included = await payrollPrisma.payrollRunEmployee.count({ where: { orgId, runId: run.id, inclusion: 'INCLUDED' } });
    await payrollPrisma.payrollRun.update({ where: { id: run.id }, data: { employeeCount: included } });
    res.json({ ok: true, employeeCount: included });
  }
);

// ---------------------------------------------------------------- the days

payrollRunsRouter.put(
  '/orgs/:orgId/payroll/runs/:id/inputs',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const run = await runOr404(req, res);
    if (!run) return;
    if (!editable(run, res)) return;

    const schema = z.object({
      inputs: z
        .array(
          z.object({
            employeeId: z.string().trim().min(1),
            workingDays: z.number().finite().min(0).max(366),
            payableDays: z.number().finite().min(0).max(366),
            lwpDays: z.number().finite().min(0).max(366).default(0),
            variablePay: z.number().finite().min(0).default(0),
            overtimeAmount: z.number().finite().min(0).default(0),
            notes: z.string().trim().max(300).optional().nullable(),
          })
        )
        .min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payroll inputs.' });

    for (const row of parsed.data.inputs) {
      await payrollPrisma.payrollInput.upsert({
        where: { runId_employeeId: { runId: run.id, employeeId: row.employeeId } },
        create: {
          accountId,
          orgId,
          runId: run.id,
          employeeId: row.employeeId,
          workingDays: row.workingDays,
          payableDays: row.payableDays,
          lwpDays: row.lwpDays,
          variablePay: row.variablePay,
          overtimeAmount: row.overtimeAmount,
          notes: row.notes || null,
          source: 'MANUAL',
          createdByUserId: req.auth!.userId,
        },
        update: {
          workingDays: row.workingDays,
          payableDays: row.payableDays,
          lwpDays: row.lwpDays,
          variablePay: row.variablePay,
          overtimeAmount: row.overtimeAmount,
          notes: row.notes || null,
          source: 'MANUAL',
        },
      });
    }
    res.json({ ok: true, saved: parsed.data.inputs.length });
  }
);

// ---------------------------------------------------------------- the stages

payrollRunsRouter.post(
  '/orgs/:orgId/payroll/runs/:id/validate',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { orgId } = req.tenant!;
    const run = await runOr404(req, res);
    if (!run) return;

    const { issues, byEmployee } = await validateRun(orgId, run.id);

    /* Stored against each person so the review screen can show them without
       revalidating, and so a reopened run still knows what was wrong. */
    for (const [employeeId, list] of byEmployee) {
      await payrollPrisma.payrollRunEmployee.updateMany({
        where: { orgId, runId: run.id, employeeId },
        data: {
          issuesJson: JSON.stringify(list),
          state: list.some((i) => i.severity === 'ERROR') ? 'ERROR' : list.length ? 'WARNING' : 'READY',
        },
      });
    }
    await payrollPrisma.payrollRunEmployee.updateMany({
      where: { orgId, runId: run.id, employeeId: { notIn: [...byEmployee.keys()] } },
      data: { issuesJson: '[]', state: 'READY' },
    });

    const errors = issues.filter((i) => i.severity === 'ERROR').length;
    const warnings = issues.filter((i) => i.severity === 'WARNING').length;
    await payrollPrisma.payrollRun.update({ where: { id: run.id }, data: { errorCount: errors, warningCount: warnings } });

    res.json({ issues, errors, warnings, canCalculate: errors === 0 });
  }
);

payrollRunsRouter.post(
  '/orgs/:orgId/payroll/runs/:id/calculate',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { orgId } = req.tenant!;
    const run = await runOr404(req, res);
    if (!run) return;
    if (!editable(run, res)) return;

    const { slips, issues } = await calculateRun(orgId, run.id, req.auth!.userId);
    const errors = issues.filter((i) => i.severity === 'ERROR');
    if (errors.length) {
      return res.status(409).json({
        error: `This payroll has ${errors.length} problem${errors.length === 1 ? '' : 's'} to resolve before it can be calculated.`,
        code: 'RUN_HAS_ERRORS',
        issues,
      });
    }
    res.json({ calculated: slips.length, issues });
  }
);

const transition = (
  path: string,
  from: string[],
  to: string,
  stamp: (userId: string, body: any) => Record<string, unknown>,
  action: PermissionAction
) =>
  payrollRunsRouter.post(
    `/orgs/:orgId/payroll/runs/:id/${path}`,
    requirePermission(PAYROLL_MODULE, action, RESOURCE),
    async (req, res) => {
      if (!(await payrollRouteOk(req, res))) return;
      const run = await runOr404(req, res);
      if (!run) return;

      if (!from.includes(run.status)) {
        return res.status(409).json({
          error: `A payroll that is ${run.status.toLowerCase()} cannot be ${path === 'submit-review' ? 'sent for review' : `${path}d`}.`,
          code: 'RUN_WRONG_STATUS',
        });
      }
      if (run.errorCount > 0) {
        return res.status(409).json({
          error: `This payroll still has ${run.errorCount} problem${run.errorCount === 1 ? '' : 's'} to resolve.`,
          code: 'RUN_HAS_ERRORS',
        });
      }

      const updated = await payrollPrisma.payrollRun.update({
        where: { id: run.id },
        data: { status: to, ...stamp(req.auth!.userId, req.body || {}) },
      });
      res.json({ run: shape(updated) });
    }
  );

/* Maker and checker are different people in principle and different
   permissions in practice: sending for review is an edit, approving is an
   approval. */
transition('submit-review', ['CALCULATED'], 'REVIEW', (userId) => ({ submittedByUserId: userId, submittedAt: new Date() }), PermissionAction.EDIT);
transition('approve', ['REVIEW'], 'APPROVED', (userId) => ({ approvedByUserId: userId, approvedAt: new Date() }), PermissionAction.APPROVE);
transition(
  'reject',
  ['REVIEW'],
  'CALCULATED',
  (userId, body) => ({
    rejectedByUserId: userId,
    rejectedAt: new Date(),
    rejectionReason: String(body?.reason || '').trim() || null,
    submittedByUserId: null,
    submittedAt: null,
  }),
  PermissionAction.APPROVE
);
transition('lock', ['APPROVED'], 'LOCKED', () => ({ lockedAt: new Date() }), PermissionAction.APPROVE);

payrollRunsRouter.post(
  '/orgs/:orgId/payroll/runs/:id/cancel',
  requirePermission(PAYROLL_MODULE, PermissionAction.DELETE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { orgId } = req.tenant!;
    const run = await runOr404(req, res);
    if (!run) return;

    /* Once money has moved or the books have been written, a cancellation is a
       reversal — which is its own piece of work and not this button. */
    if (['PAID', 'POSTED'].includes(run.status)) {
      return res.status(409).json({
        error: 'This payroll has been paid or posted. Reverse it rather than cancelling it.',
        code: 'RUN_SETTLED',
      });
    }

    const updated = await payrollPrisma.$transaction(async (tx) => {
      const slips = await tx.salarySlip.findMany({ where: { orgId, runId: run.id }, select: { id: true } });
      const ids = slips.map((s) => s.id);
      if (ids.length) {
        await tx.payrollCalculationTrace.deleteMany({ where: { slipId: { in: ids } } });
        await tx.salarySlipLine.deleteMany({ where: { slipId: { in: ids } } });
        await tx.salarySlip.deleteMany({ where: { id: { in: ids } } });
      }
      return tx.payrollRun.update({ where: { id: run.id }, data: { status: 'CANCELLED' } });
    });
    res.json({ run: shape(updated) });
  }
);
