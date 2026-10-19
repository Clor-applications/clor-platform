import { notifyPermissionOnce } from '../notifications.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { isFeatureEnabled } from '../features.js';
import { sendTemplate } from '../mailer.js';
import { istDate } from './compute.js';
import { scaleLimit } from './adms.js';
import { loadHolidays } from './schedule.js';
import { vendorsWith } from './drivers.js';
import { emit as emitWebhook } from './webhooks.js';

/** What a reader event says about the reader. */
async function readerEvent(deviceId: string | null, at: Date) {
  const d = deviceId ? await peoplePrisma.attendanceDevice.findUnique({ where: { id: deviceId }, select: { id: true, name: true, serialNumber: true, vendor: true, lastSeenAt: true, areaId: true } }) : null;
  return { deviceId, name: d?.name ?? null, serialNumber: d?.serialNumber ?? null, vendor: d?.vendor ?? null, lastSeenAt: d?.lastSeenAt ?? null, areaId: d?.areaId ?? null, at };
}

/**
 * Is each reader doing its job, and is attendance arriving at all? After
 * ClorTime's health monitor and alert checks, and the outages that shaped
 * them: a reader quietly offline for days, a clock reset to 2000 after a power
 * cut, a reader full so new staff could not be enrolled, commands it rejected
 * forever — and 145 days with no punch stored while every reader looked fine.
 *
 * `assessReader` and `assessCollection` are pure (tested alone); `runReaderChecks`
 * turns their findings into alerts that open once and close once.
 */

export type Severity = 'critical' | 'high' | 'medium';
export type Issue = { kind: string; severity: Severity; title: string; details: string };

/** A clock this far out is worth fixing; this far out it is moving people's days. */
export const CLOCK_WARN_SEC = 120;
export const CLOCK_BAD_SEC = 15 * 60;
/** Storage this full is a warning; this full and enrolment or punches start failing. */
export const FULL_WARN = 0.9;
export const FULL_BAD = 0.98;
/** A command waiting this long on a reader that is online is stuck. */
export const STUCK_MINUTES = 30;
/** A push reader (ADMS) checks in every 30 seconds; this long without one is late, though not yet offline. */
export const DELAYED_MINUTES = 3;

