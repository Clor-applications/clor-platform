import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { usersWithPermission } from '../notifications.js';
import { resolveAccess } from '../access.js';
import { inScope, teamScope } from '../people/scope.js';
import type { Actor } from '../people/changeLog.js';
import {
  ApprovalError, closeAtSource, decide, handOnStep, namesFor, onApproved, onClosed, onSource, openSourced, reassignStep, restartSourced, stepsOfRule,
  type Req, type RequestType, type Resolution,
} from '../people/approvals/engine.js';
import { timePresetRule, type TimePresetKey } from '../people/approvals/presets.js';
import { activeManagerOf } from './approvalChain.js';
import { deciderFor } from './standIns.js';
import { fail } from './days.js';

/**
 * Attendance on the approval engine (docs/people/workflow-engine/SPEC.md section 9, phase 2d), built as leave was
 * (leaveEngine.ts, 2c): attendance requests (missed punch, work from home, on duty, permission, shift change),
 * overtime and comp-off, and field punches.
 *
 * Behind one switch per company (PeopleSetting.attendanceOnEngine, Company choices, owner or admin), off by default.
 * With it on, each new one opens an engine request (`sourceKind` ATTENDANCE, OVERTIME or FIELD_PUNCH, `sourceId` its
 * row) under the preset of the chain the company stores for it (presets.ts TIME_PRESETS): the correction choice or
 * the kind's own (requestRules), the overtime chain, and for a field punch "HR or the manager". The module keeps its
 * own row, status, days and notices, exactly as before:
 *
 *  - who decides is worked out in attendance's own words (resolveTime below): HR is whoever holds the right that
 *    decides it today (Attendance Requests approve, in their scope; Attendance Records edit for overtime; Attendance
 *    Devices edit for field punches), the manager decides in CLOR or in the employee app, with a stand-in for the day;
 *    the person it is about never decides it;
 *  - the module's own checks run first, word for word as before (your own request, HR only, the manager first, HR's
 *    step after the manager, a reason when rejecting): the engine never lets anyone decide whom they refuse;
 *  - approving the last step writes the decision and the days (the module's own write, in the same transaction:
 *    a refusal such as a closed month undoes the step too); rejecting likewise. A rejection the module allows but the
 *    step's people do not hold (HR rejecting while the manager decides, as today) is written by the module, and the
 *    engine request closes to match;
 *  - the manager's step under "the manager, then HR" is still written on the row (managerApprovedAt), so its notices
 *    read the same and an older API that reads the row after a rollback hands it to HR, as it would have;
 *  - a request withdrawn, cancelled, changed, or decided anywhere else (an older API) moves or closes its engine
 *    request to match.
 *
 * Requests already waiting when the switch goes on finish on the old path. A request keeps the chain it was asked
 * under when the setting changes later (as leave). No away hand-up and no reminders: attendance has neither today.
 */

export const ATTENDANCE_SOURCE = 'ATTENDANCE';
export const OVERTIME_SOURCE = 'OVERTIME';
export const FIELD_PUNCH_SOURCE = 'FIELD_PUNCH';
export type TimeSource = typeof ATTENDANCE_SOURCE | typeof OVERTIME_SOURCE | typeof FIELD_PUNCH_SOURCE;

/** The right that decides each today (routes/attendance.ts, attendanceInsights.ts). */
const RIGHT: Record<TimeSource, string> = {
  ATTENDANCE: 'ATTENDANCE::Attendance Requests::APPROVE',
  OVERTIME: 'ATTENDANCE::Attendance Records::EDIT',
  FIELD_PUNCH: 'ATTENDANCE::Attendance Devices::EDIT',
};

/** The chain as each stores it, to its preset. Attendance's "HR" is "HR or the manager, whoever is first" (SPEC 3.2); overtime's "HR" is HR alone. */
const PRESET_OF: Record<TimeSource, Record<string, TimePresetKey>> = {
  ATTENDANCE: { HR: 'HR_OR_MANAGER', HR_ONLY: 'HR_ONLY', MANAGER: 'MANAGER', MANAGER_THEN_HR: 'MANAGER_THEN_HR' },
  OVERTIME: { HR: 'HR_ONLY', MANAGER: 'MANAGER_ALONE', MANAGER_THEN_HR: 'MANAGER_THEN_HR' },
  FIELD_PUNCH: { HR: 'HR_OR_MANAGER' },
};

