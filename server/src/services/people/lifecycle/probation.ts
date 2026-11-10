import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { notifyUsers } from '../../notifications.js';
import type { Actor } from '../changeLog.js';
import { updateEmployee } from '../employees.js';
import { writeEvent } from '../outbox.js';
import { leaveEmployee } from './leaving.js';
import { activeRule, submitRequest } from '../approvals/engine.js';
import { todayIst } from '../../../utils/istDate.js';
import { issueOnEvent, stintKey } from '../letters.js';

/**
 * Probation (docs/people/02-PRD.md LIFE-03). A review names the period, the
 * goals, what was seen and a recommendation; deciding it confirms the
 * person, extends the period to a new date, or ends the employment. Where
 * the company has a PROBATION approval rule the decision is a request;
 * otherwise whoever may edit the person decides at once. Every outcome goes
 * through the one write path and the person is told.
 */

export const PROBATION_OUTCOMES = ['CONFIRM', 'EXTEND', 'END'] as const;
export type ProbationOutcome = (typeof PROBATION_OUTCOMES)[number];

export class ProbationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function saveReview(actor: Actor, employeeId: string, input: { goals?: string | null; observations?: string | null; recommendation?: ProbationOutcome | null; newEndDate?: string | null; note?: string | null }) {
  const employee = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId: actor.orgId } });
  if (!employee) throw new ProbationError('No such employee.', 404);
  if (!employee.probationEndDate) throw new ProbationError('This person has no probation end date on file; set one first.', 409);
  if (employee.confirmedOn) throw new ProbationError(`Already confirmed on ${employee.confirmedOn}.`, 409);
  const open = await peoplePrisma.probationReview.findFirst({ where: { orgId: actor.orgId, employeeId, outcome: null }, orderBy: { createdAt: 'desc' } });
  const data = { goals: input.goals ?? null, observations: input.observations ?? null, recommendation: input.recommendation ?? null, newEndDate: input.newEndDate ?? null, note: input.note ?? null, reviewedByUserId: actor.userId };
  return open
    ? peoplePrisma.probationReview.update({ where: { id: open.id }, data })
    : peoplePrisma.probationReview.create({ data: { accountId: actor.accountId, orgId: actor.orgId, employeeId, periodEnd: employee.probationEndDate, ...data } });
}

/** Apply an outcome now: the effect behind a decision, with or without a request. */
export async function applyOutcome(actor: Actor, employeeId: string, outcome: ProbationOutcome, opts: { newEndDate?: string | null; note?: string | null; lastDay?: string | null; requestId?: string | null }) {
  const employee = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId: actor.orgId } });
  if (!employee) throw new ProbationError('No such employee.', 404);
  if (employee.status === 'LEFT') throw new ProbationError('This person has left.', 409);
  const review = await peoplePrisma.probationReview.findFirst({ where: { orgId: actor.orgId, employeeId, outcome: null }, orderBy: { createdAt: 'desc' } });
  const who = { ...actor, reason: opts.note ?? actor.reason ?? null, requestId: opts.requestId ?? actor.requestId ?? null };
  let result: Record<string, unknown> = {};
  if (outcome === 'CONFIRM') {
    const on = todayIst();
    await updateEmployee(who, employee, { confirmedOn: on }, {});
    await peoplePrisma.$transaction(async (tx) => {
      await tx.employmentEvent.create({ data: { accountId: actor.accountId, orgId: actor.orgId, employeeId, kind: 'CONFIRMED', effectiveDate: on, source: 'FORM', note: opts.note ?? 'Confirmed after probation', payrollImpact: 'Confirmed: check the salary structure and benefits that apply after probation.', recordedByUserId: actor.userId } });
      await writeEvent(tx, { accountId: actor.accountId, orgId: actor.orgId, correlationId: actor.correlationId }, 'people.employee.probation_confirmed.v1', { confirmedOn: on, employee: { id: employeeId, code: employee.code, name: employee.name } }, employeeId);
    });
    /* The company's confirmation letter, on its own where it has one (People plan 8 Nov 2026, step 6). */
    const letter = await issueOnEvent(actor, employeeId, 'CONFIRMATION', `CONFIRMATION:${await stintKey(actor.orgId, employeeId)}`);
    result = { confirmedOn: on, confirmationLetter: letter.issued };
  } else if (outcome === 'EXTEND') {
    const to = opts.newEndDate || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new ProbationError('Give the new probation end date.');
    if (to <= (employee.probationEndDate || todayIst())) throw new ProbationError(`The new date must be after ${employee.probationEndDate || 'today'}.`);
    await updateEmployee(who, employee, { probationEndDate: to }, {});
    result = { probationEndDate: to };
  } else {
    const lastDay = opts.lastDay || todayIst();
    /* The whole actor: an approved probation request then traces the leaving back to itself (Workforce audit E16). */
    const r = await leaveEmployee({ ...who, requestId: who.requestId ?? undefined }, employee as any, { lastDay, leavingType: 'TERMINATED', reason: opts.note || 'Probation not confirmed' });
    result = { left: true, scheduled: r.scheduled, lastDay, readers: r.readers };
  }
  if (review) await peoplePrisma.probationReview.update({ where: { id: review.id }, data: { outcome, decidedByUserId: actor.userId, decidedAt: new Date(), note: opts.note ?? review.note, newEndDate: opts.newEndDate ?? review.newEndDate, requestId: opts.requestId ?? review.requestId } });
  if (employee.userId) await notifyUsers(actor.accountId, actor.orgId, [employee.userId], { kind: 'people.probation', title: outcome === 'CONFIRM' ? 'Your probation is confirmed' : outcome === 'EXTEND' ? `Your probation now ends on ${opts.newEndDate}` : 'Your employment has ended', body: opts.note || null, link: { app: 'people', screen: 'overview' } as any });
  return result;
}

