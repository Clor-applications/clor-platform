import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { platformPrisma } from '../../../utils/platformPrisma.js';
import { notifyUsers } from '../../notifications.js';
import type { TeamScope } from '../scope.js';
import { TalentError } from './hiring.js';
import { todayIst } from '../../../utils/istDate.js';
import { statusWords } from '../../../utils/statusWords.js';

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
  /* Round 53 picks: open to the team unless set to "Only me and my manager"; a manager's goal for the whole team; the company goal it serves. */
  const visibility = raw?.visibility === 'PRIVATE' ? 'PRIVATE' : 'TEAM';
  return { title, measure: text(raw?.measure, 300), dueDate: date(raw?.dueDate, 'due date'), weight, description: text(raw?.description, 4000), visibility, forTeam: raw?.forTeam === true, companyGoalId: text(raw?.companyGoalId, 60) };
}

/** A company goal picked for a person's goal must be this company's and still running; a team goal needs a team. */
async function checkGoalLinks(v: Viewer, employeeId: string, data: { forTeam: boolean; companyGoalId: string | null }, before?: { companyGoalId: string | null }) {
  if (data.companyGoalId && data.companyGoalId !== before?.companyGoalId && !(await peoplePrisma.companyGoal.findFirst({ where: { id: data.companyGoalId, orgId: v.orgId, status: 'ACTIVE' }, select: { id: true } }))) throw new TalentError('Pick a company goal that is still running.');
  if (data.forTeam && !(await peoplePrisma.employee.count({ where: { orgId: v.orgId, status: { not: 'LEFT' }, OR: [{ reportingManagerId: employeeId }, { dottedManagerId: employeeId }] } }))) throw new TalentError('A team goal belongs to someone with people reporting to them.');
}

export async function createGoal(v: Viewer, raw: any) {
  const { e } = await goalAccess(v, String(raw?.employeeId || ''));
  const data = goalInput(raw);
  await checkGoalLinks(v, e.id, data);
  return peoplePrisma.goal.create({ data: { ...data, accountId: v.accountId, orgId: v.orgId, employeeId: e.id, createdByUserId: v.userId } });
}

