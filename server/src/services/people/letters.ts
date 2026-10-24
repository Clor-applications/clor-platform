import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { notifyUsers } from '../notifications.js';
import { type Actor, writeChangeLog } from './changeLog.js';
import { writeEvent } from './outbox.js';
import { textPdf } from './pdf.js';
import { startChecklist } from './checklists.js';

/**
 * Letters (docs/people/02-PRD.md DOC-04, DOC-07). A template is plain text
 * with {{fields}} from an allow-list and {{extra.key}} fields HR fills in
 * when issuing. Each save is a new version; the issued letter is a PDF on
 * the person's record that says which template version made it. Where the
 * company has no template of its own for a kind, a built-in one is used.
 */

export const LETTER_KINDS = ['OFFER', 'APPOINTMENT', 'CONFIRMATION', 'INCREMENT', 'RELIEVING', 'EXPERIENCE', 'SERVICE_CERT'] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];
export const LETTER_LABEL: Record<LetterKind, string> = {
  OFFER: 'Offer letter', APPOINTMENT: 'Appointment letter', CONFIRMATION: 'Confirmation letter', INCREMENT: 'Increment notice',
  RELIEVING: 'Relieving letter', EXPERIENCE: 'Experience letter', SERVICE_CERT: 'Service certificate',
};

/** What a template may merge from the record. Nothing about pay: that is Payroll's. */
export const MERGE_FIELDS = ['name', 'code', 'designation', 'department', 'dateOfJoining', 'firstJoiningDate', 'dateOfLeaving', 'probationEndDate', 'confirmedOn', 'establishment', 'establishmentAddress', 'orgName', 'today'] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

/**
 * States whose Shops & Establishments law says a service certificate is due
 * within a set number of days of asking, and that an employer may not keep
 * employees' original documents (docs/people/05-INDIA-COMPLIANCE-MATRIX.md
 * C-ST-02: Karnataka amendment, 4 Sep 2026).
 */
export const SERVICE_CERT_DAYS: Record<string, { days: number; source: string }> = {
  karnataka: { days: 7, source: 'Karnataka Shops & Commercial Establishments (Amendment) 2026, C-ST-02' },
};
export const NO_ORIGINALS_STATES = new Set(['karnataka']);

const DEFAULTS: Record<LetterKind, { name: string; body: string }> = {
  OFFER: {
    name: 'Offer letter',
    body: `{{today}}

Dear {{name}},

We are pleased to offer you the position of {{extra.designation}} at {{orgName}}, at {{establishment}}.

Your expected date of joining is {{extra.joiningDate}}. The pay and benefits offered are set out in the attached annexure. This offer is open until {{extra.acceptBy}}; please sign and return a copy to accept it.

Your appointment is subject to the documents you have listed being found in order and to the company's policies, which you will receive on joining.

We look forward to working with you.

For {{orgName}}

{{extra.signatory}}`,
  },
  APPOINTMENT: {
    name: 'Appointment letter',
    body: `{{today}}

Dear {{name}},

With reference to your acceptance of our offer, we are pleased to appoint you as {{designation}} in {{department}} at {{orgName}}, {{establishment}}, with effect from {{dateOfJoining}}. Your employee ID is {{code}}.

You will be on probation for the period set out in the company's policy, ending on {{probationEndDate}}, during which your work will be reviewed. Confirmation is in writing.

Your working hours, leave and other conditions of service follow the company's policies and the law of the state in which {{establishment}} is situated. The pay and benefits that apply to you are set out separately by Payroll.

Please sign and return the enclosed copy as your acceptance.

For {{orgName}}

{{extra.signatory}}`,
  },
  CONFIRMATION: {
    name: 'Confirmation letter',
    body: `{{today}}

Dear {{name}},

We are pleased to confirm your services as {{designation}} in {{department}} with effect from {{confirmedOn}}, on satisfactory completion of your probation.

All other terms of your appointment remain unchanged.

We wish you a long and rewarding association with {{orgName}}.

For {{orgName}}

{{extra.signatory}}`,
  },
  INCREMENT: {
    name: 'Increment notice',
    body: `{{today}}

Dear {{name}},

In recognition of your work, your remuneration is revised with effect from {{extra.effectiveFrom}}. The revised pay is set out in the annexure issued by Payroll.

All other terms of your employment remain unchanged.

For {{orgName}}

{{extra.signatory}}`,
  },
  RELIEVING: {
    name: 'Relieving letter',
    body: `{{today}}

Dear {{name}},

This is to confirm that you have been relieved from the services of {{orgName}} at the close of working hours on {{dateOfLeaving}}, following your resignation. You were employed as {{designation}} in {{department}} from {{dateOfJoining}} to {{dateOfLeaving}}.

Your final settlement is being processed by Payroll as per the company's policy.

We thank you for your contribution and wish you well.

For {{orgName}}

{{extra.signatory}}`,
  },
  EXPERIENCE: {
    name: 'Experience letter',
    body: `{{today}}

TO WHOM IT MAY CONCERN

This is to certify that {{name}} (employee ID {{code}}) was employed with {{orgName}} from {{dateOfJoining}} to {{dateOfLeaving}}, last holding the position of {{designation}} in {{department}}.

During this period we found {{extra.pronoun}} work and conduct to be {{extra.conduct}}.

We wish {{extra.pronounObject}} success in the future.

For {{orgName}}

{{extra.signatory}}`,
  },
  SERVICE_CERT: {
    name: 'Service certificate',
    body: `{{today}}

SERVICE CERTIFICATE

This is to certify that {{name}} (employee ID {{code}}) served {{orgName}} at {{establishment}} from {{dateOfJoining}} to {{dateOfLeaving}} as {{designation}} in {{department}}.

This certificate is issued at the employee's request under the Shops and Establishments law applicable to the establishment.

For {{orgName}}

{{extra.signatory}}`,
  },
};

