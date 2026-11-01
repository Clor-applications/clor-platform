import { decryptSecret } from '../../mailer.js';
import { etoFetchPunches } from '../etimeoffice.js';
import { pullByVendor } from './drivers.js';
import { parseJson, type PullResult } from './common.js';

export { parseJson, VERIFY_WORDS, type PullContext, type PullResult } from './common.js';

/**
 * Pulling punches from a device or a vendor server on a schedule. One entry
 * per driver with the `pull` capability (services/attendance/drivers.ts);
 * each returns the same ADMS-style lines ingestPunches takes, so the rest of
 * attendance never knows which brand they came from.
 *
 * Cloud CLOR reaches a device only where the customer has made it reachable
 * (a public address or a forwarded port); readers that live on the office LAN
 * alone are the on-site connector's job (phase 5). Addresses are checked like
 * webhook URLs: never private or metadata networks.
 */

export type PullDevice = {
  id: string;
  vendor: string;
  apiUrl: string | null;
  apiCorporateId: string | null;
  apiUsername: string | null;
  apiSecret: string | null;
  sourceTimezone: string;
  configJson: string | null;
  mappingJson: string | null;
};

const fromEto = async (d: PullDevice, from: Date, to: Date, fetchImpl?: typeof fetch): Promise<PullResult> => {
  const r = await etoFetchPunches({ apiUrl: d.apiUrl, corporateId: d.apiCorporateId, username: d.apiUsername || '', password: decryptSecret(d.apiSecret || '') }, from, to, fetchImpl);
  /* Direction not given: the connection's direction setting decides (state 255). */
  return { ok: r.ok, message: r.message, received: r.punches.length, lines: r.punches.map((p) => `${p.pin}\t${p.localTime}\t255\t0`) };
};

export async function pullPunches(d: PullDevice, from: Date, to: Date, opts: { fetchImpl?: typeof fetch } = {}): Promise<PullResult> {
  const ctx = { baseUrl: (d.apiUrl || '').replace(/\/+$/, ''), username: d.apiUsername || '', password: decryptSecret(d.apiSecret || ''), zone: d.sourceTimezone || 'Asia/Kolkata', config: parseJson(d.configJson) || {}, mapping: parseJson(d.mappingJson), from, to, fetchImpl: opts.fetchImpl };
  if (d.vendor === 'ETIMEOFFICE') return fromEto(d, from, to, opts.fetchImpl);
  return pullByVendor(d.vendor, ctx);
}
