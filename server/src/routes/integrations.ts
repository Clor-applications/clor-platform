import { Router } from 'express';
import { ADAPTERS, adapterOf, publicAdapter } from '../services/hr/adapters.js';
import { configOf, encryptSecrets, flushOutbox, pullEmployees, secretsOf } from '../services/hr/sync.js';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import { encryptSecret } from '../services/mailer.js';
import { checkUrl } from '../services/outbound.js';
import { EVENT_HELP, WEBHOOK_EVENTS, deliver, forgetWebhooks, resendDelivery } from '../services/attendance/webhooks.js';
import { SCOPES, hashToken } from './publicApi.js';
import { agentConfig, agentSecrets, ensureScimForAgent, newAgentToken } from './agent.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * Integrations, as the company manages them: API keys for outside systems
 * (ClorTime routes/api_clients.js — issued, rotated, revoked; the key shown
 * exactly once, only its hash kept) and webhooks CLOR sends events to.
 */
export const integrationsRouter = Router();
integrationsRouter.use(requireAuth, requireTenantContext);

const can = (action: string) => requirePermission(ATTENDANCE_MODULE, action as any, ATTENDANCE_RESOURCE.integrations);
const base = '/orgs/:orgId/attendance/integrations';
const newToken = () => `clor_${randomBytes(32).toString('hex')}`;
const ipList = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .refine((v) => !v || v.split(',').every((ip) => /^[0-9a-fA-F:.]{3,45}$/.test(ip.trim())), 'Addresses are IPs, separated by commas.');

const keyRow = ({ tokenHash: _h, ...k }: any) => ({ ...k, scopes: k.scopes.split(','), allowedIps: k.allowedIps ? k.allowedIps.split(',') : [] });

integrationsRouter.get(`${base}/keys`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const keys = await peoplePrisma.apiClient.findMany({ where: { accountId, orgId }, orderBy: { createdAt: 'desc' } });
  res.json({ keys: keys.map(keyRow), scopes: SCOPES });
});

integrationsRouter.post(`${base}/keys`, can(PermissionAction.CREATE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({ name: z.string().trim().min(1, 'Name the key after what uses it.').max(80), scopes: z.array(z.enum(SCOPES)).min(1, 'Choose what the key may do.'), allowedIps: ipList })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the details.' });
  const token = newToken();
  const key = await peoplePrisma.apiClient.create({
    data: {
      accountId,
      orgId,
      name: parsed.data.name,
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(0, 12),
      scopes: [...new Set(parsed.data.scopes)].join(','),
      allowedIps: parsed.data.allowedIps ? parsed.data.allowedIps.split(',').map((s) => s.trim()).filter(Boolean).join(',') : null,
      createdByUserId: req.auth!.userId,
    },
  });
  res.status(201).json({ key: keyRow(key), token, note: 'Shown once — copy it now. Only a hash is kept.' });
});

integrationsRouter.post(`${base}/keys/:id/rotate`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.apiClient.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such key.' });
  const token = newToken();
  /* The old key stops working at once; the punches it sent stay under its reader row. */
  const key = await peoplePrisma.apiClient.update({ where: { id: existing.id }, data: { tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12), isActive: true, revokedAt: null } });
  res.json({ key: keyRow(key), token, note: 'Rotated — the previous key no longer works. Shown once.' });
});

integrationsRouter.post(`${base}/keys/:id/revoke`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.apiClient.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such key.' });
  const key = await peoplePrisma.apiClient.update({ where: { id: existing.id }, data: { isActive: false, revokedAt: new Date() } });
  res.json({ key: keyRow(key) });
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

const hookRow = ({ secret: _s, ...h }: any) => ({ ...h, events: h.events.split(',') });
const hookSchema = z.object({
  name: z.string().trim().min(1, 'Name the webhook.').max(80),
  url: z.string().trim().max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Choose at least one event.'),
  isActive: z.boolean().optional(),
});

integrationsRouter.get(`${base}/webhooks`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const hooks = await peoplePrisma.webhook.findMany({ where: { accountId, orgId }, orderBy: { createdAt: 'desc' } });
  res.json({ webhooks: hooks.map(hookRow), events: WEBHOOK_EVENTS, eventHelp: EVENT_HELP });
});

