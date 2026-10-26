import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction, type PermissionAction as PermissionActionType } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { AnonymiseError, anonymiseEmployee } from '../services/anonymiseEmployee.js';
import { retentionExceptions } from '../services/people/privacy.js';
import { recordAudit } from '../services/auditTrail.js';
import { peopleEvent } from '../services/people/documentReminders.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { pushEmployeeToReaders, readerFieldsChanged, revokeFromReaders } from '../services/attendance/readerSync.js';
import { emit as emitWebhook, employeeEvent } from '../services/attendance/webhooks.js';
import { deleteToBin } from '../services/recycleBin.js';
import { episodesOf } from '../services/people/episodes.js';
import { joiningCorrected, timelineOf } from '../services/people/employmentHistory.js';
import { StaleEmployeeError, createEmployee, updateEmployee, correlationOf } from '../services/people/employees.js';
import { SCHEDULABLE_FIELDS, asOf, cancelScheduledChange, pendingChangesOf, scheduleChanges } from '../services/people/effectiveDating.js';
import { writeChangeLog, type Actor, type Change, type ChangeSource } from '../services/people/changeLog.js';
import { checkIdentifier, maskTail } from '../services/people/identifiers.js';
import { PAYROLL_STATUTORY_FIELDS, maskedStatutory, revealStatutory } from '../services/payroll/statutoryRead.js';
import { stepUpRefusal } from '../services/stepUp.js';
import { inScope, scopeWhere, teamScope } from '../services/people/scope.js';
import { activeRule, shape as shapeRequest, submitRequest } from '../services/people/approvals/engine.js';
import { PROBATION_OUTCOMES, ProbationError, decideProbation, reviewsOf, saveReview } from '../services/people/lifecycle/probation.js';
import { changeImpact } from '../services/people/lifecycle/changes.js';
import { isFeatureEnabled } from '../services/features.js';
import { closeOutFor } from '../services/people/lifecycle/closeOut.js';
import { DEFAULT_EMPLOYEE_TYPES, EMPLOYMENT_KINDS, HOURS, guessKind } from '../services/people/employmentKinds.js';
import { journeyOf, whyOf } from '../services/people/journey.js';
import { salaryQuestion } from '../services/people/salaryQuestion.js';
import { activityOf } from '../services/people/activity.js';
import { BULK_LIMIT, BulkError, bulkUpdate } from '../services/people/bulk.js';
import { deleteView, saveView, viewsFor } from '../services/people/savedViews.js';
import { raiseRequest } from '../services/people/desk.js';
import { HeadcountError, headcount as headcountOf, snooze as snoozeCheck, snoozeHistory, unsnooze as unsnoozeCheck } from '../services/people/headcount.js';
import { SelfServiceError, saveSettings, settingsOf } from '../services/people/selfService.js';
import { CustomFieldError, FIELD_TYPES, defsOf, saveDef as saveCustomFieldDef, setValues as setCustomValues, valuesFor as customValuesFor } from '../services/people/customFields.js';
import { PERMIT_KINDS, daysUntil } from '../services/people/documentReminders.js';
import { decodeDocument } from '../services/people/documentFiles.js';
import { NO_ORIGINALS_STATES } from '../services/people/letters.js';
import { ask as askToRead, remind as ackRemind, report as ackReport } from '../services/people/acknowledgements.js';
import { dataHealth, readinessOf } from '../services/people/dataHealth.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE } from '../services/payroll/guards.js';
import { KINDS, READER_ACCESS_ITEM, checklistOf, cleanItems, itemsFor, myTasks, openTasks, readTaskDoneToken, startChecklist, type Kind as ChecklistKind } from '../services/people/checklists.js';
import { addCustom, calendar, evidenceOf, updateTask } from '../services/people/compliance.js';
import { homeTodos } from '../services/people/home.js';
import { PAYROLL_HISTORY, lockPayrollEmployee } from '../services/payroll/employeeLock.js';
/* Only for Payroll's own delete guard (employeeLock.ts), which takes a payroll transaction; People reads nothing else from it. */
import { payrollPrisma } from '../utils/payrollPrisma.js';

/**
 * People: the staff directory.
 *
 * Feature set after Horilla HRMS's employee and base modules (design and
 * operations reference; none of its code): employee files with personal and
 * work details, an org structure (departments, job positions and roles,
 * employee and work types), tags, notes, an org chart, import, and an overview.
 *
 * Bank account, PAN and statutory numbers are payroll's and stay there; this
 * directory does not read them.
 */
export const peopleRouter = Router();
peopleRouter.use(requireAuth, requireTenantContext);

const { employees: EMPLOYEES, structure: STRUCTURE, notes: NOTES, documents: DOCUMENTS, confidentialDocuments: CONFIDENTIAL, statutory: STATUTORY, lifecycle: LIFECYCLE } = PEOPLE_RESOURCE;
const can = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
/** Who is making this change and why, for the change log and the outbox (services/people/changeLog.ts). */
const actorOf = (req: Request, source: ChangeSource, reason: string | null = null): Actor => ({
  accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth?.userId || null, source, correlationId: correlationOf(req as any), reason,
});

const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_NOTICE', 'LEFT', 'SUSPENDED'] as const;
/* Inclusive options, and the right not to say (CORE-03). */
export const GENDER_OPTIONS = ['MALE', 'FEMALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY'] as const;
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/* A real day, not only the right shape: 2026-13-01 and 2026-02-30 are refused. */
const realDay = (v: string) => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };
const date = z.string().trim().regex(ISO_DATE, 'Dates are YYYY-MM-DD.').refine(realDay, 'That date does not exist.').optional().nullable().or(z.literal(''));
/* A phone number: 7 to 15 digits once spaces, dashes, brackets and a leading + are set aside. */
const phoneField = z.string().trim().max(40).refine((v) => !v || /^\+?[\d\s\-()]+$/.test(v) && v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 15, 'That phone number is too short or has letters in it.').optional().nullable();
const text = (max: number) => z.string().trim().max(max).optional().nullable();

/**
 * Personal details (Workforce audit E4): the date of birth, home address,
 * personal email, family and emergency contacts, private notes and card
 * number go to whoever keeps the records (an administrator, anyone who may
 * edit employees or see statutory details) and to the person themselves.
 * A read-only role (IT, a team lead) gets the work profile.
 */
const PERSONAL_FIELDS = ['dateOfBirth', 'maritalStatus', 'guardianName', 'email', 'personalEmail', 'addressLine', 'city', 'state', 'country', 'pincode', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'notes', 'cardNumber'] as const;
async function seesPersonal(req: Request) {
  if (req.isAdmin) return true;
  if (!(await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, EMPLOYEES))) return true;
  return !(await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, STATUTORY));
}
const withoutPersonal = (row: any, me: string) => {
  if (row?.userId && row.userId === me) return row;
  const out = { ...row, personalHidden: true };
  for (const k of PERSONAL_FIELDS) delete out[k];
  return out;
};

/** One person by id in this company and inside the caller's team scope (scope.ts); outside it reads as absent. */
async function scopedEmployee<S extends Record<string, boolean>>(req: Request, id: string, select?: S) {
  const { accountId, orgId } = req.tenant!;
  const e = await peoplePrisma.employee.findFirst({ where: { id, accountId, orgId }, ...(select ? { select } : {}) });
  if (!e || !inScope(await teamScope(req), (e as any).id)) return null;
  return e as any;
}

/** Company-wide HR work (imports, data requests, anonymising, linking logins): a role limited to its own team is refused. */
async function wholeCompany(req: Request, res: Response) {
  if ((await teamScope(req)).all) return true;
  res.status(403).json({ error: 'This is HR work for the whole company; your role covers your own team.' });
  return false;
}

/** A reason an import row is refused, worded for the person importing. */
class ImportRowError extends Error {}

const inWords = (iso: string) => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return y && m && d ? `${Number(d)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${y}` : iso; };
const SCHEDULED_WORDS: Record<string, string> = { departmentId: 'Department', jobPositionId: 'Designation', reportingManagerId: 'Manager', dottedManagerId: 'Secondary manager', areaId: 'Location', establishmentId: 'Work site', teamId: 'Team', seatId: 'Position', employeeTypeId: 'Employment type', workTypeId: 'Work mode', gradeId: 'Grade', costCenterId: 'Cost centre', businessUnitId: 'Business unit', jobRoleId: 'Job role', branchId: 'Branch', contractorId: 'Contractor' };
const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const blank = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
  return s ? s : null;
};

const employeeSchema = z.object({
  name: z.string().trim().max(120).optional(),
  firstName: text(60),
  lastName: text(60),
  preferredName: text(80),
  /* The version the editor saw (or send it as If-Match); a stale one gets 409 STALE. */
  version: z.coerce.number().int().positive().optional(),
  code: text(40),
  email: z.string().trim().email('That is not an email address.').max(160).optional().nullable().or(z.literal('')),
  phone: phoneField,
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  branchId: text(60),
  dateOfJoining: date,
  dateOfLeaving: date,
  notes: text(500),

  gender: z.enum(GENDER_OPTIONS).optional().nullable().or(z.literal('')),
  dateOfBirth: date,
  maritalStatus: z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']).optional().nullable().or(z.literal('')),
  personalEmail: z.string().trim().email('That is not an email address.').max(160).optional().nullable().or(z.literal('')),
  photoUrl: z.string().max(300_000, 'That photo is too large; use one under 200 KB.').optional().nullable(),
  addressLine: text(240),
  city: text(80),
  state: text(80),
  country: text(80),
  pincode: text(12),
  emergencyContactName: text(120),
  emergencyContactPhone: phoneField,
  emergencyContactRelation: text(60),

  departmentId: text(60),
  jobPositionId: text(60),
  jobRoleId: text(60),
  businessUnitId: text(60),
  gradeId: text(60),
  costCenterId: text(60),
  employeeTypeId: text(60),
  workTypeId: text(60),
  hours: z.enum(HOURS).optional().nullable().or(z.literal('')).transform((v) => v || null),
  reportingManagerId: text(60),
  dottedManagerId: text(60),
  workEmail: z.string().trim().email('That is not an email address.').max(160).optional().nullable().or(z.literal('')),
  workPhone: phoneField,
  workLocation: text(120),
  devicePin: text(40),
  areaId: text(60),
  establishmentId: text(60),
  teamId: text(60),
  seatId: text(60),
  contractorId: text(60),
  cardNumber: text(40),
  devicePassword: text(20),
  devicePrivilege: z.coerce.number().int().refine((n) => n === 0 || n === 14, 'Reader privilege is user or administrator.').optional(),
  attendanceRequired: z.boolean().optional(),
  guardianName: text(150),
  probationEndDate: date,
  contractEndDate: date,

  tagIds: z.array(z.string().trim().min(1)).max(50).optional(),
});
type EmployeeBody = z.infer<typeof employeeSchema>;

/** The display name: what was typed, or first + last. */
const composeName = (b: EmployeeBody, fallback = '') =>
  String(b.name || '').trim() || [b.firstName, b.lastName].map((x) => String(x || '').trim()).filter(Boolean).join(' ') || fallback;

/**
 * The org-structure ids a body names, checked against this org, and the
 * display strings they imply: `department` and `designation` stay the strings
 * payroll and every older screen read, so they are written alongside the ids.
 */
async function resolveStructure(orgId: string, b: EmployeeBody) {
  const out: Record<string, string | null> = {};
  const check = async (key: keyof EmployeeBody, find: (id: string) => Promise<{ name: string } | null>) => {
    if (b[key] === undefined) return null;
    const id = blank(b[key]);
    if (!id) {
      out[key as string] = null;
      return null;
    }
    const row = await find(id);
    if (!row) throw Object.assign(new Error(`That ${String(key).replace(/Id$/, '')} is not in this organisation.`), { status: 400 });
    out[key as string] = id;
    return row;
  };
  const dept = await check('departmentId', (id) => peoplePrisma.department.findFirst({ where: { id, orgId }, select: { name: true } }));
  const pos = await check('jobPositionId', (id) => peoplePrisma.jobPosition.findFirst({ where: { id, orgId }, select: { name: true } }));
  await check('jobRoleId', (id) => peoplePrisma.jobRole.findFirst({ where: { id, orgId }, select: { name: true } }));
  await check('employeeTypeId', (id) => peoplePrisma.employeeType.findFirst({ where: { id, orgId }, select: { name: true } }));
  await check('workTypeId', (id) => peoplePrisma.workType.findFirst({ where: { id, orgId }, select: { name: true } }));
  await check('areaId', (id) => peoplePrisma.area.findFirst({ where: { id, orgId }, select: { name: true } }));
  await check('establishmentId', (id) => peoplePrisma.establishment.findFirst({ where: { id, orgId }, select: { name: true } }));
  await check('teamId', (id) => peoplePrisma.team.findFirst({ where: { id, orgId }, select: { name: true } }));
  await check('seatId', (id) => peoplePrisma.seat.findFirst({ where: { id, orgId }, select: { name: true } }));
  await check('contractorId', (id) => peoplePrisma.contractor.findFirst({ where: { id, orgId }, select: { name: true } }));
  await check('businessUnitId', (id) => peoplePrisma.businessUnit.findFirst({ where: { id, orgId }, select: { name: true } }));
  await check('gradeId', (id) => peoplePrisma.grade.findFirst({ where: { id, orgId }, select: { name: true } }));
  await check('costCenterId', (id) => peoplePrisma.costCenter.findFirst({ where: { id, orgId }, select: { name: true } }));
  if (b.departmentId !== undefined) out.department = dept?.name ?? null;
  if (b.jobPositionId !== undefined) out.designation = pos?.name ?? null;
  return out;
}

/** A manager must be another person in this org, and not someone who reports to this one. */
async function checkManager(orgId: string, employeeId: string | null, managerId: string | null) {
  if (!managerId) return;
  if (employeeId && managerId === employeeId) throw Object.assign(new Error('Somebody cannot report to themselves.'), { status: 400 });
  let cursor: string | null = managerId;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const row: { id: string; reportingManagerId: string | null } | null = await peoplePrisma.employee.findFirst({
      where: { id: cursor, orgId },
      select: { id: true, reportingManagerId: true },
    });
    if (!row) throw Object.assign(new Error('That manager is not in this organisation.'), { status: 400 });
    if (employeeId && row.reportingManagerId === employeeId) {
      throw Object.assign(new Error('That would make a reporting loop: the manager already reports to this person.'), { status: 400 });
    }
    cursor = row.reportingManagerId;
  }
}

/* Hours left blank mean full-time; SQL's "not part-time" would skip those blank rows. Added to AND so it never meets the search's OR. */
const addHours = (where: any, v?: string) => {
  if (v) (where.AND ||= []).push(v === 'FULL_TIME' ? { OR: [{ hours: null }, { hours: { not: 'PART_TIME' } }] } : { hours: v });
};

const employeeData = (b: EmployeeBody) => {
  const d: Record<string, unknown> = {};
  const keys = [
    'firstName', 'lastName', 'preferredName', 'phone', 'branchId', 'dateOfJoining', 'dateOfLeaving', 'notes', 'gender', 'dateOfBirth',
    'maritalStatus', 'photoUrl', 'addressLine', 'city', 'state', 'country', 'pincode', 'emergencyContactName',
    'emergencyContactPhone', 'emergencyContactRelation', 'reportingManagerId', 'dottedManagerId', 'workPhone', 'workLocation',
    'probationEndDate', 'contractEndDate', 'hours', 'email', 'personalEmail', 'workEmail', 'devicePin',
    'cardNumber', 'devicePassword', 'guardianName',
  ] as const;
  for (const k of keys) if (b[k] !== undefined) d[k] = blank(b[k]);
  if (b.devicePrivilege !== undefined) d.devicePrivilege = b.devicePrivilege;
  if (b.attendanceRequired !== undefined) d.attendanceRequired = b.attendanceRequired;
  if (b.status) d.status = b.status;
  return d;
};

const withMeta = async (orgId: string, rows: any[]) => {
  const managerIds = [...new Set(rows.flatMap((r) => [r.reportingManagerId, r.dottedManagerId]).filter(Boolean))] as string[];
  const managers = managerIds.length
    ? await peoplePrisma.employee.findMany({ where: { orgId, id: { in: managerIds } }, select: { id: true, name: true } })
    : [];
  const managerName = new Map(managers.map((m) => [m.id, m.name]));
  const [areas, contractors, units, grades, centres, establishments, teams, seats] = await Promise.all([
    peoplePrisma.area.findMany({ where: { orgId }, select: { id: true, name: true } }),
    peoplePrisma.contractor.findMany({ where: { orgId }, select: { id: true, name: true } }),
    peoplePrisma.businessUnit.findMany({ where: { orgId }, select: { id: true, name: true } }),
    peoplePrisma.grade.findMany({ where: { orgId }, select: { id: true, name: true } }),
    peoplePrisma.costCenter.findMany({ where: { orgId }, select: { id: true, name: true } }),
    peoplePrisma.establishment.findMany({ where: { orgId }, select: { id: true, name: true, state: true } }),
    peoplePrisma.team.findMany({ where: { orgId }, select: { id: true, name: true } }),
    peoplePrisma.seat.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  const establishmentOf = new Map(establishments.map((x) => [x.id, x]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const seatName = new Map(seats.map((t) => [t.id, t.name]));
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const contractorName = new Map(contractors.map((c) => [c.id, c.name]));
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const gradeName = new Map(grades.map((g) => [g.id, g.name]));
  const centreName = new Map(centres.map((c) => [c.id, c.name]));
  /* Secrets never leave the server: the reader PIN, and the employee app's password and set-up hashes. */
  return rows.map(({ devicePassword, portalPasswordHash, portalSetupHash, portalSetupExpires, ...r }: any) => ({
    ...r,
    /* The reader PIN is write-only here; screens only need to know one is set. */
    hasDevicePassword: Boolean(devicePassword),
    hasPortalPassword: Boolean(portalPasswordHash),
    portalSetupPending: Boolean(portalSetupHash && portalSetupExpires && new Date(portalSetupExpires) > new Date()),
    areaName: r.areaId ? areaName.get(r.areaId) || null : null,
    contractorName: r.contractorId ? contractorName.get(r.contractorId) || null : null,
    businessUnitName: r.businessUnitId ? unitName.get(r.businessUnitId) || null : null,
    gradeName: r.gradeId ? gradeName.get(r.gradeId) || null : null,
    costCenterName: r.costCenterId ? centreName.get(r.costCenterId) || null : null,
    /* Where they work in law, and the state whose rules apply (FND-07): the establishment's, never the home address. */
    establishment: r.establishmentId ? establishmentOf.get(r.establishmentId)?.name || null : null,
    workState: r.establishmentId ? establishmentOf.get(r.establishmentId)?.state || null : null,
    teamName: r.teamId ? teamName.get(r.teamId) || null : null,
    seatName: r.seatId ? seatName.get(r.seatId) || null : null,
    reportingManagerName: r.reportingManagerId ? managerName.get(r.reportingManagerId) || null : null,
    dottedManagerName: r.dottedManagerId ? managerName.get(r.dottedManagerId) || null : null,
    tags: (r.tags || []).map((l: any) => ({ id: l.tag.id, name: l.tag.name, color: l.tag.color })),
  }));
};

const sendError = (res: any, e: any) => {
  if (e?.status) return res.status(e.status).json({ error: e.message });
  if (String(e?.code) === 'P2002') return res.status(409).json({ error: 'That code, name or reader ID is already used in this organisation.' });
  throw e;
};

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * Statutory and bank details on the employee file (PE-05), read from the
 * payroll profile where Payroll keeps them, always masked here, and only for
 * someone allowed to see payroll profiles. Nothing is edited from People.
 */
/**
 * Statutory details (docs/people/02-PRD.md CORE-04). PAN, UAN, ESIC and bank
 * are Payroll's, read through its interface (services/payroll/statutoryRead.ts)
 * and shown masked; People keeps the last four of Aadhaar, passport, work
 * permit and the statutory category. Needs the Statutory Details grant, not
 * just Employees VIEW. A full value is revealed one field at a time with a
 * fresh authenticator code, and every reveal is logged.
 */
const identitySchema = z.object({
  aadhaarLast4: text(4),
  passportNumber: text(20),
  passportExpiry: date,
  workPermitNumber: text(30),
  workPermitExpiry: date,
  statutoryCategory: z.enum(['WORKER', 'SUPERVISOR', 'MANAGER', 'APPRENTICE', 'CONTRACT']).optional().nullable().or(z.literal('')),
  categoryFrom: date,
});
const identityRow = (i: any) => ({
  aadhaarLast4: i?.aadhaarLast4 ? `********${i.aadhaarLast4}` : '',
  passportNumber: maskTail(i?.passportNumber),
  passportExpiry: i?.passportExpiry || null,
  workPermitNumber: maskTail(i?.workPermitNumber),
  workPermitExpiry: i?.workPermitExpiry || null,
  statutoryCategory: i?.statutoryCategory || null,
  categoryFrom: i?.categoryFrom || null,
});

peopleRouter.get('/orgs/:orgId/people/employees/:id/statutory', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!employee || !inScope(await teamScope(req), employee.id)) return res.status(404).json({ error: 'No such employee.' });
  /* Without the grant the section says so, rather than refusing the whole record. */
  if (await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, STATUTORY)) return res.json({ visible: false });
  const [payroll, identity] = await Promise.all([maskedStatutory(orgId, employee.id), peoplePrisma.employeeIdentity.findUnique({ where: { employeeId: employee.id } })]);
  const canEdit = !(await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, STATUTORY));
  res.json({ visible: true, canEdit, ...payroll, identity: identityRow(identity) });
});

