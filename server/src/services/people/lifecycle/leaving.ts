import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { outsideTenant, runInTenant } from '../../../utils/tenantScope.js';
import { revokeFromReaders } from '../../attendance/readerSync.js';
import { exclusive, leaseFor } from '../../jobLease.js';
import { notifyPermission } from '../../notifications.js';
import { closeEpisode } from '../episodes.js';
import { recordChanges } from '../employmentHistory.js';
import { startChecklist } from '../checklists.js';
import { settleReaderTask } from './readersDone.js';
import { writeEvent } from '../outbox.js';
import { closeOutFor } from './closeOut.js';
import { peopleEvent } from '../documentReminders.js';
import { employeeStatusChanged } from '../../portalSessions.js';
import { activeRule, saveRule, submitRequest } from '../approvals/engine.js';
import { writeChangeLog, type Actor } from '../changeLog.js';
import { registerJob } from '../../jobRegistry.js';

/**
 * Someone leaves (docs/people/02-PRD.md LIFE-05): the last day, how and why.
 * One function for the form, for an approved leaving request and for the
 * day the notice ends. A last day today or ahead puts the person on notice
 * (the last day is worked): the leaving plan starts,
 * `people.employee.separation_scheduled.v1` goes out, and the hourly job
 * finishes it the day after. A last day already past finishes at once:
 * status Left, the stint closed, history, door access and employee-app
 * sessions ended, and `people.employee.separated.v1` written once, with the
 * notice owed and served. No app consumes that event yet: Payroll reads the
 * employee record for the final settlement.
 */
/**
 * Who records it. An approved request passes the whole actor (source APPROVAL
 * with the request and decision ids): the leaving is then written to the
 * change log with those ids, so it traces back to the request (E16).
 */
type Who = { accountId: string; orgId: string; userId: string | null } & Partial<Pick<Actor, 'source' | 'correlationId' | 'reason' | 'requestId' | 'decisionId'>>;

/** Change-log lines for the leaving, only when an approved request recorded it. */
async function logApproved(tx: Parameters<typeof writeChangeLog>[0], who: Who, existing: Existing, after: { status: string; dateOfLeaving: string | null; leavingType: string | null; leavingReason: string | null }) {
  if (!who.requestId) return;
  const actor: Actor = { accountId: who.accountId, orgId: who.orgId, userId: who.userId, source: who.source || 'APPROVAL', correlationId: who.correlationId || who.requestId, reason: who.reason ?? null, requestId: who.requestId, decisionId: who.decisionId ?? null };
  const lines = (['status', 'dateOfLeaving', 'leavingType', 'leavingReason'] as const)
    .map((field) => ({ field, before: (existing[field] as string | null | undefined) ?? null, after: after[field] ?? null, redacted: false }))
    .filter((c) => c.before !== c.after);
  await writeChangeLog(tx, actor, { kind: 'Employee', id: existing.id, employeeId: existing.id }, lines);
}
const viaRequest = (who: Who) => (who.requestId ? ' (approved request)' : '');
export const LEAVING_TYPES = ['RESIGNED', 'TERMINATED', 'RETIRED', 'ABSCONDED', 'CONTRACT_ENDED', 'DECEASED', 'NOT_JOINED', 'DUPLICATE'] as const;
/* Someone who never came, or a second record of the same person: closed, but no final settlement is asked of Payroll (Workforce final audit W5, W16). */
export const NO_SETTLEMENT = new Set(['NOT_JOINED', 'DUPLICATE']);
const todayIst = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

type Existing = { id: string; status: string; code: string | null; devicePin: string | null; name?: string | null; currentEpisodeSeq?: number | null; dateOfJoining?: string | null; createdAt?: Date | null } & Record<string, unknown>;
type Input = { lastDay: string; leavingType: string; reason: string | null; resignedOn?: string | null; noticeWaived?: boolean };

