import { createHash, randomBytes } from 'node:crypto';
import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { platformPrisma } from '../../../utils/platformPrisma.js';
import { outsideTenant } from '../../../utils/tenantScope.js';
import { sendTemplate } from '../../mailer.js';
import { notifyUsers, usersWithPermission } from '../../notifications.js';
import { type Actor, writeChangeLog } from '../changeLog.js';
import { updateEmployee } from '../employees.js';
import { writeEvent } from '../outbox.js';
import { decodeDocument } from '../documentFiles.js';
import { NOMINEE_RELATIONS } from '../../payroll/statutoryWrite.js';
import { StatutoryError, parseStatutory, saveFromJoiner, summariesFor } from './joiningStatutory.js';

/**
 * Before day one (docs/people/02-PRD.md LIFE-01). HR invites someone who is
 * about to join; the link works once, runs out in fourteen days, and shows
 * the joiner only their own name and joining date. What they type and
 * upload is held on the invite as "sent, not checked" until HR checks it;
 * only then is it written to the record, through the one write path, with
 * the change log saying it came from the joiner and who checked it.
 */

export const INVITE_DAYS = 14;
export const INVITE_CHANNELS = ['EMAIL', 'SMS'] as const;
export const INVITE_STATUSES = ['SENT', 'STARTED', 'RETURNED', 'CHECKED', 'EXPIRED'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

/** What a joiner may fill in: their own personal details, nothing about their job. */
export const JOINER_FIELDS = [
  'personalEmail', 'phone', 'dateOfBirth', 'gender', 'maritalStatus',
  'addressLine', 'city', 'state', 'pincode', 'country',
  'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'guardianName',
] as const;
export type JoinerField = (typeof JOINER_FIELDS)[number];
export const JOINER_FIELD_LABEL: Record<JoinerField, string> = {
  personalEmail: 'Personal email', phone: 'Phone', dateOfBirth: 'Date of birth', gender: 'Gender', maritalStatus: 'Marital status',
  addressLine: 'Address', city: 'City', state: 'State', pincode: 'PIN code', country: 'Country',
  emergencyContactName: 'Emergency contact', emergencyContactPhone: 'Emergency contact phone', emergencyContactRelation: 'Relation', guardianName: 'Father’s / guardian’s name',
};
const JOINER_DOC_KINDS = new Set(['ID_PROOF', 'ADDRESS_PROOF', 'EDUCATION', 'CERTIFICATE', 'OTHER']);
const GENDERS = new Set(['MALE', 'FEMALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY']);
const MARITAL = new Set(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const APP_URL = () => process.env.APP_URL || 'http://localhost:5173';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class InviteError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type Submitted = { fields: Partial<Record<JoinerField, string | null>>; declarations: { accurate: boolean; policiesRead: boolean }; documentIds: string[] };

export const shapeInvite = (i: { id: string; employeeId: string; channel: string; sentTo: string; message: string | null; expiresAt: Date; status: string; submitted: unknown; startedAt: Date | null; returnedAt: Date | null; checkedByUserId: string | null; checkedAt: Date | null; sentByUserId: string | null; createdAt: Date }) => ({
  id: i.id, employeeId: i.employeeId, channel: i.channel, sentTo: i.sentTo, message: i.message, expiresAt: i.expiresAt, status: i.status,
  submitted: (i.submitted as Submitted | null) ?? null, startedAt: i.startedAt, returnedAt: i.returnedAt, checkedByUserId: i.checkedByUserId, checkedAt: i.checkedAt, sentByUserId: i.sentByUserId, createdAt: i.createdAt,
});

/** Send an invite. Any earlier live invite for the person stops working. The link comes back only for SMS, which HR sends by hand. */
export async function createInvite(actor: Actor, employeeId: string, input: { channel?: string; sentTo?: string; message?: string | null }) {
  const channel = String(input.channel || 'EMAIL').toUpperCase();
  if (!INVITE_CHANNELS.includes(channel as any)) throw new InviteError('Send by email or by phone.');
  const sentTo = String(input.sentTo || '').trim();
  if (channel === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sentTo)) throw new InviteError('That is not an email address.');
  if (channel === 'SMS' && sentTo.replace(/\D/g, '').length < 10) throw new InviteError('That is not a phone number.');
  const employee = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId: actor.orgId }, select: { id: true, name: true, code: true, status: true, dateOfJoining: true } });
  if (!employee) throw new InviteError('No such employee.', 404);
  if (employee.status === 'LEFT') throw new InviteError('This person has left.', 409);
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const message = String(input.message || '').trim().slice(0, 2000) || null;
  const invite = await peoplePrisma.$transaction(async (tx) => {
    await tx.joinInvite.updateMany({ where: { orgId: actor.orgId, employeeId, status: { in: ['SENT', 'STARTED'] } }, data: { status: 'EXPIRED' } });
    const row = await tx.joinInvite.create({ data: { accountId: actor.accountId, orgId: actor.orgId, employeeId, tokenHash: sha256(token), channel, sentTo, message, expiresAt, sentByUserId: actor.userId } });
    await writeChangeLog(tx, actor, { kind: 'Employee', id: employeeId, employeeId }, [{ field: 'invite', before: null, after: `sent by ${channel.toLowerCase()} to ${sentTo}`, redacted: false }]);
    await writeEvent(tx, actor, 'people.invite.sent.v1', { inviteId: row.id, channel, expiresAt: expiresAt.toISOString(), employee: { id: employee.id, code: employee.code, name: employee.name } }, employeeId);
    return row;
  });
  const link = `${APP_URL()}/api/people/join/${token}`;
  if (channel === 'EMAIL') {
    const org = await platformPrisma.org.findUnique({ where: { id: actor.orgId }, select: { name: true } });
    await sendTemplate({
      templateKey: 'people.join_invite', to: sentTo, toName: employee.name, accountId: actor.accountId, orgId: actor.orgId, relatedType: 'JoinInvite', relatedId: invite.id,
      data: { name: employee.name, orgName: org?.name || '', joiningDate: employee.dateOfJoining || 'your joining date', link, expiresOn: expiresAt.toISOString().slice(0, 10), message: message ? `\nFrom HR: ${message}\n` : '' },
    }).catch(() => undefined);
  }
  return { invite: shapeInvite(invite), link: channel === 'SMS' ? link : null };
}