/** Decide: a request where the company has a rule, otherwise applied now. */
export async function decideProbation(actor: Actor, employeeId: string, outcome: ProbationOutcome, opts: { newEndDate?: string | null; note?: string | null; lastDay?: string | null }) {
  if (!PROBATION_OUTCOMES.includes(outcome)) throw new ProbationError('Confirm, extend or end.');
  const employee = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId: actor.orgId }, select: { id: true, name: true, confirmedOn: true, probationEndDate: true, dateOfJoining: true, status: true } });
  if (!employee) throw new ProbationError('No such employee.', 404);
  if (employee.confirmedOn) throw new ProbationError(`Already confirmed on ${employee.confirmedOn}.`, 409);
  /* Probation is decided on someone who has started and is still here (Workforce final audit W19). */
  if (employee.status === 'LEFT') throw new ProbationError(`${employee.name} has left.`, 409);
  if (employee.dateOfJoining && String(employee.dateOfJoining).slice(0, 10) > todayIst()) throw new ProbationError(`${employee.name} has not joined yet; probation is decided after they start.`, 409);
  /* One decision open at a time: a confirm and an end cannot both be waiting (W11). */
  if (await peoplePrisma.approvalRequest.count({ where: { orgId: actor.orgId, subjectEmployeeId: employeeId, requestType: 'PROBATION', status: { in: ['WAITING', 'MORE_INFO'] } } })) throw new ProbationError('A probation decision for them is already waiting for approval.', 409);
  if (outcome === 'EXTEND' && !opts.newEndDate) throw new ProbationError('Give the new probation end date.');
  const rule = await activeRule(actor.orgId, 'PROBATION');
  if (rule) {
    const r = await submitRequest({ ...actor, reason: opts.note ?? null }, { requestType: 'PROBATION', subjectEmployeeId: employeeId, title: `${employee.name}: ${outcome === 'CONFIRM' ? 'confirm after probation' : outcome === 'EXTEND' ? `extend probation to ${opts.newEndDate}` : 'end employment after probation'}`, payload: { employeeId, outcome, newEndDate: opts.newEndDate ?? null, lastDay: opts.lastDay ?? null, note: opts.note ?? null, reason: opts.note ?? null } });
    return { request: r.request, outcome: r.outcome ?? null };
  }
  return { applied: await applyOutcome(actor, employeeId, outcome, opts) };
}

export async function reviewsOf(orgId: string, employeeId: string) {
  return peoplePrisma.probationReview.findMany({ where: { orgId, employeeId }, orderBy: { createdAt: 'desc' } });
}
