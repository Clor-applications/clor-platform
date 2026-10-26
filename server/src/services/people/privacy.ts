import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { anonymiseEmployee } from '../anonymiseEmployee.js';

/**
 * Privacy controls (docs/people/02-PRD.md PRV-02, 03, 06, 07):
 *  - a retention schedule per kind of data, with the legal minimum it may not
 *    go below and a legal hold that stops every deletion of that kind;
 *  - a deletion review: former employees past retention are listed, and
 *    nothing is erased until a person approves (erasure is anonymisation,
 *    OD-04, so payroll, TDS and PF records stay for their eight years);
 *  - external auditor grants: named documents only, from a time until a
 *    time, every open logged, no profile;
 *  - the access audit: who viewed statutory details, confidential and
 *    restricted documents, auditor evidence, and private cases (opens as
 *    counts only, never what was inside).
 */

export class PrivacyError extends Error {
  constructor(message: string, public status = 400, public code = 'PRIVACY_REFUSED') {
    super(message);
  }
}

export type RetentionType = 'PEOPLE_RECORD' | 'DOCUMENTS' | 'PAYROLL' | 'ATTENDANCE' | 'ACCESS_LOG';
type Default = { label: string; keepYears: number; minYears: number; after: string; basis: string; erasable: boolean };

