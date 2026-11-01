import { peoplePrisma, peopleWrite } from '../../utils/peoplePrisma.js';
import { usersWithPermission } from '../notifications.js';
import { resolveAccess } from '../access.js';
import type { Actor } from '../people/changeLog.js';
import {
  ApprovalError, activeRule, closeAtSource, decide, handOnStep, lastResortDeciders, namesFor, onApproved, onClosed, onSource, openSourced, ownerDeciders, reassignStep, restartSourced, stepsOfRule,
  type Req, type RequestType, type Resolution,
} from '../people/approvals/engine.js';
import { PRESET_OF_CHAIN, presetRule, type LeaveChainKey, type PresetKey } from '../people/approvals/presets.js';
import { activeManagerOf, chainFor } from './approvalChain.js';
import { configuredLeaveApproval, LEAVE_APPROVE, leaveStepDeciders, portalOf } from './leaveRules.js';
import { deciderFor } from './standIns.js';
import { fail } from './days.js';

/**
 * Leave on the approval engine (docs/people/workflow-engine/SPEC.md section 9, phase 2c-i).
 *
 * Behind one switch per company (PeopleSetting.leaveOnEngine), off by default. With it on, a new leave
 * request on a simple chain (HR, the manager, the manager then HR) opens an engine request
 * (`sourceKind` LEAVE, `sourceId` the leave's first part) under the preset the chain stands for
 * (presets.ts). The engine then says who decides, in what order, and records each step; the leave keeps
 * its own row, status, balance, days and notices, exactly as before:
 *
 *  - who decides is worked out in leave's own words (resolve below), so the same people decide as on
 *    the chain: HR is whoever approves leave for this person, the manager decides in CLOR or in the
 *    employee app, a stand-in is added for the day, and the person on leave never decides it;
 *  - approving the last step approves the leave (decideLeave), rejecting rejects it, in one
 *    transaction with the step: a refusal (a closed month, Payroll has the days, no balance) undoes
 *    the step too and answers as before;
 *  - the manager's step under "the manager, then HR" is still written on the leave row
 *    (managerApprovedAt), so leave's notices read the same and an older API that reads the row after
 *    a rollback hands it to HR, as it would have;
 *  - a leave decided or withdrawn anywhere else (cancelled, the public API, an older API) closes its
 *    engine request to match (syncLeaveDecision, from every announcement).
 *
 * Requests already waiting when the switch goes on finish on the old path (the chain, or the leave rule's
 * own walker in leaveRules.ts). Since phase 2c-ii a type on the company's leave rule (RULE) runs on the
 * engine too, the rule read in its walker's words; the type's own auto-approval is the engine's
 * AUTO_APPROVED step; reminders and the rule's hand-on come from the engine's dues job; the switch is a
 * company choice (Company choices, owner or admin).
 */

export const LEAVE_SOURCE = 'LEAVE';
const INACTIVE = new Set(['LEFT', 'SUSPENDED']);

/** Is this company's new leave decided by the engine? */
export async function leaveOnEngine(orgId: string) {
  return Boolean((await peoplePrisma.peopleSetting.findUnique({ where: { orgId }, select: { leaveOnEngine: true } }))?.leaveOnEngine);
}

const stepOrder = { steps: { orderBy: [{ order: 'asc' as const }, { createdAt: 'asc' as const }, { slot: 'asc' as const }, { id: 'asc' as const }] } };

/** The engine request a leave belongs to, through any of its parts; null when it has none (the old path). */
export async function engineRequestOf(orgId: string, row: { id: string; groupId?: string | null }) {
  const ids = row.groupId ? (await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: row.groupId }, select: { id: true } })).map((x) => x.id) : [];
  if (!ids.includes(row.id)) ids.push(row.id);
  return peoplePrisma.approvalRequest.findFirst({ where: { orgId, sourceKind: LEAVE_SOURCE, sourceId: { in: ids } }, include: stepOrder, orderBy: { createdAt: 'desc' } });
}
type EngineRequest = NonNullable<Awaited<ReturnType<typeof engineRequestOf>>>;

/**
 * Still the engine's to decide: its request waits with a step open. One an older API closed during a
 * rollback (it approves an engine request without touching the leave) is not: the leave then goes on
 * the old path, so it is never stuck.
 */
export const onEngine = (r: EngineRequest | null): r is EngineRequest => Boolean(r && r.status === 'WAITING' && r.steps.some((s) => s.status === 'WAITING'));
const waitingSteps = (r: EngineRequest) => r.steps.filter((s) => s.order === r.currentStep && s.status === 'WAITING');
const candidatesOf = (r: EngineRequest) => [...new Set(waitingSteps(r).flatMap((s) => (s.candidateUserIds as string[]) || []))];
const presetOf = (r: { payload: unknown }) => String((r.payload as { preset?: unknown })?.preset || '') as PresetKey | 'RULE' | '';

// ---------------------------------------------------------------------------
// Who decides, in leave's words
// ---------------------------------------------------------------------------

/** Whoever approves leave for this person: company-wide leave approvers, and team-scoped ones whose team holds them (the chain's deciders). */
export async function inScopeApprovers(accountId: string, orgId: string, employeeId: string): Promise<string[]> {
  const { approversOf } = await import('../../routes/leave.js');
  return approversOf(accountId, orgId, employeeId);
}

/** Leave approvers for the whole company: HR's step after the manager (a team lead's scope is not HR). */
async function wholeCompanyApprovers(accountId: string, orgId: string) {
  const out: string[] = [];
  for (const u of await usersWithPermission(accountId, orgId, LEAVE_APPROVE)) if (!(await resolveAccess(accountId, orgId, u)).ownDocumentsOnly) out.push(u);
  return out;
}

/**
 * The id an employee decides leave with as a manager or stand-in, as the chain lets them: their CLOR
 * sign-in when they may approve leave there or decide in the employee app (where a manager with a
 * sign-in decides as that user), else the employee app's `portal:<id>`. Someone who can do neither,
 * or has left or is suspended, decides nothing.
 */
function deciderIdOf(e: { id: string; userId: string | null; portalEnabled: boolean; status: string } | null | undefined, approvers: string[]) {
  if (!e || INACTIVE.has(e.status)) return null;
  if (e.userId && (e.portalEnabled || approvers.includes(e.userId))) return e.userId;
  if (e.portalEnabled) return portalOf(e.id);
  return null;
}

/** On approved leave for the whole of `day` (not a half day, not hours). */
async function awayEmployees(orgId: string, employeeIds: string[], day: string) {
  if (!employeeIds.length) return new Set<string>();
  const rows = await peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId: { in: employeeIds }, status: 'APPROVED', fromDate: { lte: day }, toDate: { gte: day }, halfDay: null, fromTime: null }, select: { employeeId: true } });
  return new Set(rows.map((r) => r.employeeId));
}
async function awayUsers(orgId: string, userIds: string[], day: string) {
  const people = await peoplePrisma.employee.findMany({ where: { orgId, userId: { in: userIds.filter((u) => !u.startsWith('portal:')) }, status: { not: 'LEFT' } }, select: { id: true, userId: true } });
  const away = await awayEmployees(orgId, people.map((p) => p.id), day);
  return new Set(people.filter((p) => away.has(p.id)).map((p) => p.userId as string));
}

/** Both ids a person may decide with (their sign-in and the employee app), for "never the same person twice". */
async function bothIds(orgId: string, ids: string[]) {
  const out = new Set(ids.filter(Boolean));
  const portal = ids.filter((u) => u.startsWith('portal:')).map((u) => u.slice(7));
  const users = ids.filter((u) => u && !u.startsWith('portal:'));
  if (!portal.length && !users.length) return out;
  const people = await peoplePrisma.employee.findMany({ where: { orgId, OR: [{ id: { in: portal } }, { userId: { in: users } }] }, select: { id: true, userId: true } });
  for (const p of people) {
    out.add(portalOf(p.id));
    if (p.userId) out.add(p.userId);
  }
  return out;
}