/** The engine's request type: one per attendance kind (SPEC section 4), overtime and comp-off apart, field punches. */
export const typeOf = (source: TimeSource, kind?: string | null) => (source === ATTENDANCE_SOURCE ? `ATTENDANCE:${kind}` : source === OVERTIME_SOURCE ? String(kind || 'OVERTIME') : 'FIELD_PUNCH');
const sourceOfType = (t: string): TimeSource => (t.startsWith('ATTENDANCE:') ? ATTENDANCE_SOURCE : t === 'FIELD_PUNCH' ? FIELD_PUNCH_SOURCE : OVERTIME_SOURCE);
const TYPES = ['MISSED_PUNCH', 'WFH', 'ON_DUTY', 'PERMISSION', 'SHIFT_CHANGE'].map((k) => typeOf(ATTENDANCE_SOURCE, k)).concat(['OVERTIME', 'COMP_OFF', 'FIELD_PUNCH']);

const INACTIVE = new Set(['LEFT', 'SUSPENDED']);
const portalOf = (employeeId: string) => `portal:${employeeId}`;

/** Is this company's new attendance decided by the engine? */
export async function attendanceOnEngine(orgId: string) {
  return Boolean((await peoplePrisma.peopleSetting.findUnique({ where: { orgId }, select: { attendanceOnEngine: true } }))?.attendanceOnEngine);
}

const stepOrder = { steps: { orderBy: [{ order: 'asc' as const }, { createdAt: 'asc' as const }, { slot: 'asc' as const }, { id: 'asc' as const }] } };

/** The engine request a row belongs to; null when it has none (the old path). */
export async function engineOf(orgId: string, source: TimeSource, sourceId: string) {
  return peoplePrisma.approvalRequest.findFirst({ where: { orgId, sourceKind: source, sourceId }, include: stepOrder, orderBy: { createdAt: 'desc' } });
}
type EngineRequest = NonNullable<Awaited<ReturnType<typeof engineOf>>>;

/** Still the engine's to decide: waiting with a step open. One an older API closed during a rollback is not, so the row goes on the old path. */
export const onEngine = (r: EngineRequest | null): r is EngineRequest => Boolean(r && r.status === 'WAITING' && r.steps.some((s) => s.status === 'WAITING'));
const waitingSteps = (r: EngineRequest) => r.steps.filter((s) => s.order === r.currentStep && s.status === 'WAITING');
const payloadOf = (r: { payload: unknown }) => (r.payload || {}) as { chain?: string; preset?: string; employeeId?: string; kind?: string };

/** The chain a waiting row was asked under (its preset), in the module's own words; null when it is not on the engine. */
export async function engineChain(orgId: string, source: TimeSource, sourceId: string): Promise<string | null> {
  const r = await engineOf(orgId, source, sourceId);
  return onEngine(r) ? payloadOf(r).chain || null : null;
}

/** The same for many rows at once (queues): sourceId → chain, for the rows waiting on the engine. */
export async function engineChains(orgId: string, source: TimeSource, ids: string[]) {
  const out = new Map<string, { chain: string; step: number }>();
  if (!ids.length) return out;
  const rows = await peoplePrisma.approvalRequest.findMany({ where: { orgId, sourceKind: source, sourceId: { in: ids }, status: 'WAITING' }, include: stepOrder });
  for (const r of rows) if (onEngine(r) && r.sourceId) out.set(r.sourceId, { chain: payloadOf(r).chain || 'HR', step: r.currentStep });
  return out;
}

// ---------------------------------------------------------------------------
// Who decides, in attendance's words
// ---------------------------------------------------------------------------

