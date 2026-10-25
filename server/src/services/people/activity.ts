import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { changesOf, fieldWord } from './journey.js';

/**
 * One employee's Activity & Audit Trail (People design spec v1 §7, EMP-09;
 * Workforce package WF-08, WF-18, WF-19). Read from what the server already
 * writes, never a second store: the change log (every field, who, when, how,
 * the request and decision, the batch), approval decisions, document uploads
 * and comments. Typed events, newest first, with the actor's name and role.
 *
 * What a viewer may see is decided here: identity and statutory lines need
 * the Statutory grant, a custom field its own view grant, documents their
 * classification, comments the Notes grant. A change the viewer may not see
 * still shows that it happened, as "changed".
 */

export type ActivityViewer = {
  orgId: string;
  canStatutory: boolean;
  canNotes: boolean;
  docClasses: string[];
  /** Whether the viewer holds a grant like PEOPLE::Statutory Details::VIEW (the route answers with authorize()). */
  allows: (permission: string) => Promise<boolean>;
};

type Event = {
  id: string; type: string; at: string; actorId: string | null; actor: string | null; role: string | null;
  title: string; changes?: Array<{ field: string; label: string; before: string | null; after: string | null; redacted: boolean }>;
  reason?: string | null; body?: string | null; source?: string; batch?: { id: string; size: number } | null;
  requestId?: string | null; correlationId?: string; effectiveDate?: string | null;
};

const SOURCE_TITLE: Record<string, string> = { IMPORT: 'Imported', APPROVAL: 'Approved change applied', BULK: 'Changed in bulk', SCHEDULED: 'Scheduled change took effect', SELF_SERVICE: 'Changed by the employee', HIRE: 'Hired', SYSTEM: 'Changed by Clor' };

async function actorsOf(orgId: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return { name: new Map<string, string>(), role: new Map<string, string>() };
  const [users, assignments] = await Promise.all([
    platformPrisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true, email: true } }).catch(() => []),
    platformPrisma.userRoleAssignment.findMany({ where: { orgId, userId: { in: unique } }, select: { userId: true, role: { select: { name: true } } } }).catch(() => []),
  ]);
  const role = new Map<string, string>();
  for (const a of assignments as any[]) if (a.role?.name && !role.has(a.userId)) role.set(a.userId, a.role.name);
  return { name: new Map((users as any[]).map((u) => [u.id, u.fullName || u.email])), role };
}

