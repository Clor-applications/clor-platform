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
import { ownRecordRefusal, ownWorkRefusal } from '../services/makerChecker.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE } from '../services/people/guards.js';
import { teamScope } from '../services/people/scope.js';
import { SourcesChangedError, closePayrollSources, closePeopleSources, keepSources, settlementHold, settlementHolds, staleSources } from '../services/payroll/finalSettlementSources.js';
import { releaseHold, AbsenceError } from '../services/people/absconding.js';

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
  /* Checked against the lines the settlement already had (keepSources): never taken on trust. */
  source: z.object({ type: z.enum(['LOAN', 'ADVANCE', 'CLAIM', 'CARRY']), id: z.string().max(160), ref: z.string().max(160).nullable().optional() }).optional(),
});
const updateSchema = z.object({
  lines: z.array(lineSchema).max(60).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const today = () => new Date().toISOString().slice(0, 10);

type Hold = { caseId: string; reason: string; since: Date | null } | null | undefined;

function shape(row: any, people: Map<string, { name: string; code: string | null }>, hold?: Hold) {
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
    /* An absconding case holds the settlement (People): paying waits until the hold is lifted, with a reason. */
    hold: hold && row.status !== 'PAID' && row.status !== 'CANCELLED' ? { reason: hold.reason, since: hold.since } : null,
    /* When the People records it settles were closed; null on a paid one means closing is still to finish. */
    sourcesClosedAt: row.sourcesClosedAt ?? null,
  };
}

const shapeOne = async (row: any) => shape(row, await peopleFor(row.orgId, [row.employeeId]), await settlementHold(row.orgId, row.employeeId));

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
  const holds = await settlementHolds(orgId, [...rows.map((r) => r.employeeId), ...leavers.map((p) => p.id)]);
  res.json({
    settlements: rows.map((r) => shape(r, people, holds.get(r.employeeId))),
    waiting: leavers.filter((p) => !settled.has(p.id)).map((p) => ({ ...p, held: holds.has(p.id) })),
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
    res.status(201).json({ settlement: await shapeOne(row) });
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
  const lines = parsed.data.lines ? (keepSources(parsed.data.lines as SettlementLine[], JSON.parse(row.linesJson || '[]')) as SettlementLine[]) : undefined;
  const updated = await payrollPrisma.finalSettlement.update({
    where: { id: row.id },
    data: {
      ...(lines ? { linesJson: JSON.stringify(lines), netPayable: netOf(lines) } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
    },
  });
  res.json({ settlement: await shapeOne(updated) });
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
    res.json({ settlement: await shapeOne(updated) });
  } catch (e) {
    return fail(res, e);
  }
});

payrollSettlementsRouter.post('/orgs/:orgId/payroll/settlements/:id/approve', APPROVE, requirePayrollStepUp, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const row = await findOwn(req, res);
  if (!row) return;
  if (row.status !== 'DRAFT') return res.status(409).json({ error: 'Only a draft can be approved.', code: 'NOT_DRAFT' });
  /* Never your own; whoever worked it out approves it only as the company's maker-checker setting allows (makerChecker.ts). */
  const refused = (await ownRecordRefusal(req, row.employeeId, 'full and final settlement')) || await ownWorkRefusal(req, { makers: [row.createdByUserId], module: PAYROLL_MODULE, resource: RESOURCE, entity: 'PAYROLL_SETTLEMENT', entityId: row.id, what: 'settlement' });
  if (refused) return res.status(refused.status).json(refused.body);
  const moved = await payrollPrisma.finalSettlement.updateMany({
    where: { id: row.id, status: 'DRAFT' },
    data: { status: 'APPROVED', approvedByUserId: req.auth!.userId, approvedAt: new Date() },
  });
  if (!moved.count) return res.status(409).json({ error: 'Somebody else has just changed this settlement. Reload it.', code: 'NOT_DRAFT' });
  const updated = await payrollPrisma.finalSettlement.findUniqueOrThrow({ where: { id: row.id } });
  await recordAudit(req, {
    entity: 'PAYROLL_SETTLEMENT',
    entityId: row.id,
    action: 'APPROVE',
    message: `Approved a full and final settlement of ₹${Number(row.netPayable).toLocaleString('en-IN')}`,
    metadata: { employeeId: row.employeeId, netPayable: Number(row.netPayable), lines: JSON.parse(row.linesJson) },
  });
  res.json({ settlement: await shapeOne(updated) });
});