/**
 * Holders of the source's right: `SCOPE` those whose scope holds the person (a team-scoped role only for its team, as
 * the attendance routes and queues check), `WHOLE` only those who decide for the whole company, `ALL` every holder
 * (overtime and field punches: their single decide routes check no team, so the engine does not narrow them).
 */
async function holders(accountId: string, orgId: string, source: TimeSource, employeeId: string, which: 'SCOPE' | 'WHOLE' | 'ALL') {
  const users = await usersWithPermission(accountId, orgId, RIGHT[source]);
  if (which === 'ALL') return users;
  const out: string[] = [];
  for (const u of users) {
    const access = await resolveAccess(accountId, orgId, u);
    if (!access.ownDocumentsOnly) out.push(u);
    else if (which === 'SCOPE' && inScope(await teamScope({ ownDocumentsOnly: true, tenant: { orgId }, auth: { userId: u } } as any), employeeId)) out.push(u);
  }
  return out;
}

/**
 * The id an employee decides with as a manager or stand-in: their CLOR sign-in when they decide in the employee app
 * (as that user) or hold the right in CLOR, else the employee app's `portal:<id>`. Someone who can do neither, or has
 * left or is suspended, decides nothing.
 */
function deciderIdOf(e: { id: string; userId: string | null; portalEnabled: boolean; status: string } | null | undefined, rightHolders: string[]) {
  if (!e || INACTIVE.has(e.status)) return null;
  if (e.userId && (e.portalEnabled || rightHolders.includes(e.userId))) return e.userId;
  if (e.portalEnabled) return portalOf(e.id);
  return null;
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

/** The person it is about never decides it, as a user or in the employee app. Whoever entered it for them may (as today). */
async function subjectIds(orgId: string, employeeId: string | null) {
  if (!employeeId) return new Set<string>();
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { userId: true } });
  return new Set([portalOf(employeeId), ...(e?.userId ? [e.userId] : [])]);
}

/** HR in attendance's words: who holds the right for this person; after the manager on attendance requests, the whole company only. */
async function hrFor(accountId: string, orgId: string, source: TimeSource, chain: string, employeeId: string, afterManager: boolean) {
  if (source !== ATTENDANCE_SOURCE) return holders(accountId, orgId, source, employeeId, 'ALL');
  return holders(accountId, orgId, source, employeeId, chain === 'HR_ONLY' || afterManager ? 'WHOLE' : 'SCOPE');
}

/**
 * Who decides for one approver of a step, as of `day`:
 *  - HR: as hrFor. Under "the manager, then HR" on attendance requests, with a manager, the whole company only and
 *    never whoever took the manager's step (both ids). Overtime's HR step after the manager is any holder, as today.
 *  - MANAGER: the person's manager and their stand-in that day (ATTENDANCE stand-ins), in CLOR or the employee app.
 *    No manager (or one who left or is suspended): under "the manager" HR decides; otherwise the other approver or
 *    step does. No away hand-up: attendance has none today.
 */
function resolveTime(source: TimeSource) {
  return async (who: { accountId: string; orgId: string }, approver: { kind: string }, request: Req, day: string, approvedBy: () => Promise<Set<string | null>>): Promise<Resolution> => {
    const { accountId, orgId } = who;
    const chain = payloadOf(request as { payload: unknown }).chain || 'HR';
    const employeeId = String(request.subjectEmployeeId);
    const excluded = await subjectIds(orgId, employeeId);
    const manager = await activeManagerOf(orgId, employeeId);
    let found: string[] = [];
    let standIns: Array<{ for: string; user: string }> = [];
    let how: string | null = approver.kind;
    if (approver.kind === 'HR') {
      found = await hrFor(accountId, orgId, source, chain, employeeId, chain === 'MANAGER_THEN_HR' && Boolean(manager));
      if (source === ATTENDANCE_SOURCE && chain === 'MANAGER_THEN_HR') {
        const earlier = [...(await approvedBy())].filter((u): u is string => Boolean(u));
        if (earlier.length) {
          const same = await bothIds(orgId, earlier);
          found = found.filter((u) => !same.has(u));
        }
      }
    } else if (approver.kind === 'MANAGER') {
      if (!manager) {
        if (chain === 'MANAGER') {
          found = await hrFor(accountId, orgId, source, chain, employeeId, false);
          how = 'HR';
        }
      } else {
        const rightHolders = await holders(accountId, orgId, source, employeeId, source === ATTENDANCE_SOURCE ? 'SCOPE' : 'ALL');
        const standInId = await deciderFor(orgId, manager.id, day, 'ATTENDANCE');
        const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set([manager.id, standInId])] } }, select: { id: true, userId: true, portalEnabled: true, status: true } });
        const own = deciderIdOf(people.find((p) => p.id === manager.id), rightHolders);
        const sub = standInId !== manager.id ? deciderIdOf(people.find((p) => p.id === standInId), rightHolders) : null;
        found = [own, sub].filter((u): u is string => Boolean(u));
        if (sub) {
          standIns = [{ for: own || portalOf(manager.id), user: sub }];
          how = 'STAND_IN';
        }
      }
    }
    const all = [...new Set(found)];
    return { primary: all, standIns, all, candidates: all.filter((u) => !excluded.has(u)), how, notes: [] };
  };
}

