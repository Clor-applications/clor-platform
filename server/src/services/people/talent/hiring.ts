import { createHash, randomBytes } from 'node:crypto';

import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { platformPrisma } from '../../../utils/platformPrisma.js';
import { notifyUsers, usersWithPermission } from '../../notifications.js';
import { createEmployee } from '../employees.js';
import { startChecklist } from '../checklists.js';
import type { Actor } from '../changeLog.js';

/**
 * Talent → Hiring (docs/people/design-v1/TALENT-DECISIONS.md): job openings, candidates on one
 * pipeline, interviews with independent feedback, and the hire. Nothing here decides about a
 * person by itself: every stage move, rejection and hire is a person's act, logged on the
 * candidate's timeline.
 */

export class TalentError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

export const OPENING_STATUSES = ['REQUESTED', 'DRAFT', 'OPEN', 'ON_HOLD', 'FILLED', 'CLOSED'] as const;
export const STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'] as const;
export const OPEN_STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
export const SOURCES = ['REFERRAL', 'JOB_PORTAL', 'WALK_IN', 'AGENCY', 'WEBSITE', 'APPLY_LINK', 'INTERNAL', 'OTHER'] as const;
export const RECOMMENDATIONS = ['STRONG_YES', 'YES', 'NO', 'STRONG_NO'] as const;
const STAGE_WORD: Record<string, string> = { APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview', OFFER: 'Offer', HIRED: 'Hired', REJECTED: 'Not taken forward', WITHDRAWN: 'Withdrew' };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const text = (v: unknown, max: number) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const dateOrNull = (v: unknown) => { const s = String(v ?? '').trim(); if (!s) return null; if (!ISO.test(s)) throw new TalentError('Dates are YYYY-MM-DD.'); return s; };
export const RESUME_TYPES = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
export const RESUME_MAX = 5 * 1024 * 1024;

type Who = Actor & { userId: string | null };

/* ------------------------------------------------------------------ openings */

async function checkLists(orgId: string, b: { departmentId?: string | null; jobPositionId?: string | null; branchId?: string | null; employeeTypeId?: string | null; hiringManagerId?: string | null }) {
  const one = async (model: 'department' | 'jobPosition' | 'employeeType', id: string | null | undefined, what: string) => {
    if (id && !(await (peoplePrisma as any)[model].findFirst({ where: { id, orgId }, select: { id: true } }))) throw new TalentError(`Pick a ${what} from this company.`);
  };
  await one('department', b.departmentId, 'department');
  await one('jobPosition', b.jobPositionId, 'designation');
  await one('employeeType', b.employeeTypeId, 'employment type');
  if (b.branchId && !(await platformPrisma.branch.findFirst({ where: { id: b.branchId, orgId }, select: { id: true } }))) throw new TalentError('Pick a branch from this company.');
  if (b.hiringManagerId && !(await peoplePrisma.employee.findFirst({ where: { id: b.hiringManagerId, orgId, status: { notIn: ['LEFT'] } }, select: { id: true } }))) throw new TalentError('The hiring manager must be someone working here.');
}

function openingInput(raw: any) {
  const title = text(raw?.title, 120);
  if (!title) throw new TalentError('Say what the job is.');
  const places = Math.round(Number(raw?.places ?? 1));
  if (!Number.isFinite(places) || places < 1 || places > 500) throw new TalentError('Places is a number from 1 to 500.');
  return {
    title, places,
    departmentId: text(raw?.departmentId, 60), jobPositionId: text(raw?.jobPositionId, 60), branchId: text(raw?.branchId, 60), employeeTypeId: text(raw?.employeeTypeId, 60),
    hiringManagerId: text(raw?.hiringManagerId, 60), location: text(raw?.location, 120), description: text(raw?.description, 10000), targetDate: dateOrNull(raw?.targetDate),
  };
}

/** A new opening. Someone who may not edit openings (a manager) can only ask for one. */
export async function createOpening(who: Who, raw: any, opts: { canOpen: boolean }) {
  const data = openingInput(raw);
  await checkLists(who.orgId, data);
  const status = opts.canOpen ? (raw?.status === 'OPEN' ? 'OPEN' : 'DRAFT') : 'REQUESTED';
  const row = await peoplePrisma.jobOpening.create({ data: { ...data, accountId: who.accountId, orgId: who.orgId, status, requestedByUserId: status === 'REQUESTED' ? who.userId : null, openedByUserId: status === 'OPEN' ? who.userId : null, createdByUserId: who.userId } });
  if (status === 'REQUESTED') {
    const hr = (await usersWithPermission(who.accountId, who.orgId, 'PEOPLE::Recruitment::EDIT').catch(() => [] as string[])).filter((u) => u !== who.userId);
    await notifyUsers(who.accountId, who.orgId, hr, { kind: 'people.hiring', title: `Opening asked for: ${row.title}`, body: 'Open it, or say why not.', link: { app: 'people', screen: 'recruitment', params: { id: row.id } } as any });
  }
  return row;
}

export async function updateOpening(who: Who, id: string, raw: any) {
  const current = await peoplePrisma.jobOpening.findFirst({ where: { id, orgId: who.orgId } });
  if (!current) throw new TalentError('No such opening.', 404);
  const data = openingInput({ ...current, ...raw });
  await checkLists(who.orgId, data);
  return peoplePrisma.jobOpening.update({ where: { id }, data });
}

/**
 * Status moves. Opening a manager's request is a decision: the person who asked never opens
 * their own request, unless nobody else may edit openings. Closing needs a reason.
 */
export async function setOpeningStatus(who: Who, id: string, status: string, reason?: string | null) {
  if (!(OPENING_STATUSES as readonly string[]).includes(status) || status === 'REQUESTED') throw new TalentError('Unknown status.');
  const current = await peoplePrisma.jobOpening.findFirst({ where: { id, orgId: who.orgId } });
  if (!current) throw new TalentError('No such opening.', 404);
  if (current.status === 'REQUESTED' && status === 'OPEN' && current.requestedByUserId && current.requestedByUserId === who.userId) {
    const others = (await usersWithPermission(who.accountId, who.orgId, 'PEOPLE::Recruitment::EDIT')).filter((u) => u !== who.userId);
    if (others.length) throw new TalentError('You asked for this opening: someone else opens it.', 403, 'OWN_REQUEST');
  }
  const closedReason = status === 'CLOSED' ? text(reason, 500) : null;
  if (status === 'CLOSED' && !closedReason) throw new TalentError('Say why it is closed, for example filled elsewhere or no longer needed.');
  const row = await peoplePrisma.jobOpening.update({ where: { id }, data: { status, closedReason, ...(status === 'OPEN' && !current.openedByUserId ? { openedByUserId: who.userId } : {}), ...(status !== 'OPEN' ? { applyOpen: false } : {}) } });
  if (current.status === 'REQUESTED' && status === 'OPEN' && current.requestedByUserId) {
    await notifyUsers(who.accountId, who.orgId, [current.requestedByUserId], { kind: 'people.hiring', title: `Opening open: ${row.title}`, body: null, link: { app: 'people', screen: 'recruitment', params: { id } } as any });
  }
  return row;
}

/** The apply link: on with a fresh token (shown once), or off. Only an open opening takes applications. */
export async function setApplyLink(who: Who, id: string, on: boolean) {
  const current = await peoplePrisma.jobOpening.findFirst({ where: { id, orgId: who.orgId } });
  if (!current) throw new TalentError('No such opening.', 404);
  if (!on) {
    await peoplePrisma.jobOpening.update({ where: { id }, data: { applyOpen: false, applyTokenHash: null } });
    return { applyOpen: false, link: null };
  }
  if (current.status !== 'OPEN') throw new TalentError('Open the opening first: only an open job takes applications.', 409);
  const token = randomBytes(24).toString('hex');
  await peoplePrisma.jobOpening.update({ where: { id }, data: { applyOpen: true, applyTokenHash: sha256(token) } });
  return { applyOpen: true, link: `${process.env.APP_URL || 'http://localhost:5173'}/api/people/apply/${token}` };
}

export async function deleteOpening(who: Who, id: string) {
  const current = await peoplePrisma.jobOpening.findFirst({ where: { id, orgId: who.orgId } });
  if (!current) throw new TalentError('No such opening.', 404);
  if (await peoplePrisma.candidate.count({ where: { orgId: who.orgId, openingId: id } })) throw new TalentError('This opening has candidates. Close it instead; it keeps their history.', 409);
  await peoplePrisma.jobOpening.delete({ where: { id } });
  return current;
}

export async function listOpenings(orgId: string, q: { status?: string; q?: string } = {}) {
  const rows = await peoplePrisma.jobOpening.findMany({ where: { orgId, ...(q.status && q.status !== 'all' ? { status: q.status === 'active' ? { in: ['REQUESTED', 'DRAFT', 'OPEN', 'ON_HOLD'] } : q.status } : {}) }, orderBy: [{ updatedAt: 'desc' }], take: 500 });
  const counts = await peoplePrisma.candidate.groupBy({ by: ['openingId', 'stage'], where: { orgId, openingId: { in: rows.map((r) => r.id) }, anonymisedAt: null }, _count: { _all: true } });
  const names = await labels(orgId, rows);
  const needle = String(q.q || '').trim().toLowerCase();
  return rows
    .map((r) => {
      const mine = counts.filter((c) => c.openingId === r.id);
      const by = Object.fromEntries(STAGES.map((s) => [s, mine.find((c) => c.stage === s)?._count._all || 0]));
      return { ...shapeOpening(r, names), stages: by, active: OPEN_STAGES.reduce((n, s) => n + by[s], 0), hired: by.HIRED };
    })
    .filter((r) => !needle || [r.title, r.departmentName, r.designationName, r.location].some((w) => String(w || '').toLowerCase().includes(needle)));
}

async function labels(orgId: string, rows: Array<{ departmentId: string | null; jobPositionId: string | null; branchId: string | null; employeeTypeId: string | null; hiringManagerId: string | null }>) {
  const ids = (k: keyof (typeof rows)[number]) => [...new Set(rows.map((r) => r[k]).filter(Boolean))] as string[];
  const [d, j, b, t, m] = await Promise.all([
    peoplePrisma.department.findMany({ where: { orgId, id: { in: ids('departmentId') } }, select: { id: true, name: true } }),
    peoplePrisma.jobPosition.findMany({ where: { orgId, id: { in: ids('jobPositionId') } }, select: { id: true, name: true } }),
    platformPrisma.branch.findMany({ where: { orgId, id: { in: ids('branchId') } }, select: { id: true, branchName: true } }).then((xs) => xs.map((x) => ({ id: x.id, name: x.branchName }))),
    peoplePrisma.employeeType.findMany({ where: { orgId, id: { in: ids('employeeTypeId') } }, select: { id: true, name: true } }),
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids('hiringManagerId') } }, select: { id: true, name: true } }),
  ]);
  const map = (xs: Array<{ id: string; name: string }>) => new Map(xs.map((x) => [x.id, x.name]));
  return { d: map(d), j: map(j), b: map(b), t: map(t), m: map(m) };
}

