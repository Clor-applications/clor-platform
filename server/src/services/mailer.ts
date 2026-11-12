import { isArchived } from './companyArchive.js';
import { isSampleOrg } from './sampleIdentity.js';
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
 * SMTP passwords, SSO and connector secrets, webhook secrets and share-link
 * copies are stored encrypted, not hashed: they must be replayed. The key is
 * derived from MAIL_SECRET_KEY, falling back to JWT_SECRET so a single-secret
 * deployment still works.
 *
 * A-34: a stored secret now says which key made it and is bound to this box.
 *   v2.<key id>.<iv>.<tag>.<data>   key id = a fingerprint of the key, never the key
 *   <iv>.<tag>.<data>               the shape before; still read
 * To change the key, set the new MAIL_SECRET_KEY and put the old one in
 * MAIL_SECRET_KEY_PREVIOUS (comma separated for several): old secrets still
 * open, and are written again under the new key as they are saved.
 *
 * This release still writes the old shape, because instances of the previous
 * release read only that during a rolling deploy (and after a rollback).
 * SECRET_FORMAT=v2 writes the new one; it becomes the default next release.
 */
/*
 * Audit 11 Nov 2026: the key that seals stored credentials must not be the key
 * that signs sessions, or one leak opens both. In production a new secret is
 * sealed only with MAIL_SECRET_KEY; without it saving a credential is refused.
 * Secrets sealed earlier under JWT_SECRET still open (candidateSecrets) and
 * move to the proper key the next time they are saved.
 */
const currentSecret = () => process.env.MAIL_SECRET_KEY || (isDevOrTest() ? process.env.JWT_SECRET : '') || (isDevOrTest() ? 'dev-secret' : '');
/** For the boot check (index.ts): whether stored credentials have their own key. */
export const hasOwnSecretKey = () => Boolean(String(process.env.MAIL_SECRET_KEY || '').trim());
const deriveKey = (secret: string) => createHash('sha256').update(String(secret)).digest();
/** Which key made a secret, without saying anything about the key. */
export const keyIdOf = (secret: string) => createHash('sha256').update(`clor-key-id:${secret}`).digest('hex').slice(0, 16);
/** What every v2 secret is bound to: a ciphertext made for anything else, with the same key, does not open here. */
const AAD = Buffer.from('clor-secret-box:v2');

/** Every key a stored secret may have been made with, the current first. */
function candidateSecrets() {
  const all = [currentSecret(), ...String(process.env.MAIL_SECRET_KEY_PREVIOUS || '').split(','), process.env.JWT_SECRET || '', isDevOrTest() ? 'dev-secret' : '']
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(all)];
}

