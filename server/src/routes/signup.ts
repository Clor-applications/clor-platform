import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { signupLinkLimiter, signupStartLimiter } from '../middleware/rateLimit.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { setRefreshCookie } from '../utils/refreshCookie.js';
import { isDevOrTest } from '../utils/devMode.js';
import { deriveStateCodeFromInput } from '../utils/gstin.js';
import { clientIp, createSession, recordAuthEvent, signAccessToken } from '../services/auth.js';
import { sendTemplate } from '../services/mailer.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { ProvisionError, provisionAccount } from '../services/accountProvisioning.js';
import { QuotaBusyError } from '../services/quotaLock.js';
import { APP_OF, trialOffer } from '../services/trialPlan.js';
import { audit } from './ops.js';

/**
 * Start a free trial from clor.in's pricing page (roadmap item 7).
 *
 * No card, and the email is checked before anything is made:
 *
 *  1. POST /public/signup/start — an email (and the app the pricing button
 *     named). A pending TrialSignup is kept with the SHA-256 of a random
 *     token, and the link app.clor.in/start?t=<token> is mailed. Limited per
 *     address and per email like the demo form; a hidden field for bots.
 *  2. GET /public/signup/pending?t= — the setup page asks what the link is
 *     for: the email, the app to tick first, the offer (which apps, how many
 *     days, from the published price book: services/trialPlan.ts).
 *  3. POST /public/signup/confirm — the token with the company's name, the
 *     apps and (for Books) the state. The account is made by the one
 *     account-making path (services/accountProvisioning.ts provisionAccount),
 *     the same one the console's Create account uses: owner, subscription on
 *     a trial with dates from the plan, company with the apps switched on,
 *     and the set-password mail. The email is marked confirmed, because the
 *     link proved it, and the answer is a session so the page can open CLOR.
 *
 * People includes Attendance: picking People turns Attendance on too.
 *
 * The operator side lists pending and confirmed signups for the console's
 * Trials page, and can send a link again.
 */
export const signupRouter = Router();
export const opsSignupsRouter = Router();

/* ---------------------------------------------------------------- shared */

export const SIGNUP_LINK_HOURS = 24;
const DAY = 86_400_000;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const appUrl = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
/** The link in the mail: the app's /start page with the token. */
export const startUrl = (token: string) => `${appUrl()}/start?t=${encodeURIComponent(token)}`;

const APP_NAMES: Record<string, string> = { accounting: 'Books', people: 'People', attendance: 'Attendance', payroll: 'Payroll' };
const appCode = (v: unknown) => APP_OF[String(v || '').toLowerCase()] || null;

/** People includes Attendance (owner, 9 Nov 2026): a company that takes People has Attendance too. */
export const withImplied = (codes: string[]) => {
  const out = [...new Set(codes)];
  if (out.includes('people') && !out.includes('attendance')) out.push('attendance');
  return out;
};

export class LinkEnded extends Error {
  status = 410;
  code = 'LINK_ENDED';
  constructor() {
    super('This link has ended. Start again from clor.in and we will send a new one.');
  }
}

/** The pending signup a token names, if it still works; throws LinkEnded otherwise, the same way for unknown, used and run out. */
async function pendingFor(token: string) {
  const t = String(token || '').trim();
  const row = t.length >= 20 ? await platformPrisma.trialSignup.findUnique({ where: { tokenHash: sha256(t) } }) : null;
  if (!row || row.status !== 'PENDING') throw new LinkEnded();
  if (row.expiresAt.getTime() <= Date.now()) {
    await platformPrisma.trialSignup.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
    throw new LinkEnded();
  }
  return row;
}

