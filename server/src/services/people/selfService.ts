import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { notifyPermission } from '../notifications.js';
import type { Actor } from './changeLog.js';
import { updateEmployee } from './employees.js';
import { activeRule, saveRule, submitRequest } from './approvals/engine.js';

/**
 * Personal details from the employee app (docs/people/02-PRD.md CORE-03;
 * decision D-02). The company setting says what saves at once and what
 * waits for HR: by default contact details save directly and the rest —
 * name, address, date of birth, gender, marital status — becomes a
 * PROFILE_CHANGE request. Every path is logged; a saved change says it came
 * from the person, an approved one carries the request.
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
  dateOfBirth: 'Date of birth', gender: 'Gender', maritalStatus: 'Marital status', emergencyContactName: 'Emergency contact', emergencyContactPhone: 'Emergency contact phone', emergencyContactRelation: 'Emergency contact relation', guardianName: 'Father’s / guardian’s name',
};
const GENDERS = new Set(['MALE', 'FEMALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY']);
const MARITAL = new Set(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SelfServiceError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function settingsOf(accountId: string, orgId: string) {
  const row = await peoplePrisma.peopleSetting.findUnique({ where: { orgId } });
  return { selfServiceChanges: (row?.selfServiceChanges as SelfServiceMode) || 'CONTACT_DIRECT', modes: SELF_SERVICE_MODES.map((m) => ({ key: m, label: MODE_WORDS[m] })), accountId };
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

/** The person's own details, as they may see and change them. */
export async function myDetails(orgId: string, employeeId: string) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId } });
  if (!e) throw new SelfServiceError('No such person.', 404);
  const fields = Object.fromEntries(SELF_FIELDS.map((k) => [k, (e as any)[k] ?? null]));
  const waiting = await peoplePrisma.approvalRequest.findMany({ where: { orgId, subjectEmployeeId: employeeId, requestType: 'PROFILE_CHANGE', status: 'WAITING' }, select: { id: true, title: true, payload: true, createdAt: true } });
  return { fields, labels: SELF_FIELD_LABEL, waiting: waiting.map((w) => ({ id: w.id, title: w.title, fields: Object.keys(((w.payload as any)?.fields) || {}), createdAt: w.createdAt })) };
}

/**
 * The person changes their own details. Contact details (or everything, by
 * the setting) save at once through the one write path with the person as
 * the actor; the rest becomes a PROFILE_CHANGE request. Without a rule for
 * that, a default one is made: HR decides within three days.
 */
export async function requestChange(who: { accountId: string; orgId: string; employeeId: string; userId: string | null; correlationId: string }, input: Record<string, unknown>) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: who.employeeId, orgId: who.orgId } });
  if (!e) throw new SelfServiceError('No such person.', 404);
  const changes: Partial<Record<SelfField, string | null>> = {};
  for (const k of SELF_FIELDS) {
    if (input[k] === undefined) continue;
    const v = cleanField(k, input[k]);
    if (((e as any)[k] ?? null) !== v) changes[k] = v;
  }
  const keys = Object.keys(changes) as SelfField[];
  if (!keys.length) return { saved: [], requested: null, request: null };
  const { selfServiceChanges: mode } = await settingsOf(who.accountId, who.orgId);
  const direct = keys.filter((k) => mode === 'NONE' || (mode === 'CONTACT_DIRECT' && CONTACT.has(k)));
  const askHr = keys.filter((k) => !direct.includes(k));
  const actor: Actor = { accountId: who.accountId, orgId: who.orgId, userId: who.userId, source: 'SELF_SERVICE', correlationId: who.correlationId, reason: 'Changed by the person in the employee app' };
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
    await saveRule({ accountId: who.accountId, orgId: who.orgId, userId: null }, 'PROFILE_CHANGE', 'Profile changes (default: HR decides)', [{ order: 1, approver: { kind: 'HR' }, dueDays: 3, overdue: { action: 'REMIND' } }]);
  }
  const fields = Object.fromEntries(askHr.map((k) => [k, { before: (e as any)[k] ?? null, after: changes[k] }]));
  const r = await submitRequest({ ...actor, userId: who.userId || `portal:${who.employeeId}` }, {
    requestType: 'PROFILE_CHANGE', subjectEmployeeId: e.id, title: `${e.name}: ${askHr.map((k) => SELF_FIELD_LABEL[k].toLowerCase()).join(', ')} change`,
    payload: { employeeId: e.id, fields, reason: 'Asked by the person in the employee app', data: fields.firstName || fields.lastName ? { name: [changes.firstName ?? e.firstName, changes.lastName ?? e.lastName].filter(Boolean).join(' ') } : undefined },
  });
  return { saved, requested: askHr, request: { id: r.request.id, status: r.request.status, title: r.request.title } };
}
