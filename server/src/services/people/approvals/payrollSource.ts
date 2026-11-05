import { peoplePrisma, peopleWrite } from '../../../utils/peoplePrisma.js';
import { payrollPrisma } from '../../../utils/payrollPrisma.js';
import { usersWithPermission } from '../../notifications.js';
import type { Actor } from '../changeLog.js';
import {
  ApprovalError, closeAtSource, decide, handOnStep, onSource, openSourced, reassignStep, restartSourced, reverseSourced,
  type Req, type Resolution,
} from './engine.js';
import { payrollPresetRule } from './presets.js';

/**
 * Payroll's approvals on the approval engine (docs/people/workflow-engine/SPEC.md section 9, phase 3a; 7.5): loans,
 * salary revisions and final settlements. Built as leave (2c) and attendance (2d) were.
 *
 * Behind one switch per company (PeopleSetting.payrollOnEngine, Company choices, owner or admin), off by default. With
 * it on, a new loan, a revision sent for approval and a new settlement open an engine request (`sourceKind` LOAN,
 * SALARY_REVISION or FINAL_SETTLEMENT, `sourceId` the Payroll row) under the preset that copies Payroll's rule
 * (presets.ts PAYROLL_PRESETS): one step, whoever holds the type's Payroll approve right, the person it is about taken
 * out. Payroll keeps its row, its states and its checks, exactly as before:
 *
 *  - the route runs its own checks first, word for word (the state, your own record, maker-checker with its
 *    SELF_APPROVED audit, the authenticator code for settlements), so whoever Payroll refuses is refused as before;
 *  - then it asks the engine whether this person may decide the step waiting now (askPayrollEngine), which answers
 *    in Payroll's words: whoever holds the right (the route's guard has just said the person signed in does);
 *  - Payroll writes its approval as before (its own database, its own race guard), and only then is the step
 *    recorded (recordOnPayrollEngine). The two databases cannot share a transaction, so the order is the one that
 *    leaves a state the next look can finish: a Payroll approval whose step was not recorded (the process stopped in
 *    between) is caught up from the row by syncPayrollEngine, as the person Payroll names as approver;
 *  - nobody decides their own loan, revision or settlement (owner's decision, 4 Nov 2026); someone alone in the
 *    company whom Payroll lets decide their own under the maker-checker setting (`ownAllowed`) writes it directly and
 *    the engine request closes to match ("direct"), as attendance's own requests.
 *
 * Ones already waiting when the switch goes on finish on the old path. The engine sends no notices (Payroll sends
 * none for these today) and no reminders.
 */

export const LOAN_SOURCE = 'LOAN';
export const REVISION_SOURCE = 'SALARY_REVISION';
export const SETTLEMENT_SOURCE = 'FINAL_SETTLEMENT';
export type PayrollSource = typeof LOAN_SOURCE | typeof REVISION_SOURCE | typeof SETTLEMENT_SOURCE;
export const PAYROLL_SOURCES: PayrollSource[] = [LOAN_SOURCE, REVISION_SOURCE, SETTLEMENT_SOURCE];

/** The right that approves each in Payroll today (routes/payrollLoans.ts, payrollRevisions.ts, payrollSettlements.ts). */
export const PAYROLL_SOURCE_RIGHT: Record<PayrollSource, string> = {
  LOAN: 'PAYROLL::Payroll Loans::APPROVE',
  SALARY_REVISION: 'PAYROLL::Salary Revisions::APPROVE',
  FINAL_SETTLEMENT: 'PAYROLL::Payroll Runs::APPROVE',
};

const portalOf = (employeeId: string) => `portal:${employeeId}`;

export class PayrollEngineRefusal extends Error {
  constructor(message: string, public status = 403, public code = 'NOT_YOUR_STEP') {
    super(message);
  }
}

/** Is this company's new Payroll approval decided through the engine? */
export async function payrollOnEngine(orgId: string) {
  return Boolean((await peoplePrisma.peopleSetting.findUnique({ where: { orgId }, select: { payrollOnEngine: true } }))?.payrollOnEngine);
}

