import { createHash, randomBytes } from 'node:crypto';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant } from '../../utils/tenantScope.js';
import { isFeatureEnabled } from '../features.js';
import { sendTemplate } from '../mailer.js';
import { notifyUsers, usersWithPermission } from '../notifications.js';
import { offerBreakdown, structuresForOffer } from '../payroll/offerBreakdown.js';
import { type Actor, writeChangeLog } from './changeLog.js';
import { MERGE_FIELDS, mergeValues, render, templatesOf } from './letters.js';
import { textPdf } from './pdf.js';
import { createInvite } from './lifecycle/invites.js';

/**
 * Offers sent from CLOR (HR-VIEW gap 5), on the letters system: the company's
 * OFFER template (or the built-in), the CTC and its monthly lines as an
 * annexure, e-mailed with a link to accept. The link carries a 32-byte token
 * kept only as its sha256 and runs out at the end of the accept-by day.
 *
 * To a candidate (Hiring) or to a draft hire (an employee record before day
 * one). Monthly lines come from a salary structure through Payroll's
 * interface when Payroll is on, otherwise HR types them.
 *
 * Accepting records the day and the IP, tells HR, and moves the person on:
 * a draft hire is sent the joining form; a candidate is left offered and
 * accepted, ready for Hire (HR still sets the employee ID).
 */

export class OfferError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APP_URL = () => process.env.APP_URL || 'http://localhost:5173';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The end of a day in India, as an instant. */
const endOfDayIst = (d: string) => new Date(Date.parse(`${d}T23:59:59+05:30`));
const words = (d: string | null | undefined) => (d && ISO.test(d) ? new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : d || '');
/** Rupees as an Indian reader writes them: Rs 6,00,000. "Rs" rather than the rupee sign, which the PDF's font has not got. */
export const rupees = (n: number) => `Rs ${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })}`;

export type OfferLine = { label: string; monthly: number; kind?: string };

/** What the offer form offers: whether Payroll is on, and its structures if so. */
export async function offerSetup(accountId: string, orgId: string) {
  const payrollOn = await isFeatureEnabled(accountId, orgId, 'payroll');
  return { payrollOn, structures: payrollOn ? await structuresForOffer(orgId) : [] };
}

/** The monthly lines for a CTC: from a structure (Payroll on) or as typed. */
export async function linesFor(accountId: string, orgId: string, input: { annualCtc: number; structureId?: string | null; lines?: unknown }) {
  if (input.structureId) {
    if (!(await isFeatureEnabled(accountId, orgId, 'payroll'))) throw new OfferError('Payroll is not on, so type the monthly lines instead of picking a salary structure.');
    const b = await offerBreakdown(orgId, input.structureId, input.annualCtc);
    if (!b) throw new OfferError('That salary structure is not active.');
    if (!b.lines.length) throw new OfferError('That salary structure pays nothing for this CTC. Check it in Payroll, or type the lines.');
    return { lines: b.lines as OfferLine[], from: 'STRUCTURE' as const, structureId: b.structure.id };
  }
  const raw = Array.isArray(input.lines) ? input.lines : [];
  if (raw.length > 30) throw new OfferError('At most 30 lines.');
  const lines: OfferLine[] = [];
  for (const l of raw as Array<Record<string, unknown>>) {
    const label = String(l?.label ?? '').trim().slice(0, 80);
    const monthly = Number(l?.monthly);
    if (!label && !l?.monthly) continue;
    if (!label) throw new OfferError('Name each line, like Basic or House rent allowance.');
    if (!Number.isFinite(monthly) || monthly < 0) throw new OfferError(`The monthly amount for ${label} is not a number.`);
    lines.push({ label, monthly: Math.round(monthly * 100) / 100 });
  }
  const yearly = lines.reduce((s, l) => s + l.monthly, 0) * 12;
  if (yearly > input.annualCtc + 12) throw new OfferError(`The monthly lines come to ${rupees(Math.round(yearly))} a year, more than the CTC of ${rupees(input.annualCtc)}.`);
  return { lines, from: 'TYPED' as const, structureId: null };
}

