import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../../utils/tenantScope.js';
import { notifyPermission, notifyUsers, usersWithPermission } from '../notifications.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { decodeDocument } from './documentFiles.js';
import { inForce } from './policies.js';

/**
 * Help desk (docs/people/02-PRD.md DESK-01..06). An employee raises a
 * request from the app; it lands in a queue by category with a reply-by
 * and a resolve-by; HR answers in a thread where internal notes never
 * reach the employee; overdue goes to the queue lead; resolved with a
 * reason, reopened within seven days; moved to Private cases, the copy
 * here shrinks to the date it moved; a template answer cites the policy
 * version in force.
 */

export const URGENCIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const REPLY_CHANNELS = ['APP', 'EMAIL', 'PHONE'] as const;
export const DESK_STATUSES = ['OPEN', 'WAITING_EMPLOYEE', 'RESOLVED', 'REOPENED', 'MOVED'] as const;
export const REOPEN_DAYS = 7;
const DESK_GRANT = 'PEOPLE::HR Cases::VIEW';

/** What a company starts with; editable under Settings → Help desk. */
export const DEFAULT_CATEGORIES = [
  { key: 'PAYROLL', label: 'Pay and payslips', queue: 'Payroll', replyHours: 24, resolveDays: 3 },
  { key: 'LEAVE', label: 'Leave and attendance', queue: 'HR', replyHours: 24, resolveDays: 2 },
  { key: 'DOCUMENTS', label: 'Letters and documents', queue: 'HR', replyHours: 24, resolveDays: 5 },
  { key: 'POLICY', label: 'A policy question', queue: 'HR', replyHours: 24, resolveDays: 3 },
  { key: 'IT', label: 'Laptop, access and tools', queue: 'IT', replyHours: 8, resolveDays: 2 },
  { key: 'FACILITIES', label: 'Office and facilities', queue: 'Admin', replyHours: 24, resolveDays: 5 },
  { key: 'OTHER', label: 'Something else', queue: 'HR', replyHours: 24, resolveDays: 5 },
] as const;

export class DeskError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type Who = { accountId: string; orgId: string; userId: string | null };

/** Working days skip Saturday and Sunday; company holidays are the next step. */
export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const ist = new Date(d.getTime() + 330 * 60_000).getUTCDay();
    if (ist !== 0 && ist !== 6) left -= 1;
  }
  return d;
}