const shapeOpening = (r: any, n: Awaited<ReturnType<typeof labels>>) => ({
  id: r.id, title: r.title, status: r.status, places: r.places, targetDate: r.targetDate, location: r.location, description: r.description,
  departmentId: r.departmentId, departmentName: r.departmentId ? n.d.get(r.departmentId) || null : null,
  jobPositionId: r.jobPositionId, designationName: r.jobPositionId ? n.j.get(r.jobPositionId) || null : null,
  branchId: r.branchId, branchName: r.branchId ? n.b.get(r.branchId) || null : null,
  employeeTypeId: r.employeeTypeId, employeeTypeName: r.employeeTypeId ? n.t.get(r.employeeTypeId) || null : null,
  hiringManagerId: r.hiringManagerId, hiringManagerName: r.hiringManagerId ? n.m.get(r.hiringManagerId) || null : null,
  applyOpen: r.applyOpen, referralOpen: r.referralOpen, internalApply: r.internalApply, closedReason: r.closedReason, requestedByUserId: r.requestedByUserId, createdAt: r.createdAt, updatedAt: r.updatedAt,
});

export async function openingOf(orgId: string, id: string) {
  const r = await peoplePrisma.jobOpening.findFirst({ where: { id, orgId } });
  if (!r) throw new TalentError('No such opening.', 404);
  return shapeOpening(r, await labels(orgId, [r]));
}

