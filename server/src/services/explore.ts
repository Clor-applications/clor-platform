import { createHash, randomBytes } from 'node:crypto';

import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { createSession, recordAuthEvent, signAccessToken } from './auth.js';
import { sendTemplate } from './mailer.js';
import { ensureSampleCompany } from './sampleCompany.js';

/**
 * Explore (roadmap item 6): after asking for a demo, a visitor gets a link
 * that opens the shared sample company (services/sampleCompany.ts) for 14
 * days, read-only.
 *
 * The pass. A random token goes out in the link; only its SHA-256 is kept
 * (ExplorePass.tokenHash), and the sent mail keeps no copy of it either
 * (mailer.ts, withoutLinkTokens). Resend makes a new token, so the old link
 * stops working.
 *
 * The session. Opening the link trades the token for an ordinary CLOR
 * session (services/auth.ts createSession, the same refresh cookie and
 * access token as a sign-in) as the sample company's one viewer login. The
 * session carries the pass (Session.explorePassId, kept through every
 * rotation) and every access token says so (`xp`), which is what
 * middleware/exploreReadOnly.ts reads to refuse every change. It ends when
 * the pass does: never later than the pass's expiry, and at once when an
 * operator ends access (its sessions are revoked, and a refresh checks the
 * pass again).
 */

export const EXPLORE_DAYS = 14;
const DAY = 86_400_000;
/** What a refused change says, on the server and in the app's toast. */
export const EXPLORE_READ_ONLY_TEXT = 'This is a sample company, so changes are off.';
export const EXPLORE_APPS = ['accounting', 'payroll', 'people', 'attendance'];

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const appUrl = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

export class ExploreEnded extends Error {
  status = 410;
  code = 'EXPLORE_ENDED';
  constructor() {
    super('This link has ended.');
  }
}

/** The link in the mail: the app's /explore page, the token, and the app to open first. */
export const exploreUrl = (token: string, app?: string | null) => `${appUrl()}/explore?t=${encodeURIComponent(token)}${app && EXPLORE_APPS.includes(app) ? `&app=${app}` : ''}`;

type PassRow = { id: string; expiresAt: Date; revokedAt: Date | null };
/** active, expired (ran out) or ended (an operator ended it). */
export const passState = (p: PassRow, now = Date.now()) => (p.revokedAt ? 'ended' : p.expiresAt.getTime() <= now ? 'expired' : 'active');

/** What the operator console shows of a pass. */
export const passSummary = (p: any) =>
  p
    ? {
        id: p.id,
        email: p.email,
        app: p.app,
        state: passState(p),
        createdAt: p.createdAt,
        sentAt: p.sentAt,
        sendCount: p.sendCount,
        lastUsedAt: p.lastUsedAt,
        useCount: p.useCount,
        expiresAt: p.expiresAt,
        revokedAt: p.revokedAt,
      }
    : null;

const APP_NAMES: Record<string, string> = { accounting: 'Books', payroll: 'Payroll', people: 'People', attendance: 'Attendance' };
const onDay = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** Mail the link (a new token each time it is sent). */
async function mailPass(pass: { id: string; email: string; app: string | null; expiresAt: Date }, token: string, name: string, apps: string[]) {
  const names = apps.map((a) => APP_NAMES[a]).filter(Boolean);
  await sendTemplate({
    templateKey: 'explore.pass',
    to: pass.email,
    toName: name || undefined,
    relatedType: 'ExplorePass',
    relatedId: pass.id,
    transactional: true,
    data: {
      name: name || 'there',
      apps: names.length ? names.join(', ') : 'CLOR',
      exploreUrl: exploreUrl(token, pass.app),
      days: String(EXPLORE_DAYS),
      expiresOn: onDay(pass.expiresAt),
    },
  });
  await platformPrisma.explorePass.update({ where: { id: pass.id }, data: { sentAt: new Date(), sendCount: { increment: 1 } } });
}

/**
 * A pass for a demo request, mailed to the visitor. Returns the link too: the
 * demo form's thank-you shows "Explore the apps now" with it.
 */
