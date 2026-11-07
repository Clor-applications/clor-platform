import { appLive, closing } from '../services/principalAllowed.js';
import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { COMMANDS, FACE, FETCH_TEMPLATE_COMMANDS, HANDSHAKE_OPTIONS, commandEffect, instantOf, parseAttlogLine, parseBiodataLine, parseCommandResults, parseInfo, parseOpLine, parseReaderInfo, refusalReason } from '../services/attendance/adms.js';
import { readerLimiter } from '../middleware/rateLimit.js';
import { MAX_NETWORKS, networkOf, sameBlock } from '../services/attendance/network.js';
import { biometricPolicy } from '../services/attendance/biometrics.js';
import { enterTenant, outsideTenant } from '../utils/tenantScope.js';
import { DECIDED, ingestPunches, pinMatcher } from '../services/attendance/punches.js';
import { markOnReader, storeTemplate, storeUser } from '../services/attendance/readerSync.js';

/**
 * /iclock — where biometric readers push punches (ZKTeco / eSSL "ADMS").
 *
 * The reader connects out to api.clor.in, so nothing is opened at the
 * customer's office. It identifies itself only by serial number; there is no
 * password in the protocol. A serial therefore counts only once a company has
 * added it under Attendance → Readers, and a serial belongs to one company.
 * Anything else is acknowledged (so the reader does not retry the same batch
 * forever) and dropped — punches stay on the reader, and the first heartbeat
 * after the reader is added asks for its whole log again.
 *
 * The protocol handling follows the on-premise ClorTime server, which runs it in
 * production (server/services/adms.js there).
 */
export const iclockRouter = Router();
/* The limiter first, then the body: a flood is turned away before anything is read (#10). Body parsing is below (iclockBody). */
iclockRouter.use(readerLimiter, ((req, res, next) => iclockBody(req, res, next)) as RequestHandler);

const SERIAL = /^[A-Za-z0-9_-]{4,40}$/;
const text = (res: Response, body: string, status = 200) => res.status(status).type('text/plain').send(body);
const serialOf = (req: Request) => {
  const sn = String(req.query.SN || '').trim();
  return SERIAL.test(sn) ? sn : null;
};


async function deviceFor(serial: string) {
  /* A-35: a reader is known only by its serial, which is how its company is found. */
  const device = await outsideTenant('adms: which company this reader serial belongs to', () => peoplePrisma.attendanceDevice.findUnique({ where: { serialNumber: serial } }));
  /* Only push readers talk here; a vendor-cloud connection's "serial" is not a reader's. */
  if (!device || !device.isActive || device.vendor !== 'ADMS') return null;
  /* A company that switched Attendance off, stopped paying for it, or is closing is not collecting punches (A-11). */
  if (await appLive(device.accountId, device.orgId, 'attendance')) return null;
  return device;
}

/**
 * Unknown serials are kept so a company adding a reader sees it was heard from (devices.ts). Nobody signs
 * in to send one, so the table is bounded (audit 7 Nov 2026, #10): at most this many per network, the
 * longest silent giving way to a new one (so a real reader switched on today is always heard), and rows
 * not heard from in 30 days are pruned (services/retention.ts, UNCLAIMED_READER_KEEP_DAYS).
 */
export const UNCLAIMED_PER_NETWORK = 20;

