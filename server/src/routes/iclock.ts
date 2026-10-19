import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { enqueuePunches } from '../services/hr/sync.js';

import { peoplePrisma } from '../utils/peoplePrisma.js';
import { isFeatureEnabled } from '../services/features.js';
import {
  COMMANDS,
  FACE,
  FETCH_TEMPLATE_COMMANDS,
  admsField,
  FINGER,
  HANDSHAKE_OPTIONS,
  SEQ,
  addFinger,
  commandEffect,
  instantOf,
  pairDay,
  parseAttlogLine,
  parseBiodataLine,
  parseCommandResults,
  parseInfo,
  parseOpLine,
  parseReaderInfo,
  pinKey,
  punchKind,
  refusalReason,
  removalCommandsFor,
  shiftDayOf,
  templateCommands,
  userCommandFor,
  type Template,
} from '../services/attendance/adms.js';
import { readerLimiter } from '../middleware/rateLimit.js';
import { decryptSecret } from '../services/mailer.js';
import { pullPunches } from '../services/attendance/pull/index.js';
import { emit as emitWebhook } from '../services/attendance/webhooks.js';
import { MAX_NETWORKS, networkOf, sameBlock } from '../services/attendance/network.js';
import { closedMonths, shiftFor, writeDay } from './attendance.js';
import { readerIdMatcher } from '../services/attendance/readerIds.js';
import { biometricPolicy, openTemplate, sealTemplate, sendableWhere } from '../services/attendance/biometrics.js';
import { driverOf, parserOf, vendorsWith } from '../services/attendance/drivers.js';

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
  /* Only push readers talk here; a vendor-cloud connection's "serial" is not a reader's. */
  if (!device || !device.isActive || device.vendor !== 'ADMS') return null;
  /* A company that switched Attendance off is not collecting punches. */
  if (!(await isFeatureEnabled(device.accountId, device.orgId, 'attendance'))) return null;
  return device;
}

async function remember(serial: string, ip: string | null, info: string | null, network: string | null) {
  await peoplePrisma.unclaimedReader.upsert({
    where: { serialNumber: serial },
    create: { serialNumber: serial, ip, network, info: info?.slice(0, 300) || null },
    update: { lastSeenAt: new Date(), ...(ip ? { ip } : {}), ...(network ? { network } : {}), ...(info ? { info: info.slice(0, 300) } : {}) },
  });
}

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

/**
 * Who a reader's user ID is (services/attendance/readerIds.ts): a site ID at a
 * site's readers, else the company Reader ID, else an employee code only one
 * person has. Call the result with the reader's area.
 */
export const pinMatcher = (orgId: string) => readerIdMatcher(orgId);

const isNight = (rule: { startTime: string; endTime: string }) => rule.endTime <= rule.startTime;
/** An instant as the IST wall clock a reader would print: "YYYY-MM-DD HH:mm:ss". */
const istLocal = (at: Date) => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 19).replace('T', ' ');

