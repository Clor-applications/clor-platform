import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { createHash } from 'node:crypto';

/**
 * Rate limits.
 *
 * The limits that stop someone guessing a credential (sign-in, sign-up,
 * password reset, one-time codes, the employee portal, single sign-on) are
 * counted in Postgres, shared by every API instance, so ten tries means ten
 * across the deployment. The flood limits on machine traffic (readers,
 * pushes, connectors) stay in each process: they run thousands of times an
 * hour, and a per-instance cap still stops a flood.
 */
import { PostgresRateLimitStore } from './rateLimitStore.js';
let storeSeq = 0;
const message = (what: string) => ({
  error: `Too many ${what}. Please wait a few minutes and try again.`,
});

// Read per request, not once at import: tests and operators toggle this at
// runtime, and a value captured at module load would ignore them.
const isDisabled = () => process.env.DISABLE_RATE_LIMIT === 'true';

/**
 * Two buckets per route, not one shared key.
 *
 * The key used to be IP and identity together, so one machine trying a
 * single password against a thousand emails made a thousand fresh buckets and
 * was never limited. Now the IP bucket stops a sprayer and the identity
 * bucket stops many machines working on one account.
 *
 * The IP is `req.ip`, which honours X-Forwarded-For only from the proxies
 * `trust proxy` names (app.ts). It used to read the first X-Forwarded-For
 * value from anyone, so a client could choose its own IP — and its own
 * fresh bucket — with one header.
 */
const ipOf = (req: any) => ipKeyGenerator(String(req.ip || 'unknown'));
/** A bucket key for a credential: one per token, and nothing in it that could be used (A-07). */
const digest = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const identityOf = (req: any) =>
  String((req.body && (req.body.emailOrUsername || req.body.email)) || '')
    .trim()
    .toLowerCase();

const bucket = (windowMs: number, max: number, what: string, key: (req: any) => string, skipWhen?: (req: any) => boolean, shared = false) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => isDisabled() || Boolean(skipWhen?.(req)),
    message: message(what),
    keyGenerator: key,
    /* A shared count, or this process's own; if the database cannot be reached the request goes on (it would fail there anyway). */
    ...(shared ? { store: new PostgresRateLimitStore(`rl${(storeSeq += 1)}`), passOnStoreError: true } : {}),
  });
/** A credential limit: counted across every instance. */
const guard = (windowMs: number, max: number, what: string, key: (req: any) => string, skipWhen?: (req: any) => boolean) => bucket(windowMs, max, what, key, skipWhen, true);

const build = (windowMs: number, max: number, what: string) => [
  // A shared office behind one address gets room for its people.
  guard(windowMs, max * 3, what, (req) => `ip:${ipOf(req)}`),
  guard(windowMs, max, what, (req) => `id:${identityOf(req)}`, (req) => !identityOf(req)),
];

export const loginLimiter = build(15 * 60 * 1000, 10, 'sign-in attempts');
export const signupLimiter = build(60 * 60 * 1000, 5, 'sign-up attempts');
export const resetLimiter = build(60 * 60 * 1000, 5, 'password reset requests');
/** Punches pushed to a reader's own URL (/ingest/:token): per token, generous — middleware batches. */
export const ingestLimiter = [bucket(60 * 1000, 600, 'pushes', (req) => `ingest:${req.params?.token ? digest(String(req.params.token)) : ipOf(req)}`), bucket(60 * 1000, 3000, 'pushes', (req) => `ingest-ip:${ipOf(req)}`)];
/** Refreshing a session: a browser refreshes every few minutes per tab; this is for scripts replaying a cookie (A-06). */
export const refreshLimiter = [guard(60 * 1000, 60, 'session refreshes', (req) => `refresh:${ipOf(req)}`)];
/** The payment gateway's webhook: unauthenticated by nature, so a ceiling per address (A-16). */
export const billingWebhookLimiter = [bucket(60 * 1000, 300, 'webhook calls', (req) => `billing-hook:${ipOf(req)}`)];
/** Authenticator codes: ten tries in fifteen minutes per signed-in user, so six digits cannot be walked. */
/* A job opening's public apply page (Talent): a few applications an hour from one address, per link and overall. */
export const applyLimiter = [guard(60 * 60 * 1000, 10, 'applications', (req) => `apply:${ipOf(req)}`)];
/* Referrals (A20): the public referral page by address, and referrals made by one person (CLOR user or employee-app employee). */
export const referViewLimiter = [guard(60 * 1000, 30, 'page views', (req) => `refer-view:${ipOf(req)}`)];
export const referLimiter = [guard(60 * 60 * 1000, 20, 'referrals', (req) => `refer:${req.auth?.userId || req.portal?.employeeId || ipOf(req)}`)];

export const codeLimiter = [guard(15 * 60 * 1000, 10, 'code attempts', (req) => `code:${req.auth?.userId || ipOf(req)}`)];

