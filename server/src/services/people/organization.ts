import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { isFeatureEnabled } from '../features.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { type Actor, writeChangeLog } from './changeLog.js';
import { updateEmployee } from './employees.js';
import { scopeWhere, type TeamScope } from './scope.js';

/**
 * Organization (docs/people/design-v1/ORGANIZATION-DECISIONS.md): how the
 * company is set up and who runs what.
 *
 *  - The structure lists, one shape for all of them (STRUCTURE_KINDS).
 *  - Their change history: every create, rename, edit, move, retire,
 *    reactivate, merge and delete is one change-log line (entity Structure),
 *    with the changed fields before and after, by name rather than id.
 *  - Merge, and retire with the people moved: each person moves through the
 *    one write path (employees.ts), so their own history says why.
 *  - The overview: branches, departments under their heads, how many people
 *    where, and what needs fixing.
 *  - The "Detailed structure" switch, turned on once for a company that
 *    already uses any of the detailed lists.
 *
 * A department head is descriptive only (research D04): nothing here, or
 * anywhere, grants a head anything.
 */

export const STRUCTURE_KINDS = {
  departments: { model: 'department', usedBy: 'departmentId', extra: ['parentId', 'description', 'headEmployeeId'] },
  'job-positions': { model: 'jobPosition', usedBy: 'jobPositionId', extra: ['departmentId', 'description'] },
  'job-roles': { model: 'jobRole', usedBy: 'jobRoleId', extra: ['jobPositionId', 'description'] },
  'employee-types': { model: 'employeeType', usedBy: 'employeeTypeId', extra: ['category', 'probationMonths', 'noticeDays'] },
  'work-types': { model: 'workType', usedBy: 'workTypeId', extra: [] },
  areas: { model: 'area', usedBy: 'areaId', extra: ['parentId', 'description'] },
  'business-units': { model: 'businessUnit', usedBy: 'businessUnitId', extra: ['description'] },
  grades: { model: 'grade', usedBy: 'gradeId', extra: ['description'] },
  'cost-centres': { model: 'costCenter', usedBy: 'costCenterId', extra: ['description'] },
  /* The company in law and its places of work (FND-07). A person's work state is their establishment's. */
  'legal-entities': { model: 'legalEntity', usedBy: null, extra: ['description', 'pan', 'cin', 'address'] },
  establishments: { model: 'establishment', usedBy: 'establishmentId', extra: ['description', 'legalEntityId', 'kind', 'state', 'address', 'registrations', 'holdsOriginals'] },
  /* Teams under departments, with a lead; approved seats on a team, filled or open (ORG-01, ORG-04). */
  teams: { model: 'team', usedBy: 'teamId', extra: ['departmentId', 'leadEmployeeId', 'description'] },
  seats: { model: 'seat', usedBy: 'seatId', extra: ['teamId', 'jobPositionId', 'budgetRef', 'description'] },
} as const;
export type Kind = keyof typeof STRUCTURE_KINDS;

/** What one item of each list is called, for the change history. */
export const KIND_LABEL: Record<Kind, string> = {
  departments: 'Department', 'job-positions': 'Designation', 'job-roles': 'Job role', 'employee-types': 'Employment type', 'work-types': 'Work mode',
  areas: 'Location', 'business-units': 'Business unit', grades: 'Grade', 'cost-centres': 'Cost centre', 'legal-entities': 'Legal company',
  establishments: 'Work site', teams: 'Team', seats: 'Position',
};

/** Lists whose items can be merged into another of the same list. */
export const MERGEABLE = new Set<Kind>(['departments', 'job-positions', 'employee-types', 'work-types', 'areas', 'business-units', 'grades', 'cost-centres', 'teams', 'job-roles']);

/** The field that says where an item sits; a change to it is a move. */
const PLACE_FIELD: Partial<Record<Kind, string>> = { departments: 'parentId', areas: 'parentId', teams: 'departmentId', 'job-positions': 'departmentId', 'job-roles': 'jobPositionId', seats: 'teamId' };

const FIELD_LABEL: Record<string, string> = {
  name: 'Name', description: 'Description', departmentId: 'Department', jobPositionId: 'Designation', teamId: 'Team', legalEntityId: 'Legal company',
  headEmployeeId: 'Head', leadEmployeeId: 'Team lead', category: 'Counts as', probationMonths: 'Probation (months)', noticeDays: 'Notice (days)',
  kind: 'Kind of place', state: 'State', address: 'Address', registrations: 'Registrations', holdsOriginals: 'Keeps original documents',
  budgetRef: 'Budget reference', pan: 'PAN', cin: 'CIN', isActive: 'In use',
};
const labelOfField = (kind: Kind, field: string) => (field === 'parentId' ? (kind === 'areas' ? 'Inside' : 'Part of') : FIELD_LABEL[field] || field);

