import { platformPrisma } from '../utils/platformPrisma.js';

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
  const active = await platformPrisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  return active.map((u) => u.id);
}

/** One row per person. Never throws: a notification must not break the thing it is about. */
export async function notifyUsers(accountId: string, orgId: string, userIds: string[], notice: Notice, opts: { except?: string | null } = {}) {
  let ids = [...new Set(userIds)].filter((id) => id && id !== opts.except);
  if (!ids.length) return 0;
  try {
    /* People who muted this kind for this company are skipped. */
    const muted = await platformPrisma.notificationMute.findMany({ where: { orgId, kind: notice.kind, userId: { in: ids } }, select: { userId: true } });
    const off = new Set(muted.map((m) => m.userId));
    ids = ids.filter((id) => !off.has(id));
    if (!ids.length) return 0;
    const r = await platformPrisma.notification.createMany({
      data: ids.map((userId) => ({ accountId, orgId, userId, kind: notice.kind, title: notice.title.slice(0, 200), body: notice.body ? String(notice.body).slice(0, 1000) : null, linkJson: notice.link ? JSON.stringify(notice.link) : null })),
    });
    return r.count;
  } catch (e) {
    console.error('[notifications]', e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Everyone who may act on this (by permission), told once. */
export async function notifyPermission(accountId: string, orgId: string, permission: string, notice: Notice, opts: { except?: string | null } = {}) {
  const ids = await usersWithPermission(accountId, orgId, permission).catch(() => [] as string[]);
  return notifyUsers(accountId, orgId, ids, notice, opts);
}

/** Only one notification of a kind about one thing while it is unread: a reader that stays down does not pile up. */
export async function notifyPermissionOnce(accountId: string, orgId: string, permission: string, notice: Notice & { dedupeKey: string }) {
  const ids = await usersWithPermission(accountId, orgId, permission).catch(() => [] as string[]);
  if (!ids.length) return 0;
  const have = await platformPrisma.notification.findMany({ where: { orgId, userId: { in: ids }, kind: notice.kind, readAt: null, linkJson: { contains: `"dedupe":"${notice.dedupeKey}"` } }, select: { userId: true } });
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
  const tick = () => pruneNotifications().catch((e) => console.error('[notifications] prune failed:', e instanceof Error ? e.message : e));
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
