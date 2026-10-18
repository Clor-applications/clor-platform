import { Router, type Request, type Response } from 'express';

import { peoplePrisma } from '../utils/peoplePrisma.js';
import { ingestLimiter } from '../middleware/rateLimit.js';
import { fromZone, istLocal } from '../services/attendance/punchMapping.js';
import { hashToken } from './publicApi.js';
import { ingestPunches, markOnReader } from './iclock.js';
import { commandEffect } from '../services/attendance/adms.js';

/**
 * /matrix/<token> — Matrix COSEC door controllers (Door V3, PVR, Vega, FMX,
 * ARC DC 200, ARGO) speaking their "PUSH API". The controller is the client:
 * it logs in, polls every few seconds, fetches a command when the poll says
 * one is waiting, reports each event the moment it happens, and takes its
 * configuration (CLOR sends only the date and time) when the poll says so.
 * Everything is a GET with the arguments in the query string, and every
 * answer is plain text `key=value key=value` (format 0).
 *
 * The URL token names the reader and is the only credential, like /ingest.
 * The controller's own serial number rides on every request and is kept for
 * the screen. Punches end in ingestPunches like every other driver.
 *
 * From the Matrix COSEC Devices PUSH API User Guide. Not yet tried on a
 * controller: the driver is marked as such on the Readers screen.
 */
export const matrixRouter = Router();

const DEVICE_TYPES: Record<string, string> = { '0': 'COSEC Door V3', '1': 'COSEC PVR', '2': 'COSEC Vega', '3': 'COSEC FMX', '5': 'COSEC ARC DC 200', '7': 'COSEC ARGO' };

/** Event IDs from the guide's appendix; 101 / 105 are the punches. */
const EVENTS: Record<string, string> = {
  '101': 'User allowed',
  '105': 'User allowed – door not opened',
  '151': 'User denied – invalid user',
  '154': 'User denied – timed out',
  '157': 'User denied – disabled user',
  '158': 'User denied – blocked user',
  '162': 'User denied – door locked',
  '164': 'User denied – validity expired',
  '172': 'User denied – finger sensor busy',
  '201': 'Door status changed',
  '204': 'Aux input changed',
  '205': 'Aux output changed',
  '206': 'Door sense input',
  '207': 'Door controller link',
  '208': 'Door opened / closed',
  '209': 'Lock opened / closed',
  '405': 'Enrolment at the controller',
  '406': 'Master alarm input',
  '407': 'Master aux output',
  '409': 'Credentials deleted',
  '451': 'Configuration changed',
  '452': 'Event log rolled over',
  '453': 'Controller powered on',
  '454': 'Configuration defaulted',
  '455': 'Soft override',
  '456': 'Backup and update',
  '457': 'System defaulted',
};

/** Commands CLOR issues, as the controller names them. */
export const MATRIX_COMMANDS = { REBOOT: 'cmd-id=18', INFO: 'cmd-id=22' } as const;
export const MATRIX_COMMAND_LABELS: Record<string, string> = { 'cmd-id=18': 'Restart', 'cmd-id=22': 'Report user count' };

/** The clock is set when it is this far out, and not again for ten minutes. */
export const CLOCK_FIX_SEC = 60;
const CLOCK_FIX_GAP_MS = 10 * 60_000;

type MatrixState = {
  serialNo?: string;
  deviceType?: string;
  lastSeq?: number;
  lastEventAt?: string;
  /** When the time was last sent; also set by "Set the time" on the screen (forceClock). */
  clockSentAt?: string;
  forceClock?: boolean;
};

const reply = (res: Response, kv: Record<string, string | number>, status = 200) =>
  res
    .status(status)
    .type('text/plain')
    .send(
      Object.entries(kv)
        .map(([k, v]) => `${k}=${v}`)
        .join(' '),
    );

const q = (req: Request, name: string) => {
  const v = req.query[name] ?? (req.body && typeof req.body === 'object' ? (req.body as any)[name] : undefined);
  return v === undefined || v === null ? '' : String(Array.isArray(v) ? v[0] : v).trim();
};

const stateOf = (d: { configJson: string | null }): MatrixState => {
  try {
    return d.configJson ? JSON.parse(d.configJson) : {};
  } catch {
    return {};
  }
};

