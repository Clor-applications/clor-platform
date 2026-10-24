import { peoplePrisma } from '../utils/peoplePrisma.js';
import { runInTenant } from '../utils/tenantScope.js';
import { recordCredentialEvent, type Actor } from './credentials.js';

/**
 * Employee portal sign-ins (A-33, Batch 5).
 *
 * A portal token used to be a 30-day signed token and nothing else: it could
 * not be ended for one phone, HR could not sign a person out, and a
 * suspended employee kept using it. Each sign-in is now a row, one per
 * device; the token names it, and every request checks it. The token itself
 * keeps its shape (the apps already in people's hands store and send it as
 * before) and gains the session id.
 *
 * Staying signed in still lasts — staff punch from their phones — but a
 * session ends after 30 days unused or 180 days in all, and ends at once when
 * the person is suspended or leaves, signs out, changes their password, or
 * HR signs them out everywhere.
 */

export const IDLE_MS = 30 * 86_400_000;
export const MAX_AGE_MS = 180 * 86_400_000;
export const MAX_SESSIONS = 10;
const SEEN_EVERY_MS = 5 * 60_000;

/**
 * Tokens issued before sessions existed carry no session id. They keep
 * working, under the same checks, until this date at the latest — fixed in
 * the code, so an unset setting never means "for ever". The setting can only
 * bring it earlier.
 */
const LEGACY_CUTOFF = Date.parse('2026-11-25T00:00:00Z');
export function legacyCutoff() {
  const env = Date.parse(String(process.env.PORTAL_LEGACY_JWT_UNTIL || ''));
  return Number.isFinite(env) ? Math.min(env, LEGACY_CUTOFF) : LEGACY_CUTOFF;
}

/** A name a person recognises their device by. The Android app sends a plain HTTP client's agent. */
export function deviceLabel(ua: string) {
  const s = String(ua || '');
  const os = /Android/i.test(s) ? 'Android' : /iPhone|iPad|iOS/i.test(s) ? 'iPhone' : /Windows/i.test(s) ? 'Windows' : /Mac OS X|Macintosh/i.test(s) ? 'Mac' : /Linux/i.test(s) ? 'Linux' : '';
  const browser = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : '';
  if (browser) return os ? `${browser} on ${os}` : browser;
  return 'CLOR app';
}

type Who = { id: string; accountId: string; orgId: string };

const eventFor = (s: { id: string; accountId: string; orgId: string }) => ({ id: s.id, accountId: s.accountId, orgId: s.orgId, kind: 'PORTAL_SESSION', tokenPrefix: null as unknown as string });

/** A new sign-in. The oldest beyond ten are ended, so a phone signing in again and again does not pile up rows. */
export async function startPortalSession(e: Who, req: { ua: string; ip: string | null }) {
  return runInTenant(e.orgId, async () => {
    const row = await peoplePrisma.portalSession.create({
      data: { accountId: e.accountId, orgId: e.orgId, employeeId: e.id, deviceLabel: deviceLabel(req.ua), userAgent: req.ua.slice(0, 300) || null, ip: req.ip },
    });
    const live = await peoplePrisma.portalSession.findMany({ where: { orgId: e.orgId, employeeId: e.id, revokedAt: null }, orderBy: { lastSeenAt: 'desc' }, select: { id: true } });
    const extra = live.slice(MAX_SESSIONS).map((s) => s.id);
    if (extra.length) await peoplePrisma.portalSession.updateMany({ where: { id: { in: extra } }, data: { revokedAt: new Date(), revokedReason: 'too many devices' } });
    return row;
  });
}

export type SessionCheck = { ok: true } | { ok: false; why: 'GONE' | 'REVOKED' | 'IDLE' | 'TOO_OLD' };