/* A reference field names another row; the history shows its name. */
const REF_MODEL: Record<string, string> = { departmentId: 'department', jobPositionId: 'jobPosition', teamId: 'team', legalEntityId: 'legalEntity', headEmployeeId: 'employee', leadEmployeeId: 'employee' };

async function nameOf(orgId: string, model: string, id: string): Promise<string> {
  const row = await (peoplePrisma as any)[model].findFirst({ where: { id, orgId }, select: { name: true } });
  return row?.name ?? 'something since removed';
}

async function shown(orgId: string, kind: Kind, field: string, v: unknown): Promise<string | null> {
  if (v === null || v === undefined || v === '') return null;
  if (field === 'parentId') return nameOf(orgId, STRUCTURE_KINDS[kind].model, String(v));
  if (REF_MODEL[field]) return nameOf(orgId, REF_MODEL[field], String(v));
  if (field === 'isActive') return v ? 'Yes' : 'No (retired)';
  if (field === 'pan') return `******${String(v).slice(-4)}`;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.length ? `${v.length} on file` : null;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export type FieldChange = { field: string; label: string; before: string | null; after: string | null };

/** The fields that differ between two versions of an item, named for people. `before` null is a new item. */
export async function structureChanges(orgId: string, kind: Kind, before: Record<string, unknown> | null, after: Record<string, unknown>): Promise<FieldChange[]> {
  const out: FieldChange[] = [];
  for (const field of ['name', ...STRUCTURE_KINDS[kind].extra, 'isActive']) {
    if (!(field in after)) continue;
    const was = before ? before[field] : undefined;
    const now = after[field];
    if (!before && (field === 'isActive' || now === null || now === undefined || now === '')) continue;
    if (JSON.stringify(was ?? null) === JSON.stringify(now ?? null)) continue;
    out.push({ field, label: labelOfField(kind, field), before: before ? await shown(orgId, kind, field, was) : null, after: await shown(orgId, kind, field, now) });
  }
  return out;
}

export type StructureAction = 'CREATED' | 'RENAMED' | 'EDITED' | 'MOVED' | 'RETIRED' | 'REACTIVATED' | 'MERGED' | 'DELETED';

/** What an edit amounts to, for the history's headline. */
export function actionOf(kind: Kind, changes: FieldChange[]): StructureAction | null {
  if (!changes.length) return null;
  const active = changes.find((c) => c.field === 'isActive');
  if (active) return active.after === 'Yes' ? 'REACTIVATED' : 'RETIRED';
  if (PLACE_FIELD[kind] && changes.some((c) => c.field === PLACE_FIELD[kind])) return 'MOVED';
  if (changes.length === 1 && changes[0].field === 'name') return 'RENAMED';
  return 'EDITED';
}

type Tx = Parameters<typeof writeChangeLog>[0];

/** One history line for one structure change, in the caller's transaction when there is one. */
export async function logStructure(tx: Tx, actor: Actor, kind: Kind, item: { id: string; name: string }, action: StructureAction, changes: FieldChange[]) {
  return writeChangeLog(tx, actor, { kind: 'Structure', id: item.id, employeeId: null }, [
    { field: `${kind}.${action}`, before: null, after: JSON.stringify({ name: item.name, changes }), redacted: false },
  ]);
}

/** The structure change history, newest first, a page at a time (`before` is the last entry id of the page before). */
export async function structureHistory(orgId: string, q: { kind?: Kind | null; id?: string | null; limit?: number; before?: string | null }) {
  const take = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const where: any = { orgId, entity: 'Structure', ...(q.id ? { entityId: q.id } : {}), ...(q.kind ? { field: { startsWith: `${q.kind}.` } } : {}) };
  if (q.before) {
    const cursor = await peoplePrisma.changeLog.findFirst({ where: { id: q.before, orgId, entity: 'Structure' }, select: { at: true, id: true } });
    if (cursor) where.OR = [{ at: { lt: cursor.at } }, { at: cursor.at, id: { lt: cursor.id } }];
  }
  const rows = await peoplePrisma.changeLog.findMany({ where, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: take + 1 });
  const page = rows.slice(0, take);
  const userIds = [...new Set(page.map((r) => r.actorUserId).filter(Boolean))] as string[];
  const users = userIds.length ? await platformPrisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } }) : [];
  const userName = new Map(users.map((u) => [u.id, u.fullName || u.email]));
  const entries = page.map((r) => {
    const [kind, action] = r.field.split('.') as [Kind, StructureAction];
    let body: { name?: string; changes?: FieldChange[] } = {};
    try { body = JSON.parse(r.after || '{}'); } catch { body = {}; }
    return {
      id: r.id, at: r.at, actorName: r.actorUserId ? userName.get(r.actorUserId) || 'Someone no longer here' : 'CLOR',
      kind, kindLabel: KIND_LABEL[kind] || kind, itemId: r.entityId, itemName: body.name || '', action, changes: body.changes || [], reason: r.reason,
    };
  });
  return { entries, nextBefore: rows.length > take ? page[page.length - 1].id : null };
}

