import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { EMAIL_TEMPLATES, NOTIFICATION_EVENTS } from '../constants/emailTemplates.js';
import { encryptSecret, retryFailed, sendTemplate, verifyTransport } from '../services/mailer.js';

/**
 * Email configuration, notification preferences, and the delivery log.
 */
export const emailRouter = Router();
emailRouter.use(requireAuth, requireTenantContext);

const SETTINGS_VIEW = requirePermission('SETTINGS', PermissionAction.VIEW, 'Company Profile');
const SETTINGS_EDIT = requirePermission('SETTINGS', PermissionAction.EDIT, 'Company Profile');

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// SMTP settings
// ---------------------------------------------------------------------------

const settingsSchema = z.object({
  provider: z.enum(['SYSTEM', 'SMTP']),
  host: z.string().max(200).optional().nullable(),
  port: z.number().int().min(1).max(65535).optional().nullable(),
  secure: z.boolean().optional(),
  username: z.string().max(200).optional().nullable(),
  // Absent means "leave the stored password alone"; empty string clears it.
  password: z.string().max(300).optional(),
  fromName: z.string().max(120).optional().nullable(),
  fromEmail: z.string().email().max(200).optional().nullable(),
  replyTo: z.string().email().max(200).optional().nullable(),
});

/** The password is never returned, only whether one is stored. */
const publicSettings = (row: any) =>
  row
    ? {
        provider: row.provider,
        host: row.host,
        port: row.port,
        secure: row.secure,
        username: row.username,
        hasPassword: Boolean(row.passwordEnc),
        fromName: row.fromName,
        fromEmail: row.fromEmail,
        replyTo: row.replyTo,
        verifiedAt: row.verifiedAt,
        lastError: row.lastError,
      }
    : { provider: 'SYSTEM', hasPassword: false };

emailRouter.get('/orgs/:orgId/email/settings', SETTINGS_VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const row = await platformPrisma.emailSetting.findUnique({ where: { orgId: req.tenant!.orgId } });
  res.json({ settings: publicSettings(row) });
});

emailRouter.put('/orgs/:orgId/email/settings', SETTINGS_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const body = settingsSchema.parse(req.body);

  if (body.provider === 'SMTP' && (!body.host || !body.port)) {
    return res.status(400).json({ error: 'Host and port are required for an SMTP server' });
  }

  const existing = await platformPrisma.emailSetting.findUnique({ where: { orgId } });

  const passwordEnc =
    body.password === undefined
      ? existing?.passwordEnc ?? null
      : body.password === ''
      ? null
      : encryptSecret(body.password);

  const data = {
    accountId,
    orgId,
    provider: body.provider,
    host: body.host ?? null,
    port: body.port ?? null,
    secure: body.secure ?? true,
    username: body.username ?? null,
    passwordEnc,
    fromName: body.fromName ?? null,
    fromEmail: body.fromEmail ?? null,
    replyTo: body.replyTo ?? null,
    updatedByUserId: req.auth!.userId,
  };

  const saved = existing
    ? await platformPrisma.emailSetting.update({ where: { orgId }, data })
    : await platformPrisma.emailSetting.create({ data });

  res.json({ settings: publicSettings(saved) });
});

/** Dials the server before trusting a configuration. */
emailRouter.post('/orgs/:orgId/email/test-connection', SETTINGS_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const body = settingsSchema.parse(req.body);
  if (body.provider !== 'SMTP') return res.json({ ok: true, note: 'Using the platform mail server' });
  if (!body.host || !body.port) return res.status(400).json({ error: 'Host and port are required' });

  const existing = await platformPrisma.emailSetting.findUnique({ where: { orgId: req.tenant!.orgId } });
  const password =
    body.password !== undefined
      ? body.password
      : existing?.passwordEnc
      ? undefined // decrypted inside the mailer when it builds from stored settings
      : '';

  try {
    await verifyTransport({
      host: body.host,
      port: body.port,
      secure: body.secure ?? true,
      username: body.username ?? null,
      password: password ?? '',
    });
    await platformPrisma.emailSetting.updateMany({
      where: { orgId: req.tenant!.orgId },
      data: { verifiedAt: new Date(), lastError: null },
    });
    res.json({ ok: true });
  } catch (e: any) {
    const message = String(e?.message || e).slice(0, 300);
    await platformPrisma.emailSetting.updateMany({
      where: { orgId: req.tenant!.orgId },
      data: { lastError: message },
    });
    res.status(400).json({ ok: false, error: message });
  }
});

