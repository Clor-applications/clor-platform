import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { platformPrisma } from '../../../utils/platformPrisma.js';
import { notifyUsers } from '../../notifications.js';
import type { TeamScope } from '../scope.js';
import { TalentError } from './hiring.js';

/**
 * Talent → Growth (docs/people/design-v1/TALENT-DECISIONS.md): goals and their check-ins,
 * review cycles (self, manager, calibration, shared), improvement plans and one-on-ones.
 *
 * Who may act, everywhere: HR (Performance edit, whole company) or the person's manager
 * (someone whose own employee record the person reports to). Never on oneself as manager:
 * nobody writes their own manager review, sets their own final rating or puts themselves on a
 * plan. One-on-ones are seen by the manager and the person only, not by HR.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown, max: number) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const date = (v: unknown, what: string, required = false) => {
  const s = String(v ?? '').trim();
  if (!s) { if (required) throw new TalentError(`Choose the ${what}.`); return null; }
  if (!ISO.test(s)) throw new TalentError('Dates are YYYY-MM-DD.');
  return s;
};
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const HEALTH = ['ON_TRACK', 'AT_RISK', 'BEHIND'] as const;
export const RATING_WORDS: Record<number, string> = { 1: 'Well below what was expected', 2: 'Below what was expected', 3: 'What was expected', 4: 'Above what was expected', 5: 'Well above what was expected' };

/** The caller: their user, their own employee record, HR or not, and their team scope. */
export type Viewer = { accountId: string; orgId: string; userId: string; selfEmployeeId: string | null; hr: boolean; scope: TeamScope; correlationId?: string };

async function person(orgId: string, employeeId: string) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true, name: true, code: true, userId: true, reportingManagerId: true, dottedManagerId: true, departmentId: true, status: true } });
  if (!e) throw new TalentError('No such employee.', 404);
  return e;
}
const inScope = (v: Viewer, employeeId: string) => v.scope.all || v.scope.ids.includes(employeeId);
/** The person reports to the viewer (directly or on a dotted line). */
const managesThem = (v: Viewer, e: { reportingManagerId: string | null; dottedManagerId: string | null }) => Boolean(v.selfEmployeeId && (e.reportingManagerId === v.selfEmployeeId || e.dottedManagerId === v.selfEmployeeId));

async function namesOf(orgId: string, ids: (string | null | undefined)[]) {
  const want = [...new Set(ids.filter(Boolean))] as string[];
  return new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: want } }, select: { id: true, name: true, code: true } })).map((e) => [e.id, e]));
}
async function userNames(ids: (string | null | undefined)[]) {
  const want = [...new Set(ids.filter(Boolean))] as string[];
  return new Map((await platformPrisma.user.findMany({ where: { id: { in: want } }, select: { id: true, fullName: true, email: true } })).map((u) => [u.id, u.fullName || u.email]));
}

/**
 * Who the viewer is, for the screens: their own record, the people who report to them (directly or
 * on a dotted line) and whether they are HR. Lets a screen offer New goal or New plan only to someone
 * who may act, and pick from their own team when they cannot read the whole directory.
 */