/** Wall-clock parts of an instant in a zone, for config-id 1. */
export function clockParts(at: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  return { year: get('year'), month: get('month'), date: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Whether the controller should be sent the time on its next poll. */
export function clockFixDue(d: { clockOffsetSec: number | null; clockCheckedAt: Date | null }, st: MatrixState, now: Date) {
  if (st.forceClock) return true;
  if (d.clockOffsetSec === null || Math.abs(d.clockOffsetSec) < CLOCK_FIX_SEC) return false;
  if (st.clockSentAt && now.getTime() - new Date(st.clockSentAt).getTime() < CLOCK_FIX_GAP_MS) return false;
  return true;
}

/**
 * field-3 of a user event: bit 0 is 1 for exit, bits 4–9 say what was
 * presented (PIN, card, finger, palm, group, API). Mapped to the verify
 * modes punches are stored with (ADMS numbering: 0 password, 1 finger, 2 card,
 * 15 face, 25 palm).
 */
export function readField3(raw: string) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return { exit: false, verifyMode: 0 };
  const exit = (n & 1) === 1;
  const verifyMode = n & (1 << 6) ? 1 : n & (1 << 5) ? 2 : n & (1 << 7) ? 25 : n & (1 << 4) ? 0 : n & (1 << 10) ? 15 : 0;
  return { exit, verifyMode };
}

type Device = NonNullable<Awaited<ReturnType<typeof peoplePrisma.attendanceDevice.findUnique>>>;

async function deviceOf(req: Request, res: Response): Promise<Device | null> {
  const token = String(req.params.token || '');
  if (!/^clorp_[A-Za-z0-9_-]{20,}$/.test(token)) {
    reply(res, { status: 0 }, 404);
    return null;
  }
  const device = await peoplePrisma.attendanceDevice.findUnique({ where: { pushTokenHash: hashToken(token) } });
  if (!device || device.vendor !== 'MATRIX_COSEC') {
    reply(res, { status: 0 }, 404);
    return null;
  }
  if (!device.isActive) {
    reply(res, { status: 0 }, 403);
    return null;
  }
  return device;
}

/** Every request says who it is from; the first one names the model. */
async function seen(req: Request, device: Device, extra: Record<string, unknown> = {}, patch: Partial<MatrixState> = {}) {
  const st = stateOf(device);
  const serialNo = q(req, 'serial-no');
  const deviceType = q(req, 'device-type');
  const next: MatrixState = { ...st, ...patch, ...(serialNo ? { serialNo } : {}), ...(deviceType ? { deviceType } : {}) };
  const model = DEVICE_TYPES[deviceType] ? `${DEVICE_TYPES[deviceType]}${serialNo ? ` ${serialNo}` : ''}` : device.model;
  await peoplePrisma.attendanceDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date(), configJson: JSON.stringify(next), ...(model && model !== device.model ? { model } : {}), ...extra },
  });
  return next;
}

/* Commands (cmd-id=…) go through /getcmd; user records and the like (config-id=…) through /getconfig. */
const pendingCount = (device: Device) => peoplePrisma.deviceCommand.count({ where: { deviceId: device.id, status: 'PENDING', command: { startsWith: 'cmd-id=' } } });
const pendingConfigs = (device: Device) => peoplePrisma.deviceCommand.count({ where: { deviceId: device.id, status: 'PENDING', command: { startsWith: 'config-id=' } } });

const handle = (path: string, fn: (req: Request, res: Response, device: Device) => Promise<unknown>) =>
  matrixRouter.all(`/:token${path}`, ...ingestLimiter, async (req, res) => {
    try {
      const device = await deviceOf(req, res);
      if (!device) return;
      await fn(req, res, device);
    } catch (e) {
      console.error(`[matrix] ${path}:`, e instanceof Error ? e.message : e);
      if (!res.headersSent) reply(res, { status: 0 }, 500);
    }
  });

/* 1. Login: the polling schedule. Ten seconds between polls keeps a command under a quarter of a minute away. */
handle('/login', async (req, res, device) => {
  await seen(req, device, { lastError: null });
  reply(res, { 'poll-interval': 10, 'poll-duration': 5, 'poll-count': 3, status: 1, format: 0 });
});

/* 2. Poll: is a command or the time waiting? */
handle('/poll', async (req, res, device) => {
  const st = await seen(req, device);
  const [pending, configs] = await Promise.all([pendingCount(device), pendingConfigs(device)]);
  reply(res, { 'cmd-avlbl': pending ? 1 : 0, 'cnfg-avlbl': clockFixDue(device, st, new Date()) || configs ? 1 : 0, status: 1 });
});

