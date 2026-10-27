import type { Request } from 'express';

import { peoplePrisma } from '../utils/peoplePrisma.js';
import { Prisma as PeoplePrisma } from '../generated/people/index.js';
import { exclusive, leaseFor } from './jobLease.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE } from './attendance/guards.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE } from './people/guards.js';
import { registerJob } from './jobRegistry.js';

/**
 * The recycle bin (founder, 21 Oct 2026): something deleted by mistake can be
 * brought back for RECYCLE_BIN_DAYS (default 30), then it is gone for good.
 *
 * A delete still removes the row, so nothing else in the product has to learn
 * to skip "deleted" rows. Just before, the row is copied here whole, with the
 * rows that go with it (an employee's notes, documents and tags), and the ids
 * of rows that pointed at it (the people who reported to them). Restoring
 * writes it back under the same id, so every plain-id link to it (punches,
 * days, leave) is whole again.
 *
 * Readers are the exception and are not binned: removing a reader changes the
 * device itself, which a database restore cannot undo.
 */

type Child = { model: string; field: string };
type Kind = {
  model: string;
  noun: string;
  /** Permission that may delete it, and so see and restore it. */
  module: string;
  resource: string;
  children?: Child[];
  label: (row: any) => string | Promise<string>;
};

const employeeName = async (employeeId: string | null | undefined) => {
  if (!employeeId) return '';
  const e = await peoplePrisma.employee.findUnique({ where: { id: employeeId }, select: { name: true, code: true } });
  return e ? `${e.name}${e.code ? ` (${e.code})` : ''}` : '';
};
const forPerson = async (what: string, row: any) => [what, await employeeName(row.employeeId)].filter(Boolean).join(' · ');

const A = ATTENDANCE_RESOURCE;
const P = PEOPLE_RESOURCE;
export const BIN_KINDS: Record<string, Kind> = {
  employee: {
    model: 'employee', noun: 'Employee', module: PEOPLE_MODULE, resource: P.employees,
    children: [{ model: 'employeeTagLink', field: 'employeeId' }, { model: 'employeeNote', field: 'employeeId' }, { model: 'employeeDocument', field: 'employeeId' }],
    label: (r) => `${r.name}${r.code ? ` (${r.code})` : ''}`,
  },
  employeeNote: { model: 'employeeNote', noun: 'Employee note', module: PEOPLE_MODULE, resource: P.notes, label: (r) => forPerson(String(r.body || 'Note').slice(0, 60), r) },
  employeeDocument: { model: 'employeeDocument', noun: 'Employee document', module: PEOPLE_MODULE, resource: P.documents, label: (r) => forPerson(r.title || 'Document', r) },
  department: { model: 'department', noun: 'Department', module: PEOPLE_MODULE, resource: P.structure, label: (r) => r.name },
  jobPosition: { model: 'jobPosition', noun: 'Designation', module: PEOPLE_MODULE, resource: P.structure, label: (r) => r.name },
  jobRole: { model: 'jobRole', noun: 'Job role', module: PEOPLE_MODULE, resource: P.structure, label: (r) => r.name },
  employeeType: { model: 'employeeType', noun: 'Employee type', module: PEOPLE_MODULE, resource: P.structure, label: (r) => r.name },
  workType: { model: 'workType', noun: 'Work type', module: PEOPLE_MODULE, resource: P.structure, label: (r) => r.name },
  area: { model: 'area', noun: 'Location', module: PEOPLE_MODULE, resource: P.structure, label: (r) => r.name },
  businessUnit: { model: 'businessUnit', noun: 'Business unit', module: PEOPLE_MODULE, resource: P.structure, label: (r) => r.name },
  grade: { model: 'grade', noun: 'Grade', module: PEOPLE_MODULE, resource: P.structure, label: (r) => r.name },
  costCenter: { model: 'costCenter', noun: 'Cost centre', module: PEOPLE_MODULE, resource: P.structure, label: (r) => r.name },
  legalEntity: { model: 'legalEntity', noun: 'Legal entity', module: PEOPLE_MODULE, resource: P.structure, label: (r) => r.name },
  establishment: { model: 'establishment', noun: 'Establishment', module: PEOPLE_MODULE, resource: P.structure, label: (r) => r.name },
  team: { model: 'team', noun: 'Team', module: PEOPLE_MODULE, resource: P.structure, label: (r) => r.name },
  seat: { model: 'seat', noun: 'Seat', module: PEOPLE_MODULE, resource: P.structure, label: (r) => r.name },
  contractor: { model: 'contractor', noun: 'Contractor', module: PEOPLE_MODULE, resource: P.structure, label: (r) => r.name },
  holiday: { model: 'holiday', noun: 'Holiday', module: ATTENDANCE_MODULE, resource: A.holidays, label: (r) => `${r.name} · ${r.date}` },
  leaveType: { model: 'leaveType', noun: 'Leave type', module: ATTENDANCE_MODULE, resource: A.leaveTypes, label: (r) => r.name },
  leaveAdjustment: { model: 'leaveAdjustment', noun: 'Leave adjustment', module: ATTENDANCE_MODULE, resource: A.leave, label: (r) => forPerson(`${r.days > 0 ? '+' : ''}${r.days} days, ${r.year}: ${r.reason}`, r) },
  shift: { model: 'shift', noun: 'Shift', module: ATTENDANCE_MODULE, resource: A.shifts, label: (r) => r.name },
  shiftAssignment: { model: 'shiftAssignment', noun: 'Shift assignment', module: ATTENDANCE_MODULE, resource: A.shifts, label: (r) => forPerson(`From ${r.effectiveFrom}`, r) },
  temporarySchedule: { model: 'temporarySchedule', noun: 'Temporary schedule', module: ATTENDANCE_MODULE, resource: A.shifts, label: (r) => forPerson(`${r.fromDate || ''} to ${r.toDate || ''}`, r) },
  departmentSchedule: { model: 'departmentSchedule', noun: 'Department schedule', module: ATTENDANCE_MODULE, resource: A.shifts, label: async (r) => { const d = await peoplePrisma.department.findUnique({ where: { id: r.departmentId }, select: { name: true } }); return `${d?.name || 'Department'} · from ${r.effectiveFrom}`; } },
  shiftRotation: { model: 'shiftRotation', noun: 'Rotation', module: ATTENDANCE_MODULE, resource: A.shifts, label: (r) => r.name },
  rotationAssignment: { model: 'rotationAssignment', noun: 'Rotation assignment', module: ATTENDANCE_MODULE, resource: A.shifts, label: (r) => forPerson(`From ${r.startsOn}`, r) },
  attendanceRecord: { model: 'attendanceRecord', noun: 'Attendance day', module: ATTENDANCE_MODULE, resource: A.records, label: (r) => forPerson(`${r.date} · ${String(r.status || '').replace(/_/g, ' ').toLowerCase()}`, r) },
};

