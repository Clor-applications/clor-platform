import type { Request } from 'express';

import { peoplePrisma, peopleWrite } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { authorize } from '../../middleware/rbac.js';
import { PermissionAction } from '../../constants/enums.js';
import { recordAudit } from '../auditTrail.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE } from './guards.js';
import { teamScope } from './scope.js';

/**
 * Company choices (docs/people/workflow-engine/SPEC.md 3, DECISIONS.md): decisions that were pending become
 * settings HR and the owner choose, each with a plain caption, a default that keeps today's behaviour (or the
 * private one), a rule for who may change it, and a COMPANY_SETTING audit line with the value before and after.
 *
 * Stored on PeopleSetting, one row per company under the people schema's row-level security. The late-mark cut
 * lives with the attendance rules and the final-settlement cap with Payroll's settings; this screen links to them.
 */

export type ChoiceKey = 'attendance.correctionApproval' | 'people.hrSeesSalaryRevisions' | 'people.leavingsForReadOnly' | 'people.leavingReasonForReadOnly' | 'notifications.withdrawn' | 'leave.onEngine' | 'attendance.onEngine';
/** APPROVALS: whoever edits approval rules for the whole company (PEOPLE::Approvals::EDIT, not team-scoped), or an admin. ADMIN: the owner or an admin only. */
type Who = 'APPROVALS' | 'ADMIN';
type Column = 'correctionApproval' | 'hrSeesSalaryRevisions' | 'leavingsForReadOnly' | 'leavingReasonForReadOnly' | 'withdrawnNotices' | 'leaveOnEngine' | 'attendanceOnEngine';
type Def = { column: Column; who: Who; default: string | boolean; options: Array<{ value: string | boolean; label: string }> };

export const CORRECTION_CHOICES = ['HR_OR_MANAGER', 'MANAGER', 'HR', 'MANAGER_THEN_HR'] as const;
export type CorrectionChoice = (typeof CORRECTION_CHOICES)[number];
export const WITHDRAWN_CHOICES = ['SHOW_WITHDRAWN', 'REMOVE'] as const;
export type WithdrawnChoice = (typeof WITHDRAWN_CHOICES)[number];

const YES_NO = [{ value: true, label: 'Yes' }, { value: false, label: 'No' }];

export const CHOICES: Record<ChoiceKey, Def> = {
  'attendance.correctionApproval': {
    column: 'correctionApproval',
    who: 'APPROVALS',
    default: 'HR_OR_MANAGER',
    options: [
      { value: 'HR_OR_MANAGER', label: 'HR or the manager, whoever is first' },
      { value: 'MANAGER', label: 'The manager; HR can step in' },
      { value: 'HR', label: 'HR only' },
      { value: 'MANAGER_THEN_HR', label: 'The manager, then HR' },
    ],
  },
  'people.hrSeesSalaryRevisions': { column: 'hrSeesSalaryRevisions', who: 'ADMIN', default: false, options: YES_NO },
  'people.leavingsForReadOnly': { column: 'leavingsForReadOnly', who: 'ADMIN', default: true, options: YES_NO },
  'people.leavingReasonForReadOnly': { column: 'leavingReasonForReadOnly', who: 'ADMIN', default: false, options: YES_NO },
  'notifications.withdrawn': {
    column: 'withdrawnNotices',
    who: 'APPROVALS',
    default: 'SHOW_WITHDRAWN',
    options: [
      { value: 'SHOW_WITHDRAWN', label: 'Shows as withdrawn' },
      { value: 'REMOVE', label: 'Is removed' },
    ],
  },
  /*
   * Leave on the approval engine (workflow engine 2c-ii): new leave is decided by the approval rules (the chain the
   * company already chose, or its leave rule), with the steps shown on the request. The same people decide. Owner or
   * admin only, off until they turn it on: it changes how every leave request is decided from then on.
   */
  'leave.onEngine': { column: 'leaveOnEngine', who: 'ADMIN', default: false, options: [{ value: false, label: 'Off' }, { value: true, label: 'On' }] },
  /*
   * Attendance on the approval engine (workflow engine 2d): new attendance requests, overtime and comp-off, and field
   * punches are decided by the approval rules (the chain the company already chose for each), with the steps shown on
   * the request. The same people decide. Owner or admin only, off until they turn it on, as leave.
   */
  'attendance.onEngine': { column: 'attendanceOnEngine', who: 'ADMIN', default: false, options: [{ value: false, label: 'Off' }, { value: true, label: 'On' }] },
};
export const CHOICE_KEYS = Object.keys(CHOICES) as ChoiceKey[];