const stepOrder = { steps: { orderBy: [{ order: 'asc' as const }, { createdAt: 'asc' as const }, { slot: 'asc' as const }, { id: 'asc' as const }] } };

/** The engine request a Payroll row belongs to; null when it has none (the old path). */
export async function engineOf(orgId: string, source: PayrollSource, sourceId: string) {
  return peoplePrisma.approvalRequest.findFirst({ where: { orgId, sourceKind: source, sourceId }, include: stepOrder });
}
type EngineRequest = NonNullable<Awaited<ReturnType<typeof engineOf>>>;

/** Still the engine's to decide: waiting with a step open. One closed (decided, withdrawn, an older API) is not, so the row goes on the old path. */
export const onEngine = (r: EngineRequest | null): r is EngineRequest => Boolean(r && r.status === 'WAITING' && r.steps.some((s) => s.status === 'WAITING'));

/** The person it is about, as a user and in the employee app: never one of the step's people. */
async function subjectIds(orgId: string, employeeId: string | null) {
  if (!employeeId) return new Set<string>();
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { userId: true } });
  return new Set([portalOf(employeeId), ...(e?.userId ? [e.userId] : [])]);
}

/** Whoever holds the type's Payroll approve right (administrators hold every right), the person it is about taken out; `also`: someone the route's own guard has just let in. */
async function deciders(accountId: string, orgId: string, source: PayrollSource, employeeId: string | null, also: string | null = null) {
  const excluded = await subjectIds(orgId, employeeId);
  const all = [...new Set([...(await usersWithPermission(accountId, orgId, PAYROLL_SOURCE_RIGHT[source])), ...(also ? [also] : [])])];
  return { all, candidates: all.filter((u) => !excluded.has(u)), excluded };
}

for (const source of PAYROLL_SOURCES) {
  onSource(source, {
    /* Payroll's words for its one approver kind; any other kind (none in the preset) finds nobody. */
    resolve: async (who, approver, request: Req): Promise<Resolution> => {
      if (approver.kind !== 'PAYROLL') return { primary: [], standIns: [], all: [], candidates: [], how: null, notes: [] };
      const { all, candidates } = await deciders(who.accountId, who.orgId, source, request.subjectEmployeeId);
      return { primary: all, standIns: [], all, candidates, how: 'PAYROLL', notes: [] };
    },
    /* No step-in: Payroll has none. */
    stepIn: async () => [],
    /*
     * Nobody else holds the right (the owner's own revision when they alone approve pay): never the admins or a People
     * approver without the Payroll right. The engine then refuses to open it (5.6: your own pay is never
     * self-approved) and the row stays on the old path, which refuses its approval as today.
     */
    lastResort: async () => [],
    /* No reminders (Payroll has none); a row decided elsewhere meanwhile closes its request. */
    overdue: async (step) => {
      const r = await peoplePrisma.approvalRequest.findFirst({ where: { id: step.requestId, orgId: step.orgId }, include: stepOrder });
      if (onEngine(r) && r.sourceId) await syncPayrollEngine(step.accountId, step.orgId, source, r.sourceId);
      return null;
    },
  });
}

const actorFor = (accountId: string, orgId: string, userId: string | null, correlationId: string): Actor => ({ accountId, orgId, userId, source: 'FORM', correlationId });

/**
 * A Payroll row now waiting for approval (a new loan, a revision sent for approval, a new settlement): with the
 * company's switch on, its engine request opens (or, for a revision edited back to draft and sent again, opens again).
 * Called after Payroll's own write committed. Never fails Payroll's request: when the engine cannot open it (nobody but
 * the person it is about could approve it) or anything else goes wrong, the row is simply on the old path, which is
 * what it would have been with the switch off. Answers whether it is on the engine.
 */