const dayBefore = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const minutesOfDay = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * The shift day a punch belongs to. A morning punch is the end of last night's
 * shift only if the shift that started the evening before was a night shift —
 * the shift on the punch's own date says nothing about that — and only until
 * the morning's own shift could have begun: halfway from the night's end to the
 * day shift's start, and never more than four hours after the night ends.
 * (Moving from nights back to days put the night's 06:00 exit on the day shift,
 * or the day shift's 09:00 arrival on the night.)
 */
export async function shiftDayFor(orgId: string, employeeId: string, localTime: string) {
  const date = localTime.slice(0, 10);
  if (Number(localTime.slice(11, 13)) >= 12) return date;
  const before = dayBefore(date);
  const { rule: last } = await shiftFor(orgId, employeeId, before);
  if (!isNight(last)) return date;
  const end = minutesOfDay(last.endTime);
  let cutoff = end + 240;
  const { rule: own } = await shiftFor(orgId, employeeId, date);
  const start = minutesOfDay(own.startTime);
  if (!isNight(own) && start > end) cutoff = Math.min(cutoff, Math.max(end + 60, Math.floor((end + start) / 2)));
  return minutesOfDay(localTime.slice(11, 16)) < cutoff ? before : date;
}

/**
 * Work a day out again from its reader punches (and any app clock-ins on the
 * same shift day), then write it through the same path as every other day.
 */
export async function recomputeDeviceDay(accountId: string, orgId: string, employee: { id: string; branchId: string | null; areaId?: string | null }, date: string) {
  /* A closed month keeps its days: the punch is stored, the day does not move (and the reader is not told to resend). */
  if ((await closedMonths(orgId, [date.slice(0, 7)])).size) return null;
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

/** What a channel knows about each line besides the line: the vendor's own record and event id, and records it set aside. */
export type IngestMeta = { sources?: string[]; ids?: Array<string | null>; aside?: Array<{ original: string; reason: string; id?: string | null }> };

/** Store a batch of punch lines from one reader; returns how many were new. */
export async function ingestPunches(device: { id: string; accountId: string; orgId: string; serialNumber: string; direction: string; vendor?: string; areaId?: string | null }, body: string, meta: IngestMeta = {}) {
  const match = await pinMatcher(device.orgId);
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const all = lines.map((raw, i) => ({ raw, i, p: parseAttlogLine(raw) }));
  const parsed = all.filter((x): x is { raw: string; i: number; p: NonNullable<ReturnType<typeof parseAttlogLine>> } => Boolean(x.p));
  /* One row per batch, whatever the channel: what came, what was new, what was a repeat, what could not be read. */
  const trace = { traceId: randomUUID(), received: lines.length, rejected: lines.length - parsed.length, errors: all.filter((x) => !x.p).slice(0, 5).map((x) => x.raw.slice(0, 120)) };
  const record = (accepted: number, duplicates: number, extraRejected = 0) =>
    peoplePrisma.ingestRun
      .create({
        data: {
          accountId: device.accountId, orgId: device.orgId, deviceId: device.id, channel: device.vendor || 'ADMS', traceId: trace.traceId,
          received: trace.received, accepted, duplicates, rejected: trace.rejected + extraRejected,
          errorsJson: trace.errors.length ? JSON.stringify(trace.errors) : null,
        },
      })
      .catch((e) => console.error('[ingest-run]', e instanceof Error ? e.message : e));

  /*
   * The original of every line that becomes a punch, cannot be read, or is set
   * aside — never the repeats (counted on the run). Evidence for a dispute and
   * for certifying a reader model; deleted after 13 months (services/retention).
   */
  const parser = parserOf(device.vendor);
  const channel = device.vendor || 'ADMS';
  const evidence: any[] = [];
  const keep = (outcome: string, original: string, extra: { reason?: string; id?: string | null; pin?: string; localTime?: string }) =>
    evidence.push({
      accountId: device.accountId, orgId: device.orgId, deviceId: device.id, traceId: trace.traceId, channel, outcome, parser,
      original: original.slice(0, 8_000), payloadHash: createHash('sha256').update(original).digest('hex'),
      reason: extra.reason ?? null, sourceEventId: extra.id ?? null, pin: extra.pin ?? null, localTime: extra.localTime ?? null,
    });
  for (const x of all) if (!x.p) keep('REJECTED', meta.sources?.[x.i] ?? x.raw, { reason: 'Could not be read', id: meta.ids?.[x.i] });
  for (const a of meta.aside || []) keep('IGNORED', a.original, { reason: a.reason, id: a.id });
  const saveEvidence = () => (evidence.length ? peoplePrisma.readerEvent.createMany({ data: evidence }).catch((e) => console.error('[reader-event]', e instanceof Error ? e.message : e)) : null);

  const rows: any[] = [];
  for (const { raw, i, p } of parsed) {
    const at = instantOf(p.localTime);
    if (!at) {
      keep('REJECTED', meta.sources?.[i] ?? raw, { reason: 'Not a real date and time', id: meta.ids?.[i], pin: p.pin, localTime: p.localTime });
      continue;
    }
    const emp = match(p.pin, device.areaId);
    rows.push({
      accountId: device.accountId,
      orgId: device.orgId,
      deviceId: device.id,
      serialNumber: device.serialNumber,
      pin: p.pin,
      at,
      localTime: p.localTime,
      state: p.state,
      /* Sources that say in/out outright send state 0 / 1 (ClorTime vendor_ingest); from a reader, 0 alone says nothing (services/attendance/drivers.ts). */
      kind: driverOf(device.vendor).explicitDirection ? (p.state === '0' ? 'IN' : p.state === '1' ? 'OUT' : punchKind(p.state, device.direction)) : punchKind(p.state, device.direction),
      verifyMode: p.verifyMode,
      workCode: p.workCode,
      employeeId: emp?.id ?? null,
      shiftDate: null as string | null,
      raw: raw.slice(0, 300),
      _emp: emp,
      _src: { original: meta.sources?.[i] ?? raw, id: meta.ids?.[i] ?? null },
    });
  }
  if (!rows.length) {
    await saveEvidence();
    if (lines.length) await record(0, 0, parsed.length);
    return 0;
  }

  /* Readers resend (Stamp=0 asks for everything; outages replay). Only new punches change a day. */
  const fresh: typeof rows = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    /* A repeat is the same ID on the same reader at the same second — or the same person at the same second on any reader. */
    const people = [...new Set(chunk.map((r) => r.employeeId).filter(Boolean))] as string[];
    const [seen, seenPeople] = await Promise.all([
      peoplePrisma.devicePunch.findMany({ where: { orgId: device.orgId, deviceId: device.id, OR: chunk.map((r) => ({ pin: r.pin, at: r.at })) }, select: { pin: true, at: true } }),
      people.length
        ? peoplePrisma.devicePunch.findMany({ where: { orgId: device.orgId, employeeId: { in: people }, at: { in: [...new Set(chunk.map((r) => r.at.getTime()))].map((t) => new Date(t)) } }, select: { employeeId: true, at: true } })
        : [],
    ]);
    const have = new Set([...seen.map((s) => `p|${s.pin}|${s.at.getTime()}`), ...seenPeople.map((s) => `e|${s.employeeId}|${s.at.getTime()}`)]);
    for (const r of chunk) {
      const keys = [`p|${r.pin}|${r.at.getTime()}`, ...(r.employeeId ? [`e|${r.employeeId}|${r.at.getTime()}`] : [])];
      if (keys.some((k) => have.has(k))) continue;
      for (const k of keys) have.add(k);
      fresh.push(r);
    }
  }
  for (const r of fresh) keep('NEW', r._src.original, { id: r._src.id, pin: r.pin, localTime: r.localTime });
  await saveEvidence();
  if (!fresh.length) {
    await record(0, rows.length, parsed.length - rows.length);
    return 0;
  }
  await record(fresh.length, rows.length - fresh.length, parsed.length - rows.length);
  /* Shift days only for new punches: a reader resending its whole log costs one lookup per person-hour, not one per line. */
  const dayOf = new Map<string, string>();
  for (const r of fresh) {
    if (!r._emp) continue;
    const k = `${r._emp.id}|${r.localTime.slice(0, 13)}`;
    if (!dayOf.has(k)) dayOf.set(k, await shiftDayFor(device.orgId, r._emp.id, r.localTime));
    r.shiftDate = dayOf.get(k)!;
  }
  await peoplePrisma.devicePunch.createMany({ data: fresh.map(({ _emp, _src, ...r }) => r), skipDuplicates: true });
  emitWebhook(device.orgId, 'punch', {
    reader: device.serialNumber,
    punches: fresh.map((r) => ({ readerId: r.pin, employeeId: r.employeeId, time: r.localTime, direction: r.kind, verifyMode: r.verifyMode })),
  });
  /* And to any HR tool the company connected (services/hr/sync.ts); never waits. */
  void enqueuePunches(device.orgId, fresh.map((r) => ({ employeeId: r.employeeId, code: r._emp?.code || r._emp?.devicePin || null, readerId: r.pin, time: r.localTime, direction: r.kind, verifyMode: r.verifyMode })));

  const days = new Map<string, { emp: any; date: string }>();
  for (const r of fresh) if (r._emp && r.shiftDate) days.set(`${r._emp.id}|${r.shiftDate}`, { emp: r._emp, date: r.shiftDate });
  for (const { emp, date } of days.values()) {
    await recomputeDeviceDay(device.accountId, device.orgId, { id: emp.id, branchId: emp.branchId, areaId: emp.areaId }, date);
  }
  return fresh.length;
}

// ---------------------------------------------------------------------------
// Users and fingerprints / faces
// ---------------------------------------------------------------------------

type Device = { id: string; accountId: string; orgId: string; serialNumber: string; vendor?: string | null; areaId?: string | null; faceSupported?: boolean | null; fingerSupported?: boolean | null; faceMajorVer?: number | null; faceMinorVer?: number | null };

/**
 * Which readers someone belongs on. A reader given an area (a site) takes only
 * that area's staff, so a 40-site company does not fill every gate with every
 * employee; a reader with no area takes everyone. Someone with no area goes
 * to every reader — nobody is locked out by a field left blank.
 */
export const servesArea = (reader: { areaId?: string | null }, areaId: string | null | undefined) => !reader.areaId || !areaId || reader.areaId === areaId;

/** What a reader holds for a person, as it changes: from what the reader sends and from commands it confirms. */
export async function markOnReader(device: { id: string; accountId: string; orgId: string }, pin: string, change: { user?: boolean; name?: string | null; finger?: number; face?: boolean; clearFingers?: boolean; remove?: boolean }) {
  const key = { deviceId_pin: { deviceId: device.id, pin } };
  if (change.remove) {
    await peoplePrisma.deviceUser.deleteMany({ where: { deviceId: device.id, pin } });
    return;
  }
  const existing = await peoplePrisma.deviceUser.findUnique({ where: key, select: { fingers: true } });
  const data: any = {
    ...(change.name ? { name: change.name.slice(0, 120) } : {}),
    ...(change.finger !== undefined ? { fingers: addFinger(existing?.fingers || '', change.finger) } : {}),
    ...(change.clearFingers ? { fingers: '' } : {}),
    ...(change.face !== undefined ? { face: change.face } : {}),
  };
  await peoplePrisma.deviceUser.upsert({ where: key, create: { accountId: device.accountId, orgId: device.orgId, deviceId: device.id, pin, ...data }, update: data });
}

async function storeUser(device: Device, u: { pin: string; name: string | null; privilege: number | null; password: string | null; card: string | null }) {
  const pin = u.pin.slice(0, 40);
  await keepUser(device, pin, u);
  await adoptReaderUser(device, pin, u);
}

/** A name CLOR gave someone it only knew from a reader, until the reader says who they are. */
export const READER_PLACEHOLDER = 'Reader user ';

/**
 * Sync from the reader into CLOR (ClorTime processBiodataLine): someone added
 * at a reader whose ID matches no employee becomes one — named as the reader
 * names them, with the ID as their employee code — and the punches they have
 * already made are theirs. Someone CLOR knows keeps CLOR's details; a
 * placeholder name and an empty card are filled from the reader.
 */
async function adoptReaderUser(device: Device, pin: string, u: { name: string | null; card: string | null }) {
  const match = await pinMatcher(device.orgId);
  const known = match(pin, device.areaId);
  const name = String(u.name || '').trim().slice(0, 120);
  if (known) {
    const e = await peoplePrisma.employee.findUnique({ where: { id: known.id }, select: { name: true, cardNumber: true } });
    const data: any = {};
    if (name && e?.name.startsWith(READER_PLACEHOLDER)) data.name = name;
    if (u.card && u.card !== '0' && !e?.cardNumber) data.cardNumber = String(u.card).slice(0, 40);
    if (Object.keys(data).length) await peoplePrisma.employee.update({ where: { id: known.id }, data });
    return;
  }
  const settings = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId: device.orgId }, select: { readerUsersBecomeEmployees: true } });
  if (settings && !settings.readerUsersBecomeEmployees) return;
  let employee;
  try {
    employee = await peoplePrisma.employee.create({
      data: {
        accountId: device.accountId,
        orgId: device.orgId,
        code: pin,
        name: name || `${READER_PLACEHOLDER}${pin}`,
        status: 'ACTIVE',
        ...(u.card && u.card !== '0' ? { cardNumber: String(u.card).slice(0, 40) } : {}),
        createdByUserId: 'reader',
      } as any,
    });
  } catch {
    /* Two readers reporting the same new person at once: the other one made it. */
    return;
  }
  await attachPunchesTo(device.accountId, device.orgId, employee, pin);
  await peoplePrisma.biometricTemplate.updateMany({ where: { orgId: device.orgId, scope: '', pin, employeeId: null }, data: { employeeId: employee.id } });
  /* …and on to the company's other readers. */
  const others = (await peoplePrisma.attendanceDevice.findMany({ where: { orgId: device.orgId, isActive: true, vendor: { in: vendorsWith('templates') }, id: { not: device.id } }, select: { id: true } })).length;
  if (others) await pushEmployeeToReaders(device.orgId, employee, null, undefined, device.id);
}

