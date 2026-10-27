import type { Prisma } from '../../generated/people/index.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { isFeatureEnabled } from '../features.js';
import { istDate, istInstant, istTime } from './compute.js';
import { VERIFY_MODES } from './adms.js';
import { CLOCK_WARN_SEC } from './readerHealth.js';

/**
 * Per-day reader trust (closure audit O-11, TLA-005), an optional company
 * feature (attendanceReaderTrust), off by default.
 *
 * Some companies must show that a day's punches are genuine: an inspector, a
 * dispute, a labour court. Each time a day is written (days.ts writeDay, which
 * the reader recompute path also goes through) it is given one of:
 *
 *  - TRUSTED: every punch came from a registered reader that was online, with
 *    its clock right, and reached CLOR inside the late-upload window.
 *  - CHECK: at least one punch needs a look — it arrived late, its reader was
 *    offline that day or its clock had drifted, a phone punch was made outside
 *    every work site, or it came from a reader CLOR does not know.
 *  - MANUAL: a person wrote the day — by hand, an import, a correction or a
 *    request, or leave — and the reasons say which and who.
 *
 * Off, nothing here runs and the two columns stay null. Nothing here changes
 * how a day is scored; it only says how far its punches can be relied on.
 */

export const READER_TRUST = 'attendanceReaderTrust';
export const TRUST_LEVELS = ['TRUSTED', 'CHECK', 'MANUAL'] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];
export const DEFAULT_LATE_UPLOAD_HOURS = 24;

/** A reader punch on a day already decided by hand: kept off the day, raised for HR (Exception Center). */
export const PUNCH_ON_DECIDED = 'READER_PUNCH_ON_DECIDED_DAY';

export type TrustReason = {
  code: string;
  text: string;
  /** Who wrote the day, for MANUAL. */
  by?: string | null;
  byUserId?: string | null;
  deviceId?: string | null;
  serialNumber?: string | null;
  /** The punch concerned (IST HH:MM) and when it reached CLOR. */
  time?: string | null;
  receivedAt?: string | null;
  count?: number;
  lastAt?: string | null;
};
export type DayTrust = { trust: TrustLevel; reasons: TrustReason[] };

export type TrustPunch = {
  at: Date;
  createdAt: Date;
  deviceId: string;
  serialNumber?: string | null;
  verifyMode?: number | null;
  latitude?: number | null;
  geofenceId?: string | null;
  outsideSite?: boolean | null;
};
export type TrustDevice = {
  id: string;
  name: string;
  serialNumber: string;
  vendor: string;
  isActive: boolean;
  clockOffsetSec: number | null;
  clockCheckedAt: Date | null;
};
export type TrustAlert = { deviceId: string | null; kind: string; openedAt: Date; resolvedAt: Date | null };

const MANUAL_SOURCE: Record<string, { code: string; words: string }> = {
  MANUAL: { code: 'BY_HAND', words: 'Written by hand' },
  IMPORT: { code: 'IMPORT', words: 'Imported from a spreadsheet' },
  REQUEST: { code: 'CORRECTION', words: 'Written from an approved correction' },
  LEAVE: { code: 'LEAVE', words: 'Written from approved leave' },
};
const REQUEST_KIND: Record<string, string> = {
  WFH: 'Written from an approved work-from-home request',
  ON_DUTY: 'Written from an approved on-duty request',
  PERMISSION: 'Written from an approved permission request',
};

/** How a punch was verified, in plain words: finger, face, card, phone. */
export const methodOf = (verifyMode: number | null | undefined, vendor?: string | null) =>
  vendor === 'MOBILE' || verifyMode === 100 ? 'Phone' : VERIFY_MODES[Number(verifyMode ?? -1)] || 'Other';

const hours = (ms: number) => {
  const h = ms / 3_600_000;
  return h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
};

/**
 * The trust of one day from what is known about it. Pure, so each rule is
 * tested alone (attendanceTrust.test.ts).
 */