/** The person on leave never decides it, as a user or in the employee app. Whoever entered it for them may (as on the chain). */
async function subjectIds(orgId: string, employeeId: string | null) {
  if (!employeeId) return new Set<string>();
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { userId: true } });
  return new Set([portalOf(employeeId), ...(e?.userId ? [e.userId] : [])]);
}

/**
 * Away (SPEC 5.3 step 2), in leave's words: the manager's own manager who could decide leave and is not
 * away (and their stand-in), else company-wide leave approvers who are not away, else the owner.
 */
async function upFromManager(accountId: string, orgId: string, managerId: string, employeeId: string, excluded: Set<string>, approvers: string[], day: string) {
  const above = await activeManagerOf(orgId, managerId);
  if (above && above.id !== employeeId && !(await awayEmployees(orgId, [above.id], day)).has(above.id)) {
    const standIn = await deciderFor(orgId, above.id, day, 'LEAVE');
    const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set([above.id, standIn])] } }, select: { id: true, userId: true, portalEnabled: true, status: true } });
    const ids = [...new Set(people.map((p) => deciderIdOf(p, approvers)).filter((u): u is string => Boolean(u) && !excluded.has(u as string)))];
    if (ids.length) return ids;
  }
  for (const group of [await wholeCompanyApprovers(accountId, orgId), await ownerDeciders(accountId, orgId)]) {
    const free = group.filter((u) => !excluded.has(u));
    const away = await awayUsers(orgId, free, day);
    const left = free.filter((u) => !away.has(u));
    if (left.length) return left;
  }
  return [];
}

/**
 * Who decides for one approver of a leave step, as of `day` (SPEC 5.4, in leave's words).
 *
 * The chains' presets:
 *  - HR: whoever approves leave for this person (company-wide, or a team scope holding them). Under
 *    "the manager, then HR" with a manager, company-wide only, and never whoever took the manager's step.
 *  - MANAGER: the person's manager, and their stand-in that day. No manager (or one who left or is
 *    suspended): under "the manager" HR decides; otherwise the other approver or step does. A manager
 *    away all day with no stand-in is sent up (their manager, then HR, then the owner) where the
 *    manager alone decides; beside HR ("HR or the manager") they stay, since HR is there anyway.
 * The company's leave rule (preset RULE, phase 2c-ii): every kind as the rule's own walker reads it
 * (leaveRules.leaveStepDeciders), and a step whose people all approved an earlier one is not asked again.
 */
async function resolveLeave(who: { accountId: string; orgId: string }, approver: { kind: string; id?: string }, request: Req, day: string, approvedBy: () => Promise<Set<string | null>>): Promise<Resolution> {
  const { accountId, orgId } = who;
  const preset = presetOf({ payload: request.payload });
  const employeeId = request.subjectEmployeeId as string;
  const excluded = await subjectIds(orgId, employeeId);
  const notes: string[] = [];
  let found: string[] = [];
  let standIns: Array<{ for: string; user: string }> = [];
  let how: string | null = approver.kind;
  if (preset === 'RULE') {
    found = await leaveStepDeciders(accountId, orgId, approver as Parameters<typeof leaveStepDeciders>[2], employeeId, day);
    const earlier = [...(await approvedBy())].filter((u): u is string => Boolean(u));
    if (found.length && earlier.length) {
      const same = await bothIds(orgId, earlier);
      if (found.every((u) => same.has(u))) {
        found = [];
        notes.push('The same people approved an earlier step');
      }
    }
    const all = [...new Set(found)];
    return { primary: all, standIns, all, candidates: all.filter((u) => !excluded.has(u)), how, notes };
  }
  const manager = employeeId ? await activeManagerOf(orgId, employeeId) : null;
  if (approver.kind === 'HR') {
    found = preset === 'MANAGER_THEN_HR' && manager ? await wholeCompanyApprovers(accountId, orgId) : await inScopeApprovers(accountId, orgId, employeeId);
    const earlier = [...(await approvedBy())].filter((u): u is string => Boolean(u));
    if (earlier.length) {
      const same = await bothIds(orgId, earlier);
      found = found.filter((u) => !same.has(u));
    }
  } else if (approver.kind === 'MANAGER') {
    if (!manager) {
      if (preset === 'MANAGER') {
        found = await inScopeApprovers(accountId, orgId, employeeId);
        how = 'HR';
      }
    } else {
      const approvers = await usersWithPermission(accountId, orgId, LEAVE_APPROVE);
      const standInId = await deciderFor(orgId, manager.id, day, 'LEAVE');
      const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set([manager.id, standInId])] } }, select: { id: true, userId: true, portalEnabled: true, status: true } });
      const own = deciderIdOf(people.find((p) => p.id === manager.id), approvers);
      const sub = standInId !== manager.id ? deciderIdOf(people.find((p) => p.id === standInId), approvers) : null;
      if (sub) {
        found = [own, sub].filter((u): u is string => Boolean(u));
        standIns = [{ for: own || portalOf(manager.id), user: sub }];
        how = 'STAND_IN';
      } else if (preset !== 'HR_OR_MANAGER' && (await awayEmployees(orgId, [manager.id], day)).has(manager.id)) {
        found = await upFromManager(accountId, orgId, manager.id, employeeId, excluded, approvers, day);
        const names = await namesFor(found, orgId);
        notes.push(found.length ? `Away: ${manager.name} on leave, sent to ${found.map((u) => names.get(u) || 'someone').join(', ')}` : `Away: ${manager.name} on leave, nobody above to send it to`);
        how = 'AWAY_HANDED_UP';
      } else if (own) {
        found = [own];
      }
    }
  } else {
    /* Not a preset's kind: leave's rule words, as its own walker reads them. */
    found = await leaveStepDeciders(accountId, orgId, approver as Parameters<typeof leaveStepDeciders>[2], employeeId, day);
  }
  const all = [...new Set(found)];
  const candidates = all.filter((u) => !excluded.has(u));
  return { primary: all, standIns, all, candidates, how, notes };
}

onSource(LEAVE_SOURCE, {
  resolve: resolveLeave,
  /* "HR can still step in" (the manager preset): whoever approves leave for this person, never the person themselves. */
  stepIn: async (who, group, request) => {
    const excluded = await subjectIds(who.orgId, request.subjectEmployeeId);
    const people = group === 'HR' ? await inScopeApprovers(who.accountId, who.orgId, String(request.subjectEmployeeId)) : await ownerDeciders(who.accountId, who.orgId);
    return people.filter((u) => !excluded.has(u));
  },
  overdue: (step, spec, now) => leaveOverdue(step, spec, now),
});

// ---------------------------------------------------------------------------
// What approval and rejection do: the leave's own decision, in the same transaction
// ---------------------------------------------------------------------------

/** The leave's first part, as it is now. */
async function leadOf(r: { orgId: string; sourceId: string | null }) {
  return r.sourceId ? peoplePrisma.leaveRequest.findFirst({ where: { id: r.sourceId, orgId: r.orgId } }) : null;
}

