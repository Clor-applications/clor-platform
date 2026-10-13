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

const build = (windowMs: number, max: number, what: string) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isDisabled,
    message: message(what),
    // Limit per IP and per submitted identity, so one attacker cannot lock out
    // every user from a shared office IP, and one account cannot be sprayed
    // from many IPs without tripping the identity bucket.
    keyGenerator: (req) => {
      // ipKeyGenerator normalises IPv6 to a subnet prefix. Using the raw
      // address would let a single IPv6 user rotate through addresses to evade
      // the limit, which express-rate-limit refuses to start without.
      //
      // Its second parameter is the IPv6 subnet mask (a number), NOT the
      // response object. Passing `res` here made every rate-limited route --
      // sign-in, sign-up and password reset -- fail with "Invalid subnet
      // mask.", which the test suite hid by setting DISABLE_RATE_LIMIT=true.
      const ip = ipKeyGenerator(
        String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown'
      );
      const identity = String((req.body && (req.body.emailOrUsername || req.body.email)) || '')
        .trim()
        .toLowerCase();
      return identity ? `${ip}|${identity}` : ip;
    },
  });

export const loginLimiter = build(15 * 60 * 1000, 10, 'sign-in attempts');
export const signupLimiter = build(60 * 60 * 1000, 5, 'sign-up attempts');
export const resetLimiter = build(60 * 60 * 1000, 5, 'password reset requests');
