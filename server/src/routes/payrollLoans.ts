import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { PayrollLoanError, approveLoan, buildSchedule, summarise } from '../services/payroll/loan.js';

/**
 * Loans and salary advances.
 *
 * The lifecycle is deliberately slower than most things in payroll. A loan is
 * drafted, its schedule is shown, and only an approval writes that schedule and
 * starts taking money out of somebody's pay. Approving is the moment a future
 * deduction becomes real, so it is a separate act with its own permission.
 *
 * After that the loan is mostly read-only. Editing the terms of a loan that has
 * already recovered three instalments would silently restate what those
 * instalments were for; the ways to change one are to waive an instalment, to
 * skip one, or to close it early.
 */
export const payrollLoansRouter = Router();
payrollLoansRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.loans;

const handle = (res: any, e: unknown) => {
  if (e instanceof PayrollLoanError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

const shape = (l: any, extra: Record<string, unknown> = {}) => ({
  id: l.id,
  number: l.number,
  employeeId: l.employeeId,
  type: l.type,
  principal: Number(l.principal ?? 0),
  interestRate: Number(l.interestRate ?? 0),
  startDate: l.startDate,
  recoveryStartPeriodId: l.recoveryStartPeriodId || null,
  installmentCount: l.installmentCount ?? 0,
  installmentAmount: Number(l.installmentAmount ?? 0),
  outstandingBalance: Number(l.outstandingBalance ?? 0),
  recoveryComponentId: l.recoveryComponentId || null,
  status: l.status,
  notes: l.notes || '',
  approvedAt: l.approvedAt || null,
  createdAt: l.createdAt,
  ...extra,
});

const shapeInstallment = (i: any, extra: Record<string, unknown> = {}) => ({
  id: i.id,
  sequence: i.sequence,
  periodId: i.periodId || null,
  dueAmount: Number(i.dueAmount ?? 0),
  principalAmount: Number(i.principalAmount ?? 0),
  interestAmount: Number(i.interestAmount ?? 0),
  status: i.status,
  slipId: i.slipId || null,
  recoveredAt: i.recoveredAt || null,
  ...extra,
});

payrollLoansRouter.get(
  '/orgs/:orgId/payroll/loans',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const employeeId = String(req.query.employeeId || '').trim();
    const status = String(req.query.status || '').trim();

    const rows = await payrollPrisma.payrollLoan.findMany({
      where: { accountId, orgId, ...(employeeId ? { employeeId } : {}), ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    const ids = [...new Set(rows.map((r) => r.employeeId))];
    const people = ids.length
      ? await peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true } })
      : [];
    const byPerson = new Map(people.map((p) => [p.id, p]));

    res.json({
      loans: rows.map((r) =>
        shape(r, {
          employeeName: byPerson.get(r.employeeId)?.name || 'Unknown employee',
          employeeCode: byPerson.get(r.employeeId)?.code || '',
        })
      ),
    });
  }
);

payrollLoansRouter.get(
  '/orgs/:orgId/payroll/loans/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const loan = await payrollPrisma.payrollLoan.findFirst({
      where: { accountId, orgId, id: String(req.params.id) },
      include: { installments: { orderBy: { sequence: 'asc' } } },
    });
    if (!loan) return res.status(404).json({ error: 'No such loan.' });

    const [person, periods, component, slips] = await Promise.all([
      peoplePrisma.employee.findFirst({ where: { orgId, id: loan.employeeId }, select: { name: true, code: true } }),
      payrollPrisma.payrollPeriod.findMany({ where: { orgId }, select: { id: true, name: true } }),
      loan.recoveryComponentId
        ? payrollPrisma.salaryComponent.findFirst({ where: { orgId, id: loan.recoveryComponentId }, select: { name: true } })
        : Promise.resolve(null),
      payrollPrisma.salarySlip.findMany({
        where: { orgId, id: { in: loan.installments.map((i) => i.slipId).filter(Boolean) as string[] } },
        select: { id: true, number: true },
      }),
    ]);
    const byPeriod = new Map(periods.map((p) => [p.id, p.name]));
    const bySlip = new Map(slips.map((s) => [s.id, s.number]));

    res.json({
      loan: shape(loan, {
        employeeName: person?.name || 'Unknown employee',
        employeeCode: person?.code || '',
        recoveryComponentName: component?.name || '',
        ...summarise(loan, loan.installments),
        installments: loan.installments.map((i) =>
          shapeInstallment(i, {
            periodName: i.periodId ? byPeriod.get(i.periodId) || '' : '',
            slipNumber: i.slipId ? bySlip.get(i.slipId) || '' : '',
          })
        ),
      }),
    });
  }
);

