import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { episodesOf } from './episodes.js';
import { labelOf, timelineOf } from './employmentHistory.js';
import { namesFor, shape } from './approvals/engine.js';
import { LOGGED_EMPLOYEE_FIELDS } from './changeLog.js';

/**
 * The journey (docs/people/02-PRD.md CORE-06) and "Why?" (TRACE-01, 02).
 * Every change-log line a person has, grouped by the request or job that
 * made it (one correlation id = one change), in order, under the stint it
 * fell in. Each change opens a Why panel: what changed, when, who asked, who
 * approved, which rule version, the evidence, and what it set off downstream
 * (events, tasks). Where something is not known, the panel says so instead
 * of guessing: a change made before history started, or by hand with no
 * approval recorded.
 */

const FIELD_WORDS: Record<string, string> = {
  record: 'Record', name: 'Name', firstName: 'First name', lastName: 'Last name', code: 'Employee ID', email: 'Email', personalEmail: 'Personal email', workEmail: 'Work email', phone: 'Phone', workPhone: 'Work phone',
  designation: 'Designation', department: 'Department', departmentId: 'Department', jobPositionId: 'Designation', jobRoleId: 'Job role', businessUnitId: 'Business unit', gradeId: 'Grade', costCenterId: 'Cost centre',
  areaId: 'Location', branchId: 'Branch', establishmentId: 'Establishment', employeeTypeId: 'Employee type', workTypeId: 'Work type', contractorId: 'Contractor', reportingManagerId: 'Reports to', dottedManagerId: 'Also reports to',
  dateOfJoining: 'Date of joining', dateOfLeaving: 'Date of leaving', firstJoiningDate: 'First joining date', currentEpisodeSeq: 'Stint', confirmedOn: 'Confirmed on', probationEndDate: 'Probation ends', contractEndDate: 'Contract ends', status: 'Status',
  leavingType: 'Leaving type', leavingReason: 'Leaving reason', dateOfBirth: 'Date of birth', gender: 'Gender', maritalStatus: 'Marital status', addressLine: 'Address', city: 'City', state: 'State', country: 'Country', pincode: 'PIN code',
  emergencyContactName: 'Emergency contact', emergencyContactPhone: 'Emergency contact phone', emergencyContactRelation: 'Emergency contact relation', guardianName: 'Guardian', invite: 'Invite', letter: 'Letter', version: 'Version', done: 'Done',
};
export const fieldWord = (f: string) => FIELD_WORDS[f] || f.replace(/Id$/, '').replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

const SOURCE_WORDS: Record<string, string> = { FORM: 'by hand', IMPORT: 'from an import', APPROVAL: 'through an approved request', API: 'through the API', SYSTEM: 'by CLOR', SELF_SERVICE: 'by the person', SCHEDULED: 'on the day it was due', HIRE: 'at hiring' };

type Line = { id: string; field: string; before: string | null; after: string | null; redacted: boolean; reason: string | null; source: string; actorUserId: string | null; correlationId: string; requestId: string | null; decisionId: string | null; at: Date; entity: string; entityId: string };

/** The stint a moment fell in: by date against the stints' start and end days. */
function stintAt(episodes: Array<{ seq: number; startDate: string; endDate: string | null }>, at: Date) {
  const day = new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const hit = [...episodes].reverse().find((e) => e.startDate <= day && (!e.endDate || e.endDate >= day));
  return hit?.seq ?? (episodes[0]?.seq ?? 1);
}

/** An id field reads as its name, as it was at the time of asking; an id nobody can name any more stays an id. */
const NAMED_ID = /^(teamId|seatId|departmentId|jobPositionId|jobRoleId|businessUnitId|gradeId|costCenterId|areaId|branchId|establishmentId|employeeTypeId|workTypeId|contractorId|reportingManagerId|dottedManagerId)$/;
async function named(orgId: string, field: string, value: string | null) {
  if (!value || !NAMED_ID.test(field)) return value;
  try {
    return (await labelOf(orgId, field, value)) || value;
  } catch {
    return value;
  }
}
async function changesOf(orgId: string, g: Line[]) {
  return Promise.all(g.map(async (l) => ({ field: fieldWord(l.field), key: l.field, before: l.redacted ? null : await named(orgId, l.field, l.before), after: l.redacted ? null : await named(orgId, l.field, l.after), redacted: l.redacted })));
}