export async function whoAmI(v: Viewer) {
  if (!v.selfEmployeeId) return { me: null, reports: [], hr: v.hr };
  const [me, reports] = await Promise.all([
    peoplePrisma.employee.findFirst({ where: { id: v.selfEmployeeId, orgId: v.orgId }, select: { id: true, name: true, code: true } }),
    peoplePrisma.employee.findMany({ where: { orgId: v.orgId, status: { not: 'LEFT' }, OR: [{ reportingManagerId: v.selfEmployeeId }, { dottedManagerId: v.selfEmployeeId }] }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
  ]);
  return { me, reports, hr: v.hr };
}

/* --------------------------------------------------------------------- goals */

/** Who may set and change someone's goals: HR in scope, their manager, or the person themselves. */
async function goalAccess(v: Viewer, employeeId: string) {
  const e = await person(v.orgId, employeeId);
  if (!inScope(v, e.id) && e.id !== v.selfEmployeeId) throw new TalentError('No such employee.', 404);
  const self = e.id === v.selfEmployeeId;
  if (!(v.hr || managesThem(v, e) || self)) throw new TalentError('Only HR, their manager or the person sets their goals.', 403);
  return { e, self };
}

function goalInput(raw: any) {
  const title = text(raw?.title, 200);
  if (!title) throw new TalentError('Say what the goal is.');
  const weight = raw?.weight === undefined || raw?.weight === null || raw?.weight === '' ? null : Math.round(Number(raw.weight));
  if (weight !== null && (!Number.isFinite(weight) || weight < 0 || weight > 100)) throw new TalentError('Weight is a share from 0 to 100.');
  return { title, measure: text(raw?.measure, 300), dueDate: date(raw?.dueDate, 'due date'), weight, description: text(raw?.description, 4000) };
}

export async function createGoal(v: Viewer, raw: any) {
  const { e } = await goalAccess(v, String(raw?.employeeId || ''));
  return peoplePrisma.goal.create({ data: { ...goalInput(raw), accountId: v.accountId, orgId: v.orgId, employeeId: e.id, createdByUserId: v.userId } });
}

export async function updateGoal(v: Viewer, id: string, raw: any) {
  const g = await peoplePrisma.goal.findFirst({ where: { id, orgId: v.orgId } });
  if (!g) throw new TalentError('No such goal.', 404);
  await goalAccess(v, g.employeeId);
  const status = raw?.status && ['ACTIVE', 'DONE', 'DROPPED'].includes(raw.status) ? raw.status : g.status;
  return peoplePrisma.goal.update({ where: { id }, data: { ...goalInput({ ...g, ...raw }), status, ...(status === 'DONE' ? { progress: 100 } : {}) } });
}

/** A check-in: progress, how it is going and a note; the goal takes the latest. From the app with source SELF_SERVICE. */
export async function checkIn(v: Viewer, goalId: string, raw: any, source = 'FORM') {
  const g = await peoplePrisma.goal.findFirst({ where: { id: goalId, orgId: v.orgId } });
  if (!g) throw new TalentError('No such goal.', 404);
  await goalAccess(v, g.employeeId);
  if (g.status !== 'ACTIVE') throw new TalentError('This goal is closed.', 409);
  const progress = Math.round(Number(raw?.progress));
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new TalentError('Progress is from 0 to 100.');
  const health = (HEALTH as readonly string[]).includes(raw?.health) ? raw.health : 'ON_TRACK';
  const note = text(raw?.note, 2000);
  if (health !== 'ON_TRACK' && !note) throw new TalentError('Say what is in the way.');
  return peoplePrisma.$transaction(async (tx) => {
    await tx.goalCheckIn.create({ data: { accountId: v.accountId, orgId: v.orgId, goalId, progress, health, note, byUserId: v.userId, source } });
    return tx.goal.update({ where: { id: goalId }, data: { progress, health } });
  });
}

export async function listGoals(v: Viewer, q: { employeeId?: string; status?: string; q?: string } = {}) {
  const where: any = { orgId: v.orgId, ...(q.status && q.status !== 'all' ? { status: q.status } : q.status === 'all' ? {} : { status: 'ACTIVE' }) };
  if (q.employeeId) {
    if (!inScope(v, q.employeeId) && q.employeeId !== v.selfEmployeeId) throw new TalentError('No such employee.', 404);
    where.employeeId = q.employeeId;
  } else if (!v.scope.all) where.employeeId = { in: [...v.scope.ids] };
  const rows = await peoplePrisma.goal.findMany({ where, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], take: 1000 });
  const people = await namesOf(v.orgId, rows.map((r) => r.employeeId));
  const last = await peoplePrisma.goalCheckIn.findMany({ where: { orgId: v.orgId, goalId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: 'desc' }, distinct: ['goalId'], select: { goalId: true, createdAt: true, note: true } });
  const lastOf = new Map(last.map((l) => [l.goalId, l]));
  const needle = String(q.q || '').trim().toLowerCase();
  const today = todayIst();
  return rows.map((g) => ({ ...g, employee: people.get(g.employeeId) || null, lastCheckIn: lastOf.get(g.id)?.createdAt || null, overdue: g.status === 'ACTIVE' && Boolean(g.dueDate && g.dueDate < today) }))
    .filter((g) => !needle || [g.title, g.employee?.name, g.employee?.code].some((w) => String(w || '').toLowerCase().includes(needle)));
}

export async function goalOf(v: Viewer, id: string) {
  const g = await peoplePrisma.goal.findFirst({ where: { id, orgId: v.orgId } });
  if (!g || (!inScope(v, g.employeeId) && g.employeeId !== v.selfEmployeeId)) throw new TalentError('No such goal.', 404);
  const checkIns = await peoplePrisma.goalCheckIn.findMany({ where: { orgId: v.orgId, goalId: id }, orderBy: { createdAt: 'desc' } });
  const users = await userNames(checkIns.map((c) => c.byUserId));
  return { goal: { ...g, employee: (await namesOf(v.orgId, [g.employeeId])).get(g.employeeId) || null }, checkIns: checkIns.map((c) => ({ ...c, by: c.byUserId ? users.get(c.byUserId) || '' : '' })) };
}

/* ------------------------------------------------------------------- reviews */

export async function createCycle(v: Viewer, raw: any) {
  const name = text(raw?.name, 120);
  if (!name) throw new TalentError('Name the cycle, for example 2026–27 annual review.');
  const periodFrom = date(raw?.periodFrom, 'start of the period', true)!;
  const periodTo = date(raw?.periodTo, 'end of the period', true)!;
  if (periodTo < periodFrom) throw new TalentError('The period ends before it starts.');
  const selfDue = date(raw?.selfDue, 'self-review date');
  const managerDue = date(raw?.managerDue, 'manager-review date');
  if (selfDue && managerDue && managerDue < selfDue) throw new TalentError('Managers review after the self-reviews are in.');
  const departmentIds: string[] = Array.isArray(raw?.departmentIds) ? [...new Set<string>(raw.departmentIds.map(String))].slice(0, 100) : [];
  if (departmentIds.length && (await peoplePrisma.department.count({ where: { orgId: v.orgId, id: { in: departmentIds } } })) !== departmentIds.length) throw new TalentError('Pick departments from this company.');
  return peoplePrisma.reviewCycle.create({ data: { accountId: v.accountId, orgId: v.orgId, name, periodFrom, periodTo, selfDue, managerDue, departmentIds, createdByUserId: v.userId } });
}

/**
 * Cycle moves: DRAFT → OPEN makes one review per person working in the period (in the cycle's
 * departments), with their manager at that moment, and tells them; OPEN → CALIBRATING;
 * CALIBRATING → SHARED shares each review's outcome with its person (every review needs a final
 * rating first); SHARED → CLOSED.
 */
export async function moveCycle(v: Viewer, id: string, to: string) {
  const c = await peoplePrisma.reviewCycle.findFirst({ where: { id, orgId: v.orgId } });
  if (!c) throw new TalentError('No such cycle.', 404);
  const next: Record<string, string> = { DRAFT: 'OPEN', OPEN: 'CALIBRATING', CALIBRATING: 'SHARED', SHARED: 'CLOSED' };
  if (next[c.status] !== to) throw new TalentError(`A ${c.status.toLowerCase()} cycle cannot move to ${to.toLowerCase()}.`, 409);
  if (to === 'OPEN') {
    const depts = (c.departmentIds as string[]) || [];
    const staff = await peoplePrisma.employee.findMany({ where: { orgId: v.orgId, anonymisedAt: null, status: { in: ['ACTIVE', 'ON_NOTICE', 'SUSPENDED'] }, OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: c.periodTo } }], ...(depts.length ? { departmentId: { in: depts } } : {}) }, select: { id: true, userId: true, reportingManagerId: true } });
    if (!staff.length) throw new TalentError('Nobody is in this cycle: no one works in those departments in the period.', 409);
    await peoplePrisma.$transaction(async (tx) => {
      await tx.review.createMany({ data: staff.map((e) => ({ accountId: v.accountId, orgId: v.orgId, cycleId: id, employeeId: e.id, managerEmployeeId: e.reportingManagerId })), skipDuplicates: true });
      await tx.reviewCycle.update({ where: { id }, data: { status: 'OPEN' } });
    });
    const managers = await peoplePrisma.employee.findMany({ where: { orgId: v.orgId, id: { in: [...new Set(staff.map((s) => s.reportingManagerId).filter(Boolean))] as string[] } }, select: { userId: true } });
    await notifyUsers(v.accountId, v.orgId, [...new Set(managers.map((m) => m.userId).filter(Boolean))] as string[], { kind: 'people.review', title: `Reviews to write: ${c.name}`, body: c.managerDue ? `By ${c.managerDue}` : null, link: { app: 'people', screen: 'reviews', params: { id } } as any }, { except: v.userId });
    return { status: 'OPEN', reviews: staff.length };
  }
  if (to === 'SHARED') {
    const missing = await peoplePrisma.review.count({ where: { orgId: v.orgId, cycleId: id, finalRating: null } });
    if (missing) throw new TalentError(`${missing === 1 ? 'One review has' : `${missing} reviews have`} no final rating yet. Set them in Calibration first.`, 409);
    await peoplePrisma.$transaction([
      peoplePrisma.review.updateMany({ where: { orgId: v.orgId, cycleId: id }, data: { sharedAt: new Date() } }),
      peoplePrisma.reviewCycle.update({ where: { id }, data: { status: 'SHARED' } }),
    ]);
    return { status: 'SHARED' };
  }
  await peoplePrisma.reviewCycle.update({ where: { id }, data: { status: to } });
  return { status: to };
}