/** Sends a real message to the caller, which is the only honest test. */
emailRouter.post('/orgs/:orgId/email/send-test', SETTINGS_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;

  const user = await platformPrisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: { email: true, fullName: true },
  });
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const row = await sendTemplate({
    templateKey: 'auth.verify_email',
    to: user.email,
    toName: user.fullName,
    accountId,
    orgId,
    transactional: true,
    data: { userName: user.fullName, email: user.email, verifyUrl: '(test message — no action needed)' },
  });

  res.json({ ok: row?.status === 'SENT', status: row?.status, error: row?.lastError, to: user.email });
});

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

emailRouter.get('/orgs/:orgId/notifications', SETTINGS_VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const rows = await platformPrisma.notificationSetting.findMany({ where: { orgId: req.tenant!.orgId } });
  const byKey = new Map(rows.map((r) => [r.eventKey, r]));

  res.json({
    events: NOTIFICATION_EVENTS.map((e) => ({
      ...e,
      enabled: byKey.get(e.key)?.enabled ?? true,
      extraRecipients: byKey.get(e.key)?.extraRecipients ?? '',
    })),
    templates: EMAIL_TEMPLATES.map((t) => ({
      key: t.key,
      label: t.label,
      subject: t.subject,
      fields: t.fields,
      transactional: Boolean(t.transactional),
    })),
  });
});

const notificationSchema = z.object({
  events: z.array(
    z.object({
      eventKey: z.string().min(1),
      enabled: z.boolean(),
      extraRecipients: z.string().max(500).optional().nullable(),
    })
  ),
});

emailRouter.put('/orgs/:orgId/notifications', SETTINGS_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const body = notificationSchema.parse(req.body);

  const known = new Set(NOTIFICATION_EVENTS.map((e) => e.key));
  for (const e of body.events) {
    if (!known.has(e.eventKey)) return res.status(400).json({ error: `Unknown notification: ${e.eventKey}` });
  }

  for (const e of body.events) {
    await platformPrisma.notificationSetting.upsert({
      where: { orgId_eventKey: { orgId, eventKey: e.eventKey } },
      update: {
        enabled: e.enabled,
        extraRecipients: e.extraRecipients ?? null,
        updatedByUserId: req.auth!.userId,
      },
      create: {
        accountId,
        orgId,
        eventKey: e.eventKey,
        enabled: e.enabled,
        extraRecipients: e.extraRecipients ?? null,
        updatedByUserId: req.auth!.userId,
      },
    });
  }

  res.json({ ok: true, updated: body.events.length });
});

// ---------------------------------------------------------------------------
// Delivery log
// ---------------------------------------------------------------------------

emailRouter.get('/orgs/:orgId/email/outbox', SETTINGS_VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const rows = await platformPrisma.emailOutbox.findMany({
    where: {
      orgId: req.tenant!.orgId,
      ...(req.query.status ? { status: String(req.query.status) } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, Number(req.query.limit || 50)),
    select: {
      id: true,
      templateKey: true,
      toEmail: true,
      subject: true,
      status: true,
      attempts: true,
      lastError: true,
      sentAt: true,
      createdAt: true,
    },
  });
  res.json({ messages: rows });
});

emailRouter.post('/orgs/:orgId/email/outbox/retry', SETTINGS_EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const count = await retryFailed(req.tenant!.accountId, req.tenant!.orgId);
  res.json({ ok: true, retried: count });
});