export async function updateGoal(v: Viewer, id: string, raw: any) {
  const g = await peoplePrisma.goal.findFirst({ where: { id, orgId: v.orgId } });
  if (!g) throw new TalentError('No such goal.', 404);
  await goalAccess(v, g.employeeId);
  const status = raw?.status && ['ACTIVE', 'DONE', 'DROPPED'].includes(raw.status) ? raw.status : g.status;
  const data = goalInput({ ...g, ...raw });
  await checkGoalLinks(v, g.employeeId, data, g);
  return peoplePrisma.goal.update({ where: { id }, data: { ...data, status, ...(status === 'DONE' ? { progress: 100 } : {}) } });
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

/**
 * Who else sees a goal (round 53 picks). The person's team, meaning those who share their manager, sees
 * goals left open to the team; their manager's team goals are seen by everyone reporting to that manager.
 * "Only me and my manager" goals are seen by the person, their direct manager and HR alone.
 */
async function teamOf(v: Viewer) {
  if (!v.selfEmployeeId) return { managerId: null as string | null, peers: [] as string[] };
  const me = await peoplePrisma.employee.findFirst({ where: { id: v.selfEmployeeId, orgId: v.orgId }, select: { reportingManagerId: true } });
  if (!me?.reportingManagerId) return { managerId: null, peers: [] };
  const peers = await peoplePrisma.employee.findMany({ where: { orgId: v.orgId, reportingManagerId: me.reportingManagerId, status: { not: 'LEFT' }, id: { not: v.selfEmployeeId } }, select: { id: true } });
  return { managerId: me.reportingManagerId, peers: peers.map((p) => p.id) };
}
/** A goal shown to a viewer who is not HR, not the person and not their direct manager: open to the team only. */
const seenByTeam = (g: { visibility: string; forTeam: boolean; employeeId: string }, team: { managerId: string | null; peers: string[] }) =>
  g.visibility !== 'PRIVATE' && (team.peers.includes(g.employeeId) || (g.forTeam && g.employeeId === team.managerId));

export async function listGoals(v: Viewer, q: { employeeId?: string; status?: string; q?: string } = {}) {
  const where: any = { orgId: v.orgId, ...(q.status && q.status !== 'all' ? { status: q.status } : q.status === 'all' ? {} : { status: 'ACTIVE' }) };
  const team = v.hr ? { managerId: null, peers: [] } : await teamOf(v);
  const teamIds = [...team.peers, ...(team.managerId ? [team.managerId] : [])];
  if (q.employeeId) {
    if (!inScope(v, q.employeeId) && q.employeeId !== v.selfEmployeeId && !teamIds.includes(q.employeeId)) throw new TalentError('No such employee.', 404);
    where.employeeId = q.employeeId;
  } else if (!v.scope.all) where.employeeId = { in: [...new Set([...v.scope.ids, ...(v.selfEmployeeId ? [v.selfEmployeeId] : []), ...teamIds])] };
  const found = await peoplePrisma.goal.findMany({ where, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], take: 1000 });
  const managerOf = new Map((await peoplePrisma.employee.findMany({ where: { orgId: v.orgId, id: { in: [...new Set(found.map((g) => g.employeeId))] } }, select: { id: true, reportingManagerId: true, dottedManagerId: true } })).map((e) => [e.id, e]));
  const rows = found.flatMap((g) => {
    const own = g.employeeId === v.selfEmployeeId;
    const boss = managerOf.get(g.employeeId);
    const manages = Boolean(boss && managesThem(v, boss));
    if (v.hr || own || manages) return [{ ...g, peer: false }];
    /* Someone further up (in the team scope, not the direct manager) sees open goals only. */
    if (inScope(v, g.employeeId) && g.visibility !== 'PRIVATE') return [{ ...g, peer: false }];
    return seenByTeam(g, team) ? [{ ...g, peer: true }] : [];
  });
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
  if (!g) throw new TalentError('No such goal.', 404);
  const own = g.employeeId === v.selfEmployeeId;
  let canAct = own || v.hr;
  if (!own && !v.hr) {
    const boss = await peoplePrisma.employee.findFirst({ where: { id: g.employeeId, orgId: v.orgId }, select: { reportingManagerId: true, dottedManagerId: true } });
    const manages = Boolean(boss && managesThem(v, boss));
    canAct = manages;
    const scoped = inScope(v, g.employeeId) && g.visibility !== 'PRIVATE';
    if (!manages && !scoped && !seenByTeam(g, await teamOf(v))) throw new TalentError('No such goal.', 404);
  } else if (!own && !inScope(v, g.employeeId)) throw new TalentError('No such goal.', 404);
  const checkIns = await peoplePrisma.goalCheckIn.findMany({ where: { orgId: v.orgId, goalId: id }, orderBy: { createdAt: 'desc' } });
  const users = await userNames(checkIns.map((c) => c.byUserId));
  /* canAct: may check in, edit and close it (the person, their manager, HR); a teammate only reads it. */
  return { goal: { ...g, canAct, employee: (await namesOf(v.orgId, [g.employeeId])).get(g.employeeId) || null }, checkIns: checkIns.map((c) => ({ ...c, by: c.byUserId ? users.get(c.byUserId) || '' : '' })) };
}

/* -------------------------------------------------------------- company goals */

/**
 * Company goals over the Goals list (round 53 pick): HR sets a few; people's goals link to one, and
 * each shows how far the linked goals have come on average (dropped goals left out).
 */
