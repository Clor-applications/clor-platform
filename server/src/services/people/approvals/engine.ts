import type { Prisma } from '../../../generated/people/index.js';
import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { platformPrisma } from '../../../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../../jobLease.js';
import { notifyUsers, retireNotices, usersHoldingRoles, usersWithPermission } from '../../notifications.js';
import { sendTemplate } from '../../mailer.js';
import { choicesFor } from '../companyChoices.js';
import type { Actor } from '../changeLog.js';
import { writeChangeLog } from '../changeLog.js';
import { registerJob } from '../../jobRegistry.js';
import { getAuthPolicy } from '../../policy.js';
import { resolveAccess } from '../../access.js';
import { inReportingLine } from '../scope.js';
import { standInUsersFor } from './standIns.js';
import {
  MONEY_TYPES, NEVER_SELF_TYPES, SPEC_VERSION, TWO_PERSON_TYPES, allHold, dueAtFrom, normaliseAutoApprove, normaliseConditions, normaliseStep, normaliseSteps,
  type Approver, type ApproverSpec, type AutoApprove, type Condition, type ConditionV2, type Facts, type RuleSpecV2, type StepSpec, type StepV2,
} from './spec.js';

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
 * approver on that day is added. A manager who may not approve requests is
 * passed over for HR. The requester never decides their own request: their
 * step is skipped when someone else decides another step; when nobody else
 * would decide anything, the step goes to the company's admins instead, so a
 * request never approves itself. Approving the last step has the effect the
 * request type names, registered by the module that owns it.
 */

/* EXPENSE_CLAIM, EMPLOYEE_ADVANCE and SALARY_ADVANCE: money asked from the employee app (services/people/money). */
export const REQUEST_TYPES = ['PROFILE_CHANGE', 'JOB_CHANGE', 'LEAVING', 'DOCUMENT_REQUEST', 'LETTER_REQUEST', 'POLICY_PUBLISH', 'DESK_ESCALATION', 'SEAT_REQUEST', 'PROBATION', 'SHIFT_SWAP', 'EXPENSE_CLAIM', 'EMPLOYEE_ADVANCE', 'SALARY_ADVANCE'] as const;
/**
 * A request type HR defines with a short form (FEATURE-UI-AUDIT gap 25,
 * services/people/requestForms.ts) is `FORM:<RequestForm id>`: its rule, its
 * requests and its steps are the engine's like any other; approving it
 * records the decision and nothing else.
 */
export type FormRequestType = `FORM:${string}`;
export type RequestType = (typeof REQUEST_TYPES)[number] | FormRequestType;
export const FORM_PREFIX = 'FORM:';
export const isFormType = (t: unknown): t is FormRequestType => typeof t === 'string' && /^FORM:[a-z0-9]{8,40}$/.test(t);
/**
 * The kinds a rule can be written for: every request type, and leave
 * (owner, 28 Oct 2026). Leave keeps its own request and balance and walks the
 * steps itself (services/attendance/leaveRules.ts); it is never submitted
 * through this engine, so LEAVE is not a RequestType.
 */
export const RULE_TYPES = [...REQUEST_TYPES, 'LEAVE'] as const;
/**
 * Help-desk escalations and seat requests: nothing in CLOR asks for them, so
 * the Approval rules screen does not offer them (People plan 8 Nov 2026,
 * step 6). The engine still reads a rule or request a company already has.
 */
export const UNASKED_TYPES = new Set<string>(['DESK_ESCALATION', 'SEAT_REQUEST']);
export type RuleType = (typeof RULE_TYPES)[number] | FormRequestType;

export type { ApproverSpec, Condition, StepSpec } from './spec.js';

export type Payload = { employeeId?: string | null; fields?: Record<string, { before: unknown; after: unknown }>; [k: string]: unknown };

type Effect = (ctx: { request: RequestRow; actor: Actor }) => Promise<Record<string, unknown> | void>;
const effects = new Map<RequestType, Effect>();
/** The module that owns a request type says what approval does. */
export function onApproved(type: RequestType, effect: Effect) {
  effects.set(type, effect);
}
/** A check before any approval of this type: throws an ApprovalError to refuse (e.g. the record changed since it was asked). */
type Check = (request: RequestRow) => Promise<void>;
const checks = new Map<RequestType, Check>();
export function beforeApproving(type: RequestType, check: Check) {
  checks.set(type, check);
}
/**
 * What a request type's own record does when the request closes without
 * approval: rejected, withdrawn, or approved but not applied. A shift swap
 * keeps its own status in step this way. Never fails the decision: an error
 * is logged, and the owner's read path squares it up again.
 */
type Closed = (request: RequestRow, status: 'REJECTED' | 'WITHDRAWN', note: string | null) => Promise<void>;
const closers = new Map<string, Closed>();
export function onClosed(type: RequestType, fn: Closed) {
  closers.set(type, fn);
}
async function tellClosed(request: RequestRow, status: 'REJECTED' | 'WITHDRAWN', note: string | null) {
  const fn = closers.get(request.requestType);
  if (!fn) return;
  try {
    await fn(request, status, note);
  } catch (e) {
    /* A module that keeps its own record decides inside one transaction with the engine: its refusal undoes the decision. */
    if (sources.has(request.requestType)) throw e;
    console.error(`[people-approvals] ${request.orgId}: request ${request.id} closed, its own record not updated:`, e instanceof Error ? e.message : e);
  }
}

/** Someone who asked from the employee app without a CLOR sign-in is the requester `portal:<employeeId>`. */
export const PORTAL_PREFIX = 'portal:';

/**
 * A request type whose module keeps its own record and says who decides in its own words (leave,
 * workflow engine phase 2c). Its requests are opened by the module (openSourced, with `sourceKind`
 * and `sourceId`), never through submitRequest, and decided only where they were asked (decide's
 * `atSource`), inside the module's own transaction:
 *  - `resolve`: who decides for one approver of a step (users, or `portal:<employeeId>` in the
 *    employee app), stand-ins, away hand-up and scope already applied, the person it is about taken out;
 *  - `stepIn`: who may step in for a step (5.5);
 *  - the module tells people itself, so the engine sends no notice of its own;
 *  - an effect or closer that fails undoes the decision (the caller's transaction rolls back), so a
 *    request is never closed "approved but not applied" under the module's feet.
 */
export type SourceHooks = {
  resolve: (who: { accountId: string; orgId: string }, approver: Approver, request: Req, day: string, approvedBy: () => Promise<Set<string | null>>) => Promise<Resolution>;
  stepIn: (who: { accountId: string; orgId: string }, group: 'HR' | 'OWNER', request: Req) => Promise<string[]>;
  /** A step of the module's own request past its due time (runApprovalDues): the module reminds and hands on in its own words. */
  overdue?: (step: { id: string; requestId: string; accountId: string; orgId: string; order: number; dueAt: Date; remindedAt: Date | null; candidateUserIds: unknown }, spec: StepV2 | undefined, now: Date) => Promise<'REMINDED' | 'HANDED_ON' | null>;
};
const sources = new Map<string, SourceHooks>();
export function onSource(type: string, hooks: SourceHooks) {
  sources.set(type, hooks);
}
const sourced = (r: { requestType: string }) => sources.has(r.requestType);
/** A request a module opened for its own record (sourceKind, or the preset it was opened under). */
const ownedBySource = (r: { sourceKind?: string | null; payload?: unknown }) => Boolean(r.sourceKind || (r.payload as { preset?: unknown } | null | undefined)?.preset);

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
  /* Counted on Indian days, whatever the server's own time zone (Cloud Run runs in UTC): a Sunday is a Sunday in IST. */
  const IST = 330 * 60_000;
  const d = new Date(from.getTime() + IST);
  let left = Math.max(0, days);
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0) left -= 1;
  }
  return new Date(d.getTime() - IST);
}
const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** The main rule of a type (variant ""), as it is now. Screens and modules ask this before offering "send for approval". */
export async function activeRule(orgId: string, requestType: RuleType) {
  return peoplePrisma.approvalRule.findFirst({ where: { orgId, requestType, variantKey: '', active: true }, orderBy: { version: 'desc' } });
}

export type RuleRow = NonNullable<Awaited<ReturnType<typeof activeRule>>>;

/** A rule's steps as version 2, whichever version it was saved in. */
export const stepsOfRule = (rule: { steps: unknown; requestType?: string } | null | undefined): StepV2[] => normaliseSteps(rule?.steps, rule?.requestType);

/**
 * The rule a request follows: the most specific active variant whose
 * conditions all hold for it (most conditions first, then the higher
 * priority), else the type's main rule. Null when neither applies.
 */
export async function pickRule(orgId: string, requestType: string, facts: Facts): Promise<RuleRow | null> {
  const rows = await peoplePrisma.approvalRule.findMany({ where: { orgId, requestType, active: true }, orderBy: { version: 'desc' } });
  const variants = rows
    .filter((r) => r.variantKey && allHold(normaliseConditions(r.appliesWhen), facts) && normaliseConditions(r.appliesWhen).length)
    .sort((a, b) => normaliseConditions(b.appliesWhen).length - normaliseConditions(a.appliesWhen).length || b.priority - a.priority || b.version - a.version);
  return variants[0] || rows.find((r) => !r.variantKey) || null;
}

/**
 * A new version of one rule (the type's main rule, or one variant); the old
 * one is kept and marked inactive. Steps of either shape are written as
 * version 2: a version 1 step normalises exactly as a stored one reads, so a
 * module's default rule decides as it always did.
 */
export async function saveRule(
  who: { accountId: string; orgId: string; userId: string | null },
  requestType: RuleType,
  name: string,
  steps: Array<StepSpec | StepV2>,
  opts: { variantKey?: string; appliesWhen?: ConditionV2[]; priority?: number; autoApprove?: AutoApprove[]; presetKey?: string | null } = {},
) {
  const variantKey = opts.variantKey || '';
  const normalised = steps.map((s, i) => ({ ...normaliseStep(s, i), order: i + 1 }));
  return peoplePrisma.$transaction(async (tx) => {
    const latest = await tx.approvalRule.findFirst({ where: { orgId: who.orgId, requestType, variantKey }, orderBy: { version: 'desc' }, select: { version: true } });
    await tx.approvalRule.updateMany({ where: { orgId: who.orgId, requestType, variantKey, active: true }, data: { active: false } });
    return tx.approvalRule.create({
      data: {
        accountId: who.accountId, orgId: who.orgId, requestType, name, version: (latest?.version || 0) + 1, active: true,
        steps: normalised as unknown as Prisma.InputJsonValue, specVersion: SPEC_VERSION, variantKey,
        appliesWhen: opts.appliesWhen?.length ? (opts.appliesWhen as unknown as Prisma.InputJsonValue) : undefined,
        priority: opts.priority || 0,
        autoApprove: opts.autoApprove?.length ? (opts.autoApprove as unknown as Prisma.InputJsonValue) : undefined,
        presetKey: opts.presetKey ?? null,
        createdByUserId: who.userId,
      },
    });
  });
}

/** Save a rule checked by cleanRule. */
export async function saveRuleSpec(who: { accountId: string; orgId: string; userId: string | null }, spec: RuleSpecV2) {
  return saveRule(who, spec.requestType as RuleType, spec.name, spec.steps, { variantKey: spec.variantKey, appliesWhen: spec.appliesWhen, priority: spec.priority, autoApprove: spec.autoApprove });
}

export async function retireRule(orgId: string, requestType: RuleType, variantKey = '') {
  const r = await peoplePrisma.approvalRule.updateMany({ where: { orgId, requestType, variantKey, active: true }, data: { active: false } });
  return r.count;
}

// ---------------------------------------------------------------------------
// Resolving who decides
// ---------------------------------------------------------------------------

/** The first engine's condition test, kept for leave's own step walker (services/attendance/leaveRules.ts). */
export function conditionHolds(c: Condition | null | undefined, payload: Payload): boolean {
  if (!c) return true;
  const f = payload.fields?.[c.field];
  if (c.op === 'changed') return Boolean(f) && String(f!.before ?? '') !== String(f!.after ?? '');
  if (c.op === 'gt' || c.op === 'lt') {
    const n = Number(f ? f.after : (payload as any)[c.field]);
    const v = Number(c.value);
    if (!Number.isFinite(n) || !Number.isFinite(v)) return false;
    return c.op === 'gt' ? n > v : n < v;
  }
  const after = f ? String(f.after ?? '') : String((payload as any)[c.field] ?? '');
  return c.op === 'eq' ? after === String(c.value ?? '') : after !== String(c.value ?? '');
}

/** What a rule's conditions can read: the request's own values, and the person it is about. */
export async function factsFor(orgId: string, subjectEmployeeId: string | null | undefined, payload: unknown): Promise<Facts> {
  const person = subjectEmployeeId
    ? await peoplePrisma.employee.findFirst({ where: { id: subjectEmployeeId, orgId }, select: { departmentId: true, branchId: true, establishmentId: true, employeeTypeId: true, gradeId: true } })
    : null;
  return { payload: ((payload || {}) as Facts['payload']), person: person ? { ...person } : null };
}

/**
 * Who stands in for each of these approvers on `day` for this request type:
 * one StandIn table, by sign-in or People record, and the retired leave
 * delegates as a fallback until phase 3c (stand-in merge, phase 2b).
 */
async function standInsFor(orgId: string, userIds: string[], day: string, requestType?: string) {
  return standInUsersFor(orgId, userIds, day, requestType);
}