async function mailLink(row: { id: string; email: string; app: string | null; planCode: string | null }, token: string) {
  const offer = await trialOffer(row.app ? [row.app] : [], row.planCode);
  await sendTemplate({
    templateKey: 'signup.confirm',
    to: row.email,
    relatedType: 'TrialSignup',
    relatedId: row.id,
    transactional: true,
    data: {
      apps: row.app && APP_NAMES[row.app] ? APP_NAMES[row.app] : 'CLOR',
      startUrl: startUrl(token),
      hours: String(SIGNUP_LINK_HOURS),
      days: String(offer.trialDays),
    },
  });
  await platformPrisma.trialSignup.update({ where: { id: row.id }, data: { sendCount: { increment: 1 }, lastSentAt: new Date() } });
}

/* ---------------------------------------------------------------- public */

/** What the page says before anybody types: the apps a visitor may start and the trial's length. */
signupRouter.get('/public/signup/options', (req, res) =>
  outsideTenant('trial: the offer', async () => {
    const app = appCode(req.query.app);
    const offer = await trialOffer(app ? [app] : [], req.query.plan ? String(req.query.plan) : null);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ apps: offer.apps, trialDays: offer.trialDays, planCode: offer.planCode, linkHours: SIGNUP_LINK_HOURS });
  }),
);

const startBody = z.object({
  email: z.string({ error: 'Enter your email.' }).trim().toLowerCase().max(200, 'That email is too long.').email('Enter an email address like name@company.in.'),
  app: z.string().trim().max(20).optional().nullable(),
  plan: z.string().trim().max(40).optional().nullable(),
});