peopleRouter.put('/orgs/:orgId/people/employees/:id/identity', can(PermissionAction.EDIT, STATUTORY), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await scopedEmployee(req, String(req.params.id), { id: true });
  if (!employee) return res.status(404).json({ error: 'No such employee.' });
  const parsed = identitySchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the details.' });
  const b = parsed.data;
  for (const k of ['aadhaarLast4', 'passportNumber', 'workPermitNumber'] as const) {
    const problem = checkIdentifier(k, b[k] ?? null);
    if (problem) return res.status(400).json({ error: problem });
  }
  if (b.aadhaarLast4 && String(b.aadhaarLast4).length > 4) return res.status(400).json({ error: 'Only the last four digits of Aadhaar are kept.' });
  const data: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(b)) if (v !== undefined) data[k] = blank(v);
  const existing = await peoplePrisma.employeeIdentity.findUnique({ where: { employeeId: employee.id } });
  const actor = actorOf(req, 'FORM');
  const row = await peoplePrisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.employeeIdentity.update({ where: { employeeId: employee.id }, data: { ...data, updatedByUserId: req.auth!.userId } })
      : await tx.employeeIdentity.create({ data: { accountId, orgId, employeeId: employee.id, ...data, updatedByUserId: req.auth!.userId } });
    /* Logged as changed, never with the value (changeLog.ts). */
    const changes: Change[] = Object.keys(data).filter((k) => ((existing as any)?.[k] ?? null) !== data[k]).map((k) => ({ field: k, before: null, after: null, redacted: !['statutoryCategory', 'categoryFrom', 'passportExpiry', 'workPermitExpiry'].includes(k) }));
    for (const c of changes) if (!c.redacted) { c.before = (existing as any)?.[c.field] ?? null; c.after = data[c.field]; }
    await writeChangeLog(tx, actor, { kind: 'EmployeeIdentity', id: saved.id, employeeId: employee.id }, changes);
    return saved;
  });
  res.json({ identity: identityRow(row) });
});

/** One value in clear, for a person with the grant and a fresh authenticator code; written to the access log. */
peopleRouter.post('/orgs/:orgId/people/employees/:id/statutory/reveal', can(PermissionAction.VIEW, STATUTORY), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await scopedEmployee(req, String(req.params.id), { id: true });
  if (!employee) return res.status(404).json({ error: 'No such employee.' });
  const field = String(req.body?.field || '');
  const payrollField = (PAYROLL_STATUTORY_FIELDS as readonly string[]).includes(field);
  const peopleField = ['passportNumber', 'workPermitNumber'].includes(field);
  if (!payrollField && !peopleField) return res.status(400).json({ error: 'Say which value to show: pan, uan, esic, account, passportNumber or workPermitNumber.' });
  const refused = await stepUpRefusal(req, 'Showing a full identifier needs an authenticator app. Set one up in your profile first (your name or picture, top right).');
  if (refused) return res.status(refused.status).json(refused.body);
  const value = payrollField
    ? await revealStatutory(orgId, employee.id, field as any)
    : ((await peoplePrisma.employeeIdentity.findUnique({ where: { employeeId: employee.id }, select: { [field]: true } as any })) as any)?.[field] ?? null;
  await peoplePrisma.accessLog.create({ data: { accountId, orgId, what: 'STATUTORY', entityId: employee.id, employeeId: employee.id, field, userId: req.auth!.userId } });
  res.json({ field, value });
});

/** People → Home: what needs someone today (services/people/home.ts). */
peopleRouter.get('/orgs/:orgId/people/home', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ todos: await homeTodos(req) });
});

peopleRouter.get('/orgs/:orgId/people/overview', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, ...scopeWhere(await teamScope(req)) },
    select: { id: true, name: true, status: true, departmentId: true, department: true, dateOfJoining: true, dateOfLeaving: true, dateOfBirth: true, photoUrl: true, designation: true },
  });
  const today = new Date();
  /* India's month, and today's headcount: someone joining next week is not working here yet. */
  const todayIn = todayIst();
  const ym = todayIn.slice(0, 7);
  const active = rows.filter((r) => r.status !== 'LEFT' && (!r.dateOfJoining || String(r.dateOfJoining).slice(0, 10) <= todayIn));
  const byDepartment = new Map<string, number>();
  for (const r of active) {
    const k = r.department || 'Unassigned';
    byDepartment.set(k, (byDepartment.get(k) || 0) + 1);
  }
  /* Birthdays in the next 30 days, by month-day, whatever the year. */
  const soon = active
    .filter((r) => r.dateOfBirth && ISO_DATE.test(r.dateOfBirth))
    .map((r) => {
      const [, m, d] = r.dateOfBirth!.split('-').map(Number);
      let next = new Date(today.getFullYear(), m - 1, d);
      if (next < new Date(today.getFullYear(), today.getMonth(), today.getDate())) next = new Date(today.getFullYear() + 1, m - 1, d);
      return { id: r.id, name: r.name, photoUrl: r.photoUrl, date: next.toISOString().slice(0, 10), days: Math.round((next.getTime() - today.getTime()) / 86_400_000) };
    })
    .filter((b) => b.days <= 30)
    .sort((a, b) => a.days - b.days)
    .slice(0, 10);
  res.json({
    headcount: active.length,
    byStatus: Object.fromEntries(EMPLOYEE_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length])),
    byDepartment: [...byDepartment.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    joinedThisMonth: rows
      /* This month so far: a joiner later this month is under Joining, not joined (W14). */
      .filter((r) => String(r.dateOfJoining || '').startsWith(ym) && String(r.dateOfJoining).slice(0, 10) <= todayIn)
      .map((r) => ({ id: r.id, name: r.name, designation: r.designation, date: r.dateOfJoining })),
    leftThisMonth: rows.filter((r) => r.status === 'LEFT' && String(r.dateOfLeaving || '').startsWith(ym)).length,
    upcomingBirthdays: soon,
  });
});

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

peopleRouter.get('/orgs/:orgId/people/employees', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const q = String(req.query.q || '').trim();
  const pick = (k: string) => String(req.query[k] || '').trim() || undefined;
  const tagId = pick('tagId');
  /* A role limited to its own records sees its own team only (services/people/scope.ts). */
  const scope = await teamScope(req);
  /* Workforce "My team" (WF-01): the caller's own reports, solid or dotted line. */
  const mine = req.query.team === 'mine' ? await peoplePrisma.employee.findFirst({ where: { orgId, userId: req.auth!.userId }, select: { id: true } }) : null;
  if (req.query.team === 'mine' && !mine) return res.json({ employees: [], total: 0 });
  const where: any = {
    accountId,
    orgId,
    ...scopeWhere(scope),
    ...(mine ? { AND: [{ OR: [{ reportingManagerId: mine.id }, { dottedManagerId: mine.id }] }] } : {}),
    ...statusWhere(pick('status')),
    ...(pick('departmentId') ? { departmentId: pick('departmentId') } : {}),
    ...(pick('jobPositionId') ? { jobPositionId: pick('jobPositionId') } : {}),
    ...(pick('employeeTypeId') ? { employeeTypeId: pick('employeeTypeId') } : {}),
    ...(pick('workTypeId') ? { workTypeId: pick('workTypeId') } : {}),
    /* On probation until confirmed in writing, whether or not the date has passed (a passed one is the more urgent). */
    ...(pick('probation') === 'on' ? { probationEndDate: { not: null }, confirmedOn: null } : {}),
    ...(pick('contract') === 'ending' ? { contractEndDate: { not: null, lte: addDaysIso(todayIst(), 30) } } : {}),
    ...(pick('businessUnitId') ? { businessUnitId: pick('businessUnitId') } : {}),
    ...(pick('gradeId') ? { gradeId: pick('gradeId') } : {}),
    ...(pick('costCenterId') ? { costCenterId: pick('costCenterId') } : {}),
    ...(pick('managerId') ? { reportingManagerId: pick('managerId') } : {}),
    /* People design v1 EMP-01: location (site), establishment, joining-date range. */
    ...(pick('areaId') ? { areaId: pick('areaId') } : {}),
    ...(pick('establishmentId') ? { establishmentId: pick('establishmentId') } : {}),
    ...(pick('joinedFrom') || pick('joinedTo') ? { dateOfJoining: { ...(pick('joinedFrom') ? { gte: pick('joinedFrom') } : {}), ...(pick('joinedTo') ? { lte: pick('joinedTo') } : {}) } } : {}),
    ...(pick('leftFrom') || pick('leftTo') ? { dateOfLeaving: { not: null, ...(pick('leftFrom') ? { gte: pick('leftFrom') } : {}), ...(pick('leftTo') ? { lte: pick('leftTo') } : {}) } } : {}),
    ...(tagId ? { tags: { some: { tagId } } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { code: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { workEmail: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { designation: { contains: q, mode: 'insensitive' } },
            { department: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  addHours(where, pick('hours'));
  /* Working now: here and already joined; the count strip's first tile opens exactly these (W14). */
  if (pick('working') === 'now') (where.AND ||= []).push({ status: { not: 'LEFT' } }, { OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: todayIst() } }] });
  /* Every id the filters match (Select all matching, WF-07): the same filters and scope, capped at what one bulk change takes. */
  if (req.query.idsOnly === '1') {
    const [found, total] = await Promise.all([
      peoplePrisma.employee.findMany({ where, select: { id: true }, orderBy: { id: 'asc' }, take: BULK_LIMIT }),
      peoplePrisma.employee.count({ where }),
    ]);
    return res.json({ ids: found.map((r) => r.id), total, capped: total > BULK_LIMIT });
  }
  const take = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
  const skip = Math.max(0, Number(req.query.offset || 0));
  const asOfDate = String(req.query.asOf || '').trim();
  const [rows, total] = await Promise.all([
    peoplePrisma.employee.findMany({
      where,
      include: { tags: { include: { tag: true } } },
      orderBy: directoryOrder(String(req.query.sort || ''), String(req.query.dir || '')),
      take,
      skip,
    }),
    peoplePrisma.employee.count({ where }),
  ]);
  /* As of a date (FND-03): the job fields rolled back through history; people not yet there are left out. */
  const viewed = asOfDate ? await asOf(orgId, rows as any[], asOfDate) : rows;
  const personal = await seesPersonal(req);
  const shapedRows = await withMeta(orgId, viewed);
  res.json({ employees: personal ? shapedRows : shapedRows.map((r: any) => withoutPersonal(r, req.auth!.userId)), total: asOfDate ? viewed.length : total, asOf: asOfDate || undefined });
});

/* Sortable directory columns (People design v1 EMP-01); name breaks ties so a page never reshuffles. */
/* CURRENT is everyone still with the company (the directory's default); ALL includes those who left; otherwise one status. */
const statusWhere = (v?: string) => {
  const s = String(v || '').toUpperCase();
  if (!s || s === 'ALL') return {};
  if (s === 'CURRENT') return { status: { not: 'LEFT' as const } };
  return { status: s as any };
};
const SORTABLE: Record<string, string> = { name: 'name', code: 'code', department: 'department', designation: 'designation', dateOfJoining: 'dateOfJoining', status: 'status', location: 'workLocation' };
function directoryOrder(sort: string, dir: string): any[] {
  const field = SORTABLE[sort];
  const d = dir === 'desc' ? 'desc' : 'asc';
  if (!field) return [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }];
  /* Prisma takes nulls-last only on optional columns; name and status are always set. */
  const order = field === 'name' || field === 'status' ? { [field]: d } : { [field]: { sort: d, nulls: 'last' } };
  return [order, ...(field === 'name' ? [] : [{ name: 'asc' }]), { id: 'asc' }];
}

/**
 * The directory's headline counts (People design v1 EMP-01): everyone, active,
 * joining (a joining date still to come), on leave today (approved leave
 * covering today), on notice. Same team scope as the list.
 */
peopleRouter.get('/orgs/:orgId/people/employees/counts', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const scope = await teamScope(req);
  const base = { accountId, orgId, ...scopeWhere(scope) };
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  /* Working now: not left, and already joined (someone joining next week is under Joining, not in the headcount). */
  const joined = { OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: today } }] };
  const [byStatus, joining, onLeave, working, joinedThisMonth, leftThisMonth] = await Promise.all([
    peoplePrisma.employee.groupBy({ by: ['status'], where: { ...base, ...joined }, _count: { _all: true } }),
    peoplePrisma.employee.count({ where: { ...base, status: 'ACTIVE', dateOfJoining: { gt: today } } }),
    peoplePrisma.leaveRequest.findMany({ where: { orgId, status: 'APPROVED', fromDate: { lte: today }, toDate: { gte: today }, ...(scope.all ? {} : { employeeId: { in: (scope as any).ids } }) }, select: { employeeId: true }, distinct: ['employeeId'] }),
    peoplePrisma.employee.count({ where: { ...base, status: { not: 'LEFT' }, ...joined } }),
    peoplePrisma.employee.count({ where: { ...base, dateOfJoining: { gte: monthStart, lte: today } } }),
    peoplePrisma.employee.count({ where: { ...base, status: 'LEFT', dateOfLeaving: { gte: monthStart, lte: today } } }),
  ]);
  const of = (s: string) => byStatus.find((x) => x.status === s)?._count._all || 0;
  const me = await peoplePrisma.employee.findFirst({ where: { orgId, userId: req.auth!.userId }, select: { id: true } });
  const myTeam = me ? await peoplePrisma.employee.count({ where: { ...base, status: { not: 'LEFT' }, OR: [{ reportingManagerId: me.id }, { dottedManagerId: me.id }] } }) : 0;
  res.json({ total: working, active: of('ACTIVE'), onNotice: of('ON_NOTICE'), suspended: of('SUSPENDED'), left: of('LEFT'), joining, onLeave: onLeave.length, myTeam, joinedThisMonth, leftThisMonth, monthStart });
});

/** A suggestion for the next employee ID (People design v1 EMP-02): the company's own pattern, one past the highest. Still editable. */
peopleRouter.get('/orgs/:orgId/people/employees/next-code', can(PermissionAction.CREATE, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const codes = (await peoplePrisma.employee.findMany({ where: { orgId, code: { not: null } }, select: { code: true } })).map((r) => r.code!).filter(Boolean);
  res.json({ code: nextCode(codes) });
});

/** The most used prefix (letters and separators before the digits), and one past its highest number, keeping the width. */
export function nextCode(codes: string[]): string {
  const parsed = codes.map((c) => c.match(/^(.*?)(\d+)$/)).filter((m): m is RegExpMatchArray => Boolean(m));
  if (!parsed.length) return 'EMP-0001';
  const count = new Map<string, number>();
  for (const m of parsed) count.set(m[1], (count.get(m[1]) || 0) + 1);
  const prefix = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
  const same = parsed.filter((m) => m[1] === prefix);
  const width = Math.max(...same.map((m) => m[2].length));
  const max = Math.max(...same.map((m) => Number(m[2])));
  const taken = new Set(codes.map((c) => c.toLowerCase()));
  let n = max + 1;
  while (taken.has(`${prefix}${String(n).padStart(width, '0')}`.toLowerCase())) n += 1;
  return `${prefix}${String(n).padStart(width, '0')}`;
}

/**
 * Workforce → Pending actions (WF-01): what is waiting on employee records,
 * in the caller's scope. Requests waiting for approval about a person (and
 * whether the caller can decide the step), changes dated for later, joiner
 * details sent back to check, and the caller's own add-employee drafts.
 */
