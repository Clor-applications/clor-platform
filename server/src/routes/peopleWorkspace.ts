import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { peopleRouteOk } from '../services/people/guards.js';
import { recordAudit } from '../services/auditTrail.js';
import { WORKSPACE, parseRecord, type WorkspaceKind } from '../services/people/workspace.js';

export const peopleWorkspaceRouter = Router();
peopleWorkspaceRouter.use(requireAuth, requireTenantContext);
const path = '/orgs/:orgId/people/workspace/:kind';
peopleWorkspaceRouter.use(path, async (req, res, next) => {
  if (!(await peopleRouteOk(req, res))) return;
  const kind = req.params.kind as WorkspaceKind;
  if (!Object.hasOwn(WORKSPACE, kind)) return res.status(404).json({ error: 'Unknown People module.' });
  const action = ({ GET: 'VIEW', POST: 'CREATE', PUT: 'EDIT', DELETE: 'DELETE' } as const)[req.method as 'GET'];
  if (!action) return res.sendStatus(405);
  return requirePermission('PEOPLE', action, WORKSPACE[kind].resource)(req, res, next);
});
peopleWorkspaceRouter.get(path, async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  const rows = await peoplePrisma.peopleRecord.findMany({ where: { accountId, orgId, kind: req.params.kind }, orderBy: { updatedAt: 'desc' } });
  res.json({ records: rows });
});
async function related(accountId: string, orgId: string, kind: WorkspaceKind, body: ReturnType<typeof parseRecord>) {
  if (body.employeeId && !(await peoplePrisma.employee.findFirst({ where: { id: body.employeeId, accountId, orgId, anonymisedAt: null }, select: { id: true } }))) throw Object.assign(new Error('That employee is not in this company.'), { status: 400 });
  if (kind === 'candidates' && 'jobId' in body.details && !(await peoplePrisma.peopleRecord.findFirst({ where: { id: body.details.jobId, kind: 'recruitment', accountId, orgId } }))) throw Object.assign(new Error('Select a job from this company.'), { status: 400 });
}
peopleWorkspaceRouter.post(path, async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  const kind = req.params.kind as WorkspaceKind;
  const { version: _version, ...body } = parseRecord(kind, req.body);
  await related(accountId, orgId, kind, body);
  const record = await peoplePrisma.peopleRecord.create({ data: { ...body, accountId, orgId, kind, createdBy: req.auth!.userId, updatedBy: req.auth!.userId } });
  await recordAudit(req, { entity: 'PeopleRecord', entityId: record.id, action: 'CREATE', message: `Created ${kind}: ${record.title}`, metadata: { kind } });
  res.status(201).json({ record });
});
peopleWorkspaceRouter.put(`${path}/:id`, async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  const kind = req.params.kind as WorkspaceKind;
  const body = parseRecord(kind, req.body);
  const where = { id: req.params.id, accountId, orgId, kind };
  const current = await peoplePrisma.peopleRecord.findFirst({ where });
  if (!current) return res.status(404).json({ error: 'That record was not found.' });
  if (!body.version || body.version !== current.version) return res.status(409).json({ error: 'This record changed. Reload it before saving.' });
  await related(accountId, orgId, kind, body);
  const { version, ...data } = body;
  const result = await peoplePrisma.peopleRecord.updateMany({ where: { ...where, version }, data: { ...data, version: { increment: 1 }, updatedBy: req.auth!.userId } });
  if (!result.count) return res.status(409).json({ error: 'This record changed. Reload it before saving.' });
  const record = await peoplePrisma.peopleRecord.findFirst({ where });
  await recordAudit(req, { entity: 'PeopleRecord', entityId: current.id, action: 'UPDATE', message: `Updated ${kind}: ${body.title}`, metadata: { kind, fromStatus: current.status, toStatus: body.status } });
  res.json({ record });
});
peopleWorkspaceRouter.delete(`${path}/:id`, async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  const where = { id: req.params.id, accountId, orgId, kind: req.params.kind };
  const current = await peoplePrisma.peopleRecord.findFirst({ where });
  if (!current) return res.status(404).json({ error: 'That record was not found.' });
  if (!['DRAFT', 'PLANNED', 'CANCELLED', 'ARCHIVED', 'REJECTED', 'CLOSED', 'RETIRED'].includes(current.status)) return res.status(409).json({ error: 'Close, cancel, or archive this record before deleting it.' });
  if (current.kind === 'recruitment') {
    const used = await peoplePrisma.peopleRecord.count({ where: { accountId, orgId, kind: 'candidates', details: { path: ['jobId'], equals: current.id } } });
    if (used) return res.status(409).json({ error: 'This job has candidates. Keep it closed for their history.' });
  }
  const deleted = await peoplePrisma.peopleRecord.deleteMany({ where: { ...where, version: current.version } });
  if (!deleted.count) return res.status(409).json({ error: 'This record changed. Reload before deleting.' });
  await recordAudit(req, { entity: 'PeopleRecord', entityId: current.id, action: 'DELETE', message: `Deleted ${current.kind}: ${current.title}` });
  res.json({ ok: true });
});
