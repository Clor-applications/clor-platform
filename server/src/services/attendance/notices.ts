import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { runInTenant } from '../../utils/tenantScope.js';
import { NOTICE_EVENT, writeEvent, type Envelope } from '../people/outbox.js';
import { sendNotice, type Notice } from '../notifications.js';

/**
 * Leave and attendance-request notices, never lost (closure audit O-07).
 *
 * A notice used to be sent once, after the change, and an error dropped it.
 * Now the change writes an outbox event in its own People transaction
 * (peopleWrite shares it through peoplePrisma), and the outbox delivers it:
 * who to tell is worked out then, from the request as it was when it changed,
 * and a delivery that fails is tried again on the outbox's schedule until it
 * is marked failed for an operator (GET /internal/outbox/failed).
 *
 * Every send carries a dedupe key (Notification.dedupeKey, unique per person),
 * so a retry after a half-finished delivery, or the same notice queued twice,
 * reaches each person once.
 *
 * Topics:
 *  - leave: a leave request changed (routes/leave.ts tellAboutLeave);
 *  - leave-shortened: approved leave ends earlier (tellShortened);
 *  - request: an attendance request changed (attendance/requests.ts);
 *  - direct: a notice already addressed (the digest and lapse jobs).
 */
export type NoticeTopic = 'leave' | 'leave-shortened' | 'request' | 'direct';

export type DirectNotice = { userIds: string[]; notice: Notice; dedupeKey: string };

/** Queue inside the caller's People transaction: the notice commits with the change, or neither does. */
export async function queueNotice(who: { accountId: string; orgId: string }, topic: NoticeTopic, data: Record<string, unknown>, opts: { employeeId?: string | null; correlationId: string }) {
  return writeEvent(peoplePrisma, { accountId: who.accountId, orgId: who.orgId, correlationId: opts.correlationId }, NOTICE_EVENT, { topic, ...data }, opts.employeeId ?? null);
}

/**
 * The outbox's delivery of one notice event. Throws when it could not be sent,
 * so the outbox tries again; an unknown topic is an error, never "delivered".
 * Runs in the event's company, wherever the outbox runs (a timer, or the wake
 * call inside an HTTP request that names no company).
 */
export async function deliverNotice(ev: Envelope) {
  const { topic, ...data } = ev.data as { topic?: string } & Record<string, any>;
  await runInTenant(ev.orgId, async () => {
    switch (topic) {
      case 'leave': {
        const { tellAboutLeave } = await import('../../routes/leave.js');
        await tellAboutLeave(ev.orgId, data.request, { approvedBy: data.approvedBy ?? null, rev: Number(data.rev) || 0 });
        return;
      }
      case 'leave-shortened': {
        const { tellShortened } = await import('../../routes/leave.js');
        await tellShortened(ev.orgId, data.request, String(data.by || ''));
        return;
      }
      case 'request': {
        const { tellAboutRequest } = await import('./requests.js');
        await tellAboutRequest(ev.orgId, data.request, { approvedBy: data.approvedBy ?? null, rev: Number(data.rev) || 0, own: Boolean(data.own) });
        return;
      }
      case 'direct': {
        const d = data as unknown as DirectNotice;
        await sendNotice(ev.accountId, ev.orgId, d.userIds || [], d.notice, { dedupeKey: d.dedupeKey });
        return;
      }
      default:
        throw new Error(`Unknown notice topic: ${String(topic)}`);
    }
  });
}

/** How many times a request was changed: part of the "asks for" key, so a real change is told again and a retry is not. */
export const revisionOf = (history: unknown) => (Array.isArray(history) ? history : []).filter((h: any) => h?.what === 'EDITED').length;

/**
 * Who approved, as a sign-in to tell: the reviewer when they are a CLOR user;
 * a manager who decided in the employee app, through their own sign-in when
 * they have one; and otherwise (the leave rule approved it, or the manager has
 * no sign-in) those who approve for this person now.
 */
export async function approverUsers(orgId: string, approvedBy: string | null | undefined, fallback: () => Promise<string[]>) {
  if (approvedBy && approvedBy !== 'system') {
    if (!approvedBy.startsWith('portal:')) return [approvedBy];
    const user = (await peoplePrisma.employee.findFirst({ where: { id: approvedBy.slice(7), orgId }, select: { userId: true } }))?.userId;
    if (user) return [user];
  }
  return fallback();
}
