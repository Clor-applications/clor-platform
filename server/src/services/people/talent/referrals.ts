import { createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';

import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { payrollPrisma } from '../../../utils/payrollPrisma.js';
import { platformPrisma } from '../../../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../../../utils/tenantScope.js';
import { round2 } from '../../../utils/money.js';
import { notifyUsers, usersWithPermission } from '../../notifications.js';
import { isFeatureEnabled } from '../../features.js';
import { isAppEntitled } from '../../subscriptions.js';
import { forLiveEmployee } from '../../payroll/employeeLock.js';
import type { TeamScope } from '../scope.js';
import { RESUME_TYPES, TalentError, candidateEvent } from './hiring.js';

/**
 * Employee referrals (A20, WORKFLOW-GAP-RESEARCH-2026-10-30), made for a 1–20 person business
 * where the owner posts a job and the staff know someone.
 *
 * HR opens a job to referrals, with an optional bonus (paid once the hire has stayed N days, or
 * to the end of their probation) and who may refer (everyone, some departments, some branches).
 * The staff hear of it on the bell and in the employee app. An employee refers a friend with a
 * phone or an e-mail (a résumé if they have one), or shares their own link that opens the apply
 * page tagged to them; an employee may also apply themselves when HR allows it on that job.
 *
 * The same person is put forward once: the same phone or e-mail already on the opening, or
 * referred by anyone in the last six months, is turned down politely and the first referrer
 * keeps the credit. The check and the insert run under advisory locks on the phone and e-mail,
 * so two people referring the same friend at the same moment make one referral, not two.
 *
 * The referrer sees where their friend is in plain words (Received, In process, Interviewing,
 * Offered, Joined, Not taken forward), never the interview feedback, notes, salary or offer.
 *
 * The bonus: when the hire has stayed to the bonus date, a draft earning for the referrer goes to
 * Payroll's adjustments (keyed `referral-bonus:<id>`, made once whatever runs twice), which a
 * person approves there. If the hire left before the date it is forfeited. Without Payroll in
 * CLOR it shows as due, for HR to pay by hand and mark paid. Amounts are shown only to the
 * referrer, HR (Recruitment edit) and Payroll.
 */

const DAY = 86_400_000;
export const REPEAT_DAYS = 183;
const DEFAULT_BONUS_DAYS = 90;
/** A résumé sent with a referral: smaller than HR's own upload, as it comes from anyone's phone. */
export const REFERRAL_RESUME_MAX = 2 * 1024 * 1024;
const BONUS_PREFIX = 'referral-bonus:';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s\-()]{7,20}$/;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const text = (v: unknown, max: number) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
export const todayIst = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** The last ten digits: +91 98450 12345, 098450-12345 and 9845012345 are one phone. */
export const phoneKeyOf = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-10) : null; };
export const emailKeyOf = (v: unknown) => { const s = String(v ?? '').trim().toLowerCase(); return s || null; };
const money = (v: unknown) => (v == null ? null : Number(v));

/** What the referrer reads: where their friend is, in plain words, and nothing of how it went. */
export const REFERRER_WORD: Record<string, string> = { APPLIED: 'Received', SCREENING: 'In process', INTERVIEW: 'Interviewing', OFFER: 'Offered', HIRED: 'Joined', REJECTED: 'Not taken forward', WITHDRAWN: 'Not taken forward' };
const ENDED = ['HIRED', 'REJECTED', 'WITHDRAWN'];

export type Referrer = { id: string; accountId: string; orgId: string; name: string; userId: string | null; departmentId: string | null; branchId: string | null; status: string; email: string | null; phone: string | null };
const REFERRER_FIELDS = { id: true, accountId: true, orgId: true, name: true, userId: true, departmentId: true, branchId: true, status: true, email: true, phone: true } as const;

/** The signed-in person's own employee record, while they work here: the only right referring needs. */
export async function referrerByUser(orgId: string, userId: string): Promise<Referrer | null> {
  return peoplePrisma.employee.findFirst({ where: { orgId, userId, status: { notIn: ['LEFT', 'SUSPENDED'] }, anonymisedAt: null }, select: REFERRER_FIELDS });
}
export async function referrerById(orgId: string, id: string): Promise<Referrer | null> {
  return peoplePrisma.employee.findFirst({ where: { orgId, id, status: { notIn: ['LEFT', 'SUSPENDED'] }, anonymisedAt: null }, select: REFERRER_FIELDS });
}

/* ------------------------------------------------------------- HR's settings */

type Opening = Awaited<ReturnType<typeof peoplePrisma.jobOpening.findFirstOrThrow>>;

/** Whether this person may refer for (or apply to) this opening: the audience HR chose. */
export const mayRefer = (o: Pick<Opening, 'referAudience' | 'referDepartmentIds' | 'referBranchIds'>, e: Pick<Referrer, 'departmentId' | 'branchId'>) =>
  o.referAudience === 'DEPARTMENTS' ? Boolean(e.departmentId && o.referDepartmentIds.includes(e.departmentId))
    : o.referAudience === 'BRANCHES' ? Boolean(e.branchId && o.referBranchIds.includes(e.branchId))
      : true;

export const referralSettingsOf = (o: Opening, withMoney: boolean) => ({
  referralOpen: o.referralOpen, referralOpenedAt: o.referralOpenedAt, internalApply: o.internalApply,
  referAudience: o.referAudience, referDepartmentIds: o.referDepartmentIds, referBranchIds: o.referBranchIds,
  referralBonus: withMoney ? money(o.referralBonus) : null, referralBonusDays: o.referralBonusDays, hasBonus: o.referralBonus != null && Number(o.referralBonus) > 0,
});

type Who = { accountId: string; orgId: string; userId: string | null };

/**
 * HR turns referrals on or off for one opening, with the bonus, the days it waits for, who may
 * refer and whether staff may apply. Turning it on for an open job tells everyone who may refer.
 */
