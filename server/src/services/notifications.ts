import { platformPrisma } from '../utils/platformPrisma.js';
import { exclusive, leaseFor } from './jobLease.js';
import { registerJob } from './jobRegistry.js';
import { isSampleOrg } from './sampleIdentity.js';

/**
 * In-app notifications: the bell every app shares.
 *
 * Something happens (an approval is raised, a reader goes quiet, a bank
 * change waits, the directory adds a person) and the people who should act
 * get a row each. Who those people are is answered the way the API answers
 * "may you?": by permission — everyone in the organisation whose roles grant
 * it (directly or through a role profile), plus administrators. E-mail still
 * goes out where it did; this is the copy that follows the person into
 * whichever app they have open.
 */
export type NotificationLink = { app: string; screen?: string; params?: Record<string, string> };
export type Notice = { kind: string; title: string; body?: string | null; link?: NotificationLink | null };

/** Users of the organisation holding this permission (MODULE::Resource::ACTION), or any ADMIN role. */
export async function usersWithPermission(accountId: string, orgId: string, permission: string): Promise<string[]> {
  const [module, subModule, action] = String(permission || '').split('::');
  if (!module || !action) return [];
  const perm = await platformPrisma.permission.findFirst({ where: { module, subModule: subModule || null, action }, select: { id: true } });
  const granting = await platformPrisma.rolePermission.findMany({ where: { accountId, orgId, allowed: true, ...(perm ? { permissionId: perm.id } : { id: '__none__' }) }, select: { roleId: true } });
  const admins = await platformPrisma.role.findMany({ where: { accountId, orgId, roleType: 'ADMIN' }, select: { id: true } });
  const roleIds = [...new Set([...granting.map((g) => g.roleId), ...admins.map((a) => a.id)])];
  if (!roleIds.length) return [];
  return usersHoldingRoles(accountId, orgId, roleIds);
}

/** Users assigned any of these roles, directly or through a role profile. */
export async function usersHoldingRoles(accountId: string, orgId: string, roleIds: string[]): Promise<string[]> {
  if (!roleIds.length) return [];
  const [direct, profileRoles] = await Promise.all([
    platformPrisma.userRoleAssignment.findMany({ where: { accountId, orgId, roleId: { in: roleIds } }, select: { userId: true } }),
    platformPrisma.roleProfileRole.findMany({ where: { accountId, orgId, roleId: { in: roleIds } }, select: { profileId: true } }),
  ]);
  const viaProfiles = profileRoles.length
    ? await platformPrisma.userRoleProfile.findMany({ where: { accountId, orgId, profileId: { in: profileRoles.map((p) => p.profileId) } }, select: { userId: true } })
    : [];
  const ids = [...new Set([...direct, ...viaProfiles].map((a) => a.userId))];
  if (!ids.length) return [];
  /* A stable order, by id (cuids, so roughly who was added first): it decides who a step names first and who is told first, so it must not change from one read to the next. */
  const active = await platformPrisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true }, orderBy: { id: 'asc' } });
  return active.map((u) => u.id);
}

/**
 * One row per person, and throws when the rows cannot be written: for the
 * outbox (services/attendance/notices.ts), which tries again. With a
 * `dedupeKey`, a person who already has a notice under that key is not sent
 * another (the unique key on Notification), so a retry, or the same notice
 * queued twice, is one notice. Returns how many rows were written.
 */
