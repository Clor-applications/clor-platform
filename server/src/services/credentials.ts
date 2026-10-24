import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../utils/tenantScope.js';
import { appLive, closing, type Refusal } from './principalAllowed.js';

/**
 * The credential registry (GAP-004, Batch 5).
 *
 * CLOR hands tokens to machines and links: SCIM tokens to identity providers,
 * API keys to integrations, tokens to on-site agents and readers, pay links
 * and invoice share links to customers. Each kind grew up in its own table
 * with its own rules — some could not be paused, none expired by default, a
 * revoke was sometimes a delete, and nobody could list them in one place.
 *
 * Every one now also has a `Credential` row, and every check goes through
 * `verifyCredential`, which asks both the registry and the table that issued
 * the token. The most restrictive answer wins (KTD3): while older code may
 * still be running beside this one — a rolling deploy — a token that older
 * code switched off, deleted or re-issued in its own table stays refused here,
 * even though the registry has not heard.
 *
 * Writes go to the registry first for anything that takes access away
 * (revoke, suspend, rotate), so a failed write fails the request rather than
 * leaving a token live (KTD4). Every change is written to `CredentialEvent`.
 */

export type CredentialKind = 'SCIM' | 'API_KEY' | 'AGENT' | 'DEVICE_PUSH' | 'PAY_LINK' | 'SHARE_LINK';
export const CREDENTIAL_KINDS: CredentialKind[] = ['SCIM', 'API_KEY', 'AGENT', 'DEVICE_PUSH', 'PAY_LINK', 'SHARE_LINK'];

/** The app a kind serves; SCIM serves no app and answers only to a closure. */
const APP_OF: Record<CredentialKind, string | null> = {
  SCIM: null,
  API_KEY: 'attendance',
  AGENT: 'attendance',
  DEVICE_PUSH: 'attendance',
  PAY_LINK: 'accounting',
  SHARE_LINK: 'accounting',
};

/** SHA-256 hex of a token: all that is kept of it, here and in the issuing tables. */
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** New API keys and stand-alone SCIM tokens last a year unless the admin says otherwise (R6); the rest do not expire by default. */
export function defaultExpiry(kind: CredentialKind, opts: { standalone?: boolean } = {}, now = new Date()): Date | null {
  if (kind === 'API_KEY' || (kind === 'SCIM' && opts.standalone)) return new Date(now.getTime() + YEAR_MS);
  return null;
}

/* ------------------------------------------------------------------ actors */

