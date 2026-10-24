import type { Request } from 'express';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { authorize } from '../../middleware/rbac.js';
import type { PermissionAction } from '../../constants/enums.js';
import { type Actor, writeChangeLog } from './changeLog.js';

/**
 * Custom fields on a person (docs/people/02-PRD.md CORE-08). The company
 * defines a field — text, number, date, choice, yes/no, file — and says
 * which grant may see it and which may edit it. A field the caller may not
 * see is not in the answer at all, key included. Every change to a
 * definition is a new version; a value remembers the version it was saved
 * under, so a later reader knows what the options were.
 */

export const FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'CHOICE', 'BOOLEAN', 'FILE'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
const KEY = /^[a-z][a-z0-9_]{1,39}$/;
const PERMISSION = /^[A-Z_]+::[A-Za-z &]+::[A-Z_]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CustomFieldError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type Def = { id: string; key: string; label: string; type: string; options: unknown; required: boolean; viewPermission: string; editPermission: string; help: string | null; version: number; active: boolean; sortOrder: number };
const shapeDef = (d: Def) => ({ id: d.id, key: d.key, label: d.label, type: d.type as FieldType, options: Array.isArray(d.options) ? (d.options as string[]) : [], required: d.required, viewPermission: d.viewPermission, editPermission: d.editPermission, help: d.help, version: d.version, active: d.active, sortOrder: d.sortOrder });