const APPROVE_GRANT = 'PEOPLE::Requests::APPROVE';
/** A manager with one of these statuses is treated as no manager. */
const INACTIVE = new Set(['LEFT', 'SUSPENDED']);

/** HR: whoever may edit employees, and of them those who may also approve requests (or all of them, when none may). */
async function hrDeciders(accountId: string, orgId: string) {
  const [edit, approve] = await Promise.all([usersWithPermission(accountId, orgId, 'PEOPLE::Employees::EDIT'), usersWithPermission(accountId, orgId, APPROVE_GRANT)]);
  const both = edit.filter((u) => approve.includes(u));
  return both.length ? both : edit;
}

/** The owner: the company's administrators, whoever holds the role named Owner first. */
export async function ownerDeciders(accountId: string, orgId: string) {
  const roles = await platformPrisma.role.findMany({ where: { accountId, orgId, roleType: 'ADMIN' }, select: { id: true, name: true } });
  const owners = await usersHoldingRoles(accountId, orgId, roles.filter((r) => r.name === 'Owner').map((r) => r.id));
  const admins = await usersHoldingRoles(accountId, orgId, roles.map((r) => r.id));
  return [...new Set([...owners, ...admins])];
}

/** The Payroll right that decides a type, for a PAYROLL step. Administrators hold every right, so the owner decides when nobody else does. */
const PAYROLL_RIGHT: Record<string, string> = {
  SALARY_ADVANCE: 'PAYROLL::Payroll Loans::APPROVE',
  EMPLOYEE_ADVANCE: 'PAYROLL::Payroll Loans::APPROVE',
  LOAN: 'PAYROLL::Payroll Loans::APPROVE',
  SALARY_REVISION: 'PAYROLL::Salary Revisions::APPROVE',
  EXPENSE_CLAIM: 'PAYROLL::Payroll Adjustments::APPROVE',
};
const payrollRightOf = (requestType: string | undefined) => PAYROLL_RIGHT[String(requestType || '')] || 'PAYROLL::Payroll Runs::APPROVE';

/**
 * When nobody but the requester could decide: the company's admins, else anyone who may approve requests.
 * Never the requester. With the person it is about named, a team-scoped approver only counts inside their
 * team (review of PR #93); leave's own walker passes no person and is unchanged.
 */
export async function lastResortDeciders(accountId: string, orgId: string, excluded: string[], subjectEmployeeId?: string | null) {
  const adminRoles = await platformPrisma.role.findMany({ where: { accountId, orgId, roleType: 'ADMIN' }, select: { id: true } });
  const admins = (await usersHoldingRoles(accountId, orgId, adminRoles.map((r) => r.id))).filter((u) => !excluded.includes(u));
  if (admins.length) return admins;
  const approvers = (await usersWithPermission(accountId, orgId, APPROVE_GRANT)).filter((u) => !excluded.includes(u));
  return subjectEmployeeId ? inScopeOnly({ accountId, orgId }, approvers, subjectEmployeeId) : approvers;
}

/** The login of the person a request is about: they never decide it either (their own promotion, grade or pay). */
async function subjectUserOf(orgId: string, subjectEmployeeId: string | null) {
  if (!subjectEmployeeId) return null;
  return (await peoplePrisma.employee.findFirst({ where: { id: subjectEmployeeId, orgId }, select: { userId: true } }))?.userId || null;
}

/**
 * The logins of the other people a request is about (`payload.partyEmployeeIds`:
 * a shift swap's colleague). Like the subject, none of them decides it.
 */
async function partyUsersOf(orgId: string, payload: unknown) {
  const ids = ((payload as { partyEmployeeIds?: unknown })?.partyEmployeeIds as unknown[]) || [];
  const list = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
  if (!list.length) return [];
  return (await peoplePrisma.employee.findMany({ where: { orgId, id: { in: list } }, select: { userId: true } })).map((e) => e.userId).filter(Boolean) as string[];
}

/** An employee's sign-in when they may decide as a manager today: there, not left or suspended, with the approve right. */
async function managerUser(accountId: string, orgId: string, employeeId: string | null | undefined) {
  if (!employeeId) return null;
  const m = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { userId: true, status: true } });
  if (m?.userId && !INACTIVE.has(m.status) && (await usersWithPermission(accountId, orgId, APPROVE_GRANT)).includes(m.userId)) return m.userId;
  return null;
}

export async function resolveApprover(who: { accountId: string; orgId: string }, spec: Approver | ApproverSpec, subjectEmployeeId: string | null, day = todayIst(), requestType?: string): Promise<{ primary: string[]; standIns: Array<{ for: string; user: string }> }> {
  const { accountId, orgId } = who;
  let primary: string[] = [];
  if (spec.kind === 'USER' && spec.id) primary = [spec.id];
  else if (spec.kind === 'ROLE' && spec.id) primary = await usersHoldingRoles(accountId, orgId, [spec.id]);
  else if (spec.kind === 'HR') primary = await hrDeciders(accountId, orgId);
  else if (spec.kind === 'OWNER') primary = await ownerDeciders(accountId, orgId);
  /* Holders of the type's Payroll approve right; administrators hold it too, so with nobody else it is the owner. */
  else if (spec.kind === 'PAYROLL') primary = await usersWithPermission(accountId, orgId, payrollRightOf(requestType));
  else if (spec.kind === 'DEPARTMENT_HEAD') {
    const subject = subjectEmployeeId ? await peoplePrisma.employee.findFirst({ where: { id: subjectEmployeeId, orgId }, select: { departmentId: true } }) : null;
    const dept = subject?.departmentId ? await peoplePrisma.department.findFirst({ where: { id: subject.departmentId, orgId }, select: { headEmployeeId: true } }) : null;
    const head = await managerUser(accountId, orgId, dept?.headEmployeeId);
    /* No department, no head, or a head who has gone or may not approve: HR takes the step. */
    primary = head ? [head] : await hrDeciders(accountId, orgId);
  } else if ((spec.kind === 'MANAGER' || spec.kind === 'MANAGER_OF_MANAGER') && subjectEmployeeId) {
    const subject = await peoplePrisma.employee.findFirst({ where: { id: subjectEmployeeId, orgId }, select: { reportingManagerId: true } });
    let managerId = subject?.reportingManagerId || null;
    if (spec.kind === 'MANAGER_OF_MANAGER' && managerId) {
      const m = await peoplePrisma.employee.findFirst({ where: { id: managerId, orgId }, select: { reportingManagerId: true } });
      managerId = m?.reportingManagerId || null;
    }
    /* A manager who has left or is suspended is no manager; one who may not approve requests would only stall it (E12): passed over. */
    const m = await managerUser(accountId, orgId, managerId);
    if (m) primary = [m];
    /* No manager, one who has gone, one who cannot sign in, or one who may not approve: HR takes the step. */
    if (!primary.length) primary = await hrDeciders(accountId, orgId);
  }
  const subs = await standInsFor(orgId, primary, day, requestType);
  return { primary, standIns: [...subs.entries()].map(([f, u]) => ({ for: f, user: u })) };
}

/**
 * Who is away on this day: on approved leave for the whole of it (not a half
 * day, not a few hours), or, for a named person (`leftToo`), gone from the
 * company. Answers their sign-ins.
 */
async function awayOn(orgId: string, userIds: string[], day: string, leftToo = false) {
  const out = new Set<string>();
  const ids = userIds.filter((u) => u && !u.startsWith(PORTAL_PREFIX));
  if (!ids.length) return out;
  const people = await peoplePrisma.employee.findMany({ where: { orgId, userId: { in: ids } }, select: { id: true, userId: true, status: true } });
  const current = people.filter((p) => p.status !== 'LEFT');
  if (leftToo) {
    const users = await platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true } });
    for (const u of users) if (!u.isActive) out.add(u.id);
    for (const u of ids) if (people.some((p) => p.userId === u) && !current.some((p) => p.userId === u)) out.add(u);
  }
  if (current.length) {
    const leave = await peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId: { in: current.map((p) => p.id) }, status: 'APPROVED', fromDate: { lte: day }, toDate: { gte: day }, halfDay: null, fromTime: null }, select: { employeeId: true } });
    for (const l of leave) {
      const u = current.find((p) => p.id === l.employeeId)?.userId;
      if (u) out.add(u);
    }
  }
  return out;
}

/**
 * The next one up from an employee: their manager (and theirs, up the line)
 * who may decide today, then HR, then the owner. Nobody in `skip`, nobody away.
 */
async function upFrom(who: { accountId: string; orgId: string }, employeeId: string | null, skip: Set<string>, day: string): Promise<string[]> {
  const { accountId, orgId } = who;
  const seen = new Set<string>();
  let at = employeeId;
  for (let depth = 0; at && depth < 8; depth += 1) {
    const e = await peoplePrisma.employee.findFirst({ where: { id: at, orgId }, select: { reportingManagerId: true } });
    const next = e?.reportingManagerId || null;
    if (!next || seen.has(next)) break;
    seen.add(next);
    const u = await managerUser(accountId, orgId, next);
    if (u && !skip.has(u) && !(await awayOn(orgId, [u], day)).has(u)) return [u];
    at = next;
  }
  for (const group of [await hrDeciders(accountId, orgId), await ownerDeciders(accountId, orgId)]) {
    const free = group.filter((u) => !skip.has(u));
    const away = await awayOn(orgId, free, day);
    const left = free.filter((u) => !away.has(u));
    if (left.length) return left;
  }
  return [];
}

async function employeeOfUser(orgId: string, userId: string) {
  if (userId.startsWith(PORTAL_PREFIX)) return userId.slice(PORTAL_PREFIX.length);
  return (await peoplePrisma.employee.findFirst({ where: { orgId, userId }, orderBy: [{ dateOfJoining: 'desc' }, { id: 'asc' }], select: { id: true } }))?.id || null;
}

/** Group kinds: everyone holding something. One of them away leaves the rest; all away goes up. */
const GROUP_KINDS = new Set(['HR', 'ROLE', 'PAYROLL', 'OWNER']);
const MANAGER_KINDS = new Set(['MANAGER', 'MANAGER_OF_MANAGER', 'COLLEAGUE_MANAGER']);

export type Req = { id?: string; requestType?: string; requesterUserId: string; subjectEmployeeId: string | null; payload?: unknown; sourceKind?: string | null };
export type Resolution = {
  primary: string[];
  standIns: Array<{ for: string; user: string }>;
  /** Everyone found, before the requester and the people it is about were taken out. */
  all: string[];
  candidates: string[];
  how: string | null;
  notes: string[];
};

async function excludedOf(orgId: string, request: Req) {
  const parties = await partyUsersOf(orgId, request.payload);
  return { parties, excluded: new Set([request.requesterUserId, (await subjectUserOf(orgId, request.subjectEmployeeId)) || '', ...parties].filter(Boolean)) };
}

/** A team-scoped role never decides outside its team (SPEC 5.3): group kinds only reach people whose line the subject is on. */
async function inScopeOnly(who: { accountId: string; orgId: string }, users: string[], subjectEmployeeId: string | null) {
  if (!subjectEmployeeId || !users.length) return users;
  const out: string[] = [];
  for (const u of users) {
    if (u.startsWith(PORTAL_PREFIX)) { out.push(u); continue; }
    const access = await resolveAccess(who.accountId, who.orgId, u);
    if (access.isAdmin || !access.ownDocumentsOnly || (await inReportingLine(who.orgId, u, subjectEmployeeId))) out.push(u);
  }
  return out;
}

/**
 * Who may decide for one approver of a step, as of `day`: resolved (5.3),
 * stand-ins added, anyone away passed up, the requester and the people it is
 * about taken out, and a team-scoped group kept to its team.
 */
