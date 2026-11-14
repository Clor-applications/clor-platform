import { randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';

/**
 * A sign-in pass for the Engineering Console (console.clor.in), for a CLOR
 * staff member who asks to open it with their CLOR login.
 *
 * The Console is a separate service with its own members and its own
 * authenticator. This API does one thing for it: say, in a way the Console can
 * check, "this browser is signed in here as this person". The pass is a JWT
 * signed ES256 with a private key only this API holds
 * (CONSOLE_GRANT_PRIVATE_KEY); the Console holds the public half and nothing
 * else of ours. It lasts one minute and names the Console's own sign-in
 * attempt (`state`), so it is no use in another browser or later.
 *
 * A pass does not let anybody into the Console by itself: the Console still
 * needs them on its member list and still asks for its own authenticator code.
 * And nothing the Console holds can be used here: this API never accepts a
 * pass, only makes them.
 *
 * Off (null) until the key is set. docs/console/SETUP.md, step 8.
 */
export const CONSOLE_GRANT_SECONDS = 60;

const privateKey = () => String(process.env.CONSOLE_GRANT_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
const consoleApi = () => String(process.env.CONSOLE_API_ORIGIN || 'https://console.clor.in').replace(/\/$/, '');

export const consoleGrantOn = () => Boolean(privateKey());

/** Where to send the browser, with the pass on it; null when sign-in with CLOR is not set up. */
export function consoleGrantUrl(who: { userId: string; email: string; name: string }, state: string): string | null {
  const key = privateKey();
  if (!key) return null;
  const pass = jwt.sign({ email: who.email, name: who.name, state }, key, {
    algorithm: 'ES256',
    issuer: 'clor-api',
    audience: 'clor-console',
    subject: who.userId,
    jwtid: randomUUID(),
    expiresIn: CONSOLE_GRANT_SECONDS,
  });
  return `${consoleApi()}/api/auth/clor/callback?${new URLSearchParams({ grant: pass, state })}`;
}
