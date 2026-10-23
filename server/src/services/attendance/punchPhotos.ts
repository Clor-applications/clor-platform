import { peoplePrisma } from '../../utils/peoplePrisma.js';

/**
 * Punch selfies past each company's retention period are deleted. Moved out of routes/portalAdmin.ts so the scheduler calls a service, not a route; behaviour unchanged.
 */

/**
 * Selfies are personal data: delete each company's after its retention period
 * (Attendance rules, 90 days unless changed). The punch stays; only the photo goes.
 */
export async function purgePunchPhotos(now = new Date()) {
  const settings = await peoplePrisma.attendanceSettings.findMany({ select: { orgId: true, photoRetentionDays: true } });
  const keep = new Map(settings.map((s) => [s.orgId, s.photoRetentionDays]));
  const orgs = await peoplePrisma.punchPhoto.groupBy({ by: ['orgId'] });
  let removed = 0;
  for (const { orgId } of orgs) {
    const days = keep.get(orgId) ?? 90;
    const before = new Date(now.getTime() - days * 86_400_000);
    const old = await peoplePrisma.punchPhoto.findMany({ where: { orgId, createdAt: { lt: before } }, select: { id: true } });
    if (!old.length) continue;
    const ids = old.map((o) => o.id);
    await peoplePrisma.devicePunch.updateMany({ where: { orgId, photoId: { in: ids } }, data: { photoId: null } });
    removed += (await peoplePrisma.punchPhoto.deleteMany({ where: { orgId, id: { in: ids } } })).count;
  }
  return removed;
}
