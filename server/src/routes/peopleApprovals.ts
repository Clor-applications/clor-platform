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
import { todayIst } from '../services/people/lifecycle/board.js';
import { leavingReasonFilter } from '../services/people/companyChoices.js';
import { cleanTypes, covers, deciders, findStandIn, listStandIns, nameStandIn, removeStandIn, timeOnly } from '../services/people/approvals/standIns.js';
import type { Actor, ChangeSource } from '../services/people/changeLog.js';
import { ApprovalError, REQUEST_TYPES, RULE_TYPES, isFormType, activeRule, decide, mine, namesFor, previewRule, reply, retireRule, saveRuleSpec, shape, stepsOfRule, submitRequest, twoPersonProblem, waitingFor, withdraw, type RuleType } from '../services/people/approvals/engine.js';
import { cleanRule, isRuleProblem, legacySteps, normaliseAutoApprove, normaliseConditions, v1Exact } from '../services/people/approvals/spec.js';
import { recordAudit } from '../services/auditTrail.js';
import { inScope, teamScope } from '../services/people/scope.js';
import { changePayloadProblem } from '../services/people/approvals/changeFields.js';

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
  const rows = await peoplePrisma.approvalRule.findMany({ where: { orgId }, orderBy: [{ requestType: 'asc' }, { variantKey: 'asc' }, { version: 'desc' }] });
  /* Request types HR made (gap 25): each has its own rule, written FORM:<id>, and is named here so the screen can say which. */
  const forms = await peoplePrisma.requestForm.findMany({ where: { orgId }, select: { id: true, name: true, active: true }, orderBy: { name: 'asc' } });
  /*
   * Each rule in both shapes (SPEC 5.2): `spec` is version 2, as the engine reads it; `steps` is the
   * first shape the rules screen edits today, and `editableHere` says whether that shape says all of it
   * (several approvers in a step, ALL mode, more conditions, a due time in hours or a variant do not fit).
   */
  const rules = rows.map((r) => ({
    ...r, steps: legacySteps(r.steps), spec: stepsOfRule(r), editableHere: v1Exact(r.steps) && !r.variantKey && !normaliseAutoApprove(r.autoApprove).length,
    appliesWhen: normaliseConditions(r.appliesWhen), autoApprove: normaliseAutoApprove(r.autoApprove),
  }));
  res.json({ rules, requestTypes: RULE_TYPES, forms: forms.map((f) => ({ requestType: `FORM:${f.id}`, name: f.name, active: f.active })) });
});

/** A fixed type, or one of this company's own request types (FORM:<id>). */
const ruleTypeOk = async (orgId: string, type: string) => (RULE_TYPES as readonly string[]).includes(type) || (isFormType(type) && Boolean(await peoplePrisma.requestForm.findFirst({ where: { id: type.slice(5), orgId }, select: { id: true } })));
const ruleSchema = z.object({
  requestType: z.string().trim().max(60),
  name: z.string().trim().min(1, 'Name the rule.').max(120),
  steps: z.array(z.any()).min(1),
  variantKey: z.string().trim().max(40).optional().nullable(),
  appliesWhen: z.array(z.any()).optional().nullable(),
  priority: z.number().int().optional().nullable(),
  autoApprove: z.array(z.any()).optional().nullable(),
});
const ruleInvalid = (res: any, p: { error: string; step?: number; field?: string }) => res.status(400).json({ error: p.error, code: 'RULE_INVALID', ...(p.step ? { step: p.step } : {}), ...(p.field ? { field: p.field } : {}) });

/**
 * Saving writes a new version of the rule for that request type (or one of its variants). Steps come in
 * either shape and are saved as version 2; the version before and after go to the audit trail.
 */
