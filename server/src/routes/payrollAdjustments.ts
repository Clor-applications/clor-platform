import { Router } from 'express';
import { ownRecordRefusal, ownWorkRefusal } from '../services/makerChecker.js';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma, peopleWrite } from '../utils/peoplePrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { valueEncashments } from '../services/attendance/leaveEncashment.js';
import { forLiveEmployee } from '../services/payroll/employeeLock.js';

/**
 * One-off earnings and deductions: a bonus, an arrear, a fine, a recovery.
 *
 * These are deliberately not part of a salary structure. A structure says what
 * somebody is on, and is shared by everybody on it; an adjustment says what
 * happened to one person in one month. Folding a bonus into a structure would
 * make the same structure pay different amounts to different people, which is
 * how a structure stops meaning anything.
 *
 * Three rules shape this router:
 *
 *   An adjustment belongs to a period. That is what stops a March bonus
 *   quietly reappearing in April — a run picks up only its own period's.
 *
 *   It is approved before it is paid, by somebody other than whoever typed it
 *   where the permissions are set up that way. Money added to a payslip with
 *   no second pair of eyes is the easiest payroll fraud there is.
 *
 *   Once a payroll has consumed it, it is a record. The payslip that paid it
 *   carries it in its snapshot, and editing the adjustment afterwards would
 *   leave the two disagreeing with nothing to say which is right.
 */
export const payrollAdjustmentsRouter = Router();
payrollAdjustmentsRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.adjustments;

/** Past this, the adjustment is history rather than a plan. */
const EDITABLE = ['DRAFT', 'APPROVED'];

const shape = (a: any, extra: Record<string, unknown> = {}) => ({
  id: a.id,
  employeeId: a.employeeId,
  componentId: a.componentId,
  periodId: a.periodId,
  type: a.type,
  amount: Number(a.amount ?? 0),
  reason: a.reason || '',
  reference: a.reference || '',
  status: a.status,
  consumedByRunId: a.consumedByRunId || null,
  approvedAt: a.approvedAt || null,
  createdAt: a.createdAt,
  ...extra,
});

payrollAdjustmentsRouter.get(
  '/orgs/:orgId/payroll/adjustments',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const periodId = String(req.query.periodId || '').trim();
    const employeeId = String(req.query.employeeId || '').trim();
    const status = String(req.query.status || '').trim();

    const rows = await payrollPrisma.payrollAdjustment.findMany({
      where: {
        accountId,
        orgId,
        ...(periodId ? { periodId } : {}),
        ...(employeeId ? { employeeId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
    const componentIds = [...new Set(rows.map((r) => r.componentId))];
    const runIds = [...new Set(rows.map((r) => r.consumedByRunId).filter(Boolean) as string[])];

    const [people, components, periods, runs] = await Promise.all([
      employeeIds.length
        ? peoplePrisma.employee.findMany({ where: { orgId, id: { in: employeeIds } }, select: { id: true, name: true, code: true } })
        : Promise.resolve([]),
      componentIds.length
        ? payrollPrisma.salaryComponent.findMany({ where: { orgId, id: { in: componentIds } }, select: { id: true, name: true, code: true } })
        : Promise.resolve([]),
      payrollPrisma.payrollPeriod.findMany({ where: { orgId }, select: { id: true, name: true, startDate: true } }),
      runIds.length
        ? payrollPrisma.payrollRun.findMany({ where: { orgId, id: { in: runIds } }, select: { id: true, number: true } })
        : Promise.resolve([]),
    ]);
    const byPerson = new Map(people.map((p) => [p.id, p]));
    const byComponent = new Map(components.map((c) => [c.id, c]));
    const byPeriod = new Map(periods.map((p) => [p.id, p]));
    const byRun = new Map(runs.map((r) => [r.id, r.number]));

    res.json({
      adjustments: rows.map((r) =>
        shape(r, {
          employeeName: byPerson.get(r.employeeId)?.name || 'Unknown employee',
          employeeCode: byPerson.get(r.employeeId)?.code || '',
          componentName: byComponent.get(r.componentId)?.name || 'Unknown component',
          componentCode: byComponent.get(r.componentId)?.code || '',
          periodName: byPeriod.get(r.periodId)?.name || '',
          consumedByRunNumber: r.consumedByRunId ? byRun.get(r.consumedByRunId) || '' : '',
        })
      ),
    });
  }
);

/** HR days awaiting an earning, each valued on its leave policy's pay base; approving the earning remains Payroll's decision. */
payrollAdjustmentsRouter.get('/orgs/:orgId/payroll/leave-encashments', requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE), async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { orgId, accountId } = req.tenant!;
  const rows = await peoplePrisma.leaveAdjustment.findMany({ where: { orgId, accountId, kind: 'ENCASH', reversedAt: null }, orderBy: { createdAt: 'asc' } });
  const linked = await payrollPrisma.payrollAdjustment.findMany({ where: { orgId, id: { in: rows.map((r) => `leave-encash:${r.id}`) }, status: { not: 'CANCELLED' } }, select: { id: true } });
  const used = new Set(linked.map((r) => r.id));
  const waiting = rows.filter((r) => !used.has(`leave-encash:${r.id}`));
  /* Each one's amount on its leave policy's pay base, for Payroll to check and enter (time depth, gap 19); Payroll still decides. */
  const values = await valueEncashments(orgId, waiting);
  res.json({ encashments: waiting.map((r) => ({ id: r.id, employeeId: r.employeeId, days: -r.days, reason: r.reason, leaveType: values.get(r.id)?.leaveType ?? null, amount: values.get(r.id)?.amount ?? null, explanation: values.get(r.id)?.explanation ?? null })) });
});

const body = z.object({
  employeeId: z.string().trim().min(1, 'Say who this is for.'),
  componentId: z.string().trim().min(1, 'Say what this is — a bonus, an arrear, a fine.'),
  periodId: z.string().trim().min(1, 'Say which month this is paid in.'),
  amount: z.number().finite().positive('An adjustment of nothing changes nothing.'),
  reason: z.string().trim().max(240).optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
  leaveEncashmentId: z.string().trim().min(1).optional(),
});

/**
 * Checks shared by creating and editing.
 *
 * A locked period is the important one: payroll for a closed month has been
 * run, filed and paid, and an adjustment against it would either be ignored
 * silently or restate a month somebody has already reported.
 */
type CheckFailure = { ok: false; error: string; status: number; code?: string };
type CheckPass = { ok: true; type: 'EARNING' | 'DEDUCTION' };

async function check(orgId: string, payload: z.infer<typeof body>): Promise<CheckFailure | CheckPass> {
  const [employee, component, period] = await Promise.all([
    peoplePrisma.employee.findFirst({ where: { orgId, id: payload.employeeId }, select: { id: true } }),
    payrollPrisma.salaryComponent.findFirst({ where: { orgId, id: payload.componentId }, select: { id: true, type: true, isActive: true, name: true } }),
    payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: payload.periodId }, select: { id: true, name: true, isLocked: true } }),
  ]);

  if (!employee) return { ok: false, error: 'No such employee.', status: 404 };
  if (!component) return { ok: false, error: 'No such salary component.', status: 404 };
  if (!component.isActive) return { ok: false, error: `${component.name} is no longer in use.`, status: 409 };
  if (component.type === 'EMPLOYER_CONTRIBUTION') {
    return {
      ok: false,
      error: `${component.name} is an employer cost, not something to add to or take off somebody's pay.`,
      status: 409,
    };
  }
  if (!period) return { ok: false, error: 'No such payroll period.', status: 404 };
  if (period.isLocked) {
    return { ok: false, error: `${period.name} is closed. Adjust an open period instead.`, status: 409, code: 'PERIOD_LOCKED' };
  }

  return { ok: true, type: component.type === 'DEDUCTION' ? 'DEDUCTION' : 'EARNING' };
}