export function assessTrust(input: {
  source: string;
  dayKind?: string | null;
  by?: string | null;
  byUserId?: string | null;
  punches: TrustPunch[];
  /** App clock-ins on the day (not from a reader). */
  clocks?: Array<{ at: Date }>;
  devices: Map<string, TrustDevice>;
  alerts: TrustAlert[];
  lateUploadHours: number;
  /** The span of the day: its date, IST midnight to midnight, stretched to its last punch. */
  window: { start: Date; end: Date };
}): DayTrust {
  const manual = MANUAL_SOURCE[input.source];
  if (manual) {
    const words = input.source === 'REQUEST' && input.dayKind && REQUEST_KIND[input.dayKind] ? REQUEST_KIND[input.dayKind] : manual.words;
    return { trust: 'MANUAL', reasons: [{ code: manual.code, text: `${words}${input.by ? ` by ${input.by}` : ''}.`, by: input.by ?? null, byUserId: input.byUserId ?? null }] };
  }
  if (input.source !== 'DEVICE' && input.source !== 'CLOCK') {
    return { trust: 'MANUAL', reasons: [{ code: 'OTHER', text: `Set by ${input.source.toLowerCase()}${input.by ? `, ${input.by}` : ''}.`, by: input.by ?? null, byUserId: input.byUserId ?? null }] };
  }

  const reasons: TrustReason[] = [];
  const lateMs = Math.max(1, input.lateUploadHours) * 3_600_000;
  const flagged = new Set<string>();
  const once = (key: string, r: TrustReason) => {
    if (flagged.has(key)) return;
    flagged.add(key);
    reasons.push(r);
  };
  const overlaps = (a: TrustAlert) => a.openedAt <= input.window.end && (!a.resolvedAt || a.resolvedAt >= input.window.start);

  for (const p of input.punches) {
    const d = input.devices.get(p.deviceId);
    const time = istTime(p.at);
    const serial = d?.serialNumber ?? p.serialNumber ?? null;
    if (!d || !d.isActive) {
      once(`unknown:${p.deviceId}`, { code: 'UNKNOWN_READER', text: `Punch at ${time} came from a reader that is not registered${serial ? ` (${serial})` : ''}.`, deviceId: p.deviceId, serialNumber: serial, time });
      continue;
    }
    const phone = d.vendor === 'MOBILE' || p.verifyMode === 100;
    const delay = p.createdAt.getTime() - p.at.getTime();
    if (delay > lateMs) {
      reasons.push({ code: 'LATE_UPLOAD', text: `Punch at ${time} reached CLOR ${hours(delay)} after it was made (the window is ${input.lateUploadHours} h).`, deviceId: d.id, serialNumber: serial, time, receivedAt: p.createdAt.toISOString() });
    }
    if (phone) {
      if (p.outsideSite || (p.latitude != null && !p.geofenceId)) {
        reasons.push({ code: 'OUTSIDE_GEOFENCE', text: `Phone punch at ${time} was made outside every work site.`, deviceId: d.id, serialNumber: serial, time });
      }
      /* A phone punch carries the server's time, and a phone is not a reader that goes offline. */
      continue;
    }
    if (input.alerts.some((a) => a.deviceId === d.id && a.kind === 'offline' && overlaps(a))) {
      once(`offline:${d.id}`, { code: 'READER_OFFLINE', text: `${d.name} was offline that day.`, deviceId: d.id, serialNumber: serial });
    }
    const drifted =
      input.alerts.some((a) => a.deviceId === d.id && a.kind === 'clock' && overlaps(a)) ||
      (d.clockOffsetSec != null && Math.abs(d.clockOffsetSec) >= CLOCK_WARN_SEC && d.clockCheckedAt != null && d.clockCheckedAt >= input.window.start && d.clockCheckedAt <= input.window.end);
    if (drifted) {
      once(`clock:${d.id}`, { code: 'CLOCK_DRIFT', text: `${d.name}’s clock was out${d.clockOffsetSec != null ? ` by about ${Math.round(Math.abs(d.clockOffsetSec) / 60)} min` : ''} that day.`, deviceId: d.id, serialNumber: serial });
    }
  }
  for (const c of input.clocks || []) {
    once('clock-app', { code: 'NOT_A_READER', text: `Clocked ${istTime(c.at)} in the app, not at a reader.`, time: istTime(c.at) });
  }
  if (!input.punches.length && !(input.clocks || []).length) {
    reasons.push({ code: 'NO_PUNCHES', text: 'No punches were found for this day.' });
  }
  if (reasons.length) return { trust: 'CHECK', reasons };
  const n = input.punches.length;
  return { trust: 'TRUSTED', reasons: [{ code: 'READERS_OK', text: `${n} punch${n === 1 ? '' : 'es'} from registered readers, online with the clock right, received in time.`, count: n }] };
}

// ---------------------------------------------------------------------------
// Reading what a day's trust is worked out from
// ---------------------------------------------------------------------------

