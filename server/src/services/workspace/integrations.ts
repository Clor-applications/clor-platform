import type { Request } from 'express';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { isFeatureEnabled } from '../features.js';
import { isAppEntitled } from '../subscriptions.js';

/**
 * Workspace Integrations (Workspace plan 11 Nov 2026, P2): everything that
 * connects this company to something outside CLOR, on one page, with whether
 * it is working and where it is managed.
 *
 * Read only, and only from rows that exist: a company with no readers has no
 * readers line, never a "0 readers, all fine". Each line points at the screen
 * that owns it (People or Attendance for readers, connectors and webhooks;
 * Workspace for single sign-on, provisioning and keys); nothing is changed
 * here. Health is judged the way the jobs already judge it: open reader
 * alerts (services/attendance/readerHealth.ts), failed webhook deliveries,
 * the outbox's failures, a key's own expiry.
 */
export type IntegrationStatus = 'ok' | 'attention' | 'off';
export type IntegrationPart = { name: string; status: IntegrationStatus; note: string | null; lastSeenAt: string | null };
export type Integration = {
  key: string;
  label: string;
  /** One line on what it is for, in plain words. */
  about: string;
  status: IntegrationStatus;
  /** One line on how it is doing: "3 readers, 1 not heard from since 2 Nov". */
  summary: string;
  lastActivityAt: string | null;
  parts: IntegrationPart[];
  manage: { app: string; screen: string } | null;
  /** Where it is managed when that is not a screen this person can be sent to. */
  manageNote?: string;
};

