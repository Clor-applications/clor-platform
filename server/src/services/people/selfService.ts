import { createHash } from 'node:crypto';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { notifyPermission } from '../notifications.js';
import type { Actor } from './changeLog.js';
import { updateEmployee } from './employees.js';
import { PORTAL_PREFIX, activeRule, namesFor, reply, saveRule, submitRequest, withdraw, type Payload, type StepSpec } from './approvals/engine.js';
import { legacySteps } from './approvals/spec.js';

/**
 * Personal details from the employee app (docs/people/02-PRD.md CORE-03;
 * decision D-02). The company setting says what saves at once and what
 * waits for HR: by default contact details save directly and the rest —
 * name, address, date of birth, gender, marital status — becomes a
 * PROFILE_CHANGE request. A new photo always waits for HR. Every path is
 * logged; a saved change says it came from the person, an approved one
 * carries the request.
 *
 * The person sees their own requests here too — waiting, asked for more,
 * answered — and can answer HR or withdraw one (E5). A field with a request
 * still open cannot be asked about again, and a request is not approved onto
 * a value that has changed since it was asked (E22).
 */

export const SELF_SERVICE_MODES = ['CONTACT_DIRECT', 'ALL', 'NONE'] as const;
export type SelfServiceMode = (typeof SELF_SERVICE_MODES)[number];
export const MODE_WORDS: Record<SelfServiceMode, string> = {
  CONTACT_DIRECT: 'Contact details save at once; everything else waits for HR',
  ALL: 'Everything waits for HR',
  NONE: 'Everything saves at once; HR is told',
};