export async function activityOf(viewer: ActivityViewer, employeeId: string, opts: { before?: Date | null; limit?: number } = {}) {
  const { orgId } = viewer;
  const limit = Math.min(200, Math.max(10, opts.limit || 50));
  const before = opts.before && !Number.isNaN(opts.before.getTime()) ? { lt: opts.before } : undefined;

  const [lines, requests, docs, notes] = await Promise.all([
    peoplePrisma.changeLog.findMany({ where: { orgId, employeeId, ...(before ? { at: before } : {}) }, orderBy: { at: 'desc' }, take: limit * 6 }),
    peoplePrisma.approvalRequest.findMany({ where: { orgId, subjectEmployeeId: employeeId }, include: { steps: true } }),
    peoplePrisma.employeeDocument.findMany({ where: { orgId, employeeId, ...(before ? { createdAt: before } : {}) }, select: { id: true, title: true, kind: true, version: true, classification: true, uploadedByUserId: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: limit }),
    viewer.canNotes ? peoplePrisma.employeeNote.findMany({ where: { orgId, employeeId, ...(before ? { createdAt: before } : {}) }, orderBy: { createdAt: 'desc' }, take: limit }) : Promise.resolve([]),
  ]);

  /* Custom fields say who may see them; a line for one the viewer may not see is shown as changed. */
  const customKeys = [...new Set(lines.filter((l) => l.entity === 'CustomFieldValue').map((l) => l.field))];
  const defs = customKeys.length ? await peoplePrisma.customFieldDef.findMany({ where: { orgId, key: { in: customKeys } }, select: { key: true, label: true, viewPermission: true } }).catch(() => []) : [];
  const defOf = new Map((defs as any[]).map((d) => [d.key, d]));
  const seeable = new Set<string>();
  for (const d of defs as any[]) if (await viewer.allows(d.viewPermission)) seeable.add(d.key);
  const hidden = (l: { entity: string; field: string }) => {
    if (l.entity === 'EmployeeIdentity') return !viewer.canStatutory;
    if (l.entity === 'CustomFieldValue') return defOf.has(l.field) ? !seeable.has(l.field) : false;
    return false;
  };

  /* Batch sizes: how many people a bulk or import correlation touched. */
  const batchIds = [...new Set(lines.filter((l) => l.source === 'BULK' || l.source === 'IMPORT').map((l) => l.correlationId))];
  const batchSize = new Map<string, number>();
  for (const id of batchIds) {
    const people = await peoplePrisma.changeLog.findMany({ where: { orgId, correlationId: id, entity: 'Employee' }, select: { entityId: true }, distinct: ['entityId'] });
    batchSize.set(id, people.length);
  }

  const events: Event[] = [];
  const groups = new Map<string, typeof lines>();
  for (const l of lines) {
    if (l.entity === 'ApprovalRequest') continue; /* told through the approval decision below */
    const k = `${l.correlationId}:${l.entity}`;
    groups.set(k, [...(groups.get(k) || []), l]);
  }
  for (const [k, g] of groups) {
    const first = g[g.length - 1];
    const created = g.some((l) => l.field === 'record' && l.after === 'created');
    /* One line per real change: the text copies (department, designation) ride with their id field, and a line written twice shows once. */
    const ids = new Set(g.map((l) => l.field));
    const seen = new Set<string>();
    const shown = g.filter((l) => {
      if (l.field === 'record') return false;
      if ((l.field === 'department' && ids.has('departmentId')) || (l.field === 'designation' && ids.has('jobPositionId'))) return false;
      const sig = `${l.entity}|${l.field}|${l.before}|${l.after}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
    const changes = (await changesOf(orgId, shown as any)).map((c, i) => {
      const redacted = c.redacted || hidden(shown[i]);
      return { field: c.key, label: shown[i].entity === 'CustomFieldValue' ? (defOf.get(shown[i].field)?.label || fieldWord(shown[i].field)) : c.field, before: redacted ? null : c.before, after: redacted ? null : c.after, redacted };
    });
    const status = shown.find((l) => l.field === 'status');
    const type = created ? (first.source === 'IMPORT' ? 'import' : 'create')
      : status?.after === 'LEFT' ? 'archive'
      : first.source === 'IMPORT' ? 'import'
      : first.source === 'SYSTEM' || first.source === 'SCHEDULED' ? 'system'
      : 'update';
    const what = first.entity === 'EmployeeIdentity' ? 'Identity details updated'
      : first.entity === 'CustomFieldValue' ? 'More details updated'
      : first.entity === 'EmployeeDocument' ? 'Document changed'
      : created ? 'Employee created'
      : type === 'archive' ? 'Marked as left'
      : SOURCE_TITLE[first.source] || (changes.length === 1 ? `${changes[0].label} updated` : 'Details updated');
    events.push({
      id: `log_${k}`, type, at: first.at.toISOString(), actorId: first.actorUserId, actor: null, role: null, title: what,
      changes, reason: first.reason, source: first.source, correlationId: first.correlationId, requestId: first.requestId,
      batch: batchSize.get(first.correlationId) && (batchSize.get(first.correlationId) || 0) > 1 ? { id: first.correlationId, size: batchSize.get(first.correlationId)! } : null,
    });
  }
  for (const r of requests) {
    for (const s of r.steps) {
      if (!s.decidedAt || !['APPROVED', 'REJECTED'].includes(s.status)) continue;
      if (before && !(s.decidedAt < before.lt)) continue;
      events.push({ id: `step_${s.id}`, type: s.status === 'APPROVED' ? 'approve' : 'reject', at: s.decidedAt.toISOString(), actorId: s.decidedByUserId, actor: null, role: null, title: `${r.title}: ${s.status === 'APPROVED' ? 'approved' : 'rejected'}${r.steps.length > 1 ? ` (step ${s.order})` : ''}`, body: s.comment, requestId: r.id });
    }
  }
  for (const d of docs) {
    if (!viewer.docClasses.includes(d.classification)) continue;
    events.push({ id: `doc_${d.id}`, type: 'upload', at: d.createdAt.toISOString(), actorId: d.uploadedByUserId && d.uploadedByUserId !== 'EMPLOYEE' ? d.uploadedByUserId : null, actor: d.uploadedByUserId === 'EMPLOYEE' ? 'The employee' : null, role: null, title: `${d.version && d.version > 1 ? `New version (${d.version}) of` : 'Uploaded'} ${d.title}` });
  }
  for (const n of notes as any[]) {
    events.push({ id: `note_${n.id}`, type: 'comment', at: n.createdAt.toISOString(), actorId: n.createdByUserId, actor: null, role: null, title: 'Comment', body: n.body });
  }

  /*
   * D-V8: what the platform audit log recorded about this person that the
   * change log does not already say (a statutory reveal, a letter issued, an
   * invite sent). Joined by the request id; only its plain message is shown,
   * never the request body it keeps for administrators.
   */
  const logged = new Set(lines.map((l) => l.correlationId));
  const platform = await platformPrisma.auditLog.findMany({
    where: { orgId, entityId: employeeId, entity: { startsWith: 'PEOPLE_' }, ...(before ? { createdAt: before } : {}) },
    orderBy: { createdAt: 'desc' }, take: limit, select: { id: true, action: true, message: true, createdByUserId: true, createdAt: true, correlationId: true },
  }).catch(() => []);
  const PLATFORM_TYPE: Record<string, string> = { EXPORT: 'export', REVEAL: 'view', DELETE: 'archive', CREATE: 'create', UPDATE: 'update', APPROVE: 'approve', REJECT: 'reject' };
  for (const a of platform as any[]) {
    if (a.correlationId && logged.has(a.correlationId)) continue;
    if (['CREATE', 'UPDATE'].includes(a.action) && !a.correlationId) continue; /* older rows: the change log already tells these */
    events.push({ id: `audit_${a.id}`, type: PLATFORM_TYPE[a.action] || 'system', at: a.createdAt.toISOString(), actorId: a.createdByUserId, actor: null, role: null, title: a.message || a.action.toLowerCase().replace(/_/g, ' '), correlationId: a.correlationId || undefined, source: 'PLATFORM' });
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const page = events.slice(0, limit);
  const who = await actorsOf(orgId, page.map((e) => e.actorId || '').filter(Boolean));
  for (const e of page) {
    if (e.actorId) { e.actor = who.name.get(e.actorId) || 'A former user'; e.role = who.role.get(e.actorId) || null; }
  }
  return { events: page, nextBefore: events.length > limit ? page[page.length - 1].at : null };
}
