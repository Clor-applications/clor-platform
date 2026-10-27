import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { type Actor, writeChangeLog } from './changeLog.js';
import { writeEvent } from './outbox.js';
import { activeRule, submitRequest } from './approvals/engine.js';
import { ask } from './acknowledgements.js';

/**
 * Policies (docs/people/02-PRD.md POL-01..06). A library entry has an owner
 * and a category; each version has effective dates and says who it applies
 * to. Publishing goes through the approval rule where the company has one
 * (POL-05); an earlier version stays readable with its dates closed off, so
 * "as of 1 June" shows what held on 1 June (POL-02). A version that needs
 * acceptance asks everyone in scope on publishing (POL-04). Two published
 * policies of one category that reach the same people on the same day are
 * a conflict Health check shows (POL-06).
 */

export const POLICY_CATEGORIES = ['LEAVE', 'HOURS', 'CONDUCT', 'TRAVEL', 'BENEFITS', 'IT', 'POSH', 'PRIVACY', 'OTHER'] as const;
export const CATEGORY_LABEL: Record<string, string> = { LEAVE: 'Leave', HOURS: 'Working hours', CONDUCT: 'Conduct', TRAVEL: 'Travel', BENEFITS: 'Benefits', IT: 'IT and security', POSH: 'POSH', PRIVACY: 'Privacy notice', OTHER: 'Other' };
/** A privacy notice says what it covers (PRV-01): one notice per purpose, each with its own versions and read receipts. */
export const PRIVACY_PURPOSES: Record<string, string> = { EMPLOYMENT: 'Employment records', ATTENDANCE: 'Attendance and leave', PAYROLL: 'Pay and statutory deductions', RECRUITMENT: 'Hiring', MONITORING: 'Devices, CCTV and IT monitoring', BENEFITS: 'Insurance and benefits', OTHER: 'Other' };
/** The scheduled languages a notice may be offered in besides English (Constitution, Eighth Schedule; the common ones first). */
export const NOTICE_LANGUAGES: Record<string, string> = { hi: 'Hindi', bn: 'Bengali', mr: 'Marathi', te: 'Telugu', ta: 'Tamil', gu: 'Gujarati', ur: 'Urdu', kn: 'Kannada', or: 'Odia', ml: 'Malayalam', pa: 'Punjabi', as: 'Assamese' };

export async function noticeLanguages(orgId: string): Promise<string[]> {
  const row = await peoplePrisma.peopleSetting.findUnique({ where: { orgId }, select: { noticeLanguages: true } });
  return (Array.isArray(row?.noticeLanguages) ? (row!.noticeLanguages as unknown[]) : []).map(String).filter((l) => NOTICE_LANGUAGES[l]);
}

export async function saveNoticeLanguages(actor: Actor, input: unknown) {
  const list = [...new Set((Array.isArray(input) ? input : []).map((l) => String(l ?? '').trim().toLowerCase()))];
  const bad = list.find((l) => !NOTICE_LANGUAGES[l]);
  if (bad) throw new PolicyError(`${bad} is not one of the languages offered.`);
  await peoplePrisma.peopleSetting.upsert({ where: { orgId: actor.orgId }, create: { accountId: actor.accountId, orgId: actor.orgId, noticeLanguages: list, updatedByUserId: actor.userId }, update: { noticeLanguages: list, updatedByUserId: actor.userId } });
  return list;
}