export async function listCycles(orgId: string) {
  const cycles = await peoplePrisma.reviewCycle.findMany({ where: { orgId }, orderBy: { periodTo: 'desc' }, take: 100 });
  const stats = await peoplePrisma.review.groupBy({ by: ['cycleId'], where: { orgId, cycleId: { in: cycles.map((c) => c.id) } }, _count: { _all: true, selfAt: true, managerAt: true, finalRating: true, acknowledgedAt: true } });
  const by = new Map(stats.map((s) => [s.cycleId, s._count]));
  return cycles.map((c) => ({ ...c, counts: { people: by.get(c.id)?._all || 0, self: by.get(c.id)?.selfAt || 0, manager: by.get(c.id)?.managerAt || 0, final: by.get(c.id)?.finalRating || 0, read: by.get(c.id)?.acknowledgedAt || 0 } }));
}

/** A cycle's reviews in the viewer's sight: HR sees all in scope; a manager the people they review; anyone their own. */
export async function cycleReviews(v: Viewer, id: string) {
  const c = await peoplePrisma.reviewCycle.findFirst({ where: { id, orgId: v.orgId } });
  if (!c) throw new TalentError('No such cycle.', 404);
  const all = await peoplePrisma.review.findMany({ where: { orgId: v.orgId, cycleId: id } });
  const people = await namesOf(v.orgId, [...all.map((r) => r.employeeId), ...all.map((r) => r.managerEmployeeId)]);
  const depts = new Map((await peoplePrisma.employee.findMany({ where: { orgId: v.orgId, id: { in: all.map((r) => r.employeeId) } }, select: { id: true, departmentId: true, department: true } })).map((e) => [e.id, e.department || '']));
  const visible = all.filter((r) => (v.hr && inScope(v, r.employeeId)) || (v.selfEmployeeId && r.managerEmployeeId === v.selfEmployeeId) || r.employeeId === v.selfEmployeeId);
  return {
    cycle: c,
    reviews: visible.map((r) => {
      const own = r.employeeId === v.selfEmployeeId;
      /* Your own review shows its outcome to you only once it is shared; until then only what you wrote. HR too: their own ratings wait like everyone's. */
      const hide = own && !r.sharedAt;
      return {
        id: r.id, employee: people.get(r.employeeId) || null, department: depts.get(r.employeeId) || '', manager: r.managerEmployeeId ? people.get(r.managerEmployeeId) || null : null,
        selfRating: r.selfRating, selfText: r.selfText, selfAt: r.selfAt,
        managerRating: hide ? null : r.managerRating, managerText: hide ? null : r.managerText, managerAt: r.managerAt,
        finalRating: hide ? null : r.finalRating, finalReason: v.hr && !hide ? r.finalReason : null, sharedAt: r.sharedAt, acknowledgedAt: r.acknowledgedAt,
        own, mineToWrite: Boolean(v.selfEmployeeId && r.managerEmployeeId === v.selfEmployeeId && !own),
      };
    }),
  };
}

