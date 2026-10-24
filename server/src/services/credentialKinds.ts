import { peoplePrisma } from '../utils/peoplePrisma.js';
import {
  verifyCredential,
  registerLegacy,
  liveCredentialOf,
  type Actor,
  type Block,
  type CredentialKind,
  type LegacyHit,
  type Verified,
  type VerifyOptions,
} from './credentials.js';

/**
 * How each kind of credential is found in the table that issued it, and what
 * that table says about it now (Batch 5, KTD2/KTD3). The registry asks these
 * on every check, so a token that table has switched off, deleted or
 * re-issued is refused even when the registry has not heard yet.
 */

type ApiClientRow = NonNullable<Awaited<ReturnType<typeof peoplePrisma.apiClient.findUnique>>>;
type SiteAgentRow = NonNullable<Awaited<ReturnType<typeof peoplePrisma.siteAgent.findUnique>>>;
type DeviceRow = NonNullable<Awaited<ReturnType<typeof peoplePrisma.attendanceDevice.findUnique>>>;

export const apiKeyKind: VerifyOptions<ApiClientRow> = {
  legacy: async (hash) => {
    const r = await peoplePrisma.apiClient.findUnique({ where: { tokenHash: hash } });
    if (!r || !r.isActive || r.revokedAt) return null;
    return { ownerId: r.id, accountId: r.accountId, orgId: r.orgId, tokenPrefix: r.tokenPrefix, createdByUserId: r.createdByUserId, label: r.name };
  },
  owner: async (id) => {
    const r = await peoplePrisma.apiClient.findUnique({ where: { id } });
    return r ? { enabled: r.isActive && !r.revokedAt, hash: r.tokenHash, row: r } : null;
  },
};

export const agentKind: VerifyOptions<SiteAgentRow> = {
  legacy: async (hash) => {
    const a = await peoplePrisma.siteAgent.findUnique({ where: { tokenHash: hash } });
    if (!a) return null;
    return { ownerId: a.id, accountId: a.accountId, orgId: a.orgId, tokenPrefix: a.tokenPrefix, createdByUserId: a.createdByUserId, label: a.name };
  },
  owner: async (id) => {
    const a = await peoplePrisma.siteAgent.findUnique({ where: { id } });
    return a ? { enabled: a.isActive, hash: a.tokenHash, row: a } : null;
  },
};

/** A reader's push token, for one vendor's route: a token made for another vendor's reader is not this route's. */
export const devicePushKind = (vendor: string): VerifyOptions<DeviceRow> => ({
  legacy: async (hash) => {
    const d = await peoplePrisma.attendanceDevice.findUnique({ where: { pushTokenHash: hash } });
    if (!d || !d.pushTokenPrefix) return null;
    return { ownerId: d.id, accountId: d.accountId, orgId: d.orgId, tokenPrefix: d.pushTokenPrefix, createdByUserId: (d as any).createdByUserId ?? null, label: d.name };
  },
  owner: async (id) => {
    const d = await peoplePrisma.attendanceDevice.findUnique({ where: { id } });
    if (!d || d.vendor !== vendor) return null;
    return { enabled: d.isActive, hash: d.pushTokenHash, row: d };
  },
});

/** Words a route sends for each reason a token is refused. */
export type Refused = { status: number; error: string; code?: string; block: Block | 'UNKNOWN' };

export function refusalOf(v: Extract<Verified, { ok: false }>, words: { invalid: string; off: string; status?: { invalid?: number; off?: number } }): Refused {
  const invalid = words.status?.invalid ?? 401;
  switch (v.block) {
    case 'SUSPENDED':
      return { status: 403, error: 'This credential is paused in CLOR. An administrator can resume it under Workspace → Credentials.', code: 'CREDENTIAL_SUSPENDED', block: v.block };
    case 'EXPIRED':
      return { status: 401, error: 'This credential has expired. Ask an administrator for a new one.', code: 'CREDENTIAL_EXPIRED', block: v.block };
    case 'OWNER_OFF':
      return { status: words.status?.off ?? 403, error: words.off, block: v.block };
    case 'PARENT_OFF':
      return { status: 403, error: 'The connector this token belongs to is switched off in CLOR.', code: 'PARENT_OFF', block: v.block };
    case 'COMPANY_CLOSING':
    case 'APP_OFF':
      return { status: v.refusal?.status ?? 403, error: v.refusal?.error ?? 'Not available.', code: v.refusal?.code, block: v.block };
    default:
      return { status: invalid, error: words.invalid, block: v.block };
  }
}

/* ------------------------------------------------- the live credential of an owner */

type OwnerToken = { hash: string | null; prefix: string | null; accountId: string; orgId: string; createdByUserId?: string | null; label?: string | null; parentOwnerId?: string | null };

/**
 * The credential an owner has now, registering it from the issuing table if
 * the registry has not seen it (a token from before the registry). Used
 * before a rotate or revoke, which must act on the registry first.
 */
export async function liveCredentialFor(kind: CredentialKind, ownerId: string, t: OwnerToken, actor?: Actor) {
  const found = await liveCredentialOf(kind, ownerId, t.orgId);
  if (found) return found;
  if (!t.hash || !t.prefix) return null;
  const hit: LegacyHit = { ownerId, accountId: t.accountId, orgId: t.orgId, tokenPrefix: t.prefix, createdByUserId: t.createdByUserId, label: t.label, parentOwnerId: t.parentOwnerId };
  return registerLegacy(kind, t.hash, hit, actor, 'registered before a change');
}