function encryptionKey() {
  const secret = currentSecret();
  if (!secret) throw new Error('MAIL_SECRET_KEY must be set to store credentials.');
  return deriveKey(secret);
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const v2 = process.env.SECRET_FORMAT === 'v2';
  if (v2) cipher.setAAD(AAD);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const body = `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
  return v2 ? `v2.${keyIdOf(currentSecret())}.${body}` : body;
}

function open(secret: string, iv: string, tag: string, data: string, aad: boolean) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64'));
    if (aad) decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** The plain secret and whether it was made with a key other than the current one. */
function openAny(payload: string): { plain: string; stale: boolean } {
  const parts = String(payload || '').split('.');
  const current = currentSecret();
  if (parts[0] === 'v2' && parts.length === 5) {
    const [, kid, iv, tag, data] = parts;
    const secret = candidateSecrets().find((k) => keyIdOf(k) === kid);
    const plain = secret ? open(secret, iv, tag, data, true) : null;
    return plain == null ? { plain: '', stale: false } : { plain, stale: secret !== current };
  }
  const [iv, tag, data] = parts;
  if (parts.length !== 3 || !iv || !tag || !data) return { plain: '', stale: false };
  for (const k of candidateSecrets()) {
    const plain = open(k, iv, tag, data, false);
    if (plain != null) return { plain, stale: k !== current };
  }
  return { plain: '', stale: false };
}

export function decryptSecret(payload: string) {
  // A key that is gone makes old ciphertext unreadable; treat it as unset rather than crashing a send.
  return openAny(payload).plain;
}

/**
 * Decrypt with the current key or any key it may have been made with before
 * (MAIL_SECRET_KEY_PREVIOUS, or JWT_SECRET from before MAIL_SECRET_KEY was
 * set). `stale` says the caller should store it again under the current key.
 * Used for share links (A-32), where an unreadable copy would mean a new
 * address for a customer who already has the old one.
 */
export function decryptSecretAnyKey(payload: string): { plain: string; stale: boolean } {
  return openAny(payload);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/** `source`: a company's own mail server, or the platform's (where CLOR's sender addresses apply). */
export type ResolvedTransport =
  | { kind: 'smtp'; transporter: Transporter; from: string; replyTo?: string; source?: 'org' | 'system' }
  | { kind: 'capture'; from: string; replyTo?: string; source?: 'org' | 'system' };

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
        source: 'org',
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
      source: 'system',
    };
  }

  return { kind: 'capture', from: captureFrom(), source: 'system' };
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
  /** Small files to send with it (a report CSV). Stored with the message so a retry carries them. */
  attachments?: Array<{ filename: string; contentType: string; content: string }>;
};

/**
 * Renders, records and attempts one message.
 *
 * Never throws: a failed notification must not fail the business operation that
 * triggered it. The outcome lands in the outbox either way.
 */
export async function sendTemplate(opts: SendOptions) {
  const builtIn = TEMPLATE_BY_KEY.get(opts.templateKey);
  if (!builtIn) throw new Error(`Unknown email template: ${opts.templateKey}`);
  /* CLOR's own wording, set in the operator console (Email, Templates), where there is some. */
  const template = { ...builtIn, ...((await templateOverride(builtIn.key)) || {}) };

  const data = {
    appName: APP_NAME,
    appUrl: APP_URL,
    ...(opts.data || {}),
  };

  const subject = render(template.subject, data);
  const bodyText = render(template.body, data);

  /* Explore's sample company sends nothing: its people and customers are made up (services/sampleIdentity.ts). */
  const sample = Boolean(opts.orgId) && (await isSampleOrg(opts.orgId));
  /* An archived company sends nothing (services/companyArchive.ts): kept as SUPPRESSED so it can be seen. Closure notices still go. */
  if (opts.orgId && (sample || (!String(template.key).startsWith('closure') && (await isArchived(opts.orgId))))) {
    return platformPrisma.emailOutbox.create({
      data: {
        accountId: opts.accountId ?? null,
        orgId: opts.orgId,
        templateKey: template.key,
        toEmail: opts.to,
        toName: opts.toName ?? null,
        subject,
        bodyText,
        status: 'SUPPRESSED',
        lastError: sample ? 'Sample company: nothing is sent' : 'Company archived',
        relatedType: opts.relatedType ?? null,
        relatedId: opts.relatedId ?? null,
      },
    });
  }

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
      attachmentsJson: opts.attachments?.length
        ? JSON.stringify(opts.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, base64: Buffer.from(a.content, 'utf8').toString('base64') })))
        : null,
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
 * those tokens expire on their own (30 minutes, 24 hours; an Explore link,
 * `?t=`, in 14 days, and Resend replaces it).
 */
export const withoutLinkTokens = (text: string) =>
  String(text || '').replace(/([?&](?:token|share|reset|verify|t)=)[^\s&"'<>]+/gi, '$1[removed-after-sending]');

/** The wording an operator set for a template, if any. A missing table or row means the built-in wording. */
async function templateOverride(key: string): Promise<{ subject: string; body: string } | null> {
  try {
    return await platformPrisma.emailTemplateOverride.findUnique({ where: { key }, select: { subject: true, body: true } });
  } catch {
    return null;
  }
}

/** Which of CLOR's sender addresses a template goes out from, on the platform's mail server. */
export const SENDER_PURPOSES = ['sales', 'support', 'billing', 'no-reply'] as const;
export type SenderPurpose = (typeof SENDER_PURPOSES)[number];
export function senderPurposeFor(templateKey: string): SenderPurpose {
  if (/^(sales|explore)\./.test(templateKey)) return 'sales';
  if (/^(billing|payment|subscription|trial)\./.test(templateKey)) return 'billing';
  if (/^support\./.test(templateKey)) return 'support';
  return 'no-reply';
}

/** The From (and Reply-To) for a message on the platform's server: the sender set in the console, else the server's own. */
async function platformSender(row: { templateKey: string; relatedType: string | null; relatedId: string | null }, fallback: string) {
  const purpose = row.relatedType === 'EmailSenderTest' && row.relatedId ? row.relatedId : senderPurposeFor(row.templateKey);
  try {
    const s = await platformPrisma.emailSender.findUnique({ where: { purpose } });
    if (s?.email) return { from: `${s.name || APP_NAME} <${s.email}>`, replyTo: s.replyTo || undefined };
  } catch {
    /* No sender table yet: the server's address. */
  }
  return { from: fallback, replyTo: undefined };
}

/** Attempts delivery of one outbox row and records the result. */
export async function deliver(outboxId: string, accountId?: string | null, orgId?: string | null) {
  const row = await platformPrisma.emailOutbox.findUnique({ where: { id: outboxId } });
  if (!row || row.status === 'SENT' || row.status === 'SUPPRESSED') return row;

  const resolved = await resolveTransport(accountId ?? row.accountId, orgId ?? row.orgId);
  const transport = resolved.source === 'system' ? { ...resolved, ...(await platformSender(row, resolved.from)) } : resolved;

  try {
    if (transport.kind === 'smtp') {
      await transport.transporter.sendMail({
        from: transport.from,
        replyTo: transport.replyTo,
        to: row.toName ? `${row.toName} <${row.toEmail}>` : row.toEmail,
        subject: row.subject,
        text: row.bodyText,
        ...(row.bodyHtml ? { html: row.bodyHtml } : {}),
        ...(row.attachmentsJson
          ? { attachments: (JSON.parse(row.attachmentsJson) as Array<{ filename: string; contentType: string; base64: string }>).map((a) => ({ filename: a.filename, contentType: a.contentType, content: Buffer.from(a.base64, 'base64') })) }
          : {}),
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