payrollSettlementsRouter.post('/orgs/:orgId/payroll/settlements/:id/paid', APPROVE, requirePayrollStepUp, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const row = await findOwn(req, res);
  if (!row) return;
  if (row.status !== 'APPROVED') return res.status(409).json({ error: 'Approve it before marking it paid.', code: 'NOT_APPROVED' });
  const mine = await ownRecordRefusal(req, row.employeeId, 'full and final settlement');
  if (mine) return res.status(mine.status).json(mine.body);
  /* Held by an absconding case: not paid until the hold is lifted, with a reason. Never forfeited. */
  const hold = await settlementHold(row.orgId, row.employeeId);
  if (hold) {
    return res.status(409).json({ error: `Held — absconding case: ${hold.reason}. Lift the hold, with a reason, before paying.`, code: 'SETTLEMENT_HELD', hold });
  }
  const lines = JSON.parse(row.linesJson || '[]') as SettlementLine[];
  /* A loan taken by a payroll since, an advance given back: these lines would recover or pay twice. */
  const stale = await staleSources(row.orgId, lines);
  if (stale.length) {
    return res.status(409).json({ error: `Since this was approved, ${stale.join(', ')} changed. Cancel it and work it out again.`, code: 'SOURCES_CHANGED', stale });
  }
  const reference = req.body?.reference ? String(req.body.reference).trim().slice(0, 120) : null;
  /* Paid once: the move from approved and Payroll's own records (loans, carried deductions) together. */
  let closed: string[] | null;
  try {
    closed = await payrollPrisma.$transaction(async (tx) => {
      const moved = await tx.finalSettlement.updateMany({ where: { id: row.id, status: 'APPROVED' }, data: { status: 'PAID', paidAt: new Date(), paidReference: reference } });
      if (!moved.count) return null;
      return closePayrollSources(tx, row.orgId, row.id, lines);
    });
  } catch (e) {
    /* Moved between the check and the payment: nothing was paid or closed. */
    if (e instanceof SourcesChangedError) return res.status(409).json({ error: e.message, code: e.code });
    throw e;
  }
  if (!closed) return res.status(409).json({ error: 'Somebody else has just marked this paid. Reload it.', code: 'NOT_APPROVED' });
  const peopleClosed = await closeInPeople(req, row, lines);
  await recordAudit(req, {
    entity: 'PAYROLL_SETTLEMENT',
    entityId: row.id,
    action: 'PAID',
    message: 'Marked a full and final settlement paid',
    metadata: { employeeId: row.employeeId, netPayable: Number(row.netPayable), reference, closed: [...closed, ...(peopleClosed || [])] },
  });
  res.json({ settlement: await shapeOne(await payrollPrisma.finalSettlement.findUniqueOrThrow({ where: { id: row.id } })) });
});

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** People's records the settlement settles, closed once; on a failure the settlement stays paid and the retry route finishes it. */
async function closeInPeople(req: any, row: any, lines: SettlementLine[]) {
  try {
    const closed = await closePeopleSources({ orgId: row.orgId, userId: req.auth!.userId, settlementId: row.id, lines, today: todayIst() });
    await payrollPrisma.finalSettlement.updateMany({ where: { id: row.id, sourcesClosedAt: null }, data: { sourcesClosedAt: new Date() } });
    return closed;
  } catch (e) {
    console.error('[payroll-settlement] closing People records failed:', e instanceof Error ? e.message : e); // eslint-disable-line no-console
    return null;
  }
}