export type Actor = {
  type: 'USER' | 'SYSTEM' | 'SCIM' | 'AGENT' | 'EMPLOYEE';
  id?: string | null;
  label?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export const SYSTEM: Actor = { type: 'SYSTEM' };

export function actorFrom(req: Request): Actor {
  return {
    type: 'USER',
    id: (req as any).auth?.userId ?? null,
    ip: req.ip ?? null,
    userAgent: String(req.get('user-agent') || '').slice(0, 300) || null,
  };
}

async function labelFor(actor: Actor): Promise<string | null> {
  if (actor.label !== undefined) return actor.label ?? null;
  if (actor.type !== 'USER' || !actor.id) return null;
  try {
    const u = await outsideTenant('credential event: who did it', () =>
      platformPrisma.user.findUnique({ where: { id: actor.id! }, select: { fullName: true, email: true } })
    );
    return u ? `${u.fullName || ''} <${u.email}>`.trim() : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ events */

type CredentialRow = Awaited<ReturnType<typeof platformPrisma.credential.findUniqueOrThrow>>;

/**
 * Write one event. Never throws: an event that cannot be written is logged,
 * not allowed to undo the change it describes. No token, hash or URL is ever
 * passed here.
 */
export async function recordCredentialEvent(
  c: Pick<CredentialRow, 'id' | 'accountId' | 'orgId' | 'kind' | 'tokenPrefix'>,
  eventType: string,
  actor: Actor,
  extra: { reason?: string | null; metadata?: Record<string, unknown> } = {}
) {
  try {
    const actorLabel = await labelFor(actor);
    await runInTenant(c.orgId, () =>
      platformPrisma.credentialEvent.create({
        data: {
          accountId: c.accountId,
          orgId: c.orgId,
          credentialId: c.id,
          credentialKind: c.kind,
          credentialPrefix: c.tokenPrefix,
          eventType,
          actorType: actor.type,
          actorId: actor.id ?? null,
          actorLabel,
          ip: actor.ip ?? null,
          userAgent: actor.userAgent ?? null,
          reason: extra.reason ?? null,
          metadata: extra.metadata ? JSON.stringify(extra.metadata) : null,
        },
      })
    );
  } catch (e) {
    console.error('[credentials] event not recorded', eventType, c.id, (e as Error).message);
  }
}

/* --------------------------------------------------------- effective status */

/** What the issuing table says about the token's owner, as of now. */
export type Owner = {
  /** The admin's own switch on the owner (an agent switched off, a reader switched off, a key revoked there). */
  enabled: boolean;
  /** The owner's current hash, for owners that hold exactly one; a different one means the token was re-issued there. */
  hash?: string | null;
  /** For a child token (an agent's SCIM token): is its parent usable? */
  parentUsable?: boolean;
};

/** An owner as an adapter loads it: the verdict inputs plus the row itself, so a route need not read it twice. */
export type LoadedOwner<R = unknown> = Owner & { row: R };

export type Block =
  | 'SUSPENDED'
  | 'REVOKED'
  | 'EXPIRED'
  | 'OWNER_MISSING'
  | 'OWNER_OFF'
  | 'SUPERSEDED'
  | 'PARENT_OFF'
  | 'COMPANY_CLOSING'
  | 'APP_OFF';

export type Effective = { usable: true } | { usable: false; block: Block; refusal?: Refusal };

/**
 * The one rule (KTD3): stored status, expiry, the issuing row, the parent,
 * the company and the app must all allow it. The routes, the Credentials page
 * and the expiry job all read this.
 */
export async function effectiveStatus(
  c: Pick<CredentialRow, 'kind' | 'status' | 'expiresAt' | 'tokenHash' | 'accountId' | 'orgId'>,
  owner: Owner | null,
  now = new Date()
): Promise<Effective> {
  if (c.status === 'REVOKED') return { usable: false, block: 'REVOKED' };
  if (c.status === 'SUSPENDED') return { usable: false, block: 'SUSPENDED' };
  if (c.expiresAt && c.expiresAt <= now) return { usable: false, block: 'EXPIRED' };
  if (!owner) return { usable: false, block: 'OWNER_MISSING' };
  if (!owner.enabled) return { usable: false, block: 'OWNER_OFF' };
  if (owner.hash !== undefined && owner.hash !== c.tokenHash) return { usable: false, block: 'SUPERSEDED' };
  if (owner.parentUsable === false) return { usable: false, block: 'PARENT_OFF' };
  const app = APP_OF[c.kind as CredentialKind];
  if (!app) {
    if (await closing(c.orgId)) return { usable: false, block: 'COMPANY_CLOSING' };
    return { usable: true };
  }
  const refusal = await appLive(c.accountId, c.orgId, app);
  if (refusal) return { usable: false, block: refusal.code === 'COMPANY_CLOSING' ? 'COMPANY_CLOSING' : 'APP_OFF', refusal };
  return { usable: true };
}

/* ------------------------------------------------------------------ verify */

/** A token found only in the table that issued it (issued before the registry, or its registry write failed). */
export type LegacyHit = {
  ownerId: string;
  accountId: string;
  orgId: string;
  tokenPrefix: string;
  createdByUserId?: string | null;
  parentOwnerId?: string | null;
  label?: string | null;
  expiresAt?: Date | null;
};

export type VerifyOptions<R = unknown> = {
  /** Find the issuing row by hash, across companies (called inside outsideTenant). */
  legacy: (hash: string) => Promise<LegacyHit | null>;
  /** Read the issuing row by id, inside its company. Null when it is gone. */
  owner: (ownerId: string, c: CredentialRow) => Promise<(Owner & { row?: R }) | null>;
  now?: Date;
};

export type Verified<R = unknown> =
  | { ok: true; credential: CredentialRow; orgId: string; accountId: string; row: R }
  | { ok: false; block: Block | 'UNKNOWN'; refusal?: Refusal; credential?: CredentialRow; row?: R };

/**
 * Is this token, presented to a route that expects `kind`, honoured now?
 *
 * The kind always comes from the route, never from the token's prefix: one
 * prefix is shared by two kinds. The lookup is across companies (the token is
 * how the company is found); everything after it runs as that company.
 */
export async function verifyCredential<R = unknown>(kind: CredentialKind, token: string, opts: VerifyOptions<R>): Promise<Verified<R>> {
  if (!token) return { ok: false, block: 'UNKNOWN' };
  const tokenHash = hashToken(token);
  let c = await outsideTenant(`credential: whose ${kind} token this is`, () =>
    platformPrisma.credential.findUnique({ where: { kind_tokenHash: { kind, tokenHash } } })
  );
  if (!c) {
    const hit = await outsideTenant(`credential: ${kind} token issued before the registry`, () => opts.legacy(tokenHash));
    if (!hit) return { ok: false, block: 'UNKNOWN' };
    c = await registerLegacy(kind, tokenHash, hit);
  }
  const owner = await runInTenant(c.orgId, () => opts.owner(c!.ownerId, c!));
  const eff = await effectiveStatus(c, owner, opts.now);
  if (!eff.usable) return { ok: false, block: eff.block, refusal: eff.refusal, credential: c, row: owner?.row as R | undefined };
  return { ok: true, credential: c, orgId: c.orgId, accountId: c.accountId, row: owner!.row as R };
}

/** Write-through: a token the registry has not seen gets its row now (KTD4, KTD11). Two first uses at once make one row. */
export async function registerLegacy(kind: CredentialKind, tokenHash: string, hit: LegacyHit, actor: Actor = SYSTEM, reason = 'first use') {
  try {
    const row = await runInTenant(hit.orgId, () =>
      platformPrisma.credential.create({
        data: {
          accountId: hit.accountId,
          orgId: hit.orgId,
          kind,
          ownerId: hit.ownerId,
          parentOwnerId: hit.parentOwnerId ?? null,
          tokenHash,
          tokenPrefix: hit.tokenPrefix,
          label: hit.label ?? null,
          expiresAt: hit.expiresAt ?? null,
          createdByUserId: hit.createdByUserId ?? null,
        },
      })
    );
    await recordCredentialEvent(row, 'migrated', actor, { reason });
    return row;
  } catch (e: any) {
    if (e?.code !== 'P2002') throw e;
    return runInTenant(hit.orgId, () => platformPrisma.credential.findUniqueOrThrow({ where: { kind_tokenHash: { kind, tokenHash } } }));
  }
}

/* ------------------------------------------------------------------ issue */

export type IssueInput = {
  kind: CredentialKind;
  accountId: string;
  orgId: string;
  ownerId: string;
  parentOwnerId?: string | null;
  token: string;
  tokenPrefix: string;
  label?: string | null;
  expiresAt?: Date | null;
  createdByUserId?: string | null;
};

/** Register a token its issuing table has just written (create: legacy first, then here — KTD4). */
export async function issueCredential(input: IssueInput, actor: Actor) {
  const row = await runInTenant(input.orgId, () =>
    platformPrisma.credential.create({
      data: {
        accountId: input.accountId,
        orgId: input.orgId,
        kind: input.kind,
        ownerId: input.ownerId,
        parentOwnerId: input.parentOwnerId ?? null,
        tokenHash: hashToken(input.token),
        tokenPrefix: input.tokenPrefix,
        label: input.label ?? null,
        expiresAt: input.expiresAt ?? null,
        createdByUserId: input.createdByUserId ?? null,
      },
    })
  );
  await recordCredentialEvent(row, 'issued', actor, { metadata: row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : undefined });
  return row;
}

/* ------------------------------------------------------------- transitions */

export class CredentialError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
    this.name = 'CredentialError';
  }
}

async function load(id: string, orgId: string) {
  const c = await runInTenant(orgId, () => platformPrisma.credential.findFirst({ where: { id, orgId } }));
  if (!c) throw new CredentialError(404, 'No such credential.', 'NOT_FOUND');
  return c;
}

/** Suspend: reversible. Lives only in the registry (KTD4). */
export async function suspendCredential(id: string, orgId: string, actor: Actor, reason?: string | null) {
  const c = await load(id, orgId);
  if (c.status === 'REVOKED') throw new CredentialError(409, 'This credential is revoked; it cannot be paused.', 'CREDENTIAL_REVOKED');
  if (c.status === 'SUSPENDED') return c;
  const row = await runInTenant(orgId, () => platformPrisma.credential.update({ where: { id }, data: { status: 'SUSPENDED', suspendedAt: new Date() } }));
  await recordCredentialEvent(row, 'suspended', actor, { reason });
  return row;
}

export async function resumeCredential(id: string, orgId: string, actor: Actor, reason?: string | null, now = new Date()) {
  const c = await load(id, orgId);
  if (c.status === 'REVOKED') throw new CredentialError(409, 'This credential is revoked; make a new one.', 'CREDENTIAL_REVOKED');
  if (c.expiresAt && c.expiresAt <= now) throw new CredentialError(409, `This credential expired on ${c.expiresAt.toISOString().slice(0, 10)}; rotate it or extend its expiry.`, 'CREDENTIAL_EXPIRED');
  if (c.status === 'ACTIVE') return c;
  const row = await runInTenant(orgId, () => platformPrisma.credential.update({ where: { id }, data: { status: 'ACTIVE', suspendedAt: null } }));
  await recordCredentialEvent(row, 'resumed', actor, { reason });
  return row;
}

/** Revoke: final. The caller then mirrors it into the issuing table (KTD4). */
export async function revokeCredential(id: string, orgId: string, actor: Actor, reason?: string | null) {
  const c = await load(id, orgId);
  if (c.status === 'REVOKED') return c;
  const row = await runInTenant(orgId, () =>
    platformPrisma.credential.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason ?? null } })
  );
  await recordCredentialEvent(row, 'revoked', actor, { reason });
  return row;
}