for (const t of TYPES) {
  const source = sourceOfType(t);
  onSource(t, {
    resolve: resolveTime(source),
    /* "HR can still step in" (attendance requests under the manager): whoever holds the right for this person, never the person. */
    stepIn: async (who, _group, request) => {
      const excluded = await subjectIds(who.orgId, request.subjectEmployeeId);
      return (await hrFor(who.accountId, who.orgId, source, 'MANAGER', String(request.subjectEmployeeId), false)).filter((u) => !excluded.has(u));
    },
    /* No reminders (attendance has none); a row decided elsewhere meanwhile (an older API) closes its request. */
    overdue: async (step) => {
      const r = await peoplePrisma.approvalRequest.findFirst({ where: { id: step.requestId, orgId: step.orgId }, include: stepOrder });
      if (onEngine(r) && r.sourceId) await syncFromRow(step.accountId, step.orgId, source, r.sourceId);
      return null;
    },
  });

  /* What approval and rejection do: the module's own write, in the same transaction as the step. */
  onApproved(t as RequestType, async ({ request, actor }) => {
    const people = request.steps.filter((s) => s.status === 'APPROVED' && s.decidedByUserId).sort((a, b) => (b.decidedAt?.getTime() || 0) - (a.decidedAt?.getTime() || 0));
    const last = people[0];
    const by = actor.userId || last?.decidedByUserId || request.requesterUserId;
    /* What the approver wrote; a step the engine closed itself says nothing on the row. */
    const note = last && last.decidedByUserId === by && !last.resolvedHow?.startsWith('SELF') ? last.comment : null;
    await writeAtSource(request.accountId, request.orgId, source, String(request.sourceId), true, by, note);
    return { sourceId: request.sourceId };
  });
  onClosed(t as RequestType, async (request, status, note) => {
    if (status !== 'REJECTED') return;
    const by = request.steps.filter((s) => s.status === 'REJECTED' && s.decidedByUserId).sort((a, b) => (b.decidedAt?.getTime() || 0) - (a.decidedAt?.getTime() || 0))[0]?.decidedByUserId || 'system';
    await writeAtSource(request.accountId, request.orgId, source, String(request.sourceId), false, by, note);
  });
}

/** The module's own decision write, for the row as it is now (the decision of the last step, or a rejection). */
async function writeAtSource(accountId: string, orgId: string, source: TimeSource, sourceId: string, approve: boolean, by: string, note: string | null) {
  if (source === ATTENDANCE_SOURCE) {
    const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: sourceId, orgId } });
    if (!r || r.status !== 'PENDING') throw fail(409, 'This request was already decided.');
    const { writeDecision } = await import('./requests.js');
    await writeDecision(accountId, orgId, r, approve, by, note);
  } else if (source === OVERTIME_SOURCE) {
    const { writeOvertimeDecision } = await import('./selfService.js');
    await writeOvertimeDecision(orgId, sourceId, approve, by, note);
  } else {
    const { writePunchDecision } = await import('./phonePunch.js');
    await writePunchDecision(orgId, sourceId, approve);
  }
}