export class LetterError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z_.]+)\s*\}\}/g;

/** The placeholders in a body: merge fields and the extra keys HR must fill in. Unknown ones are refused. */
export function placeholdersOf(body: string): { fields: MergeField[]; extra: string[] } {
  const fields = new Set<MergeField>();
  const extra = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER)) {
    const key = m[1];
    if (key.startsWith('extra.')) {
      const k = key.slice('extra.'.length);
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(k)) throw new LetterError(`"{{${key}}}" is not a field name.`);
      extra.add(k);
    } else if ((MERGE_FIELDS as readonly string[]).includes(key)) fields.add(key as MergeField);
    else throw new LetterError(`"{{${key}}}" is not a field a letter can merge. Use one of: ${MERGE_FIELDS.join(', ')}, or {{extra.name}} for something HR types in.`);
  }
  return { fields: [...fields], extra: [...extra] };
}

const shape = (t: { id: string | null; kind: string; name: string; body: string; version: number; active: boolean; createdAt?: Date | null }) => ({
  id: t.id, kind: t.kind, name: t.name, body: t.body, version: t.version, active: t.active, builtIn: t.id === null, createdAt: t.createdAt ?? null, ...placeholdersOf(t.body),
});

/** The template in use for each kind: the company's newest active one, or the built-in. */
export async function templatesOf(orgId: string) {
  const own = await peoplePrisma.letterTemplate.findMany({ where: { orgId, active: true }, orderBy: { version: 'desc' } });
  return LETTER_KINDS.map((kind) => {
    const mine = own.find((t) => t.kind === kind);
    return mine ? shape(mine) : shape({ id: null, kind, name: DEFAULTS[kind].name, body: DEFAULTS[kind].body, version: 0, active: true });
  });
}

export async function versionsOf(orgId: string, kind: string) {
  const rows = await peoplePrisma.letterTemplate.findMany({ where: { orgId, kind }, orderBy: { version: 'desc' } });
  return rows.map(shape);
}