export async function categoriesOf(accountId: string, orgId: string) {
  const have = await peoplePrisma.deskCategory.findMany({ where: { orgId }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
  if (have.length) return have;
  await peoplePrisma.deskCategory.createMany({ data: DEFAULT_CATEGORIES.map((c, i) => ({ accountId, orgId, key: c.key, label: c.label, queue: c.queue, replyHours: c.replyHours, resolveDays: c.resolveDays, sortOrder: i })), skipDuplicates: true });
  return peoplePrisma.deskCategory.findMany({ where: { orgId }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
}

export async function saveCategory(who: Who, key: string, input: { label?: string; queue?: string; leadUserId?: string | null; replyHours?: number; resolveDays?: number; isActive?: boolean }) {
  const cats = await categoriesOf(who.accountId, who.orgId);
  const k = String(key || '').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 40);
  if (!k) throw new DeskError('A category needs a key.');
  const existing = cats.find((c) => c.key === k);
  const data: Record<string, unknown> = {};
  if (input.label !== undefined) { const l = String(input.label || '').trim().slice(0, 80); if (!l) throw new DeskError('Name the category.'); data.label = l; }
  if (input.queue !== undefined) { const q = String(input.queue || '').trim().slice(0, 60); if (!q) throw new DeskError('Name the queue.'); data.queue = q; }
  if (input.leadUserId !== undefined) {
    const id = String(input.leadUserId || '').trim() || null;
    if (id && !(await platformPrisma.user.findUnique({ where: { id }, select: { id: true } }))) throw new DeskError('That lead is not a user here.');
    data.leadUserId = id;
  }
  if (input.replyHours !== undefined) { const n = Number(input.replyHours); if (!Number.isInteger(n) || n < 1 || n > 720) throw new DeskError('Reply within 1 to 720 hours.'); data.replyHours = n; }
  if (input.resolveDays !== undefined) { const n = Number(input.resolveDays); if (!Number.isInteger(n) || n < 1 || n > 90) throw new DeskError('Resolve within 1 to 90 working days.'); data.resolveDays = n; }
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
  if (existing) return peoplePrisma.deskCategory.update({ where: { id: existing.id }, data });
  if (!data.label || !data.queue) throw new DeskError('A new category needs a name and a queue.');
  return peoplePrisma.deskCategory.create({ data: { accountId: who.accountId, orgId: who.orgId, key: k, label: data.label as string, queue: data.queue as string, leadUserId: (data.leadUserId as string | null) ?? null, replyHours: (data.replyHours as number) ?? 24, resolveDays: (data.resolveDays as number) ?? 3, sortOrder: cats.length } });
}

const shapeMessage = (m: { id: string; authorUserId: string | null; authorEmployeeId: string | null; body: string; internal: boolean; attachmentDocId: string | null; templateId: string | null; policyVersionId: string | null; createdAt: Date }, names: Map<string, string>) => ({
  id: m.id, from: m.authorEmployeeId ? 'EMPLOYEE' : 'HR', authorName: m.authorUserId ? names.get(m.authorUserId) || 'HR' : names.get(`e:${m.authorEmployeeId}`) || 'Employee',
  body: m.body, internal: m.internal, attachmentDocId: m.attachmentDocId, templateId: m.templateId, policyVersionId: m.policyVersionId, createdAt: m.createdAt,
});

const shapeRequest = (r: any, now = new Date()) => ({
  id: r.id, employeeId: r.employeeId, employeeName: r.employee?.name || '', employeeCode: r.employee?.code || null,
  category: r.category, subject: r.subject, description: r.description, urgency: r.urgency, replyChannel: r.replyChannel,
  assigneeUserId: r.assigneeUserId, queue: r.queue, replyBy: r.replyBy, resolveBy: r.resolveBy, firstReplyAt: r.firstReplyAt, status: r.status,
  replyOverdue: !r.firstReplyAt && ['OPEN', 'REOPENED'].includes(r.status) && r.replyBy < now,
  resolveOverdue: ['OPEN', 'REOPENED', 'WAITING_EMPLOYEE'].includes(r.status) && r.resolveBy < now,
  resolution: r.resolution, resolvedAt: r.resolvedAt, reopenedAt: r.reopenedAt, movedToCaseAt: r.movedToCaseAt, movedToCaseId: r.movedToCaseId, changeRef: r.changeRef ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt,
});

/** The employee raises a request (DESK-01); HR may raise one on their behalf. */
export async function raiseRequest(who: Who & { employeeId?: string | null }, employeeId: string, input: { category?: string; subject?: string; description?: string; urgency?: string; replyChannel?: string | null; changeRef?: string | null; attachment?: { title?: string; data?: unknown; mime?: unknown } | null }) {
  const cats = await categoriesOf(who.accountId, who.orgId);
  const cat = cats.find((c) => c.key === String(input.category || '').toUpperCase() && c.isActive) || cats.find((c) => c.key === 'OTHER') || cats[0];
  if (!cat) throw new DeskError('The help desk has no categories yet.');
  const subject = String(input.subject || '').trim().slice(0, 200);
  const description = String(input.description || '').trim().slice(0, 5000);
  if (!subject) throw new DeskError('Say in a few words what it is about.');
  if (description.length < 5) throw new DeskError('Tell HR what happened.');
  const urgency = String(input.urgency || 'NORMAL').toUpperCase();
  if (!URGENCIES.includes(urgency as any)) throw new DeskError('Urgency is low, normal, high or urgent.');
  const replyChannel = input.replyChannel ? String(input.replyChannel).toUpperCase() : null;
  if (replyChannel && !REPLY_CHANNELS.includes(replyChannel as any)) throw new DeskError('Reply by app, email or phone.');
  const employee = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId: who.orgId }, select: { id: true, name: true, code: true, status: true } });
  if (!employee || employee.status === 'LEFT') throw new DeskError('No such employee.', 404);
  const open = await peoplePrisma.deskRequest.count({ where: { orgId: who.orgId, employeeId, status: { in: ['OPEN', 'REOPENED', 'WAITING_EMPLOYEE'] } } });
  if (open >= 10) throw new DeskError('You have ten requests open already. Wait for an answer first.', 429);
  let attachmentDocId: string | null = null;
  if (input.attachment?.data) {
    const file = decodeDocument(input.attachment.data, input.attachment.mime);
    if ('error' in file) throw new DeskError(file.error);
    const doc = await peoplePrisma.employeeDocument.create({ data: { accountId: who.accountId, orgId: who.orgId, employeeId, kind: 'OTHER', title: String(input.attachment.title || subject).trim().slice(0, 120) || subject, mime: file.mime, size: file.data.length, data: file.data, classification: 'EMPLOYEE_VISIBLE', visibleToEmployee: true, uploadedByUserId: who.userId || 'EMPLOYEE' }, select: { id: true } });
    attachmentDocId = doc.id;
  }
  const now = new Date();
  const row = await peoplePrisma.deskRequest.create({
    data: {
      accountId: who.accountId, orgId: who.orgId, employeeId, category: cat.key, subject, description, urgency, replyChannel, queue: cat.queue, changeRef: input.changeRef ? String(input.changeRef).slice(0, 120) : null,
      replyBy: new Date(now.getTime() + cat.replyHours * 3_600_000), resolveBy: addWorkingDays(now, cat.resolveDays), raisedByUserId: who.userId,
      ...(attachmentDocId ? { messages: { create: { accountId: who.accountId, orgId: who.orgId, authorEmployeeId: employeeId, body: 'Attachment', attachmentDocId } } } : {}),
    },
    include: { employee: { select: { name: true, code: true } } },
  });
  const notice = { kind: 'people.desk', title: `${employee.name}${employee.code ? ` (${employee.code})` : ''} asked ${cat.queue}: ${subject}`, body: description.slice(0, 300), link: { app: 'people', screen: 'helpdesk', params: { id: row.id } } as any };
  if (cat.leadUserId) await notifyUsers(who.accountId, who.orgId, [cat.leadUserId], notice).catch(() => undefined);
  await notifyPermission(who.accountId, who.orgId, DESK_GRANT, notice, { except: cat.leadUserId }).catch(() => undefined);
  return shapeRequest(row, now);
}