/** What a person may change about themselves, and which of those are contact details. */
export const SELF_FIELDS = ['firstName', 'lastName', 'phone', 'personalEmail', 'addressLine', 'city', 'state', 'country', 'pincode', 'dateOfBirth', 'gender', 'maritalStatus', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'guardianName'] as const;
export type SelfField = (typeof SELF_FIELDS)[number];
const CONTACT: Set<string> = new Set(['phone', 'personalEmail', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation']);
export const SELF_FIELD_LABEL: Record<SelfField, string> = {
  firstName: 'First name', lastName: 'Last name', phone: 'Phone', personalEmail: 'Personal email', addressLine: 'Address', city: 'City', state: 'State', country: 'Country', pincode: 'PIN code',
  dateOfBirth: 'Date of birth', gender: 'Gender', maritalStatus: 'Marital status', emergencyContactName: 'Emergency contact', emergencyContactPhone: 'Emergency contact phone', emergencyContactRelation: 'Emergency contact relation', guardianName: 'Father / husband name',
};
const LABEL: Record<string, string> = { ...SELF_FIELD_LABEL, photoUrl: 'Photo' };
const GENDERS = new Set(['MALE', 'FEMALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY']);
const MARITAL = new Set(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A photo from the app: a small image as a data URL, the same limit HR's form has. */
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const PHOTO_MAX = 300_000;
const OPEN = ['WAITING', 'MORE_INFO'];
const DEFAULT_DUE_DAYS = 3;

export class SelfServiceError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** How many working days HR has to decide a profile change, by the active rule (E23); the default rule's when there is none yet. */
async function profileDecideDays(orgId: string) {
  const rule = await activeRule(orgId, 'PROFILE_CHANGE');
  if (!rule) return { days: DEFAULT_DUE_DAYS, ruleSet: false };
  const steps: StepSpec[] = legacySteps(rule.steps);
  return { days: steps.reduce((n, s) => n + (Number(s.dueDays) || 0), 0) || DEFAULT_DUE_DAYS, ruleSet: true };
}

export async function settingsOf(accountId: string, orgId: string) {
  const row = await peoplePrisma.peopleSetting.findUnique({ where: { orgId } });
  const due = await profileDecideDays(orgId);
  return { selfServiceChanges: (row?.selfServiceChanges as SelfServiceMode) || 'CONTACT_DIRECT', modes: SELF_SERVICE_MODES.map((m) => ({ key: m, label: MODE_WORDS[m] })), profileDecideDays: due.days, profileRuleSet: due.ruleSet, accountId };
}

export async function saveSettings(who: { accountId: string; orgId: string; userId: string | null }, input: { selfServiceChanges?: string }) {
  const mode = String(input.selfServiceChanges || '').toUpperCase() as SelfServiceMode;
  if (!SELF_SERVICE_MODES.includes(mode)) throw new SelfServiceError('Pick one of: contact details save at once; everything waits for HR; everything saves at once.');
  await peoplePrisma.peopleSetting.upsert({ where: { orgId: who.orgId }, create: { accountId: who.accountId, orgId: who.orgId, selfServiceChanges: mode, updatedByUserId: who.userId }, update: { selfServiceChanges: mode, updatedByUserId: who.userId } });
  return settingsOf(who.accountId, who.orgId);
}

function cleanField(k: SelfField, raw: unknown): string | null {
  let v: string | null = String(raw ?? '').trim().slice(0, 200) || null;
  if (k === 'personalEmail' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new SelfServiceError('That is not an email address.');
  if (k === 'dateOfBirth' && v && !ISO_DATE.test(v)) throw new SelfServiceError('Dates are YYYY-MM-DD.');
  if (k === 'gender' && v) { v = v.toUpperCase(); if (!GENDERS.has(v)) throw new SelfServiceError('Gender is male, female, non-binary, other, or prefer not to say.'); }
  if (k === 'maritalStatus' && v) { v = v.toUpperCase(); if (!MARITAL.has(v)) throw new SelfServiceError('Marital status is single, married, divorced or widowed.'); }
  if (k === 'pincode' && v && !/^\d{6}$/.test(v)) throw new SelfServiceError('A PIN code is six digits.');
  if ((k === 'firstName' || k === 'lastName') && !v) throw new SelfServiceError(`${SELF_FIELD_LABEL[k]} cannot be blank.`);
  return v;
}

/** A photo is compared by a short fingerprint, so the request does not carry the old picture. */
const photoPrint = (v: unknown) => (v ? `photo:${createHash('sha256').update(String(v)).digest('hex').slice(0, 16)}` : null);
const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

/** E22: the fields of a profile change whose value on the record is no longer what it was when asked. Labels, for the message. */
export function staleFields(current: Record<string, unknown>, payload: Payload & { photoBefore?: string | null }) {
  const out: string[] = [];
  for (const [k, v] of Object.entries(payload.fields || {})) {
    const changed = k === 'photoUrl' ? !same(photoPrint(current.photoUrl), payload.photoBefore ?? null) : !same(current[k] ?? null, v?.before ?? null);
    if (changed) out.push(LABEL[k] || k);
  }
  return out;
}

/** The user ids a person's own requests carry: their CLOR sign-in when linked, and the employee app's `portal:<id>`. */
const requesterIds = (e: { id: string; userId?: string | null }) => [`${PORTAL_PREFIX}${e.id}`, ...(e.userId ? [e.userId] : [])];

const STATUS_WORDS: Record<string, string> = { WAITING: 'Waiting for a decision', MORE_INFO: 'More information asked for', REJECTED: 'Not approved', APPROVED: 'Approved' };
const RECENT_MS = 30 * 86_400_000;

/** My requests about myself: every open one, and those answered in the last 30 days, with what was said. */
async function myRequests(orgId: string, e: { id: string; userId?: string | null }) {
  const since = new Date(Date.now() - RECENT_MS);
  const rows = await peoplePrisma.approvalRequest.findMany({
    where: { orgId, subjectEmployeeId: e.id, requesterUserId: { in: requesterIds(e) }, requestType: { in: ['PROFILE_CHANGE', 'LEAVING'] }, OR: [{ status: { in: OPEN } }, { status: { in: ['REJECTED', 'APPROVED'] }, updatedAt: { gte: since } }] },
    include: { steps: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const names = await namesFor(rows.flatMap((r) => r.steps.map((s) => s.decidedByUserId).filter(Boolean) as string[]), orgId);
  return rows.map((r) => {
    const p = (r.payload || {}) as Payload & { lastDay?: string; replies?: Array<{ at: string; note: string }> };
    const asked = r.requestType === 'LEAVING'
      ? [{ field: 'lastDay', label: 'Last working day', value: p.lastDay ?? null }]
      : Object.entries(p.fields || {}).map(([k, v]) => ({ field: k, label: LABEL[k] || k, value: k === 'photoUrl' ? null : v?.after == null ? null : String(v.after) }));
    const said = [...r.steps].reverse().find((s) => s.decidedAt && s.comment && ['MORE_INFO', 'REJECTED', 'APPROVED'].includes(s.status));
    return {
      id: r.id, kind: r.requestType, title: r.title, status: r.status, statusLabel: STATUS_WORDS[r.status] || r.status, asked,
      comment: said ? { text: said.comment, by: (said.decidedByUserId && names.get(said.decidedByUserId)) || '', at: said.decidedAt } : null,
      replies: Array.isArray(p.replies) ? p.replies : [],
      createdAt: r.createdAt, updatedAt: r.updatedAt,
      canReply: r.status === 'MORE_INFO', canWithdraw: OPEN.includes(r.status),
    };
  });
}

/** E13: my terms of employment, in words. */
async function termsOf(orgId: string, e: any) {
  const [type, mode, manager, dept, branch] = await Promise.all([
    e.employeeTypeId ? peoplePrisma.employeeType.findFirst({ where: { id: e.employeeTypeId, orgId }, select: { name: true, noticeDays: true } }) : null,
    e.workTypeId ? peoplePrisma.workType.findFirst({ where: { id: e.workTypeId, orgId }, select: { name: true } }) : null,
    e.reportingManagerId ? peoplePrisma.employee.findFirst({ where: { id: e.reportingManagerId, orgId }, select: { name: true } }) : null,
    e.departmentId ? peoplePrisma.department.findFirst({ where: { id: e.departmentId, orgId }, select: { headEmployeeId: true } }) : null,
    e.branchId ? platformPrisma.branch.findFirst({ where: { id: e.branchId, orgId }, select: { branchName: true } }) : null,
  ]);
  /* "Your department head" beside the manager (Organization): someone still here, and not the person themselves. */
  const head = dept?.headEmployeeId && dept.headEmployeeId !== e.id ? await peoplePrisma.employee.findFirst({ where: { id: dept.headEmployeeId, orgId, status: { not: 'LEFT' } }, select: { name: true } }) : null;
  const day = (v: unknown) => (typeof v === 'string' && ISO_DATE.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
  return {
    designation: e.designation ?? null,
    department: e.department ?? null,
    employmentType: type?.name ?? null,
    /* The notice owed on resigning, by employment type: the leaving form fills the last day from it. */
    noticeDays: type?.noticeDays ?? null,
    hours: e.hours === 'PART_TIME' ? 'Part-time' : 'Full-time',
    workMode: mode?.name ?? null,
    worksAt: branch?.branchName ?? null,
    manager: manager?.name ?? null,
    departmentHead: head?.name ?? null,
    joinedOn: day(e.dateOfJoining),
    probationEndsOn: e.confirmedOn ? null : day(e.probationEndDate),
    confirmedOn: day(e.confirmedOn),
    contractEndsOn: day(e.contractEndDate),
    lastDay: e.status === 'ON_NOTICE' ? day(e.dateOfLeaving) : null,
  };
}

/** The person's own details, as they may see and change them, their terms, and their requests. */
export async function myDetails(orgId: string, employeeId: string) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId } });
  if (!e) throw new SelfServiceError('No such person.', 404);
  const fields = Object.fromEntries(SELF_FIELDS.map((k) => [k, (e as any)[k] ?? null]));
  const [requests, terms, settings] = await Promise.all([myRequests(orgId, e), termsOf(orgId, e), settingsOf(e.accountId, orgId)]);
  const mode = settings.selfServiceChanges;
  const savesAtOnce = SELF_FIELDS.filter((k) => mode === 'NONE' || (mode === 'CONTACT_DIRECT' && CONTACT.has(k)));
  const waiting = requests.filter((r) => r.kind === 'PROFILE_CHANGE' && r.status === 'WAITING').map((r) => ({ id: r.id, title: r.title, fields: r.asked.map((a) => a.field), createdAt: r.createdAt }));
  return { fields, labels: SELF_FIELD_LABEL, hasPhoto: Boolean(e.photoUrl), savesAtOnce, hrDecidesWithinDays: settings.profileDecideDays, terms, requests, waiting };
}

/** Fields with a request still open (waiting, or asked for more): they cannot be asked about again until it is answered. */
async function openFields(orgId: string, employeeId: string) {
  const rows = await peoplePrisma.approvalRequest.findMany({ where: { orgId, subjectEmployeeId: employeeId, requestType: 'PROFILE_CHANGE', status: { in: OPEN } }, select: { payload: true } });
  return new Set(rows.flatMap((r) => Object.keys(((r.payload as any)?.fields) || {})));
}

/**
 * The person changes their own details. Contact details (or everything, by
 * the setting) save at once through the one write path with the person as
 * the actor; the rest becomes a PROFILE_CHANGE request, and so does a new
 * photo, always. Without a rule for that, a default one is made: HR decides
 * within three working days.
 */
export async function requestChange(who: { accountId: string; orgId: string; employeeId: string; userId: string | null; correlationId: string }, input: Record<string, unknown>) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: who.employeeId, orgId: who.orgId } });
  if (!e) throw new SelfServiceError('No such person.', 404);
  const userId = who.userId || e.userId || null;
  const changes: Partial<Record<SelfField, string | null>> = {};
  for (const k of SELF_FIELDS) {
    if (input[k] === undefined) continue;
    const v = cleanField(k, input[k]);
    if (((e as any)[k] ?? null) !== v) changes[k] = v;
  }
  let photo: string | null = null;
  if (input.photoUrl !== undefined && input.photoUrl !== null && input.photoUrl !== '') {
    photo = String(input.photoUrl);
    if (photo.length > PHOTO_MAX) throw new SelfServiceError('That photo is too large; use one under 200 KB.');
    if (!PHOTO.test(photo)) throw new SelfServiceError('A photo must be a JPEG, PNG or WebP picture.');
    if (photo === e.photoUrl) photo = null;
  }
  const keys = Object.keys(changes) as SelfField[];
  if (!keys.length && !photo) return { saved: [], requested: null, request: null };
  const { selfServiceChanges: mode } = await settingsOf(who.accountId, who.orgId);
  const direct = keys.filter((k) => mode === 'NONE' || (mode === 'CONTACT_DIRECT' && CONTACT.has(k)));
  const askHr: string[] = [...keys.filter((k) => !direct.includes(k)), ...(photo ? ['photoUrl'] : [])];
  /* E22: one open request per field. Checked before anything saves, so the answer is all or nothing. */
  if (askHr.length) {
    const open = await openFields(who.orgId, e.id);
    const clash = askHr.filter((k) => open.has(k));
    if (clash.length) throw new SelfServiceError(`You have already asked to change ${clash.map((k) => (LABEL[k] || k).toLowerCase()).join(', ')}. Wait for the answer, or withdraw that request first.`, 409);
  }
  const actor: Actor = { accountId: who.accountId, orgId: who.orgId, userId, source: 'SELF_SERVICE', correlationId: who.correlationId, reason: 'Changed by the person in the employee app' };
  const saved: string[] = [];
  if (direct.length) {
    const data: Record<string, unknown> = Object.fromEntries(direct.map((k) => [k, changes[k]]));
    if (data.firstName !== undefined || data.lastName !== undefined) data.name = [data.firstName ?? e.firstName, data.lastName ?? e.lastName].filter(Boolean).join(' ') || e.name;
    await updateEmployee(actor, e, data as any, {});
    saved.push(...direct);
    if (mode === 'NONE') await notifyPermission(who.accountId, who.orgId, 'PEOPLE::Employees::EDIT', { kind: 'people.self_change', title: `${e.name} changed their own details`, body: direct.map((k) => SELF_FIELD_LABEL[k]).join(', '), link: { app: 'people', screen: 'employees', params: { id: e.id } } as any }).catch(() => undefined);
  }
  if (!askHr.length) return { saved, requested: null, request: null };
  if (!(await activeRule(who.orgId, 'PROFILE_CHANGE'))) {
    await saveRule({ accountId: who.accountId, orgId: who.orgId, userId: null }, 'PROFILE_CHANGE', 'Profile changes (default: HR decides)', [{ order: 1, approver: { kind: 'HR' }, dueDays: DEFAULT_DUE_DAYS, overdue: { action: 'REMIND' } }]);
  }
  const fields: Record<string, { before: unknown; after: unknown }> = Object.fromEntries(askHr.filter((k) => k !== 'photoUrl').map((k) => [k, { before: (e as any)[k] ?? null, after: changes[k as SelfField] }]));
  const data: Record<string, unknown> = {};
  if (fields.firstName || fields.lastName) data.name = [changes.firstName ?? e.firstName, changes.lastName ?? e.lastName].filter(Boolean).join(' ');
  /* The picture travels in `data` (applied on approval); the fields line only says a new photo was asked for. */
  if (photo) {
    fields.photoUrl = { before: e.photoUrl ? 'Current photo' : null, after: 'New photo' };
    data.photoUrl = photo;
  }
  const r = await submitRequest({ ...actor, userId: userId || `${PORTAL_PREFIX}${who.employeeId}` }, {
    requestType: 'PROFILE_CHANGE', subjectEmployeeId: e.id, title: `${e.name}: ${askHr.map((k) => (LABEL[k] || k).toLowerCase()).join(', ')} change`,
    payload: { employeeId: e.id, fields, reason: 'Asked by the person in the employee app', data: Object.keys(data).length ? data : undefined, photoBefore: photo ? photoPrint(e.photoUrl) : undefined },
  });
  return { saved, requested: askHr, request: { id: r.request.id, status: r.request.status, title: r.request.title } };
}

