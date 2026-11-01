import { randomBytes } from 'node:crypto';
import { platformPrisma } from '../utils/platformPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { runInTenant } from '../utils/tenantScope.js';
import { decryptSecret, encryptSecret } from './mailer.js';
import {
  CredentialError,
  defaultExpiry,
  effectiveStatus,
  hashToken,
  issueCredential,
  liveCredentialOf,
  revokeCredential,
  rotateCredential,
  type Actor,
  type VerifyOptions,
} from './credentials.js';
import { liveCredentialFor } from './credentialKinds.js';

/**
 * Directory-sync (SCIM) tokens (A-31, Batch 5).
 *
 * A token is either stand-alone — an administrator made it for Entra or Okta
 * in SSO settings — or belongs to an on-site agent that syncs Active
 * Directory. An agent's token works only while the agent does: switched off,
 * the agent stops its token too (worked out on every check, so switching it
 * back on restores it); deleted, or its directory sync removed, the token is
 * revoked. Revoking keeps the row with its hash scrambled, so older code that
 * looks tokens up by hash finds nothing, and the history stays.
 */

export const newScimToken = () => `clors_${randomBytes(24).toString('base64url')}`;

type ScimRow = NonNullable<Awaited<ReturnType<typeof platformPrisma.scimToken.findUnique>>>;

/** The agent a SCIM token belongs to, if any. */
const agentOfToken = (scimTokenId: string) => peoplePrisma.siteAgent.findFirst({ where: { scimTokenId } });

/** Is an agent usable as a parent: there, switched on, and with a credential that is not suspended or revoked. */
async function agentUsable(agentId: string, orgId: string) {
  const a = await peoplePrisma.siteAgent.findUnique({ where: { id: agentId } });
  if (!a || !a.isActive) return false;
  const creds = await runInTenant(orgId, () => platformPrisma.credential.findMany({ where: { kind: 'AGENT', ownerId: agentId }, select: { status: true } }));
  return !creds.length || creds.some((c) => c.status === 'ACTIVE');
}

export const scimKind: VerifyOptions<ScimRow> = {
  legacy: async (hash) => {
    const t = await platformPrisma.scimToken.findUnique({ where: { tokenHash: hash } });
    if (!t || t.revokedAt) return null;
    const agent = await agentOfToken(t.id);
    return { ownerId: t.id, accountId: t.accountId, orgId: t.orgId, tokenPrefix: t.tokenPrefix, createdByUserId: t.createdByUserId, parentOwnerId: agent?.id ?? null, label: agent ? `Directory sync for ${agent.name}` : 'Directory sync' };
  },
  owner: async (id, c) => {
    const t = await platformPrisma.scimToken.findUnique({ where: { id } });
    if (!t) return null;
    return {
      enabled: !t.revokedAt,
      hash: t.tokenHash,
      ...(c.parentOwnerId ? { parentUsable: await agentUsable(c.parentOwnerId, c.orgId) } : {}),
      row: t,
    };
  },
};

const liveOf = async (t: ScimRow, actor: Actor) => {
  const agent = await agentOfToken(t.id);
  return liveCredentialFor('SCIM', t.id, { hash: t.tokenHash, prefix: t.tokenPrefix, accountId: t.accountId, orgId: t.orgId, createdByUserId: t.createdByUserId, parentOwnerId: agent?.id ?? null }, actor);
};

/** A stand-alone token, made in SSO settings. */
export async function createScimToken(
  t: { accountId: string; orgId: string },
  input: { defaultRoleId: string | null; expiresAt?: Date | null },
  actor: Actor & { id: string }
) {
  const token = newScimToken();
  const row = await platformPrisma.scimToken.create({
    data: { accountId: t.accountId, orgId: t.orgId, tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12), defaultRoleId: input.defaultRoleId, createdByUserId: actor.id },
  });
  const credential = await issueCredential(
    {
      kind: 'SCIM',
      accountId: t.accountId,
      orgId: t.orgId,
      ownerId: row.id,
      token,
      tokenPrefix: row.tokenPrefix,
      label: 'Directory sync',
      expiresAt: input.expiresAt === undefined ? defaultExpiry('SCIM', { standalone: true }) : input.expiresAt,
      createdByUserId: actor.id,
    },
    actor
  ).catch((e) => {
    console.error('[credentials] SCIM token registered on first use instead:', (e as Error).message);
    return null;
  });
  return { row, token, credential };
}

