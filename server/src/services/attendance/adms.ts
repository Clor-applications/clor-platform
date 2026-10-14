/**
 * The ZKTeco / eSSL push protocol ("ADMS", the /iclock endpoints), as the
 * on-premise ClorTime server speaks it in production — ported from
 * ClorTime server/services/adms.js, punch_ingest.js,
 * integrations/punch_format.js and utils/admsCommand.js. The rules here are
 * the ones that survived real readers there; the comments say where each one
 * came from.
 *
 *   GET  /iclock/cdata?SN=…            handshake: the reader asks for its options
 *   POST /iclock/cdata?SN=…&table=…    data: ATTLOG punches, OPERLOG/USERINFO users
 *   GET  /iclock/getrequest?SN=…       heartbeat: "OK" or one "C:<id>:<command>"
 *   POST /iclock/devicecmd?SN=…        the result of a command
 *
 * Pure functions only; the routes in routes/iclock.ts do the I/O.
 */

/**
 * Options returned to the handshake. Exactly ClorTime's: Stamp=0 asks the
 * reader for every log it holds (duplicates are dropped on insert), Delay=30 is
 * the heartbeat, Realtime=1 sends each punch as it happens.
 */
export const HANDSHAKE_OPTIONS = [
  'GET OPTION FROM:attlog',
  'Stamp=0',
  'OpStamp=0',
  'ErrorDelay=60',
  'Delay=30',
  'TransTimes=00:00;14:05',
  'TransInterval=1',
  'TransFlag=1111000000',
  'Realtime=1',
  'Encrypt=0',
].join('\n');

/** A reader that has not been heard from for this long is shown offline (heartbeat is 30 s). */
export const ONLINE_WINDOW_MS = 3 * 60_000;

/**
 * A value safe to place in a reader command: no tabs, newlines or controls.
 * A tab inside a name — "Ravi\tPri=14" — would otherwise make that person an
 * administrator on every reader the command reaches (ClorTime admsCommand.js).
 */
export const admsField = (value: unknown) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

/** Add a user to a reader; ClorTime's DATA UPDATE USERINFO, which its fleet accepts. */
export const userInfoCommand = (pin: string, name: string) =>
  `DATA UPDATE USERINFO PIN=${admsField(pin)}\tName=${admsField(name)}\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=1\tVerify=0\tFace=1\tFPCount=1`;

/**
 * Commands a reader accepts. Anything else is rejected with Return=-1004, which
 * looks exactly like a network failure (ClorTime tests/adms_commands.test.js).
 */
export const COMMANDS = {
  FETCH_PUNCHES: 'DATA QUERY ATTLOG',
  FETCH_USERS: 'DATA QUERY USERINFO',
  REBOOT: 'REBOOT',
} as const;

export type ParsedPunch = { pin: string; localTime: string; state: string; verifyMode: number };

const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * One ATTLOG line: PIN \t YYYY-MM-DD HH:mm:ss \t state \t verify \t workcode …
 * Some firmware separates with spaces instead of tabs; ClorTime's fallbacks.
 */
export function parseAttlogLine(line: string): ParsedPunch | null {
  let parts = line.split('\t');
  if (parts.length < 2) {
    const m = line.match(/^(\S+)\s+([\d-]+\s[\d:]+)\s+(\d+)\s+(\d+)/);
    if (m) parts = [m[1], m[2], m[3], m[4]];
    else {
      const sp = line.trim().split(/\s+/);
      if (sp.length >= 3) parts = [sp[0], `${sp[1]} ${sp[2]}`, sp[3] ?? '0', sp[4] ?? '0'];
    }
  }
  if (parts.length < 2) return null;
  const pin = String(parts[0] || '').trim();
  const localTime = String(parts[1] || '').trim();
  if (!pin || !LOCAL_TIME.test(localTime)) return null;
  return { pin, localTime, state: String(parts[2] ?? '0').trim() || '0', verifyMode: Number.parseInt(String(parts[3] ?? '0'), 10) || 0 };
}

