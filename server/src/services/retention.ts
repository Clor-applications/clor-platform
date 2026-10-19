import { platformPrisma } from '../utils/platformPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { exclusive, leaseFor } from './jobLease.js';

/**
 * Deletes sign-in records once they have no further use.
 *
 * Nothing was ever removed: every reset token, verification token and ended
 * session — with the IP address and browser it came from — was kept for good.
 * Keeping personal data past its purpose is what data-protection law asks a
 * service not to do, and these records have none once they have expired.
 *
 * What goes, and when (days, from the environment so an operator can follow
 * their own retention schedule):
 *  - reset and verification tokens: once expired or used, after
 *    TOKEN_RETENTION_DAYS (default 7);
 *  - sessions: once expired or revoked, after SESSION_RETENTION_DAYS
 *    (default 90 — long enough to investigate a suspicious sign-in);
 *  - sign-in events (AuthEvent): only when AUTH_EVENT_RETENTION_DAYS is set.
 *    They are the security log, so how long to keep them is the operator's
 *    decision, not a default here;
 *  - punch selfies (PunchPhoto): after PUNCH_PHOTO_RETENTION_DAYS (default
 *    30). The photo exists so a reviewer can see who punched; a month covers
 *    the payroll cycle it belongs to. The punch itself stays, with its
 *    position and site — only the image goes.
 * Business records and the audit log are never touched.
 */
const days = (name: string, fallback: number | null) => {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const ago = (d: number) => new Date(Date.now() - d * 86_400_000);

/** How long a punch selfie is kept, for the notice employees read before sending one. */
export const punchPhotoRetentionDays = () => days('PUNCH_PHOTO_RETENTION_DAYS', 30)!;

/** Originals of what readers sent: 13 months by default, never under a year. */
export const readerEventRetentionDays = () => Math.max(366, days('READER_EVENT_RETENTION_DAYS', 395)!);

export async function purgeExpiredRecords() {
  const tokenDays = days('TOKEN_RETENTION_DAYS', 7)!;
  const sessionDays = days('SESSION_RETENTION_DAYS', 90)!;
  const eventDays = days('AUTH_EVENT_RETENTION_DAYS', null);

  const tokenCutoff = ago(tokenDays);
  const tokens = { OR: [{ expiresAt: { lt: tokenCutoff } }, { usedAt: { lt: tokenCutoff } }] };
  const resets = await platformPrisma.passwordResetToken.deleteMany({ where: tokens });
  const verifications = await platformPrisma.emailVerificationToken.deleteMany({ where: tokens });

  const sessionCutoff = ago(sessionDays);
  const sessions = await platformPrisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: sessionCutoff } }, { revokedAt: { lt: sessionCutoff } }] },
  });

  const events = eventDays ? await platformPrisma.authEvent.deleteMany({ where: { createdAt: { lt: ago(eventDays) } } }) : { count: 0 };

  const photoCutoff = ago(punchPhotoRetentionDays());
  const stale = await peoplePrisma.punchPhoto.findMany({ where: { createdAt: { lt: photoCutoff } }, select: { id: true } });
  let photos = 0;
  if (stale.length) {
    const ids = stale.map((x) => x.id);
    await peoplePrisma.devicePunch.updateMany({ where: { photoId: { in: ids } }, data: { photoId: null } });
    photos = (await peoplePrisma.punchPhoto.deleteMany({ where: { id: { in: ids } } })).count;
  }

  /* Originals of reader lines (ReaderEvent): kept at least a year — the minimum the DPDP Rules set for processing logs — then deleted. */
  const readerEvents = await peoplePrisma.readerEvent.deleteMany({ where: { receivedAt: { lt: ago(readerEventRetentionDays()) } } });

  return {
    readerEvents: readerEvents.count,
    passwordResetTokens: resets.count,
    emailVerificationTokens: verifications.count,
    sessions: sessions.count,
    authEvents: events.count,
    punchPhotos: photos,
  };
}

/** Once a day, from server start. RETENTION_PURGE=off disables it. */
export function startRetentionPurge() {
  if (String(process.env.RETENTION_PURGE || '').toLowerCase() === 'off') return () => {};
  const run = async () => {
    try {
      const r: Record<string, number> = (await exclusive('retention.purge', leaseFor(24 * 60 * 60 * 1000), purgeExpiredRecords)) || {};
      const total = Object.values(r).reduce((a, b) => a + b, 0);
      // eslint-disable-next-line no-console
      if (total) console.log('[retention] removed', r);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[retention] purge failed:', e instanceof Error ? e.message : e);
    }
  };
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
