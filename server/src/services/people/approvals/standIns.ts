import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { usersWithPermission } from '../../notifications.js';
import { REQUEST_TYPES, namesFor } from './engine.js';

/**
 * Stand-ins, one table (workflow engine SPEC 5.3 step 1, section 6; phase 2b).
 *
 * Two systems grew apart: People approval stand-ins (`StandIn`, by sign-in,
 * read by the approvals engine) and leave delegates (`ApprovalStandIn`, by
 * People record, read by leave and attendance). Now every stand-in is one
 * `StandIn` row carrying whichever ids it has, the dates (IST, both days
 * included) and what it hands on:
 *
 *   []                      all approvals
 *   ['LEAVE']               leave only
 *   ['LEAVE', 'ATTENDANCE'] what a leave delegate always handed on: leave, and
 *                           attendance requests, overtime and field punches
 *   any request types       e.g. ['PROFILE_CHANGE', 'FORM:<id>']
 *
 * The leave delegates were copied in by the 20261118090000_stand_in_merge
 * migration. Nothing writes `ApprovalStandIn` now, but a row an older API
 * writes during a deploy is still honoured: every read here reads both, a
 * copied row once. Phase 3c drops the fallback with the table.
 */

/** What a leave delegate hands on unless told otherwise. */
export const LEAVE_DELEGATE_TYPES = ['LEAVE', 'ATTENDANCE'];
/** Attendance-side requests decided at the manager's step alongside leave. */
const ATTENDANCE_KINDS = new Set(['OVERTIME', 'COMP_OFF', 'FIELD_PUNCH']);
/** The group a request type is handed on under: attendance kinds under ATTENDANCE, the rest as themselves. */
export const groupOf = (type: string) => (type === 'ATTENDANCE' || type.startsWith('ATTENDANCE:') || ATTENDANCE_KINDS.has(type) ? 'ATTENDANCE' : type);
/** Only leave and attendance: decided in the employee app too, so a stand-in needs no sign-in. */
export const timeOnly = (types: string[]) => types.length > 0 && types.every((t) => t === 'LEAVE' || t === 'ATTENDANCE');

/**
 * Whether a stand-in handing on `types` covers a request of `type`. `TIME`
 * asks for leave or attendance (a queue that holds both); no type at all
 * (an engine call that names none) is covered by an all-approvals stand-in only.
 */
export function covers(types: string[] | null | undefined, type?: string) {
  if (!types || !types.length) return true;
  if (!type) return false;
  if (type === 'TIME') return types.includes('LEAVE') || types.includes('ATTENDANCE');
  return types.includes(type) || types.includes(groupOf(type));
}

/** The request types a stand-in may hand on, or null when one is not a type here. */
export function cleanTypes(input: unknown): string[] | null {
  if (input == null) return [];
  if (!Array.isArray(input)) return null;
  const known = new Set<string>(['LEAVE', 'ATTENDANCE', ...REQUEST_TYPES]);
  const out = [...new Set(input.map((t) => String(t || '').trim()))];
  if (out.some((t) => !known.has(t) && !/^FORM:[A-Za-z0-9_-]{1,64}$/.test(t))) return null;
  return out.sort();
}

