import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Time-based one-time passwords (RFC 6238, as Google Authenticator, Microsoft
 * Authenticator and the rest use): HMAC-SHA1, 30-second steps, six digits.
 * Written out here rather than pulled from a package — it is forty lines of
 * arithmetic and the one thing in sign-in that must not change underneath us.
 *
 * A code is accepted for the step before and after the current one (clock
 * drift on a phone), and never twice: the caller keeps the last step used.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string) {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Not base32.');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32Encode(randomBytes(20));

/** The code for one 30-second step. */
export function codeAt(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  counter.writeUInt32BE(step >>> 0, 4);
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = h[h.length - 1] & 15;
  const n = ((h[offset] & 127) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export const stepNow = (at = Date.now()) => Math.floor(at / 1000 / STEP_SECONDS);

/** The step a code belongs to, or null — not accepted, or already used (`lastStep`). */
export function verifyCode(secret: string, code: string, lastStep: number | null, at = Date.now()) {
  const given = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  const now = stepNow(at);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep != null && step <= lastStep) continue;
    const want = codeAt(secret, step);
    if (timingSafeEqual(Buffer.from(want), Buffer.from(given))) return step;
  }
  return null;
}

/** What an authenticator app scans (as a QR code) to add the account. */
export const otpauthUri = (secret: string, account: string, issuer = 'CLOR') =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

/** Eight one-use codes for a lost phone, shown once; only their hashes are kept. */
export function recoveryCodes() {
  const codes = Array.from({ length: 8 }, () => {
    const raw = base32Encode(randomBytes(5)).slice(0, 8);
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashRecovery) };
}
export const hashRecovery = (code: string) => createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex');