/* ---------------------------------------------------------------- candidates */

async function event(tx: any, who: { accountId: string; orgId: string; userId: string | null }, candidateId: string, e: { kind: string; fromStage?: string | null; toStage?: string | null; text?: string | null }) {
  await tx.candidateEvent.create({ data: { accountId: who.accountId, orgId: who.orgId, candidateId, kind: e.kind, fromStage: e.fromStage ?? null, toStage: e.toStage ?? null, text: e.text ? String(e.text).slice(0, 4000) : null, byUserId: who.userId } });
}
export { event as candidateEvent };

function candidateInput(raw: any, partial = false) {
  const name = text(raw?.name, 120);
  if (!partial && !name) throw new TalentError('Give the candidate’s name.');
  const email = text(raw?.email, 200);
  if (email && !EMAIL.test(email)) throw new TalentError('That e-mail address does not look right.');
  const phone = text(raw?.phone, 40);
  if (phone && !/^\+?[\d\s\-()]{7,20}$/.test(phone)) throw new TalentError('That phone number does not look right.');
  const source = raw?.source === undefined ? undefined : (SOURCES as readonly string[]).includes(raw.source) ? raw.source : 'OTHER';
  const out: Record<string, unknown> = {};
  if (name || !partial) out.name = name;
  if (raw?.email !== undefined || !partial) out.email = email;
  if (raw?.phone !== undefined || !partial) out.phone = phone;
  if (source !== undefined || !partial) out.source = source || 'OTHER';
  if (raw?.sourceDetail !== undefined || !partial) out.sourceDetail = text(raw?.sourceDetail, 120);
  if (raw?.currentEmployer !== undefined || !partial) out.currentEmployer = text(raw?.currentEmployer, 120);
  return out;
}

/** Someone already on this opening with the same e-mail or phone: refused, so one person is one card. */
async function duplicateOf(orgId: string, openingId: string, email: string | null, phone: string | null, exceptId?: string) {
  if (!email && !phone) return null;
  return peoplePrisma.candidate.findFirst({ where: { orgId, openingId, anonymisedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}), OR: [...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []), ...(phone ? [{ phone }] : [])] }, select: { id: true, name: true } });
}

export async function addCandidate(who: Who, raw: any) {
  const openingId = String(raw?.openingId || '');
  const opening = await peoplePrisma.jobOpening.findFirst({ where: { id: openingId, orgId: who.orgId } });
  if (!opening) throw new TalentError('Pick the opening they apply for.');
  if (['FILLED', 'CLOSED'].includes(opening.status)) throw new TalentError('That opening is closed. Open it again to add candidates.', 409);
  const data = candidateInput(raw) as any;
  const dup = await duplicateOf(who.orgId, openingId, data.email, data.phone);
  if (dup) throw new TalentError(`${dup.name} is already a candidate for this opening.`, 409, 'DUPLICATE');
  return peoplePrisma.$transaction(async (tx) => {
    const c = await tx.candidate.create({ data: { ...data, accountId: who.accountId, orgId: who.orgId, openingId, stage: 'APPLIED', createdByUserId: who.userId } });
    await event(tx, who, c.id, { kind: 'APPLIED', toStage: 'APPLIED', text: data.source === 'REFERRAL' && data.sourceDetail ? `Referred by ${data.sourceDetail}` : null });
    return c;
  });
}

export async function updateCandidate(who: Who, id: string, raw: any) {
  const c = await peoplePrisma.candidate.findFirst({ where: { id, orgId: who.orgId, anonymisedAt: null } });
  if (!c) throw new TalentError('No such candidate.', 404);
  const data = candidateInput(raw, true) as any;
  if ((data.email !== undefined || data.phone !== undefined)) {
    const dup = await duplicateOf(who.orgId, c.openingId, data.email ?? c.email, data.phone ?? c.phone, c.id);
    if (dup) throw new TalentError(`${dup.name} is already a candidate for this opening.`, 409, 'DUPLICATE');
  }
  return peoplePrisma.candidate.update({ where: { id }, data });
}

