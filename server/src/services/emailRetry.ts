import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { currentLease, exclusive, leaseFor } from './jobLease.js';
import { registerJob } from './jobRegistry.js';
import { MAX_ATTEMPTS, deliver, unclaimed } from './mailer.js';

/**
 * Sending mail again (platform audit, 11 Nov 2026).
 *
 * A message is sent in the request that wrote it (services/mailer.ts). Two
 * things used to end there: a send the mail server refused stayed FAILED until
 * somebody pressed Resend, and a message written just before the instance
 * stopped stayed QUEUED for ever. Every minute this job
 *
 *  - sends again each FAILED message whose next time has come (mailer.ts sets
 *    it: 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours after each failure,
 *    then no more), and
 *  - sends each QUEUED message nobody has had in hand for a few minutes.
 *
 * No message is sent twice by two senders: `deliver` claims the row with one
 * UPDATE before it dials out, and whoever does not get the claim sends nothing.
 * What cannot be ruled out is the mail server taking a message a moment before
 * the instance dies, with the result never written: that message is sent again
 * when its claim runs out. Once too many is the right side to err on for a
 * password reset or an approval notice.
 *
 * Old rows are left alone. A message that failed before retries existed has no
 * next time and is not re-sent; one that has waited unsent for more than a day
 * is marked FAILED instead of arriving days late with a dead link in it.
 */
export const RETRY_EVERY_MS = 60_000;
/** A QUEUED message this old was left behind by a sender that stopped. */
export const QUEUED_AFTER_MS = 5 * 60_000;
/** A QUEUED message older than this is no longer worth sending. */
export const QUEUED_TOO_OLD_MS = 24 * 3_600_000;
/** One run sends at most this many and stops starting new ones after this long, so it ends well inside the wake call. */
const BATCH = 40;
const RUN_FOR_MS = 120_000;

export async function runEmailRetries(now = new Date(), { limit = BATCH, runForMs = RUN_FOR_MS }: { limit?: number; runForMs?: number } = {}) {
  const free = unclaimed(now);
  const tooOld = new Date(now.getTime() - QUEUED_TOO_OLD_MS);

  const expired = await platformPrisma.emailOutbox.updateMany({
    where: { status: 'QUEUED', createdAt: { lt: tooOld }, ...free },
    data: { status: 'FAILED', nextAttemptAt: null, claimedAt: null, lastError: 'Not sent within a day of being written. Send it again by hand if it is still wanted.' },
  });

  const due = await platformPrisma.emailOutbox.findMany({
    where: {
      AND: [
        free,
        {
          OR: [
            { status: 'FAILED', attempts: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: now } },
            { status: 'QUEUED', createdAt: { lt: new Date(now.getTime() - QUEUED_AFTER_MS), gte: tooOld } },
          ],
        },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  const started = Date.now();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of due) {
    /* The instance is stopping, or another one holds the job now: what is left is still due at the next run. */
    if (currentLease()?.signal.aborted || Date.now() - started > runForMs) break;
    const after = await deliver(r.id).catch(() => null);
    if (after?.status === 'SENT') sent += 1;
    else if (after?.status === 'FAILED' && after.claimedAt === null && after.updatedAt.getTime() >= started) failed += 1;
    else skipped += 1;
  }
  return { due: due.length, sent, failed, skipped, expired: expired.count };
}

/** Every minute, under a lease so one instance sends; each row is claimed as well, so a person pressing Resend cannot double it. */
export function startEmailRetries({ intervalMs = RETRY_EVERY_MS, startupDelayMs = 45_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  if (String(process.env.EMAIL_RETRIES || '').toLowerCase() === 'off') return () => {};
  const tick = () =>
    exclusive('email.retries', leaseFor(intervalMs), () => outsideTenant('email: retries', () => runEmailRetries())).catch((e) =>
      console.error('[email.retries] failed:', e instanceof Error ? e.message : e), // eslint-disable-line no-console
    );
  registerJob('email.retries', tick, intervalMs);
  const startup = setTimeout(tick, startupDelayMs);
  const timer = setInterval(tick, intervalMs);
  startup.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(startup);
    clearInterval(timer);
  };
}
