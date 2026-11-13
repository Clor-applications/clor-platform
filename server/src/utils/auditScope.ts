import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The audit entry a request's change must be written with, when it must be written in the same transaction
 * (middleware/auditMutations.ts, "Written together"). Set for the request by the audit middleware; read by the
 * platform client (utils/platformPrisma.ts), which calls `inTransaction` inside every transaction that writes
 * while it is set, before that transaction commits. If the entry cannot be written, `inTransaction` throws and
 * the change is rolled back with it.
 *
 * Its own module so the database client does not import the audit middleware that imports the client.
 */
export type TxAudit = {
  /** Written: later transactions of the request are left alone. */
  done: boolean;
  /** `tx`: the transaction. `wrote`: the models written in it so far (camelCase, as on the client). */
  inTransaction(tx: any, wrote: ReadonlySet<string>): Promise<void>;
};

export const auditScope = new AsyncLocalStorage<TxAudit>();
