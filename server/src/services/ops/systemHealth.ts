import { platformPrisma } from '../../utils/platformPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { prisma } from '../../utils/prisma.js';

/**
 * System health for the operator console (Ops P0): are the background
 * workers running, and what failed in the last day. Counts and names only —
 * never a customer's business records. Callers run this inside outsideTenant.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A reader that has not called in for this long is offline. */
export const READER_OFFLINE_MS = 30 * 60_000;

type Run = { worker: string; startedAt: Date; finishedAt: Date | null; outcome: string; error: string | null };

/**
 * One line per background worker. A worker's usual gap is the median gap
 * between its recent starts; it is late when its last start is more than
 * twice that ago (and at least 30 minutes). One run alone has no usual gap.
 */
export function workerLines(runs: Run[], now = Date.now()) {
  const by = new Map<string, Run[]>();
  for (const r of runs) {
    const list = by.get(r.worker) || [];
    list.push(r);
    by.set(r.worker, list);
  }
  const lines = [...by.entries()].map(([worker, list]) => {
    list.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    const last = list[0];
    const gaps: number[] = [];
    for (let i = 0; i + 1 < Math.min(list.length, 8); i += 1) gaps.push(list[i].startedAt.getTime() - list[i + 1].startedAt.getTime());
    gaps.sort((a, b) => a - b);
    const usualGapMs = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
    const sinceMs = now - last.startedAt.getTime();
    const late = usualGapMs != null && sinceMs > Math.max(2 * usualGapMs, 30 * 60_000);
    const failedToday = list.filter((r) => r.outcome === 'FAILED' && now - r.startedAt.getTime() < DAY).length;
    const stuck = last.outcome === 'RUNNING' && sinceMs > Math.max(2 * (usualGapMs || HOUR), HOUR);
    const state = last.outcome === 'FAILED' || stuck ? 'failing' : late ? 'late' : 'ok';
    return {
      worker,
      state,
      lastStartedAt: last.startedAt,
      lastFinishedAt: last.finishedAt,
      lastOutcome: last.outcome,
      lastError: last.error ? last.error.slice(0, 300) : null,
      usualGapMinutes: usualGapMs == null ? null : Math.round(usualGapMs / 60_000),
      failedToday,
    };
  });
  const rank = { failing: 0, late: 1, ok: 2 } as Record<string, number>;
  return lines.sort((a, b) => rank[a.state] - rank[b.state] || a.worker.localeCompare(b.worker));
}

/** Everything the System health page shows. */
export async function systemHealth(now = Date.now()) {
  const since = new Date(now - DAY);
  const offlineBefore = new Date(now - READER_OFFLINE_MS);
  const [runs, emailsFailed, emailsStuck, webhooksFailed, readersOffline, readerAlerts, einvoiceErrors, closuresStuck, hrErrors, ssoErrors] = await Promise.all([
    platformPrisma.jobRun.findMany({ where: { startedAt: { gt: new Date(now - 7 * DAY) } }, orderBy: { startedAt: 'desc' }, take: 2000, select: { worker: true, startedAt: true, finishedAt: true, outcome: true, error: true } }),
    platformPrisma.emailOutbox.count({ where: { status: 'FAILED', createdAt: { gt: since } } }),
    platformPrisma.emailOutbox.count({ where: { status: 'QUEUED', createdAt: { lt: new Date(now - HOUR) } } }),
    peoplePrisma.webhookDelivery.count({ where: { status: { in: ['FAILED', 'DEAD'] }, createdAt: { gt: since } } }),
    peoplePrisma.attendanceDevice.count({ where: { isActive: true, lastSeenAt: { lt: offlineBefore } } }),
    peoplePrisma.readerAlert.count({ where: { resolvedAt: null } }),
    prisma.eInvoiceSetting.count({ where: { lastError: { not: null } } }),
    platformPrisma.orgClosure.count({ where: { purgeError: { not: null }, deletedAt: null } }),
    peoplePrisma.hrConnection.count({ where: { enabled: true, lastError: { not: null } } }),
    platformPrisma.authProvider.count({ where: { enabled: true, lastError: { not: null } } }),
  ]);
  const workers = workerLines(runs, now);
  const signals = [
    { key: 'emails-failed', label: 'Emails that failed in the last day', count: emailsFailed, screen: 'emails' },
    { key: 'emails-stuck', label: 'Emails waiting more than an hour', count: emailsStuck, screen: 'emails' },
    { key: 'webhooks-failed', label: 'Webhook deliveries that failed in the last day', count: webhooksFailed, screen: null },
    { key: 'readers-offline', label: 'Attendance readers offline', count: readersOffline, screen: 'connections' },
    { key: 'reader-alerts', label: 'Open reader alerts', count: readerAlerts, screen: null },
    { key: 'einvoice-errors', label: 'Companies whose e-invoice connection reports an error', count: einvoiceErrors, screen: 'connections' },
    { key: 'hr-errors', label: 'HR connections reporting an error', count: hrErrors, screen: 'connections' },
    { key: 'sso-errors', label: 'Single sign-on setups reporting an error', count: ssoErrors, screen: 'connections' },
    { key: 'closures-stuck', label: 'Company deletions that stopped part-way', count: closuresStuck, screen: null },
  ];
  const failing = workers.filter((w) => w.state === 'failing').length;
  const late = workers.filter((w) => w.state === 'late').length;
  const problems = signals.filter((s) => s.count > 0).length;
  const overall = failing ? 'down' : late || problems ? 'attention' : 'ok';
  return { at: new Date(now), overall, workers, signals };
}