export const binDays = () => {
  const n = Number(String(process.env.RECYCLE_BIN_DAYS || '').trim());
  return Number.isFinite(n) && n > 0 ? n : 30;
};

/* Rows as JSON and back: dates as ISO strings, file contents as base64. */
const modelMeta = (model: string) => {
  const name = model[0].toUpperCase() + model.slice(1);
  const m = PeoplePrisma.dmmf.datamodel.models.find((x) => x.name === name);
  if (!m) throw new Error(`recycle bin: no model ${name}`);
  return m;
};
function toJson(model: string, row: any) {
  const out: Record<string, unknown> = {};
  for (const f of modelMeta(model).fields) {
    if (f.kind === 'object' || !(f.name in row)) continue;
    const v = row[f.name];
    out[f.name] = v == null ? v : f.type === 'Bytes' ? Buffer.from(v).toString('base64') : f.type === 'DateTime' ? new Date(v).toISOString() : f.type === 'Decimal' ? String(v) : v;
  }
  return out;
}
function fromJson(model: string, data: any) {
  const out: Record<string, unknown> = {};
  for (const f of modelMeta(model).fields) {
    if (f.kind === 'object' || !(f.name in data)) continue;
    const v = data[f.name];
    out[f.name] = v == null ? (f.type === 'Json' ? PeoplePrisma.JsonNull : v) : f.type === 'Bytes' ? Buffer.from(String(v), 'base64') : f.type === 'DateTime' ? new Date(v) : v;
  }
  return out;
}

const delegate = (model: string): any => (peoplePrisma as any)[model];

/**
 * Deletes `row` (already found and checked by the route), keeping a copy in
 * the bin. `alongside` runs in the same transaction, before the delete.
 */