export async function listRequests(orgId: string, where: { status?: string; queue?: string; assigneeUserId?: string; employeeId?: string; q?: string } = {}) {
  const status = where.status ? (where.status === 'OPEN' ? { in: ['OPEN', 'REOPENED', 'WAITING_EMPLOYEE'] } : where.status) : undefined;
  const q = String(where.q || '').trim();
  const rows = await peoplePrisma.deskRequest.findMany({
    where: { orgId, ...(status ? { status } : {}), ...(where.queue ? { queue: where.queue } : {}), ...(where.assigneeUserId ? { assigneeUserId: where.assigneeUserId } : {}), ...(where.employeeId ? { employeeId: where.employeeId } : {}), ...(q ? { OR: [{ subject: { contains: q, mode: 'insensitive' } }, { employee: { name: { contains: q, mode: 'insensitive' } } }] } : {}) },
    include: { employee: { select: { name: true, code: true } } }, orderBy: [{ resolveBy: 'asc' }], take: 500,
  });
  const now = new Date();
  return rows.map((r) => shapeRequest(r, now));
}

async function namesFor(orgId: string, msgs: Array<{ authorUserId: string | null; authorEmployeeId: string | null }>, extraUserIds: Array<string | null> = []) {
  const userIds = [...new Set([...msgs.map((m) => m.authorUserId), ...extraUserIds].filter((x): x is string => Boolean(x)))];
  const empIds = [...new Set(msgs.map((m) => m.authorEmployeeId).filter((x): x is string => Boolean(x)))];
  const [users, emps] = await Promise.all([
    userIds.length ? platformPrisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [],
    empIds.length ? peoplePrisma.employee.findMany({ where: { orgId, id: { in: empIds } }, select: { id: true, name: true } }) : [],
  ]);
  const names = new Map<string, string>();
  for (const u of users) names.set(u.id, u.fullName);
  for (const e of emps) names.set(`e:${e.id}`, e.name);
  return names;
}