/** Save a template: always a new version, which becomes the one in use. */
export async function saveTemplate(actor: Actor, input: { kind?: string; name?: string; body?: string }) {
  const kind = String(input.kind || '').toUpperCase() as LetterKind;
  if (!LETTER_KINDS.includes(kind)) throw new LetterError('Unknown letter kind.');
  const name = String(input.name || '').trim().slice(0, 120) || DEFAULTS[kind].name;
  const body = String(input.body || '').trim();
  if (!body) throw new LetterError('The letter needs a body.');
  if (body.length > 20_000) throw new LetterError('Keep the letter under 20,000 characters.');
  placeholdersOf(body);
  return peoplePrisma.$transaction(async (tx) => {
    const last = await tx.letterTemplate.findFirst({ where: { orgId: actor.orgId, kind }, orderBy: { version: 'desc' }, select: { version: true } });
    await tx.letterTemplate.updateMany({ where: { orgId: actor.orgId, kind, active: true }, data: { active: false } });
    const row = await tx.letterTemplate.create({ data: { accountId: actor.accountId, orgId: actor.orgId, kind, name, body, version: (last?.version ?? 0) + 1, active: true, createdByUserId: actor.userId } });
    return shape(row);
  });
}

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
/** A YYYY-MM-DD plus whole days, with no time zone in the way. */
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const fmt = (d: string | null | undefined) => {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return d || '';
  return new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
};

/** The record's values for the merge fields, as the letter prints them. */
export async function mergeValues(orgId: string, employeeId: string): Promise<Record<MergeField, string>> {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId } });
  if (!e) throw new LetterError('No such employee.', 404);
  const [org, est] = await Promise.all([
    platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
    e.establishmentId ? peoplePrisma.establishment.findFirst({ where: { id: e.establishmentId, orgId }, select: { name: true, state: true, address: true } }) : null,
  ]);
  return {
    name: e.name, code: e.code || '', designation: e.designation || '', department: e.department || '',
    dateOfJoining: fmt(e.dateOfJoining), firstJoiningDate: fmt(e.firstJoiningDate), dateOfLeaving: fmt(e.dateOfLeaving), probationEndDate: fmt(e.probationEndDate), confirmedOn: fmt(e.confirmedOn),
    establishment: est ? `${est.name}${est.state ? `, ${est.state}` : ''}` : '', establishmentAddress: est?.address || '', orgName: org?.name || '', today: fmt(todayIst()),
  };
}

/** Fields a letter may leave blank: a small company has no departments, an establishment may have no address on file. */
const OPTIONAL_FIELDS = new Set<string>(['department', 'establishmentAddress', 'code']);

/** The letter's text with every field filled; a blank merge field or a missing extra is refused, so no letter goes out with a hole. */
export function render(body: string, values: Record<string, string>, extra: Record<string, string>) {
  const missing: string[] = [];
  const text = body.replace(PLACEHOLDER, (_m, key: string) => {
    if (key.startsWith('extra.')) {
      const v = String(extra[key.slice(6)] ?? '').trim();
      if (!v) missing.push(key);
      return v;
    }
    const v = values[key] ?? '';
    if (!v && !OPTIONAL_FIELDS.has(key)) missing.push(key);
    return v;
  });
  if (missing.length) throw new LetterError(`Fill in before issuing: ${[...new Set(missing)].map((k) => k.replace(/^extra\./, '')).join(', ')}.`);
  return text.replace(/ in  /g, ' ').replace(/[ \t]{2,}/g, ' ');
}

