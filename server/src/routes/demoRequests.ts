import { pausedRefusal } from '../services/platformSwitches.js';
import { Router } from 'express';
import type { Request } from 'express';
import cors from 'cors';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { demoRequestLimiter } from '../middleware/rateLimit.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { clientIp, recordAuthEvent } from '../services/auth.js';
import { sendTemplate } from '../services/mailer.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { ProvisionError, provisionAccount } from '../services/accountProvisioning.js';
import { QuotaBusyError } from '../services/quotaLock.js';
import { deriveStateCodeFromInput } from '../utils/gstin.js';
import { endExplorePass, issueExplorePass, passSummary, resendExplorePass } from '../services/explore.js';
import { audit } from './ops.js';

/**
 * "Request a demo" (roadmap items 3 and 4).
 *
 * The public side: clor.in/demo posts here with no sign-in. Checked field by
 * field, limited per address and per email, a hidden field for bots, kept as a
 * DemoRequest (platform data: there is no account yet), written to the
 * security log, and sent to sales@clor.in through the email outbox.
 *
 * The operator side: the CLOR team lists requests in the operator console,
 * moves them along (new, contacted, demo done, not a fit) with a note, and
 * after the demo clicks Create account — the one account-making path
 * (services/accountProvisioning.ts), with the chosen apps on a trial and a
 * set-password email to the owner. Behind requireOperator, its roles and
 * step-up, the way routes/ops.ts is. A customer's own owner never reaches it.
 */
export const demoRequestsRouter = Router();
export const opsDemoRequestsRouter = Router();

/* ---------------------------------------------------------------- shared */

/** The site's product slugs and the platform's app codes, both accepted; stored as app codes. */
const APP_OF: Record<string, string> = { books: 'accounting', accounting: 'accounting', payroll: 'payroll', people: 'people', attendance: 'attendance' };
export const COMPANY_SIZES = ['1-10', '11-20', '21-50', '51-200', '200+'] as const;
export const DEMO_STATUSES = ['NEW', 'CONTACTED', 'DEMO_DONE', 'ACCOUNT_CREATED', 'NOT_A_FIT'] as const;
/** What an operator may set by hand; ACCOUNT_CREATED comes only from Create account. */
const SETTABLE = ['NEW', 'CONTACTED', 'DEMO_DONE', 'NOT_A_FIT'] as const;
const TRIAL_DAYS = 30;
/** The apps by the names clor.in uses, in the site's order. */
const APP_NAMES: [string, string][] = [
  ['accounting', 'Books'],
  ['payroll', 'Payroll'],
  ['people', 'People'],
  ['attendance', 'Attendance'],
];
const DAY = 86_400_000;

