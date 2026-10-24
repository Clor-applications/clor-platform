import type { Prisma } from '../../../generated/people/index.js';
import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { platformPrisma } from '../../../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../../jobLease.js';
import { notifyUsers, usersHoldingRoles, usersWithPermission } from '../../notifications.js';
import type { Actor } from '../changeLog.js';
import { writeChangeLog } from '../changeLog.js';

/**
 * The approval engine (docs/people/02-PRD.md APR-01..07; build contract §5.3).
 *
 * One engine for every People request: a profile change, a job change,
 * leaving, a document or letter request, publishing a policy, a help-desk
 * escalation, a seat request, a probation outcome. A rule names the steps
 * in order, who decides each, a condition that may skip it, a due time and
 * what happens when it is overdue. Rules are versioned; a request keeps the
 * version it was submitted under.
 *
 * Who decides is resolved when a step opens: the subject's manager as of
 * that day, their manager's manager, a named person, anyone holding a role,
 * or anyone who may edit employees ("HR"). Someone standing in for an
 * approver on that day is added. The requester never decides their own
 * request: their step is skipped. Approving the last step has the effect
 * the request type names, registered by the module that owns it.
 */

export const REQUEST_TYPES = ['PROFILE_CHANGE', 'JOB_CHANGE', 'LEAVING', 'DOCUMENT_REQUEST', 'LETTER_REQUEST', 'POLICY_PUBLISH', 'DESK_ESCALATION', 'SEAT_REQUEST', 'PROBATION'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export type ApproverSpec = { kind: 'MANAGER' | 'MANAGER_OF_MANAGER' | 'USER' | 'ROLE' | 'HR'; id?: string };
export type Condition = { field: string; op: 'changed' | 'eq' | 'ne'; value?: string | null };
export type StepSpec = { order: number; approver: ApproverSpec; condition?: Condition | null; dueDays: number; overdue?: { action: 'REMIND' | 'HAND_ON'; to?: ApproverSpec } | null };

export type Payload = { employeeId?: string | null; fields?: Record<string, { before: unknown; after: unknown }>; [k: string]: unknown };

type Effect = (ctx: { request: RequestRow; actor: Actor }) => Promise<Record<string, unknown> | void>;
const effects = new Map<RequestType, Effect>();
/** The module that owns a request type says what approval does. */
export function onApproved(type: RequestType, effect: Effect) {
  effects.set(type, effect);
}

export class ApprovalError extends Error {
  constructor(message: string, public status = 400, public code = 'APPROVAL_REFUSED') {
    super(message);
  }
}

type RequestRow = Prisma.ApprovalRequestGetPayload<{ include: { steps: true } }>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** Working days: Monday to Saturday, as most Indian companies count them. */
export function addWorkingDays(from: Date, days: number) {
  const d = new Date(from);
  let left = Math.max(0, days);
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0) left -= 1;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export function cleanSteps(raw: unknown): StepSpec[] | string {
  if (!Array.isArray(raw) || !raw.length) return 'A rule needs at least one step.';
  if (raw.length > 8) return 'Eight steps at most.';
  const out: StepSpec[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const s = raw[i] as any;
    const kind = String(s?.approver?.kind || '');
    if (!['MANAGER', 'MANAGER_OF_MANAGER', 'USER', 'ROLE', 'HR'].includes(kind)) return `Step ${i + 1}: who decides must be the manager, their manager, a named person, a role, or HR.`;
    if ((kind === 'USER' || kind === 'ROLE') && !String(s.approver.id || '').trim()) return `Step ${i + 1}: name the person or role.`;
    const dueDays = Number(s?.dueDays);
    if (!Number.isFinite(dueDays) || dueDays < 1 || dueDays > 60) return `Step ${i + 1}: due in 1 to 60 working days.`;
    let condition: Condition | null = null;
    if (s?.condition) {
      const op = String(s.condition.op || '');
      if (!['changed', 'eq', 'ne'].includes(op) || !String(s.condition.field || '').trim()) return `Step ${i + 1}: a condition names a field and one of changed, eq, ne.`;
      condition = { field: String(s.condition.field).trim(), op: op as Condition['op'], value: s.condition.value == null ? null : String(s.condition.value) };
    }
    let overdue: StepSpec['overdue'] = null;
    if (s?.overdue) {
      const action = String(s.overdue.action || '');
      if (!['REMIND', 'HAND_ON'].includes(action)) return `Step ${i + 1}: when overdue, remind or hand on.`;
      overdue = { action: action as 'REMIND' | 'HAND_ON', to: s.overdue.to ? { kind: s.overdue.to.kind, id: s.overdue.to.id } : undefined };
      if (action === 'HAND_ON' && !overdue.to?.kind) return `Step ${i + 1}: say who it is handed on to.`;
    }
    out.push({ order: i + 1, approver: { kind: kind as ApproverSpec['kind'], id: s.approver.id ? String(s.approver.id) : undefined }, condition, dueDays, overdue });
  }
  return out;
}

export async function activeRule(orgId: string, requestType: RequestType) {
  return peoplePrisma.approvalRule.findFirst({ where: { orgId, requestType, active: true }, orderBy: { version: 'desc' } });
}

/** A new version; the old one is kept and marked inactive. */
export async function saveRule(who: { accountId: string; orgId: string; userId: string | null }, requestType: RequestType, name: string, steps: StepSpec[]) {
  return peoplePrisma.$transaction(async (tx) => {
    const latest = await tx.approvalRule.findFirst({ where: { orgId: who.orgId, requestType }, orderBy: { version: 'desc' }, select: { version: true } });
    await tx.approvalRule.updateMany({ where: { orgId: who.orgId, requestType, active: true }, data: { active: false } });
    return tx.approvalRule.create({ data: { accountId: who.accountId, orgId: who.orgId, requestType, name, version: (latest?.version || 0) + 1, active: true, steps: steps as unknown as Prisma.InputJsonValue, createdByUserId: who.userId } });
  });
}

export async function retireRule(orgId: string, requestType: RequestType) {
  const r = await peoplePrisma.approvalRule.updateMany({ where: { orgId, requestType, active: true }, data: { active: false } });
  return r.count;
}

// ---------------------------------------------------------------------------
// Resolving who decides
// ---------------------------------------------------------------------------

function conditionHolds(c: Condition | null | undefined, payload: Payload): boolean {
  if (!c) return true;
  const f = payload.fields?.[c.field];
  if (c.op === 'changed') return Boolean(f) && String(f!.before ?? '') !== String(f!.after ?? '');
  const after = f ? String(f.after ?? '') : String((payload as any)[c.field] ?? '');
  return c.op === 'eq' ? after === String(c.value ?? '') : after !== String(c.value ?? '');
}

async function standInsFor(orgId: string, userIds: string[], day: string) {
  if (!userIds.length) return new Map<string, string>();
  const rows = await peoplePrisma.standIn.findMany({ where: { orgId, userId: { in: userIds }, fromDate: { lte: day }, toDate: { gte: day } } });
  return new Map(rows.map((r) => [r.userId, r.standInUserId]));
}

export async function resolveApprover(who: { accountId: string; orgId: string }, spec: ApproverSpec, subjectEmployeeId: string | null, day = todayIst()): Promise<{ primary: string[]; standIns: Array<{ for: string; user: string }> }> {
  const { accountId, orgId } = who;
  let primary: string[] = [];
  if (spec.kind === 'USER' && spec.id) primary = [spec.id];
  else if (spec.kind === 'ROLE' && spec.id) primary = await usersHoldingRoles(accountId, orgId, [spec.id]);
  else if (spec.kind === 'HR') primary = await usersWithPermission(accountId, orgId, 'PEOPLE::Employees::EDIT');
  else if ((spec.kind === 'MANAGER' || spec.kind === 'MANAGER_OF_MANAGER') && subjectEmployeeId) {
    const subject = await peoplePrisma.employee.findFirst({ where: { id: subjectEmployeeId, orgId }, select: { reportingManagerId: true } });
    let managerId = subject?.reportingManagerId || null;
    if (spec.kind === 'MANAGER_OF_MANAGER' && managerId) {
      const m = await peoplePrisma.employee.findFirst({ where: { id: managerId, orgId }, select: { reportingManagerId: true } });
      managerId = m?.reportingManagerId || null;
    }
    if (managerId) {
      const m = await peoplePrisma.employee.findFirst({ where: { id: managerId, orgId }, select: { userId: true } });
      if (m?.userId) primary = [m.userId];
    }
    /* No manager, or one who cannot sign in: HR takes the step. */
    if (!primary.length) primary = await usersWithPermission(accountId, orgId, 'PEOPLE::Employees::EDIT');
  }
  const subs = await standInsFor(orgId, primary, day);
  return { primary, standIns: [...subs.entries()].map(([f, u]) => ({ for: f, user: u })) };
}

// ---------------------------------------------------------------------------
// Submitting and deciding
// ---------------------------------------------------------------------------

const include = { steps: { orderBy: { order: 'asc' as const } } };

async function openStep(tx: Prisma.TransactionClient, who: { accountId: string; orgId: string }, request: { id: string; requesterUserId: string; subjectEmployeeId: string | null; payload: unknown; ruleSteps: StepSpec[] }, order: number): Promise<'OPENED' | 'DONE'> {
  const payload = (request.payload || {}) as Payload;
  for (let i = order - 1; i < request.ruleSteps.length; i += 1) {
    const spec = request.ruleSteps[i];
    const skipCondition = !conditionHolds(spec.condition, payload);
    const resolved = skipCondition ? { primary: [], standIns: [] } : await resolveApprover(who, spec.approver, request.subjectEmployeeId);
    /* Nobody approves their own request (APR-05). */
    const candidates = [...new Set([...resolved.primary, ...resolved.standIns.map((s) => s.user)])].filter((u) => u !== request.requesterUserId);
    if (skipCondition || !candidates.length) {
      await tx.approvalStep.create({ data: { accountId: who.accountId, orgId: who.orgId, requestId: request.id, order: spec.order, candidateUserIds: [], approverUserId: null, dueAt: new Date(), status: 'SKIPPED', comment: skipCondition ? 'Condition not met' : 'Would have been the requester, or nobody to decide' } });
      continue;
    }
    const standIn = resolved.standIns.find((s) => candidates.includes(s.user));
    await tx.approvalStep.create({
      data: {
        accountId: who.accountId, orgId: who.orgId, requestId: request.id, order: spec.order,
        candidateUserIds: candidates, approverUserId: candidates[0], standInForUserId: standIn ? standIn.for : null,
        dueAt: addWorkingDays(new Date(), spec.dueDays), status: 'WAITING',
      },
    });
    await tx.approvalRequest.update({ where: { id: request.id }, data: { currentStep: spec.order, status: 'WAITING' } });
    return 'OPENED';
  }
  return 'DONE';
}

export async function submitRequest(actor: Actor, input: { requestType: RequestType; subjectEmployeeId?: string | null; title: string; payload: Payload; idempotencyKey?: string | null }): Promise<{ request: RequestRow; outcome?: Record<string, unknown> | void; existed?: boolean }> {
  const { accountId, orgId } = actor;
  if (!actor.userId) throw new ApprovalError('Sign in to ask for something.', 401);
  if (input.idempotencyKey) {
    const existing = await peoplePrisma.approvalRequest.findFirst({ where: { orgId, idempotencyKey: input.idempotencyKey }, include });
    if (existing) return { request: existing, existed: true };
  }
  const rule = await activeRule(orgId, input.requestType);
  if (!rule) throw new ApprovalError(`No approval rule for ${input.requestType.toLowerCase().replace(/_/g, ' ')}: the company has not set one.`, 409, 'NO_RULE');
  const ruleSteps = rule.steps as unknown as StepSpec[];
  const created = await peoplePrisma.$transaction(async (tx) => {
    const r = await tx.approvalRequest.create({
      data: {
        accountId, orgId, requestType: input.requestType, subjectEmployeeId: input.subjectEmployeeId ?? null, requesterUserId: actor.userId!,
        ruleId: rule.id, ruleVersion: rule.version, title: input.title.slice(0, 200), payload: input.payload as unknown as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey ?? null, status: 'WAITING', currentStep: 1,
      },
    });
    await writeChangeLog(tx, actor, { kind: 'ApprovalRequest', id: r.id, employeeId: input.subjectEmployeeId ?? null }, [{ field: 'status', before: null, after: 'WAITING', redacted: false }]);
    const state = await openStep(tx, { accountId, orgId }, { id: r.id, requesterUserId: r.requesterUserId, subjectEmployeeId: r.subjectEmployeeId, payload: r.payload, ruleSteps }, 1);
    return { id: r.id, state };
  });
  if (created.state === 'DONE') return approveFinal(actor, created.id);
  const request = await peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: created.id }, include });
  await notifyStep(request);
  return { request };
}