peopleApprovalsRouter.post(`${base}/approval-rules`, can(PermissionAction.EDIT, APPROVALS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const parsed = ruleSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the rule.', code: 'RULE_INVALID' });
  const { accountId, orgId } = req.tenant!;
  const spec = cleanRule({ requestType: parsed.data.requestType, name: parsed.data.name, steps: parsed.data.steps, variantKey: parsed.data.variantKey ?? '', appliesWhen: parsed.data.appliesWhen ?? undefined, priority: parsed.data.priority ?? undefined, autoApprove: parsed.data.autoApprove ?? undefined });
  if (isRuleProblem(spec)) return ruleInvalid(res, spec);
  /* Money, all of them: only where this company has two different people to approve it (re-review of PR #93). */
  const twoPeople = await twoPersonProblem({ accountId, orgId }, spec);
  if (twoPeople) return ruleInvalid(res, twoPeople);
  if (!(await ruleTypeOk(orgId, parsed.data.requestType))) return res.status(400).json({ error: 'Unknown request type.', code: 'RULE_INVALID', field: 'requestType' });
  const before = await peoplePrisma.approvalRule.findFirst({ where: { orgId, requestType: spec.requestType, variantKey: spec.variantKey, active: true }, orderBy: { version: 'desc' } });
  const rule = await saveRuleSpec({ accountId, orgId, userId: req.auth!.userId }, spec);
  const by = (await namesFor([req.auth!.userId], orgId)).get(req.auth!.userId) || 'Someone';
  await recordAudit(req, {
    entity: 'APPROVAL_RULE', entityId: rule.id, action: 'SAVED',
    message: `${by} saved the approval rule "${rule.name}"${spec.variantKey ? ` (variant ${spec.variantKey})` : ''} as version ${rule.version}`,
    metadata: {
      requestType: rule.requestType, variantKey: rule.variantKey, version: rule.version,
      before: before ? { version: before.version, steps: stepsOfRule(before), appliesWhen: normaliseConditions(before.appliesWhen), autoApprove: normaliseAutoApprove(before.autoApprove) } : null,
      after: { steps: spec.steps, appliesWhen: spec.appliesWhen, autoApprove: spec.autoApprove, priority: spec.priority },
    },
  });
  res.status(201).json({ rule: { ...rule, steps: legacySteps(rule.steps), spec: stepsOfRule(rule) } });
});

/**
 * Who would decide each step for this person and amount, today, and why (SPEC 8.1). For a draft rule
 * (`rule`), or the rule a request would follow now. Creates nothing.
 */
const previewSchema = z.object({
  requestType: z.string().trim().max(60),
  rule: z.object({ name: z.string().trim().max(120).optional(), steps: z.array(z.any()).min(1), autoApprove: z.array(z.any()).optional().nullable() }).optional().nullable(),
  sample: z.object({ employeeId: z.string().trim().max(60).optional().nullable(), requesterUserId: z.string().trim().max(80).optional().nullable(), payload: z.record(z.string(), z.any()).optional().nullable() }),
});
peopleApprovalsRouter.post(`${base}/approval-rules/preview`, can(PermissionAction.EDIT, APPROVALS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const parsed = previewSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Choose a person to try it with.', code: 'RULE_INVALID' });
  const { accountId, orgId } = req.tenant!;
  const b = parsed.data;
  if (!(await ruleTypeOk(orgId, b.requestType))) return res.status(400).json({ error: 'Unknown request type.', code: 'RULE_INVALID', field: 'requestType' });
  /* Leave walks its own steps until it moves onto the engine (phase 2c): a preview here would not be what leave does. */
  if (b.requestType === 'LEAVE') return res.status(400).json({ error: 'Leave moves onto these rules in the next phase; its preview comes with it.', code: 'RULE_INVALID', field: 'requestType' });
  let draft = null;
  if (b.rule) {
    const spec = cleanRule({ requestType: b.requestType, name: b.rule.name || 'Draft', steps: b.rule.steps, autoApprove: b.rule.autoApprove ?? undefined });
    if (isRuleProblem(spec)) return ruleInvalid(res, spec);
    draft = spec;
  }
  /* A team-scoped editor tries it only with people in their team (review of PR #93): outside it reads as absent. */
  if (b.sample.employeeId && !inScope(await teamScope(req), b.sample.employeeId)) return res.status(404).json({ error: 'No such person.' });
  /* A named requester must be someone in this company. */
  if (b.sample.requesterUserId && !(await platformPrisma.userOrgMembership.findFirst({ where: { orgId, userId: b.sample.requesterUserId }, select: { id: true } }))) {
    return res.status(400).json({ error: 'That person is not in this company.', code: 'RULE_INVALID', field: 'sample' });
  }
  try {
    res.json(await previewRule({ accountId, orgId }, { requestType: b.requestType, rule: draft, sample: b.sample }));
  } catch (e) {
    return sendError(res, e);
  }
});