export async function listCompanyGoals(v: Viewer, q: { status?: string } = {}) {
  const rows = await peoplePrisma.companyGoal.findMany({ where: { orgId: v.orgId, ...(q.status === 'all' ? {} : { status: 'ACTIVE' }) }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], take: 50 });
  const linked = await peoplePrisma.goal.groupBy({ by: ['companyGoalId'], where: { orgId: v.orgId, companyGoalId: { in: rows.map((r) => r.id) }, status: { not: 'DROPPED' } }, _avg: { progress: true }, _count: { _all: true } });
  const by = new Map(linked.map((l) => [l.companyGoalId, l]));
  return rows.map((r) => ({ ...r, linkedGoals: by.get(r.id)?._count._all || 0, progress: by.get(r.id) ? Math.round(by.get(r.id)!._avg.progress || 0) : null }));
}

function companyGoalInput(raw: any) {
  const title = text(raw?.title, 200);
  if (!title) throw new TalentError('Say what the company goal is.');
  return { title, measure: text(raw?.measure, 300), dueDate: date(raw?.dueDate, 'due date') };
}

export async function createCompanyGoal(v: Viewer, raw: any) {
  if (!v.hr) throw new TalentError('Only HR sets company goals.', 403);
  return peoplePrisma.companyGoal.create({ data: { ...companyGoalInput(raw), accountId: v.accountId, orgId: v.orgId, createdByUserId: v.userId } });
}

export async function updateCompanyGoal(v: Viewer, id: string, raw: any) {
  if (!v.hr) throw new TalentError('Only HR sets company goals.', 403);
  const g = await peoplePrisma.companyGoal.findFirst({ where: { id, orgId: v.orgId } });
  if (!g) throw new TalentError('No such company goal.', 404);
  const status = raw?.status && ['ACTIVE', 'DONE', 'DROPPED'].includes(raw.status) ? raw.status : g.status;
  return peoplePrisma.companyGoal.update({ where: { id }, data: { ...companyGoalInput({ ...g, ...raw }), status } });
}

/**
 * The score the goals give for a review (round 53 pick): the person's goals due in the period (or with no
 * date), dropped ones left out, progress averaged by weight (equal shares when no weights are set), on the
 * 1 to 5 scale: 0% is 1, 100% is 5. A suggestion beside the rating, never the rating itself.
 */
export function goalScore(goals: Array<{ progress: number; weight: number | null }>) {
  if (!goals.length) return null;
  const weighted = goals.some((g) => (g.weight || 0) > 0);
  const total = goals.reduce((n, g) => n + (weighted ? g.weight || 0 : 1), 0);
  if (!total) return null;
  const progress = goals.reduce((n, g) => n + g.progress * (weighted ? g.weight || 0 : 1), 0) / total;
  return { score: Math.round((1 + (4 * progress) / 100) * 10) / 10, progress: Math.round(progress), goals: goals.length, weighted };
}

async function goalScores(orgId: string, employeeIds: string[], periodFrom: string, periodTo: string) {
  if (!employeeIds.length) return new Map<string, ReturnType<typeof goalScore>>();
  const goals = await peoplePrisma.goal.findMany({ where: { orgId, employeeId: { in: employeeIds }, status: { not: 'DROPPED' }, forTeam: false, OR: [{ dueDate: null }, { dueDate: { gte: periodFrom, lte: periodTo } }] }, select: { employeeId: true, progress: true, weight: true } });
  return new Map(employeeIds.map((id) => [id, goalScore(goals.filter((g) => g.employeeId === id))]));
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
  if (next[c.status] !== to) throw new TalentError(`A review cycle that is ${statusWords(c.status)} cannot become ${statusWords(to)}.`, 409);
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
  /* What the goals say, for whoever rates: HR and the manager (not the person on their own review). */
  const scores = await goalScores(v.orgId, visible.filter((r) => r.employeeId !== v.selfEmployeeId).map((r) => r.employeeId), c.periodFrom, c.periodTo);
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
        goalScore: own ? null : scores.get(r.employeeId) || null,
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