async function notifyStep(request: RequestRow) {
  const step = request.steps.find((s) => s.order === request.currentStep && s.status === 'WAITING');
  if (!step) return;
  const ids = (step.candidateUserIds as string[]) || [];
  await notifyUsers(request.accountId, request.orgId, ids, { kind: 'people.approval', title: `Waiting for you: ${request.title}`, body: `Due ${step.dueAt.toISOString().slice(0, 10)}.`, link: { app: 'people', screen: 'approvals' } as any });
}

/** Everything approved: run the effect and close. */
async function approveFinal(actor: Actor, requestId: string) {
  const request = await peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include });
  const effect = effects.get(request.requestType as RequestType);
  /* TRACE-05: what the decision rested on is frozen before anything changes, and every change-log line carries it. */
  const { recordDecision } = await import('../decisions.js');
  const decision = await recordDecision(request);
  let outcome: Record<string, unknown> | void = undefined;
  if (effect) outcome = await effect({ request, actor: { ...actor, source: 'APPROVAL', requestId: request.id, decisionId: decision.id } });
  const closed = await peoplePrisma.$transaction(async (tx) => {
    const r = await tx.approvalRequest.update({ where: { id: requestId }, data: { status: 'APPROVED', decisionId: decision.id, outcome: (outcome || null) as Prisma.InputJsonValue }, include });
    await writeChangeLog(tx, actor, { kind: 'ApprovalRequest', id: r.id, employeeId: r.subjectEmployeeId }, [{ field: 'status', before: 'WAITING', after: 'APPROVED', redacted: false }]);
    return r;
  });
  await notifyUsers(closed.accountId, closed.orgId, [closed.requesterUserId], { kind: 'people.approval', title: `Approved: ${closed.title}`, link: { app: 'people', screen: 'approvals' } as any });
  return { request: closed, outcome };
}