export async function openOnPayrollEngine(p: { accountId: string; orgId: string; source: PayrollSource; sourceId: string; employeeId: string; title: string; by: string | null; facts?: Record<string, unknown> }): Promise<boolean> {
  const { accountId, orgId, source, sourceId } = p;
  try {
    if (!(await payrollOnEngine(orgId))) return false;
    return await peopleWrite(orgId, async () => {
      const rule = await payrollPresetRule({ accountId, orgId }, source);
      const payload = { employeeId: p.employeeId, preset: 'PAYROLL', ...(p.facts || {}) };
      const actor = actorFor(accountId, orgId, p.by, sourceId);
      const existing = await engineOf(orgId, source, sourceId);
      const person = await peoplePrisma.employee.findFirst({ where: { id: p.employeeId, orgId }, select: { userId: true } });
      if (existing) {
        if (existing.status === 'WAITING' && existing.subjectEmployeeId === p.employeeId) return true;
        const subject = { subjectEmployeeId: p.employeeId, requesterUserId: person?.userId || portalOf(p.employeeId), title: p.title };
        return Boolean(await restartSourced(actor, existing.id, { sourceId, payload, rule, why: 'Sent for approval again', reopen: true, subject }));
      }
      await openSourced(actor, {
        requestType: source, sourceKind: source, sourceId, subjectEmployeeId: p.employeeId,
        /* Who it is about is who it is for, whoever prepared it: they never decide it, and the preparer still may, as maker-checker allows (as today). */
        requesterUserId: person?.userId || portalOf(p.employeeId),
        title: p.title, payload, rule,
      });
      return true;
    });
  } catch (e) {
    if (!(e instanceof ApprovalError)) console.error(`[payroll-engine] ${orgId}: ${source} ${sourceId} not opened on the engine:`, e instanceof Error ? e.message : e); // eslint-disable-line no-console
    return false;
  }
}

/** The answer to "may this user decide the step waiting now?": take the step, or write it directly (the person it is about, alone, as Payroll allowed). Null: not on the engine. */
export type PayrollAsk = { engineId: string; take: 'STEP' | 'DIRECT' } | null;

/**
 * Asked by Payroll's approve and reject routes after their own checks passed and before they write. The route's guard
 * has already said the person holds the right, so they are one of the step's people unless the row is about them;
 * then it is theirs only when Payroll's own check let them (`ownAllowed`: nobody else in the company could, and the
 * maker-checker setting allows it), and otherwise refused (403 NOT_YOUR_STEP).
 */
export async function askPayrollEngine(p: { accountId: string; orgId: string; source: PayrollSource; sourceId: string; userId: string; approve: boolean; ownAllowed?: boolean }): Promise<PayrollAsk> {
  /* Decided on the row meanwhile (an older API, or a step not recorded): brought in line first, then the old path. */
  await syncPayrollEngine(p.accountId, p.orgId, p.source, p.sourceId);
  const engine = await engineOf(p.orgId, p.source, p.sourceId);
  if (!engine || !onEngine(engine)) return null;
  const { candidates, excluded } = await deciders(p.accountId, p.orgId, p.source, engine.subjectEmployeeId, p.userId);
  if (candidates.includes(p.userId)) return { engineId: engine.id, take: 'STEP' };
  if (excluded.has(p.userId) && p.ownAllowed) return { engineId: engine.id, take: 'DIRECT' };
  throw new PayrollEngineRefusal('This is not yours to decide.');
}

/**
 * After Payroll's write committed: the step recorded as this person's decision (its people brought up to date first,
 * this person among them, as the route's guard said), or, for the person it is about alone in the company, taken by
 * them outside the step's people. Never fails Payroll's request: the write stands, and a step not recorded is caught
 * up from the row (syncPayrollEngine) when the row is next asked about, or by the engine's dues job.
 */