const cleanPurpose = (category: string, purpose: unknown) => {
  if (category !== 'PRIVACY') return null;
  const p = String(purpose ?? '').trim().toUpperCase();
  if (!PRIVACY_PURPOSES[p]) throw new PolicyError('Say what the notice covers: employment records, attendance, pay, hiring, monitoring, benefits or other.');
  return p;
};
export const VERSION_STATUSES = ['DRAFT', 'WAITING', 'PUBLISHED', 'RETIRED'] as const;
export type AppliesTo = { establishmentIds?: string[]; states?: string[]; departmentIds?: string[]; employeeTypeIds?: string[]; gradeIds?: string[]; workTypeIds?: string[] };
const APPLIES_KEYS: Array<keyof AppliesTo> = ['establishmentIds', 'states', 'departmentIds', 'employeeTypeIds', 'gradeIds', 'workTypeIds'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export class PolicyError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function cleanAppliesTo(input: unknown): AppliesTo {
  const out: AppliesTo = {};
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  for (const k of APPLIES_KEYS) {
    const list = Array.isArray(src[k]) ? (src[k] as unknown[]).map((v) => String(v ?? '').trim()).filter(Boolean) : [];
    if (list.length) out[k] = [...new Set(list)];
  }
  return out;
}

type Person = { id: string; name: string; code: string | null; establishmentId: string | null; departmentId: string | null; employeeTypeId: string | null; gradeId: string | null; workTypeId: string | null; state: string | null };

/** Every list the version names must include the person's value; an empty rule applies to everyone. */
export function applies(rule: AppliesTo, p: Person): boolean {
  if (rule.establishmentIds?.length && !(p.establishmentId && rule.establishmentIds.includes(p.establishmentId))) return false;
  if (rule.states?.length && !(p.state && rule.states.some((s) => s.toLowerCase() === p.state!.toLowerCase()))) return false;
  if (rule.departmentIds?.length && !(p.departmentId && rule.departmentIds.includes(p.departmentId))) return false;
  if (rule.employeeTypeIds?.length && !(p.employeeTypeId && rule.employeeTypeIds.includes(p.employeeTypeId))) return false;
  if (rule.gradeIds?.length && !(p.gradeId && rule.gradeIds.includes(p.gradeId))) return false;
  if (rule.workTypeIds?.length && !(p.workTypeId && rule.workTypeIds.includes(p.workTypeId))) return false;
  return true;
}

async function peopleOf(orgId: string, ids?: string[]): Promise<Person[]> {
  const rows = await peoplePrisma.employee.findMany({ where: { orgId, status: { not: 'LEFT' }, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true, name: true, code: true, establishmentId: true, departmentId: true, employeeTypeId: true, gradeId: true, workTypeId: true } });
  const estIds = [...new Set(rows.map((r) => r.establishmentId).filter((x): x is string => Boolean(x)))];
  const ests = estIds.length ? await peoplePrisma.establishment.findMany({ where: { orgId, id: { in: estIds } }, select: { id: true, state: true } }) : [];
  const stateOf = new Map(ests.map((e) => [e.id, e.state]));
  return rows.map((r) => ({ ...r, state: r.establishmentId ? stateOf.get(r.establishmentId) ?? null : null }));
}

export async function peopleInScope(orgId: string, rule: AppliesTo) {
  return (await peopleOf(orgId)).filter((p) => applies(rule, p));
}

const shapeVersion = (v: { id: string; policyId: string; version: number; body: string | null; translations?: unknown; documentId: string | null; effectiveFrom: string; effectiveTo: string | null; appliesTo: unknown; needsAcceptance: boolean; status: string; publishedAt: Date | null; publishedByUserId: string | null; requestId: string | null; createdAt: Date }) => ({
  id: v.id, policyId: v.policyId, version: v.version, body: v.body, documentId: v.documentId, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, appliesTo: (v.appliesTo as AppliesTo) || {},
  translations: (v.translations as Record<string, string> | null) || {},
  needsAcceptance: v.needsAcceptance, status: v.status, publishedAt: v.publishedAt, publishedByUserId: v.publishedByUserId, requestId: v.requestId, createdAt: v.createdAt,
});

/** The version in force on a day: published, started by then, not yet closed; the newest wins. */
export function inForce<T extends { version: number; status: string; effectiveFrom: string; effectiveTo: string | null }>(versions: T[], asOf = todayIst()): T | null {
  return versions.filter((v) => (v.status === 'PUBLISHED' || v.status === 'RETIRED') && v.effectiveFrom <= asOf && (!v.effectiveTo || v.effectiveTo >= asOf)).sort((a, b) => b.version - a.version)[0] || null;
}

export async function createPolicy(actor: Actor, input: { title?: string; category?: string; purpose?: string | null; description?: string | null; ownerUserId?: string | null }) {
  const title = String(input.title || '').trim().slice(0, 160);
  if (!title) throw new PolicyError('Name the policy.');
  const category = String(input.category || 'OTHER').toUpperCase();
  if (!POLICY_CATEGORIES.includes(category as any)) throw new PolicyError('Pick a category: leave, working hours, conduct, travel, benefits, IT, POSH, privacy notice or other.');
  const purpose = cleanPurpose(category, input.purpose);
  const ownerUserId = String(input.ownerUserId || actor.userId || '').trim();
  if (!ownerUserId) throw new PolicyError('A policy needs an owner.');
  const owner = await platformPrisma.user.findUnique({ where: { id: ownerUserId }, select: { id: true } });
  if (!owner) throw new PolicyError('That owner is not a user here.');
  return peoplePrisma.policy.create({ data: { accountId: actor.accountId, orgId: actor.orgId, title, category, purpose, description: String(input.description || '').trim().slice(0, 2000) || null, ownerUserId, createdByUserId: actor.userId } });
}

export async function updatePolicy(actor: Actor, id: string, input: { title?: string; category?: string; purpose?: string | null; description?: string | null; ownerUserId?: string | null; isActive?: boolean }) {
  const row = await peoplePrisma.policy.findFirst({ where: { id, orgId: actor.orgId } });
  if (!row) throw new PolicyError('No such policy.', 404);
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) { const t = String(input.title || '').trim().slice(0, 160); if (!t) throw new PolicyError('Name the policy.'); data.title = t; }
  if (input.category !== undefined) { const c = String(input.category || '').toUpperCase(); if (!POLICY_CATEGORIES.includes(c as any)) throw new PolicyError('Unknown category.'); data.category = c; }
  if (input.description !== undefined) data.description = String(input.description || '').trim().slice(0, 2000) || null;
  if (input.ownerUserId !== undefined) { const o = String(input.ownerUserId || '').trim(); if (!o || !(await platformPrisma.user.findUnique({ where: { id: o }, select: { id: true } }))) throw new PolicyError('That owner is not a user here.'); data.ownerUserId = o; }
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
  if (input.category !== undefined || input.purpose !== undefined) data.purpose = cleanPurpose(String(data.category ?? row.category), input.purpose ?? row.purpose);
  return peoplePrisma.policy.update({ where: { id: row.id }, data });
}

