import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { decryptSecret, encryptSecret } from '../mailer.js';
import { adapterOf, type Punch } from './adapters.js';

/**
 * The outbox and the sync runs behind HR connections.
 *
 * A punch that arrives (reader or phone) is written to the outbox once per
 * enabled connection that pushes punches, keyed by (employee, time, reader)
 * so a retry never posts it twice. Every minute the outbox is flushed per
 * connection in one batch; a failed batch waits like a webhook does
 * (1, 5, 30, 120, 720 minutes) and is then marked failed, visible on the
 * Integrations screen with the reason. Employee pulls run hourly.
 */
export const RETRY_MINUTES = [1, 5, 30, 120, 720];
const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;

export const secretsOf = (c: { secretsEnc: string | null }): Record<string, string> => {
  if (!c.secretsEnc) return {};
  try {
    return JSON.parse(decryptSecret(c.secretsEnc));
  } catch {
    return {};
  }
};
export const encryptSecrets = (s: Record<string, string>) => encryptSecret(JSON.stringify(s));
export const configOf = (c: { configJson: string }): Record<string, string> => {
  try {
    return JSON.parse(c.configJson || '{}');
  } catch {
    return {};
  }
};

async function log(c: { id: string; accountId: string; orgId: string }, kind: string, ok: boolean, detail: string) {
  await peoplePrisma.hrSyncLog.create({ data: { accountId: c.accountId, orgId: c.orgId, connectionId: c.id, kind, ok, detail: detail.slice(0, 1000) } });
  await peoplePrisma.hrConnection.update({ where: { id: c.id }, data: { lastRunAt: new Date(), lastError: ok ? null : detail.slice(0, 500), ...(ok ? { lastSummary: detail.slice(0, 300) } : {}) } });
}

/** A batch of punches just recorded: queue them for every connection that pushes. Never throws. */
export async function enqueuePunches(orgId: string, punches: Array<{ employeeId: string | null; code: string | null; readerId: string; time: string; direction: string | null; verifyMode: number }>) {
  try {
    const conns = await peoplePrisma.hrConnection.findMany({ where: { orgId, enabled: true, pushPunches: true }, select: { id: true, accountId: true, orgId: true, adapter: true } });
    if (!conns.length) return 0;
    const withCode = punches.filter((p): p is typeof p & { code: string } => Boolean(p.employeeId && p.code));
    if (!withCode.length) return 0;
    const rows = conns.flatMap((c) =>
      adapterOf(c.adapter)?.pushPunches
        ? withCode.map((p) => ({
            accountId: c.accountId,
            orgId,
            connectionId: c.id,
            kind: 'punch',
            key: `${p.code}|${p.time}|${p.readerId}`,
            payload: JSON.stringify({ code: p.code, readerId: p.readerId, time: p.time, direction: p.direction === 'IN' || p.direction === 'OUT' ? p.direction : null, verifyMode: p.verifyMode } satisfies Punch),
            status: 'PENDING',
            nextAttemptAt: new Date(),
          }))
        : []
    );
    if (!rows.length) return 0;
    const r = await peoplePrisma.hrOutbox.createMany({ data: rows, skipDuplicates: true });
    return r.count;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[hr] enqueue failed:', e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Send what is due, one batch per connection. Returns how many were sent. */
export async function flushOutbox(now = new Date(), limitPerConnection = 200) {
  const due = await peoplePrisma.hrOutbox.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: 2000 });
  if (!due.length) return 0;
  const byConn = new Map<string, typeof due>();
  for (const row of due) byConn.set(row.connectionId, [...(byConn.get(row.connectionId) || []), row].slice(0, limitPerConnection));
  let sent = 0;
  for (const [connectionId, rows] of byConn) {
    const c = await peoplePrisma.hrConnection.findUnique({ where: { id: connectionId } });
    const adapter = c ? adapterOf(c.adapter) : null;
    if (!c || !c.enabled || !adapter?.pushPunches) {
      await peoplePrisma.hrOutbox.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'FAILED', lastError: 'Connection is off or cannot push punches' } });
      continue;
    }
    const punches = rows.map((r) => ({ ...(JSON.parse(r.payload) as Punch), key: r.key }));
    let result;
    try {
      result = await adapter.pushPunches(configOf(c), secretsOf(c), punches);
    } catch (e: any) {
      result = { accepted: 0, rejected: rows.map((r) => ({ key: r.key, error: String(e?.message || e) })), retryAll: true };
    }
    const bad = new Map(result.rejected.map((x) => [x.key, x.error]));
    const okIds = rows.filter((r) => !bad.has(r.key)).map((r) => r.id);
    if (okIds.length) await peoplePrisma.hrOutbox.updateMany({ where: { id: { in: okIds } }, data: { status: 'OK', sentAt: now, lastError: null } });
    for (const r of rows.filter((x) => bad.has(x.key))) {
      const n = r.attempts + 1;
      const retryIn = result.retryAll && n < MAX_ATTEMPTS ? RETRY_MINUTES[n - 1] : null;
      await peoplePrisma.hrOutbox.update({ where: { id: r.id }, data: { attempts: n, lastError: bad.get(r.key)!.slice(0, 500), status: retryIn == null ? 'FAILED' : 'PENDING', nextAttemptAt: retryIn == null ? null : new Date(now.getTime() + retryIn * 60_000) } });
    }
    sent += okIds.length;
    await log(c, 'push', bad.size === 0, bad.size === 0 ? `Sent ${okIds.length} punch${okIds.length === 1 ? '' : 'es'}.` : `${okIds.length} sent, ${bad.size} not: ${[...bad.values()][0]}`);
  }
  return sent;
}