/** Extend without rotating. The new expiry may not pass today plus one year (R7). */
export async function extendCredential(id: string, orgId: string, until: Date, actor: Actor, now = new Date()) {
  const c = await load(id, orgId);
  if (c.status === 'REVOKED') throw new CredentialError(409, 'This credential is revoked; make a new one.', 'CREDENTIAL_REVOKED');
  if (!(until instanceof Date) || Number.isNaN(until.getTime()) || until <= now) throw new CredentialError(400, 'Choose a date in the future.', 'BAD_EXPIRY');
  if (until.getTime() > now.getTime() + YEAR_MS) throw new CredentialError(400, 'An expiry can be at most one year from today.', 'EXPIRY_TOO_FAR');
  const row = await runInTenant(orgId, () => platformPrisma.credential.update({ where: { id }, data: { expiresAt: until } }));
  await recordCredentialEvent(row, 'extended', actor, { metadata: { from: c.expiresAt?.toISOString() ?? null, to: until.toISOString() } });
  return row;
}

/**
 * Rotate: the old credential is revoked and its successor issued, registry
 * first, before the issuing table is re-hashed (KTD4, KTD5). A revoked
 * credential cannot be rotated; a suspended or expired one can (that is how
 * one recovers after pausing a leaked token).
 */
export async function rotateCredential(
  id: string,
  orgId: string,
  next: { token: string; tokenPrefix: string; expiresAt?: Date | null },
  actor: Actor,
  reason?: string | null
) {
  const c = await load(id, orgId);
  if (c.status === 'REVOKED') throw new CredentialError(409, 'This credential is revoked; make a new one.', 'CREDENTIAL_REVOKED');
  const [, successor] = await runInTenant(orgId, () =>
    platformPrisma.$transaction([
      platformPrisma.credential.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'rotated' } }),
      platformPrisma.credential.create({
        data: {
          accountId: c.accountId,
          orgId: c.orgId,
          kind: c.kind,
          ownerId: c.ownerId,
          parentOwnerId: c.parentOwnerId,
          tokenHash: hashToken(next.token),
          tokenPrefix: next.tokenPrefix,
          label: c.label,
          expiresAt: next.expiresAt === undefined ? c.expiresAt : next.expiresAt,
          rotatedFromId: c.id,
          createdByUserId: actor.type === 'USER' ? actor.id ?? null : c.createdByUserId,
        },
      }),
    ])
  ).catch((e: any) => {
    if (e?.code === 'P2002') throw new CredentialError(409, 'This credential was just rotated; refresh to see the new one.', 'ALREADY_ROTATED');
    throw e;
  });
  await recordCredentialEvent(c, 'rotated', actor, { reason, metadata: { successorId: successor.id } });
  await recordCredentialEvent(successor, 'issued', actor, { reason: 'rotation', metadata: { rotatedFromId: c.id } });
  return successor;
}