/** The library: each policy with what is in force today and the newest version's state. */
export async function listPolicies(orgId: string, where: { q?: string; category?: string; includeInactive?: boolean } = {}) {
  const q = String(where.q || '').trim();
  const rows = await peoplePrisma.policy.findMany({
    where: { orgId, ...(where.includeInactive ? {} : { isActive: true }), ...(where.category ? { category: where.category.toUpperCase() } : {}), ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}) },
    orderBy: [{ category: 'asc' }, { title: 'asc' }],
    include: { versions: { orderBy: { version: 'desc' } } },
  });
  const owners = await platformPrisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ownerUserId))] } }, select: { id: true, fullName: true } });
  const ownerOf = new Map(owners.map((u) => [u.id, u.fullName]));
  const today = todayIst();
  return rows.map((p) => {
    const current = inForce(p.versions, today);
    const latest = p.versions[0] || null;
    return { id: p.id, title: p.title, category: p.category, categoryLabel: CATEGORY_LABEL[p.category] || p.category, purpose: p.purpose, purposeLabel: p.purpose ? PRIVACY_PURPOSES[p.purpose] || p.purpose : null, description: p.description, ownerUserId: p.ownerUserId, ownerName: ownerOf.get(p.ownerUserId) || '', isActive: p.isActive, updatedAt: p.updatedAt, current: current ? shapeVersion(current) : null, latest: latest ? shapeVersion(latest) : null, versions: p.versions.length };
  });
}