onApproved(LEAVE_SOURCE as RequestType, async ({ request, actor }) => {
  const { approvable, decideLeave, withHistory } = await import('../../routes/leave.js');
  const lead = await leadOf(request);
  if (!lead || lead.status !== 'PENDING') throw fail(409, 'This request is no longer pending.');
  /* Every part checked before any is written (a closed month, Payroll has the days, a clock-in): all of the leave is approved, or none. */
  const parts = lead.groupId ? await peoplePrisma.leaveRequest.findMany({ where: { orgId: request.orgId, groupId: lead.groupId, status: 'PENDING' } }) : [lead];
  for (const part of parts) await approvable(request.accountId, request.orgId, part, { chain: false });
  /*
   * "The manager, then HR" where the only one who could take HR's step is the manager who took the first (a small
   * business whose owner is manager and HR): HR's step is skipped so it never waits on nobody (owner, PR #102
   * review, item 5), and the leave's own history says so.
   */
  if (presetOf(request) === 'MANAGER_THEN_HR' && request.steps.some((s) => s.order === 2 && s.status === 'SKIPPED') && request.steps.some((s) => s.order === 1 && s.status === 'APPROVED' && s.decidedByUserId)) {
    for (const part of parts) await peoplePrisma.leaveRequest.update({ where: { id: part.id }, data: { history: withHistory(part, { by: 'system', what: 'STEP_SKIPPED', note: 'HR step skipped: nobody else can approve' }) as any } });
  }
  const people = request.steps.filter((s) => s.status === 'APPROVED' && s.decidedByUserId).sort((a, b) => (b.decidedAt?.getTime() || 0) - (a.decidedAt?.getTime() || 0));
  /* Nobody approved it in person: the type's own auto-approval, or a leave rule none of whose steps applies. Approved by the rule, as before. */
  if (!people.length) {
    const auto = request.steps.find((s) => s.resolvedHow === 'AUTO_APPROVED');
    await decideLeave(request.accountId, request.orgId, lead, 'system', auto ? auto.comment || 'Approved by the leave rule' : 'No step of the leave approval rule applies', true, { chain: false, auto: true });
    return { leaveRequestId: lead.id };
  }
  const last = people[0];
  const by = actor.userId || last.decidedByUserId || 'system';
  /* What the approver wrote; a step the engine closed itself says nothing on the leave. */
  const note = last.decidedByUserId === by && !last.resolvedHow?.startsWith('SELF') ? last.comment : null;
  await decideLeave(request.accountId, request.orgId, lead, by, note, true, { chain: false });
  return { leaveRequestId: lead.id };
});

onClosed(LEAVE_SOURCE as RequestType, async (request, status, note) => {
  if (status !== 'REJECTED') return;
  const { decideLeave } = await import('../../routes/leave.js');
  const lead = await leadOf(request);
  if (!lead || lead.status !== 'PENDING') throw fail(409, 'This request is no longer pending.');
  const by = request.steps.filter((s) => s.status === 'REJECTED' && s.decidedByUserId).sort((a, b) => (b.decidedAt?.getTime() || 0) - (a.decidedAt?.getTime() || 0))[0]?.decidedByUserId || 'system';
  await decideLeave(request.accountId, request.orgId, lead, by, note, false);
});

// ---------------------------------------------------------------------------
// Opening, deciding, changing
// ---------------------------------------------------------------------------

/** A chain the engine runs: the three presets, and the company's leave rule (RULE, phase 2c-ii). */
type EngineChain = LeaveChainKey | 'RULE';
const isEngineChain = (c: string): c is EngineChain => c === 'HR' || c === 'MANAGER' || c === 'MANAGER_THEN_HR' || c === 'RULE';

const actorFor = (accountId: string, orgId: string, userId: string | null, correlationId: string): Actor => ({ accountId, orgId, userId, source: 'FORM', correlationId });

/** Does a new leave of this type go on the engine (the company's switch is on, and the type's chain is one the engine runs)? */
export async function goesOnEngine(orgId: string, leaveTypeId: string) {
  if (!(await leaveOnEngine(orgId))) return false;
  return isEngineChain(await configuredLeaveApproval(orgId, leaveTypeId));
}

/** A refusal of the leave's own (a clock-in that day, a closed month, Payroll has the days, the balance): not the engine's, never a programming error. */
const leaveRefusal = (e: unknown) => Boolean(e && typeof e === 'object' && typeof (e as { status?: unknown }).status === 'number' && !(e instanceof ApprovalError));

/**
 * A new leave (all its parts, still waiting, not on the leave rule's own walker): its engine request opens
 * under the preset of the type's chain, or the company's leave rule, inside createLeave's transaction.
 * `autoApproved`: the type approves it on its own (LeaveType.autoApproveUpToDays, worked out by createLeave as
 * before: the person's own request, within the balance): the rule's AUTO_APPROVED step, nobody asked. When
 * nobody but the person could decide it, it is approved at once and written SELF_APPROVED (SPEC 5.6); under
 * STRICT maker-checker it is refused (409 NO_APPROVER) and nothing is saved. When the leave itself refuses
 * an approval at once (a clock-in that day), it waits as the old path left it, and its history says why.
 * Answers the rows as they are now.
 */
export async function openLeaveOnEngine<T extends { id: string; status: string; ruleId?: string | null }>(accountId: string, orgId: string, rows: T[], opts: { autoApproved?: string | null } = {}): Promise<T[]> {
  const waiting = rows.filter((r) => r.status === 'PENDING' && !r.ruleId) as unknown as Array<{ id: string; employeeId: string; leaveTypeId: string; fromDate: string; toDate: string; days: number; groupId: string | null; requestedByUserId: string }>;
  if (!waiting.length || waiting.length !== rows.filter((r) => r.status === 'PENDING').length || !(await leaveOnEngine(orgId))) return rows;
  const lead = [...waiting].sort((a, b) => a.fromDate.localeCompare(b.fromDate))[0];
  const chain = await configuredLeaveApproval(orgId, lead.leaveTypeId);
  if (!isEngineChain(chain)) return rows;
  const reread = async () => (await peoplePrisma.leaveRequest.findMany({ where: { orgId, id: { in: rows.map((r) => r.id) } } })).sort((a, b) => rows.findIndex((r) => r.id === a.id) - rows.findIndex((r) => r.id === b.id)) as unknown as T[];
  try {
    await openFor(accountId, orgId, lead, waiting, chain, null, opts.autoApproved ?? null);
  } catch (e) {
    const opened = await peoplePrisma.approvalRequest.findFirst({ where: { orgId, sourceKind: LEAVE_SOURCE, sourceId: lead.id }, select: { id: true } });
    /* Only the leave's own refusal is turned into "it waits"; the engine's (STRICT) and anything unexpected refuse the request. */
    if (!leaveRefusal(e) || !opened) throw e;
    const { withHistory } = await import('../../routes/leave.js');
    await peoplePrisma.decisionRecord.deleteMany({ where: { orgId, requestId: opened.id } });
    await peoplePrisma.approvalRequest.delete({ where: { id: opened.id } });
    const why = e instanceof Error ? e.message : 'it could not be applied';
    for (const r of waiting) {
      const row = await peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id: r.id } });
      await peoplePrisma.leaveRequest.update({ where: { id: r.id }, data: { history: withHistory(row, { by: 'system', what: 'RULE_SKIPPED', note: opts.autoApproved ? `Not approved by the leave rule: ${why}` : `Not approved at once: ${why}` }) as any } });
    }
    /* The type's own approval refused: it is asked of a person, as before. */
    if (opts.autoApproved) return openLeaveOnEngine(accountId, orgId, await reread(), {});
  }
  return reread();
}