/** An Indian phone number, as +91 and ten digits: mobiles start 6–9; a landline with its STD code is ten digits too. */
export function indianPhone(raw: string): string | null {
  let d = String(raw || '').replace(/[\s\-().]/g, '');
  if (d.startsWith('+91')) d = d.slice(3);
  else if (d.startsWith('0091')) d = d.slice(4);
  else if (/^91\d{10}$/.test(d)) d = d.slice(2);
  else if (/^0\d{10}$/.test(d)) d = d.slice(1);
  return /^[1-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

/* ---------------------------------------------------------------- public */

/*
 * The site (clor.in) is another origin. The app's CORS list (app.ts,
 * CORS_ORIGIN) is for the signed-in app and sends credentials; this one route
 * is also open to the site's own origins, with no credentials, and nothing
 * else. Mounted in app.ts ahead of the app-wide CORS.
 */
export const siteOrigins = () =>
  new Set(
    [
      'https://clor.in',
      'https://www.clor.in',
      'https://staging.clor.in',
      ...String(process.env.SITE_ORIGINS || '').split(','),
      ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5190', 'http://127.0.0.1:5190', 'http://localhost:5191', 'http://127.0.0.1:5191']),
    ]
      .map((s) => s.trim())
      .filter(Boolean),
  );
export const demoRequestCors = cors({
  origin: (origin, cb) => cb(null, !origin || siteOrigins().has(origin)),
  methods: ['POST'],
  credentials: false,
  maxAge: 7200,
  allowedHeaders: ['Content-Type'],
});

const text = (label: string, min: number, max: number) =>
  z
    .string({ error: `Enter ${label}.` })
    .trim()
    .min(min, `Enter ${label}.`)
    .max(max, `Keep ${label} under ${max} characters.`);

const demoBody = z.object({
  name: text('your name', 2, 120),
  company: text('your company’s name', 2, 160),
  email: z.string({ error: 'Enter your work email.' }).trim().toLowerCase().max(200, 'That email is too long.').email('Enter an email address like name@company.in.'),
  phone: z
    .string({ error: 'Enter a phone number.' })
    .trim()
    .transform((v, ctx) => {
      const p = indianPhone(v);
      if (!p) ctx.addIssue({ code: 'custom', message: 'Enter a 10-digit Indian phone number.' });
      return p || '';
    }),
  city: text('your city', 2, 80),
  companySize: z.enum(COMPANY_SIZES, { error: 'Choose how many people work there.' }),
  users: z.coerce
    .number({ error: 'Enter how many people will sign in.' })
    .int('Enter a whole number.')
    .min(1, 'At least one person signs in.')
    .max(100_000, 'Enter a smaller number.'),
  apps: z
    .array(z.string(), { error: 'Tick at least one app.' })
    .default([])
    .transform((list, ctx) => {
      const codes = [...new Set(list.map((a) => APP_OF[String(a).toLowerCase()]).filter(Boolean))];
      if (!codes.length) ctx.addIssue({ code: 'custom', message: 'Tick at least one app.' });
      return codes;
    }),
  message: z.string().trim().max(2000, 'Keep the message under 2,000 characters.').optional().nullable(),
  /** Where the visitor first landed from, as the website kept it for the visit. Never required; junk is dropped. */
  source: z
    .object({
      utm_source: z.string().trim().max(120).optional().nullable(),
      utm_medium: z.string().trim().max(120).optional().nullable(),
      utm_campaign: z.string().trim().max(160).optional().nullable(),
      referrer: z.string().trim().max(300).optional().nullable(),
      landing: z.string().trim().max(300).optional().nullable(),
    })
    .optional()
    .nullable()
    .catch(null),
});

/** One word for the list: the campaign's source, else the referring site, else direct. */
export function sourceLabel(src: { utm_source?: string | null; referrer?: string | null } | null | undefined): string {
  const utm = src?.utm_source?.trim().toLowerCase();
  if (utm) return utm.slice(0, 60);
  try {
    const host = src?.referrer ? new URL(src.referrer).hostname.replace(/^www\./, '') : '';
    if (host && !/(^|\.)clor\.in$/.test(host)) return host.slice(0, 60);
  } catch {
    /* Not a URL: treated as no referrer. */
  }
  return 'direct';
}

/** zod's issues as one message per field, the first for each. */
const fieldErrors = (e: z.ZodError) => {
  const out: Record<string, string> = {};
  for (const i of e.issues) {
    const k = String(i.path[0] ?? 'form');
    if (!out[k]) out[k] = i.message;
  }
  return out;
};

demoRequestsRouter.post('/public/demo-requests', ...demoRequestLimiter, (req, res) =>
  outsideTenant('demo request: a visitor with no account', async () => {
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    /* A bot filled the hidden field: the same answer as a real request, and nothing kept. */
    if (String(b.website ?? '').trim()) return res.status(201).json({ ok: true });
    const paused = await pausedRefusal('demoRequests');
    if (paused) return res.status(paused.status).json(paused.body);
    const parsed = demoBody.safeParse(b);
    if (!parsed.success) return res.status(400).json({ error: 'Check the fields marked below.', code: 'INVALID', fields: fieldErrors(parsed.error) });
    const d = parsed.data;
    const ip = clientIp(req);
    const userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 300) : null;
    const row = await platformPrisma.demoRequest.create({
      data: { name: d.name, company: d.company, email: d.email, phone: d.phone, city: d.city, companySize: d.companySize, users: d.users, apps: d.apps, message: d.message || null, source: sourceLabel(d.source), sourceDetail: d.source ? JSON.parse(JSON.stringify(d.source)) : undefined, ip: ip ?? null, userAgent },
      select: { id: true },
    });
    await recordAuthEvent({ email: d.email, eventType: 'DEMO_REQUESTED', ip, userAgent: userAgent ?? undefined, detail: JSON.stringify({ demoRequestId: row.id, apps: d.apps }) });
    const appNames = APP_NAMES.filter(([code]) => d.apps.includes(code)).map(([, n]) => n);
    await sendTemplate({
      templateKey: 'sales.demo_requested',
      to: process.env.SALES_EMAIL || 'sales@clor.in',
      toName: 'CLOR sales',
      relatedType: 'DemoRequest',
      relatedId: row.id,
      transactional: true,
      data: {
        name: d.name,
        company: d.company,
        apps: appNames.join(', '),
        companySize: d.companySize,
        users: String(d.users),
        city: d.city,
        email: d.email,
        phone: d.phone,
        message: d.message ? `Their message:\n${d.message}` : 'No message.',
        opsUrl: process.env.OPS_URL || 'https://ops.clor.in',
      },
    });
    /*
     * Explore (roadmap item 6): a 14-day link to the sample company, mailed to
     * them and shown on the thank-you. It opens a made-up company read-only,
     * nothing of anybody's, so handing it to whoever filled the form is safe.
     * A pass that cannot be made must not lose the request: it is kept, and
     * an operator can send one from the console.
     */
    let explore: { url: string; expiresAt: Date } | null = null;
    try {
      const issued = await issueExplorePass({ demoRequestId: row.id, email: d.email, name: d.name, apps: d.apps });
      explore = { url: issued.url, expiresAt: issued.pass.expiresAt };
    } catch (e) {
      console.error('Explore pass for a demo request failed:', (e as Error)?.message || e);
    }
    res.status(201).json({ ok: true, explore });
  }),
);

/* -------------------------------------------------------------- operator */

opsDemoRequestsRouter.use('/ops/demo-requests', requireAuth, requireOperator);

const shape = (r: any) => ({
  id: r.id,
  name: r.name,
  company: r.company,
  email: r.email,
  phone: r.phone,
  city: r.city,
  companySize: r.companySize,
  users: r.users,
  apps: r.apps,
  message: r.message,
  status: r.status,
  note: r.note,
  statusChangedAt: r.statusChangedAt,
  accountId: r.accountId,
  assignedToUserId: r.assignedToUserId ?? null,
  assignedToName: r.assignedToName ?? null,
  followUpAt: r.followUpAt ?? null,
  source: r.source ?? null,
  sourceDetail: r.sourceDetail ?? null,
  createdAt: r.createdAt,
});

/** The staff names for a page of requests. */
async function withOwners<T extends { assignedToUserId?: string | null }>(rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.assignedToUserId).filter(Boolean))] as string[];
  const users = ids.length ? await platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.fullName || u.email]));
  return rows.map((r) => ({ ...r, assignedToName: r.assignedToUserId ? name.get(r.assignedToUserId) || null : null }));
}