export type Decision = 'approve' | 'reject' | 'more-info';

export async function decide(actor: Actor, requestId: string, decision: Decision, comment: string | null) {
  const { orgId } = actor;
  const userId = actor.userId;
  if (!userId) throw new ApprovalError('Sign in to decide.', 401);
  const request = await peoplePrisma.approvalRequest.findFirst({ where: { id: requestId, orgId }, include });
  if (!request) throw new ApprovalError('No such request.', 404, 'NOT_FOUND');
  if (request.status !== 'WAITING') throw new ApprovalError(`This request is ${request.status.toLowerCase().replace('_', ' ')}; nothing to decide.`, 409, 'NOT_WAITING');
  const step = request.steps.find((s) => s.order === request.currentStep && s.status === 'WAITING');
  if (!step) throw new ApprovalError('No step is waiting.', 409, 'NOT_WAITING');
  if (!((step.candidateUserIds as string[]) || []).includes(userId)) throw new ApprovalError('This is not yours to decide.', 403, 'NOT_APPROVER');
  if (request.requesterUserId === userId) throw new ApprovalError('Nobody decides their own request.', 403, 'OWN_REQUEST');
  const ruleSteps = ((await peoplePrisma.approvalRule.findUnique({ where: { id: request.ruleId } }))?.steps || []) as unknown as StepSpec[];
  const stepStatus = decision === 'approve' ? 'APPROVED' : decision === 'reject' ? 'REJECTED' : 'MORE_INFO';
  const standInFor = step.standInForUserId && userId !== step.standInForUserId ? step.standInForUserId : null;
  const result = await peoplePrisma.$transaction(async (tx) => {
    /* Claimed atomically: two approvers deciding at once leave one decision. */
    const claimed = await tx.approvalStep.updateMany({ where: { id: step.id, status: 'WAITING' }, data: { status: stepStatus, decidedByUserId: userId, decidedAt: new Date(), comment: comment ? comment.slice(0, 1000) : null, approverUserId: userId, standInForUserId: standInFor } });
    if (!claimed.count) throw new ApprovalError('Someone else just decided this.', 409, 'ALREADY_DECIDED');
    await writeChangeLog(tx, actor, { kind: 'ApprovalRequest', id: request.id, employeeId: request.subjectEmployeeId }, [{ field: `step ${step.order}`, before: 'WAITING', after: stepStatus, redacted: false }]);
    if (decision === 'reject') {
      await tx.approvalRequest.update({ where: { id: request.id }, data: { status: 'REJECTED' } });
      return 'REJECTED' as const;
    }
    if (decision === 'more-info') {
      await tx.approvalRequest.update({ where: { id: request.id }, data: { status: 'MORE_INFO' } });
      return 'MORE_INFO' as const;
    }
    const state = await openStep(tx, { accountId: actor.accountId, orgId }, { id: request.id, requesterUserId: request.requesterUserId, subjectEmployeeId: request.subjectEmployeeId, payload: request.payload, ruleSteps }, step.order + 1);
    return state === 'DONE' ? ('DONE' as const) : ('OPENED' as const);
  });
  if (result === 'DONE') return approveFinal(actor, request.id);
  const fresh = await peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id }, include });
  if (result === 'OPENED') await notifyStep(fresh);
  else await notifyUsers(fresh.accountId, fresh.orgId, [fresh.requesterUserId], { kind: 'people.approval', title: `${result === 'REJECTED' ? 'Not approved' : 'More information asked for'}: ${fresh.title}`, body: comment, link: { app: 'people', screen: 'approvals' } as any });
  return { request: fresh };
}

