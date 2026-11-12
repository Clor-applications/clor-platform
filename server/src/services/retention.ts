import { platformPrisma } from '../utils/platformPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { exclusive, leaseFor, pruneJobRuns } from './jobLease.js';
import { BIOMETRIC_GRACE_UNTIL, isMinor } from './attendance/biometrics.js';
import { registerJob } from './jobRegistry.js';

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
 *  - punch selfies (PunchPhoto) are NOT handled here: each company sets how
 *    long it keeps them (Attendance rules, photoRetentionDays), and the photo
 *    purge (routes/portalAdmin.ts purgePunchPhotos) is their one owner. A
 *    global 30-day purge here used to override every company's own setting
 *    (A-48).
 * Business records and the audit log are never touched.
 */
const days = (name: string, fallback: number | null) => {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const ago = (d: number) => new Date(Date.now() - d * 86_400_000);

/** How long this company keeps a punch selfie, for the notice employees read before sending one: its own setting (default 90). */
export const punchPhotoRetentionDays = async (orgId: string) =>
  (await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { photoRetentionDays: true } }))?.photoRetentionDays ?? 90;

/** Where a phone punch was made: 13 months, then only the site stays (DPDP: no longer than needed). */
export const punchLocationRetentionDays = () => Math.max(366, days('PUNCH_LOCATION_RETENTION_DAYS', 395)!);

/** Originals of what readers sent: 13 months by default, never under a year. */
export const readerEventRetentionDays = () => Math.max(366, days('READER_EVENT_RETENTION_DAYS', 395)!);

/** Unknown reader serials (routes/iclock.ts remember): kept a month after they were last heard from. */
export const UNCLAIMED_READER_KEEP_DAYS = 30;

export async function purgeExpiredRecords() {
  const tokenDays = days('TOKEN_RETENTION_DAYS', 7)!;
  const sessionDays = days('SESSION_RETENTION_DAYS', 90)!;
  /* Sign-in events are the security log: when a period is set, never under the year the DPDP Rules ask logs be kept. */
  const setEventDays = days('AUTH_EVENT_RETENTION_DAYS', null);
  const eventDays = setEventDays ? Math.max(366, setEventDays) : null;

  const tokenCutoff = ago(tokenDays);
  const tokens = { OR: [{ expiresAt: { lt: tokenCutoff } }, { usedAt: { lt: tokenCutoff } }] };
  const resets = await platformPrisma.passwordResetToken.deleteMany({ where: tokens });
  const verifications = await platformPrisma.emailVerificationToken.deleteMany({ where: tokens });

  const sessionCutoff = ago(sessionDays);
  const sessions = await platformPrisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: sessionCutoff } }, { revokedAt: { lt: sessionCutoff } }] },
  });

  const events = eventDays ? await platformPrisma.authEvent.deleteMany({ where: { createdAt: { lt: ago(eventDays) } } }) : { count: 0 };

  /* Originals of reader lines (ReaderEvent): kept at least a year — the minimum the DPDP Rules set for processing logs — then deleted. */
  const readerEvents = await peoplePrisma.readerEvent.deleteMany({ where: { receivedAt: { lt: ago(readerEventRetentionDays()) } } });

  /* Reader serials no company added, not heard from in 30 days (audit 7 Nov 2026, #10): nobody signs in to send one. */
  const unclaimed = await peoplePrisma.unclaimedReader.deleteMany({ where: { lastSeenAt: { lt: ago(UNCLAIMED_READER_KEEP_DAYS) } } });

  /* The position of old phone punches: the punch and its site stay, the coordinates go. */
  const located = await peoplePrisma.devicePunch.updateMany({
    where: { at: { lt: ago(punchLocationRetentionDays()) }, OR: [{ latitude: { not: null } }, { longitude: { not: null } }] },
    data: { latitude: null, longitude: null, accuracyM: null },
  });

  /*
   * Copies of fingerprints and faces a company has decided not to keep
   * (copying switched off on its settings), once the notice period is over;
   * and anyone excluded.
   *
   * Company by company, and only where the decision is on record. This used
   * to be one delete of every template whose company was not in the "keeping"
   * list — so a company with no settings row, or a settings read that came
   * back empty (an outage, a row-security setting), wiped every tenant's
   * templates at once (A-48). A company with templates and no settings row is
   * logged for somebody to look at, not deleted by a blanket sweep.
   */
  let templates = 0;
  if (new Date().toISOString().slice(0, 10) > BIOMETRIC_GRACE_UNTIL) {
    const holding = (await peoplePrisma.biometricTemplate.groupBy({ by: ['orgId'] })).map((x) => x.orgId);
    if (holding.length) {
      const settings = await peoplePrisma.attendanceSettings.findMany({ where: { orgId: { in: holding } }, select: { orgId: true, biometricCopy: true } });
      const decided = new Map(settings.map((x) => [x.orgId, x.biometricCopy]));
      const unknown = holding.filter((o) => !decided.has(o));
      if (unknown.length) console.error(`[retention] biometric copies kept for ${unknown.length} compan${unknown.length === 1 ? 'y' : 'ies'} with no attendance settings on record:`, unknown.join(', ')); // eslint-disable-line no-console
      for (const orgId of holding) {
        if (decided.get(orgId) !== false) continue;
        templates += (await peoplePrisma.biometricTemplate.deleteMany({ where: { orgId } })).count;
      }
    }
  }
  const excluded = (await peoplePrisma.employee.findMany({ where: { OR: [{ biometricOptOutAt: { not: null } }, { dateOfBirth: { not: null } }] }, select: { id: true, biometricOptOutAt: true, dateOfBirth: true } }))
    .filter((x) => x.biometricOptOutAt || isMinor(x.dateOfBirth))
    .map((x) => x.id);
  if (excluded.length) templates += (await peoplePrisma.biometricTemplate.deleteMany({ where: { employeeId: { in: excluded } } })).count;

  return {
    readerEvents: readerEvents.count,
    unclaimedReaders: unclaimed.count,
    punchLocations: located.count,
    biometricTemplates: templates,
    passwordResetTokens: resets.count,
    emailVerificationTokens: verifications.count,
    sessions: sessions.count,
    authEvents: events.count,
    jobRuns: await pruneJobRuns(),
  };
}

/** Once a day, from server start. RETENTION_PURGE=off disables it. */
export function startRetentionPurge() {
  if (String(process.env.RETENTION_PURGE || '').toLowerCase() === 'off') return () => {};
  const run = async () => {
    try {
      const r: Record<string, number> = (await exclusive('retention.purge', leaseFor(24 * 60 * 60 * 1000), () => purgeExpiredRecords(), { idempotent: true })) || {};
      const total = Object.values(r).reduce((a, b) => a + b, 0);
      // eslint-disable-next-line no-console
      if (total) console.log('[retention] removed', r);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[retention] purge failed:', e instanceof Error ? e.message : e);
    }
  };
  registerJob('startRetentionPurge', run, 24 * 60 * 60 * 1000);
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