/** The schedule a loan would have, before one exists. */
payrollLoansRouter.post(
  '/orgs/:orgId/payroll/loans/schedule-preview',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;

    const schema = z.object({
      principal: z.number().finite().positive(),
      interestRate: z.number().finite().min(0).max(100).default(0),
      installmentCount: z.number().int().positive().max(600),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid loan terms.' });

    try {
      const schedule = buildSchedule({
        principal: parsed.data.principal,
        annualInterestRate: parsed.data.interestRate,
        installmentCount: parsed.data.installmentCount,
      });
      res.json({
        schedule,
        total: schedule.reduce((t, r) => t + r.dueAmount, 0),
        interest: schedule.reduce((t, r) => t + r.interestAmount, 0),
      });
    } catch (e) {
      return handle(res, e);
    }
  }
);

const body = z.object({
  employeeId: z.string().trim().min(1, 'Say who this is for.'),
  type: z.enum(['LOAN', 'SALARY_ADVANCE']).default('LOAN'),
  principal: z.number().finite().positive('A loan of nothing has nothing to recover.'),
  interestRate: z.number().finite().min(0).max(100).default(0),
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'The start date must be a date.'),
  recoveryStartPeriodId: z.string().trim().min(1, 'Say which month recovery starts in.'),
  installmentCount: z.number().int().positive('Say how many instalments this is recovered over.').max(600),
  recoveryComponentId: z.string().trim().min(1, 'Say which deduction this appears as on a payslip.'),
  notes: z.string().trim().max(500).optional().nullable(),
});

async function check(orgId: string, payload: z.infer<typeof body>) {
  const [employee, period, component] = await Promise.all([
    peoplePrisma.employee.findFirst({ where: { orgId, id: payload.employeeId }, select: { id: true } }),
    payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: payload.recoveryStartPeriodId }, select: { id: true, name: true, isLocked: true } }),
    payrollPrisma.salaryComponent.findFirst({
      where: { orgId, id: payload.recoveryComponentId },
      select: { id: true, type: true, isActive: true, name: true },
    }),
  ]);

  if (!employee) return { ok: false as const, error: 'No such employee.', status: 404 };
  if (!period) return { ok: false as const, error: 'No such payroll period.', status: 404 };
  if (period.isLocked) {
    return { ok: false as const, error: `${period.name} is closed. Start recovery in an open month.`, status: 409, code: 'PERIOD_LOCKED' };
  }
  if (!component) return { ok: false as const, error: 'No such salary component.', status: 404 };
  if (!component.isActive) return { ok: false as const, error: `${component.name} is no longer in use.`, status: 409 };
  /* A recovery takes money off somebody's pay, so it has to be a deduction. An
     earning here would pay them their own loan back every month. */
  if (component.type !== 'DEDUCTION') {
    return {
      ok: false as const,
      error: `${component.name} is not a deduction, so a recovery against it would not come off anybody's pay.`,
      status: 409,
      code: 'NOT_A_DEDUCTION',
    };
  }
  return { ok: true as const };
}

payrollLoansRouter.post(
  '/orgs/:orgId/payroll/loans',
  requirePermission(PAYROLL_MODULE, PermissionAction.CREATE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId, branchId } = req.tenant!;

    const parsed = body.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid loan.' });

    const checked = await check(orgId, parsed.data);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error, code: checked.code });

    const count = await payrollPrisma.payrollLoan.count({ where: { orgId } });
    const number = `LN-${parsed.data.startDate.slice(0, 4)}-${String(count + 1).padStart(4, '0')}`;

    const row = await payrollPrisma.payrollLoan.create({
      data: {
        accountId,
        orgId,
        branchId: branchId || null,
        number,
        employeeId: parsed.data.employeeId,
        type: parsed.data.type,
        principal: parsed.data.principal,
        interestRate: parsed.data.interestRate,
        startDate: parsed.data.startDate,
        recoveryStartPeriodId: parsed.data.recoveryStartPeriodId,
        installmentCount: parsed.data.installmentCount,
        recoveryComponentId: parsed.data.recoveryComponentId,
        /* Nothing is owed until somebody approves it. The schedule, the
           instalment and the balance are all written at approval. */
        outstandingBalance: 0,
        status: 'DRAFT',
        notes: parsed.data.notes?.trim() || null,
        createdByUserId: req.auth!.userId,
      },
    });

    res.status(201).json({ loan: shape(row) });
  }
);