export async function setReferralSettings(who: Who, openingId: string, raw: any) {
  const o = await peoplePrisma.jobOpening.findFirst({ where: { id: openingId, orgId: who.orgId } });
  if (!o) throw new TalentError('No such opening.', 404);
  const open = raw?.referralOpen === undefined ? o.referralOpen : raw.referralOpen === true;
  const internalApply = raw?.internalApply === undefined ? o.internalApply : raw.internalApply === true;
  let bonus: number | null = raw?.referralBonus === undefined ? money(o.referralBonus) : raw.referralBonus === null || raw.referralBonus === '' ? null : Number(raw.referralBonus);
  if (bonus != null && (!Number.isFinite(bonus) || bonus < 0 || bonus > 10_00_000)) throw new TalentError('The bonus is an amount up to ₹10,00,000.');
  if (bonus === 0) bonus = null;
  let days: number | null = raw?.referralBonusDays === undefined ? o.referralBonusDays : raw.referralBonusDays === null || raw.referralBonusDays === '' ? null : Math.round(Number(raw.referralBonusDays));
  if (days != null && (!Number.isFinite(days) || days < 1 || days > 730)) throw new TalentError('Pay the bonus after 1 to 730 days, or leave it blank for the end of probation.');
  const audience = raw?.referAudience === undefined ? o.referAudience : ['ALL', 'DEPARTMENTS', 'BRANCHES'].includes(raw.referAudience) ? raw.referAudience : null;
  if (!audience) throw new TalentError('Choose who may refer: everyone, some departments or some branches.');
  const ids = (v: unknown, fallback: string[]) => (v === undefined ? fallback : [...new Set((Array.isArray(v) ? v : []).map(String).filter(Boolean))].slice(0, 100));
  const departmentIds = audience === 'DEPARTMENTS' ? ids(raw?.referDepartmentIds, o.referDepartmentIds) : [];
  const branchIds = audience === 'BRANCHES' ? ids(raw?.referBranchIds, o.referBranchIds) : [];
  if (audience === 'DEPARTMENTS') {
    if (!departmentIds.length) throw new TalentError('Pick the departments whose people may refer.');
    if ((await peoplePrisma.department.count({ where: { orgId: who.orgId, id: { in: departmentIds } } })) !== departmentIds.length) throw new TalentError('Pick departments from this company.');
  }
  if (audience === 'BRANCHES') {
    if (!branchIds.length) throw new TalentError('Pick the branches whose people may refer.');
    if ((await platformPrisma.branch.count({ where: { orgId: who.orgId, id: { in: branchIds } } })) !== branchIds.length) throw new TalentError('Pick branches from this company.');
  }
  if ((open || internalApply) && ['FILLED', 'CLOSED'].includes(o.status)) throw new TalentError('This opening is closed. Open it again first.', 409);
  const turningOn = (open && !o.referralOpen) || (internalApply && !o.internalApply);
  const row = await peoplePrisma.jobOpening.update({
    where: { id: o.id },
    data: { referralOpen: open, internalApply, referralBonus: bonus, referralBonusDays: days, referAudience: audience, referDepartmentIds: departmentIds, referBranchIds: branchIds },
  });
  if (turningOn && row.status === 'OPEN') await announce(who, row);
  return row;
}

/**
 * Everyone who may refer for an open job is told once it is open to them: on the bell (a CLOR
 * user) and in the employee app's What's new (from `referralOpenedAt`).
 */
export async function announce(who: Who, o: Opening) {
  if (o.status !== 'OPEN' || (!o.referralOpen && !o.internalApply)) return 0;
  await peoplePrisma.jobOpening.update({ where: { id: o.id }, data: { referralOpenedAt: new Date() } });
  const staff = await peoplePrisma.employee.findMany({ where: { orgId: o.orgId, status: { notIn: ['LEFT', 'SUSPENDED'] }, userId: { not: null }, anonymisedAt: null }, select: { userId: true, departmentId: true, branchId: true }, take: 5000 });
  const to = staff.filter((e) => mayRefer(o, e)).map((e) => e.userId!).filter((u) => u !== who.userId);
  const bonus = o.referralOpen && o.referralBonus && Number(o.referralBonus) > 0 ? ` Referral bonus ₹${Number(o.referralBonus).toLocaleString('en-IN')}.` : '';
  await notifyUsers(o.accountId, o.orgId, to, { kind: 'people.referral', title: o.referralOpen ? `Know someone for ${o.title}?` : `Open to apply: ${o.title}`, body: o.referralOpen ? `Refer them from Jobs.${bonus}` : 'You may apply from Jobs.', link: { app: 'people', screen: 'referMe', params: { opening: o.id } } });
  return to.length;
}

/* ------------------------------------------------------------ the employee */

/** The jobs this person may refer for or apply to, newest first; the bonus each one offers. */
export async function jobsFor(e: Referrer) {
  const rule = await referrerRuleOf(e.orgId);
  const stillHere = rule.forfeitIfReferrerLeaves ? ' and you still work here then' : '';
  const rows = await peoplePrisma.jobOpening.findMany({ where: { orgId: e.orgId, status: 'OPEN', OR: [{ referralOpen: true }, { internalApply: true }] }, orderBy: [{ referralOpenedAt: 'desc' }, { updatedAt: 'desc' }], take: 200 });
  const mine = rows.filter((o) => mayRefer(o, e));
  const [depts, branches, applied] = await Promise.all([
    peoplePrisma.department.findMany({ where: { orgId: e.orgId, id: { in: mine.map((o) => o.departmentId).filter(Boolean) as string[] } }, select: { id: true, name: true } }),
    platformPrisma.branch.findMany({ where: { orgId: e.orgId, id: { in: mine.map((o) => o.branchId).filter(Boolean) as string[] } }, select: { id: true, branchName: true } }),
    peoplePrisma.candidate.findMany({ where: { orgId: e.orgId, internalEmployeeId: e.id, openingId: { in: mine.map((o) => o.id) } }, select: { openingId: true } }),
  ]);
  const d = new Map(depts.map((x) => [x.id, x.name]));
  const b = new Map(branches.map((x) => [x.id, x.branchName]));
  const done = new Set(applied.map((a) => a.openingId));
  return mine.map((o) => ({
    id: o.id, title: o.title, places: o.places, description: o.description,
    department: o.departmentId ? d.get(o.departmentId) || null : null, where: (o.branchId ? b.get(o.branchId) : null) || o.location || null,
    canRefer: o.referralOpen, canApply: o.internalApply && !done.has(o.id), applied: done.has(o.id),
    bonus: o.referralOpen && o.referralBonus && Number(o.referralBonus) > 0 ? Number(o.referralBonus) : null,
    bonusAfter: `${o.referralBonusDays ? `${o.referralBonusDays} days after they join` : `once they finish probation (${DEFAULT_BONUS_DAYS} days if no probation is set)`}, if they are still here${stillHere}`,
    postedAt: o.referralOpenedAt || o.updatedAt,
  }));
}

async function openForReferral(e: Referrer, openingId: string, what: 'refer' | 'apply' = 'refer') {
  const o = await peoplePrisma.jobOpening.findFirst({ where: { id: String(openingId || ''), orgId: e.orgId } });
  if (!o) throw new TalentError('No such job.', 404);
  if (o.status !== 'OPEN' || (what === 'refer' ? !o.referralOpen : !o.internalApply)) throw new TalentError(what === 'refer' ? 'This job is not taking referrals now.' : 'This job is not open to staff applications.', 409, 'NOT_OPEN');
  if (!mayRefer(o, e)) throw new TalentError(what === 'refer' ? 'This job is open to referrals from another team.' : 'This job is open to another team.', 403, 'NOT_YOURS');
  return o;
}

/**
 * The duplicate check, under the caller's transaction and its advisory locks: the same phone or
 * e-mail on this opening, someone who works here, or a referral of them in the last six months.
 */