/** OD-04: erasure only for people who left, by anonymisation; payroll, TDS and PF eight years, attendance three. */
export const RETENTION_DEFAULTS: Record<RetentionType, Default> = {
  PEOPLE_RECORD: { label: 'Personal details of people who left', keepYears: 3, minYears: 3, after: 'the last working day', basis: 'Limitation Act, 1963: three years for most claims after employment ends.', erasable: true },
  DOCUMENTS: { label: 'Documents on file (except contracts and payslips)', keepYears: 3, minYears: 3, after: 'the last working day', basis: 'Same period as the personal record; contracts and payslips stay with the pay records.', erasable: true },
  PAYROLL: { label: 'Pay, TDS and PF records', keepYears: 8, minYears: 8, after: 'the end of the financial year', basis: 'Companies Act, 2013 s.128(5) and Income-tax rules: eight years. Kept through any erasure.', erasable: false },
  ATTENDANCE: { label: 'Attendance and leave registers', keepYears: 3, minYears: 3, after: 'the last entry', basis: 'Code on Wages, 2019 and the state shops and establishments rules: three years.', erasable: false },
  ACCESS_LOG: { label: 'Who-viewed-what log', keepYears: 3, minYears: 1, after: 'the view', basis: 'Kept long enough to answer a grievance or a Board inquiry.', erasable: false },
};
export const RETENTION_TYPES = Object.keys(RETENTION_DEFAULTS) as RetentionType[];

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addYears = (ymd: string, years: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return `${y + years}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};
const ymdOf = (v: Date | string | null | undefined) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

export async function retentionSchedule(orgId: string) {
  const saved = new Map((await peoplePrisma.retentionRule.findMany({ where: { orgId } })).map((r) => [r.dataType, r]));
  return RETENTION_TYPES.map((t) => {
    const d = RETENTION_DEFAULTS[t];
    const r = saved.get(t);
    return { dataType: t, label: d.label, keepYears: r?.keepYears ?? d.keepYears, minYears: d.minYears, after: d.after, basis: d.basis, erasable: d.erasable, legalHold: r?.legalHold ?? false, holdReason: r?.holdReason ?? null, changed: Boolean(r), updatedAt: r?.updatedAt ?? null };
  });
}

export async function saveRetention(args: { accountId: string; orgId: string; userId: string; dataType: string; keepYears?: unknown; legalHold?: unknown; holdReason?: unknown }) {
  const t = String(args.dataType || '').toUpperCase() as RetentionType;
  const d = RETENTION_DEFAULTS[t];
  if (!d) throw new PrivacyError('No such kind of data.', 404, 'NOT_FOUND');
  const current = (await retentionSchedule(args.orgId)).find((r) => r.dataType === t)!;
  const keepYears = args.keepYears === undefined ? current.keepYears : Number(args.keepYears);
  if (!Number.isInteger(keepYears) || keepYears < d.minYears || keepYears > 30) {
    throw new PrivacyError(`${d.label}: keep between ${d.minYears} and 30 whole years. ${d.basis}`, 400, 'BELOW_LEGAL_MINIMUM');
  }
  const legalHold = args.legalHold === undefined ? current.legalHold : Boolean(args.legalHold);
  const holdReason = legalHold ? String(args.holdReason ?? current.holdReason ?? '').trim().slice(0, 300) : null;
  if (legalHold && !holdReason) throw new PrivacyError('Say why the data is on hold (a case, a notice, an inspection). It shows on the deletion review.', 400, 'HOLD_REASON');
  const data = { keepYears, legalHold, holdReason, basis: d.basis, updatedByUserId: args.userId };
  await peoplePrisma.retentionRule.upsert({ where: { orgId_dataType: { orgId: args.orgId, dataType: t } }, create: { accountId: args.accountId, orgId: args.orgId, dataType: t, ...data }, update: data });
  return (await retentionSchedule(args.orgId)).find((r) => r.dataType === t)!;
}

/** What an erasure keeps, and until when, in words the person reads (PRV-02). */
export async function retentionExceptions(orgId: string, dateOfLeaving: Date | string | null) {
  const left = ymdOf(dateOfLeaving);
  return (await retentionSchedule(orgId))
    .filter((r) => !r.erasable)
    .map((r) => ({ dataType: r.dataType, label: r.label, keepYears: r.keepYears, basis: r.basis, until: left ? addYears(left, r.keepYears) : null, legalHold: r.legalHold }));
}

/**
 * Former employees whose personal record is past retention land on the
 * review (PRV-03). Rows already decided stay decided; a legal hold adds none.
 */
export async function scanDeletionReview(accountId: string, orgId: string, today = todayIst()) {
  const rule = (await retentionSchedule(orgId)).find((r) => r.dataType === 'PEOPLE_RECORD')!;
  if (rule.legalHold) return { added: 0, hold: rule.holdReason };
  const cutoff = addYears(today, -rule.keepYears);
  const due = await peoplePrisma.employee.findMany({
    where: { orgId, status: 'LEFT', anonymisedAt: null, dateOfLeaving: { not: null, lte: cutoff } },
    select: { id: true, name: true, code: true, dateOfLeaving: true },
  });
  if (!due.length) return { added: 0, hold: null };
  const known = new Set((await peoplePrisma.deletionReview.findMany({ where: { orgId, dataType: 'PEOPLE_RECORD', entityId: { in: due.map((e) => e.id) } }, select: { entityId: true } })).map((r) => r.entityId));
  const fresh = due.filter((e) => !known.has(e.id));
  if (fresh.length) {
    await peoplePrisma.deletionReview.createMany({
      data: fresh.map((e) => ({ accountId, orgId, dataType: 'PEOPLE_RECORD', entityId: e.id, label: `${e.name}${e.code ? ` (${e.code})` : ''}`, dueSince: addYears(ymdOf(e.dateOfLeaving)!, rule.keepYears) })),
      skipDuplicates: true,
    });
  }
  return { added: fresh.length, hold: null };
}

export async function deletionReview(accountId: string, orgId: string, status = 'PENDING') {
  const scan = await scanDeletionReview(accountId, orgId);
  const rows = await peoplePrisma.deletionReview.findMany({ where: { orgId, ...(status ? { status } : {}) }, orderBy: [{ dueSince: 'asc' }], take: 500 });
  return { hold: scan.hold, rows };
}

/** APPROVE erases by anonymisation; KEEP needs a reason and leaves the row decided. Nothing is erased under a hold. */
export async function decideDeletion(args: { accountId: string; orgId: string; userId: string; id: string; decision: string; note?: unknown }) {
  const row = await peoplePrisma.deletionReview.findFirst({ where: { id: args.id, orgId: args.orgId } });
  if (!row) throw new PrivacyError('No such review item.', 404, 'NOT_FOUND');
  if (row.status !== 'PENDING') throw new PrivacyError(`This was already ${row.status === 'APPROVED' ? 'erased' : 'kept'}.`, 409, 'DECIDED');
  const decision = String(args.decision || '').toUpperCase();
  const note = String(args.note ?? '').trim().slice(0, 500) || null;
  if (decision === 'KEEP') {
    if (!note) throw new PrivacyError('Say why it is kept; the next review reads it.', 400, 'NOTE_NEEDED');
    return peoplePrisma.deletionReview.update({ where: { id: row.id }, data: { status: 'KEPT', note, decidedByUserId: args.userId, decidedAt: new Date() } });
  }
  if (decision !== 'APPROVE') throw new PrivacyError('Decide APPROVE (erase) or KEEP.', 400, 'BAD_DECISION');
  const rule = (await retentionSchedule(args.orgId)).find((r) => r.dataType === row.dataType);
  if (rule?.legalHold) throw new PrivacyError(`On legal hold: ${rule.holdReason}. Lift the hold first.`, 409, 'LEGAL_HOLD');
  const result = await anonymiseEmployee({ accountId: args.accountId, orgId: args.orgId, employeeId: row.entityId });
  const decided = await peoplePrisma.deletionReview.update({ where: { id: row.id }, data: { status: 'APPROVED', note, label: result.name, decidedByUserId: args.userId, decidedAt: new Date() } });
  return { ...decided, kept: result.kept };
}

// ---------------------------------------------------------------- auditors (PRV-06)

const MAX_GRANT_DAYS = 90;
const asIds = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim()).filter(Boolean);

export async function createAuditorGrant(args: { accountId: string; orgId: string; grantedByUserId: string; userId: unknown; purpose: unknown; documentIds: unknown; fromAt: unknown; untilAt: unknown }) {
  const userId = String(args.userId ?? '').trim();
  const purpose = String(args.purpose ?? '').trim().slice(0, 300);
  const documentIds = [...new Set(asIds(args.documentIds))];
  const fromAt = args.fromAt ? new Date(String(args.fromAt)) : new Date();
  const untilAt = new Date(String(args.untilAt ?? ''));
  if (!userId) throw new PrivacyError('Choose the auditor.', 400, 'AUDITOR_NEEDED');
  if (!purpose) throw new PrivacyError('Say what the audit is for.', 400, 'PURPOSE_NEEDED');
  if (!documentIds.length) throw new PrivacyError('Name at least one document the auditor may open.', 400, 'EVIDENCE_NEEDED');
  if (Number.isNaN(fromAt.getTime()) || Number.isNaN(untilAt.getTime()) || untilAt <= fromAt) throw new PrivacyError('Access must end after it starts.', 400, 'BAD_DATES');
  if (untilAt.getTime() - fromAt.getTime() > MAX_GRANT_DAYS * 86_400_000) throw new PrivacyError(`Access lasts at most ${MAX_GRANT_DAYS} days; give a new grant for a longer audit.`, 400, 'TOO_LONG');
  if (userId === args.grantedByUserId) throw new PrivacyError('You cannot grant audit access to yourself.', 400, 'SELF_GRANT');
  const member = await platformPrisma.userOrgMembership.findFirst({ where: { accountId: args.accountId, orgId: args.orgId, userId } });
  if (!member) throw new PrivacyError('The auditor must be a user of this company first (Settings, Users), with the External auditor role.', 400, 'NOT_A_USER');
  const docs = await peoplePrisma.employeeDocument.findMany({ where: { orgId: args.orgId, id: { in: documentIds } }, select: { id: true } });
  if (docs.length !== documentIds.length) throw new PrivacyError('A named document is not on file in this company.', 400, 'UNKNOWN_DOCUMENT');
  return peoplePrisma.auditorGrant.create({ data: { accountId: args.accountId, orgId: args.orgId, userId, purpose, documentIds, fromAt, untilAt, grantedByUserId: args.grantedByUserId } });
}

export async function revokeAuditorGrant(orgId: string, id: string) {
  const g = await peoplePrisma.auditorGrant.findFirst({ where: { id, orgId } });
  if (!g) throw new PrivacyError('No such grant.', 404, 'NOT_FOUND');
  if (g.revokedAt) return g;
  return peoplePrisma.auditorGrant.update({ where: { id }, data: { revokedAt: new Date() } });
}

const liveGrants = (orgId: string, userId: string, now = new Date()) =>
  peoplePrisma.auditorGrant.findMany({ where: { orgId, userId, revokedAt: null, fromAt: { lte: now }, untilAt: { gt: now } } });

/** What the auditor may open now: title, kind and date only, no person behind it. */
export async function auditorEvidence(orgId: string, userId: string, now = new Date()) {
  const grants = await liveGrants(orgId, userId, now);
  const ids = [...new Set(grants.flatMap((g) => asIds(g.documentIds)))];
  const docs = ids.length ? await peoplePrisma.employeeDocument.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, title: true, kind: true, mime: true, createdAt: true } }) : [];
  return {
    grants: grants.map((g) => ({ id: g.id, purpose: g.purpose, untilAt: g.untilAt, documents: asIds(g.documentIds).length })),
    documents: docs.map((d) => ({ ...d, untilAt: grants.filter((g) => asIds(g.documentIds).includes(d.id)).reduce((a, g) => (g.untilAt > a ? g.untilAt : a), new Date(0)) })),
  };
}

export async function openAuditorDocument(args: { accountId: string; orgId: string; userId: string; documentId: string; now?: Date }) {
  const grants = await liveGrants(args.orgId, args.userId, args.now);
  const grant = grants.find((g) => asIds(g.documentIds).includes(args.documentId));
  if (!grant) throw new PrivacyError('No such document.', 404, 'NOT_FOUND');
  const d = await peoplePrisma.employeeDocument.findFirst({ where: { id: args.documentId, orgId: args.orgId }, select: { id: true, title: true, kind: true, mime: true, data: true, employeeId: true } });
  if (!d) throw new PrivacyError('No such document.', 404, 'NOT_FOUND');
  await peoplePrisma.accessLog.create({ data: { accountId: args.accountId, orgId: args.orgId, what: 'AUDITOR_DOC', entityId: d.id, employeeId: d.employeeId, field: grant.id, userId: args.userId } });
  return { id: d.id, title: d.title, kind: d.kind, mime: d.mime, dataUrl: `data:${d.mime};base64,${Buffer.from(d.data).toString('base64')}` };
}

// ---------------------------------------------------------------- access audit (PRV-07)

export const ACCESS_KINDS: Record<string, string> = {
  STATUTORY: 'Statutory detail revealed',
  DOC_CONFIDENTIAL: 'Confidential document opened',
  DOC_RESTRICTED: 'Restricted document opened',
  AUDITOR_DOC: 'Auditor opened evidence',
};

export async function accessReport(args: { orgId: string; from?: string; to?: string; employeeId?: string; what?: string }) {
  const from = args.from && /^\d{4}-\d{2}-\d{2}$/.test(args.from) ? args.from : `${todayIst().slice(0, 8)}01`;
  const to = args.to && /^\d{4}-\d{2}-\d{2}$/.test(args.to) ? args.to : todayIst();
  const at = { gte: new Date(`${from}T00:00:00+05:30`), lte: new Date(`${to}T23:59:59.999+05:30`) };
  const what = args.what && ACCESS_KINDS[args.what] ? args.what : undefined;
  const [rows, caseOpens] = await Promise.all([
    peoplePrisma.accessLog.findMany({ where: { orgId: args.orgId, at, ...(what ? { what } : {}), ...(args.employeeId ? { employeeId: args.employeeId } : {}) }, orderBy: { at: 'desc' }, take: 2000 }),
    /* Private cases: who opened how many times, never which case or what was in it (PRIV-03 keeps the detail inside the case). */
    args.employeeId || (what && what !== 'CASE') ? Promise.resolve([]) : peoplePrisma.privateCaseAccess.groupBy({ by: ['userId', 'what'], where: { orgId: args.orgId, at }, _count: { _all: true } }),
  ]);
  const userIds = [...new Set([...rows.map((r) => r.userId), ...caseOpens.map((c) => c.userId)])];
  const empIds = [...new Set(rows.map((r) => r.employeeId).filter((x): x is string => Boolean(x)))];
  const [users, emps, docs] = await Promise.all([
    userIds.length ? platformPrisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } }).catch(() => []) : [],
    empIds.length ? peoplePrisma.employee.findMany({ where: { orgId: args.orgId, id: { in: empIds } }, select: { id: true, name: true, code: true } }) : [],
    peoplePrisma.employeeDocument.findMany({ where: { orgId: args.orgId, id: { in: rows.filter((r) => r.what !== 'STATUTORY').map((r) => r.entityId) } }, select: { id: true, title: true } }),
  ]);
  const userName = new Map(users.map((u: any) => [u.id, u.fullName || u.email]));
  const empName = new Map(emps.map((e) => [e.id, `${e.name}${e.code ? ` (${e.code})` : ''}`]));
  const docTitle = new Map(docs.map((d) => [d.id, d.title]));
  return {
    from,
    to,
    views: rows.map((r) => ({
      id: r.id, at: r.at, what: r.what, label: ACCESS_KINDS[r.what] || r.what, userId: r.userId, user: userName.get(r.userId) || 'Unknown user',
      employeeId: r.employeeId, employee: r.employeeId ? empName.get(r.employeeId) || 'Former employee' : null,
      detail: r.what === 'STATUTORY' ? r.field : docTitle.get(r.entityId) || 'Removed document',
    })),
    privateCaseOpens: caseOpens.map((c: any) => ({ userId: c.userId, user: userName.get(c.userId) || 'Unknown user', what: c.what, count: c._count._all })),
  };
}