export type StandInRow = {
  id: string;
  /** NEW: the one table. OLD: a leave delegate not copied yet (written by an older API). */
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

/**
 * Every stand-in of the company in a date window, from both tables, oldest
 * first, each with the sign-ins and People records its people have (a row
 * names whichever it was made with; the other is filled from the record).
 */
async function read(orgId: string, window: { day?: string; endsFrom?: string; id?: string } = {}): Promise<StandInRow[]> {
  const range = window.id ? { id: window.id } : window.day ? { fromDate: { lte: window.day }, toDate: { gte: window.day } } : window.endsFrom ? { toDate: { gte: window.endsFrom } } : {};
  const [rows, legacy] = await Promise.all([
    peoplePrisma.standIn.findMany({ where: { orgId, ...range }, orderBy: { createdAt: 'asc' }, take: 2000 }),
    peoplePrisma.approvalStandIn.findMany({ where: { orgId, ...range }, orderBy: { createdAt: 'asc' }, take: 2000 }),
  ]);
  /* A copied leave delegate is read once, from the one table. */
  const copied = legacy.length
    ? new Set((await peoplePrisma.standIn.findMany({ where: { orgId, legacyId: { in: legacy.map((l) => l.id) } }, select: { legacyId: true } })).map((r) => r.legacyId))
    : new Set<string | null>();
  const out: StandInRow[] = [
    ...rows.map((r) => ({ ...r, source: 'NEW' as const, requestTypes: r.requestTypes || [] })),
    ...legacy.filter((l) => !copied.has(l.id)).map((l) => ({
      id: l.id, source: 'OLD' as const, accountId: l.accountId, orgId: l.orgId, userId: null, standInUserId: null,
      employeeId: l.managerEmployeeId, standInEmployeeId: l.standInEmployeeId, fromDate: l.fromDate, toDate: l.toDate,
      requestTypes: LEAVE_DELEGATE_TYPES, note: null, createdByUserId: l.createdByUserId, legacyId: null, createdAt: l.createdAt,
    })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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

/** Stand-ins live on `day` that hand on `type`. */
export async function liveStandIns(orgId: string, day: string, type?: string) {
  return (await read(orgId, { day })).filter((r) => covers(r.requestTypes, type));
}

/** For the engine: each approver sign-in with someone standing in on `day` for `type`, and who. The latest named wins. */
export async function standInUsersFor(orgId: string, userIds: string[], day: string, type?: string) {
  const out = new Map<string, string>();
  if (!userIds.length) return out;
  const wanted = new Set(userIds);
  for (const r of await liveStandIns(orgId, day, type)) {
    if (r.userId && wanted.has(r.userId) && r.standInUserId && r.standInUserId !== r.userId) out.set(r.userId, r.standInUserId);
  }
  return out;
}

/** For leave and attendance: the People record deciding for this manager on `day`, or null for the manager themselves. The latest named wins. */
export async function standInEmployeeFor(orgId: string, managerEmployeeId: string, day: string, type?: string) {
  let found: string | null = null;
  for (const r of await liveStandIns(orgId, day, type)) {
    if (r.employeeId === managerEmployeeId && r.standInEmployeeId && r.standInEmployeeId !== managerEmployeeId) found = r.standInEmployeeId;
  }
  return found;
}

/** The managers (People records) this person stands in for on `day`, for `type`. */
export async function managersCoveredBy(orgId: string, employeeId: string, day: string, type?: string) {
  const rows = (await liveStandIns(orgId, day, type)).filter((r) => r.standInEmployeeId === employeeId && r.employeeId && r.employeeId !== employeeId);
  return [...new Set(rows.map((r) => r.employeeId as string))];
}

/** The stand-ins ending on or after `endsFrom` (all when null), newest start first, with the names of both people. */
export async function listStandIns(orgId: string, endsFrom: string | null, day: string) {
  const rows = (await read(orgId, endsFrom ? { endsFrom } : {})).sort((a, b) => b.fromDate.localeCompare(a.fromDate) || b.createdAt.getTime() - a.createdAt.getTime());
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

/** Who may decide anything at all: a stand-in handing on more than leave and attendance must be one of them. */
export async function deciders(accountId: string, orgId: string) {
  const [people, leave] = await Promise.all([usersWithPermission(accountId, orgId, 'PEOPLE::Requests::APPROVE'), usersWithPermission(accountId, orgId, 'ATTENDANCE::Leave Requests::APPROVE')]);
  return new Set([...people, ...leave]);
}

/** Write a stand-in to the one table (never to ApprovalStandIn). The caller has checked who may. */
export async function nameStandIn(data: {
  accountId: string; orgId: string; createdByUserId: string;
  userId: string | null; employeeId: string | null; standInUserId: string | null; standInEmployeeId: string | null;
  fromDate: string; toDate: string; requestTypes: string[]; note?: string | null;
}) {
  return peoplePrisma.standIn.create({ data: { ...data, note: data.note ? data.note.slice(0, 500) : null } });
}

/** One stand-in by id, from either table (an old one only while it is not copied). */
export async function findStandIn(orgId: string, id: string): Promise<StandInRow | null> {
  return (await read(orgId, { id }))[0] || null;
}

/**
 * Remove a stand-in, from both tables: a copied row and the leave delegate it
 * came from go together, or the fallback read would bring it back.
 */
export async function removeStandIn(orgId: string, row: StandInRow) {
  await peoplePrisma.$transaction(async (tx) => {
    if (row.source === 'NEW') await tx.standIn.deleteMany({ where: { id: row.id, orgId } });
    const legacyId = row.source === 'OLD' ? row.id : row.legacyId;
    if (legacyId) await tx.approvalStandIn.deleteMany({ where: { id: legacyId, orgId } });
  });
}