const listQuery = z.object({
  status: z.enum(['all', ...DEMO_STATUSES]).optional(),
  page: z.coerce.number().int().min(0).max(10_000).optional(),
  /** mine: assigned to the caller; due: a follow-up today or before; unassigned: nobody looks after it yet. */
  view: z.enum(['all', 'mine', 'due', 'unassigned']).optional(),
  source: z.string().trim().max(60).optional(),
});
/** End of today in India: a follow-up "today" is due all day. */
const endOfTodayIst = (now = new Date()) => {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1) - 330 * 60_000);
};
const OPEN_STATUSES = ['NEW', 'CONTACTED', 'DEMO_DONE'];
const PAGE = 25;

/** Every request, newest first, by status. */
opsDemoRequestsRouter.get('/ops/demo-requests', (req, res) =>
  outsideTenant('ops: demo requests', async () => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { status = 'all', page = 0, view = 'all', source } = parsed.data;
    const me = req.auth!.userId;
    const dueBy = endOfTodayIst();
    const where = {
      ...(status === 'all' ? {} : { status }),
      ...(source ? { source } : {}),
      ...(view === 'mine' ? { assignedToUserId: me } : {}),
      ...(view === 'unassigned' ? { assignedToUserId: null, status: status === 'all' ? { in: OPEN_STATUSES } : status } : {}),
      ...(view === 'due' ? { followUpAt: { lte: dueBy }, status: status === 'all' ? { in: OPEN_STATUSES } : status } : {}),
    };
    /* Due follow-ups come first, the most overdue at the top; otherwise newest first. */
    const orderBy = view === 'due' ? [{ followUpAt: 'asc' as const }] : [{ createdAt: 'desc' as const }];
    const [total, rows, counts, due, mine, unassigned, sources] = await Promise.all([
      platformPrisma.demoRequest.count({ where }),
      platformPrisma.demoRequest.findMany({ where, orderBy, skip: page * PAGE, take: PAGE }),
      platformPrisma.demoRequest.groupBy({ by: ['status'], _count: true }),
      platformPrisma.demoRequest.count({ where: { followUpAt: { lte: dueBy }, status: { in: OPEN_STATUSES } } }),
      platformPrisma.demoRequest.count({ where: { assignedToUserId: me, status: { in: OPEN_STATUSES } } }),
      platformPrisma.demoRequest.count({ where: { assignedToUserId: null, status: { in: OPEN_STATUSES } } }),
      platformPrisma.demoRequest.groupBy({ by: ['source'], _count: true, where: { source: { not: null } } }),
    ]);
    res.json({
      total,
      page,
      pageSize: PAGE,
      counts: Object.fromEntries(counts.map((c) => [c.status, Number(c._count) || 0])),
      views: { due, mine, unassigned },
      sources: sources.map((x) => ({ source: x.source, count: Number(x._count) || 0 })).sort((a, b) => b.count - a.count),
      requests: (await withOwners(rows)).map(shape),
    });
  }),
);

