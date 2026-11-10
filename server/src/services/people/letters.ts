import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { notifyUsers } from '../notifications.js';
import { type Actor, writeChangeLog } from './changeLog.js';
import { writeEvent } from './outbox.js';
import { textPdf } from './pdf.js';
import { startChecklist, tickWhenDone } from './checklists.js';
import { addDays, todayIst } from '../../utils/istDate.js';
import { activeRule, saveRule, submitRequest } from './approvals/engine.js';

/**
 * Letters (docs/people/02-PRD.md DOC-04, DOC-07). A template is plain text
 * with {{fields}} from an allow-list and {{extra.key}} fields HR fills in
 * when issuing. Each save is a new version; the issued letter is a PDF on
 * the person's record that says which template version made it. Where the
 * company has no template of its own for a kind, a built-in one is used.
 */

export const LETTER_KINDS = ['OFFER', 'APPOINTMENT', 'CONFIRMATION', 'INCREMENT', 'RELIEVING', 'EXPERIENCE', 'SERVICE_CERT', 'EMPLOYMENT', 'ABSENCE_NOTICE_1', 'ABSENCE_NOTICE_2'] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];
export const LETTER_LABEL: Record<LetterKind, string> = {
  OFFER: 'Offer letter', APPOINTMENT: 'Appointment letter', CONFIRMATION: 'Confirmation letter', INCREMENT: 'Increment notice',
  RELIEVING: 'Relieving letter', EXPERIENCE: 'Experience letter', SERVICE_CERT: 'Service certificate',
  /* The letter people ask for most while they work here: for a bank, a visa, a landlord. */
  EMPLOYMENT: 'Employment certificate',
  /* Unexplained absence (people/absconding.ts): asked to report back or explain, twice, before any leaving is recorded. */
  ABSENCE_NOTICE_1: 'Absence notice', ABSENCE_NOTICE_2: 'Second absence notice',
};

/** What a template may merge from the record. Nothing about pay: that is Payroll's. */
export const MERGE_FIELDS = ['name', 'code', 'designation', 'department', 'dateOfJoining', 'firstJoiningDate', 'dateOfLeaving', 'leavingWords', 'probationEndDate', 'confirmedOn', 'establishment', 'establishmentAddress', 'orgName', 'today'] as const;
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

We are pleased to offer you the position of {{extra.designation}} at {{orgName}}.

Your expected date of joining is {{extra.joiningDate}}. Your cost to the company (CTC) will be {{extra.ctc}} a year; the monthly pay is set out in the annexure. This offer is open until {{extra.acceptBy}}; to accept it, use the link in the e-mail that came with this letter, or sign and return a copy.

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

