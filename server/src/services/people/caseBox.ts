import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * The lock on private cases (docs/people/02-PRD.md PRIV-03; decision D-09):
 * AES-256-GCM with PEOPLE_CASE_KEY. Each value names the key that sealed it
 * (a fingerprint, never the key) and is bound to its case, so a sealed
 * summary cannot be moved onto another case. The key can be changed by
 * moving the old one to PEOPLE_CASE_KEY_PREVIOUS: old values still open, new
 * ones use the new key. Without a key in production nothing is sealed or
 * opened — the case routes say so rather than store plain text.
 */

const VERSION = 'pc1';
const DEV_KEY = 'clor-dev-only-private-case-key-not-for-production';

const keyOf = (secret: string) => createHash('sha256').update(`clor:private-case:${secret}`).digest();
const fingerprint = (secret: string) => createHash('sha256').update(`clor:fp:${secret}`).digest('hex').slice(0, 12);

export class CaseKeyMissing extends Error {
  constructor() {
    super('Private cases are switched off here: no encryption key is set (PEOPLE_CASE_KEY).');
  }
}

function current(): string {
  const k = process.env.PEOPLE_CASE_KEY;
  if (k && k.length >= 16) return k;
  if (process.env.NODE_ENV === 'production') throw new CaseKeyMissing();
  return DEV_KEY;
}

function candidates(): string[] {
  const out: string[] = [];
  const now = process.env.PEOPLE_CASE_KEY;
  const prev = process.env.PEOPLE_CASE_KEY_PREVIOUS;
  if (now && now.length >= 16) out.push(now);
  if (prev && prev.length >= 16) out.push(prev);
  if (process.env.NODE_ENV !== 'production') out.push(DEV_KEY);
  return out;
}

export function caseKeyReady() {
  try {
    current();
    return true;
  } catch {
    return false;
  }
}

/** Seal text or bytes for one case: "pc1.<fp>.<iv>.<tag>.<data>", all base64url. */
export function seal(caseId: string, value: string | Buffer): string {
  const secret = current();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  c.setAAD(Buffer.from(`case:${caseId}`));
  const data = Buffer.concat([c.update(typeof value === 'string' ? Buffer.from(value, 'utf8') : value), c.final()]);
  return [VERSION, fingerprint(secret), iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function openBytes(caseId: string, sealed: string): Buffer {
  const [v, fp, iv, tag, data] = String(sealed || '').split('.');
  if (v !== VERSION || !iv || !tag || data === undefined) throw new Error('Not a sealed case value.');
  const secret = candidates().find((k) => fingerprint(k) === fp);
  if (!secret) throw new CaseKeyMissing();
  const d = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(`case:${caseId}`));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]);
}

export const openText = (caseId: string, sealed: string) => openBytes(caseId, sealed).toString('utf8');