/** One of my own requests, by the ids it may carry; anything else is not found. */
async function ownRequest(orgId: string, employeeId: string, requestId: string) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true, userId: true } });
  if (!e) throw new SelfServiceError('No such person.', 404);
  const r = await peoplePrisma.approvalRequest.findFirst({ where: { id: requestId, orgId, subjectEmployeeId: e.id, requesterUserId: { in: requesterIds(e) } }, select: { id: true, requesterUserId: true } });
  if (!r) throw new SelfServiceError('No such request.', 404);
  return r;
}

/** E5: the person answers a request for more information, from the app. */
export async function answerFromApp(who: { accountId: string; orgId: string; employeeId: string; correlationId: string }, requestId: string, note: string) {
  const text = String(note || '').trim();
  if (!text) throw new SelfServiceError('Write your answer.');
  const r = await ownRequest(who.orgId, who.employeeId, requestId);
  await reply({ accountId: who.accountId, orgId: who.orgId, userId: r.requesterUserId, source: 'SELF_SERVICE', correlationId: who.correlationId }, r.id, text);
  return { id: r.id, status: 'WAITING' };
}

/** E5: the person withdraws their own open request, from the app. */
export async function withdrawFromApp(who: { accountId: string; orgId: string; employeeId: string; correlationId: string }, requestId: string) {
  const r = await ownRequest(who.orgId, who.employeeId, requestId);
  const done = await withdraw({ accountId: who.accountId, orgId: who.orgId, userId: r.requesterUserId, source: 'SELF_SERVICE', correlationId: who.correlationId }, r.id);
  return { id: done.id, status: done.status };
}
