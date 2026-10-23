import type { Prisma } from '../../generated/people/index.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { outsideTenant, runInTenant } from '../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../jobLease.js';

/**
 * The outbox (docs/people/02-PRD.md FND-05; build contract §7).
 *
 * An event is a row written in the same transaction as the change that
 * caused it, so a crash between the write and the send loses nothing: the
 * worker finds it on the next tick. Names carry a version
 * (people.employee.created.v1); every event has an id a consumer can
 * remember, so one delivered twice has one effect.
 *
 * Delivery goes to the in-process handlers registered here (Attendance,
 * Payroll, webhooks). A handler that throws is tried again on a schedule
 * that backs off and is then parked with its error for someone to look at.
 */

export const PEOPLE_EVENTS = [
  'people.employee.created.v1',
  'people.employee.updated.v1',
  'people.employment.changed.v1',
  'people.employee.transferred.v1',
  'people.employee.probation_confirmed.v1',
  'people.employee.separation_scheduled.v1',
  'people.employee.separated.v1',
  'people.employee.rejoined.v1',
  'people.policy.published.v1',
  'people.document.expiring.v1',
  'people.obligation.due.v1',
] as const;
export type PeopleEventName = (typeof PEOPLE_EVENTS)[number];

export type Envelope = {
  eventId: string;
  name: PeopleEventName;
  version: number;
  accountId: string;
  orgId: string;
  employeeId: string | null;
  occurredAt: string;
  correlationId: string;
  data: Record<string, unknown>;
};

type Tx = Prisma.TransactionClient | typeof peoplePrisma;

/** Queue an event inside the caller's transaction. */
export async function writeEvent(tx: Tx, who: { accountId: string; orgId: string; correlationId: string }, name: PeopleEventName, data: Record<string, unknown>, employeeId: string | null = null) {
  return tx.outboxEvent.create({
    data: { accountId: who.accountId, orgId: who.orgId, name, employeeId, correlationId: who.correlationId, payload: data as Prisma.InputJsonValue },
    select: { id: true, name: true },
  });
}

export type Handler = (event: Envelope) => Promise<void>;
const handlers = new Map<string, Handler[]>();

/** Consumers register here; `name` is one event or '*'. */
export function onPeopleEvent(name: PeopleEventName | '*', handler: Handler) {
  const list = handlers.get(name) || [];
  list.push(handler);
  handlers.set(name, list);
  return () => {
    const now = handlers.get(name) || [];
    handlers.set(name, now.filter((h) => h !== handler));
  };
}

/** A minute, five, thirty, two hours, twelve; then parked. */
export const RETRY_MINUTES = [1, 5, 30, 120, 720];

const toEnvelope = (r: { id: string; name: string; accountId: string; orgId: string; employeeId: string | null; occurredAt: Date; correlationId: string; payload: unknown }): Envelope => ({
  eventId: r.id,
  name: r.name as PeopleEventName,
  version: Number(/\.v(\d+)$/.exec(r.name)?.[1] || 1),
  accountId: r.accountId,
  orgId: r.orgId,
  employeeId: r.employeeId,
  occurredAt: r.occurredAt.toISOString(),
  correlationId: r.correlationId,
  data: (r.payload || {}) as Record<string, unknown>,
});

/**
 * Deliver what is due, oldest first, one company at a time. Returns what it
 * did. Safe to call again at any time: a delivered event is never sent twice
 * by this worker, and a consumer still checks the eventId.
 */
export async function deliverOutbox(now = new Date(), limit = 50) {
  const due = await outsideTenant('job: people outbox', () =>
    peoplePrisma.outboxEvent.findMany({
      where: { deliveredAt: null, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      orderBy: { occurredAt: 'asc' },
      take: limit,
    }),
  );
  let delivered = 0;
  let failed = 0;
  for (const row of due) {
    const envelope = toEnvelope(row);
    const list = [...(handlers.get(row.name) || []), ...(handlers.get('*') || [])];
    try {
      for (const h of list) await h(envelope);
      await runInTenant(row.orgId, () => peoplePrisma.outboxEvent.updateMany({ where: { id: row.id, deliveredAt: null }, data: { deliveredAt: new Date(), attempts: { increment: 1 }, lastError: null } }));
      delivered += 1;
    } catch (e) {
      const attempts = row.attempts + 1;
      const wait = RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)];
      const parked = attempts > RETRY_MINUTES.length;
      await runInTenant(row.orgId, () =>
        peoplePrisma.outboxEvent.update({
          where: { id: row.id },
          data: { attempts, lastError: String(e instanceof Error ? e.message : e).slice(0, 500), nextAttemptAt: parked ? null : new Date(now.getTime() + wait * 60_000), ...(parked ? {} : {}) },
        }),
      );
      failed += 1;
    }
  }
  return { due: due.length, delivered, failed };
}

/** Every five seconds, under a lease so only one instance sends. */
export function startPeopleOutbox({ intervalMs = 5_000, startupDelayMs = 15_000 } = {}) {
  if (String(process.env.PEOPLE_OUTBOX || '').toLowerCase() === 'off') return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await exclusive('people.outbox', leaseFor(intervalMs), () => deliverOutbox());
      // eslint-disable-next-line no-console
      if (r && r.failed) console.warn(`[people-outbox] ${r.failed} event(s) will be tried again`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[people-outbox] run failed:', e instanceof Error ? e.message : e);
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
