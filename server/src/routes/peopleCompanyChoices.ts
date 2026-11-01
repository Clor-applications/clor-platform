import { Router, type Request, type Response } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { CHOICE_KEYS, ChoiceError, choicesScreen, mayChange, readsRevisionsAsHr, saveChoice, type ChoiceKey } from '../services/people/companyChoices.js';
import { todayIst } from '../utils/istDate.js';

/**
 * People → Settings → Company choices (docs/people/workflow-engine/SPEC.md 3, 8.1): the decisions HR and the owner
 * choose, read by anyone who reads employees, each changed only by whoever its rule names (403 says who).
 *
 * And the one read the salary-revisions choice opens: HR without Payroll access reads the list, old and new pay,
 * read only. Nothing else in Payroll opens; each reader's first read of a day is in the audit trail.
 */
export const peopleCompanyChoicesRouter = Router();
const base = '/orgs/:orgId/people';
for (const p of ['company-choices', 'salary-revisions']) peopleCompanyChoicesRouter.use(`${base}/${p}`, requireAuth, requireTenantContext);

const view = requirePermission(PEOPLE_MODULE, PermissionAction.VIEW, PEOPLE_RESOURCE.employees);
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    await fn(req, res);
  } catch (e: any) {
    if (e instanceof ChoiceError) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    console.error('[company choices]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong. Try again in a moment.', requestId: (req as any).id || null });
  }
};

peopleCompanyChoicesRouter.get(`${base}/company-choices`, view, handle(async (req, res) => {
  res.set('Cache-Control', 'private, no-store').json(await choicesScreen(req));
}));

peopleCompanyChoicesRouter.put(`${base}/company-choices/:key`, view, handle(async (req, res) => {
  const key = String(req.params.key) as ChoiceKey;
  if (!CHOICE_KEYS.includes(key)) return res.status(404).json({ error: 'No such choice.' });
  const may = await mayChange(req, key);
  if (!may.ok) return res.status(403).json({ error: may.error, code: 'NOT_YOURS_TO_CHANGE' });
  await saveChoice(req, key, req.body?.value);
  res.json(await choicesScreen(req));
}));

/**
 * The day's read line, written once even when two pages load at once: the check and the write run in one
 * transaction holding a lock on this reader's day, so the second waits, then sees the first's line.
 */
async function auditOncePerDay(req: Request, entityId: string, count: number) {
  const { accountId, orgId, branchId } = req.tenant!;
  try {
    await platformPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`salary-revisions-read:${orgId}:${entityId}`}, 0))`;
      if (await tx.auditLog.findFirst({ where: { orgId, entity: 'SalaryRevision', action: 'SALARY_REVISION_VIEWED', entityId }, select: { id: true } })) return;
      await tx.auditLog.create({ data: { accountId, orgId, branchId: branchId || '', entity: 'SalaryRevision', entityId, action: 'SALARY_REVISION_VIEWED', message: 'Read salary revisions as HR (read only, by the company’s choice)', metadata: JSON.stringify({ count }), createdByUserId: req.auth!.userId, correlationId: typeof (req as any).id === 'string' ? String((req as any).id).slice(0, 80) : null } });
    });
    if (req.res) req.res.locals.audited = true;
  } catch (e) {
    console.error('[salary revisions] read not audited:', e instanceof Error ? e.message : e);
  }
}

/** Salary revisions for HR without Payroll access, when the company allows it (3.3). Read only. */
peopleCompanyChoicesRouter.get(`${base}/salary-revisions`, view, handle(async (req, res) => {
  if (!(await readsRevisionsAsHr(req))) return res.status(403).json({ error: 'Salary revisions are kept with Payroll. The owner can let HR read them in Settings → Company choices.', code: 'NOT_OPEN' });
  const { accountId, orgId } = req.tenant!;
  const rows = await payrollPrisma.salaryRevision.findMany({ where: { accountId, orgId }, orderBy: { createdAt: 'desc' }, take: 300, select: { id: true, employeeId: true, currentAnnualCtc: true, proposedAnnualCtc: true, incrementPercent: true, effectiveFrom: true, status: true, createdAt: true } });
  const people = rows.length ? new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, name: true, code: true } })).map((p) => [p.id, p])) : new Map();
  /* Once a day per reader: "Asha read salary revisions" without a line per page load. */
  const day = todayIst();
  const entityId = `${req.auth!.userId}:${day}`;
  await auditOncePerDay(req, entityId, rows.length);
  res.set('Cache-Control', 'private, no-store').json({
    readOnly: true,
    revisions: rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeName: people.get(r.employeeId)?.name || 'Unknown employee', employeeCode: people.get(r.employeeId)?.code || '', currentAnnualCtc: Number(r.currentAnnualCtc ?? 0), proposedAnnualCtc: Number(r.proposedAnnualCtc ?? 0), incrementPercent: Number(r.incrementPercent ?? 0), effectiveFrom: r.effectiveFrom, status: r.status, createdAt: r.createdAt })),
  });
}));