/** Who a lead can be given to: CLOR staff who can act (not read-only). Before /:id so "team" is not read as an id. */
opsDemoRequestsRouter.get('/ops/demo-requests/team', (req, res) =>
  outsideTenant('ops: demo request team', async () => {
    const staff = await platformPrisma.platformOperator.findMany({ where: { active: true, role: { not: 'READ_ONLY' } }, select: { userId: true, role: true, user: { select: { fullName: true, email: true } } } });
    res.json({ me: req.auth!.userId, team: staff.map((s) => ({ userId: s.userId, name: s.user.fullName || s.user.email, role: s.role })).sort((a, b) => a.name.localeCompare(b.name)) });
  }),
);

/** One request, with what the team did on it. */
opsDemoRequestsRouter.get('/ops/demo-requests/:id', (req, res) =>
  outsideTenant('ops: one demo request', async () => {
    const id = String(req.params.id);
    const r = await platformPrisma.demoRequest.findUnique({ where: { id } });
    if (!r) return res.status(404).json({ error: 'No such request' });
    const events = await platformPrisma.operatorAuditEvent.findMany({ where: { detail: { path: ['demoRequestId'], equals: id } }, orderBy: { at: 'desc' }, take: 50 });
    const people = await platformPrisma.user.findMany({ where: { id: { in: [...new Set(events.map((e) => e.operatorUserId))] } }, select: { id: true, fullName: true } });
    const who = new Map(people.map((p) => [p.id, p.fullName]));
    const account = r.accountId ? await platformPrisma.account.findUnique({ where: { id: r.accountId }, select: { id: true, name: true, code: true } }) : null;
    const pass = await platformPrisma.explorePass.findFirst({ where: { demoRequestId: id }, orderBy: { createdAt: 'desc' } });
    const [withName] = await withOwners([r]);
    res.json({ request: shape(withName), account, explore: passSummary(pass), history: events.map((e) => ({ id: e.id, action: e.action, at: e.at, operatorName: who.get(e.operatorUserId) || null, detail: e.detail })) });
  }),
);

const statusBody = z
  .object({
    status: z.enum(SETTABLE).optional(),
    note: z.string().trim().max(1000).optional().nullable(),
    /** A CLOR staff member's userId, or null for nobody. */
    assignedToUserId: z.string().trim().min(1).max(64).optional().nullable(),
    /** When to call next (an ISO date or date-time), or null for none. */
    followUpAt: z.coerce.date().optional().nullable(),
  })
  .refine((b) => b.status !== undefined || b.note !== undefined || b.assignedToUserId !== undefined || b.followUpAt !== undefined, 'Nothing to change.');