/** The requester answers a request for more information: the same step waits again for the same people. */
export async function reply(actor: Actor, requestId: string, note: string) {
  const request = await peoplePrisma.approvalRequest.findFirst({ where: { id: requestId, orgId: actor.orgId }, include });
  if (!request) throw new ApprovalError('No such request.', 404, 'NOT_FOUND');
  if (request.requesterUserId !== actor.userId) throw new ApprovalError('Only the person who asked can answer.', 403);
  if (request.status !== 'MORE_INFO') throw new ApprovalError('Nothing was asked.', 409, 'NOT_WAITING');
  const last = request.steps.filter((s) => s.order === request.currentStep).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const ruleSteps = ((await peoplePrisma.approvalRule.findUnique({ where: { id: request.ruleId } }))?.steps || []) as unknown as StepSpec[];
  const spec = ruleSteps.find((s) => s.order === request.currentStep)!;
  await peoplePrisma.$transaction(async (tx) => {
    await tx.approvalStep.create({ data: { accountId: request.accountId, orgId: request.orgId, requestId: request.id, order: request.currentStep, candidateUserIds: last.candidateUserIds as Prisma.InputJsonValue, approverUserId: last.approverUserId, standInForUserId: last.standInForUserId, dueAt: addWorkingDays(new Date(), spec?.dueDays || 2), status: 'WAITING' } });
    await tx.approvalRequest.update({ where: { id: request.id }, data: { status: 'WAITING', payload: { ...(request.payload as object), replies: [...(((request.payload as any)?.replies as unknown[]) || []), { at: new Date().toISOString(), note: note.slice(0, 1000) }] } as Prisma.InputJsonValue } });
  });
  const fresh = await peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id }, include });
  await notifyStep(fresh);
  return fresh;
}