/** The pay annexure, as lines of the letter. */
export function annexure(annualCtc: number, lines: OfferLine[]) {
  const out = ['', 'ANNEXURE: PAY OFFERED', '', `Cost to the company (CTC): ${rupees(annualCtc)} a year (${rupees(Math.round((annualCtc / 12) * 100) / 100)} a month)`];
  if (lines.length) {
    out.push('', 'Monthly:');
    for (const l of lines) out.push(`  ${l.label}: ${rupees(l.monthly)}`);
    const gross = lines.filter((l) => l.kind !== 'EMPLOYER').reduce((s, l) => s + l.monthly, 0);
    out.push(`  Monthly gross: ${rupees(Math.round(gross * 100) / 100)}`);
  }
  out.push('', 'Statutory deductions (PF, ESI, professional tax, income tax) are made from pay as the law requires.');
  return out;
}

const shape = (o: any) => ({
  id: o.id, employeeId: o.employeeId, candidateId: o.candidateId, name: o.name, email: o.email, designation: o.designation, joiningDate: o.joiningDate, acceptBy: o.acceptBy,
  annualCtc: Number(o.annualCtc), lines: o.lines, linesFrom: o.linesFrom, structureId: o.structureId, documentId: o.documentId, expiresAt: o.expiresAt,
  status: o.status === 'SENT' && o.expiresAt < new Date() ? 'EXPIRED' : o.status, sentByUserId: o.sentByUserId, acceptedAt: o.acceptedAt, acceptedIp: o.acceptedIp, declinedAt: o.declinedAt, createdAt: o.createdAt,
});

type CreateInput = { employeeId?: string | null; candidateId?: string | null; email?: string; designation?: string; joiningDate?: string | null; acceptBy?: string | null; annualCtc?: unknown; structureId?: string | null; lines?: unknown; signatory?: string; message?: string | null };