/** The request with its thread; for the employee, internal notes are left out (DESK-02) and a moved request shows only its date. */
export async function requestDetail(orgId: string, id: string, opts: { forEmployeeId?: string | null } = {}) {
  const r = await peoplePrisma.deskRequest.findFirst({ where: { id, orgId, ...(opts.forEmployeeId ? { employeeId: opts.forEmployeeId } : {}) }, include: { employee: { select: { name: true, code: true } }, messages: { orderBy: { createdAt: 'asc' } } } });
  if (!r) throw new DeskError('No such request.', 404);
  const msgs = opts.forEmployeeId ? r.messages.filter((m) => !m.internal) : r.messages;
  const names = await namesFor(orgId, msgs, [r.assigneeUserId, r.resolvedByUserId]);
  return { ...shapeRequest(r), assigneeName: r.assigneeUserId ? names.get(r.assigneeUserId) || '' : '', messages: msgs.map((m) => shapeMessage(m, names)) };
}

/** HR answers, notes internally, or inserts a template (DESK-06). The first answer the employee can see stops the reply clock. */
export async function addMessage(who: Who, id: string, input: { body?: string; internal?: boolean; templateId?: string | null; attachment?: { title?: string; data?: unknown; mime?: unknown } | null; waitForEmployee?: boolean }) {
  const r = await peoplePrisma.deskRequest.findFirst({ where: { id, orgId: who.orgId }, include: { employee: { select: { userId: true, name: true } } } });
  if (!r) throw new DeskError('No such request.', 404);
  if (r.status === 'MOVED') throw new DeskError('This request was moved to Private cases.', 409);
  let body = String(input.body || '').trim().slice(0, 10_000);
  let policyVersionId: string | null = null;
  let templateId: string | null = null;
  if (input.templateId) {
    const t = await peoplePrisma.deskTemplate.findFirst({ where: { id: String(input.templateId), orgId: who.orgId, isActive: true } });
    if (!t) throw new DeskError('No such template.', 404);
    templateId = t.id;
    let citation = '';
    if (t.policyId) {
      const p = await peoplePrisma.policy.findFirst({ where: { id: t.policyId, orgId: who.orgId }, include: { versions: { where: { status: { in: ['PUBLISHED', 'RETIRED'] } } } } });
      const v = p ? inForce(p.versions) : null;
      if (p && v) { policyVersionId = v.id; citation = `\n\nPolicy: ${p.title}, version ${v.version}, in force from ${v.effectiveFrom}.`; }
    }
    body = `${t.body}${citation}${body ? `\n\n${body}` : ''}`;
  }
  if (!body && !input.attachment?.data) throw new DeskError('Write something.');
  let attachmentDocId: string | null = null;
  if (input.attachment?.data) {
    const file = decodeDocument(input.attachment.data, input.attachment.mime);
    if ('error' in file) throw new DeskError(file.error);
    const doc = await peoplePrisma.employeeDocument.create({ data: { accountId: who.accountId, orgId: who.orgId, employeeId: r.employeeId, kind: 'OTHER', title: String(input.attachment.title || r.subject).trim().slice(0, 120), mime: file.mime, size: file.data.length, data: file.data, classification: input.internal ? 'HR_ONLY' : 'EMPLOYEE_VISIBLE', visibleToEmployee: !input.internal, uploadedByUserId: who.userId || 'CLOR' }, select: { id: true } });
    attachmentDocId = doc.id;
  }
  const internal = Boolean(input.internal);
  const m = await peoplePrisma.deskMessage.create({ data: { accountId: who.accountId, orgId: who.orgId, requestId: r.id, authorUserId: who.userId, body: body || 'Attachment', internal, attachmentDocId, templateId, policyVersionId } });
  if (!internal) {
    await peoplePrisma.deskRequest.update({ where: { id: r.id }, data: { ...(r.firstReplyAt ? {} : { firstReplyAt: new Date() }), ...(input.waitForEmployee && ['OPEN', 'REOPENED'].includes(r.status) ? { status: 'WAITING_EMPLOYEE' } : {}) } });
    if (r.employee.userId) await notifyUsers(who.accountId, who.orgId, [r.employee.userId], { kind: 'people.desk', title: `HR replied: ${r.subject}`, body: body.slice(0, 300), link: { app: 'people', screen: 'overview' } as any }).catch(() => undefined);
  }
  const names = await namesFor(who.orgId, [m]);
  return shapeMessage(m, names);
}