export class OrgError extends Error {
  constructor(message: string, public status = 400, public code?: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/** An item and the items under it, however deep (for "not into something inside it"). */
async function isInside(orgId: string, model: string, candidateId: string, ancestorId: string) {
  let at: string | null = candidateId;
  for (let depth = 0; at && depth < 50; depth += 1) {
    if (at === ancestorId) return true;
    at = ((await (peoplePrisma as any)[model].findFirst({ where: { id: at, orgId }, select: { parentId: true } })) as { parentId: string | null } | null)?.parentId ?? null;
  }
  return false;
}

const plural = (n: number) => (n === 1 ? '1 person is' : `${n} people are`);

/** The people still placed in an item: anyone who has not left. */
export const peopleIn = (orgId: string, kind: Kind, id: string) => {
  const usedBy = STRUCTURE_KINDS[kind].usedBy;
  return usedBy ? peoplePrisma.employee.count({ where: { orgId, [usedBy]: id, status: { not: 'LEFT' } } as any }) : Promise.resolve(0);
};

export const inUseRefusal = (n: number, name: string) => new OrgError(`${plural(n)} in ${name}. Choose where they move, then retire it.`, 409, 'IN_USE', { count: n });

/** Check a target for a move or merge: same list, this company, in use, not the item itself, not inside it. */
export async function targetFor(orgId: string, kind: Kind, source: { id: string }, targetId: unknown) {
  const cfg = STRUCTURE_KINDS[kind];
  const id = typeof targetId === 'string' ? targetId.trim() : '';
  if (!id) throw new OrgError(`Choose the ${KIND_LABEL[kind].toLowerCase()} to move them to.`);
  if (id === source.id) throw new OrgError('Choose a different one: it cannot merge into itself.');
  const target = await (peoplePrisma as any)[cfg.model].findFirst({ where: { id, orgId } });
  if (!target) throw new OrgError(`That is not a ${KIND_LABEL[kind].toLowerCase()} in this company's list.`);
  if (target.isActive === false) throw new OrgError(`${target.name} is retired. Choose one still in use.`);
  if ((kind === 'departments' || kind === 'areas') && (await isInside(orgId, cfg.model, target.id, source.id))) throw new OrgError(`${target.name} sits inside the one being merged. Choose one outside it.`);
  if (kind === 'seats') {
    const holder = await peoplePrisma.employee.findFirst({ where: { orgId, seatId: target.id, status: { not: 'LEFT' } }, select: { name: true } });
    if (holder) throw new OrgError(`${holder.name} already holds ${target.name}.`, 409);
  }
  return target as { id: string; name: string } & Record<string, unknown>;
}

/**
 * Move everyone still in `source` into `target`, one person at a time through
 * the one write path, so each person's history reads "<why>". Dated changes
 * waiting to put someone into `source` now put them into `target`.
 */
export async function movePeople(actor: Actor, kind: Kind, source: { id: string; name: string }, target: { id: string; name: string }, why: string) {
  const usedBy = STRUCTURE_KINDS[kind].usedBy;
  if (!usedBy) return 0;
  const people = await peoplePrisma.employee.findMany({ where: { orgId: actor.orgId, [usedBy]: source.id, status: { not: 'LEFT' } } as any });
  const data: Record<string, unknown> = { [usedBy]: target.id };
  if (kind === 'departments') data.department = target.name;
  if (kind === 'job-positions') data.designation = target.name;
  const who: Actor = { ...actor, source: 'BULK', reason: why };
  let moved = 0;
  for (const p of people) {
    await updateEmployee(who, p as any, data as any, {});
    moved += 1;
  }
  await peoplePrisma.scheduledChange.updateMany({ where: { orgId: actor.orgId, field: usedBy, toValue: source.id, status: 'PENDING' }, data: { toValue: target.id, toLabel: target.name } });
  return moved;
}

/** What sits under an item and moves with a merge: sub-departments, teams and designations under a department; roles and positions under a designation; positions on a team; sub-locations. */
async function moveChildren(orgId: string, kind: Kind, sourceId: string, targetId: string) {
  const moves: Array<Promise<{ count: number }>> = [];
  if (kind === 'departments') {
    moves.push(peoplePrisma.department.updateMany({ where: { orgId, parentId: sourceId }, data: { parentId: targetId } }));
    moves.push(peoplePrisma.team.updateMany({ where: { orgId, departmentId: sourceId }, data: { departmentId: targetId } }));
    moves.push(peoplePrisma.jobPosition.updateMany({ where: { orgId, departmentId: sourceId }, data: { departmentId: targetId } }));
  }
  if (kind === 'areas') moves.push(peoplePrisma.area.updateMany({ where: { orgId, parentId: sourceId }, data: { parentId: targetId } }));
  if (kind === 'job-positions') {
    moves.push(peoplePrisma.jobRole.updateMany({ where: { orgId, jobPositionId: sourceId }, data: { jobPositionId: targetId } }));
    moves.push(peoplePrisma.seat.updateMany({ where: { orgId, jobPositionId: sourceId }, data: { jobPositionId: targetId } }));
  }
  if (kind === 'teams') moves.push(peoplePrisma.seat.updateMany({ where: { orgId, teamId: sourceId }, data: { teamId: targetId } }));
  return (await Promise.all(moves)).reduce((n, r) => n + r.count, 0);
}

/** Merge one item into another of the same list: people and what sits under it move, the duplicate is retired, and the history says so. */
export async function mergeInto(actor: Actor, kind: Kind, sourceId: string, intoId: unknown) {
  if (!MERGEABLE.has(kind)) throw new OrgError(`${KIND_LABEL[kind]}s cannot be merged.`, 400);
  const model: any = (peoplePrisma as any)[STRUCTURE_KINDS[kind].model];
  const source = await model.findFirst({ where: { id: sourceId, orgId: actor.orgId } });
  if (!source) throw new OrgError('Not found.', 404);
  const target = await targetFor(actor.orgId, kind, source, intoId);
  const moved = await movePeople(actor, kind, source, target, `Merged into ${target.name}`);
  const children = await moveChildren(actor.orgId, kind, source.id, target.id);
  const item = await peoplePrisma.$transaction(async (tx) => {
    const row = await (tx as any)[STRUCTURE_KINDS[kind].model].update({ where: { id: source.id }, data: { isActive: false } });
    await logStructure(tx, actor, kind, row, 'MERGED', [
      { field: 'mergedInto', label: 'Merged into', before: null, after: target.name },
      ...(source.isActive !== false ? [{ field: 'isActive', label: FIELD_LABEL.isActive, before: 'Yes', after: 'No (retired)' }] : []),
      { field: 'peopleMoved', label: 'People moved', before: null, after: String(moved) },
      ...(children ? [{ field: 'childrenMoved', label: 'Items moved under it', before: null, after: String(children) }] : []),
    ]);
    return row;
  });
  return { moved, children, item };
}

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
/** Working now (one definition, D12): not left, and already joined or no joining date. */
export const workingNow = () => ({ status: { not: 'LEFT' as const }, OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: todayIst() } }] });