async function refusedAsDuplicate(tx: any, orgId: string, openingId: string, keys: { phone: string | null; email: string | null }, now: Date) {
  const or = [...(keys.phone ? [{ phoneKey: keys.phone }] : []), ...(keys.email ? [{ emailKey: keys.email }] : [])];
  if (!or.length) return null;
  /* Lock both keys, in one order, so two referrals of one friend wait for each other. */
  for (const k of [keys.phone ? `p:${keys.phone}` : null, keys.email ? `e:${keys.email}` : null].filter(Boolean).sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`referral:${orgId}:${k}`}))`;
  }
  const onOpening = await tx.candidate.findMany({ where: { orgId, openingId, anonymisedAt: null }, select: { email: true, phone: true } });
  if (onOpening.some((c: any) => (keys.email && emailKeyOf(c.email) === keys.email) || (keys.phone && phoneKeyOf(c.phone) === keys.phone))) return 'ON_OPENING';
  const recent = await tx.referral.findFirst({ where: { orgId, createdAt: { gte: new Date(now.getTime() - REPEAT_DAYS * DAY) }, OR: or }, select: { id: true } });
  if (recent) return 'REFERRED';
  const staff = await tx.employee.findMany({ where: { orgId, status: { not: 'LEFT' }, anonymisedAt: null, OR: [{ email: { not: null } }, { phone: { not: null } }] }, select: { email: true, phone: true }, take: 5000 });
  if (staff.some((s: any) => (keys.email && emailKeyOf(s.email) === keys.email) || (keys.phone && phoneKeyOf(s.phone) === keys.phone))) return 'WORKS_HERE';
  return null;
}
/* One answer for every refusal, so a referrer learns nothing about whether the person applied or works here; the reason is in the audit log for HR. */
export const DUPLICATE_WORDS = 'We can’t take this referral. HR already has this person’s details. Thank you for thinking of them.';
const REFUSAL_REASON: Record<string, string> = { ON_OPENING: 'already a candidate for this opening', REFERRED: 'referred by someone in the last six months', WORKS_HERE: 'already works here' };
async function auditRefusal(e: Referrer, o: Opening, reason: string, via: string) {
  await platformPrisma.auditLog.create({
    data: { accountId: o.accountId, orgId: o.orgId, branchId: '', entity: 'Referral', entityId: o.id, action: 'REFUSED_DUPLICATE', message: `Referral for ${o.title} by ${e.name} refused: ${REFUSAL_REASON[reason] || reason}`.slice(0, 500), metadata: JSON.stringify({ reason, referrerEmployeeId: e.id, via }), createdByUserId: e.userId || `portal:${e.id}`, correlationId: null },
  }).catch((err) => console.error('[referrals] refusal not audited:', err instanceof Error ? err.message : err)); // eslint-disable-line no-console
}

type Friend = { name: string; email: string | null; phone: string | null; relation: string | null; note: string | null; resumeUrl?: string | null };
function friendInput(raw: any, needContact = true): Friend {
  const name = text(raw?.name, 120);
  if (!name) throw new TalentError('Give their name.');
  const email = text(raw?.email, 200);
  if (email && !EMAIL.test(email)) throw new TalentError('That e-mail address does not look right.');
  const phone = text(raw?.phone, 40);
  if (phone && (!PHONE.test(phone) || !phoneKeyOf(phone))) throw new TalentError('That phone number does not look right.');
  if (needContact && !email && !phone) throw new TalentError('Give their phone number or e-mail, so HR can reach them.');
  return { name, email, phone, relation: text(raw?.relation, 120), note: text(raw?.note, 2000) };
}

/** HR with Recruitment edit, told of a new candidate from a referral. */
async function tellHr(o: Opening, title: string, body: string) {
  const hr = await usersWithPermission(o.accountId, o.orgId, 'PEOPLE::Recruitment::EDIT').catch(() => [] as string[]);
  await notifyUsers(o.accountId, o.orgId, hr, { kind: 'people.hiring', title, body, link: { app: 'people', screen: 'candidates', params: { opening: o.id } } });
}

/**
 * An employee refers a friend: a candidate at Applied with source Referral and the referrer, the
 * résumé if given (PDF or Word, checked by its bytes, up to 5 MB), and the bonus as promised today.
 */
export async function refer(e: Referrer, raw: any, file: { name: string; mime: string; data: Buffer } | null, now = new Date()) {
  const o = await openForReferral(e, raw?.openingId);
  const f = friendInput(raw);
  if (file) {
    if (!RESUME_TYPES.has(file.mime)) throw new TalentError('A résumé is a PDF or Word file.');
    if (!file.data.length || file.data.length > REFERRAL_RESUME_MAX) throw new TalentError('A résumé sent with a referral is up to 2 MB.');
  }
  const keys = { phone: phoneKeyOf(f.phone), email: emailKeyOf(f.email) };
  if ((keys.phone && keys.phone === phoneKeyOf(e.phone)) || (keys.email && keys.email === emailKeyOf(e.email))) throw new TalentError('That is you. To apply yourself, use Apply on the job.', 400, 'SELF');
  return createReferral(e, o, f, keys, 'FORM', file, now);
}

async function createReferral(e: Referrer, o: Opening, f: Friend, keys: { phone: string | null; email: string | null }, via: 'FORM' | 'LINK', file: { name: string; mime: string; data: Buffer } | null, now: Date) {
  /* The referrer acts as themselves: their CLOR user, or the employee app (a 'portal:' id shows as Employee app on the timeline). */
  const who = { accountId: o.accountId, orgId: o.orgId, userId: via === 'LINK' ? null : e.userId || `portal:${e.id}` };
  const made = await peoplePrisma.$transaction(async (tx) => {
    const dup = await refusedAsDuplicate(tx, o.orgId, o.id, keys, now);
    if (dup) throw Object.assign(new TalentError(DUPLICATE_WORDS, 409, 'DUPLICATE_REFERRAL'), { reason: dup });
    const c = await tx.candidate.create({
      data: {
        accountId: o.accountId, orgId: o.orgId, openingId: o.id, stage: 'APPLIED', name: f.name, email: f.email, phone: f.phone, source: 'REFERRAL', sourceDetail: e.name.slice(0, 120), createdByUserId: e.userId,
        ...(f.resumeUrl ? { resumeUrl: f.resumeUrl } : {}),
        ...(file ? { resumeName: file.name.slice(0, 200), resumeMime: file.mime, resumeSize: file.data.length, resumeData: file.data } : {}),
      },
    });
    const how = [via === 'LINK' ? `Applied through ${e.name}’s referral link.` : `Referred by ${e.name}.`, f.relation ? `How they know them: ${f.relation}.` : null, f.note].filter(Boolean).join(' ');
    await candidateEvent(tx, who, c.id, { kind: 'APPLIED', toStage: 'APPLIED', text: how });
    const r = await tx.referral.create({ data: { accountId: o.accountId, orgId: o.orgId, openingId: o.id, candidateId: c.id, referrerEmployeeId: e.id, via, relation: f.relation, note: f.note, phoneKey: keys.phone, emailKey: keys.email, bonusAmount: o.referralBonus, bonusDays: o.referralBonusDays } });
    return { candidateId: c.id, referralId: r.id };
  }).catch(async (err) => {
    if (err instanceof TalentError && err.code === 'DUPLICATE_REFERRAL') await auditRefusal(e, o, (err as any).reason, via);
    throw err;
  });
  await tellHr(o, `New referral: ${f.name}`, `${o.title} · referred by ${e.name}`);
  return made;
}

/* The referrer's own link: the token is an HMAC of the row, so it can be shown again; only its sha256 is stored. */
/* No fixed-text fallback: without a secret, production makes no links; a developer's machine uses one for this process only. */
const devKey = randomBytes(32);
const linkKey = () => {
  const ikm = process.env.REFERRAL_LINK_SECRET || process.env.JWT_SECRET;
  if (!ikm) {
    if (process.env.NODE_ENV === 'production') throw new TalentError('Referral links are not set up on this server yet. Ask HR to tell CLOR support.', 503, 'NO_LINK_SECRET');
    return devKey;
  }
  return Buffer.from(hkdfSync('sha256', ikm, '', 'clor/referral-link/v1', 32));
};
const tokenOf = (id: string) => createHmac('sha256', linkKey()).update(`referral-link:${id}`).digest('hex').slice(0, 48);
const appUrl = () => process.env.APP_URL || 'http://localhost:5173';

/** My link for one job, made the first time I ask, and the words to send with it on WhatsApp. */
export async function linkFor(e: Referrer, openingId: string) {
  const o = await openForReferral(e, openingId);
  let row = await peoplePrisma.referralLink.findUnique({ where: { openingId_referrerEmployeeId: { openingId: o.id, referrerEmployeeId: e.id } } });
  if (!row) {
    const id = `rl${randomBytes(12).toString('hex')}`;
    try {
      row = await peoplePrisma.referralLink.create({ data: { id, accountId: o.accountId, orgId: o.orgId, openingId: o.id, referrerEmployeeId: e.id, tokenHash: sha256(tokenOf(id)) } });
    } catch {
      /* Two taps at once: the other one made it. */
      row = await peoplePrisma.referralLink.findUniqueOrThrow({ where: { openingId_referrerEmployeeId: { openingId: o.id, referrerEmployeeId: e.id } } });
    }
  }
  /* The secret was rotated since the link was made: the link shown now is the one that works. */
  const hash = sha256(tokenOf(row.id));
  if (row.tokenHash !== hash) row = await peoplePrisma.referralLink.update({ where: { id: row.id }, data: { tokenHash: hash } });
  const org = await platformPrisma.org.findUnique({ where: { id: o.orgId }, select: { name: true } });
  const link = `${appUrl()}/api/people/refer/${tokenOf(row.id)}`;
  const shareText = `${org?.name || 'We'} ${org?.name ? 'is' : 'are'} hiring: ${o.title}. I think you would be good for it. Apply here: ${link}`;
  return { link, shareText };
}

/** A link's opening and referrer, outside any company (the public page), or null when it no longer works. */
export async function byLinkToken(token: string) {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const l = await outsideTenant('referral link: find it', () => peoplePrisma.referralLink.findUnique({ where: { tokenHash: sha256(token) } }));
  if (!l) return null;
  return runInTenant(l.orgId, async () => {
    const [o, e, org] = await Promise.all([
      peoplePrisma.jobOpening.findFirst({ where: { id: l.openingId, orgId: l.orgId } }),
      referrerById(l.orgId, l.referrerEmployeeId),
      platformPrisma.org.findUnique({ where: { id: l.orgId }, select: { name: true } }),
    ]);
    if (!o) return null;
    const live = Boolean(e && o.status === 'OPEN' && o.referralOpen && mayRefer(o, e));
    return { link: l, opening: o, referrer: e, orgName: org?.name || '', live };
  });
}

/**
 * The friend applies through the referrer's link. A person already put forward is thanked the
 * same way (a stranger learns nothing about who applied); their note is kept on the card.
 */
export async function applyThroughLink(found: NonNullable<Awaited<ReturnType<typeof byLinkToken>>>, raw: any, now = new Date()) {
  if (!found.live || !found.referrer) throw new TalentError('This job is no longer taking applications.', 410);
  const f = friendInput(raw);
  const resumeUrl = text(raw?.resumeUrl, 500);
  if (resumeUrl && !/^https:\/\//i.test(resumeUrl)) throw new TalentError('A résumé link starts with https://');
  const keys = { phone: phoneKeyOf(f.phone), email: emailKeyOf(f.email) };
  try {
    await createReferral(found.referrer, found.opening, { ...f, relation: null, resumeUrl }, keys, 'LINK', null, now);
    return { duplicate: false };
  } catch (e) {
    if (e instanceof TalentError && e.code === 'DUPLICATE_REFERRAL') return { duplicate: true };
    throw e;
  }
}

/** I apply myself: a candidate on the job with my name and contacts, marked as someone who works here. */
export async function applyInternal(e: Referrer, openingId: string, raw: any) {
  const o = await openForReferral(e, openingId, 'apply');
  const note = text(raw?.note, 2000);
  return peoplePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`internal-apply:${o.id}:${e.id}`}))`;
    if (await tx.candidate.findFirst({ where: { orgId: e.orgId, openingId: o.id, internalEmployeeId: e.id }, select: { id: true } })) throw new TalentError('You have already applied for this job.', 409, 'DUPLICATE');
    const c = await tx.candidate.create({ data: { accountId: e.accountId, orgId: e.orgId, openingId: o.id, stage: 'APPLIED', name: e.name, email: e.email, phone: e.phone, source: 'INTERNAL', sourceDetail: 'Works here', internalEmployeeId: e.id, createdByUserId: e.userId } });
    await candidateEvent(tx, { accountId: e.accountId, orgId: e.orgId, userId: e.userId || `portal:${e.id}` }, c.id, { kind: 'APPLIED', toStage: 'APPLIED', text: note ? `Applied from within. ${note}` : 'Applied from within' });
    return c;
  }).then(async (c) => {
    await tellHr(o, `Applied from within: ${e.name}`, o.title);
    return c;
  });
}

