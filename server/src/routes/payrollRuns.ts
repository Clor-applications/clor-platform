import { Router } from 'express';
import { ownWorkRefusal } from '../services/makerChecker.js';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { calculateRun, daysBetween, eligibleEmployees, validateRun } from '../services/payroll/run.js';
import { isFeatureEnabled } from '../services/features.js';
import { recordAudit } from '../services/auditTrail.js';
import { closedMonths, daysBetween as datesBetween, periodRows } from '../services/attendance/days.js';
import { leaveLossOfPay } from '../services/attendance/payableDays.js';
import { requirePayrollStepUp } from '../services/stepUp.js';
import { emit as emitWebhook } from '../services/attendance/webhooks.js';

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
              overtimeHours: Number(inputByEmployee.get(m.employeeId)!.overtimeHours),
              /* Where the days came from (MANUAL, ATTENDANCE), and the attendance breakdown when they came from there. */
              source: inputByEmployee.get(m.employeeId)!.source,
              notes: inputByEmployee.get(m.employeeId)!.notes,
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
            overtimeHours: z.number().finite().min(0).max(744).optional(),
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
          ...(row.overtimeHours !== undefined ? { overtimeHours: row.overtimeHours } : {}),
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
          ...(row.overtimeHours !== undefined ? { overtimeHours: row.overtimeHours } : {}),
          notes: row.notes || null,
          source: 'MANUAL',
        },
      });
    }
    res.json({ ok: true, saved: parsed.data.inputs.length });
  }
);

/**
 * Days from Attendance. Payable days and loss of pay per person come from the
 * attendance summary for the pay period — the same figures as Attendance →
 * Month summary — instead of being typed in. Variable pay and overtime amounts
 * already entered are kept. Days entered by hand are kept too unless
 * `overwrite` is set: a correction somebody made on purpose is not silently
 * replaced. Days of the period still to come are counted as paid, and say so.
 */
payrollRunsRouter.post(
  '/orgs/:orgId/payroll/runs/:id/inputs/from-attendance',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const run = await runOr404(req, res);
    if (!run) return;
    if (!editable(run, res)) return;
    if (!(await isFeatureEnabled(accountId, orgId, 'attendance'))) {
      return res.status(409).json({ error: 'Attendance is not switched on for this company.', code: 'ATTENDANCE_DISABLED' });
    }
    const overwrite = req.body?.overwrite === true;
    const period = await payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: run.periodId } });
    if (!period) return res.status(409).json({ error: 'This run has no payroll period.' });

    const members = await payrollPrisma.payrollRunEmployee.findMany({ where: { orgId, runId: run.id, inclusion: 'INCLUDED' }, select: { employeeId: true } });
    const inRun = new Set(members.map((m) => m.employeeId));
    const rows = (await periodRows(accountId, orgId, datesBetween(period.startDate, period.endDate))).filter((r) => inRun.has(r.employeeId));
    const existing = new Map(
      (await payrollPrisma.payrollInput.findMany({ where: { orgId, runId: run.id } })).map((i) => [i.employeeId, i])
    );
    const workingDays = datesBetween(period.startDate, period.endDate).length;

    let saved = 0;
    const keptManual: string[] = [];
    const toResolve: Array<{ employeeId: string; name: string; incompleteDays: number }> = [];
    for (const r of rows) {
      const had = existing.get(r.employeeId);
      if (had && had.source === 'MANUAL' && !overwrite) {
        keptManual.push(r.employeeId);
        continue;
      }
      const lop = Number(r.lossOfPayDays) || 0;
      const payableDays = Math.max(0, r.totalDays - lop);
      if (r.incompleteDays) toResolve.push({ employeeId: r.employeeId, name: r.name, incompleteDays: r.incompleteDays });
      const parts = [
        r.absent ? `${r.absent} absent` : '',
        r.halfDays ? `${r.halfDays} half` : '',
        r.incompleteDays ? `${r.incompleteDays} no check-out` : '',
        r.unpaidLeaveDays ? `${r.unpaidLeaveDays} unpaid leave` : '',
        r.latePenaltyDays ? `${r.latePenaltyDays} late penalty` : '',
      ].filter(Boolean);
      const notes = [
        `From attendance: loss of pay ${lop}${parts.length ? ` (${parts.join(', ')})` : ''}.`,
        r.notYet ? `${r.notYet} days still to come counted as paid.` : '',
      ].filter(Boolean).join(' ').slice(0, 300);
      /* Approved overtime only, as hours: a component's formula prices it (OVERTIME_HOURS). */
      const overtimeHours = Math.round(((Number(r.approvedOvertimeMinutes) || 0) / 60) * 100) / 100;
      const days = { workingDays, payableDays, lwpDays: lop, overtimeHours, source: 'ATTENDANCE', notes };
      await payrollPrisma.payrollInput.upsert({
        where: { runId_employeeId: { runId: run.id, employeeId: r.employeeId } },
        create: { accountId, orgId, runId: run.id, employeeId: r.employeeId, ...days, createdByUserId: req.auth!.userId },
        /* Days only: variable pay and overtime amounts somebody entered stay. */
        update: days,
      });
      saved += 1;
    }
    const periodMonths = [...new Set(datesBetween(period.startDate, period.endDate).map((d) => d.slice(0, 7)))];
    const shut = await closedMonths(orgId, periodMonths);
    /* Which close of each month these figures match: the latest snapshot, kept when the month was closed. */
    const snaps = await peoplePrisma.attendanceMonthSnapshot.findMany({ where: { orgId, month: { in: periodMonths } }, orderBy: { version: 'desc' }, select: { month: true, version: true, createdAt: true } });
    const attendanceSnapshots = periodMonths.filter((m) => shut.has(m)).map((m) => snaps.find((x) => x.month === m)).filter(Boolean);
    res.json({
      attendanceSnapshots,
      ok: true,
      saved,
      keptManual: keptManual.length,
      /* Closed in Attendance, the figures cannot move after this; open, a correction there would not reach this run. */
      attendanceClosed: periodMonths.every((m) => shut.has(m)),
      /* People in the run Attendance has no figures for (not employed in the period per People, or not expected at work). */
      missing: [...inRun].filter((id) => !rows.some((r) => r.employeeId === id)).length,
      toResolve,
    });
  }
);