export class ChoiceError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

/** Attendance's own column keeps the old three words; its HR has always let a manager in scope decide too. */
const fromAttendance = (v: string | null | undefined): CorrectionChoice => (v === 'MANAGER' || v === 'MANAGER_THEN_HR' ? v : 'HR_OR_MANAGER');
/** And back, so a rollback (or the Attendance app's screen) reads the nearest choice it knows. */
const toAttendance = (v: CorrectionChoice) => (v === 'HR_OR_MANAGER' || v === 'HR' ? 'HR' : v);

export type Choices = {
  correctionApproval: CorrectionChoice;
  hrSeesSalaryRevisions: boolean;
  leavingsForReadOnly: boolean;
  leavingReasonForReadOnly: boolean;
  withdrawnNotices: WithdrawnChoice;
  leaveOnEngine: boolean;
  attendanceOnEngine: boolean;
};

/** The company's choices, with the defaults for anything not chosen. */
export async function choicesFor(orgId: string): Promise<Choices> {
  const [row, att] = await Promise.all([
    peoplePrisma.peopleSetting.findUnique({ where: { orgId }, select: { correctionApproval: true, hrSeesSalaryRevisions: true, leavingsForReadOnly: true, leavingReasonForReadOnly: true, withdrawnNotices: true, leaveOnEngine: true, attendanceOnEngine: true } }),
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { correctionApproval: true } }),
  ]);
  const correction = row?.correctionApproval && (CORRECTION_CHOICES as readonly string[]).includes(row.correctionApproval) ? (row.correctionApproval as CorrectionChoice) : fromAttendance(att?.correctionApproval);
  return {
    correctionApproval: correction,
    hrSeesSalaryRevisions: row?.hrSeesSalaryRevisions ?? false,
    leavingsForReadOnly: row?.leavingsForReadOnly ?? true,
    leavingReasonForReadOnly: row?.leavingReasonForReadOnly ?? false,
    withdrawnNotices: row?.withdrawnNotices === 'REMOVE' ? 'REMOVE' : 'SHOW_WITHDRAWN',
    leaveOnEngine: row?.leaveOnEngine ?? false,
    attendanceOnEngine: row?.attendanceOnEngine ?? false,
  };
}

const valueOf = (c: Choices, key: ChoiceKey) => c[CHOICES[key].column];

/** Whether this person may change the choice, and if not, the plain reason. Call after a requirePermission guard (it sets isAdmin). */
export async function mayChange(req: Request, key: ChoiceKey): Promise<{ ok: true } | { ok: false; error: string }> {
  const def = CHOICES[key];
  if (req.isAdmin) return { ok: true };
  if (def.who === 'ADMIN') return { ok: false, error: 'Only the owner or an admin can change this.' };
  if (await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, PEOPLE_RESOURCE.approvals)) return { ok: false, error: 'Changed by whoever edits approval rules (People: Approvals, Edit), or the owner.' };
  if (!(await teamScope(req)).all) return { ok: false, error: 'This is set for the whole company; your role covers your own team.' };
  return { ok: true };
}

const words = (key: ChoiceKey, v: unknown) => CHOICES[key].options.find((o) => o.value === v)?.label ?? String(v);

/**
 * Save one choice: checked, written under the company's People write lock (so the "before" in the audit line is
 * the value really replaced), and audited when it changed. The correction choice is mirrored on the Attendance
 * settings in its old words, so the Attendance app and a rollback read the nearest thing.
 */