peopleRouter.get('/orgs/:orgId/people/workforce/pending', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const scope = await teamScope(req);
  const inScopeIds = (ids: string[]) => (scope.all ? ids : ids.filter((id) => (scope as any).ids.includes(id)));
  const [requests, scheduled, invites, drafts] = await Promise.all([
    peoplePrisma.approvalRequest.findMany({ where: { orgId, status: 'WAITING', subjectEmployeeId: { not: null } }, include: { steps: true }, orderBy: { createdAt: 'asc' }, take: 200 }),
    peoplePrisma.scheduledChange.findMany({ where: { orgId, status: 'PENDING' }, orderBy: [{ effectiveOn: 'asc' }], take: 200 }),
    peoplePrisma.joinInvite.findMany({ where: { orgId, status: 'RETURNED' }, orderBy: { returnedAt: 'asc' }, take: 200 }).catch(() => []),
    peoplePrisma.employeeDraft.findMany({ where: { orgId, userId: req.auth!.userId, expiresAt: { gt: new Date() } }, orderBy: { updatedAt: 'desc' }, take: 20 }),
  ]);
  const ids = inScopeIds([...new Set([...requests.map((r) => r.subjectEmployeeId!), ...scheduled.map((c) => c.employeeId), ...(invites as any[]).map((i) => i.employeeId)])]);
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true } })).map((e) => [e.id, e]));
  const label = (f: string) => ({ departmentId: 'Department', jobPositionId: 'Designation', reportingManagerId: 'Manager', dottedManagerId: 'Secondary manager', areaId: 'Location', establishmentId: 'Work site', teamId: 'Team', seatId: 'Position', employeeTypeId: 'Employment type', workTypeId: 'Work mode', gradeId: 'Grade', costCenterId: 'Cost centre', businessUnitId: 'Business unit', jobRoleId: 'Job role', status: 'Status' } as Record<string, string>)[f] || f;
  const me = req.auth!.userId;
  res.json({
    requests: requests.filter((r) => people.has(r.subjectEmployeeId!)).map((r) => {
      const step = r.steps.find((x) => x.order === r.currentStep && x.status === 'WAITING');
      return { id: r.id, title: r.title, type: r.requestType, employee: people.get(r.subjectEmployeeId!), createdAt: r.createdAt, dueAt: step?.dueAt || null, overdue: Boolean(step && step.dueAt < new Date()), mine: Boolean(step && ((step.candidateUserIds as string[]) || []).includes(me)) };
    }),
    scheduled: scheduled.filter((c) => people.has(c.employeeId)).map((c) => ({ id: c.id, employee: people.get(c.employeeId), field: c.field, label: label(c.field), from: c.fromLabel, to: c.toLabel, effectiveOn: c.effectiveOn, reason: c.reason })),
    invites: (invites as any[]).filter((i) => people.has(i.employeeId)).map((i) => ({ id: i.id, employee: people.get(i.employeeId), returnedAt: i.returnedAt })),
    drafts: drafts.map((d) => ({ id: d.id, label: d.label, step: d.step, updatedAt: d.updatedAt })),
  });
  void accountId;
});

/* ------------------------------------------------ add-employee drafts (EMP-02) */

const DRAFT_DAYS = 30;
const draftRow = (d: any) => ({ id: d.id, step: d.step, label: d.label, data: d.data, updatedAt: d.updatedAt, expiresAt: d.expiresAt });

peopleRouter.get('/orgs/:orgId/people/employee-drafts', can(PermissionAction.CREATE, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const rows = await peoplePrisma.employeeDraft.findMany({ where: { orgId, userId: req.auth!.userId, expiresAt: { gt: new Date() } }, orderBy: { updatedAt: 'desc' }, take: 20 });
  res.json({ drafts: rows.map(draftRow) });
});

peopleRouter.get('/orgs/:orgId/people/employee-drafts/:id', can(PermissionAction.CREATE, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const d = await peoplePrisma.employeeDraft.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId, userId: req.auth!.userId, expiresAt: { gt: new Date() } } });
  if (!d) return res.status(404).json({ error: 'No such draft.' });
  res.json({ draft: draftRow(d) });
});

/** Save the wizard as it stands; only its maker sees it. Statutory numbers are never kept in a draft. */
peopleRouter.put('/orgs/:orgId/people/employee-drafts/:id?', can(PermissionAction.CREATE, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const raw = req.body?.data && typeof req.body.data === 'object' && !Array.isArray(req.body.data) ? { ...req.body.data } : null;
  if (!raw) return res.status(400).json({ error: 'Nothing to save.' });
  for (const k of ['pan', 'aadhaar', 'aadhaarNumber', 'passportNumber', 'bankAccount', 'uan', 'esic', 'devicePassword']) delete raw[k];
  if (JSON.stringify(raw).length > 50_000) return res.status(400).json({ error: 'That draft is too large.' });
  const step = Math.min(4, Math.max(1, Number(req.body?.step || 1)));
  const label = String(raw.name || [raw.firstName, raw.lastName].filter(Boolean).join(' ') || '').trim().slice(0, 120) || null;
  const expiresAt = new Date(Date.now() + DRAFT_DAYS * 86_400_000);
  const id = req.params.id ? String(req.params.id) : null;
  if (id) {
    const mine = await peoplePrisma.employeeDraft.findFirst({ where: { id, orgId, userId: req.auth!.userId } });
    if (!mine) return res.status(404).json({ error: 'No such draft.' });
    const d = await peoplePrisma.employeeDraft.update({ where: { id }, data: { data: raw, step, label, expiresAt } });
    return res.json({ draft: draftRow(d) });
  }
  const count = await peoplePrisma.employeeDraft.count({ where: { orgId, userId: req.auth!.userId } });
  if (count >= 20) return res.status(409).json({ error: 'You have 20 drafts already. Finish or delete one first.' });
  const d = await peoplePrisma.employeeDraft.create({ data: { accountId, orgId, userId: req.auth!.userId, data: raw, step, label, expiresAt } });
  res.status(201).json({ draft: draftRow(d) });
});

peopleRouter.delete('/orgs/:orgId/people/employee-drafts/:id', can(PermissionAction.CREATE, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const r = await peoplePrisma.employeeDraft.deleteMany({ where: { id: String(req.params.id), orgId: req.tenant!.orgId, userId: req.auth!.userId } });
  if (!r.count) return res.status(404).json({ error: 'No such draft.' });
  res.json({ ok: true });
});

/* ------------------------------------------------ server export (EMP-01) */

/*
 * The fields an export may carry: work details and the mobile number (an
 * owner's contact list). Statutory numbers, the date of birth, gender, the
 * personal email, the home address and anything secret are never in this
 * list, so no choice of columns can reach them. The first eleven are the
 * default, as before.
 */
const STATUS_WORDS: Record<string, string> = { ACTIVE: 'Active', ON_NOTICE: 'On notice', SUSPENDED: 'Suspended', LEFT: 'Left' };
const EXPORT_COLUMNS: Array<[string, string, (e: any) => unknown]> = [
  ['Employee ID', 'code', (e) => e.code], ['Name', 'name', (e) => e.name], ['Preferred name', 'preferredName', (e) => e.preferredName],
  ['Work email', 'workEmail', (e) => e.workEmail || e.email], ['Phone', 'phone', (e) => e.phone], ['Department', 'department', (e) => e.department],
  ['Designation', 'designation', (e) => e.designation], ['Manager', 'reportingManagerName', (e) => e.reportingManagerName], ['Location', 'location', (e) => e.areaName || e.workLocation],
  ['Joining date', 'dateOfJoining', (e) => e.dateOfJoining], ['Status', 'status', (e) => (e.status === 'ACTIVE' && e.dateOfJoining && String(e.dateOfJoining).slice(0, 10) > todayIst() ? 'Joining' : STATUS_WORDS[e.status] || e.status)],
  ['Work phone', 'workPhone', (e) => e.workPhone], ['Secondary manager', 'dottedManagerName', (e) => e.dottedManagerName], ['Employment type', 'employeeType', (e) => e.employeeTypeName],
  ['Work mode', 'workType', (e) => e.workTypeName], ['Hours', 'hours', (e) => (e.hours === 'PART_TIME' ? 'Part-time' : 'Full-time')], ['Work site', 'establishment', (e) => e.establishment], ['Business unit', 'businessUnit', (e) => e.businessUnitName],
  ['Team', 'team', (e) => e.teamName], ['Position', 'position', (e) => e.seatName], ['Grade', 'grade', (e) => e.gradeName], ['Cost centre', 'costCentre', (e) => e.costCenterName],
  ['Probation ends', 'probationEndDate', (e) => e.probationEndDate], ['Contract ends', 'contractEndDate', (e) => e.contractEndDate], ['Tags', 'tags', (e) => (e.tags || []).map((t: any) => t.name).join('; ')],
];
const DEFAULT_EXPORT = EXPORT_COLUMNS.slice(0, 11).map(([, k]) => k);
/* A cell a spreadsheet would run as a formula is quoted; a plain number such as +91 98450 12345 is left as it is, so the file imports again. */
const PLAIN_NUMBER = /^[+-]?\d[\d\s().-]*$/;
const csvSafe = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The directory as CSV, with the filters on screen (People design v1 EMP-01:
 * "Import/export separately permission-checked and audited"). Needs the
 * Employees EXPORT grant; team scope applies; no statutory or secret columns;
 * an audit row records who exported how many.
 */
/** The columns an export can carry, and which are chosen unless the person picks others. */
peopleRouter.get('/orgs/:orgId/people/employees/export/columns', can(PermissionAction.EXPORT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ columns: EXPORT_COLUMNS.map(([label, key]) => ({ key, label, default: DEFAULT_EXPORT.includes(key) })) });
});

