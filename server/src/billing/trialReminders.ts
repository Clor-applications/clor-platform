import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { exclusive, leaseFor } from '../services/jobLease.js';
import { registerJob } from '../services/jobRegistry.js';
import { sendTemplate } from '../services/mailer.js';

/**
 * Trial reminders to the customer (platform audit, 11 Nov 2026: "no
 * trial-ending, renewal or payment-failed emails"). The account owner hears
 * 7, 3 and 1 days before the trial ends, and once when it has ended and the
 * account turns read-only. CLOR's sales team already gets its own alert
 * (services/ops/alerts.ts); this is the customer's side.
 *
 * Each step is sent once per trial end date: a missed run still sends the most
 * urgent step that applies, never an earlier one after it, and a trial extended
 * by staff gets its reminders again for the new date. The record of what was
 * sent is the email outbox itself (relatedType TrialReminder), so no new table.
 */
const EVERY_MS = 6 * 3600_000;
const DAY = 86_400_000;
export const BEFORE_DAYS = [7, 3, 1] as const;
/** An ended trial older than this is left to staff: that customer needs a person, not an email. */
const ENDED_WITHIN_DAYS = 7;

const words = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const dayKey = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Which reminder is due for a trial ending at `endsAt`, or null. */
export function dueStep(endsAt: Date, now = new Date()): 'ended' | `${number}` | null {
  const left = (endsAt.getTime() - now.getTime()) / DAY;
  if (left <= 0) return -left <= ENDED_WITHIN_DAYS ? 'ended' : null;
  const fits = BEFORE_DAYS.filter((d) => left <= d);
  return fits.length ? (String(Math.min(...fits)) as `${number}`) : null;
}

/** Steps at or after `step`: once a later one is sent, an earlier one never goes. */
const sameOrLater = (step: string) => (step === 'ended' ? ['ended'] : [...BEFORE_DAYS.filter((d) => d <= Number(step)).map(String), 'ended']);

export type TrialReminderRun = { sent: number; skipped: number };

export async function runTrialReminders(now = new Date(), only?: string[]): Promise<TrialReminderRun> {
  return outsideTenant('billing: trial reminders', async () => {
    const out: TrialReminderRun = { sent: 0, skipped: 0 };
    const subs = await platformPrisma.subscription.findMany({
      where: {
        ...(only ? { accountId: { in: only } } : {}),
        status: 'trialing',
        /* The owner stopped the plan: no nudges to choose one. */
        cancelAtPeriodEnd: false,
        trialEndsAt: { not: null, gt: new Date(now.getTime() - ENDED_WITHIN_DAYS * DAY), lte: new Date(now.getTime() + Math.max(...BEFORE_DAYS) * DAY) },
      },
      select: { id: true, accountId: true, trialEndsAt: true },
      take: 1000,
    });
    for (const sub of subs) {
      const endsAt = sub.trialEndsAt!;
      const step = dueStep(endsAt, now);
      if (!step) continue;
      const key = (s: string) => `${sub.id}:${dayKey(endsAt)}:${s}`;
      const already = await platformPrisma.emailOutbox.count({ where: { relatedType: 'TrialReminder', relatedId: { in: sameOrLater(step).map(key) } } });
      if (already) {
        out.skipped += 1;
        continue;
      }
      const owner = await platformPrisma.accountMembership.findFirst({ where: { accountId: sub.accountId, role: 'OWNER', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { userId: true } });
      const user = owner ? await platformPrisma.user.findUnique({ where: { id: owner.userId }, select: { email: true, fullName: true, isActive: true } }) : null;
      if (!user?.email || !user.isActive) {
        out.skipped += 1;
        continue;
      }
      const account = await platformPrisma.account.findUnique({ where: { id: sub.accountId }, select: { name: true } });
      const app = (process.env.APP_URL || 'https://app.clor.in').replace(/\/$/, '');
      const days = Math.max(1, Math.ceil((endsAt.getTime() - now.getTime()) / DAY));
      await sendTemplate({
        templateKey: step === 'ended' ? 'billing.trial_ended' : 'billing.trial_ending',
        to: user.email,
        toName: user.fullName ?? undefined,
        accountId: sub.accountId,
        transactional: true,
        relatedType: 'TrialReminder',
        relatedId: key(step),
        data: {
          userName: user.fullName || user.email,
          companyName: account?.name || 'your company',
          days: `${days} day${days === 1 ? '' : 's'}`,
          endsOn: words(endsAt),
          plansUrl: 'https://clor.in/pricing',
          appUrl: app,
        },
      });
      out.sent += 1;
    }
    return out;
  });
}

export function startTrialReminders({ intervalMs = EVERY_MS, startupDelayMs = 240_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () =>
    exclusive('billing.trialReminders', leaseFor(intervalMs), () => runTrialReminders(), { idempotent: true })
      .then((r) => r && r.sent && console.log('[billing.trialReminders]', JSON.stringify(r)))
      .catch((e) => console.error('[billing.trialReminders] failed:', e instanceof Error ? e.message : e));
  registerJob('billing.trialReminders', tick, intervalMs);
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
