import { Router, type Request, type Response } from 'express';

import { peoplePrisma } from '../utils/peoplePrisma.js';
import { isFeatureEnabled } from '../services/features.js';
import {
  COMMANDS,
  FACE,
  FINGER,
  HANDSHAKE_OPTIONS,
  SEQ,
  instantOf,
  pairDay,
  parseAttlogLine,
  parseBiodataLine,
  parseCommandResults,
  parseInfo,
  parseOpLine,
  pinKey,
  punchKind,
  removalCommands,
  shiftDayOf,
  templateCommands,
  userInfoCommand,
  type Template,
} from '../services/attendance/adms.js';
import { readerLimiter } from '../middleware/rateLimit.js';
import { shiftFor, writeDay } from './attendance.js';

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
iclockRouter.use(readerLimiter);

const SERIAL = /^[A-Za-z0-9_-]{4,40}$/;
const text = (res: Response, body: string, status = 200) => res.status(status).type('text/plain').send(body);
const serialOf = (req: Request) => {
  const sn = String(req.query.SN || '').trim();
  return SERIAL.test(sn) ? sn : null;
};

/** Days someone decided by hand are not rewritten by a reader: a correction, a request, an approved leave. */
const DECIDED = new Set(['MANUAL', 'REQUEST', 'LEAVE']);

async function deviceFor(serial: string) {
  const device = await peoplePrisma.attendanceDevice.findUnique({ where: { serialNumber: serial } });
  if (!device || !device.isActive) return null;
  /* A company that switched Attendance off is not collecting punches. */
  if (!(await isFeatureEnabled(device.accountId, device.orgId, 'attendance'))) return null;
  return device;
}

async function remember(serial: string, ip: string | null, info: string | null) {
  await peoplePrisma.unclaimedReader.upsert({
    where: { serialNumber: serial },
    create: { serialNumber: serial, ip, info: info?.slice(0, 300) || null },
    update: { lastSeenAt: new Date(), ...(ip ? { ip } : {}), ...(info ? { info: info.slice(0, 300) } : {}) },
  });
}

const readerIp = (req: Request) => {
  const ip = String(req.ip || '').replace(/^::ffff:/, '');
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) ? ip : null;
};

// ---------------------------------------------------------------------------
// Matching and the day
// ---------------------------------------------------------------------------

/**
 * Who a reader's user ID is: the employee whose Reader ID is that pin, else
 * the one whose employee code is (leading zeros ignored). An ambiguous code
 * matches nobody rather than the wrong person.
 */
export async function pinMatcher(orgId: string) {
  const people = await peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, code: true, devicePin: true, branchId: true } });
  const byPin = new Map<string, (typeof people)[number]>();
  const byCode = new Map<string, (typeof people)[number]>();
  const ambiguous = new Set<string>();
  for (const p of people) if (p.devicePin) byPin.set(pinKey(p.devicePin), p);
  for (const p of people) {
    if (!p.code) continue;
    const k = pinKey(p.code);
    if (byCode.has(k)) ambiguous.add(k);
    else byCode.set(k, p);
  }
  return (pin: string) => {
    const k = pinKey(pin);
    return byPin.get(k) || (ambiguous.has(k) ? null : byCode.get(k)) || null;
  };
}

const isNight = (rule: { startTime: string; endTime: string }) => rule.endTime <= rule.startTime;
/** An instant as the IST wall clock a reader would print: "YYYY-MM-DD HH:mm:ss". */
const istLocal = (at: Date) => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 19).replace('T', ' ');

export async function shiftDayFor(orgId: string, employeeId: string, localTime: string) {
  const { rule } = await shiftFor(orgId, employeeId, localTime.slice(0, 10));
  return shiftDayOf(localTime, isNight(rule));
}

/**
 * Work a day out again from its reader punches (and any app clock-ins on the
 * same shift day), then write it through the same path as every other day.
 */