async function resolveOne(who: { accountId: string; orgId: string }, approver: Approver, request: Req, day: string, approvedBy: () => Promise<Set<string | null>> = async () => new Set()): Promise<Resolution> {
  /* Only the module's own requests (opened with a preset) go to its words: a preview or anything else of the same type reads as before. */
  const hooks = ownedBySource(request) ? sources.get(String(request.requestType || '')) : undefined;
  if (hooks) return hooks.resolve(who, approver, request, day, approvedBy);
  const notes: string[] = [];
  let how: string | null = null;
  let resolved: { primary: string[]; standIns: Array<{ for: string; user: string }> };
  if (approver.kind === 'COLLEAGUE_MANAGER') {
    const other = String((request.payload as { colleagueEmployeeId?: unknown })?.colleagueEmployeeId || '') || null;
    resolved = await resolveApprover(who, { kind: 'MANAGER' }, other, day, request.requestType);
    /* The same manager as the requester's decided already: nothing more to ask. */
    const mine = await resolveApprover(who, { kind: 'MANAGER' }, request.subjectEmployeeId, day, request.requestType);
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    if (!other || same(resolved.primary, mine.primary)) return { primary: [], standIns: [], all: [], candidates: [], how: null, notes };
  } else {
    resolved = await resolveApprover(who, approver, request.subjectEmployeeId, day, request.requestType);
  }
  const { parties, excluded } = await excludedOf(who.orgId, request);
  /* Away (5.3 step 2): on leave all day with nobody standing in. One of a group away leaves the rest; a person away, or a whole group, goes up. */
  if (resolved.primary.length) {
    const covered = new Set(resolved.standIns.map((s) => s.for));
    const away = await awayOn(who.orgId, resolved.primary.filter((u) => !covered.has(u)), day, approver.kind === 'USER');
    if (away.size) {
      const present = resolved.primary.filter((u) => !away.has(u));
      const names = await namesFor([...away], who.orgId);
      if (GROUP_KINDS.has(approver.kind) && present.length) {
        resolved = { primary: present, standIns: resolved.standIns.filter((s) => present.includes(s.for)) };
        for (const a of away) notes.push(`Away: ${names.get(a) || 'someone'} on leave`);
      } else {
        const skip = new Set([...excluded, ...away]);
        const ups: string[] = [];
        for (const a of away) {
          const up = await upFrom(who, await employeeOfUser(who.orgId, a), skip, day);
          const upNames = await namesFor(up, who.orgId);
          notes.push(up.length ? `Away: ${names.get(a) || 'someone'} on leave, sent to ${up.map((u) => upNames.get(u) || 'someone').join(', ')}` : `Away: ${names.get(a) || 'someone'} on leave, nobody above to send it to`);
          ups.push(...up);
        }
        const primary = [...new Set([...present, ...ups])];
        const subs = await standInsFor(who.orgId, ups, day, request.requestType);
        resolved = { primary, standIns: [...resolved.standIns.filter((s) => present.includes(s.for)), ...[...subs.entries()].map(([f, u]) => ({ for: f, user: u }))] };
        how = 'AWAY_HANDED_UP';
      }
    }
  }
  const all = [...new Set([...resolved.primary, ...resolved.standIns.map((s) => s.user)])];
  /* Nobody approves their own request (APR-05), nor one about themselves, nor one they are a party to. */
  let candidates = all.filter((u) => !excluded.has(u));
  if (GROUP_KINDS.has(approver.kind)) candidates = await inScopeOnly(who, candidates, request.subjectEmployeeId);
  /* A manager step left empty only because its manager is a party to it (the colleague manages the requester): HR decides instead. */
  if (!candidates.length && all.some((u) => parties.includes(u)) && MANAGER_KINDS.has(approver.kind)) {
    resolved = await resolveApprover(who, { kind: 'HR' }, request.subjectEmployeeId, day, request.requestType);
    const hr = [...new Set([...resolved.primary, ...resolved.standIns.map((s) => s.user)])].filter((u) => !excluded.has(u));
    candidates = await inScopeOnly(who, hr, request.subjectEmployeeId);
  }
  if (!how && resolved.standIns.some((s) => candidates.includes(s.user))) how = 'STAND_IN';
  return { primary: resolved.primary, standIns: resolved.standIns, all, candidates, how: how || approver.kind, notes };
}

/** Several approvers resolved as one group (ANY), or one slot of ALL. */
async function resolveGroup(who: { accountId: string; orgId: string }, approvers: Approver[], request: Req, day: string, approvedBy?: () => Promise<Set<string | null>>): Promise<Resolution> {
  if (approvers.length === 1) return resolveOne(who, approvers[0], request, day, approvedBy);
  const parts = [];
  for (const a of approvers) parts.push(await resolveOne(who, a, request, day, approvedBy));
  return {
    primary: [...new Set(parts.flatMap((p) => p.primary))],
    standIns: parts.flatMap((p) => p.standIns),
    all: [...new Set(parts.flatMap((p) => p.all))],
    candidates: [...new Set(parts.flatMap((p) => p.candidates))],
    how: parts.find((p) => p.candidates.length)?.how || parts[0]?.how || null,
    notes: parts.flatMap((p) => p.notes),
  };
}

// ---------------------------------------------------------------------------
// Planning a step: who decides it, or why it is skipped (shared with preview)
// ---------------------------------------------------------------------------

/* Within one order, a step asked again after more information sits after the one it replaced. */
const include = { steps: { orderBy: [{ order: 'asc' as const }, { createdAt: 'asc' as const }, { slot: 'asc' as const }, { id: 'asc' as const }] } };

type SlotPlan = { slot: number; candidates: string[]; approverUserId: string; standInForUserId: string | null; how: string | null; comment: string | null };
export type StepPlan =
  | { order: number; kind: 'SKIPPED'; comment: string }
  | { order: number; kind: 'OPEN'; mode: 'ANY' | 'ALL'; slots: SlotPlan[]; dueAt: Date }
  /* Nobody else in the company could decide: the requester's own decision, written SELF_APPROVED (5.6). */
  | { order: number; kind: 'SELF'; comment: string; makerChecker: string };

const slotFrom = (slot: number, r: Resolution, candidates: string[], how: string | null, comment: string | null): SlotPlan => {
  const standIn = r.standIns.find((s) => candidates.includes(s.user));
  return { slot, candidates, approverUserId: candidates[0], standInForUserId: standIn ? standIn.for : null, how, comment };
};

/** Somebody besides the requester and the people it is about could decide this step. */
async function stepHasDecider(who: { accountId: string; orgId: string }, spec: StepV2, request: Req, facts: Facts, day: string) {
  if (!allHold(spec.when, facts)) return false;
  const groups = spec.mode === 'ALL' ? spec.approvers.map((a) => [a]) : [spec.approvers];
  for (const g of groups) {
    const r = await resolveGroup(who, g, request, day);
    if (r.candidates.length) return true;
    if (spec.ifRequester === 'NEXT_UP' && r.all.length && (await nextUpFor(who, request, day)).length) return true;
  }
  return false;
}

/** NEXT_UP (5.6): the requester's own manager, then HR, then the owner, never the requester or the people it is about. */
async function nextUpFor(who: { accountId: string; orgId: string }, request: Req, day: string) {
  const { excluded } = await excludedOf(who.orgId, request);
  return upFrom(who, await employeeOfUser(who.orgId, request.requesterUserId), excluded, day);
}

/**
 * One step, as of `day`: skipped (its conditions do not hold, or only the
 * requester could decide and somebody else decides another step), opened
 * with its deciders (one slot, or one per approver in ALL mode), or, when
 * nobody else in the company could decide anything, the maker-checker
 * setting's answer: approved by the requester (AUTO, ALLOW) or refused
 * (STRICT). Never writes.
 */
async function planStep(
  who: { accountId: string; orgId: string },
  specs: StepV2[],
  i: number,
  request: Req,
  facts: Facts,
  ctx: { day: string; now: Date; approvedBefore: () => Promise<boolean>; approvedBy: () => Promise<Set<string | null>> },
): Promise<StepPlan> {
  const spec = specs[i];
  if (!allHold(spec.when, facts)) return { order: spec.order, kind: 'SKIPPED', comment: 'Condition not met' };
  const groups = spec.mode === 'ALL' ? spec.approvers.map((a) => [a]) : [spec.approvers];
  const resolved: Resolution[] = [];
  for (const g of groups) resolved.push(await resolveGroup(who, g, request, ctx.day, ctx.approvedBy));
  /* The colleague's manager step is not asked of whoever already approved this request (one manager for both, or HR standing in twice). */
  if (spec.approvers.some((a) => a.kind === 'COLLEAGUE_MANAGER') && resolved.some((r) => r.candidates.length)) {
    const approvedBy = await ctx.approvedBy();
    if (approvedBy.size && resolved.some((r) => r.candidates.some((u) => approvedBy.has(u)))) return { order: spec.order, kind: 'SKIPPED', comment: 'Already approved by them' };
  }
  const dueAt = dueAtFrom(ctx.now, spec.due, addWorkingDays);
  const note = (r: Resolution, extra: string | null = null) => [extra, ...r.notes].filter(Boolean).join('. ').slice(0, 1000) || null;
  let slots: SlotPlan[] = [];
  for (let s = 0; s < resolved.length; s += 1) {
    const r = resolved[s];
    if (r.candidates.length) { slots.push(slotFrom(s, r, r.candidates, r.how, note(r))); continue; }
    /* Only the requester (or the people it is about) would take it: NEXT_UP sends it up their own line. */
    if (spec.ifRequester === 'NEXT_UP' && r.all.length) {
      const up = await nextUpFor(who, request, ctx.day);
      if (up.length) slots.push(slotFrom(s, r, up, 'NEXT_UP', note(r, 'Sent up: it would have been their own')));
    }
  }
  /*
   * Money, all of them (re-review of PR #93): a part nobody else can take goes to the admins, never just left
   * out, so two different people approve. When the company cannot supply two, the step still opens, and says
   * so in plain words to whoever can see it; they can reject it.
   */
  if (slots.length && spec.mode === 'ALL' && spec.approvers.length > 1 && TWO_PERSON_TYPES.has(String(request.requestType))) {
    const used = new Set(slots.flatMap((x) => x.candidates));
    for (let k = 0; k < resolved.length; k += 1) {
      if (slots.some((x) => x.slot === k)) continue;
      const { excluded } = await excludedOf(who.orgId, request);
      const to = await lastResortDeciders(who.accountId, who.orgId, [...excluded, ...used], request.subjectEmployeeId);
      if (to.length) { slots.push({ slot: k, candidates: to, approverUserId: to[0], standInForUserId: null, how: 'LAST_RESORT', comment: 'Sent to the admins: money needs a second person' }); to.forEach((u) => used.add(u)); }
    }
    slots.sort((a, b) => a.slot - b.slot);
    /* Blocked only when no second person exists at all: the same person on two parts is handled when they decide (the other part goes to the admins). */
    const { excluded } = await excludedOf(who.orgId, request);
    const blocked = slots.length < 2 || (used.size < 2 && !(await lastResortDeciders(who.accountId, who.orgId, [...excluded, ...used], request.subjectEmployeeId)).length);
    if (blocked) slots = slots.map((x) => ({ ...x, comment: TWO_PEOPLE_WORDS }));
  }
  /* ALL mode: a slot nobody else can take is left out while another slot has someone. */
  if (slots.length) {
    slots = slots.map((x, k) => ({ ...x, slot: spec.mode === 'ALL' ? k : 0 }));
    return { order: spec.order, kind: 'OPEN', mode: spec.mode, slots, dueAt };
  }
  /* Only the requester (or nobody) would decide this step. It is skipped only when somebody else decides the request: an earlier step, or a later one. */
  const approvedBefore = await ctx.approvedBefore();
  let laterDecides = false;
  for (let j = i + 1; !approvedBefore && !laterDecides && j < specs.length; j += 1) {
    if (await stepHasDecider(who, specs[j], request, facts, ctx.day)) laterDecides = true;
  }
  if (approvedBefore || laterDecides) return { order: spec.order, kind: 'SKIPPED', comment: 'Would have been the requester, or nobody to decide' };
  /* Otherwise it would approve itself (E11): the admins decide instead. */
  const { excluded } = await excludedOf(who.orgId, request);
  const admins = await lastResortDeciders(who.accountId, who.orgId, [...excluded], request.subjectEmployeeId);
  if (admins.length) return { order: spec.order, kind: 'OPEN', mode: 'ANY', dueAt, slots: [{ slot: 0, candidates: admins, approverUserId: admins[0], standInForUserId: null, how: 'LAST_RESORT', comment: 'Sent to the admins: nobody else could decide it' }] };
  /*
   * Nobody else in the company can decide it at all (5.6): the company's
   * maker-checker setting answers, as attendance's own requests already do
   * (makerChecker.ts selfDecisionAllowed). Something about yourself that is
   * Payroll's (your own pay, loan or settlement) is never self-approved.
   */
  if (NEVER_SELF_TYPES.has(String(request.requestType))) throw new ApprovalError('This is about you, so somebody else has to approve it. Give someone else the right to approve it.', 409, 'OWN_RECORD');
  const mode = (await getAuthPolicy(who.accountId, who.orgId)).makerChecker;
  if (mode === 'STRICT') throw new ApprovalError('Nobody else can approve this. Give someone else the right to approve requests, or change the approval rule.', 409, 'NO_APPROVER');
  return { order: spec.order, kind: 'SELF', makerChecker: mode, comment: mode === 'ALLOW' ? 'Nobody else in the company can decide this; the company allows one person to do both' : 'Nobody else in the company can decide this' };
}

/** Said to approvers when money needs two different people and the company has only one left who could. */
export const TWO_PEOPLE_WORDS = 'This needs two different people to approve; nobody else can. Reject it or add an approver.';

/**
 * Saving a money rule with an ALL step (re-review of PR #93): refused when this company cannot supply two
 * different people for it at all, so such a rule never leaves a request waiting on a second person who
 * does not exist. Counts everyone who could be named by the step's approvers, and the admins who take a
 * part nobody else can.
 */
export async function twoPersonProblem(who: { accountId: string; orgId: string }, spec: Pick<RuleSpecV2, 'requestType' | 'steps'>): Promise<{ error: string; step: number; field: string } | null> {
  if (!TWO_PERSON_TYPES.has(spec.requestType)) return null;
  const { accountId, orgId } = who;
  for (const step of spec.steps) {
    if (step.mode !== 'ALL' || step.approvers.length < 2) continue;
    const people = new Set<string>(await ownerDeciders(accountId, orgId));
    for (const a of step.approvers) {
      const found = a.kind === 'USER' && a.id ? [a.id]
        : a.kind === 'ROLE' && a.id ? await usersHoldingRoles(accountId, orgId, [a.id])
        : a.kind === 'HR' ? await hrDeciders(accountId, orgId)
        : a.kind === 'OWNER' ? []
        : a.kind === 'PAYROLL' ? await usersWithPermission(accountId, orgId, payrollRightOf(spec.requestType))
        : [...(await usersWithPermission(accountId, orgId, APPROVE_GRANT)), ...(await hrDeciders(accountId, orgId))];
      found.forEach((u) => people.add(u));
    }
    if (people.size < 2) return { step: step.order, field: 'mode', error: `Step ${step.order}: money needs two different people to approve, and this company has only one who can. Choose “any one of them”, or give a second person the right to approve.` };
  }
  return null;
}