async function reviewWithAccess(v: Viewer, id: string) {
  const r = await peoplePrisma.review.findFirst({ where: { id, orgId: v.orgId } });
  if (!r) throw new TalentError('No such review.', 404);
  const c = await peoplePrisma.reviewCycle.findFirstOrThrow({ where: { id: r.cycleId } });
  return { r, c };
}
const rating = (v: unknown) => { const n = Math.round(Number(v)); if (!Number.isInteger(n) || n < 1 || n > 5) throw new TalentError('Pick a rating from 1 to 5.'); return n; };

/** The person's own review: while the cycle is open, from the employee app or here. */
export async function writeSelf(v: Viewer, id: string, raw: any) {
  const { r, c } = await reviewWithAccess(v, id);
  if (r.employeeId !== v.selfEmployeeId) throw new TalentError('This is someone else’s self-review.', 403);
  if (c.status !== 'OPEN') throw new TalentError('Self-reviews are closed for this cycle.', 409);
  const selfText = text(raw?.selfText, 8000);
  if (!selfText) throw new TalentError('Write a few lines about the period.');
  return peoplePrisma.review.update({ where: { id }, data: { selfRating: rating(raw?.selfRating), selfText, selfAt: new Date() } });
}

/**
 * The manager's review: by the person's manager at the time the cycle opened; where there is
 * none, by HR. Never by the person reviewed.
 */