/**
 * Punches already made under a reader ID now belong to this employee: each is
 * given its shift day and the days are worked out. (Matching by hand, and a
 * reader user becoming an employee, both end here.)
 */
export async function attachPunchesTo(accountId: string, orgId: string, employee: { id: string; branchId: string | null; areaId?: string | null }, pin: string, siteAreaId?: string | null) {
  /* A site ID claims only the punches made on that site's readers. */
  const readers = siteAreaId ? (await peoplePrisma.attendanceDevice.findMany({ where: { orgId, areaId: siteAreaId }, select: { id: true } })).map((d) => d.id) : null;
  const punches = await peoplePrisma.devicePunch.findMany({ where: { orgId, pin, employeeId: null, ...(readers ? { deviceId: { in: readers } } : {}) }, select: { id: true, localTime: true } });
  const days = new Set<string>();
  for (const p of punches) {
    const shiftDate = await shiftDayFor(orgId, employee.id, p.localTime);
    await peoplePrisma.devicePunch.update({ where: { id: p.id }, data: { employeeId: employee.id, shiftDate } });
    days.add(shiftDate);
  }
  for (const date of days) await recomputeDeviceDay(accountId, orgId, employee, date);
  return { matched: punches.length, days: days.size };
}

async function keepUser(device: Device, pin: string, u: { name: string | null; privilege: number | null; password: string | null; card: string | null }) {
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

/**
 * The user record to send with a template: the name and card as the reader it
 * came from holds them, else the employee's. Administrator rights and the door
 * PIN only ever come from CLOR's employee file: a reader is known by its serial
 * number alone, so what "a reader" reports must never become admin rights or a
 * known door PIN on every other reader of the company.
 */
async function userFor(orgId: string, pin: string, preferDeviceId?: string, match?: Awaited<ReturnType<typeof pinMatcher>>, areaId?: string | null) {
  const held = await peoplePrisma.deviceUser.findMany({ where: { orgId, pin }, orderBy: { updatedAt: 'desc' } });
  const u = held.find((h) => h.deviceId === preferDeviceId) || held[0];
  const emp = (match ?? (await pinMatcher(orgId)))(pin, areaId);
  const file = emp
    ? await peoplePrisma.employee.findUnique({ where: { id: emp.id }, select: { name: true, cardNumber: true, devicePassword: true, devicePrivilege: true } })
    : null;
  return {
    name: u?.name || file?.name || 'Unknown',
    privilege: file?.devicePrivilege ?? 0,
    password: file?.devicePassword ?? '',
    card: file?.cardNumber || u?.card || '',
  };
}

/**
 * A user record still waiting for a reader is replaced by a newer one, so the
 * latest name, card and PIN win (a record queued when the employee was created
 * must not stand in for the one carrying the card a reader enrolled later).
 * Ones already sent are left alone.
 */
const supersedeUserInfo = (deviceId: string, pin: string) =>
  peoplePrisma.deviceCommand.deleteMany({ where: { deviceId, status: 'PENDING', OR: [{ command: { startsWith: `DATA UPDATE USERINFO PIN=${admsField(pin)}\t` } }, { command: { startsWith: `config-id=10 user-id=${pin} ` } }] } });

/* Templates travel only between ADMS readers; a Matrix controller enrols at the door. */
const supports = (target: Device, type: number) =>
  target.vendor !== 'MATRIX_COSEC' && !(type === FACE && target.faceSupported === false) && !(type === FINGER && target.fingerSupported === false);

/**
 * Queue one person's templates onto one reader: their user record first
 * (unless one is already on its way), then each template in order.
 */
async function queueOnto(target: Device, pin: string, templates: Template[], user: Awaited<ReturnType<typeof userFor>>, createdByUserId: string | null) {
  const usable = templates.filter((t) => supports(target, t.type));
  if (!usable.length) return 0;
  const userCmd = userCommandFor(target.vendor, pin, user.name, user);
  await supersedeUserInfo(target.id, pin);
  const rows = [{ seq: SEQ.USER, command: userCmd }, ...usable.flatMap((t) => templateCommands(t, target))];
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
  const emp = match(pin, device.areaId);
  /* A site ID's fingerprints are kept apart from the same number elsewhere in the company. */
  const scope = match.isSiteId(pin, device.areaId) ? String(device.areaId) : '';
  /* The face algorithm this reader runs, learnt from what it sends. */
  if (t.type === FACE && t.majorVer > 0 && (device.faceMajorVer !== t.majorVer || device.faceMinorVer !== t.minorVer)) {
    await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { faceMajorVer: t.majorVer, faceMinorVer: t.minorVer || null, faceSupported: true } });
  }
  /* This reader certainly has it, whatever CLOR may keep. */
  if (t.type === FINGER) await markOnReader(device, pin, { finger: t.no });
  else if (t.type === FACE) await markOnReader(device, pin, { face: true });
  /* DPDP: a copy only when the company switched copying on, and never for someone who withdrew or is under 18. */
  const policy = await biometricPolicy(device.orgId);
  if (!policy.allows(emp?.id)) return;
  const key = { orgId_scope_pin_type_no: { orgId: device.orgId, scope, pin, type: t.type, no: t.no } };
  const existing = await peoplePrisma.biometricTemplate.findUnique({ where: key, select: { data: true } });
  const changed = !existing || openTemplate(existing.data) !== t.data;
  const values = { data: sealTemplate(t.data), valid: t.valid, duress: t.duress, majorVer: t.majorVer, minorVer: t.minorVer, format: t.format, indexNo: t.indexNo, sourceDeviceId: device.id, employeeId: emp?.id ?? null };
  await peoplePrisma.biometricTemplate.upsert({
    where: key,
    create: { accountId: device.accountId, orgId: device.orgId, scope, pin, type: t.type, no: t.no, ...values },
    update: values,
  });
  if (!changed) return;
  for (const target of await otherReaders(device)) {
    if (emp) {
      /* A known person goes to the readers that serve them, under the ID they have on each. */
      if (!servesArea(target, emp.areaId)) continue;
      const there = match.pinFor(emp, target.areaId);
      if (!there) continue;
      await queueOnto(target, there, [{ ...t, pin: there }], await userFor(device.orgId, there, there === pin ? device.id : undefined, match, target.areaId), null);
    } else if (!scope && !match(pin, target.areaId)) {
      /* An ID nobody has yet travels as it is, but never onto a reader where that number is someone else. */
      await queueOnto(target, pin, [{ ...t, pin }], await userFor(device.orgId, pin, device.id, match, target.areaId), null);
    }
  }
}