type Audit = { action: string; message: string; metadata: Record<string, unknown>; userId: string | null };

async function openStep(
  tx: Prisma.TransactionClient,
  who: { accountId: string; orgId: string },
  /* `since`: a request asked again (restartSourced) counts only the approvals made after that. */
  request: { id: string; requestType: string; requesterUserId: string; subjectEmployeeId: string | null; payload: unknown; ruleSteps: StepV2[]; since?: Date },
  order: number,
  audits: Audit[] = [],
): Promise<'OPENED' | 'DONE'> {
  const facts = await factsFor(who.orgId, request.subjectEmployeeId, request.payload);
  const now = new Date();
  const day = todayIst();
  const base = { accountId: who.accountId, orgId: who.orgId, requestId: request.id };
  const askedAgain = (request.payload as { restartedAt?: unknown } | null)?.restartedAt;
  const since = request.since || (typeof askedAgain === 'string' ? new Date(askedAgain) : undefined);
  for (let i = order - 1; i < request.ruleSteps.length; i += 1) {
    const plan = await planStep(who, request.ruleSteps, i, request, facts, {
      day, now,
      approvedBefore: async () => (await tx.approvalStep.count({ where: { requestId: request.id, orgId: who.orgId, status: 'APPROVED', ...(since ? { decidedAt: { gte: since } } : {}) } })) > 0,
      approvedBy: async () => new Set((await tx.approvalStep.findMany({ where: { requestId: request.id, orgId: who.orgId, status: 'APPROVED', ...(since ? { decidedAt: { gte: since } } : {}) }, select: { decidedByUserId: true } })).map((x) => x.decidedByUserId)),
    });
    if (plan.kind === 'SKIPPED') {
      await tx.approvalStep.create({ data: { ...base, order: plan.order, candidateUserIds: [], approverUserId: null, dueAt: new Date(), status: 'SKIPPED', comment: plan.comment } });
      continue;
    }
    if (plan.kind === 'SELF') {
      await tx.approvalStep.create({ data: { ...base, order: plan.order, candidateUserIds: [request.requesterUserId], approverUserId: request.requesterUserId, dueAt: now, status: 'APPROVED', decidedByUserId: request.requesterUserId, decidedAt: now, comment: plan.comment, resolvedHow: 'SELF_APPROVED' } });
      const name = (await namesFor([request.requesterUserId], who.orgId)).get(request.requesterUserId) || 'the person who asked';
      audits.push({ action: 'SELF_APPROVED', userId: request.requesterUserId, message: `Step ${plan.order} approved by ${name}, who asked for it: ${plan.comment.charAt(0).toLowerCase()}${plan.comment.slice(1)}`, metadata: { makerChecker: plan.makerChecker, requestType: request.requestType, step: plan.order } });
      continue;
    }
    for (const slot of plan.slots) {
      await tx.approvalStep.create({
        data: {
          ...base, order: plan.order, slot: slot.slot, mode: plan.mode,
          candidateUserIds: slot.candidates, approverUserId: slot.approverUserId, standInForUserId: slot.standInForUserId,
          dueAt: plan.dueAt, status: 'WAITING', comment: slot.comment, resolvedHow: slot.how,
        },
      });
    }
    await tx.approvalRequest.update({ where: { id: request.id }, data: { currentStep: plan.order, status: 'WAITING' } });
    return 'OPENED';
  }
  return 'DONE';
}

/** Audit lines the engine writes itself (self-approval), after the decision commits. Every line names the person. */
async function writeAudits(who: { accountId: string; orgId: string }, requestId: string, audits: Audit[]) {
  for (const a of audits) {
    try {
      await platformPrisma.auditLog.create({ data: { accountId: who.accountId, orgId: who.orgId, branchId: '', entity: 'ApprovalRequest', entityId: requestId, action: a.action, message: a.message.slice(0, 500), metadata: JSON.stringify(a.metadata).slice(0, 20_000), createdByUserId: a.userId || 'system', correlationId: requestId } });
    } catch (e) {
      console.error(`[people-approvals] ${who.orgId}: audit ${a.action} for ${requestId} not recorded:`, e instanceof Error ? e.message : e);
    }
  }
}

/** Does an auto-approve entry of the rule hold for this request? Never for money (5.2). */
function autoApproves(rule: RuleRow, requestType: string, facts: Facts) {
  if (MONEY_TYPES.has(requestType)) return false;
  return normaliseAutoApprove(rule.autoApprove).some((a) => allHold(a.when, facts));
}

// ---------------------------------------------------------------------------
// Submitting and deciding
// ---------------------------------------------------------------------------

export async function submitRequest(actor: Actor, input: { requestType: RequestType; subjectEmployeeId?: string | null; title: string; payload: Payload; idempotencyKey?: string | null }): Promise<{ request: RequestRow; outcome?: Record<string, unknown> | void; existed?: boolean }> {
  const { accountId, orgId } = actor;
  if (!actor.userId) throw new ApprovalError('Sign in to ask for something.', 401);
  if (input.idempotencyKey) {
    const existing = await peoplePrisma.approvalRequest.findFirst({ where: { orgId, idempotencyKey: input.idempotencyKey }, include });
    if (existing) return { request: existing, existed: true };
  }
  const facts = await factsFor(orgId, input.subjectEmployeeId ?? null, input.payload);
  const rule = await pickRule(orgId, input.requestType, facts);
  if (!rule) throw new ApprovalError(`No approval rule for ${input.requestType.toLowerCase().replace(/_/g, ' ')}: the company has not set one.`, 409, 'NO_RULE');
  /* Two job changes on the same field cannot wait side by side: approving both would let the later one undo the earlier without anyone seeing it (Workforce final audit W11). */
  if (input.requestType === 'JOB_CHANGE' && input.subjectEmployeeId) {
    const asked = Object.keys(((input.payload || {}) as { fields?: Record<string, unknown> }).fields || {});
    const open = await peoplePrisma.approvalRequest.findMany({ where: { orgId, subjectEmployeeId: input.subjectEmployeeId, requestType: 'JOB_CHANGE', status: { in: ['WAITING', 'MORE_INFO'] } }, select: { title: true, payload: true } });
    const clash = open.find((r) => Object.keys(((r.payload || {}) as { fields?: Record<string, unknown> }).fields || {}).some((f) => asked.includes(f)));
    if (clash) throw new ApprovalError(`"${clash.title}" is already waiting for approval. Wait for it, or withdraw it, first.`, 409, 'REQUEST_WAITING');
  }
  const ruleSteps = stepsOfRule(rule);
  const audits: Audit[] = [];
  const created = await peoplePrisma.$transaction(async (tx) => {
    const r = await tx.approvalRequest.create({
      data: {
        accountId, orgId, requestType: input.requestType, subjectEmployeeId: input.subjectEmployeeId ?? null, requesterUserId: actor.userId!,
        ruleId: rule.id, ruleVersion: rule.version, ruleVariant: rule.variantKey, title: input.title.slice(0, 200), payload: input.payload as unknown as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey ?? null, status: 'WAITING', currentStep: 1,
      },
    });
    await writeChangeLog(tx, actor, { kind: 'ApprovalRequest', id: r.id, employeeId: input.subjectEmployeeId ?? null }, [{ field: 'status', before: null, after: 'WAITING', redacted: false }]);
    /* The rule approves this on its own (5.2 autoApprove): one closed step says so, and nobody is asked. */
    if (autoApproves(rule, input.requestType, facts)) {
      await tx.approvalStep.create({ data: { accountId, orgId, requestId: r.id, order: 1, candidateUserIds: [], approverUserId: null, dueAt: new Date(), status: 'APPROVED', decidedAt: new Date(), comment: 'Approved on its own: the rule approves requests like this', resolvedHow: 'AUTO_APPROVED' } });
      return { id: r.id, state: 'DONE' as const };
    }
    const state = await openStep(tx, { accountId, orgId }, { id: r.id, requestType: r.requestType, requesterUserId: r.requesterUserId, subjectEmployeeId: r.subjectEmployeeId, payload: r.payload, ruleSteps }, 1, audits);
    return { id: r.id, state };
  });
  await writeAudits({ accountId, orgId }, created.id, audits);
  if (created.state === 'DONE') return approveFinal(actor, created.id);
  const request = await peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: created.id }, include });
  await notifyStep(request);
  return { request };
}

/**
 * Tell the person who asked. Someone without a CLOR sign-in asked from the
 * employee app: they see it there (My details, and the app's updates), not
 * as a CLOR notification to a user who does not exist.
 */
async function tellRequester(r: { accountId: string; orgId: string; requesterUserId: string; requestType?: string }, title: string, body?: string | null) {
  if (r.requesterUserId.startsWith(PORTAL_PREFIX)) return;
  /* A module that keeps its own record tells its own people (leave's notices). */
  if (r.requestType && sources.has(r.requestType)) return;
  await notifyUsers(r.accountId, r.orgId, [r.requesterUserId], { kind: 'people.approval', title, body: body ?? null, link: { app: 'people', screen: 'approvals' } as any });
  await emailUsers(r.accountId, r.orgId, [r.requesterUserId], 'people.approval_decided', { title, noteLine: body ? `\n\n${body}` : '' }, (r as { id?: string }).id || '');
}

/**
 * The same notice by email (platform audit, 11 Nov 2026: People approvals only
 * rang the in-app bell). Only CLOR users get it; someone in the employee app
 * sees it there. Optional mail: a company can switch these off in Workspace,
 * Email notifications. A failed send never stops the approval.
 */
async function emailUsers(accountId: string, orgId: string, userIds: string[], templateKey: 'people.approval_waiting' | 'people.approval_decided', data: Record<string, string>, relatedId: string) {
  const ids = [...new Set(userIds.filter((u) => u && !u.startsWith(PORTAL_PREFIX)))];
  if (!ids.length) return;
  const [users, org] = await outsideTenant('approvals: who to email', () =>
    Promise.all([
      platformPrisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { email: true, fullName: true } }),
      platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
    ]),
  );
  const appUrl = `${(process.env.APP_URL || 'https://app.clor.in').replace(/\/$/, '')}/`;
  for (const u of users) {
    await sendTemplate({ templateKey, to: u.email, toName: u.fullName ?? undefined, accountId, orgId, relatedType: 'ApprovalRequest', relatedId, data: { userName: u.fullName || u.email, orgName: org?.name || '', appUrl, ...data } }).catch(() => undefined);
  }
}

async function notifyStep(request: RequestRow) {
  if (sourced(request)) return;
  const waiting = request.steps.filter((s) => s.order === request.currentStep && s.status === 'WAITING');
  const step = waiting[0];
  if (!step) return;
  /* ALL mode: everyone on every slot still waiting. */
  const ids = [...new Set(waiting.flatMap((s) => (s.candidateUserIds as string[]) || []))];
  await notifyUsers(request.accountId, request.orgId, ids, { kind: 'people.approval', title: `Waiting for you: ${request.title}`, body: `Due ${step.dueAt.toISOString().slice(0, 10)}.`, link: { app: 'people', screen: 'approvals' } as any }, { subjectKey: `approval:${request.id}` });
  await emailUsers(request.accountId, request.orgId, ids, 'people.approval_waiting', { headline: 'Waiting for you', title: request.title, dueLine: `Due ${step.dueAt.toISOString().slice(0, 10)}.` }, request.id);
}

/**
 * Everything approved: run the effect and close.
 *
 * The last step's decision commits first and this runs after it, because an
 * effect belongs to the module that owns the request type and writes in its
 * own transactions. So a request whose steps are all decided but which is
 * still WAITING, with no step waiting, is one this did not finish (the
 * process stopped, a write failed). That state is the mark: finishStalled
 * runs this again from the read paths and the dues job. A lock per request,
 * held until the status is written, and a fresh look under it, make the
 * original run and a recovery never both apply the effect.
 */