/**
 * Move a candidate. Hired only through `hire`; Rejected and Withdrew need a reason; a closed
 * candidate can be brought back to Applied. Each move is a line on the timeline.
 */
export async function moveCandidate(who: Who, id: string, stage: string, reason?: string | null) {
  if (!(STAGES as readonly string[]).includes(stage)) throw new TalentError('Unknown stage.');
  if (stage === 'HIRED') throw new TalentError('Use Hire: it makes their employee record.', 409);
  const c = await peoplePrisma.candidate.findFirst({ where: { id, orgId: who.orgId, anonymisedAt: null } });
  if (!c) throw new TalentError('No such candidate.', 404);
  if (c.stage === 'HIRED') throw new TalentError('Already hired.', 409);
  if (c.stage === stage) return c;
  const why = text(reason, 500);
  if ((stage === 'REJECTED' || stage === 'WITHDRAWN') && !why) throw new TalentError(stage === 'REJECTED' ? 'Say why they are not taken forward. It stays on their card.' : 'Say why they withdrew.');
  return peoplePrisma.$transaction(async (tx) => {
    const r = await tx.candidate.updateMany({ where: { id, orgId: who.orgId, stage: c.stage }, data: { stage, stageAt: new Date(), closedReason: stage === 'REJECTED' || stage === 'WITHDRAWN' ? why : null } });
    if (!r.count) throw new TalentError('Someone else moved this candidate. Reload.', 409);
    await event(tx, who, id, { kind: 'STAGE', fromStage: c.stage, toStage: stage, text: why });
    return tx.candidate.findFirstOrThrow({ where: { id } });
  });
}

export async function noteCandidate(who: Who, id: string, note: unknown) {
  const t = text(note, 4000);
  if (!t) throw new TalentError('Write the note.');
  const c = await peoplePrisma.candidate.findFirst({ where: { id, orgId: who.orgId, anonymisedAt: null }, select: { id: true } });
  if (!c) throw new TalentError('No such candidate.', 404);
  await peoplePrisma.$transaction((tx) => event(tx, who, id, { kind: 'NOTE', text: t }));
}

export async function saveResume(who: Who, id: string, file: { name: string; mime: string; data: Buffer }) {
  if (!RESUME_TYPES.has(file.mime)) throw new TalentError('A résumé is a PDF or Word file.');
  if (!file.data.length || file.data.length > RESUME_MAX) throw new TalentError('A résumé is up to 5 MB.');
  const c = await peoplePrisma.candidate.findFirst({ where: { id, orgId: who.orgId, anonymisedAt: null }, select: { id: true } });
  if (!c) throw new TalentError('No such candidate.', 404);
  await peoplePrisma.candidate.update({ where: { id }, data: { resumeName: file.name.slice(0, 200), resumeMime: file.mime, resumeSize: file.data.length, resumeData: file.data } });
}

const shapeCandidate = (c: any, opening?: { id: string; title: string } | null) => ({
  id: c.id, name: c.name, email: c.email, phone: c.phone, source: c.source, sourceDetail: c.sourceDetail, currentEmployer: c.currentEmployer,
  stage: c.stage, stageWord: STAGE_WORD[c.stage] || c.stage, stageAt: c.stageAt, closedReason: c.closedReason, offerAcceptedOn: c.offerAcceptedOn, employeeId: c.employeeId,
  resume: c.resumeName ? { name: c.resumeName, size: c.resumeSize, mime: c.resumeMime } : null, resumeUrl: c.resumeUrl,
  openingId: c.openingId, openingTitle: opening?.title || null, createdAt: c.createdAt, anonymised: Boolean(c.anonymisedAt),
});

export async function listCandidates(orgId: string, q: { openingId?: string; stage?: string; q?: string; limit?: number; offset?: number } = {}) {
  const base: any = { orgId, anonymisedAt: null, ...(q.openingId ? { openingId: q.openingId } : {}) };
  const needle = String(q.q || '').trim();
  if (needle) base.OR = [{ name: { contains: needle, mode: 'insensitive' } }, { email: { contains: needle, mode: 'insensitive' } }, { phone: { contains: needle } }];
  const where = { ...base, ...(q.stage === 'open' || !q.stage ? { stage: { in: OPEN_STAGES } } : q.stage === 'closed' ? { stage: { in: ['REJECTED', 'WITHDRAWN'] } } : q.stage === 'all' ? {} : { stage: q.stage }) };
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
  const [rows, total, grouped] = await Promise.all([
    peoplePrisma.candidate.findMany({ where, orderBy: [{ stageAt: 'desc' }], take: limit, skip: Math.max(0, Number(q.offset) || 0), select: { id: true, name: true, email: true, phone: true, source: true, sourceDetail: true, currentEmployer: true, stage: true, stageAt: true, closedReason: true, offerAcceptedOn: true, employeeId: true, resumeName: true, resumeSize: true, resumeMime: true, resumeUrl: true, openingId: true, createdAt: true, anonymisedAt: true } }),
    peoplePrisma.candidate.count({ where }),
    peoplePrisma.candidate.groupBy({ by: ['stage'], where: base, _count: { _all: true } }),
  ]);
  const openings = new Map((await peoplePrisma.jobOpening.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.openingId))] } }, select: { id: true, title: true } })).map((o) => [o.id, o]));
  const counts: Record<string, number> = Object.fromEntries(grouped.map((g) => [g.stage, g._count._all]));
  counts.open = OPEN_STAGES.reduce((n, s) => n + (counts[s] || 0), 0);
  counts.closed = (counts.REJECTED || 0) + (counts.WITHDRAWN || 0);
  return { rows: rows.map((r) => shapeCandidate(r, openings.get(r.openingId))), total, counts };
}