/** Machine clients with a bearer token (SCIM providers, on-site connectors): per token, and per address for the ones guessing. */
/*
 * A-07: the key used to be the bearer's first 24 characters. Every access
 * token is a JWT and they all begin with the same header, so every signed-in
 * person in every company shared one bucket — one busy office could 429 the
 * whole API — while machine tokens left 18 secret characters in the key. The
 * key is now a hash of the whole token: one bucket per credential, and
 * nothing in it that could be used.
 */
const bearerOf = (req: any) => {
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return token ? digest(token) : '';
};
export const scimLimiter = [bucket(60 * 1000, 600, 'SCIM requests', (req) => `scim:${bearerOf(req) || ipOf(req)}`), bucket(60 * 1000, 1200, 'SCIM requests', (req) => `scim-ip:${ipOf(req)}`)];
export const agentLimiter = [bucket(60 * 1000, 600, 'connector requests', (req) => `agent:${bearerOf(req) || ipOf(req)}`), bucket(60 * 1000, 1200, 'connector requests', (req) => `agent-ip:${ipOf(req)}`)];
/** Hikvision pushes, before the body is read: per URL token (from the path) and per address. */
export const hikvisionLimiter = [bucket(60 * 1000, 600, 'pushes', (req) => `hik:${String(req.path || '').length > 1 ? digest(String(req.path).slice(1).split('/')[0]) : ipOf(req)}`), bucket(60 * 1000, 3000, 'pushes', (req) => `hik-ip:${ipOf(req)}`)];
/**
 * Every /api call: a ceiling that no real person reaches, so one stolen token
 * or runaway script cannot hammer the API. Per session token (the bearer is
 * unique to a sign-in) and per address (a shared office gets more room).
 * Counted in each process, not Postgres: it runs on every request. The
 * per-minute numbers can be lowered with API_RATE_LIMIT_PER_MIN.
 */
const apiPerMin = () => Math.max(1, Number(process.env.API_RATE_LIMIT_PER_MIN || 600));
export const apiLimiter = [
  bucket(60 * 1000, apiPerMin(), 'requests', (req) => `api:${bearerOf(req) || ipOf(req)}`, (req) => !bearerOf(req)),
  bucket(60 * 1000, apiPerMin() * 3, 'requests', (req) => `api-ip:${ipOf(req)}`),
];
/** Single sign-on: lookups, starts and assertions, per address. */
/** Address search for work sites: a person typing, debounced, never this many; spares the free map services. */
export const geocodeLimiter = [bucket(60 * 1000, 60, 'address searches', (req) => `geo:${req.auth?.userId || ipOf(req)}`)];
export const ssoLimiter = [guard(60 * 1000, 60, 'sign-in attempts', (req) => `sso:${ipOf(req)}`)];

/**
 * Biometric readers (/iclock). One bucket per serial number and one per
 * address. A reader sends a heartbeat every 30 s and, in real-time mode, one
 * request per punch — a busy gate at 09:00 can be a few hundred a minute — so
 * the serial limit is generous; it is there to stop one broken or forged
 * serial flooding the API. The address limit covers serials invented on the
 * fly, and leaves room for an office with a dozen readers behind one IP.
 *
 * Refused with 503 in plain text: a reader that gets no "OK" keeps its batch
 * and sends it again after ErrorDelay, so nothing is lost by slowing it down.
 */
const readerSerial = (req: any) => String(req.query?.SN || '').trim().slice(0, 40);
const readerBucket = (max: number, key: (req: any) => string, skipWhen?: (req: any) => boolean) =>
  rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: false,
    legacyHeaders: false,
    skip: (req) => isDisabled() || Boolean(skipWhen?.(req)),
    keyGenerator: key,
    handler: (_req, res) => {
      res.status(503).type('text/plain').send('BUSY');
    },
  });

export const READER_LIMITS = { perSerial: 600, perAddress: 3000 };
export const readerLimiter = [
  readerBucket(READER_LIMITS.perSerial, (req) => `sn:${readerSerial(req)}`, (req) => !readerSerial(req)),
  readerBucket(READER_LIMITS.perAddress, (req) => `ip:${ipOf(req)}`),
];

/**
 * Employee portal sign-in and activation: per address, and per company +
 * employee code so many machines cannot work through one person's password or
 * activation code (40 bits, 24 hours) between them.
 */
const portalIdentity = (req: any) =>
  req.body?.company && req.body?.employeeCode ? `${String(req.body.company).trim().toUpperCase()}|${String(req.body.employeeCode).trim().toUpperCase()}` : '';
export const portalLimiter = [
  guard(15 * 60 * 1000, 60, 'sign-in attempts', (req) => `portal-ip:${ipOf(req)}`),
  guard(15 * 60 * 1000, 10, 'sign-in attempts', (req) => `portal-id:${portalIdentity(req)}`, (req) => !portalIdentity(req)),
];