integrationsRouter.post(`${base}/webhooks`, can(PermissionAction.CREATE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = hookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the details.' });
  const bad = checkUrl(parsed.data.url);
  if (bad) return res.status(400).json({ error: bad });
  const secret = `whsec_${randomBytes(24).toString('hex')}`;
  const hook = await peoplePrisma.webhook.create({
    data: { accountId, orgId, name: parsed.data.name, url: parsed.data.url, events: parsed.data.events.join(','), isActive: parsed.data.isActive ?? true, secret: encryptSecret(secret), createdByUserId: req.auth!.userId },
  });
  forgetWebhooks(orgId);
  res.status(201).json({ webhook: hookRow(hook), secret, note: 'Shown once — use it to check the X-Clor-Signature header.' });
});

integrationsRouter.put(`${base}/webhooks/:id`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.webhook.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such webhook.' });
  const parsed = hookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the details.' });
  const bad = checkUrl(parsed.data.url);
  if (bad) return res.status(400).json({ error: bad });
  const hook = await peoplePrisma.webhook.update({
    where: { id: existing.id },
    data: { name: parsed.data.name, url: parsed.data.url, events: parsed.data.events.join(','), ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}) },
  });
  forgetWebhooks(orgId);
  res.json({ webhook: hookRow(hook) });
});

integrationsRouter.delete(`${base}/webhooks/:id`, can(PermissionAction.DELETE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.webhook.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such webhook.' });
  await peoplePrisma.webhook.delete({ where: { id: existing.id } });
  forgetWebhooks(orgId);
  res.json({ ok: true });
});

/** Send a test event now and answer with what the endpoint said. */
/** What was sent to a webhook lately, and how it went. */
integrationsRouter.get(`${base}/webhooks/:id/deliveries`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const hook = await peoplePrisma.webhook.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!hook) return res.status(404).json({ error: 'No such webhook.' });
  const status = String(req.query.status || '').trim();
  const rows = await peoplePrisma.webhookDelivery.findMany({
    where: { orgId, webhookId: hook.id, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({
    deliveries: rows.map((d) => ({ id: d.id, event: d.event, status: d.status, attempts: d.attempts, lastStatus: d.lastStatus, lastError: d.lastError, nextAttemptAt: d.nextAttemptAt, deliveredAt: d.deliveredAt, createdAt: d.createdAt, body: d.body.slice(0, 2_000) })),
  });
});

integrationsRouter.post(`${base}/webhooks/:id/deliveries/:deliveryId/resend`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const r = await resendDelivery(orgId, String(req.params.deliveryId));
  if (!r) return res.status(404).json({ error: 'No such delivery.' });
  res.json(r);
});

integrationsRouter.post(`${base}/webhooks/:id/test`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const hook = await peoplePrisma.webhook.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!hook) return res.status(404).json({ error: 'No such webhook.' });
  const r = await deliver(hook, 'test', orgId, { message: 'Test from CLOR. If you can read this, the webhook works.' });
  res.json(r);
});

// ---------------------------------------------------------------------------
// HR tools (greytHR, Keka, …): connections the company runs alongside
// ---------------------------------------------------------------------------

const publicConnection = (c: any) => {
  const a = adapterOf(c.adapter);
  const secretsPresent = Object.keys(secretsOf(c));
  return {
    id: c.id, adapter: c.adapter, adapterLabel: a?.label || c.adapter, name: c.name, config: configOf(c), secretsSet: secretsPresent,
    enabled: c.enabled, pushPunches: c.pushPunches, pullEmployees: c.pullEmployees, createEmployees: c.createEmployees,
    capabilities: a?.capabilities || [], lastRunAt: c.lastRunAt, lastError: c.lastError, lastSummary: c.lastSummary, createdAt: c.createdAt,
  };
};

/* ------------------------------------------------------------ On-site connectors */

