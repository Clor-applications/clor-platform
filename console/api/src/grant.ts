import { createPublicKey, verify } from 'node:crypto';

/**
 * A CLOR sign-in pass. The customer API (server/src/routes/consoleGrant.ts)
 * hands one to a signed-in CLOR staff member who asks to open the Console:
 * a JWT signed ES256 with a private key only that API holds, good for one
 * minute, naming the person and the sign-in attempt it was made for.
 *
 * The Console holds the public key only. It can check a pass; it cannot make
 * one, and nothing here could be used against the customer API. A pass proves
 * who the person is at CLOR. It does not get them in on its own: they must
 * also be a member here and enter this Console's own authenticator code.
 */
export interface Grant {
  clorUserId: string;
  email: string;
  name: string;
  jti: string;
}

export const GRANT_ISSUER = 'clor-api';
export const GRANT_AUDIENCE = 'clor-console';

const part = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

export function verifyGrant(token: string, publicKeyPem: string, state: string, now: number): Grant | null {
  try {
    const [h, p, sig, extra] = token.split('.');
    if (!h || !p || !sig || extra !== undefined) return null;
    const header = part(h);
    /* Only the algorithm CLOR signs passes with. "none" and HMAC under the public key are both refused here. */
    if (header.alg !== 'ES256') return null;
    const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key: createPublicKey(publicKeyPem), dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
    if (!ok) return null;
    const c = part(p);
    const seconds = Math.floor(now / 1000);
    if (c.iss !== GRANT_ISSUER || c.aud !== GRANT_AUDIENCE) return null;
    if (typeof c.exp !== 'number' || c.exp < seconds || c.exp > seconds + 120) return null;
    if (typeof c.iat !== 'number' || c.iat > seconds + 30) return null;
    if (!state || c.state !== state) return null;
    if (typeof c.sub !== 'string' || !c.sub || typeof c.email !== 'string' || !c.email.includes('@') || typeof c.jti !== 'string' || !c.jti) return null;
    return { clorUserId: c.sub, email: c.email.toLowerCase(), name: typeof c.name === 'string' && c.name ? c.name : c.email, jti: c.jti };
  } catch {
    return null;
  }
}