export async function policyDetail(orgId: string, id: string) {
  const p = await peoplePrisma.policy.findFirst({ where: { id, orgId }, include: { versions: { orderBy: { version: 'desc' } } } });
  if (!p) throw new PolicyError('No such policy.', 404);
  const owner = await platformPrisma.user.findUnique({ where: { id: p.ownerUserId }, select: { fullName: true } });
  const acks = await peoplePrisma.acknowledgement.groupBy({ by: ['targetId'], where: { orgId, targetType: 'POLICY_VERSION', targetId: { in: p.versions.map((v) => v.id) } }, _count: { _all: true } });
  const accepted = await peoplePrisma.acknowledgement.groupBy({ by: ['targetId'], where: { orgId, targetType: 'POLICY_VERSION', targetId: { in: p.versions.map((v) => v.id) }, acceptedAt: { not: null } }, _count: { _all: true } });
  const askedOf = new Map(acks.map((a) => [a.targetId, a._count._all]));
  const acceptedOf = new Map(accepted.map((a) => [a.targetId, a._count._all]));
  const current = inForce(p.versions);
  return {
    id: p.id, title: p.title, category: p.category, categoryLabel: CATEGORY_LABEL[p.category] || p.category, purpose: p.purpose, purposeLabel: p.purpose ? PRIVACY_PURPOSES[p.purpose] || p.purpose : null, description: p.description, ownerUserId: p.ownerUserId, ownerName: owner?.fullName || '', isActive: p.isActive,
    currentVersion: current?.version ?? null,
    versions: p.versions.map((v) => ({ ...shapeVersion(v), inForce: current?.id === v.id, asked: askedOf.get(v.id) || 0, accepted: acceptedOf.get(v.id) || 0 })),
  };
}

type VersionInput = { body?: string | null; documentId?: string | null; effectiveFrom?: string; effectiveTo?: string | null; appliesTo?: unknown; needsAcceptance?: boolean; translations?: unknown };
async function cleanVersion(orgId: string, input: VersionInput, existing?: { body: string | null; documentId: string | null }) {
  const body = input.body !== undefined ? String(input.body || '').trim().slice(0, 100_000) || null : existing?.body ?? null;
  const documentId = input.documentId !== undefined ? String(input.documentId || '').trim() || null : existing?.documentId ?? null;
  if (!body && !documentId) throw new PolicyError('Write the policy, or point it at a document on file.');
  if (documentId && !(await peoplePrisma.employeeDocument.findFirst({ where: { id: documentId, orgId }, select: { id: true } }))) throw new PolicyError('That document is not on file.');
  const effectiveFrom = input.effectiveFrom !== undefined ? String(input.effectiveFrom || '').trim() : undefined;
  if (effectiveFrom !== undefined && !ISO_DATE.test(effectiveFrom)) throw new PolicyError('Say from which day it applies (YYYY-MM-DD).');
  const effectiveTo = input.effectiveTo !== undefined ? String(input.effectiveTo || '').trim() || null : undefined;
  if (effectiveTo && !ISO_DATE.test(effectiveTo)) throw new PolicyError('Dates are YYYY-MM-DD.');
  let translations: Record<string, string> | undefined;
  if (input.translations !== undefined) {
    const enabled = await noticeLanguages(orgId);
    translations = {};
    for (const [lang, text] of Object.entries((input.translations && typeof input.translations === 'object' ? input.translations : {}) as Record<string, unknown>)) {
      const t = String(text ?? '').trim().slice(0, 100_000);
      if (!t) continue;
      if (!enabled.includes(lang)) throw new PolicyError(`${NOTICE_LANGUAGES[lang] || lang} is not switched on for notices. Add it under Privacy notice languages first.`);
      translations[lang] = t;
    }
  }
  return { body, documentId, effectiveFrom, effectiveTo, translations, appliesTo: input.appliesTo !== undefined ? cleanAppliesTo(input.appliesTo) : undefined, needsAcceptance: input.needsAcceptance !== undefined ? Boolean(input.needsAcceptance) : undefined };
}