/** An agent's token: made when directory sync is first set up on it, handed over once through the agent's mailbox. */
export async function issueAgentScimToken(a: { id: string; accountId: string; orgId: string; pendingEnc: string | null; createdByUserId: string; name?: string }, defaultRoleId: string | null, actor: Actor) {
  const token = newScimToken();
  const row = await platformPrisma.scimToken.create({ data: { accountId: a.accountId, orgId: a.orgId, tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12), defaultRoleId, createdByUserId: a.createdByUserId } });
  await issueCredential(
    { kind: 'SCIM', accountId: a.accountId, orgId: a.orgId, ownerId: row.id, parentOwnerId: a.id, token, tokenPrefix: row.tokenPrefix, label: a.name ? `Directory sync for ${a.name}` : 'Directory sync', createdByUserId: a.createdByUserId },
    actor
  ).catch((e) => console.error('[credentials] agent SCIM token registered on first use instead:', (e as Error).message));
  await handToAgent(a.id, a.pendingEnc, token, row.id);
  return row;
}

async function handToAgent(agentId: string, pendingEnc: string | null, token: string, scimTokenId?: string) {
  let pending: Record<string, string> = {};
  try {
    pending = pendingEnc ? JSON.parse(decryptSecret(pendingEnc)) : {};
  } catch {
    pending = {};
  }
  await peoplePrisma.siteAgent.update({ where: { id: agentId }, data: { ...(scimTokenId ? { scimTokenId } : {}), pendingEnc: encryptSecret(JSON.stringify({ ...pending, scimToken: token })) } });
}

export async function findScimToken(orgId: string, id: string) {
  return platformPrisma.scimToken.findFirst({ where: { id, orgId } });
}

/**
 * Revoke: registry first, then the token row is kept with its hash
 * scrambled. An agent's token is unlinked from the agent, so the next
 * directory-sync save makes it a new one.
 */
export async function revokeScimToken(orgId: string, id: string, actor: Actor, reason?: string | null) {
  const t = await findScimToken(orgId, id);
  if (!t) throw new CredentialError(404, 'No such token.', 'NOT_FOUND');
  if (t.revokedAt) return t;
  const live = await liveOf(t, actor);
  if (live) await revokeCredential(live.id, orgId, actor, reason);
  const row = await platformPrisma.scimToken.update({ where: { id: t.id }, data: { revokedAt: new Date(), tokenHash: `revoked:${t.id}:${randomBytes(8).toString('hex')}` } });
  await peoplePrisma.siteAgent.updateMany({ where: { scimTokenId: t.id }, data: { scimTokenId: null } });
  return row;
}

/**
 * Rotate: the old token stops at once and a new one is made. A stand-alone
 * token's successor is shown once to the administrator; an agent's goes to
 * the agent through its mailbox.
 */
export async function rotateScimToken(orgId: string, id: string, actor: Actor, reason?: string | null) {
  const t = await findScimToken(orgId, id);
  if (!t) throw new CredentialError(404, 'No such token.', 'NOT_FOUND');
  if (t.revokedAt) throw new CredentialError(409, 'This token is revoked; make a new one.', 'CREDENTIAL_REVOKED');
  const live = await liveOf(t, actor);
  if (!live) throw new CredentialError(409, 'This token cannot be rotated; make a new one.', 'CREDENTIAL_REVOKED');
  const token = newScimToken();
  /* Registry first (KTD4): if this cannot be recorded, the old token keeps working and this fails. */
  const credential = await rotateCredential(live.id, orgId, { token, tokenPrefix: token.slice(0, 12) }, actor, reason);
  const row = await platformPrisma.scimToken.update({ where: { id: t.id }, data: { tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12) } });
  const agent = await agentOfToken(t.id);
  if (agent) {
    await handToAgent(agent.id, agent.pendingEnc, token);
    return { row, token: null, credential, agentId: agent.id };
  }
  return { row, token, credential, agentId: null };
}

/**
 * The SSO settings list: every token not revoked, with the status the
 * registry and its agent give it now, so a token that stops for a reason
 * outside SSO settings (its connector switched off, paused under Credentials)
 * says why.
 */
export async function scimTokensFor(t: { accountId: string; orgId: string }) {
  const rows = await platformPrisma.scimToken.findMany({ where: { accountId: t.accountId, orgId: t.orgId, revokedAt: null }, orderBy: { createdAt: 'asc' } });
  return Promise.all(
    rows.map(async (r) => {
      const c = await liveCredentialOf('SCIM', r.id, t.orgId);
      const agent = await agentOfToken(r.id);
      let status: string = 'ACTIVE';
      if (c) {
        const owner = await scimKind.owner(r.id, c);
        const eff = await effectiveStatus(c, owner);
        status = eff.usable ? 'ACTIVE' : eff.block;
      }
      return {
        id: r.id,
        tokenPrefix: r.tokenPrefix,
        defaultRoleId: r.defaultRoleId,
        lastUsedAt: c?.lastUsedAt ?? r.lastUsedAt,
        lastError: r.lastError,
        createdAt: r.createdAt,
        credentialId: c?.id ?? null,
        expiresAt: c?.expiresAt ?? null,
        status,
        agent: agent ? { id: agent.id, name: agent.name } : null,
      };
    })
  );
}