async function payloadFor(orgId: string, lead: { employeeId: string; leaveTypeId: string; groupId: string | null; requestedByUserId: string }, parts: Array<{ id: string; days: number; fromDate: string; toDate: string }>, chain: EngineChain) {
  const days = Math.round(parts.reduce((a, x) => a + Number(x.days || 0), 0) * 100) / 100;
  const from = parts.reduce((a, x) => (x.fromDate < a ? x.fromDate : a), parts[0].fromDate);
  const to = parts.reduce((a, x) => (x.toDate > a ? x.toDate : a), parts[0].toDate);
  return { employeeId: lead.employeeId, preset: chain === 'RULE' ? 'RULE' : PRESET_OF_CHAIN[chain], chain, leaveTypeId: lead.leaveTypeId, days, fromDate: from, toDate: to, leaveIds: parts.map((x) => x.id), groupId: lead.groupId, enteredByUserId: lead.requestedByUserId };
}

/** The rule a chain stands for: its preset, or the company's leave rule (with none set up, the company's own chain, as the walker falls back). */
async function ruleFor(accountId: string, orgId: string, chain: EngineChain) {
  if (chain !== 'RULE') return { rule: await presetRule({ accountId, orgId }, chain), chain };
  const main = await activeRule(orgId, 'LEAVE');
  if (main) return { rule: main, chain };
  const company = await chainFor(orgId, 'leave');
  const key = (company === 'MANAGER' || company === 'MANAGER_THEN_HR' ? company : 'HR') as LeaveChainKey;
  return { rule: await presetRule({ accountId, orgId }, key), chain: key as EngineChain };
}

async function openFor(accountId: string, orgId: string, lead: { id: string; employeeId: string; leaveTypeId: string; fromDate: string; toDate: string; groupId: string | null; requestedByUserId: string }, parts: Array<{ id: string; days: number; fromDate: string; toDate: string }>, asked: EngineChain, restartOf: string | null, autoApproved: string | null = null) {
  const { rule, chain } = await ruleFor(accountId, orgId, asked);
  const payload = await payloadFor(orgId, lead, parts, chain);
  const person = await peoplePrisma.employee.findFirst({ where: { id: lead.employeeId, orgId }, select: { userId: true, name: true } });
  const actor = actorFor(accountId, orgId, lead.requestedByUserId, lead.id);
  if (restartOf) return restartSourced(actor, restartOf, { sourceId: lead.id, payload, rule, why: 'Changed while it waited: asked again' });
  return openSourced(actor, {
    requestType: LEAVE_SOURCE, sourceKind: LEAVE_SOURCE, sourceId: lead.id, subjectEmployeeId: lead.employeeId,
    /* The person on leave is who it is for, whoever entered it: they never decide it, and HR who entered it still may (as on the chain). */
    requesterUserId: person?.userId || portalOf(lead.employeeId),
    title: `${person?.name || 'Leave'}: leave, ${payload.fromDate === payload.toDate ? payload.fromDate : `${payload.fromDate} to ${payload.toDate}`}`,
    payload, rule, autoApproved,
  });
}

/**
 * A waiting leave changed (its dates, half or type: editLeave): its engine request starts again from
 * the first step, as the chain asks again; moved onto the leave rule's walker, it closes. `engine` is the
 * request found before the parts were rewritten.
 */
export async function restartLeaveOnEngine(accountId: string, orgId: string, engine: EngineRequest | null, rows: Array<{ id: string; status: string; ruleId: string | null; employeeId: string; leaveTypeId: string; fromDate: string; toDate: string; days: number; groupId: string | null; requestedByUserId: string }>, by: string) {
  if (!onEngine(engine)) return;
  const waiting = rows.filter((r) => r.status === 'PENDING');
  const chain = waiting.length ? await configuredLeaveApproval(orgId, waiting[0].leaveTypeId) : 'RULE';
  if (!waiting.length || waiting.some((r) => r.ruleId) || !isEngineChain(chain)) {
    await closeAtSource(actorFor(accountId, orgId, by, engine.id), engine.id, 'WITHDRAWN', 'Changed onto the leave approval rule');
    return;
  }
  const lead = [...waiting].sort((a, b) => a.fromDate.localeCompare(b.fromDate))[0];
  await openFor(accountId, orgId, lead, waiting, chain, engine.id);
}

/**
 * A leave decided or withdrawn outside the engine's steps (cancelled by the person or HR, the public
 * API, an older API): its engine request closes to match. Called from every announcement of a leave
 * that is no longer waiting; nothing to do for one the engine is finishing itself.
 */
export async function syncLeaveDecision(orgId: string, row: { id: string; status: string; reviewedByUserId?: string | null; employeeId: string; accountId: string }) {
  if (row.status === 'PENDING') return;
  const r = await peoplePrisma.approvalRequest.findFirst({ where: { orgId, sourceKind: LEAVE_SOURCE, sourceId: row.id, status: { in: ['WAITING', 'MORE_INFO'] } }, select: { id: true } });
  if (!r) return;
  const by = row.reviewedByUserId || null;
  const name = by ? (await namesFor([by], orgId)).get(by) || 'someone' : 'someone';
  const own = by === portalOf(row.employeeId) || (by && (await subjectIds(orgId, row.employeeId)).has(by));
  const status = row.status === 'APPROVED' ? 'APPROVED' : row.status === 'REJECTED' ? 'REJECTED' : 'WITHDRAWN';
  const why = status === 'WITHDRAWN' ? (own ? 'Withdrawn by the person' : `Cancelled by ${name}`) : `${status === 'APPROVED' ? 'Approved' : 'Rejected'} by ${name}, outside the steps`;
  await closeAtSource(actorFor(row.accountId, orgId, by, row.id), r.id, status, why);
}

/**
 * The type's hand-on (LeaveType.handOnAfterDays): under "the manager, then HR" the manager's step closes and HR's
 * opens; under "the manager", whoever approves leave for the person takes the step, else the admins. Answers
 * whether it moved: with nobody to take it, the step stays where it is, and the caller writes nothing on the leave.
 */
export async function handOnLeaveOnEngine(orgId: string, row: { id: string; groupId: string | null; accountId: string; employeeId: string }, why: string) {
  const engine = await engineRequestOf(orgId, row);
  if (!onEngine(engine)) return false;
  const actor = actorFor(row.accountId, orgId, null, engine.id);
  if (presetOf(engine) === 'MANAGER') {
    const excluded = await subjectIds(orgId, row.employeeId);
    let to = (await inScopeApprovers(row.accountId, orgId, row.employeeId)).filter((u) => !excluded.has(u));
    /* Nobody who approves leave for them: the company's admins whose scope holds them, never the person themselves. */
    if (!to.length) to = await lastResortDeciders(row.accountId, orgId, [...excluded], row.employeeId);
    if (!to.length) return false;
    return handOnStep(actor, engine.id, { to, why });
  }
  if (presetOf(engine) === 'MANAGER_THEN_HR' && engine.currentStep === 1) return handOnStep(actor, engine.id, { why });
  return false;
}

/** Is this leave's waiting request on the engine (a preset or the leave rule), for the hand-on job: it then writes on the leave only what the engine did. */
export async function isOnEngine(orgId: string, row: { id: string; groupId: string | null }) {
  return onEngine(await engineRequestOf(orgId, row));
}

/**
 * Waiting leave on the engine, for the queues: the step's people as stored, whether "HR can step in", and
 * whether HR is one of the step's approvers (so whoever approves leave now, hired since the step opened,
 * sees it too; deciding is checked live, decideLeaveOnEngine). A manager's step an older API wrote on the
 * leave reads as HR's step here (it is caught up when someone decides).
 */