/** The live credential an owner has now (rotation leaves one). */
export async function liveCredentialOf(kind: CredentialKind, ownerId: string, orgId: string) {
  return runInTenant(orgId, () =>
    platformPrisma.credential.findFirst({ where: { kind, ownerId, orgId, status: { not: 'REVOKED' } }, orderBy: { createdAt: 'desc' } })
  );
}

export async function markReviewed(id: string, orgId: string, actor: Actor) {
  const c = await load(id, orgId);
  if (!c.needsReviewReason) return c;
  const row = await runInTenant(orgId, () => platformPrisma.credential.update({ where: { id }, data: { needsReviewReason: null } }));
  await recordCredentialEvent(row, 'reviewed', actor, { reason: c.needsReviewReason });
  return row;
}

/* --------------------------------------------------------------- last used */

const LAST_USED_EVERY_MS = 5 * 60 * 1000;
const lastWritten = new Map<string, number>();

/**
 * Stamp last use at most every five minutes per credential (KTD7): readers
 * push constantly, and a write per punch is load for nothing. Fire and forget,
 * inside the credential's company; never slows or fails the request.
 */
export function touchLastUsed(c: Pick<CredentialRow, 'id' | 'orgId'>, ip?: string | null, now = new Date()) {
  const seen = lastWritten.get(c.id);
  if (seen && now.getTime() - seen < LAST_USED_EVERY_MS) return;
  lastWritten.set(c.id, now.getTime());
  if (lastWritten.size > 10_000) lastWritten.clear();
  const before = new Date(now.getTime() - LAST_USED_EVERY_MS);
  void runInTenant(c.orgId, () =>
    platformPrisma.credential.updateMany({
      where: { id: c.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: before } }] },
      data: { lastUsedAt: now, lastUsedIp: ip ?? null },
    })
  ).catch(() => {});
}

/** For tests: forget which credentials were stamped. */
export const __resetLastUsedGate = () => lastWritten.clear();
