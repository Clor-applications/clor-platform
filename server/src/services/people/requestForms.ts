import type { Prisma } from '../../generated/people/index.js';
import { peoplePrisma, peopleWrite } from '../../utils/peoplePrisma.js';
import { ApprovalError, PORTAL_PREFIX, activeRule, addWorkingDays, reply, saveRule, submitRequest, withdraw, type FormRequestType, type StepSpec } from './approvals/engine.js';
import type { Actor } from './changeLog.js';

/**
 * Request types HR makes (FEATURE-UI-AUDIT gap 25; WORKFLOW-GAP-RESEARCH:
 * Frappe HR's custom doctypes with a workflow, Keka's and greytHR's custom
 * requests). Kept to what a small business uses: a name, up to twelve fields
 * (text, number, date, a choice, a file), who may ask (everyone, or some
 * departments), who approves, and how many working days each step has.
 *
 * Each form's approval rule is the approval engine's, under the request type
 * `FORM:<id>`: one Approvals inbox, ask for more, reply, withdraw, stand-ins,
 * overdue reminders and the rule's versions come with it, and HR may refine
 * the steps on Approval rules like any other kind. Approving records the
 * decision; HR does the thing asked (prints the card, issues the letter).
 *
 * Three ready-made forms HR can switch on: ID card, salary certificate and
 * asset request.
 */

export const FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'CHOICE', 'FILE'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export type Field = { key: string; label: string; type: FieldType; required: boolean; options?: string[] };
export const APPROVERS = ['MANAGER', 'HR', 'MANAGER_HR'] as const;
export type Approver = (typeof APPROVERS)[number];
export const MAX_FIELDS = 12;
/** A file on a request: a photo, a quote, a scan. Sent as base64 in the request body. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Every file on one request together: as base64 it stays under the 7 MB the route's body may be (app.ts). */
export const MAX_FILES_BYTES = 4 * 1024 * 1024;
/** What a file's first bytes must be for its type: the type a browser says is not trusted. */
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};
const FILE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const DEFAULT_SLA_DAYS = 2;

export class FormError extends Error {
  constructor(message: string, public status = 400, public code = 'FORM_REFUSED') {
    super(message);
  }
}

export const TEMPLATES: Record<string, { name: string; description: string; approver: Approver; fields: Array<Omit<Field, 'key'>> }> = {
  ID_CARD: {
    name: 'ID card',
    description: 'A new or replacement company ID card.',
    approver: 'HR',
    fields: [
      { label: 'Why', type: 'CHOICE', required: true, options: ['New card', 'Lost card', 'Damaged card', 'Name or photo change'] },
      { label: 'Photo for the card', type: 'FILE', required: false },
      { label: 'Anything else', type: 'TEXT', required: false },
    ],
  },
  SALARY_CERTIFICATE: {
    name: 'Salary certificate',
    description: 'A letter stating your salary, for a bank, a visa or a landlord.',
    approver: 'HR',
    fields: [
      { label: 'Purpose', type: 'CHOICE', required: true, options: ['Bank loan', 'Visa', 'Rent agreement', 'Other'] },
      { label: 'Addressed to', type: 'TEXT', required: true },
      { label: 'Needed by', type: 'DATE', required: false },
    ],
  },
  ASSET_REQUEST: {
    name: 'Asset request',
    description: 'Equipment you need for work: a laptop, a phone, a chair.',
    approver: 'MANAGER_HR',
    fields: [
      { label: 'What you need', type: 'TEXT', required: true },
      { label: 'Why', type: 'TEXT', required: true },
      { label: 'Rough cost, ₹', type: 'NUMBER', required: false },
      { label: 'Quote or picture', type: 'FILE', required: false },
    ],
  },
};

export const formType = (id: string): FormRequestType => `FORM:${id}`;

const keyOf = (label: string, taken: Set<string>) => {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'field';
  let k = base;
  for (let i = 2; taken.has(k); i += 1) k = `${base}_${i}`;
  taken.add(k);
  return k;
};

