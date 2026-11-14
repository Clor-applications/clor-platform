import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * The Console's own passwords, for members who sign in with an email address.
 * scrypt from Node itself: no package to keep up with. A password is never
 * enough by itself here: every password sign-in must also pass the Console's
 * authenticator before it reads anything (app.ts, requireSignInCode).
 */
const N = 32768;
const KEYLEN = 64;
export const MIN_PASSWORD = 12;

const derive = (password: string, salt: Buffer, n: number) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r: 8, p: 1, maxmem: 128 * n * 8 * 2 }, (e, key) => (e ? reject(e) : resolve(key))));

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${N}$${salt.toString('base64url')}$${(await derive(password, salt, N)).toString('base64url')}`;
}

export async function checkPassword(password: string, stored: string | null) {
  const [kind, n, salt, hash] = String(stored || '').split('$');
  /* Work is done even when there is nothing to compare with, so a wrong address takes as long as a wrong password. */
  if (kind !== 'scrypt' || !salt || !hash) {
    await derive(password, Buffer.alloc(16), N);
    return false;
  }
  const want = Buffer.from(hash, 'base64url');
  const got = await derive(password, Buffer.from(salt, 'base64url'), Number(n));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** A one-time code that lets a member choose their password. Shown once to whoever made it; only its hash is kept. */
export function newSetupCode() {
  const raw = randomBytes(15).toString('base64url').replace(/[-_]/g, 'x').slice(0, 20).toUpperCase();
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
}
export const hashSetupCode = (code: string) => createHash('sha256').update(String(code).replace(/[\s-]/g, '').toUpperCase()).digest('hex');
export const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
