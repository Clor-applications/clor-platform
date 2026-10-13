import { PrismaClient } from '../generated/people/index.js';

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
export const peoplePrisma = new PrismaClient({
  log: ['warn', 'error'],
});

/** A transaction, or the client itself. */
export type PeopleDb = Parameters<Parameters<typeof peoplePrisma.$transaction>[0]>[0] | typeof peoplePrisma;
