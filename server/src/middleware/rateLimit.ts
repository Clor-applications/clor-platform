import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Rate limits on the credential endpoints.
 *
 * The default store is in-memory, which is correct for a single instance and
 * NOT shared across several. Running more than one API process means moving
 * this to Redis, or the limit is per process rather than per deployment.
 */
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
const identityOf = (req: any) =>
  String((req.body && (req.body.emailOrUsername || req.body.email)) || '')
    .trim()
    .toLowerCase();

const bucket = (windowMs: number, max: number, what: string, key: (req: any) => string, skipWhen?: (req: any) => boolean) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => isDisabled() || Boolean(skipWhen?.(req)),
    message: message(what),
    keyGenerator: key,
  });

const build = (windowMs: number, max: number, what: string) => [
  // A shared office behind one address gets room for its people.
  bucket(windowMs, max * 3, what, (req) => `ip:${ipOf(req)}`),
  bucket(windowMs, max, what, (req) => `id:${identityOf(req)}`, (req) => !identityOf(req)),
];

export const loginLimiter = build(15 * 60 * 1000, 10, 'sign-in attempts');
export const signupLimiter = build(60 * 60 * 1000, 5, 'sign-up attempts');
export const resetLimiter = build(60 * 60 * 1000, 5, 'password reset requests');
/** Authenticator codes: ten tries in fifteen minutes per signed-in user, so six digits cannot be walked. */
export const codeLimiter = [bucket(15 * 60 * 1000, 10, 'code attempts', (req) => `code:${req.auth?.userId || ipOf(req)}`)];

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
  bucket(15 * 60 * 1000, 60, 'sign-in attempts', (req) => `portal-ip:${ipOf(req)}`),
  bucket(15 * 60 * 1000, 10, 'sign-in attempts', (req) => `portal-id:${portalIdentity(req)}`, (req) => !portalIdentity(req)),
];
