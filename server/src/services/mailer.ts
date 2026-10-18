import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import nodemailer from 'nodemailer';
// Nodemailer 10 no longer exposes its types under the default export's
// namespace, so the transporter type is imported by name.
import type { Transporter } from 'nodemailer';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { TEMPLATE_BY_KEY, render } from '../constants/emailTemplates.js';
import { isDevOrTest } from '../utils/devMode.js';

/**
 * Sending mail.
 *
 * Every message is written to `EmailOutbox` before a delivery is attempted, so
 * there is always a record of what the product tried to send and what happened
 * — which is the first question asked when a customer says "I never got it".
 *
 * Three transports:
 *  - an organisation's own SMTP server, when configured;
 *  - the platform's SMTP server, from environment variables;
 *  - a capture transport used when neither is configured, which records the
 *    message as SENT without dialling out. That keeps development and the test
 *    suite honest about content without needing a mail server.
 */

const APP_NAME = process.env.APP_NAME || 'CLOR';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

// ---------------------------------------------------------------------------
// Credential encryption
// ---------------------------------------------------------------------------

/**
 * SMTP passwords are stored encrypted, not hashed: they must be replayed to the
 * mail server. The key is derived from MAIL_SECRET_KEY, falling back to
 * JWT_SECRET so a single-secret deployment still works.
 */
function encryptionKey() {
  const secret = process.env.MAIL_SECRET_KEY || process.env.JWT_SECRET || (isDevOrTest() ? 'dev-secret' : '');
  if (!secret) throw new Error('MAIL_SECRET_KEY (or JWT_SECRET) must be set to store credentials.');
  return createHash('sha256').update(String(secret)).digest();
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(payload: string) {
  const [ivB64, tagB64, dataB64] = String(payload || '').split('.');
  if (!ivB64 || !tagB64 || !dataB64) return '';
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // A rotated key makes old ciphertext unreadable; treat it as unset rather
    // than crashing a send.
    return '';
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type ResolvedTransport =
  | { kind: 'smtp'; transporter: Transporter; from: string; replyTo?: string }
  | { kind: 'capture'; from: string; replyTo?: string };

const captureFrom = () => `${APP_NAME} <no-reply@localhost>`;

/**
 * Timeouts are not optional here. Without them a wrong host leaves the request
 * waiting on the operating system's TCP timeout, which can be minutes, and the
 * user sees a hung page rather than 'could not connect'.
 */
const SMTP_TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS || 10_000);

function buildSmtp(opts: {
  host: string;
  port: number;
  secure: boolean;
  user?: string | null;
  pass?: string | null;
}) {
  return nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.secure,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    ...(opts.user ? { auth: { user: opts.user, pass: opts.pass || '' } } : {}),
  });
}

export async function resolveTransport(accountId?: string | null, orgId?: string | null): Promise<ResolvedTransport> {
  if (orgId) {
    const setting = await platformPrisma.emailSetting.findUnique({ where: { orgId } });
    if (setting && setting.provider === 'SMTP' && setting.host && setting.port) {
      const from = setting.fromEmail
        ? `${setting.fromName || APP_NAME} <${setting.fromEmail}>`
        : captureFrom();
      return {
        kind: 'smtp',
        transporter: buildSmtp({
          host: setting.host,
          port: setting.port,
          secure: setting.secure,
          user: setting.username,
          pass: setting.passwordEnc ? decryptSecret(setting.passwordEnc) : '',
        }),
        from,
        replyTo: setting.replyTo || undefined,
      };
    }
  }

  const host = process.env.SMTP_HOST;
  if (host) {
    return {
      kind: 'smtp',
      transporter: buildSmtp({
        host,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || 'false') === 'true',
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      }),
      from: process.env.SMTP_FROM || captureFrom(),
    };
  }

  return { kind: 'capture', from: captureFrom() };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type SendOptions = {
  templateKey: string;
  to: string;
  toName?: string;
  data?: Record<string, unknown>;
  accountId?: string | null;
  orgId?: string | null;
  relatedType?: string;
  relatedId?: string;
  /** Set for messages the recipient cannot opt out of. */
  transactional?: boolean;
  /** An HTML rendering to send alongside the text (a report table); the text stays the fallback. */
  html?: string;
};

/**
 * Renders, records and attempts one message.
 *
 * Never throws: a failed notification must not fail the business operation that
 * triggered it. The outcome lands in the outbox either way.
 */