async function approveFinal(actor: Actor, requestId: string) {
  const done = await peoplePrisma.$transaction(async (lock) => {
    await lock.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`approval-final:${requestId}`}))`;
    const request = await lock.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include });
    /* Finished already (by the run this one waited for), or not finished deciding: nothing to apply. */
    if (request.status !== 'WAITING' || request.steps.some((s) => s.status === 'WAITING')) return { request, outcome: undefined as Record<string, unknown> | void, applied: false };
    const effect = effects.get(request.requestType as RequestType);
    /* TRACE-05: what the decision rested on is frozen before anything changes, and every change-log line carries it. */
    const { recordDecision } = await import('../decisions.js');
    const decision = await recordDecision(request);
    let outcome: Record<string, unknown> | void = undefined;
    try {
      if (effect) outcome = await effect({ request, actor: { ...actor, source: 'APPROVAL', requestId: request.id, decisionId: decision.id } });
    } catch (e) {
      /* The module's own transaction undoes the decision: its error, as it said it (leave's 409s). */
      if (sourced(request)) throw e;
      await closeUnapplied(actor, request, decision.id, e);
      throw new ApprovalError(`Approved, but it could not be applied: ${reasonOf(e)} The request is closed; ask again once that is fixed.`, 409, 'NOT_APPLIED');
    }
    const r = await lock.approvalRequest.update({ where: { id: requestId }, data: { status: 'APPROVED', decisionId: decision.id, outcome: (outcome || null) as Prisma.InputJsonValue }, include });
    await writeChangeLog(lock, actor, { kind: 'ApprovalRequest', id: r.id, employeeId: r.subjectEmployeeId }, [{ field: 'status', before: 'WAITING', after: 'APPROVED', redacted: false }]);
    return { request: r, outcome, applied: true };
  }, { timeout: 60_000 });
  if (done.applied) await tellRequester(done.request, `Approved: ${done.request.title}`);
  return { request: done.request, outcome: done.outcome };
}

/** Every step decided, the request still WAITING with none waiting: approveFinal did not finish. */
const stalled = (r: RequestRow) => r.status === 'WAITING' && r.steps.length > 0 && !r.steps.some((s) => s.status === 'WAITING');

/**
 * Finish requests approveFinal left half done, as whoever approved the last
 * step (the requester, when every step was skipped). Never fails a read: a
 * request that still cannot be applied is closed by approveFinal itself, and
 * anything else is logged and tried again on the next read or dues run.
 * Answers the rows as they are now.
 */
export async function finishStalled(rows: RequestRow[]): Promise<RequestRow[]> {
  if (!rows.some(stalled)) return rows;
  const out: RequestRow[] = [];
  for (const r of rows) {
    if (!stalled(r)) { out.push(r); continue; }
    const last = r.steps.filter((s) => s.status === 'APPROVED').sort((a, b) => (b.decidedAt?.getTime() || 0) - (a.decidedAt?.getTime() || 0))[0];
    try {
      await approveFinal({ accountId: r.accountId, orgId: r.orgId, userId: last?.decidedByUserId || r.requesterUserId, source: 'APPROVAL', correlationId: r.id, requestId: r.id }, r.id);
    } catch (e) {
      console.error(`[people-approvals] ${r.orgId}: request ${r.id} not finished:`, e instanceof Error ? e.message : e);
    }
    out.push(await peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id }, include }));
  }
  return out;
}

const reasonOf = (e: unknown) => {
  const m = String(e instanceof Error ? e.message : e || 'something went wrong').trim().slice(0, 400);
  return /[.!?]$/.test(m) ? m : `${m}.`;
};

/**
 * Every step approved, but what approval does failed (the record changed, a
 * date no longer fits). The request must not sit WAITING with no step
 * waiting: it is closed as not approved, with a closing line saying why that
 * the Approvals screen shows, and the requester and HR are told.
 */
async function closeUnapplied(actor: Actor, request: RequestRow, decisionId: string, error: unknown) {
  const reason = reasonOf(error);
  try {
    const closed = await peoplePrisma.$transaction(async (tx) => {
      await tx.approvalStep.create({ data: { accountId: request.accountId, orgId: request.orgId, requestId: request.id, order: request.currentStep, candidateUserIds: [], approverUserId: null, dueAt: new Date(), status: 'REJECTED', comment: `Could not apply: ${reason}`.slice(0, 1000), decidedAt: new Date() } });
      const r = await tx.approvalRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', decisionId, outcome: { notApplied: reason } as Prisma.InputJsonValue }, include });
      await writeChangeLog(tx, actor, { kind: 'ApprovalRequest', id: r.id, employeeId: r.subjectEmployeeId }, [{ field: 'status', before: 'WAITING', after: 'REJECTED', redacted: false }]);
      return r;
    });
    await tellClosed(closed, 'REJECTED', `Could not apply: ${reason}`);
    await tellRequester(closed, `Approved but not applied: ${closed.title}`, `Could not apply: ${reason} Ask again once that is fixed.`);
    const hr = (await hrDeciders(closed.accountId, closed.orgId)).filter((u) => u !== closed.requesterUserId);
    await notifyUsers(closed.accountId, closed.orgId, hr, { kind: 'people.approval', title: `Approved but not applied: ${closed.title}`, body: `Could not apply: ${reason}`, link: { app: 'people', screen: 'approvals' } as any }, { except: actor.userId });
  } catch (e) {
    console.error(`[people-approvals] ${request.orgId}: request ${request.id} not closed after a failed effect:`, e instanceof Error ? e.message : e);
  }
}

export type Decision = 'approve' | 'reject' | 'more-info';

/** Who may step in for a step's approver (5.5): HR, or the owner. */
async function stepInGroup(who: { accountId: string; orgId: string }, group: 'HR' | 'OWNER', subjectEmployeeId: string | null) {
  return group === 'HR' ? inScopeOnly(who, await hrDeciders(who.accountId, who.orgId), subjectEmployeeId) : ownerDeciders(who.accountId, who.orgId);
}

export async function decide(actor: Actor, requestId: string, decision: Decision, comment: string | null, opts: { atSource?: boolean } = {}) {
  const { orgId } = actor;
  const userId = actor.userId;
  if (!userId) throw new ApprovalError('Sign in to decide.', 401);
  const request = await peoplePrisma.approvalRequest.findFirst({ where: { id: requestId, orgId }, include });
  if (!request) throw new ApprovalError('No such request.', 404, 'NOT_FOUND');
  /* A module's own record (a leave) is decided where it was asked, with the module's checks and in its transaction. */
  if (request.sourceKind && !opts.atSource) throw new ApprovalError('Decide this from the leave requests, where it was asked.', 409, 'DECIDE_AT_SOURCE');
  if (request.sourceKind && decision === 'more-info') throw new ApprovalError('Approve or reject it.', 400, 'NOT_SUPPORTED');
  if (request.status !== 'WAITING') throw new ApprovalError(`This request is ${request.status.toLowerCase().replace('_', ' ')}; nothing to decide.`, 409, 'NOT_WAITING');
  /* ANY mode: one row waits. ALL mode: one row per approver, each decided by its own people. */
  const waiting = request.steps.filter((s) => s.order === request.currentStep && s.status === 'WAITING');
  if (!waiting.length) {
    /* Every step decided but never closed: finished now, and the decider is told it is done. */
    if (stalled(request)) await finishStalled([request]);
    throw new ApprovalError('No step is waiting.', 409, 'NOT_WAITING');
  }
  const ruleSteps = stepsOfRule(await peoplePrisma.approvalRule.findUnique({ where: { id: request.ruleId } }));
  const spec = ruleSteps.find((s) => s.order === waiting[0].order);
  let mine = waiting.filter((s) => ((s.candidateUserIds as string[]) || []).includes(userId));
  /* ALL mode: whoever approved one part of this step does not take another, by step-in or otherwise (review of PR #93). */
  const all = waiting[0].mode === 'ALL';
  const decidedPart = new Set(request.steps.filter((s) => s.order === waiting[0].order && s.status === 'APPROVED' && s.decidedByUserId).map((s) => s.decidedByUserId as string));
  if (all && decidedPart.has(userId)) throw new ApprovalError('You approved part of this step already; someone else decides the rest.', 403, 'ALREADY_DECIDED_PART');
  /* Step-in (5.5): someone in the step's step-in group decides in the approver's place, and it is logged as such. */
  let steppingIn: 'HR' | 'OWNER' | null = null;
  const stepInPeople = async (group: 'HR' | 'OWNER') => {
    const hooks = ownedBySource(request) ? sources.get(request.requestType) : undefined;
    return hooks ? hooks.stepIn({ accountId: actor.accountId, orgId }, group, request) : stepInGroup({ accountId: actor.accountId, orgId }, group, request.subjectEmployeeId);
  };
  if (!mine.length && spec?.stepIn && (await stepInPeople(spec.stepIn)).includes(userId)) {
    mine = [waiting[0]];
    steppingIn = spec.stepIn;
  }
  if (!mine.length) throw new ApprovalError('This is not yours to decide.', 403, 'NOT_APPROVER');
  if (request.requesterUserId === userId) throw new ApprovalError('Nobody decides their own request.', 403, 'OWN_REQUEST');
  if ((await subjectUserOf(orgId, request.subjectEmployeeId)) === userId) throw new ApprovalError('Nobody decides a request about themselves.', 403, 'OWN_REQUEST');
  if ((await partyUsersOf(orgId, request.payload)).includes(userId)) throw new ApprovalError('Nobody decides a request they are part of.', 403, 'OWN_REQUEST');
  /*
   * One decision takes one part of an ALL step (review of PR #93): the part fewest others could take. A
   * further part this person is named on, that nobody else could take, is theirs too (written SAME_PERSON
   * and audited) — except money, where it goes to someone else: two different people, always.
   */
  const othersFor = (s: (typeof waiting)[number]) => ((s.candidateUserIds as string[]) || []).filter((u) => u !== userId && !decidedPart.has(u));
  const ordered = [...mine].sort((a, b) => othersFor(a).length - othersFor(b).length);
  let targets = [ordered[0]];
  const samePerson: string[] = [];
  const widen: Array<{ id: string; to: string[] }> = [];
  if (decision === 'approve' && all && !steppingIn) {
    const twoPeople = TWO_PERSON_TYPES.has(request.requestType);
    for (const s of ordered.slice(1)) {
      if (othersFor(s).length) continue;
      if (!twoPeople) { samePerson.push(s.id); continue; }
      const { excluded } = await excludedOf(orgId, request);
      const to = await lastResortDeciders(actor.accountId, orgId, [...excluded, userId, ...decidedPart], request.subjectEmployeeId);
      if (!to.length) throw new ApprovalError(TWO_PEOPLE_WORDS, 409, 'TWO_PEOPLE');
      widen.push({ id: s.id, to });
    }
    targets = [ordered[0], ...ordered.filter((s) => samePerson.includes(s.id))];
    /* Money: this would close the step with one person's approval (nobody else could take another part). */
    if (twoPeople && (spec?.approvers.length || 0) > 1 && !decidedPart.size && waiting.every((w) => targets.some((t) => t.id === w.id)) && !widen.length) throw new ApprovalError(TWO_PEOPLE_WORDS, 409, 'TWO_PEOPLE');
  }
  if (decision === 'approve') await checks.get(request.requestType as RequestType)?.(request);
  const stepStatus = decision === 'approve' ? 'APPROVED' : decision === 'reject' ? 'REJECTED' : 'MORE_INFO';
  const order = targets[0].order;
  const audits: Audit[] = [];
  const forUser = targets[0].approverUserId || '';
  const forName = steppingIn && forUser ? (await namesFor([forUser], orgId)).get(forUser) || '' : '';
  if (samePerson.length) {
    const me = (await namesFor([userId], orgId)).get(userId) || 'Someone';
    audits.push({ action: 'SAME_PERSON_APPROVED', userId, message: `${me} approved both parts of step ${order}: nobody else could`, metadata: { requestType: request.requestType, step: order, parts: targets.length } });
  }
  const result = await peoplePrisma.$transaction(async (tx) => {
    /* One decision on a request at a time: two slots of an ALL step approved at once still open the next step exactly once. */
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`approval-decide:${request.id}`}))`;
    if (all && (await tx.approvalStep.count({ where: { requestId: request.id, order, status: 'APPROVED', decidedByUserId: userId } }))) throw new ApprovalError('You approved part of this step already; someone else decides the rest.', 403, 'ALREADY_DECIDED_PART');
    for (const step of targets) {
      const standInFor = steppingIn ? step.approverUserId : step.standInForUserId && userId !== step.standInForUserId ? step.standInForUserId : null;
      const how = steppingIn ? { resolvedHow: 'STEP_IN' } : samePerson.includes(step.id) ? { resolvedHow: 'SAME_PERSON' } : {};
      /* Claimed atomically: two approvers deciding at once leave one decision. */
      const claimed = await tx.approvalStep.updateMany({ where: { id: step.id, status: 'WAITING' }, data: { status: stepStatus, decidedByUserId: userId, decidedAt: new Date(), comment: comment ? comment.slice(0, 1000) : null, approverUserId: userId, standInForUserId: standInFor, ...how } });
      if (!claimed.count) throw new ApprovalError('Someone else just decided this.', 409, 'ALREADY_DECIDED');
    }
    for (const w of widen) {
      await tx.approvalStep.updateMany({ where: { id: w.id, status: 'WAITING' }, data: { candidateUserIds: w.to, approverUserId: w.to[0], standInForUserId: null, resolvedHow: 'LAST_RESORT', comment: 'Sent to the admins: money needs a second person' } });
    }
    await writeChangeLog(tx, actor, { kind: 'ApprovalRequest', id: request.id, employeeId: request.subjectEmployeeId }, [
      { field: `step ${order}`, before: 'WAITING', after: stepStatus, redacted: false },
      ...(steppingIn ? [{ field: `step ${order} decided for`, before: null, after: `${forName || 'the approver'} (stepped in as ${steppingIn === 'HR' ? 'HR' : 'the owner'})`, redacted: false }] : []),
    ]);
    if (decision === 'reject') {
      /* ALL mode: one rejection rejects; the other slots are not needed. */
      await tx.approvalStep.updateMany({ where: { requestId: request.id, order, status: 'WAITING' }, data: { status: 'SKIPPED', comment: 'Not needed: rejected at another part of this step' } });
      await tx.approvalRequest.update({ where: { id: request.id }, data: { status: 'REJECTED' } });
      return 'REJECTED' as const;
    }
    if (decision === 'more-info') {
      await tx.approvalRequest.update({ where: { id: request.id }, data: { status: 'MORE_INFO' } });
      return 'MORE_INFO' as const;
    }
    /* ALL mode: the step completes when every slot is approved. */
    if (await tx.approvalStep.count({ where: { requestId: request.id, order, status: 'WAITING' } })) return 'PARTIAL' as const;
    const state = await openStep(tx, { accountId: actor.accountId, orgId }, { id: request.id, requestType: request.requestType, requesterUserId: request.requesterUserId, subjectEmployeeId: request.subjectEmployeeId, payload: request.payload, ruleSteps }, order + 1, audits);
    return state === 'DONE' ? ('DONE' as const) : ('OPENED' as const);
  });
  await writeAudits({ accountId: actor.accountId, orgId }, request.id, audits);
  if (steppingIn) {
    const deciderName = (await namesFor([userId], orgId)).get(userId) || 'Someone';
    await tellRequester(request, `Decided by ${deciderName} (${steppingIn === 'HR' ? 'HR' : 'the owner'})${forName ? ` for ${forName}` : ''}: ${request.title}`);
  }
  if (result === 'DONE') return approveFinal(actor, request.id);
  const fresh = await peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id }, include });
  if (result === 'PARTIAL') return { request: fresh };
  if (result === 'REJECTED') await tellClosed(fresh, 'REJECTED', comment);
  if (result === 'OPENED') await notifyStep(fresh);
  else await tellRequester(fresh, `${result === 'REJECTED' ? 'Not approved' : 'More information asked for'}: ${fresh.title}`, comment);
  return { request: fresh };
}

