import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { runDueSchedules } from '../services/recurring.js';

/**
 * Recurring invoice schedules.
 *
 * The schedules themselves used to live in a browser, which meant they only
 * existed on one machine and only ran while somebody had the app open.
 */
export const recurringRouter = Router();
recurringRouter.use(requireAuth, requireTenantContext);

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

const VIEW = requirePermission('SALES', PermissionAction.VIEW, 'Invoices');
const EDIT = requirePermission('SALES', PermissionAction.CREATE, 'Invoices');

const scheduleSchema = z.object({
  name: z.string().min(1).max(160),
  partyId: z.string().optional().nullable(),
  partyName: z.string().min(1).max(200),
  branchId: z.string().optional().nullable(),
  warehouseId: z.string().optional().nullable(),
  frequency: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']).optional(),
  interval: z.number().int().min(1).max(52).optional(),
  nextRunDate: z.string().min(1),
  endDate: z.string().optional().nullable(),
  maxOccurrences: z.number().int().min(1).optional().nullable(),
  dueDays: z.number().int().min(0).max(365).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
  /** The invoice this raises: lines and totals, as agreed. */
  template: z.record(z.any()),
});

const out = (r: any) => {
  let template: unknown = {};
  try {
    template = JSON.parse(r.templateJson || '{}');
  } catch {
    template = {};
  }
  return { ...r, templateJson: undefined, template };
};

recurringRouter.get('/orgs/:orgId/recurring', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await prisma.recurringSchedule.findMany({
    where: { accountId, orgId },
    orderBy: [{ isActive: 'desc' }, { nextRunDate: 'asc' }],
  });
  res.json({ schedules: rows.map(out) });
});

recurringRouter.post('/orgs/:orgId/recurring', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId, branchId } = req.tenant!;
  const body = scheduleSchema.parse(req.body);

  const row = await prisma.recurringSchedule.create({
    data: {
      accountId,
      orgId,
      branchId: body.branchId ?? branchId ?? null,
      name: body.name.trim(),
      partyId: body.partyId ?? null,
      partyName: body.partyName.trim(),
      warehouseId: body.warehouseId ?? null,
      frequency: body.frequency ?? 'MONTHLY',
      interval: body.interval ?? 1,
      nextRunDate: String(body.nextRunDate).slice(0, 10),
      endDate: body.endDate ? String(body.endDate).slice(0, 10) : null,
      maxOccurrences: body.maxOccurrences ?? null,
      dueDays: body.dueDays ?? 30,
      isActive: body.isActive ?? true,
      notes: body.notes ?? null,
      templateJson: JSON.stringify(body.template ?? {}),
      createdByUserId: req.auth!.userId,
    },
  });
  res.status(201).json({ schedule: out(row) });
});

recurringRouter.patch('/orgs/:orgId/recurring/:id', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await prisma.recurringSchedule.findFirst({
    where: { id: String(req.params.id), accountId, orgId },
  });
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });

  const body = scheduleSchema.partial().parse(req.body);
  const row = await prisma.recurringSchedule.update({
    where: { id: existing.id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.partyId !== undefined ? { partyId: body.partyId ?? null } : {}),
      ...(body.partyName !== undefined ? { partyName: body.partyName.trim() } : {}),
      ...(body.branchId !== undefined ? { branchId: body.branchId ?? null } : {}),
      ...(body.warehouseId !== undefined ? { warehouseId: body.warehouseId ?? null } : {}),
      ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
      ...(body.interval !== undefined ? { interval: body.interval } : {}),
      ...(body.nextRunDate !== undefined ? { nextRunDate: String(body.nextRunDate).slice(0, 10) } : {}),
      ...(body.endDate !== undefined ? { endDate: body.endDate ? String(body.endDate).slice(0, 10) : null } : {}),
      ...(body.maxOccurrences !== undefined ? { maxOccurrences: body.maxOccurrences ?? null } : {}),
      ...(body.dueDays !== undefined ? { dueDays: body.dueDays } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
      ...(body.template !== undefined ? { templateJson: JSON.stringify(body.template) } : {}),
    },
  });
  res.json({ schedule: out(row) });
});

recurringRouter.delete('/orgs/:orgId/recurring/:id', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await prisma.recurringSchedule.findFirst({
    where: { id: String(req.params.id), accountId, orgId },
  });
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });
  await prisma.recurringSchedule.delete({ where: { id: existing.id } });
  res.json({ deleted: true, id: existing.id });
});

/** What this schedule has already raised, and when. */
recurringRouter.get('/orgs/:orgId/recurring/:id/runs', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await prisma.recurringScheduleRun.findMany({
    where: { accountId, orgId, scheduleId: String(req.params.id) },
    orderBy: { periodDate: 'desc' },
    take: 100,
  });
  res.json({ runs: rows });
});

/**
 * Raise whatever is due now.
 *
 * Safe to call repeatedly: the period claim is unique, so a second call raises
 * nothing rather than billing a customer again. That is what makes it usable as
 * a button, a cron target and a boot-time catch-up at the same time.
 */
recurringRouter.post('/orgs/:orgId/recurring/run', EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const summary = await runDueSchedules({ accountId, orgId });
  res.json(summary);
});

export default recurringRouter;