/** Move a request along, with a note. */
opsDemoRequestsRouter.patch('/ops/demo-requests/:id', requireOperatorRole('SALES', 'SUPPORT', 'BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: demo request status', async () => {
    const id = String(req.params.id);
    const parsed = statusBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message === 'Nothing to change.' ? 'Nothing to change.' : 'Check the status, owner and follow-up date.' });
    const b = parsed.data;
    const r = await platformPrisma.demoRequest.findUnique({ where: { id }, select: { status: true, note: true, assignedToUserId: true, followUpAt: true, updatedAt: true } });
    if (!r) return res.status(404).json({ error: 'No such request' });
    if (r.status === 'ACCOUNT_CREATED' && b.status !== undefined) return res.status(409).json({ error: 'The account is made; this request is closed.', code: 'ACCOUNT_CREATED' });
    if (b.assignedToUserId) {
      const staff = await platformPrisma.platformOperator.findFirst({ where: { userId: b.assignedToUserId, active: true, role: { not: 'READ_ONLY' } }, select: { userId: true } });
      if (!staff) return res.status(400).json({ error: 'Choose someone on the CLOR team.' });
    }
    const note = b.note === undefined ? r.note : b.note || null;
    const statusMoved = b.status !== undefined && b.status !== r.status;
    /*
     * Only over the request as it was read. A change made in between (the
     * account created from it, or a colleague's update) used to be overwritten:
     * an ACCOUNT_CREATED request went back to CONTACTED. Now this one is refused.
     */
    const claimed = await platformPrisma.demoRequest.updateMany({
      where: { id, status: r.status, updatedAt: r.updatedAt },
      data: {
        note,
        ...(b.status !== undefined ? { status: b.status } : {}),
        ...(statusMoved ? { statusChangedAt: new Date(), statusChangedByUserId: req.auth!.userId } : {}),
        ...(b.assignedToUserId !== undefined ? { assignedToUserId: b.assignedToUserId } : {}),
        ...(b.followUpAt !== undefined ? { followUpAt: b.followUpAt } : {}),
        /* Closed as not a fit: nothing left to follow up. */
        ...(b.status === 'NOT_A_FIT' ? { followUpAt: null } : {}),
      },
    });
    if (!claimed.count) return res.status(409).json({ error: 'Someone changed this request a moment ago. Refresh to see it as it is now.', code: 'REQUEST_CHANGED' });
    const row = await platformPrisma.demoRequest.findUniqueOrThrow({ where: { id } });
    if (b.status !== undefined || b.note !== undefined) await audit(req, 'DEMO_REQUEST_STATUS', {}, { demoRequestId: id, from: r.status, to: row.status, note: b.note || undefined });
    if (b.assignedToUserId !== undefined && b.assignedToUserId !== r.assignedToUserId) await audit(req, 'DEMO_REQUEST_ASSIGNED', {}, { demoRequestId: id, from: r.assignedToUserId, to: row.assignedToUserId });
    if (b.followUpAt !== undefined && (b.followUpAt?.getTime() ?? null) !== (r.followUpAt?.getTime() ?? null)) await audit(req, 'DEMO_REQUEST_FOLLOW_UP', {}, { demoRequestId: id, at: row.followUpAt });
    const [withName] = await withOwners([row]);
    res.json({ request: shape(withName) });
  }),
);

const createBody = z.object({
  /* The head office's state: it decides CGST + SGST or IGST on every invoice, and the form asks only for a city. */
  state: z.string().trim().min(2).max(60),
  apps: z.array(z.string()).optional(),
  trialDays: z.number().int().min(1).max(90).optional(),
});

/** What Create account answers, the first time and every time after. */
async function made(r: { accountId: string | null; ownerUserId: string | null }) {
  const [account, owner] = await Promise.all([
    r.accountId ? platformPrisma.account.findUnique({ where: { id: r.accountId }, select: { id: true, name: true, code: true } }) : null,
    r.ownerUserId ? platformPrisma.user.findUnique({ where: { id: r.ownerUserId }, select: { id: true, email: true } }) : null,
  ]);
  return { account, owner };
}

/**
 * Create the account: owner, company with the chosen apps on a trial, and the
 * set-password email. Idempotent: a second click, or a second operator, gets
 * the account already made. The claim (provisioningAt) is taken with a
 * conditional update, so two at once cannot both start.
 */