export async function addVersion(actor: Actor, policyId: string, input: VersionInput) {
  const p = await peoplePrisma.policy.findFirst({ where: { id: policyId, orgId: actor.orgId }, select: { id: true, category: true } });
  if (!p) throw new PolicyError('No such policy.', 404);
  const c = await cleanVersion(actor.orgId, input);
  /* PRV-01: every version of a privacy notice asks everyone it reaches to read it again. */
  if (p.category === 'PRIVACY') c.needsAcceptance = true;
  if (!c.effectiveFrom) throw new PolicyError('Say from which day it applies (YYYY-MM-DD).');
  if (c.effectiveTo && c.effectiveTo < c.effectiveFrom) throw new PolicyError('It cannot end before it starts.');
  const last = await peoplePrisma.policyVersion.findFirst({ where: { policyId }, orderBy: { version: 'desc' }, select: { version: true } });
  const row = await peoplePrisma.policyVersion.create({ data: { accountId: actor.accountId, orgId: actor.orgId, policyId, version: (last?.version ?? 0) + 1, body: c.body, documentId: c.documentId, effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo ?? null, appliesTo: (c.appliesTo || {}) as any, needsAcceptance: c.needsAcceptance ?? false, translations: (c.translations ?? undefined) as any, createdByUserId: actor.userId } });
  return shapeVersion(row);
}

export async function updateVersion(actor: Actor, policyId: string, version: number, input: VersionInput) {
  const row = await peoplePrisma.policyVersion.findFirst({ where: { policyId, version, orgId: actor.orgId }, include: { policy: { select: { category: true } } } });
  if (!row) throw new PolicyError('No such version.', 404);
  if (row.status !== 'DRAFT') throw new PolicyError('Only a draft can be changed; make a new version instead.', 409);
  const c = await cleanVersion(actor.orgId, input, row);
  if (row.policy.category === 'PRIVACY') c.needsAcceptance = true;
  const effectiveFrom = c.effectiveFrom ?? row.effectiveFrom;
  const effectiveTo = c.effectiveTo === undefined ? row.effectiveTo : c.effectiveTo;
  if (effectiveTo && effectiveTo < effectiveFrom) throw new PolicyError('It cannot end before it starts.');
  const updated = await peoplePrisma.policyVersion.update({ where: { id: row.id }, data: { body: c.body, documentId: c.documentId, effectiveFrom, effectiveTo, ...(c.appliesTo !== undefined ? { appliesTo: c.appliesTo as any } : {}), ...(c.needsAcceptance !== undefined ? { needsAcceptance: c.needsAcceptance } : {}), ...(c.translations !== undefined ? { translations: c.translations as any } : {}) } });
  return shapeVersion(updated);
}