/** Issue a letter: rendered, made into a PDF, stored on the record with the template version, logged, the person told. */
export async function issueLetter(actor: Actor, employeeId: string, input: { kind?: string; extra?: Record<string, unknown>; classification?: string }) {
  const kind = String(input.kind || '').toUpperCase() as LetterKind;
  if (!LETTER_KINDS.includes(kind)) throw new LetterError('Unknown letter kind.');
  const template = (await templatesOf(actor.orgId)).find((t) => t.kind === kind)!;
  const extra = Object.fromEntries(Object.entries(input.extra || {}).map(([k, v]) => [k, String(v ?? '').trim().slice(0, 1000)]));
  const values = await mergeValues(actor.orgId, employeeId);
  const text = render(template.body, values, extra);
  const paragraphs = text.split(/\n/);
  const pdf = textPdf({ title: template.name, paragraphs, footer: `${values.orgName} - ${template.name} - template v${template.version}` });
  const classification = String(input.classification || 'EMPLOYEE_VISIBLE').toUpperCase();
  if (!['EMPLOYEE_VISIBLE', 'HR_ONLY'].includes(classification)) throw new LetterError('A letter is visible to the person, or HR only.');
  const title = `${template.name} - ${values.today}`;
  const doc = await peoplePrisma.$transaction(async (tx) => {
    const row = await tx.employeeDocument.create({
      data: { accountId: actor.accountId, orgId: actor.orgId, employeeId, kind: 'LETTER', title, mime: 'application/pdf', size: pdf.length, data: pdf, classification, visibleToEmployee: classification === 'EMPLOYEE_VISIBLE', uploadedByUserId: actor.userId || 'CLOR', templateId: template.id, templateVersion: template.version },
    });
    await writeChangeLog(tx, actor, { kind: 'Employee', id: employeeId, employeeId }, [{ field: 'letter', before: null, after: `${LETTER_LABEL[kind]} issued (template v${template.version})`, redacted: false }]);
    await writeEvent(tx, actor, 'people.letter.issued.v1', { documentId: row.id, kind, templateVersion: template.version, employee: { id: employeeId, name: values.name, code: values.code } }, employeeId);
    return row;
  });
  const person = await peoplePrisma.employee.findFirst({ where: { id: employeeId }, select: { userId: true } });
  if (person?.userId && classification === 'EMPLOYEE_VISIBLE') await notifyUsers(actor.accountId, actor.orgId, [person.userId], { kind: 'people.letter', title: `Your ${template.name.toLowerCase()} is ready`, body: 'Open Me → Documents to download it.', link: { app: 'people', screen: 'overview' } as any }).catch(() => undefined);
  /* A letter asked for is now issued: the task for it is ticked. */
  await peoplePrisma.checklistTask.updateMany({ where: { orgId: actor.orgId, employeeId, kind: 'LETTER', doneAt: null, title: { startsWith: `Issue ${LETTER_LABEL[kind].toLowerCase()}` } }, data: { doneAt: new Date(), doneByUserId: actor.userId, note: `Issued: ${title}` } });
  return { document: { id: doc.id, title, kind: 'LETTER', mime: 'application/pdf', size: pdf.length, templateId: template.id, templateVersion: template.version, classification }, text };
}

/** When a service certificate asked for today is due, by the establishment's state (DOC-07). */
export async function serviceCertificateDue(orgId: string, employeeId: string, askedOn = todayIst()) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { establishmentId: true } });
  if (!e) throw new LetterError('No such employee.', 404);
  const est = e.establishmentId ? await peoplePrisma.establishment.findFirst({ where: { id: e.establishmentId, orgId }, select: { name: true, state: true } }) : null;
  const rule = est?.state ? SERVICE_CERT_DAYS[est.state.trim().toLowerCase()] : undefined;
  const dueOn = rule ? addDays(askedOn, rule.days) : null;
  return { askedOn, establishment: est?.name || null, state: est?.state || null, dueDays: rule?.days ?? null, dueOn, source: rule?.source || null, note: rule ? `Due within ${rule.days} days of asking in ${est!.state}.` : 'No statutory day for this state is on file; the company\'s own set days apply.' };
}

/** Record that someone asked for a letter: an HR task on the record, due by the statutory day where there is one. */
export async function recordLetterRequest(actor: Actor, employeeId: string, input: { kind?: string; askedOn?: string | null }) {
  const kind = String(input.kind || '').toUpperCase() as LetterKind;
  if (!LETTER_KINDS.includes(kind)) throw new LetterError('Unknown letter kind.');
  const askedOn = input.askedOn && /^\d{4}-\d{2}-\d{2}$/.test(input.askedOn) ? input.askedOn : todayIst();
  const due = kind === 'SERVICE_CERT' ? await serviceCertificateDue(actor.orgId, employeeId, askedOn) : null;
  const dueDays = due?.dueDays ?? 7;
  const label = LETTER_LABEL[kind].toLowerCase();
  await startChecklist({ accountId: actor.accountId, orgId: actor.orgId, userId: actor.userId }, { id: employeeId }, 'LETTER', askedOn, {
    items: [{ title: `Issue ${label} (asked ${askedOn})`, owner: 'HR', dueDays, note: due?.source ? `${due.note} Source: ${due.source}.` : `Due within the company's set days (${dueDays}).` }],
  });
  return { kind, askedOn, dueOn: due?.dueOn ?? addDays(askedOn, dueDays), dueDays, source: due?.source ?? null };
}