export async function saveChoice(req: Request, key: ChoiceKey, raw: unknown) {
  const def = CHOICES[key];
  const value = typeof def.default === 'boolean' ? raw : String(raw ?? '');
  if (typeof def.default === 'boolean' ? typeof value !== 'boolean' : !def.options.some((o) => o.value === value)) throw new ChoiceError('Pick one of the choices shown.');
  const { accountId, orgId } = req.tenant!;
  const userId = req.auth!.userId;
  /* Read and written under the company's People write lock: two saves at once each audit the value they really replaced. */
  const was = await peopleWrite(orgId, async () => {
    const before = valueOf(await choicesFor(orgId), key);
    if (before === value) return before;
    const data = { [def.column]: value, updatedByUserId: userId } as any;
    await peoplePrisma.peopleSetting.upsert({ where: { orgId }, create: { accountId, orgId, ...data }, update: data });
    if (key === 'attendance.correctionApproval') {
      const legacy = toAttendance(value as CorrectionChoice);
      await peoplePrisma.attendanceSettings.upsert({ where: { orgId }, create: { accountId, orgId, correctionApproval: legacy, updatedByUserId: userId }, update: { correctionApproval: legacy } });
    }
    return before;
  });
  if (was !== value) {
    await recordAudit(req, { entity: 'COMPANY_SETTING', entityId: key, action: 'CHANGED', message: `${LABELS[key]}: ${words(key, was)} → ${words(key, value)}`, metadata: { before: was, after: value } });
  }
  return choicesFor(orgId);
}

const LABELS: Record<ChoiceKey, string> = {
  'attendance.correctionApproval': 'Who decides attendance requests',
  'people.hrSeesSalaryRevisions': 'HR without Payroll access sees salary revisions',
  'people.leavingsForReadOnly': 'Read-only users and IT administrators see the Leaving list',
  'people.leavingReasonForReadOnly': 'Read-only users and IT administrators see the reason for leaving',
  'notifications.withdrawn': 'A withdrawn request’s notice',
  'leave.onEngine': 'Leave decided by the approval rules',
  'attendance.onEngine': 'Attendance requests, overtime and field punches decided by the approval rules',
};

/** Who changed each choice last, and when: "Changed by Asha, 31 Oct". */
export async function lastChanges(orgId: string) {
  const rows = await platformPrisma.auditLog.findMany({ where: { orgId, entity: 'COMPANY_SETTING', action: 'CHANGED', entityId: { in: CHOICE_KEYS } }, orderBy: { createdAt: 'desc' }, take: 200, select: { entityId: true, createdAt: true, createdByUserId: true } });
  const latest = new Map<string, { at: Date; by: string | null }>();
  for (const r of rows) if (!latest.has(r.entityId)) latest.set(r.entityId, { at: r.createdAt, by: r.createdByUserId });
  const ids = [...new Set([...latest.values()].map((x) => x.by).filter(Boolean) as string[])];
  const users = ids.length ? new Map((await platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } })).map((u) => [u.id, u.fullName || u.email])) : new Map<string, string>();
  return Object.fromEntries([...latest.entries()].map(([k, v]) => [k, { at: v.at, by: (v.by && users.get(v.by)) || null }]));
}

/** The screen's list: each choice with its value, choices, default, whether this person may change it, and the last change. */
export async function choicesScreen(req: Request) {
  const orgId = req.tenant!.orgId;
  const [values, changed] = await Promise.all([choicesFor(orgId), lastChanges(orgId)]);
  const items = [];
  for (const key of CHOICE_KEYS) {
    const def = CHOICES[key];
    const may = await mayChange(req, key);
    items.push({ key, value: valueOf(values, key), default: def.default, options: def.options, canChange: may.ok, ...(may.ok ? {} : { why: may.error }), changed: changed[key] || null });
  }
  return { choices: items };
}

// ---------------------------------------------------------------------------
// What the choices change
// ---------------------------------------------------------------------------