export async function withdraw(actor: Actor, requestId: string) {
  const request = await peoplePrisma.approvalRequest.findFirst({ where: { id: requestId, orgId: actor.orgId }, include });
  if (!request) throw new ApprovalError('No such request.', 404, 'NOT_FOUND');
  if (request.requesterUserId !== actor.userId) throw new ApprovalError('Only the person who asked can withdraw it.', 403);
  if (!['WAITING', 'MORE_INFO'].includes(request.status)) throw new ApprovalError(`This request is ${request.status.toLowerCase()}.`, 409, 'NOT_WAITING');
  return peoplePrisma.$transaction(async (tx) => {
    await tx.approvalStep.updateMany({ where: { requestId: request.id, status: 'WAITING' }, data: { status: 'WITHDRAWN' } });
    const r = await tx.approvalRequest.update({ where: { id: request.id }, data: { status: 'WITHDRAWN' }, include });
    await writeChangeLog(tx, actor, { kind: 'ApprovalRequest', id: r.id, employeeId: r.subjectEmployeeId }, [{ field: 'status', before: request.status, after: 'WITHDRAWN', redacted: false }]);
    return r;
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function waitingFor(orgId: string, userId: string) {
  const steps = await peoplePrisma.approvalStep.findMany({ where: { orgId, status: 'WAITING' }, select: { requestId: true, candidateUserIds: true, dueAt: true } });
  const ids = steps.filter((s) => ((s.candidateUserIds as string[]) || []).includes(userId)).map((s) => s.requestId);
  if (!ids.length) return [];
  const rows = await peoplePrisma.approvalRequest.findMany({ where: { orgId, id: { in: ids }, status: 'WAITING' }, include });
  return rows.sort((a, b) => dueOf(a).getTime() - dueOf(b).getTime());
}
const dueOf = (r: RequestRow) => r.steps.find((s) => s.order === r.currentStep && s.status === 'WAITING')?.dueAt || r.createdAt;

export async function mine(orgId: string, userId: string, limit = 100) {
  return peoplePrisma.approvalRequest.findMany({ where: { orgId, requesterUserId: userId }, include, orderBy: { createdAt: 'desc' }, take: limit });
}

export async function requestsAbout(orgId: string, employeeId: string) {
  return peoplePrisma.approvalRequest.findMany({ where: { orgId, subjectEmployeeId: employeeId }, include, orderBy: { createdAt: 'desc' } });
}

/** Names for the people on a request, for the screen. */
export async function namesFor(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map<string, string>();
  const users = await platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } });
  return new Map(users.map((u) => [u.id, u.fullName || u.email]));
}