This is to confirm that you have been relieved from the services of {{orgName}} at the close of working hours on {{dateOfLeaving}}, {{leavingWords}}. You were employed as {{designation}} in {{department}} from {{dateOfJoining}} to {{dateOfLeaving}}.

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
  ABSENCE_NOTICE_1: {
    name: 'Absence notice',
    body: `{{today}}

Dear {{name}},

You have been absent from work since {{extra.absentFrom}} without leave and without telling us why. We have tried to reach you and are concerned.

Please report back to work, or write to us explaining your absence, by {{extra.reportBy}}. If you are unwell or something has happened, tell us and we will help.

If we do not hear from you by then, we will send a second notice.

For {{orgName}}

{{extra.signatory}}`,
  },
  ABSENCE_NOTICE_2: {
    name: 'Second absence notice',
    body: `{{today}}

Dear {{name}},

We wrote to you on {{extra.firstNoticeOn}} because you have been absent since {{extra.absentFrom}} without leave or explanation. We have not heard from you.

Please report back to work, or explain your absence in writing, by {{extra.reportBy}}. If we do not hear from you by then, we will treat you as having left the company of your own accord, on the terms of the company's standing orders and policies. Wages you have earned will be settled as the law requires.

For {{orgName}}

{{extra.signatory}}`,
  },
  EMPLOYMENT: {
    name: 'Employment certificate',
    body: `{{today}}

TO WHOM IT MAY CONCERN

This is to certify that {{name}} (employee ID {{code}}) has been employed with {{orgName}} since {{dateOfJoining}} and works with us as {{designation}} in {{department}}.

This certificate is issued at the employee's request.

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

/** A YYYY-MM-DD plus whole days, with no time zone in the way. */
const fmt = (d: string | null | undefined) => {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return d || '';
  return new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
};

/* How the relieving letter says why they went: never "following your resignation" for someone whose contract ended or who retired (Workforce final audit W17). */
const LEAVING_WORDS: Record<string, string> = {
  RESIGNED: 'following your resignation', CONTRACT_ENDED: 'on the completion of your contract', RETIRED: 'on your retirement', TERMINATED: 'on the termination of your services',
};
/* Letters that say someone has gone, and who never gets one. */
const LEAVING_LETTERS = new Set(['RELIEVING', 'EXPERIENCE', 'SERVICE_CERT']);
const NO_RELIEVING = new Set(['ABSCONDED', 'DECEASED', 'NOT_JOINED', 'DUPLICATE']);

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
    dateOfJoining: fmt(e.dateOfJoining), firstJoiningDate: fmt(e.firstJoiningDate), dateOfLeaving: fmt(e.dateOfLeaving), leavingWords: LEAVING_WORDS[e.leavingType || ''] || '', probationEndDate: fmt(e.probationEndDate), confirmedOn: fmt(e.confirmedOn),
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
export async function issueLetter(actor: Actor, employeeId: string, input: { kind?: string; extra?: Record<string, unknown>; classification?: string; /** Once each (step 6): what the letter is for, e.g. "APPOINTMENT:stint1". */ issuedFor?: string | null; /** The template to use, when the caller already read it. */ template?: Awaited<ReturnType<typeof templatesOf>>[number] }) {
  const kind = String(input.kind || '').toUpperCase() as LetterKind;
  if (!LETTER_KINDS.includes(kind)) throw new LetterError('Unknown letter kind.');
  if (LEAVING_LETTERS.has(kind)) {
    const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId: actor.orgId }, select: { status: true, leavingType: true } });
    if (!e || (e.status !== 'LEFT' && e.status !== 'ON_NOTICE')) throw new LetterError('This letter is for someone who is leaving or has left. Record their leaving first.', 409);
    if (kind === 'RELIEVING' && NO_RELIEVING.has(e.leavingType || '')) throw new LetterError('A relieving letter is not issued for this kind of leaving.', 409);
  }
  const template = input.template && input.template.kind === kind ? input.template : (await templatesOf(actor.orgId)).find((t) => t.kind === kind)!;
  const extra = Object.fromEntries(Object.entries(input.extra || {}).map(([k, v]) => [k, String(v ?? '').trim().slice(0, 1000)]));
  const values = await mergeValues(actor.orgId, employeeId);
  const text = render(template.body, values, extra);
  const paragraphs = text.split(/\n/);
  const pdf = textPdf({ title: template.name, paragraphs, footer: `${values.orgName} - ${template.name} - template v${template.version}` });
  const classification = String(input.classification || 'EMPLOYEE_VISIBLE').toUpperCase();
  if (!['EMPLOYEE_VISIBLE', 'HR_ONLY'].includes(classification)) throw new LetterError('A letter is visible to the person, or HR only.');
  const title = `${template.name} - ${values.today}`;
  const issuedFor = input.issuedFor ? String(input.issuedFor).slice(0, 120) : null;
  const doc = await peoplePrisma.$transaction(async (tx) => {
    const row = await tx.employeeDocument.create({
      data: { accountId: actor.accountId, orgId: actor.orgId, employeeId, kind: 'LETTER', title, mime: 'application/pdf', size: pdf.length, data: pdf, classification, visibleToEmployee: classification === 'EMPLOYEE_VISIBLE', uploadedByUserId: actor.userId || 'CLOR', templateId: template.id, templateVersion: template.version, letterKind: kind, issuedFor },
    });
    await writeChangeLog(tx, actor, { kind: 'Employee', id: employeeId, employeeId }, [{ field: 'letter', before: null, after: `${LETTER_LABEL[kind]} issued (template v${template.version})`, redacted: false }]);
    await writeEvent(tx, actor, 'people.letter.issued.v1', { documentId: row.id, kind, templateVersion: template.version, employee: { id: employeeId, name: values.name, code: values.code } }, employeeId);
    return row;
  }).catch((e) => {
    /* Two runs of the same event at once: the second finds the first's letter. */
    if (issuedFor && (e as { code?: string })?.code === 'P2002') throw new LetterError('This letter was already issued.', 409);
    throw e;
  });
  const person = await peoplePrisma.employee.findFirst({ where: { id: employeeId }, select: { userId: true } });
  if (person?.userId && classification === 'EMPLOYEE_VISIBLE') await notifyUsers(actor.accountId, actor.orgId, [person.userId], { kind: 'people.letter', title: `Your ${template.name.toLowerCase()} is ready`, body: 'Open Me → Documents to download it.', link: { app: 'people', screen: 'overview' } as any }).catch(() => undefined);
  await tickLetterTasks(actor, employeeId, kind, title);
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
    items: [{ title: `Issue ${label} (asked ${askedOn})`, owner: 'HR', dueDays, fixedDue: true, note: due?.source ? `${due.note} Source: ${due.source}.` : `Due within the company's set days (${dueDays}).` }],
  });
  return { kind, askedOn, dueOn: due?.dueOn ?? addDays(askedOn, dueDays), dueDays, source: due?.source ?? null };
}