const agentBase = () => `${process.env.API_PUBLIC_URL || process.env.PUBLIC_API_URL || 'https://api.clor.in'}/agent/v1`;
const ldapSchema = z
  .object({
    url: z.string().trim().max(200).regex(/^ldaps?:\/\//, 'The LDAP address starts with ldap:// or ldaps://.'),
    bindDn: z.string().trim().min(1).max(300),
    bindPassword: z.string().max(200).optional(),
    baseDn: z.string().trim().min(1).max(300),
    filter: z.string().trim().max(500).optional(),
    emailAttr: z.string().trim().max(60).optional(),
    deactivateMissing: z.boolean().optional(),
    defaultRoleId: z.string().nullable().optional(),
  })
  .nullable()
  .optional();
const tallySchema = z.object({ host: z.string().trim().max(120), port: z.coerce.number().int().min(1).max(65535).optional(), company: z.string().trim().max(120).optional() }).nullable().optional();
const agentSchema = z.object({ name: z.string().trim().min(1, 'Name the connector, e.g. "Head office server".').max(80), isActive: z.boolean().optional(), pollSeconds: z.coerce.number().int().min(30).max(900).optional(), tally: tallySchema, ldap: ldapSchema });

const agentRow = async (a: any) => {
  const cfg = agentConfig(a);
  const [readers, jobs] = await Promise.all([
    peoplePrisma.attendanceDevice.findMany({ where: { agentId: a.id }, select: { id: true, name: true, vendor: true, lastFetchedAt: true, lastError: true } }),
    peoplePrisma.agentJob.groupBy({ by: ['status'], where: { agentId: a.id }, _count: { _all: true } }),
  ]);
  const { tokenHash: _h, secretsEnc, pendingEnc, configJson: _c, ...rest } = a;
  return {
    ...rest,
    online: Boolean(a.lastSeenAt && Date.now() - new Date(a.lastSeenAt).getTime() < 5 * 60_000),
    pollSeconds: Number(cfg.pollSeconds) || 60,
    tally: cfg.tally || null,
    ldap: cfg.ldap ? { ...cfg.ldap, passwordSet: Boolean(agentSecrets(a).ldapBindPassword) } : null,
    scimPending: Boolean(pendingEnc),
    readers,
    jobs: Object.fromEntries(jobs.map((j) => [j.status, j._count._all])),
  };
};

integrationsRouter.get(`${base}/agents`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await peoplePrisma.siteAgent.findMany({ where: { accountId, orgId }, orderBy: { createdAt: 'asc' } });
  res.json({ agents: await Promise.all(rows.map(agentRow)), baseUrl: agentBase(), downloadUrl: `${agentBase()}/download` });
});

integrationsRouter.post(`${base}/agents`, can(PermissionAction.CREATE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const p = agentSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the details.' });
  if ((await peoplePrisma.siteAgent.count({ where: { orgId } })) >= 10) return res.status(400).json({ error: 'Ten connectors is the most.' });
  const token = newAgentToken();
  const { ldap, tally, pollSeconds, name } = p.data;
  const { bindPassword, ...ldapCfg } = ldap || ({} as any);
  const a = await peoplePrisma.siteAgent.create({
    data: {
      accountId,
      orgId,
      name,
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(0, 12),
      configJson: JSON.stringify({ ...(pollSeconds ? { pollSeconds } : {}), ...(tally ? { tally } : {}), ...(ldap ? { ldap: ldapCfg } : {}) }),
      secretsEnc: bindPassword ? encryptSecret(JSON.stringify({ ldapBindPassword: bindPassword })) : null,
      createdByUserId: req.auth!.userId,
    },
  });
  if (ldap) await ensureScimForAgent(a, ldap.defaultRoleId ?? null);
  res.status(201).json({ token, agent: await agentRow(await peoplePrisma.siteAgent.findUniqueOrThrow({ where: { id: a.id } })), baseUrl: agentBase(), downloadUrl: `${agentBase()}/download` });
});

integrationsRouter.put(`${base}/agents/:id`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const a = await peoplePrisma.siteAgent.findFirst({ where: { id: String(req.params.id), orgId } });
  if (!a) return res.status(404).json({ error: 'No such connector.' });
  const p = agentSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the details.' });
  const { ldap, tally, pollSeconds, name, isActive } = p.data;
  const { bindPassword, ...ldapCfg } = ldap || ({} as any);
  const secrets = agentSecrets(a);
  if (ldap === null) delete secrets.ldapBindPassword;
  if (bindPassword) secrets.ldapBindPassword = bindPassword;
  const cfg = agentConfig(a);
  const next = { ...cfg, ...(pollSeconds ? { pollSeconds } : {}), tally: tally === undefined ? cfg.tally : tally, ldap: ldap === undefined ? cfg.ldap : ldap ? ldapCfg : undefined };
  if (!next.tally) delete next.tally;
  if (!next.ldap) delete next.ldap;
  await peoplePrisma.siteAgent.update({ where: { id: a.id }, data: { name, ...(isActive !== undefined ? { isActive } : {}), configJson: JSON.stringify(next), secretsEnc: Object.keys(secrets).length ? encryptSecret(JSON.stringify(secrets)) : null } });
  if (ldap) await ensureScimForAgent(a, ldap.defaultRoleId ?? null);
  res.json({ agent: await agentRow(await peoplePrisma.siteAgent.findUniqueOrThrow({ where: { id: a.id } })) });
});