opsDemoRequestsRouter.post('/ops/demo-requests/:id/create-account', requireOperatorRole('SALES', 'BILLING'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: create an account from a demo request', async () => {
    const id = String(req.params.id);
    const r = await platformPrisma.demoRequest.findUnique({ where: { id } });
    if (!r) return res.status(404).json({ error: 'No such request' });
    if (r.accountId) return res.json({ created: false, ...(await made(r)) });

    const parsed = createBody.safeParse(req.body);
    if (!parsed.success || !deriveStateCodeFromInput(parsed.data.state)) return res.status(400).json({ error: 'Choose the state of their head office.', code: 'STATE_REQUIRED' });
    const apps = parsed.data.apps ? [...new Set(parsed.data.apps.map((a) => APP_OF[String(a).toLowerCase()]).filter(Boolean))] : r.apps;
    if (!apps.length) return res.status(400).json({ error: 'Choose at least one app.', code: 'NO_APPS' });

    /* Stale after ten minutes: a crash halfway does not lock the request for ever. */
    const stale = new Date(Date.now() - 10 * 60_000);
    const claim = await platformPrisma.demoRequest.updateMany({
      where: { id, accountId: null, OR: [{ provisioningAt: null }, { provisioningAt: { lt: stale } }] },
      data: { provisioningAt: new Date() },
    });
    if (!claim.count) {
      const now = await platformPrisma.demoRequest.findUnique({ where: { id }, select: { accountId: true, ownerUserId: true } });
      if (now?.accountId) return res.json({ created: false, ...(await made(now)) });
      return res.status(409).json({ error: 'Somebody is creating this account right now. Look again in a minute.', code: 'IN_PROGRESS' });
    }

    const trialDays = parsed.data.trialDays ?? TRIAL_DAYS;
    const trialEndsAt = new Date(Date.now() + trialDays * DAY);
    let result;
    try {
      result = await provisionAccount({
        ownerName: r.name,
        ownerEmail: r.email,
        companyName: r.company,
        state: parsed.data.state,
        plan: { apps, status: 'trialing', trialEndsAt },
        /* requestedApp: the app the owner came for (the form puts the product page's app first), for the shell to open (roadmap item 5). */
        profile: { requestedApp: r.apps.find((a) => apps.includes(a)) || apps[0], city: r.city, companySize: r.companySize, expectedUsers: r.users, source: 'demo-request' },
        ip: clientIp(req),
        actor: 'a CLOR operator',
      });
    } catch (e) {
      await platformPrisma.demoRequest.update({ where: { id }, data: { provisioningAt: null } });
      if (e instanceof ProvisionError || e instanceof QuotaBusyError) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }
    await platformPrisma.demoRequest.update({
      where: { id },
      data: { accountId: result.account.id, ownerUserId: result.user.id, status: 'ACCOUNT_CREATED', statusChangedAt: new Date(), statusChangedByUserId: req.auth!.userId, provisioningAt: null },
    });
    await audit(req, 'DEMO_ACCOUNT_CREATED', { accountId: result.account.id, userId: result.user.id }, { demoRequestId: id, apps, trialDays, state: parsed.data.state });
    res.status(201).json({ created: true, ...(await made({ accountId: result.account.id, ownerUserId: result.user.id })) });
  }),
);

/* ------------------------------------------------------------- explore */

/**
 * The request's Explore pass (services/explore.ts): Resend mails a new link
 * (the old one stops working; a pass that had ended or run out opens for
 * another 14 days), End access stops the link and ends every session it
 * opened. Support or billing, with step-up, on the record like the rest.
 * A request from before Explore has no pass: Resend makes its first.
 */
opsDemoRequestsRouter.post('/ops/demo-requests/:id/explore/resend', requireOperatorRole('SALES', 'SUPPORT', 'BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: resend an Explore link', async () => {
    const id = String(req.params.id);
    const r = await platformPrisma.demoRequest.findUnique({ where: { id } });
    if (!r) return res.status(404).json({ error: 'No such request' });
    const existing = await platformPrisma.explorePass.findFirst({ where: { demoRequestId: id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    let pass;
    let reopened = false;
    if (existing) {
      const done = await resendExplorePass(existing.id, r.name, r.apps);
      pass = done?.pass;
      reopened = Boolean(done?.reopened);
    } else {
      pass = (await issueExplorePass({ demoRequestId: id, email: r.email, name: r.name, apps: r.apps })).pass;
    }
    await audit(req, 'EXPLORE_RESENT', {}, { demoRequestId: id, explorePassId: pass?.id, reopened, first: !existing });
    res.json({ explore: passSummary(pass) });
  }),
);

opsDemoRequestsRouter.post('/ops/demo-requests/:id/explore/end', requireOperatorRole('SALES', 'SUPPORT', 'BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: end an Explore link', async () => {
    const id = String(req.params.id);
    const existing = await platformPrisma.explorePass.findFirst({ where: { demoRequestId: id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'This request has no Explore link.' });
    const done = await endExplorePass(existing.id, req.auth!.userId);
    await audit(req, 'EXPLORE_ENDED', {}, { demoRequestId: id, explorePassId: existing.id, sessionsEnded: done?.sessionsEnded ?? 0 });
    res.json({ explore: passSummary(done?.pass), sessionsEnded: done?.sessionsEnded ?? 0 });
  }),
);
