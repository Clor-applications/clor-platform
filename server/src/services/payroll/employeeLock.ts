import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';

/**
 * One person's payroll records change one writer at a time (A-39).
 *
 * Deleting an employee checked their payroll history, then deleted them —
 * a salary assignment made in between survived its employee. Writers that
 * create payroll records for someone, and the delete, take this lock first,
 * inside their payroll transaction; it is released when that transaction
 * ends. Postgres advisory locks are per database, so every payroll writer
 * meets here whatever schema or client it uses.
 */
export const lockPayrollEmployee = (tx: { $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }, employeeId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll-employee:${employeeId}`}))`;

/**
 * Payroll records that are someone's history: money was worked out, paid,
 * owed or declared. An employee with any of these is set to Left, never
 * deleted — deleting would take that history with them or leave it
 * pointing at nobody.
 */
export const PAYROLL_HISTORY = [
  ['salarySlip', 'payslips'],
  ['payrollRunEmployee', 'pay runs'],
  ['payrollPaymentLine', 'salary payments'],
  ['finalSettlement', 'a final settlement'],
  ['payrollLoan', 'loans'],
  ['payrollAdjustment', 'adjustments'],
  ['payrollInput', 'pay run inputs'],
  ['salaryRevision', 'salary revisions'],
  ['salaryAssignment', 'a salary assignment'],
  ['taxDeclaration', 'tax declarations'],
  ['bankDetailChange', 'bank account changes'],
] as const;

/** Setup that belongs to the person and nothing else: removed with them. */
export const PAYROLL_SETUP = ['employeePayrollProfile', 'employeeStatutoryConfig', 'salaryComponentEmployee'] as const;

/**
 * Write a payroll record for someone only while they exist: the lock, then
 * the check, then `fn` in the same payroll transaction. A person deleted
 * meanwhile is a 404, never a record pointing at nobody.
 */
export async function forLiveEmployee<T>(orgId: string, employeeId: string, fn: (tx: any) => Promise<T>): Promise<T> {
  return payrollPrisma.$transaction(async (tx: any) => {
    await lockPayrollEmployee(tx, employeeId);
    const alive = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true } });
    if (!alive) throw Object.assign(new Error('No such employee.'), { status: 404, code: 'EMPLOYEE_GONE' });
    return fn(tx);
  });
}