/** A new token; the old one stops working at once. */
integrationsRouter.post(`${base}/agents/:id/rotate`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const a = await peoplePrisma.siteAgent.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId } });
  if (!a) return res.status(404).json({ error: 'No such connector.' });
  const token = newAgentToken();
  /* The SCIM token goes again with the new one, so a reinstalled agent has everything. */
  let pending: Record<string, string> = {};
  if (a.scimTokenId) {
    const { newScimToken } = await import('./scim.js');
    const st = newScimToken();
    await platformPrisma.scimToken.update({ where: { id: a.scimTokenId }, data: { tokenHash: hashToken(st), tokenPrefix: st.slice(0, 12) } }).catch(() => {});
    pending = { scimToken: st };
  }
  await peoplePrisma.siteAgent.update({ where: { id: a.id }, data: { tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12), pendingEnc: Object.keys(pending).length ? encryptSecret(JSON.stringify(pending)) : null } });
  res.json({ token, baseUrl: agentBase(), downloadUrl: `${agentBase()}/download` });
});

integrationsRouter.delete(`${base}/agents/:id`, can(PermissionAction.DELETE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const a = await peoplePrisma.siteAgent.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId } });
  if (!a) return res.status(404).json({ error: 'No such connector.' });
  await peoplePrisma.attendanceDevice.updateMany({ where: { agentId: a.id }, data: { agentId: null } });
  await peoplePrisma.agentJob.deleteMany({ where: { agentId: a.id } });
  if (a.scimTokenId) await platformPrisma.scimToken.deleteMany({ where: { id: a.scimTokenId } });
  await peoplePrisma.siteAgent.delete({ where: { id: a.id } });
  res.json({ ok: true });
});

integrationsRouter.get(`${base}/agents/:id/jobs`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const a = await peoplePrisma.siteAgent.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId }, select: { id: true } });
  if (!a) return res.status(404).json({ error: 'No such connector.' });
  const jobs = await peoplePrisma.agentJob.findMany({ where: { agentId: a.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ jobs: jobs.map(({ payloadJson, ...j }) => ({ ...j, label: (() => { try { return JSON.parse(payloadJson).label || j.kind; } catch { return j.kind; } })() })) });
});

integrationsRouter.get(`${base}/hr/adapters`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  res.json({ adapters: ADAPTERS.map(publicAdapter) });
});

integrationsRouter.get(`${base}/hr`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await peoplePrisma.hrConnection.findMany({ where: { accountId, orgId }, orderBy: { createdAt: 'asc' } });
  const pending = await peoplePrisma.hrOutbox.groupBy({ by: ['connectionId', 'status'], where: { orgId }, _count: { _all: true } });
  const counts = new Map<string, Record<string, number>>();
  for (const p of pending) counts.set(p.connectionId, { ...(counts.get(p.connectionId) || {}), [p.status]: p._count._all });
  res.json({ connections: rows.map((c) => ({ ...publicConnection(c), outbox: counts.get(c.id) || {} })) });
});

/** Fields come in as one object; the adapter says which are secret and those are encrypted together. */
function splitFields(adapterId: string, body: any) {
  const a = adapterOf(adapterId);
  if (!a) return null;
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const f of a.fields) {
    const v = body?.[f.key];
    if (v === undefined || v === null) continue;
    (f.secret ? secrets : config)[f.key] = String(v);
  }
  return { a, config, secrets };
}

