import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { recordAudit } from '../services/auditTrail.js';
import { netOf, proposeSettlement, type SettlementLine } from '../services/payroll/finalSettlement.js';
import { requirePayrollStepUp } from '../services/stepUp.js';

/**
 * Full and final settlements for people who have left. Drafted from what CLOR
 * knows (services/payroll/finalSettlement.ts), corrected by HR while a draft,
 * approved by somebody who may approve pay runs, then marked paid. Due within
 * two working days of the leaving date; overdue ones are flagged.
 */
export const payrollSettlementsRouter = Router();
payrollSettlementsRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.runs;
const VIEW = requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE);
const EDIT = requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE);
const APPROVE = requirePermission(PAYROLL_MODULE, PermissionAction.APPROVE, RESOURCE);

const lineSchema = z.object({
  code: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1, 'Every line needs a name.').max(120),
  kind: z.enum(['EARNING', 'DEDUCTION', 'INFO']),
  amount: z.coerce.number().min(0, 'Enter amounts as positive numbers; a deduction is taken off.').max(100_000_000),
  explanation: z.string().trim().max(500).default(''),
});
const updateSchema = z.object({
  lines: z.array(lineSchema).max(60).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const today = () => new Date().toISOString().slice(0, 10);

function shape(row: any, people: Map<string, { name: string; code: string | null }>) {
  const lines = JSON.parse(row.linesJson || '[]') as SettlementLine[];
  const open = row.status === 'DRAFT' || row.status === 'APPROVED';
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: people.get(row.employeeId)?.name || null,
    employeeCode: people.get(row.employeeId)?.code || null,
    status: row.status,
    leavingDate: row.leavingDate,
    dueDate: row.dueDate,
    overdue: open && row.dueDate < today(),
    lines,
    netPayable: Number(row.netPayable),
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    approvedAt: row.approvedAt,
    approvedByUserId: row.approvedByUserId,
    paidAt: row.paidAt,
    paidReference: row.paidReference,
  };
}

async function peopleFor(orgId: string, ids: string[]) {
  const rows = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(ids)] } }, select: { id: true, name: true, code: true } });
  return new Map(rows.map((p) => [p.id, p]));
}

const fail = (res: any, e: unknown) => {
  const err = e as { status?: number; code?: string; message?: string };
  if (err?.status) return res.status(err.status).json({ error: err.message, code: err.code });
  throw e;
};

payrollSettlementsRouter.get('/orgs/:orgId/payroll/settlements', VIEW, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await payrollPrisma.finalSettlement.findMany({ where: { accountId, orgId, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 300 });
  const people = await peopleFor(orgId, rows.map((r) => r.employeeId));

  /* Who has left, or is leaving, and has no settlement yet. */
  const settled = new Set(rows.map((r) => r.employeeId));
  const leavers = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, dateOfLeaving: { not: null }, status: { in: ['LEFT', 'ON_NOTICE'] } },
    select: { id: true, name: true, code: true, dateOfLeaving: true, status: true },
    orderBy: { dateOfLeaving: 'desc' },
    take: 300,
  });
  res.json({
    settlements: rows.map((r) => shape(r, people)),
    waiting: leavers.filter((p) => !settled.has(p.id)),
  });
});

payrollSettlementsRouter.post('/orgs/:orgId/payroll/settlements', EDIT, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employeeId = String(req.body?.employeeId || '');
  if (!employeeId) return res.status(400).json({ error: 'Choose who is leaving.' });
  const existing = await payrollPrisma.finalSettlement.findFirst({ where: { orgId, employeeId, status: { not: 'CANCELLED' } } });
  if (existing) return res.status(409).json({ error: 'They already have a settlement. Open it, or cancel it first.', code: 'SETTLEMENT_EXISTS', id: existing.id });
  try {
    const p = await proposeSettlement(accountId, orgId, employeeId);
    const row = await payrollPrisma.finalSettlement.create({
      data: {
        accountId,
        orgId,
        employeeId,
        leavingDate: p.leavingDate,
        dueDate: p.dueDate,
        linesJson: JSON.stringify(p.lines),
        netPayable: netOf(p.lines),
        createdByUserId: req.auth!.userId,
      },
    });
    res.status(201).json({ settlement: shape(row, await peopleFor(orgId, [employeeId])) });
  } catch (e) {
    return fail(res, e);
  }
});

async function findOwn(req: any, res: any) {
  const row = await payrollPrisma.finalSettlement.findFirst({ where: { id: String(req.params.id), accountId: req.tenant.accountId, orgId: req.tenant.orgId } });
  if (!row) res.status(404).json({ error: 'No such settlement.' });
  return row;
}