/** Fields as HR wrote them, checked; existing keys are kept so answers already given still read. */
export function cleanFields(raw: unknown): Field[] | string {
  if (!Array.isArray(raw) || !raw.length) return 'Add at least one field.';
  if (raw.length > MAX_FIELDS) return `${MAX_FIELDS} fields at most: keep the form short.`;
  const taken = new Set<string>();
  const out: Field[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const f = raw[i] as any;
    const label = String(f?.label || '').trim().slice(0, 60);
    if (!label) return `Field ${i + 1}: give it a name.`;
    const type = String(f?.type || 'TEXT').toUpperCase() as FieldType;
    if (!(FIELD_TYPES as readonly string[]).includes(type)) return `${label}: a field is text, a number, a date, a choice or a file.`;
    let options: string[] | undefined;
    if (type === 'CHOICE') {
      options = [...new Set((Array.isArray(f.options) ? f.options : String(f.options || '').split(/\n|,/)).map((o: unknown) => String(o).trim().slice(0, 60)).filter(Boolean))] as string[];
      if (options.length < 2) return `${label}: a choice needs at least two options.`;
      if (options.length > 20) return `${label}: twenty options at most.`;
    }
    const wanted = typeof f.key === 'string' && /^[a-z0-9_]{1,40}$/.test(f.key) && !taken.has(f.key) ? f.key : null;
    if (wanted) taken.add(wanted);
    out.push({ key: wanted || keyOf(label, taken), label, type, required: Boolean(f.required), ...(options ? { options } : {}) });
  }
  return out;
}

const stepsFor = (approver: Approver, slaDays: number | null): StepSpec[] => {
  const dueDays = slaDays || DEFAULT_SLA_DAYS;
  const step = (order: number, kind: 'MANAGER' | 'HR'): StepSpec => ({ order, approver: { kind }, dueDays, overdue: { action: 'REMIND' } });
  if (approver === 'MANAGER') return [step(1, 'MANAGER')];
  if (approver === 'HR') return [step(1, 'HR')];
  return [step(1, 'MANAGER'), step(2, 'HR')];
};

/** Which of the three ways a rule reads as, or CUSTOM when HR changed it on Approval rules. */
export function approverOf(steps: StepSpec[] | null | undefined): Approver | 'CUSTOM' | null {
  if (!steps?.length) return null;
  const kinds = steps.map((s) => (s.condition ? 'X' : s.approver.kind)).join(',');
  return kinds === 'MANAGER' ? 'MANAGER' : kinds === 'HR' ? 'HR' : kinds === 'MANAGER,HR' ? 'MANAGER_HR' : 'CUSTOM';
}

type Who = { accountId: string; orgId: string; userId: string | null };

async function shapeForm(f: Prisma.RequestFormGetPayload<object>) {
  const rule = await activeRule(f.orgId, formType(f.id));
  const steps = (rule?.steps || null) as StepSpec[] | null;
  return { id: f.id, requestType: formType(f.id), name: f.name, description: f.description, fields: f.fields as Field[], audience: f.audience, departmentIds: f.departmentIds, slaDays: f.slaDays, template: f.template, active: f.active, approver: approverOf(steps), steps: steps?.length || 0, createdAt: f.createdAt, updatedAt: f.updatedAt };
}