/* ------------------------------------------------------------ letters by event */

/**
 * The checklist steps a letter closes (People plan 8 Nov 2026, steps 4 and 6),
 * matched by words in the title so a company's own wording still ticks:
 * the joining plan's appointment letter, a confirmation letter on the
 * probation or joining plan, an increment letter on a change plan, a letter
 * asked for. A leaving step that names the relieving and the experience
 * letter closes when both are on file from this leaving on.
 */
async function tickLetterTasks(actor: Actor, employeeId: string, kind: LetterKind, title: string) {
  const note = `Issued: ${title}`;
  if (kind === 'APPOINTMENT') await tickWhenDone(actor.orgId, employeeId, 'JOINING', ['appointment letter'], note, actor.userId);
  if (kind === 'CONFIRMATION') {
    await tickWhenDone(actor.orgId, employeeId, 'PROBATION', ['confirmation letter'], note, actor.userId);
    await tickWhenDone(actor.orgId, employeeId, 'JOINING', ['confirmation letter'], note, actor.userId);
  }
  if (kind === 'INCREMENT') await tickWhenDone(actor.orgId, employeeId, 'CHANGE', ['increment'], note, actor.userId);
  if (kind === 'RELIEVING' || kind === 'EXPERIENCE') {
    try {
      const steps = await peoplePrisma.checklistTask.findMany({ where: { orgId: actor.orgId, employeeId, kind: 'LEAVING', doneAt: null, system: null, title: { contains: 'letter', mode: 'insensitive' } }, select: { id: true, title: true, createdAt: true } });
      for (const step of steps) {
        const t = step.title.toLowerCase();
        const needs = [t.includes('relieving') ? 'RELIEVING' : null, t.includes('experience') ? 'EXPERIENCE' : null].filter(Boolean) as string[];
        if (!needs.includes(kind)) continue;
        /* Letters issued for this leaving: from when its plan began. */
        const have = await peoplePrisma.employeeDocument.findMany({ where: { orgId: actor.orgId, employeeId, letterKind: { in: needs }, createdAt: { gte: step.createdAt } }, select: { letterKind: true } });
        if (needs.every((k) => have.some((h) => h.letterKind === k))) {
          await peoplePrisma.checklistTask.updateMany({ where: { id: step.id, doneAt: null }, data: { doneAt: new Date(), doneByUserId: actor.userId, note: needs.length > 1 ? 'Issued: both letters are on their documents.' : note } });
        }
      }
    } catch (e) {
      console.error('[letters] leaving step not ticked:', e instanceof Error ? e.message : e);
    }
  }
  /* A letter asked for is now issued: the task for it is ticked. */
  await peoplePrisma.checklistTask.updateMany({ where: { orgId: actor.orgId, employeeId, kind: 'LETTER', doneAt: null, title: { startsWith: `Issue ${LETTER_LABEL[kind].toLowerCase()}` } }, data: { doneAt: new Date(), doneByUserId: actor.userId, note } });
}

/** The company's letter settings: who signs the letters CLOR issues on its own. */
export async function letterSettings(orgId: string) {
  const row = await peoplePrisma.peopleSetting.findUnique({ where: { orgId }, select: { letterSignatory: true } });
  return { signatory: row?.letterSignatory || '' };
}

export async function saveLetterSettings(actor: Actor, input: { signatory?: unknown }) {
  const signatory = String(input.signatory ?? '').trim().slice(0, 200) || null;
  await peoplePrisma.peopleSetting.upsert({ where: { orgId: actor.orgId }, create: { accountId: actor.accountId, orgId: actor.orgId, letterSignatory: signatory }, update: { letterSignatory: signatory } });
  return letterSettings(actor.orgId);
}