/**
 * Put one person on one reader as CLOR has them: their user record (card from
 * the employee file, else as a reader holds it; door PIN and privilege from the
 * employee file only — see userFor) and whichever of their fingerprints and
 * face this reader lacks.
 */
export async function sendPersonTo(target: Device, employee: { name: string; cardNumber?: string | null; devicePassword?: string | null; devicePrivilege?: number | null }, pin: string, templates: Template[], createdByUserId: string | null) {
  const held = await peoplePrisma.deviceUser.findFirst({ where: { orgId: target.orgId, pin }, orderBy: { updatedAt: 'desc' } });
  const rows = [
    {
      seq: SEQ.USER as number,
      command: userCommandFor(target.vendor, pin, employee.name, {
        privilege: employee.devicePrivilege ?? 0,
        password: employee.devicePassword ?? '',
        card: employee.cardNumber ?? held?.card ?? '',
      }),
    },
    ...templates.filter((t) => supports(target, t.type)).flatMap((t) => templateCommands({ ...t, pin }, target)),
  ];
  await supersedeUserInfo(target.id, pin);
  await peoplePrisma.deviceCommand.createMany({
    data: rows.map((r) => ({ accountId: target.accountId, orgId: target.orgId, deviceId: target.id, serialNumber: target.serialNumber, command: r.command, sequence: r.seq, createdByUserId })),
  });
  return rows.length;
}