/** My referrals and my own applications, each with its stage in plain words; the bonus is mine to see. */
export async function mine(e: Referrer) {
  const [refs, apps] = await Promise.all([
    peoplePrisma.referral.findMany({ where: { orgId: e.orgId, referrerEmployeeId: e.id }, orderBy: { createdAt: 'desc' }, take: 200 }),
    peoplePrisma.candidate.findMany({ where: { orgId: e.orgId, internalEmployeeId: e.id }, orderBy: { createdAt: 'desc' }, select: { id: true, openingId: true, stage: true, createdAt: true }, take: 50 }),
  ]);
  const cands = new Map((await peoplePrisma.candidate.findMany({ where: { orgId: e.orgId, id: { in: refs.map((r) => r.candidateId) } }, select: { id: true, name: true, stage: true, anonymisedAt: true } })).map((c) => [c.id, c]));
  const titles = new Map((await peoplePrisma.jobOpening.findMany({ where: { orgId: e.orgId, id: { in: [...refs.map((r) => r.openingId), ...apps.map((a) => a.openingId)] } }, select: { id: true, title: true } })).map((o) => [o.id, o.title]));
  return {
    referrals: refs.map((r) => {
      const c = cands.get(r.candidateId);
      const stage = !c || c.anonymisedAt ? 'REJECTED' : c.stage;
      return { id: r.id, name: c && !c.anonymisedAt ? c.name : 'Former candidate', job: titles.get(r.openingId) || '', status: REFERRER_WORD[stage] || 'Received', referredAt: r.createdAt, via: r.via, bonus: bonusForReferrer(r) };
    }),
    applications: apps.map((a) => ({ id: a.id, job: titles.get(a.openingId) || '', status: a.stage === 'HIRED' ? 'Moved to this job' : REFERRER_WORD[a.stage] || 'Received', appliedAt: a.createdAt })),
  };
}
const BONUS_WORDS: Record<string, string> = { WAITING: 'Due on', DUE: 'Due now', SENT: 'With Payroll', PAID: 'Paid', FORFEITED: 'Not payable' };
const bonusForReferrer = (r: { bonusAmount: unknown; bonusStatus: string; bonusDueOn: string | null; bonusNote: string | null }) => {
  if (r.bonusAmount == null || !Number(r.bonusAmount)) return null;
  return { amount: Number(r.bonusAmount), status: r.bonusStatus, words: r.bonusStatus === 'NONE' ? 'If they join and stay' : BONUS_WORDS[r.bonusStatus] || '', dueOn: r.bonusDueOn, note: ['FORFEITED', 'WAITING'].includes(r.bonusStatus) ? r.bonusNote : null };
};