/** What CLOR can fill in itself on a letter it issues: the signatory on file, and the person's pronouns. */
async function autoExtra(orgId: string, employeeId: string, extra: Record<string, string>) {
  const [settings, e] = await Promise.all([
    letterSettings(orgId),
    peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { gender: true } }),
  ]);
  const pronouns = e?.gender === 'MALE' ? { pronoun: 'his', pronounObject: 'him' } : e?.gender === 'FEMALE' ? { pronoun: 'her', pronounObject: 'her' } : { pronoun: 'their', pronounObject: 'them' };
  return { ...(settings.signatory ? { signatory: settings.signatory } : {}), ...pronouns, ...extra };
}

/** Which events issue which letter, for the Letters screen to say. */
export const EVENT_OF: Partial<Record<LetterKind, string>> = {
  APPOINTMENT: 'someone joins',
  CONFIRMATION: 'probation is confirmed',
  INCREMENT: 'Payroll applies a pay rise',
  RELIEVING: 'someone leaves',
  EXPERIENCE: 'someone leaves',
};

export type EventLetter = { issued: true; documentId: string; title: string } | { issued: false; why: string };

/**
 * A letter an event issues (People plan 8 Nov 2026, step 6): appointment on
 * joining, confirmation on confirming, increment on a pay rise, relieving and
 * experience on leaving. Only where the company has saved its own letter for
 * the kind (CLOR's built-in wording is never sent on its own), once per
 * `issuedFor`, filled from the record, the signatory on file and the
 * pronouns. Anything missing skips it quietly: the hire, confirmation or
 * leaving it follows has already happened, and HR can still issue the letter
 * by hand; an open step for it says why. Never throws.
 */
export async function issueOnEvent(actor: Actor, employeeId: string, kind: LetterKind, issuedFor: string, extra: Record<string, string> = {}): Promise<EventLetter> {
  try {
    const own = await peoplePrisma.letterTemplate.findFirst({ where: { orgId: actor.orgId, kind, active: true }, orderBy: { version: 'desc' } });
    if (!own) return { issued: false, why: 'The company has no letter of its own for this.' };
    if (await peoplePrisma.employeeDocument.findFirst({ where: { orgId: actor.orgId, employeeId, issuedFor }, select: { id: true } })) return { issued: false, why: 'Already issued.' };
    const r = await issueLetter(actor, employeeId, { kind, extra: await autoExtra(actor.orgId, employeeId, extra), issuedFor, template: shape(own) });
    return { issued: true, documentId: r.document.id, title: r.document.title };
  } catch (e) {
    const why = e instanceof LetterError ? e.message : 'The letter could not be made.';
    if (!(e instanceof LetterError)) console.error(`[letters] ${kind} for ${employeeId} not issued:`, e instanceof Error ? e.message : e);
    /* A field was blank: the step that waits for this letter says so, so HR knows to issue it by hand. */
    if (e instanceof LetterError && /^Fill in/.test(e.message)) await noteOpenStep(actor.orgId, employeeId, kind, `CLOR could not issue the ${LETTER_LABEL[kind].toLowerCase()} on its own. ${e.message} Issue it from their record.`);
    return { issued: false, why };
  }
}

/** Puts why on the open step for this letter, without overwriting a note someone wrote. */
async function noteOpenStep(orgId: string, employeeId: string, kind: LetterKind, note: string) {
  const where = kind === 'APPOINTMENT' ? { kind: 'JOINING', title: { contains: 'appointment letter', mode: 'insensitive' as const } }
    : kind === 'RELIEVING' || kind === 'EXPERIENCE' ? { kind: 'LEAVING', title: { contains: kind === 'RELIEVING' ? 'relieving' : 'experience', mode: 'insensitive' as const } }
      : kind === 'CONFIRMATION' ? { title: { contains: 'confirmation letter', mode: 'insensitive' as const } }
        : null;
  if (!where) return;
  await peoplePrisma.checklistTask.updateMany({ where: { orgId, employeeId, doneAt: null, system: null, note: null, ...where }, data: { note: note.slice(0, 500) } }).catch(() => undefined);
}

/** The stint a letter belongs to: a rejoin is a new stint and earns its own letters. */
export async function stintKey(orgId: string, employeeId: string) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { currentEpisodeSeq: true } });
  return `stint${e?.currentEpisodeSeq ?? 1}`;
}