export { supports as readerSupports };

/** Copy every stored template of people still employed (and of reader IDs not yet matched) onto one reader. */
export async function copyAllTemplatesTo(target: Device, createdByUserId: string | null) {
  const policy = await biometricPolicy(target.orgId);
  const templates = await peoplePrisma.biometricTemplate.findMany({ where: { orgId: target.orgId, scope: { in: ['', target.areaId || ''] }, ...sendableWhere(policy) }, orderBy: [{ pin: 'asc' }, { type: 'asc' }, { no: 'asc' }] });
  const people = await peoplePrisma.employee.findMany({ where: { orgId: target.orgId }, select: { id: true, status: true, areaId: true, devicePin: true, code: true } });
  const byId = new Map(people.map((e) => [e.id, e]));
  const left = new Set(people.filter((e) => e.status === 'LEFT').map((e) => e.id));
  const elsewhere = new Set(people.filter((e) => !servesArea(target, e.areaId)).map((e) => e.id));
  const match = await pinMatcher(target.orgId);
  /* One set per person (a person may have prints stored under a company and a site ID), else per unknown ID. */
  const groups = new Map<string, { pin: string; list: Map<string, Template> }>();
  for (const t of templates) {
    if (t.employeeId && (left.has(t.employeeId) || elsewhere.has(t.employeeId))) continue;
    const emp = t.employeeId ? byId.get(t.employeeId) : null;
    const pin = emp ? match.pinFor(emp, target.areaId) : t.pin;
    if (!pin || (!emp && match(t.pin, target.areaId))) continue;
    const k = emp ? `e:${emp.id}` : `p:${t.pin}`;
    if (!groups.has(k)) groups.set(k, { pin, list: new Map() });
    const g = groups.get(k)!;
    const slot = `${t.type}|${t.no}`;
    if (!g.list.has(slot) || t.scope) g.list.set(slot, { ...t, pin });
  }
  let commands = 0;
  for (const g of groups.values()) commands += await queueOnto(target, g.pin, [...g.list.values()], await userFor(target.orgId, g.pin, undefined, match, target.areaId), createdByUserId);
  return { people: groups.size, commands };
}

