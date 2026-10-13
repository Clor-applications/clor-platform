import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { PAY_FREQUENCIES } from './payrollPayGroups.js';

/**
 * The pay cycles a run belongs to.
 *
 * A payroll period is a closed interval with a name people actually use —
 * "September 2026" — and it is what makes a run answerable: every payslip, every
 * adjustment and every statutory return is filed against one. Without it, "this
 * month's payroll" is a phrase rather than a record.
 *
 * Two things this enforces that nothing downstream can recover from.
 *
 * Periods of the same frequency may not overlap. An adjustment is attached to a
 * period, and if two periods cover the same day there is no answer to which
 * payroll it belongs in — the bonus lands in whichever run is calculated first.
 *
 * A locked period refuses new work, and stays locked. It is payroll's closed
 * book: once the returns are filed and the money has gone out, a new run in that
 * period would produce payslips for a month that has already been reported.
 */
export const payrollPeriodsRouter = Router();
payrollPeriodsRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.settings;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (label: string) =>
  z.string().trim().regex(ISO_DATE, `${label} must be a date.`);

const bodySchema = z.object({
  name: z.string().trim().min(1, 'A period needs a name.').max(80),
  startDate: isoDate('The start'),
  endDate: isoDate('The end'),
  paymentDate: isoDate('The payment date').optional().nullable(),
  frequency: z.enum(PAY_FREQUENCIES).default('MONTHLY'),
  fiscalYearId: z.string().trim().optional().nullable(),
});

type Body = z.infer<typeof bodySchema>;

const shape = (row: any) => ({
  id: row.id,
  name: row.name,
  startDate: row.startDate,
  endDate: row.endDate,
  paymentDate: row.paymentDate || null,
  frequency: row.frequency,
  fiscalYearId: row.fiscalYearId || null,
  status: row.status,
  isLocked: !!row.isLocked,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

function problems(body: Body): string | null {
  if (body.endDate < body.startDate) return 'A period cannot end before it starts.';
  if (body.paymentDate && body.paymentDate < body.startDate) {
    /* Paying before the period opens is almost always a typed year. Paying
       after it closes is ordinary and allowed. */
    return 'A period cannot be paid before it starts.';
  }
  return null;
}

/**
 * Another period of the same rhythm covering any of the same days.
 *
 * Same-frequency only, on purpose: a weekly cycle and a monthly cycle are meant
 * to overlap, and a business running both is running them over the same days by
 * definition. Two monthly periods over the same week is the mistake.
 */
async function overlapping(orgId: string, body: Body, exceptId?: string) {
  return payrollPrisma.payrollPeriod.findFirst({
    where: {
      orgId,
      frequency: body.frequency,
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
      // Two closed intervals overlap when each starts before the other ends.
      startDate: { lte: body.endDate },
      endDate: { gte: body.startDate },
    },
    select: { id: true, name: true, startDate: true, endDate: true },
  });
}

/** What has already been filed against this period. */
async function usage(orgId: string, periodId: string) {
  const [runs, slips, adjustments] = await Promise.all([
    payrollPrisma.payrollRun.count({ where: { orgId, periodId } }),
    payrollPrisma.salarySlip.count({ where: { orgId, periodId } }),
    payrollPrisma.payrollAdjustment.count({ where: { orgId, periodId } }),
  ]);
  return { runs, slips, adjustments, total: runs + slips + adjustments };
}

payrollPeriodsRouter.get(
  '/orgs/:orgId/payroll/periods',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const rows = await payrollPrisma.payrollPeriod.findMany({
      where: { accountId, orgId, ...(String(req.query.open || '') === 'true' ? { isLocked: false } : {}) },
      orderBy: [{ startDate: 'desc' }],
      take: Math.min(200, Math.max(1, Number(req.query.limit || 60))),
    });
    const used = await Promise.all(rows.map((r) => usage(orgId, r.id)));
    res.json({ periods: rows.map((r, i) => ({ ...shape(r), usage: used[i] })) });
  }
);

payrollPeriodsRouter.post(
  '/orgs/:orgId/payroll/periods',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid period.' });
    const body = parsed.data;
    const problem = problems(body);
    if (problem) return res.status(400).json({ error: problem });

    const clash = await payrollPrisma.payrollPeriod.findFirst({ where: { orgId, name: body.name }, select: { id: true } });
    if (clash) return res.status(409).json({ error: `A period called ${body.name} already exists.` });

    const overlap = await overlapping(orgId, body);
    if (overlap) {
      return res.status(409).json({
        error: `${overlap.name} already covers ${overlap.startDate} to ${overlap.endDate}. Two periods on the same cycle cannot cover the same days.`,
        code: 'PAYROLL_PERIOD_OVERLAP',
      });
    }

    const row = await payrollPrisma.payrollPeriod.create({
      data: { ...body, accountId, orgId, createdByUserId: req.auth!.userId },
    });
    res.status(201).json({ period: { ...shape(row), usage: { runs: 0, slips: 0, adjustments: 0, total: 0 } } });
  }
);

