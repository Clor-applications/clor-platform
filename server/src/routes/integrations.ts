import { Router } from 'express';
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