export async function recomputeDeviceDay(accountId: string, orgId: string, employee: { id: string; branchId: string | null }, date: string) {
  const existing = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: employee.id, date } } });
  if (existing && DECIDED.has(existing.source)) return null;

  const punches = await peoplePrisma.devicePunch.findMany({
    where: { orgId, employeeId: employee.id, shiftDate: date },
    select: { at: true, kind: true },
  });
  /* App clock-ins on the same shift day count too: someone may use both. */
  const from = new Date(`${date}T00:00:00+05:30`);
  const to = new Date(from.getTime() + 36 * 3_600_000);
  const clocks = await peoplePrisma.attendanceActivity.findMany({
    where: { orgId, employeeId: employee.id, source: 'CLOCK', at: { gte: from, lt: to } },
    select: { at: true, kind: true },
  });
  const { rule } = await shiftFor(orgId, employee.id, date);
  const sameDay = clocks.filter((c) => shiftDayOf(istLocal(c.at), isNight(rule)) === date);
  const points = [
    ...punches.map((p) => ({ at: p.at, kind: (p.kind as 'IN' | 'OUT' | null) ?? null })),
    ...sameDay.map((c) => ({ at: c.at, kind: c.kind === 'OUT' ? ('OUT' as const) : ('IN' as const) })),
  ];
  const day = pairDay(points);
  if (!day) return null;
  return writeDay({ accountId, orgId, userId: 'reader', employee, date, checkIn: day.checkIn, checkOut: day.checkOut, source: 'DEVICE' });
}

/** Store a batch of punch lines from one reader; returns how many were new. */
export async function ingestPunches(device: { id: string; accountId: string; orgId: string; serialNumber: string; direction: string }, body: string) {
  const match = await pinMatcher(device.orgId);
  const parsed = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((raw) => ({ raw, p: parseAttlogLine(raw) }))
    .filter((x): x is { raw: string; p: NonNullable<ReturnType<typeof parseAttlogLine>> } => Boolean(x.p));

  const rows: any[] = [];
  for (const { raw, p } of parsed) {
    const at = instantOf(p.localTime);
    if (!at) continue;
    const emp = match(p.pin);
    rows.push({
      accountId: device.accountId,
      orgId: device.orgId,
      deviceId: device.id,
      serialNumber: device.serialNumber,
      pin: p.pin,
      at,
      localTime: p.localTime,
      state: p.state,
      kind: punchKind(p.state, device.direction),
      verifyMode: p.verifyMode,
      employeeId: emp?.id ?? null,
      shiftDate: emp ? await shiftDayFor(device.orgId, emp.id, p.localTime) : null,
      raw: raw.slice(0, 300),
      _emp: emp,
    });
  }
  if (!rows.length) return 0;

  /* Readers resend (Stamp=0 asks for everything; outages replay). Only new punches change a day. */
  const fresh: typeof rows = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const seen = await peoplePrisma.devicePunch.findMany({
      where: { orgId: device.orgId, OR: chunk.map((r) => ({ pin: r.pin, at: r.at })) },
      select: { pin: true, at: true },
    });
    const have = new Set(seen.map((s) => `${s.pin}|${s.at.getTime()}`));
    const batch = new Set<string>();
    for (const r of chunk) {
      const key = `${r.pin}|${r.at.getTime()}`;
      if (have.has(key) || batch.has(key)) continue;
      batch.add(key);
      fresh.push(r);
    }
  }
  if (!fresh.length) return 0;
  await peoplePrisma.devicePunch.createMany({ data: fresh.map(({ _emp, ...r }) => r), skipDuplicates: true });

  const days = new Map<string, { emp: any; date: string }>();
  for (const r of fresh) if (r._emp && r.shiftDate) days.set(`${r._emp.id}|${r.shiftDate}`, { emp: r._emp, date: r.shiftDate });
  for (const { emp, date } of days.values()) {
    await recomputeDeviceDay(device.accountId, device.orgId, { id: emp.id, branchId: emp.branchId }, date);
  }
  return fresh.length;
}

// ---------------------------------------------------------------------------
// Users and fingerprints / faces
// ---------------------------------------------------------------------------

type Device = { id: string; accountId: string; orgId: string; serialNumber: string; faceSupported?: boolean | null; fingerSupported?: boolean | null; faceMajorVer?: number | null; faceMinorVer?: number | null };