/**
 * When a bonus is due, from the hire's record as it is now: N days after joining, or the end of
 * their probation, or 90 days after joining when the record has no probation date (said so).
 */
export function bonusDateOf(r: { bonusDays: number | null }, hire: { dateOfJoining: string | null; probationEndDate: string | null } | null | undefined) {
  const joined = hire?.dateOfJoining || todayIst();
  if (r.bonusDays) return { dueOn: plusDays(joined, r.bonusDays), note: `Due ${r.bonusDays} days after they joined.` };
  if (hire?.probationEndDate && hire.probationEndDate > joined) return { dueOn: hire.probationEndDate, note: 'Due when their probation ends.' };
  return { dueOn: plusDays(joined, DEFAULT_BONUS_DAYS), note: `Due ${DEFAULT_BONUS_DAYS} days after they joined: their record has no probation end date.` };
}

/* ------------------------------------------------------- the candidate moves */

/**
 * After a candidate moves: a referral's story ends (Joined, Not taken forward) and the referrer
 * is told once; a hire starts the bonus clock, from the joining date to the bonus date. A
 * candidate brought back from Not taken forward opens the story again.
 */
export async function afterCandidateMoved(accountId: string, orgId: string, candidateId: string) {
  const r = await peoplePrisma.referral.findFirst({ where: { orgId, candidateId } });
  if (!r) return;
  const c = await peoplePrisma.candidate.findFirst({ where: { id: candidateId, orgId }, select: { name: true, stage: true, employeeId: true, openingId: true } });
  if (!c) return;
  if (!ENDED.includes(c.stage)) {
    if (r.outcome) await peoplePrisma.referral.updateMany({ where: { id: r.id, outcome: { not: null } }, data: { outcome: null, outcomeAt: null } });
    return;
  }
  const outcome = c.stage === 'HIRED' ? 'JOINED' : 'NOT_TAKEN';
  const data: Record<string, unknown> = { outcome, outcomeAt: new Date() };
  if (outcome === 'JOINED' && r.bonusStatus === 'NONE' && r.bonusAmount != null && Number(r.bonusAmount) > 0 && c.employeeId) {
    const hire = await peoplePrisma.employee.findFirst({ where: { id: c.employeeId, orgId }, select: { dateOfJoining: true, probationEndDate: true } });
    const when = bonusDateOf(r, hire);
    data.bonusStatus = 'WAITING';
    data.bonusDueOn = when.dueOn;
    data.bonusNote = when.note;
  }
  const moved = await peoplePrisma.referral.updateMany({ where: { id: r.id, outcome: null }, data });
  if (!moved.count) return;
  const referrer = await peoplePrisma.employee.findFirst({ where: { id: r.referrerEmployeeId, orgId }, select: { userId: true, status: true } });
  const title = (await peoplePrisma.jobOpening.findFirst({ where: { id: c.openingId, orgId }, select: { title: true } }))?.title || 'the job';
  if (referrer?.userId && referrer.status !== 'LEFT') {
    await notifyUsers(accountId, orgId, [referrer.userId], {
      kind: 'people.referral',
      title: outcome === 'JOINED' ? `${c.name} is joining as ${title}` : `${c.name} was not taken forward for ${title}`,
      body: outcome === 'JOINED' ? (data.bonusDueOn ? `Thank you for the referral. Your bonus is due on ${data.bonusDueOn} if they are still here.` : 'Thank you for the referral.') : 'Thank you for the referral.',
      link: { app: 'people', screen: 'referMe' },
    });
  }
}

/* ---------------------------------------------------------------- HR's view */

export type HrView = { money: boolean; scope: TeamScope };

const HR_STATUS: Record<string, (r: any, c: any) => boolean> = {
  all: () => true,
  open: (_r, c) => c && !ENDED.includes(c.stage),
  joined: (_r, c) => c?.stage === 'HIRED',
  notTaken: (_r, c) => !c || ['REJECTED', 'WITHDRAWN'].includes(c.stage),
  bonusDue: (r) => ['DUE', 'SENT'].includes(r.bonusStatus),
  bonusWaiting: (r) => r.bonusStatus === 'WAITING',
  bonusPaid: (r) => r.bonusStatus === 'PAID',
};

/** The Referrals list for HR: candidate, job, referrer, stage, bonus; filtered, and the referrer inside the viewer's team. */
export async function listReferrals(orgId: string, q: { status?: string; openingId?: string; referrerId?: string; q?: string }, view: HrView) {
  const where: any = { orgId, ...(q.openingId ? { openingId: q.openingId } : {}), ...(q.referrerId ? { referrerEmployeeId: q.referrerId } : {}) };
  if (!view.scope.all) where.referrerEmployeeId = q.referrerId ? (view.scope.ids.includes(q.referrerId) ? q.referrerId : '__none__') : { in: view.scope.ids };
  const rows = await peoplePrisma.referral.findMany({ where, orderBy: { createdAt: 'desc' }, take: 1000 });
  const [cands, openings, people] = await Promise.all([
    peoplePrisma.candidate.findMany({ where: { orgId, id: { in: rows.map((r) => r.candidateId) } }, select: { id: true, name: true, stage: true, anonymisedAt: true, employeeId: true, phone: true, email: true } }),
    peoplePrisma.jobOpening.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.openingId))] } }, select: { id: true, title: true } }),
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.referrerEmployeeId))] } }, select: { id: true, name: true, code: true, status: true } }),
  ]);
  const c = new Map(cands.map((x) => [x.id, x]));
  const o = new Map(openings.map((x) => [x.id, x.title]));
  const p = new Map(people.map((x) => [x.id, x]));
  const test = HR_STATUS[q.status || 'all'] || HR_STATUS.all;
  const needle = String(q.q || '').trim().toLowerCase();
  const out = rows
    .filter((r) => test(r, c.get(r.candidateId)))
    .map((r) => {
      const cand = c.get(r.candidateId);
      const by = p.get(r.referrerEmployeeId);
      return {
        id: r.id, candidateId: r.candidateId, candidate: cand && !cand.anonymisedAt ? cand.name : 'Former candidate', stage: cand && !cand.anonymisedAt ? cand.stage : 'REJECTED',
        openingId: r.openingId, job: o.get(r.openingId) || '', referrerId: r.referrerEmployeeId, referrer: by?.name || '', referrerCode: by?.code || null, referrerLeft: by?.status === 'LEFT',
        via: r.via, relation: r.relation, referredAt: r.createdAt,
        bonusStatus: r.bonusStatus, bonusDueOn: r.bonusDueOn, bonusNote: r.bonusNote, bonusAmount: view.money ? money(r.bonusAmount) : null, hasBonus: r.bonusAmount != null && Number(r.bonusAmount) > 0,
        bonusAdjustmentId: view.money ? r.bonusAdjustmentId : null, bonusPaidAt: r.bonusPaidAt,
      };
    })
    .filter((r) => !needle || [r.candidate, r.job, r.referrer].some((w) => w.toLowerCase().includes(needle)));
  const counts = Object.fromEntries(Object.keys(HR_STATUS).map((k) => [k, rows.filter((r) => HR_STATUS[k](r, c.get(r.candidateId))).length]));
  return { rows: out, counts };
}