const mins = (ms: number) => Math.round(ms / 60_000);
const span = (minutes: number) =>
  minutes < 90 ? `${minutes} minutes` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} hours` : `${Math.round(minutes / 1440)} days`;
const clockText = (sec: number) => {
  const a = Math.abs(sec);
  const amount = a < 3600 ? `${Math.round(a / 60)} min` : a < 172_800 ? `${(a / 3600).toFixed(1)} h` : `${Math.round(a / 86_400)} days`;
  return `${amount} ${sec > 0 ? 'ahead' : 'behind'}`;
};

export type ReaderFacts = {
  id: string;
  name: string;
  isActive: boolean;
  lastSeenAt: Date | null;
  clockOffsetSec: number | null;
  vendor?: string | null;
  agentId?: string | null;
  userCount: number | null;
  fingerCount: number | null;
  faceCount: number | null;
  punchCount: number | null;
  maxUsers: number | null;
  maxFingers: number | null;
  maxFaces: number | null;
  maxPunches: number | null;
  /** False for a reader without face recognition: its face count is not a problem. */
  faceSupported?: boolean | null;
  /** Commands the reader refused or never answered, last 24 hours. */
  failed24h: number;
  /** The oldest command still waiting, if any. */
  oldestPendingAt: Date | null;
};

/** What is wrong with one reader right now, worst first. */
export function assessReader(r: ReaderFacts, now: Date, opts: { offlineMinutes: number }): Issue[] {
  if (!r.isActive) return [];
  const issues: Issue[] = [];
  if (!r.lastSeenAt) {
    issues.push({
      kind: 'never',
      severity: 'medium',
      title: `${r.name} has not connected yet`,
      details: 'Set the reader’s cloud server (ADMS) to this address and port. It appears here within a minute of connecting.',
    });
    return issues;
  }
  const silent = mins(now.getTime() - r.lastSeenAt.getTime());
  const online = silent < opts.offlineMinutes;
  /* Between "late with its check-in" and offline: only readers that push on their own; polled ones are seen when polled. */
  if (online && silent >= DELAYED_MINUTES && (r.vendor || 'ADMS') === 'ADMS' && !r.agentId) {
    issues.push({
      kind: 'delayed',
      severity: 'medium',
      title: `${r.name} is late checking in`,
      details: `Last heard ${span(silent)} ago; it normally checks in every 30 seconds. If this lasts ${span(opts.offlineMinutes)} it is counted as offline. A busy or unstable network is the usual cause.`,
    });
  }
  if (!online) {
    issues.push({
      kind: 'offline',
      severity: 'high',
      title: `${r.name} has stopped reporting`,
      details: `Nothing from this reader for ${span(silent)}. Punches made there are kept on the reader and arrive when it reconnects — check its power, network cable or Wi-Fi.`,
    });
  }
  if (r.clockOffsetSec !== null && Math.abs(r.clockOffsetSec) >= CLOCK_WARN_SEC) {
    const reset = Math.abs(r.clockOffsetSec) > 30 * 86_400;
    issues.push({
      kind: 'clock',
      severity: Math.abs(r.clockOffsetSec) >= CLOCK_BAD_SEC ? 'high' : 'medium',
      title: reset ? `${r.name}’s clock has been reset` : `${r.name}’s clock is ${clockText(r.clockOffsetSec)}`,
      details: reset
        ? `Its punches carry a date ${clockText(r.clockOffsetSec)} — usually a power cut with a flat clock battery. Set the date and time on the reader; punches already made keep the wrong time.`
        : r.agentId
          ? `Punches from it are stamped ${clockText(r.clockOffsetSec)} of the real time. The on-site connector sets its clock on its next round; if this stays, the reader refused the time (see Reader logs).`
          : r.vendor === 'MATRIX_COSEC'
          ? `Punches from it are stamped ${clockText(r.clockOffsetSec)} of the real time. CLOR sends the controller the time on its next poll; if this stays, check that it accepts configuration from the server.`
          : `Punches from it are stamped ${clockText(r.clockOffsetSec)} of the real time, so late and early marks are off. Choose "Set the time" on the reader's page in CLOR, or set it at the reader (Menu → System → Date/Time).`,
    });
  }
  const full: string[] = [];
  let worst = 0;
  for (const [what, n, max] of [
    ['users', r.userCount, r.maxUsers],
    ['fingerprints', r.fingerCount, r.maxFingers],
    ['faces', r.faceSupported === false ? null : r.faceCount, r.maxFaces],
    ['punch log', r.punchCount, r.maxPunches],
  ] as const) {
    if (n === null || !max) continue;
    const used = n / max;
    if (used >= FULL_WARN) full.push(`${what} ${n.toLocaleString('en-IN')} of ${max.toLocaleString('en-IN')}`);
    worst = Math.max(worst, used);
  }
  if (full.length) {
    issues.push({
      kind: 'full',
      severity: worst >= FULL_BAD ? 'high' : 'medium',
      title: `${r.name} is nearly full`,
      details: `${full.join('; ')}. A full reader stops enrolling — or stops keeping punches. Remove people who have left (Sync status → remove extras); a full punch log can be cleared on the reader once CLOR has every punch.`,
    });
  }
  if (r.failed24h > 0) {
    issues.push({
      kind: 'commands',
      severity: 'medium',
      title: `${r.failed24h} change${r.failed24h === 1 ? '' : 's'} did not reach ${r.name}`,
      details: 'The reader refused them or never answered. See the reader’s queue for which, and retry.',
    });
  }
  if (online && r.oldestPendingAt && now.getTime() - r.oldestPendingAt.getTime() >= STUCK_MINUTES * 60_000) {
    issues.push({
      kind: 'stuck',
      severity: 'medium',
      title: `Changes are waiting on ${r.name}`,
      details: `It is online but has not taken changes queued ${span(mins(now.getTime() - r.oldestPendingAt.getTime()))} ago. Restarting the reader usually clears it.`,
    });
  }
  const rank = { critical: 0, high: 1, medium: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** ok · warn · bad · offline — for a dot on the screen. */
export const readerStatus = (issues: Issue[]) =>
  issues.some((i) => i.kind === 'offline')
    ? 'offline'
    : issues.some((i) => i.severity !== 'medium')
      ? 'bad'
      : issues.length && issues.every((i) => i.kind === 'delayed')
        ? 'delayed'
        : issues.length
          ? 'warn'
          : 'ok';

/**
 * The outcome check (ClorTime checkNoPunches): it is a working day, the
 * morning is over, and not one punch from any reader has been stored. It does
 * not care where the chain broke. Returns null when it should not decide
 * (Sunday, a holiday, too early, a company that has never collected a punch) —
 * and then an open alert stays open rather than appearing to fix itself.
 */
export function assessCollection(f: { localHour: number; sunday: boolean; holiday: boolean; afterHour: number; punchesToday: number; everPunched: boolean; lastPunchAt: Date | null }, now: Date): Issue[] | null {
  if (!f.everPunched || f.sunday || f.holiday || f.localHour < f.afterHour) return null;
  if (f.punchesToday > 0) return [];
  const ago = f.lastPunchAt ? span(mins(now.getTime() - f.lastPunchAt.getTime())) : null;
  return [
    {
      kind: 'no-punches',
      severity: 'critical',
      title: 'No attendance recorded today',
      details: `Not one punch from any reader has arrived since midnight${ago ? `; the last was ${ago} ago` : ''}. Readers can look online and still have every punch fail on the way — check the readers’ cloud server setting and the network before assuming everyone is absent.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Facts from the database
// ---------------------------------------------------------------------------

export async function readerFacts(orgId: string, devices?: any[]) {
  const readers = devices || (await peoplePrisma.attendanceDevice.findMany({ where: { orgId, vendor: { in: vendorsWith('health') } }, orderBy: { name: 'asc' } }));
  const ids = readers.map((r) => r.id);
  const since = new Date(Date.now() - 86_400_000);
  const [failed, pending] = await Promise.all([
    ids.length ? peoplePrisma.deviceCommand.groupBy({ by: ['deviceId'], where: { orgId, deviceId: { in: ids }, status: 'FAILED', doneAt: { gte: since } }, _count: { _all: true } }) : [],
    ids.length ? peoplePrisma.deviceCommand.groupBy({ by: ['deviceId'], where: { orgId, deviceId: { in: ids }, status: { in: ['PENDING', 'SENT'] } }, _min: { createdAt: true }, _count: { _all: true } }) : [],
  ]);
  return readers.map((r) => {
    const p = (pending as any[]).find((x) => x.deviceId === r.id);
    return {
      device: r,
      facts: {
        id: r.id,
        name: r.name,
        isActive: r.isActive,
        lastSeenAt: r.lastSeenAt,
        clockOffsetSec: r.clockOffsetSec,
        vendor: r.vendor ?? null,
        agentId: r.agentId ?? null,
        userCount: r.userCount,
        fingerCount: r.fingerCount,
        faceCount: r.faceCount,
        punchCount: r.punchCount,
        /* Stored before limits were read in units: scaled here too (idempotent). */
        maxUsers: scaleLimit('users', r.maxUsers),
        maxFingers: scaleLimit('fingers', r.maxFingers),
        maxFaces: r.maxFaces,
        maxPunches: scaleLimit('punches', r.maxPunches),
        faceSupported: r.faceSupported,
        failed24h: (failed as any[]).find((x) => x.deviceId === r.id)?._count._all || 0,
        oldestPendingAt: p?._min.createdAt || null,
      } as ReaderFacts,
      pending: p?._count._all || 0,
    };
  });
}

export async function collectionFacts(orgId: string, afterHour: number, now = new Date()) {
  const today = istDate(now);
  const localHour = new Date(now.getTime() + 330 * 60_000).getUTCHours();
  const from = new Date(`${today}T00:00:00+05:30`);
  const [punchesToday, last, holidays] = await Promise.all([
    peoplePrisma.devicePunch.count({ where: { orgId, at: { gte: from } } }),
    peoplePrisma.devicePunch.findFirst({ where: { orgId }, orderBy: { at: 'desc' }, select: { at: true } }),
    loadHolidays(orgId, today, today),
  ]);
  return {
    localHour,
    sunday: new Date(`${today}T00:00:00Z`).getUTCDay() === 0,
    holiday: holidays.company.has(today),
    afterHour,
    punchesToday,
    everPunched: Boolean(last),
    lastPunchAt: last?.at || null,
  };
}

export const alertSettings = async (orgId: string) => {
  const s = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId } });
  return {
    alertEmails: s?.alertEmails || '',
    offlineAlertMinutes: s?.offlineAlertMinutes ?? 30,
    noPunchAfterHour: s?.noPunchAfterHour ?? 11,
  };
};

// ---------------------------------------------------------------------------
// Alerts: open once, close once
// ---------------------------------------------------------------------------

const recipientsOf = (s: string) =>
  String(s || '')
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));

async function mail(orgId: string, accountId: string, to: string[], templateKey: string, data: Record<string, unknown>) {
  if (!to.length) return { sent: false, error: null as string | null };
  try {
    for (const t of to) await sendTemplate({ templateKey, to: t, accountId, orgId, relatedType: 'ReaderAlert', data });
    return { sent: true, error: null };
  } catch (e) {
    /* Alerting never breaks attendance; a failed send is shown on the alert instead. */
    return { sent: false, error: e instanceof Error ? e.message.slice(0, 300) : 'Could not send.' };
  }
}

/**
 * Bring one company's alerts in line with what is wrong now. A problem seen
 * for the first time opens an alert (and mails it); one no longer seen is
 * closed (and the close is mailed). `skip` keys are left exactly as they are —
 * the no-punch check on a Sunday neither opens nor closes.
 */
export async function trackAlerts(org: { accountId: string; orgId: string; name: string }, found: Array<Issue & { key: string; deviceId?: string | null }>, managedKeys: (key: string) => boolean, settings: { alertEmails: string }, now = new Date()) {
  const open = await peoplePrisma.readerAlert.findMany({ where: { orgId: org.orgId, resolvedAt: null } });
  const to = recipientsOf(settings.alertEmails);
  const byKey = new Map(open.map((a) => [a.key, a]));
  let opened = 0;
  let resolved = 0;
  for (const f of found) {
    const existing = byKey.get(f.key);
    if (existing) {
      /* Still open: keep the words current (the minutes offline grow), no new mail. */
      if (existing.details !== f.details || existing.title !== f.title || existing.severity !== f.severity) {
        await peoplePrisma.readerAlert.update({ where: { id: existing.id }, data: { title: f.title, details: f.details, severity: f.severity } });
      }
      continue;
    }
    const row = await peoplePrisma.readerAlert.create({
      data: { accountId: org.accountId, orgId: org.orgId, key: f.key, kind: f.kind, deviceId: f.deviceId || null, severity: f.severity, title: f.title, details: f.details, openedAt: now },
    });
    opened += 1;
    await notifyPermissionOnce(org.accountId, org.orgId, 'ATTENDANCE::Attendance Devices::VIEW', { kind: f.kind.startsWith('connector') ? 'connector.alert' : 'reader.alert', title: f.title, body: f.details, link: { app: 'attendance', screen: 'readerHealth' }, dedupeKey: f.key });
    if (f.kind === 'offline') emitWebhook(org.orgId, 'reader.offline', await readerEvent(f.deviceId || null, now));
    const m = await mail(org.orgId, org.accountId, to, 'attendance.reader_alert', { orgName: org.name, title: f.title, details: f.details, severity: f.severity });
    if (m.sent || m.error) await peoplePrisma.readerAlert.update({ where: { id: row.id }, data: m.sent ? { notifiedAt: now } : { lastError: m.error } });
  }
  const still = new Set(found.map((f) => f.key));
  for (const a of open) {
    if (still.has(a.key) || !managedKeys(a.key)) continue;
    await peoplePrisma.readerAlert.update({ where: { id: a.id }, data: { resolvedAt: now } });
    resolved += 1;
    if (a.kind === 'offline') emitWebhook(org.orgId, 'reader.online', { ...(await readerEvent(a.deviceId, now)), offlineSince: a.openedAt });
    /* Only say it cleared if anyone was told it started. */
    if (a.notifiedAt) {
      const m = await mail(org.orgId, org.accountId, to, 'attendance.reader_alert_cleared', { orgName: org.name, title: a.title, openedFor: span(mins(now.getTime() - a.openedAt.getTime())) });
      if (m.sent || m.error) await peoplePrisma.readerAlert.update({ where: { id: a.id }, data: m.sent ? { resolvedNotifiedAt: now } : { lastError: m.error } });
    }
  }
  return { opened, resolved };
}

/**
 * On-site connectors: one going quiet silently stops every reader, Tally
 * voucher and directory sync behind it, so it is an alert like a reader's.
 */
export function assessConnector(a: { id: string; name: string; isActive: boolean; lastSeenAt: Date | null; readers: number; lastError: string | null }, now: Date, opts: { offlineMinutes: number }): Issue[] {
  if (!a.isActive) return [];
  const behind = a.readers ? ` ${a.readers} reader${a.readers === 1 ? '' : 's'} behind it ${a.readers === 1 ? 'is' : 'are'} not being read.` : '';
  if (!a.lastSeenAt) {
    return [{ kind: 'connector', severity: 'medium', title: `Connector ${a.name} has not connected yet`, details: `Run clor-agent.cjs with its token on a computer in the office (Attendance → Integrations → On-site connectors has the steps).${behind}` }];
  }
  const m = mins(now.getTime() - a.lastSeenAt.getTime());
  if (m >= opts.offlineMinutes) {
    return [{ kind: 'connector', severity: 'high', title: `Connector ${a.name} has stopped checking in`, details: `Nothing from it for ${span(m)}.${behind} Check that the computer is on and clor-agent.cjs is running.` }];
  }
  if (a.lastError) return [{ kind: 'connector-error', severity: 'medium', title: `Connector ${a.name} reports a problem`, details: a.lastError }];
  return [];
}

export async function connectorFacts(orgId: string) {
  const agents = await peoplePrisma.siteAgent.findMany({ where: { orgId, isActive: true } });
  if (!agents.length) return [];
  const counts = await peoplePrisma.attendanceDevice.groupBy({ by: ['agentId'], where: { orgId, agentId: { in: agents.map((a) => a.id) }, isActive: true }, _count: { _all: true } });
  return agents.map((a) => ({ id: a.id, name: a.name, isActive: a.isActive, lastSeenAt: a.lastSeenAt, lastError: a.lastError, readers: (counts as any[]).find((c) => c.agentId === a.id)?._count._all || 0 }));
}

/** Check every company that has readers or connectors; run every few minutes. Never throws for one company. */
export async function runReaderChecks(now = new Date()) {
  const withReaders = await peoplePrisma.attendanceDevice.groupBy({ by: ['accountId', 'orgId'], where: { vendor: { in: vendorsWith('health') }, isActive: true } });
  const withAgents = await peoplePrisma.siteAgent.groupBy({ by: ['accountId', 'orgId'], where: { isActive: true } });
  const orgs = [...new Map([...withReaders, ...withAgents].map((o) => [o.orgId, { accountId: o.accountId, orgId: o.orgId }])).values()];
  let opened = 0;
  let resolved = 0;
  for (const { accountId, orgId } of orgs) {
    try {
      if (!(await isFeatureEnabled(accountId, orgId, 'attendance'))) continue;
      const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true } });
      const settings = await alertSettings(orgId);
      const found: Array<Issue & { key: string; deviceId?: string | null }> = [];
      for (const { facts } of await readerFacts(orgId)) {
        /* "Late checking in" is shown on screen, never e-mailed: it clears itself in minutes, or becomes offline. */
        for (const i of assessReader(facts, now, { offlineMinutes: settings.offlineAlertMinutes }).filter((x) => x.kind !== 'delayed')) found.push({ ...i, key: `${i.kind}:${facts.id}`, deviceId: facts.id });
      }
      for (const a of await connectorFacts(orgId)) {
        for (const i of assessConnector(a, now, { offlineMinutes: settings.offlineAlertMinutes })) found.push({ ...i, key: `${i.kind}:${a.id}` });
      }
      const collection = assessCollection(await collectionFacts(orgId, settings.noPunchAfterHour, now), now);
      for (const i of collection || []) found.push({ ...i, key: 'no-punches' });
      const r = await trackAlerts({ accountId, orgId, name: org?.name || '' }, found, (key) => key !== 'no-punches' || collection !== null, settings, now);
      opened += r.opened;
      resolved += r.resolved;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[reader-checks] ${orgId}:`, e instanceof Error ? e.message : e);
    }
  }
  return { orgs: orgs.length, opened, resolved };
}