async function storeUser(device: Device, u: { pin: string; name: string | null; privilege: number | null; password: string | null; card: string | null }) {
  const pin = u.pin.slice(0, 40);
  const fields = {
    ...(u.name !== null ? { name: u.name.slice(0, 120) } : {}),
    ...(u.privilege !== null ? { privilege: u.privilege } : {}),
    ...(u.password !== null ? { password: u.password.slice(0, 40) } : {}),
    ...(u.card !== null ? { card: u.card.slice(0, 40) } : {}),
  };
  await peoplePrisma.deviceUser.upsert({
    where: { deviceId_pin: { deviceId: device.id, pin } },
    create: { accountId: device.accountId, orgId: device.orgId, deviceId: device.id, pin, ...fields },
    update: fields,
  });
}

/** The user record to send with a template: as the reader it came from holds it, else the employee's name. */
async function userFor(orgId: string, pin: string, preferDeviceId?: string) {
  const held = await peoplePrisma.deviceUser.findMany({ where: { orgId, pin }, orderBy: { updatedAt: 'desc' } });
  const u = held.find((h) => h.deviceId === preferDeviceId) || held[0];
  let name = u?.name || null;
  if (!name) {
    const emp = (await pinMatcher(orgId))(pin);
    if (emp) name = (await peoplePrisma.employee.findUnique({ where: { id: emp.id }, select: { name: true } }))?.name || null;
  }
  return { name: name || 'Unknown', privilege: u?.privilege ?? 0, password: u?.password ?? '', card: u?.card ?? '' };
}

const supports = (target: Device, type: number) =>
  !(type === FACE && target.faceSupported === false) && !(type === FINGER && target.fingerSupported === false);

/**
 * Queue one person's templates onto one reader: their user record first
 * (unless one is already on its way), then each template in order.
 */
async function queueOnto(target: Device, pin: string, templates: Template[], user: Awaited<ReturnType<typeof userFor>>, createdByUserId: string | null) {
  const usable = templates.filter((t) => supports(target, t.type));
  if (!usable.length) return 0;
  const userCmd = userInfoCommand(pin, user.name, user);
  const pendingUser = await peoplePrisma.deviceCommand.findFirst({
    where: { deviceId: target.id, status: { in: ['PENDING', 'SENT'] }, command: { startsWith: `DATA UPDATE USERINFO PIN=${userCmd.split('\t')[0].slice('DATA UPDATE USERINFO PIN='.length)}\t` }, createdAt: { gt: new Date(Date.now() - 2 * 60_000) } },
    select: { id: true },
  });
  const rows = [
    ...(pendingUser ? [] : [{ seq: SEQ.USER, command: userCmd }]),
    ...usable.flatMap((t) => templateCommands(t, target)),
  ];
  await peoplePrisma.deviceCommand.createMany({
    data: rows.map((r) => ({ accountId: target.accountId, orgId: target.orgId, deviceId: target.id, serialNumber: target.serialNumber, command: r.command, sequence: r.seq, createdByUserId })),
  });
  return rows.length;
}

const otherReaders = (source: { orgId: string; id: string }) =>
  peoplePrisma.attendanceDevice.findMany({ where: { orgId: source.orgId, isActive: true, id: { not: source.id } } });

/**
 * A template a reader just enrolled (or changed) goes to every other reader of
 * the company, so a person enrolled once is recognised everywhere (ClorTime
 * syncTemplateToOtherDevices). Unchanged templates are not re-sent: a reader
 * asked for its templates would otherwise bounce every copy back round.
 */