/** Whether the company has the feature on (off by default; needs Attendance). */
export const readerTrustOn = (accountId: string, orgId: string) => isFeatureEnabled(accountId, orgId, READER_TRUST);

export async function lateUploadHours(orgId: string) {
  const s = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { readerLateUploadHours: true } });
  return s?.readerLateUploadHours ?? DEFAULT_LATE_UPLOAD_HOURS;
}

/** Who a user id is, in words, for "written by hand by …". */
export async function actorLabel(userId: string | null | undefined) {
  if (!userId) return null;
  if (userId === 'reader') return 'reader punches';
  if (userId === 'system') return 'CLOR';
  if (userId.startsWith('portal:')) return 'the employee (portal)';
  const u = await platformPrisma.user.findUnique({ where: { id: userId }, select: { fullName: true, email: true } }).catch(() => null);
  return u?.fullName || u?.email || 'a user';
}

/** The punches that count on a day (as recomputeDeviceDay reads them), and the readers and alerts around them. */
export async function dayFacts(orgId: string, employeeId: string, date: string) {
  const [punches, clocks] = await Promise.all([
    peoplePrisma.devicePunch.findMany({
      where: { orgId, employeeId, shiftDate: date, OR: [{ reviewStatus: null }, { reviewStatus: 'APPROVED' }] },
      select: { id: true, at: true, createdAt: true, deviceId: true, serialNumber: true, verifyMode: true, latitude: true, longitude: true, geofenceId: true, outsideSite: true, kind: true, pin: true, localTime: true, reviewStatus: true },
      orderBy: { at: 'asc' },
    }),
    peoplePrisma.attendanceActivity.findMany({
      where: { orgId, employeeId, source: 'CLOCK', at: { gte: istInstant(date, '00:00'), lt: istInstant(date, '12:00', 1) } },
      select: { at: true, kind: true, createdAt: true },
      orderBy: { at: 'asc' },
    }),
  ]);
  const start = istInstant(date, '00:00');
  const last = punches.reduce((m, p) => Math.max(m, p.at.getTime()), 0);
  const end = new Date(Math.max(istInstant(date, '00:00', 1).getTime(), last));
  const ids = [...new Set(punches.map((p) => p.deviceId))];
  const [devices, alerts] = ids.length
    ? await Promise.all([
        peoplePrisma.attendanceDevice.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, serialNumber: true, vendor: true, isActive: true, clockOffsetSec: true, clockCheckedAt: true } }),
        peoplePrisma.readerAlert.findMany({
          where: { orgId, deviceId: { in: ids }, kind: { in: ['offline', 'clock'] }, openedAt: { lte: end }, OR: [{ resolvedAt: null }, { resolvedAt: { gte: start } }] },
          select: { deviceId: true, kind: true, openedAt: true, resolvedAt: true },
        }),
      ])
    : [[], []];
  return { punches, clocks, devices: new Map(devices.map((d) => [d.id, d])), alerts, window: { start, end } };
}

/** The trust of a day about to be written. */
export async function trustForDay(o: { orgId: string; employeeId: string; date: string; source: string; userId: string; dayKind?: string | null; lateHours?: number }) {
  const manual = Boolean(MANUAL_SOURCE[o.source]) || (o.source !== 'DEVICE' && o.source !== 'CLOCK');
  const by = await actorLabel(o.userId);
  if (manual) return assessTrust({ source: o.source, dayKind: o.dayKind, by, byUserId: o.userId, punches: [], devices: new Map(), alerts: [], lateUploadHours: 24, window: { start: new Date(), end: new Date() } });
  const [facts, late] = await Promise.all([dayFacts(o.orgId, o.employeeId, o.date), o.lateHours ?? lateUploadHours(o.orgId)]);
  return assessTrust({ source: o.source, by, byUserId: o.userId, punches: facts.punches, clocks: facts.clocks, devices: facts.devices, alerts: facts.alerts, lateUploadHours: late, window: facts.window });
}

/** A day's reasons as stored, read back safely. */
export const reasonsOf = (v: unknown): TrustReason[] => (Array.isArray(v) ? (v as TrustReason[]).filter((r) => r && typeof r === 'object' && typeof r.code === 'string') : []);

/** The marker for punches that reached a day decided by hand, carried over when the day is written by hand again. */
export const decidedMarker = (v: unknown) => reasonsOf(v).filter((r) => r.code === PUNCH_ON_DECIDED);

export const asJson = (r: TrustReason[]) => r as unknown as Prisma.InputJsonValue;