/**
 * Someone left: take them off every reader (templates, then the user) and
 * delete their stored fingerprints and faces — door access ends with
 * employment, and biometric data is not kept longer than it is needed.
 */
export async function revokeFromReaders(orgId: string, employee: { id: string; code: string | null; devicePin: string | null }, createdByUserId: string | null) {
  const match = await pinMatcher(orgId);
  const templates = await peoplePrisma.biometricTemplate.findMany({ where: { orgId, employeeId: employee.id }, select: { pin: true, scope: true } });
  const readers = await peoplePrisma.attendanceDevice.findMany({ where: { orgId, isActive: true } });
  /* On each reader, only the IDs that are this person there: at another site the same number may be someone else. */
  const pinsAt = new Map<string, Set<string>>();
  for (const r of readers) {
    const set = new Set<string>();
    const own = match.pinFor(employee, r.areaId);
    if (own) set.add(own);
    for (const t of templates) if ((t.scope === '' || t.scope === r.areaId) && (match(t.pin, r.areaId)?.id ?? employee.id) === employee.id) set.add(t.pin);
    pinsAt.set(r.id, set);
  }
  const all = new Set([...pinsAt.values()].flatMap((x) => [...x]));
  if (!all.size) return { readers: 0, pins: 0 };
  /*
   * Anything still waiting to go to a reader for them goes first: the removals
   * below are handed out before fingerprint copies (lower sequence), so a copy
   * left in the queue would put a leaver's fingerprint back after removal.
   */
  const waiting = await peoplePrisma.deviceCommand.findMany({ where: { orgId, status: 'PENDING' }, select: { id: true, deviceId: true, command: true } });
  const pinOf = (c: string) => /\b(?:PIN|Pin)=([^\t]*)/.exec(c)?.[1] ?? /\buser-id=([^ ]+)/.exec(c)?.[1] ?? '';
  const theirs = waiting.filter((c) => pinsAt.get(c.deviceId)?.has(pinOf(c.command))).map((c) => c.id);
  if (theirs.length) await peoplePrisma.deviceCommand.deleteMany({ where: { id: { in: theirs } } });
  for (const r of readers) {
    const pins = [...(pinsAt.get(r.id) || [])];
    if (!pins.length) continue;
    await peoplePrisma.deviceCommand.createMany({
      data: pins.flatMap((pin) => removalCommandsFor(r.vendor, pin).map((command) => ({ accountId: r.accountId, orgId, deviceId: r.id, serialNumber: r.serialNumber, command, sequence: SEQ.USER, createdByUserId }))),
    });
    await peoplePrisma.deviceUser.deleteMany({ where: { orgId, deviceId: r.id, pin: { in: pins } } });
  }
  const company = String(employee.devicePin || employee.code || '').trim();
  await peoplePrisma.biometricTemplate.deleteMany({ where: { orgId, OR: [{ employeeId: employee.id }, ...(company ? [{ employeeId: null, scope: '', pin: company }] : [])] } });
  return { readers: readers.length, pins: all.size };
}