/**
 * One candidate: details, timeline, interviews and their feedback. `viewer` decides what
 * feedback shows: an interviewer sees others' only after giving their own (independent
 * opinions); HR sees all.
 */
export async function candidateOf(orgId: string, id: string, viewer: { userId: string; hr: boolean }) {
  const c = await peoplePrisma.candidate.findFirst({ where: { id, orgId }, select: { id: true, name: true, email: true, phone: true, source: true, sourceDetail: true, currentEmployer: true, stage: true, stageAt: true, closedReason: true, offerAcceptedOn: true, employeeId: true, resumeName: true, resumeSize: true, resumeMime: true, resumeUrl: true, openingId: true, createdAt: true, anonymisedAt: true } });
  if (!c) throw new TalentError('No such candidate.', 404);
  const [opening, events, interviews, feedback, offers] = await Promise.all([
    peoplePrisma.jobOpening.findFirst({ where: { id: c.openingId, orgId }, select: { id: true, title: true } }),
    peoplePrisma.candidateEvent.findMany({ where: { orgId, candidateId: id }, orderBy: { createdAt: 'desc' }, take: 200 }),
    peoplePrisma.interview.findMany({ where: { orgId, candidateId: id }, orderBy: { at: 'asc' } }),
    peoplePrisma.interviewFeedback.findMany({ where: { orgId, candidateId: id } }),
    peoplePrisma.offer.findMany({ where: { orgId, candidateId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, designation: true, joiningDate: true, acceptBy: true, expiresAt: true, createdAt: true, acceptedAt: true } }),
  ]);
  const userIds = [...new Set([...events.map((e) => e.byUserId), ...interviews.flatMap((i) => (i.interviewerUserIds as string[]) || []), ...feedback.map((f) => f.byUserId)].filter(Boolean))] as string[];
  const users = new Map((await platformPrisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } })).map((u) => [u.id, u.fullName || u.email]));
  const isInterviewer = interviews.some((i) => ((i.interviewerUserIds as string[]) || []).includes(viewer.userId));
  if (!viewer.hr && !isInterviewer) throw new TalentError('No such candidate.', 404);
  const gave = new Set(feedback.filter((f) => f.byUserId === viewer.userId).map((f) => f.interviewId));
  const shaped = shapeCandidate(c, opening);
  /* An interviewer gets the brief: name, opening, where they work now, the résumé; not their contact details. */
  if (!viewer.hr) Object.assign(shaped, { email: null, phone: null, closedReason: null, sourceDetail: null });
  return {
    candidate: shaped,
    timeline: viewer.hr ? events.map((e) => ({ id: e.id, kind: e.kind, fromStage: e.fromStage, toStage: e.toStage, fromWord: e.fromStage ? STAGE_WORD[e.fromStage] : null, toWord: e.toStage ? STAGE_WORD[e.toStage] : null, text: e.text, by: e.byUserId?.startsWith('portal:') ? 'Employee app' : e.byUserId ? users.get(e.byUserId) || '' : 'Apply link', at: e.createdAt })) : [],
    interviews: interviews.map((i) => {
      const mine = gave.has(i.id);
      const ids = (i.interviewerUserIds as string[]) || [];
      const fb = feedback.filter((f) => f.interviewId === i.id);
      return {
        id: i.id, at: i.at, minutes: i.minutes, mode: i.mode, place: i.place, status: i.status,
        interviewers: ids.map((u) => ({ id: u, name: users.get(u) || '' , gave: fb.some((f) => f.byUserId === u) })),
        mineToGive: ids.includes(viewer.userId) && !mine && i.status !== 'CANCELLED',
        /* Independent opinions: an interviewer reads the others' only after giving their own. */
        feedback: viewer.hr || mine ? fb.map((f) => ({ by: users.get(f.byUserId) || '', byUserId: f.byUserId, recommendation: f.recommendation, notes: f.notes, at: f.createdAt })) : fb.filter((f) => f.byUserId === viewer.userId).map((f) => ({ by: users.get(f.byUserId) || '', byUserId: f.byUserId, recommendation: f.recommendation, notes: f.notes, at: f.createdAt })),
        feedbackHidden: !viewer.hr && !mine && fb.length > 0,
      };
    }),
    offers: viewer.hr ? offers.map((o) => ({ ...o, status: o.status === 'SENT' && o.expiresAt < new Date() ? 'EXPIRED' : o.status })) : [],
  };
}

/* ---------------------------------------------------------------- interviews */

/** Who can sit on an interview: the company's active users, by name only (no e-mail, no role). */
export async function interviewerChoices(orgId: string) {
  const members = await platformPrisma.userOrgMembership.findMany({ where: { orgId }, select: { userId: true } });
  const users = await platformPrisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) }, isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
  return users.map((u) => ({ id: u.id, name: u.fullName || 'Unnamed user' }));
}

/** The users among `ids` who belong to this company and can still sign in: the only ones who may interview. */
async function companyUsers(orgId: string, ids: string[]) {
  const found = await platformPrisma.userOrgMembership.findMany({ where: { orgId, userId: { in: ids } }, select: { userId: true } });
  const active = await platformPrisma.user.findMany({ where: { id: { in: found.map((f) => f.userId) }, isActive: true }, select: { id: true } });
  return new Set(active.map((u) => u.id));
}