peopleApprovalsRouter.delete(`${base}/approval-rules/:requestType`, can(PermissionAction.DELETE, APPROVALS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const type = String(req.params.requestType) as RuleType;
  if (!(await ruleTypeOk(req.tenant!.orgId, type))) return res.status(404).json({ error: 'Unknown request type.' });
  const was = await activeRule(req.tenant!.orgId, type);
  const retired = await retireRule(req.tenant!.orgId, type);
  if (was && retired) await auditRetired(req, was);
  res.json({ ok: true, retired });
});

/** Switching a rule off is audited by name, like saving one (review of PR #93). */
async function auditRetired(req: Request, rule: { id: string; name: string; requestType: string; variantKey: string; version: number }) {
  const by = (await namesFor([req.auth!.userId], req.tenant!.orgId)).get(req.auth!.userId) || 'Someone';
  await recordAudit(req, { entity: 'APPROVAL_RULE', entityId: rule.id, action: 'RETIRED', message: `${by} switched off the approval rule "${rule.name}"${rule.variantKey ? ` (variant ${rule.variantKey})` : ''}`, metadata: { requestType: rule.requestType, variantKey: rule.variantKey, version: rule.version } });
}

/** Retire one variant of a type's rule; requests already waiting under it keep their steps. */
peopleApprovalsRouter.delete(`${base}/approval-rules/:requestType/:variant`, can(PermissionAction.DELETE, APPROVALS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const type = String(req.params.requestType) as RuleType;
  const variant = String(req.params.variant);
  if (!(await ruleTypeOk(req.tenant!.orgId, type))) return res.status(404).json({ error: 'Unknown request type.' });
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(variant)) return res.status(404).json({ error: 'No such variant.' });
  const was = await peoplePrisma.approvalRule.findFirst({ where: { orgId: req.tenant!.orgId, requestType: type, variantKey: variant, active: true }, orderBy: { version: 'desc' } });
  const retired = await retireRule(req.tenant!.orgId, type, variant);
  if (!retired) return res.status(404).json({ error: 'No such variant.' });
  if (was) await auditRetired(req, was);
  res.json({ ok: true, retired });
});

// ---- Requests --------------------------------------------------------------

/**
 * A resignation's reason is the reason typed for leaving (SPEC 3.5): the same rule as everywhere, by the leaving's
 * last day. HR, the owner and admins read it, and the person resigning; Viewer and IT Administrator when the
 * company says so; the manager who decides the last day only when HR allows it for that leaving.
 */
type Shaped = Awaited<ReturnType<typeof shape>>;
async function readable(req: Request, rows: Shaped[]): Promise<Shaped[]> {
  const leaving = rows.filter((r) => r.requestType === 'LEAVING' && r.subjectEmployeeId && (r.payload as any)?.reason);
  if (!leaving.length) return rows;
  const subjects = await peoplePrisma.employee.findMany({ where: { orgId: req.tenant!.orgId, id: { in: [...new Set(leaving.map((r) => r.subjectEmployeeId!))] } }, select: { id: true, userId: true, dateOfLeaving: true } });
  const byId = new Map(subjects.map((e) => [e.id, e]));
  const shows = await leavingReasonFilter(req, subjects);
  return rows.map((r) => {
    if (!leaving.includes(r)) return r;
    const s = byId.get(r.subjectEmployeeId!);
    const payload = r.payload as Record<string, unknown>;
    /* The person resigning reads their own: shows() answers yes when the reader is them. */
    if (s && shows(s, String(payload.lastDay || s.dateOfLeaving || ''))) return r;
    return { ...r, payload: { ...payload, reason: null, reasonHidden: true } as any };
  });
}
const shapeFor = async (req: Request, r: Parameters<typeof shape>[0], names?: Parameters<typeof shape>[1]) => (await readable(req, [await shape(r, names)]))[0];

