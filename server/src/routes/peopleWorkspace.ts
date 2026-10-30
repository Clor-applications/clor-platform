import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { recordAudit } from '../services/auditTrail.js';
import { MODULE_OF_KIND, WORKSPACE, announcementReaches, departmentNames, parseRecord, type WorkspaceKind } from '../services/people/workspace.js';
import { authorize } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { isFeatureEnabled } from '../services/features.js';
import { inScope, teamScope, type TeamScope } from '../services/people/scope.js';
import { today } from '../services/attendance/days.js';

/**
 * A record about one person follows the team scope like every other People
 * read; a record about nobody in particular (a job, a training plan) stays
 * visible to everyone who may open the module, as before.
 */
const recordScope = (scope: TeamScope): Record<string, unknown> => (scope.all ? {} : { OR: [{ employeeId: null }, { employeeId: { in: scope.ids } }] });

/** What a People user without the module's right may read of it: what the employee app shows everyone. */
const PUBLISHED_ONLY: Partial<Record<WorkspaceKind, string>> = { announcements: 'PUBLISHED', events: 'SCHEDULED' };

export const peopleWorkspaceRouter = Router();
peopleWorkspaceRouter.use(requireAuth, requireTenantContext);
const path = '/orgs/:orgId/people/workspace/:kind';
peopleWorkspaceRouter.use(path, async (req, res, next) => {
  if (!(await peopleRouteOk(req, res))) return;
  const kind = req.params.kind as WorkspaceKind;
  if (!Object.hasOwn(WORKSPACE, kind)) return res.status(404).json({ error: 'Unknown People module.' });
  /* A module the company switched off, or its People plan does not carry, takes no work (Settings → Modules). */
  const mod = MODULE_OF_KIND[kind];
  if (mod && !(await isFeatureEnabled(req.tenant!.accountId, req.tenant!.orgId, mod.feature))) {
    return res.status(403).json({ error: `${mod.label} is switched off for this company. Switch it on in People → Settings → Modules.`, code: 'MODULE_OFF', feature: mod.feature });
  }
  const action = ({ GET: 'VIEW', POST: 'CREATE', PUT: 'EDIT', DELETE: 'DELETE' } as const)[req.method as 'GET'];
  if (!action) return res.sendStatus(405);
  /*
   * Published announcements and scheduled events are no secret: every employee
   * reads them in the employee app. Someone who works in People without the
   * module's own right (a team manager on Home) reads those, and only those
   * (the GET below filters); drafts, cancelled events and every write stay
   * with the module's rights.
   */
  if (action === 'VIEW' && PUBLISHED_ONLY[kind] && (await authorize(req, 'PEOPLE', PermissionAction.VIEW as any, WORKSPACE[kind].resource))) {
    if (await authorize(req, 'PEOPLE', PermissionAction.VIEW as any, PEOPLE_RESOURCE.employees)) return requirePermission('PEOPLE', action, WORKSPACE[kind].resource)(req, res, next);
    res.locals.publishedOnly = true;
    return next();
  }
  return requirePermission('PEOPLE', action, WORKSPACE[kind].resource)(req, res, next);
});
/* A reader's copy: only the fields the employee app sends (plus the symbol Home draws), never the audience, whose ids name other employees. */
const ANNOUNCEMENT_READ = ['body', 'symbol'];
const only = <T extends { details: unknown }>(r: T, keys: string[]) => {
  const d = (r.details || {}) as Record<string, unknown>;
  return { ...r, details: Object.fromEntries(keys.filter((k) => d[k] !== undefined).map((k) => [k, d[k]])) };
};
peopleWorkspaceRouter.get(path, async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  /* `employeeId`: one person's records (their assets on the employee record), still inside the caller's team. */
  const one = typeof req.query.employeeId === 'string' && req.query.employeeId ? { employeeId: req.query.employeeId } : {};
  const where = { accountId, orgId, kind: req.params.kind, ...one, ...recordScope(await teamScope(req)) };
  const reaching = async <T extends { details: unknown }>(records: T[]) => {
    const me = await peoplePrisma.employee.findFirst({ where: { accountId, orgId, userId: req.auth!.userId }, select: { id: true, branchId: true, areaId: true, departmentId: true, department: true } });
    const names = await departmentNames(orgId);
    return records.filter((r) => announcementReaches(r.details, me || { id: '' }, names));
  };
  if (res.locals.publishedOnly === true) {
    /* As the employee app (portal.ts, /company-updates): no bookkeeping columns, only what reaches this reader, no past events. */
    const records = await peoplePrisma.peopleRecord.findMany({ where: { ...where, status: PUBLISHED_ONLY[req.params.kind as WorkspaceKind] }, orderBy: { updatedAt: 'desc' }, select: { id: true, kind: true, title: true, status: true, details: true, updatedAt: true } });
    if (req.params.kind === 'announcements') return res.json({ records: (await reaching(records)).map((r) => only(r, ANNOUNCEMENT_READ)) });
    const t = today();
    return res.json({ records: records.filter((r) => String((r.details as any).endDate || (r.details as any).startDate) >= t).map((r) => only(r, ['startDate', 'endDate', 'location', 'description', 'symbol'])) });
  }
  const rows = await peoplePrisma.peopleRecord.findMany({ where, orderBy: { updatedAt: 'desc' } });
  /* Someone who reads announcements but may not write them reads what is published for them, as in the employee app (time depth, gap 20). */
  const readerOnly = req.params.kind === 'announcements' && (await authorize(req, 'PEOPLE', PermissionAction.EDIT as any, WORKSPACE.announcements.resource)) && (await authorize(req, 'PEOPLE', PermissionAction.CREATE as any, WORKSPACE.announcements.resource));
  if (readerOnly) return res.json({ records: (await reaching(rows.filter((r) => r.status === 'PUBLISHED'))).map((r) => only(r, ANNOUNCEMENT_READ)) });
  res.json({ records: rows });
});
async function related(accountId: string, orgId: string, kind: WorkspaceKind, body: ReturnType<typeof parseRecord>) {
  if (body.employeeId && !(await peoplePrisma.employee.findFirst({ where: { id: body.employeeId, accountId, orgId, anonymisedAt: null }, select: { id: true } }))) throw Object.assign(new Error('That employee is not in this company.'), { status: 400 });
  /* An announcement's audience names this company's own departments, branches, locations or people, nothing else. */
  const d = body.details as { audienceKind?: string; audienceIds?: string[] };
  if (kind === 'announcements' && d.audienceKind && d.audienceKind !== 'ALL' && d.audienceIds?.length) {
    const ids = [...new Set(d.audienceIds)];
    const where = { id: { in: ids }, orgId };
    const found = d.audienceKind === 'DEPARTMENT' ? await peoplePrisma.department.count({ where })
      : d.audienceKind === 'LOCATION' ? await peoplePrisma.area.count({ where })
        : d.audienceKind === 'PEOPLE' ? await peoplePrisma.employee.count({ where: { ...where, accountId, anonymisedAt: null } })
          : await platformPrisma.branch.count({ where });
    if (found !== ids.length) throw Object.assign(new Error('Someone or something in the audience is not in this company.'), { status: 400 });
  }
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
  const scope = await teamScope(req);
  const current = await peoplePrisma.peopleRecord.findFirst({ where: { ...where, ...recordScope(scope) } });
  if (!current) return res.status(404).json({ error: 'That record was not found.' });
  /* Nor can a scoped user move a record onto someone outside their team. */
  if (body.employeeId && !inScope(scope, body.employeeId)) return res.status(400).json({ error: 'That employee is not in this company.' });
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
  /* The same team limit as reading and changing: a record outside it is not there to delete. */
  const current = await peoplePrisma.peopleRecord.findFirst({ where: { ...where, ...recordScope(await teamScope(req)) } });
  if (!current) return res.status(404).json({ error: 'That record was not found.' });
  if (!['DRAFT', 'PLANNED', 'CANCELLED', 'ARCHIVED', 'REJECTED', 'CLOSED', 'RETIRED'].includes(current.status)) return res.status(409).json({ error: 'Close, cancel, or archive this record before deleting it.' });
  const deleted = await peoplePrisma.peopleRecord.deleteMany({ where: { ...where, version: current.version } });
  if (!deleted.count) return res.status(409).json({ error: 'This record changed. Reload before deleting.' });
  await recordAudit(req, { entity: 'PeopleRecord', entityId: current.id, action: 'DELETE', message: `Deleted ${current.kind}: ${current.title}` });
  res.json({ ok: true });
});