/** Publish now: earlier versions still open are closed the day before; people in scope are asked to accept where the version says so. */
export async function publishVersion(actor: Actor, versionId: string, opts: { requestId?: string | null } = {}) {
  const v = await peoplePrisma.policyVersion.findFirst({ where: { id: versionId, orgId: actor.orgId }, include: { policy: true } });
  if (!v) throw new PolicyError('No such version.', 404);
  if (v.status === 'PUBLISHED') return shapeVersion(v);
  if (v.status === 'RETIRED') throw new PolicyError('A retired version cannot be published again; make a new one.', 409);
  const published = await peoplePrisma.$transaction(async (tx) => {
    const earlier = await tx.policyVersion.findMany({ where: { policyId: v.policyId, status: 'PUBLISHED', effectiveTo: null, id: { not: v.id }, effectiveFrom: { lte: v.effectiveFrom } } });
    for (const e of earlier) await tx.policyVersion.update({ where: { id: e.id }, data: { effectiveTo: addDays(v.effectiveFrom, -1) < e.effectiveFrom ? e.effectiveFrom : addDays(v.effectiveFrom, -1) } });
    const row = await tx.policyVersion.update({ where: { id: v.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedByUserId: actor.userId, requestId: opts.requestId ?? v.requestId } });
    await writeChangeLog(tx, { ...actor, requestId: opts.requestId ?? actor.requestId ?? null }, { kind: 'Policy', id: v.policyId }, [{ field: 'version', before: earlier.length ? `v${Math.max(...earlier.map((e) => e.version))}` : null, after: `v${v.version} published from ${v.effectiveFrom}`, redacted: false }]);
    await writeEvent(tx, actor, 'people.policy.published.v1', { policyId: v.policyId, versionId: v.id, version: v.version, title: v.policy.title, category: v.policy.category, effectiveFrom: v.effectiveFrom, needsAcceptance: v.needsAcceptance, appliesTo: v.appliesTo });
    return row;
  });
  if (v.needsAcceptance) {
    const scope = await peopleInScope(actor.orgId, (v.appliesTo as AppliesTo) || {});
    await ask({ accountId: actor.accountId, orgId: actor.orgId, userId: actor.userId }, 'POLICY_VERSION', v.id, scope.map((p) => p.id), { title: `Please read and accept: ${v.policy.title}`, body: `Version ${v.version}, from ${v.effectiveFrom}.` });
  }
  return shapeVersion(published);
}

/** Send a draft for publishing: a request where the company has a rule (POL-05), otherwise published now. */
export async function submitVersion(actor: Actor, policyId: string, version: number) {
  const v = await peoplePrisma.policyVersion.findFirst({ where: { policyId, version, orgId: actor.orgId }, include: { policy: true } });
  if (!v) throw new PolicyError('No such version.', 404);
  if (v.status !== 'DRAFT') throw new PolicyError(v.status === 'WAITING' ? 'Already waiting for approval.' : 'Already published.', 409);
  const rule = await activeRule(actor.orgId, 'POLICY_PUBLISH');
  if (rule) {
    const r = await submitRequest({ ...actor, reason: null }, { requestType: 'POLICY_PUBLISH', subjectEmployeeId: null, title: `Publish ${v.policy.title} v${v.version} from ${v.effectiveFrom}`, payload: { policyId, versionId: v.id, version: v.version, effectiveFrom: v.effectiveFrom } as any });
    if (r.request.status === 'APPROVED') return { version: await publishVersion(actor, v.id, { requestId: r.request.id }), request: r.request };
    await peoplePrisma.policyVersion.update({ where: { id: v.id }, data: { status: 'WAITING', requestId: r.request.id } });
    return { version: shapeVersion({ ...v, status: 'WAITING', requestId: r.request.id }), request: r.request };
  }
  return { version: await publishVersion(actor, v.id), request: null };
}

export async function retireVersion(actor: Actor, policyId: string, version: number, effectiveTo?: string | null) {
  const v = await peoplePrisma.policyVersion.findFirst({ where: { policyId, version, orgId: actor.orgId } });
  if (!v) throw new PolicyError('No such version.', 404);
  const to = effectiveTo && ISO_DATE.test(effectiveTo) ? effectiveTo : todayIst();
  if (to < v.effectiveFrom) throw new PolicyError('It cannot end before it starts.');
  return shapeVersion(await peoplePrisma.policyVersion.update({ where: { id: v.id }, data: { status: 'RETIRED', effectiveTo: to } }));
}

