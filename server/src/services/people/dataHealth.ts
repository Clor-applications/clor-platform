import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { isFeatureEnabled } from '../features.js';
import { balancesFor } from '../../routes/leave.js';

/**
 * Data health: the implementation auditor from the HR research ("finds
 * duplicate employees, mismatched IDs, orphan punches, wrong UAN/PAN/ESIC
 * mappings… before go-live"). Deterministic checks, no AI: each says what is
 * wrong, why it matters for pay or compliance, how many people, who, and
 * which screen fixes it. Never returns the identifiers themselves — a PAN
 * that is wrong is still a PAN.
 */

export type Severity = 'BLOCKS_PAYROLL' | 'FIX_SOON' | 'TIDY_UP';
type Person = { id: string; name: string; code: string | null };
export type Check = {
  id: string;
  area: 'People' | 'Payroll' | 'Attendance' | 'Leave';
  severity: Severity;
  title: string;
  why: string;
  fix: string;
  /** The screen that fixes it (nav key in the Attendance or Payroll app). */
  screen: string;
  count: number;
  people: Array<Person & { detail?: string }>;
};

/* Formats the portals check (EPFO, ESIC, Income Tax, RBI). */
export const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const UAN = /^\d{12}$/;
export const ESIC_IP = /^\d{10}$/;
export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const clean = (v: string | null | undefined) => String(v || '').replace(/\s+/g, '').toUpperCase();
const norm = (v: string | null | undefined) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const digits = (v: string | null | undefined) => String(v || '').replace(/\D/g, '');

const SAMPLE = 25;