/** On a candidate's card, for HR: who referred them, how they know them, and when. */
export async function referralOfCandidate(orgId: string, candidateId: string) {
  const r = await peoplePrisma.referral.findFirst({ where: { orgId, candidateId } });
  if (!r) return null;
  const by = await peoplePrisma.employee.findFirst({ where: { id: r.referrerEmployeeId, orgId }, select: { id: true, name: true, code: true } });
  return { id: r.id, referrerId: r.referrerEmployeeId, referrer: by?.name || '', referrerCode: by?.code || null, via: r.via, relation: r.relation, note: r.note, referredAt: r.createdAt, bonusStatus: r.bonusStatus, bonusDueOn: r.bonusDueOn };
}

/** Referrals by employee, hires from referrals, and bonuses waiting, due and paid. */
export async function referralReport(orgId: string, view: HrView) {
  const { rows } = await listReferrals(orgId, {}, view);
  const by = new Map<string, { referrerId: string; referrer: string; referred: number; inProcess: number; joined: number; bonusDue: number | null; bonusPaid: number | null }>();
  for (const r of rows) {
    const x = by.get(r.referrerId) || { referrerId: r.referrerId, referrer: r.referrer, referred: 0, inProcess: 0, joined: 0, bonusDue: view.money ? 0 : null, bonusPaid: view.money ? 0 : null };
    x.referred += 1;
    if (!ENDED.includes(r.stage)) x.inProcess += 1;
    if (r.stage === 'HIRED') x.joined += 1;
    if (view.money && r.bonusAmount) {
      if (['DUE', 'SENT', 'WAITING'].includes(r.bonusStatus)) x.bonusDue = round2((x.bonusDue || 0) + r.bonusAmount);
      if (r.bonusStatus === 'PAID') x.bonusPaid = round2((x.bonusPaid || 0) + r.bonusAmount);
    }
    by.set(r.referrerId, x);
  }
  const sum = (s: string[]) => (view.money ? round2(rows.filter((r) => s.includes(r.bonusStatus)).reduce((t, r) => t + (r.bonusAmount || 0), 0)) : null);
  return {
    byEmployee: [...by.values()].sort((a, b) => b.joined - a.joined || b.referred - a.referred),
    totals: { referred: rows.length, joined: rows.filter((r) => r.stage === 'HIRED').length, inProcess: rows.filter((r) => !ENDED.includes(r.stage)).length, bonusWaiting: sum(['WAITING']), bonusDue: sum(['DUE', 'SENT']), bonusPaid: sum(['PAID']), bonusForfeited: rows.filter((r) => r.bonusStatus === 'FORFEITED').length },
    hires: rows.filter((r) => r.stage === 'HIRED').map((r) => ({ id: r.id, candidate: r.candidate, job: r.job, referrer: r.referrer, bonusStatus: r.bonusStatus, bonusDueOn: r.bonusDueOn, bonusAmount: r.bonusAmount })),
  };
}

/* -------------------------------------------------------------- the bonus */

/** The open month containing today, or else the next one to open (the same rule as leave encashment). */
async function periodToPayIn(orgId: string, today: string) {
  const open = { orgId, isLocked: false, status: 'OPEN' };
  return (await payrollPrisma.payrollPeriod.findFirst({ where: { ...open, startDate: { lte: today }, endDate: { gte: today } }, orderBy: { startDate: 'asc' }, select: { id: true, name: true } }))
    || payrollPrisma.payrollPeriod.findFirst({ where: { ...open, startDate: { gt: today } }, orderBy: { startDate: 'asc' }, select: { id: true, name: true } });
}

/** The company's referral bonus earning, by its code only (a component merely named like it is not taken), made the first time it is needed. */
async function bonusComponent(accountId: string, orgId: string, userId: string) {
  const made = await payrollPrisma.salaryComponent.upsert({
    where: { orgId_code: { orgId, code: 'REFERRAL_BONUS' } },
    update: {},
    create: { accountId, orgId, code: 'REFERRAL_BONUS', name: 'Referral bonus', description: 'Paid to an employee whose referral joined and stayed to the bonus date: added by People.', type: 'EARNING', calculationMethod: 'VARIABLE', appliesTo: 'STRUCTURE', prorate: false, isVariable: true, isTaxable: true, displayOrder: 910, createdByUserId: userId },
    select: { id: true },
  });
  return made.id;
}

export const payrollOn = async (accountId: string, orgId: string) => (await isAppEntitled(accountId, 'payroll').catch(() => false)) && (await isFeatureEnabled(accountId, orgId, 'payroll'));

/** The referral row, locked for the rest of the transaction: send, forfeit and paid take turns on one bonus. */
const lockReferral = async (tx: any, orgId: string, id: string) => {
  const rows = await tx.$queryRaw`SELECT id FROM "Referral" WHERE id = ${id} AND "orgId" = ${orgId} FOR UPDATE`;
  if (!(rows as unknown[]).length) throw new TalentError('No such referral.', 404);
  return tx.referral.findFirstOrThrow({ where: { id, orgId } });
};
const LOCKED = { timeout: 30_000, maxWait: 15_000 };
export const SETTLEMENT_WORDS = 'They have left: pay it in their final settlement or by hand, then mark it paid.';

/**
 * One due bonus to Payroll as a draft earning on the referrer, keyed `referral-bonus:<id>`, under
 * the referral's row lock: a second send (the job and HR's button at once) waits and finds it
 * sent, and a forfeit waits until the draft exists and then voids it. Never throws for a reason
 * Payroll gives; the bonus stays Due with that reason. A referrer who has left is paid in their
 * final settlement, never as a draft on a payslip that will not be run.
 */