/* The lists "Detailed structure" covers. */
const DETAILED: Array<[string, string]> = [['team', 'teams'], ['seat', 'positions'], ['businessUnit', 'units'], ['grade', 'grades'], ['costCenter', 'centres'], ['jobRole', 'roles'], ['area', 'areas'], ['establishment', 'sites']];
export const ORG_DETAIL = 'peopleOrgDetail';

/**
 * The "Detailed structure" switch, decided once per company: a company that
 * already has any active team, position, business unit, grade, cost centre,
 * job role or location gets it on, so nothing it uses disappears; any other
 * company gets the default (off), written down so the question is not asked
 * again. A choice the company has made itself is never touched.
 */
export async function ensureOrgDetail(accountId: string, orgId: string, userId: string | null) {
  const existing = await platformPrisma.featureSetting.findFirst({ where: { accountId, orgId, key: ORG_DETAIL }, select: { id: true } });
  if (existing) return false;
  const counts = await Promise.all(DETAILED.map(([model]) => (peoplePrisma as any)[model].count({ where: { orgId, isActive: true } }) as Promise<number>));
  const used = counts.some((n) => n > 0);
  await platformPrisma.featureSetting.createMany({ data: [{ accountId, orgId, key: ORG_DETAIL, enabled: used, updatedByUserId: userId || 'system' }], skipDuplicates: true });
  return used;
}

