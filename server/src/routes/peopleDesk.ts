import { Router, type Request } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PEOPLE_MODULE, peopleRouteOk } from '../services/people/guards.js';
import { inScope, teamScope } from '../services/people/scope.js';
import { DESK_STATUSES, DeskError, URGENCIES, addMessage, assignRequest, categoriesOf, listRequests, moveToCase, raiseRequest, reopenRequest, requestDetail, resolveRequest, saveCategory, saveTemplate, templatesOf } from '../services/people/desk.js';
import { z } from 'zod';
import { check, flag, id, idParams, num, q, rawText, text } from '../middleware/validate.js';

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
/** Who, with their team scope: a team lead works only the requests of their own people; anyone else's reads as absent. */
const scoped = async (req: Request) => ({ ...who(req), scope: await teamScope(req) });
const sendError = (res: any, e: unknown) => {
  if (e instanceof DeskError) return res.status(e.status).json({ error: e.message });
  console.error('[people-desk]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong.' });
};

/*
 * What each route takes, checked before its handler (middleware/validate.ts). A wrong kind of value or one far too
 * long is refused with a 400; keys not named here are dropped; whether a field must be there, and the words for
 * it, stay the service's (desk.ts).
 */
/* A number a form may send as its text: the service makes the number and has the words for one that is not. */
const amount = z.union([num(-1e15, 1e15), text(40)]);
/* An id in a body: "" reads as none (an assignee taken off). */
const ref = text(200);
/* A file as the browser reads it (a data URL, or base64 with its type), up to what the JSON may carry (app.ts: 1 MB). */
const ATTACHMENT = z.object({ title: text(2000).nullish(), data: rawText(1024 * 1024).nullish(), mime: text(200).nullish() });
/* `id` in the body of a new template is read by the service as the one to change, as before. */
const TEMPLATE = z.object({ id: ref.nullish(), title: text(2000).nullish(), body: text(100_000).nullish(), category: text(80).nullish(), policyId: ref.nullish(), isActive: flag.nullish() });

peopleDeskRouter.get(base, can(PermissionAction.VIEW), check({ query: z.object({ status: q(text(40)), queue: q(text(200)), mine: q(text(10)), assignee: q(ref), employeeId: q(ref), q: q(text(2000)) }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const status = String(req.query.status || '').toUpperCase();
  if (status && status !== 'OPEN' && !DESK_STATUSES.includes(status as any)) return res.status(400).json({ error: 'Unknown status.' });
  const [requests, categories] = await Promise.all([
    listRequests(orgId, { status: status || undefined, queue: String(req.query.queue || '') || undefined, assigneeUserId: req.query.mine === '1' ? req.auth!.userId : String(req.query.assignee || '') || undefined, employeeId: String(req.query.employeeId || '') || undefined, q: String(req.query.q || ''), scope: await teamScope(req) }),
    categoriesOf(accountId, orgId),
  ]);
  res.json({ requests, categories, queues: [...new Set(categories.map((c) => c.queue))], urgencies: URGENCIES });
});

peopleDeskRouter.get(`${base}/categories`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ categories: await categoriesOf(req.tenant!.accountId, req.tenant!.orgId) });
});

peopleDeskRouter.put(`${base}/categories/:key`, can(PermissionAction.EDIT), check({ params: z.object({ key: id }), body: z.object({ label: text(2000).nullish(), queue: text(2000).nullish(), leadUserId: ref.nullish(), replyHours: amount.nullish(), resolveDays: amount.nullish(), isActive: flag.nullish() }) }), async (req, res) => {
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

peopleDeskRouter.post(`${base}/templates`, can(PermissionAction.EDIT), check({ body: TEMPLATE }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ template: await saveTemplate(who(req), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.put(`${base}/templates/:id`, can(PermissionAction.EDIT), check({ params: idParams, body: TEMPLATE }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ template: await saveTemplate(who(req), { ...(req.body || {}), id: String(req.params.id) }) });
  } catch (e) {
    sendError(res, e);
  }
});

/** HR raises one on an employee's behalf (a call, a visit to the desk). */
peopleDeskRouter.post(base, can(PermissionAction.EDIT), check({ body: z.object({ employeeId: ref.nullish(), category: text(80).nullish(), subject: text(2000).nullish(), description: text(50_000).nullish(), urgency: text(40).nullish(), replyChannel: text(40).nullish(), changeRef: text(2000).nullish(), attachment: ATTACHMENT.nullish() }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.body?.employeeId || ''), accountId, orgId }, select: { id: true } });
  if (!employee || !inScope(await teamScope(req), employee.id)) return res.status(400).json({ error: 'Pick the employee it is for.' });
  try {
    res.status(201).json({ request: await raiseRequest(who(req), employee.id, req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.get(`${base}/:id`, can(PermissionAction.VIEW), check({ params: idParams }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ request: await requestDetail(req.tenant!.orgId, String(req.params.id), { scope: await teamScope(req) }) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.post(`${base}/:id/messages`, can(PermissionAction.EDIT), check({ params: idParams, body: z.object({ body: text(100_000).nullish(), internal: flag.nullish(), templateId: ref.nullish(), attachment: ATTACHMENT.nullish(), waitForEmployee: flag.nullish() }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ message: await addMessage(await scoped(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.post(`${base}/:id/assign`, can(PermissionAction.EDIT), check({ params: idParams, body: z.object({ assigneeUserId: ref.nullish(), queue: text(2000).nullish() }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ request: await assignRequest(await scoped(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.post(`${base}/:id/resolve`, can(PermissionAction.EDIT), check({ params: idParams, body: z.object({ resolution: text(50_000).nullish() }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ request: await resolveRequest(await scoped(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.post(`${base}/:id/reopen`, can(PermissionAction.EDIT), check({ params: idParams }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ request: await reopenRequest(await scoped(req), String(req.params.id)) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleDeskRouter.post(`${base}/:id/move-to-case`, can(PermissionAction.EDIT), check({ params: idParams, body: z.object({ caseId: ref.nullish() }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ request: await moveToCase(await scoped(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});