payrollLoansRouter.put(
  '/orgs/:orgId/payroll/loans/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.payrollLoan.findFirst({ where: { accountId, orgId, id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'No such loan.' });
    if (existing.status !== 'DRAFT') {
      return res.status(409).json({
        error: 'Only a draft can be changed. A loan being recovered has instalments behind it that the new terms would not match.',
        code: 'LOAN_NOT_DRAFT',
      });
    }

    const parsed = body.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid loan.' });

    const checked = await check(orgId, parsed.data);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error, code: checked.code });

    const row = await payrollPrisma.payrollLoan.update({
      where: { id: existing.id },
      data: {
        employeeId: parsed.data.employeeId,
        type: parsed.data.type,
        principal: parsed.data.principal,
        interestRate: parsed.data.interestRate,
        startDate: parsed.data.startDate,
        recoveryStartPeriodId: parsed.data.recoveryStartPeriodId,
        installmentCount: parsed.data.installmentCount,
        recoveryComponentId: parsed.data.recoveryComponentId,
        notes: parsed.data.notes?.trim() || null,
      },
    });
    res.json({ loan: shape(row) });
  }
);

/** Write the schedule and start taking the money. */
payrollLoansRouter.post(
  '/orgs/:orgId/payroll/loans/:id/approve',
  requirePermission(PAYROLL_MODULE, PermissionAction.APPROVE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    try {
      const loan = await approveLoan({ accountId, orgId, userId: req.auth!.userId, loanId: String(req.params.id) });
      res.json({ loan: shape(loan, { installments: (loan as any).installments?.map(shapeInstallment) || [] }) });
    } catch (e) {
      return handle(res, e);
    }
  }
);

/**
 * Skip an instalment, or write one off.
 *
 * Skipping moves it out of the way without forgiving it — the loan simply runs
 * a month longer. Waiving forgives it, and reduces what is owed. They are
 * different decisions and neither should be reachable by accident, so both go
 * through the same explicit route rather than an editable status field.
 */
payrollLoansRouter.post(
  '/orgs/:orgId/payroll/loans/:id/installments/:installmentId',
  requirePermission(PAYROLL_MODULE, PermissionAction.APPROVE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const schema = z.object({ action: z.enum(['SKIP', 'WAIVE', 'RESTORE']) });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Say whether to skip, waive or restore it.' });

    const installment = await payrollPrisma.payrollLoanInstallment.findFirst({
      where: { accountId, orgId, id: String(req.params.installmentId), loanId: String(req.params.id) },
    });
    if (!installment) return res.status(404).json({ error: 'No such instalment.' });
    if (installment.status === 'RECOVERED') {
      return res.status(409).json({
        error: 'This instalment has already come out of a payslip, so it is a record rather than a plan.',
        code: 'INSTALMENT_RECOVERED',
      });
    }

    const next = parsed.data.action === 'RESTORE' ? 'PENDING' : parsed.data.action === 'SKIP' ? 'SKIPPED' : 'WAIVED';

    const loan = await payrollPrisma.$transaction(async (tx) => {
      await tx.payrollLoanInstallment.update({ where: { id: installment.id }, data: { status: next } });
      const installments = await tx.payrollLoanInstallment.findMany({ where: { orgId, loanId: installment.loanId } });
      const left = installments.filter((i) => i.status === 'PENDING');
      /* A skipped instalment is still owed, so it stays in the outstanding; a
         waived one is forgiven and comes out of it. */
      const outstanding = installments
        .filter((i) => ['PENDING', 'SKIPPED'].includes(i.status))
        .reduce((t, i) => t + Number(i.dueAmount), 0);
      return tx.payrollLoan.update({
        where: { id: installment.loanId },
        data: {
          outstandingBalance: Math.round((outstanding + Number.EPSILON) * 100) / 100,
          status: left.length || installments.some((i) => i.status === 'SKIPPED') ? 'ACTIVE' : 'COMPLETED',
        },
      });
    });

    res.json({ loan: shape(loan) });
  }
);

payrollLoansRouter.post(
  '/orgs/:orgId/payroll/loans/:id/cancel',
  requirePermission(PAYROLL_MODULE, PermissionAction.APPROVE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const loan = await payrollPrisma.payrollLoan.findFirst({
      where: { accountId, orgId, id: String(req.params.id) },
      include: { installments: true },
    });
    if (!loan) return res.status(404).json({ error: 'No such loan.' });
    if (loan.installments.some((i) => i.status === 'RECOVERED')) {
      return res.status(409).json({
        error: 'Money has already been recovered against this loan. Waive what is left rather than cancelling it.',
        code: 'LOAN_PARTLY_RECOVERED',
      });
    }

    const row = await payrollPrisma.$transaction(async (tx) => {
      await tx.payrollLoanInstallment.deleteMany({ where: { loanId: loan.id } });
      return tx.payrollLoan.update({ where: { id: loan.id }, data: { status: 'CANCELLED', outstandingBalance: 0 } });
    });
    res.json({ loan: shape(row) });
  }
);
