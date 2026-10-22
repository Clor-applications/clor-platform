import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { peopleRouteOk } from '../services/people/guards.js';
import { recordAudit } from '../services/auditTrail.js';
import { WORKSPACE, parseRecord, type WorkspaceKind } from '../services/people/workspace.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE } from '../services/people/guards.js';
import { PermissionAction } from '../constants/enums.js';
import { recordJoined } from '../services/people/employmentHistory.js';
import { startChecklist } from '../services/people/checklists.js';
import { emit as emitWebhook, employeeEvent } from '../services/attendance/webhooks.js';
import { pushEmployeeToReaders } from './iclock.js';

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
/**
 * Hire: an offered candidate becomes an employee in one step, with their
 * name, email and phone, the job's department when it names one the company
 * has, and the joining checklist started (founder: one connected HR system,
 * not separate registers). Needs Recruitment and Employees permission both.
 */
peopleWorkspaceRouter.post(`${path}/:id/hire`, async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  if (req.params.kind !== 'candidates') return res.status(404).json({ error: 'Only candidates are hired.' });
  const refused = await authorize(req, PEOPLE_MODULE, PermissionAction.CREATE as any, PEOPLE_RESOURCE.employees);
  if (refused) return res.status(refused.status).json(refused.body);
  const joining = String(req.body?.dateOfJoining || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joining)) return res.status(400).json({ error: 'Choose the joining date.' });
  const code = String(req.body?.code || '').trim() || null;
  const candidate = await peoplePrisma.peopleRecord.findFirst({ where: { id: req.params.id, accountId, orgId, kind: 'candidates' } });
  if (!candidate) return res.status(404).json({ error: 'That candidate was not found.' });
  if (candidate.employeeId) return res.status(409).json({ error: 'Already an employee.' });
  if (!['OFFERED', 'HIRED'].includes(candidate.status)) return res.status(409).json({ error: 'Make an offer first: only an offered candidate is hired.' });
  if (code && (await peoplePrisma.employee.findFirst({ where: { orgId, code }, select: { id: true } }))) return res.status(409).json({ error: `Employee ID ${code} is already used.` });
  const d = (candidate.details || {}) as Record<string, any>;
  const job = d.jobId ? await peoplePrisma.peopleRecord.findFirst({ where: { id: String(d.jobId), orgId, kind: 'recruitment' } }) : null;
  const deptName = String((job?.details as any)?.department || '').trim();
  const dept = deptName ? await peoplePrisma.department.findFirst({ where: { orgId, name: { equals: deptName, mode: 'insensitive' } } }) : null;
  const employee = await peoplePrisma.employee.create({
    data: {
      accountId, orgId, name: candidate.title, code,
      email: d.email || null, phone: d.phone || null,
      dateOfJoining: joining, status: 'ACTIVE',
      departmentId: dept?.id ?? null, department: dept?.name ?? null,
      createdByUserId: req.auth!.userId,
    } as any,
  });
  await peoplePrisma.peopleRecord.update({ where: { id: candidate.id }, data: { status: 'HIRED', employeeId: employee.id, version: { increment: 1 }, updatedBy: req.auth!.userId } });
  const who = { accountId, orgId, userId: req.auth!.userId };
  await recordJoined(who, employee, 'FORM');
  await startChecklist(who, employee, 'JOINING', joining);
  await pushEmployeeToReaders(orgId, employee, req.auth!.userId).catch(() => undefined);
  emitWebhook(orgId, 'employee.created', employeeEvent(employee));
  await recordAudit(req, { entity: 'Employee', entityId: employee.id, action: 'HIRED', message: `Hired ${candidate.title}${job ? ` for ${job.title}` : ''}`, metadata: { candidateId: candidate.id, jobId: job?.id ?? null } });
  res.status(201).json({ employee: { id: employee.id, name: employee.name, code: employee.code } });
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