/* Finish closing People's records for a paid settlement (after a failure part-way). Closes nothing twice. */
payrollSettlementsRouter.post('/orgs/:orgId/payroll/settlements/:id/close-sources', APPROVE, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const row = await findOwn(req, res);
  if (!row) return;
  if (row.status !== 'PAID') return res.status(409).json({ error: 'Only a paid settlement closes its records.', code: 'NOT_PAID' });
  /* Closed already: a second close would meet records that have moved on since. */
  if (row.sourcesClosedAt) return res.json({ settlement: await shapeOne(row), closed: [] });
  const closed = await closeInPeople(req, row, JSON.parse(row.linesJson || '[]'));
  if (!closed) return res.status(502).json({ error: 'People did not take the update. Try again in a moment.', code: 'PEOPLE_UNAVAILABLE' });
  if (closed.length) await recordAudit(req, { entity: 'PAYROLL_SETTLEMENT', entityId: row.id, action: 'CLOSE_SOURCES', message: 'Closed the advances and claims a full and final settlement settled', metadata: { closed } });
  res.json({ settlement: await shapeOne(await payrollPrisma.finalSettlement.findUniqueOrThrow({ where: { id: row.id } })), closed });
});

/*
 * Lift an absconding case's hold from Payroll, with a reason: the same
 * release HR makes in People, recorded there (the case, its event) and here.
 * As strict as People's own (peopleTimeRules.ts: People edit, as HR) and
 * Payroll approval on top, a fresh authenticator code where the company asks
 * for one, and never by the person held.
 */
payrollSettlementsRouter.post('/orgs/:orgId/payroll/settlements/:id/release-hold', APPROVE, requirePermission(PEOPLE_MODULE, PermissionAction.EDIT, PEOPLE_RESOURCE.employees), requirePayrollStepUp, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const row = await findOwn(req, res);
  if (!row) return;
  if (!(await teamScope(req)).all) return res.status(403).json({ error: 'HR lifts a hold on a settlement.', code: 'HR_ONLY' });
  const mine = await ownRecordRefusal(req, row.employeeId, 'settlement hold');
  if (mine) return res.status(mine.status).json(mine.body);
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why the hold is lifted, e.g. "Came in to settle, 4 Nov".', code: 'REASON_NEEDED' });
  const hold = await settlementHold(row.orgId, row.employeeId);
  if (!hold) return res.status(409).json({ error: 'This settlement is not on hold.', code: 'NOT_HELD' });
  try {
    await releaseHold({ accountId: row.accountId, orgId: row.orgId, userId: req.auth!.userId, correlationId: String((req as any).id || `release_${row.id}`) }, hold.caseId, reason);
  } catch (e) {
    if (e instanceof AbsenceError) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
  await recordAudit(req, { entity: 'PAYROLL_SETTLEMENT', entityId: row.id, action: 'RELEASE_HOLD', message: `Lifted the absconding hold on a full and final settlement: ${reason.slice(0, 300)}`, metadata: { employeeId: row.employeeId, caseId: hold.caseId, reason: reason.slice(0, 300) } });
  res.json({ settlement: await shapeOne(row) });
});

payrollSettlementsRouter.post('/orgs/:orgId/payroll/settlements/:id/cancel', APPROVE, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const row = await findOwn(req, res);
  if (!row) return;
  if (row.status === 'PAID') return res.status(409).json({ error: 'A paid settlement stays on the record.', code: 'PAID' });
  const updated = await payrollPrisma.finalSettlement.update({ where: { id: row.id }, data: { status: 'CANCELLED' } });
  await recordAudit(req, { entity: 'PAYROLL_SETTLEMENT', entityId: row.id, action: 'CANCEL', message: 'Cancelled a full and final settlement', metadata: { employeeId: row.employeeId, was: row.status } });
  res.json({ settlement: await shapeOne(updated) });
});