payrollAdjustmentsRouter.post(
  '/orgs/:orgId/payroll/adjustments',
  requirePermission(PAYROLL_MODULE, PermissionAction.CREATE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId, branchId } = req.tenant!;

    const parsed = body.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid adjustment.' });

    const checked = await check(orgId, parsed.data);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error, code: checked.code });

    const create = async () => {
      const source = parsed.data.leaveEncashmentId ? await peoplePrisma.leaveAdjustment.findFirst({ where: { id: parsed.data.leaveEncashmentId, accountId, orgId, employeeId: parsed.data.employeeId, kind: 'ENCASH', reversedAt: null } }) : null;
      if (parsed.data.leaveEncashmentId && (!source || checked.type !== 'EARNING')) throw Object.assign(new Error('Choose an encashment for this employee and an earning component.'), { status: 400 });
      if (source) {
        const prior = await payrollPrisma.payrollAdjustment.findUnique({ where: { id: `leave-encash:${source.id}` } });
        if (prior && prior.status !== 'CANCELLED') {
          if (prior.periodId !== parsed.data.periodId || prior.componentId !== parsed.data.componentId || Number(prior.amount) !== parsed.data.amount) throw Object.assign(new Error('This encashment is already linked to a payroll earning.'), { status: 409 });
          return prior;
        }
        if (prior) return payrollPrisma.payrollAdjustment.update({ where: { id: prior.id }, data: { componentId: parsed.data.componentId, periodId: parsed.data.periodId, amount: parsed.data.amount, status: 'DRAFT', approvedAt: null, approvedByUserId: null, consumedByRunId: null } });
      }
      return forLiveEmployee(orgId, parsed.data.employeeId, (tx) => tx.payrollAdjustment.create({
        data: {
          ...(source ? { id: `leave-encash:${source.id}` } : {}),
          accountId,
          orgId,
          branchId: branchId || null,
          employeeId: parsed.data.employeeId,
          componentId: parsed.data.componentId,
          periodId: parsed.data.periodId,
          type: checked.type,
          amount: parsed.data.amount,
          reason: parsed.data.reason?.trim() || null,
          reference: source ? `leave-encash:${source.id}` : parsed.data.reference?.trim() || null,
          status: 'DRAFT',
          createdByUserId: req.auth!.userId,
        },
      }));
    };
    const row = parsed.data.leaveEncashmentId ? await peopleWrite(orgId, create) : await create();

    res.status(201).json({ adjustment: shape(row) });
  }
);

