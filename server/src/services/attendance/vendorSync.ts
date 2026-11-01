import { appLive } from '../../services/principalAllowed.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { pullPunches } from './pull/index.js';
import { vendorsWith } from './drivers.js';
import { ingestPunches } from './punches.js';
import { todayIst } from '../../utils/istDate.js';

/**
 * Vendor cloud connections: pull punches from readers that report to a vendor service (Hikvision, Dahua, BioStar, Anviz, e-Time Office, any JSON API) and feed them in like a reader push.
 *
 * Moved out of routes/iclock.ts, the ZKTeco ADMS route, so that every reader
 * channel, the portal, scheduling and payroll call a service instead of a
 * route file. Behaviour is unchanged.
 */


// ---------------------------------------------------------------------------
// Vendor clouds (e-Time Office): pulled, not pushed
// ---------------------------------------------------------------------------

/**
 * Pull new punches from an e-Time Office connection and run them through the
 * same ingest as a reader's: same matching, same days, duplicates dropped.
 * From the last pull (less ten minutes' overlap, for punches that reached the
 * vendor late), or from midnight on the first pull; `from` backfills.
 */
export async function syncVendorConnection(device: any, opts: { from?: Date; fetchImpl?: typeof fetch; dryRun?: boolean } = {}) {
  const now = new Date();
  const midnight = new Date(`${todayIst(now)}T00:00:00+05:30`);
  const from = opts.from || (device.lastFetchedAt ? new Date(device.lastFetchedAt.getTime() - 10 * 60_000) : midnight);
  let result;
  try {
    result = await pullPunches(device, from, now, { fetchImpl: opts.fetchImpl });
  } catch (e: any) {
    result = { ok: false, message: String(e?.message || e).slice(0, 300), lines: [], received: 0 };
  }
  const seen = result.payload ? { lastPayload: result.payload, lastPayloadAt: now } : {};
  if (!result.ok) {
    if (!opts.dryRun) await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { lastError: result.message, ...seen } });
    return { ok: false, message: result.message, received: result.received, added: 0 };
  }
  if (opts.dryRun) return { ok: true, message: result.message, received: result.received, added: 0, readable: result.lines.length };
  const added = result.lines.length || result.aside?.length ? await ingestPunches(device, result.lines.join('\n'), { sources: result.sources, ids: result.ids, aside: result.aside }) : 0;
  await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { lastFetchedAt: now, lastSeenAt: now, lastError: null, ...seen } });
  return { ok: true, message: result.message, received: result.received, added, readable: result.lines.length };
}

/** Every active vendor connection of companies with Attendance on — the timer's job. */
export async function syncAllVendorConnections(opts: { fetchImpl?: typeof fetch } = {}) {
  /* Readers behind an on-site connector are its job (routes/agent.ts), not the cloud's. */
  const devices = await peoplePrisma.attendanceDevice.findMany({ where: { vendor: { in: vendorsWith('pull') }, isActive: true, agentId: null } });
  let added = 0;
  for (const d of devices) {
    if (await appLive(d.accountId, d.orgId, 'attendance')) continue;
    try {
      added += (await syncVendorConnection(d, opts)).added;
    } catch (e: any) {
      await peoplePrisma.attendanceDevice.update({ where: { id: d.id }, data: { lastError: String(e?.message || e).slice(0, 300) } }).catch(() => undefined);
    }
  }
  return { connections: devices.length, added };
}