export async function listForms(orgId: string) {
  const rows = await peoplePrisma.requestForm.findMany({ where: { orgId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  const counts = await peoplePrisma.approvalRequest.groupBy({ by: ['requestType', 'status'], where: { orgId, requestType: { in: rows.map((r) => formType(r.id)) } }, _count: { _all: true } });
  const shaped = await Promise.all(rows.map(shapeForm));
  return shaped.map((f) => {
    const mine = counts.filter((c) => c.requestType === f.requestType);
    return { ...f, requests: mine.reduce((a, c) => a + c._count._all, 0), open: mine.filter((c) => c.status === 'WAITING' || c.status === 'MORE_INFO').reduce((a, c) => a + c._count._all, 0) };
  });
}

type FormBody = { name?: unknown; description?: unknown; fields?: unknown; audience?: unknown; departmentIds?: unknown; slaDays?: unknown; approver?: unknown; active?: unknown };

async function cleanBody(orgId: string, b: FormBody, partial: boolean) {
  const data: Record<string, unknown> = {};
  if (!partial || b.name !== undefined) {
    const name = String(b.name || '').trim().slice(0, 60);
    if (!name) throw new FormError('Name the request, for example “ID card”.');
    data.name = name;
  }
  if (b.description !== undefined) data.description = String(b.description || '').trim().slice(0, 300) || null;
  if (!partial || b.fields !== undefined) {
    const fields = cleanFields(b.fields);
    if (typeof fields === 'string') throw new FormError(fields);
    data.fields = fields;
  }
  if (b.audience !== undefined || b.departmentIds !== undefined) {
    const audience = String(b.audience || 'EVERYONE') === 'DEPARTMENTS' ? 'DEPARTMENTS' : 'EVERYONE';
    const ids = audience === 'DEPARTMENTS' ? [...new Set((Array.isArray(b.departmentIds) ? b.departmentIds : []).map(String))].slice(0, 100) : [];
    if (audience === 'DEPARTMENTS') {
      if (!ids.length) throw new FormError('Choose the departments that may ask, or let everyone ask.');
      if ((await peoplePrisma.department.count({ where: { orgId, id: { in: ids } } })) !== ids.length) throw new FormError('One of those departments is not in this company.');
    }
    data.audience = audience;
    data.departmentIds = ids;
  }
  if (b.slaDays !== undefined) {
    const n = b.slaDays === null || b.slaDays === '' ? null : Number(b.slaDays);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 30)) throw new FormError('Decided within 1 to 30 working days, or leave it empty.');
    data.slaDays = n;
  }
  if (b.active !== undefined) data.active = Boolean(b.active);
  let approver: Approver | null = null;
  if (b.approver !== undefined && b.approver !== null && b.approver !== 'CUSTOM') {
    if (!(APPROVERS as readonly string[]).includes(String(b.approver))) throw new FormError('Approved by the manager, by HR, or by the manager then HR.');
    approver = String(b.approver) as Approver;
  }
  return { data, approver };
}

const taken = (e: unknown) => (e as { code?: string })?.code === 'P2002';

/** A new form, with its approval rule. */
export async function createForm(who: Who, body: FormBody & { template?: string | null }) {
  const { data, approver } = await cleanBody(who.orgId, body, false);
  try {
    /* The form and its rule together, under the company's write lock: never a form without a rule, nor two of one name. */
    return await peopleWrite(who.orgId, async () => {
    const f = await peoplePrisma.requestForm.create({ data: { accountId: who.accountId, orgId: who.orgId, name: data.name as string, description: (data.description as string) ?? null, fields: data.fields as Prisma.InputJsonValue, audience: (data.audience as string) || 'EVERYONE', departmentIds: (data.departmentIds as string[]) || [], slaDays: (data.slaDays as number | null) ?? null, template: body.template || null, active: data.active === undefined ? true : Boolean(data.active), createdByUserId: who.userId } });
    await saveRule(who, formType(f.id), `${f.name} (${approverWords(approver || 'HR')})`, stepsFor(approver || 'HR', f.slaDays));
    return shapeForm(f);
    });
  } catch (e) {
    if (taken(e)) throw new FormError('There is already a request with that name.', 409, 'NAME_TAKEN');
    throw e;
  }
}

const approverWords = (a: Approver) => (a === 'MANAGER' ? 'their manager' : a === 'HR' ? 'HR' : 'their manager, then HR');

/**
 * A change to a form. The rule gets a new version only when who approves or
 * the due days change; a rule HR refined on Approval rules is left alone
 * unless a new approver is chosen here. Requests already asked keep the
 * fields and rule version they were asked under.
 */
export async function updateForm(who: Who, id: string, body: FormBody) {
  const { data, approver } = await cleanBody(who.orgId, body, true);
  /* The form and its rule change together, under the company's write lock (review of PR #75). */
  return peopleWrite(who.orgId, async () => {
  const f = await peoplePrisma.requestForm.findFirst({ where: { id, orgId: who.orgId } });
  if (!f) throw new FormError('No such request type.', 404, 'NOT_FOUND');
  let saved;
  try {
    saved = await peoplePrisma.requestForm.update({ where: { id: f.id }, data: data as Prisma.RequestFormUpdateInput });
  } catch (e) {
    if (taken(e)) throw new FormError('There is already a request with that name.', 409, 'NAME_TAKEN');
    throw e;
  }
  const rule = await activeRule(who.orgId, formType(f.id));
  const current = approverOf((rule?.steps || null) as StepSpec[] | null);
  const slaChanged = data.slaDays !== undefined && data.slaDays !== f.slaDays;
  const next = approver || (current && current !== 'CUSTOM' ? current : null);
  if (!rule || (approver && approver !== current) || (slaChanged && next)) {
    const a = next || 'HR';
    await saveRule(who, formType(f.id), `${saved.name} (${approverWords(a)})`, stepsFor(a, saved.slaDays));
  }
  return shapeForm(saved);
  });
}

/** Switch on a ready-made form: made the first time, switched back on after that. */
export async function useTemplate(who: Who, key: string) {
  const t = TEMPLATES[key];
  if (!t) throw new FormError('No such ready-made request.', 404, 'NOT_FOUND');
  /* Looked for and made under the company's write lock: two clicks at once make one. */
  return peopleWrite(who.orgId, async () => {
    const existing = await peoplePrisma.requestForm.findFirst({ where: { orgId: who.orgId, OR: [{ template: key }, { name: t.name }] } });
    if (existing) return shapeForm(existing.active ? existing : await peoplePrisma.requestForm.update({ where: { id: existing.id }, data: { active: true } }));
    return createForm(who, { name: t.name, description: t.description, fields: t.fields, approver: t.approver, template: key });
  });
}

type Person = { id: string; name: string; userId: string | null; departmentId: string | null; status: string };
const mayAsk = (f: { active: boolean; audience: string; departmentIds: string[] }, p: Person) => f.active && (f.audience !== 'DEPARTMENTS' || (Boolean(p.departmentId) && f.departmentIds.includes(p.departmentId!)));

async function personIn(orgId: string, employeeId: string): Promise<Person> {
  const p = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true, name: true, userId: true, departmentId: true, status: true } });
  if (!p) throw new FormError('No such person.', 404, 'NOT_FOUND');
  return p;
}