export async function writeManager(v: Viewer, id: string, raw: any) {
  const { r, c } = await reviewWithAccess(v, id);
  if (r.employeeId === v.selfEmployeeId) throw new TalentError('You do not review yourself as manager.', 403, 'OWN_REVIEW');
  const manager = Boolean(v.selfEmployeeId && r.managerEmployeeId === v.selfEmployeeId);
  if (!manager && !(v.hr && !r.managerEmployeeId && inScope(v, r.employeeId))) throw new TalentError('Only their manager writes this review.', 403);
  if (!['OPEN', 'CALIBRATING'].includes(c.status)) throw new TalentError('Manager reviews are closed for this cycle.', 409);
  const managerText = text(raw?.managerText, 8000);
  if (!managerText) throw new TalentError('Say what went well and what to work on.');
  return peoplePrisma.review.update({ where: { id }, data: { managerRating: rating(raw?.managerRating), managerText, managerAt: new Date(), managerByUserId: v.userId } });
}

/** Calibration: HR sets the final rating; a reason when it differs from the manager's. Not on HR's own review. */
export async function setFinal(v: Viewer, id: string, raw: any) {
  const { r, c } = await reviewWithAccess(v, id);
  if (!v.hr || !inScope(v, r.employeeId)) throw new TalentError('Only HR sets the final rating.', 403);
  if (r.employeeId === v.selfEmployeeId) throw new TalentError('Someone else sets your final rating.', 403, 'OWN_REVIEW');
  if (!['OPEN', 'CALIBRATING'].includes(c.status)) throw new TalentError('This cycle is past calibration.', 409);
  const finalRating = rating(raw?.finalRating);
  const finalReason = text(raw?.finalReason, 2000);
  if (r.managerRating && finalRating !== r.managerRating && !finalReason) throw new TalentError('Say why the final rating differs from the manager’s.');
  return peoplePrisma.review.update({ where: { id }, data: { finalRating, finalReason, finalByUserId: v.userId } });
}

export async function acknowledge(v: Viewer, id: string) {
  const { r } = await reviewWithAccess(v, id);
  if (r.employeeId !== v.selfEmployeeId) throw new TalentError('Only the person reads and acknowledges their review.', 403);
  if (!r.sharedAt) throw new TalentError('This review is not shared yet.', 409);
  return peoplePrisma.review.update({ where: { id }, data: { acknowledgedAt: r.acknowledgedAt || new Date() } });
}