export async function issueExplorePass(input: { demoRequestId: string; email: string; name: string; apps: string[] }) {
  return outsideTenant('explore: a pass for a visitor with no account', async () => {
    const token = newToken();
    const app = input.apps.find((a) => EXPLORE_APPS.includes(a)) || null;
    const pass = await platformPrisma.explorePass.create({
      data: { demoRequestId: input.demoRequestId, email: input.email.trim().toLowerCase(), tokenHash: sha256(token), app, expiresAt: new Date(Date.now() + EXPLORE_DAYS * DAY) },
    });
    await mailPass(pass, token, input.name, input.apps);
    return { pass, url: exploreUrl(token, app) };
  });
}

/**
 * Trade a pass's token for a session as the sample company's viewer. Throws
 * ExploreEnded for a token that is unknown, ran out or was ended: the same
 * answer for each, so the page cannot be used to test tokens.
 */
export async function openExploreSession(token: string, ctx: { ip?: string; userAgent?: string }) {
  return outsideTenant('explore: open the sample company', async () => {
    const t = String(token || '').trim();
    const pass = t.length >= 20 ? await platformPrisma.explorePass.findUnique({ where: { tokenHash: sha256(t) } }) : null;
    if (!pass || passState(pass) !== 'active') throw new ExploreEnded();
    const company = await ensureSampleCompany();
    const { session, refreshToken } = await createSession({
      accountId: company.accountId,
      userId: company.viewerUserId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      days: EXPLORE_DAYS,
      notAfter: pass.expiresAt,
      explorePassId: pass.id,
    });
    await platformPrisma.explorePass.update({ where: { id: pass.id }, data: { useCount: { increment: 1 }, lastUsedAt: new Date() } });
    await recordAuthEvent({ accountId: company.accountId, userId: company.viewerUserId, email: pass.email, eventType: 'EXPLORE_OPENED', ip: ctx.ip, userAgent: ctx.userAgent, detail: JSON.stringify({ explorePassId: pass.id }) });
    return {
      accessToken: signAccessToken({ userId: company.viewerUserId, accountId: company.accountId, sid: session.id, xp: pass.id }),
      refreshToken,
      session,
      pass,
      company,
    };
  });
}

/** For /auth/me: when the pass ends and the app it was for. Null when the pass is gone. */
export async function exploreInfo(passId: string) {
  const p = await outsideTenant('explore: the pass behind this session', () => platformPrisma.explorePass.findUnique({ where: { id: passId }, select: { id: true, app: true, expiresAt: true, revokedAt: true } }));
  if (!p) return null;
  const daysLeft = Math.max(0, Math.ceil((p.expiresAt.getTime() - Date.now()) / DAY));
  return { expiresAt: p.expiresAt, daysLeft, app: p.app, state: passState(p) };
}

/** Every session a pass opened ends now (an operator ended access, or a new link replaced the old one). */
async function endSessionsOf(passId: string, reason: string) {
  return platformPrisma.session.updateMany({ where: { explorePassId: passId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
}

/**
 * Resend (operator): a new link, mailed. The old link stops working. A pass
 * that had ended or run out opens again for another 14 days from now.
 */
export async function resendExplorePass(passId: string, name: string, apps: string[]) {
  return outsideTenant('explore: resend a pass', async () => {
    const p = await platformPrisma.explorePass.findUnique({ where: { id: passId } });
    if (!p) return null;
    const token = newToken();
    const reopen = passState(p) !== 'active';
    const pass = await platformPrisma.explorePass.update({
      where: { id: passId },
      data: { tokenHash: sha256(token), ...(reopen ? { revokedAt: null, revokedByUserId: null, expiresAt: new Date(Date.now() + EXPLORE_DAYS * DAY) } : {}) },
    });
    await mailPass(pass, token, name, apps);
    /* The link goes out only in the mail; `url` is for this server's own callers (tests), never an answer to the console. */
    return { pass: await platformPrisma.explorePass.findUnique({ where: { id: passId } }), reopened: reopen, url: exploreUrl(token, pass.app) };
  });
}

/** End access (operator): the link stops working and every session it opened ends. */
export async function endExplorePass(passId: string, byUserId: string) {
  return outsideTenant('explore: end a pass', async () => {
    const p = await platformPrisma.explorePass.findUnique({ where: { id: passId } });
    if (!p) return null;
    const pass = p.revokedAt ? p : await platformPrisma.explorePass.update({ where: { id: passId }, data: { revokedAt: new Date(), revokedByUserId: byUserId } });
    const ended = await endSessionsOf(passId, 'EXPLORE_ENDED');
    return { pass, sessionsEnded: ended.count };
  });
}