peopleRouter.get('/orgs/:orgId/people/employees/export', can(PermissionAction.EXPORT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const q = String(req.query.q || '').trim();
  const pick = (k: string) => String(req.query[k] || '').trim() || undefined;
  const scope = await teamScope(req);
  const where: any = {
    accountId, orgId, ...scopeWhere(scope),
    ...statusWhere(pick('status')),
    ...(pick('departmentId') ? { departmentId: pick('departmentId') } : {}),
    ...(pick('jobPositionId') ? { jobPositionId: pick('jobPositionId') } : {}),
    ...(pick('employeeTypeId') ? { employeeTypeId: pick('employeeTypeId') } : {}),
    ...(pick('managerId') ? { reportingManagerId: pick('managerId') } : {}),
    ...(pick('areaId') ? { areaId: pick('areaId') } : {}),
    ...(pick('workTypeId') ? { workTypeId: pick('workTypeId') } : {}),
    /* On probation until confirmed in writing, whether or not the date has passed (a passed one is the more urgent). */
    ...(pick('probation') === 'on' ? { probationEndDate: { not: null }, confirmedOn: null } : {}),
    ...(pick('contract') === 'ending' ? { contractEndDate: { not: null, lte: addDaysIso(todayIst(), 30) } } : {}),
    ...(pick('establishmentId') ? { establishmentId: pick('establishmentId') } : {}),
    ...(pick('businessUnitId') ? { businessUnitId: pick('businessUnitId') } : {}),
    ...(pick('gradeId') ? { gradeId: pick('gradeId') } : {}),
    ...(pick('costCenterId') ? { costCenterId: pick('costCenterId') } : {}),
    ...(pick('tagId') ? { tags: { some: { tagId: pick('tagId') } } } : {}),
    ...(pick('joinedFrom') || pick('joinedTo') ? { dateOfJoining: { ...(pick('joinedFrom') ? { gte: pick('joinedFrom') } : {}), ...(pick('joinedTo') ? { lte: pick('joinedTo') } : {}) } } : {}),
    ...(pick('leftFrom') || pick('leftTo') ? { dateOfLeaving: { not: null, ...(pick('leftFrom') ? { gte: pick('leftFrom') } : {}), ...(pick('leftTo') ? { lte: pick('leftTo') } : {}) } } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { workEmail: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }, { designation: { contains: q, mode: 'insensitive' } }, { department: { contains: q, mode: 'insensitive' } }] } : {}),
  };
  if (req.query.team === 'mine') {
    const mine = await peoplePrisma.employee.findFirst({ where: { orgId, userId: req.auth!.userId }, select: { id: true } });
    where.AND = [{ OR: mine ? [{ reportingManagerId: mine.id }, { dottedManagerId: mine.id }] : [{ id: '__none__' }] }];
  }
  addHours(where, pick('hours'));
  /* Working now: here and already joined; the count strip's first tile opens exactly these (W14). */
  if (pick('working') === 'now') (where.AND ||= []).push({ status: { not: 'LEFT' } }, { OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: todayIst() } }] });
  /* The rows ticked on screen: still inside the caller's scope and this company, whatever ids are sent. */
  const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 1000);
  if (ids.length) (where.AND ||= []).push({ id: { in: ids } });
  /* Only columns from the catalogue, in its order; none asked for means the default set. */
  const asked = String(req.query.columns || '').split(',').map((x) => x.trim()).filter(Boolean);
  const chosen = EXPORT_COLUMNS.filter(([, k]) => (asked.length ? asked.includes(k) : DEFAULT_EXPORT.includes(k)));
  if (!chosen.length) return res.status(400).json({ error: 'Choose at least one column.' });
  const rows = await peoplePrisma.employee.findMany({ where, include: { tags: { include: { tag: true } } }, orderBy: directoryOrder(String(req.query.sort || ''), String(req.query.dir || '')), take: 10_000 });
  const [types, workTypes] = await Promise.all([
    peoplePrisma.employeeType.findMany({ where: { orgId }, select: { id: true, name: true } }),
    peoplePrisma.workType.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const workTypeName = new Map(workTypes.map((t) => [t.id, t.name]));
  const shaped = (await withMeta(orgId, rows)).map((e: any) => ({ ...e, employeeTypeName: typeName.get(e.employeeTypeId) || null, workTypeName: workTypeName.get(e.workTypeId) || null }));
  const lines = [chosen.map(([h]) => h), ...shaped.map((e: any) => chosen.map(([, , f]) => f(e)))];
  await recordAudit(req, { entity: 'PEOPLE_EMPLOYEES', entityId: 'export', action: 'EXPORT', message: `Exported ${rows.length} ${rows.length === 1 ? 'employee' : 'employees'}`, metadata: { count: rows.length, columns: chosen.map(([, k]) => k), filters: Object.keys(req.query).filter((k) => k !== 'q' && k !== 'ids'), searched: Boolean(req.query.q), ticked: String(req.query.ids || '').split(',').filter(Boolean).length } });
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="employees-${new Date().toISOString().slice(0, 10)}.csv"`).set('Cache-Control', 'no-store');
  res.send(`\ufeff${lines.map((l) => l.map(csvSafe).join(',')).join('\r\n')}`);
});

/** Work permits and certificates on file, with how long they have left (LIFE-08): shown on the profile, not enforced. */
async function permitsOf(orgId: string, employeeId: string) {
  const now = new Date();
  const docs = await peoplePrisma.employeeDocument.findMany({ where: { orgId, employeeId, kind: { in: [...PERMIT_KINDS] }, expiresOn: { not: null } }, select: { id: true, kind: true, title: true, expiresOn: true, restrictsWork: true }, orderBy: { expiresOn: 'asc' } });
  return docs.map((d) => ({ ...d, daysLeft: daysUntil(d.expiresOn!, now), expired: daysUntil(d.expiresOn!, now) < 0 }));
}

peopleRouter.get('/orgs/:orgId/people/employees/link-candidates', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const members = await platformPrisma.userOrgMembership.findMany({ where: { accountId, orgId }, select: { userId: true } });
  const taken = new Set((await peoplePrisma.employee.findMany({ where: { orgId, userId: { not: null } }, select: { userId: true } })).map((e) => e.userId));
  const ids = members.map((m) => m.userId).filter((id) => !taken.has(id));
  const users = ids.length ? await platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true }, orderBy: { email: 'asc' } }) : [];
  res.json({ users: users.map((u) => ({ id: u.id, name: u.fullName || u.email, email: u.email })) });
});

peopleRouter.get('/orgs/:orgId/people/employees/:id', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const row = await peoplePrisma.employee.findFirst({
    where: { id: String(req.params.id), accountId, orgId },
    include: { tags: { include: { tag: true } } },
  });
  if (!row || !inScope(await teamScope(req), row.id)) return res.status(404).json({ error: 'No such employee.' });
  const reports = await peoplePrisma.employee.findMany({
    where: { orgId, reportingManagerId: row.id, status: { not: 'LEFT' } },
    select: { id: true, name: true, designation: true, photoUrl: true },
    orderBy: { name: 'asc' },
  });
  const asOfDate = String(req.query.asOf || '').trim();
  const viewed = asOfDate ? (await asOf(orgId, [row as any], asOfDate))[0] : row;
  if (!viewed) return res.status(404).json({ error: `Not here on ${asOfDate}.` });
  const scheduledChanges = await pendingChangesOf(orgId, row.id);
  const [full] = await withMeta(orgId, [viewed]);
  const viewScope = await teamScope(req);
  /* The manager's name is shown either way; whether their record opens depends on the viewer's scope (E20). */
  const shaped = { ...((await seesPersonal(req)) ? full : withoutPersonal(full, req.auth!.userId)), managerOpens: !row.reportingManagerId || inScope(viewScope, row.reportingManagerId), ownRecordLocked: !viewScope.all && Boolean(row.userId) && row.userId === req.auth!.userId };
  const linked = row.userId ? await platformPrisma.user.findFirst({ where: { id: row.userId }, select: { fullName: true, email: true } }) : null;
  res.json({ scheduledChanges, permits: await permitsOf(orgId, row.id), employee: { ...shaped, directReports: reports, linkedUser: linked ? { name: linked.fullName || linked.email, email: linked.email } : null } });
});

/** Replace a person's tags; a real change goes on their change log by tag name (Workforce Activity). */
async function setTags(accountId: string, orgId: string, employeeId: string, tagIds: string[], actor?: Actor) {
  const valid = await peoplePrisma.employeeTag.findMany({ where: { orgId, id: { in: tagIds } }, select: { id: true, name: true } });
  const before = await peoplePrisma.employeeTagLink.findMany({ where: { orgId, employeeId }, select: { tag: { select: { name: true } } } });
  const was = before.map((l) => l.tag.name).sort().join(', ');
  const now = valid.map((t) => t.name).sort().join(', ');
  await peoplePrisma.$transaction(async (tx) => {
    await tx.employeeTagLink.deleteMany({ where: { employeeId } });
    for (const t of valid) await tx.employeeTagLink.create({ data: { accountId, orgId, employeeId, tagId: t.id } });
    if (actor && was !== now) await writeChangeLog(tx as any, actor, { kind: 'Employee', id: employeeId, employeeId }, [{ field: 'tags', before: was || null, after: now || null, redacted: false }]);
  });
}

/** People already here who share an email, phone or employee ID with what is being saved (CORE-02). */
async function findDuplicates(orgId: string, exceptId: string | null, b: { email?: string | null; personalEmail?: string | null; workEmail?: string | null; phone?: string | null; code?: string | null }) {
  const emails = [...new Set([b.email, b.personalEmail, b.workEmail].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean))];
  const phone = String(b.phone || '').replace(/\D/g, '').slice(-10);
  const code = String(b.code || '').trim();
  if (!emails.length && !phone && !code) return [];
  const rows = await peoplePrisma.employee.findMany({
    /* Someone who left counts too: adding them again as new loses their history; the answer says to rehire them (W13). */
    where: { orgId, ...(exceptId ? { id: { not: exceptId } } : {}), OR: [
      ...(emails.length ? [{ email: { in: emails, mode: 'insensitive' as const } }, { personalEmail: { in: emails, mode: 'insensitive' as const } }, { workEmail: { in: emails, mode: 'insensitive' as const } }] : []),
      /* Phones are stored as typed ("+91 98765 11111"); the last four digits narrow the query and the digits decide. */
      ...(phone ? [{ phone: { contains: phone.slice(-4) } }] : []),
      ...(code ? [{ code }] : []),
    ] },
    select: { id: true, name: true, code: true, email: true, personalEmail: true, workEmail: true, phone: true, status: true }, take: 20,
  });
  const digits = (v: string | null) => String(v || '').replace(/\D/g, '');
  const out: Array<{ id: string; name: string; code: string | null; field: string; left?: boolean }> = [];
  for (const r of rows) {
    const field = code && r.code === code ? 'employee ID' : phone && digits(r.phone).endsWith(phone) ? 'phone' : emails.some((e) => [r.email, r.personalEmail, r.workEmail].map((x) => String(x || '').toLowerCase()).includes(e)) ? 'email' : null;
    if (field) out.push({ id: r.id, name: r.name, code: r.code, field, ...(r.status === 'LEFT' ? { left: true } : {}) });
  }
  return out.slice(0, 5);
}

/** A seat holds one person (ORG-04): taken by someone else, it is refused in words. */
async function seatFree(orgId: string, seatId: string | null | undefined, exceptId: string | null) {
  if (!seatId) return null;
  /* Someone who left no longer holds it (W12). */
  const holder = await peoplePrisma.employee.findFirst({ where: { orgId, seatId, status: { not: 'LEFT' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true, code: true } });
  return holder ? `${holder.name}${holder.code ? ` (${holder.code})` : ''} already holds that seat.` : null;
}

peopleRouter.post('/orgs/:orgId/people/employees', can(PermissionAction.CREATE, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = employeeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid employee.' });
  const b = parsed.data;
  const name = composeName(b);
  if (!name) return res.status(400).json({ error: 'An employee needs a name.' });
  if (b.dateOfLeaving && b.dateOfJoining && b.dateOfLeaving < b.dateOfJoining) {
    return res.status(400).json({ error: 'Somebody cannot leave before they joined.' });
  }
  /* The same person twice (CORE-02): a matching email, phone or employee ID on someone already here is shown, and saving anyway needs a reason. */
  const duplicates = await findDuplicates(orgId, null, b);
  const duplicateReason = typeof req.body?.duplicateReason === 'string' ? req.body.duplicateReason.trim().slice(0, 500) : '';
  if (duplicates.length && !duplicateReason) return res.status(409).json({ error: `${duplicates[0].name} already has this ${duplicates[0].field}. Open their record, or say why this is a different person.`, code: 'DUPLICATE', duplicates });
  try {
    const structure = await resolveStructure(orgId, b);
    const taken = await seatFree(orgId, blank(b.seatId), null);
    if (taken) return res.status(409).json({ error: taken });
    await checkManager(orgId, null, blank(b.reportingManagerId));
    await checkManager(orgId, null, blank(b.dottedManagerId));
    const row = await createEmployee(actorOf(req, 'FORM', duplicates.length ? `Saved despite a match on ${duplicates.map((d) => `${d.field} (${d.name})`).join(', ')}: ${duplicateReason}` : null), {
      accountId,
      orgId,
      name,
      code: blank(b.code),
      ...employeeData(b),
      ...structure,
      status: b.status || 'ACTIVE',
      createdByUserId: req.auth!.userId,
    } as any);
    if (b.tagIds?.length) await setTags(accountId, orgId, row.id, b.tagIds, actorOf(req, 'FORM'));
    await startChecklist({ accountId, orgId, userId: req.auth!.userId }, row, 'JOINING', row.dateOfJoining);
    /* On every reader straight away, as ClorTime does: enrolment can start the same minute. */
    await pushEmployeeToReaders(orgId, row, req.auth!.userId);
    /* Created from a wizard draft (EMP-02): the draft has done its job. */
    if (typeof req.body?.draftId === 'string') await peoplePrisma.employeeDraft.deleteMany({ where: { id: req.body.draftId, orgId, userId: req.auth!.userId } });
    const fresh = (await peoplePrisma.employee.findUnique({ where: { id: row.id }, include: { tags: { include: { tag: true } } } })) || row;
    res.status(201).json({ employee: (await withMeta(orgId, [fresh]))[0] });
    emitWebhook(orgId, 'employee.created', employeeEvent(row));
    void peopleEvent(accountId, orgId, 'people.joined', row, req.auth!.userId);
  } catch (e) {
    return sendError(res, e);
  }
});

peopleRouter.put('/orgs/:orgId/people/employees/:id', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  /* A role limited to its own team edits only its team; anyone else reads as absent. */
  const editScope = await teamScope(req);
  if (!existing || !inScope(editScope, existing.id)) return res.status(404).json({ error: 'No such employee.' });
  /* A team lead's own record changes the way anyone's does, through the employee app and HR (Workforce audit E10). */
  if (!editScope.all && existing.userId && existing.userId === req.auth!.userId) return res.status(403).json({ error: 'Change your own details in the employee app; HR approves what needs approving.', code: 'OWN_RECORD' });
  const parsed = employeeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid employee.' });
  const b = parsed.data;
  /*
   * Someone else saved since this editor loaded the record: never overwrite
   * silently (People design spec v1 §8). The current record comes back so
   * the screen can show what changed and let them apply theirs again.
   */
  const ifMatch = String(req.headers['if-match'] || '').replace(/[^0-9]/g, '');
  const expected = b.version ?? (ifMatch ? Number(ifMatch) : undefined);
  delete (b as any).version;
  /* Someone who has left comes back through Rehire, which opens a new stint; an edit cannot quietly make them active (WF-14). */
  if (existing.status === 'LEFT' && b.status && b.status !== 'LEFT') {
    return res.status(409).json({ error: `${existing.name} has left. Use Rehire to bring them back: it starts a new period of employment and keeps the earlier one.`, code: 'USE_REHIRE' });
  }
  /* Leaving has its own step (last day, reason, the period closed, Payroll told); an edit cannot put someone on notice or mark them left (Workforce final audit W7). */
  if (b.status && b.status !== existing.status && (b.status === 'LEFT' || b.status === 'ON_NOTICE')) {
    return res.status(409).json({ error: `Use Mark as left on ${existing.name}'s record: it records the last day and the reason.`, code: 'USE_LEAVING' });
  }
  /* Someone on notice leaves on their day; suspending or reactivating them would break that (W2). */
  if (existing.status === 'ON_NOTICE' && b.status && b.status !== 'ON_NOTICE') {
    return res.status(409).json({ error: `${existing.name} is on notice. Change the leaving details, or withdraw the leaving, instead.`, code: 'ON_NOTICE' });
  }
  if (expected !== undefined && expected !== existing.version) {
    return res.status(409).json({ error: 'Someone else changed this record after you opened it. Reload to see their changes, then make yours again.', code: 'STALE', employee: (await withMeta(orgId, [existing]))[0] });
  }
  const joined = b.dateOfJoining !== undefined ? blank(b.dateOfJoining) : existing.dateOfJoining;
  const left = b.dateOfLeaving !== undefined ? blank(b.dateOfLeaving) : existing.dateOfLeaving;
  if (joined && left && left < joined) return res.status(400).json({ error: 'Somebody cannot leave before they joined.' });
  try {
    const structure = await resolveStructure(orgId, b);
    const taken = await seatFree(orgId, blank(b.seatId), existing.id);
    if (taken) return res.status(409).json({ error: taken });
    if (b.reportingManagerId !== undefined) await checkManager(orgId, existing.id, blank(b.reportingManagerId));
    if (b.dottedManagerId !== undefined) await checkManager(orgId, existing.id, blank(b.dottedManagerId));
    const nameChanged = b.name !== undefined || b.firstName !== undefined || b.lastName !== undefined;
    /*
     * A job change dated in the future waits (FND-02): the job fields go to
     * ScheduledChange and are applied on that day; everything else in the
     * same form (a phone, an address) is saved now.
     */
    const effectiveFrom = typeof req.body?.effectiveFrom === 'string' && ISO_DATE.test(req.body.effectiveFrom) ? req.body.effectiveFrom : null;
    /*
     * Where the company has an approval rule for job changes (APR-01), a
     * change to a job field becomes a request instead of a write; the rest of
     * the form still saves. The record says "waiting for approval".
     */
    /* A field with a dated change waiting would be overwritten on that day without anyone noticing: changing it now is refused until that one is withdrawn (Workforce final audit W11). */
    if (!(effectiveFrom && effectiveFrom > todayIst())) {
      const nowFields = [...SCHEDULABLE_FIELDS].filter((f) => f !== 'status' && (b as any)[f] !== undefined && ((existing as any)[f] ?? null) !== ((structure as any)[f] !== undefined ? (structure as any)[f] : blank((b as any)[f])));
      const waiting = nowFields.length ? await peoplePrisma.scheduledChange.findFirst({ where: { orgId, employeeId: existing.id, status: 'PENDING', field: { in: nowFields } }, orderBy: { effectiveOn: 'asc' } }) : null;
      if (waiting) return res.status(409).json({ error: `A change to ${(SCHEDULED_WORDS[waiting.field] || waiting.field).toLowerCase()} is already set for ${inWords(waiting.effectiveOn)}. Withdraw it under Upcoming changes first, or date this one.`, code: 'CHANGE_WAITING' });
    }
    const jobRule = await activeRule(orgId, 'JOB_CHANGE');
    let request: Awaited<ReturnType<typeof submitRequest>>['request'] | null = null;
    if (jobRule) {
      const fields: Record<string, { before: unknown; after: unknown }> = {};
      for (const field of SCHEDULABLE_FIELDS) {
        if ((b as any)[field] === undefined || field === 'status') continue;
        const after = (structure as any)[field] !== undefined ? (structure as any)[field] : blank((b as any)[field]);
        if (((existing as any)[field] ?? null) === after) continue;
        fields[field] = { before: (existing as any)[field] ?? null, after };
        delete (structure as any)[field];
        delete (b as any)[field];
      }
      if (fields.departmentId) delete (structure as any).department;
      if (fields.jobPositionId) delete (structure as any).designation;
      if (Object.keys(fields).length) {
        const labels = Object.keys(fields).map((f) => f.replace(/Id$/, '')).join(', ');
        /* TRACE-05: documents on this person's file the change rests on (an appraisal, an offer); their versions are frozen at the decision. */
        const askedIds = (Array.isArray(req.body?.evidenceDocumentIds) ? req.body.evidenceDocumentIds : []).map(String).slice(0, 20);
        const evidence = askedIds.length ? (await peoplePrisma.employeeDocument.findMany({ where: { orgId, employeeId: existing.id, id: { in: askedIds } }, select: { id: true, title: true } })).map((d) => ({ documentId: d.id, title: d.title })) : [];
        const r = await submitRequest(actorOf(req, 'FORM', typeof req.body?.changeNote === 'string' ? req.body.changeNote : null), {
          requestType: 'JOB_CHANGE', subjectEmployeeId: existing.id, title: `${existing.name}: ${labels} change`,
          payload: { employeeId: existing.id, fields, effectiveOn: effectiveFrom, reason: typeof req.body?.changeNote === 'string' ? req.body.changeNote : null, ...(evidence.length ? { evidence } : {}) },
          idempotencyKey: typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : null,
        });
        request = r.request;
      }
    }
    let scheduled: Awaited<ReturnType<typeof scheduleChanges>> = [];
    if (effectiveFrom && effectiveFrom > todayIst()) {
      const future: Record<string, string | null> = {};
      for (const field of SCHEDULABLE_FIELDS) {
        if ((b as any)[field] === undefined || field === 'status') continue;
        future[field] = (structure as any)[field] !== undefined ? (structure as any)[field] : blank((b as any)[field]);
        delete (structure as any)[field];
        delete (b as any)[field];
      }
      if (future.departmentId !== undefined) delete (structure as any).department;
      if (future.jobPositionId !== undefined) delete (structure as any).designation;
      scheduled = await scheduleChanges(actorOf(req, 'FORM', typeof req.body?.changeNote === 'string' ? req.body.changeNote : null), existing as any, future, effectiveFrom);
    }
    /* The form may say from when a change counts (effectiveFrom) and why (changeNote); both go on the change log and history. */
    const { row } = await updateEmployee(
      actorOf(req, 'FORM', typeof req.body?.changeNote === 'string' ? req.body.changeNote : null),
      existing,
      {
        ...(nameChanged ? { name: composeName({ ...existing, ...b } as any, existing.name) } : {}),
        ...(b.code !== undefined ? { code: blank(b.code) } : {}),
        ...employeeData(b),
        ...structure,
      } as any,
      /* An approval applied in this same save has already moved the version on; then the earlier check stands. */
      { effectiveDate: typeof req.body?.effectiveFrom === 'string' ? req.body.effectiveFrom : null, expectedVersion: request ? undefined : expected },
    );
    if (b.tagIds) await setTags(accountId, orgId, row.id, b.tagIds, actorOf(req, 'FORM'));
    /* A corrected joining date moves the dates service counts from, while the first stint is still open (W6). */
    if (row.dateOfJoining !== existing.dateOfJoining) await joiningCorrected({ accountId, orgId, userId: req.auth!.userId }, row, row.dateOfJoining ? String(row.dateOfJoining).slice(0, 10) : null);
    /* Leaving or coming back starts that checklist; CLOR takes them off the readers itself, so it ticks that item. */
    if (row.status === 'LEFT' && existing.status !== 'LEFT') await startChecklist({ accountId, orgId, userId: req.auth!.userId }, row, 'LEAVING', row.dateOfLeaving, { done: [READER_ACCESS_ITEM] });
    else if (row.status !== 'LEFT' && existing.status === 'LEFT') await startChecklist({ accountId, orgId, userId: req.auth!.userId }, row, 'JOINING', row.dateOfJoining);
    /* Leaving ends door access: off every biometric reader, fingerprints and faces deleted. */
    if (row.status === 'LEFT' && existing.status !== 'LEFT') await revokeFromReaders(orgId, existing, req.auth!.userId);
    /* Suspended means not at work: off the doors while suspended, back on when reactivated (W9). */
    else if (row.status === 'SUSPENDED' && existing.status !== 'SUSPENDED') await revokeFromReaders(orgId, existing, req.auth!.userId);
    else if (row.status === 'ACTIVE' && existing.status === 'SUSPENDED') await pushEmployeeToReaders(orgId, row, req.auth!.userId);
    else if (row.status !== 'LEFT' && readerFieldsChanged(existing, row)) await pushEmployeeToReaders(orgId, row, req.auth!.userId, existing);
    /* Professional Tax follows the move only when the person asked for it on the transfer (the preview's ACTION line). */
    const ptState = req.body?.alsoPtState === true ? await followPtState(req, existing, row, typeof req.body?.establishmentId === 'string' ? req.body.establishmentId : null, Boolean(request) || scheduled.length > 0, effectiveFrom) : null;
    /* With its tags, as GET returns it: a save must not blank the tag line. */
    const fresh = (await peoplePrisma.employee.findUnique({ where: { id: row.id }, include: { tags: { include: { tag: true } } } })) || row;
    res.json({ employee: (await withMeta(orgId, [fresh]))[0], scheduled, request: request ? await shapeRequest(request) : null, ptState });
    emitWebhook(orgId, row.status === 'LEFT' && existing.status !== 'LEFT' ? 'employee.left' : 'employee.updated', employeeEvent(row));
    if (row.status === 'LEFT' && existing.status !== 'LEFT') void peopleEvent(accountId, orgId, 'people.left', row, req.auth!.userId);
  } catch (e) {
    if (e instanceof StaleEmployeeError) return res.status(409).json({ error: 'Someone else changed this record after you opened it. Reload to see their changes, then make yours again.', code: 'STALE', employee: (await withMeta(orgId, [e.current]))[0] });
    return sendError(res, e);
  }
});

/**
 * Data health: what is wrong in the employee data before it costs a payroll
 * (services/people/dataHealth.ts). Payroll checks only for someone who may
 * see payroll profiles.
 */
peopleRouter.get('/orgs/:orgId/people/data-health', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const payroll = !(await authorize(req, PAYROLL_MODULE, PermissionAction.VIEW as any, PAYROLL_RESOURCE.profile));
  const scope = await teamScope(req);
  res.json(await dataHealth(accountId, orgId, { payroll, readable: await readableClassifications(req), ...(scope.all ? {} : { onlyIds: scope.ids }) }));
});

/** One person's readiness (the same checks, filtered to them): shown on their record. */
peopleRouter.get('/orgs/:orgId/people/employees/:id/readiness', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!employee || !inScope(await teamScope(req), employee.id)) return res.status(404).json({ error: 'No such employee.' });
  const apps = await impactApps(req);
  res.json({ apps: { payroll: apps.payroll, attendance: apps.attendance, seePayroll: apps.seePayroll }, ...(await readinessOf(accountId, orgId, employee.id, { payroll: apps.seePayroll, readable: await readableClassifications(req) })) });
});

/** Snooze a Health check item with a reason and a date (HLTH-03); it returns on its date. */
peopleRouter.post('/orgs/:orgId/people/data-health/:checkId/snooze', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  try {
    res.status(201).json({ snooze: await snoozeCheck(actorOf(req, 'FORM'), String(req.params.checkId), req.body || {}) });
  } catch (e) {
    if (e instanceof HeadcountError) return res.status(e.status).json({ error: e.message });
    return sendError(res, e);
  }
});

peopleRouter.delete('/orgs/:orgId/people/data-health/:checkId/snooze', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  res.json(await unsnoozeCheck(actorOf(req, 'FORM'), String(req.params.checkId)));
});

peopleRouter.get('/orgs/:orgId/people/data-health/snoozes', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ snoozes: await snoozeHistory(req.tenant!.orgId, String(req.query.checkId || '') || undefined) });
});

/** Headcount and movements (HLTH-04): joiners, leavers, transfers by month and establishment; headcount as of any day. */
peopleRouter.get('/orgs/:orgId/people/headcount', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  try {
    res.json(await headcountOf(req.tenant!.orgId, { asOf: String(req.query.asOf || ''), from: String(req.query.from || ''), to: String(req.query.to || '') }));
  } catch (e) {
    if (e instanceof HeadcountError) return res.status(e.status).json({ error: e.message });
    return sendError(res, e);
  }
});

// ---------------------------------------------------------------------------
// Joining and leaving checklists (services/people/checklists.ts)
// ---------------------------------------------------------------------------

const kindParam = (v: unknown): ChecklistKind | null => (KINDS.includes(String(v).toUpperCase() as ChecklistKind) ? (String(v).toUpperCase() as ChecklistKind) : null);

peopleRouter.get('/orgs/:orgId/people/employees/:id/checklist', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  void accountId;
  const employee = await scopedEmployee(req, String(req.params.id), { id: true });
  if (!employee) return res.status(404).json({ error: 'No such employee.' });
  res.json(await checklistOf(orgId, employee.id));
});

/** Start a checklist by hand (someone added before checklists existed). */
peopleRouter.post('/orgs/:orgId/people/employees/:id/checklist/:kind', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const kind = kindParam(req.params.kind);
  if (!kind) return res.status(404).json({ error: 'Checklists are JOINING or LEAVING.' });
  const employee = await scopedEmployee(req, String(req.params.id));
  if (!employee) return res.status(404).json({ error: 'No such employee.' });
  const started = await startChecklist({ accountId, orgId, userId: req.auth!.userId }, employee, kind, kind === 'JOINING' ? employee.dateOfJoining : employee.dateOfLeaving);
  if (!started) return res.status(409).json({ error: 'That checklist is already under way.' });
  res.status(201).json(await checklistOf(orgId, employee.id));
});

/** The tasks on my name (LIFE-07): anyone with a task sees and ticks their own, whatever else they may do. */
peopleRouter.get('/orgs/:orgId/people/tasks/mine', async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ tasks: await myTasks(req.tenant!.orgId, req.auth!.userId) });
});

