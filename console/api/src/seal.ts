import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Sealing: AES-256-GCM under a key derived from one setting. Used for the
 * session cookie (which carries the person's GitHub token, so it must be
 * unreadable as well as unforgeable) and for authenticator secrets at rest.
 * The `purpose` is bound in, so a sealed session can never be replayed as a
 * sealed secret or the other way round.
 */
const keyFor = (secret: string, purpose: string) => createHash('sha256').update(`${purpose}\n${secret}`).digest();

export function seal(secret: string, purpose: string, value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, purpose), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function unseal<T>(secret: string, purpose: string, sealed: string): T | null {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret, purpose), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as T;
  } catch {
    return null;
  }
}