/**
 * Days from HR's leave, for a company that runs Payroll and People without
 * Attendance (founder, 22 Oct 2026: leave in step across the apps). Approved
 * unpaid leave in the pay period is loss of pay, counted from the day records
 * approval writes (a half day is half). With Attendance on, its month summary
 * already counts leave, so this sends the user there. Days typed by hand are
 * kept unless `overwrite`. Leave paid out in HR is listed for the run, not
 * paid silently.
 */
payrollRunsRouter.post(
  '/orgs/:orgId/payroll/runs/:id/inputs/from-leave',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const run = await runOr404(req, res);
    if (!run) return;
    if (!editable(run, res)) return;
    if (await isFeatureEnabled(accountId, orgId, 'attendance')) {
      return res.status(409).json({ error: 'Attendance is on: take the days from Attendance, which already counts leave.', code: 'USE_ATTENDANCE' });
    }
    if (!(await isFeatureEnabled(accountId, orgId, 'people'))) {
      return res.status(409).json({ error: 'People is not switched on, so there is no leave to take.', code: 'PEOPLE_DISABLED' });
    }
    const overwrite = req.body?.overwrite === true;
    const period = await payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: run.periodId } });
    if (!period) return res.status(409).json({ error: 'This run has no payroll period.' });
    const dates = datesBetween(period.startDate, period.endDate);
    const workingDays = dates.length;

    const members = (await payrollPrisma.payrollRunEmployee.findMany({ where: { orgId, runId: run.id, inclusion: 'INCLUDED' }, select: { employeeId: true } })).map((m) => m.employeeId);
    /* One calculation with People's month view (services/attendance/payableDays.ts), so HR checks the numbers payroll takes. */
    const unpaid = await leaveLossOfPay(orgId, members, period.startDate, period.endDate);
    const types = new Map((await peoplePrisma.leaveType.findMany({ where: { orgId }, select: { id: true, name: true } })).map((t) => [t.id, t]));
    const existing = new Map((await payrollPrisma.payrollInput.findMany({ where: { orgId, runId: run.id } })).map((i) => [i.employeeId, i]));

    let saved = 0;
    const keptManual: string[] = [];
    for (const employeeId of members) {
      const u = unpaid.get(employeeId);
      const had = existing.get(employeeId);
      if (!u && !had) continue;
      if (had && had.source === 'MANUAL' && !overwrite) {
        if (u) keptManual.push(employeeId);
        continue;
      }
      const lop = u ? Math.round(u.days * 100) / 100 : 0;
      /* What the person would be paid for before leave: the days already worked out for them, or the whole period. */
      const base = had && had.source !== 'MANUAL' ? Number(had.payableDays) + Number(had.lwpDays) : workingDays;
      const notes = lop ? `From leave: loss of pay ${lop} (${[...u!.names].join(', ')}).` : 'From leave: no unpaid leave.';
      const data = { workingDays: had ? Number(had.workingDays) : workingDays, payableDays: Math.max(0, base - lop), lwpDays: lop, source: 'LEAVE', notes };
      await payrollPrisma.payrollInput.upsert({
        where: { runId_employeeId: { runId: run.id, employeeId } },
        create: { accountId, orgId, runId: run.id, employeeId, ...data, createdByUserId: req.auth!.userId },
        update: data,
      });
      saved += 1;
    }
    /* Paid out in HR and not yet paid by a run: shown so the amount is added, never paid twice. */
    const year = Number(period.endDate.slice(0, 4));
    const encash = await peoplePrisma.leaveAdjustment.findMany({ where: { orgId, kind: 'ENCASH', paidInRunId: null, employeeId: { in: members }, year: { lte: year } }, select: { id: true, employeeId: true, days: true, leaveTypeId: true } });
    res.json({
      ok: true,
      saved,
      keptManual: keptManual.length,
      unpaidLeaveDays: [...unpaid.values()].reduce((a, u) => a + u.leaveDays, 0),
      encashments: encash.map((e) => ({ id: e.id, employeeId: e.employeeId, days: -e.days, leaveType: types.get(e.leaveTypeId)?.name || '' })),
    });
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
    /* Approving is what lets the money go: a fresh authenticator code, where the company asks for one. */
    path === 'approve' ? requirePayrollStepUp : (_req: any, _res: any, next: any) => next(),
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

      /* A-13: whoever prepared the run approves it only as the company's maker-checker setting allows. */
      if (to === 'APPROVED') {
        const refused = await ownWorkRefusal(req, { makers: [run.createdByUserId, run.submittedByUserId], module: PAYROLL_MODULE, resource: RESOURCE, entity: 'PAYROLL_RUN', entityId: run.id, what: 'payroll' });
        if (refused) return res.status(refused.status).json(refused.body);
      }

      /* Only from the state that was checked: two people acting at once cannot both move it. */
      const moved = await payrollPrisma.payrollRun.updateMany({
        where: { id: run.id, status: { in: from } },
        data: { status: to, ...stamp(req.auth!.userId, req.body || {}) },
      });
      if (moved.count !== 1) return res.status(409).json({ error: 'Somebody else has just changed this payroll. Reload it.', code: 'RUN_WRONG_STATUS' });
      const updated = await payrollPrisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
      res.json({ run: shape(updated) });
      /* Payslips are final: attendance for the period is settled, accounting can post (HR research: PayrollPeriodLocked). */
      if (to === 'LOCKED') emitWebhook(updated.orgId, 'payroll.locked', { runId: updated.id, number: updated.number, periodId: updated.periodId, status: updated.status, lockedAt: (updated as any).lockedAt ?? null });
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
    /* Locked is final: corrections go in a later run as adjustments, not by unmaking this one. */
    if (run.status === 'LOCKED') {
      return res.status(409).json({ error: 'This payroll is locked. Correct it with adjustments in the next run.', code: 'RUN_LOCKED' });
    }
    /* Undoing an approval is an approver's call, not anyone who can delete a draft. */
    const approved = run.status === 'APPROVED';
    if (approved) {
      if (await authorize(req, PAYROLL_MODULE, PermissionAction.APPROVE, RESOURCE)) {
        return res.status(403).json({ error: 'Only somebody who can approve payroll can cancel an approved one.', code: 'APPROVE_REQUIRED' });
      }
    }
    /* What is about to be removed, kept in the audit log for good. */
    const gone = await payrollPrisma.salarySlip.findMany({
      where: { orgId, runId: run.id },
      select: { number: true, employeeId: true, grossEarnings: true, totalDeductions: true, netPay: true },
      orderBy: { number: 'asc' },
    });

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
    await recordAudit(req, {
      entity: 'PAYROLL_RUN',
      entityId: run.id,
      action: 'CANCEL',
      message: `Payroll ${run.number || run.id} cancelled from ${run.status} (${gone.length} payslips removed)`,
      metadata: {
        fromStatus: run.status,
        slips: gone.map((x) => ({ number: x.number, employeeId: x.employeeId, gross: Number(x.grossEarnings), deductions: Number(x.totalDeductions), net: Number(x.netPay) })),
      },
    });
    res.json({ run: shape(updated) });
  }
);