export async function sendBonusToPayroll(orgId: string, referralId: string, today = todayIst()) {
  return peoplePrisma.$transaction(async (tx) => {
    const r = await lockReferral(tx, orgId, referralId);
    if (r.bonusStatus === 'SENT') return { sent: true, why: null as string | null };
    if (r.bonusStatus !== 'DUE') throw new TalentError('This bonus is not due.', 409);
    const stay = async (why: string) => {
      await tx.referral.update({ where: { id: r.id }, data: { bonusNote: why } });
      return { sent: false, why };
    };
    const referrer = await tx.employee.findFirst({ where: { id: r.referrerEmployeeId, orgId }, select: { status: true, branchId: true } });
    if (!referrer || referrer.status === 'LEFT') return stay(SETTLEMENT_WORDS);
    if (!(await payrollOn(r.accountId, orgId))) return stay('This company does not run payroll in CLOR: pay it by hand and mark it paid.');
    const amount = Number(r.bonusAmount || 0);
    if (!(amount > 0)) return stay('No amount was promised.');
    const period = await periodToPayIn(orgId, today);
    if (!period) return stay('Payroll has no open month to pay it in. Open one, then send it again.');
    const [opening, cand] = await Promise.all([
      tx.jobOpening.findFirst({ where: { id: r.openingId, orgId }, select: { title: true, openedByUserId: true, createdByUserId: true } }),
      tx.candidate.findFirst({ where: { id: r.candidateId, orgId }, select: { name: true } }),
    ]);
    /* Made by the system, not by HR: the HR person who set the bonus may still approve it in Payroll. */
    const maker = 'system:referral-bonus';
    const id = `${BONUS_PREFIX}${r.id}`;
    try {
      const componentId = await bonusComponent(r.accountId, orgId, opening?.openedByUserId || opening?.createdByUserId || maker);
      const made = await forLiveEmployee(orgId, r.referrerEmployeeId, async (ptx) => {
        const prior = await ptx.payrollAdjustment.findUnique({ where: { id } });
        if (prior && prior.status !== 'CANCELLED') return prior;
        const data = { componentId, periodId: period.id, type: 'EARNING', amount, reason: `Referral bonus: ${cand?.name || 'a referral'} joined as ${opening?.title || 'a hire'}`.slice(0, 240), reference: id, status: 'DRAFT', approvedAt: null, approvedByUserId: null, consumedByRunId: null };
        if (prior) return ptx.payrollAdjustment.update({ where: { id }, data });
        return ptx.payrollAdjustment.create({ data: { id, accountId: r.accountId, orgId, branchId: referrer.branchId || null, employeeId: r.referrerEmployeeId, createdByUserId: maker, ...data } });
      });
      await tx.referral.update({ where: { id: r.id }, data: { bonusStatus: 'SENT', bonusAdjustmentId: made.id, bonusNote: `Draft earning in ${period.name}, for Payroll to approve.` } });
      return { sent: true, why: null };
    } catch (e) {
      console.error('[referrals] bonus not sent to payroll:', e instanceof Error ? e.message : e); // eslint-disable-line no-console
      return stay('It could not reach Payroll just now. Send it again.');
    }
  }, LOCKED);
}

/** HR paid it by hand (no Payroll in CLOR, a referrer who has left, or paid outside it): Due becomes Paid, once. */
export async function markBonusPaid(who: Who, referralId: string) {
  await peoplePrisma.$transaction(async (tx) => {
    const r = await lockReferral(tx, who.orgId, referralId);
    if (r.bonusStatus !== 'DUE') throw new TalentError('Only a bonus that is due can be marked paid. One with Payroll is paid on the payslip.', 409);
    await tx.referral.update({ where: { id: r.id }, data: { bonusStatus: 'PAID', bonusPaidAt: new Date(), bonusPaidByUserId: who.userId, bonusNote: 'Paid by hand.' } });
  }, LOCKED);
}

/**
 * HR decides a bonus is not payable (for example the hire was let go in probation), with the
 * reason. Under the row lock; a draft earning already with Payroll is voided (deleted while a
 * draft, cancelled once approved); one a payslip has used cannot be taken back here.
 */
export async function forfeitBonus(who: Who, referralId: string, reason: unknown) {
  const why = text(reason, 300);
  if (!why) throw new TalentError('Say why the bonus is not payable.');
  await forfeitLocked(who.orgId, referralId, why, ['WAITING', 'DUE', 'SENT']);
}

async function forfeitLocked(orgId: string, referralId: string, why: string, from: string[]) {
  return peoplePrisma.$transaction(async (tx) => {
    const r = await lockReferral(tx, orgId, referralId);
    if (!from.includes(r.bonusStatus)) {
      if (from.length === 1) return false;
      throw new TalentError('Only a bonus that is waiting, due or with Payroll can be set as not payable.', 409);
    }
    const id = `${BONUS_PREFIX}${r.id}`;
    const adj = await payrollPrisma.payrollAdjustment.findUnique({ where: { id } });
    if (adj?.status === 'CONSUMED') throw new TalentError('This bonus is already on a payslip: recover it in Payroll instead.', 409);
    if (adj?.status === 'DRAFT') await payrollPrisma.payrollAdjustment.deleteMany({ where: { id, orgId, status: 'DRAFT' } });
    else if (adj && adj.status !== 'CANCELLED') await payrollPrisma.payrollAdjustment.updateMany({ where: { id, orgId, status: { not: 'CONSUMED' } }, data: { status: 'CANCELLED' } });
    await tx.referral.update({ where: { id: r.id }, data: { bonusStatus: 'FORFEITED', bonusNote: why, bonusAdjustmentId: null } });
    return true;
  }, LOCKED);
}

/* The company's rule for a referrer who leaves before the date (PeopleSetting; default: not paid). */
export async function referrerRuleOf(orgId: string) {
  const row = await peoplePrisma.peopleSetting.findUnique({ where: { orgId }, select: { referralForfeitIfReferrerLeaves: true } });
  return { forfeitIfReferrerLeaves: row?.referralForfeitIfReferrerLeaves ?? true };
}
export async function setReferrerRule(who: Who, raw: any) {
  const v = raw?.forfeitIfReferrerLeaves !== false;
  await peoplePrisma.peopleSetting.upsert({ where: { orgId: who.orgId }, create: { accountId: who.accountId, orgId: who.orgId, referralForfeitIfReferrerLeaves: v, updatedByUserId: who.userId }, update: { referralForfeitIfReferrerLeaves: v, updatedByUserId: who.userId } });
  return { forfeitIfReferrerLeaves: v };
}

/** Still here on a day: not left, or left after it (serving notice counts as here). */
const hereOn = (p: { status: string; dateOfLeaving: string | null } | null | undefined, day: string) => Boolean(p && (p.status !== 'LEFT' || (p.dateOfLeaving && p.dateOfLeaving >= day)));

/**
 * The bonus clock, run by the talent job every few hours. The date is worked out again on each
 * run from the hire's record as it is now (a moved joining date or an extended probation counts).
 * A hire who left before the date forfeits the bonus; so does a referrer, under the company's
 * rule. One still here on the date makes it due, and it goes to Payroll when the company runs it.
 * The status moves with a guarded update, so the job and a second instance never both claim one.
 */