/** The forms this person may fill in now. */
export async function formsFor(orgId: string, employeeId: string) {
  const p = await personIn(orgId, employeeId);
  const rows = await peoplePrisma.requestForm.findMany({ where: { orgId, active: true }, orderBy: { name: 'asc' } });
  return rows.filter((f) => mayAsk(f, p)).map((f) => ({ id: f.id, name: f.name, description: f.description, fields: f.fields as Field[], slaDays: f.slaDays || DEFAULT_SLA_DAYS }));
}

type FileIn = { name?: unknown; dataUrl?: unknown };
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/;

/** One answer, checked against its field. Returns the value to keep, and the words to show. */
function answerOf(f: Field, raw: unknown): { value: unknown; text: string } | null {
  if (f.type === 'FILE') return null;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    if (f.required) throw new FormError(`${f.label}: this is needed.`);
    return { value: null, text: '' };
  }
  const s = String(raw).trim();
  if (f.type === 'NUMBER') {
    const n = Number(s.replace(/,/g, ''));
    if (!Number.isFinite(n)) throw new FormError(`${f.label}: give a number.`);
    if (Math.abs(n) > 1e12) throw new FormError(`${f.label}: that number is too large.`);
    return { value: n, text: n.toLocaleString('en-IN') };
  }
  if (f.type === 'DATE') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new FormError(`${f.label}: give a date.`);
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return { value: s, text: `${Number(s.slice(8, 10))} ${MON[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` };
  }
  if (f.type === 'CHOICE') {
    if (!(f.options || []).includes(s)) throw new FormError(`${f.label}: choose one of the options.`);
    return { value: s, text: s };
  }
  return { value: s.slice(0, 2000), text: s.slice(0, 2000) };
}

/**
 * Ask. `userId` is the asker's CLOR sign-in, or null from the employee app
 * (then `portal:<employeeId>` asks). An `idempotencyKey` makes a double tap
 * one request.
 */