export async function scheduleInterview(who: Who, candidateId: string, raw: any, id?: string) {
  const c = await peoplePrisma.candidate.findFirst({ where: { id: candidateId, orgId: who.orgId, anonymisedAt: null } });
  if (!c) throw new TalentError('No such candidate.', 404);
  if (!OPEN_STAGES.includes(c.stage)) throw new TalentError('This candidate is no longer in the running.', 409);
  const at = new Date(String(raw?.at || ''));
  if (Number.isNaN(at.getTime())) throw new TalentError('Pick the date and time.');
  const minutes = Math.max(10, Math.min(480, Math.round(Number(raw?.minutes) || 45)));
  const mode = ['IN_PERSON', 'PHONE', 'VIDEO'].includes(raw?.mode) ? raw.mode : 'IN_PERSON';
  const ids = [...new Set((Array.isArray(raw?.interviewerUserIds) ? raw.interviewerUserIds : []).map(String))] as string[];
  if (!ids.length) throw new TalentError('Pick at least one interviewer.');
  if (ids.length > 10) throw new TalentError('Up to 10 interviewers.');
  const known = await companyUsers(who.orgId, ids);
  if (ids.some((u) => !known.has(u))) throw new TalentError('Interviewers must be users of this company who can sign in.');
  const data = { at, minutes, mode, place: text(raw?.place, 300), interviewerUserIds: ids };
  const row = await peoplePrisma.$transaction(async (tx) => {
    const r = id
      ? await tx.interview.update({ where: { id }, data })
      : await tx.interview.create({ data: { ...data, accountId: who.accountId, orgId: who.orgId, candidateId, createdByUserId: who.userId } });
    await event(tx, who, candidateId, { kind: 'INTERVIEW', text: `${id ? 'Interview moved to' : 'Interview on'} ${at.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}` });
    /* An interview means the candidate is in the interview stage. */
    if (c.stage === 'APPLIED' || c.stage === 'SCREENING') {
      await tx.candidate.update({ where: { id: candidateId }, data: { stage: 'INTERVIEW', stageAt: new Date() } });
      await event(tx, who, candidateId, { kind: 'STAGE', fromStage: c.stage, toStage: 'INTERVIEW' });
    }
    return r;
  });
  const others = ids.filter((u) => u !== who.userId);
  await notifyUsers(who.accountId, who.orgId, others, { kind: 'people.hiring', title: `Interview: ${c.name}`, body: at.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }), link: { app: 'people', screen: 'interviews', params: { id: row.id } } as any });
  return row;
}

export async function cancelInterview(who: Who, id: string) {
  const i = await peoplePrisma.interview.findFirst({ where: { id, orgId: who.orgId } });
  if (!i) throw new TalentError('No such interview.', 404);
  await peoplePrisma.$transaction(async (tx) => {
    await tx.interview.update({ where: { id }, data: { status: 'CANCELLED' } });
    await event(tx, who, i.candidateId, { kind: 'INTERVIEW', text: 'Interview cancelled' });
  });
}

/** Feedback from one interviewer, once per interview (they may change it before HR moves the candidate on). */
export async function giveFeedback(who: Who, interviewId: string, raw: any) {
  const i = await peoplePrisma.interview.findFirst({ where: { id: interviewId, orgId: who.orgId } });
  if (!i || !((i.interviewerUserIds as string[]) || []).includes(who.userId || '')) throw new TalentError('This interview is not yours.', 404);
  if (i.status === 'CANCELLED') throw new TalentError('This interview was cancelled.', 409);
  const recommendation = String(raw?.recommendation || '');
  if (!(RECOMMENDATIONS as readonly string[]).includes(recommendation)) throw new TalentError('Pick a recommendation.');
  const notes = text(raw?.notes, 4000);
  await peoplePrisma.$transaction(async (tx) => {
    await tx.interviewFeedback.upsert({ where: { interviewId_byUserId: { interviewId, byUserId: who.userId! } }, create: { accountId: who.accountId, orgId: who.orgId, interviewId, candidateId: i.candidateId, byUserId: who.userId!, recommendation, notes }, update: { recommendation, notes } });
    await event(tx, who, i.candidateId, { kind: 'FEEDBACK', text: `Feedback given: ${recommendation.replace('_', ' ').toLowerCase()}` });
    /* Every interviewer has spoken: the interview is done. */
    const given = await tx.interviewFeedback.count({ where: { interviewId } });
    if (given >= ((i.interviewerUserIds as string[]) || []).length) await tx.interview.update({ where: { id: interviewId }, data: { status: 'DONE' } });
  });
}