/** Read the tool's people and match them to CLOR's by code (or e-mail); create the missing ones when asked. */
export async function pullEmployees(c: { id: string; accountId: string; orgId: string; adapter: string; configJson: string; secretsEnc: string | null; createEmployees: boolean }, userId = 'hr-sync') {
  const adapter = adapterOf(c.adapter);
  if (!adapter?.pullEmployees) {
    await log(c, 'pull', false, `${adapter?.label || c.adapter} cannot list employees.`);
    return { pulled: 0, matched: 0, created: 0 };
  }
  try {
    const remote = await adapter.pullEmployees(configOf(c), secretsOf(c));
    const people = await peoplePrisma.employee.findMany({ where: { orgId: c.orgId }, select: { id: true, code: true, workEmail: true, email: true } });
    const byCode = new Map(people.filter((p) => p.code).map((p) => [p.code!.trim().toLowerCase(), p]));
    const byEmail = new Map(people.flatMap((p) => [p.workEmail, p.email].filter(Boolean).map((e) => [String(e).toLowerCase(), p])));
    let matched = 0;
    let created = 0;
    for (const r of remote) {
      const hit = (r.code && byCode.get(r.code.toLowerCase())) || (r.email && byEmail.get(r.email.toLowerCase()));
      if (hit) {
        matched += 1;
        continue;
      }
      if (c.createEmployees && r.active && r.name) {
        await peoplePrisma.employee.create({ data: { accountId: c.accountId, orgId: c.orgId, name: r.name, code: r.code || null, workEmail: r.email || null, createdByUserId: userId } as any });
        created += 1;
      }
    }
    await log(c, 'pull', true, `Read ${remote.length} people: ${matched} matched by code or e-mail${c.createEmployees ? `, ${created} added` : `, ${remote.length - matched} not in CLOR`}.`);
    return { pulled: remote.length, matched, created };
  } catch (e: any) {
    await log(c, 'pull', false, String(e?.message || e));
    return { pulled: 0, matched: 0, created: 0 };
  }
}

/** Hourly: every enabled connection that pulls employees. */
export async function pullAllDue() {
  const conns = await peoplePrisma.hrConnection.findMany({ where: { enabled: true, pullEmployees: true } });
  for (const c of conns) await pullEmployees(c);
  return conns.length;
}

/** Every minute flush the outbox; every hour pull people. Off under test. */
export function startHrSync({ flushMs = 60_000, pullMs = 3_600_000, startupDelayMs = 30_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const safe = (fn: () => Promise<unknown>, what: string) => () => fn().catch((e) => console.error(`[hr] ${what} failed:`, e instanceof Error ? e.message : e)); // eslint-disable-line no-console
  const t1 = setTimeout(() => {
    safe(() => flushOutbox(), 'flush')();
    const a = setInterval(safe(() => flushOutbox(), 'flush'), flushMs);
    const b = setInterval(safe(pullAllDue, 'pull'), pullMs);
    a.unref?.();
    b.unref?.();
  }, startupDelayMs);
  t1.unref?.();
  return () => clearTimeout(t1);
}
