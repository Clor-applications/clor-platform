import { decryptSecret } from '../../mailer.js';
import { etoFetchPunches } from '../etimeoffice.js';
import { pullHikvision } from './hikvision.js';
import { pullDahua } from './dahua.js';
import { pullBiostar } from './biostar.js';
import { pullHttp } from './httpPull.js';

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

export type PullResult = {
  ok: boolean;
  message: string;
  /** `pin \t YYYY-MM-DD HH:mm:ss \t state \t verify` — what ingestPunches takes. */
  lines: string[];
  received: number;
  /** The raw answer, trimmed, so a mapping can be set against it (HTTP pull). */
  payload?: string;
};

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

export const parseJson = (s: string | null | undefined) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

const fromEto = async (d: PullDevice, from: Date, to: Date, fetchImpl?: typeof fetch): Promise<PullResult> => {
  const r = await etoFetchPunches({ apiUrl: d.apiUrl, corporateId: d.apiCorporateId, username: d.apiUsername || '', password: decryptSecret(d.apiSecret || '') }, from, to, fetchImpl);
  /* Direction not given: the connection's direction setting decides (state 255). */
  return { ok: r.ok, message: r.message, received: r.punches.length, lines: r.punches.map((p) => `${p.pin}\t${p.localTime}\t255\t0`) };
};

export async function pullPunches(d: PullDevice, from: Date, to: Date, opts: { fetchImpl?: typeof fetch } = {}): Promise<PullResult> {
  const ctx = { baseUrl: (d.apiUrl || '').replace(/\/+$/, ''), username: d.apiUsername || '', password: decryptSecret(d.apiSecret || ''), zone: d.sourceTimezone || 'Asia/Kolkata', config: parseJson(d.configJson) || {}, mapping: parseJson(d.mappingJson), from, to };
  switch (d.vendor) {
    case 'ETIMEOFFICE':
      return fromEto(d, from, to, opts.fetchImpl);
    case 'HIKVISION':
      return pullHikvision(ctx);
    case 'DAHUA':
      return pullDahua(ctx);
    case 'BIOSTAR':
      return pullBiostar(ctx);
    case 'HTTP_PULL':
      return pullHttp(ctx);
    default:
      return { ok: false, message: `${d.vendor} has no pull driver.`, lines: [], received: 0 };
  }
}

export type PullContext = { baseUrl: string; username: string; password: string; zone: string; config: Record<string, any>; mapping: any; from: Date; to: Date };

/** "YYYY-MM-DD HH:mm:ss" of an instant in a zone, for devices that take local times. */
export function localIn(at: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(at)
    .reduce<Record<string, string>>((m, p) => ((m[p.type] = p.value), m), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** The zone's offset as "+05:30" at an instant. */
export function offsetIn(at: Date, zone: string) {
  const local = Date.parse(`${localIn(at, zone).replace(' ', 'T')}Z`);
  const mins = Math.round((local - at.getTime()) / 60_000);
  const sign = mins < 0 ? '-' : '+';
  const a = Math.abs(mins);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

export const VERIFY_WORDS: Record<string, number> = { fingerprint: 1, finger: 1, fp: 1, card: 4, rfid: 4, cardandfp: 4, face: 15, facerecognition: 15, palm: 25, password: 0, pin: 0 };