/**
 * Someone's ID at one site changed (a site ID given, changed or taken away):
 * that site's readers drop the ID they knew them by and get them under the new
 * one, with their fingerprints and face. `oldPin` is the ID they had there.
 */
export async function moveIdAtSite(orgId: string, employeeId: string, areaId: string, oldPin: string, createdByUserId: string | null) {
  const match = await pinMatcher(orgId);
  const emp = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId } });
  if (!emp) return { readers: 0 };
  const pin = match.pinFor(emp, areaId);
  const readers = await peoplePrisma.attendanceDevice.findMany({ where: { orgId, areaId, isActive: true, vendor: { in: vendorsWith('users') } } });
  const stored = (await biometricPolicy(orgId)).allows(employeeId) ? await peoplePrisma.biometricTemplate.findMany({ where: { orgId, employeeId }, orderBy: [{ type: 'asc' }, { no: 'asc' }] }) : [];
  const templates = [...new Map(stored.map((t) => [`${t.type}|${t.no}`, t])).values()];
  for (const r of readers) {
    if (oldPin && oldPin !== pin) {
      await peoplePrisma.deviceCommand.createMany({
        data: removalCommandsFor(r.vendor, oldPin).map((command) => ({ accountId: r.accountId, orgId, deviceId: r.id, serialNumber: r.serialNumber, command, sequence: SEQ.USER, createdByUserId })),
      });
      await peoplePrisma.deviceUser.deleteMany({ where: { orgId, deviceId: r.id, pin: oldPin } });
    }
    if (pin && emp.status !== 'LEFT' && servesArea(r, emp.areaId)) await sendPersonTo(r, emp, pin, templates.map((t) => ({ ...t, pin })), createdByUserId);
  }
  return { readers: readers.length };
}

/** Did anything a reader holds change: the ID, name, card, PIN or privilege? */
export const readerFieldsChanged = (before: any, after: any) =>
  ['code', 'devicePin', 'name', 'cardNumber', 'devicePassword', 'devicePrivilege', 'areaId'].some((k) => (before?.[k] ?? null) !== (after?.[k] ?? null)) ||
  (before?.status === 'LEFT' && after?.status !== 'LEFT');