export async function shape(r: RequestRow, names?: Map<string, string>) {
  const n = names || (await namesFor([r.requesterUserId, ...r.steps.flatMap((s) => [s.approverUserId, s.decidedByUserId, s.standInForUserId, ...((s.candidateUserIds as string[]) || [])].filter(Boolean) as string[])]));
  const now = Date.now();
  return {
    id: r.id, requestType: r.requestType, title: r.title, status: r.status, currentStep: r.currentStep, subjectEmployeeId: r.subjectEmployeeId,
    requesterUserId: r.requesterUserId, requesterName: n.get(r.requesterUserId) || '', ruleVersion: r.ruleVersion, payload: r.payload, outcome: r.outcome, createdAt: r.createdAt,
    dueAt: dueOf(r), overdue: r.status === 'WAITING' && dueOf(r).getTime() < now,
    steps: r.steps.map((s) => ({
      id: s.id, order: s.order, status: s.status, dueAt: s.dueAt, comment: s.comment, decidedAt: s.decidedAt,
      candidates: ((s.candidateUserIds as string[]) || []).map((u) => n.get(u) || u),
      decidedBy: s.decidedByUserId ? n.get(s.decidedByUserId) || '' : '',
      standInFor: s.standInForUserId ? n.get(s.standInForUserId) || '' : '',
      remindedAt: s.remindedAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Due times (APR-03)
// ---------------------------------------------------------------------------

/** Overdue steps: a reminder first; a day after that, handed on if the rule says so. Idempotent per step. */
export async function runApprovalDues(now = new Date()) {
  const due = await outsideTenant('job: approval dues', () => peoplePrisma.approvalStep.findMany({ where: { status: 'WAITING', dueAt: { lt: now } }, include: { request: true } }));
  let reminded = 0;
  let handedOn = 0;
  for (const step of due) {
    await runInTenant(step.orgId, async () => {
      const rule = await peoplePrisma.approvalRule.findUnique({ where: { id: step.request.ruleId } });
      const spec = ((rule?.steps || []) as unknown as StepSpec[]).find((s) => s.order === step.order);
      if (!step.remindedAt) {
        await peoplePrisma.approvalStep.update({ where: { id: step.id }, data: { remindedAt: now } });
        await notifyUsers(step.accountId, step.orgId, (step.candidateUserIds as string[]) || [], { kind: 'people.approval', title: `Overdue: ${step.request.title}`, body: `Was due ${step.dueAt.toISOString().slice(0, 10)}.`, link: { app: 'people', screen: 'approvals' } as any });
        reminded += 1;
        return;
      }
      if (spec?.overdue?.action === 'HAND_ON' && spec.overdue.to && now.getTime() - step.remindedAt.getTime() >= 24 * 3_600_000) {
        const resolved = await resolveApprover({ accountId: step.accountId, orgId: step.orgId }, spec.overdue.to, step.request.subjectEmployeeId, now.toISOString().slice(0, 10));
        const candidates = [...new Set([...resolved.primary, ...resolved.standIns.map((s) => s.user)])].filter((u) => u !== step.request.requesterUserId);
        if (!candidates.length) return;
        await peoplePrisma.$transaction(async (tx) => {
          const moved = await tx.approvalStep.updateMany({ where: { id: step.id, status: 'WAITING' }, data: { status: 'HANDED_ON', comment: 'Handed on: overdue', decidedAt: now } });
          if (!moved.count) return;
          await tx.approvalStep.create({ data: { accountId: step.accountId, orgId: step.orgId, requestId: step.requestId, order: step.order, candidateUserIds: candidates, approverUserId: candidates[0], dueAt: addWorkingDays(now, spec.dueDays), status: 'WAITING' } });
        });
        await notifyUsers(step.accountId, step.orgId, candidates, { kind: 'people.approval', title: `Handed on to you: ${step.request.title}`, link: { app: 'people', screen: 'approvals' } as any });
        handedOn += 1;
      }
    });
  }
  return { due: due.length, reminded, handedOn };
}

export function startApprovalDues({ intervalMs = 15 * 60_000, startupDelayMs = 60_000 } = {}) {
  if (String(process.env.PEOPLE_APPROVAL_DUES || '').toLowerCase() === 'off') return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await exclusive('people.approval-dues', leaseFor(intervalMs), () => runApprovalDues());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[people-approvals] dues run failed:', e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  const startup = setTimeout(tick, startupDelayMs);
  const timer = setInterval(tick, intervalMs);
  startup.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(startup);
    clearInterval(timer);
  };
}

export const isoDay = (v: unknown) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null);