/** Is this session still on? Bumps last seen (at most every five minutes). */
export async function checkPortalSession(orgId: string, employeeId: string, sid: string, now = new Date()): Promise<SessionCheck> {
  const s = await runInTenant(orgId, () => peoplePrisma.portalSession.findFirst({ where: { id: sid, orgId, employeeId } }));
  if (!s) return { ok: false, why: 'GONE' };
  if (s.revokedAt) return { ok: false, why: 'REVOKED' };
  if (s.lastSeenAt.getTime() < now.getTime() - IDLE_MS) return { ok: false, why: 'IDLE' };
  if (s.createdAt.getTime() < now.getTime() - MAX_AGE_MS) return { ok: false, why: 'TOO_OLD' };
  if (now.getTime() - s.lastSeenAt.getTime() > SEEN_EVERY_MS) {
    void runInTenant(orgId, () => peoplePrisma.portalSession.updateMany({ where: { id: s.id, lastSeenAt: { lt: new Date(now.getTime() - SEEN_EVERY_MS) } }, data: { lastSeenAt: now } })).catch(() => {});
  }
  return { ok: true };
}

/**
 * End a person's sign-ins — all of them, or all but the one in use. Tokens
 * from before sessions are ended too: the time is stamped on the person, and
 * a token issued before it is refused.
 */
export async function endPortalSessions(e: { id: string; accountId: string; orgId: string }, reason: string, actor: Actor, opts: { except?: string | null } = {}) {
  const now = new Date();
  const ended = await runInTenant(e.orgId, async () => {
    const live = await peoplePrisma.portalSession.findMany({ where: { orgId: e.orgId, employeeId: e.id, revokedAt: null, ...(opts.except ? { id: { not: opts.except } } : {}) }, select: { id: true, accountId: true, orgId: true } });
    if (live.length) await peoplePrisma.portalSession.updateMany({ where: { id: { in: live.map((s) => s.id) } }, data: { revokedAt: now, revokedReason: reason } });
    await peoplePrisma.employee.updateMany({ where: { id: e.id, orgId: e.orgId }, data: { portalSessionsRevokedAt: now } });
    return live;
  });
  for (const s of ended) await recordCredentialEvent(eventFor(s), 'revoked', actor, { reason, metadata: { employeeId: e.id } });
  return ended.length;
}

/** End one of a person's sessions (their own device list). */
export async function endPortalSession(e: { id: string; orgId: string }, sid: string, reason: string, actor: Actor) {
  return runInTenant(e.orgId, async () => {
    const s = await peoplePrisma.portalSession.findFirst({ where: { id: sid, orgId: e.orgId, employeeId: e.id, revokedAt: null } });
    if (!s) return false;
    await peoplePrisma.portalSession.update({ where: { id: s.id }, data: { revokedAt: new Date(), revokedReason: reason } });
    await recordCredentialEvent(eventFor(s), 'revoked', actor, { reason, metadata: { employeeId: e.id } });
    return true;
  });
}

export async function listPortalSessions(e: { id: string; orgId: string }, now = new Date()) {
  const rows = await runInTenant(e.orgId, () =>
    peoplePrisma.portalSession.findMany({ where: { orgId: e.orgId, employeeId: e.id, revokedAt: null }, orderBy: { lastSeenAt: 'desc' } })
  );
  return rows.filter((s) => s.lastSeenAt.getTime() >= now.getTime() - IDLE_MS && s.createdAt.getTime() >= now.getTime() - MAX_AGE_MS);
}

/** A person's status changed: suspended or gone, every sign-in ends (R16). Notice, rehire and back-to-work change nothing here. */
export async function employeeStatusChanged(e: { id: string; accountId: string; orgId: string }, from: string | null | undefined, to: string | null | undefined, actor: Actor) {
  const next = String(to || '').toUpperCase();
  if (String(from || '').toUpperCase() === next) return 0;
  if (next !== 'SUSPENDED' && next !== 'LEFT') return 0;
  return endPortalSessions(e, next === 'LEFT' ? 'employee left' : 'employee suspended', actor);
}