payrollSettlementsRouter.put('/orgs/:orgId/payroll/settlements/:id', EDIT, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const row = await findOwn(req, res);
  if (!row) return;
  if (row.status !== 'DRAFT') return res.status(409).json({ error: 'Only a draft can be changed.', code: 'NOT_DRAFT' });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the lines.' });
  const lines = parsed.data.lines as SettlementLine[] | undefined;
  const updated = await payrollPrisma.finalSettlement.update({
    where: { id: row.id },
    data: {
      ...(lines ? { linesJson: JSON.stringify(lines), netPayable: netOf(lines) } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
    },
  });
  res.json({ settlement: shape(updated, await peopleFor(row.orgId, [row.employeeId])) });
});

/* Worked out again from today's records — after a late payslip or leave correction. */
payrollSettlementsRouter.post('/orgs/:orgId/payroll/settlements/:id/recalculate', EDIT, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const row = await findOwn(req, res);
  if (!row) return;
  if (row.status !== 'DRAFT') return res.status(409).json({ error: 'Only a draft can be worked out again.', code: 'NOT_DRAFT' });
  try {
    const p = await proposeSettlement(row.accountId, row.orgId, row.employeeId);
    const updated = await payrollPrisma.finalSettlement.update({
      where: { id: row.id },
      data: { leavingDate: p.leavingDate, dueDate: p.dueDate, linesJson: JSON.stringify(p.lines), netPayable: netOf(p.lines) },
    });
    res.json({ settlement: shape(updated, await peopleFor(row.orgId, [row.employeeId])) });
  } catch (e) {
    return fail(res, e);
  }
});

payrollSettlementsRouter.post('/orgs/:orgId/payroll/settlements/:id/approve', APPROVE, requirePayrollStepUp, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const row = await findOwn(req, res);
  if (!row) return;
  if (row.status !== 'DRAFT') return res.status(409).json({ error: 'Only a draft can be approved.', code: 'NOT_DRAFT' });
  const updated = await payrollPrisma.finalSettlement.update({
    where: { id: row.id },
    data: { status: 'APPROVED', approvedByUserId: req.auth!.userId, approvedAt: new Date() },
  });
  await recordAudit(req, {
    entity: 'PAYROLL_SETTLEMENT',
    entityId: row.id,
    action: 'APPROVE',
    message: `Approved a full and final settlement of ₹${Number(row.netPayable).toLocaleString('en-IN')}`,
    metadata: { employeeId: row.employeeId, netPayable: Number(row.netPayable), lines: JSON.parse(row.linesJson) },
  });
  res.json({ settlement: shape(updated, await peopleFor(row.orgId, [row.employeeId])) });
});

payrollSettlementsRouter.post('/orgs/:orgId/payroll/settlements/:id/paid', APPROVE, requirePayrollStepUp, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const row = await findOwn(req, res);
  if (!row) return;
  if (row.status !== 'APPROVED') return res.status(409).json({ error: 'Approve it before marking it paid.', code: 'NOT_APPROVED' });
  const reference = req.body?.reference ? String(req.body.reference).trim().slice(0, 120) : null;
  const updated = await payrollPrisma.finalSettlement.update({ where: { id: row.id }, data: { status: 'PAID', paidAt: new Date(), paidReference: reference } });
  await recordAudit(req, {
    entity: 'PAYROLL_SETTLEMENT',
    entityId: row.id,
    action: 'PAID',
    message: 'Marked a full and final settlement paid',
    metadata: { employeeId: row.employeeId, netPayable: Number(row.netPayable), reference },
  });
  res.json({ settlement: shape(updated, await peopleFor(row.orgId, [row.employeeId])) });
});

payrollSettlementsRouter.post('/orgs/:orgId/payroll/settlements/:id/cancel', APPROVE, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const row = await findOwn(req, res);
  if (!row) return;
  if (row.status === 'PAID') return res.status(409).json({ error: 'A paid settlement stays on the record.', code: 'PAID' });
  const updated = await payrollPrisma.finalSettlement.update({ where: { id: row.id }, data: { status: 'CANCELLED' } });
  await recordAudit(req, { entity: 'PAYROLL_SETTLEMENT', entityId: row.id, action: 'CANCEL', message: 'Cancelled a full and final settlement', metadata: { employeeId: row.employeeId, was: row.status } });
  res.json({ settlement: shape(updated, await peopleFor(row.orgId, [row.employeeId])) });
});