export async function defsOf(orgId: string, includeInactive = false) {
  const rows = await peoplePrisma.customFieldDef.findMany({ where: { orgId, entity: 'Employee', ...(includeInactive ? {} : { active: true }) }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
  return rows.map(shapeDef);
}

function cleanOptions(type: string, options: unknown) {
  if (type !== 'CHOICE') return null;
  const list = Array.isArray(options) ? [...new Set(options.map((o) => String(o ?? '').trim()).filter(Boolean))] : [];
  if (!list.length) throw new CustomFieldError('A choice field needs at least one option.');
  return list.slice(0, 50);
}

/** Make a field, or change one: label, options, required, permissions and help may change (a new version); the key and the type never do. */
export async function saveDef(who: { accountId: string; orgId: string; userId: string | null }, input: { id?: string | null; key?: string; label?: string; type?: string; options?: unknown; required?: boolean; viewPermission?: string; editPermission?: string; help?: string | null; active?: boolean; sortOrder?: number }) {
  const label = String(input.label || '').trim().slice(0, 80);
  const viewPermission = String(input.viewPermission || 'PEOPLE::Employees::VIEW').trim();
  const editPermission = String(input.editPermission || 'PEOPLE::Employees::EDIT').trim();
  if (!PERMISSION.test(viewPermission) || !PERMISSION.test(editPermission)) throw new CustomFieldError('Permissions look like PEOPLE::Employees::VIEW.');
  const help = String(input.help || '').trim().slice(0, 300) || null;
  if (input.id) {
    const row = await peoplePrisma.customFieldDef.findFirst({ where: { id: String(input.id), orgId: who.orgId } });
    if (!row) throw new CustomFieldError('No such field.', 404);
    if (input.key !== undefined && input.key !== row.key) throw new CustomFieldError('A field keeps its key; make a new field instead.');
    if (input.type !== undefined && String(input.type).toUpperCase() !== row.type) throw new CustomFieldError('A field keeps its type; make a new field instead.');
    const options = input.options !== undefined ? cleanOptions(row.type, input.options) : row.options;
    const changed = (label && label !== row.label) || (input.options !== undefined && JSON.stringify(options) !== JSON.stringify(row.options)) || (input.required !== undefined && Boolean(input.required) !== row.required) || viewPermission !== row.viewPermission || editPermission !== row.editPermission || help !== row.help;
    const updated = await peoplePrisma.customFieldDef.update({ where: { id: row.id }, data: { label: label || row.label, options: options as any, required: input.required !== undefined ? Boolean(input.required) : row.required, viewPermission, editPermission, help, ...(input.active !== undefined ? { active: Boolean(input.active) } : {}), ...(input.sortOrder !== undefined ? { sortOrder: Number(input.sortOrder) || 0 } : {}), ...(changed ? { version: { increment: 1 } } : {}) } });
    return shapeDef(updated);
  }
  const key = String(input.key || '').trim();
  if (!KEY.test(key)) throw new CustomFieldError('A key is lower-case letters, digits and underscores, starting with a letter: e.g. blood_group.');
  if (!label) throw new CustomFieldError('Name the field.');
  const type = String(input.type || '').toUpperCase() as FieldType;
  if (!FIELD_TYPES.includes(type)) throw new CustomFieldError('The type is text, number, date, choice, yes/no or file.');
  const count = await peoplePrisma.customFieldDef.count({ where: { orgId: who.orgId, entity: 'Employee' } });
  try {
    const row = await peoplePrisma.customFieldDef.create({ data: { accountId: who.accountId, orgId: who.orgId, entity: 'Employee', key, label, type, options: cleanOptions(type, input.options) as any, required: Boolean(input.required), viewPermission, editPermission, help, sortOrder: input.sortOrder !== undefined ? Number(input.sortOrder) || 0 : count, createdByUserId: who.userId } });
    return shapeDef(row);
  } catch (e: any) {
    if (String(e?.code) === 'P2002') throw new CustomFieldError(`A field with the key ${key} already exists.`, 409);
    throw e;
  }
}

/** Which of the given permissions the caller holds, asked once each. */
async function held(req: Request, permissions: string[]) {
  const ok = new Map<string, boolean>();
  for (const p of [...new Set(permissions)]) {
    const [module, resource, action] = p.split('::');
    ok.set(p, Boolean(module && resource && action) && !(await authorize(req, module, action as PermissionAction, resource)));
  }
  return ok;
}

/** The fields the caller may see for one person, with their values; a field they may not see is absent, key and all. */
export async function valuesFor(req: Request, orgId: string, employeeId: string) {
  const defs = await defsOf(orgId);
  const can = await held(req, defs.flatMap((d) => [d.viewPermission, d.editPermission]));
  const visible = defs.filter((d) => can.get(d.viewPermission));
  const rows = visible.length ? await peoplePrisma.customFieldValue.findMany({ where: { orgId, entityId: employeeId, defId: { in: visible.map((d) => d.id) } } }) : [];
  const of = new Map(rows.map((r) => [r.defId, r]));
  return visible.map((d) => ({ ...d, value: of.get(d.id)?.value ?? null, savedUnderVersion: of.get(d.id)?.defVersion ?? null, updatedAt: of.get(d.id)?.updatedAt ?? null, canEdit: Boolean(can.get(d.editPermission)) }));
}

function cleanValue(d: ReturnType<typeof shapeDef>, raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === '') {
    if (d.required) throw new CustomFieldError(`${d.label} is needed.`);
    return null;
  }
  switch (d.type) {
    case 'TEXT': return String(raw).trim().slice(0, 2000);
    case 'NUMBER': { const n = Number(raw); if (!Number.isFinite(n)) throw new CustomFieldError(`${d.label} is a number.`); return n; }
    case 'DATE': { const s = String(raw).trim(); if (!ISO_DATE.test(s)) throw new CustomFieldError(`${d.label} is a date (YYYY-MM-DD).`); return s; }
    case 'CHOICE': { const s = String(raw).trim(); if (!d.options.includes(s)) throw new CustomFieldError(`${d.label} is one of: ${d.options.join(', ')}.`); return s; }
    case 'BOOLEAN': { if (typeof raw === 'boolean') return raw; const s = String(raw).toLowerCase(); if (['true', 'yes', '1'].includes(s)) return true; if (['false', 'no', '0'].includes(s)) return false; throw new CustomFieldError(`${d.label} is yes or no.`); }
    case 'FILE': return String(raw).trim();
    default: return raw;
  }
}

/** Save values: each field by its edit permission; every change is a change-log line (custom.<key>). */
export async function setValues(req: Request, actor: Actor, employeeId: string, input: Record<string, unknown>) {
  const defs = await defsOf(actor.orgId);
  const can = await held(req, defs.flatMap((d) => [d.viewPermission, d.editPermission]));
  const keys = Object.keys(input || {});
  const touched = defs.filter((d) => keys.includes(d.key));
  const unknown = keys.filter((k) => !defs.some((d) => d.key === k));
  if (unknown.length) throw new CustomFieldError(`No such field: ${unknown.join(', ')}.`);
  for (const d of touched) if (!can.get(d.editPermission)) throw new CustomFieldError(`You may not change ${d.label}.`, 403);
  const existing = touched.length ? await peoplePrisma.customFieldValue.findMany({ where: { orgId: actor.orgId, entityId: employeeId, defId: { in: touched.map((d) => d.id) } } }) : [];
  const before = new Map(existing.map((r) => [r.defId, r.value]));
  const changes: Array<{ field: string; before: string | null; after: string | null; redacted: boolean }> = [];
  await peoplePrisma.$transaction(async (tx) => {
    for (const d of touched) {
      let value: unknown = cleanValue(d, input[d.key]);
      if (d.type === 'FILE' && value) {
        const doc = await tx.employeeDocument.findFirst({ where: { id: String(value), orgId: actor.orgId, employeeId }, select: { id: true } });
        if (!doc) throw new CustomFieldError(`${d.label}: that file is not on this person's record.`);
      }
      const was = before.get(d.id) ?? null;
      if (JSON.stringify(was) === JSON.stringify(value)) continue;
      await tx.customFieldValue.upsert({ where: { defId_entityId: { defId: d.id, entityId: employeeId } }, create: { accountId: actor.accountId, orgId: actor.orgId, defId: d.id, entityId: employeeId, value: value as any, defVersion: d.version, updatedByUserId: actor.userId }, update: { value: value as any, defVersion: d.version, updatedByUserId: actor.userId } });
      const hidden = d.viewPermission !== 'PEOPLE::Employees::VIEW';
      changes.push({ field: `custom.${d.key}`, before: hidden ? null : was === null ? null : String(was), after: hidden ? null : value === null ? null : String(value), redacted: hidden });
    }
    if (changes.length) await writeChangeLog(tx, actor, { kind: 'Employee', id: employeeId, employeeId }, changes);
  });
  return { changed: changes.map((c) => c.field.slice('custom.'.length)) };
}
