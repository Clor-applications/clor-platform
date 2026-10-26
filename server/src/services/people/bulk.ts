import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import type { Actor } from './changeLog.js';
import { updateEmployee } from './employees.js';
import { activeRule } from './approvals/engine.js';
import { ISO_DAY, SCHEDULABLE_FIELDS, scheduleChanges } from './effectiveDating.js';
import { HOURS } from './employmentKinds.js';

/**
 * Bulk update from the directory (docs/people/02-PRD.md CORE-01). Every
 * person goes through the one write path, so each gets their own change-log
 * lines and events; all of them share one correlation id, so the batch reads
 * back as one change. Where a job-change approval rule is in force, a bulk
 * change to a job field is refused: it would skip the approvers.
 */

export const BULK_LIMIT = 2000;
/* `branch` lives in the platform database (platformPrisma), not with People's lists; it is read there below. */
const STRUCTURE: Record<string, { model: string; nameField?: 'department' | 'designation'; platform?: true }> = {
  departmentId: { model: 'department', nameField: 'department' },
  jobPositionId: { model: 'jobPosition', nameField: 'designation' },
  employeeTypeId: { model: 'employeeType' },
  workTypeId: { model: 'workType' },
  establishmentId: { model: 'establishment' },
  areaId: { model: 'area' },
  teamId: { model: 'team' },
  gradeId: { model: 'grade' },
  costCenterId: { model: 'costCenter' },
  businessUnitId: { model: 'businessUnit' },
  reportingManagerId: { model: 'employee' },
  contractorId: { model: 'contractor' },
  branchId: { model: 'branch', platform: true },
};

/** True when `employeeId` already sits above `managerId` in the reporting chain (a change would close a loop). */
async function managesAbove(orgId: string, managerId: string, employeeId: string) {
  let at: string | null = managerId;
  for (let hops = 0; at && hops < 50; hops += 1) {
    if (at === employeeId) return true;
    const row: { reportingManagerId: string | null } | null = await peoplePrisma.employee.findFirst({ where: { id: at, orgId }, select: { reportingManagerId: true } });
    at = row?.reportingManagerId ?? null;
  }
  return false;
}

export class BulkError extends Error {
  constructor(message: string, public status = 400, public code = 'BULK_REFUSED') {
    super(message);
  }
}

export async function bulkUpdate(actor: Actor, input: { ids?: unknown; set?: unknown; reason?: unknown; effectiveFrom?: unknown }, scope: { all: true } | { all: false; ids: string[] }) {
  const ids = [...new Set((Array.isArray(input.ids) ? input.ids : []).map(String))];
  if (!ids.length) throw new BulkError('Choose the people to change.');
  if (ids.length > BULK_LIMIT) throw new BulkError(`At most ${BULK_LIMIT} people at a time.`);
  const raw = (input.set && typeof input.set === 'object' ? input.set : {}) as Record<string, unknown>;
  const set: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!STRUCTURE[k] && k !== 'hours') throw new BulkError(`${k} cannot be changed in bulk.`);
    set[k] = v == null || v === '' ? null : String(v);
  }
  /* Hours are a word, not a list item: full-time or part-time, never blank in bulk. */
  if ('hours' in set && !(HOURS as readonly string[]).includes(String(set.hours))) throw new BulkError('Hours are full-time or part-time.');
  /* A department is never cleared for a whole selection at once (Workforce audit O20). */
  if ('departmentId' in set && !set.departmentId) throw new BulkError('Choose the department to move them to.');
  if (!Object.keys(set).length) throw new BulkError('Say what to change.');
  const reason = String(input.reason ?? '').trim().slice(0, 500) || null;
  /* From when (Workforce audit O20): a later day waits for that day, as a one-person change does; today or earlier applies now, dated. */
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const effectiveFrom = input.effectiveFrom == null || input.effectiveFrom === '' ? null : String(input.effectiveFrom);
  if (effectiveFrom && (!ISO_DAY.test(effectiveFrom) || new Date(`${effectiveFrom}T00:00:00Z`).toISOString().slice(0, 10) !== effectiveFrom)) throw new BulkError('That date does not exist.');
  const later = Boolean(effectiveFrom && effectiveFrom > today);
  if (later && Object.keys(set).some((k) => !SCHEDULABLE_FIELDS.has(k))) throw new BulkError('Hours change from today; leave the date empty for them.');
  if (Object.keys(set).some((k) => SCHEDULABLE_FIELDS.has(k)) && (await activeRule(actor.orgId, 'JOB_CHANGE'))) {
    throw new BulkError('A job-change approval rule is in force, so job details change one person at a time, through the approvers.', 409, 'RULE_IN_FORCE');
  }
  const data: Record<string, unknown> = { ...set };
  for (const [k, v] of Object.entries(set)) {
    if (k === 'hours') continue;
    if (!v) { if (STRUCTURE[k].nameField) data[STRUCTURE[k].nameField!] = null; continue; }
    if (STRUCTURE[k].platform) {
      /* A branch must be one of this company's, and open. */
      const branch = await platformPrisma.branch.findFirst({ where: { id: v, orgId: actor.orgId, accountId: actor.accountId, isActive: true }, select: { id: true } });
      if (!branch) throw new BulkError('Choose one of this company\'s open branches.');
      continue;
    }
    const row = await (peoplePrisma as any)[STRUCTURE[k].model].findFirst({ where: { id: v, orgId: actor.orgId }, select: { id: true, name: true } });
    if (!row) throw new BulkError(`That ${k.replace(/Id$/, '').replace(/([A-Z])/g, ' $1').toLowerCase()} is not in this company.`);
    if (STRUCTURE[k].nameField) data[STRUCTURE[k].nameField!] = row.name;
  }
  const people = await peoplePrisma.employee.findMany({ where: { orgId: actor.orgId, id: { in: ids }, ...(scope.all ? {} : { id: { in: ids.filter((id) => (scope as { ids: string[] }).ids.includes(id)) } }) } });
  const who: Actor = { ...actor, source: 'BULK', reason };
  let changed = 0;
  let scheduled = 0;
  const skipped: Array<{ id: string; name: string; why: string }> = [];
  for (const p of people) {
    if (p.status === 'LEFT') { skipped.push({ id: p.id, name: p.name, why: 'has left' }); continue; }
    if (set.reportingManagerId && set.reportingManagerId === p.id) { skipped.push({ id: p.id, name: p.name, why: 'cannot report to themselves' }); continue; }
    if (set.reportingManagerId && (await managesAbove(actor.orgId, set.reportingManagerId, p.id))) { skipped.push({ id: p.id, name: p.name, why: 'would make a reporting loop' }); continue; }
    if (later) {
      const rows = await scheduleChanges(who, p as any, set, effectiveFrom!);
      if (rows.length) scheduled += 1;
      continue;
    }
    const { changes } = await updateEmployee(who, p as any, data as any, { effectiveDate: effectiveFrom });
    if (changes.length) changed += 1;
  }
  const missing = ids.length - people.length;
  return { correlationId: actor.correlationId, asked: ids.length, changed, scheduled, effectiveFrom: later ? effectiveFrom : null, unchanged: people.length - changed - scheduled - skipped.length, skipped, notFound: missing };
}