export async function deleteToBin(req: Request, kind: string, row: any, opts: { alongside?: any[]; links?: Record<string, string[]> } = {}) {
  const k = BIN_KINDS[kind];
  if (!k) throw new Error(`recycle bin: unknown kind ${kind}`);
  const { accountId, orgId } = req.tenant!;
  const full = await delegate(k.model).findUnique({ where: { id: row.id } });
  if (!full) return;
  const children: Record<string, unknown[]> = {};
  for (const c of k.children || []) {
    children[c.model] = (await delegate(c.model).findMany({ where: { [c.field]: row.id } })).map((r: any) => toJson(c.model, r));
  }
  const now = new Date();
  await peoplePrisma.$transaction([
    peoplePrisma.deletedItem.create({
      data: {
        accountId,
        orgId,
        kind,
        entityId: row.id,
        label: String((await k.label(full)) || k.noun).slice(0, 200),
        snapshot: { row: toJson(k.model, full), children, links: opts.links || {} } as any,
        deletedByUserId: req.auth!.userId,
        deletedAt: now,
        purgeAfter: new Date(now.getTime() + binDays() * 86_400_000),
      },
    }),
    ...(opts.alongside || []),
    delegate(k.model).delete({ where: { id: row.id } }),
  ]);
}

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

/**
 * Writes an item back. Refused, with the reason, when something now stands in
 * its place (a holiday re-added on the same date, an employee code reused).
 * Returns the restored row.
 */
export async function restoreFromBin(orgId: string, id: string) {
  const item = await peoplePrisma.deletedItem.findFirst({ where: { id, orgId } });
  if (!item) throw fail(404, 'That is no longer in the recycle bin.');
  const k = BIN_KINDS[item.kind];
  if (!k) throw fail(409, 'This kind of item cannot be restored.');
  const snap = item.snapshot as any;
  if (await delegate(k.model).findUnique({ where: { id: item.entityId }, select: { id: true } })) {
    throw fail(409, 'It is already back.');
  }
  try {
    const [restored] = await peoplePrisma.$transaction([
      delegate(k.model).create({ data: fromJson(k.model, snap.row) }),
      ...(k.children || []).flatMap((c) => {
        const rows = (snap.children?.[c.model] || []) as any[];
        return rows.length ? [delegate(c.model).createMany({ data: rows.map((r) => fromJson(c.model, r)), skipDuplicates: true })] : [];
      }),
      ...Object.entries((snap.links || {}) as Record<string, string[]>).flatMap(([field, ids]) =>
        ids.length ? [delegate(k.model).updateMany({ where: { orgId, id: { in: ids } }, data: { [field]: item.entityId } })] : []
      ),
      peoplePrisma.deletedItem.delete({ where: { id: item.id } }),
    ]);
    return { item, restored, kind: k };
  } catch (e: any) {
    if (String(e?.code) === 'P2002') {
      throw fail(409, `Cannot restore: another ${k.noun.toLowerCase()} now has the same ${String(e?.meta?.target || 'name or code').replace(/[[\]"]/g, '')}. Rename or remove it first.`);
    }
    if (String(e?.code) === 'P2003') throw fail(409, `Cannot restore: something this ${k.noun.toLowerCase()} belonged to has been removed.`);
    throw e;
  }
}

/** Once a day: items past their days in the bin are deleted for good. */
export async function purgeRecycleBin(now = new Date()) {
  /* An employee gone for good takes their employment history and checklists along (it is kept while they can still be restored). */
  const people = await peoplePrisma.deletedItem.findMany({ where: { purgeAfter: { lte: now }, kind: 'employee' }, select: { entityId: true } });
  if (people.length) {
    const ids = people.map((p) => p.entityId);
    await peoplePrisma.employmentEvent.deleteMany({ where: { employeeId: { in: ids } } });
    await peoplePrisma.checklistTask.deleteMany({ where: { employeeId: { in: ids } } });
  }
  return (await peoplePrisma.deletedItem.deleteMany({ where: { purgeAfter: { lte: now } } })).count;
}

export function startRecycleBinPurge() {
  if (String(process.env.RECYCLE_BIN_PURGE || '').toLowerCase() === 'off') return () => {};
  const run = () =>
    exclusive('recycleBin.purge', leaseFor(24 * 60 * 60 * 1000), () => purgeRecycleBin(), { idempotent: true }).then(
      (n) => {
        // eslint-disable-next-line no-console
        if (n) console.log(`[recycle bin] removed ${n} expired item(s)`);
      },
      (e) => {
        // eslint-disable-next-line no-console
        console.error('[recycle bin] purge failed:', e instanceof Error ? e.message : e);
      }
    );
  registerJob('startRecycleBinPurge', run, 24 * 60 * 60 * 1000);
  const first = setTimeout(run, 120_000);
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