export async function engineQueue(orgId: string, leaveIds: string[]) {
  const out = new Map<string, { candidates: string[]; stepIn: 'HR' | 'OWNER' | null; hrStep: boolean; preset: string; step: number; tookFirst: string[] }>();
  if (!leaveIds.length) return out;
  const rows = await peoplePrisma.approvalRequest.findMany({ where: { orgId, sourceKind: LEAVE_SOURCE, sourceId: { in: leaveIds }, status: 'WAITING' }, include: stepOrder });
  const leads = new Map((await peoplePrisma.leaveRequest.findMany({ where: { orgId, id: { in: rows.map((r) => r.sourceId as string) } }, select: { id: true, managerApprovedAt: true, managerApprovedById: true } })).map((l) => [l.id, l]));
  const rules = new Map<string, ReturnType<typeof stepsOfRule>>();
  for (const r of rows) {
    if (!onEngine(r) || !r.sourceId) continue;
    if (!rules.has(r.ruleId)) rules.set(r.ruleId, stepsOfRule(await peoplePrisma.approvalRule.findUnique({ where: { id: r.ruleId } })));
    const lead = leads.get(r.sourceId);
    const caughtUp = presetOf(r) === 'MANAGER_THEN_HR' && r.currentStep === 1 && Boolean(lead?.managerApprovedAt);
    const step = caughtUp ? 2 : r.currentStep;
    const spec = rules.get(r.ruleId)!.find((s) => s.order === step);
    const took = r.steps.filter((x) => x.status === 'APPROVED' && x.decidedByUserId).map((x) => x.decidedByUserId as string);
    if (caughtUp && lead?.managerApprovedById) {
      const m = await peoplePrisma.employee.findFirst({ where: { id: lead.managerApprovedById, orgId }, select: { id: true, userId: true } });
      if (m) took.push(m.userId || portalOf(m.id));
    }
    out.set(r.sourceId, { candidates: caughtUp ? [] : candidatesOf(r), stepIn: spec?.stepIn ?? null, hrStep: Boolean(spec?.approvers.some((a) => a.kind === 'HR')), preset: presetOf(r), step, tookFirst: took });
  }
  return out;
}

/** Leave waiting on the engine where one of these ids is named on the step now (a hand-up, a manager in the employee app). */
export async function engineLeaveNaming(orgId: string, ids: string[]) {
  const out = new Set<string>();
  for (const id of ids.filter(Boolean)) {
    const steps = await peoplePrisma.approvalStep.findMany({ where: { orgId, status: 'WAITING', candidateUserIds: { array_contains: [id] }, request: { sourceKind: LEAVE_SOURCE, status: 'WAITING' } }, select: { request: { select: { sourceId: true } } }, take: 2000 });
    for (const s of steps) if (s.request.sourceId) out.add(s.request.sourceId);
  }
  return out;
}

/** Approved steps since the request was last asked again (the people who already approved it). */
function approvedSince(engine: EngineRequest) {
  const since = (engine.payload as { restartedAt?: string } | null)?.restartedAt;
  return new Set(engine.steps.filter((x) => x.status === 'APPROVED' && (!since || (x.decidedAt && x.decidedAt >= new Date(since)))).map((x) => x.decidedByUserId));
}

const todayInIndia = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Who may decide the step waiting now, as of today: its approvers resolved again in leave's words
 * (resolveLeave), and who may step in. A step handed on keeps going to whom it was handed (worked out again:
 * the rule's hand-on target, or whoever approves leave for the person). Nobody at all: the company's admins
 * whose scope holds the person, never the person on leave.
 */
export async function liveDeciders(accountId: string, orgId: string, engine: EngineRequest) {
  const spec = stepsOfRule(await peoplePrisma.approvalRule.findUnique({ where: { id: engine.ruleId } })).find((x) => x.order === engine.currentStep);
  const waiting = waitingSteps(engine)[0];
  const request: Req = { id: engine.id, requestType: engine.requestType, requesterUserId: engine.requesterUserId, subjectEmployeeId: engine.subjectEmployeeId, payload: engine.payload, sourceKind: engine.sourceKind };
  const day = todayInIndia();
  const excluded = await subjectIds(orgId, engine.subjectEmployeeId);
  const subject = engine.subjectEmployeeId;
  if (waiting?.resolvedHow === 'HANDED_ON') {
    let to = spec?.overdue?.to ? (await resolveLeave({ accountId, orgId }, spec.overdue.to, request, day, async () => approvedSince(engine))).candidates : (await inScopeApprovers(accountId, orgId, String(subject))).filter((u) => !excluded.has(u));
    if (!to.length) to = await lastResortDeciders(accountId, orgId, [...excluded], subject);
    return { spec, stepId: waiting.id, candidates: to, stepIn: [] as string[], how: 'HANDED_ON', standInFor: null as string | null, comment: waiting.comment };
  }
  const parts: Resolution[] = [];
  for (const a of spec?.approvers || []) parts.push(await resolveLeave({ accountId, orgId }, a, request, day, async () => approvedSince(engine)));
  let candidates = [...new Set(parts.flatMap((x) => x.candidates))];
  const stepIn = spec?.stepIn === 'HR' ? (await inScopeApprovers(accountId, orgId, String(subject))).filter((u) => !excluded.has(u)) : spec?.stepIn === 'OWNER' ? (await ownerDeciders(accountId, orgId)).filter((u) => !excluded.has(u)) : [];
  let how = parts.find((x) => x.candidates.length)?.how || null;
  if (!candidates.length && !stepIn.length) {
    candidates = await lastResortDeciders(accountId, orgId, [...excluded], subject);
    how = 'LAST_RESORT';
  }
  const standIn = parts.flatMap((x) => x.standIns).find((x) => candidates.includes(x.user));
  return { spec, stepId: waiting?.id || '', candidates, stepIn, how, standInFor: standIn ? standIn.for : null, comment: parts.flatMap((x) => x.notes).join('. ') || null };
}

/** The waiting step's people brought up to date, only for the step they were worked out for. Answers whether they changed. */
async function refreshStep(accountId: string, orgId: string, engine: EngineRequest, live: Awaited<ReturnType<typeof liveDeciders>>) {
  if (!live.candidates.length || !live.stepId) return false;
  return reassignStep(actorFor(accountId, orgId, null, engine.id), engine.id, { stepId: live.stepId, candidates: live.candidates, how: live.how, comment: live.comment, standInFor: live.standInFor });
}

/**
 * The manager's step written on the leave row while the engine still waits for it (an older API decided it during a
 * rollback, or handed it on there): the engine takes it as taken by the same person (or handed on), and HR's step
 * opens. Inside the caller's transaction, so a decision refused after it undoes it too. Answers whether it moved.
 */
async function catchUpManagerStep(accountId: string, orgId: string, engine: EngineRequest) {
  if (presetOf(engine) !== 'MANAGER_THEN_HR' || engine.currentStep !== 1 || !engine.sourceId) return false;
  const lead = await peoplePrisma.leaveRequest.findFirst({ where: { id: engine.sourceId, orgId }, select: { managerApprovedAt: true, managerApprovedById: true } });
  if (!lead?.managerApprovedAt) return false;
  const by = lead.managerApprovedById ? await peoplePrisma.employee.findFirst({ where: { id: lead.managerApprovedById, orgId }, select: { id: true, userId: true } }) : null;
  const approvedBy = by ? by.userId || portalOf(by.id) : null;
  return handOnStep(actorFor(accountId, orgId, approvedBy, engine.id), engine.id, { approvedBy, why: approvedBy ? 'The manager approved it on the leave itself' : 'Handed on to HR on the leave itself' });
}

/**
 * One leave's engine request brought up to date under the company's People write lock (so it never crosses a
 * decision): a leave no longer waiting closes its request quietly; a manager's step written on the leave is caught
 * up; the step's people are worked out again and, when they changed, told (as the chain tells a manager).
 */
async function refreshOne(accountId: string, orgId: string, requestId: string) {
  return peopleWrite(orgId, async () => {
    await peoplePrisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave-engine:${requestId}`}))`;
    let engine = await peoplePrisma.approvalRequest.findFirst({ where: { id: requestId, orgId }, include: stepOrder });
    if (!onEngine(engine)) return false;
    const lead = await leadOf(engine);
    if (!lead) return false;
    if (lead.status !== 'PENDING') {
      await syncLeaveDecision(orgId, lead);
      return false;
    }
    if (await catchUpManagerStep(accountId, orgId, engine)) engine = await peoplePrisma.approvalRequest.findFirst({ where: { id: requestId, orgId }, include: stepOrder });
    if (!onEngine(engine)) return false;
    if (!(await refreshStep(accountId, orgId, engine, await liveDeciders(accountId, orgId, engine)))) return false;
    const { tellWaiting } = await import('../../routes/leave.js');
    await tellWaiting(orgId, lead.id);
    return true;
  });
}

/** Above this many waiting requests, a change made in a screen leaves the refresh to the leave job (runLeaveEngineRefresh) rather than holding the request. */
const INLINE_REFRESH_LIMIT = 100;

/**
 * Leave waiting on the engine in this company, its steps' people worked out again: after a stand-in is named or
 * removed, or a person's manager changed (`employeeId`: only their leave). All of them, in pages; from a screen
 * (`inline`) a big company's are left to the leave job, which says so in its log. Never fails the change that called it.
 */
export async function refreshLeaveSteps(accountId: string, orgId: string, opts: { employeeId?: string | null; inline?: boolean } = {}) {
  try {
    const where = { orgId, sourceKind: LEAVE_SOURCE, status: 'WAITING', ...(opts.employeeId ? { subjectEmployeeId: opts.employeeId } : {}) };
    if (opts.inline && !opts.employeeId) {
      const count = await peoplePrisma.approvalRequest.count({ where });
      if (count > INLINE_REFRESH_LIMIT) {
        console.warn(`[leave-engine] ${orgId}: ${count} waiting requests; their steps are brought up to date by the leave job`);
        return -1;
      }
    }
    let moved = 0;
    let after: string | undefined;
    for (;;) {
      const page = await peoplePrisma.approvalRequest.findMany({ where: { ...where, ...(after ? { id: { gt: after } } : {}) }, select: { id: true }, orderBy: { id: 'asc' }, take: 200 });
      if (!page.length) break;
      for (const r of page) if (await refreshOne(accountId, orgId, r.id)) moved += 1;
      after = page[page.length - 1].id;
    }
    return moved;
  } catch (e) {
    console.error(`[leave-engine] ${orgId}: steps not brought up to date:`, e instanceof Error ? e.message : e);
    return 0;
  }
}

/**
 * Someone whose own leave was approved or cancelled for today (they are away, or back): the leave they decide is
 * worked out again, so it goes up while they are away and back when they return, and whoever it goes to is told.
 * Their reportees' leave (they are the manager, or the manager's manager) and every step that names them.
 */
export async function refreshForPerson(accountId: string, orgId: string, employeeId: string) {
  const me = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true, userId: true } });
  if (!me) return 0;
  const ids = [portalOf(me.id), ...(me.userId ? [me.userId] : [])];
  const team = await peoplePrisma.employee.findMany({ where: { orgId, reportingManagerId: me.id }, select: { id: true } });
  const below = team.length ? await peoplePrisma.employee.findMany({ where: { orgId, reportingManagerId: { in: team.map((t) => t.id) } }, select: { id: true } }) : [];
  const subjects = [...team, ...below].map((x) => x.id);
  const named = new Set<string>();
  for (const id of ids) {
    const steps = await peoplePrisma.approvalStep.findMany({ where: { orgId, status: 'WAITING', candidateUserIds: { array_contains: [id] }, request: { sourceKind: LEAVE_SOURCE, status: 'WAITING' } }, select: { requestId: true }, take: 2000 });
    for (const s of steps) named.add(s.requestId);
  }
  const theirs = subjects.length ? await peoplePrisma.approvalRequest.findMany({ where: { orgId, sourceKind: LEAVE_SOURCE, status: 'WAITING', subjectEmployeeId: { in: subjects } }, select: { id: true }, take: 2000 }) : [];
  let moved = 0;
  for (const id of new Set([...named, ...theirs.map((t) => t.id)])) if (await refreshOne(accountId, orgId, id)) moved += 1;
  return moved;
}