/**
 * The invite behind a link, looked up outside any company. The caller enters
 * the invite's company itself (`enterTenant` binds the caller's own async
 * context, so it cannot be done from in here) and then asks `expireIfDue`.
 */
export async function findInviteByToken(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return outsideTenant('join link: find the invite', () => peoplePrisma.joinInvite.findUnique({ where: { tokenHash: sha256(token) } }));
}

/** A live invite past its date is marked EXPIRED the moment it is seen. */
export async function expireIfDue<T extends { id: string; status: string; expiresAt: Date }>(row: T): Promise<T> {
  if ((row.status === 'SENT' || row.status === 'STARTED') && row.expiresAt < new Date()) {
    return (await peoplePrisma.joinInvite.update({ where: { id: row.id }, data: { status: 'EXPIRED' } })) as unknown as T;
  }
  return row;
}

/** What the joiner sees: their own name and joining date, the company, HR's note — nothing else. */
export async function joinerView(invite: { id: string; orgId: string; employeeId: string; status: string; expiresAt: Date; message: string | null }) {
  const [employee, org] = await Promise.all([
    peoplePrisma.employee.findFirst({ where: { id: invite.employeeId, orgId: invite.orgId }, select: { name: true, code: true, dateOfJoining: true, designation: true } }),
    platformPrisma.org.findUnique({ where: { id: invite.orgId }, select: { name: true } }),
  ]);
  if (invite.status === 'SENT') await peoplePrisma.joinInvite.update({ where: { id: invite.id }, data: { status: 'STARTED', startedAt: new Date() } });
  return {
    status: invite.status === 'SENT' ? 'STARTED' : invite.status, expiresAt: invite.expiresAt, message: invite.message,
    orgName: org?.name || '', name: employee?.name || '', code: employee?.code || null, dateOfJoining: employee?.dateOfJoining || null, designation: employee?.designation || null,
    fields: JOINER_FIELDS.map((k) => ({ key: k, label: JOINER_FIELD_LABEL[k] })),
    documentKinds: [...JOINER_DOC_KINDS],
    /* PAN, UAN, ESIC, bank and PF nominees: checked by HR before they reach Payroll (joiningStatutory.ts). */
    statutory: { fields: ['pan', 'uan', 'esicNumber', 'bankAccountName', 'bankAccountNumber', 'bankIfsc', 'bankName'], nomineeRelations: [...NOMINEE_RELATIONS] },
  };
}