// ---------------------------------------------------------------------------
// Opening, deciding, closing
// ---------------------------------------------------------------------------

const actorFor = (accountId: string, orgId: string, userId: string | null, correlationId: string): Actor => ({ accountId, orgId, userId, source: 'FORM', correlationId });

/** A refusal of the module's own (a closed month, approved leave on the day): not the engine's, never a programming error. */
const moduleRefusal = (e: unknown) => Boolean(e && typeof e === 'object' && typeof (e as { status?: unknown }).status === 'number' && !(e instanceof ApprovalError));

/**
 * A new row waiting for a decision, inside the caller's transaction (askRequest, askOvertime, a field punch): its
 * engine request opens under the preset of the chain the company stores for it. When nobody but the person could
 * decide it, it is approved at once and written SELF_APPROVED (SPEC 5.6, as leave); under STRICT maker-checker that
 * is refused (409 NO_APPROVER) and nothing is saved. When the module itself refuses that approval at once, the row
 * waits on the old path and the engine request goes. Answers whether it opened, and whether it is decided already.
 */
export async function openOnEngine(p: { accountId: string; orgId: string; source: TimeSource; sourceId: string; kind?: string | null; employeeId: string; chain: string; title: string; enteredBy: string | null; facts?: Record<string, unknown> }): Promise<{ opened: boolean; done: boolean; refused?: string }> {
  const { accountId, orgId, source } = p;
  if (!(await attendanceOnEngine(orgId))) return { opened: false, done: false };
  const key = PRESET_OF[source][p.chain] || PRESET_OF[source].HR;
  const requestType = typeOf(source, p.kind);
  const rule = await timePresetRule({ accountId, orgId }, requestType, key);
  const person = await peoplePrisma.employee.findFirst({ where: { id: p.employeeId, orgId }, select: { userId: true } });
  const payload = { employeeId: p.employeeId, preset: key, chain: p.chain, kind: p.kind || null, enteredByUserId: p.enteredBy, ...(p.facts || {}) };
  try {
    const out = await openSourced(actorFor(accountId, orgId, p.enteredBy, p.sourceId), {
      requestType, sourceKind: source, sourceId: p.sourceId, subjectEmployeeId: p.employeeId,
      /* The person it is about is who it is for, whoever entered it: they never decide it, and HR who entered it still may (as today). */
      requesterUserId: person?.userId || portalOf(p.employeeId),
      title: p.title, payload, rule,
    });
    return { opened: true, done: out.done };
  } catch (e) {
    const opened = await peoplePrisma.approvalRequest.findFirst({ where: { orgId, sourceKind: source, sourceId: p.sourceId }, select: { id: true } });
    /* Only the module's own refusal turns into "it waits"; the engine's (STRICT) and anything unexpected refuse the request. */
    if (!moduleRefusal(e) || !opened) throw e;
    await peoplePrisma.decisionRecord.deleteMany({ where: { orgId, requestId: opened.id } });
    await peoplePrisma.approvalRequest.delete({ where: { id: opened.id } });
    return { opened: false, done: false, refused: e instanceof Error ? e.message : 'it could not be applied' };
  }
}