/** Every company at once, outside any request (maintenance scope); safe to repeat. */
export async function backfillOrgDetail() {
  const orgs = await platformPrisma.org.findMany({ select: { id: true, accountId: true } });
  let turnedOn = 0;
  for (const o of orgs) {
    try {
      if (await ensureOrgDetail(o.accountId, o.id, null)) turnedOn += 1;
    } catch (e) {
      console.error(`[org-detail] ${o.id}:`, e instanceof Error ? e.message : e); // eslint-disable-line no-console
    }
  }
  return { orgs: orgs.length, turnedOn };
}

export function startOrgDetailBackfill({ delayMs = 90_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const t = setTimeout(() => {
    exclusive('people.org-detail.backfill', leaseFor(6 * 3_600_000), async () => {
      console.log('[org-detail] backfill:', JSON.stringify(await backfillOrgDetail())); // eslint-disable-line no-console
    }, { idempotent: true }).catch((e) => console.error('[org-detail] backfill failed:', e instanceof Error ? e.message : e)); // eslint-disable-line no-console
  }, delayMs);
  t.unref?.();
  return () => clearTimeout(t);
}

/**
 * The whole company on one page (Organization overview), inside the viewer's
 * team scope. A department's or branch's people are everyone placed there who
 * has not left (future joiners included): the same count its list shows and
 * the people a merge or retire would move.
 */
export async function organizationOverview(accountId: string, orgId: string, scope: TeamScope, userId: string | null) {
  await ensureOrgDetail(accountId, orgId, userId);
  await fillSoleBranch(accountId, orgId);
  const base = { accountId, orgId, ...scopeWhere(scope), status: { not: 'LEFT' as const } };
  const [org, branches, departments, byBranch, byDept, noDepartment, noBranch, detailed] = await Promise.all([
    platformPrisma.org.findFirst({ where: { id: orgId, accountId }, select: { name: true } }),
    platformPrisma.branch.findMany({ where: { accountId, orgId }, select: { id: true, branchName: true, branchCode: true, city: true, state: true, isActive: true }, orderBy: { branchName: 'asc' } }),
    peoplePrisma.department.findMany({ where: { accountId, orgId }, select: { id: true, name: true, parentId: true, isActive: true, headEmployeeId: true }, orderBy: { name: 'asc' } }),
    peoplePrisma.employee.groupBy({ by: ['branchId'], where: base as any, _count: { _all: true } }),
    peoplePrisma.employee.groupBy({ by: ['departmentId'], where: base as any, _count: { _all: true } }),
    peoplePrisma.employee.count({ where: { ...base, departmentId: null } as any }),
    peoplePrisma.employee.count({ where: { ...base, branchId: null } as any }),
    isFeatureEnabled(accountId, orgId, ORG_DETAIL),
  ]);
  /* Without a manager: their requests have nobody to go to (research, rank 1). The top of the tree — someone others report to — is not counted, as in Data Health. */
  const [unmanaged, reporting] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { ...base, reportingManagerId: null } as any, select: { id: true } }),
    peoplePrisma.employee.findMany({ where: { accountId, orgId, status: { not: 'LEFT' }, reportingManagerId: { not: null } }, select: { reportingManagerId: true } }),
  ]);
  const isManager = new Set(reporting.map((r) => r.reportingManagerId));
  const noManager = (await peoplePrisma.employee.count({ where: { accountId, orgId, status: { not: 'LEFT' } } })) > 1 ? unmanaged.filter((e) => !isManager.has(e.id)).length : 0;
  const branchCount = new Map(byBranch.map((r) => [r.branchId, r._count._all]));
  const deptCount = new Map(byDept.map((r) => [r.departmentId, r._count._all]));
  const heads = await headsOf(orgId, departments.map((d) => d.headEmployeeId));
  const active = { orgId, isActive: true };
  const [designations, roles, teams, positions, units, grades, centres, areas, sites, types, workModes] = await Promise.all([
    peoplePrisma.jobPosition.count({ where: active }), peoplePrisma.jobRole.count({ where: active }), peoplePrisma.team.count({ where: active }),
    peoplePrisma.seat.count({ where: active }), peoplePrisma.businessUnit.count({ where: active }), peoplePrisma.grade.count({ where: active }),
    peoplePrisma.costCenter.count({ where: active }), peoplePrisma.area.count({ where: active }), peoplePrisma.establishment.count({ where: active }),
    peoplePrisma.employeeType.count({ where: active }), peoplePrisma.workType.count({ where: active }),
  ]);
  return {
    company: { name: org?.name ?? '' },
    branches: branches.map((b) => ({ id: b.id, name: b.branchName, code: b.branchCode, city: b.city, state: b.state, isActive: b.isActive, people: branchCount.get(b.id) || 0 })),
    departments: departments.map((d) => ({ ...d, ...headFields(heads, d.headEmployeeId), people: deptCount.get(d.id) || 0 })),
    unplaced: { noDepartment, noBranch, noManager },
    lists: { designations, roles, teams, positions, units, grades, centres, areas, sites, types, workModes },
    detailed,
  };
}

