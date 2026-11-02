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
import { calculateRun, daysBetween, eligibleEmployees, ptAlreadyTakenElsewhere, ptTakenElsewhereGone, validateRun } from '../services/payroll/run.js';
import { checksSentence, uncheckedRulesOnRun } from '../services/payroll/statutory/resolve.js';
import { isFeatureEnabled } from '../services/features.js';
import { recordAudit } from '../services/auditTrail.js';
import { periodRows } from '../services/attendance/days.js';
import { leaveLossOfPay } from '../services/attendance/payableDays.js';
import { provisionalWarning, snapshotChange, snapshotRows, takenMonths } from '../services/payroll/attendanceSnapshots.js';
import { runLopCheck } from '../services/payroll/readinessTower.js';
import { catchUpLatePenalties, correctProvisionalDays, cutoffDateFor, lateMarkMonthsOwed, ordinal, provisionalMessage, provisionalPeriodRows, provisionalSetting } from '../services/payroll/provisionalDays.js';
import { CarryTakenError, RunBusyError, RunNotEditableError, RunSourcesMovedError, carriesTakenElsewhere, leaseFree, rederiveLoans, runStale, undoCarries } from '../services/payroll/run.js';
import { capMessage } from '../services/payroll/deductionCap.js';
import { Prisma } from '../generated/payroll/index.js';
import { requirePayrollStepUp } from '../services/stepUp.js';
import { emit as emitWebhook } from '../services/attendance/webhooks.js';
import { eachDay } from '../utils/istDate.js';

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
  /* Which Attendance month closes the days were taken from (O-04): [{ month, version, closed }]. */
  attendanceSnapshots: row.attendanceSnapshots ?? null,
  /* Days after the company's cut-off counted as present (payrollProvisionalDays): { cutoffDate, from, to, people, days }, and the sentence the run screen shows. */
  provisionalDays: row.provisionalDays ?? null,
  provisionalMessage: row.provisionalDays && (row.provisionalDays as any).people ? provisionalMessage(row.provisionalDays as any) : null,
  /* Deductions held to the legal share of wages (deductionCap.ts): { percent, people, carried }, and the sentence. */
  deductionCap: row.deductionCap ?? null,
  deductionCapMessage: row.deductionCap ? capMessage(row.deductionCap as any) : null,
  /* People whose entered deductions pass the share of wages on their own, and the recorded reason they stand (null until given). */
  overLimit: overLimitOf(row),
  createdAt: row.createdAt,
  ...extra,
});