/** The reader's wall clock is Indian Standard Time. */
export const instantOf = (localTime: string) => {
  const m = LOCAL_TIME.exec(localTime);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const EXPLICIT_OUT = [1, 2, 5, 9]; // check-out, break-out, OT-out
const EXPLICIT_IN = [3, 4, 8]; // break-in, OT-in

/**
 * Entry or exit. A reader set to "in" or "out" decides, whatever key was
 * pressed; otherwise the punch state does; state 0 / 255 on a reader with no
 * direction says nothing (null). From ClorTime punch_format.js: eSSL readers
 * that are not configured for a direction report 0 or 255 for everything.
 */
export function punchKind(state: string, direction: string): 'IN' | 'OUT' | null {
  if (direction === 'in') return 'IN';
  if (direction === 'out') return 'OUT';
  const n = Number.parseInt(state, 10);
  if (EXPLICIT_OUT.includes(n)) return 'OUT';
  if (EXPLICIT_IN.includes(n)) return 'IN';
  return null;
}

/**
 * The shift day a punch belongs to. For a night shift the boundary moves to
 * noon: a punch before 12:00 is the previous day's shift. Noon because no
 * night shift starts before it and none ends after it (ClorTime
 * attendance_engine.js).
 */
export function shiftDayOf(localTime: string, isNightShift: boolean) {
  const date = localTime.slice(0, 10);
  const hour = Number(localTime.slice(11, 13));
  if (!isNightShift || hour >= 12) return date;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * First punch in, last real exit out (ClorTime attendance_engine.js). Taking
 * simply the last punch made a forgotten badge-out invisible: in 10:30, out
 * 13:49, back 14:45, never out again read as a 10:30–14:45 day. With no
 * direction at all, the last punch is the best there is.
 */
export function pairDay(points: Array<{ at: Date; kind: 'IN' | 'OUT' | null }>) {
  if (!points.length) return null;
  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const hasDirection = sorted.some((p) => p.kind !== null);
  const checkIn = sorted[0].at;
  const last = sorted[sorted.length - 1];
  const lastExit = hasDirection ? [...sorted].reverse().find((p) => p.kind === 'OUT') : sorted.length > 1 ? last : null;
  const checkOut = lastExit && lastExit.at.getTime() > checkIn.getTime() ? lastExit.at : null;
  return { checkIn, checkOut, endsOnEntry: hasDirection && last.kind !== 'OUT' };
}

/** Pins compared without leading zeros: readers store "50" for employee "050". */
export const pinKey = (pin: string) => {
  const p = String(pin || '').trim();
  return /^\d+$/.test(p) ? String(Number.parseInt(p, 10)) : p.toUpperCase();
};

/**
 * The INFO a reader sends on its heartbeat:
 * "ZAM70-NF24HA-Ver3.3.12,1,1,0,192.168.1.201,10,40,12,1,11010,0,0,0".
 * The IP is accepted only if it looks like one (ClorTime: it was later used in a command).
 */
export function parseInfo(info: string | undefined) {
  if (!info) return { model: null, firmware: null, ip: null };
  const parts = String(info).split(',');
  const head = parts[0] || '';
  const ver = head.match(/-[Vv]er([\d.]+)/);
  const cut = head.search(/-ver/i);
  return {
    model: cut > 0 ? head.slice(0, cut).slice(0, 80) : null,
    firmware: ver ? ver[1].slice(0, 40) : null,
    ip: parts.length > 4 && /^(\d{1,3}\.){3}\d{1,3}$/.test(parts[4]) ? parts[4] : null,
  };
}

/** "ID=12&Return=0&CMD=DATA" — one per line when a reader reports several at once. */
export function parseCommandResults(body: string) {
  return String(body || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => new URLSearchParams(l))
    .map((p) => ({ id: Number.parseInt(p.get('ID') || '', 10), returnCode: Number.parseInt(p.get('Return') || '', 10) }))
    .filter((r) => Number.isInteger(r.id) && Number.isInteger(r.returnCode));
}

/** "USER PIN=104\tName=Ravi Kumar\tPri=0\t…" from a user query. */
export function parseUserLine(line: string) {
  const body = line.replace(/^USER\s+/, '');
  const fields: Record<string, string> = {};
  for (const part of body.split('\t')) {
    const i = part.indexOf('=');
    if (i > 0) fields[part.slice(0, i).trim().toUpperCase()] = part.slice(i + 1).trim();
  }
  const pin = fields.PIN || '';
  return pin ? { pin, name: fields.NAME || null } : null;
}
