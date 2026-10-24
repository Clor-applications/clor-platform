import { Router, type Request } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PEOPLE_MODULE, peopleRouteOk } from '../services/people/guards.js';
import { DESK_STATUSES, DeskError, URGENCIES, addMessage, assignRequest, categoriesOf, listRequests, moveToCase, raiseRequest, reopenRequest, requestDetail, resolveRequest, saveCategory, saveTemplate, templatesOf } from '../services/people/desk.js';

/**
 * Help desk, HR's side (docs/people/02-PRD.md DESK-01..06). The HR Cases
 * grant opens it: VIEW to read the queues, EDIT to answer, assign, resolve
 * and keep categories and templates.
 */
export const peopleDeskRouter = Router();
peopleDeskRouter.use(requireAuth, requireTenantContext);

const CASES = 'HR Cases';
const can = (action: string) => requirePermission(PEOPLE_MODULE, action as any, CASES);
const base = '/orgs/:orgId/people/desk';
const who = (req: Request) => ({ accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth?.userId || null });
const sendError = (res: any, e: unknown) => {
  if (e instanceof DeskError) return res.status(e.status).json({ error: e.message });
  console.error('[people-desk]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong.' });
};

peopleDeskRouter.get(base, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const status = String(req.query.status || '').toUpperCase();
  if (status && status !== 'OPEN' && !DESK_STATUSES.includes(status as any)) return res.status(400).json({ error: 'Unknown status.' });
  const [requests, categories] = await Promise.all([
    listRequests(orgId, { status: status || undefined, queue: String(req.query.queue || '') || undefined, assigneeUserId: req.query.mine === '1' ? req.auth!.userId : String(req.query.assignee || '') || undefined, employeeId: String(req.query.employeeId || '') || undefined, q: String(req.query.q || '') }),
    categoriesOf(accountId, orgId),
  ]);
  res.json({ requests, categories, queues: [...new Set(categories.map((c) => c.queue))], urgencies: URGENCIES });
});

peopleDeskRouter.get(`${base}/categories`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ categories: await categoriesOf(req.tenant!.accountId, req.tenant!.orgId) });
});

peopleDeskRouter.put(`${base}/categories/:key`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ category: await saveCategory(who(req), String(req.params.key), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.get(`${base}/templates`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ templates: await templatesOf(req.tenant!.orgId) });
});

peopleDeskRouter.post(`${base}/templates`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ template: await saveTemplate(who(req), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.put(`${base}/templates/:id`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ template: await saveTemplate(who(req), { ...(req.body || {}), id: String(req.params.id) }) });
  } catch (e) {
    sendError(res, e);
  }
});

/** HR raises one on an employee's behalf (a call, a visit to the desk). */
peopleDeskRouter.post(base, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.body?.employeeId || ''), accountId, orgId }, select: { id: true } });
  if (!employee) return res.status(400).json({ error: 'Pick the employee it is for.' });
  try {
    res.status(201).json({ request: await raiseRequest(who(req), employee.id, req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.get(`${base}/:id`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ request: await requestDetail(req.tenant!.orgId, String(req.params.id)) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.post(`${base}/:id/messages`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ message: await addMessage(who(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.post(`${base}/:id/assign`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ request: await assignRequest(who(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.post(`${base}/:id/resolve`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ request: await resolveRequest(who(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.post(`${base}/:id/reopen`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ request: await reopenRequest(who(req), String(req.params.id)) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.post(`${base}/:id/move-to-case`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ request: await moveToCase(who(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});
