import { PrismaClient } from '../generated/payroll/index.js';

/**
 * The payroll database, which is not the accounting database.
 *
 * Two clients, two files, no shared table. The point is not tidiness: payroll
 * holds what every person earns, their bank account and their PAN, and the
 * strongest guarantee that none of it leaks into a sales report is that the
 * join which would leak it cannot be written. A query against `prisma` cannot
 * reach a salary, because the salary is not in that database.
 *
 * It also means payroll can be backed up, retained, exported or moved to its
 * own server on its own schedule — which is what payroll data usually needs —
 * without touching an accounting query.
 *
 * Payroll still posts to Clor's one general ledger. It does that through the
 * accounting service, never by writing a journal row itself.
 *
 * The cost, stated plainly: a transaction cannot span both databases. Anything
 * that writes to both does it in two steps, each idempotent, in an order where
 * a crash in between leaves a state the next attempt can recognise and finish.
 * `postPayrollRun` is the one place that matters, and it says so there.
 */
export const payrollPrisma = new PrismaClient({
  log: ['warn', 'error'],
});

/** The payroll equivalent of `DbClient`: a transaction, or the client itself. */
export type PayrollDb = Parameters<Parameters<typeof payrollPrisma.$transaction>[0]>[0] | typeof payrollPrisma;