/**
 * Put one employee on every reader of the company (ClorTime: POST/PUT
 * /api/employees and rehire queue DATA UPDATE USERINFO to all readers). Their
 * Reader ID, else their employee code. A card not set in CLOR is taken from
 * what a reader already holds, so pushing never wipes one enrolled at a reader.
 * If their ID changed, the old ID is taken off the readers first.
 */
export async function pushEmployeeToReaders(orgId: string, employee: any, createdByUserId: string | null, before?: any, skipDeviceId?: string) {
  const match = await pinMatcher(orgId);
  /* The ID they have on each reader: a site ID there, else the company one (services/attendance/readerIds.ts). */
  const pinAt = (r: { areaId?: string | null }) => match.pinFor(employee, r.areaId);
  const oldAt = (r: { areaId?: string | null }) => (before ? match.pinFor(before, r.areaId) : '');
  const all = await peoplePrisma.attendanceDevice.findMany({ where: { orgId, isActive: true, vendor: { in: vendorsWith('users') } } });
  if (!all.some((r) => pinAt(r) || oldAt(r))) return { readers: 0 };
  const readers = all.filter((r) => servesArea(r, employee.areaId) && r.id !== skipDeviceId);
  /* Moved to another site: off the readers that no longer serve them. */
  if (before && (before.areaId ?? null) !== (employee.areaId ?? null)) {
    for (const r of all.filter((x) => servesArea(x, before.areaId) && !servesArea(x, employee.areaId))) {
      const pins = [...new Set([oldAt(r), pinAt(r)].filter(Boolean))];
      await peoplePrisma.deviceCommand.createMany({
        data: pins.flatMap((p) => removalCommandsFor(r.vendor, p).map((command) => ({ accountId: r.accountId, orgId, deviceId: r.id, serialNumber: r.serialNumber, command, sequence: SEQ.USER, createdByUserId }))),
      });
    }
  }
  if (!readers.length) return { readers: 0 };
  /* Readers that did not serve them before (a new site) get their fingerprints and face too. */
  const movedSite = before && (before.areaId ?? null) !== (employee.areaId ?? null);
  const policy = movedSite ? await biometricPolicy(orgId) : null;
  const stored = movedSite && employee.id && policy?.allows(employee.id) ? await peoplePrisma.biometricTemplate.findMany({ where: { orgId, employeeId: employee.id }, orderBy: [{ type: 'asc' }, { no: 'asc' }] }) : [];
  const templates = [...new Map(stored.map((t) => [`${t.type}|${t.no}`, t])).values()];
  for (const r of readers) {
    const pin = pinAt(r);
    const oldPin = oldAt(r);
    const rows: Array<{ command: string; sequence: number }> = [];
    if (oldPin && oldPin !== pin) for (const c of removalCommandsFor(r.vendor, oldPin)) rows.push({ command: c, sequence: SEQ.USER });
    if (pin) {
      const held = await peoplePrisma.deviceUser.findFirst({ where: { orgId, pin }, orderBy: { updatedAt: 'desc' } });
      await supersedeUserInfo(r.id, pin);
      rows.push({
        /* Privilege and door PIN from the employee file only (see userFor); a card enrolled at a reader is kept. */
        command: userCommandFor(r.vendor, pin, employee.name, {
          privilege: employee.devicePrivilege ?? 0,
          password: employee.devicePassword ?? '',
          card: employee.cardNumber ?? held?.card ?? '',
        }),
        sequence: SEQ.USER,
      });
    }
    await peoplePrisma.deviceCommand.createMany({
      data: rows.map((x) => ({ accountId: r.accountId, orgId, deviceId: r.id, serialNumber: r.serialNumber, command: x.command, sequence: x.sequence, createdByUserId })),
    });
    if (pin && templates.length && !servesArea(r, before.areaId)) {
      const extra = templates.filter((t) => supports(r, t.type)).flatMap((t) => templateCommands({ ...t, pin }, r));
      if (extra.length) {
        await peoplePrisma.deviceCommand.createMany({
          data: extra.map((x) => ({ accountId: r.accountId, orgId, deviceId: r.id, serialNumber: r.serialNumber, command: x.command, sequence: x.seq, createdByUserId })),
        });
      }
    }
  }
  return { readers: readers.length };
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
  const midnight = new Date(`${new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)}T00:00:00+05:30`);
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
    if (!(await isFeatureEnabled(d.accountId, d.orgId, 'attendance'))) continue;
    try {
      added += (await syncVendorConnection(d, opts)).added;
    } catch (e: any) {
      await peoplePrisma.attendanceDevice.update({ where: { id: d.id }, data: { lastError: String(e?.message || e).slice(0, 300) } }).catch(() => undefined);
    }
  }
  return { connections: devices.length, added };
}