export async function recordOnPayrollEngine(p: { accountId: string; orgId: string; source: PayrollSource; sourceId: string; userId: string; approve: boolean; note?: string | null; ask: PayrollAsk }) {
  const { accountId, orgId, ask } = p;
  if (!ask) return;
  try {
    await peopleWrite(orgId, async () => {
      const engine = await engineOf(orgId, p.source, p.sourceId);
      if (!onEngine(engine) || engine.id !== ask.engineId) return;
      const actor = actorFor(accountId, orgId, p.userId, engine.id);
      if (ask.take === 'DIRECT') {
        if (p.approve) await handOnStep(actor, engine.id, { approvedBy: p.userId, why: 'Approved by the person it is about: nobody else in the company can approve it' });
        else await closeAtSource(actor, engine.id, 'REJECTED', 'Rejected by the person it is about: nobody else in the company can decide it');
        return;
      }
      const { candidates } = await deciders(accountId, orgId, p.source, engine.subjectEmployeeId, p.userId);
      const waiting = engine.steps.find((s) => s.order === engine.currentStep && s.status === 'WAITING');
      if (waiting) await reassignStep(actor, engine.id, { stepId: waiting.id, candidates, how: 'PAYROLL', comment: null, standInFor: null });
      await decide(actor, engine.id, p.approve ? 'approve' : 'reject', p.note ?? null, { atSource: true });
    });
  } catch (e) {
    console.error(`[payroll-engine] ${orgId}: ${p.source} ${p.sourceId} decided in Payroll, its step not recorded yet:`, e instanceof Error ? e.message : e); // eslint-disable-line no-console
  }
}

/**
 * The draft is now about someone else (a loan moved to another person while a draft): its request starts again about
 * them, with their name and their own-record rule. When nobody but the new person could approve it, the request is
 * withdrawn and the row goes on the old path, which refuses or allows it as Payroll does. Called whatever the switch
 * says: a request already open must follow its row. Never fails Payroll's request.
 */
export async function resubjectOnPayrollEngine(p: { accountId: string; orgId: string; source: PayrollSource; sourceId: string; employeeId: string; title: string; by: string | null; facts?: Record<string, unknown> }) {
  const { accountId, orgId, source, sourceId } = p;
  try {
    const engine = await engineOf(orgId, source, sourceId);
    if (!engine || engine.status !== 'WAITING' || engine.subjectEmployeeId === p.employeeId) return false;
    try {
      return await peopleWrite(orgId, async () => {
        const rule = await payrollPresetRule({ accountId, orgId }, source);
        const person = await peoplePrisma.employee.findFirst({ where: { id: p.employeeId, orgId }, select: { userId: true } });
        const subject = { subjectEmployeeId: p.employeeId, requesterUserId: person?.userId || portalOf(p.employeeId), title: p.title };
        return Boolean(await restartSourced(actorFor(accountId, orgId, p.by, sourceId), engine.id, { sourceId, payload: { employeeId: p.employeeId, preset: 'PAYROLL', ...(p.facts || {}) }, rule, why: 'Now about someone else: asked again', subject }));
      });
    } catch (e) {
      if (!(e instanceof ApprovalError)) throw e;
      await peopleWrite(orgId, () => closeAtSource(actorFor(accountId, orgId, p.by, sourceId), engine.id, 'WITHDRAWN', 'Now about someone nobody else can approve for: decided in Payroll'));
      return false;
    }
  } catch (e) {
    console.error(`[payroll-engine] ${orgId}: ${source} ${sourceId} not moved to its new person on the engine:`, e instanceof Error ? e.message : e); // eslint-disable-line no-console
    return false;
  }
}

/**
 * The row stopped waiting outside a decision, or was reversed after approval: a waiting request is withdrawn (cancelled,
 * or a revision edited back to draft); an approved one is closed as reversed, with who did it and why (a loan or
 * settlement cancelled once approved: WITHDRAWN; a revision rejected once approved: REJECTED). Idempotent; nothing for
 * a row not on the engine. Never fails Payroll's request.
 */