peopleApprovalsRouter.get(`${base}/requests`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const userId = req.auth!.userId;
  const [waiting, asked] = await Promise.all([waitingFor(orgId, userId), mine(orgId, userId)]);
  const names = await namesFor([...waiting, ...asked].flatMap((r) => [r.requesterUserId, ...r.steps.flatMap((s) => [s.approverUserId, s.decidedByUserId, s.standInForUserId, ...((s.candidateUserIds as string[]) || [])].filter(Boolean) as string[])]), orgId);
  res.json({ waitingForMe: await readable(req, await Promise.all(waiting.map((r) => shape(r, names)))), mine: await readable(req, await Promise.all(asked.map((r) => shape(r, names)))) });
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
  /* Field punches and overtime (time depth, gap 18). */
  [ATTENDANCE_MODULE, PermissionAction.EDIT, ATTENDANCE_RESOURCE.devices],
  [ATTENDANCE_MODULE, PermissionAction.EDIT, ATTENDANCE_RESOURCE.records],
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
  /* Steps in the engine's order: a step asked again or handed on sits after the row it replaced, even within one millisecond (createdAt, then slot, then id). */
  const r = await peoplePrisma.approvalRequest.findFirst({ where: { id: String(req.params.id), orgId }, include: { steps: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { slot: 'asc' }, { id: 'asc' }] } } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  const userId = req.auth!.userId;
  const involved = r.requesterUserId === userId || r.steps.some((s) => ((s.candidateUserIds as string[]) || []).includes(userId) || s.decidedByUserId === userId);
  if (!involved && (await requirePermissionCheck(req, APPROVALS))) return res.status(404).json({ error: 'No such request.' });
  res.json({ request: await shapeFor(req, r) });
});
/** True when the caller lacks the grant (used where a 404 is the right answer). */
async function requirePermissionCheck(req: Request, resource: string) {
  const { authorize } = await import('../middleware/rbac.js');
  return Boolean(await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, resource));
}

const submitSchema = z.object({
  /* A shift swap is asked from the employee app, colleague first (services/people/shiftSwaps.ts), and a form request through its form: neither from here. */
  requestType: z.enum(REQUEST_TYPES).refine((t) => t !== 'SHIFT_SWAP', 'A shift swap is asked from the employee app.')
    /* These have their own paths, which check what the generic one cannot: a profile change from the employee app,
       leaving from the person's record, probation from its review, a policy from its version (security audit, 3 Nov 2026). */
    .refine((t) => !['PROFILE_CHANGE', 'LEAVING', 'PROBATION', 'POLICY_PUBLISH'].includes(t), 'Ask for this from its own screen.'),
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
  /* A team-scoped asker asks only about their own team; a change carries only its own fields (changeFields.ts). */
  if (parsed.data.subjectEmployeeId && !inScope(await teamScope(req), parsed.data.subjectEmployeeId)) return res.status(404).json({ error: 'No such person.' });
  const fieldProblem = changePayloadProblem(parsed.data.requestType, parsed.data.payload);
  if (fieldProblem) return res.status(400).json({ error: fieldProblem });
  const key = String(req.headers['idempotency-key'] || req.body?.idempotencyKey || '').trim().slice(0, 120) || null;
  try {
    const r = await submitRequest(actorOf(req, 'FORM', typeof parsed.data.payload?.reason === 'string' ? parsed.data.payload.reason : null), { ...parsed.data, idempotencyKey: key });
    res.status(r.existed ? 200 : 201).json({ request: await shapeFor(req, r.request), outcome: r.outcome ?? null, existed: Boolean(r.existed) });
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
      res.json({ request: await shapeFor(req, r.request), outcome: (r as any).outcome ?? null });
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
    res.json({ request: await shapeFor(req, await reply(actorOf(req), String(req.params.id), note)) });
  } catch (e) {
    return sendError(res, e);
  }
});