export async function raise(who: { accountId: string; orgId: string; employeeId: string; userId: string | null; correlationId: string }, formId: string, body: { answers?: unknown; files?: unknown; idempotencyKey?: unknown }) {
  const p = await personIn(who.orgId, who.employeeId);
  if (p.status === 'LEFT') throw new FormError('You have left; ask HR directly.', 403, 'LEFT');
  if (p.status === 'SUSPENDED') throw new FormError('Your employment is paused; ask HR directly.', 403, 'SUSPENDED');
  const form = await peoplePrisma.requestForm.findFirst({ where: { id: formId, orgId: who.orgId } });
  if (!form || !mayAsk(form, p)) throw new FormError('That request is not open to you.', 404, 'NOT_FOUND');
  const fields = form.fields as Field[];
  const answers = (body.answers && typeof body.answers === 'object' ? body.answers : {}) as Record<string, unknown>;
  const files = (body.files && typeof body.files === 'object' ? body.files : {}) as Record<string, FileIn>;
  const kept: Record<string, unknown> = {};
  const lines: Array<{ label: string; value: string }> = [];
  const toStore: Array<{ field: Field; name: string; mime: string; data: Buffer }> = [];
  for (const f of fields) {
    if (f.type === 'FILE') {
      const file = files[f.key];
      if (!file || !file.dataUrl) {
        if (f.required) throw new FormError(`${f.label}: attach the file.`);
        continue;
      }
      const m = DATA_URL.exec(String(file.dataUrl));
      if (!m || !FILE_MIMES.includes(m[1])) throw new FormError(`${f.label}: a picture (JPEG, PNG, WebP) or a PDF.`);
      const data = Buffer.from(m[2], 'base64');
      if (!data.length) throw new FormError(`${f.label}: the file is empty.`);
      if (data.length > MAX_FILE_BYTES) throw new FormError(`${f.label}: up to 2 MB.`);
      if (!MAGIC[m[1]]?.(data)) throw new FormError(`${f.label}: that file is not the picture or PDF it says it is.`);
      toStore.push({ field: f, name: String(file.name || f.label).trim().slice(0, 120) || f.label, mime: m[1], data });
      continue;
    }
    const a = answerOf(f, answers[f.key]);
    if (!a) continue;
    kept[f.key] = a.value;
    if (a.text) lines.push({ label: f.label, value: a.text });
  }
  if (toStore.reduce((a, x) => a + x.data.length, 0) > MAX_FILES_BYTES) throw new FormError('The files come to more than 4 MB together; send smaller ones.');
  const key = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim() ? `form:${who.employeeId}:${body.idempotencyKey.trim().slice(0, 80)}` : null;
  if (key) {
    const existing = await peoplePrisma.approvalRequest.findFirst({ where: { orgId: who.orgId, idempotencyKey: key } });
    if (existing) return { id: existing.id, status: existing.status, existed: true };
  }
  const requester = who.userId || `${PORTAL_PREFIX}${p.id}`;
  /* Files first, unattached; tied to the request once it exists, so a refused request leaves nothing anyone can reach. */
  const stored = [];
  for (const s of toStore) {
    const row = await peoplePrisma.requestFormFile.create({ data: { accountId: who.accountId, orgId: who.orgId, formId: form.id, employeeId: p.id, fieldKey: s.field.key, fileName: s.name, mime: s.mime, size: s.data.length, data: s.data } });
    stored.push({ fieldKey: s.field.key, label: s.field.label, fileId: row.id, name: s.name, size: s.data.length });
    lines.push({ label: s.field.label, value: s.name });
  }
  if (!(await activeRule(who.orgId, formType(form.id)))) await saveRule({ accountId: who.accountId, orgId: who.orgId, userId: null }, formType(form.id), `${form.name} (HR)`, stepsFor('HR', form.slaDays));
  const actor: Actor = { accountId: who.accountId, orgId: who.orgId, userId: requester, source: 'SELF_SERVICE', correlationId: who.correlationId, reason: null };
  let r;
  try {
    r = await submitRequest(actor, { requestType: formType(form.id), subjectEmployeeId: p.id, title: `${form.name}: ${p.name}`, payload: { employeeId: p.id, formId: form.id, formName: form.name, answers: kept, files: stored, lines } as any, idempotencyKey: key });
  } catch (e) {
    if (stored.length) await peoplePrisma.requestFormFile.deleteMany({ where: { orgId: who.orgId, id: { in: stored.map((x) => x.fileId) }, requestId: null } });
    /* The same double tap, the other one first: answer with that one. */
    if (key && taken(e)) {
      const existing = await peoplePrisma.approvalRequest.findFirst({ where: { orgId: who.orgId, idempotencyKey: key } });
      if (existing) return { id: existing.id, status: existing.status, existed: true };
    }
    if (e instanceof ApprovalError) throw new FormError(e.message, e.status, e.code);
    throw e;
  }
  if (stored.length) {
    const ids = stored.map((x) => x.fileId);
    if (r.existed) await peoplePrisma.requestFormFile.deleteMany({ where: { orgId: who.orgId, id: { in: ids }, requestId: null } });
    else await peoplePrisma.requestFormFile.updateMany({ where: { orgId: who.orgId, id: { in: ids } }, data: { requestId: r.request.id } });
  }
  return { id: r.request.id, status: r.request.status, existed: Boolean(r.existed) };
}