/** The requester answers a request for more information: the same step waits again for the same people. */
export async function reply(actor: Actor, requestId: string, note: string) {
  const request = await peoplePrisma.approvalRequest.findFirst({ where: { id: requestId, orgId: actor.orgId }, include });
  if (!request) throw new ApprovalError('No such request.', 404, 'NOT_FOUND');
  if (request.sourceKind) throw new ApprovalError('Nothing was asked.', 409, 'NOT_WAITING');
  if (request.requesterUserId !== actor.userId) throw new ApprovalError('Only the person who asked can answer.', 403);
  if (request.status !== 'MORE_INFO') throw new ApprovalError('Nothing was asked.', 409, 'NOT_WAITING');
  const ofStep = request.steps.filter((s) => s.order === request.currentStep).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  /* The slot that asked (ALL mode); in ANY mode that is the step's last row, as before. */
  const last = ofStep.find((s) => s.status === 'MORE_INFO') || ofStep[0];
  const spec = stepsOfRule(await peoplePrisma.approvalRule.findUnique({ where: { id: request.ruleId } })).find((s) => s.order === request.currentStep);
  await peoplePrisma.$transaction(async (tx) => {
    /* Claimed first, while it is still MORE_INFO: a double submit opens one waiting step, not two. */
    const claimed = await tx.approvalRequest.updateMany({ where: { id: request.id, orgId: request.orgId, status: 'MORE_INFO' }, data: { status: 'WAITING' } });
    if (!claimed.count) throw new ApprovalError('This was already answered.', 409, 'NOT_WAITING');
    await tx.approvalStep.create({ data: { accountId: request.accountId, orgId: request.orgId, requestId: request.id, order: request.currentStep, slot: last.slot, mode: last.mode, candidateUserIds: last.candidateUserIds as Prisma.InputJsonValue, approverUserId: last.approverUserId, standInForUserId: last.standInForUserId, dueAt: dueAtFrom(new Date(), spec?.due || { workingDays: 2 }, addWorkingDays), status: 'WAITING', resolvedHow: last.resolvedHow === 'STEP_IN' ? null : last.resolvedHow } });
    await tx.approvalRequest.update({ where: { id: request.id }, data: { status: 'WAITING', payload: { ...(request.payload as object), replies: [...(((request.payload as any)?.replies as unknown[]) || []), { at: new Date().toISOString(), note: note.slice(0, 1000) }] } as Prisma.InputJsonValue } });
  });
  const fresh = await peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id }, include });
  await notifyStep(fresh);
  return fresh;
}

export async function withdraw(actor: Actor, requestId: string) {
  const request = await peoplePrisma.approvalRequest.findFirst({ where: { id: requestId, orgId: actor.orgId }, include });
  if (!request) throw new ApprovalError('No such request.', 404, 'NOT_FOUND');
  if (request.sourceKind) throw new ApprovalError('Withdraw it from your leave, where you asked for it.', 409, 'DECIDE_AT_SOURCE');
  if (request.requesterUserId !== actor.userId) throw new ApprovalError('Only the person who asked can withdraw it.', 403);
  if (!['WAITING', 'MORE_INFO'].includes(request.status)) throw new ApprovalError(`This request is ${request.status.toLowerCase()}.`, 409, 'NOT_WAITING');
  const done = await peoplePrisma.$transaction(async (tx) => {
    /* Claimed while still open: a withdraw racing a decision leaves one outcome. */
    const claimed = await tx.approvalRequest.updateMany({ where: { id: request.id, orgId: actor.orgId, status: { in: ['WAITING', 'MORE_INFO'] } }, data: { status: 'WITHDRAWN' } });
    if (!claimed.count) throw new ApprovalError('This was decided a moment ago.', 409, 'NOT_WAITING');
    await tx.approvalStep.updateMany({ where: { requestId: request.id, status: 'WAITING' }, data: { status: 'WITHDRAWN' } });
    const r = await tx.approvalRequest.findUniqueOrThrow({ where: { id: request.id }, include });
    await writeChangeLog(tx, actor, { kind: 'ApprovalRequest', id: r.id, employeeId: r.subjectEmployeeId }, [{ field: 'status', before: request.status, after: 'WITHDRAWN', redacted: false }]);
    return r;
  });
  await tellClosed(done, 'WITHDRAWN', null);
  /* The approvers' "waiting for you" notices say it was withdrawn, or go, as the company chose (SPEC 3.6). */
  const { withdrawnNotices } = await choicesFor(actor.orgId);
  await retireNotices(actor.orgId, `approval:${done.id}`, withdrawnNotices, { app: 'people', screen: 'approvals', params: { open: 'APPROVAL', id: done.id } });
  return done;
}

// ---------------------------------------------------------------------------
// A module's own records (leave, phase 2c): opened, restarted and closed by the module
// ---------------------------------------------------------------------------

/**
 * A request for a record a module keeps itself (a leave), under the rule the module chose (a preset).
 * Called inside the module's transaction: the record and its request commit together. The module
 * tells people itself. When nobody but the person could decide, the step closes as SELF_APPROVED
 * (5.6) and the module's effect runs at once.
 */
export async function openSourced(actor: Actor, input: { requestType: string; sourceKind: string; sourceId: string; subjectEmployeeId: string; requesterUserId: string; title: string; payload: Payload; rule: RuleRow; autoApproved?: string | null }): Promise<{ request: RequestRow; done: boolean }> {
  const { accountId, orgId } = actor;
  const ruleSteps = stepsOfRule(input.rule);
  const audits: Audit[] = [];
  const created = await peoplePrisma.$transaction(async (tx) => {
    const r = await tx.approvalRequest.create({
      data: {
        accountId, orgId, requestType: input.requestType, subjectEmployeeId: input.subjectEmployeeId, requesterUserId: input.requesterUserId,
        ruleId: input.rule.id, ruleVersion: input.rule.version, ruleVariant: input.rule.variantKey, title: input.title.slice(0, 200), payload: input.payload as unknown as Prisma.InputJsonValue,
        status: 'WAITING', currentStep: 1, sourceKind: input.sourceKind, sourceId: input.sourceId,
      },
    });
    await writeChangeLog(tx, actor, { kind: 'ApprovalRequest', id: r.id, employeeId: input.subjectEmployeeId }, [{ field: 'status', before: null, after: 'WAITING', redacted: false }]);
    /* Approved by the rule itself (the module says when: a leave type's own auto-approval): one closed step says so, and nobody is asked. */
    if (input.autoApproved) {
      await tx.approvalStep.create({ data: { accountId, orgId, requestId: r.id, order: 1, candidateUserIds: [], approverUserId: null, dueAt: new Date(), status: 'APPROVED', decidedAt: new Date(), comment: input.autoApproved.slice(0, 1000), resolvedHow: 'AUTO_APPROVED' } });
      return { id: r.id, state: 'DONE' as const };
    }
    const state = await openStep(tx, { accountId, orgId }, { id: r.id, requestType: r.requestType, requesterUserId: r.requesterUserId, subjectEmployeeId: r.subjectEmployeeId, payload: r.payload, ruleSteps }, 1, audits);
    return { id: r.id, state };
  });
  /* The audit lines (self-approval) once it has really finished opening: a module that refuses the approval leaves none behind. */
  const out = await finishSourced(actor, created.id, created.state === 'DONE', input.autoApproved ? null : input.requesterUserId);
  await writeAudits({ accountId, orgId }, created.id, audits);
  return out;
}

/** Opened or restarted: when every step closed already (self-approved, skipped), the module's effect runs as whoever approved last. */
async function finishSourced(actor: Actor, requestId: string, done: boolean, fallbackUserId: string | null) {
  if (done) {
    const last = await peoplePrisma.approvalStep.findFirst({ where: { requestId, status: 'APPROVED' }, orderBy: [{ order: 'desc' }, { createdAt: 'desc' }] });
    const out = await approveFinal({ ...actor, userId: last?.decidedByUserId || fallbackUserId }, requestId);
    return { request: out.request, done: true };
  }
  return { request: await peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include }), done: false };
}

/**
 * The record changed while it waited (a leave's dates or type): its request starts again from the
 * first step under `rule`, and says so. Steps already decided stay in its story.
 */
export async function restartSourced(actor: Actor, requestId: string, input: { sourceId: string; payload: Payload; rule: RuleRow; why: string }): Promise<{ request: RequestRow; done: boolean } | null> {
  const audits: Audit[] = [];
  const ruleSteps = stepsOfRule(input.rule);
  const state = await peoplePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`approval-decide:${requestId}`}))`;
    const r = await tx.approvalRequest.findFirst({ where: { id: requestId, orgId: actor.orgId } });
    if (!r || !['WAITING', 'MORE_INFO'].includes(r.status)) return 'NONE' as const;
    await tx.approvalStep.updateMany({ where: { requestId, status: { in: ['WAITING', 'MORE_INFO'] } }, data: { status: 'WITHDRAWN', comment: input.why.slice(0, 1000), decidedAt: new Date() } });
    const fresh = await tx.approvalRequest.update({ where: { id: requestId }, data: { sourceId: input.sourceId, payload: { ...input.payload, restartedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue, ruleId: input.rule.id, ruleVersion: input.rule.version, ruleVariant: input.rule.variantKey, status: 'WAITING', currentStep: 1 } });
    await writeChangeLog(tx, { ...actor, reason: input.why }, { kind: 'ApprovalRequest', id: requestId, employeeId: fresh.subjectEmployeeId }, [{ field: 'steps', before: 'WAITING', after: 'ASKED AGAIN', redacted: false }]);
    /* Approvals before the change do not count for the new steps. */
    return openStep(tx, { accountId: actor.accountId, orgId: actor.orgId }, { id: fresh.id, requestType: fresh.requestType, requesterUserId: fresh.requesterUserId, subjectEmployeeId: fresh.subjectEmployeeId, payload: fresh.payload, ruleSteps }, 1, audits);
  });
  if (state === 'NONE') return null;
  await writeAudits({ accountId: actor.accountId, orgId: actor.orgId }, requestId, audits);
  return finishSourced(actor, requestId, state === 'DONE', actor.userId);
}

/**
 * The module's record was decided or withdrawn outside the steps (cancelled by the person or HR, decided
 * through the public API, or by an older API during a rollback): its request closes to match, and the
 * steps still waiting say why. A request with no step waiting is the engine's own finish in progress
 * (the module's effect is running): left alone. Idempotent.
 */
export async function closeAtSource(actor: Actor, requestId: string, status: 'APPROVED' | 'REJECTED' | 'WITHDRAWN', why: string) {
  return peoplePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`approval-decide:${requestId}`}))`;
    const r = await tx.approvalRequest.findFirst({ where: { id: requestId, orgId: actor.orgId }, include });
    if (!r || !['WAITING', 'MORE_INFO'].includes(r.status) || !r.steps.some((s) => s.status === 'WAITING' || s.status === 'MORE_INFO')) return false;
    await tx.approvalStep.updateMany({ where: { requestId, status: { in: ['WAITING', 'MORE_INFO'] } }, data: { status: status === 'WITHDRAWN' ? 'WITHDRAWN' : 'SKIPPED', comment: why.slice(0, 1000), decidedAt: new Date() } });
    await tx.approvalRequest.update({ where: { id: requestId }, data: { status } });
    await writeChangeLog(tx, { ...actor, reason: why }, { kind: 'ApprovalRequest', id: requestId, employeeId: r.subjectEmployeeId }, [{ field: 'status', before: r.status, after: status, redacted: false }]);
    return true;
  });
}

/**
 * Move on the step waiting now, for a module's own record:
 *  - `to`: handed on in place to these people (a leave's manager step after the type's days). An empty
 *    `to` moves nothing: the step stays waiting (never closes the request on nobody's decision);
 *  - `approvedBy`: taken outside the engine by that person (an older API wrote the manager's step on the
 *    leave during a rollback): written APPROVED by them, and the next step opens;
 *  - neither: closed as HANDED_ON and the next step opens.
 * Inside the module's transaction. Answers whether it moved.
 */
