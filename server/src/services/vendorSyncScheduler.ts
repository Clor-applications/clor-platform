import { syncAllVendorConnections } from '../routes/iclock.js';
import { purgePunchPhotos } from '../routes/portalAdmin.js';
import { runReaderChecks } from './attendance/readerHealth.js';
import { exclusive, leaseFor } from './jobLease.js';

/**
 * Pulls punches from vendor clouds (e-Time Office) every five minutes, the
 * same in-process interval the recurring-invoice run uses (see
 * recurringScheduler.ts). Readers that push (ADMS) need nothing like this.
 *
 * On a host that sleeps when idle (Cloud Run scaled to zero) the interval does
 * not fire while asleep; the next pull starts from the last one, so nothing is
 * lost — punches just arrive later. "Sync now" on the connection pulls at once.
 * VENDOR_SYNC=off disables it.
 */
export function startVendorSync({ intervalMs = 5 * 60_000, startupDelayMs = 45_000 } = {}) {
  if (String(process.env.VENDOR_SYNC || '').toLowerCase() === 'off') return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = (await exclusive('vendor.sync', leaseFor(intervalMs), syncAllVendorConnections)) || { added: 0, connections: 0 };
      // eslint-disable-next-line no-console
      if (r.added) console.log(`[vendor-sync] ${r.added} punch(es) from ${r.connections} connection(s)`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[vendor-sync] run failed:', e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  const startup = setTimeout(tick, startupDelayMs);
  const timer = setInterval(tick, intervalMs);
  startup.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(startup);
    clearInterval(timer);
  };
}

/** Deletes phone-punch selfies past each company's retention period, every six hours. */
export function startPhotoPurge({ intervalMs = 6 * 3_600_000, startupDelayMs = 90_000 } = {}) {
  const tick = async () => {
    try {
      const n = (await exclusive('photo.purge', leaseFor(intervalMs), purgePunchPhotos)) || 0;
      // eslint-disable-next-line no-console
      if (n) console.log(`[photo-purge] ${n} punch photo(s) past retention deleted`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[photo-purge] run failed:', e instanceof Error ? e.message : e);
    }
  };
  const startup = setTimeout(tick, startupDelayMs);
  const timer = setInterval(tick, intervalMs);
  startup.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(startup);
    clearInterval(timer);
  };
}

/**
 * Reader health checks every five minutes: offline readers, wrong clocks, full
 * readers, failing commands, and no punches at all on a working day. Each
 * problem is alerted once when it starts and once when it clears.
 * READER_CHECKS=off disables it.
 */
export function startReaderChecks({ intervalMs = 5 * 60_000, startupDelayMs = 60_000 } = {}) {
  if (String(process.env.READER_CHECKS || '').toLowerCase() === 'off') return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = (await exclusive('reader.checks', leaseFor(intervalMs), runReaderChecks)) || { opened: 0, resolved: 0 };
      // eslint-disable-next-line no-console
      if (r.opened || r.resolved) console.log(`[reader-checks] ${r.opened} opened, ${r.resolved} cleared`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[reader-checks] run failed:', e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  const startup = setTimeout(tick, startupDelayMs);
  const timer = setInterval(tick, intervalMs);
  startup.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(startup);
    clearInterval(timer);
  };
}

/**
 * Webhook retries: deliveries that failed are tried again on their schedule
 * (services/attendance/webhooks.ts); old deliveries and used idempotency keys
 * are pruned once an hour.
 */
export function startWebhookRetries({ intervalMs = 60_000, startupDelayMs = 30_000 } = {}) {
  if (process.env.WEBHOOK_RETRIES === 'off' || process.env.NODE_ENV === 'test') return () => undefined;
  let running = false;
  let ticks = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { retryDueDeliveries, pruneDeliveries } = await import('./attendance/webhooks.js');
      const n = (await exclusive('webhooks.retry', leaseFor(intervalMs), retryDueDeliveries)) || 0;
      // eslint-disable-next-line no-console
      if (n) console.log(`[webhooks] retried ${n} deliver${n === 1 ? 'y' : 'ies'}`);
      ticks += 1;
      if (ticks % 60 === 1) {
        await pruneDeliveries();
        const { pruneIdempotency } = await import('./attendance/idempotency.js');
        await pruneIdempotency();
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[webhooks] retry tick failed:', e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  const startup = setTimeout(tick, startupDelayMs);
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  startup.unref?.();
  return () => {
    clearTimeout(startup);
    clearInterval(timer);
  };
}