/** Who may decide the step waiting now, as of today, and who may step in: worked out again in attendance's words. */
async function liveDeciders(accountId: string, orgId: string, engine: EngineRequest) {
  const source = engine.sourceKind as TimeSource;
  const spec = stepsOfRule(await peoplePrisma.approvalRule.findUnique({ where: { id: engine.ruleId } })).find((x) => x.order === engine.currentStep);
  const waiting = waitingSteps(engine)[0];
  const request: Req = { id: engine.id, requestType: engine.requestType, requesterUserId: engine.requesterUserId, subjectEmployeeId: engine.subjectEmployeeId, payload: engine.payload, sourceKind: engine.sourceKind };
  const day = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const approved = async () => new Set(engine.steps.filter((x) => x.status === 'APPROVED').map((x) => x.decidedByUserId));
  const parts: Resolution[] = [];
  for (const a of spec?.approvers || []) parts.push(await resolveTime(source)({ accountId, orgId }, a, request, day, approved));
  const excluded = await subjectIds(orgId, engine.subjectEmployeeId);
  const stepIn = spec?.stepIn ? (await hrFor(accountId, orgId, source, 'MANAGER', String(engine.subjectEmployeeId), false)).filter((u) => !excluded.has(u)) : [];
  const candidates = [...new Set(parts.flatMap((x) => x.candidates))];
  const standIn = parts.flatMap((x) => x.standIns).find((x) => candidates.includes(x.user));
  /* A step handed to the admins (nobody else could take it) keeps them: they are not worked out again here. */
  if (waiting?.resolvedHow === 'LAST_RESORT' && !candidates.length) return { stepId: waiting.id, candidates: (waiting.candidateUserIds as string[]) || [], stepIn, how: 'LAST_RESORT', standInFor: null as string | null, spec };
  return { stepId: waiting?.id || '', candidates, stepIn, how: parts.find((x) => x.candidates.length)?.how || null, standInFor: standIn ? standIn.for : null, spec };
}

/**
 * One decision on a row the engine decides, by `userId`, inside the caller's People write lock, after the module's
 * own checks passed (they are the same as today's, so whoever they refuse is refused as before). The request is read
 * again under its own lock; a manager's step an older API wrote on the row is caught up (approval only); the step's
 * people are brought up to date; then:
 *  - the decider takes the step, or steps in (`decided`: the engine's request as it is now; the module's write ran in
 *    its hook when the last step closed or the request was rejected);
 *  - a rejection by someone the module allows who is not one of the step's people (HR rejecting while the manager
 *    decides): `direct`, the module writes it, then calls closeOnEngine;
 *  - anything else is not theirs: 403.
 * Answers null when the row is no longer on the engine (decided meanwhile).
 */