export async function handOnStep(actor: Actor, requestId: string, input: { to?: string[]; approvedBy?: string | null; why: string }) {
  if (input.to && !input.to.length) return false;
  const audits: Audit[] = [];
  const state = await peoplePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`approval-decide:${requestId}`}))`;
    const r = await tx.approvalRequest.findFirst({ where: { id: requestId, orgId: actor.orgId }, include });
    if (!r || r.status !== 'WAITING') return 'NONE' as const;
    const waiting = r.steps.filter((s) => s.order === r.currentStep && s.status === 'WAITING');
    if (!waiting.length) return 'NONE' as const;
    const taken = input.approvedBy ? { status: 'APPROVED', decidedByUserId: input.approvedBy, approverUserId: input.approvedBy } : { status: 'HANDED_ON' };
    await tx.approvalStep.updateMany({ where: { id: { in: waiting.map((w) => w.id) }, status: 'WAITING' }, data: { ...taken, comment: input.why.slice(0, 1000), decidedAt: new Date() } });
    await writeChangeLog(tx, { ...actor, reason: input.why }, { kind: 'ApprovalRequest', id: requestId, employeeId: r.subjectEmployeeId }, [{ field: `step ${r.currentStep}`, before: 'WAITING', after: taken.status, redacted: false }]);
    if (input.to?.length) {
      const w = waiting[0];
      await tx.approvalStep.create({ data: { accountId: r.accountId, orgId: r.orgId, requestId, order: w.order, slot: w.slot, mode: w.mode, candidateUserIds: input.to, approverUserId: input.to[0], dueAt: w.dueAt, status: 'WAITING', comment: input.why.slice(0, 1000), resolvedHow: 'HANDED_ON' } });
      return 'OPENED' as const;
    }
    const ruleSteps = stepsOfRule(await tx.approvalRule.findUnique({ where: { id: r.ruleId } }));
    return openStep(tx, { accountId: actor.accountId, orgId: actor.orgId }, { id: r.id, requestType: r.requestType, requesterUserId: r.requesterUserId, subjectEmployeeId: r.subjectEmployeeId, payload: r.payload, ruleSteps }, r.currentStep + 1, audits);
  });
  await writeAudits({ accountId: actor.accountId, orgId: actor.orgId }, requestId, audits);
  /* Every later step closed on its own (self-approved when nobody else could, 5.6): finished as whoever approved last, never as "system". */
  if (state === 'DONE') {
    const last = await peoplePrisma.approvalStep.findFirst({ where: { requestId, status: 'APPROVED' }, orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }] });
    await approveFinal({ ...actor, userId: last?.decidedByUserId || actor.userId }, requestId);
  }
  return state !== 'NONE';
}

/** A waiting step's people worked out again (a module's own record: the deciders changed since it opened). Answers whether they changed. */
export async function reassignStep(actor: Actor, requestId: string, input: { stepId: string; candidates: string[]; how: string | null; comment: string | null; standInFor: string | null }) {
  if (!input.candidates.length) return false;
  return peoplePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`approval-decide:${requestId}`}))`;
    const r = await tx.approvalRequest.findFirst({ where: { id: requestId, orgId: actor.orgId }, include });
    if (!r || r.status !== 'WAITING') return false;
    const waiting = r.steps.filter((s) => s.order === r.currentStep && s.status === 'WAITING');
    /* Worked out for another step (one decided meanwhile opened the next): left alone, never given someone else's people. */
    if (waiting.length !== 1 || waiting[0].id !== input.stepId) return false;
    const before = (waiting[0].candidateUserIds as string[]) || [];
    if (before.length === input.candidates.length && before.every((u, i) => u === input.candidates[i])) return false;
    await tx.approvalStep.update({ where: { id: waiting[0].id }, data: { candidateUserIds: input.candidates, approverUserId: input.candidates[0], standInForUserId: input.standInFor, resolvedHow: input.how, comment: input.comment ? input.comment.slice(0, 1000) : null } });
    await writeChangeLog(tx, { ...actor, reason: 'Who decides changed since the step opened' }, { kind: 'ApprovalRequest', id: requestId, employeeId: r.subjectEmployeeId }, [{ field: `step ${r.currentStep} approvers`, before: before.join(', ') || null, after: input.candidates.join(', '), redacted: false }]);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Preview: who would decide each step, for one person, today (8.1)
// ---------------------------------------------------------------------------

export type PreviewStep = {
  order: number;
  outcome: 'DECIDES' | 'SKIPPED' | 'SELF_APPROVED' | 'REFUSED';
  why: string | null;
  mode: 'ANY' | 'ALL';
  dueAt: Date | null;
  slots: Array<{ people: string[]; how: string | null; standInFor: string | null; note: string | null }>;
};

/**
 * For a draft rule (or the rule the request would follow) and a sample — a
 * person, and an amount, days or whatever the conditions read — who would
 * decide each step if it were asked today, and why: stand-ins, away
 * hand-ups, the own-record rule and the maker-checker fall-through included.
 * Reads only; creates nothing. Earlier steps are taken as approved by their
 * first decider, as the request would go if each said yes.
 */
export async function previewRule(
  who: { accountId: string; orgId: string },
  input: { requestType: string; rule?: Pick<RuleSpecV2, 'steps' | 'autoApprove' | 'name'> | null; sample: { employeeId?: string | null; requesterUserId?: string | null; payload?: Record<string, unknown> | null } },
) {
  const subjectEmployeeId = input.sample.employeeId || null;
  const subject = subjectEmployeeId ? await peoplePrisma.employee.findFirst({ where: { id: subjectEmployeeId, orgId: who.orgId }, select: { id: true, userId: true, name: true } }) : null;
  if (subjectEmployeeId && !subject) throw new ApprovalError('That person is not in this company.', 400, 'NOT_FOUND');
  /* The person asks for themselves unless the sample says who asks (HR raising it for them). */
  const requesterUserId = input.sample.requesterUserId || subject?.userId || (subject ? `${PORTAL_PREFIX}${subject.id}` : null);
  if (!requesterUserId) throw new ApprovalError('Choose the person it is for, or who asks.', 400, 'RULE_INVALID');
  const payload = { ...(input.sample.payload || {}), ...(subjectEmployeeId ? { employeeId: subjectEmployeeId } : {}) } as Payload;
  const facts = await factsFor(who.orgId, subjectEmployeeId, payload);
  let ruleWords: { name: string; version: number | null; variantKey: string; draft: boolean } | null;
  let specs: StepV2[];
  let auto: AutoApprove[];
  if (input.rule) {
    ruleWords = { name: input.rule.name, version: null, variantKey: '', draft: true };
    specs = input.rule.steps;
    auto = input.rule.autoApprove || [];
  } else {
    const rule = await pickRule(who.orgId, input.requestType, facts);
    if (!rule) return { rule: null, autoApproved: false, steps: [] as PreviewStep[] };
    ruleWords = { name: rule.name, version: rule.version, variantKey: rule.variantKey, draft: false };
    specs = stepsOfRule(rule);
    auto = normaliseAutoApprove(rule.autoApprove);
  }
  /* A leave preset's auto-approval also needs the person's own request within the balance, which a sample cannot say: not shown as approved on its own. */
  const presetAuto = input.requestType === 'LEAVE' && !input.rule;
  if (!presetAuto && !MONEY_TYPES.has(input.requestType) && auto.some((a) => allHold(a.when, facts))) return { rule: ruleWords, autoApproved: true, steps: [] as PreviewStep[] };
  const request: Req = { requestType: input.requestType, requesterUserId, subjectEmployeeId, payload };
  const day = todayIst();
  const now = new Date();
  let approvedSoFar = false;
  const approvedBy = new Set<string | null>();
  const planned: Array<{ plan: StepPlan | null; error?: ApprovalError }> = [];
  for (let i = 0; i < specs.length; i += 1) {
    try {
      const plan = await planStep(who, specs, i, request, facts, { day, now, approvedBefore: async () => approvedSoFar, approvedBy: async () => approvedBy });
      planned.push({ plan });
      if (plan.kind === 'OPEN') { approvedSoFar = true; for (const s of plan.slots) approvedBy.add(s.approverUserId); }
      if (plan.kind === 'SELF') { approvedSoFar = true; approvedBy.add(requesterUserId); }
    } catch (e) {
      if (!(e instanceof ApprovalError)) throw e;
      planned.push({ plan: null, error: e });
      break;
    }
  }
  const names = await namesFor([requesterUserId, ...planned.flatMap((p) => (p.plan?.kind === 'OPEN' ? p.plan.slots.flatMap((s) => [...s.candidates, s.standInForUserId || '']) : []))], who.orgId);
  const steps: PreviewStep[] = planned.map(({ plan, error }, i) => {
    if (!plan) return { order: specs[i].order, outcome: 'REFUSED', why: error!.message, mode: specs[i].mode, dueAt: null, slots: [] };
    if (plan.kind === 'SKIPPED') return { order: plan.order, outcome: 'SKIPPED', why: plan.comment, mode: specs[i].mode, dueAt: null, slots: [] };
    if (plan.kind === 'SELF') return { order: plan.order, outcome: 'SELF_APPROVED', why: `${plan.comment}: approved by ${names.get(requesterUserId) || 'the person who asks'} at once`, mode: specs[i].mode, dueAt: now, slots: [] };
    return {
      order: plan.order, outcome: 'DECIDES', why: null, mode: plan.mode, dueAt: plan.dueAt,
      slots: plan.slots.map((s) => ({ people: s.candidates.map((u) => names.get(u) || 'someone'), how: s.how, standInFor: s.standInForUserId ? names.get(s.standInForUserId) || 'someone' : null, note: s.comment })),
    };
  });
  return { rule: ruleWords, autoApproved: false, steps };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function waitingFor(orgId: string, userId: string) {
  const steps = await peoplePrisma.approvalStep.findMany({ where: { orgId, status: 'WAITING' }, select: { requestId: true, candidateUserIds: true, dueAt: true } });
  const ids = steps.filter((s) => ((s.candidateUserIds as string[]) || []).includes(userId)).map((s) => s.requestId);
  if (!ids.length) return [];
  /* A module's own requests (leave) wait in that module's queue, which the inbox already lists. */
  const rows = await peoplePrisma.approvalRequest.findMany({ where: { orgId, id: { in: ids }, status: 'WAITING', sourceKind: null }, include });
  return rows.sort((a, b) => dueOf(a).getTime() - dueOf(b).getTime());
}
const dueOf = (r: RequestRow) => r.steps.find((s) => s.order === r.currentStep && s.status === 'WAITING')?.dueAt || r.createdAt;

export async function mine(orgId: string, userId: string, limit = 100) {
  return finishStalled(await peoplePrisma.approvalRequest.findMany({ where: { orgId, requesterUserId: userId, sourceKind: null }, include, orderBy: { createdAt: 'desc' }, take: limit }));
}

export async function requestsAbout(orgId: string, employeeId: string) {
  return finishStalled(await peoplePrisma.approvalRequest.findMany({ where: { orgId, subjectEmployeeId: employeeId, sourceKind: null }, include, orderBy: { createdAt: 'desc' } }));
}

/**
 * Names for the people on a request, for the screen. `portal:<employeeId>`
 * (asked from the employee app without a CLOR sign-in) is named from that
 * company's employee record (E15).
 */
export async function namesFor(userIds: string[], orgId?: string) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map<string, string>();
  const portal = ids.filter((u) => u.startsWith(PORTAL_PREFIX));
  const users = await platformPrisma.user.findMany({ where: { id: { in: ids.filter((u) => !u.startsWith(PORTAL_PREFIX)) } }, select: { id: true, fullName: true, email: true } });
  const out = new Map(users.map((u) => [u.id, u.fullName || u.email]));
  if (portal.length && orgId) {
    const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: portal.map((u) => u.slice(PORTAL_PREFIX.length)) } }, select: { id: true, name: true } });
    for (const p of people) out.set(`${PORTAL_PREFIX}${p.id}`, p.name);
  }
  return out;
}

export async function shape(r: RequestRow, names?: Map<string, string>) {
  const n = names || (await namesFor([r.requesterUserId, ...r.steps.flatMap((s) => [s.approverUserId, s.decidedByUserId, s.standInForUserId, ...((s.candidateUserIds as string[]) || [])].filter(Boolean) as string[])], r.orgId));
  const now = Date.now();
  return {
    id: r.id, requestType: r.requestType, title: r.title, status: r.status, currentStep: r.currentStep, subjectEmployeeId: r.subjectEmployeeId,
    requesterUserId: r.requesterUserId, requesterName: n.get(r.requesterUserId) || '', ruleVersion: r.ruleVersion, ruleVariant: r.ruleVariant, payload: r.payload, outcome: r.outcome, createdAt: r.createdAt,
    dueAt: dueOf(r), overdue: r.status === 'WAITING' && dueOf(r).getTime() < now,
    steps: r.steps.map((s) => ({
      id: s.id, order: s.order, status: s.status, dueAt: s.dueAt, comment: s.comment, decidedAt: s.decidedAt,
      candidates: ((s.candidateUserIds as string[]) || []).map((u) => n.get(u) || u),
      decidedBy: s.decidedByUserId ? n.get(s.decidedByUserId) || '' : '',
      standInFor: s.standInForUserId ? n.get(s.standInForUserId) || '' : '',
      remindedAt: s.remindedAt,
      /* ALL mode: which approver of the step this row is; how its deciders were found (stand-in, away, stepped in, self-approved). */
      slot: s.slot, mode: s.mode, how: s.resolvedHow,
    })),
  };
}

// ---------------------------------------------------------------------------
// Due times (APR-03)
// ---------------------------------------------------------------------------

/** A step left waiting on a "remind" rule is reminded again every this many working days. */
export const REMIND_EVERY_WORKING_DAYS = 3;

/**
 * Overdue steps: a reminder first; a day after that, handed on if the rule
 * says so; on a "remind" rule, reminded again every three working days while
 * it waits (remindedAt is the last reminder). Idempotent per step and run.
 * One step that fails is logged with its company and the rest go on.
 */
