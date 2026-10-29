import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { CODE_TTL_MS } from '../../attendance/portal.js';
import { activationLink, companyCode, emailCode, issueCode, portalUrl } from '../../portalCodes.js';
import { type Actor, writeChangeLog } from '../changeLog.js';

/**
 * "Send employee app access" from the Workforce directory (HR-VIEW gap 3).
 *
 * Each person picked gets a one-time activation code (the same codes as
 * Settings → Employee app access, services/portalCodes.ts):
 * - with an e-mail on file, by e-mail with the link that opens the app with
 *   their company and employee code filled in. HR never sees the code.
 * - with only a phone, the code comes back in this one response, for a
 *   printed sheet and a WhatsApp share link (wa.me, no paid SMS). It is not
 *   kept anywhere in clear, so it cannot be shown again; a new send makes a
 *   new code.
 * Every send is recorded (AppAccessSend) and on the person's change log.
 */

export class AppAccessError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const MAX_PER_SEND = 200;

/** A phone as wa.me wants it: country code and number, digits only. Ten digits are taken as Indian. */
export const waNumber = (phone: string | null | undefined) => {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
};

/** When a code stops working, in India's time: the one wording the WhatsApp text, the e-mail and HR's screen all use. */
export const expiryWords = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
export const whatsappText = (o: { name: string; orgName: string; link: string; companyCode: string; employeeCode: string; code: string; expires: Date }) =>
  `Hello ${o.name}, ${o.orgName} has set you up on the employee app. Open ${o.link} and choose "First time? Activate". Company code: ${o.companyCode}. Employee code: ${o.employeeCode}. Activation code: ${o.code} (works once, until ${expiryWords(o.expires)}). Choose your own password; nobody at ${o.orgName} will know it.`;

type Sent =
  | { employeeId: string; name: string; employeeCode: string; channel: 'EMAIL'; sentTo: string }
  | { employeeId: string; name: string; employeeCode: string; channel: 'PRINT'; phoneEnding: string; activationCode: string; whatsappUrl: string | null; link: string };
type Skipped = { employeeId: string; name: string; reason: string };

export async function sendAppAccess(actor: Actor, employeeIds: string[]) {
  const ids = [...new Set(employeeIds.filter(Boolean))];
  if (!ids.length) throw new AppAccessError('Pick someone.');
  if (ids.length > MAX_PER_SEND) throw new AppAccessError(`At most ${MAX_PER_SEND} people at a time.`);
  const people = await peoplePrisma.employee.findMany({
    where: { accountId: actor.accountId, orgId: actor.orgId, id: { in: ids } },
    select: { id: true, name: true, code: true, status: true, workEmail: true, email: true, personalEmail: true, phone: true, workPhone: true, mobilePunch: true },
  });
  const company = await companyCode(actor.accountId, actor.orgId);
  const expires = new Date(Date.now() + CODE_TTL_MS);
  const sent: Sent[] = [];
  const skipped: Skipped[] = ids.filter((id) => !people.some((p) => p.id === id)).map((id) => ({ employeeId: id, name: '', reason: 'Not in this company.' }));
  for (const p of people) {
    if (p.status === 'LEFT') { skipped.push({ employeeId: p.id, name: p.name, reason: 'Has left.' }); continue; }
    if (!p.code) { skipped.push({ employeeId: p.id, name: p.name, reason: 'No employee code, which is what they sign in with. Set one first.' }); continue; }
    const email = p.workEmail || p.email || p.personalEmail;
    const phone = p.phone || p.workPhone;
    if (!email && !phone) { skipped.push({ employeeId: p.id, name: p.name, reason: 'No e-mail or phone on file.' }); continue; }
    const { formatted } = await issueCode(p.id, expires);
    let channel: 'EMAIL' | 'PRINT' = 'PRINT';
    if (email) {
      try {
        await emailCode({ accountId: actor.accountId, orgId: actor.orgId, to: email, person: { id: p.id, name: p.name, code: p.code, mobilePunch: p.mobilePunch }, company, formatted, expires });
        channel = 'EMAIL';
      } catch (e) {
        console.error('[app-access] e-mail:', e instanceof Error ? e.message : e);
        if (!phone) { skipped.push({ employeeId: p.id, name: p.name, reason: 'The e-mail could not be sent, and there is no phone on file.' }); continue; }
      }
    }
    const phoneEnding = String(phone || '').replace(/\D/g, '').slice(-4);
    await peoplePrisma.$transaction(async (tx) => {
      await tx.appAccessSend.create({ data: { accountId: actor.accountId, orgId: actor.orgId, employeeId: p.id, channel, sentTo: channel === 'EMAIL' ? email : phoneEnding ? `phone ending ${phoneEnding}` : null, expiresAt: expires, sentByUserId: actor.userId || 'system' } });
      await writeChangeLog(tx, actor, { kind: 'Employee', id: p.id, employeeId: p.id }, [{ field: 'appAccess', before: null, after: channel === 'EMAIL' ? `activation code e-mailed to ${email}` : 'activation code given on a printed sheet / WhatsApp', redacted: false }]);
    });
    if (channel === 'EMAIL') sent.push({ employeeId: p.id, name: p.name, employeeCode: p.code, channel, sentTo: email! });
    else {
      const link = activationLink(company.code, p.code);
      const wa = waNumber(phone);
      const text = whatsappText({ name: p.name, orgName: company.name, link, companyCode: company.code, employeeCode: p.code, code: formatted, expires });
      sent.push({ employeeId: p.id, name: p.name, employeeCode: p.code, channel, phoneEnding, activationCode: formatted, whatsappUrl: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : null, link });
    }
  }
  return { company, portalUrl: portalUrl(), expiresAt: expires, expiresWords: expiryWords(expires), sent, skipped };
}

/** The record of sends, newest first. */
export async function appAccessSends(orgId: string, employeeId?: string) {
  const rows = await peoplePrisma.appAccessSend.findMany({ where: { orgId, ...(employeeId ? { employeeId } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, name: true, code: true } })).map((p) => [p.id, p]));
  return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeName: people.get(r.employeeId)?.name || '', employeeCode: people.get(r.employeeId)?.code || null, channel: r.channel, sentTo: r.sentTo, expiresAt: r.expiresAt, sentByUserId: r.sentByUserId, sentAt: r.createdAt }));
}