/** Tick, untick, note or reassign a task. The named owner may tick their own without the Employees grant. */
peopleRouter.patch('/orgs/:orgId/people/checklist-tasks/:id', async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z.object({ done: z.boolean().optional(), note: z.string().trim().max(500).optional().nullable(), ownerUserId: z.string().trim().max(60).optional().nullable() }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Check the details.' });
  const task = await peoplePrisma.checklistTask.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!task) return res.status(404).json({ error: 'No such task.' });
  const own = task.ownerUserId === req.auth!.userId;
  /* HR may act on anyone's task inside their scope; a team lead's grant reaches their own team only. */
  const hr = !(await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, EMPLOYEES)) && inScope(await teamScope(req), task.employeeId);
  if (!own && !hr) return res.status(403).json({ error: 'This task is on somebody else\'s name.' });
  const { done, note, ownerUserId } = parsed.data;
  if (ownerUserId !== undefined && !hr) return res.status(403).json({ error: 'Only HR gives a task to someone else.' });
  if (ownerUserId && !(await platformPrisma.userOrgMembership.findFirst({ where: { orgId, userId: ownerUserId }, select: { id: true } }))) return res.status(400).json({ error: 'That person is not in this company.' });
  const actor = actorOf(req, 'FORM');
  await peoplePrisma.$transaction(async (tx) => {
    const data = {
      ...(done === true ? { doneAt: task.doneAt || new Date(), doneByUserId: task.doneAt ? task.doneByUserId : req.auth!.userId } : done === false ? { doneAt: null, doneByUserId: null } : {}),
      ...(note !== undefined ? { note: note || null } : {}),
      ...(ownerUserId !== undefined ? { ownerUserId: ownerUserId || null } : {}),
    };
    await tx.checklistTask.update({ where: { id: task.id }, data });
    const changes = [];
    if (done !== undefined && Boolean(task.doneAt) !== done) changes.push({ field: 'done', before: task.doneAt ? 'yes' : 'no', after: done ? 'yes' : 'no', redacted: false });
    if (ownerUserId !== undefined && ownerUserId !== task.ownerUserId) changes.push({ field: 'ownerUserId', before: task.ownerUserId, after: ownerUserId || null, redacted: false });
    await writeChangeLog(tx, actor, { kind: 'ChecklistTask', id: task.id, employeeId: task.employeeId }, changes);
  });
  res.json(await checklistOf(orgId, task.employeeId));
});

/** Open checklist items across the company, overdue first. */
peopleRouter.get('/orgs/:orgId/people/checklist-tasks', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const scope = await teamScope(req);
  res.json({ tasks: (await openTasks(req.tenant!.orgId)).filter((t) => inScope(scope, t.employee!.id)) });
});

peopleRouter.get('/orgs/:orgId/people/checklist-templates', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const [joining, leaving] = await Promise.all([itemsFor(orgId, 'JOINING'), itemsFor(orgId, 'LEAVING')]);
  res.json({ joining, leaving });
});

/** A company's own checklist; DELETE goes back to CLOR's defaults. */
peopleRouter.put('/orgs/:orgId/people/checklist-templates/:kind', can(PermissionAction.EDIT, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const kind = kindParam(req.params.kind);
  if (!kind) return res.status(404).json({ error: 'Checklists are JOINING or LEAVING.' });
  const items = cleanItems(req.body?.items);
  if (typeof items === 'string') return res.status(400).json({ error: items });
  await peoplePrisma.checklistTemplate.upsert({
    where: { orgId_kind: { orgId, kind } },
    create: { accountId, orgId, kind, items: items as any, updatedByUserId: req.auth!.userId },
    update: { items: items as any, updatedByUserId: req.auth!.userId },
  });
  res.json(await itemsFor(orgId, kind));
});

peopleRouter.delete('/orgs/:orgId/people/checklist-templates/:kind', can(PermissionAction.EDIT, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const kind = kindParam(req.params.kind);
  if (!kind) return res.status(404).json({ error: 'Checklists are JOINING or LEAVING.' });
  await peoplePrisma.checklistTemplate.deleteMany({ where: { orgId, kind } });
  res.json(await itemsFor(orgId, kind));
});

// ---------------------------------------------------------------------------
// Compliance calendar (services/people/compliance.ts)
// ---------------------------------------------------------------------------

peopleRouter.get('/orgs/:orgId/people/compliance', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  res.json(await calendar({ accountId, orgId, userId: req.auth!.userId }));
});

peopleRouter.post('/orgs/:orgId/people/compliance', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const task = await addCustom({ accountId, orgId, userId: req.auth!.userId }, req.body);
    res.status(201).json({ id: task.id });
  } catch (e) {
    return sendError(res, e);
  }
});

peopleRouter.patch('/orgs/:orgId/people/compliance/:id', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    await updateTask({ accountId, orgId, userId: req.auth!.userId }, String(req.params.id), req.body || {});
    res.json(await calendar({ accountId, orgId, userId: req.auth!.userId }));
  } catch (e) {
    return sendError(res, e);
  }
});

peopleRouter.get('/orgs/:orgId/people/compliance/:id/evidence', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const file = await evidenceOf(req.tenant!.orgId, String(req.params.id));
  if (!file) return res.status(404).json({ error: 'No evidence kept for this deadline.' });
  res.json({ evidence: file });
});

/** Employment history: joined, moved, changed, left, rehired — newest first, with what each meant for payroll. */
peopleRouter.get('/orgs/:orgId/people/employees/:id/history', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!employee || !inScope(await teamScope(req), employee.id)) return res.status(404).json({ error: 'No such employee.' });
  res.json({ events: await timelineOf(orgId, employee), episodes: await episodesOf(orgId, employee) });
});

/** Company-wide People settings (CORE-03, D-02): what employees may change about themselves without waiting. */
peopleRouter.get('/orgs/:orgId/people/settings', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const { accountId: _a, ...rest } = await settingsOf(accountId, orgId);
  res.json({ settings: rest });
});

peopleRouter.put('/orgs/:orgId/people/settings', can(PermissionAction.EDIT, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const { accountId: _a, ...rest } = await saveSettings({ accountId, orgId, userId: req.auth!.userId }, req.body || {});
    res.json({ settings: rest });
  } catch (e) {
    if (e instanceof SelfServiceError) return res.status(e.status).json({ error: e.message });
    return sendError(res, e);
  }
});

/** Custom fields (CORE-08): the definitions (Org Structure, since they shape every record) and a person's values by grant. */
peopleRouter.get('/orgs/:orgId/people/custom-fields', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ fields: await defsOf(req.tenant!.orgId, req.query.all === '1'), types: FIELD_TYPES });
});

peopleRouter.post('/orgs/:orgId/people/custom-fields', can(PermissionAction.EDIT, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    res.status(201).json({ field: await saveCustomFieldDef({ accountId, orgId, userId: req.auth!.userId }, req.body || {}) });
  } catch (e) {
    if (e instanceof CustomFieldError) return res.status(e.status).json({ error: e.message });
    return sendError(res, e);
  }
});

peopleRouter.put('/orgs/:orgId/people/custom-fields/:id', can(PermissionAction.EDIT, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    res.json({ field: await saveCustomFieldDef({ accountId, orgId, userId: req.auth!.userId }, { ...(req.body || {}), id: String(req.params.id) }) });
  } catch (e) {
    if (e instanceof CustomFieldError) return res.status(e.status).json({ error: e.message });
    return sendError(res, e);
  }
});

peopleRouter.get('/orgs/:orgId/people/employees/:id/custom-fields', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!employee || !inScope(await teamScope(req), employee.id)) return res.status(404).json({ error: 'No such employee.' });
  res.json({ fields: await customValuesFor(req, orgId, employee.id) });
});

peopleRouter.put('/orgs/:orgId/people/employees/:id/custom-fields', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!employee || !inScope(await teamScope(req), employee.id)) return res.status(404).json({ error: 'No such employee.' });
  try {
    const r = await setCustomValues(req, actorOf(req, 'FORM'), employee.id, req.body?.values && typeof req.body.values === 'object' ? req.body.values : {});
    res.json({ ...r, fields: await customValuesFor(req, orgId, employee.id) });
  } catch (e) {
    if (e instanceof CustomFieldError) return res.status(e.status).json({ error: e.message });
    return sendError(res, e);
  }
});

/* --------------------------------------------- saved views and bulk update (CORE-01) */

peopleRouter.get('/orgs/:orgId/people/saved-views', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ views: await viewsFor(req.tenant!.orgId, req.auth!.userId, String(req.query.screen || '')) });
  } catch (e: any) {
    res.status(e?.status || 400).json({ error: String(e?.message || 'Could not load.') });
  }
});

peopleRouter.post('/orgs/:orgId/people/saved-views', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ view: await saveView({ accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth!.userId }, req.body || {}) });
  } catch (e: any) {
    res.status(e?.status || 400).json({ error: String(e?.message || 'Not saved.') });
  }
});

peopleRouter.delete('/orgs/:orgId/people/saved-views/:id', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    await deleteView(req.tenant!.orgId, req.auth!.userId, String(req.params.id));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(e?.status || 400).json({ error: String(e?.message || 'Not deleted.') });
  }
});

/** Change many people at once (CORE-01): one write path per person, one correlation id for the batch. */
peopleRouter.post('/orgs/:orgId/people/employees/bulk', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    const actor = { ...actorOf(req, 'BULK', null), correlationId: `bulk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` };
    res.json(await bulkUpdate(actor, req.body || {}, await teamScope(req)));
  } catch (e: any) {
    if (e instanceof BulkError) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
});

/**
 * Activity & Audit Trail for one employee (People design v1 EMP-09, Workforce WF-18/19):
 * changes, approvals, documents and comments, newest first, redacted for this viewer.
 * `before` pages back. Read-only: nothing here edits or deletes an event.
 */
/**
 * The CLOR sign-in an employee uses, if any (WF-06 Link Portal User). Only a
 * login that is a member of this company can be linked, and one login is one
 * employee here. The link is an ordinary logged edit (userId is on the change
 * log), so History and Activity show who linked whom and when.
 */
peopleRouter.put('/orgs/:orgId/people/employees/:id/user', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing || !inScope(await teamScope(req), existing.id)) return res.status(404).json({ error: 'No such employee.' });
  const userId = req.body?.userId ? String(req.body.userId) : null;
  if (userId) {
    /* Linking your own login to a record makes its manager approvals and self-service yours: only an administrator may do that to themselves. */
    if (userId === req.auth!.userId && !req.isAdmin) return res.status(403).json({ error: 'Ask an administrator to link your own sign-in.' });
    const member = await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId, userId }, select: { id: true } });
    if (!member) return res.status(400).json({ error: 'That login is not a member of this company.' });
    const other = await peoplePrisma.employee.findFirst({ where: { orgId, userId, id: { not: existing.id } }, select: { name: true } });
    if (other) return res.status(409).json({ error: `That login is already linked to ${other.name}.` });
  }
  if ((existing.userId || null) === userId) return res.json({ employee: (await withMeta(orgId, [existing]))[0] });
  const { row } = await updateEmployee(actorOf(req, 'FORM', userId ? 'Linked a sign-in' : 'Removed the sign-in link'), existing, { userId });
  const user = userId ? await platformPrisma.user.findFirst({ where: { id: userId }, select: { fullName: true, email: true } }) : null;
  res.json({ employee: { ...(await withMeta(orgId, [row]))[0], linkedUser: user ? { name: user.fullName || user.email, email: user.email } : null } });
});

peopleRouter.get('/orgs/:orgId/people/employees/:id/activity', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!employee || !inScope(await teamScope(req), employee.id)) return res.status(404).json({ error: 'No such employee.' });
  const allows = async (permission: string) => {
    const [m, sub, action] = permission.split('::');
    return !(await authorize(req, m, action as PermissionActionType, sub));
  };
  const out = await activityOf({
    orgId,
    canStatutory: !(await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, STATUTORY)),
    canNotes: !(await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, NOTES)),
    canPersonal: await seesPersonal(req),
    docClasses: await readableClassifications(req),
    allows,
  }, employee.id, { before: req.query.before ? new Date(String(req.query.before)) : null, limit: Number(req.query.limit || 50) });
  res.set('Cache-Control', 'private, no-store').json(out);
});

/** The journey (CORE-06): every change in order, under its stint, each with a key for its Why. */
peopleRouter.get('/orgs/:orgId/people/employees/:id/journey', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!employee || !inScope(await teamScope(req), employee.id)) return res.status(404).json({ error: 'No such employee.' });
  res.json(await journeyOf(orgId, employee as any, { hidePersonal: !(await seesPersonal(req)) && employee.userId !== req.auth!.userId }));
});

/** Why (TRACE-01, 02): what changed, when, who asked, who approved, the rule version, the evidence, what it set off — or plain words for what is not known. */
peopleRouter.get('/orgs/:orgId/people/employees/:id/why/:key', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true, userId: true } });
  if (!employee || !inScope(await teamScope(req), employee.id)) return res.status(404).json({ error: 'No such employee.' });
  const why = await whyOf(orgId, employee.id, String(req.params.key), { hidePersonal: !(await seesPersonal(req)) && employee.userId !== req.auth!.userId });
  if (!why) return res.status(404).json({ error: 'No such change.' });
  res.json({ why });
});

/**
 * TRACE-03: raise a correction or a question about a change, straight from
 * its Why panel. The help desk request is pre-filled from the change and
 * carries its key, so whoever answers opens the same panel.
 */
peopleRouter.post('/orgs/:orgId/people/employees/:id/why/:key/raise', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true, name: true, userId: true } });
  if (!employee || !inScope(await teamScope(req), employee.id)) return res.status(404).json({ error: 'No such employee.' });
  const key = String(req.params.key);
  const why = await whyOf(orgId, employee.id, key, { hidePersonal: !(await seesPersonal(req)) && employee.userId !== req.auth!.userId });
  if (!why) return res.status(404).json({ error: 'No such change.' });
  const kind = String(req.body?.kind || 'CORRECTION').toUpperCase() === 'QUESTION' ? 'QUESTION' : 'CORRECTION';
  const what = (why.what as Array<{ field: string; before: string | null; after: string | null }>).map((w) => `${w.field}: ${w.before ?? 'blank'} to ${w.after ?? 'blank'}`).join('; ') || 'the change';
  const when = why.when instanceof Date ? why.when.toISOString().slice(0, 10) : String(why.when || '').slice(0, 10);
  const note = String(req.body?.note || '').trim().slice(0, 3000);
  try {
    const request = await raiseRequest({ accountId, orgId, userId: req.auth!.userId }, employee.id, {
      category: String(req.body?.category || (kind === 'CORRECTION' ? 'DOCUMENTS' : 'OTHER')),
      subject: `${kind === 'CORRECTION' ? 'Correction' : 'Question'}: ${what}`.slice(0, 200),
      description: `${note ? `${note}\n\n` : ''}About the change on ${when}: ${what}.${why.request ? ` Request: ${why.request.title}.` : ''}`,
      changeRef: key,
    });
    res.status(201).json({ request });
  } catch (e: any) {
    res.status(e?.status || 400).json({ error: String(e?.message || 'Not raised.') });
  }
});

/** TRACE-04: a salary question, answered from Payroll's and Attendance's read interfaces; People never computes pay. */
peopleRouter.get('/orgs/:orgId/people/employees/:id/salary-question', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!employee || !inScope(await teamScope(req), employee.id)) return res.status(404).json({ error: 'No such employee.' });
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
  res.json(await salaryQuestion(orgId, employee.id, month));
});

/** What else a change would affect (LIFE-04), before it is sent: pass the fields as they would be saved. */
/**
 * After a transfer to a work site in another state, set the payroll
 * profile's Professional Tax state to match, when the move has taken effect
 * and the caller may change payroll profiles. A move that waits (dated
 * ahead, or for an approver) or a caller without that grant gets a task on
 * the person's record for the day instead: nothing in Payroll changes early
 * or behind someone's back.
 */
async function followPtState(req: any, before: { id: string; establishmentId: string | null }, after: { id: string; establishmentId: string | null }, asked: string | null, waits: boolean, effectiveFrom: string | null) {
  const { accountId, orgId } = req.tenant!;
  if (!asked || asked === before.establishmentId) return null;
  const est = await peoplePrisma.establishment.findFirst({ where: { id: asked, orgId }, select: { state: true } });
  if (!est?.state || !(await isFeatureEnabled(accountId, orgId, 'payroll'))) return null;
  const profile = await payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId, employeeId: before.id }, select: { ptApplicable: true, professionalTaxState: true } });
  if (!profile?.ptApplicable || profile.professionalTaxState === est.state) return null;
  const mayEdit = !(await authorize(req, PAYROLL_MODULE, PermissionAction.EDIT as any, PAYROLL_RESOURCE.profile));
  if (!waits && after.establishmentId === asked && mayEdit) {
    await payrollPrisma.employeePayrollProfile.updateMany({ where: { orgId, employeeId: before.id }, data: { professionalTaxState: est.state } });
    await recordAudit(req, { entity: 'PAYROLL_PROFILE', entityId: before.id, action: 'UPDATE', message: `Professional Tax state set to ${est.state} with a transfer`, metadata: { from: profile.professionalTaxState, to: est.state } });
    return { applied: true, state: est.state };
  }
  const due = effectiveFrom && effectiveFrom > todayIst() ? effectiveFrom : todayIst();
  await startChecklist({ accountId, orgId, userId: req.auth!.userId }, { id: before.id }, 'CHANGE', due, { items: [{ title: `Set Professional Tax state to ${est.state} in Payroll`, owner: 'PAYROLL', dueDays: 0, note: 'The work site moved to another state; Payroll deducts PT for the state on the payroll profile.' }] });
  return { applied: false, task: true, state: est.state, due };
}

/* Which apps this company uses, and whether the caller may see and change payroll profiles: the preview says only what is true for them. */
async function impactApps(req: any) {
  const { accountId, orgId } = req.tenant!;
  const [payroll, attendance] = await Promise.all([isFeatureEnabled(accountId, orgId, 'payroll'), isFeatureEnabled(accountId, orgId, 'attendance')]);
  const seePayroll = payroll && !(await authorize(req, PAYROLL_MODULE, PermissionAction.VIEW as any, PAYROLL_RESOURCE.profile));
  return { payroll, attendance, seePayroll };
}

peopleRouter.get('/orgs/:orgId/people/employees/:id/change-impact', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true, establishmentId: true, departmentId: true, reportingManagerId: true, areaId: true } });
  if (!employee || !inScope(await teamScope(req), employee.id)) return res.status(404).json({ error: 'No such employee.' });
  const fields: Record<string, string | null> = {};
  for (const k of ['establishmentId', 'departmentId', 'reportingManagerId', 'areaId']) if (req.query[k] !== undefined) fields[k] = String(req.query[k] || '') || null;
  const scope = await teamScope(req);
  res.json({ impact: await changeImpact(orgId, employee, fields, await impactApps(req), { managerVisible: !fields.reportingManagerId || inScope(scope, fields.reportingManagerId) }) });
});

