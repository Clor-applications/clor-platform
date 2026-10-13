import { runDueSchedules } from './recurring.js';

/**
 * The thing that makes a schedule a schedule.
 *
 * Recurring invoices used to be raised when somebody signed in. That is not a
 * billing system: a business that took a fortnight off billed nobody, and the
 * customer whose invoice was due on the 1st got it on the 14th.
 *
 * Deliberately an interval in the API process rather than a queue or a cron
 * daemon. This product runs as one service on one box today, and the run is
 * idempotent per period — so the simple thing is safe, and when a second
 * instance or a real scheduler arrives, nothing here has to be unpicked: they
 * can call the same function or the same endpoint and the period claim still
 * decides who wins.
 *
 * Failures are logged and swallowed. A billing run that throws must not take
 * the API down with it, and the next tick will try again.
 */

const HOUR = 60 * 60 * 1000;

export function startRecurringScheduler({
  intervalMs = HOUR,
  // A short delay so boot is not competing with the first requests.
  startupDelayMs = 30_000,
}: { intervalMs?: number; startupDelayMs?: number } = {}) {
  if (String(process.env.RECURRING_SCHEDULER || '').toLowerCase() === 'off') {
    return () => {};
  }

  let running = false;

  const tick = async () => {
    // Never two at once: a slow run must not overlap the next tick and race
    // itself for the same period.
    if (running) return;
    running = true;
    try {
      const summary = await runDueSchedules();
      if (summary.raised > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[recurring] raised ${summary.raised} draft invoice(s) across ${summary.schedules} schedule(s)`
        );
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[recurring] run failed:', e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };

  // Catch up on boot: a service that was down over a billing date should raise
  // what it missed as soon as it is back, not wait an hour.
  const startupTimer = setTimeout(tick, startupDelayMs);
  const timer = setInterval(tick, intervalMs);
  // Neither should hold the process open on shutdown.
  startupTimer.unref?.();
  timer.unref?.();

  return () => {
    clearTimeout(startupTimer);
    clearInterval(timer);
  };
}