/** Interviews on my name (or everyone's, for HR), upcoming first, with whether I still owe feedback. */
export async function interviewsFor(orgId: string, viewer: { userId: string; hr: boolean }, q: { when?: string } = {}) {
  const now = new Date();
  const rows = await peoplePrisma.interview.findMany({ where: { orgId, status: { not: 'CANCELLED' }, ...(q.when === 'past' ? { at: { lt: now } } : q.when === 'all' ? {} : { OR: [{ at: { gte: new Date(now.getTime() - 12 * 3_600_000) } }, { status: 'SCHEDULED' }] }) }, orderBy: { at: q.when === 'past' ? 'desc' : 'asc' }, take: 500 });
  const mineOnly = rows.filter((r) => viewer.hr || ((r.interviewerUserIds as string[]) || []).includes(viewer.userId));
  const cands = new Map((await peoplePrisma.candidate.findMany({ where: { orgId, id: { in: mineOnly.map((r) => r.candidateId) }, anonymisedAt: null }, select: { id: true, name: true, openingId: true, stage: true } })).map((c) => [c.id, c]));
  const openings = new Map((await peoplePrisma.jobOpening.findMany({ where: { orgId, id: { in: [...new Set([...cands.values()].map((c) => c.openingId))] } }, select: { id: true, title: true } })).map((o) => [o.id, o.title]));
  const gave = new Set((await peoplePrisma.interviewFeedback.findMany({ where: { orgId, byUserId: viewer.userId, interviewId: { in: mineOnly.map((r) => r.id) } }, select: { interviewId: true } })).map((f) => f.interviewId));
  const ids = [...new Set(mineOnly.flatMap((r) => (r.interviewerUserIds as string[]) || []))];
  const users = new Map((await platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } })).map((u) => [u.id, u.fullName || u.email]));
  return mineOnly.filter((r) => cands.has(r.candidateId)).map((r) => {
    const c = cands.get(r.candidateId)!;
    const mine = ((r.interviewerUserIds as string[]) || []).includes(viewer.userId);
    return { id: r.id, at: r.at, minutes: r.minutes, mode: r.mode, place: r.place, status: r.status, candidate: { id: c.id, name: c.name, stage: c.stage }, openingTitle: openings.get(c.openingId) || '', interviewers: ((r.interviewerUserIds as string[]) || []).map((u) => users.get(u) || ''), mine, owesFeedback: mine && !gave.has(r.id) && r.at < new Date(now.getTime() + 60 * 60_000) };
  });
}

/* ------------------------------------------------------------------- hiring */

/**
 * Hire: the employee record from the opening (department, designation, branch, type, the
 * hiring manager as manager) and the candidate (name, contacts), the joining date from the form
 * or the accepted offer; the joining plan starts. Once per candidate (a guarded update).
 * When an opening's places are all taken it is marked Filled.
 */
export async function hireCandidate(who: Who, id: string, raw: any) {
  const c = await peoplePrisma.candidate.findFirst({ where: { id, orgId: who.orgId, anonymisedAt: null } });
  if (!c) throw new TalentError('No such candidate.', 404);
  if (c.employeeId || c.stage === 'HIRED') throw new TalentError('Already hired.', 409);
  if (c.stage !== 'OFFER') throw new TalentError('Move them to Offer first: only someone offered the job is hired.', 409);
  if (c.internalEmployeeId) return moveFromWithin(who, c);
  const offer = await peoplePrisma.offer.findFirst({ where: { orgId: who.orgId, candidateId: id, status: 'ACCEPTED' }, orderBy: { createdAt: 'desc' } });
  const joining = dateOrNull(raw?.dateOfJoining) || offer?.joiningDate || null;
  if (!joining) throw new TalentError('Choose the joining date.');
  const code = text(raw?.code, 40);
  if (code && (await peoplePrisma.employee.findFirst({ where: { orgId: who.orgId, code }, select: { id: true } }))) throw new TalentError(`Employee ID ${code} is already used.`, 409);
  const opening = await peoplePrisma.jobOpening.findFirst({ where: { id: c.openingId, orgId: who.orgId } });
  const [dept, desig, manager] = await Promise.all([
    opening?.departmentId ? peoplePrisma.department.findFirst({ where: { id: opening.departmentId, orgId: who.orgId }, select: { id: true, name: true } }) : null,
    opening?.jobPositionId ? peoplePrisma.jobPosition.findFirst({ where: { id: opening.jobPositionId, orgId: who.orgId }, select: { id: true, name: true } }) : null,
    opening?.hiringManagerId ? peoplePrisma.employee.findFirst({ where: { id: opening.hiringManagerId, orgId: who.orgId, status: { notIn: ['LEFT'] } }, select: { id: true } }) : null,
  ]);
  const employee = await createEmployee(
    { ...who, source: 'HIRE', reason: `Hired from candidate ${c.name}${opening ? ` for ${opening.title}` : ''}` },
    {
      accountId: who.accountId, orgId: who.orgId, name: c.name, code,
      email: c.email, phone: c.phone, dateOfJoining: joining, status: 'ACTIVE',
      departmentId: dept?.id ?? null, department: dept?.name ?? null,
      jobPositionId: desig?.id ?? null, designation: desig?.name ?? offer?.designation ?? null,
      branchId: opening?.branchId ?? null, employeeTypeId: opening?.employeeTypeId ?? null,
      reportingManagerId: manager?.id ?? null,
      createdByUserId: who.userId,
    } as any,
    {
      afterWrite: async (tx, row) => {
        const r = await tx.candidate.updateMany({ where: { id, orgId: who.orgId, employeeId: null, stage: 'OFFER' }, data: { stage: 'HIRED', stageAt: new Date(), employeeId: row.id } });
        if (!r.count) throw new TalentError('Already hired.', 409);
        await event(tx, who, id, { kind: 'HIRED', fromStage: 'OFFER', toStage: 'HIRED', text: `Joins on ${joining}` });
        if (opening) {
          const hired = await tx.candidate.count({ where: { orgId: who.orgId, openingId: opening.id, stage: 'HIRED' } });
          if (hired >= opening.places && ['OPEN', 'ON_HOLD', 'DRAFT'].includes(opening.status)) await tx.jobOpening.update({ where: { id: opening.id }, data: { status: 'FILLED', applyOpen: false } });
        }
      },
    },
  );
  await startChecklist({ accountId: who.accountId, orgId: who.orgId, userId: who.userId }, employee, 'JOINING', joining);
  return employee;
}