payrollPeriodsRouter.put(
  '/orgs/:orgId/payroll/periods/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.payrollPeriod.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!existing) return res.status(404).json({ error: 'No such payroll period.' });

    /* A locked period is payroll's closed book. Nothing about it moves. */
    if (existing.isLocked) {
      return res.status(409).json({
        error: 'This period is locked. Unlock it before changing its dates.',
        code: 'PAYROLL_PERIOD_LOCKED',
      });
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid period.' });
    const body = parsed.data;
    const problem = problems(body);
    if (problem) return res.status(400).json({ error: problem });

    if (body.name !== existing.name) {
      const clash = await payrollPrisma.payrollPeriod.findFirst({
        where: { orgId, name: body.name, NOT: { id: existing.id } },
        select: { id: true },
      });
      if (clash) return res.status(409).json({ error: `A period called ${body.name} already exists.` });
    }

    const datesMoved =
      body.startDate !== existing.startDate || body.endDate !== existing.endDate || body.frequency !== existing.frequency;

    if (datesMoved) {
      /*
       * Once payroll has been calculated against a period, its dates are part
       * of what was calculated — proration is days in the period over days
       * worked. Moving them afterwards would leave payslips whose arithmetic
       * no longer matches the period they name.
       */
      const used = await usage(orgId, existing.id);
      if (used.total > 0) {
        return res.status(409).json({
          error:
            'Payroll has already been run for this period, so its dates can no longer change. ' +
            'Close it and add the next period instead.',
          code: 'PAYROLL_PERIOD_IN_USE',
        });
      }
      const overlap = await overlapping(orgId, body, existing.id);
      if (overlap) {
        return res.status(409).json({
          error: `${overlap.name} already covers ${overlap.startDate} to ${overlap.endDate}.`,
          code: 'PAYROLL_PERIOD_OVERLAP',
        });
      }
    }

    const row = await payrollPrisma.payrollPeriod.update({ where: { id: existing.id }, data: body });
    res.json({ period: { ...shape(row), usage: await usage(orgId, row.id) } });
  }
);

/**
 * Lock or unlock a period.
 *
 * Its own route rather than a field on the update, because it is a different
 * act with a different permission story: changing a date is bookkeeping,
 * closing a month is a decision. Locking is also the only one of the two that
 * is safe to do while payroll exists, which a single PUT would blur.
 */
payrollPeriodsRouter.post(
  '/orgs/:orgId/payroll/periods/:id/lock',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.payrollPeriod.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!existing) return res.status(404).json({ error: 'No such payroll period.' });

    const locked = req.body?.locked !== false;

    if (locked && !existing.isLocked) {
      /* Locking a period with a run still in progress would strand it: the run
         could never be approved, and could never be abandoned cleanly either. */
      const open = await payrollPrisma.payrollRun.count({
        where: { orgId, periodId: existing.id, status: { in: ['DRAFT', 'CALCULATED', 'REVIEW'] } },
      });
      if (open > 0) {
        return res.status(409).json({
          error: `${open} payroll run${open === 1 ? ' is' : 's are'} still open in this period. Approve or cancel ${open === 1 ? 'it' : 'them'} first.`,
          code: 'PAYROLL_PERIOD_HAS_OPEN_RUNS',
        });
      }
    }

    const row = await payrollPrisma.payrollPeriod.update({
      where: { id: existing.id },
      data: { isLocked: locked, status: locked ? 'CLOSED' : 'OPEN' },
    });
    res.json({ period: { ...shape(row), usage: await usage(orgId, row.id) } });
  }
);

payrollPeriodsRouter.delete(
  '/orgs/:orgId/payroll/periods/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.payrollPeriod.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!existing) return res.status(404).json({ error: 'No such payroll period.' });
    if (existing.isLocked) {
      return res.status(409).json({ error: 'A locked period cannot be deleted.', code: 'PAYROLL_PERIOD_LOCKED' });
    }

    const used = await usage(orgId, existing.id);
    if (used.total > 0) {
      return res.status(409).json({
        error: 'Payroll has been run for this period, so it cannot be deleted.',
        code: 'PAYROLL_PERIOD_IN_USE',
      });
    }

    await payrollPrisma.payrollPeriod.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  }
);