/* 3. Get command: the oldest waiting one, marked sent. */
handle('/getcmd', async (req, res, device) => {
  await seen(req, device);
  const next = await peoplePrisma.deviceCommand.findFirst({ where: { deviceId: device.id, status: 'PENDING', command: { startsWith: 'cmd-id=' } }, orderBy: [{ sequence: 'asc' }, { id: 'asc' }] });
  if (!next) return reply(res, { status: 0 });
  await peoplePrisma.deviceCommand.update({ where: { id: next.id }, data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } } });
  res.type('text/plain').send(next.command);
});

/* 4. Update command: the controller says how it went; counts ride along for cmd 22. */
handle('/updatecmd', async (req, res, device) => {
  await seen(req, device);
  const cmdId = q(req, 'cmd-id').replace(/\s/g, '');
  const ok = q(req, 'status') === '1';
  const cmd = cmdId
    ? await peoplePrisma.deviceCommand.findFirst({ where: { deviceId: device.id, status: 'SENT', command: { startsWith: `cmd-id=${cmdId}` } }, orderBy: { id: 'asc' } })
    : null;
  if (cmd) {
    await peoplePrisma.deviceCommand.update({
      where: { id: cmd.id },
      data: { status: ok ? 'DONE' : 'FAILED', returnCode: ok ? 0 : -1, doneAt: new Date(), lastError: ok ? null : 'The controller reported failure.' },
    });
    /* A user taken off: no longer held. */
    const eff = commandEffect(cmd.command);
    if (ok && eff?.what === 'removeUser') await markOnReader(device, eff.pin, { remove: true });
    if (ok && cmdId === '22') {
      const users = Number.parseInt(q(req, 'user-count') || q(req, 'usercount'), 10);
      await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { ...(Number.isFinite(users) ? { userCount: users } : {}), infoAt: new Date() } });
      await peoplePrisma.deviceLog.create({
        data: { accountId: device.accountId, orgId: device.orgId, deviceId: device.id, kind: 'OPERATION', code: 'INFO', localTime: istLocal(new Date()), details: Number.isFinite(users) ? `users=${users}` : null },
      });
    }
  }
  reply(res, { 'cmd-avlbl': (await pendingCount(device)) ? 1 : 0, status: 1 });
});

/* 5. Get configuration: only the date and time, in the zone the controller is set to. */
handle('/getconfig', async (req, res, device) => {
  const st = await seen(req, device);
  const now = new Date();
  if (clockFixDue(device, st, now)) {
    await seen(req, device, {}, { clockSentAt: now.toISOString(), forceClock: false });
    return reply(res, { 'config-id': 1, ...clockParts(now, device.sourceTimezone || 'Asia/Kolkata') });
  }
  /* Then whatever configuration is queued: user records, oldest first. */
  const next = await peoplePrisma.deviceCommand.findFirst({ where: { deviceId: device.id, status: 'PENDING', command: { startsWith: 'config-id=' } }, orderBy: [{ sequence: 'asc' }, { id: 'asc' }] });
  if (!next) return reply(res, { status: 0 });
  await peoplePrisma.deviceCommand.update({ where: { id: next.id }, data: { status: 'SENT', sentAt: now, attempts: { increment: 1 } } });
  res.type('text/plain').send(next.command);
});

/* 6. Update configuration: the controller stored it (or not). */
handle('/updateconfig', async (req, res, device) => {
  const st = await seen(req, device);
  const ok = q(req, 'status') === '1';
  if (q(req, 'config-id') === '1') {
    await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: ok ? { clockOffsetSec: 0, clockCheckedAt: new Date() } : { lastError: 'The controller refused the time CLOR sent.' } });
    await peoplePrisma.deviceLog.create({
      data: { accountId: device.accountId, orgId: device.orgId, deviceId: device.id, kind: ok ? 'OPERATION' : 'ERROR', code: 'CLOCK_SET', localTime: istLocal(new Date()), details: ok ? 'Date and time set from CLOR.' : 'The controller refused the time.' },
    });
  }
  const configId = q(req, 'config-id');
  if (configId && configId !== '1') {
    const cmd = await peoplePrisma.deviceCommand.findFirst({ where: { deviceId: device.id, status: 'SENT', command: { startsWith: `config-id=${configId} ` } }, orderBy: { id: 'asc' } });
    if (cmd) {
      await peoplePrisma.deviceCommand.update({ where: { id: cmd.id }, data: { status: ok ? 'DONE' : 'FAILED', returnCode: ok ? 0 : -1, doneAt: new Date(), lastError: ok ? null : 'The controller refused the record.' } });
      const eff = commandEffect(cmd.command);
      if (ok && eff?.what === 'user') await markOnReader(device, eff.pin, { user: true, name: / name=(.*?)(?: user-active=| card1=|$)/.exec(cmd.command)?.[1] || null });
    }
  }
  reply(res, { 'cnfg-avlbl': clockFixDue({ ...device, clockOffsetSec: ok ? 0 : device.clockOffsetSec }, { ...st, forceClock: false }, new Date()) || (await pendingConfigs(device)) ? 1 : 0, status: 1 });
});