export async function remember(serial: string, ip: string | null, info: string | null, network: string | null) {
  /* The latest network is kept: adding the reader from that network proves it is yours (devices.ts). */
  const seen = { lastSeenAt: new Date(), ...(ip ? { ip } : {}), ...(network ? { network } : {}), ...(info ? { info: info.slice(0, 300) } : {}) };
  /* One already kept is only touched; only a new serial counts against the cap. */
  const touched = await peoplePrisma.unclaimedReader.updateMany({ where: { serialNumber: serial }, data: seen });
  if (touched.count) return;
  /* A new one counts against its network's cap, under a lock per network, so a burst cannot overshoot it. */
  await peoplePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`unclaimed-reader:${network ?? ''}`}))`;
    const kept = await tx.unclaimedReader.findMany({ where: { network }, orderBy: { lastSeenAt: 'desc' }, skip: UNCLAIMED_PER_NETWORK - 1, select: { serialNumber: true } });
    if (kept.length) await tx.unclaimedReader.deleteMany({ where: { serialNumber: { in: kept.map((k) => k.serialNumber) } } });
    await tx.unclaimedReader.createMany({ data: [{ serialNumber: serial, ip, network, info: info?.slice(0, 300) || null }], skipDuplicates: true });
  });
}

/**
 * Bodies are parsed only up to what the serial deserves: a reader a company added may send a big batch
 * (a few hundred KB; ClorTime caps at 8 MB), anything else gets 64 KB (#10). The serial is looked up
 * once a minute at most, so a flood of unknown serials costs one small query each, not an 8 MB parse.
 */
const BIG_BODY = express.text({ type: () => true, limit: '8mb' });
const SMALL_BODY = express.text({ type: () => true, limit: '64kb' });
const knownSerials = new Map<string, { known: boolean; at: number }>();
async function knownSerial(serial: string) {
  const hit = knownSerials.get(serial);
  if (hit && Date.now() - hit.at < 60_000) return hit.known;
  const device = await outsideTenant('adms: is this serial a company reader (body size)', () => peoplePrisma.attendanceDevice.findUnique({ where: { serialNumber: serial }, select: { isActive: true, vendor: true } }));
  const known = Boolean(device?.isActive && device.vendor === 'ADMS');
  if (knownSerials.size > 5_000) knownSerials.clear();
  knownSerials.set(serial, { known, at: Date.now() });
  return known;
}
export const iclockBody: RequestHandler = (req, res, next) => {
  if (req.method !== 'POST') return SMALL_BODY(req, res, next);
  const serial = serialOf(req);
  if (!serial) return SMALL_BODY(req, res, next);
  knownSerial(serial).then((known) => (known ? BIG_BODY : SMALL_BODY)(req, res, next), next);
};

type Lockable = {
  id: string;
  allowedNetworks: string[];
  networkVerifiedAt: Date | null;
  claimNetwork: string | null;
  pendingNetwork: string | null;
  pendingNetworkAt: Date | null;
};

/**
 * The network lock (AttendanceDevice.allowedNetworks): may this request speak
 * for the reader? Approved addresses may. So may, once, the address the reader
 * was added from, the first address of a reader added before the lock existed,
 * and a new address in the same small block as an approved one (a dynamic
 * office line). Anything else is held: the reader is told it is busy, keeps
 * its punches, and is given no commands until an admin on that network
 * approves it — someone who only knows the serial gets nothing and adds nothing.
 */
async function admitted(device: Lockable, req: Request) {
  const net = networkOf(req);
  if (!net) return false;
  const allowed = device.allowedNetworks || [];
  if (allowed.includes(net)) return true;
  const approve = device.networkVerifiedAt
    ? !allowed.length || allowed.some((a) => sameBlock(a, net))
    : device.claimNetwork === net;
  if (approve) {
    await peoplePrisma.attendanceDevice.update({
      where: { id: device.id },
      data: { allowedNetworks: [...allowed, net].slice(-MAX_NETWORKS), networkVerifiedAt: device.networkVerifiedAt ?? new Date(), pendingNetwork: null, pendingNetworkAt: null },
    });
    return true;
  }
  if (device.pendingNetwork !== net || !device.pendingNetworkAt || Date.now() - device.pendingNetworkAt.getTime() > 5 * 60_000) {
    await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { pendingNetwork: net, pendingNetworkAt: new Date() } });
  }
  return false;
}

const readerIp = (req: Request) => {
  const ip = String(req.ip || '').replace(/^::ffff:/, '');
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) ? ip : null;
};

// ---------------------------------------------------------------------------
// Matching and the day
// ---------------------------------------------------------------------------

/** 1. Handshake: the reader asks for its options. Every reader gets them, so it starts sending. */
iclockRouter.get(['/cdata', '/cdata.aspx'], async (req, res) => {
  const serial = serialOf(req);
  if (!serial) return text(res, 'ADMS Server Ready');
  try {
    const device = await deviceFor(serial);
    if (device) enterTenant(device.orgId); /* A-30 */
    /* Options are no secret; a reader on a network not approved yet is not marked as seen. */
    if (device && !(await admitted(device, req))) return text(res, HANDSHAKE_OPTIONS);
    if (device) {
      /* The LAN address the reader reports (heartbeat INFO) is the useful one; the connection's is the office router's. */
      await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), ...(readerIp(req) && !device.ip ? { ip: readerIp(req) } : {}) } });
    } else {
      await remember(serial, readerIp(req), null, networkOf(req));
    }
    return text(res, HANDSHAKE_OPTIONS);
  } catch (e) {
    /* The reader only ever sees OK or ERROR; the reason goes to the logs. */
    // eslint-disable-next-line no-console
    console.error(`[iclock] handshake ${serialOf(req)}:`, e instanceof Error ? e.message : e);
    return text(res, 'ERROR', 500);
  }
});

/**
 * How far a reader's clock is out, from a punch it sent the moment it was
 * made: a reader that was online a minute ago, sending one to three new
 * punches (real-time upload), has just made them — so the time on the punch
 * minus the time now is its clock error. Batches (a reader catching up after
 * being offline, or answering "fetch all") prove nothing and are ignored.
 */
export function clockOffsetOf(body: string, lastSeenAt: Date | null, now: Date) {
  if (!lastSeenAt || now.getTime() - lastSeenAt.getTime() > 2 * 60_000) return null;
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length || lines.length > 3) return null;
  const times = lines.map((l) => parseAttlogLine(l)).filter(Boolean).map((p) => instantOf(p!.localTime)).filter((d): d is Date => Boolean(d));
  if (!times.length) return null;
  const newest = Math.max(...times.map((d) => d.getTime()));
  const sec = Math.round((newest - now.getTime()) / 1000);
  return Math.max(-2_000_000_000, Math.min(2_000_000_000, sec));
}

/** Tables that carry users and fingerprints / faces (ClorTime's list, upper-cased). */
const DATA_TABLES = new Set(['OPERLOG', 'ERRORLOG', 'USERINFO', 'BIODATA', 'FINGERTMP', 'FACE', 'USERVF', 'FACEV7', 'TEMPLATEV10']);

/** 2. Data: punches (ATTLOG), users and templates; other tables are acknowledged. */
iclockRouter.post(['/cdata', '/cdata.aspx'], async (req, res) => {
  const serial = serialOf(req);
  if (!serial) return text(res, 'OK');
  const table = String(req.query.table || '').trim().toUpperCase();
  const body = typeof req.body === 'string' ? req.body : '';
  try {
    const device = await deviceFor(serial);
    if (device) enterTenant(device.orgId); /* A-30 */
    if (!device) {
      await remember(serial, readerIp(req), null, networkOf(req));
      return text(res, 'OK');
    }
    /* Not from an approved network: not taken, and not acknowledged — the reader keeps the batch and sends it again. */
    if (!(await admitted(device, req))) return text(res, 'BUSY', 503);
    const now = new Date();
    await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: now } });

    if (table === 'ATTLOG' || table === '') {
      const n = await ingestPunches(device, body);
      const offset = n ? clockOffsetOf(body, device.lastSeenAt, now) : null;
      if (offset !== null) await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { clockOffsetSec: offset, clockCheckedAt: now } });
      return text(res, `OK: ${n}`);
    }
    if (DATA_TABLES.has(table)) {
      const match = await pinMatcher(device.orgId);
      const logs: any[] = [];
      for (const line of body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        /* OPERLOG mixes operation records (OPLOG …) with users and templates; ERRORLOG is errors. */
        if (table === 'ERRORLOG' || (table === 'OPERLOG' && !/^(USER|FP|FACE|BIODATA|USERPIC)\b/.test(line))) {
          const op = parseOpLine(line);
          if (op) logs.push({ accountId: device.accountId, orgId: device.orgId, deviceId: device.id, kind: table === 'ERRORLOG' ? 'ERROR' : 'OPERATION', ...op });
          continue;
        }
        const r = parseBiodataLine(line, table);
        if (!r) continue;
        if (r.kind === 'USER') await storeUser(device, r);
        else await storeTemplate(device, r.template, match);
      }
      if (logs.length) {
        await peoplePrisma.deviceLog.createMany({ data: logs });
        /* Someone used the reader: read its users again shortly, so a person enrolled there reaches CLOR and the other readers. */
        if (table === 'OPERLOG') await readUsersIfDue(device, true);
      }
    }
    return text(res, 'OK');
  } catch (e) {
    /* The reader only ever sees OK or ERROR; the reason goes to the logs. */
    // eslint-disable-next-line no-console
    console.error(`[iclock] cdata ${serialOf(req)}:`, e instanceof Error ? e.message : e);
    /* Not acknowledged, so the reader keeps the batch and sends it again after ErrorDelay. */
    return text(res, 'ERROR', 500);
  }
});

const INFO_EVERY_MS = 6 * 3_600_000;
/** The user list is small (IDs, names, cards): read hourly. Fingerprints and faces are not: daily, or when they change. */
export const USERS_EVERY_MS = 3_600_000;
export const TEMPLATES_EVERY_MS = 24 * 3_600_000;

/**
 * Sync from the reader: CLOR asks for its users when the reader is new to it,
 * every hour, and — `soon` — a couple of minutes after the reader shows a
 * change (its user, fingerprint or face count moved, or someone used its menu).
 * Fingerprints and faces come with the first read, once a day after that, and
 * with every `soon` read, since enrolling at the reader is what changes them.
 * Never while a read is already on its way.
 */
async function readUsersIfDue(device: { id: string; accountId: string; orgId: string; serialNumber: string }, soon = false) {
  const last = await peoplePrisma.deviceCommand.findFirst({ where: { deviceId: device.id, command: COMMANDS.FETCH_USERS }, orderBy: { id: 'desc' }, select: { status: true, createdAt: true } });
  if (last && (last.status === 'PENDING' || last.status === 'SENT')) return false;
  const age = last ? Date.now() - last.createdAt.getTime() : Infinity;
  const due = soon ? age > 2 * 60_000 : age > USERS_EVERY_MS || (!last && !(await peoplePrisma.deviceUser.findFirst({ where: { deviceId: device.id }, select: { id: true } })));
  if (!due) return false;
  const lastTemplates = await peoplePrisma.deviceCommand.findFirst({
    where: { deviceId: device.id, command: FETCH_TEMPLATE_COMMANDS[0] },
    orderBy: { id: 'desc' },
    select: { status: true, createdAt: true },
  });
  const templatesWaiting = lastTemplates && (lastTemplates.status === 'PENDING' || lastTemplates.status === 'SENT');
  /* Fingerprints and faces are read from readers only when the company keeps copies (DPDP: no collection without a purpose). */
  const copying = (await biometricPolicy(device.orgId)).copy;
  const templatesDue = copying && !templatesWaiting && (soon || !lastTemplates || Date.now() - lastTemplates.createdAt.getTime() > TEMPLATES_EVERY_MS);
  const commands = [COMMANDS.FETCH_USERS, ...(templatesDue ? FETCH_TEMPLATE_COMMANDS : [])];
  await peoplePrisma.deviceCommand.createMany({
    data: commands.map((command) => ({ accountId: device.accountId, orgId: device.orgId, deviceId: device.id, serialNumber: device.serialNumber, command })),
  });
  return true;
}
/** A command sent and not answered in this long is sent again; after MAX_ATTEMPTS it has failed. */
export const ANSWER_WITHIN_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 3;

/**
 * Commands a reader took and never answered (a lost reply, a restart mid-way)
 * go back in the queue, at most three times; then they have failed, visibly,
 * instead of sitting "sent" for ever (ClorTime command-queue retries).
 */
export async function retryUnanswered(deviceId: string, now = new Date()) {
  const stale = { deviceId, status: 'SENT', sentAt: { lt: new Date(now.getTime() - ANSWER_WITHIN_MS) } };
  await peoplePrisma.deviceCommand.updateMany({ where: { ...stale, attempts: { lt: MAX_ATTEMPTS } }, data: { status: 'PENDING' } });
  await peoplePrisma.deviceCommand.updateMany({
    where: { ...stale, attempts: { gte: MAX_ATTEMPTS } },
    data: { status: 'FAILED', doneAt: now, lastError: `The reader did not answer (sent ${MAX_ATTEMPTS} times).` },
  });
}

/** 3. Heartbeat: "OK", or the next command for this reader. */
iclockRouter.get(['/getrequest', '/getrequest.aspx'], async (req, res) => {
  const serial = serialOf(req);
  if (!serial) return text(res, 'OK');
  try {
    const device = await deviceFor(serial);
    if (device) enterTenant(device.orgId); /* A-30 */
    const info = parseInfo(req.query.INFO ? String(req.query.INFO) : undefined);
    const ip = info.ip || readerIp(req);
    if (!device) {
      await remember(serial, ip, req.query.INFO ? String(req.query.INFO) : null, networkOf(req));
      return text(res, 'OK');
    }
    /* Commands carry names, cards and fingerprints: only to a reader on an approved network. */
    if (!(await admitted(device, req))) return text(res, 'OK');
    /* Someone was enrolled, changed or deleted at the reader: its counts say so before any operation record does. */
    const moved = (now: number | null, before: number | null) => now !== null && before !== null && now !== before;
    const changedAtReader =
      moved(info.userCount, device.userCount) || moved(info.fingerCount, device.fingerCount) || moved(info.faceCount, device.faceCount);
    await peoplePrisma.attendanceDevice.update({
      where: { id: device.id },
      data: {
        lastSeenAt: new Date(),
        ...(info.model ? { model: info.model } : {}),
        ...(info.firmware ? { firmware: info.firmware } : {}),
        ...(info.ip ? { ip: info.ip } : !device.ip && ip ? { ip } : {}),
        ...(info.faceSupported !== null ? { faceSupported: info.faceSupported } : {}),
        ...(info.fingerSupported !== null ? { fingerSupported: info.fingerSupported } : {}),
        /* A version learnt from a face template is more exact than INFO's; keep it. */
        ...(info.faceMajorVer && !device.faceMajorVer ? { faceMajorVer: info.faceMajorVer } : {}),
        /* Live counts ride on every heartbeat; limits come from the INFO command. */
        ...(info.userCount !== null ? { userCount: info.userCount } : {}),
        ...(info.fingerCount !== null ? { fingerCount: info.fingerCount } : {}),
        ...(info.punchCount !== null ? { punchCount: info.punchCount } : {}),
        ...(info.faceCount !== null ? { faceCount: info.faceCount } : {}),
      },
    });

    /*
     * A reader whose punches never reached us (just added, or moved here) is
     * asked for its whole log once — at most every half hour (ClorTime's
     * recovery pull). This is also what recovers punches made before the
     * company added the reader.
     */
    const [anyPunch, recentPull] = await Promise.all([
      peoplePrisma.devicePunch.findFirst({ where: { orgId: device.orgId, deviceId: device.id }, select: { id: true } }),
      peoplePrisma.deviceCommand.findFirst({
        where: { deviceId: device.id, command: COMMANDS.FETCH_PUNCHES, createdAt: { gt: new Date(Date.now() - 30 * 60_000) } },
        select: { id: true },
      }),
    ]);
    if (!anyPunch && !recentPull) {
      await peoplePrisma.deviceCommand.create({
        data: { accountId: device.accountId, orgId: device.orgId, deviceId: device.id, serialNumber: serial, command: COMMANDS.FETCH_PUNCHES },
      });
    }

    await retryUnanswered(device.id);
    /* Counts and limits (users, fingers, faces, punch log) every six hours, for "nearly full". */
    if (!device.infoAt || Date.now() - device.infoAt.getTime() > INFO_EVERY_MS) {
      const asked = await peoplePrisma.deviceCommand.findFirst({
        where: { deviceId: device.id, command: COMMANDS.INFO, OR: [{ status: { in: ['PENDING', 'SENT'] } }, { createdAt: { gt: new Date(Date.now() - INFO_EVERY_MS) } }] },
        select: { id: true },
      });
      if (!asked) {
        await peoplePrisma.deviceCommand.create({ data: { accountId: device.accountId, orgId: device.orgId, deviceId: device.id, serialNumber: serial, command: COMMANDS.INFO } });
      }
    }

    /* Who is on it (sync from the reader): when new to CLOR, hourly, and soon after a change there. */
    await readUsersIfDue(device, changedAtReader);

    const next = await peoplePrisma.deviceCommand.findFirst({ where: { deviceId: device.id, status: 'PENDING' }, orderBy: [{ sequence: 'asc' }, { id: 'asc' }] });
    if (!next) return text(res, 'OK');
    await peoplePrisma.deviceCommand.update({ where: { id: next.id }, data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } } });
    return text(res, `C:${next.id}:${next.command}`);
  } catch (e) {
    /* The reader only ever sees OK or ERROR; the reason goes to the logs. */
    // eslint-disable-next-line no-console
    console.error(`[iclock] getrequest ${serialOf(req)}:`, e instanceof Error ? e.message : e);
    return text(res, 'OK');
  }
});

/** 4. Command results: Return >= 0 is success. */
iclockRouter.post(['/devicecmd', '/devicecmd.aspx'], async (req, res) => {
  const serial = serialOf(req);
  if (!serial) return text(res, 'OK');
  try {
    const results = parseCommandResults(typeof req.body === 'string' ? req.body : '');
    const device = results.length ? await deviceFor(serial) : null;
    if (device) enterTenant(device.orgId); /* A-30 */
    /* Only the reader itself, from an approved network, can say a command was carried out. */
    if (!device || !(await admitted(device, req))) return text(res, 'OK');
    for (const r of results) {
      const ok = r.returnCode >= 0;
      const cmd = await peoplePrisma.deviceCommand.findFirst({ where: { id: r.id, serialNumber: serial } });
      if (!cmd) continue;
      await peoplePrisma.deviceCommand.update({
        where: { id: cmd.id },
        data: { status: ok ? 'DONE' : 'FAILED', returnCode: r.returnCode, doneAt: new Date(), lastError: ok ? null : refusalReason(r.returnCode) },
      });
      if (!ok || !device || cmd.deviceId !== device.id) continue;
      if (cmd.command === COMMANDS.INFO) {
        const info = parseReaderInfo(r.info);
        /* Kept under Reader logs as the reader said it: firmware differs in what it names its counts. */
        await peoplePrisma.deviceLog.create({
          data: {
            accountId: device.accountId,
            orgId: device.orgId,
            deviceId: device.id,
            kind: 'OPERATION',
            code: 'INFO',
            localTime: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 19).replace('T', ' '),
            details: Object.entries(r.info).map(([k, v]) => `${k}=${v}`).join('; ').slice(0, 2000) || null,
          },
        });
        const { firmware, ...counts } = info;
        await peoplePrisma.attendanceDevice.update({
          where: { id: device.id },
          data: { ...Object.fromEntries(Object.entries(counts).filter(([, v]) => v !== null)), ...(firmware ? { firmware } : {}), infoAt: new Date() },
        });
        continue;
      }
      /* The reader confirmed it: now it holds (or no longer holds) this. */
      const e = commandEffect(cmd.command);
      if (!e) continue;
      if (e.what === 'user') await markOnReader(device, e.pin, { user: true, name: /\tName=([^\t]*)/.exec(cmd.command)?.[1] || null });
      else if (e.what === 'finger') await markOnReader(device, e.pin, { finger: e.no ?? 0 });
      else if (e.what === 'face') await markOnReader(device, e.pin, { face: true });
      else if (e.what === 'removeUser') await markOnReader(device, e.pin, { remove: true });
      else if (e.what === 'removeFingers') await peoplePrisma.deviceUser.updateMany({ where: { deviceId: device.id, pin: e.pin }, data: { fingers: '' } });
      else if (e.what === 'removeFace') await peoplePrisma.deviceUser.updateMany({ where: { deviceId: device.id, pin: e.pin }, data: { face: false } });
    }
  } catch (e) {
    /* The reader only ever sees OK or ERROR; the reason goes to the logs. */
    // eslint-disable-next-line no-console
    console.error(`[iclock] devicecmd ${serialOf(req)}:`, e instanceof Error ? e.message : e);
    /* a lost result leaves the command SENT; the screen shows it */
  }
  return text(res, 'OK');
});

/** Anything else a reader asks for (firmware varies): acknowledge. */
iclockRouter.all('*', (_req, res) => text(res, 'OK'));