/** The employee replies; a request waiting on them goes back to the queue. */
export async function employeeReply(who: Who, employeeId: string, id: string, input: { body?: string; attachment?: { title?: string; data?: unknown; mime?: unknown } | null }) {
  const r = await peoplePrisma.deskRequest.findFirst({ where: { id, orgId: who.orgId, employeeId } });
  if (!r) throw new DeskError('No such request.', 404);
  if (r.status === 'MOVED') throw new DeskError('This request has moved; HR will be in touch.', 409);
  if (r.status === 'RESOLVED') throw new DeskError('This was resolved. Reopen it to say more.', 409);
  const body = String(input.body || '').trim().slice(0, 5000);
  if (!body) throw new DeskError('Write something.');
  const m = await peoplePrisma.deskMessage.create({ data: { accountId: who.accountId, orgId: who.orgId, requestId: r.id, authorEmployeeId: employeeId, body } });
  if (r.status === 'WAITING_EMPLOYEE') await peoplePrisma.deskRequest.update({ where: { id: r.id }, data: { status: 'OPEN' } });
  if (r.assigneeUserId) await notifyUsers(who.accountId, who.orgId, [r.assigneeUserId], { kind: 'people.desk', title: `Reply on: ${r.subject}`, body: body.slice(0, 300), link: { app: 'people', screen: 'helpdesk', params: { id: r.id } } as any }).catch(() => undefined);
  const names = await namesFor(who.orgId, [m]);
  return shapeMessage(m, names);
}

export async function assignRequest(who: Who, id: string, input: { assigneeUserId?: string | null; queue?: string | null }) {
  const r = await peoplePrisma.deskRequest.findFirst({ where: { id, orgId: who.orgId } });
  if (!r) throw new DeskError('No such request.', 404);
  const data: Record<string, unknown> = {};
  if (input.assigneeUserId !== undefined) {
    const uid = String(input.assigneeUserId || '').trim() || null;
    if (uid && !(await platformPrisma.user.findUnique({ where: { id: uid }, select: { id: true } }))) throw new DeskError('That person is not a user here.');
    data.assigneeUserId = uid;
    if (uid && uid !== who.userId) await notifyUsers(who.accountId, who.orgId, [uid], { kind: 'people.desk', title: `Assigned to you: ${r.subject}`, body: `Resolve by ${r.resolveBy.toISOString().slice(0, 10)}.`, link: { app: 'people', screen: 'helpdesk', params: { id: r.id } } as any }).catch(() => undefined);
  }
  if (input.queue !== undefined) { const q = String(input.queue || '').trim().slice(0, 60); if (!q) throw new DeskError('Name the queue.'); data.queue = q; }
  const row = await peoplePrisma.deskRequest.update({ where: { id: r.id }, data, include: { employee: { select: { name: true, code: true } } } });
  return shapeRequest(row);
}

/** Resolved, with a reason the employee reads (DESK-04). */
export async function resolveRequest(who: Who, id: string, input: { resolution?: string }) {
  const r = await peoplePrisma.deskRequest.findFirst({ where: { id, orgId: who.orgId }, include: { employee: { select: { userId: true } } } });
  if (!r) throw new DeskError('No such request.', 404);
  if (r.status === 'MOVED') throw new DeskError('This request was moved to Private cases.', 409);
  const resolution = String(input.resolution || '').trim().slice(0, 5000);
  if (!resolution) throw new DeskError('Say how it was resolved; the person reads this.');
  const row = await peoplePrisma.deskRequest.update({ where: { id: r.id }, data: { status: 'RESOLVED', resolution, resolvedAt: new Date(), resolvedByUserId: who.userId, ...(r.firstReplyAt ? {} : { firstReplyAt: new Date() }) }, include: { employee: { select: { name: true, code: true } } } });
  if (r.employee.userId) await notifyUsers(who.accountId, who.orgId, [r.employee.userId], { kind: 'people.desk', title: `Resolved: ${r.subject}`, body: resolution.slice(0, 300), link: { app: 'people', screen: 'overview' } as any }).catch(() => undefined);
  return shapeRequest(row);
}