/**
 * Probation (LIFE-03): the review, and the decision — confirm, extend or end.
 * With a PROBATION approval rule the decision becomes a request.
 */
peopleRouter.get('/orgs/:orgId/people/employees/:id/probation', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  if (!inScope(await teamScope(req), String(req.params.id))) return res.status(404).json({ error: 'No such employee.' });
  res.json({ reviews: await reviewsOf(orgId, String(req.params.id)) });
});

peopleRouter.post('/orgs/:orgId/people/employees/:id/probation/review', can(PermissionAction.EDIT, LIFECYCLE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const subject = await scopedEmployee(req, String(req.params.id), { id: true, userId: true });
  if (!subject) return res.status(404).json({ error: 'No such employee.' });
  if (subject.userId && subject.userId === req.auth!.userId) return res.status(403).json({ error: 'Someone else reviews and decides your own probation.' });
  const parsed = z.object({ goals: text(2000), observations: text(4000), recommendation: z.enum(PROBATION_OUTCOMES).optional().nullable().or(z.literal('')), newEndDate: date, note: text(1000) }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the review.' });
  try {
    const b = parsed.data;
    const review = await saveReview(actorOf(req, 'FORM'), String(req.params.id), { goals: blank(b.goals), observations: blank(b.observations), recommendation: (blank(b.recommendation) as any) || null, newEndDate: blank(b.newEndDate), note: blank(b.note) });
    res.status(201).json({ review });
  } catch (e) {
    if (e instanceof ProbationError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

peopleRouter.post('/orgs/:orgId/people/employees/:id/probation/decide', can(PermissionAction.APPROVE, LIFECYCLE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const subject = await scopedEmployee(req, String(req.params.id), { id: true, userId: true });
  if (!subject) return res.status(404).json({ error: 'No such employee.' });
  if (subject.userId && subject.userId === req.auth!.userId) return res.status(403).json({ error: 'Someone else reviews and decides your own probation.' });
  const parsed = z.object({ outcome: z.enum(PROBATION_OUTCOMES), newEndDate: date, note: text(1000), lastDay: date }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Confirm, extend or end.' });
  try {
    const b = parsed.data;
    const r = await decideProbation(actorOf(req, 'FORM', blank(b.note)), String(req.params.id), b.outcome, { newEndDate: blank(b.newEndDate), note: blank(b.note), lastDay: blank(b.lastDay) });
    res.json({ ...r, request: (r as any).request ? await shapeRequest((r as any).request) : null });
  } catch (e) {
    if (e instanceof ProbationError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

/** Withdraw a change dated for a future day (FND-02). */
peopleRouter.delete('/orgs/:orgId/people/employees/:id/scheduled/:changeId', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  if (!inScope(await teamScope(req), String(req.params.id))) return res.status(404).json({ error: 'No pending change by that id.' });
  const ok = await cancelScheduledChange(orgId, String(req.params.changeId), String(req.params.id));
  if (!ok) return res.status(404).json({ error: 'No pending change by that id.' });
  res.json({ ok: true });
});

/**
 * Removing someone. A person payroll has paid is part of the books' history:
 * they are marked as having left, never deleted. Only a file with no payroll
 * record goes, and their reports are moved up to their own manager.
 */
peopleRouter.delete('/orgs/:orgId/people/employees/:id', can(PermissionAction.DELETE, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing || !inScope(await teamScope(req), existing.id)) return res.status(404).json({ error: 'No such employee.' });
  /*
   * In payroll at all — a profile, or any payroll history (A-39: only
   * payslips were checked, so someone with a loan or an adjustment was
   * binned and their records pointed at nobody) — is a reason to mark them
   * as left. Checked and binned under the lock payroll writers take
   * (services/payroll/employeeLock.ts), so nothing is added in between.
   */
  const inPayroll = await payrollPrisma.$transaction(async (tx: any) => {
    await lockPayrollEmployee(tx, existing.id);
    if (await tx.employeePayrollProfile.count({ where: { orgId, employeeId: existing.id } })) return true;
    for (const [model] of PAYROLL_HISTORY) if (await tx[model].count({ where: { orgId, employeeId: existing.id } })) return true;
    await revokeFromReaders(orgId, existing, req.auth!.userId);
    /* Their reports move up to their manager; the bin remembers who they were, to put them back on restore. */
    const reports = await peoplePrisma.employee.findMany({ where: { orgId, reportingManagerId: existing.id }, select: { id: true } });
    await deleteToBin(req, 'employee', existing, {
      links: { reportingManagerId: reports.map((r) => r.id) },
      alongside: [
        peoplePrisma.employee.updateMany({
          where: { orgId, reportingManagerId: existing.id },
          data: { reportingManagerId: existing.reportingManagerId },
        }),
      ],
    });
    return false;
  }, { timeout: 30_000 });
  if (inPayroll) {
    return res.status(409).json({
      error: 'This person is in payroll. Mark them as having left instead of deleting their file.',
      code: 'EMPLOYEE_IN_PAYROLL',
    });
  }
  /* Their dated changes and open requests close with them; anyone with them as a secondary manager loses that line (W1, W4). */
  await closeOutFor(actorOf(req, 'FORM', `${existing.name} removed`), existing.id);
  await peoplePrisma.employee.updateMany({ where: { orgId, dottedManagerId: existing.id }, data: { dottedManagerId: null } });
  res.json({ ok: true });
});

/**
 * Import. One row per person, the same fields as the form (names of the
 * department, position and type rather than ids, so a spreadsheet can be
 * filled in by hand). Each row stands or falls alone and the answer says which.
 */
/* How dates and gender arrive in Indian spreadsheets: 05/10/2026, 5-10-2026, 05.10.2026, 5 Oct 2026, 2026/10/05; Male, M, f. */
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const two = (n: number | string) => String(n).padStart(2, '0');
export function importDateToIso(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!t || ISO_DATE.test(t)) return t;
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${two(m[2])}-${two(m[1])}`;
  m = t.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (m) return `${m[1]}-${two(m[2])}-${two(m[3])}`;
  m = t.match(/^(\d{1,2})[\s/.-]([A-Za-z]{3,9})[\s/.,-]+(\d{4})$/);
  if (m && MONTH_NAMES.includes(m[2].slice(0, 3).toLowerCase())) return `${m[3]}-${two(MONTH_NAMES.indexOf(m[2].slice(0, 3).toLowerCase()) + 1)}-${two(m[1])}`;
  return t;
}
const GENDER_WORDS: Record<string, string> = { m: 'MALE', male: 'MALE', f: 'FEMALE', female: 'FEMALE', o: 'OTHER', other: 'OTHER', nonbinary: 'NON_BINARY', prefernottosay: 'PREFER_NOT_TO_SAY' };
const importDate = z.preprocess(importDateToIso, date);
const importGender = z.preprocess((v) => (typeof v === 'string' && v.trim() ? GENDER_WORDS[v.trim().toLowerCase().replace(/[^a-z]/g, '')] || v.trim().toUpperCase() : v), z.enum(GENDER_OPTIONS, { message: 'Gender should be Male, Female, Other, Non-binary or Prefer not to say.' }).optional().nullable().or(z.literal('')));

const importRow = z.object({
  name: z.string().trim().min(1).max(120),
  code: text(40),
  email: z.string().trim().email().max(160).optional().nullable().or(z.literal('')),
  /* A "rows to fix" file from before carried a leading ' on phone numbers; it is dropped. */
  phone: z.preprocess((v) => (typeof v === 'string' ? v.replace(/^'/, '') : v), phoneField),
  department: text(120),
  jobPosition: text(120),
  employeeType: text(120),
  workType: text(120),
  businessUnit: text(120),
  grade: text(120),
  costCentre: text(120),
  dateOfJoining: importDate,
  dateOfBirth: importDate,
  probationEndDate: importDate,
  contractEndDate: importDate,
  /* The manager by their employee ID, and the work site by its name (Workforce audit O17). */
  managerCode: text(40),
  workSite: text(120),
  /* Written the way people write it: "Part-time", "part time", "PT". Blank is full-time. */
  hours: z.preprocess(
    (v) => {
      const t = String(v ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
      if (!t) return null;
      if (t === 'parttime' || t === 'pt' || t === 'part') return 'PART_TIME';
      if (t === 'fulltime' || t === 'ft' || t === 'full') return 'FULL_TIME';
      return v;
    },
    z.enum(HOURS, { message: 'Hours should be Full-time or Part-time.' }).nullable(),
  ),
  gender: importGender,
  workEmail: z.string().trim().email().max(160).optional().nullable().or(z.literal('')),
});

peopleRouter.post('/orgs/:orgId/people/employees/import', can(PermissionAction.CREATE, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nothing to import.' });
  if (rows.length > 1000) return res.status(400).json({ error: 'Import up to 1,000 people at a time.' });
  const userId = req.auth!.userId;
  /* dryRun: every row checked, nothing created (departments included), so the screen can preview first. */
  const dryRun = req.body?.dryRun === true;
  /* update: a row whose code is already here changes that person (only the columns given); otherwise it is an error, as before. */
  const mode = String(req.body?.mode || 'create').toLowerCase() === 'update' ? 'UPDATE' : 'CREATE';
  /* Changing people already here is an edit, and needs the edit grant. */
  if (mode === 'UPDATE') {
    const refused = await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, EMPLOYEES);
    if (refused) return res.status(refused.status).json(refused.body);
  }
  /* A department or designation change waits for its approver on the record; an import does not go round that. */
  const jobRule = mode === 'UPDATE' ? await activeRule(orgId, 'JOB_CHANGE') : null;
  /* Only someone who may add to the company's lists gets new departments, types and grades made for them. */
  const canMakeLists = !(await authorize(req, PEOPLE_MODULE, PermissionAction.CREATE, STRUCTURE));
  const codesInFile = new Set<string>();
  const createdIds: string[] = [];
  const updatedRows: Array<{ id: string; before: Record<string, unknown> }> = [];

  /* Names to ids, creating what does not exist yet — the way a spreadsheet
     of staff usually arrives before anyone has set up departments. */
  /* Matched case-insensitively, and the stored name is the one used after: a
     row typing "warehouse" joins Warehouse rather than starting a second. */
  const cache = new Map<string, { id: string; name: string }>();
  const ensure = async (kind: 'department' | 'jobPosition' | 'employeeType' | 'workType' | 'businessUnit' | 'grade' | 'costCenter', name: string | null | undefined) => {
    const n = blank(name);
    if (!n) return null;
    const key = `${kind}:${n.toLowerCase()}`;
    if (cache.has(key)) return cache.get(key)!;
    const model: any = (peoplePrisma as any)[kind];
    const found = await model.findFirst({ where: { orgId, name: { equals: n, mode: 'insensitive' } }, select: { id: true, name: true } });
    if (!found && !canMakeLists) throw new ImportRowError(`"${n}" is not in the company's lists yet; ask whoever looks after the lists to add it.`);
    const row = found || (dryRun ? { id: '', name: n } : await model.create({ data: { accountId, orgId, name: n, createdByUserId: userId, ...(kind === 'employeeType' ? { category: guessKind(n) } : {}) }, select: { id: true, name: true } }));
    cache.set(key, row);
    return row as { id: string; name: string };
  };

  /* A manager named by employee ID, someone already here or a row earlier in this file; a work site by its name (never made up: its state decides the rules). */
  const managerByCode = new Map<string, string>();
  const managerOf = async (code: string | null) => {
    if (!code) return null;
    const key = code.toLowerCase();
    if (managerByCode.has(key)) return managerByCode.get(key)!;
    const found = await peoplePrisma.employee.findFirst({ where: { orgId, code: { equals: code, mode: 'insensitive' }, status: { not: 'LEFT' } }, select: { id: true } });
    if (!found) throw new ImportRowError(`Nobody has the employee ID ${code} to be the manager.`);
    managerByCode.set(key, found.id);
    return found.id;
  };
  const siteOf = async (name: string | null) => {
    if (!name) return null;
    const found = await peoplePrisma.establishment.findFirst({ where: { orgId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
    if (!found) throw new ImportRowError(`"${name}" is not one of the company's work sites; add it under Settings, Work Sites, first.`);
    return found.id;
  };

  const results: Array<{ row: number; ok: boolean; id?: string; error?: string; action?: 'CREATE' | 'UPDATE'; warning?: string }> = [];
  for (let i = 0; i < rows.length; i += 1) {
    const parsed = importRow.safeParse(rows[i]);
    if (!parsed.success) {
      /* Every problem in the row at once, so the file is fixed in one pass. */
      results.push({ row: i + 1, ok: false, error: [...new Set(parsed.error.issues.map((x) => x.message))].join(' ') || 'Invalid row.' });
      continue;
    }
    const r = parsed.data;
    try {
      const code = blank(r.code);
      const existingByCode = code ? await peoplePrisma.employee.findFirst({ where: { orgId, code } }) : null;
      if (existingByCode && mode === 'CREATE') {
        results.push({ row: i + 1, ok: false, error: `Code ${code} is already used. Choose "update existing" to change them.` });
        continue;
      }
      if (code && codesInFile.has(code.toLowerCase())) {
        results.push({ row: i + 1, ok: false, error: `Code ${code} appears twice in this file.` });
        continue;
      }
      if (code) codesInFile.add(code.toLowerCase());
      /* The same person twice (CORE-02): a match on email or phone is a warning the preview shows; the row still goes in. */
      const dupes = (await findDuplicates(orgId, existingByCode?.id ?? null, { email: r.email, workEmail: r.workEmail, phone: r.phone })).filter((d) => d.field !== 'employee ID');
      const warning = dupes.length ? `Same ${dupes[0].field} as ${dupes[0].name}${dupes[0].code ? ` (${dupes[0].code})` : ''}.` : undefined;
      if (dryRun) {
        await ensure('department', r.department);
        await ensure('jobPosition', r.jobPosition);
        await siteOf(blank(r.workSite));
        if (blank(r.managerCode) && blank(r.managerCode)!.toLowerCase() === code?.toLowerCase()) throw new ImportRowError('Someone cannot be their own manager.');
        await managerOf(blank(r.managerCode));
        if (code) managerByCode.set(code.toLowerCase(), existingByCode?.id || '');
        results.push({ row: i + 1, ok: true, action: existingByCode ? 'UPDATE' : 'CREATE', warning });
        continue;
      }
      if (existingByCode) {
        /* Update: only the columns the file carries; names of lists resolve as on create. */
        const data: Record<string, unknown> = {};
        const set = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== '') data[k] = v; };
        set('name', r.name); set('email', blank(r.email)); set('workEmail', blank(r.workEmail)); set('phone', blank(r.phone)); set('dateOfJoining', blank(r.dateOfJoining)); set('dateOfBirth', blank(r.dateOfBirth)); set('gender', blank(r.gender)); set('hours', r.hours); set('probationEndDate', blank(r.probationEndDate)); set('contractEndDate', blank(r.contractEndDate));
        const dep = await ensure('department', r.department); if (dep) { data.department = dep.name; data.departmentId = dep.id; }
        const pos = await ensure('jobPosition', r.jobPosition); if (pos) { data.designation = pos.name; data.jobPositionId = pos.id; }
        if (jobRule && ((data.departmentId && data.departmentId !== existingByCode.departmentId) || (data.jobPositionId && data.jobPositionId !== existingByCode.jobPositionId))) {
          results.push({ row: i + 1, ok: false, error: `A department or designation change for ${existingByCode.name} needs approval; make it on their record.` });
          continue;
        }
        for (const [kind, col, field] of [['employeeType', r.employeeType, 'employeeTypeId'], ['workType', r.workType, 'workTypeId'], ['businessUnit', r.businessUnit, 'businessUnitId'], ['grade', r.grade, 'gradeId'], ['costCenter', r.costCentre, 'costCenterId']] as const) {
          const row = await ensure(kind, col); if (row) data[field] = row.id;
        }
        const site = await siteOf(blank(r.workSite)); if (site) data.establishmentId = site;
        const mgr = await managerOf(blank(r.managerCode));
        if (mgr) { await checkManager(orgId, existingByCode.id, mgr); data.reportingManagerId = mgr; }
        const before = Object.fromEntries(Object.keys(data).map((k) => [k, (existingByCode as any)[k] ?? null]));
        await updateEmployee(actorOf(req, 'IMPORT', 'Import (update existing)'), existingByCode, data as any, {});
        updatedRows.push({ id: existingByCode.id, before });
        results.push({ row: i + 1, ok: true, id: existingByCode.id, action: 'UPDATE', warning });
        continue;
      }
      const department = await ensure('department', r.department);
      const jobPosition = await ensure('jobPosition', r.jobPosition);
      const establishmentId = await siteOf(blank(r.workSite));
      const reportingManagerId = await managerOf(blank(r.managerCode));
      const created = await createEmployee(actorOf(req, 'IMPORT'), {
          accountId,
          orgId,
          name: r.name,
          code,
          email: blank(r.email),
          workEmail: blank(r.workEmail),
          phone: blank(r.phone),
          department: department?.name ?? null,
          departmentId: department?.id ?? null,
          designation: jobPosition?.name ?? null,
          jobPositionId: jobPosition?.id ?? null,
          employeeTypeId: (await ensure('employeeType', r.employeeType))?.id ?? null,
          workTypeId: (await ensure('workType', r.workType))?.id ?? null,
          businessUnitId: (await ensure('businessUnit', r.businessUnit))?.id ?? null,
          gradeId: (await ensure('grade', r.grade))?.id ?? null,
          costCenterId: (await ensure('costCenter', r.costCentre))?.id ?? null,
          dateOfJoining: blank(r.dateOfJoining),
          dateOfBirth: blank(r.dateOfBirth),
          probationEndDate: blank(r.probationEndDate),
          contractEndDate: blank(r.contractEndDate),
          hours: r.hours,
          gender: blank(r.gender),
          establishmentId,
          reportingManagerId,
          status: 'ACTIVE',
          createdByUserId: userId,
        } as any);
      createdIds.push(created.id);
      if (code) managerByCode.set(code.toLowerCase(), created.id);
      results.push({ row: i + 1, ok: true, id: created.id, action: 'CREATE', warning });
    } catch (e: any) {
      /* Our own reasons are shown; a database message is not (it can name tables and other people's values). */
      results.push({ row: i + 1, ok: false, error: e instanceof ImportRowError || e?.status === 400 ? e.message : String(e?.code) === 'P2002' ? 'Already exists.' : 'This row could not be saved.' });
    }
  }
  const imported = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  /* The batch is remembered so the whole import can be undone within a day (CORE-07). */
  const batch = !dryRun && (createdIds.length || updatedRows.length)
    ? await peoplePrisma.importBatch.create({ data: { accountId, orgId, mode, rows: rows.length, failed, createdIds, updated: updatedRows as any, createdByUserId: userId } })
    : null;
  if (batch) await recordAudit(req, { entity: 'PEOPLE_EMPLOYEES', entityId: batch.id, action: 'IMPORT', message: `Imported ${createdIds.length} new and ${updatedRows.length} updated ${createdIds.length + updatedRows.length === 1 ? 'employee' : 'employees'}`, metadata: { mode, rows: rows.length, failed, created: createdIds.length, updated: updatedRows.length } });
  res.json({ dryRun, mode, imported, failed, results, batchId: batch?.id ?? null, undoUntil: batch ? new Date(batch.createdAt.getTime() + IMPORT_UNDO_HOURS * 3_600_000) : null });
});

const IMPORT_UNDO_HOURS = 24;

peopleRouter.get('/orgs/:orgId/people/employees/import/batches', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  const rows = await peoplePrisma.importBatch.findMany({ where: { orgId: req.tenant!.orgId }, orderBy: { createdAt: 'desc' }, take: 20 });
  const now = Date.now();
  res.json({ batches: rows.map((b) => ({ id: b.id, mode: b.mode, rows: b.rows, failed: b.failed, created: (b.createdIds as string[]).length, updated: (b.updated as unknown[]).length, createdAt: b.createdAt, undoneAt: b.undoneAt, canUndo: !b.undoneAt && now - b.createdAt.getTime() < IMPORT_UNDO_HOURS * 3_600_000 })) });
});

/** Undo an import within a day (CORE-07): the people it made go, with their events; the people it changed go back to what they were. */
peopleRouter.post('/orgs/:orgId/people/employees/import/:batchId/undo', can(PermissionAction.DELETE, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const batch = await peoplePrisma.importBatch.findFirst({ where: { id: String(req.params.batchId), orgId } });
  if (!batch) return res.status(404).json({ error: 'No such import.' });
  if (batch.undoneAt) return res.status(409).json({ error: 'This import was already undone.' });
  if (Date.now() - batch.createdAt.getTime() > IMPORT_UNDO_HOURS * 3_600_000) return res.status(409).json({ error: 'An import can be undone within 24 hours; this one is older. Correct the people by hand.' });
  /* Claimed first, so two clicks cannot both undo it. */
  const claimed = await peoplePrisma.importBatch.updateMany({ where: { id: batch.id, undoneAt: null }, data: { undoneAt: new Date(), undoneByUserId: req.auth!.userId } });
  if (!claimed.count) return res.status(409).json({ error: 'This import was already undone.' });
  const actor = actorOf(req, 'IMPORT', 'Import undone');
  const createdIds = batch.createdIds as string[];
  let removed = 0;
  let restored = 0;
  let kept = 0;
  /* Someone changed by hand since the import keeps those changes; the answer counts them as kept. */
  const touchedSince = (e: { updatedAt: Date }) => e.updatedAt.getTime() > batch.createdAt.getTime() + 1000;
  for (const id of createdIds) {
    const e = await peoplePrisma.employee.findFirst({ where: { id, orgId } });
    if (!e) continue;
    if (touchedSince(e)) { kept += 1; continue; }
    /* The same rule as deleting one person: anyone payroll has touched stays; the rest go to the bin and off the readers. */
    const inPayroll = await payrollPrisma.$transaction(async (tx: any) => {
      await lockPayrollEmployee(tx, e.id);
      if (await tx.employeePayrollProfile.count({ where: { orgId, employeeId: e.id } })) return true;
      for (const [model] of PAYROLL_HISTORY) if (await tx[model].count({ where: { orgId, employeeId: e.id } })) return true;
      await revokeFromReaders(orgId, e, req.auth!.userId);
      await peoplePrisma.outboxEvent.deleteMany({ where: { orgId, employeeId: e.id, deliveredAt: null } });
      await deleteToBin(req, 'employee', e);
      return false;
    }, { timeout: 30_000 });
    if (inPayroll) { kept += 1; continue; }
    await writeChangeLog(peoplePrisma as any, actor, { kind: 'Employee', id, employeeId: id }, [{ field: 'record', before: 'created', after: 'removed: import undone', redacted: false }]);
    removed += 1;
  }
  for (const u of batch.updated as Array<{ id: string; before: Record<string, unknown> }>) {
    const existing = await peoplePrisma.employee.findFirst({ where: { id: u.id, orgId } });
    if (!existing) continue;
    if (touchedSince(existing)) { kept += 1; continue; }
    await updateEmployee(actor, existing, u.before as any, {});
    restored += 1;
  }
  res.json({ removed, restored, kept });
});

peopleRouter.get('/orgs/:orgId/people/org-chart', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const nodes = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, status: { not: 'LEFT' }, ...scopeWhere(await teamScope(req)) },
    select: { id: true, name: true, code: true, designation: true, department: true, photoUrl: true, reportingManagerId: true, dottedManagerId: true },
    orderBy: { name: 'asc' },
  });
  /* Open seats show on the chart (ORG-04): seats on an active team that nobody holds. */
  const seats = await peoplePrisma.seat.findMany({ where: { orgId, isActive: true }, select: { id: true, name: true, teamId: true, jobPositionId: true, budgetRef: true, team: { select: { name: true, leadEmployeeId: true, departmentId: true } } } });
  const held = new Set((await peoplePrisma.employee.findMany({ where: { orgId, seatId: { not: null }, status: { not: 'LEFT' } }, select: { seatId: true } })).map((e) => e.seatId));
  const openSeats = seats.filter((s) => !held.has(s.id)).map((s) => ({ id: s.id, name: s.name, teamId: s.teamId, teamName: s.team?.name || null, leadEmployeeId: s.team?.leadEmployeeId || null, budgetRef: s.budgetRef }));
  res.json({ nodes, openSeats });
});

// ---------------------------------------------------------------------------
// Org structure: one shape for five lists
// ---------------------------------------------------------------------------

const STRUCTURE_KINDS = {
  departments: { model: 'department', usedBy: 'departmentId', extra: ['parentId', 'description'] },
  'job-positions': { model: 'jobPosition', usedBy: 'jobPositionId', extra: ['departmentId', 'description'] },
  'job-roles': { model: 'jobRole', usedBy: 'jobRoleId', extra: ['jobPositionId', 'description'] },
  'employee-types': { model: 'employeeType', usedBy: 'employeeTypeId', extra: ['category', 'probationMonths', 'noticeDays'] },
  'work-types': { model: 'workType', usedBy: 'workTypeId', extra: [] },
  areas: { model: 'area', usedBy: 'areaId', extra: ['parentId', 'description'] },
  'business-units': { model: 'businessUnit', usedBy: 'businessUnitId', extra: ['description'] },
  grades: { model: 'grade', usedBy: 'gradeId', extra: ['description'] },
  'cost-centres': { model: 'costCenter', usedBy: 'costCenterId', extra: ['description'] },
  /* The company in law and its places of work (FND-07). A person's work state is their establishment's. */
  'legal-entities': { model: 'legalEntity', usedBy: null, extra: ['description', 'pan', 'cin', 'address'] },
  establishments: { model: 'establishment', usedBy: 'establishmentId', extra: ['description', 'legalEntityId', 'kind', 'state', 'address', 'registrations', 'holdsOriginals'] },
  /* Teams under departments, with a lead; approved seats on a team, filled or open (ORG-01, ORG-04). */
  teams: { model: 'team', usedBy: 'teamId', extra: ['departmentId', 'leadEmployeeId', 'description'] },
  seats: { model: 'seat', usedBy: 'seatId', extra: ['teamId', 'jobPositionId', 'budgetRef', 'description'] },
} as const;
type Kind = keyof typeof STRUCTURE_KINDS;

const structureSchema = z.object({
  name: z.string().trim().min(1, 'A name is needed.').max(120),
  description: text(500),
  parentId: text(60),
  departmentId: text(60),
  jobPositionId: text(60),
  legalEntityId: text(60),
  kind: z.enum(['SHOP', 'FACTORY', 'OFFICE', 'SITE', 'WAREHOUSE']).optional().nullable().or(z.literal('')),
  state: text(80),
  address: text(500),
  holdsOriginals: z.boolean().optional(),
  teamId: text(60),
  leadEmployeeId: text(60),
  budgetRef: text(80),
  /* A real PAN, or the masked form a screen sends back unchanged. */
  pan: z.string().trim().regex(/^([A-Z]{5}\d{4}[A-Z]|\*{6}[0-9A-Z]{4})$/, 'PAN looks like ABCDE1234F.').optional().nullable().or(z.literal('')),
  cin: text(40),
  registrations: z.array(z.object({ type: z.string().trim().max(40), number: z.string().trim().max(80), validTill: z.string().trim().regex(ISO_DATE).optional().nullable().or(z.literal('')) })).max(20).optional().nullable(),
  isActive: z.boolean().optional(),
  category: z.enum(EMPLOYMENT_KINDS).optional(),
  probationMonths: z.union([z.coerce.number().int().min(1, 'Probation is at least a month.').max(24, 'Probation is at most 24 months.'), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
  noticeDays: z.union([z.coerce.number().int().min(0, 'Notice cannot be negative.').max(365, 'Notice is at most a year.'), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
});

/** A PAN is shown as its last four characters (CORE-04): the full number is for Payroll and the vault. */
const maskPan = (pan: string | null | undefined) => (pan ? `******${pan.slice(-4)}` : pan ?? null);
const kindOf = (req: any): Kind | null => (String(req.params.kind) in STRUCTURE_KINDS ? (String(req.params.kind) as Kind) : null);

peopleRouter.get('/orgs/:orgId/people/structure/:kind', can(PermissionAction.VIEW, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const kind = kindOf(req);
  if (!kind) return res.status(404).json({ error: 'Unknown list.' });
  const { accountId, orgId } = req.tenant!;
  const cfg = STRUCTURE_KINDS[kind];
  /* A company that has not set up its employment types yet starts with the standard ones (safe to repeat: names are unique). */
  if (kind === 'employee-types' && !(await peoplePrisma.employeeType.count({ where: { orgId } }))) {
    await peoplePrisma.employeeType.createMany({ data: DEFAULT_EMPLOYEE_TYPES.map(([name, category]) => ({ accountId, orgId, name, category, createdByUserId: req.auth!.userId })), skipDuplicates: true });
  }
  const rows = await (peoplePrisma as any)[cfg.model].findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } });
  /* A legal entity is used by its establishments, not by people directly. */
  const used = cfg.usedBy
    ? new Map(((await (peoplePrisma.employee.groupBy as any)({ by: [cfg.usedBy], where: { accountId, orgId, status: { not: 'LEFT' } }, _count: { _all: true } })) as any[]).map((c) => [c[cfg.usedBy as string], c._count._all]))
    : new Map(((await (peoplePrisma.establishment.groupBy as any)({ by: ['legalEntityId'], where: { orgId }, _count: { _all: true } })) as any[]).map((c) => [c.legalEntityId, c._count._all]));
  res.json({ items: rows.map((r: any) => ({ ...r, ...(kind === 'legal-entities' ? { pan: maskPan(r.pan) } : {}), employeeCount: used.get(r.id) || 0 })) });
});

/* A list item points only at things in this company, and never under itself, however deep (Workforce audit S18). */
const REF_MODELS: Record<string, string> = { departmentId: 'department', legalEntityId: 'legalEntity', teamId: 'team', jobPositionId: 'jobPosition', leadEmployeeId: 'employee' };
async function badStructureRef(orgId: string, model: string, data: Record<string, unknown>, selfId: string | null): Promise<string | null> {
  for (const [key, ref] of Object.entries({ ...REF_MODELS, parentId: model })) {
    const id = data[key];
    if (typeof id !== 'string' || !id) continue;
    if (!(await (peoplePrisma as any)[ref].findFirst({ where: { id, orgId }, select: { id: true } }))) return 'That link points at something not in this company.';
  }
  if (selfId && typeof data.parentId === 'string') {
    let at: string | null = data.parentId;
    for (let depth = 0; at && depth < 50; depth += 1) {
      if (at === selfId) return 'That would put it under itself.';
      at = ((await (peoplePrisma as any)[model].findFirst({ where: { id: at, orgId }, select: { parentId: true } })) as { parentId: string | null } | null)?.parentId ?? null;
    }
  }
  return null;
}

peopleRouter.post('/orgs/:orgId/people/structure/:kind', can(PermissionAction.CREATE, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const kind = kindOf(req);
  if (!kind) return res.status(404).json({ error: 'Unknown list.' });
  const { accountId, orgId } = req.tenant!;
  const parsed = structureSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid.' });
  const cfg = STRUCTURE_KINDS[kind];
  const data: any = { accountId, orgId, name: parsed.data.name, createdByUserId: req.auth!.userId };
  for (const k of cfg.extra) if ((parsed.data as any)[k] !== undefined) data[k] = k === 'registrations' || k === 'holdsOriginals' || k === 'probationMonths' || k === 'noticeDays' ? (parsed.data as any)[k] : blank((parsed.data as any)[k]);
  if (kind === 'establishments' && !data.state) return res.status(400).json({ error: 'Say which state the establishment is in: its rules follow from that.' });
  /* An unset type takes the default; an unset entity is simply absent. */
  if (kind === 'establishments') { if (!data.kind) delete data.kind; if (!data.legalEntityId) delete data.legalEntityId; }
  /* A type created without saying what it counts as is read from its name ("Summer intern" is an intern). */
  if (kind === 'employee-types' && !data.category) data.category = guessKind(data.name);
  if (kind === 'establishments' && data.holdsOriginals === true && NO_ORIGINALS_STATES.has(String(data.state || '').trim().toLowerCase())) return res.status(400).json({ error: `${data.state} does not allow an employer to hold employees' original documents (Shops & Establishments amendment, 2026).` });
  const badRef = await badStructureRef(orgId, cfg.model, data, null);
  if (badRef) return res.status(400).json({ error: badRef });
  try {
    const row = await (peoplePrisma as any)[cfg.model].create({ data });
    res.status(201).json({ item: kind === 'legal-entities' ? { ...row, pan: maskPan(row.pan) } : row });
  } catch (e) {
    return sendError(res, e);
  }
});

peopleRouter.put('/orgs/:orgId/people/structure/:kind/:id', can(PermissionAction.EDIT, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const kind = kindOf(req);
  if (!kind) return res.status(404).json({ error: 'Unknown list.' });
  const { accountId, orgId } = req.tenant!;
  const cfg = STRUCTURE_KINDS[kind];
  const model: any = (peoplePrisma as any)[cfg.model];
  const existing = await model.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'Not found.' });
  const parsed = structureSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid.' });
  if (kind === 'departments' && parsed.data.parentId === existing.id) {
    return res.status(400).json({ error: 'A department cannot sit under itself.' });
  }
  const data: any = { name: parsed.data.name };
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
  for (const k of cfg.extra) if ((parsed.data as any)[k] !== undefined) data[k] = k === 'registrations' || k === 'holdsOriginals' || k === 'probationMonths' || k === 'noticeDays' ? (parsed.data as any)[k] : blank((parsed.data as any)[k]);
  /* A masked PAN sent back unchanged is not a change. */
  if (kind === 'legal-entities' && typeof data.pan === 'string' && data.pan.includes('*')) delete data.pan;
  if (kind === 'establishments' && data.state === null) return res.status(400).json({ error: 'An establishment keeps its state.' });
  if (kind === 'establishments' && data.kind === null) delete data.kind;
  if (kind === 'establishments' && data.holdsOriginals === true) {
    const state = data.state !== undefined ? data.state : (await peoplePrisma.establishment.findFirst({ where: { id: String(req.params.id), orgId }, select: { state: true } }))?.state;
    if (NO_ORIGINALS_STATES.has(String(state || '').trim().toLowerCase())) return res.status(400).json({ error: `${state} does not allow an employer to hold employees' original documents (Shops & Establishments amendment, 2026).` });
  }
  const badRef = await badStructureRef(orgId, cfg.model, data, existing.id);
  if (badRef) return res.status(400).json({ error: badRef });
  try {
    const row = await model.update({ where: { id: existing.id }, data });
    if (kind === 'legal-entities') row.pan = maskPan(row.pan);
    /* Renaming a department or position renames what the files display. */
    if (kind === 'departments' && row.name !== existing.name) {
      await peoplePrisma.employee.updateMany({ where: { orgId, departmentId: row.id }, data: { department: row.name } });
    }
    if (kind === 'job-positions' && row.name !== existing.name) {
      await peoplePrisma.employee.updateMany({ where: { orgId, jobPositionId: row.id }, data: { designation: row.name } });
    }
    res.json({ item: row });
  } catch (e) {
    return sendError(res, e);
  }
});

