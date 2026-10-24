import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { notifyUsers } from '../notifications.js';

/**
 * Read-and-accept (docs/people/02-PRD.md DOC-05, POL-04). One row per person
 * per target — a document on their file, or a policy version — from the day
 * they are asked to the day they accept. The report says who has not, and a
 * reminder reaches them again without asking twice.
 */

export type AckTarget = 'DOCUMENT' | 'POLICY_VERSION';
type Who = { accountId: string; orgId: string; userId: string | null };
type Notice = { title: string; body?: string | null; link?: Record<string, unknown> };

export class AckError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Ask these people. Someone already asked keeps their row; someone who accepted is not asked again. Returns how many are newly asked. */
export async function ask(who: Who, targetType: AckTarget, targetId: string, employeeIds: string[], notice: Notice) {
  const ids = [...new Set(employeeIds)].filter(Boolean);
  if (!ids.length) return 0;
  const people = await peoplePrisma.employee.findMany({ where: { orgId: who.orgId, id: { in: ids }, status: { not: 'LEFT' } }, select: { id: true, userId: true } });
  const made = await peoplePrisma.acknowledgement.createMany({ data: people.map((p) => ({ accountId: who.accountId, orgId: who.orgId, targetType, targetId, employeeId: p.id, askedByUserId: who.userId })), skipDuplicates: true });
  const users = people.map((p) => p.userId).filter((u): u is string => Boolean(u));
  if (users.length) await notifyUsers(who.accountId, who.orgId, users, { kind: 'people.acknowledge', title: notice.title, body: notice.body ?? 'Please read it and accept in the employee app.', link: (notice.link || { app: 'people', screen: 'overview' }) as any }).catch(() => undefined);
  return made.count;
}

/** The person accepts; doing it twice is harmless. */
export async function accept(orgId: string, employeeId: string, ackId: string) {
  const row = await peoplePrisma.acknowledgement.findFirst({ where: { id: ackId, orgId, employeeId } });
  if (!row) throw new AckError('Nothing to accept here.', 404);
  if (row.acceptedAt) return row;
  return peoplePrisma.acknowledgement.update({ where: { id: row.id }, data: { acceptedAt: new Date() } });
}

/** Who was asked, who accepted, who has not. */
export async function report(orgId: string, targetType: AckTarget, targetId: string) {
  const rows = await peoplePrisma.acknowledgement.findMany({ where: { orgId, targetType, targetId }, orderBy: { askedAt: 'asc' } });
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: rows.map((r) => r.employeeId) } }, select: { id: true, name: true, code: true } });
  const of = new Map(people.map((p) => [p.id, p]));
  const line = (r: (typeof rows)[number]) => ({ id: r.id, employeeId: r.employeeId, name: of.get(r.employeeId)?.name || '', code: of.get(r.employeeId)?.code || null, askedAt: r.askedAt, acceptedAt: r.acceptedAt, remindedAt: r.remindedAt, remindCount: r.remindCount });
  const accepted = rows.filter((r) => r.acceptedAt).map(line);
  const pending = rows.filter((r) => !r.acceptedAt).map(line);
  return { asked: rows.length, accepted: accepted.length, pending: pending.length, acceptedList: accepted, pendingList: pending };
}

/** Everyone who has not accepted hears again. Returns how many were reminded. */
export async function remind(who: Who, targetType: AckTarget, targetId: string, notice: Notice) {
  const rows = await peoplePrisma.acknowledgement.findMany({ where: { orgId: who.orgId, targetType, targetId, acceptedAt: null }, select: { id: true, employeeId: true } });
  if (!rows.length) return 0;
  await peoplePrisma.acknowledgement.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { remindedAt: new Date(), remindCount: { increment: 1 } } });
  const people = await peoplePrisma.employee.findMany({ where: { orgId: who.orgId, id: { in: rows.map((r) => r.employeeId) } }, select: { userId: true } });
  const users = people.map((p) => p.userId).filter((u): u is string => Boolean(u));
  if (users.length) await notifyUsers(who.accountId, who.orgId, users, { kind: 'people.acknowledge', title: `Reminder: ${notice.title}`, body: notice.body ?? 'Please read it and accept in the employee app.', link: (notice.link || { app: 'people', screen: 'overview' }) as any }).catch(() => undefined);
  return rows.length;
}

/** What one person still has to accept, with a title for each. */
export async function pendingFor(orgId: string, employeeId: string) {
  const rows = await peoplePrisma.acknowledgement.findMany({ where: { orgId, employeeId, acceptedAt: null }, orderBy: { askedAt: 'asc' } });
  const docIds = rows.filter((r) => r.targetType === 'DOCUMENT').map((r) => r.targetId);
  const versionIds = rows.filter((r) => r.targetType === 'POLICY_VERSION').map((r) => r.targetId);
  const [docs, versions] = await Promise.all([
    docIds.length ? peoplePrisma.employeeDocument.findMany({ where: { orgId, id: { in: docIds } }, select: { id: true, title: true } }) : [],
    versionIds.length ? peoplePrisma.policyVersion.findMany({ where: { orgId, id: { in: versionIds } }, select: { id: true, version: true, policy: { select: { title: true } } } }) : [],
  ]);
  const docOf = new Map(docs.map((d) => [d.id, d.title]));
  const verOf = new Map(versions.map((v) => [v.id, `${v.policy.title} (v${v.version})`]));
  return rows.map((r) => ({ id: r.id, targetType: r.targetType, targetId: r.targetId, title: r.targetType === 'DOCUMENT' ? docOf.get(r.targetId) || 'Document' : verOf.get(r.targetId) || 'Policy', askedAt: r.askedAt, remindedAt: r.remindedAt }));
}
