import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { usersHoldingRoles, usersWithPermission } from '../notifications.js';
import { resolveAccess } from '../access.js';
import { activeRule, addWorkingDays, conditionHolds, lastResortDeciders, type ApproverSpec, type StepSpec } from '../people/approvals/engine.js';
import { legacySteps } from '../people/approvals/spec.js';
import { activeManagerOf, CHAINS, type Chain } from './approvalChain.js';
import { deciderFor } from './standIns.js';
import { today } from './days.js';

/**
 * Leave through the company's approval rule (owner, 28 Oct 2026).
 *
 * The simple chains (HR, the manager, the manager then HR) stay as they are.
 * A company, or one leave type, may instead choose "the approval rule": the
 * LEAVE rule written in People → Settings → Approval Rules, with the same
 * steps every People request has — the manager, their manager, a named
 * person, anyone holding a role, or HR — each with an optional condition
 * (only when longer than 3 days, only for Sick leave), a due time, and what
 * happens when it is late.
 *
 * Leave keeps its own request, balance and calendar; it only borrows the
 * rule. A request remembers the rule version it was asked under (ruleId) and
 * which step waits now (ruleStep), and who may take that step (stepUserIds):
 * CLOR users, or `portal:<employeeId>` for a manager who decides in the
 * employee app. Who decides is worked out when a step opens, as the engine
 * does: the manager as of that day, or whoever stands in for them; someone
 * who has left or is suspended is no manager, and HR takes the step. Nobody
 * decides their own leave; HR entering leave for someone (most of a small
 * company's leave) may still take a step. A step only the person could take
 * is skipped when someone else decides another step, and otherwise goes to
 * the company's admins, so a request never approves itself.
 */

export const LEAVE_APPROVE = 'ATTENDANCE::Leave Requests::APPROVE';
export type LeaveChain = Chain | 'RULE';
export const LEAVE_CHAINS: LeaveChain[] = [...CHAINS, 'RULE'];

export const portalOf = (employeeId: string) => `portal:${employeeId}`;

/** What a new request of this type follows: the type's own choice, else the company's; HR when neither says. */
export async function configuredLeaveApproval(orgId: string, leaveTypeId: string | null | undefined): Promise<LeaveChain> {
  const t = leaveTypeId ? await peoplePrisma.leaveType.findFirst({ where: { id: leaveTypeId, orgId }, select: { approval: true } }) : null;
  if (t?.approval && (LEAVE_CHAINS as string[]).includes(t.approval)) return t.approval as LeaveChain;
  const s = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { leaveApproval: true } });
  return s?.leaveApproval && (LEAVE_CHAINS as string[]).includes(s.leaveApproval) ? (s.leaveApproval as LeaveChain) : 'HR';
}

/**
 * HR for leave: whoever approves leave for the whole company; a team lead's
 * scope is not HR. With nobody like that, nobody: a team-scoped approver
 * given HR's step would decide outside their team (a step bypasses team
 * scope), so the step goes the way any step nobody can take goes — skipped
 * when someone else decides another, else to the company's admins.
 */
async function leaveHr(accountId: string, orgId: string) {
  const users = await usersWithPermission(accountId, orgId, LEAVE_APPROVE);
  const whole: string[] = [];
  for (const u of users) if (!(await resolveAccess(accountId, orgId, u)).ownDocumentsOnly) whole.push(u);
  return whole;
}

/**
 * A manager and whoever stands in for them that day, as the ids they decide
 * with: their CLOR sign-in, else the employee app when it is on for them.
 * Someone who can sign in to neither could never decide, so they are left out
 * (and with nobody left, HR takes the step), as the engine passes over a
 * manager who cannot sign in.
 */
async function managerDeciders(orgId: string, managerId: string, day: string) {
  const ids = [...new Set([managerId, await deciderFor(orgId, managerId, day)])];
  const rows = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids }, status: { notIn: ['LEFT', 'SUSPENDED'] } }, select: { id: true, userId: true, portalEnabled: true } });
  return rows.map((e) => e.userId || (e.portalEnabled ? portalOf(e.id) : null)).filter(Boolean) as string[];
}

/** Who may take a step for this person's leave, before the person and the asker are taken out. */
export async function leaveStepDeciders(accountId: string, orgId: string, spec: ApproverSpec, employeeId: string, day = today()): Promise<string[]> {
  if (spec.kind === 'USER') return spec.id ? [spec.id] : [];
  if (spec.kind === 'ROLE') return spec.id ? usersHoldingRoles(accountId, orgId, [spec.id]) : [];
  if (spec.kind === 'HR') return leaveHr(accountId, orgId);
  let manager = await activeManagerOf(orgId, employeeId);
  if (spec.kind === 'MANAGER_OF_MANAGER' && manager) manager = await activeManagerOf(orgId, manager.id);
  /* No manager, one who has left or is suspended, or one who can sign in nowhere: HR takes the step. */
  if (!manager) return leaveHr(accountId, orgId);
  const managers = await managerDeciders(orgId, manager.id, day);
  return managers.length ? managers : leaveHr(accountId, orgId);
}