/** Appointment on joining: for someone joining now or ahead, not a record added for someone who joined long ago. */
export async function appointmentOnHire(actor: Actor, employee: { id: string; dateOfJoining?: string | null; status?: string | null }) {
  if (!employee.dateOfJoining || employee.status === 'LEFT') return { issued: false, why: 'No joining date.' } as EventLetter;
  if (employee.dateOfJoining < addDays(todayIst(), -30)) return { issued: false, why: 'Joined more than 30 days ago.' } as EventLetter;
  return issueOnEvent(actor, employee.id, 'APPOINTMENT', `APPOINTMENT:${await stintKey(actor.orgId, employee.id)}`);
}

/** Relieving and experience on leaving; not for an absconding, a death, someone who never joined or a duplicate. */
export async function lettersOnLeaving(actor: Actor, employee: { id: string; leavingType?: string | null }) {
  if (NO_RELIEVING.has(employee.leavingType || '')) return [];
  const stint = await stintKey(actor.orgId, employee.id);
  return [await issueOnEvent(actor, employee.id, 'RELIEVING', `RELIEVING:${stint}`), await issueOnEvent(actor, employee.id, 'EXPERIENCE', `EXPERIENCE:${stint}`)];
}

/* ------------------------------------------------------- asked for in the app */

/** What someone may ask for from the employee app, by where they are: the leaving letters only once they are leaving. */
export function askableKinds(status: string): LetterKind[] {
  const leaving = status === 'ON_NOTICE' || status === 'LEFT';
  return leaving ? ['EMPLOYMENT', 'SERVICE_CERT', 'RELIEVING', 'EXPERIENCE'] : ['EMPLOYMENT'];
}

type AppWho = { accountId: string; orgId: string; employeeId: string; userId: string | null; correlationId: string };

/** My letter and document requests, newest first, for the app. */
export async function myLetterRequests(who: { orgId: string; employeeId: string }) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: who.employeeId, orgId: who.orgId }, select: { id: true, status: true, userId: true } });
  if (!e) throw new LetterError('No such person.', 404);
  const rows = await peoplePrisma.approvalRequest.findMany({ where: { orgId: who.orgId, subjectEmployeeId: e.id, requestType: { in: ['LETTER_REQUEST', 'DOCUMENT_REQUEST'] }, requesterUserId: { in: [e.userId, `portal:${e.id}`].filter(Boolean) as string[] } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, requestType: true, title: true, status: true, createdAt: true, outcome: true } });
  return {
    kinds: askableKinds(e.status).map((k) => ({ kind: k, label: LETTER_LABEL[k] })),
    requests: rows.map((r) => ({ id: r.id, type: r.requestType, title: r.title, status: r.status, createdAt: r.createdAt, issued: Boolean((r.outcome as { documentId?: string } | null)?.documentId) })),
  };
}

/**
 * Ask for a letter, or a copy of a document, from the employee app (People
 * plan 8 Nov 2026, step 6): a LETTER_REQUEST or DOCUMENT_REQUEST under the
 * company's rule, or HR alone where it has none. Approving a letter issues
 * it onto my documents; approving a document puts a task on HR to share it.
 * One open ask of each kind at a time.
 */
export async function askFromApp(who: AppWho, input: { kind?: unknown; what?: unknown; note?: unknown }) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: who.employeeId, orgId: who.orgId }, select: { id: true, name: true, status: true, userId: true } });
  if (!e) throw new LetterError('No such person.', 404);
  const requester = who.userId || e.userId || `portal:${e.id}`;
  const note = String(input.note ?? '').trim().slice(0, 500) || null;
  const copy = String(input.kind || '').toUpperCase() === 'COPY';
  let requestType: 'LETTER_REQUEST' | 'DOCUMENT_REQUEST';
  let title: string;
  let payload: Record<string, unknown>;
  if (copy) {
    const what = String(input.what ?? '').trim().slice(0, 200);
    if (!what) throw new LetterError('Say which document you need a copy of.');
    requestType = 'DOCUMENT_REQUEST';
    title = `${e.name}: a copy of ${what}`;
    payload = { employeeId: e.id, what, note, reason: note };
  } else {
    const kind = String(input.kind || '').toUpperCase() as LetterKind;
    if (!askableKinds(e.status).includes(kind)) throw new LetterError(LEAVING_LETTERS.has(kind) ? 'This letter is for when you are leaving.' : 'Pick a letter from the list.');
    requestType = 'LETTER_REQUEST';
    title = `${e.name}: ${LETTER_LABEL[kind].toLowerCase()}`;
    payload = { employeeId: e.id, kind, note, reason: note };
  }
  const open = await peoplePrisma.approvalRequest.findFirst({ where: { orgId: who.orgId, subjectEmployeeId: e.id, requestType, title, status: { in: ['WAITING', 'MORE_INFO'] } }, select: { id: true } });
  if (open) throw new LetterError('You have already asked for this. HR has it.', 409);
  if (!(await activeRule(who.orgId, requestType))) {
    await saveRule({ accountId: who.accountId, orgId: who.orgId, userId: null }, requestType, requestType === 'LETTER_REQUEST' ? 'Letters (default: HR)' : 'Document copies (default: HR)', [
      { order: 1, approver: { kind: 'HR' }, dueDays: 3, overdue: { action: 'REMIND' } },
    ]);
  }
  const r = await submitRequest({ accountId: who.accountId, orgId: who.orgId, userId: requester, source: 'SELF_SERVICE', correlationId: who.correlationId, reason: note }, { requestType, subjectEmployeeId: e.id, title, payload });
  return { request: { id: r.request.id, status: r.request.status, title: r.request.title }, outcome: r.outcome ?? null };
}