/** Within seven days of resolving; after that, a new request (DESK-04). */
export async function reopenRequest(who: Who, id: string, opts: { employeeId?: string | null; now?: Date } = {}) {
  const now = opts.now || new Date();
  const r = await peoplePrisma.deskRequest.findFirst({ where: { id, orgId: who.orgId, ...(opts.employeeId ? { employeeId: opts.employeeId } : {}) } });
  if (!r) throw new DeskError('No such request.', 404);
  if (r.status !== 'RESOLVED' || !r.resolvedAt) throw new DeskError('Only a resolved request can be reopened.', 409);
  if (now.getTime() - r.resolvedAt.getTime() > REOPEN_DAYS * 86_400_000) throw new DeskError(`That was resolved more than ${REOPEN_DAYS} days ago; raise a new request.`, 409);
  const cats = await categoriesOf(who.accountId, who.orgId);
  const cat = cats.find((c) => c.key === r.category);
  const row = await peoplePrisma.deskRequest.update({ where: { id: r.id }, data: { status: 'REOPENED', reopenedAt: now, resolveBy: addWorkingDays(now, cat?.resolveDays ?? 3), resolveEscalatedAt: null }, include: { employee: { select: { name: true, code: true } } } });
  const notice = { kind: 'people.desk', title: `Reopened: ${r.subject}`, body: 'The person says it is not settled.', link: { app: 'people', screen: 'helpdesk', params: { id: r.id } } as any };
  if (r.assigneeUserId) await notifyUsers(who.accountId, who.orgId, [r.assigneeUserId], notice).catch(() => undefined);
  else await notifyPermission(who.accountId, who.orgId, DESK_GRANT, notice).catch(() => undefined);
  return shapeRequest(row, now);
}

/** Moved to Private cases (DESK-05): the details and the thread are wiped here; only the date and the case stay. */
export async function moveToCase(who: Who, id: string, input: { caseId?: string | null } = {}) {
  const r = await peoplePrisma.deskRequest.findFirst({ where: { id, orgId: who.orgId } });
  if (!r) throw new DeskError('No such request.', 404);
  if (r.status === 'MOVED') return requestDetail(who.orgId, id);
  const when = new Date();
  await peoplePrisma.$transaction(async (tx) => {
    await tx.deskMessage.deleteMany({ where: { requestId: r.id } });
    await tx.deskRequest.update({ where: { id: r.id }, data: { status: 'MOVED', subject: `Moved on ${when.toISOString().slice(0, 10)}`, description: '', resolution: null, replyChannel: null, movedToCaseAt: when, movedToCaseId: String(input.caseId || '').trim() || null } });
  });
  return requestDetail(who.orgId, id);
}

export async function templatesOf(orgId: string) {
  const rows = await peoplePrisma.deskTemplate.findMany({ where: { orgId, isActive: true }, orderBy: { title: 'asc' } });
  const policyIds = [...new Set(rows.map((r) => r.policyId).filter((x): x is string => Boolean(x)))];
  const policies = policyIds.length ? await peoplePrisma.policy.findMany({ where: { orgId, id: { in: policyIds } }, select: { id: true, title: true } }) : [];
  const titleOf = new Map(policies.map((p) => [p.id, p.title]));
  return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, category: r.category, policyId: r.policyId, policyTitle: r.policyId ? titleOf.get(r.policyId) || '' : '' }));
}