export async function sendNotice(accountId: string, orgId: string, userIds: string[], notice: Notice, opts: { except?: string | null; dedupeKey?: string | null; subjectKey?: string | null } = {}) {
  let ids = [...new Set(userIds)].filter((id) => id && !id.startsWith('portal:') && id !== 'system' && id !== opts.except);
  if (!ids.length) return 0;
  /* Explore's sample company: its visitor starts with, and keeps, a clean bell. */
  if (await isSampleOrg(orgId)) return 0;
  /* People who muted this kind for this company are skipped. */
  const muted = await platformPrisma.notificationMute.findMany({ where: { orgId, kind: notice.kind, userId: { in: ids } }, select: { userId: true } });
  const off = new Set(muted.map((m) => m.userId));
  ids = ids.filter((id) => !off.has(id));
  if (!ids.length) return 0;
  const dedupeKey = opts.dedupeKey ? String(opts.dedupeKey).slice(0, 300) : null;
  const r = await platformPrisma.notification.createMany({
    data: ids.map((userId) => ({ accountId, orgId, userId, kind: notice.kind, title: notice.title.slice(0, 200), body: notice.body ? String(notice.body).slice(0, 1000) : null, linkJson: notice.link ? JSON.stringify(notice.link) : null, dedupeKey, subjectKey: opts.subjectKey ? String(opts.subjectKey).slice(0, 200) : null })),
    ...(dedupeKey ? { skipDuplicates: true } : {}),
  });
  return r.count;
}

/**
 * A recurring notice (a morning digest, a standing reminder) is one row per
 * kind and person, refreshed: the same key every run, so a job that runs
 * daily for two weeks leaves one unread row that says today's words, not
 * fourteen that say the same thing (production, 9 Nov 2026: the bell said 18
 * while the Inbox was empty). The row comes back unread and to the top.
 * `retire` names older keys the same notice used to be sent under; those
 * rows go. Returns 1 when a row was written or refreshed.
 */
export async function upsertNotice(accountId: string, orgId: string, userId: string, notice: Notice, dedupeKey: string, opts: { retire?: { startsWith: string } } = {}) {
  if (!userId || userId.startsWith('portal:') || userId === 'system') return 0;
  if (await isSampleOrg(orgId)) return 0;
  if (await platformPrisma.notificationMute.findFirst({ where: { orgId, kind: notice.kind, userId }, select: { id: true } })) return 0;
  const key = String(dedupeKey).slice(0, 300);
  const data = { kind: notice.kind, title: notice.title.slice(0, 200), body: notice.body ? String(notice.body).slice(0, 1000) : null, linkJson: notice.link ? JSON.stringify(notice.link) : null };
  if (opts.retire) await platformPrisma.notification.deleteMany({ where: { orgId, userId, kind: notice.kind, dedupeKey: { startsWith: opts.retire.startsWith, not: key } } });
  await platformPrisma.notification.upsert({
    where: { orgId_userId_dedupeKey: { orgId, userId, dedupeKey: key } },
    create: { accountId, orgId, userId, ...data, dedupeKey: key },
    update: { ...data, readAt: null, createdAt: new Date() },
  });
  return 1;
}