export async function dataHealth(accountId: string, orgId: string, opts: { payroll: boolean; year?: number } = { payroll: true }) {
  const year = opts.year ?? Number(new Date().toISOString().slice(0, 4));
  const [employees, payrollOn, readers, unmatched] = await Promise.all([
    peoplePrisma.employee.findMany({
      where: { accountId, orgId, status: { not: 'LEFT' } },
      select: { id: true, name: true, code: true, dateOfJoining: true, dateOfBirth: true, departmentId: true, department: true, phone: true, email: true, workEmail: true, devicePin: true, attendanceRequired: true },
      orderBy: { name: 'asc' },
    }),
    isFeatureEnabled(accountId, orgId, 'payroll'),
    peoplePrisma.attendanceDevice.count({ where: { orgId } }),
    peoplePrisma.devicePunch.groupBy({ by: ['pin'], where: { accountId, orgId, employeeId: null }, _count: { _all: true } }),
  ]);
  const who = (e: { id: string; name: string; code: string | null }, detail?: string): Person & { detail?: string } => ({ id: e.id, name: e.name, code: e.code, ...(detail ? { detail } : {}) });
  const checks: Check[] = [];
  const add = (c: Omit<Check, 'count' | 'people'>, list: Array<Person & { detail?: string }>) => {
    if (list.length) checks.push({ ...c, count: list.length, people: list.slice(0, SAMPLE) });
  };

  /* People: the same person twice. */
  const groups = (key: (e: (typeof employees)[number]) => string, min = 2) => {
    const m = new Map<string, typeof employees>();
    for (const e of employees) {
      const k = key(e);
      if (!k) continue;
      m.set(k, [...(m.get(k) || []), e]);
    }
    return [...m.values()].filter((g) => g.length >= min);
  };
  add(
    { id: 'duplicate-person', area: 'People', severity: 'FIX_SOON', title: 'Possibly the same person twice', why: 'Two files with the same name and date of birth get paid twice and split one person\'s attendance.', fix: 'Open both files; keep one and record the other as left, or correct the details.', screen: 'employees' },
    groups((e) => (e.dateOfBirth ? `${norm(e.name)}|${String(e.dateOfBirth).slice(0, 10)}` : '')).flat().map((e) => who(e, `born ${String(e.dateOfBirth).slice(0, 10)}`))
  );
  add(
    { id: 'shared-phone', area: 'People', severity: 'TIDY_UP', title: 'Phone number on more than one person', why: 'Portal sign-in help and reminders go to the wrong person.', fix: 'Correct the phone on each file.', screen: 'employees' },
    groups((e) => digits(e.phone).slice(-10)).flat().map((e) => who(e))
  );
  add(
    { id: 'shared-email', area: 'People', severity: 'TIDY_UP', title: 'Email on more than one person', why: 'Payslips and notices sent by email reach the wrong person.', fix: 'Correct the email on each file.', screen: 'employees' },
    groups((e) => norm(e.workEmail || e.email)).flat().map((e) => who(e))
  );
  add(
    { id: 'no-joining-date', area: 'People', severity: 'BLOCKS_PAYROLL', title: 'No date of joining', why: 'Pay for a part month, leave accrual, gratuity and PF need the joining date.', fix: 'Add the date of joining on the employee file.', screen: 'employees' },
    employees.filter((e) => !e.dateOfJoining).map((e) => who(e))
  );
  add(
    { id: 'no-code', area: 'People', severity: 'FIX_SOON', title: 'No employee ID', why: 'Employees sign in to the app and match reader punches with their ID; registers list it.', fix: 'Give each person an employee ID.', screen: 'employees' },
    employees.filter((e) => !e.code).map((e) => who(e))
  );
  add(
    { id: 'no-department', area: 'People', severity: 'TIDY_UP', title: 'No department', why: 'Salary cost cannot be booked to a department and department reports leave them out.', fix: 'Set a department, or move several at once with Transfers.', screen: 'transfer' },
    employees.filter((e) => !e.departmentId).map((e) => who(e, e.department ? `"${e.department}" is text only, not a department in the list` : undefined))
  );

  /* Attendance: people readers cannot match, punches nobody owns. */
  if (readers > 0) {
    add(
      { id: 'no-reader-id', area: 'Attendance', severity: 'FIX_SOON', title: 'No reader ID', why: 'Their punches at a biometric reader cannot be matched, so their days show as absent.', fix: 'Set the reader ID on the file, or map it on Employee ID Mapping.', screen: 'idMapping' },
      employees.filter((e) => e.attendanceRequired !== false && !e.devicePin).map((e) => who(e))
    );
  }
  if (unmatched.length) {
    const punches = unmatched.reduce((n, u) => n + u._count._all, 0);
    checks.push({
      id: 'unmatched-punches', area: 'Attendance', severity: 'FIX_SOON', title: 'Punches nobody owns',
      why: `${punches} punch${punches === 1 ? '' : 'es'} came from ${unmatched.length} reader ID${unmatched.length === 1 ? '' : 's'} not on anyone's file; those days are missing from attendance and pay.`,
      fix: 'Match each reader ID to a person on Unmatched Punches.', screen: 'unmatched', count: unmatched.length,
      people: unmatched.slice(0, SAMPLE).map((u) => ({ id: '', name: `Reader ID ${u.pin}`, code: null, detail: `${u._count._all} punches` })),
    });
  }

  /* Leave: more taken than given. */
  if (employees.length) {
    const { types, balances } = await balancesFor(accountId, orgId, employees.map((e) => e.id), year);
    const typeName = new Map(types.map((t) => [t.id, t.name]));
    const over: Array<Person & { detail?: string }> = [];
    for (const e of employees) {
      for (const [typeId, b] of balances.get(e.id) || new Map()) {
        if (b.available != null && b.available < 0) over.push(who(e, `${typeName.get(typeId) || 'Leave'}: ${b.available} days`));
      }
    }
    add({ id: 'negative-leave', area: 'Leave', severity: 'FIX_SOON', title: 'Leave balance below zero', why: 'More leave taken or asked for than given: either the opening balance is wrong or the extra days should be loss of pay.', fix: 'Correct the opening balance on Leave Balances, or decide the extra days.', screen: 'leaveBalances' }, over);
  }

  /* Payroll: what the statutory files and the bank need. */
  /* Only for someone allowed to see payroll profiles. */
  if (opts.payroll && payrollOn && employees.length) {
    const ids = employees.map((e) => e.id);
    const [profiles, assignments] = await Promise.all([
      payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, employeeId: { in: ids } } }),
      payrollPrisma.salaryAssignment.findMany({ where: { orgId, employeeId: { in: ids }, status: 'ACTIVE' }, select: { employeeId: true } }),
    ]);
    const byId = new Map(employees.map((e) => [e.id, e]));
    const paid = profiles.filter((p) => p.payrollStatus === 'IN_PAYROLL');
    const hasSalary = new Set(assignments.map((a) => a.employeeId));
    const person = (p: { employeeId: string }, detail?: string) => who(byId.get(p.employeeId)!, detail);

    add({ id: 'no-salary', area: 'Payroll', severity: 'BLOCKS_PAYROLL', title: 'In payroll without a salary', why: 'A pay run has nothing to pay them: no salary structure is assigned.', fix: 'Assign a salary structure and CTC.', screen: 'assignments' }, paid.filter((p) => !hasSalary.has(p.employeeId)).map((p) => person(p)));
    add({ id: 'pan', area: 'Payroll', severity: 'BLOCKS_PAYROLL', title: 'PAN missing or not in the PAN format', why: 'Without a valid PAN, TDS is deducted at 20% (section 206AA) and the 24Q return and Form 16 are rejected.', fix: 'Enter the PAN as on the card: five letters, four digits, a letter.', screen: 'people' }, paid.filter((p) => !PAN.test(clean(p.pan))).map((p) => person(p, p.pan ? 'not in the PAN format' : 'missing')));
    add({ id: 'uan', area: 'Payroll', severity: 'BLOCKS_PAYROLL', title: 'PF member without a 12-digit UAN', why: 'The EPFO ECR file cannot carry their contribution; it is left out and paid late with damages.', fix: 'Enter the UAN from the member\'s EPFO passbook, or switch PF off if they are not a member.', screen: 'people' }, paid.filter((p) => p.pfApplicable && !UAN.test(digits(p.uan))).map((p) => person(p, p.uan ? 'not 12 digits' : 'missing')));
    add({ id: 'esic', area: 'Payroll', severity: 'BLOCKS_PAYROLL', title: 'ESI member without a 10-digit IP number', why: 'The ESIC monthly upload cannot carry them, and they cannot use ESI benefits.', fix: 'Enter the insurance (IP) number from the ESIC registration.', screen: 'people' }, paid.filter((p) => p.esiApplicable && !ESIC_IP.test(digits(p.esiNumber))).map((p) => person(p, p.esiNumber ? 'not 10 digits' : 'missing')));
    add({ id: 'bank', area: 'Payroll', severity: 'BLOCKS_PAYROLL', title: 'Bank account or IFSC missing or wrong', why: 'The salary bank file rejects the line and the person is not paid on payday.', fix: 'Enter the account number and the IFSC (four letters, 0, six characters).', screen: 'people' }, paid.filter((p) => !digits(p.bankAccountNumber) || !IFSC.test(clean(p.bankIfsc))).map((p) => person(p, !digits(p.bankAccountNumber) ? 'no account number' : !clean(p.bankIfsc) ? 'no IFSC' : 'IFSC not in the IFSC format')));
    add({ id: 'pt-state', area: 'Payroll', severity: 'FIX_SOON', title: 'Professional Tax on, but no state', why: 'Professional Tax is set by the state; without it nothing is deducted and the state return is short.', fix: 'Set the Professional Tax state on the payroll profile.', screen: 'people' }, paid.filter((p) => p.ptApplicable && !p.professionalTaxState).map((p) => person(p)));
    add({ id: 'shared-bank', area: 'Payroll', severity: 'BLOCKS_PAYROLL', title: 'Same bank account on more than one person', why: 'Two salaries would go into one account — a mistake, or a sign of a made-up employee.', fix: 'Check both files against the bank details the people gave.', screen: 'people' },
      [...paid.reduce((m, p) => { const k = digits(p.bankAccountNumber); if (k) m.set(k, [...(m.get(k) || []), p]); return m; }, new Map<string, typeof paid>()).values()].filter((g) => g.length > 1).flat().map((p) => person(p)));
    add({ id: 'shared-pan', area: 'Payroll', severity: 'BLOCKS_PAYROLL', title: 'Same PAN on more than one person', why: 'Income tax is reported against the PAN: two people on one PAN means one person\'s tax goes to the other.', fix: 'Correct the PAN on the wrong file.', screen: 'people' },
      [...paid.reduce((m, p) => { const k = clean(p.pan); if (PAN.test(k)) m.set(k, [...(m.get(k) || []), p]); return m; }, new Map<string, typeof paid>()).values()].filter((g) => g.length > 1).flat().map((p) => person(p)));
    const profiled = new Set(profiles.map((p) => p.employeeId));
    add({ id: 'not-in-payroll', area: 'Payroll', severity: 'TIDY_UP', title: 'Active but not set up in Payroll', why: 'They work but no pay run includes them.', fix: 'Add them in Payroll → Salaries, or mark them as paid elsewhere.', screen: 'people' }, employees.filter((e) => !profiled.has(e.id)).map((e) => who(e)));
  }

  const order: Record<Severity, number> = { BLOCKS_PAYROLL: 0, FIX_SOON: 1, TIDY_UP: 2 };
  checks.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
  return {
    people: employees.length,
    blocking: checks.filter((c) => c.severity === 'BLOCKS_PAYROLL').reduce((n, c) => n + c.count, 0),
    checks,
    ranAt: new Date().toISOString(),
  };
}