signupRouter.post('/public/signup/start', ...signupStartLimiter, (req, res) =>
  outsideTenant('trial: a visitor starting a trial', async () => {
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    /* A bot filled the hidden field: the same answer as a real start, and nothing kept. */
    if (String(b.website ?? '').trim()) return res.status(202).json({ ok: true });
    const parsed = startBody.safeParse(b);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter your email.', code: 'INVALID' });
    const { email } = parsed.data;
    const app = appCode(parsed.data.app);
    const planCode = parsed.data.plan ? String(parsed.data.plan).toLowerCase() : null;
    const offer = await trialOffer(app ? [app] : [], planCode);
    if (app && !offer.apps.some((a) => a.code === app)) return res.status(400).json({ error: `${APP_NAMES[app] || app} cannot be started on its own yet. Ask us for a demo.`, code: 'NOT_SELF_SERVE' });

    const taken = await platformPrisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    if (taken) return res.status(409).json({ error: 'Somebody already signs in to CLOR with this email. Sign in instead, or use another address.', code: 'EMAIL_TAKEN' });

    const ip = clientIp(req);
    const userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 300) : null;
    const token = newToken();
    const expiresAt = new Date(Date.now() + SIGNUP_LINK_HOURS * 3_600_000);
    /* Asking again replaces the earlier link for this address: one pending signup per email, the newest link the only one that works. */
    const open = await platformPrisma.trialSignup.findFirst({ where: { email, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    const row = open
      ? await platformPrisma.trialSignup.update({ where: { id: open.id }, data: { tokenHash: sha256(token), app: app ?? open.app, planCode: planCode ?? open.planCode, expiresAt, ip: ip ?? null, userAgent } })
      : await platformPrisma.trialSignup.create({ data: { email, tokenHash: sha256(token), app, planCode, expiresAt, ip: ip ?? null, userAgent } });
    await mailLink(row, token);
    await recordAuthEvent({ email, eventType: 'TRIAL_STARTED', ip, userAgent: userAgent ?? undefined, detail: JSON.stringify({ trialSignupId: row.id, app, resent: Boolean(open) }) });
    res.status(201).json({ ok: true, email, linkHours: SIGNUP_LINK_HOURS, trialDays: offer.trialDays, ...(isDevOrTest() ? { devStartToken: token } : {}) });
  }),
);

/** What the link is for, so the setup page can show the email and tick the app. */
signupRouter.get('/public/signup/pending', ...signupLinkLimiter, (req, res) =>
  outsideTenant('trial: the setup page opening a link', async () => {
    try {
      const row = await pendingFor(String(req.query.t || ''));
      const offer = await trialOffer(row.app ? [row.app] : [], row.planCode);
      res.set('Cache-Control', 'no-store');
      res.json({ email: row.email, app: row.app, apps: offer.apps, trialDays: offer.trialDays, planCode: offer.planCode, expiresAt: row.expiresAt });
    } catch (e) {
      if (e instanceof LinkEnded) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }
  }),
);

const text = (label: string, min: number, max: number) =>
  z
    .string({ error: `Enter ${label}.` })
    .trim()
    .min(min, `Enter ${label}.`)
    .max(max, `Keep ${label} under ${max} characters.`);

const confirmBody = z.object({
  token: z.string().trim().min(20, 'This link is not complete.'),
  ownerName: text('your name', 2, 120),
  companyName: text('your company’s name', 2, 160),
  apps: z.array(z.string()).default([]),
  /* The head office's state: asked only when Books is chosen (it decides CGST + SGST or IGST). */
  state: z.string().trim().max(60).optional().nullable(),
});

signupRouter.post('/public/signup/confirm', ...signupLinkLimiter, (req: Request, res: Response) =>
  outsideTenant('trial: making the account from a confirmed link', async () => {
    const parsed = confirmBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the form.', code: 'INVALID' });
    const d = parsed.data;
    let row;
    try {
      row = await pendingFor(d.token);
    } catch (e) {
      if (e instanceof LinkEnded) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }

    const offer = await trialOffer([], row.planCode);
    const allowed = new Set(offer.apps.map((a) => a.code));
    const asked = d.apps.map(appCode).filter((a): a is string => Boolean(a));
    const apps = withImplied(asked).filter((a) => allowed.has(a));
    if (!apps.length) return res.status(400).json({ error: 'Choose at least one app.', code: 'NO_APPS' });
    const state = String(d.state || '').trim();
    if (apps.includes('accounting') && !deriveStateCodeFromInput(state)) return res.status(400).json({ error: 'Choose the state of your head office. It decides CGST and SGST or IGST on every invoice.', code: 'STATE_REQUIRED' });
    if (state && !deriveStateCodeFromInput(state)) return res.status(400).json({ error: `Unknown state: ${state}`, code: 'STATE_REQUIRED' });

    /* The trial's length comes from the plan that carries these apps, the shortest among them as a quote does. */
    const trial = await trialOffer(apps, row.planCode);
    const trialEndsAt = new Date(Date.now() + trial.trialDays * DAY);

    /* The claim, taken with a conditional update: a double click, or two tabs, cannot both start. Stale after ten minutes. */
    const stale = new Date(Date.now() - 10 * 60_000);
    const claim = await platformPrisma.trialSignup.updateMany({
      where: { id: row.id, accountId: null, status: 'PENDING', OR: [{ provisioningAt: null }, { provisioningAt: { lt: stale } }] },
      data: { provisioningAt: new Date() },
    });
    if (!claim.count) return res.status(409).json({ error: 'This account is being made right now. Give it a minute, then sign in.', code: 'IN_PROGRESS' });

    const ip = clientIp(req);
    const userAgent = req.headers['user-agent'] as string | undefined;
    const first = row.app && apps.includes(row.app) ? row.app : apps[0];
    let made;
    try {
      made = await provisionAccount({
        ownerName: d.ownerName,
        ownerEmail: row.email,
        companyName: d.companyName,
        state,
        plan: { apps, status: 'trialing', trialEndsAt },
        profile: { requestedApp: first, source: 'self-serve', planCode: trial.planCode, trialDays: trial.trialDays },
        ip,
        actor: 'the owner, from clor.in',
      });
    } catch (e) {
      await platformPrisma.trialSignup.update({ where: { id: row.id }, data: { provisioningAt: null } });
      if (e instanceof ProvisionError || e instanceof QuotaBusyError) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }
    /* The link proved the address: no second confirmation mail, and no sign-in rule about unconfirmed addresses stands in the way. */
    await platformPrisma.user.update({ where: { id: made.user.id }, data: { emailVerifiedAt: new Date() } });
    await platformPrisma.trialSignup.update({
      where: { id: row.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), provisioningAt: null, accountId: made.account.id, ownerUserId: made.user.id, companyName: d.companyName.trim(), apps, state: state || null, trialDays: trial.trialDays },
    });

    /* Signed in at once, as a sign-in would: the refresh token only in the cookie. The set-password mail is their way back in later. */
    const { session, refreshToken } = await createSession({ accountId: made.account.id, userId: made.user.id, ip, userAgent });
    await recordAuthEvent({ accountId: made.account.id, userId: made.user.id, email: row.email, eventType: 'LOGIN_SUCCESS', ip, userAgent, detail: 'Trial confirmed' });
    setRefreshCookie(res, refreshToken, session.expiresAt);
    res.status(201).json({
      token: signAccessToken({ userId: made.user.id, accountId: made.account.id, sid: session.id }),
      activeOrgId: made.org.id,
      app: first,
      apps,
      trialEndsAt,
      trialDays: trial.trialDays,
    });
  }),
);

/* -------------------------------------------------------------- operator */

opsSignupsRouter.use('/ops/signups', requireAuth, requireOperator);

const shape = (r: any) => ({
  id: r.id,
  email: r.email,
  app: r.app,
  planCode: r.planCode,
  status: r.status,
  expiresAt: r.expiresAt,
  sendCount: r.sendCount,
  lastSentAt: r.lastSentAt,
  confirmedAt: r.confirmedAt,
  companyName: r.companyName,
  apps: r.apps,
  state: r.state,
  trialDays: r.trialDays,
  accountId: r.accountId,
  createdAt: r.createdAt,
});

const listQuery = z.object({
  status: z.enum(['all', 'PENDING', 'CONFIRMED', 'EXPIRED']).optional(),
  page: z.coerce.number().int().min(0).max(10_000).optional(),
});
const PAGE = 25;

/** Every trial sign-up from clor.in, newest first, by status, with the offer in force. */
opsSignupsRouter.get('/ops/signups', (req, res) =>
  outsideTenant('ops: trial sign-ups', async () => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { status = 'all', page = 0 } = parsed.data;
    const where = status === 'all' ? {} : { status };
    const [total, rows, counts, offer] = await Promise.all([
      platformPrisma.trialSignup.count({ where }),
      platformPrisma.trialSignup.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page * PAGE, take: PAGE }),
      platformPrisma.trialSignup.groupBy({ by: ['status'], _count: true }),
      trialOffer(),
    ]);
    /* A pending link that ran out reads as such without waiting for somebody to click it. */
    const now = Date.now();
    const signups = rows.map((r) => shape(r.status === 'PENDING' && r.expiresAt.getTime() <= now ? { ...r, status: 'EXPIRED' } : r));
    res.json({ total, page, pageSize: PAGE, counts: Object.fromEntries(counts.map((c) => [c.status, Number(c._count) || 0])), signups, offer });
  }),
);

/** Send the link again (a new token; the old one stops working), for somebody whose mail did not arrive. */
opsSignupsRouter.post('/ops/signups/:id/resend', requireOperatorRole('SUPPORT', 'BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: resend a trial link', async () => {
    const id = String(req.params.id);
    const r = await platformPrisma.trialSignup.findUnique({ where: { id } });
    if (!r) return res.status(404).json({ error: 'No such sign-up' });
    if (r.status === 'CONFIRMED') return res.status(409).json({ error: 'This account is made; there is nothing to send.', code: 'CONFIRMED' });
    const token = newToken();
    const row = await platformPrisma.trialSignup.update({ where: { id }, data: { tokenHash: sha256(token), status: 'PENDING', expiresAt: new Date(Date.now() + SIGNUP_LINK_HOURS * 3_600_000), provisioningAt: null } });
    await mailLink(row, token);
    await audit(req, 'TRIAL_LINK_RESENT', {}, { trialSignupId: id, email: r.email });
    res.json({ signup: shape({ ...row, sendCount: row.sendCount + 1 }) });
  }),
);