/**
 * A reader punch reached a day someone decided by hand (a correction, a
 * request, leave, a hand entry). The day is not rewritten — that stays as it
 * was — but with the feature on HR is told, so they can decide (Exception
 * Center: "Reader punch on a day marked by hand"). Only punches that arrived
 * after the day was last written by hand count, so recalculating old days
 * does not raise it again.
 */
export async function notePunchOnDecidedDay(accountId: string, orgId: string, record: { id: string; employeeId: string; date: string; updatedAt: Date; trustReasons: unknown }) {
  if (!(await readerTrustOn(accountId, orgId))) return null;
  const lastWrite = await peoplePrisma.attendanceRecordHistory.findFirst({
    where: { orgId, employeeId: record.employeeId, date: record.date, action: { in: ['WRITE', 'BULK'] } },
    orderBy: { at: 'desc' },
    select: { at: true },
  });
  const since = lastWrite?.at ?? record.updatedAt;
  const punches = await peoplePrisma.devicePunch.findMany({
    where: { orgId, employeeId: record.employeeId, shiftDate: record.date, createdAt: { gt: since } },
    select: { at: true },
    orderBy: { at: 'asc' },
  });
  if (!punches.length) return null;
  const times = punches.map((p) => istTime(p.at));
  const marker: TrustReason = {
    code: PUNCH_ON_DECIDED,
    text: `${punches.length} reader punch${punches.length === 1 ? '' : 'es'} (${times.join(', ')}) arrived after the day was marked by hand, and were not used.`,
    count: punches.length,
    lastAt: punches[punches.length - 1].at.toISOString(),
  };
  const rest = reasonsOf(record.trustReasons).filter((r) => r.code !== PUNCH_ON_DECIDED);
  return peoplePrisma.attendanceRecord.update({ where: { id: record.id }, data: { trustReasons: asJson([...rest, marker]) } });
}

/**
 * Work trust out again for days already written (after the feature is turned
 * on, or the window changed). Only the two trust columns change: the day, its
 * history and its validation stay as they are.
 */