/**
 * A company with exactly one open branch: everyone works from it. People
 * added before branches were shown on the record get it, once, so Attendance
 * gives them that branch's holidays and the overview counts them there.
 */
export async function fillSoleBranch(accountId: string, orgId: string) {
  const open = await platformPrisma.branch.findMany({ where: { accountId, orgId, isActive: true }, select: { id: true }, take: 2 });
  if (open.length !== 1) return 0;
  const r = await peoplePrisma.employee.updateMany({ where: { accountId, orgId, branchId: null, status: { not: 'LEFT' } }, data: { branchId: open[0].id } });
  return r.count;
}

/** Heads by id, with whether they have left. */
export async function headsOf(orgId: string, ids: Array<string | null>) {
  const wanted = [...new Set(ids.filter(Boolean))] as string[];
  const rows = wanted.length ? await peoplePrisma.employee.findMany({ where: { orgId, id: { in: wanted } }, select: { id: true, name: true, status: true } }) : [];
  return new Map(rows.map((r) => [r.id, r]));
}
export const headFields = (heads: Map<string, { name: string; status: string }>, id: string | null) => {
  const h = id ? heads.get(id) : null;
  return { headEmployeeId: id ?? null, headName: h?.name ?? null, headLeft: Boolean(h && h.status === 'LEFT') };
};

/**
 * The first person to work in a state (research: PT, LWF, holidays and the
 * shop or establishment registration all follow the state of the
 * workplace): HR gets one task listing what to register there. Once per
 * company and state; never for a company's very first state.
 */
export async function firstInState(actor: { accountId: string; orgId: string; userId: string | null }, employee: { id: string; branchId?: string | null; status?: string | null }) {
  if (!employee.branchId || employee.status === 'LEFT') return false;
  const branch = await platformPrisma.branch.findFirst({ where: { id: employee.branchId, orgId: actor.orgId }, select: { state: true, branchName: true } });
  const state = branch?.state?.trim();
  if (!state) return false;
  const marker = `state:${state.toLowerCase()}`;
  if (await peoplePrisma.checklistTask.count({ where: { orgId: actor.orgId, kind: 'CHANGE', note: { contains: marker } } })) return false;
  const branches = await platformPrisma.branch.findMany({ where: { accountId: actor.accountId, orgId: actor.orgId }, select: { id: true, state: true } });
  const sameState = branches.filter((b) => (b.state || '').trim().toLowerCase() === state.toLowerCase()).map((b) => b.id);
  const here = await peoplePrisma.employee.count({ where: { orgId: actor.orgId, status: { not: 'LEFT' }, id: { not: employee.id }, branchId: { in: sameState } } });
  if (here) return false;
  /* A company's first state is where it started; it registered there already. */
  const elsewhere = await peoplePrisma.employee.count({ where: { orgId: actor.orgId, status: { not: 'LEFT' }, id: { not: employee.id } } });
  if (!elsewhere) return false;
  const { startChecklist } = await import('./checklists.js');
  await startChecklist(actor, { id: employee.id }, 'CHANGE', null, { items: [{ title: `First person working in ${state}: register there`, owner: 'HR', dueDays: 0, note: `${marker}. Professional Tax (if ${state} levies it), Labour Welfare Fund (if it applies), the shop or establishment registration (or OSH Code registration), and a holiday list for ${branch!.branchName}.` }] });
  return true;
}
