import { createPublicKey, verify } from 'node:crypto';

/**
 * The public half of the key CLOR signs every connector build with
 * (scripts/sign-agent.mjs). A self-update installs a download only when its
 * signature checks out against this, so a compromised download path, proxy
 * or server cannot push code onto a customer's box. The private key lives off
 * the repository (~/.config/clor/agent-signing.key on the deploying machine).
 */
export const AGENT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAavJEjHHE9OvtctgkQ/YefCtHEl5M04KhiJwr+uXp2X4=
-----END PUBLIC KEY-----
`;

/** Whether `sigBase64` is a valid Ed25519 signature of `code` by the key. Never throws: anything odd is a no. */
export function verifyAgentSignature(code: Buffer, sigBase64: string | null | undefined, publicKeyPem: string = AGENT_PUBLIC_KEY): boolean {
  const text = String(sigBase64 || '').trim();
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false;
  const sig = Buffer.from(text, 'base64');
  if (sig.length !== 64) return false;
  try {
    return verify(null, code, createPublicKey(publicKeyPem), sig);
  } catch {
    return false;
  }
}