/** A reader or agent silent for this long is listed as broken; a shorter gap is a shop shut for the night. */
export const BROKEN_AFTER_MS = DAY;
const BROKEN_SHOWN = 300;

export type BrokenConnection = { kind: string; id: string; name: string; accountId: string; customer: string | null; state: 'error' | 'offline'; since: Date | null; error: string | null };

/**
 * Every customer's connection that is not working, for the console's list: one in error (it tried and
 * failed), or a reader or site agent that has not called in for a day. Switched-off ones are the
 * customer's own choice and are left out. Names and errors only; never a customer's records. The same
 * rules as `accountConnections` below, read across accounts. Callers run this inside outsideTenant.
 */
export async function brokenConnections(now = Date.now()) {
  const silentBefore = new Date(now - BROKEN_AFTER_MS);
  const silentOrFailed = { isActive: true, OR: [{ lastError: { not: null } }, { lastSeenAt: { lt: silentBefore } }] };
  const [readers, agents, hr, sso, einv] = await Promise.all([
    peoplePrisma.attendanceDevice.findMany({ where: silentOrFailed, select: { id: true, accountId: true, name: true, lastSeenAt: true, lastError: true }, take: BROKEN_SHOWN }),
    peoplePrisma.siteAgent.findMany({ where: silentOrFailed, select: { id: true, accountId: true, name: true, lastSeenAt: true, lastError: true }, take: BROKEN_SHOWN }),
    peoplePrisma.hrConnection.findMany({ where: { enabled: true, lastError: { not: null } }, select: { id: true, accountId: true, name: true, adapter: true, lastRunAt: true, lastError: true }, take: BROKEN_SHOWN }),
    platformPrisma.authProvider.findMany({ where: { enabled: true, lastError: { not: null } }, select: { id: true, accountId: true, name: true, kind: true, lastUsedAt: true, lastError: true }, take: BROKEN_SHOWN }),
    prisma.eInvoiceSetting.findMany({ where: { lastError: { not: null } }, select: { id: true, accountId: true, provider: true, mode: true, verifiedAt: true, lastError: true }, take: BROKEN_SHOWN }),
  ]);
  const short = (e: string | null) => (e ? e.slice(0, 200) : null);
  const rows: Omit<BrokenConnection, 'customer'>[] = [
    ...readers.map((r) => ({ kind: 'Attendance reader', id: r.id, name: r.name, accountId: r.accountId, state: r.lastError ? ('error' as const) : ('offline' as const), since: r.lastSeenAt, error: short(r.lastError) })),
    ...agents.map((a) => ({ kind: 'Site agent', id: a.id, name: a.name, accountId: a.accountId, state: a.lastError ? ('error' as const) : ('offline' as const), since: a.lastSeenAt, error: short(a.lastError) })),
    ...hr.map((h) => ({ kind: 'HR connection', id: h.id, name: `${h.name} (${h.adapter})`, accountId: h.accountId, state: 'error' as const, since: h.lastRunAt, error: short(h.lastError) })),
    ...sso.map((s) => ({ kind: 'Single sign-on', id: s.id, name: `${s.name} (${s.kind})`, accountId: s.accountId, state: 'error' as const, since: s.lastUsedAt, error: short(s.lastError) })),
    ...einv.map((e) => ({ kind: 'E-invoice', id: e.id, name: `${e.provider} ${e.mode.toLowerCase()}`, accountId: e.accountId, state: 'error' as const, since: e.verifiedAt, error: short(e.lastError) })),
  ];
  const accounts = rows.length ? await platformPrisma.account.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.accountId))] } }, select: { id: true, name: true, suspendedAt: true } }) : [];
  const by = new Map(accounts.map((a) => [a.id, a]));
  /* A suspended customer's readers are silent because the customer is: not a fault to chase. Longest broken first. */
  const items: BrokenConnection[] = rows
    .filter((r) => by.has(r.accountId) && !by.get(r.accountId)!.suspendedAt)
    .map((r) => ({ ...r, customer: by.get(r.accountId)!.name }))
    .sort((a, b) => (a.since?.getTime() ?? 0) - (b.since?.getTime() ?? 0) || a.kind.localeCompare(b.kind))
    .slice(0, BROKEN_SHOWN);
  const kinds: Record<string, number> = {};
  for (const i of items) kinds[i.kind] = (kinds[i.kind] || 0) + 1;
  return { at: new Date(now), items, kinds, customers: new Set(items.map((i) => i.accountId)).size };
}

