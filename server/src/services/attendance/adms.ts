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

/**
 * Add or update a user on a reader; ClorTime's DATA UPDATE USERINFO, which its
 * fleet accepts. Privilege, password and card are copied from the reader the
 * user came from, so a door PIN or card set on one reader works on all.
 */
export const userInfoCommand = (pin: string, name: string, extra: { privilege?: number | null; password?: string | null; card?: string | null } = {}) =>
  `DATA UPDATE USERINFO PIN=${admsField(pin)}\tName=${admsField(name)}\tPri=${admsField(extra.privilege ?? 0)}\tPasswd=${admsField(extra.password ?? '')}\tCard=${admsField(extra.card ?? '')}\tGrp=1\tTZ=1\tVerify=0\tFace=1\tFPCount=1`;

/** Command order on a reader (ClorTime's sequence): user, then delete, then template. */
export const SEQ = { USER: 1, DELETE: 2, TEMPLATE: 3, OTHER: 999 } as const;

export const FACE = 9;
export const FINGER = 1;

/** Bytes in a base64 template (FINGERTMP carries it as Size=). */
export const templateSize = (b64: string) => {
  const clean = String(b64 || '').trim().replace(/[\r\n]/g, '');
  return Math.floor((clean.length * 3) / 4) - (clean.match(/=/g) || []).length;
};

export type Template = {
  pin: string;
  type: number;
  no: number;
  data: string;
  valid: number;
  duress: number;
  majorVer: number;
  minorVer: number;
  format: number;
  indexNo: number;
};

/**
 * The commands that put one template on a reader. Fingerprints go as
 * FINGERTMP (the readers reject them as BIODATA); a face is deleted first and
 * sent as BIODATA with the target reader's own face algorithm version, which a
 * face must match to be recognised there (ClorTime adms.js / device_sync.js).
 * Other BIODATA types are sent back as BIODATA unchanged.
 */
export function templateCommands(t: Template, target: { faceMajorVer?: number | null; faceMinorVer?: number | null } = {}) {
  const data = String(t.data || '').trim().replace(/[\r\n]/g, '');
  const pin = admsField(t.pin);
  if (t.type === FINGER) {
    return [{ seq: SEQ.TEMPLATE, command: `DATA UPDATE FINGERTMP PIN=${pin}\tFID=${admsField(t.no)}\tSize=${templateSize(data)}\tValid=${admsField(t.valid || 1)}\tTMP=${admsField(data)}` }];
  }
  const major = t.type === FACE ? target.faceMajorVer || t.majorVer || 40 : t.majorVer;
  const minor = t.type === FACE ? target.faceMinorVer || t.minorVer || 1 : t.minorVer;
  const biodata = `DATA UPDATE BIODATA Pin=${pin}\tNo=${admsField(t.no)}\tIndex=${admsField(t.indexNo)}\tValid=${admsField(t.valid || 1)}\tDuress=${admsField(t.duress)}\tType=${admsField(t.type)}\tMajorVer=${admsField(major)}\tMinorVer=${admsField(minor)}\tFormat=${admsField(t.format)}\tTmp=${admsField(data)}`;
  return t.type === FACE
    ? [
        { seq: SEQ.DELETE, command: `DATA DELETE FACE PIN=${pin}` },
        { seq: SEQ.TEMPLATE, command: biodata },
      ]
    : [{ seq: SEQ.TEMPLATE, command: biodata }];
}

/** Take someone off a reader: templates first, then the user (ClorTime queueTemplateRemoval). */
export const removalCommands = (pin: string) => [
  `DATA DELETE FINGERTMP PIN=${admsField(pin)}`,
  `DATA DELETE FACE PIN=${admsField(pin)}`,
  `DATA DELETE USERINFO PIN=${admsField(pin)}`,
];

/**
 * Commands a reader accepts. Anything else is rejected with Return=-1004, which
 * looks exactly like a network failure (ClorTime tests/adms_commands.test.js).
 */
export const COMMANDS = {
  FETCH_PUNCHES: 'DATA QUERY ATTLOG',
  FETCH_USERS: 'DATA QUERY USERINFO',
  REBOOT: 'REBOOT',
  /** The reader answers with its counts and limits (users, fingers, faces, punch log). */
  INFO: 'INFO',
} as const;