const DAY = 86_400_000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const latest = (ds: (Date | null | undefined)[]) => {
  const t = ds.filter(Boolean).map((d) => (d as Date).getTime());
  return t.length ? new Date(Math.max(...t)) : null;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const worst = (parts: { status: IntegrationStatus }[]): IntegrationStatus => (parts.some((p) => p.status === 'attention') ? 'attention' : parts.some((p) => p.status === 'ok') ? 'ok' : 'off');

export async function workspaceIntegrations(req: Request, now = new Date()): Promise<{ integrations: Integration[] }> {
  const { accountId, orgId } = req.tenant!;
  const where = { accountId, orgId };
  const since = new Date(now.getTime() - 7 * DAY);
  const [people, attendance] = await Promise.all([isAppEntitled(accountId, 'people'), isAppEntitled(accountId, 'attendance')]);
  const timeOn = (people || attendance) && ((await isFeatureEnabled(accountId, orgId, 'people')) || (await isFeatureEnabled(accountId, orgId, 'attendance')));
  /* Readers, connectors and webhooks are set up in People when the company has it, else in Attendance. */
  const timeApp = people ? 'people' : 'attendance';

  const [devices, alerts, agents, hooks, failedDeliveries, providers, scim, keys, mail, mailSent, mailFailed, jobs, jobsFailed] = await Promise.all([
    timeOn ? peoplePrisma.attendanceDevice.findMany({ where: { ...where, isActive: true }, select: { id: true, name: true, vendor: true, lastSeenAt: true, lastFetchedAt: true, lastError: true }, orderBy: { name: 'asc' } }) : [],
    timeOn ? peoplePrisma.readerAlert.findMany({ where: { ...where, resolvedAt: null }, select: { kind: true, deviceId: true, title: true } }) : [],
    timeOn ? peoplePrisma.siteAgent.findMany({ where: { ...where, isActive: true }, select: { id: true, name: true, version: true, lastSeenAt: true, lastError: true }, orderBy: { name: 'asc' } }) : [],
    timeOn ? peoplePrisma.webhook.findMany({ where: { ...where, isActive: true }, select: { id: true, name: true, lastStatus: true, lastError: true, lastDeliveredAt: true }, orderBy: { name: 'asc' } }) : [],
    timeOn ? peoplePrisma.webhookDelivery.groupBy({ by: ['webhookId'], where: { orgId, status: 'FAILED', createdAt: { gte: since } }, _count: { _all: true } }) : [],
    platformPrisma.authProvider.findMany({ where: { ...where, enabled: true }, select: { name: true, kind: true, updatedAt: true } }),
    platformPrisma.scimToken.findMany({ where: { ...where, revokedAt: null }, select: { tokenPrefix: true, lastUsedAt: true, lastError: true } }),
    platformPrisma.credential.findMany({ where: { ...where, kind: 'API_KEY', status: { not: 'REVOKED' } }, select: { label: true, ownerId: true, tokenPrefix: true, status: true, expiresAt: true, needsReviewReason: true, lastUsedAt: true } }),
    platformPrisma.emailSetting.findFirst({ where, select: { provider: true, fromEmail: true, verifiedAt: true, lastError: true } }),
    platformPrisma.emailOutbox.count({ where: { accountId, status: 'SENT', sentAt: { gte: since } } }),
    platformPrisma.emailOutbox.count({ where: { accountId, status: 'FAILED', updatedAt: { gte: since } } }),
    timeOn ? peoplePrisma.agentJob.count({ where: { ...where, createdAt: { gte: since } } }) : 0,
    timeOn ? peoplePrisma.agentJob.count({ where: { ...where, status: 'FAILED', createdAt: { gte: since } } }) : 0,
  ]);

  const out: Integration[] = [];

  if (devices.length) {
    const alertsFor = (id: string) => alerts.filter((a) => a.deviceId === id);
    const parts: IntegrationPart[] = devices.map((d) => {
      const open = alertsFor(d.id);
      return { name: d.name, status: open.length || d.lastError ? 'attention' : 'ok', note: open[0]?.title || d.lastError || null, lastSeenAt: iso(latest([d.lastSeenAt, d.lastFetchedAt])) };
    });
    const bad = parts.filter((p) => p.status === 'attention').length;
    out.push({
      key: 'readers', label: 'Attendance readers', about: 'Fingerprint and face machines that send punches to CLOR.',
      status: worst(parts), summary: `${plural(devices.length, 'reader')}${bad ? `, ${bad} need${bad === 1 ? 's' : ''} a look` : ', all sending'}`,
      lastActivityAt: iso(latest(devices.map((d) => latest([d.lastSeenAt, d.lastFetchedAt])))), parts, manage: { app: timeApp, screen: 'readers' },
    });
  }

  if (agents.length) {
    const quietSince = new Date(now.getTime() - DAY);
    const parts: IntegrationPart[] = agents.map((a) => {
      const quiet = !a.lastSeenAt || a.lastSeenAt < quietSince;
      return { name: a.name, status: quiet || a.lastError ? 'attention' : 'ok', note: a.lastError || (a.lastSeenAt ? (quiet ? 'Not heard from in over a day' : a.version ? `Version ${a.version}` : null) : 'Not connected yet'), lastSeenAt: iso(a.lastSeenAt) };
    });
    out.push({
      key: 'connectors', label: 'On-site connectors', about: 'The small program on your office computer that links readers and Tally to CLOR.',
      status: worst(parts), summary: plural(agents.length, 'connector'), lastActivityAt: iso(latest(agents.map((a) => a.lastSeenAt))), parts, manage: { app: timeApp, screen: 'integrations' },
    });
  }

  if (jobs || jobsFailed) {
    out.push({
      key: 'tally', label: 'Tally postings', about: 'Entries the connector posts into Tally on your computer.',
      status: jobsFailed ? 'attention' : 'ok', summary: `${plural(jobs, 'posting')} this week${jobsFailed ? `, ${jobsFailed} failed` : ''}`,
      lastActivityAt: null, parts: [], manage: { app: timeApp, screen: 'integrations' },
    });
  }

  if (hooks.length) {
    const failed = new Map(failedDeliveries.map((f) => [f.webhookId, f._count._all]));
    const parts: IntegrationPart[] = hooks.map((h) => {
      const n = failed.get(h.id) || 0;
      const lastBad = h.lastStatus != null && (h.lastStatus < 200 || h.lastStatus >= 300);
      return { name: h.name, status: n || lastBad ? 'attention' : 'ok', note: n ? `${plural(n, 'delivery', 'deliveries')} failed this week` : h.lastError || null, lastSeenAt: iso(h.lastDeliveredAt) };
    });
    out.push({
      key: 'webhooks', label: 'Webhooks', about: 'Addresses CLOR tells when something happens, such as a punch or approved leave.',
      status: worst(parts), summary: plural(hooks.length, 'webhook'), lastActivityAt: iso(latest(hooks.map((h) => h.lastDeliveredAt))), parts, manage: { app: timeApp, screen: 'integrations' },
    });
  }

  if (providers.length) {
    out.push({
      key: 'sso', label: 'Single sign-on', about: 'People sign in with your company account instead of a CLOR password.',
      status: 'ok', summary: providers.map((p) => `${p.name} (${p.kind})`).join(', '), lastActivityAt: null,
      parts: [], manage: { app: 'admin', screen: 'sso' },
    });
  }

  if (scim.length) {
    const parts: IntegrationPart[] = scim.map((t) => ({ name: `Token ${t.tokenPrefix}…`, status: t.lastError ? 'attention' : t.lastUsedAt ? 'ok' : 'off', note: t.lastError || (t.lastUsedAt ? null : 'Not used yet'), lastSeenAt: iso(t.lastUsedAt) }));
    out.push({
      key: 'scim', label: 'User provisioning (SCIM)', about: 'Your directory adds and removes CLOR users for you.',
      status: worst(parts), summary: plural(scim.length, 'token'), lastActivityAt: iso(latest(scim.map((t) => t.lastUsedAt))), parts, manage: { app: 'admin', screen: 'sso' },
    });
  }

  if (keys.length) {
    /* A key's name is its API client's, the one given when it was made. */
    const clients = await peoplePrisma.apiClient.findMany({ where: { orgId, id: { in: keys.map((k) => k.ownerId) } }, select: { id: true, name: true } }).catch(() => []);
    const clientName = new Map(clients.map((c) => [c.id, c.name]));
    const soon = new Date(now.getTime() + 30 * DAY);
    const parts: IntegrationPart[] = keys.map((k) => {
      const expiring = k.expiresAt && k.expiresAt < soon;
      const expired = k.expiresAt && k.expiresAt < now;
      const note = expired ? 'Expired' : k.needsReviewReason ? 'Needs review' : k.status === 'SUSPENDED' ? 'Paused' : expiring ? `Expires ${k.expiresAt!.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : null;
      return { name: k.label || clientName.get(k.ownerId) || `Key ${k.tokenPrefix}…`, status: expired || k.needsReviewReason || expiring ? 'attention' : k.status === 'SUSPENDED' ? 'off' : 'ok', note, lastSeenAt: iso(k.lastUsedAt) };
    });
    out.push({
      key: 'apiKeys', label: 'API keys', about: 'Keys other systems use to read from or send to CLOR.',
      status: worst(parts), summary: plural(keys.length, 'key'), lastActivityAt: iso(latest(keys.map((k) => k.lastUsedAt))), parts, manage: { app: 'admin', screen: 'credentials' },
    });
  }

  if (mail || mailSent || mailFailed) {
    const own = mail?.provider === 'SMTP';
    out.push({
      key: 'email', label: 'E-mail', about: own ? `Mail goes out through your own server${mail?.fromEmail ? ` as ${mail.fromEmail}` : ''}.` : 'Mail goes out through CLOR.',
      status: mailFailed || mail?.lastError ? 'attention' : 'ok',
      summary: `${plural(mailSent, 'e-mail')} sent this week${mailFailed ? `, ${mailFailed} not delivered` : ''}`,
      lastActivityAt: null, parts: mail?.lastError ? [{ name: 'Your mail server', status: 'attention', note: mail.lastError, lastSeenAt: null }] : [],
      manage: null, manageNote: own ? 'Your mail server is set in Books, under Settings.' : undefined,
    });
  }

  /* What needs a look first, then the rest in the order above. */
  out.sort((a, b) => Number(b.status === 'attention') - Number(a.status === 'attention'));
  return { integrations: out };
}