export async function sendTemplate(opts: SendOptions) {
  const template = TEMPLATE_BY_KEY.get(opts.templateKey);
  if (!template) throw new Error(`Unknown email template: ${opts.templateKey}`);

  const data = {
    appName: APP_NAME,
    appUrl: APP_URL,
    ...(opts.data || {}),
  };

  const subject = render(template.subject, data);
  const bodyText = render(template.body, data);

  // Optional notifications honour the org's settings; transactional mail does not.
  if (!template.transactional && !opts.transactional && opts.orgId) {
    const setting = await platformPrisma.notificationSetting.findUnique({
      where: { orgId_eventKey: { orgId: opts.orgId, eventKey: template.key } },
    });
    if (setting && !setting.enabled) {
      return platformPrisma.emailOutbox.create({
        data: {
          accountId: opts.accountId ?? null,
          orgId: opts.orgId ?? null,
          templateKey: template.key,
          toEmail: opts.to,
          toName: opts.toName ?? null,
          subject,
          bodyText,
          status: 'SUPPRESSED',
          lastError: 'Notification switched off for this organisation',
          relatedType: opts.relatedType ?? null,
          relatedId: opts.relatedId ?? null,
        },
      });
    }
  }

  const row = await platformPrisma.emailOutbox.create({
    data: {
      accountId: opts.accountId ?? null,
      orgId: opts.orgId ?? null,
      templateKey: template.key,
      toEmail: opts.to,
      toName: opts.toName ?? null,
      subject,
      bodyText,
      bodyHtml: opts.html ?? null,
      status: 'QUEUED',
      relatedType: opts.relatedType ?? null,
      relatedId: opts.relatedId ?? null,
    },
  });

  return deliver(row.id, opts.accountId, opts.orgId);
}

/**
 * The message with any link token taken out.
 *
 * Reset and verification tokens are stored only as hashes, so a database
 * copy cannot be used to take over an account — but the outbox kept the
 * rendered email, live link and all, in plain text in the database and every
 * backup. Once the message has gone, the stored copy keeps the shape of the
 * link and loses the secret. A message still waiting to be retried keeps it;
 * those tokens expire on their own (30 minutes, 24 hours).
 */
export const withoutLinkTokens = (text: string) =>
  String(text || '').replace(/([?&](?:token|share)=)[^\s&"'<>]+/gi, '$1[removed-after-sending]');

/** Attempts delivery of one outbox row and records the result. */
export async function deliver(outboxId: string, accountId?: string | null, orgId?: string | null) {
  const row = await platformPrisma.emailOutbox.findUnique({ where: { id: outboxId } });
  if (!row || row.status === 'SENT' || row.status === 'SUPPRESSED') return row;

  const transport = await resolveTransport(accountId ?? row.accountId, orgId ?? row.orgId);

  try {
    if (transport.kind === 'smtp') {
      await transport.transporter.sendMail({
        from: transport.from,
        replyTo: transport.replyTo,
        to: row.toName ? `${row.toName} <${row.toEmail}>` : row.toEmail,
        subject: row.subject,
        text: row.bodyText,
        ...(row.bodyHtml ? { html: row.bodyHtml } : {}),
      });
    }
    // The capture transport records the message without dialling out.

    return platformPrisma.emailOutbox.update({
      where: { id: row.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
        // Delivered: the stored copy no longer needs the working link.
        bodyText: withoutLinkTokens(row.bodyText),
        ...(row.bodyHtml ? { bodyHtml: withoutLinkTokens(row.bodyHtml) } : {}),
      },
    });
  } catch (e: any) {
    return platformPrisma.emailOutbox.update({
      where: { id: row.id },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        lastError: String(e?.message || e).slice(0, 500),
      },
    });
  }
}

/** Retries failed messages, newest first. Safe to call repeatedly. */
export async function retryFailed(accountId: string, orgId: string, limit = 25) {
  const rows = await platformPrisma.emailOutbox.findMany({
    where: { accountId, orgId, status: 'FAILED', attempts: { lt: 5 } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true },
  });
  for (const r of rows) await deliver(r.id, accountId, orgId);
  return rows.length;
}

/** Confirms an SMTP configuration without saving a broken one. */
export async function verifyTransport(config: {
  host: string;
  port: number;
  secure: boolean;
  username?: string | null;
  password?: string | null;
}) {
  const transporter = buildSmtp({
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.username,
    pass: config.password,
  });
  await transporter.verify();
  return true;
}
