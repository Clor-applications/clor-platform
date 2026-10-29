import { Router, type Request } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requireAnyPermission, requirePermission } from '../middleware/rbac.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE } from '../services/attendance/guards.js';
import { inboxFor } from '../services/people/inbox.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { correlationOf } from '../services/people/employees.js';
import type { Actor, ChangeSource } from '../services/people/changeLog.js';
import { ApprovalError, REQUEST_TYPES, RULE_TYPES, activeRule, cleanSteps, decide, mine, namesFor, reply, retireRule, saveRule, shape, submitRequest, waitingFor, withdraw, type RuleType } from '../services/people/approvals/engine.js';

/**
 * Approvals (docs/people/02-PRD.md APR-01..07): rules, requests, decisions,
 * stand-ins. Rules need the Approvals grant; acting on a request needs
 * Requests; a person always sees what they asked for.
 */
export const peopleApprovalsRouter = Router();
peopleApprovalsRouter.use(requireAuth, requireTenantContext);

const { approvals: APPROVALS, requests: REQUESTS } = PEOPLE_RESOURCE;
const can = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
const base = '/orgs/:orgId/people';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const actorOf = (req: Request, source: ChangeSource = 'FORM', reason: string | null = null): Actor => ({
  accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth?.userId || null, source, correlationId: correlationOf(req as any), reason,
});
const sendError = (res: any, e: unknown) => {
  if (e instanceof ApprovalError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

// ---- Rules -----------------------------------------------------------------

peopleApprovalsRouter.get(`${base}/approval-rules`, can(PermissionAction.VIEW, APPROVALS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const rows = await peoplePrisma.approvalRule.findMany({ where: { orgId }, orderBy: [{ requestType: 'asc' }, { version: 'desc' }] });
  res.json({ rules: rows, requestTypes: RULE_TYPES });
});

const ruleSchema = z.object({ requestType: z.enum(RULE_TYPES), name: z.string().trim().min(1, 'Name the rule.').max(120), steps: z.array(z.any()).min(1) });

/** Saving writes a new version of the rule for that request type. */
peopleApprovalsRouter.post(`${base}/approval-rules`, can(PermissionAction.EDIT, APPROVALS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const parsed = ruleSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the rule.' });
  const steps = cleanSteps(parsed.data.steps);
  if (typeof steps === 'string') return res.status(400).json({ error: steps });
  const { accountId, orgId } = req.tenant!;
  const rule = await saveRule({ accountId, orgId, userId: req.auth!.userId }, parsed.data.requestType, parsed.data.name, steps);
  res.status(201).json({ rule });
});

peopleApprovalsRouter.delete(`${base}/approval-rules/:requestType`, can(PermissionAction.DELETE, APPROVALS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const type = String(req.params.requestType) as RuleType;
  if (!(RULE_TYPES as readonly string[]).includes(type)) return res.status(404).json({ error: 'Unknown request type.' });
  const retired = await retireRule(req.tenant!.orgId, type);
  res.json({ ok: true, retired });
});

// ---- Requests --------------------------------------------------------------

peopleApprovalsRouter.get(`${base}/requests`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const userId = req.auth!.userId;
  const [waiting, asked] = await Promise.all([waitingFor(orgId, userId), mine(orgId, userId)]);
  const names = await namesFor([...waiting, ...asked].flatMap((r) => [r.requesterUserId, ...r.steps.flatMap((s) => [s.approverUserId, s.decidedByUserId, s.standInForUserId, ...((s.candidateUserIds as string[]) || [])].filter(Boolean) as string[])]), orgId);
  res.json({ waitingForMe: await Promise.all(waiting.map((r) => shape(r, names))), mine: await Promise.all(asked.map((r) => shape(r, names))) });
});

/**
 * One Approvals inbox (HR view audit, gap 1): People approvals, leave,
 * attendance requests and Help Desk cases waiting on the reader, oldest
 * first, with a count per kind. Each source is shown only to those who may
 * open it (services/people/inbox.ts); decisions go through each source's own
 * routes, single or bulk.
 */
const inboxRight = requireAnyPermission(
  [PEOPLE_MODULE, PermissionAction.VIEW, REQUESTS],
  [ATTENDANCE_MODULE, PermissionAction.APPROVE, ATTENDANCE_RESOURCE.leave],
  [ATTENDANCE_MODULE, PermissionAction.APPROVE, ATTENDANCE_RESOURCE.requests],
  [PEOPLE_MODULE, PermissionAction.VIEW, 'HR Cases'],
);
peopleApprovalsRouter.get(
  `${base}/inbox`,
  /* Someone a step of the leave approval rule names has an inbox, whatever else they may do. */
  async (req: any, res: any, next: any) => {
    const orgId = req.tenant?.orgId || req.params?.orgId;
    const userId = req.auth?.userId;
    if (orgId && userId && (await peoplePrisma.leaveRequest.count({ where: { orgId, status: 'PENDING', ruleId: { not: null }, stepUserIds: { has: userId } } }))) return next();
    return inboxRight(req, res, next);
  },
  async (req, res) => {
    if (!(await peopleRouteOk(req, res))) return;
    res.json(await inboxFor(req));
  },
);

peopleApprovalsRouter.get(`${base}/requests/:id`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const r = await peoplePrisma.approvalRequest.findFirst({ where: { id: String(req.params.id), orgId }, include: { steps: { orderBy: { order: 'asc' } } } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  const userId = req.auth!.userId;
  const involved = r.requesterUserId === userId || r.steps.some((s) => ((s.candidateUserIds as string[]) || []).includes(userId) || s.decidedByUserId === userId);
  if (!involved && (await requirePermissionCheck(req, APPROVALS))) return res.status(404).json({ error: 'No such request.' });
  res.json({ request: await shape(r) });
});
/** True when the caller lacks the grant (used where a 404 is the right answer). */
async function requirePermissionCheck(req: Request, resource: string) {
  const { authorize } = await import('../middleware/rbac.js');
  return Boolean(await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, resource));
}

const submitSchema = z.object({
  requestType: z.enum(REQUEST_TYPES),
  subjectEmployeeId: z.string().trim().max(60).optional().nullable(),
  title: z.string().trim().min(1, 'Say what is asked.').max(200),
  payload: z.record(z.string(), z.any()).default({}),
});

/** Ask for something. `Idempotency-Key` makes a double click one request (APR-07). */
peopleApprovalsRouter.post(`${base}/requests`, can(PermissionAction.CREATE, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const parsed = submitSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the request.' });
  const { orgId } = req.tenant!;
  if (parsed.data.subjectEmployeeId && !(await peoplePrisma.employee.findFirst({ where: { id: parsed.data.subjectEmployeeId, orgId }, select: { id: true } }))) return res.status(400).json({ error: 'That person is not in this company.' });
  const key = String(req.headers['idempotency-key'] || req.body?.idempotencyKey || '').trim().slice(0, 120) || null;
  try {
    const r = await submitRequest(actorOf(req, 'FORM', typeof parsed.data.payload?.reason === 'string' ? parsed.data.payload.reason : null), { ...parsed.data, idempotencyKey: key });
    res.status(r.existed ? 200 : 201).json({ request: await shape(r.request), outcome: r.outcome ?? null, existed: Boolean(r.existed) });
  } catch (e) {
    return sendError(res, e);
  }
});

type DecideAction = 'approve' | 'reject' | 'more-info';
const DECIDE_ACTIONS: readonly DecideAction[] = ['approve', 'reject', 'more-info'];
const commentOf = (req: Request) => {
  const raw = typeof req.body?.comment === 'string' ? req.body.comment : typeof req.body?.note === 'string' ? req.body.note : '';
  return raw.trim() || null;
};
/** The reason rule, the same for one request and for many: rejecting or asking for more says why. */
const reasonMissing = (action: DecideAction, comment: string | null) => (action !== 'approve' && !comment ? (action === 'reject' ? 'Say why it is not approved.' : 'Say what more is needed.') : null);

for (const action of DECIDE_ACTIONS) {
  peopleApprovalsRouter.post(`${base}/requests/:id/${action}`, can(PermissionAction.APPROVE, REQUESTS), async (req, res) => {
    if (!(await peopleRouteOk(req, res))) return;
    const comment = commentOf(req);
    const missing = reasonMissing(action, comment);
    if (missing) return res.status(400).json({ error: missing });
    try {
      const r = await decide(actorOf(req, 'APPROVAL', comment), String(req.params.id), action, comment);
      res.json({ request: await shape(r.request), outcome: (r as any).outcome ?? null });
    } catch (e) {
      return sendError(res, e);
    }
  });
}

/**
 * Decide several People approvals at once from the Approvals inbox. Each id
 * goes through the same `decide` as one request — the approver check, nobody
 * deciding their own or their own subject (maker-checker), the step that is
 * waiting now, and the type's own checks — so the rules hold per request, and
 * one refused never stops the rest. One note goes with every decision, and the
 * reason rule is the single route's: rejecting or asking for more says why.
 */
peopleApprovalsRouter.post(`${base}/approvals/bulk-decide`, can(PermissionAction.APPROVE, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const ids: string[] = Array.isArray(req.body?.ids) ? [...new Set<string>(req.body.ids.map(String).filter(Boolean))].slice(0, 200) : [];
  const action: DecideAction | null = typeof req.body?.action === 'string'
    ? (DECIDE_ACTIONS.includes(req.body.action) ? req.body.action : null)
    : req.body?.approve === false ? 'reject' : 'approve';
  if (!action) return res.status(400).json({ error: 'Approve, reject or ask for more.' });
  if (!ids.length) return res.status(400).json({ error: 'Choose the requests.' });
  const comment = commentOf(req);
  const missing = reasonMissing(action, comment);
  if (missing) return res.status(400).json({ error: missing });
  const results: Array<{ id: string; error: string; code?: string }> = [];
  let done = 0;
  for (const id of ids) {
    try {
      await decide(actorOf(req, 'APPROVAL', comment), id, action, comment);
      done += 1;
    } catch (e) {
      if (e instanceof ApprovalError) results.push({ id, error: e.message, ...(e.code ? { code: e.code } : {}) });
      else {
        console.error('[approvals] bulk decision failed:', e instanceof Error ? e.message : e);
        results.push({ id, error: 'Something went wrong.' });
      }
    }
  }
  res.json({ done, failed: results.length, results });
});

peopleApprovalsRouter.post(`${base}/requests/:id/reply`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (!note) return res.status(400).json({ error: 'Write the answer.' });
  try {
    res.json({ request: await shape(await reply(actorOf(req), String(req.params.id), note)) });
  } catch (e) {
    return sendError(res, e);
  }
});