/** HR, the owner and admins: the person keeps the records (Employees edit), or an admin. */
async function keepsRecords(req: Request) {
  const refused = await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, PEOPLE_RESOURCE.employees);
  return !refused || Boolean(req.isAdmin);
}

/**
 * Who reads the reason typed for leaving (3.5), for people other than themselves:
 *   ALL          HR (Employees edit), the owner and admins; and Viewer / IT administrator (whole-company readers
 *                with the Lifecycle right) when the company says so.
 *   PER_LEAVING  a team manager: only a leaving whose exit interview was sent and not kept from managers (the
 *                per-leaving switch from #81, exitInterview.ts hideFromManager). The company switch never opens it.
 *   NONE         everyone else.
 * The person always reads their own.
 */
export type ReasonAccess = 'ALL' | 'PER_LEAVING' | 'NONE';
export async function leavingReasonAccess(req: Request): Promise<ReasonAccess> {
  if (await keepsRecords(req)) return 'ALL';
  if (await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, PEOPLE_RESOURCE.lifecycle)) return 'NONE';
  if (!(await teamScope(req)).all) return 'PER_LEAVING';
  return (await choicesFor(req.tenant!.orgId)).leavingReasonForReadOnly ? 'ALL' : 'NONE';
}

/** Leavings whose reason the leaver's managers may read: the exit interview was sent, not withdrawn, and not kept from them. Keys `employeeId|leavingDate`. */
export async function leavingsOpenToManagers(orgId: string, employeeIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(employeeIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const rows = await peoplePrisma.exitInterview.findMany({ where: { orgId, employeeId: { in: ids }, status: 'SUBMITTED', hideFromManager: false, withdrawnAt: null }, select: { employeeId: true, leavingDate: true } });
  return new Set(rows.map((r) => `${r.employeeId}|${r.leavingDate}`));
}

export type ReasonSubject = { id: string; userId?: string | null; dateOfLeaving?: string | null };
/**
 * One check for many people: whether this reader sees the reason for a person's leaving (by default their current
 * one, dateOfLeaving; or the leaving that ended on `leavingDate`, for a past stint).
 */
export async function leavingReasonFilter(req: Request, subjects: ReasonSubject[]) {
  const me = req.auth?.userId;
  const access = await leavingReasonAccess(req);
  const open = access === 'PER_LEAVING' ? await leavingsOpenToManagers(req.tenant!.orgId, subjects.map((s) => s.id)) : new Set<string>();
  return (s: ReasonSubject, leavingDate: string | null | undefined = s.dateOfLeaving) => {
    if (s.userId && s.userId === me) return true;
    if (access === 'ALL') return true;
    if (access === 'PER_LEAVING') return Boolean(leavingDate) && open.has(`${s.id}|${String(leavingDate).slice(0, 10)}`);
    return false;
  };
}

/** One person: whether this reader sees the reason for their current leaving. */
export async function seesLeavingReason(req: Request, subject: ReasonSubject) {
  return (await leavingReasonFilter(req, [subject]))(subject);
}

/**
 * Who sees the Leaving list (3.5): everyone it opens for, unless the company says read-only users and IT
 * administrators do not. A team manager always sees their own team's leavings: they hand the work over.
 */
export async function seesLeavings(req: Request) {
  if (await keepsRecords(req)) return true;
  if (!(await teamScope(req)).all) return true;
  return (await choicesFor(req.tenant!.orgId)).leavingsForReadOnly;
}

/**
 * HR without Payroll access reading salary revisions (3.3): the company allows it, the person keeps employee records
 * (Employees edit), and holds no Payroll right to the revisions (they would use Payroll's own screen).
 */
export async function readsRevisionsAsHr(req: Request) {
  if (!(await authorize(req, 'PAYROLL', PermissionAction.VIEW, 'Salary Revisions'))) return false;
  if (await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, PEOPLE_RESOURCE.employees)) return false;
  if (!(await teamScope(req)).all) return false;
  return (await choicesFor(req.tenant!.orgId)).hrSeesSalaryRevisions;
}