/** The over-limit decision a calculation saved on the run: { people, reason, by, at }, or null when nobody passes the limit. */
function overLimitOf(row: any) {
  const c = row?.deductionCap as any;
  const people = Array.isArray(c?.overLimit) ? c.overLimit : [];
  if (!people.length) return null;
  return { people, reason: c.overLimitReason?.reason ?? null, by: c.overLimitReason?.userId ?? null, at: c.overLimitReason?.at ?? null };
}

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
      run: { ...shape(run, { period }), stale: await runStale(orgId, run) },
      /* State rules on these payslips nobody has confirmed: the run cannot be approved until they are. */
      statutoryChecks: slips.length ? await uncheckedRulesOnRun(orgId, run.id) : [],
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
              /* Days after the cut-off counted as present before they happened. */
              provisionalDays: Number(inputByEmployee.get(m.employeeId)!.provisionalDays ?? 0),
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
          /* Typed days are a decision, not an assumption: nothing for next month to correct. */
          provisionalDays: 0,
          provisionalDates: Prisma.DbNull,
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
    /* Closed in Attendance: the figures saved when each month was closed (O-04). Open: today's, said to be provisional. */
    const fromSnapshot = await snapshotRows(orgId, period.startDate, period.endDate);
    /* Paying before the month ends (payrollProvisionalDays, O-11): live figures to the cut-off, the days after it counted as present. */
    const setting = fromSnapshot ? null : await provisionalSetting(accountId, orgId);
    const cutoffDate = setting?.enabled ? cutoffDateFor(period, setting.cutoffDay) : null;
    const provisional = cutoffDate ? await provisionalPeriodRows(accountId, orgId, period.startDate, period.endDate, cutoffDate) : null;
    const rows = (fromSnapshot ? fromSnapshot.rows : provisional ? provisional.rows : await periodRows(accountId, orgId, eachDay(period.startDate, period.endDate))).filter((r: any) => inRun.has(r.employeeId));
    /* Late-mark penalties (People, attendance/markRules.ts): taken only once HR applied or waived them, never guessed. */
    if (!fromSnapshot) {
      const { undecidedIn } = await import('../services/attendance/markRules.js');
      /* Paid before the month ends (cut-off): only months that have ended by the cut-off are decided now. */
      const undecided = await undecidedIn(accountId, orgId, eachDay(period.startDate, cutoffDate && cutoffDate < period.endDate ? cutoffDate : period.endDate), [...inRun]);
      /* And the months an earlier run's cut-off left uncharged, which this pull charges (catchUpLatePenalties). */
      for (const owed of await lateMarkMonthsOwed(orgId, period, [...inRun])) {
        const { daysOfMonth } = await import('../services/attendance/days.js');
        undecided.push(...(await undecidedIn(accountId, orgId, daysOfMonth(owed.month), owed.employeeIds)));
      }
      if (undecided.length) {
        const names = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: undecided.map((u) => u.employeeId) } }, select: { name: true } });
        const month = undecided[0].month;
        const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        return res.status(409).json({ error: `Late-mark penalties for ${label} are not applied or waived for ${names[0]?.name || 'someone'}${names.length > 1 ? ` and ${names.length - 1} more` : ''}. Apply or waive them in People, Time, Late marks, then take attendance again.`, code: 'PENALTIES_UNDECIDED', month, link: { app: 'people', screen: 'lateMarks', params: { month } } });
      }
    }
    const existing = new Map(
      (await payrollPrisma.payrollInput.findMany({ where: { orgId, runId: run.id } })).map((i) => [i.employeeId, i])
    );
    const workingDays = eachDay(period.startDate, period.endDate).length;

    let saved = 0;
    const keptManual: string[] = [];
    const toResolve: Array<{ employeeId: string; name: string; incompleteDays: number }> = [];
    const assumed = { people: 0, days: 0 };
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
        r.provisionalDays ? `${r.provisionalDays} ${r.provisionalDays === 1 ? 'day' : 'days'} after the ${ordinal(Number(cutoffDate!.slice(8, 10)))} counted as present.` : '',
      ].filter(Boolean).join(' ').slice(0, 300);
      /* Approved overtime only, as hours: a component's formula prices it (OVERTIME_HOURS). */
      const overtimeHours = Math.round(((Number(r.approvedOvertimeMinutes) || 0) / 60) * 100) / 100;
      /* What was assumed after the cut-off, for next month's pull to compare with what happened. None without the feature. */
      const assumedDates = provisional && Array.isArray(r.provisionalDates) && r.provisionalDates.length ? r.provisionalDates : null;
      if (r.provisionalDays) {
        assumed.people += 1;
        assumed.days += Number(r.provisionalDays);
      }
      const days = {
        workingDays, payableDays, lwpDays: lop, overtimeHours, source: 'ATTENDANCE', notes,
        provisionalDays: Number(r.provisionalDays) || 0,
        provisionalDates: assumedDates ?? Prisma.DbNull,
      };
      await payrollPrisma.payrollInput.upsert({
        where: { runId_employeeId: { runId: run.id, employeeId: r.employeeId } },
        create: { accountId, orgId, runId: run.id, employeeId: r.employeeId, ...days, createdByUserId: req.auth!.userId },
        /* Days only: variable pay and overtime amounts somebody entered stay. */
        update: days,
      });
      saved += 1;
    }
    /* Which close of each month these figures match, kept on the run so approve and lock can tell if a month moved since. */
    const taken = await takenMonths(orgId, period.startDate, period.endDate);
    const provisionalDays = provisional && cutoffDate ? { cutoffDate, from: provisional.windowFrom, to: provisional.windowTo, people: assumed.people, days: Math.round(assumed.days * 100) / 100 } : null;
    await payrollPrisma.payrollRun.update({ where: { id: run.id }, data: { attendanceSnapshots: taken as any, provisionalDays: provisionalDays ?? Prisma.DbNull } });
    /* Last month's assumed days against what happened, booked as corrections in this period (nothing when no earlier run assumed any). */
    const corrections = await correctProvisionalDays({ accountId, orgId, run, period, employeeIds: [...inRun], userId: req.auth!.userId });
    /* Late-mark penalties for a month whose last day fell after an earlier run's cut-off: charged here, once. */
    const latePenalties = await catchUpLatePenalties({ accountId, orgId, run, period, employeeIds: [...inRun], userId: req.auth!.userId });
    const openMonths = taken.filter((t) => !t.closed).map((t) => t.month);
    res.json({
      attendanceSnapshots: taken.filter((t) => t.closed),
      /* SNAPSHOT: the closed months' saved figures. LIVE: today's (a month open, or a period that is not whole months). */
      figuresFrom: fromSnapshot ? 'SNAPSHOT' : 'LIVE',
      provisional: openMonths.length > 0,
      openMonths,
      warning: openMonths.length ? provisionalWarning(openMonths) : null,
      ok: true,
      saved,
      keptManual: keptManual.length,
      /* Closed in Attendance, the figures cannot move after this; open, a correction there would not reach this run. */
      attendanceClosed: openMonths.length === 0,
      /* People in the run Attendance has no figures for (not employed in the period per People, or not expected at work). */
      missing: [...inRun].filter((id) => !rows.some((r) => r.employeeId === id)).length,
      toResolve,
      provisionalDays,
      provisionalMessage: provisionalDays?.people ? provisionalMessage(provisionalDays) : null,
      /* Corrections booked for days an earlier run counted as present. */
      corrections: corrections.filter((c) => c.type),
      /* Late-mark penalties caught up from a month an earlier cut-off left uncharged. */
      latePenalties: latePenalties.filter((p) => p.amount > 0 || p.status === 'NONE'),
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
    const dates = eachDay(period.startDate, period.endDate);
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
      const data = { workingDays: had ? Number(had.workingDays) : workingDays, payableDays: Math.max(0, base - lop), lwpDays: lop, source: 'LEAVE', notes, provisionalDays: 0, provisionalDates: Prisma.DbNull };
      await payrollPrisma.payrollInput.upsert({
        where: { runId_employeeId: { runId: run.id, employeeId } },
        create: { accountId, orgId, runId: run.id, employeeId, ...data, createdByUserId: req.auth!.userId },
        update: data,
      });
      saved += 1;
    }
    /* Paid out in HR and not yet paid by a run: shown so the amount is added, never paid twice. */
    const year = Number(period.endDate.slice(0, 4));
    const encash = await peoplePrisma.leaveAdjustment.findMany({ where: { orgId, kind: 'ENCASH', paidInRunId: null, reversedAt: null, employeeId: { in: members }, year: { lte: year } }, select: { id: true, employeeId: true, days: true, leaveTypeId: true } });
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

/**
 * The loss-of-pay cross-check for the run review (O-06): per person, approved
 * unpaid leave, loss of pay on the day records, and loss of pay on the run,
 * listed where they do not agree. Locking refuses while any are listed,
 * unless somebody acknowledges them with a reason.
 */
payrollRunsRouter.get(
  '/orgs/:orgId/payroll/runs/:id/lop-check',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const run = await runOr404(req, res);
    if (!run) return;
    const check = await runLopCheck(accountId, orgId, run.id);
    /* Whether the days were taken from months still open, and whether a month has moved since (O-04). */
    const taken = Array.isArray(run.attendanceSnapshots) ? (run.attendanceSnapshots as Array<{ month: string; closed: boolean }>) : [];
    const openMonths = taken.filter((t) => t && !t.closed).map((t) => t.month);
    const changed = await snapshotChange(orgId, run.attendanceSnapshots);
    res.json({
      ...check,
      provisional: openMonths.length > 0,
      openMonths,
      warning: openMonths.length ? provisionalWarning(openMonths) : null,
      snapshotChanged: changed,
    });
  }
);

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
    /* The over-limit warnings come from the calculation, not from validating: kept in the count until it is worked out again. */
    const warnings = issues.filter((i) => i.severity === 'WARNING').length + (overLimitOf(run)?.people.length || 0);
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

    let calculated;
    try {
      calculated = await calculateRun(orgId, run.id, req.auth!.userId);
    } catch (e) {
      if (e instanceof CarryTakenError || e instanceof RunBusyError || e instanceof RunNotEditableError) return res.status(409).json({ error: e.message, code: e.code });
      /* Something it takes kept being settled while it was worked out (three tries). */
      if (e instanceof RunSourcesMovedError) return res.status(409).json({ error: 'A full and final for somebody in this payroll was paid while it was being calculated. Calculate again.', code: e.code });
      throw e;
    }
    const { slips, issues } = calculated;
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