/** Calibration view: ratings by department and manager, and the spread. No forced curve. */
export async function calibration(v: Viewer, id: string) {
  if (!v.hr) throw new TalentError('Calibration is HR’s.', 403);
  const { reviews } = await cycleReviews(v, id);
  const spread = [1, 2, 3, 4, 5].map((n) => ({ rating: n, word: RATING_WORDS[n], manager: reviews.filter((r) => r.managerRating === n).length, final: reviews.filter((r) => r.finalRating === n).length }));
  const groups = new Map<string, { label: string; ratings: number[] }>();
  for (const r of reviews) {
    for (const [key, label] of [[`d:${r.department}`, r.department || 'No department'], [`m:${r.manager?.id || ''}`, r.manager ? `Reviewed by ${r.manager.name}` : 'No manager']] as const) {
      const g = groups.get(key) || { label, ratings: [] };
      if (r.managerRating) g.ratings.push(r.managerRating);
      groups.set(key, g);
    }
  }
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  return { spread, groups: [...groups.entries()].map(([key, g]) => ({ key, label: g.label, count: g.ratings.length, average: avg(g.ratings) })), reviews };
}

/* --------------------------------------------------------- improvement plans */

async function planAccess(v: Viewer, employeeId: string) {
  const e = await person(v.orgId, employeeId);
  if (!inScope(v, e.id)) throw new TalentError('No such employee.', 404);
  if (e.id === v.selfEmployeeId) throw new TalentError('Someone else manages your plan.', 403, 'OWN_PLAN');
  if (!(v.hr || managesThem(v, e))) throw new TalentError('Only HR or their manager.', 403);
  return e;
}

export async function createPlan(v: Viewer, raw: any) {
  const e = await planAccess(v, String(raw?.employeeId || ''));
  const reason = text(raw?.reason, 4000);
  const expectations = text(raw?.expectations, 8000);
  if (!reason || !expectations) throw new TalentError('Say why, and what is expected by the end.');
  const startDate = date(raw?.startDate, 'start date', true)!;
  const endDate = date(raw?.endDate, 'end date', true)!;
  if (endDate <= startDate) throw new TalentError('The plan ends after it starts.');
  if (await peoplePrisma.improvementPlan.findFirst({ where: { orgId: v.orgId, employeeId: e.id, status: { in: ['ACTIVE', 'EXTENDED'] } }, select: { id: true } })) throw new TalentError('They already have a plan running.', 409);
  const plan = await peoplePrisma.improvementPlan.create({ data: { accountId: v.accountId, orgId: v.orgId, employeeId: e.id, managerEmployeeId: e.reportingManagerId, reason, expectations, startDate, endDate, createdByUserId: v.userId } });
  if (e.userId) await notifyUsers(v.accountId, v.orgId, [e.userId], { kind: 'people.review', title: 'An improvement plan was agreed with you', body: `Until ${endDate}`, link: null }, { except: v.userId });
  return plan;
}

export async function planNote(v: Viewer, id: string, note: unknown) {
  const p = await peoplePrisma.improvementPlan.findFirst({ where: { id, orgId: v.orgId } });
  if (!p) throw new TalentError('No such plan.', 404);
  await planAccess(v, p.employeeId);
  const t = text(note, 4000);
  if (!t) throw new TalentError('Write the note.');
  return peoplePrisma.talentNote.create({ data: { accountId: v.accountId, orgId: v.orgId, subject: 'PLAN', subjectId: id, note: t, byUserId: v.userId } });
}

/** The outcome: completed, extended (a new end date) or not met. A person decides; nothing else happens on its own. */
export async function decidePlan(v: Viewer, id: string, raw: any) {
  const p = await peoplePrisma.improvementPlan.findFirst({ where: { id, orgId: v.orgId } });
  if (!p) throw new TalentError('No such plan.', 404);
  await planAccess(v, p.employeeId);
  if (!['ACTIVE', 'EXTENDED'].includes(p.status)) throw new TalentError('This plan is decided.', 409);
  const outcome = String(raw?.outcome || '');
  if (!['COMPLETED', 'EXTENDED', 'NOT_MET', 'CANCELLED'].includes(outcome)) throw new TalentError('Pick the outcome.');
  const outcomeNote = text(raw?.note, 4000);
  if (!outcomeNote) throw new TalentError('Say what was seen. It stays on the plan.');
  const newEnd = outcome === 'EXTENDED' ? date(raw?.endDate, 'new end date', true)! : null;
  if (newEnd && newEnd <= p.endDate) throw new TalentError('The new end date is after the current one.');
  return peoplePrisma.improvementPlan.update({ where: { id }, data: { status: outcome, outcomeNote, decidedByUserId: v.userId, decidedAt: new Date(), ...(newEnd ? { endDate: newEnd } : {}) } });
}