peopleRouter.delete('/orgs/:orgId/people/structure/:kind/:id', can(PermissionAction.DELETE, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const kind = kindOf(req);
  if (!kind) return res.status(404).json({ error: 'Unknown list.' });
  const { accountId, orgId } = req.tenant!;
  const cfg = STRUCTURE_KINDS[kind];
  const model: any = (peoplePrisma as any)[cfg.model];
  const existing = await model.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'Not found.' });
  const inUse = cfg.usedBy
    ? await peoplePrisma.employee.count({ where: { orgId, [cfg.usedBy]: existing.id } as any })
    : await peoplePrisma.establishment.count({ where: { orgId, legalEntityId: existing.id } });
  if (inUse) {
    return res.status(409).json({ error: cfg.usedBy ? `${inUse} ${inUse === 1 ? 'person uses' : 'people use'} this. Move them first, or mark it inactive.` : `${inUse} establishment${inUse === 1 ? ' belongs' : 's belong'} to it. Move them first, or mark it inactive.` });
  }
  await deleteToBin(req, cfg.model, existing);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Tags and notes
// ---------------------------------------------------------------------------

peopleRouter.get('/orgs/:orgId/people/tags', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  res.json({ tags: await peoplePrisma.employeeTag.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } }) });
});

peopleRouter.post('/orgs/:orgId/people/tags', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({ name: z.string().trim().min(1).max(40), color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A tag needs a name, and a colour like #E54F38.' });
  try {
    const tag = await peoplePrisma.employeeTag.create({
      data: { accountId, orgId, name: parsed.data.name, ...(parsed.data.color ? { color: parsed.data.color } : {}), createdByUserId: req.auth!.userId },
    });
    res.status(201).json({ tag });
  } catch (e) {
    return sendError(res, e);
  }
});

peopleRouter.delete('/orgs/:orgId/people/tags/:id', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const tag = await peoplePrisma.employeeTag.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!tag) return res.status(404).json({ error: 'No such tag.' });
  await peoplePrisma.employeeTag.delete({ where: { id: tag.id } });
  res.json({ ok: true });
});

peopleRouter.get('/orgs/:orgId/people/employees/:id/notes', can(PermissionAction.VIEW, NOTES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  void accountId;
  const employee = await scopedEmployee(req, String(req.params.id), { id: true });
  if (!employee) return res.status(404).json({ error: 'No such employee.' });
  res.json({
    notes: await peoplePrisma.employeeNote.findMany({ where: { orgId, employeeId: employee.id }, orderBy: { createdAt: 'desc' } }),
  });
});