async function storeTemplate(device: Device, t: Template, match: Awaited<ReturnType<typeof pinMatcher>>) {
  const pin = t.pin.slice(0, 40);
  const key = { orgId_pin_type_no: { orgId: device.orgId, pin, type: t.type, no: t.no } };
  const existing = await peoplePrisma.biometricTemplate.findUnique({ where: key, select: { data: true } });
  const changed = !existing || existing.data !== t.data;
  const values = { data: t.data, valid: t.valid, duress: t.duress, majorVer: t.majorVer, minorVer: t.minorVer, format: t.format, indexNo: t.indexNo, sourceDeviceId: device.id, employeeId: match(pin)?.id ?? null };
  await peoplePrisma.biometricTemplate.upsert({
    where: key,
    create: { accountId: device.accountId, orgId: device.orgId, pin, type: t.type, no: t.no, ...values },
    update: values,
  });
  /* The face algorithm this reader runs, learnt from what it sends. */
  if (t.type === FACE && t.majorVer > 0 && (device.faceMajorVer !== t.majorVer || device.faceMinorVer !== t.minorVer)) {
    await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { faceMajorVer: t.majorVer, faceMinorVer: t.minorVer || null, faceSupported: true } });
  }
  if (!changed) return;
  const user = await userFor(device.orgId, pin, device.id);
  for (const target of await otherReaders(device)) await queueOnto(target, pin, [{ ...t, pin }], user, null);
}

/** Copy every stored template of people still employed (and of reader IDs not yet matched) onto one reader. */
export async function copyAllTemplatesTo(target: Device, createdByUserId: string | null) {
  const templates = await peoplePrisma.biometricTemplate.findMany({ where: { orgId: target.orgId }, orderBy: [{ pin: 'asc' }, { type: 'asc' }, { no: 'asc' }] });
  const left = new Set(
    (await peoplePrisma.employee.findMany({ where: { orgId: target.orgId, status: 'LEFT' }, select: { id: true } })).map((e) => e.id)
  );
  const byPin = new Map<string, Template[]>();
  for (const t of templates) {
    if (t.employeeId && left.has(t.employeeId)) continue;
    if (!byPin.has(t.pin)) byPin.set(t.pin, []);
    byPin.get(t.pin)!.push(t);
  }
  let commands = 0;
  for (const [pin, list] of byPin) commands += await queueOnto(target, pin, list, await userFor(target.orgId, pin), createdByUserId);
  return { people: byPin.size, commands };
}

/**
 * Someone left: take them off every reader (templates, then the user) and
 * delete their stored fingerprints and faces — door access ends with
 * employment, and biometric data is not kept longer than it is needed.
 */
export async function revokeFromReaders(orgId: string, employee: { id: string; code: string | null; devicePin: string | null }, createdByUserId: string | null) {
  const templates = await peoplePrisma.biometricTemplate.findMany({ where: { orgId, employeeId: employee.id }, select: { pin: true } });
  const pins = new Set<string>(templates.map((t) => t.pin));
  const own = employee.devicePin || employee.code;
  if (own) pins.add(own);
  if (!pins.size) return { readers: 0, pins: 0 };
  const readers = await peoplePrisma.attendanceDevice.findMany({ where: { orgId, isActive: true } });
  for (const r of readers) {
    await peoplePrisma.deviceCommand.createMany({
      data: [...pins].flatMap((pin) =>
        removalCommands(pin).map((command) => ({ accountId: r.accountId, orgId, deviceId: r.id, serialNumber: r.serialNumber, command, sequence: SEQ.USER, createdByUserId }))
      ),
    });
  }
  await peoplePrisma.biometricTemplate.deleteMany({ where: { orgId, OR: [{ employeeId: employee.id }, { pin: { in: [...pins] } }] } });
  await peoplePrisma.deviceUser.deleteMany({ where: { orgId, pin: { in: [...pins] } } });
  return { readers: readers.length, pins: pins.size };
}

// ---------------------------------------------------------------------------
// The protocol
// ---------------------------------------------------------------------------