export async function saveTemplate(who: Who, input: { id?: string | null; title?: string; body?: string; category?: string | null; policyId?: string | null; isActive?: boolean }) {
  const title = String(input.title || '').trim().slice(0, 120);
  const body = String(input.body || '').trim().slice(0, 10_000);
  if (!title || !body) throw new DeskError('A template needs a title and a body.');
  const policyId = String(input.policyId || '').trim() || null;
  if (policyId && !(await peoplePrisma.policy.findFirst({ where: { id: policyId, orgId: who.orgId }, select: { id: true } }))) throw new DeskError('No such policy.');
  const category = String(input.category || '').trim().toUpperCase() || null;
  if (input.id) {
    const row = await peoplePrisma.deskTemplate.findFirst({ where: { id: String(input.id), orgId: who.orgId } });
    if (!row) throw new DeskError('No such template.', 404);
    return peoplePrisma.deskTemplate.update({ where: { id: row.id }, data: { title, body, category, policyId, ...(input.isActive !== undefined ? { isActive: Boolean(input.isActive) } : {}) } });
  }
  return peoplePrisma.deskTemplate.create({ data: { accountId: who.accountId, orgId: who.orgId, title, body, category, policyId, createdByUserId: who.userId } });
}

/** Overdue goes to the queue lead (DESK-03), once per clock: the reply clock and the resolve clock. */
export async function runDeskDues(now = new Date()) {
  const orgs = await outsideTenant('job: desk dues', () => peoplePrisma.deskRequest.findMany({ where: { status: { in: ['OPEN', 'REOPENED', 'WAITING_EMPLOYEE'] }, OR: [{ firstReplyAt: null, replyEscalatedAt: null, replyBy: { lt: now } }, { resolveEscalatedAt: null, resolveBy: { lt: now } }] }, select: { orgId: true }, distinct: ['orgId'] }));
  let told = 0;
  for (const { orgId } of orgs) {
    told += await runInTenant(orgId, async () => {
      const rows = await peoplePrisma.deskRequest.findMany({ where: { orgId, status: { in: ['OPEN', 'REOPENED', 'WAITING_EMPLOYEE'] }, OR: [{ firstReplyAt: null, replyEscalatedAt: null, replyBy: { lt: now } }, { resolveEscalatedAt: null, resolveBy: { lt: now } }] }, include: { employee: { select: { name: true } } } });
      if (!rows.length) return 0;
      const cats = await categoriesOf(rows[0].accountId, orgId);
      let n = 0;
      for (const r of rows) {
        const replyLate = !r.firstReplyAt && !r.replyEscalatedAt && r.replyBy < now && r.status !== 'WAITING_EMPLOYEE';
        const resolveLate = !r.resolveEscalatedAt && r.resolveBy < now;
        if (!replyLate && !resolveLate) continue;
        const lead = cats.find((c) => c.key === r.category)?.leadUserId || null;
        const notice = { kind: 'people.desk_overdue', title: `${replyLate ? 'No reply yet' : 'Not resolved'}: ${r.subject} (${r.employee.name})`, body: replyLate ? `Reply was due ${r.replyBy.toISOString().slice(0, 16).replace('T', ' ')}.` : `Resolve-by was ${r.resolveBy.toISOString().slice(0, 10)}; assigned to ${r.assigneeUserId ? 'someone' : 'nobody'}.`, link: { app: 'people', screen: 'helpdesk', params: { id: r.id } } as any };
        if (lead) await notifyUsers(r.accountId, orgId, [lead], notice).catch(() => undefined);
        else { const ids = await usersWithPermission(r.accountId, orgId, 'PEOPLE::HR Cases::EDIT'); await notifyUsers(r.accountId, orgId, ids, notice).catch(() => undefined); }
        await peoplePrisma.deskRequest.update({ where: { id: r.id }, data: { ...(replyLate ? { replyEscalatedAt: now } : {}), ...(resolveLate ? { resolveEscalatedAt: now } : {}) } });
        n += 1;
      }
      return n;
    });
  }
  return told;
}

export function startDeskDues({ intervalMs = 30 * 60_000, startupDelayMs = 90_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () => exclusive('people.desk-dues', leaseFor(intervalMs), () => runDeskDues()).catch((e) => console.error('[desk-dues] failed:', e instanceof Error ? e.message : e));
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