/** Is this id one who may decide this leave now, worked out live (the guard on the decide routes for someone without the leave right, and the queues). */
export async function decidesNow(accountId: string, orgId: string, row: { id: string; groupId?: string | null }, id: string) {
  const engine = await engineRequestOf(orgId, row);
  if (!onEngine(engine)) return false;
  const live = await liveDeciders(accountId, orgId, engine);
  return live.candidates.includes(id) || live.stepIn.includes(id);
}

/**
 * A step of a leave's engine request past its due time (the engine's dues job): reminded at due and again every
 * three working days (a REMIND rule, the presets), or handed on a day after the reminder (the leave rule's
 * HAND_ON, to whom it names, worked out as of now). Reminders go to the step's people with a CLOR sign-in, about
 * the leave, so withdrawing it retires them.
 */
async function leaveOverdue(step: { id: string; requestId: string; accountId: string; orgId: string; order: number; dueAt: Date; remindedAt: Date | null; candidateUserIds: unknown }, spec: { overdue: { action: string; afterHours?: number; to?: { kind: string; id?: string } } | null; due: { hours?: number; workingDays?: number } } | undefined, now: Date): Promise<'REMINDED' | 'HANDED_ON' | null> {
  const { accountId, orgId } = step;
  const engine = await peoplePrisma.approvalRequest.findFirst({ where: { id: step.requestId, orgId }, include: stepOrder });
  if (!onEngine(engine) || !engine.sourceId) return null;
  const lead = await leadOf(engine);
  if (!lead || lead.status !== 'PENDING') {
    if (lead) await peopleWrite(orgId, () => syncLeaveDecision(orgId, lead));
    return null;
  }
  const remind = async () => {
    await peoplePrisma.approvalStep.update({ where: { id: step.id }, data: { remindedAt: now } });
    const to = ((step.candidateUserIds as string[]) || []).filter((u) => !u.startsWith('portal:'));
    const { sendNotice } = await import('../notifications.js');
    const app = (await import('../features.js')).isFeatureEnabled;
    const where = (await app(accountId, orgId, 'people')) ? 'people' : 'attendance';
    if (to.length) await sendNotice(accountId, orgId, to, { kind: 'attendance.leave_asked', title: `Overdue: ${engine.title}`, body: `Was due ${step.dueAt.toISOString().slice(0, 10)}.`, link: { app: where, screen: 'leaveRequests', params: { id: lead.id } } as any }, { dedupeKey: `leave-overdue:${lead.id}:${step.id}:${now.toISOString().slice(0, 10)}`, subjectKey: `leave:${lead.id}` });
    return 'REMINDED' as const;
  };
  if (!step.remindedAt) return remind();
  const afterMs = (spec?.overdue?.afterHours ?? 24) * 3_600_000;
  if (spec?.overdue?.action === 'HAND_ON' && spec.overdue.to && now.getTime() - step.remindedAt.getTime() >= afterMs) {
    const request: Req = { id: engine.id, requestType: engine.requestType, requesterUserId: engine.requesterUserId, subjectEmployeeId: engine.subjectEmployeeId, payload: engine.payload, sourceKind: engine.sourceKind };
    const to = (await resolveLeave({ accountId, orgId }, spec.overdue.to, request, todayInIndia(), async () => approvedSince(engine))).candidates;
    if (!to.length) return null;
    const moved = await peopleWrite(orgId, async () => {
      const ok = await handOnStep(actorFor(accountId, orgId, null, engine.id), engine.id, { to, why: `Step ${step.order} handed on: it was due ${step.dueAt.toISOString().slice(0, 10)}` });
      if (ok) {
        const { tellWaiting, withHistory } = await import('../../routes/leave.js');
        const row = await peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id: lead.id } });
        await peoplePrisma.leaveRequest.update({ where: { id: lead.id }, data: { history: withHistory(row, { by: 'system', what: 'STEP_HANDED_ON', note: `Step ${step.order} handed on: it was due ${step.dueAt.toISOString().slice(0, 10)}` }) as any } });
        await tellWaiting(orgId, lead.id);
      }
      return ok;
    });
    return moved ? 'HANDED_ON' : null;
  }
  const { addWorkingDays, REMIND_EVERY_WORKING_DAYS } = await import('../people/approvals/engine.js');
  if (addWorkingDays(step.remindedAt, REMIND_EVERY_WORKING_DAYS).getTime() <= now.getTime()) return remind();
  return null;
}