export async function runApprovalDues(now = new Date()) {
  /* Only steps of requests still waiting: an ALL step's other slots sit WAITING while the request is with the requester for more information. */
  const due = await outsideTenant('job: approval dues', () => peoplePrisma.approvalStep.findMany({ where: { status: 'WAITING', dueAt: { lt: now }, request: { status: 'WAITING' } }, include: { request: true } }));
  let reminded = 0;
  let handedOn = 0;
  let autoApproved = 0;
  let failed = 0;
  const remind = async (step: (typeof due)[number]) => {
    await peoplePrisma.approvalStep.update({ where: { id: step.id }, data: { remindedAt: now } });
    await notifyUsers(step.accountId, step.orgId, (step.candidateUserIds as string[]) || [], { kind: 'people.approval', title: `Overdue: ${step.request.title}`, body: `Was due ${step.dueAt.toISOString().slice(0, 10)}.`, link: { app: 'people', screen: 'approvals' } as any }, { subjectKey: `approval:${step.requestId}` });
    await emailUsers(step.accountId, step.orgId, (step.candidateUserIds as string[]) || [], 'people.approval_waiting', { headline: 'Overdue', title: step.request.title, dueLine: `It was due ${step.dueAt.toISOString().slice(0, 10)}.` }, step.requestId);
    reminded += 1;
  };
  for (const step of due) {
    try {
      await runInTenant(step.orgId, async () => {
        const rule = await peoplePrisma.approvalRule.findUnique({ where: { id: step.request.ruleId } });
        const specs = stepsOfRule(rule);
        /* A module's own request (leave): reminded and handed on in its own words, or not at all when it has no hook. */
        if (step.request.sourceKind) {
          const hook = sources.get(step.request.requestType)?.overdue;
          const done = hook ? await hook(step, specs.find((x) => x.order === step.order), now) : null;
          if (done === 'REMINDED') reminded += 1;
          if (done === 'HANDED_ON') handedOn += 1;
          return;
        }
        const spec = specs.find((s) => s.order === step.order);
        if (!step.remindedAt) return remind(step);
        const afterMs = (spec?.overdue?.afterHours ?? 24) * 3_600_000;
        if (spec?.overdue?.action === 'REMIND') {
          if (addWorkingDays(step.remindedAt, REMIND_EVERY_WORKING_DAYS).getTime() <= now.getTime()) await remind(step);
          return;
        }
        if (spec?.overdue?.action === 'HAND_ON' && spec.overdue.to && now.getTime() - step.remindedAt.getTime() >= afterMs) {
          const resolved = await resolveApprover({ accountId: step.accountId, orgId: step.orgId }, spec.overdue.to, step.request.subjectEmployeeId, istDay(now), step.request.requestType);
          const candidates = [...new Set([...resolved.primary, ...resolved.standIns.map((s) => s.user)])].filter((u) => u !== step.request.requesterUserId);
          if (!candidates.length) return;
          await peoplePrisma.$transaction(async (tx) => {
            const moved = await tx.approvalStep.updateMany({ where: { id: step.id, status: 'WAITING' }, data: { status: 'HANDED_ON', comment: 'Handed on: overdue', decidedAt: now } });
            if (!moved.count) return;
            await tx.approvalStep.create({ data: { accountId: step.accountId, orgId: step.orgId, requestId: step.requestId, order: step.order, slot: step.slot, mode: step.mode, candidateUserIds: candidates, approverUserId: candidates[0], dueAt: dueAtFrom(now, spec.due, addWorkingDays), status: 'WAITING', resolvedHow: 'HANDED_ON' } });
          });
          await notifyUsers(step.accountId, step.orgId, candidates, { kind: 'people.approval', title: `Handed on to you: ${step.request.title}`, link: { app: 'people', screen: 'approvals' } as any }, { subjectKey: `approval:${step.requestId}` });
          await emailUsers(step.accountId, step.orgId, candidates, 'people.approval_waiting', { headline: 'Handed on to you', title: step.request.title, dueLine: '' }, step.requestId);
          handedOn += 1;
          return;
        }
        /*
         * Approved on its own when late (5.5): never money, never the last step a
         * person still decides (refused when the rule is saved, and checked again
         * here: when every later step would be skipped, it is reminded instead).
         */
        if (spec?.overdue?.action === 'AUTO_APPROVE' && !MONEY_TYPES.has(step.request.requestType) && now.getTime() - step.remindedAt.getTime() >= afterMs) {
          const who = { accountId: step.accountId, orgId: step.orgId };
          const request = { id: step.requestId, requestType: step.request.requestType, requesterUserId: step.request.requesterUserId, subjectEmployeeId: step.request.subjectEmployeeId, payload: step.request.payload };
          const facts = await factsFor(step.orgId, request.subjectEmployeeId, request.payload);
          const at = specs.findIndex((s) => s.order === step.order);
          let personLater = false;
          for (let j = at + 1; !personLater && j < specs.length; j += 1) personLater = await stepHasDecider(who, specs[j], request, facts, todayIst());
          /* The type's own check holds for this too (the record changed since it was asked): then a person decides it. */
          let checked = true;
          try {
            await checks.get(step.request.requestType as RequestType)?.(await peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: step.requestId }, include }));
          } catch {
            checked = false;
          }
          if (!personLater || !checked) {
            if (addWorkingDays(step.remindedAt, REMIND_EVERY_WORKING_DAYS).getTime() <= now.getTime()) await remind(step);
            return;
          }
          const audits: Audit[] = [];
          const state = await peoplePrisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`approval-decide:${step.requestId}`}))`;
            /* Looked at again under the lock: asked for more information, withdrawn or decided meanwhile, it is left alone. */
            if ((await tx.approvalRequest.findUnique({ where: { id: step.requestId }, select: { status: true } }))?.status !== 'WAITING') return 'NONE' as const;
            const moved = await tx.approvalStep.updateMany({ where: { requestId: step.requestId, order: step.order, status: 'WAITING' }, data: { status: 'APPROVED', decidedAt: now, comment: 'Approved on its own: overdue', resolvedHow: 'AUTO_APPROVED' } });
            if (!moved.count) return 'NONE' as const;
            await writeChangeLog(tx, { accountId: step.accountId, orgId: step.orgId, userId: null, source: 'APPROVAL', correlationId: step.requestId, reason: 'Approved on its own: overdue' }, { kind: 'ApprovalRequest', id: step.requestId, employeeId: step.request.subjectEmployeeId }, [{ field: `step ${step.order}`, before: 'WAITING', after: 'APPROVED', redacted: false }]);
            return openStep(tx, who, { ...request, ruleSteps: specs }, step.order + 1, audits);
          });
          await writeAudits(who, step.requestId, audits);
          if (state === 'NONE') return;
          autoApproved += 1;
          const fresh = await peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: step.requestId }, include });
          /* A later step closed on its own after all (self-approved): finished as any half-done request is. */
          if (state === 'DONE') await finishStalled([fresh]);
          else await notifyStep(fresh);
        }
      });
    } catch (e) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`[people-approvals] dues: org ${step.orgId}, step ${step.id}:`, e instanceof Error ? e.message : e);
    }
  }
  const away = await runAwayHandUps(now);
  /* Requests approveFinal left half done (approved, never closed): finished here too, for those nobody opens again. */
  const half = await outsideTenant('job: approvals left unfinished', () => peoplePrisma.approvalRequest.findMany({ where: { status: 'WAITING', sourceKind: null, steps: { some: {}, none: { status: 'WAITING' } } }, include, take: 200 }));
  for (const r of half) await runInTenant(r.orgId, () => finishStalled([r]));
  return { due: due.length, reminded, handedOn, autoApproved, awayHandedUp: away.handedUp, failed: failed + away.failed };
}

/**
 * Away hand-up for steps already waiting (5.3 step 2): when everyone a step
 * waits on is on approved leave all of today with nobody standing in, it goes
 * to the next one up (their manager, then HR, then the owner) and says so on
 * the step. Runs inside the dues job's lease; a step handed up this way is
 * not handed up again, and the claim on WAITING makes a second run a no-op.
 * Only steps this engine opened (resolvedHow set) are looked at: a step left
 * waiting from before this release keeps its people (review of PR #93).
 */
async function runAwayHandUps(now: Date) {
  const day = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  let handedUp = 0;
  let failed = 0;
  /* Only companies with someone on leave all of today have anything to do. */
  const onLeave = await outsideTenant('job: approvers away today', () => peoplePrisma.leaveRequest.findMany({ where: { status: 'APPROVED', fromDate: { lte: day }, toDate: { gte: day }, halfDay: null, fromTime: null }, select: { orgId: true }, distinct: ['orgId'], take: 5000 }));
  if (!onLeave.length) return { handedUp, failed };
  const steps = await outsideTenant('job: steps waiting on someone away', () =>
    peoplePrisma.approvalStep.findMany({ where: { orgId: { in: onLeave.map((o) => o.orgId) }, status: 'WAITING', request: { status: 'WAITING', sourceKind: null }, AND: [{ resolvedHow: { not: null } }, { resolvedHow: { not: 'AWAY_HANDED_UP' } }] }, include: { request: true }, take: 2000 }),
  );
  for (const step of steps) {
    try {
      await runInTenant(step.orgId, async () => {
        const who = { accountId: step.accountId, orgId: step.orgId };
        const candidates = ((step.candidateUserIds as string[]) || []).filter((u) => !u.startsWith(PORTAL_PREFIX));
        if (!candidates.length) return;
        const away = await awayOn(step.orgId, candidates, day);
        if (away.size < candidates.length) return;
        const request = { requestType: step.request.requestType, requesterUserId: step.request.requesterUserId, subjectEmployeeId: step.request.subjectEmployeeId, payload: step.request.payload };
        const { excluded } = await excludedOf(step.orgId, request);
        const from = step.approverUserId && away.has(step.approverUserId) ? step.approverUserId : candidates[0];
        const up = (await upFrom(who, await employeeOfUser(step.orgId, from), new Set([...excluded, ...away]), day)).filter((u) => !excluded.has(u));
        if (!up.length) return;
        const names = await namesFor([from, ...up], step.orgId);
        const note = `Away: ${names.get(from) || 'someone'} on leave, sent to ${up.map((u) => names.get(u) || 'someone').join(', ')}`;
        const moved = await peoplePrisma.$transaction(async (tx) => {
          const claimed = await tx.approvalStep.updateMany({ where: { id: step.id, status: 'WAITING' }, data: { status: 'HANDED_ON', comment: note, decidedAt: now } });
          if (!claimed.count) return false;
          /* The due time stays: being away does not give the step more time. */
          await tx.approvalStep.create({ data: { accountId: step.accountId, orgId: step.orgId, requestId: step.requestId, order: step.order, slot: step.slot, mode: step.mode, candidateUserIds: up, approverUserId: up[0], dueAt: step.dueAt, status: 'WAITING', comment: note, resolvedHow: 'AWAY_HANDED_UP' } });
          return true;
        });
        if (!moved) return;
        handedUp += 1;
        await notifyUsers(step.accountId, step.orgId, up, { kind: 'people.approval', title: `Waiting for you: ${step.request.title}`, body: note, link: { app: 'people', screen: 'approvals' } as any }, { subjectKey: `approval:${step.requestId}` });
      });
    } catch (e) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`[people-approvals] away hand-up: org ${step.orgId}, step ${step.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return { handedUp, failed };
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
  registerJob('startApprovalDues', tick, intervalMs);
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

/**
 * A person's manager changed: their requests waiting on a manager step move
 * to the new manager (Organization research, rank 2: requests left with the
 * old manager). Only steps whose rule says "the manager" or "the manager's
 * manager" are re-resolved; a named person, a role or HR stays as it was.
 * The requester never becomes the decider. Logged on the request.
 */
export async function rerouteManagerSteps(actor: Actor, employeeId: string) {
  /* A module's own requests (leave) are re-resolved by the module, in its own words (leaveEngine.rerouteLeaveFor). */
  const open = await peoplePrisma.approvalRequest.findMany({ where: { orgId: actor.orgId, subjectEmployeeId: employeeId, status: 'WAITING', sourceKind: null }, include });
  let moved = 0;
  for (const request of open) {
    const step = request.steps.find((s) => s.order === request.currentStep && s.status === 'WAITING');
    if (!step) continue;
    const spec = stepsOfRule(await peoplePrisma.approvalRule.findUnique({ where: { id: request.ruleId } })).find((s) => s.order === step.order);
    /* One approver, the manager or theirs, in a step a person has not stepped into: re-resolved. ALL steps and groups keep their people. */
    if (!spec || spec.mode !== 'ANY' || spec.approvers.length !== 1 || (spec.approvers[0].kind !== 'MANAGER' && spec.approvers[0].kind !== 'MANAGER_OF_MANAGER')) continue;
    const { candidates } = await resolveOne({ accountId: request.accountId, orgId: request.orgId }, spec.approvers[0], request, todayIst());
    const before = (step.candidateUserIds as string[]) || [];
    if (!candidates.length || (candidates.length === before.length && candidates.every((c) => before.includes(c)))) continue;
    await peoplePrisma.$transaction(async (tx) => {
      await tx.approvalStep.update({ where: { id: step.id }, data: { candidateUserIds: candidates, approverUserId: candidates[0], standInForUserId: null } });
      await writeChangeLog(tx, { ...actor, reason: 'Manager changed' }, { kind: 'ApprovalRequest', id: request.id, employeeId }, [{ field: 'approver', before: before.join(', ') || null, after: candidates.join(', '), redacted: false }]);
    });
    await notifyStep(await peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id }, include }));
    moved += 1;
  }
  return moved;
}
