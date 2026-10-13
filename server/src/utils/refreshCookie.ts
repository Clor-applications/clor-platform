import type { Request, Response } from 'express';

/**
 * The refresh token, kept where JavaScript cannot read it.
 *
 * Both tokens used to live in localStorage. The access token is short — fifteen
 * minutes — so stealing one is bad and bounded. The refresh token is the
 * long-lived credential: it rotates indefinitely, and anything that can read it
 * can keep minting sessions for as long as it likes. An XSS, or one
 * compromised frontend dependency, and the whole account goes with it.
 *
 * In a cookie marked HttpOnly the browser will send it and will not let a script
 * read it, which is the property that matters. Rotation and reuse detection on
 * the server were already good; this is the half that was missing.
 */
export const REFRESH_COOKIE = 'neev_rt';

/**
 * Scoped to the auth routes.
 *
 * A cookie on `/` rides along with every API request the app makes, which is a
 * lot of places for a credential to be for no reason. Only refresh and logout
 * need it.
 */
const COOKIE_PATH = '/api/auth';

const isProduction = () => String(process.env.NODE_ENV || '') === 'production';

export const setRefreshCookie = (res: Response, token: string) => {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    // Over HTTPS only in production. Development is plain http on localhost, and
    // a Secure cookie there simply would not be set at all.
    secure: isProduction(),
    /*
     * The app and the API are the same site in production, so the strictest
     * setting costs nothing. In development the SPA is on :5173 and the API on
     * :4001 — different ports are still the same site, so `lax` is enough and
     * `none` (which would need Secure) is not required.
     */
    sameSite: isProduction() ? 'strict' : 'lax',
    path: COOKIE_PATH,
    // Matches the session's own life. The server is still the authority: a
    // revoked session is refused however long the cookie lasts.
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
};

export const clearRefreshCookie = (res: Response) => {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: isProduction(), sameSite: isProduction() ? 'strict' : 'lax', path: COOKIE_PATH });
};

/**
 * The refresh token for this request: the cookie first, the body second.
 *
 * The body is still accepted so that sessions created before this existed keep
 * working — their browsers hold a token in localStorage and no cookie, and
 * forcing everyone to sign in again to deploy a security improvement is a poor
 * trade. New sessions never put one in the body, so the fallback goes quiet on
 * its own as sessions turn over.
 */
export const refreshTokenFrom = (req: Request): string => {
  const fromCookie = String((req as any).cookies?.[REFRESH_COOKIE] || '').trim();
  if (fromCookie) return fromCookie;
  const body = req.body as { refreshToken?: unknown } | undefined;
  return String(body?.refreshToken || '').trim();
};
