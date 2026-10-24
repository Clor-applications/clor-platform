import { describe, it, expect, afterEach } from 'vitest';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

/*
 * A-34 (Batch 11): secrets kept encrypted (SMTP and SSO passwords, webhook and
 * connector secrets, share-link copies) said nothing about which key made
 * them, bound nothing beyond the key, and could not survive a key change:
 * changing MAIL_SECRET_KEY made every stored secret unreadable at once.
 *
 * Now a stored secret names its key (a fingerprint, never the key), is bound
 * to CLOR's secret box, and the key can be changed by moving the old one to
 * MAIL_SECRET_KEY_PREVIOUS: old secrets still open, new ones use the new key.
 * This release still writes the old shape (old instances in a rolling deploy
 * read it); SECRET_FORMAT=v2 writes the new one, the default next release.
 */
const mailer = await import('../services/mailer.js');

const ENV = ['MAIL_SECRET_KEY', 'MAIL_SECRET_KEY_PREVIOUS', 'SECRET_FORMAT'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV) if (saved[k] === undefined) delete process.env[k];
  else process.env[k] = saved[k];
});

/** A secret as this release's predecessor wrote it: iv.tag.data, no key id, no binding. */
function legacy(plain: string, secret: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

describe('a stored secret names its key', () => {
  it('in the new shape: v2, a key fingerprint, and nothing of the key itself', () => {
    process.env.MAIL_SECRET_KEY = 'key-one-0123456789abcdef';
    process.env.SECRET_FORMAT = 'v2';
    const box = mailer.encryptSecret('smtp-pass');
    const [v, kid] = box.split('.');
    expect(v).toBe('v2');
    expect(kid).toBe(mailer.keyIdOf('key-one-0123456789abcdef'));
    expect(kid).toMatch(/^[0-9a-f]{16}$/);
    expect(box).not.toContain('key-one');
    expect(mailer.decryptSecret(box)).toBe('smtp-pass');
  });

  it('is bound to CLOR’s secret box: the same ciphertext without the binding does not open', () => {
    process.env.MAIL_SECRET_KEY = 'key-one-0123456789abcdef';
    process.env.SECRET_FORMAT = 'v2';
    const [, , iv, tag, data] = mailer.encryptSecret('smtp-pass').split('.');
    expect(mailer.decryptSecret(`${iv}.${tag}.${data}`)).toBe('');
  });

  it('this release still writes the shape old instances read, unless told otherwise', () => {
    process.env.MAIL_SECRET_KEY = 'key-one-0123456789abcdef';
    delete process.env.SECRET_FORMAT;
    const box = mailer.encryptSecret('smtp-pass');
    expect(box.split('.')).toHaveLength(3);
    expect(mailer.decryptSecret(box)).toBe('smtp-pass');
  });
});

describe('the key can be changed', () => {
  it('old secrets, either shape, open with the previous key; new ones use the new key', () => {
    process.env.MAIL_SECRET_KEY = 'key-one-0123456789abcdef';
    process.env.SECRET_FORMAT = 'v2';
    const v2Old = mailer.encryptSecret('webhook-secret');
    const v1Old = legacy('sso-secret', 'key-one-0123456789abcdef');

    process.env.MAIL_SECRET_KEY = 'key-two-fedcba9876543210';
    process.env.MAIL_SECRET_KEY_PREVIOUS = 'key-one-0123456789abcdef';
    expect(mailer.decryptSecret(v2Old)).toBe('webhook-secret');
    expect(mailer.decryptSecret(v1Old)).toBe('sso-secret');
    expect(mailer.decryptSecretAnyKey(v1Old)).toEqual({ plain: 'sso-secret', stale: true });
    const fresh = mailer.encryptSecret('new');
    expect(fresh.split('.')[1]).toBe(mailer.keyIdOf('key-two-fedcba9876543210'));

    delete process.env.MAIL_SECRET_KEY_PREVIOUS;
    expect(mailer.decryptSecret(v2Old)).toBe('');
    expect(mailer.decryptSecret(fresh)).toBe('new');
  });

  it('a secret made with the current key is not stale', () => {
    process.env.MAIL_SECRET_KEY = 'key-one-0123456789abcdef';
    process.env.SECRET_FORMAT = 'v2';
    expect(mailer.decryptSecretAnyKey(mailer.encryptSecret('x'))).toEqual({ plain: 'x', stale: false });
  });
});