function groupLines(lines: Line[]) {
  const groups = new Map<string, Line[]>();
  for (const l of lines) {
    const list = groups.get(l.correlationId) || [];
    list.push(l);
    groups.set(l.correlationId, list);
  }
  return [...groups.values()];
}

/** The whole journey, newest first, each change with enough to show and a key for its Why. */
export async function journeyOf(orgId: string, employee: { id: string; currentEpisodeSeq?: number | null; status?: string | null } & Record<string, unknown>) {
  const [lines, episodes, history] = await Promise.all([
    peoplePrisma.changeLog.findMany({ where: { orgId, employeeId: employee.id }, orderBy: { at: 'asc' } }),
    episodesOf(orgId, employee),
    timelineOf(orgId, employee as any),
  ]);
  /* The person's own lines: a request's status lines carry the employee id too, but they are the request's story, told on the Why panel. */
  const groups = groupLines((lines as Line[]).filter((l) => l.entity === 'Employee'));
  const names = await namesFor([...new Set(lines.map((l) => l.actorUserId).filter((x): x is string => Boolean(x)))]);
  const firstLogAt = lines[0]?.at ?? null;
  const entries = await Promise.all(groups.map(async (g) => {
    const first = g[0];
    const fields = g.filter((l) => l.entity === 'Employee' || LOGGED_EMPLOYEE_FIELDS.includes(l.field as any) || l.field === 'record');
    const summary = first.field === 'record' && first.after === 'created' ? 'Joined the record' : fields.length === 1 ? `${fieldWord(fields[0].field)} changed` : `${fields.length} details changed`;
    return {
      key: first.correlationId, at: first.at, stint: stintAt(episodes, first.at), kind: first.requestId ? 'APPROVED' : first.source === 'SCHEDULED' ? 'SCHEDULED' : first.source === 'SELF_SERVICE' ? 'SELF' : 'CHANGE',
      summary, source: first.source, how: SOURCE_WORDS[first.source] || first.source.toLowerCase(), by: first.actorUserId ? names.get(first.actorUserId) || '' : 'CLOR', reason: first.reason, requestId: first.requestId,
      changes: await changesOf(orgId, g),
    };
  }));
  /* History from before the change log started has no lines of its own: it is shown with that said, not left out. */
  const older = history.filter((e: any) => !firstLogAt || new Date(e.at) < firstLogAt).filter((e: any) => e.kind !== 'JOINED' || !lines.length);
  const legacy = older.map((e: any) => ({
    key: `history_${e.id}`, at: new Date(`${e.effectiveDate}T00:00:00+05:30`), stint: stintAt(episodes, new Date(`${e.effectiveDate}T00:00:00+05:30`)), kind: 'HISTORY', summary: e.title, source: e.source, how: 'recorded in employment history', by: e.by || '', reason: e.note, requestId: null,
    changes: e.field ? [{ field: fieldWord(e.field), key: e.field, before: e.from, after: e.to, redacted: false }] : [],
  }));
  const all = [...entries, ...legacy].sort((a, b) => b.at.getTime() - a.at.getTime());
  return { episodes, entries: all };
}