const requesterIds = (p: { id: string; userId: string | null }) => [`${PORTAL_PREFIX}${p.id}`, ...(p.userId ? [p.userId] : [])];

/** My own form requests: open ones and those of the last 90 days, with what was said. */
export async function myFormRequests(orgId: string, employeeId: string) {
  const p = await personIn(orgId, employeeId);
  const since = new Date(Date.now() - 90 * 86_400_000);
  const rows = await peoplePrisma.approvalRequest.findMany({
    where: { orgId, subjectEmployeeId: p.id, requesterUserId: { in: requesterIds(p) }, requestType: { startsWith: 'FORM:' }, OR: [{ status: { in: ['WAITING', 'MORE_INFO'] } }, { updatedAt: { gte: since } }] },
    include: { steps: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } }, orderBy: { createdAt: 'desc' }, take: 100,
  });
  return rows.map((r) => {
    const pl = (r.payload || {}) as { formName?: string; lines?: Array<{ label: string; value: string }>; files?: Array<{ fileId: string; name: string; label: string }>; replies?: Array<{ at: string; note: string }> };
    const said = r.steps.filter((s) => s.comment && ['MORE_INFO', 'REJECTED', 'APPROVED'].includes(s.status)).slice(-1)[0];
    const waiting = r.steps.find((s) => s.status === 'WAITING');
    return { id: r.id, formName: pl.formName || r.title, title: r.title, status: r.status, lines: pl.lines || [], files: pl.files || [], askedAt: r.createdAt, decidedAt: r.status === 'WAITING' || r.status === 'MORE_INFO' ? null : r.updatedAt, dueAt: waiting?.dueAt || null, said: said?.comment || null, replies: pl.replies || [] };
  });
}

async function ownRequest(orgId: string, employeeId: string, requestId: string) {
  const p = await personIn(orgId, employeeId);
  const r = await peoplePrisma.approvalRequest.findFirst({ where: { id: requestId, orgId, subjectEmployeeId: p.id, requesterUserId: { in: requesterIds(p) }, requestType: { startsWith: 'FORM:' } }, select: { id: true, requesterUserId: true } });
  if (!r) throw new FormError('No such request.', 404, 'NOT_FOUND');
  return r;
}

export async function replyOwn(who: { accountId: string; orgId: string; employeeId: string; correlationId: string }, requestId: string, note: string) {
  const text = String(note || '').trim();
  if (!text) throw new FormError('Write your answer.');
  const r = await ownRequest(who.orgId, who.employeeId, requestId);
  try {
    const done = await reply({ accountId: who.accountId, orgId: who.orgId, userId: r.requesterUserId, source: 'SELF_SERVICE', correlationId: who.correlationId }, r.id, text);
    return { id: done.id, status: done.status };
  } catch (e) {
    if (e instanceof ApprovalError) throw new FormError(e.message, e.status, e.code);
    throw e;
  }
}

export async function withdrawOwn(who: { accountId: string; orgId: string; employeeId: string; correlationId: string }, requestId: string) {
  const r = await ownRequest(who.orgId, who.employeeId, requestId);
  try {
    const done = await withdraw({ accountId: who.accountId, orgId: who.orgId, userId: r.requesterUserId, source: 'SELF_SERVICE', correlationId: who.correlationId }, r.id);
    return { id: done.id, status: done.status };
  } catch (e) {
    if (e instanceof ApprovalError) throw new FormError(e.message, e.status, e.code);
    throw e;
  }
}

/**
 * A file on a request, for whoever may see the request: the person it is
 * about, anyone who decides or decided a step of it, or HR (`hr`).
 */
