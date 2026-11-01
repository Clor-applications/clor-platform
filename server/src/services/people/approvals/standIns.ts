import type { Prisma } from '../../../generated/people/index.js';
import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { usersWithPermission } from '../../notifications.js';
import { REQUEST_TYPES, isFormType, namesFor } from './engine.js';

/**
 * Stand-ins, one table (workflow engine SPEC 5.3 step 1, section 6; phase 2b).
 *
 * Two systems grew apart: People approval stand-ins (`StandIn`, by sign-in,
 * read by the approvals engine) and leave delegates (`ApprovalStandIn`, by
 * People record, read by leave and attendance). Now every stand-in is one
 * `StandIn` row carrying whichever ids it has, the dates (IST, both days
 * included) and what it hands on, always written as an explicit list:
 *
 *   ['ALL']                 all approvals
 *   ['PEOPLE']              every People request, not leave or attendance:
 *                           what a People stand-in was before the merge
 *   ['LEAVE']               leave only
 *   ['LEAVE', 'ATTENDANCE'] what a leave delegate always handed on: leave, and
 *                           attendance requests, overtime and field punches
 *   chosen request types    e.g. ['EXPENSE_CLAIM', 'FORM:<id>']
 *
 * An empty list is a row an older API wrote (it knows no requestTypes): a
 * People stand-in, so it reads as ['PEOPLE'] and never hands on leave.
 *
 * Until phase 3c retires ApprovalStandIn (rollback safety, DEPLOY.md):
 *  - every read here reads both tables; an old row not copied still counts,
 *    a copied one is read once, and a new row whose linked old row an older
 *    API deleted is gone too;
 *  - a row covering leave or attendance is also written to ApprovalStandIn
 *    (linked by `legacyId`), so an older API still sees the leave delegate;
 *  - the sign-ins are stored only on rows that hand on People requests. A
 *    leave and attendance row keeps them null, so the older engine and People
 *    list (which select by sign-in and expect both) never see it; they are
 *    filled in from the People records when read here.
 */

/** What a leave delegate hands on unless told otherwise. */
export const LEAVE_DELEGATE_TYPES = ['LEAVE', 'ATTENDANCE'];
/** Attendance-side requests decided at the manager's step alongside leave. */
const ATTENDANCE_KINDS = new Set(['OVERTIME', 'COMP_OFF', 'FIELD_PUNCH']);
const TIME_GROUPS = new Set(['LEAVE', 'ATTENDANCE']);
/** The group a request type is handed on under: attendance kinds under ATTENDANCE, the rest as themselves. */
export const groupOf = (type: string) => (type === 'ATTENDANCE' || type.startsWith('ATTENDANCE:') || ATTENDANCE_KINDS.has(type) ? 'ATTENDANCE' : type);
/** A row's list as it is meant: empty (an older API's People stand-in) is PEOPLE. */
export const effectiveTypes = (types: string[] | null | undefined) => (types && types.length ? types : ['PEOPLE']);
/** Only leave and attendance: decided in the employee app too, so a stand-in needs no sign-in. */
export const timeOnly = (types: string[] | null | undefined) => effectiveTypes(types).every((t) => TIME_GROUPS.has(t));
/** Hands on at least one People request (decided by sign-in). */
export const coversPeople = (types: string[] | null | undefined) => effectiveTypes(types).some((t) => !TIME_GROUPS.has(t));

/**
 * Whether a stand-in handing on `types` covers a request of `type`. `TIME`
 * asks for leave or attendance (a queue that holds both); no type at all (an
 * engine call that names none) asks for a People request.
 */
export function covers(raw: string[] | null | undefined, type?: string) {
  const types = effectiveTypes(raw);
  if (types.includes('ALL')) return true;
  if (type === 'TIME') return types.includes('LEAVE') || types.includes('ATTENDANCE');
  if (!type) return types.includes('PEOPLE');
  const group = groupOf(type);
  if (TIME_GROUPS.has(group)) return types.includes(group) || types.includes(type);
  return types.includes('PEOPLE') || types.includes(type);
}