export async function recomputeTrust(accountId: string, orgId: string, from: string, to: string) {
  const records = await peoplePrisma.attendanceRecord.findMany({
    where: { accountId, orgId, date: { gte: from, lte: to } },
    select: { id: true, employeeId: true, date: true, source: true, dayKind: true, trustReasons: true, createdByUserId: true },
  });
  if (!records.length) return 0;
  const late = await lateUploadHours(orgId);
  /* Who last wrote each day, from its history (the record keeps only who created it). */
  const history = await peoplePrisma.attendanceRecordHistory.findMany({
    where: { orgId, recordId: { in: records.map((r) => r.id) }, action: { in: ['WRITE', 'BULK'] } },
    orderBy: { at: 'asc' },
    select: { recordId: true, userId: true },
  });
  const writer = new Map(history.map((h) => [h.recordId, h.userId]));
  let n = 0;
  for (const r of records) {
    const t = await trustForDay({ orgId, employeeId: r.employeeId, date: r.date, source: r.source, userId: writer.get(r.id) || r.createdByUserId, dayKind: r.dayKind, lateHours: late });
    const reasons = t.trust === 'MANUAL' ? [...t.reasons, ...decidedMarker(r.trustReasons)] : t.reasons;
    await peoplePrisma.attendanceRecord.update({ where: { id: r.id }, data: { trust: t.trust, trustReasons: asJson(reasons) } });
    n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// The evidence export: every punch of a person's period, with its day's trust
// ---------------------------------------------------------------------------

export type EvidenceRow = {
  date: string;
  punchedAt: string;
  punched: string;
  receivedAt: string;
  received: string;
  delayMinutes: number;
  direction: string | null;
  readerId: string | null;
  serialNumber: string | null;
  reader: string;
  method: string;
  geofence: string;
  reviewStatus: string | null;
  dayTrust: TrustLevel | null;
  dayReasons: string;
};

const istStamp = (at: Date) => `${istDate(at)} ${new Date(at.getTime() + 330 * 60_000).toISOString().slice(11, 19)}`;

/** Every punch of a person in a period (reader, phone and app), with reader, serial, when made and when received, method, site check, and the day's trust. */
export async function evidenceRows(orgId: string, employeeId: string, from: string, to: string): Promise<EvidenceRow[]> {
  const [punches, clocks, records, fences] = await Promise.all([
    peoplePrisma.devicePunch.findMany({
      where: { orgId, employeeId, shiftDate: { gte: from, lte: to } },
      select: { at: true, createdAt: true, deviceId: true, serialNumber: true, pin: true, kind: true, verifyMode: true, latitude: true, geofenceId: true, outsideSite: true, address: true, reviewStatus: true, shiftDate: true },
      orderBy: { at: 'asc' },
    }),
    peoplePrisma.attendanceActivity.findMany({
      where: { orgId, employeeId, source: 'CLOCK', at: { gte: istInstant(from, '00:00'), lt: istInstant(to, '00:00', 1) } },
      select: { at: true, createdAt: true, kind: true },
      orderBy: { at: 'asc' },
    }),
    peoplePrisma.attendanceRecord.findMany({ where: { orgId, employeeId, date: { gte: from, lte: to } }, select: { date: true, trust: true, trustReasons: true } }),
    peoplePrisma.geofence.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  const deviceIds = [...new Set(punches.map((p) => p.deviceId))];
  const devices = new Map((deviceIds.length ? await peoplePrisma.attendanceDevice.findMany({ where: { orgId, id: { in: deviceIds } }, select: { id: true, name: true, vendor: true } }) : []).map((d) => [d.id, d]));
  const fenceName = new Map(fences.map((f) => [f.id, f.name]));
  const day = new Map(records.map((r) => [r.date, r]));
  const trustOf = (date: string) => {
    const r = day.get(date);
    return { dayTrust: (r?.trust as TrustLevel | null) ?? null, dayReasons: reasonsOf(r?.trustReasons).map((x) => x.text).join(' ') };
  };
  const rows: EvidenceRow[] = punches.map((p) => {
    const d = devices.get(p.deviceId);
    const phone = d?.vendor === 'MOBILE' || p.verifyMode === 100;
    const date = p.shiftDate || istDate(p.at);
    return {
      date,
      punchedAt: p.at.toISOString(),
      punched: istStamp(p.at),
      receivedAt: p.createdAt.toISOString(),
      received: istStamp(p.createdAt),
      delayMinutes: Math.max(0, Math.round((p.createdAt.getTime() - p.at.getTime()) / 60_000)),
      direction: p.kind,
      readerId: p.pin,
      serialNumber: p.serialNumber,
      reader: d?.name || 'Not registered',
      method: methodOf(p.verifyMode, d?.vendor),
      geofence: !phone ? 'Not a phone punch' : p.geofenceId ? `Inside ${fenceName.get(p.geofenceId) || 'a work site'}` : p.outsideSite || p.latitude != null ? `Outside every work site${p.address ? ` (${p.address})` : ''}` : 'No location',
      reviewStatus: p.reviewStatus,
      ...trustOf(date),
    };
  });
  for (const c of clocks) {
    const date = istDate(c.at);
    rows.push({
      date, punchedAt: c.at.toISOString(), punched: istStamp(c.at), receivedAt: c.createdAt.toISOString(), received: istStamp(c.createdAt),
      delayMinutes: Math.max(0, Math.round((c.createdAt.getTime() - c.at.getTime()) / 60_000)), direction: c.kind, readerId: null, serialNumber: null,
      reader: 'The app', method: 'App', geofence: 'Not a phone punch', reviewStatus: null, ...trustOf(date),
    });
  }
  return rows.sort((a, b) => a.punchedAt.localeCompare(b.punchedAt));
}

const CSV_COLUMNS: Array<[keyof EvidenceRow, string]> = [
  ['date', 'Day'], ['punched', 'Punched (IST)'], ['received', 'Received (IST)'], ['delayMinutes', 'Delay (min)'], ['direction', 'Direction'],
  ['readerId', 'Reader ID'], ['serialNumber', 'Reader serial'], ['reader', 'Reader'], ['method', 'Method'], ['geofence', 'Work site'],
  ['reviewStatus', 'Field punch review'], ['dayTrust', 'Day trust'], ['dayReasons', 'Why'],
];
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  /* A leading = + - @ (or tab, return) would run as a formula in a spreadsheet; a number is left alone. */
  const safe = /^[=+\-@\t\r]/.test(s) && !Number.isFinite(Number(s)) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const evidenceCsv = (rows: EvidenceRow[]) =>
  [CSV_COLUMNS.map(([, h]) => h).join(','), ...rows.map((r) => CSV_COLUMNS.map(([k]) => csvCell(r[k])).join(','))].join('\r\n') + '\r\n';
