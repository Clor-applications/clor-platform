import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';

/**
 * The connector installs an update only when its Ed25519 signature checks out
 * against the key built into it (agent/src/signing.ts).
 */

const { verifyAgentSignature, AGENT_PUBLIC_KEY } = await import('../../agent/src/signing.js');

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, pub: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
};
const code = Buffer.from('#!/usr/bin/env node\n' + 'x'.repeat(5000));

describe('a connector update signature', () => {
  it('is accepted when it is the right key over the exact bytes', () => {
    const k = pair();
    const sig = sign(null, code, k.privateKey).toString('base64');
    expect(verifyAgentSignature(code, sig, k.pub)).toBe(true);
    expect(verifyAgentSignature(code, `${sig}\n`, k.pub)).toBe(true);
  });

  it('is refused when one byte of the file changed', () => {
    const k = pair();
    const sig = sign(null, code, k.privateKey).toString('base64');
    const tampered = Buffer.from(code);
    tampered[100] ^= 1;
    expect(verifyAgentSignature(tampered, sig, k.pub)).toBe(false);
  });

  it('is refused when made with another key', () => {
    const ours = pair();
    const theirs = pair();
    const sig = sign(null, code, theirs.privateKey).toString('base64');
    expect(verifyAgentSignature(code, sig, ours.pub)).toBe(false);
    /* The key built into the connector is not anybody's test key either. */
    expect(verifyAgentSignature(code, sig)).toBe(false);
  });

  it('is refused when missing or not a signature at all', () => {
    const k = pair();
    expect(verifyAgentSignature(code, undefined, k.pub)).toBe(false);
    expect(verifyAgentSignature(code, null, k.pub)).toBe(false);
    expect(verifyAgentSignature(code, '', k.pub)).toBe(false);
    expect(verifyAgentSignature(code, '<html>Not found</html>', k.pub)).toBe(false);
    expect(verifyAgentSignature(code, Buffer.alloc(64).toString('base64'), k.pub)).toBe(false);
    expect(verifyAgentSignature(code, Buffer.alloc(10).toString('base64'), k.pub)).toBe(false);
  });

  it('builds in an Ed25519 public key', async () => {
    const { createPublicKey } = await import('node:crypto');
    expect(createPublicKey(AGENT_PUBLIC_KEY).asymmetricKeyType).toBe('ed25519');
    expect(AGENT_PUBLIC_KEY).not.toMatch(/PRIVATE/);
  });
});