/** The request types a stand-in may hand on, as stored; all approvals when none named; null when one is not a type here. */
export function cleanTypes(input: unknown): string[] | null {
  if (input == null) return ['ALL'];
  if (!Array.isArray(input)) return null;
  const known = new Set<string>(['ALL', 'PEOPLE', 'LEAVE', 'ATTENDANCE', ...REQUEST_TYPES]);
  const out = [...new Set(input.map((t) => String(t || '').trim()))];
  if (out.some((t) => !known.has(t) && !isFormType(t))) return null;
  if (!out.length || out.includes('ALL')) return ['ALL'];
  return out.sort();
}

export type StandInRow = {
  id: string;
  /** NEW: the one table. OLD: a leave delegate not copied (written by an older API). */
  source: 'NEW' | 'OLD';
  accountId: string;
  orgId: string;
  userId: string | null;
  standInUserId: string | null;
  employeeId: string | null;
  standInEmployeeId: string | null;
  fromDate: string;
  toDate: string;
  requestTypes: string[];
  note: string | null;
  createdByUserId: string | null;
  legacyId: string | null;
  createdAt: Date;
};

/** Whose stand-ins: the approver's, or the stand-in's, by sign-in and People record. */
type People = { userIds: string[]; employeeIds: string[] };
type Filter = { day?: string; endsFrom?: string; id?: string; managers?: People; standIns?: People; limit?: number };

/** Both ids of these people: the records of the sign-ins named, and the sign-ins of the records. */
async function bothIds(orgId: string, who: Partial<People>): Promise<People> {
  const userIds = (who.userIds || []).filter(Boolean);
  const employeeIds = (who.employeeIds || []).filter(Boolean);
  if (!userIds.length && !employeeIds.length) return { userIds, employeeIds };
  const rows = await peoplePrisma.employee.findMany({ where: { orgId, OR: [{ userId: { in: userIds } }, { id: { in: employeeIds } }] }, select: { id: true, userId: true } });
  return {
    userIds: [...new Set([...userIds, ...(rows.map((r) => r.userId).filter(Boolean) as string[])])],
    employeeIds: [...new Set([...employeeIds, ...rows.map((r) => r.id)])],
  };
}

/**
 * The stand-ins of the company matching `filter`, from both tables, newest
 * first, each with the sign-ins and People records its people have (a row
 * names whichever it was made with; the other is filled from the record).
 */