export async function settleBonuses(orgId: string, today = todayIst()) {
  const waiting = await peoplePrisma.referral.findMany({ where: { orgId, bonusStatus: 'WAITING' }, take: 500 });
  if (!waiting.length) return { due: 0, forfeited: 0 };
  const rule = await referrerRuleOf(orgId);
  const cands = new Map((await peoplePrisma.candidate.findMany({ where: { orgId, id: { in: waiting.map((w) => w.candidateId) } }, select: { id: true, employeeId: true, name: true } })).map((c) => [c.id, c]));
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...waiting.map((w) => w.referrerEmployeeId), ...[...cands.values()].map((c) => c.employeeId).filter(Boolean) as string[]] } }, select: { id: true, status: true, dateOfLeaving: true, dateOfJoining: true, probationEndDate: true, userId: true } })).map((p) => [p.id, p]));
  let due = 0;
  let forfeited = 0;
  for (const w of waiting) {
    const cand = cands.get(w.candidateId);
    const hire = cand?.employeeId ? people.get(cand.employeeId) : null;
    const referrer = people.get(w.referrerEmployeeId);
    const when = bonusDateOf(w, hire);
    if (when.dueOn !== w.bonusDueOn || when.note !== w.bonusNote) await peoplePrisma.referral.updateMany({ where: { id: w.id, bonusStatus: 'WAITING' }, data: { bonusDueOn: when.dueOn, bonusNote: when.note } });
    const hireGone = !hire || (hire.status === 'LEFT' && !hereOn(hire, when.dueOn));
    const referrerGone = rule.forfeitIfReferrerLeaves && referrer?.status === 'LEFT' && !hereOn(referrer, when.dueOn);
    if (hireGone || referrerGone) {
      if (await forfeitLocked(orgId, w.id, hireGone ? 'The hire left before the bonus date.' : 'The referrer left before the bonus date.', ['WAITING'])) forfeited += 1;
      continue;
    }
    if (when.dueOn > today) continue;
    const claimed = await peoplePrisma.referral.updateMany({ where: { id: w.id, bonusStatus: 'WAITING' }, data: { bonusStatus: 'DUE', bonusNote: null } });
    if (!claimed.count) continue;
    due += 1;
    const sent = await sendBonusToPayroll(orgId, w.id, today);
    const name = cand?.name || 'Your referral';
    const hr = await usersWithPermission(w.accountId, orgId, 'PEOPLE::Recruitment::EDIT').catch(() => [] as string[]);
    const settlement = sent.why === SETTLEMENT_WORDS;
    await notifyUsers(w.accountId, orgId, hr, {
      kind: 'people.referral',
      title: sent.sent ? `Referral bonus with Payroll: ${name}` : `Referral bonus due: ${name}`,
      body: sent.sent ? 'A draft earning waits for approval in Payroll → Adjustments.' : sent.why,
      link: settlement ? { app: 'payroll', screen: 'settlements' } : { app: 'people', screen: 'referrals', params: { status: 'bonusDue' } },
    });
    if (referrer?.userId && referrer.status !== 'LEFT') await notifyUsers(w.accountId, orgId, [referrer.userId], { kind: 'people.referral', title: `Your referral bonus for ${name} is due`, body: sent.sent ? 'It goes on your payslip once Payroll approves it.' : 'HR pays it.', link: { app: 'people', screen: 'referMe' } });
  }
  return { due, forfeited };
}

/**
 * Referrals whose candidate's story ended but the referral did not hear of it (the call after a
 * move failed): told now, and a hire's bonus clock started.
 */
export async function sweepOutcomes(accountId: string, orgId: string) {
  const open = await peoplePrisma.referral.findMany({ where: { orgId, outcome: null }, select: { candidateId: true }, take: 1000 });
  if (!open.length) return 0;
  const ended = await peoplePrisma.candidate.findMany({ where: { orgId, id: { in: open.map((o) => o.candidateId) }, stage: { in: ENDED } }, select: { id: true } });
  for (const c of ended) await afterCandidateMoved(accountId, orgId, c.id);
  return ended.length;
}

/** The job: every company with a referral to finish or a bonus waiting. */
export async function runReferralBonuses(now = new Date()) {
  const orgs = await outsideTenant('job: referral bonuses', () => peoplePrisma.referral.findMany({ where: { OR: [{ bonusStatus: 'WAITING' }, { outcome: null }] }, select: { orgId: true, accountId: true }, distinct: ['orgId'], take: 1000 }));
  let due = 0;
  for (const o of orgs) {
    try {
      due += await runInTenant(o.orgId, async () => {
        await sweepOutcomes(o.accountId, o.orgId);
        return (await settleBonuses(o.orgId, todayIst(now))).due;
      });
    } catch (err) {
      console.error(`[referrals] bonuses ${o.orgId}:`, err instanceof Error ? err.message : err); // eslint-disable-line no-console
    }
  }
  return due;
}

/* --------------------------------------------------------- the employee app */

/**
 * For the employee app's What's new (portal /updates): jobs opened to me for referrals this
 * week, and my referrals that joined or were not taken forward this week.
 */
export async function portalUpdates(accountId: string, orgId: string, employeeId: string, since: Date) {
  if (!(await isFeatureEnabled(accountId, orgId, 'peopleHiring').catch(() => false))) return [];
  const e = await referrerById(orgId, employeeId);
  if (!e) return [];
  const [jobs, ended] = await Promise.all([
    peoplePrisma.jobOpening.findMany({ where: { orgId: e.orgId, status: 'OPEN', referralOpenedAt: { gte: since }, OR: [{ referralOpen: true }, { internalApply: true }] }, take: 20 }),
    peoplePrisma.referral.findMany({ where: { orgId: e.orgId, referrerEmployeeId: e.id, outcomeAt: { gte: since } }, take: 20 }),
  ]);
  const names = new Map((await peoplePrisma.candidate.findMany({ where: { orgId: e.orgId, id: { in: ended.map((r) => r.candidateId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return [
    ...jobs.filter((o) => mayRefer(o, e)).map((o) => ({ key: `refjob:${o.id}:${o.referralOpenedAt!.getTime()}`, kind: 'referral' as const, status: 'JOB', text: o.referralOpen ? `New job open for referrals: ${o.title}.${o.referralBonus && Number(o.referralBonus) > 0 ? ` Bonus ₹${Number(o.referralBonus).toLocaleString('en-IN')}.` : ''} Refer someone from Me → Jobs.` : `New job you may apply for: ${o.title}. See Me → Jobs.`, note: null, at: o.referralOpenedAt!.toISOString() })),
    ...ended.map((r) => ({ key: `referral:${r.id}:${r.outcome}`, kind: 'referral' as const, status: r.outcome === 'JOINED' ? 'JOINED' : 'NOT_TAKEN', text: r.outcome === 'JOINED' ? `${names.get(r.candidateId) || 'Your referral'} is joining. Thank you for the referral.` : `${names.get(r.candidateId) || 'Your referral'} was not taken forward. Thank you for the referral.`, note: null, at: r.outcomeAt!.toISOString() })),
  ];
}
