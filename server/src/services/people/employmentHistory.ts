import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { emit as emitWebhook, employeeEvent } from '../attendance/webhooks.js';
import { ensureFirstEpisode } from './episodes.js';

/**
 * Employment history (HR research, Phase 1: "every change must retain
 * effective date, source, approver, previous value, new value and payroll
 * impact"). Written next to the change itself by the routes that make it:
 * the employee form, bulk transfer, resignation, rehire and import. Read as
 * one timeline on the employee's file. Append-only: a wrong change is put
 * right by another change, so the history shows both.
 */

export type HistorySource = 'FORM' | 'TRANSFER' | 'RESIGNATION' | 'REHIRE' | 'IMPORT';
type Who = { accountId: string; orgId: string; userId: string | null };
type Row = Record<string, any>;

/** The fields whose change is part of someone's employment, with how to name them. */
export const TRACKED: Record<string, { label: string; kind: 'TRANSFERRED' | 'CHANGED' }> = {
  departmentId: { label: 'Department', kind: 'TRANSFERRED' },
  businessUnitId: { label: 'Business unit', kind: 'TRANSFERRED' },
  areaId: { label: 'Location', kind: 'TRANSFERRED' },
  branchId: { label: 'Branch', kind: 'TRANSFERRED' },
  state: { label: 'Work state', kind: 'TRANSFERRED' },
  jobPositionId: { label: 'Designation', kind: 'CHANGED' },
  jobRoleId: { label: 'Job role', kind: 'CHANGED' },
  reportingManagerId: { label: 'Reporting manager', kind: 'CHANGED' },
  employeeTypeId: { label: 'Employee type', kind: 'CHANGED' },
  workTypeId: { label: 'Work type', kind: 'CHANGED' },
  contractorId: { label: 'Contractor', kind: 'CHANGED' },
  gradeId: { label: 'Grade', kind: 'CHANGED' },
  costCenterId: { label: 'Cost centre', kind: 'CHANGED' },
};

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The name behind an id, as it is today (stored on the event so later renames do not rewrite history). */
async function labelOf(orgId: string, field: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const by = { where: { id, orgId }, select: { name: true } } as const;
  switch (field) {
    case 'departmentId': return (await peoplePrisma.department.findFirst(by))?.name ?? null;
    case 'areaId': return (await peoplePrisma.area.findFirst(by))?.name ?? null;
    case 'jobPositionId': return (await peoplePrisma.jobPosition.findFirst(by))?.name ?? null;
    case 'jobRoleId': return (await peoplePrisma.jobRole.findFirst(by))?.name ?? null;
    case 'employeeTypeId': return (await peoplePrisma.employeeType.findFirst(by))?.name ?? null;
    case 'workTypeId': return (await peoplePrisma.workType.findFirst(by))?.name ?? null;
    case 'contractorId': return (await peoplePrisma.contractor.findFirst(by))?.name ?? null;
    case 'reportingManagerId': return (await peoplePrisma.employee.findFirst(by))?.name ?? null;
    case 'businessUnitId': return (await peoplePrisma.businessUnit.findFirst(by))?.name ?? null;
    case 'gradeId': return (await peoplePrisma.grade.findFirst(by))?.name ?? null;
    case 'costCenterId': return (await peoplePrisma.costCenter.findFirst(by))?.name ?? null;
    case 'branchId': return (await platformPrisma.branch.findFirst({ where: { id, orgId }, select: { branchName: true } }))?.branchName ?? null;
    default: return id;
  }
}