/**
 * Someone who works here, taken for the job they applied to (an internal application): no second
 * employee record. The candidate is marked hired against their own record and HR is pointed to
 * the job change on it, which carries the new department, designation and pay from a date.
 */
async function moveFromWithin(who: Who, c: { id: string; name: string; openingId: string; internalEmployeeId: string | null }) {
  const employee = await peoplePrisma.employee.findFirst({ where: { id: c.internalEmployeeId!, orgId: who.orgId, status: { not: 'LEFT' } } });
  if (!employee) throw new TalentError('They no longer work here, so they cannot move to this job.', 409);
  const opening = await peoplePrisma.jobOpening.findFirst({ where: { id: c.openingId, orgId: who.orgId } });
  await peoplePrisma.$transaction(async (tx) => {
    const r = await tx.candidate.updateMany({ where: { id: c.id, orgId: who.orgId, employeeId: null, stage: 'OFFER' }, data: { stage: 'HIRED', stageAt: new Date(), employeeId: employee.id } });
    if (!r.count) throw new TalentError('Already hired.', 409);
    await event(tx, who, c.id, { kind: 'HIRED', fromStage: 'OFFER', toStage: 'HIRED', text: 'Moves from within. Record the job change on their employee record.' });
    if (opening) {
      const hired = await tx.candidate.count({ where: { orgId: who.orgId, openingId: opening.id, stage: 'HIRED' } });
      if (hired >= opening.places && ['OPEN', 'ON_HOLD', 'DRAFT'].includes(opening.status)) await tx.jobOpening.update({ where: { id: opening.id }, data: { status: 'FILLED', applyOpen: false } });
    }
  });
  return Object.assign(employee, { movedFromWithin: true as const });
}

/* ---------------------------------------------------------------- apply link */

export async function openingByToken(token: string) {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  return peoplePrisma.jobOpening.findUnique({ where: { applyTokenHash: sha256(token) } });
}

/** An application from the public page: a candidate at Applied, HR told. Duplicates are folded quietly. */
export async function applyFromLink(opening: { id: string; accountId: string; orgId: string; title: string; status: string; applyOpen: boolean }, raw: any) {
  if (!opening.applyOpen || opening.status !== 'OPEN') throw new TalentError('This job is no longer taking applications.', 410);
  const data = candidateInput({ ...raw, source: 'APPLY_LINK' }) as any;
  if (!data.email && !data.phone) throw new TalentError('Give an e-mail address or a phone number, so the company can reach you.');
  const resumeUrl = text(raw?.resumeUrl, 500);
  if (resumeUrl && !/^https:\/\//i.test(resumeUrl)) throw new TalentError('A résumé link starts with https://');
  const note = text(raw?.note, 2000);
  const who = { accountId: opening.accountId, orgId: opening.orgId, userId: null };
  const dup = await duplicateOf(opening.orgId, opening.id, data.email, data.phone);
  if (dup) {
    if (note) await peoplePrisma.$transaction((tx) => event(tx, who, dup.id, { kind: 'NOTE', text: `Applied again through the link: ${note}` }));
    return { duplicate: true };
  }
  await peoplePrisma.$transaction(async (tx) => {
    const c = await tx.candidate.create({ data: { ...data, resumeUrl, accountId: opening.accountId, orgId: opening.orgId, openingId: opening.id, stage: 'APPLIED' } });
    await event(tx, who, c.id, { kind: 'APPLIED', toStage: 'APPLIED', text: note ? `Through the apply link. ${note}` : 'Through the apply link' });
  });
  const hr = await usersWithPermission(opening.accountId, opening.orgId, 'PEOPLE::Recruitment::EDIT').catch(() => [] as string[]);
  await notifyUsers(opening.accountId, opening.orgId, hr, { kind: 'people.hiring', title: `New application: ${opening.title}`, body: data.name, link: { app: 'people', screen: 'candidates', params: { opening: opening.id } } as any });
  return { duplicate: false };
}

/* ---------------------------------------------------------------- retention */

/** Rejected or withdrawn more than `days` ago: name, contacts, résumé and notes cleared (DPDP). */
export async function anonymiseOldCandidates(orgId: string, days = 365, now = new Date()) {
  const before = new Date(now.getTime() - days * 86_400_000);
  const old = await peoplePrisma.candidate.findMany({ where: { orgId, anonymisedAt: null, stage: { in: ['REJECTED', 'WITHDRAWN'] }, stageAt: { lt: before } }, select: { id: true }, take: 500 });
  if (!old.length) return 0;
  const ids = old.map((o) => o.id);
  await peoplePrisma.$transaction([
    peoplePrisma.candidate.updateMany({ where: { orgId, id: { in: ids } }, data: { name: 'Former candidate', email: null, phone: null, sourceDetail: null, currentEmployer: null, resumeName: null, resumeMime: null, resumeSize: null, resumeData: null, resumeUrl: null, closedReason: null, anonymisedAt: now } }),
    peoplePrisma.candidateEvent.updateMany({ where: { orgId, candidateId: { in: ids }, text: { not: null } }, data: { text: null } }),
    peoplePrisma.interviewFeedback.updateMany({ where: { orgId, candidateId: { in: ids }, notes: { not: null } }, data: { notes: null } }),
    /* The referral keeps who referred and the bonus; how they knew them and the contacts go. */
    peoplePrisma.referral.updateMany({ where: { orgId, candidateId: { in: ids } }, data: { relation: null, note: null, phoneKey: null, emailKey: null } }),
  ]);
  return ids.length;
}