/**
 * Asking a reader for its templates. USERVF is deliberately absent: ClorTime's
 * readers rejected it every time (44 of 44), and FACE and BIODATA return the
 * same data. BIODATA is where newer firmware keeps them.
 */
export const FETCH_TEMPLATE_COMMANDS = ['DATA QUERY FINGERTMP', 'DATA QUERY FACE', 'DATA QUERY BIODATA'];

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
 * The INFO a reader sends on its heartbeat. The standard ADMS layout:
 *   firmware, users, fingerprints, punches, IP, finger algorithm, face algorithm, faces, …
 *   "ZAM70-NF24HA-Ver3.3.12,1,1,0,192.168.1.201,10,40,12,1,11010,0,0,0"
 *   "Ver 8.0.4.3-20240116,6,6,980,10.81.20.225,10,-1,0,0,100,0,0,0"   (eSSL, fingerprint only)
 * A finger or face algorithm version above 0 means the reader has it; -1 or 0
 * means it does not. (ClorTime read [1] and [2] as face/finger flags; on a real
 * eSSL they are user and fingerprint counts — 6 and 6 — which marked a
 * fingerprint reader as having no fingerprint support.)
 * The IP is accepted only if it looks like one (ClorTime: it was later used in a command).
 */
export function parseInfo(info: string | undefined) {
  const none = { model: null, firmware: null, ip: null, faceSupported: null, fingerSupported: null, faceMajorVer: null, userCount: null, fingerCount: null, punchCount: null, faceCount: null };
  if (!info) return none;
  const parts = String(info).split(',').map((x) => x.trim());
  const head = parts[0] || '';
  const ver = head.match(/(?:^|-)Ver\s*([\d.]+)/i);
  /* LAN address the reader reports for itself; a public one (the office router) is not the reader's. */
  const cut = head.search(/-ver/i);
  const int = (i: number) => {
    if (parts.length <= i || !/^-?\d+$/.test(parts[i])) return null;
    return Number.parseInt(parts[i], 10);
  };
  const count = (i: number) => {
    const n = int(i);
    return n !== null && n >= 0 ? n : null;
  };
  const fingerAlgo = int(5);
  const faceAlgo = int(6);
  return {
    model: cut > 0 ? head.slice(0, cut).slice(0, 80) : null,
    firmware: ver ? ver[1].slice(0, 40) : null,
    ip: parts.length > 4 && /^(\d{1,3}\.){3}\d{1,3}$/.test(parts[4]) ? parts[4] : null,
    faceSupported: faceAlgo === null ? null : faceAlgo > 0,
    fingerSupported: fingerAlgo === null ? null : fingerAlgo > 0,
    faceMajorVer: faceAlgo !== null && faceAlgo >= 30 && faceAlgo <= 100 ? faceAlgo : null,
    userCount: count(1),
    fingerCount: count(2),
    punchCount: count(3),
    faceCount: faceAlgo !== null && faceAlgo > 0 ? count(7) : null,
  };
}

/**
 * A user or template line, as readers send them in BIODATA / FINGERTMP / FACE
 * tables or inside OPERLOG (ClorTime processBiodataLine):
 *   USER PIN=104\tName=Ravi\tPri=0\tPasswd=\tCard=…
 *   FP PIN=104\tFID=6\tSize=1240\tValid=1\tTMP=<base64>
 *   FACE PIN=104\tFID=0\tSIZE=…\tVALID=1\tTMP=<base64>
 *   BIODATA Pin=104\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=40\tMinorVer=1\tFormat=0\tTmp=<base64>
 * Split on tabs only when there are tabs: base64 must stay whole.
 */