integrationsRouter.post(`${base}/hr`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const split = splitFields(String(req.body?.adapter || ''), req.body?.fields || {});
  if (!split) return res.status(400).json({ error: 'Unknown HR tool.' });
  const missing = split.a.fields.filter((f) => f.required && !(f.secret ? split.secrets : split.config)[f.key]).map((f) => f.label);
  if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(', ')}.` });
  const name = String(req.body?.name || split.a.label).trim().slice(0, 80);
  const row = await peoplePrisma.hrConnection.create({
    data: {
      accountId, orgId, adapter: split.a.id, name, configJson: JSON.stringify(split.config), secretsEnc: Object.keys(split.secrets).length ? encryptSecrets(split.secrets) : null,
      enabled: Boolean(req.body?.enabled), pushPunches: req.body?.pushPunches !== false && split.a.capabilities.includes('pushPunches'),
      pullEmployees: Boolean(req.body?.pullEmployees) && split.a.capabilities.includes('pullEmployees'), createEmployees: Boolean(req.body?.createEmployees), createdByUserId: req.auth!.userId,
    },
  });
  res.status(201).json({ connection: publicConnection(row) });
});

integrationsRouter.put(`${base}/hr/:id`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const c = await peoplePrisma.hrConnection.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!c) return res.status(404).json({ error: 'No such connection.' });
  const split = splitFields(c.adapter, req.body?.fields || {});
  if (!split) return res.status(400).json({ error: 'Unknown HR tool.' });
  /* A blank secret keeps the stored one; a value replaces it. */
  const secrets = { ...secretsOf(c), ...Object.fromEntries(Object.entries(split.secrets).filter(([, v]) => v !== '')) };
  const row = await peoplePrisma.hrConnection.update({
    where: { id: c.id },
    data: {
      name: req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 80) : c.name,
      configJson: JSON.stringify({ ...configOf(c), ...split.config }), secretsEnc: Object.keys(secrets).length ? encryptSecrets(secrets) : null,
      enabled: req.body?.enabled !== undefined ? Boolean(req.body.enabled) : c.enabled,
      pushPunches: req.body?.pushPunches !== undefined ? Boolean(req.body.pushPunches) && split.a.capabilities.includes('pushPunches') : c.pushPunches,
      pullEmployees: req.body?.pullEmployees !== undefined ? Boolean(req.body.pullEmployees) && split.a.capabilities.includes('pullEmployees') : c.pullEmployees,
      createEmployees: req.body?.createEmployees !== undefined ? Boolean(req.body.createEmployees) : c.createEmployees,
    },
  });
  res.json({ connection: publicConnection(row) });
});

integrationsRouter.delete(`${base}/hr/:id`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const c = await peoplePrisma.hrConnection.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!c) return res.status(404).json({ error: 'No such connection.' });
  await peoplePrisma.hrOutbox.deleteMany({ where: { connectionId: c.id } });
  await peoplePrisma.hrSyncLog.deleteMany({ where: { connectionId: c.id } });
  await peoplePrisma.hrConnection.delete({ where: { id: c.id } });
  res.json({ ok: true });
});

/** Prove the credentials work, without sending anything that counts. */
integrationsRouter.post(`${base}/hr/:id/test`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const c = await peoplePrisma.hrConnection.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!c) return res.status(404).json({ error: 'No such connection.' });
  const a = adapterOf(c.adapter);
  if (!a) return res.status(400).json({ error: 'Unknown HR tool.' });
  try {
    const r = await a.test(configOf(c), secretsOf(c));
    await peoplePrisma.hrConnection.update({ where: { id: c.id }, data: { lastError: r.ok ? null : r.message } });
    res.json(r);
  } catch (e: any) {
    res.json({ ok: false, message: String(e?.message || e) });
  }
});

/** Read its people now, rather than at the next hour. */
integrationsRouter.post(`${base}/hr/:id/pull`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const c = await peoplePrisma.hrConnection.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!c) return res.status(404).json({ error: 'No such connection.' });
  res.json(await pullEmployees(c, req.auth!.userId));
});

/** Send what is waiting now, rather than at the next minute. */
integrationsRouter.post(`${base}/hr/:id/flush`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const c = await peoplePrisma.hrConnection.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!c) return res.status(404).json({ error: 'No such connection.' });
  await peoplePrisma.hrOutbox.updateMany({ where: { connectionId: c.id, status: 'PENDING' }, data: { nextAttemptAt: new Date() } });
  res.json({ sent: await flushOutbox() });
});

integrationsRouter.get(`${base}/hr/:id/log`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const c = await peoplePrisma.hrConnection.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!c) return res.status(404).json({ error: 'No such connection.' });
  const [log, failed] = await Promise.all([
    peoplePrisma.hrSyncLog.findMany({ where: { connectionId: c.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    peoplePrisma.hrOutbox.findMany({ where: { connectionId: c.id, status: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, key: true, lastError: true, attempts: true, createdAt: true } }),
  ]);
  res.json({ log, failed });
});