async function read(orgId: string, filter: Filter = {}): Promise<StandInRow[]> {
  const dates = filter.id ? { id: filter.id } : filter.day ? { fromDate: { lte: filter.day }, toDate: { gte: filter.day } } : filter.endsFrom ? { toDate: { gte: filter.endsFrom } } : {};
  const take = filter.limit || 500;
  const newWhere: Prisma.StandInWhereInput = { orgId, ...dates };
  const oldWhere: Prisma.ApprovalStandInWhereInput = { orgId, ...dates };
  const ands: Prisma.StandInWhereInput[] = [];
  const oldAnds: Prisma.ApprovalStandInWhereInput[] = [];
  if (filter.managers) {
    const m = await bothIds(orgId, filter.managers);
    if (!m.userIds.length && !m.employeeIds.length) return [];
    ands.push({ OR: [{ userId: { in: m.userIds } }, { employeeId: { in: m.employeeIds } }] });
    oldAnds.push({ managerEmployeeId: { in: m.employeeIds } });
  }
  if (filter.standIns) {
    const s = await bothIds(orgId, filter.standIns);
    if (!s.userIds.length && !s.employeeIds.length) return [];
    ands.push({ OR: [{ standInUserId: { in: s.userIds } }, { standInEmployeeId: { in: s.employeeIds } }] });
    oldAnds.push({ standInEmployeeId: { in: s.employeeIds } });
  }
  if (ands.length) newWhere.AND = ands;
  if (oldAnds.length) oldWhere.AND = oldAnds;
  const [rows, legacy] = await Promise.all([
    peoplePrisma.standIn.findMany({ where: newWhere, orderBy: { createdAt: 'desc' }, take }),
    peoplePrisma.approvalStandIn.findMany({ where: oldWhere, orderBy: { createdAt: 'desc' }, take }),
  ]);
  /* The old rows behind new ones: a new row whose old row an older API deleted is gone; an old row copied is read once, from the new table. */
  const linked = [...new Set(rows.map((r) => r.legacyId).filter(Boolean) as string[])];
  const stillThere = linked.length ? new Set((await peoplePrisma.approvalStandIn.findMany({ where: { orgId, id: { in: linked } }, select: { id: true } })).map((r) => r.id)) : new Set<string>();
  const copied = legacy.length
    ? new Set((await peoplePrisma.standIn.findMany({ where: { orgId, legacyId: { in: legacy.map((l) => l.id) } }, select: { legacyId: true } })).map((r) => r.legacyId))
    : new Set<string | null>();
  const out: StandInRow[] = [
    ...rows.filter((r) => !r.legacyId || stillThere.has(r.legacyId)).map((r) => ({ ...r, source: 'NEW' as const, requestTypes: effectiveTypes(r.requestTypes) })),
    ...legacy.filter((l) => !copied.has(l.id)).map((l) => ({
      id: l.id, source: 'OLD' as const, accountId: l.accountId, orgId: l.orgId, userId: null, standInUserId: null,
      employeeId: l.managerEmployeeId, standInEmployeeId: l.standInEmployeeId, fromDate: l.fromDate, toDate: l.toDate,
      requestTypes: [...LEAVE_DELEGATE_TYPES], note: null, createdByUserId: l.createdByUserId, legacyId: null, createdAt: l.createdAt,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const byRecord = [...new Set(out.flatMap((r) => [!r.userId && r.employeeId, !r.standInUserId && r.standInEmployeeId]).filter(Boolean) as string[])];
  const byLogin = [...new Set(out.flatMap((r) => [!r.employeeId && r.userId, !r.standInEmployeeId && r.standInUserId]).filter(Boolean) as string[])];
  if (byRecord.length || byLogin.length) {
    const people = await peoplePrisma.employee.findMany({ where: { orgId, OR: [{ id: { in: byRecord } }, { userId: { in: byLogin } }] }, select: { id: true, userId: true } });
    const loginOf = new Map(people.map((e) => [e.id, e.userId]));
    const recordOf = new Map(people.filter((e) => e.userId).map((e) => [e.userId as string, e.id]));
    for (const r of out) {
      if (!r.userId && r.employeeId) r.userId = loginOf.get(r.employeeId) || null;
      if (!r.standInUserId && r.standInEmployeeId) r.standInUserId = loginOf.get(r.standInEmployeeId) || null;
      if (!r.employeeId && r.userId) r.employeeId = recordOf.get(r.userId) || null;
      if (!r.standInEmployeeId && r.standInUserId) r.standInEmployeeId = recordOf.get(r.standInUserId) || null;
    }
  }
  return out;
}

/**
 * For the engine: each approver sign-in with someone standing in on `day` for
 * `type`, and who. The latest named for that approver wins, as on the leave
 * path; when it names someone without a sign-in, nobody stands in here.
 */
export async function standInUsersFor(orgId: string, userIds: string[], day: string, type?: string) {
  const out = new Map<string, string>();
  if (!userIds.length) return out;
  const decided = new Set<string>();
  for (const r of await read(orgId, { day, managers: { userIds, employeeIds: [] } })) {
    if (!r.userId || !userIds.includes(r.userId) || decided.has(r.userId) || !covers(r.requestTypes, type)) continue;
    decided.add(r.userId);
    if (r.standInUserId && r.standInUserId !== r.userId) out.set(r.userId, r.standInUserId);
  }
  return out;
}

/** For leave and attendance: the People record deciding for this manager on `day`, or null for the manager themselves. The latest named wins. */
export async function standInEmployeeFor(orgId: string, managerEmployeeId: string, day: string, type?: string) {
  for (const r of await read(orgId, { day, managers: { userIds: [], employeeIds: [managerEmployeeId] } })) {
    /* A row naming nobody with a People record decides nothing here, so it never hides an older one that does. */
    if (r.employeeId !== managerEmployeeId || !r.standInEmployeeId || !covers(r.requestTypes, type)) continue;
    return r.standInEmployeeId !== managerEmployeeId ? r.standInEmployeeId : null;
  }
  return null;
}

/** The managers (People records) this person stands in for on `day`, for `type`. */
export async function managersCoveredBy(orgId: string, employeeId: string, day: string, type?: string) {
  const rows = (await read(orgId, { day, standIns: { userIds: [], employeeIds: [employeeId] } }))
    .filter((r) => r.standInEmployeeId === employeeId && r.employeeId && r.employeeId !== employeeId && covers(r.requestTypes, type));
  return [...new Set(rows.map((r) => r.employeeId as string))];
}

/** Stand-ins ending on or after `endsFrom` (all when null), optionally one manager's, newest start first, with both people's names. */
export async function listStandIns(orgId: string, endsFrom: string | null, day: string, managers?: People) {
  const rows = (await read(orgId, { ...(endsFrom ? { endsFrom } : {}), ...(managers ? { managers } : {}), limit: 200 }))
    .sort((a, b) => b.fromDate.localeCompare(a.fromDate) || b.createdAt.getTime() - a.createdAt.getTime());
  const records = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.flatMap((r) => [r.employeeId, r.standInEmployeeId]).filter(Boolean) as string[])] } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]));
  const logins = await namesFor(rows.flatMap((r) => [r.userId, r.standInUserId]).filter(Boolean) as string[], orgId);
  return rows.map((r) => ({
    ...r,
    managerEmployeeId: r.employeeId,
    managerName: (r.employeeId && records.get(r.employeeId)) || (r.userId && logins.get(r.userId)) || null,
    standInName: (r.standInEmployeeId && records.get(r.standInEmployeeId)) || (r.standInUserId && logins.get(r.standInUserId)) || null,
    live: r.fromDate <= day && r.toDate >= day,
  }));
}