peopleApprovalsRouter.post(`${base}/requests/:id/withdraw`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ request: await shapeFor(req, await withdraw(actorOf(req), String(req.params.id))) });
  } catch (e) {
    return sendError(res, e);
  }
});

// ---- Stand-ins -------------------------------------------------------------
// One StandIn table since the stand-in merge (workflow engine phase 2b): these
// and the leave delegates (routes/leave.ts) are the same rows, each saying what
// it hands on. Listed here: the ones handing on my decisions, by my sign-in or
// my People record.

async function myRecord(orgId: string, userId: string) {
  return peoplePrisma.employee.findFirst({ where: { orgId, userId }, select: { id: true, name: true } });
}

peopleApprovalsRouter.get(`${base}/stand-ins`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const userId = req.auth!.userId;
  const me = await myRecord(orgId, userId);
  const day = todayIst();
  const rows = (await listStandIns(orgId, null, day, { userIds: [userId], employeeIds: me ? [me.id] : [] })).filter((r) => r.userId === userId || (me && r.employeeId === me.id));
  res.json({ today: day, selfEmployeeId: me?.id ?? null, standIns: rows });
});

/**
 * Who can stand in: the people here who may approve requests or leave, by
 * name and code only. A team-limited manager's own lists stop at their team,
 * but the person they hand their decisions to is usually above or beside
 * them (their own manager, HR), so this list reaches past the team, and says
 * nothing beyond the name. The POST below holds to the same rule.
 */
