import { peoplePrisma } from '../../utils/peoplePrisma.js';
import type { Actor } from './changeLog.js';
import { updateEmployee } from './employees.js';
import { activeRule } from './approvals/engine.js';
import { SCHEDULABLE_FIELDS } from './effectiveDating.js';

/**
 * Bulk update from the directory (docs/people/02-PRD.md CORE-01). Every
 * person goes through the one write path, so each gets their own change-log
 * lines and events; all of them share one correlation id, so the batch reads
 * back as one change. Where a job-change approval rule is in force, a bulk
 * change to a job field is refused: it would skip the approvers.
 */

export const BULK_LIMIT = 2000;
const STRUCTURE: Record<string, { model: string; nameField?: 'department' | 'designation' }> = {
  departmentId: { model: 'department', nameField: 'department' },
  jobPositionId: { model: 'jobPosition', nameField: 'designation' },
  employeeTypeId: { model: 'employeeType' },
  workTypeId: { model: 'workType' },
  establishmentId: { model: 'establishment' },
  teamId: { model: 'team' },
  gradeId: { model: 'grade' },
  costCenterId: { model: 'costCenter' },
  businessUnitId: { model: 'businessUnit' },
  reportingManagerId: { model: 'employee' },
};

export class BulkError extends Error {
  constructor(message: string, public status = 400, public code = 'BULK_REFUSED') {
    super(message);
  }
}

export async function bulkUpdate(actor: Actor, input: { ids?: unknown; set?: unknown; reason?: unknown }, scope: { all: true } | { all: false; ids: string[] }) {
  const ids = [...new Set((Array.isArray(input.ids) ? input.ids : []).map(String))];
  if (!ids.length) throw new BulkError('Choose the people to change.');
  if (ids.length > BULK_LIMIT) throw new BulkError(`At most ${BULK_LIMIT} people at a time.`);
  const raw = (input.set && typeof input.set === 'object' ? input.set : {}) as Record<string, unknown>;
  const set: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!STRUCTURE[k]) throw new BulkError(`${k} cannot be changed in bulk.`);
    set[k] = v == null || v === '' ? null : String(v);
  }
  if (!Object.keys(set).length) throw new BulkError('Say what to change.');
  const reason = String(input.reason ?? '').trim().slice(0, 500) || null;
  if (Object.keys(set).some((k) => SCHEDULABLE_FIELDS.has(k)) && (await activeRule(actor.orgId, 'JOB_CHANGE'))) {
    throw new BulkError('A job-change approval rule is in force, so job details change one person at a time, through the approvers.', 409, 'RULE_IN_FORCE');
  }
  const data: Record<string, unknown> = { ...set };
  for (const [k, v] of Object.entries(set)) {
    if (!v) { if (STRUCTURE[k].nameField) data[STRUCTURE[k].nameField!] = null; continue; }
    const row = await (peoplePrisma as any)[STRUCTURE[k].model].findFirst({ where: { id: v, orgId: actor.orgId }, select: { id: true, name: true } });
    if (!row) throw new BulkError(`That ${k.replace(/Id$/, '').replace(/([A-Z])/g, ' $1').toLowerCase()} is not in this company.`);
    if (STRUCTURE[k].nameField) data[STRUCTURE[k].nameField!] = row.name;
  }
  const people = await peoplePrisma.employee.findMany({ where: { orgId: actor.orgId, id: { in: ids }, ...(scope.all ? {} : { id: { in: ids.filter((id) => (scope as { ids: string[] }).ids.includes(id)) } }) } });
  const who: Actor = { ...actor, source: 'BULK', reason };
  let changed = 0;
  const skipped: Array<{ id: string; name: string; why: string }> = [];
  for (const p of people) {
    if (p.status === 'LEFT') { skipped.push({ id: p.id, name: p.name, why: 'has left' }); continue; }
    if (set.reportingManagerId && set.reportingManagerId === p.id) { skipped.push({ id: p.id, name: p.name, why: 'cannot report to themselves' }); continue; }
    const { changes } = await updateEmployee(who, p as any, data as any);
    if (changes.length) changed += 1;
  }
  const missing = ids.length - people.length;
  return { correlationId: actor.correlationId, asked: ids.length, changed, unchanged: people.length - changed - skipped.length, skipped, notFound: missing };
}