export function parseBiodataLine(line: string, table = '') {
  const parts = line.includes('\t') ? line.split('\t') : line.split(/\s+/);
  const fields: Record<string, string> = {};
  for (const part of parts) {
    const kv = part.replace(/^(BIODATA|FACE|FP|USER)\s+/, '');
    const i = kv.indexOf('=');
    if (i > 0) fields[kv.slice(0, i).trim().toUpperCase()] = kv.slice(i + 1).trim();
  }
  const pin = fields.PIN || '';
  if (!pin) return null;
  const data = fields.TEMP || fields.TMP || fields.V || fields.DATA || '';
  const int = (k: string, d = 0) => {
    const n = Number.parseInt(fields[k] ?? '', 10);
    return Number.isNaN(n) ? d : n;
  };

  if (line.startsWith('USER') && !data) {
    return { kind: 'USER' as const, pin, name: fields.NAME || null, privilege: fields.PRI !== undefined ? int('PRI') : null, password: fields.PASSWD ?? null, card: fields.CARD ?? null };
  }

  let type = fields.TYPE !== undefined ? int('TYPE') : NaN;
  if (Number.isNaN(type)) {
    const t = table.toUpperCase();
    if (line.startsWith('FACE') || t === 'FACE' || t === 'FACEV7' || t === 'USERVF') type = FACE;
    else if (line.startsWith('FP') || t === 'FINGERTMP' || t === 'TEMPLATEV10') type = FINGER;
  }
  /* Blank or truncated templates are not templates (ClorTime: AAAAA… and short data skipped). */
  if (Number.isNaN(type) || !data || data.startsWith('AAAAA') || data.length < 100) return null;
  return {
    kind: 'TEMPLATE' as const,
    template: {
      pin,
      type,
      no: fields.NO !== undefined ? int('NO') : fields.FID !== undefined ? int('FID') : fields.FACEID !== undefined ? int('FACEID') : int('INDEX'),
      data: data.replace(/[\r\n]/g, ''),
      valid: int('VALID', 1),
      duress: int('DURESS'),
      majorVer: int('MAJORVER'),
      minorVer: int('MINORVER'),
      format: int('FORMAT'),
      indexNo: int('INDEX'),
    } satisfies Template,
  };
}