peopleApprovalsRouter.get(`${base}/stand-ins/candidates`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const may = [...(await deciders(accountId, orgId))];
  const rows = may.length ? await peoplePrisma.employee.findMany({ where: { orgId, status: { not: 'LEFT' }, userId: { in: may } }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' }, take: 1000 }) : [];
  res.json({ people: rows });
});

/**
 * Name someone to decide in my place between two dates. Only my own; a
 * manager cannot be given one. The stand-in is named by their login, or by
 * their People record when it carries one (the Delegates screen picks people).
 * `requestTypes` says what is handed on: all approvals when left out.
 * Handing on more than leave and attendance needs someone who signs in and
 * may approve; leave and attendance alone may go to someone deciding in the
 * employee app.
 */
peopleApprovalsRouter.post(`${base}/stand-ins`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const parsed = z.object({
    standInUserId: z.string().trim().min(1).optional(), standInEmployeeId: z.string().trim().min(1).optional(), fromDate: z.string().regex(ISO_DATE), toDate: z.string().regex(ISO_DATE),
    requestTypes: z.array(z.string()).max(40).optional(), note: z.string().trim().max(500).optional(),
  }).safeParse(req.body || {});
  if (!parsed.success || (!parsed.data.standInUserId && !parsed.data.standInEmployeeId)) return res.status(400).json({ error: 'Name the person and the dates (YYYY-MM-DD).' });
  const { accountId, orgId } = req.tenant!;
  const userId = req.auth!.userId;
  const b = parsed.data;
  if (b.toDate < b.fromDate) return res.status(400).json({ error: 'The end is before the start.' });
  const types = cleanTypes(b.requestTypes);
  if (!types) return res.status(400).json({ error: 'Choose what they decide.' });
  const timeAlone = timeOnly(types);
  const me = await myRecord(orgId, userId);
  /* Leave and attendance are decided by People record: a sign-in with none has nothing there to hand on. */
  if (timeAlone && !me) return res.status(400).json({ error: 'Leave and attendance are handed on from your employee record, and your sign-in is not linked to one.' });
  /* Naming leave or attendance by itself: only someone who decides them has any to hand on. */
  if ((types.includes('LEAVE') || types.includes('ATTENDANCE')) && !(await deciders(accountId, orgId)).has(userId)) return res.status(400).json({ error: 'You do not approve leave or requests here, so there is nothing to hand on.' });
  let standInUserId: string | null = b.standInUserId || null;
  let standInEmployeeId: string | null = null;
  if (b.standInEmployeeId) {
    const person = await peoplePrisma.employee.findFirst({ where: { id: b.standInEmployeeId, orgId, status: { not: 'LEFT' } }, select: { id: true, name: true, userId: true } });
    if (!person) return res.status(400).json({ error: 'That person is not in this company.' });
    if (!person.userId && !timeAlone) return res.status(400).json({ error: `${person.name} has no CLOR sign-in, so they cannot decide requests. Link one on their record first.` });
    standInUserId = person.userId;
    standInEmployeeId = person.id;
  }
  if ((standInUserId && standInUserId === userId) || (me && standInEmployeeId === me.id)) return res.status(400).json({ error: 'Someone else has to stand in.' });
  if (standInUserId) {
    const member = await platformPrisma.userOrgMembership.findFirst({ where: { orgId, userId: standInUserId }, select: { id: true } });
    if (!member) return res.status(400).json({ error: 'That person is not in this company.' });
    if (!timeAlone && !(await deciders(accountId, orgId)).has(standInUserId)) return res.status(400).json({ error: 'They cannot approve requests here, so they cannot decide in your place. Choose someone who can.' });
    if (!standInEmployeeId) standInEmployeeId = (await myRecord(orgId, standInUserId))?.id ?? null;
  }
  /* Leave and attendance are decided by People record: a stand-in with none could decide none of it, and would only hide the real one. */
  /* Nothing named and nobody's record to name: People requests only, as a People stand-in always was. */
  if (b.requestTypes === undefined && !standInEmployeeId) types.splice(0, types.length, 'PEOPLE');
  if (covers(types, 'TIME') && !standInEmployeeId) return res.status(400).json({ error: 'They have no employee record here, so they cannot decide leave or attendance. Hand on other approvals only, or link a record first.' });
  const row = await nameStandIn({ accountId, orgId, createdByUserId: userId, userId, employeeId: me?.id ?? null, standInUserId, standInEmployeeId, fromDate: b.fromDate, toDate: b.toDate, requestTypes: types, note: b.note || null });
  /* Leave already waiting on the engine takes the stand-in in now (workflow engine 2c). */
  await (await import('../services/attendance/leaveEngine.js')).refreshLeaveSteps(accountId, orgId, { inline: true });
  res.status(201).json({ standIn: row });
});

peopleApprovalsRouter.delete(`${base}/stand-ins/:id`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const userId = req.auth!.userId;
  const row = await findStandIn(orgId, String(req.params.id));
  const me = row ? await myRecord(orgId, userId) : null;
  if (!row || !(row.userId === userId || (me && row.employeeId === me.id))) return res.status(404).json({ error: 'No such stand-in.' });
  await removeStandIn(orgId, row);
  await (await import('../services/attendance/leaveEngine.js')).refreshLeaveSteps(req.tenant!.accountId, orgId, { inline: true });
  res.json({ ok: true });
});

/** Is there a rule for this type? Screens ask before showing "send for approval". */
peopleApprovalsRouter.get(`${base}/approval-rules/active/:requestType`, can(PermissionAction.VIEW, REQUESTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const type = String(req.params.requestType) as RuleType;
  if (!(await ruleTypeOk(req.tenant!.orgId, type))) return res.status(404).json({ error: 'Unknown request type.' });
  const rule = await activeRule(req.tenant!.orgId, type);
  res.json({ rule: rule ? { id: rule.id, name: rule.name, version: rule.version, steps: legacySteps(rule.steps), spec: stepsOfRule(rule) } : null });
});