/**
 * One decision on a leave the engine decides, by whoever is signed in (`ids`: their sign-in, or in the
 * employee app their sign-in and `portal:<id>`). Answers null when the leave is not on the engine (the
 * caller decides it on the old path). Everything happens under the company's People write lock: the
 * request is read again there, a manager's step an older API wrote on the leave is caught up, who decides
 * is worked out as of now and the step brought up to date, then the decision; a refusal undoes all of it.
 * Refusals answer as the chain did: the manager first under "the manager, then HR" (409 MANAGER_FIRST),
 * HR's step not the manager's (403 HR_STEP), your own leave. Whoever approves leave for the person may still
 * reject it while the manager's step waits (as on the chain): the leave is rejected and its request closes.
 */
export async function decideLeaveOnEngine(p: { accountId: string; orgId: string; row: { id: string; groupId: string | null; employeeId: string; status: string }; ids: string[]; approve: boolean; note: string | null; channel: 'web' | 'app' }): Promise<{ request: any; stage?: 'HR' | 'NEXT'; by: string; override?: boolean } | null> {
  const { accountId, orgId, row, approve, note } = p;
  if (!onEngine(await engineRequestOf(orgId, row))) return null;
  return peopleWrite(orgId, async () => {
    let engine = await engineRequestOf(orgId, row);
    if (!onEngine(engine)) return null;
    await peoplePrisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave-engine:${engine.id}`}))`;
    if (await catchUpManagerStep(accountId, orgId, engine)) engine = await engineRequestOf(orgId, row);
    if (!onEngine(engine)) return null;
    const ids = p.ids.filter(Boolean);
    const live = await liveDeciders(accountId, orgId, engine);
    if (await refreshStep(accountId, orgId, engine, live)) engine = (await engineRequestOf(orgId, row))!;
    const candidates = live.candidates;
    const spec = live.spec;
    const preset = presetOf(engine);
    let by = ids.find((u) => candidates.includes(u)) || null;
    if (!by && spec?.stepIn) by = ids.find((u) => live.stepIn.includes(u)) || null;
    const { decideLeave, managerStep, withTypes } = await import('../../routes/leave.js');
    if (!by) {
      const own = await subjectIds(orgId, row.employeeId);
      if (ids.some((u) => own.has(u))) throw p.channel === 'web' ? fail(403, 'You prepared this leave request; somebody else has to approve it.', 'MAKER_CHECKER') : fail(403, 'This request is not yours to decide.');
      const user = ids.find((u) => !u.startsWith('portal:'));
      const approvesHere = p.channel === 'web' && user ? (await inScopeApprovers(accountId, orgId, row.employeeId)).includes(user) : false;
      if (preset === 'MANAGER_THEN_HR' && engine.currentStep === 1 && approvesHere) {
        if (approve) {
          const m = await activeManagerOf(orgId, row.employeeId);
          throw fail(409, `${m?.name || 'Their manager'} has not approved this yet; the company asks for the manager first.`, 'MANAGER_FIRST');
        }
        /* HR rejecting while the manager's step waits, as the chain allowed: the leave is rejected, and its request closes to match. */
        const request = await decideLeave(accountId, orgId, row, user!, note, false);
        return { request, by: user!, override: true };
      }
      const tookFirst = engine.steps.some((s) => s.order === 1 && s.status === 'APPROVED' && ids.includes(String(s.decidedByUserId)));
      if (preset === 'MANAGER_THEN_HR' && engine.currentStep === 2 && tookFirst && p.channel === 'app') {
        throw approve ? fail(409, 'You have already approved this; it is with HR now.') : fail(409, 'You have already approved this; it is with HR now.', 'HR_STEP');
      }
      if (preset === 'MANAGER_THEN_HR' && engine.currentStep === 2 && (approvesHere || tookFirst)) {
        throw fail(403, approve ? 'HR approves after the manager; the manager cannot take both steps.' : 'The manager has passed this to HR; HR decides it now.', 'HR_STEP');
      }
      throw fail(403, preset === 'RULE' ? `Step ${engine.currentStep} of the leave approval rule waits for someone else.` : 'This request is not yours to decide.', 'NOT_YOUR_STEP');
    }
    const decider = by;
    const before = engine.currentStep;
    const stepKind = spec?.approvers.length === 1 ? spec.approvers[0].kind : null;
    let out: { request: { status: string; currentStep: number } };
    try {
      out = await decide(actorFor(accountId, orgId, decider, engine.id), engine.id, approve ? 'approve' : 'reject', note, { atSource: true });
    } catch (e) {
      if (e instanceof ApprovalError && e.code === 'ALREADY_DECIDED') throw fail(409, 'Someone else just decided this.', 'ALREADY_DECIDED');
      throw e;
    }
    const lead = await peoplePrisma.leaveRequest.findFirstOrThrow({ where: { id: engine.sourceId!, orgId } });
    if (approve && out.request.status === 'WAITING' && out.request.currentStep > before) {
      /* The manager's step, written on the leave as the chain writes it: leave's notices read the same, and an older API hands it to HR. */
      if (stepKind === 'MANAGER' && preset !== 'RULE') {
        const manager = await activeManagerOf(orgId, row.employeeId);
        const actorEmp = decider.startsWith('portal:') ? decider.slice(7) : (await peoplePrisma.employee.findFirst({ where: { orgId, userId: decider, status: { not: 'LEFT' } }, select: { id: true } }))?.id;
        if (manager && actorEmp) return { request: await managerStep(orgId, lead, manager.id, note, { employeeId: actorEmp, userId: decider.startsWith('portal:') ? null : decider }), stage: preset === 'MANAGER_THEN_HR' ? ('HR' as const) : ('NEXT' as const), by: decider };
      }
      /* The leave rule: the step taken is written in the leave's own history, as its walker wrote it, and the next step's people are told. */
      if (preset === 'RULE') {
        const { withHistory, tellWaiting } = await import('../../routes/leave.js');
        await peoplePrisma.leaveRequest.update({ where: { id: lead.id }, data: { history: withHistory(lead, { by: decider, what: 'STEP_APPROVED', note: note ? `Step ${before}: ${note}` : `Step ${before}` }) as any } });
        await tellWaiting(orgId, lead.id);
      }
      return { request: (await withTypes(orgId, [await peoplePrisma.leaveRequest.findFirstOrThrow({ where: { id: lead.id } })]))[0], stage: 'NEXT' as const, by: decider };
    }
    return { request: (await withTypes(orgId, [lead]))[0], by: decider };
  });
}