/** One row per person. Never throws: a notification must not break the thing it is about. Leave and request notices go through the outbox instead (sendNotice). */
export async function notifyUsers(accountId: string, orgId: string, userIds: string[], notice: Notice, opts: { except?: string | null; subjectKey?: string | null } = {}) {
  try {
    return await sendNotice(accountId, orgId, userIds, notice, opts);
  } catch (e) {
    console.error('[notifications]', e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Words a "waiting for you" title starts with that stop being true once the request is withdrawn. */
const WAITING_WORDS = /^(Waiting for you|Overdue|Handed on to you):\s*/;

/**
 * A request was withdrawn (docs/people/workflow-engine/SPEC.md 3.6), or HR cancelled it while it waited: its
 * "waiting for you" notices, found by the key they were sent with, either say so (SHOW_WITHDRAWN: "Withdrawn: …"
 * or "Cancelled: …", marked read, opening the closed request) or go (REMOVE). Notices sent before keys existed are
 * left as they are. Never throws: the withdrawal has already happened. Returns how many notices changed.
 */
export async function retireNotices(orgId: string, subjectKey: string, mode: 'SHOW_WITHDRAWN' | 'REMOVE', link?: NotificationLink | null, word: 'Withdrawn' | 'Cancelled' = 'Withdrawn') {
  try {
    if (mode === 'REMOVE') return (await platformPrisma.notification.deleteMany({ where: { orgId, subjectKey } })).count;
    const rows = await platformPrisma.notification.findMany({ where: { orgId, subjectKey, NOT: [{ title: { startsWith: 'Withdrawn: ' } }, { title: { startsWith: 'Cancelled: ' } }] }, select: { id: true, title: true, readAt: true } });
    const now = new Date();
    for (const r of rows) {
      await platformPrisma.notification.updateMany({
        where: { id: r.id, orgId },
        data: { title: `${word}: ${r.title.replace(WAITING_WORDS, '')}`.slice(0, 200), body: null, readAt: r.readAt ?? now, ...(link ? { linkJson: JSON.stringify(link) } : {}) },
      });
    }
    return rows.length;
  } catch (e) {
    console.error('[notifications] withdrawn notices not updated:', e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Everyone who may act on this (by permission), told once. */
export async function notifyPermission(accountId: string, orgId: string, permission: string, notice: Notice, opts: { except?: string | null } = {}) {
  const ids = await usersWithPermission(accountId, orgId, permission).catch(() => [] as string[]);
  return notifyUsers(accountId, orgId, ids, notice, opts);
}

/**
 * Only one notification of a kind about one thing.
 *
 * By default "one" means one while it is unread: a reader that stays down
 * does not pile up, but once read it may be raised again the next time the
 * job runs. `ever: true` means one, full stop, read or not: a dated reminder
 * (a contract ends on 30 Nov, a licence on 1 Dec) whose key already names the
 * date and stage is never worth sending twice. The bell keeps read rows for
 * 90 days (pruneNotifications), so "ever" is bounded by that.
 */
export async function notifyPermissionOnce(accountId: string, orgId: string, permission: string, notice: Notice & { dedupeKey: string }, opts: { ever?: boolean } = {}) {
  const ids = await usersWithPermission(accountId, orgId, permission).catch(() => [] as string[]);
  if (!ids.length) return 0;
  const have = await platformPrisma.notification.findMany({ where: { orgId, userId: { in: ids }, kind: notice.kind, ...(opts.ever ? {} : { readAt: null }), linkJson: { contains: `"dedupe":"${notice.dedupeKey}"` } }, select: { userId: true } });
  const seen = new Set(have.map((h) => h.userId));
  const link = { ...(notice.link || { app: 'attendance' }), dedupe: notice.dedupeKey } as NotificationLink & { dedupe: string };
  return notifyUsers(accountId, orgId, ids.filter((id) => !seen.has(id)), { ...notice, link });
}

/** The people holding a permission, with addresses, for mail that goes to "whoever may act". */
export async function recipientsWithPermission(accountId: string, orgId: string, permission: string) {
  const ids = await usersWithPermission(accountId, orgId, permission);
  if (!ids.length) return [] as Array<{ id: string; email: string; fullName: string }>;
  return platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, fullName: true } });
}

/** Keep the inbox small: read rows go after 90 days, unread after 180. */
export async function pruneNotifications(now = new Date()) {
  const day = 86_400_000;
  const r = await platformPrisma.notification.deleteMany({
    where: { OR: [{ readAt: { not: null }, createdAt: { lt: new Date(now.getTime() - 90 * day) } }, { readAt: null, createdAt: { lt: new Date(now.getTime() - 180 * day) } }] },
  });
  return r.count;
}

export function startNotificationPruning({ intervalMs = 24 * 3_600_000, startupDelayMs = 240_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () => exclusive('notifications.prune', leaseFor(intervalMs), () => pruneNotifications(), { idempotent: true }).catch((e) => console.error('[notifications] prune failed:', e instanceof Error ? e.message : e));
  registerJob('startNotificationPruning', tick, intervalMs);
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