peopleRouter.post('/orgs/:orgId/people/employees/:id/notes', can(PermissionAction.CREATE, NOTES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await scopedEmployee(req, String(req.params.id), { id: true });
  if (!employee) return res.status(404).json({ error: 'No such employee.' });
  const parsed = z.object({ body: z.string().trim().min(1, 'Write something first.').max(4000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid note.' });
  const note = await peoplePrisma.employeeNote.create({
    data: { accountId, orgId, employeeId: employee.id, body: parsed.data.body, createdByUserId: req.auth!.userId },
  });
  res.status(201).json({ note });
});

peopleRouter.delete('/orgs/:orgId/people/notes/:noteId', can(PermissionAction.DELETE, NOTES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const note = await peoplePrisma.employeeNote.findFirst({ where: { id: String(req.params.noteId), accountId, orgId } });
  if (!note || !inScope(await teamScope(req), note.employeeId)) return res.status(404).json({ error: 'No such note.' });
  await deleteToBin(req, 'employeeNote', note);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Documents on the employee file (ClorTime's Employee Document)
// ---------------------------------------------------------------------------

const DOC_KINDS = new Set(['ID_PROOF', 'ADDRESS_PROOF', 'EDUCATION', 'CONTRACT', 'PAYSLIP', 'WORK_PERMIT', 'CERTIFICATE', 'LETTER', 'OTHER']);
const docRow = (d: any) => ({ id: d.id, employeeId: d.employeeId, kind: d.kind, title: d.title, mime: d.mime, size: d.size, expiresOn: d.expiresOn, restrictsWork: d.restrictsWork ?? null, version: d.version ?? 1, supersedesId: d.supersedesId ?? null, supersededById: d.supersededById ?? null, templateId: d.templateId ?? null, templateVersion: d.templateVersion ?? null, classification: d.classification, visibleToEmployee: d.visibleToEmployee, uploadedByUserId: d.uploadedByUserId, createdAt: d.createdAt });
const DOC_SELECT = { id: true, employeeId: true, kind: true, title: true, mime: true, size: true, expiresOn: true, restrictsWork: true, version: true, supersedesId: true, supersededById: true, templateId: true, templateVersion: true, classification: true, visibleToEmployee: true, uploadedByUserId: true, createdAt: true } as const;

/**
 * Who can see a document (docs/people/02-PRD.md DOC-01; review R-01).
 *
 * Until 24 Oct 2026 any role with Employees VIEW opened every file on every
 * person, and the Attendance Manager preset carried that grant. Now each
 * document names its classification, and the grant that opens it is:
 *
 *   EMPLOYEE_VISIBLE, HR_ONLY   Documents VIEW
 *   RESTRICTED                  Documents EDIT
 *   CONFIDENTIAL                Confidential Documents VIEW (its own grant)
 *
 * The employee app keeps reading `visibleToEmployee`, which is true only for
 * EMPLOYEE_VISIBLE. Lists are filtered to what the caller may open, so a
 * person never learns a confidential file exists from its title.
 */
const DOC_CLASSIFICATIONS = ['EMPLOYEE_VISIBLE', 'HR_ONLY', 'RESTRICTED', 'CONFIDENTIAL'] as const;
type DocClass = (typeof DOC_CLASSIFICATIONS)[number];
async function readableClassifications(req: Request): Promise<DocClass[]> {
  const out: DocClass[] = [];
  if (!(await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, DOCUMENTS))) out.push('EMPLOYEE_VISIBLE', 'HR_ONLY');
  if (!(await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, DOCUMENTS))) out.push('RESTRICTED');
  if (!(await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, CONFIDENTIAL))) out.push('CONFIDENTIAL');
  return out;
}
/** The grant a write (upload, delete) on a document of this classification needs. */
const writeGrantFor = (classification: string, action: PermissionActionType): [string, PermissionActionType, string] =>
  classification === 'CONFIDENTIAL' ? [PEOPLE_MODULE, action, CONFIDENTIAL] : [PEOPLE_MODULE, action, DOCUMENTS];

peopleRouter.get('/orgs/:orgId/people/documents', can(PermissionAction.VIEW, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const classification = { in: await readableClassifications(req) };
  const scope = await teamScope(req);
  const rows = await peoplePrisma.employeeDocument.findMany({
    where: { accountId, orgId, classification, supersededById: null, ...(scope.all ? {} : { employeeId: { in: scope.ids } }) }, orderBy: { createdAt: 'desc' },
    select: { ...DOC_SELECT, employee: { select: { name: true, code: true } } },
  });
  res.json({ documents: rows.map((r) => ({ ...docRow(r), employeeName: r.employee.name, employeeCode: r.employee.code })) });
});

peopleRouter.get('/orgs/:orgId/people/employees/:id/documents', can(PermissionAction.VIEW, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const classification = { in: await readableClassifications(req) };
  if (!inScope(await teamScope(req), String(req.params.id))) return res.status(404).json({ error: 'No such employee.' });
  const rows = await peoplePrisma.employeeDocument.findMany({ where: { accountId, orgId, employeeId: String(req.params.id), classification, supersededById: null }, orderBy: { createdAt: 'desc' }, select: DOC_SELECT });
  res.json({ documents: rows.map(docRow) });
});

/** Replace a file (DOC-02): the new one takes the old one's place; the old one stays, pointed both ways, under "Earlier versions". */
peopleRouter.post('/orgs/:orgId/people/documents/:docId/replace', can(PermissionAction.CREATE, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const old = await peoplePrisma.employeeDocument.findFirst({ where: { id: String(req.params.docId), accountId, orgId }, select: { ...DOC_SELECT } });
  if (!old || !(await readableClassifications(req)).includes(old.classification as DocClass) || !inScope(await teamScope(req), old.employeeId)) return res.status(404).json({ error: 'No such document.' });
  if (old.supersededById) return res.status(409).json({ error: 'A newer version already exists; replace that one.' });
  const refused = await authorize(req, ...writeGrantFor(old.classification, PermissionAction.CREATE));
  if (refused) return res.status(refused.status).json(refused.body);
  const file = decodeDocument(req.body?.data, req.body?.mime);
  if ('error' in file) return res.status(400).json({ error: file.error });
  const title = String(req.body?.title || old.title).trim().slice(0, 120) || old.title;
  const expiresOn = req.body?.expiresOn !== undefined ? String(req.body.expiresOn || '').trim() || null : old.expiresOn;
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return res.status(400).json({ error: 'Dates are YYYY-MM-DD.' });
  const d = await peoplePrisma.$transaction(async (tx) => {
    const created = await tx.employeeDocument.create({
      data: { accountId, orgId, employeeId: old.employeeId, kind: old.kind, title, mime: file.mime, size: file.data.length, data: file.data, expiresOn, restrictsWork: old.restrictsWork, classification: old.classification, visibleToEmployee: old.visibleToEmployee, uploadedByUserId: req.auth!.userId, version: (old.version ?? 1) + 1, supersedesId: old.id },
    });
    await tx.employeeDocument.update({ where: { id: old.id }, data: { supersededById: created.id } });
    return created;
  });
  res.status(201).json({ document: docRow(d) });
});

/** Ask the person to read and accept a file on their record (DOC-05). Only a file they can see can be asked of them. */
peopleRouter.post('/orgs/:orgId/people/documents/:docId/ask-to-read', can(PermissionAction.EDIT, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const d = await peoplePrisma.employeeDocument.findFirst({ where: { id: String(req.params.docId), accountId, orgId }, select: { id: true, title: true, employeeId: true, classification: true } });
  if (!d || !(await readableClassifications(req)).includes(d.classification as DocClass) || !inScope(await teamScope(req), d.employeeId)) return res.status(404).json({ error: 'No such document.' });
  if (d.classification !== 'EMPLOYEE_VISIBLE') return res.status(400).json({ error: 'The person cannot see this file, so they cannot be asked to accept it. Set "Who can see" to the person and HR first.' });
  const asked = await askToRead({ accountId, orgId, userId: req.auth!.userId }, 'DOCUMENT', d.id, [d.employeeId], { title: `Please read and accept: ${d.title}`, body: 'Open Me → Documents in the employee app.' });
  res.json({ newlyAsked: asked, ...(await ackReport(orgId, 'DOCUMENT', d.id)) });
});

peopleRouter.get('/orgs/:orgId/people/documents/:docId/acknowledgements', can(PermissionAction.VIEW, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const d = await peoplePrisma.employeeDocument.findFirst({ where: { id: String(req.params.docId), accountId, orgId }, select: { id: true, employeeId: true, classification: true } });
  if (!d || !(await readableClassifications(req)).includes(d.classification as DocClass) || !inScope(await teamScope(req), d.employeeId)) return res.status(404).json({ error: 'No such document.' });
  res.json(await ackReport(orgId, 'DOCUMENT', d.id));
});

peopleRouter.post('/orgs/:orgId/people/documents/:docId/remind', can(PermissionAction.EDIT, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const d = await peoplePrisma.employeeDocument.findFirst({ where: { id: String(req.params.docId), accountId, orgId }, select: { id: true, title: true, employeeId: true, classification: true } });
  if (!d || !(await readableClassifications(req)).includes(d.classification as DocClass) || !inScope(await teamScope(req), d.employeeId)) return res.status(404).json({ error: 'No such document.' });
  res.json({ reminded: await ackRemind({ accountId, orgId, userId: req.auth!.userId }, 'DOCUMENT', d.id, { title: `Please read and accept: ${d.title}`, body: 'Open Me → Documents in the employee app.' }) });
});

/** Every version of a file, newest first (DOC-02). */
peopleRouter.get('/orgs/:orgId/people/documents/:docId/versions', can(PermissionAction.VIEW, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const d = await peoplePrisma.employeeDocument.findFirst({ where: { id: String(req.params.docId), accountId, orgId }, select: DOC_SELECT });
  if (!d || !(await readableClassifications(req)).includes(d.classification as DocClass) || !inScope(await teamScope(req), d.employeeId)) return res.status(404).json({ error: 'No such document.' });
  const chain: Array<typeof d> = [d];
  let cur = d;
  for (let i = 0; i < 50 && cur.supersedesId; i += 1) {
    const prev = await peoplePrisma.employeeDocument.findFirst({ where: { id: cur.supersedesId, orgId }, select: DOC_SELECT });
    if (!prev) break;
    chain.push(prev);
    cur = prev;
  }
  cur = d;
  for (let i = 0; i < 50 && cur.supersededById; i += 1) {
    const next = await peoplePrisma.employeeDocument.findFirst({ where: { id: cur.supersededById, orgId }, select: DOC_SELECT });
    if (!next) break;
    chain.unshift(next);
    cur = next;
  }
  res.json({ versions: chain.map(docRow) });
});

peopleRouter.post('/orgs/:orgId/people/employees/:id/documents', can(PermissionAction.CREATE, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  /* The old flag still arrives from older clients: false meant "HR only". */
  const classification = String(req.body?.classification || (req.body?.visibleToEmployee === false ? 'HR_ONLY' : 'EMPLOYEE_VISIBLE')).toUpperCase();
  if (!DOC_CLASSIFICATIONS.includes(classification as DocClass)) return res.status(400).json({ error: 'Say who can see it: the person and HR, HR only, restricted, or confidential.' });
  const refused = await authorize(req, ...writeGrantFor(classification, PermissionAction.CREATE));
  if (refused) return res.status(refused.status).json(refused.body);
  const employee = await scopedEmployee(req, String(req.params.id), { id: true });
  if (!employee) return res.status(404).json({ error: 'No such employee.' });
  const kind = String(req.body?.kind || 'OTHER').toUpperCase();
  if (!DOC_KINDS.has(kind)) return res.status(400).json({ error: 'Unknown document kind.' });
  const title = String(req.body?.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'Name the document.' });
  const expiresOn = String(req.body?.expiresOn || '').trim() || null;
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return res.status(400).json({ error: 'Dates are YYYY-MM-DD.' });
  /* A permit or certificate says what the person may not do while it is lapsed (LIFE-08). */
  const restrictsWork = PERMIT_KINDS.has(kind) ? String(req.body?.restrictsWork || '').trim().slice(0, 500) || null : null;
  if (PERMIT_KINDS.has(kind) && !expiresOn) return res.status(400).json({ error: 'A permit or certificate needs its expiry date.' });
  const file = decodeDocument(req.body?.data, req.body?.mime);
  if ('error' in file) return res.status(400).json({ error: file.error });
  const d = await peoplePrisma.employeeDocument.create({
    data: { accountId, orgId, employeeId: employee.id, kind, title, mime: file.mime, size: file.data.length, data: file.data, expiresOn, restrictsWork, classification, visibleToEmployee: classification === 'EMPLOYEE_VISIBLE', uploadedByUserId: req.auth!.userId },
  });
  res.status(201).json({ document: docRow(d) });
});

/** The file itself, as a data URL — small enough to carry inline, and the same shape the portal uses. */
peopleRouter.get('/orgs/:orgId/people/documents/:docId', can(PermissionAction.VIEW, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const d = await peoplePrisma.employeeDocument.findFirst({ where: { id: String(req.params.docId), accountId, orgId } });
  /* A file the caller may not open reads as absent, so its title does not leak through a 403. */
  if (!d || !(await readableClassifications(req)).includes(d.classification as DocClass) || !inScope(await teamScope(req), d.employeeId)) return res.status(404).json({ error: 'No such document.' });
  /* PRV-07: every open of a confidential or restricted file is on the access log. */
  if (d.classification === 'CONFIDENTIAL' || d.classification === 'RESTRICTED') {
    await peoplePrisma.accessLog.create({ data: { accountId, orgId, what: d.classification === 'CONFIDENTIAL' ? 'DOC_CONFIDENTIAL' : 'DOC_RESTRICTED', entityId: d.id, employeeId: d.employeeId, userId: req.auth!.userId } });
  }
  res.json({ document: { ...docRow(d), dataUrl: `data:${d.mime};base64,${Buffer.from(d.data).toString('base64')}` } });
});

peopleRouter.delete('/orgs/:orgId/people/documents/:docId', can(PermissionAction.DELETE, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const d = await peoplePrisma.employeeDocument.findFirst({ where: { id: String(req.params.docId), accountId, orgId }, select: { id: true, classification: true, title: true, employeeId: true } });
  if (!d || !(await readableClassifications(req)).includes(d.classification as DocClass) || !inScope(await teamScope(req), d.employeeId)) return res.status(404).json({ error: 'No such document.' });
  const refused = await authorize(req, ...writeGrantFor(d.classification, PermissionAction.DELETE));
  if (refused) return res.status(refused.status).json(refused.body);
  await deleteToBin(req, 'employeeDocument', { id: d.id });
  /* The person's Activity shows a removed file, as it shows an uploaded one (Workforce WF-18). */
  await writeChangeLog(peoplePrisma as any, actorOf(req, 'FORM'), { kind: 'EmployeeDocument', id: d.id, employeeId: d.employeeId }, [{ field: 'document', before: d.title, after: null, redacted: false }]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Data requests (DPDP): raised in the portal, answered here
// ---------------------------------------------------------------------------

peopleRouter.get('/orgs/:orgId/people/data-requests', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const status = String(req.query.status || '').toUpperCase();
  const rows = await peoplePrisma.dataRequest.findMany({ where: { accountId, orgId, ...(['PENDING', 'RESOLVED', 'REJECTED'].includes(status) ? { status } : {}) }, orderBy: [{ status: 'desc' }, { createdAt: 'desc' }], take: 500 });
  const names = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, name: true, code: true } })).map((e) => [e.id, e]));
  /* PRV-02: an erasure shows what the law keeps, and until when, before anyone answers it. */
  const erasures = rows.filter((r) => r.type === 'ERASURE');
  const leftOn = new Map((erasures.length ? await peoplePrisma.employee.findMany({ where: { orgId, id: { in: erasures.map((r) => r.employeeId) } }, select: { id: true, dateOfLeaving: true } }) : []).map((e) => [e.id, e.dateOfLeaving]));
  const kept = new Map<string, Awaited<ReturnType<typeof retentionExceptions>>>();
  for (const r of erasures) kept.set(r.id, await retentionExceptions(orgId, leftOn.get(r.employeeId) ?? null));
  res.json({ requests: rows.map((r) => ({ ...r, employeeName: names.get(r.employeeId)?.name || null, employeeCode: names.get(r.employeeId)?.code || null, retentionExceptions: kept.get(r.id) || null })), pending: rows.filter((r) => r.status === 'PENDING').length });
});

peopleRouter.post('/orgs/:orgId/people/data-requests/:id/resolve', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.dataRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: `This request was already ${r.status.toLowerCase()}.` });
  const status = String(req.body?.status || '').toUpperCase();
  if (!['RESOLVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'status must be RESOLVED or REJECTED.' });
  const resolution = String(req.body?.resolution || '').trim().slice(0, 2000);
  if (!resolution) return res.status(400).json({ error: 'Say what was done — the person reads this.' });
  const updated = await peoplePrisma.dataRequest.update({ where: { id: r.id }, data: { status, resolution, reviewedByUserId: req.auth!.userId, reviewedAt: new Date() } });
  res.json({ request: updated });
});

/*
 * Anonymise a former employee (LX-07): erase what no law makes the company
 * keep; see services/anonymiseEmployee.ts for exactly what goes and stays.
 * Irreversible, so the caller types the person's name, and it needs the right
 * to delete employees. With an erasure request's id, that request is answered
 * as done, in words the person will read in the portal.
 */
peopleRouter.post('/orgs/:orgId/people/employees/:id/anonymise', can(PermissionAction.DELETE, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employeeId = String(req.params.id);
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, accountId, orgId }, select: { name: true } });
  if (!e) return res.status(404).json({ error: 'No such employee.' });
  if (String(req.body?.confirmName || '').trim().toLowerCase() !== e.name.trim().toLowerCase()) {
    return res.status(400).json({ error: `Type ${e.name} exactly to confirm.`, code: 'CONFIRM_NAME' });
  }
  const requestId = req.body?.dataRequestId ? String(req.body.dataRequestId) : '';
  const request = requestId
    ? await peoplePrisma.dataRequest.findFirst({ where: { id: requestId, accountId, orgId, employeeId, type: 'ERASURE', status: 'PENDING' } })
    : null;
  if (requestId && !request) return res.status(409).json({ error: 'That erasure request is not open for this person.' });

  let result;
  try {
    result = await anonymiseEmployee({ accountId, orgId, employeeId });
  } catch (err) {
    if (err instanceof AnonymiseError) return res.status(err.status).json({ error: err.message, code: err.code });
    throw err;
  }
  if (request) {
    await peoplePrisma.dataRequest.update({
      where: { id: request.id },
      data: {
        status: 'RESOLVED',
        resolution: `Your personal data was erased on ${result.anonymisedAt.slice(0, 10)}. The law makes us keep some records for a fixed period, deleted when it ends: ${(await retentionExceptions(orgId, (await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { dateOfLeaving: true } }))?.dateOfLeaving ?? null)).map((k) => `${k.label.toLowerCase()} until ${k.until || `${k.keepYears} years after leaving`} (${k.basis})`).join('; ')}.`,
        reviewedByUserId: req.auth!.userId,
        reviewedAt: new Date(),
      },
    });
  }
  await recordAudit(req, {
    entity: 'Employee',
    entityId: employeeId,
    action: 'ANONYMISE',
    message: `Anonymised ${result.name}${result.code ? ` (${result.code})` : ''}${request ? ', answering their erasure request' : ''}`,
    metadata: { erased: result.erased, kept: result.kept, dataRequestId: request?.id || null },
  });
  res.json({ result, requestResolved: Boolean(request) });
});
