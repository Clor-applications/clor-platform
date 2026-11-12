/**
 * Announcements from CLOR (Ops plan P1, item 4). Staff write them on
 * ops.clor.in (routes/opsAnnouncements.ts); customers see the live ones as a
 * bar at the top of the app (routes/announcements.ts). A draft until
 * published; live from startsAt until endsAt or until a person ends it.
 */
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { SELLABLE_APP_CODES } from '../constants/appCatalog.js';
import { appAccess } from './subscriptions.js';
import { accountRoleOf } from './accountMembership.js';

export const KINDS = ['info', 'maintenance', 'incident'] as const;
export const AUDIENCES = ['everyone', 'admins'] as const;
export const ANNOUNCEMENT_APPS = SELLABLE_APP_CODES;
export type AnnouncementStatus = 'draft' | 'scheduled' | 'live' | 'ended';

/** Roles that see an announcement meant for administrators. */
const ADMIN_ROLES = new Set(['OWNER', 'ADMIN', 'BILLING_ADMIN']);
/** A problem being fixed comes first, then planned work, then news. */
const ORDER: Record<string, number> = { incident: 0, maintenance: 1, info: 2 };

type Row = { publishedAt: Date | null; endedAt: Date | null; startsAt: Date; endsAt: Date | null };

export function statusOf(a: Row, now = new Date()): AnnouncementStatus {
  if (!a.publishedAt) return 'draft';
  if (a.endedAt || (a.endsAt && a.endsAt <= now)) return 'ended';
  if (a.startsAt > now) return 'scheduled';
  return 'live';
}

/** An incident stays on screen while it lasts; news and maintenance can be closed. */
export const dismissible = (kind: string) => kind !== 'incident';

/** What this person should see now, most serious first. */
export async function liveFor(accountId: string, userId: string, now = new Date()) {
  return outsideTenant('announcements: what this person sees', async () => {
    const live = await platformPrisma.announcement.findMany({
      where: { publishedAt: { not: null }, endedAt: null, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: { startsAt: 'desc' },
      take: 20,
      include: { dismissals: { where: { userId }, select: { userId: true } } },
    });
    if (!live.length) return [];
    const [access, role] = await Promise.all([appAccess(accountId), accountRoleOf(accountId, userId)]);
    const owned = new Set(access.ownedApps);
    return live
      .filter((a) => !a.apps.length || a.apps.some((x) => owned.has(x)))
      .filter((a) => a.audience !== 'admins' || (role && ADMIN_ROLES.has(role)))
      .filter((a) => !dismissible(a.kind) || a.dismissals.length === 0)
      .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9) || b.startsAt.getTime() - a.startsAt.getTime())
      .map((a) => ({ id: a.id, title: a.title, body: a.body, kind: a.kind, apps: a.apps, startsAt: a.startsAt, endsAt: a.endsAt, dismissible: dismissible(a.kind) }));
  });
}