const yearsBetween = (from: string | null | undefined, to: string) => {
  if (!from || !ISO_DAY.test(from.slice(0, 10))) return null;
  const a = new Date(`${from.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.floor(((b - a) / 86_400_000 / 365.25) * 10) / 10;
};

/** What the change means for pay, approvals or registers — the "payroll impact" the research asks every change to carry. */
export function impactOf(kind: string, field: string | null, to: string | null, date: string, employee: Row): string | null {
  if (kind === 'JOINED') return `Joins payroll from ${date}. Add salary and statutory details (PAN, UAN, ESIC) in Payroll before the first run.`;
  if (kind === 'REHIRED') return `Back on payroll from ${date}. Check salary assignment and statutory details are still right.`;
  if (kind === 'LEFT') {
    const years = yearsBetween(employee.dateOfJoining, date);
    const gratuity = years == null ? '' : years >= 5 ? ` Gratuity applies (${years} years of service).` : ` No gratuity (${years} years of service; 5 needed).`;
    return `Full and final settlement due for service up to ${date}: last salary, notice pay, leave encashment.${gratuity}`;
  }
  switch (field) {
    case 'departmentId': return to ? `Salary cost is booked to ${to} from ${date}.` : 'Salary cost no longer has a department.';
    case 'state': return to ? `Professional Tax and Labour Welfare Fund follow ${to} from the next pay run.` : null;
    case 'branchId': return to ? `Payroll and statutory registers count this person under ${to}.` : null;
    case 'areaId': return to ? `Attendance uses ${to}'s work sites and holidays.` : null;
    case 'reportingManagerId': return to ? `Leave and attendance corrections go to ${to} for approval.` : 'Leave and corrections go to HR: no reporting manager.';
    case 'jobPositionId': return to ? `Payslips from the next run show ${to}.` : null;
    case 'employeeTypeId':
    case 'workTypeId': return to ? `Check the salary structure and PF/ESI eligibility for ${to}.` : null;
    case 'contractorId': return to ? `Counted under ${to} in contractor registers.` : 'Now on the company roll, not under a contractor.';
    case 'costCenterId': return to ? `Salary cost is booked to cost centre ${to} from ${date}.` : 'No cost centre for salary cost.';
    case 'gradeId': return to ? `Check the salary structure for grade ${to}.` : null;
    case 'businessUnitId': return to ? `Reports and costs count this person under ${to}.` : null;
    default: return null;
  }
}

async function write(who: Who, employee: Row, e: { kind: string; field?: string | null; fromId?: string | null; toId?: string | null; effectiveDate: string; source: HistorySource; note?: string | null }) {
  const [fromLabel, toLabel] = e.field ? await Promise.all([labelOf(who.orgId, e.field, e.fromId), labelOf(who.orgId, e.field, e.toId)]) : [null, null];
  /* Lifecycle events for other systems (HR research: EmployeeTransferred, EmploymentEnded…). The employee form already sends employee.left itself. */
  const change = { effectiveDate: e.effectiveDate, source: e.source, note: e.note ?? null };
  if (e.kind === 'TRANSFERRED' || e.kind === 'CHANGED') emitWebhook(who.orgId, 'employee.transferred', { employee: employeeEvent(employee), field: e.field, from: { id: e.fromId ?? null, name: fromLabel }, to: { id: e.toId ?? null, name: toLabel }, ...change });
  else if (e.kind === 'REHIRED') emitWebhook(who.orgId, 'employee.rehired', { employee: employeeEvent(employee), ...change });
  else if (e.kind === 'LEFT' && e.source !== 'FORM') emitWebhook(who.orgId, 'employee.left', employeeEvent(employee));
  return peoplePrisma.employmentEvent.create({
    data: {
      accountId: who.accountId,
      orgId: who.orgId,
      employeeId: employee.id,
      kind: e.kind,
      field: e.field ?? null,
      fromId: e.fromId ?? null,
      toId: e.toId ?? null,
      fromLabel,
      toLabel,
      effectiveDate: e.effectiveDate,
      source: e.source,
      note: e.note ? String(e.note).slice(0, 500) : null,
      payrollImpact: impactOf(e.kind, e.field ?? null, toLabel, e.effectiveDate, employee),
      recordedByUserId: who.userId,
    },
  });
}

/**
 * Records what changed between two versions of an employee. Never fails the
 * change it records: history that could not be written is logged, not
 * allowed to undo the work (as services/auditTrail.ts).
 */