export async function withdrawOnPayrollEngine(accountId: string, orgId: string, source: PayrollSource, sourceId: string, why: string, by: string | null, after: { status: 'REJECTED' | 'WITHDRAWN'; why: string } = { status: 'WITHDRAWN', why: 'Cancelled in Payroll after approval' }) {
  try {
    const engine = await engineOf(orgId, source, sourceId);
    if (!engine) return false;
    const actor = actorFor(accountId, orgId, by, sourceId);
    if (engine.status === 'APPROVED') return await peopleWrite(orgId, () => reverseSourced(actor, engine.id, after.status, after.why));
    if (!['WAITING', 'MORE_INFO'].includes(engine.status)) return false;
    return await peopleWrite(orgId, () => closeAtSource(actor, engine.id, 'WITHDRAWN', why));
  } catch (e) {
    console.error(`[payroll-engine] ${orgId}: ${source} ${sourceId} not closed on the engine:`, e instanceof Error ? e.message : e); // eslint-disable-line no-console
    return false;
  }
}

/** Where the Payroll row stands: still waiting for approval, approved (by whom), rejected or withdrawn. */
async function rowState(orgId: string, source: PayrollSource, sourceId: string): Promise<{ state: 'WAITING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'; by: string | null } | null> {
  if (source === LOAN_SOURCE) {
    const r = await payrollPrisma.payrollLoan.findFirst({ where: { orgId, id: sourceId }, select: { status: true, approvedByUserId: true } });
    if (!r) return null;
    return { state: r.status === 'CANCELLED' ? 'WITHDRAWN' : r.status === 'ACTIVE' || r.status === 'COMPLETED' ? 'APPROVED' : 'WAITING', by: r.approvedByUserId };
  }
  if (source === REVISION_SOURCE) {
    const r = await payrollPrisma.salaryRevision.findFirst({ where: { orgId, id: sourceId }, select: { status: true, approvedByUserId: true } });
    if (!r) return null;
    const state = r.status === 'REVIEWED' ? 'WAITING' : r.status === 'APPROVED' || r.status === 'APPLIED' ? 'APPROVED' : r.status === 'REJECTED' ? 'REJECTED' : 'WITHDRAWN';
    return { state, by: r.approvedByUserId };
  }
  const r = await payrollPrisma.finalSettlement.findFirst({ where: { orgId, id: sourceId }, select: { status: true, approvedByUserId: true } });
  if (!r) return null;
  return { state: r.status === 'DRAFT' ? 'WAITING' : r.status === 'APPROVED' || r.status === 'PAID' ? 'APPROVED' : 'WITHDRAWN', by: r.approvedByUserId };
}

/**
 * An engine request out of line with its Payroll row: still waiting while the row was decided (a step not recorded
 * after Payroll's write, an older API during a rollback), taken as the person Payroll names as approver; or approved
 * while the row was reversed since, closed as reversed. Answers whether it moved.
 */
export async function syncPayrollEngine(accountId: string, orgId: string, source: PayrollSource, sourceId: string) {
  try {
    const engine = await engineOf(orgId, source, sourceId);
    if (!engine) return false;
    const row = await rowState(orgId, source, sourceId);
    if (!row || row.state === 'WAITING') return false;
    /* Approved on the engine, reversed in Payroll since (an older API): closed as reversed. */
    if (engine.status === 'APPROVED') {
      if (row.state === 'APPROVED') return false;
      return await peopleWrite(orgId, () => reverseSourced(actorFor(accountId, orgId, null, engine.id), engine.id, row.state === 'REJECTED' ? 'REJECTED' : 'WITHDRAWN', row.state === 'REJECTED' ? 'Rejected in Payroll after approval' : 'Cancelled in Payroll after approval'));
    }
    if (!onEngine(engine)) return false;
    return await peopleWrite(orgId, async () => {
      const actor = actorFor(accountId, orgId, row.by, engine.id);
      if (row.state === 'APPROVED' && row.by) return handOnStep(actor, engine.id, { approvedBy: row.by, why: 'Approved in Payroll' });
      const status = row.state as 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
      return closeAtSource(actor, engine.id, status, row.state === 'REJECTED' ? 'Rejected in Payroll' : row.state === 'APPROVED' ? 'Approved in Payroll' : 'Withdrawn in Payroll');
    });
  } catch (e) {
    console.error(`[payroll-engine] ${orgId}: ${source} ${sourceId} not brought in line:`, e instanceof Error ? e.message : e); // eslint-disable-line no-console
    return false;
  }
}
