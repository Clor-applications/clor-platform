import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';

/**
 * Populations that are paid on the same rhythm.
 *
 * Monthly staff, weekly site labour, contractors on a fortnight. A pay group is
 * what a payroll run is drawn from, so it answers a question the run cannot ask
 * any other way: who is being paid this time, and on what cycle.
 *
 * Small, but load-bearing. A run is unique per period and pay group, which is
 * what stops the same people being paid twice in a month — so a group that is
 * already attached to a run or an assignment cannot be deleted out from under
 * it, and its frequency cannot change once history has been calculated on it.
 */
export const payrollPayGroupsRouter = Router();
payrollPayGroupsRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.settings;

export const PAY_FREQUENCIES = ['MONTHLY', 'WEEKLY', 'FORTNIGHTLY', 'CUSTOM'] as const;

const bodySchema = z.object({
  name: z.string().trim().min(1, 'A pay group needs a name.').max(80),
  code: z.string().trim().max(40).optional().nullable(),
  frequency: z.enum(PAY_FREQUENCIES).default('MONTHLY'),
  /* Day of the month salary is paid. Only a monthly cycle has one — a weekly
     group is paid on a weekday, which is a different question and not one this
     field can answer honestly. */
  paymentDay: z.number().int().min(1).max(31).optional().nullable(),
  branchId: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
});

type Body = z.infer<typeof bodySchema>;

function problems(body: Body): string | null {
  if (body.frequency !== 'MONTHLY' && body.paymentDay != null) {
    return 'A payment day is a day of the month, so it belongs to a monthly pay group.';
  }
  return null;
}

const shape = (row: any) => ({
  id: row.id,
  name: row.name,
  code: row.code || '',
  frequency: row.frequency,
  paymentDay: row.paymentDay ?? null,
  branchId: row.branchId || null,
  notes: row.notes || '',
  isActive: !!row.isActive,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** What already depends on this group, and would be orphaned by removing it. */
async function dependants(orgId: string, payGroupId: string) {
  const [runs, assignments, structures] = await Promise.all([
    payrollPrisma.payrollRun.count({ where: { orgId, payGroupId } }),
    payrollPrisma.salaryAssignment.count({ where: { orgId, payGroupId } }),
    payrollPrisma.salaryStructure.count({ where: { orgId, payGroupId } }),
  ]);
  return { runs, assignments, structures, total: runs + assignments + structures };
}

payrollPayGroupsRouter.get(
  '/orgs/:orgId/payroll/pay-groups',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const rows = await payrollPrisma.payGroup.findMany({
      where: { accountId, orgId, ...(String(req.query.active || '') === 'true' ? { isActive: true } : {}) },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    /* The counts come back with the list because the screen needs them to say
       why a group cannot be deleted, and asking per row would be one request
       per group. */
    const usage = await Promise.all(rows.map((r) => dependants(orgId, r.id)));
    res.json({ payGroups: rows.map((r, i) => ({ ...shape(r), usage: usage[i] })) });
  }
);

payrollPayGroupsRouter.post(
  '/orgs/:orgId/payroll/pay-groups',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid pay group.' });
    const body = parsed.data;
    const problem = problems(body);
    if (problem) return res.status(400).json({ error: problem });

    const clash = await payrollPrisma.payGroup.findFirst({ where: { orgId, name: body.name }, select: { id: true } });
    if (clash) return res.status(409).json({ error: `A pay group called ${body.name} already exists.` });

    const row = await payrollPrisma.payGroup.create({
      data: { ...body, accountId, orgId, createdByUserId: req.auth!.userId },
    });
    res.status(201).json({ payGroup: { ...shape(row), usage: { runs: 0, assignments: 0, structures: 0, total: 0 } } });
  }
);

payrollPayGroupsRouter.put(
  '/orgs/:orgId/payroll/pay-groups/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.payGroup.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!existing) return res.status(404).json({ error: 'No such pay group.' });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid pay group.' });
    const body = parsed.data;
    const problem = problems(body);
    if (problem) return res.status(400).json({ error: problem });

    if (body.name !== existing.name) {
      const clash = await payrollPrisma.payGroup.findFirst({
        where: { orgId, name: body.name, NOT: { id: existing.id } },
        select: { id: true },
      });
      if (clash) return res.status(409).json({ error: `A pay group called ${body.name} already exists.` });
    }

    /*
     * The rhythm is what past runs were drawn on. A monthly group whose twelve
     * runs exist cannot become weekly — the runs would still be monthly, and
     * every report that groups by frequency would start describing them wrongly.
     * Renaming is fine; the cycle is not.
     */
    if (body.frequency !== existing.frequency) {
      const used = await dependants(orgId, existing.id);
      if (used.runs > 0) {
        return res.status(409).json({
          error:
            `This pay group has ${used.runs} payroll run${used.runs === 1 ? '' : 's'} behind it, so its cycle can no longer change. ` +
            'Make it inactive and add a group on the new cycle.',
          code: 'PAY_GROUP_IN_USE',
        });
      }
    }

    const row = await payrollPrisma.payGroup.update({ where: { id: existing.id }, data: body });
    res.json({ payGroup: { ...shape(row), usage: await dependants(orgId, row.id) } });
  }
);

payrollPayGroupsRouter.delete(
  '/orgs/:orgId/payroll/pay-groups/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.payGroup.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!existing) return res.status(404).json({ error: 'No such pay group.' });

    /* Nothing may be left pointing at a group that no longer exists: a run
       whose population cannot be named is a run nobody can explain. */
    const used = await dependants(orgId, existing.id);
    if (used.total > 0) {
      const parts = [
        used.runs ? `${used.runs} payroll run${used.runs === 1 ? '' : 's'}` : null,
        used.assignments ? `${used.assignments} salary assignment${used.assignments === 1 ? '' : 's'}` : null,
        used.structures ? `${used.structures} salary structure${used.structures === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      return res.status(409).json({
        error: `This pay group is used by ${parts.join(' and ')}. Make it inactive instead.`,
        code: 'PAY_GROUP_IN_USE',
      });
    }

    await payrollPrisma.payGroup.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  }
);