export async function recordChanges(who: Who, before: Row, after: Row, opts: { source: HistorySource; effectiveDate?: string | null; note?: string | null }) {
  try {
    const date = opts.effectiveDate && ISO_DAY.test(opts.effectiveDate) ? opts.effectiveDate : todayIst();
    for (const [field, meta] of Object.entries(TRACKED)) {
      const was = before[field] ?? null;
      const now = after[field] ?? null;
      if (was === now) continue;
      await write(who, after, { kind: meta.kind, field, fromId: was, toId: now, effectiveDate: date, source: opts.source, note: opts.note });
    }
    if (before.status !== 'LEFT' && after.status === 'LEFT') {
      await write(who, after, { kind: 'LEFT', effectiveDate: after.dateOfLeaving || date, source: opts.source, note: opts.note ?? after.leavingReason });
    } else if (before.status === 'LEFT' && after.status !== 'LEFT') {
      await write(who, after, { kind: 'REHIRED', effectiveDate: after.dateOfJoining && after.dateOfJoining > (before.dateOfLeaving || '') ? after.dateOfJoining : date, source: opts.source, note: opts.note });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[employment history] not recorded:', e instanceof Error ? e.message : e);
  }
}

/** Someone new: joined, and where they start. */
export async function recordJoined(who: Who, employee: Row, source: HistorySource) {
  try {
    /* Their first stint, and the date that never moves (episodes.ts). Every path that creates a person comes through here. */
    await ensureFirstEpisode(who, { id: String(employee.id), dateOfJoining: employee.dateOfJoining ? String(employee.dateOfJoining) : null, createdAt: employee.createdAt instanceof Date ? employee.createdAt : null });
    if (!employee.firstJoiningDate) await peoplePrisma.employee.updateMany({ where: { id: employee.id, orgId: who.orgId, firstJoiningDate: null }, data: { firstJoiningDate: employee.dateOfJoining ? String(employee.dateOfJoining).slice(0, 10) : todayIst() } });
    const date = employee.dateOfJoining && ISO_DAY.test(String(employee.dateOfJoining).slice(0, 10)) ? String(employee.dateOfJoining).slice(0, 10) : todayIst();
    const where = (await Promise.all(['departmentId', 'jobPositionId', 'areaId'].map((f) => labelOf(who.orgId, f, employee[f])))).filter(Boolean).join(' · ');
    await write(who, employee, { kind: 'JOINED', effectiveDate: date, source, note: where || null });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[employment history] joining not recorded:', e instanceof Error ? e.message : e);
  }
}

const KIND_TITLE: Record<string, string> = { JOINED: 'Joined', LEFT: 'Left', REHIRED: 'Rehired', TRANSFERRED: 'Moved', CHANGED: 'Changed' };

/** The timeline, newest first. Someone added before history existed still shows when they joined. */
export async function timelineOf(orgId: string, employee: Row) {
  const rows = await peoplePrisma.employmentEvent.findMany({ where: { orgId, employeeId: employee.id }, orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }] });
  const userIds = [...new Set(rows.map((r) => r.recordedByUserId).filter(Boolean))] as string[];
  const users = userIds.length ? await platformPrisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.fullName || u.email]));
  const events = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.field ? `${TRACKED[r.field]?.label || r.field} changed` : KIND_TITLE[r.kind] || r.kind,
    field: r.field,
    from: r.fromLabel,
    to: r.toLabel,
    effectiveDate: r.effectiveDate,
    source: r.source,
    note: r.note,
    payrollImpact: r.payrollImpact,
    by: r.recordedByUserId ? nameOf.get(r.recordedByUserId) || '' : '',
    at: r.createdAt,
  }));
  if (!rows.some((r) => r.kind === 'JOINED') && employee.dateOfJoining) {
    events.push({
      id: `joined-${employee.id}`, kind: 'JOINED', title: 'Joined', field: null, from: null, to: null,
      effectiveDate: String(employee.dateOfJoining).slice(0, 10), source: 'FORM' as const, note: 'From the date of joining on file (before history was kept).',
      payrollImpact: null, by: '', at: employee.createdAt,
    });
  }
  return events;
}
