import { PrismaClient } from '../generated/people/index.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { tenantScoped } from './tenantScope.js';
import { withFileOffload } from './fileOffload.js';

/**
 * The people database: who works here.
 *
 * One person record, shared by payroll, attendance, timesheets and leave, and
 * owned by none of them. Each holds `employeeId` across the boundary the way it
 * holds an org or a ledger account — there are no cross-database foreign keys,
 * because there is no such thing.
 *
 * The failure this prevents is five modules each growing their own staff list:
 * five spellings of one name, five joining dates, and no answer to which is
 * right. The failure it accepts in exchange is that referential integrity
 * across the boundary is the application's job, enforced where the two meet.
 */
/* Told which company the request is for (utils/tenantScope.ts). */
const client = tenantScoped(new PrismaClient({
  log: ['warn', 'error'],
}));

/** A transaction, or the client itself. */
export type PeopleDb = Parameters<Parameters<typeof peoplePrisma.$transaction>[0]>[0] | typeof peoplePrisma;

// Nested People services share the caller's transaction, including balance reads.
const writes = new AsyncLocalStorage<{ db: any; orgId: string; effects: Array<() => void> }>();
/*
 * R2 plan: document, selfie and evidence bytes live in object storage when a
 * store is configured (utils/fileOffload.ts) — for plain calls, for the `tx`
 * a $transaction callback is given, and for the transaction peopleWrite shares.
 */
export const peoplePrisma: typeof client = new Proxy(client, {
  get(target, key) {
    const active = writes.getStore();
    if (active && key === '$transaction') return (fn: any) => typeof fn === 'function' ? fn(withFileOffload(active.db)) : Promise.all(fn);
    if (!active && key === '$transaction') {
      return (arg: any, options?: any) => (typeof arg === 'function' ? target.$transaction((tx: any) => arg(withFileOffload(tx)), options) : target.$transaction(arg, options));
    }
    const db = withFileOffload(active?.db || target);
    const value = Reflect.get(db, key);
    return typeof value === 'function' ? value.bind(db) : value;
  },
});

/** Serialize leave/day changes with closing the company register; roll back as one unit. */
export async function peopleWrite<T>(orgId: string, work: () => Promise<T>): Promise<T> {
  const active = writes.getStore();
  if (active) {
    if (active.orgId !== orgId) throw new Error('A People transaction cannot cross companies.');
    return work();
  }
  const effects: Array<() => void> = [];
  const result = await client.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`people-write:${orgId}`}))`;
    return writes.run({ db, orgId, effects }, work);
  }, { timeout: 60_000 });
  for (const effect of effects) effect();
  return result;
}

export function afterPeopleCommit(effect: () => void) {
  const active = writes.getStore();
  if (active) active.effects.push(effect);
  else effect();
}