export async function decideOnEngine(p: { accountId: string; orgId: string; source: TimeSource; sourceId: string; userId: string; approve: boolean; note: string | null; managerTook?: { at: Date | null; byEmployeeId: string | null } }) {
  const { accountId, orgId, source, sourceId, approve } = p;
  let engine = await engineOf(orgId, source, sourceId);
  if (!onEngine(engine)) return null;
  await peoplePrisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`time-engine:${engine.id}`}))`;
  engine = await engineOf(orgId, source, sourceId);
  if (!onEngine(engine)) return null;
  /* The manager's step written on the row while the engine still waits for it (an older API, during a rollback): taken as theirs, for an approval only. */
  if (approve && p.managerTook?.at && payloadOf(engine).chain === 'MANAGER_THEN_HR' && engine.currentStep === 1) {
    const m = p.managerTook.byEmployeeId ? await peoplePrisma.employee.findFirst({ where: { id: p.managerTook.byEmployeeId, orgId }, select: { id: true, userId: true } }) : null;
    const approvedBy = m ? m.userId || portalOf(m.id) : null;
    await handOnStep(actorFor(accountId, orgId, approvedBy, engine.id), engine.id, { approvedBy, why: approvedBy ? 'The manager approved it on the request itself' : 'Handed on to HR on the request itself' });
    engine = await engineOf(orgId, source, sourceId);
    if (!onEngine(engine)) return null;
  }
  const live = await liveDeciders(accountId, orgId, engine);
  if (live.candidates.length && live.stepId) {
    const moved = await reassignStep(actorFor(accountId, orgId, null, engine.id), engine.id, { stepId: live.stepId, candidates: live.candidates, how: live.how, comment: null, standInFor: live.standInFor });
    if (moved) engine = (await engineOf(orgId, source, sourceId))!;
  }
  const mayStep = live.candidates.includes(p.userId) || (Boolean(live.spec?.stepIn) && live.stepIn.includes(p.userId));
  if (!mayStep) {
    if (!approve) return { direct: true as const, before: engine.currentStep };
    throw fail(403, 'This request is not yours to decide.', 'NOT_YOUR_STEP');
  }
  const before = engine.currentStep;
  const stepKind = live.spec?.approvers.length === 1 ? live.spec.approvers[0].kind : null;
  try {
    const out = await decide(actorFor(accountId, orgId, p.userId, engine.id), engine.id, approve ? 'approve' : 'reject', p.note, { atSource: true });
    const r = out.request as { status: string; currentStep: number };
    /* The manager's step taken, the next one open: the module writes it on its row, as before. */
    return { direct: false as const, status: r.status, managerStep: approve && r.status === 'WAITING' && r.currentStep > before && stepKind === 'MANAGER', before };
  } catch (e) {
    if (e instanceof ApprovalError && e.code === 'ALREADY_DECIDED') throw fail(409, 'This request was already decided.', 'ALREADY_DECIDED');
    if (e instanceof ApprovalError && (e.code === 'NOT_APPROVER' || e.code === 'OWN_REQUEST')) throw fail(403, 'This request is not yours to decide.', 'NOT_YOUR_STEP');
    throw e;
  }
}

/**
 * The row decided, withdrawn or cancelled outside the steps (a rejection the module wrote itself, withdrawn by the
 * person, cancelled by HR, an older API): its engine request closes to match. Idempotent; nothing for a row not on it.
 */
export async function closeOnEngine(accountId: string, orgId: string, source: TimeSource, sourceId: string, status: 'APPROVED' | 'REJECTED' | 'WITHDRAWN', why: string, by: string | null) {
  const r = await peoplePrisma.approvalRequest.findFirst({ where: { orgId, sourceKind: source, sourceId, status: { in: ['WAITING', 'MORE_INFO'] } }, select: { id: true } });
  if (!r) return false;
  return closeAtSource(actorFor(accountId, orgId, by, sourceId), r.id, status, why);
}

/** A row no longer waiting whose engine request still is (an older API decided it during a rollback): closed to match. */
export async function syncFromRow(accountId: string, orgId: string, source: TimeSource, sourceId: string) {
  const row =
    source === ATTENDANCE_SOURCE ? await peoplePrisma.attendanceRequest.findFirst({ where: { id: sourceId, orgId }, select: { status: true, reviewedByUserId: true } })
      : source === OVERTIME_SOURCE ? await peoplePrisma.overtimeRequest.findFirst({ where: { id: sourceId, orgId }, select: { status: true, reviewedByUserId: true } })
        : await peoplePrisma.devicePunch.findFirst({ where: { id: sourceId, orgId }, select: { reviewStatus: true } }).then((x) => (x ? { status: x.reviewStatus || 'APPROVED', reviewedByUserId: null } : null));
  if (!row || row.status === 'PENDING') return false;
  const status = row.status === 'APPROVED' ? 'APPROVED' : row.status === 'REJECTED' ? 'REJECTED' : 'WITHDRAWN';
  return closeOnEngine(accountId, orgId, source, sourceId, status, status === 'WITHDRAWN' ? 'Withdrawn' : `${status === 'APPROVED' ? 'Approved' : 'Rejected'} outside the steps`, row.reviewedByUserId || null);
}

/**
 * A waiting attendance request changed (its days, times or kind's details, not only the reason): its engine request
 * starts again from the first step under the company's chain now, as the chain asks the manager again today.
 */
export async function restartOnEngine(accountId: string, orgId: string, source: TimeSource, sourceId: string, chain: string, by: string) {
  const engine = await engineOf(orgId, source, sourceId);
  if (!onEngine(engine)) return;
  const key = PRESET_OF[source][chain] || PRESET_OF[source].HR;
  const rule = await timePresetRule({ accountId, orgId }, engine.requestType, key);
  await restartSourced(actorFor(accountId, orgId, by, sourceId), engine.id, { sourceId, payload: { ...payloadOf(engine), preset: key, chain }, rule, why: 'Changed while it waited: asked again' });
}

// ---------------------------------------------------------------------------
// What people see: the drawer's step timeline
// ---------------------------------------------------------------------------

const KIND_WORDS: Record<string, string> = { MANAGER: 'manager', HR: 'HR', STAND_IN: 'standing in', HANDED_ON: 'handed on', LAST_RESORT: 'admin' };
const dayOf = (d: Date | null | undefined) => (d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10) : null);

/**
 * A row's engine request as the drawer shows it (SPEC 5.7): one line per step since it was last asked, in order, in
 * plain words ("Ravi Kumar (manager) approved", "Waiting for Asha, Kavya (HR)"), with the date. Null when the row
 * never went on the engine. Deciding is still the module's, so the buttons are as before.
 */
export async function timeStepView(orgId: string, source: TimeSource, sourceId: string) {
  const engine = await engineOf(orgId, source, sourceId);
  if (!engine) return null;
  const since = (engine.payload as { restartedAt?: string } | null)?.restartedAt;
  const steps = engine.steps.filter((s) => s.status !== 'WITHDRAWN' || engine.status === 'WITHDRAWN').filter((s) => !since || s.createdAt >= new Date(since) || (s.decidedAt && s.decidedAt >= new Date(since)) || s.status === 'WAITING');
  const rule = await peoplePrisma.approvalRule.findUnique({ where: { id: engine.ruleId }, select: { name: true, steps: true, requestType: true } });
  const specs = stepsOfRule(rule);
  const names = await namesFor(steps.flatMap((s) => [s.decidedByUserId, ...((s.candidateUserIds as string[]) || [])]).filter(Boolean) as string[], orgId);
  const role = (order: number, how: string | null, stoodIn = false) => {
    if (stoodIn) return ` (${KIND_WORDS.STAND_IN})`;
    const kind = how && KIND_WORDS[how] && how !== 'MANAGER' && how !== 'HR' && how !== 'STAND_IN' ? how : specs.find((x) => x.order === order)?.approvers.length === 1 ? specs.find((x) => x.order === order)!.approvers[0].kind : null;
    return kind && KIND_WORDS[kind] ? ` (${KIND_WORDS[kind]})` : '';
  };
  const lower = (s: string | null) => (s ? `: ${s.charAt(0).toLowerCase()}${s.slice(1)}` : '');
  const timeline: Array<{ order: number; status: string; text: string; on: string | null }> = [];
  for (const s of steps) {
    const who = s.decidedByUserId ? names.get(s.decidedByUserId) || 'Someone' : null;
    const stoodIn = Boolean(s.standInForUserId && s.decidedByUserId !== s.standInForUserId);
    if (s.status === 'APPROVED') timeline.push({ order: s.order, status: s.status, on: dayOf(s.decidedAt), text: s.resolvedHow === 'SELF_APPROVED' ? `${who} approved: nobody else in the company can decide this` : `${who}${role(s.order, s.resolvedHow, stoodIn)} approved` });
    else if (s.status === 'REJECTED') timeline.push({ order: s.order, status: s.status, on: dayOf(s.decidedAt), text: `${who || 'Not approved'}${who ? `${role(s.order, s.resolvedHow, stoodIn)} rejected` : ''}` });
    else if (s.status === 'SKIPPED') timeline.push({ order: s.order, status: s.status, on: dayOf(s.decidedAt), text: `Step ${s.order} skipped${lower(s.comment)}` });
    else if (s.status === 'HANDED_ON') timeline.push({ order: s.order, status: s.status, on: dayOf(s.decidedAt), text: `Step ${s.order} handed on${lower(s.comment)}` });
    else if (s.status === 'WAITING') {
      const people = ((s.candidateUserIds as string[]) || []).map((u) => names.get(u)).filter(Boolean);
      timeline.push({ order: s.order, status: s.status, on: null, text: people.length ? `Waiting for ${people.length > 3 ? `${people.slice(0, 3).join(', ')} and others` : people.join(', ')}${role(s.order, s.resolvedHow)}` : 'Waiting for a decision' });
    }
  }
  return { engine: true, rule: rule?.name || 'Approval', of: specs.length || null, current: onEngine(engine) ? engine.currentStep : null, timeline };
}