/**
 * A letter request approved: the letter is issued onto the person's
 * documents (the company's letter, or CLOR's), signed by the signatory on
 * file. Where it cannot be made yet (a blank field, a letter HR must word),
 * it becomes a task on HR's list, due by the statutory day for a service
 * certificate; issuing it by hand ticks the task.
 */
export async function letterRequestApproved(actor: Actor, request: { id: string; subjectEmployeeId: string | null; title: string; payload: unknown }) {
  if (!request.subjectEmployeeId) return { skipped: 'No person on the request.' };
  const p = (request.payload || {}) as { kind?: string; note?: string | null };
  const kind = String(p.kind || '').toUpperCase() as LetterKind;
  if (!LETTER_KINDS.includes(kind)) {
    await startChecklist({ accountId: actor.accountId, orgId: actor.orgId, userId: actor.userId }, { id: request.subjectEmployeeId }, 'LETTER', todayIst(), { items: [{ title: `Issue the letter asked for: ${request.title}`.slice(0, 200), owner: 'HR', dueDays: 3, note: p.note || undefined }] });
    return { task: true };
  }
  const issuedFor = `REQUEST:${request.id}`;
  const already = await peoplePrisma.employeeDocument.findFirst({ where: { orgId: actor.orgId, employeeId: request.subjectEmployeeId, issuedFor }, select: { id: true } });
  if (already) return { documentId: already.id };
  try {
    const r = await issueLetter(actor, request.subjectEmployeeId, { kind, extra: await autoExtra(actor.orgId, request.subjectEmployeeId, {}), issuedFor });
    return { documentId: r.document.id, title: r.document.title };
  } catch (e) {
    if (!(e instanceof LetterError)) throw e;
    const t = await recordLetterRequest(actor, request.subjectEmployeeId, { kind });
    await noteLetterTask(actor.orgId, request.subjectEmployeeId, kind, `${e.message} Asked in the employee app${p.note ? `: ${p.note}` : ''}.`);
    return { task: true, dueOn: t.dueOn, why: e.message };
  }
}

/** The why on the task just made for a letter asked for. */
async function noteLetterTask(orgId: string, employeeId: string, kind: LetterKind, note: string) {
  const t = await peoplePrisma.checklistTask.findFirst({ where: { orgId, employeeId, kind: 'LETTER', doneAt: null, title: { startsWith: `Issue ${LETTER_LABEL[kind].toLowerCase()}` } }, orderBy: { createdAt: 'desc' }, select: { id: true, note: true } });
  if (t) await peoplePrisma.checklistTask.update({ where: { id: t.id }, data: { note: `${note} ${t.note || ''}`.trim().slice(0, 500) } });
}

/** A copy of a document approved: HR shares it with the person, a task on their list until it is done. */
export async function documentRequestApproved(actor: Actor, request: { subjectEmployeeId: string | null; title: string; payload: unknown }) {
  if (!request.subjectEmployeeId) return { skipped: 'No person on the request.' };
  const p = (request.payload || {}) as { what?: string; note?: string | null };
  const what = String(p.what || '').trim() || request.title.replace(/^[^:]*:\s*/, '');
  await startChecklist({ accountId: actor.accountId, orgId: actor.orgId, userId: actor.userId }, { id: request.subjectEmployeeId }, 'LETTER', todayIst(), {
    items: [{ title: `Share a copy of ${what}`.slice(0, 200), owner: 'HR', dueDays: 3, note: `Asked in the employee app${p.note ? `: ${p.note}` : ''}. Upload it to their documents, visible to them.`.slice(0, 500) }],
  });
  return { task: true };
}