/** Who may decide anything at all: a stand-in handing on People requests must be one of them. */
export async function deciders(accountId: string, orgId: string) {
  const [people, leave] = await Promise.all([usersWithPermission(accountId, orgId, 'PEOPLE::Requests::APPROVE'), usersWithPermission(accountId, orgId, 'ATTENDANCE::Leave Requests::APPROVE')]);
  return new Set([...people, ...leave]);
}

/**
 * Write a stand-in (the caller has checked who may). The sign-ins are kept
 * only when it hands on People requests; one covering leave or attendance
 * is also written, linked, to ApprovalStandIn until phase 3c.
 */
export async function nameStandIn(data: {
  accountId: string; orgId: string; createdByUserId: string;
  userId: string | null; employeeId: string | null; standInUserId: string | null; standInEmployeeId: string | null;
  fromDate: string; toDate: string; requestTypes: string[]; note?: string | null;
}) {
  const { accountId, orgId, createdByUserId, fromDate, toDate, requestTypes } = data;
  /* Leave and attendance go by People record: never store one that would decide none of it (callers refuse it first). */
  if (covers(requestTypes, 'TIME') && !data.standInEmployeeId) throw new Error('A stand-in for leave or attendance needs a People record.');
  const people = coversPeople(requestTypes) && data.userId && data.standInUserId;
  return peoplePrisma.$transaction(async (tx) => {
    const old = covers(requestTypes, 'TIME') && data.employeeId && data.standInEmployeeId
      ? await tx.approvalStandIn.create({ data: { accountId, orgId, managerEmployeeId: data.employeeId, standInEmployeeId: data.standInEmployeeId, fromDate, toDate, createdByUserId } })
      : null;
    return tx.standIn.create({
      data: {
        accountId, orgId, createdByUserId, fromDate, toDate, requestTypes,
        userId: people ? data.userId : null, standInUserId: people ? data.standInUserId : null,
        employeeId: data.employeeId, standInEmployeeId: data.standInEmployeeId,
        note: data.note ? data.note.slice(0, 500) : null, legacyId: old?.id ?? null,
      },
    });
  });
}

/** One stand-in by id, from either table. */
export async function findStandIn(orgId: string, id: string): Promise<StandInRow | null> {
  return (await read(orgId, { id }))[0] || null;
}

/** Remove a stand-in, from both tables: a new row and the old row linked to it go together, or the fallback read would bring it back. */
export async function removeStandIn(orgId: string, row: StandInRow) {
  await peoplePrisma.$transaction(async (tx) => {
    if (row.source === 'NEW') await tx.standIn.deleteMany({ where: { id: row.id, orgId } });
    const legacyId = row.source === 'OLD' ? row.id : row.legacyId;
    if (legacyId) await tx.approvalStandIn.deleteMany({ where: { id: legacyId, orgId } });
  });
}