export async function listPlans(v: Viewer, q: { status?: string } = {}) {
  const rows = await peoplePrisma.improvementPlan.findMany({ where: { orgId: v.orgId, ...(q.status === 'all' ? {} : q.status ? { status: q.status } : { status: { in: ['ACTIVE', 'EXTENDED'] } }) }, orderBy: { endDate: 'asc' }, take: 500 });
  const visible: typeof rows = [];
  for (const p of rows) {
    if (p.employeeId === v.selfEmployeeId) continue;
    if (!inScope(v, p.employeeId)) continue;
    if (v.hr || (v.selfEmployeeId && p.managerEmployeeId === v.selfEmployeeId)) visible.push(p);
  }
  const people = await namesOf(v.orgId, visible.flatMap((p) => [p.employeeId, p.managerEmployeeId]));
  const notes = await peoplePrisma.talentNote.findMany({ where: { orgId: v.orgId, subject: 'PLAN', subjectId: { in: visible.map((p) => p.id) } }, orderBy: { createdAt: 'desc' } });
  const users = await userNames([...notes.map((n) => n.byUserId), ...visible.map((p) => p.decidedByUserId)]);
  return visible.map((p) => ({ ...p, employee: people.get(p.employeeId) || null, manager: p.managerEmployeeId ? people.get(p.managerEmployeeId) || null : null, decidedBy: p.decidedByUserId ? users.get(p.decidedByUserId) || '' : null, notes: notes.filter((n) => n.subjectId === p.id).map((n) => ({ id: n.id, note: n.note, by: n.byUserId ? users.get(n.byUserId) || '' : '', at: n.createdAt })) }));
}

/* ---------------------------------------------------------------- one-on-ones */

/** One-on-ones: the manager's notes with one report; the manager and the person see them, nobody else. */
export async function saveOneOnOne(v: Viewer, raw: any, id?: string) {
  if (!v.selfEmployeeId) throw new TalentError('Link your sign-in to your employee record to keep one-on-ones.', 409);
  const existing = id ? await peoplePrisma.oneOnOne.findFirst({ where: { id, orgId: v.orgId } }) : null;
  if (id && (!existing || existing.managerEmployeeId !== v.selfEmployeeId)) throw new TalentError('No such one-on-one.', 404);
  const employeeId = existing?.employeeId || String(raw?.employeeId || '');
  const e = await person(v.orgId, employeeId);
  if (!managesThem(v, e)) throw new TalentError('One-on-ones are with the people who report to you.', 403);
  const data = { date: date(raw?.date, 'date', true)!, notes: text(raw?.notes, 8000), actions: text(raw?.actions, 4000) };
  if (!data.notes && !data.actions) throw new TalentError('Write what you talked about or agreed.');
  return existing
    ? peoplePrisma.oneOnOne.update({ where: { id: existing.id }, data })
    : peoplePrisma.oneOnOne.create({ data: { ...data, accountId: v.accountId, orgId: v.orgId, managerEmployeeId: v.selfEmployeeId, employeeId, createdByUserId: v.userId } });
}

export async function listOneOnOnes(v: Viewer, q: { employeeId?: string } = {}) {
  if (!v.selfEmployeeId) return { reports: [], rows: [] };
  const reports = await peoplePrisma.employee.findMany({ where: { orgId: v.orgId, status: { not: 'LEFT' }, OR: [{ reportingManagerId: v.selfEmployeeId }, { dottedManagerId: v.selfEmployeeId }] }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
  const rows = await peoplePrisma.oneOnOne.findMany({ where: { orgId: v.orgId, OR: [{ managerEmployeeId: v.selfEmployeeId }, { employeeId: v.selfEmployeeId }], ...(q.employeeId ? { employeeId: q.employeeId } : {}) }, orderBy: { date: 'desc' }, take: 500 });
  const people = await namesOf(v.orgId, rows.flatMap((r) => [r.employeeId, r.managerEmployeeId]));
  return { reports, rows: rows.map((r) => ({ ...r, employee: people.get(r.employeeId) || null, manager: people.get(r.managerEmployeeId) || null, mine: r.managerEmployeeId === v.selfEmployeeId })) };
}