/** Write and send an offer. An earlier offer still open for the same person is withdrawn. */
export async function createOffer(actor: Actor, input: CreateInput) {
  const { accountId, orgId } = actor;
  if (Boolean(input.employeeId) === Boolean(input.candidateId)) throw new OfferError('Make the offer to a candidate or to a draft hire.');
  const annualCtc = Math.round(Number(input.annualCtc) * 100) / 100;
  if (!Number.isFinite(annualCtc) || annualCtc <= 0) throw new OfferError('Enter the annual CTC.');
  if (annualCtc > 1e10) throw new OfferError('That CTC is too large.');
  const designation = String(input.designation || '').trim().slice(0, 120);
  if (!designation) throw new OfferError('Say what the position is.');
  const joiningDate = input.joiningDate ? String(input.joiningDate) : null;
  if (joiningDate && !ISO.test(joiningDate)) throw new OfferError('Dates are YYYY-MM-DD.');
  const acceptBy = input.acceptBy ? String(input.acceptBy) : addDays(todayIst(), 7);
  if (!ISO.test(acceptBy)) throw new OfferError('Dates are YYYY-MM-DD.');
  if (acceptBy < todayIst()) throw new OfferError('The accept-by date has passed.');
  const signatory = String(input.signatory || '').trim().slice(0, 200);
  if (!signatory) throw new OfferError('Say who signs the offer, for example the owner’s name and title.');

  /* Who it is for, and the record's values for the letter. */
  let name = '';
  let emailOnFile: string | null = null;
  let values: Record<string, string>;
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true } });
  if (input.employeeId) {
    const e = await peoplePrisma.employee.findFirst({ where: { id: String(input.employeeId), accountId, orgId }, select: { id: true, name: true, status: true, workEmail: true, personalEmail: true, email: true } });
    if (!e) throw new OfferError('No such employee.', 404);
    if (e.status === 'LEFT') throw new OfferError('This person has left.', 409);
    name = e.name;
    emailOnFile = e.personalEmail || e.email || e.workEmail;
    values = await mergeValues(orgId, e.id);
  } else {
    /* Talent → Hiring (services/people/talent/hiring.ts): the candidate's own table. */
    const c = await peoplePrisma.candidate.findFirst({ where: { id: String(input.candidateId), accountId, orgId, anonymisedAt: null } });
    if (!c) throw new OfferError('No such candidate.', 404);
    if (c.employeeId || c.stage === 'HIRED') throw new OfferError('This candidate is already hired. Make the offer to their employee record.', 409);
    if (c.stage === 'REJECTED' || c.stage === 'WITHDRAWN') throw new OfferError('This candidate is no longer in the running.', 409);
    name = c.name;
    emailOnFile = c.email || null;
    values = Object.fromEntries(MERGE_FIELDS.map((k) => [k, ''])) as Record<string, string>;
    Object.assign(values, { name, orgName: org?.name || '', today: words(todayIst()) });
  }
  const email = String(input.email || emailOnFile || '').trim();
  if (!EMAIL.test(email)) throw new OfferError('An offer goes by e-mail: give an e-mail address.');

  const { lines, from, structureId } = await linesFor(accountId, orgId, { annualCtc, structureId: input.structureId, lines: input.lines });
  const gross = lines.filter((l) => l.kind !== 'EMPLOYER').reduce((s, l) => s + l.monthly, 0);
  const template = (await templatesOf(orgId)).find((t) => t.kind === 'OFFER')!;
  /* Fields a candidate has no record for are not asked of an offer letter. */
  const filled = { ...values, establishment: values.establishment || values.orgName, designation: values.designation || designation };
  const extra = { designation, joiningDate: joiningDate ? words(joiningDate) : 'to be agreed', acceptBy: words(acceptBy), signatory, ctc: rupees(annualCtc), monthlyGross: rupees(Math.round(gross * 100) / 100) };
  let text: string;
  try {
    text = render(template.body, filled, extra);
  } catch (e) {
    throw new OfferError(e instanceof Error ? e.message : 'The offer template could not be filled.');
  }
  text = [text, ...annexure(annualCtc, lines)].join('\n');
  const token = randomBytes(32).toString('hex');
  const expiresAt = endOfDayIst(acceptBy);
  const message = String(input.message || '').trim().slice(0, 2000) || null;

  const offer = await peoplePrisma.$transaction(async (tx) => {
    const target = input.employeeId ? { employeeId: String(input.employeeId) } : { candidateId: String(input.candidateId) };
    await tx.offer.updateMany({ where: { orgId, ...target, status: 'SENT' }, data: { status: 'WITHDRAWN' } });
    let documentId: string | null = null;
    if (input.employeeId) {
      const pdf = textPdf({ title: template.name, paragraphs: text.split(/\n/), footer: `${org?.name || ''} - ${template.name} - template v${template.version}` });
      const doc = await tx.employeeDocument.create({ data: { accountId, orgId, employeeId: String(input.employeeId), kind: 'LETTER', title: `${template.name} - ${words(todayIst())}`, mime: 'application/pdf', size: pdf.length, data: pdf, classification: 'EMPLOYEE_VISIBLE', visibleToEmployee: true, uploadedByUserId: actor.userId || 'CLOR', templateId: template.id, templateVersion: template.version } });
      documentId = doc.id;
      await writeChangeLog(tx, actor, { kind: 'Employee', id: String(input.employeeId), employeeId: String(input.employeeId) }, [{ field: 'offer', before: null, after: `offer sent to ${email}: ${designation}, CTC ${rupees(annualCtc)}, open until ${acceptBy}`, redacted: false }]);
    } else {
      /* Sending an offer is what moves a candidate to Offer, on their timeline. */
      const c = await tx.candidate.findFirst({ where: { id: String(input.candidateId), orgId }, select: { stage: true } });
      if (c && ['APPLIED', 'SCREENING', 'INTERVIEW'].includes(c.stage)) await tx.candidate.update({ where: { id: String(input.candidateId) }, data: { stage: 'OFFER', stageAt: new Date() } });
      await tx.candidateEvent.create({ data: { accountId, orgId, candidateId: String(input.candidateId), kind: 'OFFER', fromStage: c?.stage ?? null, toStage: 'OFFER', text: `Offer sent to ${email}: ${designation}, CTC ${rupees(annualCtc)}, open until ${acceptBy}`, byUserId: actor.userId } });
    }
    return tx.offer.create({ data: { accountId, orgId, ...target, name, email, designation, joiningDate, acceptBy, annualCtc, lines: lines as any, linesFrom: from, structureId, letterText: text, documentId, tokenHash: sha256(token), expiresAt, sentByUserId: actor.userId } });
  });
  const link = `${APP_URL()}/api/people/offer/${token}`;
  await sendTemplate({
    templateKey: 'people.offer', to: email, toName: name, accountId, orgId, relatedType: 'Offer', relatedId: offer.id,
    data: { name, orgName: org?.name || '', designation, ctc: rupees(annualCtc), link, acceptBy: words(acceptBy), message: message ? `\n${message}\n` : '' },
  }).catch((e) => console.error('[offers] e-mail:', e instanceof Error ? e.message : e));
  return { offer: shape(offer), text };
}