type Asked = { employeeId: string; requestedByUserId: string; leaveTypeId: string; days: number };

/** The ids that may never decide this leave: the person on it, as a user and in the app. Whoever entered it for them may. */
async function excludedFor(orgId: string, r: Asked) {
  const person = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { userId: true } });
  return [person?.userId, portalOf(r.employeeId)].filter(Boolean) as string[];
}

/** Who may take a step for this request, the person and the asker taken out (a hand-on resolves its new deciders this way). */
export async function deciders(accountId: string, orgId: string, spec: ApproverSpec, r: Asked, day = today()) {
  const excluded = await excludedFor(orgId, r);
  return (await leaveStepDeciders(accountId, orgId, spec, r.employeeId, day)).filter((u) => !excluded.includes(u));
}

export type StepOutcome =
  | { done: true; skipped: Array<{ order: number; why: string }> }
  | { done: false; order: number; users: string[]; dueAt: Date; lastResort: boolean; skipped: Array<{ order: number; why: string }> };

/**
 * The next step that applies from `from` on: its order and who decides it,
 * or done when no step is left. `decidedBefore`: an earlier step was taken
 * by somebody, so a step only the person could take may be skipped;
 * `approvedBy`: who approved the earlier steps.
 */
export async function nextLeaveStep(accountId: string, orgId: string, r: Asked, steps: StepSpec[], from: number, decidedBefore: boolean, day = today(), approvedBy: string[] = []): Promise<StepOutcome> {
  const payload = { days: r.days, leaveTypeId: r.leaveTypeId };
  const excluded = await excludedFor(orgId, r);
  const deciders = async (spec: StepSpec) => (await leaveStepDeciders(accountId, orgId, spec.approver, r.employeeId, day)).filter((u) => !excluded.includes(u));
  const skipped: Array<{ order: number; why: string }> = [];
  const ordered = [...steps].sort((a, b) => a.order - b.order);
  for (let i = 0; i < ordered.length; i += 1) {
    const spec = ordered[i];
    if (spec.order < from) continue;
    if (!conditionHolds(spec.condition, payload)) {
      skipped.push({ order: spec.order, why: 'its condition does not apply' });
      continue;
    }
    let users = await deciders(spec);
    /* Everyone this step names already approved an earlier one (HR standing in for a manager who cannot sign in, then for theirs): asking them again adds nothing. */
    if (users.length && users.every((u) => approvedBy.includes(u))) {
      skipped.push({ order: spec.order, why: 'the same people approved an earlier step' });
      continue;
    }
    let lastResort = false;
    if (!users.length) {
      let laterDecides = false;
      for (let j = i + 1; !decidedBefore && !laterDecides && j < ordered.length; j += 1) {
        if (conditionHolds(ordered[j].condition, payload) && (await deciders(ordered[j])).length) laterDecides = true;
      }
      if (decidedBefore || laterDecides) {
        skipped.push({ order: spec.order, why: 'nobody else could take it' });
        continue;
      }
      users = await lastResortDeciders(accountId, orgId, excluded);
      if (!users.length) {
        throw Object.assign(new Error('Nobody else can approve this leave. Give someone the right to approve leave, or change the leave approval rule.'), { status: 409, code: 'NO_APPROVER' });
      }
      lastResort = true;
    }
    return { done: false, order: spec.order, users, dueAt: addWorkingDays(new Date(), spec.dueDays), lastResort, skipped };
  }
  return { done: true, skipped };
}

/** The company's leave rule, as it is now; null when there is none (the request then goes to HR). */
export async function activeLeaveRule(orgId: string) {
  /* Read in the first step shape this walker knows: a leave rule saved as version 2 says nothing it cannot (cleanRule refuses the rest for LEAVE). */
  const rule = await activeRule(orgId, 'LEAVE');
  return rule ? { ...rule, steps: legacySteps(rule.steps) as unknown as typeof rule.steps } : null;
}

/** The steps of the rule version a request was asked under. */
export async function stepsOf(ruleId: string): Promise<StepSpec[]> {
  const rule = await peoplePrisma.approvalRule.findUnique({ where: { id: ruleId }, select: { steps: true } });
  return legacySteps(rule?.steps);
}

/** "Step 2 skipped: its condition does not apply." lines for a request's history. */
export const skippedLines = (skipped: Array<{ order: number; why: string }>) => skipped.map((s) => ({ what: 'STEP_SKIPPED', note: `Step ${s.order} skipped: ${s.why}.` }));

/** Is this id one of the people who may take the step waiting now? */
export const takesStep = (r: { ruleId?: string | null; ruleStep?: number | null; stepUserIds?: string[] | null; status?: string }, ids: Array<string | null | undefined>) =>
  Boolean(r.ruleId && r.ruleStep && r.status === 'PENDING' && (r.stepUserIds || []).some((u) => ids.includes(u)));
