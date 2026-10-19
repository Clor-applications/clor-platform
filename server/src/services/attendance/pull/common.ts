/**
 * What every pull driver shares, with no database or secrets behind it — so
 * the on-site connector (server/agent) can bundle the drivers and run them
 * on a customer's LAN exactly as the cloud runs them.
 */
export type PullResult = {
  ok: boolean;
  message: string;
  /** `pin \t YYYY-MM-DD HH:mm:ss \t state \t verify` — what ingestPunches takes. */
  lines: string[];
  received: number;
  /** The raw answer, trimmed, so a mapping can be set against it (HTTP pull). */
  payload?: string;
  /** The vendor's own record behind each line (same order as `lines`), kept as the original (ReaderEvent). */
  sources?: string[];
  /** The vendor's id for each line's event, where it has one. */
  ids?: Array<string | null>;
  /** Records read but not punches — a door event, a refused attempt — with why. */
  aside?: Array<{ original: string; reason: string; id?: string | null }>;
};

/** A vendor record as stored: compact JSON, capped. */
export const originalOf = (r: unknown) => {
  try {
    return JSON.stringify(r).slice(0, 8_000);
  } catch {
    return String(r).slice(0, 8_000);
  }
};

export type PullContext = { baseUrl: string; username: string; password: string; zone: string; config: Record<string, any>; mapping: any; from: Date; to: Date; fetchImpl?: typeof fetch };

export const parseJson = (s: string | null | undefined) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

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