payrollAdjustmentsRouter.put(
  '/orgs/:orgId/payroll/adjustments/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.payrollAdjustment.findFirst({ where: { accountId, orgId, id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'No such adjustment.' });
    if (!EDITABLE.includes(existing.status)) {
      return res.status(409).json({
        error:
          existing.status === 'CONSUMED'
            ? 'This has already been paid on a payslip. Add a correcting adjustment rather than editing this one.'
            : 'This adjustment was cancelled.',
        code: 'ADJUSTMENT_NOT_EDITABLE',
      });
    }

    const parsed = body.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid adjustment.' });

    const checked = await check(orgId, parsed.data);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error, code: checked.code });

    if (existing.id.startsWith('leave-encash:') && (parsed.data.employeeId !== existing.employeeId || checked.type !== 'EARNING')) return res.status(400).json({ error: 'An encashment earning must stay with its employee and remain an earning.' });
    const row = await payrollPrisma.payrollAdjustment.update({
      where: { id: existing.id },
      data: {
        employeeId: parsed.data.employeeId,
        componentId: parsed.data.componentId,
        periodId: parsed.data.periodId,
        type: checked.type,
        amount: parsed.data.amount,
        reason: parsed.data.reason?.trim() || null,
        reference: existing.id.startsWith('leave-encash:') ? existing.reference : parsed.data.reference?.trim() || null,
        /* Editing an approved adjustment sends it back for approval. The
           approval was of an amount, not of a row. */
        status: 'DRAFT',
        approvedByUserId: null,
        approvedAt: null,
      },
    });

    res.json({ adjustment: shape(row) });
  }
);

/**
 * Approve, or take the approval back.
 *
 * Its own permission, so a company can require that the person who types a
 * bonus is not the person who lets it through.
 */
payrollAdjustmentsRouter.post(
  '/orgs/:orgId/payroll/adjustments/:id/approve',
  requirePermission(PAYROLL_MODULE, PermissionAction.APPROVE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.payrollAdjustment.findFirst({ where: { accountId, orgId, id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'No such adjustment.' });
    if (existing.status === 'CONSUMED') {
      return res.status(409).json({ error: 'This has already been paid.', code: 'ADJUSTMENT_CONSUMED' });
    }
    if (existing.status === 'CANCELLED') {
      return res.status(409).json({ error: 'This adjustment was cancelled.', code: 'ADJUSTMENT_CANCELLED' });
    }

    /* A-13: never a bonus to yourself; the person who typed it approves only as the company's setting allows. */
    const refused =
      (await ownRecordRefusal(req, existing.employeeId, 'payroll adjustment')) ||
      (await ownWorkRefusal(req, { makers: [existing.createdByUserId], module: PAYROLL_MODULE, resource: RESOURCE, entity: 'PAYROLL_ADJUSTMENT', entityId: existing.id, what: 'adjustment' }));
    if (refused) return res.status(refused.status).json(refused.body);

    /* Only while it is still waiting: a consumed or cancelled one cannot be re-approved by a second request in between. */
    const moved = await payrollPrisma.payrollAdjustment.updateMany({
      where: { id: existing.id, status: { notIn: ['CONSUMED', 'CANCELLED'] } },
      data: { status: 'APPROVED', approvedByUserId: req.auth!.userId, approvedAt: new Date() },
    });
    if (moved.count !== 1) return res.status(409).json({ error: 'Somebody else has just changed this adjustment. Reload it.', code: 'ADJUSTMENT_CHANGED' });
    const row = await payrollPrisma.payrollAdjustment.findUniqueOrThrow({ where: { id: existing.id } });
    res.json({ adjustment: shape(row) });
  }
);

payrollAdjustmentsRouter.post(
  '/orgs/:orgId/payroll/adjustments/:id/cancel',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.payrollAdjustment.findFirst({ where: { accountId, orgId, id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'No such adjustment.' });
    if (existing.status === 'CONSUMED') {
      return res.status(409).json({
        error: 'This has already been paid on a payslip. Add a correcting adjustment rather than cancelling this one.',
        code: 'ADJUSTMENT_CONSUMED',
      });
    }

    const row = await payrollPrisma.payrollAdjustment.update({ where: { id: existing.id }, data: { status: 'CANCELLED' } });
    res.json({ adjustment: shape(row) });
  }
);

/**
 * Delete, but only something nobody has acted on.
 *
 * A cancelled adjustment stays, because "we decided not to pay this" is worth
 * knowing. A draft somebody typed by mistake is not.
 */
payrollAdjustmentsRouter.delete(
  '/orgs/:orgId/payroll/adjustments/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.DELETE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.payrollAdjustment.findFirst({ where: { accountId, orgId, id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'No such adjustment.' });
    if (existing.status !== 'DRAFT') {
      return res.status(409).json({
        error: 'Only a draft can be deleted. Cancel this one instead, so the decision stays visible.',
        code: 'ADJUSTMENT_NOT_DRAFT',
      });
    }

    await payrollPrisma.payrollAdjustment.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  }
);