/* Notice owed, served and short (W15): from the employment type's notice days and the day the resignation came. Payroll recovers or waives from these. */
async function noticeOf(orgId: string, existing: Existing, input: Input) {
  const typeId = existing.employeeTypeId as string | null | undefined;
  const owed = typeId ? (await peoplePrisma.employeeType.findFirst({ where: { id: typeId, orgId }, select: { noticeDays: true } }))?.noticeDays ?? null : null;
  const from = input.resignedOn || null;
  const served = from ? Math.max(0, Math.round((Date.parse(`${input.lastDay}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1) : null;
  const short = owed != null && served != null && !input.noticeWaived ? Math.max(0, owed - served) : null;
  return { noticeDays: owed, resignedOn: from, servedDays: served, shortfallDays: short, noticeWaived: Boolean(input.noticeWaived) };
}

export async function leaveEmployee(who: Who, existing: Existing, input: Input, opts: { now?: Date } = {}) {
  /* The last working day is worked: someone whose last day is today stays on notice, on the doors and in attendance until it is over (W-A1). An offer withdrawn or a duplicate closes at once. */
  if (input.lastDay >= todayIst(opts.now) && !NO_SETTLEMENT.has(input.leavingType)) return scheduleLeaving(who, existing, input);
  return finishLeaving(who, existing, input);
}

/** On notice: the date goes on the record, the plan starts, other apps hear it is coming; the person stays active until the day. */
async function scheduleLeaving(who: Who, existing: Existing, input: Input) {
  const { accountId, orgId } = who;
  const employee = await peoplePrisma.$transaction(async (tx) => {
    const row = await tx.employee.update({ where: { id: existing.id }, data: { status: 'ON_NOTICE', dateOfLeaving: input.lastDay, leavingType: input.leavingType, leavingReason: input.reason, ...(input.resignedOn !== undefined ? { resignedOn: input.resignedOn } : {}), ...(input.noticeWaived !== undefined ? { noticeWaived: input.noticeWaived } : {}) } });
    await logApproved(tx, who, existing, row);
    await writeEvent(tx, { accountId, orgId, correlationId: `leave_${row.id}_${input.lastDay}` }, 'people.employee.separation_scheduled.v1', { lastWorkingDay: input.lastDay, type: input.leavingType, employee: { id: row.id, code: row.code, name: row.name } }, row.id);
    return row;
  });
  await recordChanges({ accountId, orgId, userId: who.userId }, existing, employee, { source: 'RESIGNATION', effectiveDate: input.lastDay, note: `On notice until ${input.lastDay}: ${input.reason || input.leavingType.replace(/_/g, ' ').toLowerCase()}${viaRequest(who)}` });
  await startChecklist({ accountId, orgId, userId: who.userId }, employee, 'LEAVING', input.lastDay);
  await successorsFor(who, employee, input.lastDay);
  return { employee, readers: 0, scheduled: true as const };
}

/** The day has come, or was already past: gone from the record, the doors and the app, and other apps told once. */
async function finishLeaving(who: Who, existing: Existing, input: Input) {
  const { accountId, orgId } = who;
  const employee = await peoplePrisma.$transaction(async (tx) => {
    const row = await tx.employee.update({
      where: { id: existing.id },
      data: { status: 'LEFT', dateOfLeaving: input.lastDay, leavingType: input.leavingType, leavingReason: input.reason, ...(input.resignedOn !== undefined ? { resignedOn: input.resignedOn } : {}), ...(input.noticeWaived !== undefined ? { noticeWaived: input.noticeWaived } : {}) },
    });
    await logApproved(tx, who, existing, row);
    await closeEpisode({ accountId, orgId }, existing, { endDate: input.lastDay, endType: input.leavingType, endReason: input.reason }, tx);
    await writeEvent(tx, { accountId, orgId, correlationId: `leave_${row.id}_${input.lastDay}` }, 'people.employee.separated.v1', { lastWorkingDay: input.lastDay, type: input.leavingType, settlementRequested: !NO_SETTLEMENT.has(input.leavingType), notice: await noticeOf(orgId, { ...existing, ...row } as any, { ...input, resignedOn: input.resignedOn ?? row.resignedOn, noticeWaived: input.noticeWaived ?? row.noticeWaived }), employee: { id: row.id, code: row.code, name: row.name } }, row.id);
    return row;
  });
  /* A-33: gone, their employee-app sign-ins end. */
  await employeeStatusChanged(employee, existing.status, 'LEFT', who.userId ? { type: 'USER', id: who.userId } : { type: 'SYSTEM', label: 'leaving' });
  await recordChanges({ accountId, orgId, userId: who.userId }, existing, employee, { source: 'RESIGNATION', effectiveDate: input.lastDay, note: `${existing.status === 'ON_NOTICE' ? 'Last working day reached' : input.reason || input.leavingType.replace(/_/g, ' ').toLowerCase()}${viaRequest(who)}` });
  const removed = await revokeFromReaders(orgId, existing, who.userId);
  const actor: Actor = { accountId, orgId, userId: who.userId, source: who.source || 'SYSTEM', correlationId: who.correlationId || `leave_${employee.id}_${input.lastDay}`, reason: `${employee.name} left` };
  /* Nothing goes on acting on them: dated changes and requests closed, their team moved up a line, their position freed (W1, W4, W12). */
  await closeOutFor(actor, employee.id);
  /* A profile link sent to them stops working (W5). */
  await peoplePrisma.joinInvite.updateMany({ where: { orgId, employeeId: employee.id, status: { in: ['SENT', 'STARTED'] } }, data: { status: 'EXPIRED' } });
  if (NO_SETTLEMENT.has(input.leavingType)) {
    /* Never came, or not a real second person: their joining plan is closed as not needed, and no leaving plan starts. */
    await peoplePrisma.checklistTask.updateMany({ where: { orgId, employeeId: employee.id, doneAt: null }, data: { doneAt: new Date(), doneByUserId: who.userId, note: input.leavingType === 'NOT_JOINED' ? 'Not needed: did not join.' : 'Not needed: duplicate record.' } });
    return { employee, readers: removed.readers, scheduled: false as const };
  }
  await startChecklist({ accountId, orgId, userId: who.userId }, employee, 'LEAVING', input.lastDay);
  await successorsFor(who, employee, input.lastDay);
  /* The removal is queued, not done: the reader task waits until every reader confirms (JCL-A02; lifecycle/readersDone.ts). */
  await settleReaderTask({ accountId, orgId, userId: who.userId }, employee, removed);
  /* A CLOR sign-in is not turned off by CLOR on its own (it may also be someone's admin access): HR gets the task (W-A5). */
  if (employee.userId && !(await peoplePrisma.checklistTask.count({ where: { orgId, employeeId: employee.id, kind: 'LEAVING', title: { startsWith: 'Turn off' } } }))) {
    await startChecklist({ accountId, orgId, userId: who.userId }, employee, 'LEAVING', input.lastDay, { items: [{ title: `Turn off ${employee.name}’s CLOR sign-in`, owner: 'HR', dueDays: 0, note: 'Settings, Users & Security. Hand their approvals and tasks to someone first.' }] });
  }
  /* Who looks after people hears it, however the leaving came about: the form, an approval or the notice running out (W-A14). */
  void peopleEvent(accountId, orgId, 'people.left', employee, who.userId);
  return { employee, readers: removed.readers, scheduled: false as const };
}

/** The day the notice ends: everyone on notice whose last day has come leaves now. Returns how many. */
export async function runSeparations(now = new Date()) {
  const today = todayIst(now);
  /* The day after the last working day (W-A1); a leaving type is not required (a record put on notice another way still leaves, as Resigned) (W-A2). */
  const due = await outsideTenant('job: separations', () => peoplePrisma.employee.findMany({ where: { status: 'ON_NOTICE', dateOfLeaving: { not: null, lt: today } }, select: { id: true, orgId: true, accountId: true } }));
  let done = 0;
  for (const e of due) {
    /* One bad record must not stop everyone else's leaving, in any company (W-A9). */
    try {
      await runInTenant(e.orgId, async () => {
        const existing = await peoplePrisma.employee.findFirst({ where: { id: e.id, orgId: e.orgId } });
        if (!existing || existing.status !== 'ON_NOTICE' || !existing.dateOfLeaving) return;
        await finishLeaving({ accountId: e.accountId, orgId: e.orgId, userId: null }, existing as any, { lastDay: existing.dateOfLeaving, leavingType: existing.leavingType || 'RESIGNED', reason: existing.leavingReason });
        done += 1;
      });
    } catch (err) {
      console.error(`[separations] ${e.orgId} ${e.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return done;
}

export function startSeparations({ intervalMs = 60 * 60_000, startupDelayMs = 120_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () => exclusive('people.separations', leaseFor(intervalMs), () => runSeparations()).catch((e) => console.error('[separations] failed:', e instanceof Error ? e.message : e));
  registerJob('startSeparations', tick, intervalMs);
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}

export class ResignError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** The person resigns from the employee app: a LEAVING request; without a rule, a default one is made (manager, then HR). */
export async function resignFromApp(who: { accountId: string; orgId: string; employeeId: string; userId: string | null; correlationId: string }, input: { lastDay?: string; reason?: string | null }) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: who.employeeId, orgId: who.orgId } });
  if (!e) throw new ResignError('No such person.', 404);
  /* A person with a CLOR sign-in asks as that user; otherwise as the employee app's `portal:<id>`. */
  const requester = who.userId || e.userId || `portal:${e.id}`;
  if (e.status === 'LEFT') throw new ResignError('You have already left.', 409);
  if (e.status === 'ON_NOTICE') throw new ResignError(`Your last day is already on record: ${e.dateOfLeaving}. Ask HR to change it.`, 409);
  const lastDay = String(input.lastDay || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) throw new ResignError('Say your last working day (YYYY-MM-DD).');
  if (lastDay < todayIst()) throw new ResignError('The last day cannot be in the past.');
  const open = await peoplePrisma.approvalRequest.findFirst({ where: { orgId: who.orgId, subjectEmployeeId: e.id, requestType: 'LEAVING', status: { in: ['WAITING', 'MORE_INFO'] } }, select: { id: true } });
  if (open) throw new ResignError('Your resignation is already with HR.', 409);
  if (!(await activeRule(who.orgId, 'LEAVING'))) {
    await saveRule({ accountId: who.accountId, orgId: who.orgId, userId: null }, 'LEAVING', 'Resignations (default: manager, then HR)', [
      { order: 1, approver: { kind: 'MANAGER' }, dueDays: 3, overdue: { action: 'HAND_ON', to: { kind: 'HR' } } },
      { order: 2, approver: { kind: 'HR' }, dueDays: 3, overdue: { action: 'REMIND' } },
    ]);
  }
  const reason = String(input.reason || '').trim().slice(0, 1000) || null;
  const r = await submitRequest({ accountId: who.accountId, orgId: who.orgId, userId: requester, source: 'SELF_SERVICE', correlationId: who.correlationId, reason }, {
    requestType: 'LEAVING', subjectEmployeeId: e.id, title: `${e.name}: resignation, last day ${lastDay}`, payload: { employeeId: e.id, lastDay, leavingType: 'RESIGNED', reason },
  });
  await notifyPermission(who.accountId, who.orgId, 'PEOPLE::Employees::EDIT', { kind: 'people.resignation', title: `${e.name} has resigned; last day ${lastDay}`, body: reason || 'No reason given.', link: { app: 'people', screen: 'approvals' } as any }).catch(() => undefined);
  return { request: { id: r.request.id, status: r.request.status, title: r.request.title }, outcome: r.outcome ?? null };
}

/* A department head or team lead leaving: HR is asked who takes over (Organization). Never blocks the leaving. */
async function successorsFor(who: Who, employee: { id: string; name: string }, lastDay: string) {
  const { successorTasks } = await import('../organization.js');
  await successorTasks({ accountId: who.accountId, orgId: who.orgId, userId: who.userId }, employee, lastDay).catch((e) => console.error('[leaving] successor tasks:', e instanceof Error ? e.message : e));
}