/*
 * Why entered deductions past the share of wages stand (a signed agreement,
 * an order): recorded on the run and in the audit log, and then the payroll
 * can be sent for review and approved. Calculating again asks again.
 */
payrollRunsRouter.post(
  '/orgs/:orgId/payroll/runs/:id/over-limit-reason',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const run = await runOr404(req, res);
    if (!run) return;
    if (!['CALCULATED', 'REVIEW'].includes(run.status)) return res.status(409).json({ error: 'Only a calculated payroll takes a reason.', code: 'RUN_WRONG_STATUS' });
    const over = overLimitOf(run);
    if (!over) return res.status(409).json({ error: 'No deductions pass the limit on this payroll.', code: 'NOT_OVER_LIMIT' });
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (reason.length < 5) return res.status(400).json({ error: 'Say why these deductions stand, e.g. "Signed damage agreement, 12 Jun".', code: 'REASON_NEEDED' });
    const cap = { ...(run.deductionCap as any), overLimitReason: { reason, userId: req.auth!.userId, at: new Date().toISOString() } };
    /* Against the calculation it was given for: a recalculation in between replaces the figures, and this reason with them. */
    const moved = await payrollPrisma.payrollRun.updateMany({ where: { id: run.id, calculatedAt: run.calculatedAt, status: run.status }, data: { deductionCap: cap } });
    if (!moved.count) return res.status(409).json({ error: 'This payroll has just been worked out again. Reload it.', code: 'RUN_CHANGED' });
    await recordAudit(req, {
      entity: 'PAYROLL_RUN',
      entityId: run.id,
      action: 'OVER_LIMIT_REASON',
      message: `Payroll ${run.number || run.id}: deductions past the share of wages stand for ${over.people.length}: ${reason}`,
      metadata: { reason, people: over.people },
    });
    res.json({ run: shape(await payrollPrisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } })) });
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

      /* Entered deductions past the share of wages: not sent on or approved until reduced, or until somebody records why they stand. */
      if (to === 'REVIEW' || to === 'APPROVED') {
        const over = overLimitOf(run);
        if (over && !over.reason) {
          return res.status(409).json({
            error: `Deductions pass ${over.people[0].percent}% of wages for ${over.people.length} ${over.people.length === 1 ? 'person' : 'people'}: ${over.people.map((p: any) => p.name).join(', ')}. Reduce them and calculate again, or record why they stand.`,
            code: 'DEDUCTIONS_OVER_LIMIT',
            overLimit: over,
          });
        }
      }

      /*
       * State rules CLOR could not confirm: a run under them is calculated and
       * previewed, never approved, until somebody confirms or corrects each
       * one against the state's notice (Payroll › Compliance).
       */
      if (to === 'APPROVED') {
        const checks = await uncheckedRulesOnRun(run.orgId, run.id);
        if (checks.length) {
          return res.status(409).json({
            error: `This payroll uses figures CLOR could not confirm from an official notice: ${checksSentence(checks)}. Confirm ${checks.length === 1 ? 'it' : 'each'} in Payroll › Compliance, or correct it there and calculate again.`,
            code: 'RULE_NEEDS_CHECK',
            checks,
          });
        }
      }

      /* PT another approved run already took for the same person and month: taken twice unless calculated again. */
      if (to === 'APPROVED') {
        const twice = await ptAlreadyTakenElsewhere(run.orgId, run);
        if (twice.length) {
          return res.status(409).json({
            error: `Professional tax for ${twice[0].month} was already taken by another approved payroll for ${twice.map((t) => t.name).join(', ')}. Calculate this payroll again; it will then take none for ${twice.length === 1 ? 'them' : 'those people'}.`,
            code: 'PT_ALREADY_TAKEN',
            people: twice,
          });
        }
      }

      /* Nil PT because another run took the month's: that run must still stand, or this goes out with no PT at all. */
      if (to === 'APPROVED') {
        const gone = await ptTakenElsewhereGone(run.orgId, run);
        if (gone.length) {
          return res.status(409).json({
            error: `${gone.length === 1 ? 'One person has' : `${gone.length} people have`} no professional tax on this payroll because another payroll for the month had taken it, and that payroll is no longer approved. Calculate this payroll again.`,
            code: 'PT_TAKEN_ELSEWHERE_GONE',
            employeeIds: gone,
          });
        }
      }

      /* Figures older than what they were worked out from (QA of #82, F4): calculated again first. */
      if (to === 'REVIEW' || to === 'APPROVED') {
        const stale = await runStale(run.orgId, run);
        if (stale) return res.status(409).json({ error: stale, code: 'RUN_STALE' });
      }

      /* O-04: a closed Attendance month the days were taken from has been reopened, or closed again, since the pull. */
      if (to === 'APPROVED' || to === 'LOCKED') {
        const changed = await snapshotChange(run.orgId, run.attendanceSnapshots);
        if (changed) return res.status(409).json({ error: changed.message, code: 'SNAPSHOT_CHANGED', month: changed.month, reason: changed.reason });
      }

      /* O-06: loss of pay that leave, the days and the run do not agree on is locked only when somebody says why. */
      let lopAcknowledged: { reason: string; mismatches: unknown[] } | null = null;
      if (to === 'LOCKED') {
        const { mismatches } = await runLopCheck(run.accountId, run.orgId, run.id);
        if (mismatches.length) {
          const reason = String(req.body?.reason || '').trim().slice(0, 300);
          if (req.body?.acknowledge !== true) {
            return res.status(409).json({
              error: `Loss of pay does not agree for ${mismatches.length} ${mismatches.length === 1 ? 'person' : 'people'}: leave, the days and this payroll say different things. Correct it, or lock with a reason.`,
              code: 'LOP_MISMATCH',
              mismatches,
            });
          }
          if (reason.length < 5) return res.status(400).json({ error: 'Say why this payroll is locked with loss of pay that does not agree. It goes in the audit log.', code: 'REASON_NEEDED', mismatches });
          lopAcknowledged = { reason, mismatches };
        }
      }

      /* A-13: whoever prepared the run approves it only as the company's maker-checker setting allows. */
      if (to === 'APPROVED') {
        const refused = await ownWorkRefusal(req, { makers: [run.createdByUserId, run.submittedByUserId], module: PAYROLL_MODULE, resource: RESOURCE, entity: 'PAYROLL_RUN', entityId: run.id, what: 'payroll' });
        if (refused) return res.status(refused.status).json(refused.body);
      }

      /*
       * Only from the state that was checked: two people acting at once
       * cannot both move it. Sent on or approved only on the calculation that
       * was checked: one in between replaced the figures and cleared any
       * over-limit reason, so it is checked again.
       */
      const moved = await payrollPrisma.payrollRun.updateMany({
        where: { id: run.id, status: { in: from }, ...(to === 'REVIEW' || to === 'APPROVED' ? { calculatedAt: run.calculatedAt } : {}) },
        data: { status: to, ...stamp(req.auth!.userId, req.body || {}) },
      });
      if (moved.count !== 1) return res.status(409).json({ error: 'Somebody else has just changed this payroll. Reload it.', code: 'RUN_WRONG_STATUS' });
      const updated = await payrollPrisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
      if (lopAcknowledged) {
        await recordAudit(req, {
          entity: 'PAYROLL_RUN',
          entityId: run.id,
          action: 'LOCK_LOP_ACKNOWLEDGED',
          message: `Payroll ${run.number || run.id} locked with loss of pay not agreeing for ${lopAcknowledged.mismatches.length}: ${lopAcknowledged.reason}`,
          metadata: { reason: lopAcknowledged.reason, mismatches: lopAcknowledged.mismatches },
        });
      }
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
    /* What this payroll carried forward, a later one has taken: that one stands on this. */
    if (await carriesTakenElsewhere(orgId, run.id)) {
      return res.status(409).json({ error: 'A later payroll has already taken a deduction this one carried forward. Cancel that payroll first.', code: 'CARRY_TAKEN' });
    }
    /* What is about to be removed, kept in the audit log for good. */
    const gone = await payrollPrisma.salarySlip.findMany({
      where: { orgId, runId: run.id },
      select: { number: true, employeeId: true, grossEarnings: true, totalDeductions: true, netPay: true },
      orderBy: { number: 'asc' },
    });

    let updated;
    try {
      updated = await payrollPrisma.$transaction(async (tx) => {
        /*
         * Not while it is being calculated (run.ts calculateRun's lease). The
         * row stays locked until this commits, so a calculation starting now
         * waits, then finds the run cancelled and writes nothing.
         */
        const free = await tx.payrollRun.updateMany({ where: { orgId, id: run.id, ...leaseFree() }, data: { calcLeaseToken: null, calcLeaseUntil: null } });
        if (!free.count) throw new RunBusyError('This payroll is being calculated right now. Try again in a minute.');
        const slips = await tx.salarySlip.findMany({ where: { orgId, runId: run.id }, select: { id: true } });
        const ids = slips.map((s) => s.id);
        /*
         * What the payslips took goes back to being owed: carried deductions
         * back on what they came from, instalments to pending, one-off
         * adjustments to approved, so the next payroll takes them.
         */
        const undone = await undoCarries(tx, orgId, run.id);
        const instalments = ids.length ? await tx.payrollLoanInstallment.findMany({ where: { orgId, slipId: { in: ids } }, select: { loanId: true } }) : [];
        if (ids.length) await tx.payrollLoanInstallment.updateMany({ where: { orgId, slipId: { in: ids }, status: 'RECOVERED' }, data: { status: 'PENDING', slipId: null, recoveredAt: null } });
        await tx.payrollAdjustment.updateMany({ where: { orgId, consumedByRunId: run.id, status: 'CONSUMED' }, data: { status: 'APPROVED', consumedByRunId: null } });
        await rederiveLoans(tx, orgId, [...undone.loanIds, ...instalments.map((i) => i.loanId)]);
        if (ids.length) {
          await tx.payrollCalculationTrace.deleteMany({ where: { slipId: { in: ids } } });
          await tx.salarySlipLine.deleteMany({ where: { slipId: { in: ids } } });
          await tx.salarySlip.deleteMany({ where: { id: { in: ids } } });
        }
        return tx.payrollRun.update({ where: { id: run.id }, data: { status: 'CANCELLED', deductionCap: Prisma.DbNull } });
      });
    } catch (e) {
      if (e instanceof RunBusyError || e instanceof CarryTakenError) return res.status(409).json({ error: e.message, code: e.code });
      throw e;
    }
    /* Leave paid out by these payslips is owed again (the earning is canonical; see calculateRun). */
    await peoplePrisma.leaveAdjustment.updateMany({ where: { orgId, paidInRunId: run.id }, data: { paidInRunId: null } });
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
