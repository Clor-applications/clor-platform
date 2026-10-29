import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { isFeatureEnabled } from '../features.js';
import { OUTSIDE_PAYROLL } from './employmentKinds.js';
import { balancesFor, leaveYearOf } from '../attendance/leaveBalances.js';
import { structureChecks } from './structureHealth.js';

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
  area: 'People' | 'Payroll' | 'Attendance' | 'Leave' | 'Structure';
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
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* A day as people write it in what they read: 2 Mar 2024. */
const dayWords = (iso: string | null | undefined) => { const [y, m, d] = String(iso || '').slice(0, 10).split('-'); return y && m && d ? `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}` : String(iso || ''); };

export async function dataHealth(accountId: string, orgId: string, opts: { payroll: boolean; year?: number; sample?: number; onlyIds?: string[]; readable?: string[] } = { payroll: true }) {
  const year = opts.year ?? (await leaveYearOf(orgId));
  const [employees, payrollOn, readers, unmatched] = await Promise.all([
    peoplePrisma.employee.findMany({
      where: { accountId, orgId, status: { not: 'LEFT' } },
      select: { id: true, name: true, code: true, dateOfJoining: true, dateOfBirth: true, departmentId: true, department: true, phone: true, email: true, workEmail: true, devicePin: true, attendanceRequired: true, employeeTypeId: true, probationEndDate: true, confirmedOn: true, contractEndDate: true },
      orderBy: { name: 'asc' },
    }),
    isFeatureEnabled(accountId, orgId, 'payroll'),
    peoplePrisma.attendanceDevice.count({ where: { orgId } }),
    peoplePrisma.devicePunch.groupBy({ by: ['pin'], where: { accountId, orgId, employeeId: null }, _count: { _all: true } }),
  ]);
  const who = (e: { id: string; name: string; code: string | null }, detail?: string): Person & { detail?: string } => ({ id: e.id, name: e.name, code: e.code, ...(detail ? { detail } : {}) });
  const checks: Check[] = [];
  /* A team lead sees their own team's rows; the checks still run across the company (a phone shared with someone outside the team is still shared). */
  const only = opts.onlyIds ? new Set(opts.onlyIds) : null;
  const add = (c: Omit<Check, 'count' | 'people'>, all: Array<Person & { detail?: string }>) => {
    const list = only ? all.filter((x) => x.id && only.has(x.id)) : all;
    if (list.length) checks.push({ ...c, count: list.length, people: list.slice(0, opts.sample ?? SAMPLE) });
  };

  /* Documents past their date (DOC-03, LIFE-08): a lapsed permit first, then anything else that has run out. */
  {
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const byId = new Map(employees.map((e) => [e.id, e]));
    const expired = await peoplePrisma.employeeDocument.findMany({ where: { orgId, employeeId: { in: employees.map((e) => e.id) }, expiresOn: { not: null, lt: today } }, select: { employeeId: true, kind: true, title: true, classification: true, expiresOn: true, restrictsWork: true }, orderBy: { expiresOn: 'asc' } });
    /* A document the viewer may not open is counted, never named. */
    const titleOf = (d: { title: string; classification: string }) => (!opts.readable || opts.readable.includes(String(d.classification || '')) ? d.title : 'A restricted document');
    const permits = expired.filter((d) => d.kind === 'WORK_PERMIT' || d.kind === 'CERTIFICATE');
    const others = expired.filter((d) => !(d.kind === 'WORK_PERMIT' || d.kind === 'CERTIFICATE'));
    add({ id: 'permit-expired', area: 'People', severity: 'FIX_SOON', title: 'Work permit or certificate has expired', why: 'They may be doing work the permit allowed; the record says so, other apps do not stop it.', fix: 'Renew it and add the new copy on Documents, or move them off that work.', screen: 'employees' },
      permits.map((d) => who(byId.get(d.employeeId)!, `${titleOf(d)} expired ${dayWords(d.expiresOn!)}${d.restrictsWork ? ` · may not: ${d.restrictsWork}` : ''}`)));
    add({ id: 'document-expired', area: 'People', severity: 'TIDY_UP', title: 'Document past its date', why: 'An expired ID, contract or proof on file is not valid for an audit or a renewal.', fix: 'Add the renewed copy on Documents.', screen: 'employees' },
      others.map((d) => who(byId.get(d.employeeId)!, `${titleOf(d)} expired ${dayWords(d.expiresOn!)}`)));
  }

  /* Policies (POL-06): two published policies of one kind that apply to the same people on the same day. */
  try {
    const { conflicts } = await import('./policies.js');
    const found = await conflicts(orgId);
    add({ id: 'policy-conflict', area: 'People', severity: 'FIX_SOON', title: 'Two policies of the same kind apply to the same people', why: 'Nobody can tell which one holds; a dispute or an inspection will ask.', fix: 'Narrow who each policy applies to, or retire one of them.', screen: 'policies' },
      found.map((c) => ({ id: c.a.policyId, name: `${c.a.title} v${c.a.version} and ${c.b.title} v${c.b.version}`, code: c.category, detail: `${c.people} ${c.people === 1 ? 'person' : 'people'}, e.g. ${c.sample.join(', ')}` })));
  } catch (e) {
    console.error('[data-health] policies:', e instanceof Error ? e.message : e);
  }

  /* People without a manager (HLTH-01): requests and leave have nobody to go to. The top of the tree — someone others report to — is not counted. */
  {
    const managers = new Set((await peoplePrisma.employee.findMany({ where: { orgId, status: { not: 'LEFT' }, reportingManagerId: { not: null } }, select: { reportingManagerId: true } })).map((e) => e.reportingManagerId));
    const noManager = await peoplePrisma.employee.findMany({ where: { orgId, status: { not: 'LEFT' }, reportingManagerId: null }, select: { id: true, name: true, code: true } });
    if (employees.length > 1) add({ id: 'no-manager', area: 'People', severity: 'TIDY_UP', title: 'No manager', why: 'Their leave, corrections and requests have nobody to go to, so they wait for HR.', fix: 'Set their manager on their record, or change several at once with Change manager.', screen: 'employees' }, noManager.filter((e) => !managers.has(e.id)).map((e) => who(e)));
  }

  /* Plan tasks past their date (HLTH-01): joining, leaving, renewals and changes. */
  {
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const late = await peoplePrisma.checklistTask.findMany({ where: { orgId, doneAt: null, dueDate: { not: null, lt: today } }, select: { employeeId: true, title: true, dueDate: true }, orderBy: { dueDate: 'asc' } });
    const byId = new Map(employees.map((e) => [e.id, e]));
    /* One line per person, not per task: how many are late and the oldest one. */
    const perPerson = new Map<string, { n: number; oldest: typeof late[number] }>();
    for (const t of late) {
      if (!byId.has(t.employeeId)) continue;
      const cur = perPerson.get(t.employeeId);
      if (cur) cur.n += 1; else perPerson.set(t.employeeId, { n: 1, oldest: t });
    }
    add({ id: 'overdue-tasks', area: 'People', severity: 'FIX_SOON', title: 'Plan tasks past their date', why: 'A joining or leaving step not done on time: a missed PF form, a laptop not recovered, a settlement late.', fix: 'Open Joining & Leaving, Tasks, Late, and close or hand on each task. A joining plan for someone who joined long ago can be ticked off from their record.', screen: 'checklists' },
      [...perPerson.entries()].map(([id, v]) => who(byId.get(id)!, v.n === 1 ? `${v.oldest.title}, due ${dayWords(v.oldest.dueDate)}` : `${v.n} late; the oldest, ${v.oldest.title}, was due ${dayWords(v.oldest.dueDate)}`)));
  }

  /* Policies not accepted a week after asking (HLTH-01). */
  {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const pending = await peoplePrisma.acknowledgement.findMany({ where: { orgId, acceptedAt: null, askedAt: { lt: weekAgo } }, select: { employeeId: true, targetType: true } });
    const byId = new Map(employees.map((e) => [e.id, e]));
    const seen = new Set<string>();
    add({ id: 'unaccepted', area: 'People', severity: 'TIDY_UP', title: 'Not accepted a week after asking', why: 'A policy or document they were asked to read and accept is still open; in a dispute, nobody can show they saw it.', fix: 'Send a reminder from the policy or the document.', screen: 'policies' },
      pending.filter((a) => byId.has(a.employeeId) && !seen.has(a.employeeId) && seen.add(a.employeeId)).map((a) => who(byId.get(a.employeeId)!, a.targetType === 'POLICY_VERSION' ? 'a policy' : 'a document')));
  }

  /* Changes waiting to apply (HLTH-01): dated ahead, they apply on the day. Listed so nobody is surprised. */
  {
    const waiting = await peoplePrisma.scheduledChange.findMany({ where: { orgId, status: 'PENDING' }, select: { employeeId: true, field: true, toLabel: true, toValue: true, effectiveOn: true }, orderBy: { effectiveOn: 'asc' } });
    const byId = new Map(employees.map((e) => [e.id, e]));
    add({ id: 'scheduled', area: 'People', severity: 'TIDY_UP', title: 'Changes waiting to apply', why: 'A transfer or a promotion dated ahead changes the record on its day; payroll and attendance follow it then.', fix: 'Check each is still right; withdraw one on the person’s record if not.', screen: 'employees' },
      waiting.filter((c) => byId.has(c.employeeId)).map((c) => who(byId.get(c.employeeId)!, `${c.field.replace(/Id$/, '')} → ${c.toLabel || c.toValue || 'none'} on ${c.effectiveOn}`)));
  }

  /* People: an end date that passed with nothing decided. */
  {
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    add({ id: 'contract-ended', area: 'People', severity: 'FIX_SOON', title: 'Contract ended, still working', why: 'Their contract or internship end date has passed and they are still active, so they keep being paid on an ended contract.', fix: 'Renew the contract with a new end date, or record their leaving.', screen: 'employees' },
      employees.filter((e) => e.contractEndDate && String(e.contractEndDate).slice(0, 10) < today).map((e) => who(e, `ended ${dayWords(e.contractEndDate)}`)));
    add({ id: 'probation-due', area: 'People', severity: 'TIDY_UP', title: 'Probation over, not decided', why: 'The probation date passed without a confirmation, extension or end; leave and benefits that start on confirmation wait for it.', fix: 'Confirm, extend or end it on their Employment tab.', screen: 'employees' },
      employees.filter((e) => e.probationEndDate && !e.confirmedOn && String(e.probationEndDate).slice(0, 10) < today).map((e) => who(e, `ended ${dayWords(e.probationEndDate)}`)));
  }

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
    { id: 'duplicate-person', area: 'People', severity: 'FIX_SOON', title: 'Possibly the same person twice', why: 'Two files with the same name and date of birth get paid twice and split one person\'s attendance.', fix: 'Open both files; keep one, and close the other with Mark as left, reason Duplicate record (no settlement is asked), or correct the details.', screen: 'employees' },
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

  /* Structure (Organization): the company's shape. Rows naming a department or a team are for whole-company viewers; `add` keeps a team lead to their own people. */
  try {
    await structureChecks(accountId, orgId, add);
  } catch (e) {
    console.error('[data-health] structure:', e instanceof Error ? e.message : e);
  }

  /* Attendance: people readers cannot match, punches nobody owns. */
  if (readers > 0) {
    add(
      { id: 'no-reader-id', area: 'Attendance', severity: 'FIX_SOON', title: 'No reader ID', why: 'Their punches at a biometric reader cannot be matched, so their days show as absent.', fix: 'Set the reader ID on the file, or map it on Employee ID Mapping.', screen: 'idMapping' },
      employees.filter((e) => e.attendanceRequired !== false && !e.devicePin).map((e) => who(e))
    );
  }
  if (unmatched.length && !only) {
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
    /* Consultants and agency workers are paid on an invoice: not being in payroll is right for them. */
    const outside = new Set((await peoplePrisma.employeeType.findMany({ where: { orgId, category: { in: [...OUTSIDE_PAYROLL] } }, select: { id: true } })).map((t) => t.id));
    add({ id: 'not-in-payroll', area: 'Payroll', severity: 'TIDY_UP', title: 'Active but not set up in Payroll', why: 'They work but no pay run includes them.', fix: 'Add them in Payroll → Salaries, or mark them as paid elsewhere.', screen: 'people' }, employees.filter((e) => !profiled.has(e.id) && !(e.employeeTypeId && outside.has(e.employeeTypeId))).map((e) => who(e)));
  }

  const order: Record<Severity, number> = { BLOCKS_PAYROLL: 0, FIX_SOON: 1, TIDY_UP: 2 };
  checks.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
  /* Snoozed items step aside until their date (HLTH-03); they are still counted as snoozed, never hidden silently. */
  const todayIst = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const snoozes = await peoplePrisma.healthSnooze.findMany({ where: { orgId, endedAt: null, until: { gt: todayIst } }, orderBy: { createdAt: 'desc' } });
  const snoozeOf = new Map<string, (typeof snoozes)[number]>();
  for (const z of snoozes) if (!snoozeOf.has(z.checkId)) snoozeOf.set(z.checkId, z);
  const live = checks.filter((c) => !snoozeOf.has(c.id));
  const snoozed = checks.filter((c) => snoozeOf.has(c.id)).map((c) => ({ ...c, snooze: { reason: snoozeOf.get(c.id)!.reason, until: snoozeOf.get(c.id)!.until, byUserId: snoozeOf.get(c.id)!.byUserId } }));
  return {
    people: employees.length,
    blocking: live.filter((c) => c.severity === 'BLOCKS_PAYROLL').reduce((n, c) => n + c.count, 0),
    checks: live,
    snoozed,
    ranAt: new Date().toISOString(),
  };
}

/**
 * One person's view of the same checks: everything that names them, so the
 * record can say "before payday: PAN, bank, salary" where the owner is
 * already looking. Company-wide checks (two people on one bank account)
 * still count, because the full lists are read before filtering.
 */
export async function readinessOf(accountId: string, orgId: string, employeeId: string, opts: { payroll: boolean; readable?: string[] }) {
  const all = await dataHealth(accountId, orgId, { payroll: opts.payroll, sample: Number.POSITIVE_INFINITY, onlyIds: [employeeId], readable: opts.readable });
  const checks = all.checks
    .map((c: Check) => ({ c, me: c.people.find((p) => p.id === employeeId) }))
    .filter((x) => x.me)
    .map(({ c, me }) => ({ id: c.id, area: c.area, severity: c.severity, title: c.title, why: c.why, fix: c.fix, screen: c.screen, detail: me!.detail || null }));
  return { checks, ranAt: all.ranAt };
}