/** The joiner sends their details: held on the invite until HR checks; their documents go on the record at once, marked as theirs. */
export async function submitInvite(invite: { id: string; accountId: string; orgId: string; employeeId: string; status: string; expiresAt: Date }, body: Record<string, unknown>) {
  if (invite.status === 'RETURNED' || invite.status === 'CHECKED') throw new InviteError('These details were already sent. HR will be in touch if anything is missing.', 410);
  if (invite.status === 'EXPIRED' || invite.expiresAt < new Date()) throw new InviteError('This link has run out. Ask HR for a new one.', 410);
  const fields: Partial<Record<JoinerField, string | null>> = {};
  const raw = (body.fields && typeof body.fields === 'object' ? body.fields : {}) as Record<string, unknown>;
  for (const k of JOINER_FIELDS) {
    if (raw[k] === undefined) continue;
    let v: string | null = String(raw[k] ?? '').trim().slice(0, 200) || null;
    if (k === 'personalEmail' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new InviteError('That is not an email address.');
    if (k === 'dateOfBirth' && v && !ISO_DATE.test(v)) throw new InviteError('Dates are YYYY-MM-DD.');
    if (k === 'gender' && v) { v = v.toUpperCase(); if (!GENDERS.has(v)) throw new InviteError('Gender is male, female, non-binary, other, or prefer not to say.'); }
    if (k === 'maritalStatus' && v) { v = v.toUpperCase(); if (!MARITAL.has(v)) throw new InviteError('Marital status is single, married, divorced or widowed.'); }
    if (k === 'pincode' && v && !/^\d{6}$/.test(v)) throw new InviteError('A PIN code is six digits.');
    fields[k] = v;
  }
  const decl = (body.declarations && typeof body.declarations === 'object' ? body.declarations : {}) as Record<string, unknown>;
  if (decl.accurate !== true) throw new InviteError('Tick the declaration that these details are true and complete.');
  const declarations = { accurate: true, policiesRead: decl.policiesRead === true };
  const docs = Array.isArray(body.documents) ? body.documents.slice(0, 10) : [];
  const files: Array<{ kind: string; title: string; mime: string; data: Buffer }> = [];
  for (const d of docs as Array<Record<string, unknown>>) {
    const kind = String(d?.kind || 'OTHER').toUpperCase();
    if (!JOINER_DOC_KINDS.has(kind)) throw new InviteError('Unknown document kind.');
    const title = String(d?.title || '').trim().slice(0, 120);
    if (!title) throw new InviteError('Name each document.');
    const file = decodeDocument(d?.data, d?.mime);
    if ('error' in file) throw new InviteError(file.error);
    files.push({ kind, title, mime: file.mime, data: file.data });
  }
  let statutory: ReturnType<typeof parseStatutory> = null;
  try {
    statutory = parseStatutory(body.statutory);
  } catch (e) {
    if (e instanceof StatutoryError) throw new InviteError(e.message, e.status);
    throw e;
  }
  const actor = { accountId: invite.accountId, orgId: invite.orgId, correlationId: `invite_${invite.id}` };
  const result = await peoplePrisma.$transaction(async (tx) => {
    const documentIds: string[] = [];
    for (const f of files) {
      const row = await tx.employeeDocument.create({ data: { accountId: invite.accountId, orgId: invite.orgId, employeeId: invite.employeeId, kind: f.kind, title: f.title, mime: f.mime, size: f.data.length, data: f.data, classification: 'EMPLOYEE_VISIBLE', visibleToEmployee: true, uploadedByUserId: 'JOINER' }, select: { id: true } });
      documentIds.push(row.id);
    }
    /* Held apart from the invite, so its plain values never travel with a list of invites. */
    if (statutory) await saveFromJoiner(tx, invite, statutory);
    const submitted: Submitted = { fields, declarations, documentIds };
    const row = await tx.joinInvite.update({ where: { id: invite.id }, data: { status: 'RETURNED', returnedAt: new Date(), submitted: submitted as any } });
    await writeEvent(tx, actor, 'people.invite.returned.v1', { inviteId: invite.id, fields: Object.keys(fields), documents: documentIds.length, statutory: Boolean(statutory) }, invite.employeeId);
    return row;
  });
  try {
    const employee = await peoplePrisma.employee.findFirst({ where: { id: invite.employeeId }, select: { name: true } });
    const hr = await usersWithPermission(invite.accountId, invite.orgId, 'PEOPLE::Lifecycle::EDIT');
    await notifyUsers(invite.accountId, invite.orgId, hr, { kind: 'people.invite', title: `${employee?.name || 'A joiner'} sent their joining details`, body: `${Object.keys(fields).length} details and ${files.length} document${files.length === 1 ? '' : 's'}: check them on the record before day one.`, link: { app: 'people', screen: 'employees', params: { id: invite.employeeId } } as any });
  } catch (e) {
    console.error('[invites] tell HR:', e instanceof Error ? e.message : e);
  }
  return shapeInvite(result);
}

/** HR checks what was sent, with any corrections, and it goes on the record through the one write path. */
export async function checkInvite(actor: Actor, inviteId: string, overrides: Record<string, unknown> = {}) {
  const invite = await peoplePrisma.joinInvite.findFirst({ where: { id: inviteId, orgId: actor.orgId } });
  if (!invite) throw new InviteError('No such invite.', 404);
  if (invite.status !== 'RETURNED') throw new InviteError(invite.status === 'CHECKED' ? 'Already checked.' : 'Nothing has been sent on this invite yet.', 409);
  const submitted = (invite.submitted as Submitted | null) || { fields: {}, declarations: { accurate: false, policiesRead: false }, documentIds: [] };
  const data: Record<string, string | null> = {};
  for (const k of JOINER_FIELDS) {
    const v = overrides[k] !== undefined ? overrides[k] : submitted.fields[k];
    if (v === undefined) continue;
    data[k] = v === null || v === '' ? null : String(v).trim().slice(0, 200);
  }
  const employee = await peoplePrisma.employee.findFirst({ where: { id: invite.employeeId, orgId: actor.orgId } });
  if (!employee) throw new InviteError('The person is no longer here.', 409);
  const { changes } = await updateEmployee({ ...actor, source: 'SELF_SERVICE', reason: actor.reason || 'Joining details sent by the person, checked by HR' }, employee, data as any, {});
  const row = await peoplePrisma.joinInvite.update({ where: { id: invite.id }, data: { status: 'CHECKED', checkedAt: new Date(), checkedByUserId: actor.userId } });
  return { invite: shapeInvite(row), applied: changes.map((c) => c.field) };
}

export async function invitesOf(orgId: string, where: { employeeId?: string; status?: string } = {}) {
  const rows = await peoplePrisma.joinInvite.findMany({ where: { orgId, ...(where.employeeId ? { employeeId: where.employeeId } : {}), ...(where.status ? { status: where.status } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, name: true, code: true, dateOfJoining: true } });
  const of = new Map(people.map((p) => [p.id, p]));
  const statutory = await summariesFor(orgId, rows.map((r) => r.id));
  return rows.map((r) => ({ ...shapeInvite(r), statutory: statutory.get(r.id) ?? null, employeeName: of.get(r.employeeId)?.name || '', employeeCode: of.get(r.employeeId)?.code || null, dateOfJoining: of.get(r.employeeId)?.dateOfJoining || null }));
}