/** 1. Handshake: the reader asks for its options. Every reader gets them, so it starts sending. */
iclockRouter.get(['/cdata', '/cdata.aspx'], async (req, res) => {
  const serial = serialOf(req);
  if (!serial) return text(res, 'ADMS Server Ready');
  try {
    const device = await deviceFor(serial);
    if (device) {
      await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), ...(readerIp(req) ? { ip: readerIp(req) } : {}) } });
    } else {
      await remember(serial, readerIp(req), null);
    }
    return text(res, HANDSHAKE_OPTIONS);
  } catch {
    return text(res, 'ERROR', 500);
  }
});

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
    if (!device) {
      await remember(serial, readerIp(req), null);
      return text(res, 'OK');
    }
    await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });

    if (table === 'ATTLOG' || table === '') {
      const n = await ingestPunches(device, body);
      return text(res, `OK: ${n}`);
    }
    if (DATA_TABLES.has(table)) {
      const match = await pinMatcher(device.orgId);
      const logs: any[] = [];
      for (const line of body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        /* OPERLOG mixes operation records (OPLOG …) with users and templates; ERRORLOG is errors. */
        if (table === 'ERRORLOG' || (table === 'OPERLOG' && !/^(USER|FP|FACE|BIODATA)\b/.test(line))) {
          const op = parseOpLine(line);
          if (op) logs.push({ accountId: device.accountId, orgId: device.orgId, deviceId: device.id, kind: table === 'ERRORLOG' ? 'ERROR' : 'OPERATION', ...op });
          continue;
        }
        const r = parseBiodataLine(line, table);
        if (!r) continue;
        if (r.kind === 'USER') await storeUser(device, r);
        else await storeTemplate(device, r.template, match);
      }
      if (logs.length) await peoplePrisma.deviceLog.createMany({ data: logs });
    }
    return text(res, 'OK');
  } catch {
    /* Not acknowledged, so the reader keeps the batch and sends it again after ErrorDelay. */
    return text(res, 'ERROR', 500);
  }
});

/** 3. Heartbeat: "OK", or the next command for this reader. */
iclockRouter.get(['/getrequest', '/getrequest.aspx'], async (req, res) => {
  const serial = serialOf(req);
  if (!serial) return text(res, 'OK');
  try {
    const device = await deviceFor(serial);
    const info = parseInfo(req.query.INFO ? String(req.query.INFO) : undefined);
    const ip = info.ip || readerIp(req);
    if (!device) {
      await remember(serial, ip, req.query.INFO ? String(req.query.INFO) : null);
      return text(res, 'OK');
    }
    await peoplePrisma.attendanceDevice.update({
      where: { id: device.id },
      data: {
        lastSeenAt: new Date(),
        ...(info.model ? { model: info.model } : {}),
        ...(info.firmware ? { firmware: info.firmware } : {}),
        ...(ip ? { ip } : {}),
        ...(info.faceSupported !== null ? { faceSupported: info.faceSupported } : {}),
        ...(info.fingerSupported !== null ? { fingerSupported: info.fingerSupported } : {}),
        /* A version learnt from a face template is more exact than INFO's; keep it. */
        ...(info.faceMajorVer && !device.faceMajorVer ? { faceMajorVer: info.faceMajorVer } : {}),
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

    const next = await peoplePrisma.deviceCommand.findFirst({ where: { deviceId: device.id, status: 'PENDING' }, orderBy: [{ sequence: 'asc' }, { id: 'asc' }] });
    if (!next) return text(res, 'OK');
    await peoplePrisma.deviceCommand.update({ where: { id: next.id }, data: { status: 'SENT', sentAt: new Date() } });
    return text(res, `C:${next.id}:${next.command}`);
  } catch {
    return text(res, 'OK');
  }
});

/** 4. Command results: Return >= 0 is success. */
iclockRouter.post(['/devicecmd', '/devicecmd.aspx'], async (req, res) => {
  const serial = serialOf(req);
  if (!serial) return text(res, 'OK');
  try {
    const results = parseCommandResults(typeof req.body === 'string' ? req.body : '');
    for (const r of results) {
      await peoplePrisma.deviceCommand.updateMany({
        where: { id: r.id, serialNumber: serial },
        data: { status: r.returnCode >= 0 ? 'DONE' : 'FAILED', returnCode: r.returnCode, doneAt: new Date() },
      });
    }
  } catch {
    /* a lost result leaves the command SENT; the screen shows it */
  }
  return text(res, 'OK');
});

/** Anything else a reader asks for (firmware varies): acknowledge. */
iclockRouter.all('*', (_req, res) => text(res, 'OK'));