/**
 * One customer's connections, for its Customer 360 page: what is set up and
 * whether it last worked. Names and errors only.
 */
export async function accountConnections(accountId: string, now = Date.now()) {
  const offlineBefore = now - READER_OFFLINE_MS;
  const [readers, agents, hr, sso, einv, creds, emailsFailed, webhooksFailed, alerts] = await Promise.all([
    peoplePrisma.attendanceDevice.findMany({ where: { accountId }, select: { id: true, name: true, isActive: true, lastSeenAt: true, lastError: true }, orderBy: { name: 'asc' }, take: 100 }),
    peoplePrisma.siteAgent.findMany({ where: { accountId }, select: { id: true, name: true, isActive: true, lastSeenAt: true, lastError: true }, orderBy: { name: 'asc' }, take: 50 }),
    peoplePrisma.hrConnection.findMany({ where: { accountId }, select: { id: true, name: true, adapter: true, enabled: true, lastRunAt: true, lastError: true }, take: 50 }),
    platformPrisma.authProvider.findMany({ where: { accountId }, select: { id: true, name: true, kind: true, enabled: true, lastUsedAt: true, lastError: true }, take: 20 }),
    prisma.eInvoiceSetting.findMany({ where: { accountId }, select: { id: true, orgId: true, mode: true, provider: true, verifiedAt: true, lastError: true }, take: 20 }),
    platformPrisma.credential.groupBy({ by: ['kind', 'status'], where: { accountId }, _count: true }),
    platformPrisma.emailOutbox.count({ where: { accountId, status: 'FAILED', createdAt: { gt: new Date(now - 7 * DAY) } } }),
    peoplePrisma.webhookDelivery.count({ where: { accountId, status: { in: ['FAILED', 'DEAD'] }, createdAt: { gt: new Date(now - 7 * DAY) } } }),
    peoplePrisma.readerAlert.count({ where: { accountId, resolvedAt: null } }),
  ]);
  const short = (e: string | null) => (e ? e.slice(0, 200) : null);
  const line = (kind: string, id: string, name: string, state: 'ok' | 'off' | 'error' | 'offline', lastAt: Date | null, error: string | null) => ({ kind, id, name, state, lastAt, error: short(error) });
  const items = [
    ...readers.map((r) => line('Attendance reader', r.id, r.name, !r.isActive ? 'off' : r.lastError ? 'error' : !r.lastSeenAt || r.lastSeenAt.getTime() < offlineBefore ? 'offline' : 'ok', r.lastSeenAt, r.lastError)),
    ...agents.map((a) => line('Site agent', a.id, a.name, !a.isActive ? 'off' : a.lastError ? 'error' : !a.lastSeenAt || a.lastSeenAt.getTime() < offlineBefore ? 'offline' : 'ok', a.lastSeenAt, a.lastError)),
    ...hr.map((h) => line('HR connection', h.id, `${h.name} (${h.adapter})`, !h.enabled ? 'off' : h.lastError ? 'error' : 'ok', h.lastRunAt, h.lastError)),
    ...sso.map((s) => line('Single sign-on', s.id, `${s.name} (${s.kind})`, !s.enabled ? 'off' : s.lastError ? 'error' : 'ok', s.lastUsedAt, s.lastError)),
    ...einv.map((e) => line('E-invoice', e.id, `${e.provider} ${e.mode.toLowerCase()}`, e.lastError ? 'error' : e.verifiedAt ? 'ok' : 'off', e.verifiedAt, e.lastError)),
  ];
  return {
    items,
    credentials: creds.map((c) => ({ kind: c.kind, status: c.status, count: Number(c._count) || 0 })),
    emailsFailedThisWeek: emailsFailed,
    webhooksFailedThisWeek: webhooksFailed,
    openReaderAlerts: alerts,
  };
}