/* 7. Set event: a punch (101 / 105), or something else for the reader log. */
handle('/setevent', async (req, res, device) => {
  const evt = q(req, 'evt_id') || q(req, 'evt-id');
  const seq = Number.parseInt(q(req, 'seq-no'), 10);
  const dd = Number(q(req, 'date-dd'));
  const mm = Number(q(req, 'date-mm'));
  const yyyy = Number(q(req, 'date-yyyy'));
  const hh = Number(q(req, 'time-hh'));
  const mi = Number(q(req, 'time-mm'));
  const ss = Number(q(req, 'time-ss'));
  const timed = [dd, mm, yyyy, hh, mi, ss].every(Number.isFinite) && yyyy >= 2000 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
  if (!evt || !timed) {
    await seen(req, device, { lastError: 'An event arrived without its ID or time.' });
    return reply(res, { status: 0 });
  }
  const zone = device.sourceTimezone || 'Asia/Kolkata';
  const at = fromZone(yyyy, mm, dd, hh, mi, ss, zone);
  const now = new Date();
  const st = stateOf(device);
  const patch: Partial<MatrixState> = { lastEventAt: now.toISOString(), ...(Number.isFinite(seq) ? { lastSeq: seq } : {}) };

  if (evt === '101' || evt === '105') {
    const pin = q(req, 'field-1');
    if (!pin) {
      await seen(req, device, { lastError: 'A punch arrived without a user ID (field-1).' }, patch);
      return reply(res, { status: 1 });
    }
    const { exit, verifyMode } = readField3(q(req, 'field-3'));
    const line = `${pin}\t${istLocal(at)}\t${exit ? 1 : 0}\t${verifyMode}`;
    const added = await ingestPunches(device, line);
    /*
     * Clock drift: an event reported on its own (not the burst a controller
     * sends when it catches up) by a controller that polled a moment ago was
     * made just now, so its time minus the time now is the clock error.
     */
    const live = device.lastSeenAt && now.getTime() - device.lastSeenAt.getTime() < 2 * 60_000 && (!st.lastEventAt || now.getTime() - new Date(st.lastEventAt).getTime() > 5_000);
    const offset = live && added ? Math.max(-2_000_000_000, Math.min(2_000_000_000, Math.round((at.getTime() - now.getTime()) / 1000))) : null;
    await seen(req, device, { lastError: null, ...(offset !== null ? { clockOffsetSec: offset, clockCheckedAt: now } : {}) }, patch);
    return reply(res, { status: 1 });
  }

  const denied = /^1[5-9]\d$/.test(evt);
  const user = q(req, 'field-1');
  await peoplePrisma.deviceLog.create({
    data: {
      accountId: device.accountId,
      orgId: device.orgId,
      deviceId: device.id,
      kind: denied ? 'ERROR' : 'OPERATION',
      code: `EVT-${evt}`,
      operator: denied || evt === '405' || evt === '409' ? user || null : null,
      localTime: istLocal(at),
      details: [EVENTS[evt] || `Event ${evt}`, user && !denied ? `user ${user}` : null, ...['field-2', 'field-3', 'field-4', 'field-5'].map((f) => (q(req, f) ? `${f}=${q(req, f)}` : null))].filter(Boolean).join(' · ').slice(0, 2000),
    },
  });
  await seen(req, device, {}, patch);
  reply(res, { status: 1 });
});

matrixRouter.use((_req, res) => reply(res, { status: 0 }, 404));