/** `employeeIds`: a team-limited caller's team, applied in the query so the 200 newest are theirs. */
export async function offersOf(orgId: string, where: { employeeId?: string; candidateId?: string; employeeIds?: string[] } = {}) {
  const person = where.employeeIds ? { employeeId: { in: where.employeeId ? where.employeeIds.filter((x) => x === where.employeeId) : where.employeeIds } } : where.employeeId ? { employeeId: where.employeeId } : {};
  const rows = await peoplePrisma.offer.findMany({ where: { orgId, ...person, ...(where.candidateId ? { candidateId: where.candidateId } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
  return rows.map(shape);
}

export async function withdrawOffer(actor: Actor, id: string) {
  const r = await peoplePrisma.offer.updateMany({ where: { id, orgId: actor.orgId, status: 'SENT' }, data: { status: 'WITHDRAWN' } });
  if (!r.count) throw new OfferError('Only an open offer can be withdrawn.', 409);
  return shape(await peoplePrisma.offer.findUniqueOrThrow({ where: { id } }));
}

/* ---------------------------------------------------------------- the person's side (public, by token) */

export async function findOfferByToken(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return outsideTenant('offer link: find the offer', () => peoplePrisma.offer.findUnique({ where: { tokenHash: sha256(token) } }));
}

/** What the person sees: their own letter and nothing else. */
export async function offerView(o: { orgId: string; name: string; designation: string; acceptBy: string; letterText: string; status: string; expiresAt: Date; acceptedAt: Date | null }) {
  const org = await platformPrisma.org.findUnique({ where: { id: o.orgId }, select: { name: true } });
  return { orgName: org?.name || '', name: o.name, designation: o.designation, acceptBy: o.acceptBy, letter: o.letterText, status: o.status === 'SENT' && o.expiresAt < new Date() ? 'EXPIRED' : o.status, acceptedAt: o.acceptedAt };
}

async function tellHr(o: { accountId: string; orgId: string; employeeId: string | null; candidateId?: string | null; name: string }, title: string, body: string) {
  try {
    const hr = await usersWithPermission(o.accountId, o.orgId, 'PEOPLE::Lifecycle::EDIT');
    await notifyUsers(o.accountId, o.orgId, hr, { kind: 'people.offer', title, body, link: (o.employeeId ? { app: 'people', screen: 'employees', params: { id: o.employeeId } } : { app: 'people', screen: 'candidates', params: { id: o.candidateId } }) as any });
  } catch (e) {
    console.error('[offers] tell HR:', e instanceof Error ? e.message : e);
  }
}

/** Accept: once, before it runs out. Records the moment and the IP, and moves the person on. */
export async function acceptOffer(o: any, ip: string | null) {
  if (o.status !== 'SENT') throw new OfferError(o.status === 'ACCEPTED' ? 'You have already accepted this offer.' : 'This offer is no longer open.', 410);
  if (o.expiresAt < new Date()) throw new OfferError('This offer has run out. Ask the company if it still stands.', 410);
  const now = new Date();
  const claimed = await peoplePrisma.offer.updateMany({ where: { id: o.id, status: 'SENT' }, data: { status: 'ACCEPTED', acceptedAt: now, acceptedIp: ip ? ip.slice(0, 64) : null } });
  if (claimed.count !== 1) throw new OfferError('This offer is no longer open.', 410);
  const actor: Actor = { accountId: o.accountId, orgId: o.orgId, userId: null, source: 'SELF_SERVICE', correlationId: `offer_${o.id}`, reason: 'Offer accepted by the person' };
  let next = 'NOTHING';
  if (o.employeeId) {
    await peoplePrisma.$transaction((tx) => writeChangeLog(tx, actor, { kind: 'Employee', id: o.employeeId, employeeId: o.employeeId }, [{ field: 'offer', before: 'sent', after: `accepted ${todayIst()}${ip ? ` from ${ip.slice(0, 64)}` : ''}`, redacted: false }]));
    /* A draft hire who accepts is sent the joining form, unless one is already out. */
    const live = await peoplePrisma.joinInvite.count({ where: { orgId: o.orgId, employeeId: o.employeeId, status: { in: ['SENT', 'STARTED', 'RETURNED', 'CHECKED'] } } });
    if (!live) {
      try {
        await createInvite({ ...actor, userId: o.sentByUserId, source: 'SYSTEM' }, o.employeeId, { channel: 'EMAIL', sentTo: o.email, message: `Thank you for accepting our offer for ${o.designation}.` });
        next = 'JOINING_FORM_SENT';
      } catch (e) {
        console.error('[offers] joining form:', e instanceof Error ? e.message : e);
      }
    }
  } else if (o.candidateId) {
    const c = await peoplePrisma.candidate.findFirst({ where: { id: o.candidateId, orgId: o.orgId } });
    if (c) {
      await peoplePrisma.$transaction([
        peoplePrisma.candidate.update({ where: { id: c.id }, data: { stage: c.stage === 'HIRED' ? c.stage : 'OFFER', offerAcceptedOn: todayIst() } }),
        peoplePrisma.candidateEvent.create({ data: { accountId: o.accountId, orgId: o.orgId, candidateId: c.id, kind: 'OFFER', text: `Offer accepted${ip ? ` from ${ip.slice(0, 64)}` : ''}` } }),
      ]);
      next = 'READY_TO_HIRE';
    }
  }
  await tellHr(o, `${o.name} accepted the offer`, next === 'READY_TO_HIRE' ? `For ${o.designation}. Open Hiring and choose Hire to make their employee record.` : next === 'JOINING_FORM_SENT' ? `For ${o.designation}. The joining form went to ${o.email}.` : `For ${o.designation}.`);
  return { status: 'ACCEPTED', acceptedAt: now, next };
}

export async function declineOffer(o: any) {
  if (o.status !== 'SENT' || o.expiresAt < new Date()) throw new OfferError('This offer is no longer open.', 410);
  const r = await peoplePrisma.offer.updateMany({ where: { id: o.id, status: 'SENT' }, data: { status: 'DECLINED', declinedAt: new Date() } });
  if (r.count !== 1) throw new OfferError('This offer is no longer open.', 410);
  await tellHr(o, `${o.name} declined the offer`, `For ${o.designation}.`);
  return { status: 'DECLINED' };
}

/** The letter as a PDF, for the person to keep. */
export function offerPdf(o: { letterText: string; designation: string }) {
  return textPdf({ title: 'Offer letter', paragraphs: o.letterText.split(/\n/), footer: `Offer letter - ${o.designation}` });
}