export async function fileFor(orgId: string, fileId: string, reader: { employeeId?: string | null; userId?: string | null; hr?: boolean }) {
  const f = await peoplePrisma.requestFormFile.findFirst({ where: { id: fileId, orgId } });
  if (!f || !f.requestId) throw new FormError('No such file.', 404, 'NOT_FOUND');
  if (reader.hr || (reader.employeeId && reader.employeeId === f.employeeId)) return f;
  if (reader.userId) {
    const steps = await peoplePrisma.approvalStep.findMany({ where: { orgId, requestId: f.requestId }, select: { candidateUserIds: true, decidedByUserId: true } });
    if (steps.some((s) => s.decidedByUserId === reader.userId || ((s.candidateUserIds as string[]) || []).includes(reader.userId!))) return f;
  }
  throw new FormError('No such file.', 404, 'NOT_FOUND');
}

/**
 * HR's report: every request of these types in a period, with its answers,
 * who asked, how long it waited and whether it is overdue; and a line per
 * type with counts and the average working time to a decision.
 */
export async function report(orgId: string, opts: { formId?: string | null; status?: string | null; from?: string | null; to?: string | null }) {
  const forms = await peoplePrisma.requestForm.findMany({ where: { orgId }, select: { id: true, name: true } });
  const types = (opts.formId ? forms.filter((f) => f.id === opts.formId) : forms).map((f) => formType(f.id));
  const where: Prisma.ApprovalRequestWhereInput = { orgId, requestType: { in: types } };
  if (opts.status && ['WAITING', 'MORE_INFO', 'APPROVED', 'REJECTED', 'WITHDRAWN'].includes(opts.status)) where.status = opts.status;
  if (opts.from || opts.to) where.createdAt = { ...(opts.from ? { gte: new Date(`${opts.from}T00:00:00+05:30`) } : {}), ...(opts.to ? { lte: new Date(`${opts.to}T23:59:59+05:30`) } : {}) };
  const rows = types.length ? await peoplePrisma.approvalRequest.findMany({ where, include: { steps: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } }, orderBy: { createdAt: 'desc' }, take: 2000 }) : [];
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.subjectEmployeeId).filter(Boolean) as string[])] } }, select: { id: true, name: true, code: true, department: true } })).map((e) => [e.id, e]));
  const name = new Map<string, string>(forms.map((f) => [formType(f.id), f.name]));
  const now = Date.now();
  const shaped = rows.map((r) => {
    const pl = (r.payload || {}) as { lines?: Array<{ label: string; value: string }> };
    const waiting = r.steps.find((s) => s.status === 'WAITING');
    const closed = !['WAITING', 'MORE_INFO'].includes(r.status);
    const e = r.subjectEmployeeId ? people.get(r.subjectEmployeeId) : null;
    return {
      id: r.id, formId: r.requestType.slice(5), formName: name.get(r.requestType) || r.title, status: r.status,
      employeeId: r.subjectEmployeeId, employeeName: e?.name || '', employeeCode: e?.code || null, department: e?.department || null,
      askedAt: r.createdAt, decidedAt: closed ? r.updatedAt : null, daysToDecide: closed ? workingDaysBetween(r.createdAt, r.updatedAt) : null,
      dueAt: waiting?.dueAt || null, overdue: Boolean(waiting && waiting.dueAt.getTime() < now), lines: pl.lines || [],
    };
  });
  const summary = forms.filter((f) => !opts.formId || f.id === opts.formId).map((f) => {
    const mine = shaped.filter((r) => r.formId === f.id);
    const decided = mine.filter((r) => r.daysToDecide != null && (r.status === 'APPROVED' || r.status === 'REJECTED'));
    return {
      formId: f.id, formName: f.name, total: mine.length,
      waiting: mine.filter((r) => r.status === 'WAITING' || r.status === 'MORE_INFO').length,
      approved: mine.filter((r) => r.status === 'APPROVED').length,
      rejected: mine.filter((r) => r.status === 'REJECTED').length,
      withdrawn: mine.filter((r) => r.status === 'WITHDRAWN').length,
      overdue: mine.filter((r) => r.overdue).length,
      averageDaysToDecide: decided.length ? Math.round((decided.reduce((a, r) => a + (r.daysToDecide || 0), 0) / decided.length) * 10) / 10 : null,
    };
  });
  return { rows: shaped, summary };
}

/** Working days (Monday to Saturday) from one moment to another, as the engine counts due days. */
function workingDaysBetween(a: Date, b: Date) {
  let n = 0;
  for (let d = addWorkingDays(a, 1); d.getTime() <= b.getTime(); d = addWorkingDays(d, 1)) n += 1;
  return n;
}
