import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { liveFor, markReleaseNotesSeen, releaseNotesFor } from '../services/announcements.js';
import { check, idParams } from '../middleware/validate.js';

/**
 * Announcements from CLOR, for the signed-in person (Ops plan P1). Read-only
 * apart from closing one for yourself. Staff write them in routes/opsAnnouncements.ts.
 */
export const announcementsRouter = Router();
announcementsRouter.use('/announcements', requireAuth);

announcementsRouter.get('/announcements', async (req, res) => {
  res.json({ announcements: await liveFor(req.auth!.accountId, req.auth!.userId) });
});

/** What's new (round 67): CLOR's release notes for this person, and how many are unread. */
announcementsRouter.get('/announcements/whats-new', async (req, res) => {
  res.json(await releaseNotesFor(req.auth!.accountId, req.auth!.userId));
});

announcementsRouter.post('/announcements/whats-new/seen', async (req, res) => {
  res.json({ marked: await markReleaseNotesSeen(req.auth!.accountId, req.auth!.userId) });
});

/** Close one for yourself, on every device. Only one you can see, and never a problem notice while it lasts. */
announcementsRouter.post('/announcements/:id/dismiss', check({ params: idParams }), async (req, res) => {
  const id = String(req.params.id);
  const visible = await liveFor(req.auth!.accountId, req.auth!.userId);
  const a = visible.find((x) => x.id === id);
  if (!a) return res.status(404).json({ error: 'That notice is not showing for you.' });
  if (!a.dismissible) return res.status(409).json({ error: 'This notice stays until the problem is fixed.' });
  await outsideTenant('announcements: close for this person', () =>
    platformPrisma.announcementDismissal.upsert({
      where: { announcementId_userId: { announcementId: id, userId: req.auth!.userId } },
      create: { announcementId: id, userId: req.auth!.userId },
      update: {},
    }),
  );
  res.json({ dismissed: true });
});