/** What applies to one person on a day, with whether they have accepted (POL-01, POL-03). Drafts are never here. */
export async function policiesFor(orgId: string, employeeId: string, asOf = todayIst()) {
  const [person] = await peopleOf(orgId, [employeeId]);
  if (!person) return [];
  const rows = await peoplePrisma.policy.findMany({ where: { orgId, isActive: true }, include: { versions: { where: { status: { in: ['PUBLISHED', 'RETIRED'] } }, orderBy: { version: 'desc' } } } });
  const out: Array<{ policyId: string; title: string; category: string; categoryLabel: string; purpose: string | null; purposeLabel: string | null; languages: string[]; versionId: string; version: number; effectiveFrom: string; effectiveTo: string | null; needsAcceptance: boolean; hasBody: boolean; documentId: string | null }> = [];
  for (const p of rows) {
    const v = inForce(p.versions, asOf);
    if (!v || !applies((v.appliesTo as AppliesTo) || {}, person)) continue;
    out.push({ policyId: p.id, title: p.title, category: p.category, categoryLabel: CATEGORY_LABEL[p.category] || p.category, purpose: p.purpose, purposeLabel: p.purpose ? PRIVACY_PURPOSES[p.purpose] || p.purpose : null, languages: Object.keys((v.translations as Record<string, string>) || {}), versionId: v.id, version: v.version, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, needsAcceptance: v.needsAcceptance, hasBody: Boolean(v.body), documentId: v.documentId });
  }
  const acks = out.length ? await peoplePrisma.acknowledgement.findMany({ where: { orgId, employeeId, targetType: 'POLICY_VERSION', targetId: { in: out.map((o) => o.versionId) } } }) : [];
  const ackOf = new Map(acks.map((a) => [a.targetId, a]));
  return out.map((o) => ({ ...o, acknowledgementId: ackOf.get(o.versionId)?.id ?? null, acceptedAt: ackOf.get(o.versionId)?.acceptedAt ?? null }));
}

/** A published version one person may read: in force (or asked of them) and applying to them. */
export async function versionForPerson(orgId: string, employeeId: string, versionId: string) {
  const v = await peoplePrisma.policyVersion.findFirst({ where: { id: versionId, orgId, status: { in: ['PUBLISHED', 'RETIRED'] } }, include: { policy: true } });
  if (!v) return null;
  const [person] = await peopleOf(orgId, [employeeId]);
  if (!person || !applies((v.appliesTo as AppliesTo) || {}, person)) return null;
  return { ...shapeVersion(v), title: v.policy.title, category: v.policy.category, purpose: v.policy.purpose };
}

/** Two published policies of one category reaching the same people on a day (POL-06). */
export async function conflicts(orgId: string, asOf = todayIst()) {
  const rows = await peoplePrisma.policy.findMany({ where: { orgId, isActive: true }, include: { versions: { where: { status: { in: ['PUBLISHED', 'RETIRED'] } } } } });
  const everyone = await peopleOf(orgId);
  const live = rows.map((p) => ({ policyId: p.id, title: p.title, category: p.category, purpose: p.purpose, v: inForce(p.versions, asOf) })).filter((x) => x.v);
  const out: Array<{ category: string; a: { policyId: string; title: string; version: number }; b: { policyId: string; title: string; version: number }; people: number; sample: string[] }> = [];
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const a = live[i]; const b = live[j];
      if (a.category !== b.category || (a.purpose || null) !== (b.purpose || null)) continue;
      const both = everyone.filter((p) => applies((a.v!.appliesTo as AppliesTo) || {}, p) && applies((b.v!.appliesTo as AppliesTo) || {}, p));
      if (!both.length) continue;
      out.push({ category: a.category, a: { policyId: a.policyId, title: a.title, version: a.v!.version }, b: { policyId: b.policyId, title: b.title, version: b.v!.version }, people: both.length, sample: both.slice(0, 3).map((p) => p.name) });
    }
  }
  return out;
}