/** These leave rows less those decided on the engine (any part of a leave whose request waits there). */
export async function offEngine<T extends { id: string; groupId: string | null }>(orgId: string, rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const groups = [...new Set(rows.map((r) => r.groupId).filter(Boolean) as string[])];
  const parts = groups.length ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: { in: groups } }, select: { id: true, groupId: true } }) : [];
  const ids = [...new Set([...rows.map((r) => r.id), ...parts.map((x) => x.id)])];
  const open = await peoplePrisma.approvalRequest.findMany({ where: { orgId, sourceKind: LEAVE_SOURCE, sourceId: { in: ids }, status: 'WAITING' }, select: { sourceId: true } });
  if (!open.length) return rows;
  const onIds = new Set(open.map((o) => o.sourceId as string));
  const onGroups = new Set(parts.filter((x) => onIds.has(x.id)).map((x) => x.groupId));
  return rows.filter((r) => !onIds.has(r.id) && !(r.groupId && onGroups.has(r.groupId)));
}

/** For notices, tests and the readiness check: is a leave decided on the engine, and who may take the step now. */
export async function engineStepOf(orgId: string, row: { id: string; groupId?: string | null }) {
  const engine = await engineRequestOf(orgId, row);
  if (!onEngine(engine)) return null;
  const step = waitingSteps(engine)[0];
  return { requestId: engine.id, order: engine.currentStep, candidates: candidatesOf(engine), how: step?.resolvedHow ?? null, comment: step?.comment ?? null, preset: presetOf(engine) };
}

// ---------------------------------------------------------------------------
// What people see: the drawer's step timeline, and "With Ravi (your manager)" in the employee app
// ---------------------------------------------------------------------------

const KIND_WORDS: Record<string, string> = { MANAGER: 'manager', MANAGER_OF_MANAGER: "manager's manager", HR: 'HR', STAND_IN: 'standing in', AWAY_HANDED_UP: 'sent up', HANDED_ON: 'handed on', LAST_RESORT: 'admin' };
const dayOf = (d: Date | null | undefined) => (d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10) : null);

/**
 * A leave's engine request as the drawer shows it (SPEC 5.7): one line per step since it was last asked, in
 * order, in plain words ("Ravi Kumar (manager) approved", "Waiting for HR: Asha, Kavya"), with the date; and
 * the step waiting now, who may take it, its due time, and whether the reader may decide it (worked out live).
 */
export async function engineStepView(accountId: string, orgId: string, row: { id: string; groupId?: string | null }, readerId: string) {
  const engine = await engineRequestOf(orgId, row);
  if (!engine) return null;
  const since = (engine.payload as { restartedAt?: string } | null)?.restartedAt;
  const steps = engine.steps.filter((s) => s.status !== 'WITHDRAWN' || engine.status === 'WITHDRAWN').filter((s) => !since || s.createdAt >= new Date(since) || (s.decidedAt && s.decidedAt >= new Date(since)) || s.status === 'WAITING');
  const rule = await peoplePrisma.approvalRule.findUnique({ where: { id: engine.ruleId }, select: { name: true, version: true, steps: true, presetKey: true } });
  const specs = stepsOfRule(rule);
  const names = await namesFor(steps.flatMap((s) => [s.decidedByUserId, ...((s.candidateUserIds as string[]) || [])]).filter(Boolean) as string[], orgId);
  const role = (order: number, how: string | null) => {
    const kind = how && KIND_WORDS[how] && how !== 'MANAGER' && how !== 'HR' ? how : specs.find((x) => x.order === order)?.approvers[0]?.kind || null;
    return kind && KIND_WORDS[kind] ? ` (${KIND_WORDS[kind]})` : '';
  };
  const timeline: Array<{ order: number; status: string; text: string; on: string | null }> = [];
  for (const s of steps) {
    const who = s.decidedByUserId ? names.get(s.decidedByUserId) || 'Someone' : null;
    if (s.status === 'APPROVED') timeline.push({ order: s.order, status: s.status, on: dayOf(s.decidedAt), text: s.resolvedHow === 'AUTO_APPROVED' ? 'Approved by the leave rule' : s.resolvedHow === 'SELF_APPROVED' ? `${who} approved: nobody else in the company can decide this` : `${who}${role(s.order, s.resolvedHow)} approved` });
    else if (s.status === 'REJECTED') timeline.push({ order: s.order, status: s.status, on: dayOf(s.decidedAt), text: `${who || 'Not approved'}${who ? `${role(s.order, s.resolvedHow)} rejected` : ''}` });
    else if (s.status === 'SKIPPED') timeline.push({ order: s.order, status: s.status, on: dayOf(s.decidedAt), text: `Step ${s.order} skipped${s.comment ? `: ${s.comment.charAt(0).toLowerCase()}${s.comment.slice(1)}` : ''}` });
    else if (s.status === 'HANDED_ON') timeline.push({ order: s.order, status: s.status, on: dayOf(s.decidedAt), text: `Step ${s.order} handed on${s.comment ? `: ${s.comment.charAt(0).toLowerCase()}${s.comment.slice(1)}` : ''}` });
    else if (s.status === 'WAITING') {
      const people = ((s.candidateUserIds as string[]) || []).map((u) => names.get(u)).filter(Boolean);
      timeline.push({ order: s.order, status: s.status, on: dayOf(s.dueAt), text: people.length ? `Waiting for ${people.length > 3 ? `${people.slice(0, 3).join(', ')} and others` : people.join(', ')}${role(s.order, s.resolvedHow)}` : 'Waiting for a decision' });
    }
  }
  const waiting = onEngine(engine) ? waitingSteps(engine)[0] : null;
  return {
    engine: true,
    rule: rule ? (rule.presetKey ? rule.name : `${rule.name} (v${rule.version})`) : 'Leave approval',
    of: specs.length || null,
    current: waiting ? engine.currentStep : null,
    waitingFor: waiting ? ((waiting.candidateUserIds as string[]) || []).map((u) => names.get(u)).filter(Boolean) : [],
    dueAt: waiting?.dueAt ?? null,
    yours: waiting ? await decidesNow(accountId, orgId, row, readerId) : false,
    timeline,
  };
}

/** "With Ravi (your manager)", "With HR", "With Meena": who a waiting leave is with now, for the person who asked (the employee app). */
export async function withWhom(orgId: string, row: { id: string; groupId?: string | null; status: string }) {
  if (row.status !== 'PENDING') return null;
  const engine = await engineRequestOf(orgId, row);
  if (!onEngine(engine)) return null;
  const step = waitingSteps(engine)[0];
  const spec = stepsOfRule(await peoplePrisma.approvalRule.findUnique({ where: { id: engine.ruleId } })).find((x) => x.order === engine.currentStep);
  const kinds = (spec?.approvers || []).map((a) => a.kind);
  const how = step?.resolvedHow || null;
  const people = (step?.candidateUserIds as string[]) || [];
  const names = await namesFor(people, orgId);
  const listed = people.map((u) => names.get(u)).filter(Boolean) as string[];
  if ((how === 'MANAGER' || how === 'STAND_IN') && kinds.length === 1 && kinds[0] === 'MANAGER' && listed.length) return `With ${listed[0]} (your manager${how === 'STAND_IN' && listed.length > 1 ? `, or ${listed.slice(1).join(', ')} standing in` : ''})`;
  if (kinds.includes('HR') && how !== 'AWAY_HANDED_UP' && how !== 'HANDED_ON') return kinds.includes('MANAGER') ? 'With your manager or HR' : 'With HR';
  if (listed.length) return `With ${listed.length > 2 ? `${listed.slice(0, 2).join(', ')} and others` : listed.join(' or ')}`;
  return 'Waiting for a decision';
}
