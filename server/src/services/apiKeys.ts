import { randomBytes } from 'node:crypto';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import {
  CredentialError,
  defaultExpiry,
  hashToken,
  issueCredential,
  revokeCredential,
  rotateCredential,
  type Actor,
} from './credentials.js';
import { liveCredentialFor } from './credentialKinds.js';

/**
 * API keys for outside systems: issued, rotated and revoked here, wherever
 * the request comes from (Attendance → Integrations, Workspace →
 * Credentials). The key lives in `ApiClient` (people) and in the credential
 * registry (platform); changes that take access away go to the registry first
 * and fail the request if they cannot be recorded (Batch 5, KTD4).
 */

export const newApiKeyToken = () => `clor_${randomBytes(32).toString('hex')}`;

type Scope = { accountId: string; orgId: string };

export async function createApiKey(
  t: Scope,
  input: { name: string; scopes: string[]; allowedIps?: string | null; expiresAt?: Date | null },
  actor: Actor & { id: string }
) {
  const token = newApiKeyToken();
  const key = await peoplePrisma.apiClient.create({
    data: {
      accountId: t.accountId,
      orgId: t.orgId,
      name: input.name,
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(0, 12),
      scopes: [...new Set(input.scopes)].join(','),
      allowedIps: input.allowedIps ? input.allowedIps.split(',').map((s) => s.trim()).filter(Boolean).join(',') : null,
      createdByUserId: actor.id,
    },
  });
  /* Created: issuing table first, then the registry; a missed registry write is repaired on first use (write-through). */
  const credential = await issueCredential(
    {
      kind: 'API_KEY',
      accountId: t.accountId,
      orgId: t.orgId,
      ownerId: key.id,
      token,
      tokenPrefix: key.tokenPrefix,
      label: key.name,
      expiresAt: input.expiresAt === undefined ? defaultExpiry('API_KEY') : input.expiresAt,
      createdByUserId: actor.id,
    },
    actor
  ).catch((e) => {
    console.error('[credentials] API key registered on first use instead:', (e as Error).message);
    return null;
  });
  return { key, token, credential };
}

async function liveOf(key: NonNullable<Awaited<ReturnType<typeof peoplePrisma.apiClient.findFirst>>>, actor: Actor) {
  return liveCredentialFor('API_KEY', key.id, { hash: key.tokenHash, prefix: key.tokenPrefix, accountId: key.accountId, orgId: key.orgId, createdByUserId: key.createdByUserId, label: key.name }, actor);
}

export async function findApiKey(t: Scope, id: string) {
  return peoplePrisma.apiClient.findFirst({ where: { id, accountId: t.accountId, orgId: t.orgId } });
}

/**
 * A new key; the old one stops at once. A revoked key is not brought back by
 * rotating it (it used to be): revoked is final, make a new one.
 */
export async function rotateApiKey(t: Scope, id: string, actor: Actor, reason?: string | null) {
  const existing = await findApiKey(t, id);
  if (!existing) throw new CredentialError(404, 'No such key.', 'NOT_FOUND');
  if (!existing.isActive || existing.revokedAt) throw new CredentialError(409, 'This key is revoked; make a new one.', 'CREDENTIAL_REVOKED');
  const live = await liveOf(existing, actor);
  if (!live) throw new CredentialError(409, 'This key cannot be rotated; make a new one.', 'CREDENTIAL_REVOKED');
  const token = newApiKeyToken();
  /* Registry first: if this fails, the request fails and the old key still works (KTD4). */
  const credential = await rotateCredential(live.id, t.orgId, { token, tokenPrefix: token.slice(0, 12) }, actor, reason);
  const key = await peoplePrisma.apiClient.update({ where: { id: existing.id }, data: { tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12) } });
  return { key, token, credential };
}

export async function revokeApiKey(t: Scope, id: string, actor: Actor, reason?: string | null) {
  const existing = await findApiKey(t, id);
  if (!existing) throw new CredentialError(404, 'No such key.', 'NOT_FOUND');
  const live = await liveOf(existing, actor);
  if (live) await revokeCredential(live.id, t.orgId, actor, reason);
  /* Mirrored into the column older code reads (KTD4). */
  const key = await peoplePrisma.apiClient.update({ where: { id: existing.id }, data: { isActive: false, revokedAt: existing.revokedAt ?? new Date() } });
  return { key };
}
