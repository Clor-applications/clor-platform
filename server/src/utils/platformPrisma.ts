import { PrismaClient } from '../generated/platform/index.js';

/**
 * The platform database: who can sign in, which company they belong to, and
 * what they are allowed to do.
 *
 * Accounts, orgs, branches, users, sessions, roles, permissions, the audit
 * trail, entitlements and the auth/email plumbing live here — the control plane
 * every accounting query assumes but none of them owns. It is a separate client
 * against a separate database for the same reason payroll and people are: the
 * part that is shared by everything changes on its own rhythm and carries its
 * own sensitivity, and an accidental join from a sales report into a password
 * hash cannot be written when the two are not in the same database.
 *
 * Accounting holds the platform's identifiers — `accountId`, `orgId`,
 * `branchId`, `userId`, `warehouseId` — as plain strings, with no
 * cross-database foreign keys, because there is no such thing. Referential
 * integrity across the boundary is the application's job, enforced where the
 * two meet.
 *
 * The cost, stated plainly: a transaction cannot span both databases. Anything
 * that writes to both does it in two steps, each idempotent, in an order where
 * a crash in between leaves a state the next attempt can recognise and finish.
 */
export const platformPrisma = new PrismaClient({
  log: ['warn', 'error'],
});

/** The platform equivalent of `DbClient`: a transaction, or the client itself. */
export type PlatformDb = Parameters<Parameters<typeof platformPrisma.$transaction>[0]>[0] | typeof platformPrisma;