/** "ID=12&Return=0&CMD=DATA" — one per line when a reader reports several at once. */
export function parseCommandResults(body: string) {
  /*
   * One result per "ID=…&Return=…&CMD=…" line. INFO's answer follows its
   * result line as key=value lines ("~DeviceName=…", "UserCount=…"), which
   * belong to that result.
   */
  const out: Array<{ id: number; returnCode: number; cmd: string | null; info: Record<string, string> }> = [];
  for (const raw of String(body || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/(^|&)ID=/.test(line) && /(^|&)Return=/.test(line)) {
      const p = new URLSearchParams(line);
      const id = Number.parseInt(p.get('ID') || '', 10);
      const returnCode = Number.parseInt(p.get('Return') || '', 10);
      if (!Number.isInteger(id) || !Number.isInteger(returnCode)) continue;
      const info: Record<string, string> = {};
      for (const [k, v] of p) if (!['ID', 'Return', 'CMD'].includes(k)) info[k.replace(/^~/, '')] = v;
      out.push({ id, returnCode, cmd: p.get('CMD'), info });
      continue;
    }
    const last = out[out.length - 1];
    const i = line.indexOf('=');
    if (last && i > 0) last.info[line.slice(0, i).replace(/^~/, '').trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** "Ver 8.0.4.3-20240116", "6.60", "ZAM70-NF24HA-Ver3.3.12" → "8.0.4.3", "6.60", "3.3.12". */
export const normaliseFirmware = (s: unknown) => {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const m = t.match(/Ver\s*([\d.]+)/i) || t.match(/^v?([\d][\d.]*)/i);
  return (m ? m[1] : t).slice(0, 40);
};

/**
 * Readers state some limits in units, not items: users and fingerprints in
 * hundreds, the punch log in ten-thousands (a real eSSL: MaxUserCount=50,
 * MaxFingerCount=30, MaxAttLogCount=3 — 5,000 / 3,000 / 30,000). No real
 * reader holds fewer than 1,000 of these, so a smaller number is in units.
 */
export const scaleLimit = (kind: 'users' | 'fingers' | 'punches' | 'faces', n: number | null) => {
  if (n === null || n <= 0) return n;
  if (kind === 'faces' || n >= 1000) return n;
  return kind === 'punches' ? n * 10_000 : n * 100;
};

/** The counts and limits in a reader's answer to INFO; anything it leaves out stays unknown. */
export function parseReaderInfo(info: Record<string, string>) {
  const n = (...keys: string[]) => {
    for (const k of keys) {
      const v = Number.parseInt(info[k] ?? '', 10);
      if (Number.isInteger(v) && v >= 0) return v;
    }
    return null;
  };
  return {
    userCount: n('UserCount'),
    fingerCount: n('FPCount', 'FingerCount'),
    faceCount: n('FaceCount'),
    punchCount: n('TransactionCount', 'AttLogCount'),
    maxUsers: scaleLimit('users', n('MaxUserCount')),
    maxFingers: scaleLimit('fingers', n('MaxFingerCount', 'MaxFPCount')),
    maxFaces: scaleLimit('faces', n('MaxFaceCount')),
    maxPunches: scaleLimit('punches', n('MaxAttLogCount', 'MaxTransactionCount')),
    mac: info.MAC ? String(info.MAC).slice(0, 40) : null,
    firmware: info.FWVersion ? normaliseFirmware(info.FWVersion) : null,
  };
}

/**
 * Why a reader refused a command, in words. Only -1004 is known for certain
 * (ClorTime: the reader does not recognise the command — the 12 user
 * deletions it rejected in production for naming USER, not USERINFO); anything else is reported with its code.
 */
export const refusalReason = (code: number) =>
  code === -1004 ? 'The reader does not accept this command (-1004).' : `The reader refused it (code ${code}).`;

/**
 * What a confirmed command changed on the reader, for knowing who is on which
 * reader: a user added or removed, a finger or face added or removed.
 */
export function commandEffect(command: string): { pin: string; what: 'user' | 'finger' | 'face' | 'removeUser' | 'removeFingers' | 'removeFace'; no?: number } | null {
  const m = /^DATA (UPDATE|DELETE) (USERINFO|FINGERTMP|FACE|BIODATA) (?:PIN|Pin)=([^\t]*)/.exec(String(command || ''));
  if (!m) return null;
  const [, verb, table, pin] = m;
  const field = (k: string) => new RegExp(`\\t${k}=([^\\t]*)`).exec(command)?.[1];
  if (verb === 'DELETE') return { pin, what: table === 'USERINFO' ? 'removeUser' : table === 'FINGERTMP' ? 'removeFingers' : 'removeFace' };
  if (table === 'USERINFO') return { pin, what: 'user' };
  if (table === 'FINGERTMP') return { pin, what: 'finger', no: Number.parseInt(field('FID') || '0', 10) || 0 };
  if (table === 'BIODATA' && field('Type') === String(FACE)) return { pin, what: 'face' };
  if (table === 'BIODATA' && field('Type') === String(FINGER)) return { pin, what: 'finger', no: Number.parseInt(field('No') || '0', 10) || 0 };
  return null;
}

/** "0,6" + 3 → "0,3,6". */
export const addFinger = (list: string, no: number) =>
  [...new Set([...String(list || '').split(',').filter(Boolean).map(Number), no])].sort((a, b) => a - b).join(',');

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

/**
 * An operation or error record: "OPLOG 4 0 2026-10-14 09:00:00 0 0 0 0" —
 * tag, type/code, who, date, time, values (ClorTime handleAttendanceLogs).
 */
export function parseOpLine(line: string) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const localTime = `${parts[3]} ${parts[4]}`;
  if (!LOCAL_TIME.test(localTime)) return null;
  return { code: parts[1].slice(0, 20), operator: parts[2] && parts[2] !== '0' ? parts[2].slice(0, 40) : null, localTime, details: parts.slice(5).join(' ').slice(0, 300) || null };
}

/** How a punch was verified, as ZKTeco / eSSL readers number it. */
export const VERIFY_MODES: Record<number, string> = { 0: 'Password', 1: 'Fingerprint', 2: 'Card', 3: 'Password', 4: 'Card', 15: 'Face', 25: 'Palm', 100: 'Phone' };