peopleApprovalsRouter.post(`${base}/requests/:id/withdraw`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ request: await shape(await withdraw(actorOf(req), String(req.params.id))) });
  } catch (e) {
    return sendError(res, e);
  }
});

// ---- Stand-ins -------------------------------------------------------------

peopleApprovalsRouter.get(`${base}/stand-ins`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const rows = await peoplePrisma.standIn.findMany({ where: { orgId, userId: req.auth!.userId }, orderBy: { fromDate: 'desc' } });
  const names = await namesFor(rows.map((r) => r.standInUserId), orgId);
  res.json({ standIns: rows.map((r) => ({ ...r, standInName: names.get(r.standInUserId) || '' })) });
});

/** Name someone to decide in my place between two dates. Only my own; a manager cannot be given one. */
peopleApprovalsRouter.post(`${base}/stand-ins`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const parsed = z.object({ standInUserId: z.string().trim().min(1), fromDate: z.string().regex(ISO_DATE), toDate: z.string().regex(ISO_DATE) }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Name the person and the dates (YYYY-MM-DD).' });
  const { accountId, orgId } = req.tenant!;
  if (parsed.data.toDate < parsed.data.fromDate) return res.status(400).json({ error: 'The end is before the start.' });
  if (parsed.data.standInUserId === req.auth!.userId) return res.status(400).json({ error: 'Someone else has to stand in.' });
  const member = await platformPrisma.userOrgMembership.findFirst({ where: { orgId, userId: parsed.data.standInUserId }, select: { id: true } });
  if (!member) return res.status(400).json({ error: 'That person is not in this company.' });
  const row = await peoplePrisma.standIn.create({ data: { accountId, orgId, userId: req.auth!.userId, ...parsed.data } });
  res.status(201).json({ standIn: row });
});

peopleApprovalsRouter.delete(`${base}/stand-ins/:id`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const r = await peoplePrisma.standIn.deleteMany({ where: { id: String(req.params.id), orgId: req.tenant!.orgId, userId: req.auth!.userId } });
  if (!r.count) return res.status(404).json({ error: 'No such stand-in.' });
  res.json({ ok: true });
});

/** Is there a rule for this type? Screens ask before showing "send for approval". */
peopleApprovalsRouter.get(`${base}/approval-rules/active/:requestType`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const type = String(req.params.requestType) as RuleType;
  if (!(RULE_TYPES as readonly string[]).includes(type)) return res.status(404).json({ error: 'Unknown request type.' });
  const rule = await activeRule(req.tenant!.orgId, type);
  res.json({ rule: rule ? { id: rule.id, name: rule.name, version: rule.version, steps: rule.steps } : null });
});
