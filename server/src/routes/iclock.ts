import { Router, type Request, type Response } from 'express';

import { peoplePrisma } from '../utils/peoplePrisma.js';
import { isFeatureEnabled } from '../services/features.js';
import {
  COMMANDS,
  HANDSHAKE_OPTIONS,
  instantOf,
  pairDay,
  parseAttlogLine,
  parseCommandResults,
  parseInfo,
  parseUserLine,
  pinKey,
  punchKind,
  shiftDayOf,
} from '../services/attendance/adms.js';
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

/** 2. Data: punches (ATTLOG) and users (OPERLOG / USERINFO); other tables are acknowledged. */
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
    if (table === 'OPERLOG' || table === 'USERINFO') {
      const users = body
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('USER '))
        .map(parseUserLine)
        .filter((u): u is { pin: string; name: string | null } => Boolean(u));
      for (const u of users) {
        await peoplePrisma.deviceUser.upsert({
          where: { deviceId_pin: { deviceId: device.id, pin: u.pin.slice(0, 40) } },
          create: { accountId: device.accountId, orgId: device.orgId, deviceId: device.id, pin: u.pin.slice(0, 40), name: u.name?.slice(0, 120) || null },
          update: { name: u.name?.slice(0, 120) || null },
        });
      }
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
      data: { lastSeenAt: new Date(), ...(info.model ? { model: info.model } : {}), ...(info.firmware ? { firmware: info.firmware } : {}), ...(ip ? { ip } : {}) },
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

    const next = await peoplePrisma.deviceCommand.findFirst({ where: { deviceId: device.id, status: 'PENDING' }, orderBy: { id: 'asc' } });
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