/** Why: the seven things a reader asks about one change, and plain words for each one that is not known. */
export async function whyOf(orgId: string, employeeId: string, key: string) {
  if (key.startsWith('history_')) {
    const ev = await peoplePrisma.employmentEvent.findFirst({ where: { orgId, employeeId, id: key.slice('history_'.length) } });
    if (!ev) return null;
    const by = ev.recordedByUserId ? (await namesFor([ev.recordedByUserId])).get(ev.recordedByUserId) || '' : '';
    return {
      key, what: ev.field ? [{ field: fieldWord(ev.field), before: ev.fromLabel, after: ev.toLabel }] : [], when: ev.effectiveDate, recordedAt: ev.createdAt, askedBy: by || null, approvedBy: null, rule: null, evidence: [], downstream: { events: [], tasks: [] },
      unknown: ['No approval recorded: changed before the change log started.', 'No evidence attached: recorded in employment history only.'],
      reason: ev.note, impact: ev.payrollImpact,
    };
  }
  const lines = await peoplePrisma.changeLog.findMany({ where: { orgId, employeeId, correlationId: key, entity: 'Employee' }, orderBy: { at: 'asc' } });
  if (!lines.length) return null;
  const first = lines[0];
  const [events, request, actorNames] = await Promise.all([
    peoplePrisma.outboxEvent.findMany({ where: { orgId, correlationId: key }, select: { id: true, name: true, occurredAt: true, deliveredAt: true } }),
    first.requestId ? peoplePrisma.approvalRequest.findFirst({ where: { id: first.requestId, orgId }, include: { steps: { orderBy: { order: 'asc' } } } }) : null,
    namesFor(lines.map((l) => l.actorUserId).filter((x): x is string => Boolean(x))),
  ]);
  const shaped = request ? await shape(request) : null;
  const rule = request ? await peoplePrisma.approvalRule.findUnique({ where: { id: request.ruleId }, select: { name: true, version: true, requestType: true } }) : null;
  /* Tasks this change set off: the plan tasks created in the minute after it, on this person. */
  const tasks = await peoplePrisma.checklistTask.findMany({ where: { orgId, employeeId, createdAt: { gte: first.at, lte: new Date(first.at.getTime() + 60_000) } }, select: { id: true, title: true, kind: true, owner: true, dueDate: true, doneAt: true } });
  const evidence: Array<{ kind: string; id: string; title: string }> = [];
  const payload = (request?.payload || {}) as Record<string, unknown>;
  for (const d of (Array.isArray(payload.evidence) ? payload.evidence : []) as Array<{ documentId?: string; title?: string }>) if (d.documentId) evidence.push({ kind: 'DOCUMENT', id: d.documentId, title: d.title || 'Document' });
  const unknown: string[] = [];
  if (!request) unknown.push(first.source === 'FORM' || first.source === 'IMPORT' || first.source === 'API' ? `No approval recorded: changed ${SOURCE_WORDS[first.source]}, with no rule in force for it.` : first.source === 'SELF_SERVICE' ? 'No approval recorded: the person sent it and HR checked it.' : first.source === 'SCHEDULED' ? 'Approved when it was scheduled; see the change that scheduled it.' : 'No approval recorded.');
  if (!evidence.length) unknown.push('No evidence attached to this change.');
  if (!events.length) unknown.push('Nothing was sent to other apps for this change.');
  const decided = shaped?.steps.filter((s) => s.status === 'APPROVED' || s.status === 'REJECTED') || [];
  return {
    key,
    what: await changesOf(orgId, lines as Line[]),
    when: first.at, source: first.source, how: SOURCE_WORDS[first.source] || first.source.toLowerCase(),
    askedBy: shaped ? shaped.requesterName : first.actorUserId ? actorNames.get(first.actorUserId) || null : 'CLOR',
    approvedBy: decided.length ? decided.map((s) => `${s.decidedBy}${s.standInFor ? ` (for ${s.standInFor})` : ''}${s.comment ? `: ${s.comment}` : ''}`) : null,
    request: shaped ? { id: shaped.id, title: shaped.title, status: shaped.status, type: shaped.requestType, createdAt: shaped.createdAt } : null,
    rule: rule ? { name: rule.name, version: request!.ruleVersion, type: rule.requestType } : null,
    reason: first.reason,
    evidence,
    downstream: { events: events.map((e) => ({ id: e.id, name: e.name, at: e.occurredAt, delivered: Boolean(e.deliveredAt) })), tasks },
    unknown,
  };
}
