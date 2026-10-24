import { randomBytes } from 'node:crypto';
import { prisma } from '../utils/prisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { decryptSecretAnyKey, encryptSecret } from './mailer.js';
import {
  extendCredential,
  hashToken,
  issueCredential,
  liveCredentialOf,
  registerLegacy,
  resumeCredential,
  revokeCredential,
  suspendCredential,
  SYSTEM,
  type Actor,
  type VerifyOptions,
} from './credentials.js';

/**
 * Invoice share links (A-32, Batch 5).
 *
 * A link used to be stored as it is — whoever could read the table could open
 * every customer's invoice — never expired, and was made by anyone who could
 * view invoices. Now it is found by its hash; an encrypted copy lets every
 * reminder send the same address (a customer who kept the first reminder and
 * one who kept the third look at the same page); it expires; making a new one
 * takes permission to edit invoices; and it follows its invoice: cancelled,
 * the link says so; reinstated, the same link works again; a deleted draft's
 * link is revoked.
 *
 * The plaintext column is still written for one release, so an instance
 * running older code during a deploy can still follow a new link (U9 drops it).
 */

const TOKEN_BYTES = 32;
const DAY = 86_400_000;
const LIFE = 90 * DAY;
const MAX_FROM_INVOICE = 2 * 365 * DAY;

type LinkRow = NonNullable<Awaited<ReturnType<typeof prisma.documentShareLink.findUnique>>>;
type InvoiceDates = { date?: unknown; dueDate?: unknown };

const day = (v: unknown) => {
  const d = new Date(String(v || '').slice(0, 10));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** How long a link lives: 90 days past the due date (or the invoice date), never less than 90 days from now, within two years of the invoice (R11). */
export function linkExpiry(inv: InvoiceDates, now = new Date(), current: Date | null = null) {
  const base = day(inv.dueDate) || day(inv.date) || now;
  const cap = Math.max((day(inv.date) || now).getTime() + MAX_FROM_INVOICE, now.getTime() + LIFE);
  const want = Math.max(base.getTime() + LIFE, now.getTime() + LIFE, current?.getTime() ?? 0);
  return new Date(Math.min(want, cap));
}

export const shareKind: VerifyOptions<LinkRow> = {
  legacy: async (hash) => {
    const l = await prisma.documentShareLink.findUnique({ where: { tokenHash: hash } });
    if (!l || l.revokedAt) return null;
    return { ownerId: l.id, accountId: l.accountId, orgId: l.orgId, tokenPrefix: hash.slice(0, 8), createdByUserId: l.createdByUserId, label: `${l.docType} ${l.docId}`, expiresAt: l.expiresAt };
  },
  owner: async (id) => {
    const l = await prisma.documentShareLink.findUnique({ where: { id } });
    return l ? { enabled: !l.revokedAt, hash: l.tokenHash, row: l } : null;
  },
};

/**
 * A link made before A-32 is stored only as plaintext: give it its hash and
 * encrypted copy the first time it is followed or fetched. Its expiry is the
 * kinder of the usual rule and 90 days from now, so a reminder already sent
 * keeps working past the deploy (AE5).
 */
export async function hashLegacyLink(token: string) {
  const l = await outsideTenant('share link: one stored before hashing', () => prisma.documentShareLink.findUnique({ where: { token } }));
  if (!l || l.tokenHash) return l;
  return upgrade(l, token);
}

async function upgrade(l: LinkRow, token: string) {
  const inv = await outsideTenant('share link: its invoice dates', () => prisma.invoice.findFirst({ where: { id: l.docId, orgId: l.orgId }, select: { date: true, dueDate: true } }));
  const expiresAt = linkExpiry(inv || {}, new Date(), l.expiresAt);
  const tokenHash = hashToken(token);
  const row = await outsideTenant('share link: store its hash', () =>
    prisma.documentShareLink.update({ where: { id: l.id }, data: { tokenHash, tokenEnc: encryptSecret(token), expiresAt } })
  );
  if (!row.revokedAt) {
    await registerLegacy('SHARE_LINK', tokenHash, { ownerId: row.id, accountId: row.accountId, orgId: row.orgId, tokenPrefix: tokenHash.slice(0, 8), createdByUserId: row.createdByUserId, label: `${row.docType} ${row.docId}`, expiresAt }, SYSTEM, 'stored before hashing');
  }
  return row;
}

/** The link's token, read back from its encrypted copy (or the plaintext column for one made before A-32). */
function tokenOf(l: LinkRow): { token: string; reencrypt: boolean } | null {
  if (l.tokenEnc) {
    const { plain, stale } = decryptSecretAnyKey(l.tokenEnc);
    if (plain) return { token: plain, reencrypt: stale };
  }
  if (l.token && l.token.length >= 20 && (!l.tokenHash || hashToken(l.token) === l.tokenHash)) return { token: l.token, reencrypt: true };
  return null;
}

export type LinkResult = { token: string; createdAt: Date; expiresAt: Date | null; minted: boolean } | { refused: 'MAY_NOT_MINT' | 'NOT_FOUND' };

/**
 * The invoice's link for a reminder: the live one, extended to 90 days from
 * now; or, when there is none (never made, revoked, expired, unreadable), a
 * new one — only for someone who may edit invoices.
 */
export async function linkForInvoice(
  t: { accountId: string; orgId: string },
  invoiceId: string,
  opts: { mayMint: boolean; actor: Actor & { id: string } }
): Promise<LinkResult> {
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, accountId: t.accountId, orgId: t.orgId }, select: { id: true, date: true, dueDate: true, status: true } });
  if (!invoice) return { refused: 'NOT_FOUND' };
  const now = new Date();
  let existing = await prisma.documentShareLink.findFirst({ where: { accountId: t.accountId, orgId: t.orgId, docType: 'INVOICE', docId: invoice.id } });

  if (existing && !existing.revokedAt) {
    const read = tokenOf(existing);
    if (read && !existing.tokenHash) existing = await upgrade(existing, read.token);
    const cred = read ? await liveCredentialOf('SHARE_LINK', existing.id, t.orgId) : null;
    const expired = !!cred?.expiresAt && cred.expiresAt <= now;
    if (read && cred && !expired) {
      if (read.reencrypt) await prisma.documentShareLink.update({ where: { id: existing.id }, data: { tokenEnc: encryptSecret(read.token) } });
      /* A reminder keeps the link alive: 90 days from now, within its cap (R11). A public GET never does this. */
      const next = linkExpiry(invoice, now, cred.expiresAt);
      if (!cred.expiresAt || next.getTime() > cred.expiresAt.getTime() + DAY) {
        try {
          await extendCredential(cred.id, t.orgId, next, opts.actor, now);
          await prisma.documentShareLink.update({ where: { id: existing.id }, data: { expiresAt: next } });
        } catch {
          /* Further out than an extension may go (a due date far ahead): it keeps the expiry it has. */
        }
      }
      const after = await liveCredentialOf('SHARE_LINK', existing.id, t.orgId);
      return { token: read.token, createdAt: existing.createdAt, expiresAt: after?.expiresAt ?? null, minted: false };
    }
    if (!read) console.error(`[share] ALERT: link ${existing.id} could not be read back with any key; a new one is made`);
  }

  if (!opts.mayMint) return { refused: 'MAY_NOT_MINT' };
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = linkExpiry(invoice, now);
  const old = existing ? await liveCredentialOf('SHARE_LINK', existing.id, t.orgId) : null;
  if (old) await revokeCredential(old.id, t.orgId, opts.actor, 'replaced by a new link');
  const data = { token, tokenHash, tokenEnc: encryptSecret(token), revokedAt: null, expiresAt, createdByUserId: opts.actor.id };
  const row = existing
    ? await prisma.documentShareLink.update({ where: { id: existing.id }, data })
    : await prisma.documentShareLink.create({ data: { accountId: t.accountId, orgId: t.orgId, docType: 'INVOICE', docId: invoice.id, ...data } });
  await issueCredential(
    { kind: 'SHARE_LINK', accountId: t.accountId, orgId: t.orgId, ownerId: row.id, token, tokenPrefix: tokenHash.slice(0, 8), label: `INVOICE ${invoice.id}`, expiresAt, createdByUserId: opts.actor.id },
    opts.actor
  ).catch((e) => console.error('[credentials] share link registered on first use instead:', (e as Error).message));
  return { token, createdAt: row.createdAt, expiresAt, minted: true };
}

/** Revoke the invoice's link: staff asked, or its draft was deleted. */
export async function revokeInvoiceLink(t: { orgId: string }, invoiceId: string, actor: Actor, reason: string) {
  const l = await prisma.documentShareLink.findFirst({ where: { orgId: t.orgId, docType: 'INVOICE', docId: invoiceId } });
  if (!l) return null;
  const cred = await liveCredentialOf('SHARE_LINK', l.id, t.orgId);
  if (cred) await revokeCredential(cred.id, t.orgId, actor, reason);
  return prisma.documentShareLink.update({ where: { id: l.id }, data: { revokedAt: l.revokedAt ?? new Date() } });
}

/**
 * The invoice's status changed. Cancelled: its link is paused (the page says
 * the seller cancelled it) and any payment link still open is cancelled, so a
 * customer cannot pay for an invoice that no longer stands. Reinstated: the
 * same link works again, extended if it ran out meanwhile (AE4).
 */
export async function invoiceStatusChanged(t: { accountId: string; orgId: string }, invoiceId: string, from: string, to: string, actor: Actor) {
  const was = from.toLowerCase() === 'cancelled';
  const now = to.toLowerCase() === 'cancelled';
  if (was === now) return;
  const l = await prisma.documentShareLink.findFirst({ where: { orgId: t.orgId, docType: 'INVOICE', docId: invoiceId, revokedAt: null } });
  const cred = l ? await liveCredentialOf('SHARE_LINK', l.id, t.orgId) : null;
  if (now) {
    if (cred) await suspendCredential(cred.id, t.orgId, actor, 'invoice cancelled');
    const pending = await prisma.paymentRequest.findMany({ where: { orgId: t.orgId, docId: invoiceId, status: 'PENDING' }, select: { id: true } });
    for (const p of pending) await closePayRequest(t.orgId, p.id, actor, 'invoice cancelled');
    return;
  }
  if (cred) {
    if (cred.expiresAt && cred.expiresAt <= new Date()) {
      const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, orgId: t.orgId }, select: { date: true, dueDate: true } });
      const next = linkExpiry(inv || {}, new Date(), null);
      await extendCredential(cred.id, t.orgId, next, actor);
      await prisma.documentShareLink.update({ where: { id: l!.id }, data: { expiresAt: next } });
    }
    await resumeCredential(cred.id, t.orgId, actor, 'invoice reinstated');
  }
}

/* --------------------------------------------------------------- pay links */

type PayRow = NonNullable<Awaited<ReturnType<typeof prisma.paymentRequest.findUnique>>>;

/**
 * A payment link's own state decides what its page shows: a paid or claimed
 * request still shows "paid" after its date or after the link is closed (R12);
 * only a pending one can be claimed, and only while the link is usable.
 */
export const payKind: VerifyOptions<PayRow> = {
  legacy: async (hash) => {
    const r = await prisma.paymentRequest.findUnique({ where: { tokenHash: hash } });
    if (!r) return null;
    return { ownerId: r.id, accountId: r.accountId, orgId: r.orgId, tokenPrefix: r.tokenPrefix, createdByUserId: r.createdByUserId, label: r.docNumber ? `Invoice ${r.docNumber}` : 'Payment', expiresAt: r.expiresAt };
  },
  owner: async (id) => {
    const r = await prisma.paymentRequest.findUnique({ where: { id } });
    return r ? { enabled: r.status !== 'CANCELLED', hash: r.tokenHash, row: r } : null;
  },
};

export async function registerPayLink(r: PayRow, token: string, actor: Actor) {
  await issueCredential(
    { kind: 'PAY_LINK', accountId: r.accountId, orgId: r.orgId, ownerId: r.id, token, tokenPrefix: r.tokenPrefix, label: r.docNumber ? `Invoice ${r.docNumber}` : 'Payment', expiresAt: r.expiresAt, createdByUserId: r.createdByUserId },
    actor
  ).catch((e) => console.error('[credentials] pay link registered on first use instead:', (e as Error).message));
}

/** Cancel a pending payment request and close its link (registry first). Paid ones are left alone. */
export async function closePayRequest(orgId: string, id: string, actor: Actor, reason: string) {
  const r0 = await prisma.paymentRequest.findFirst({ where: { id, orgId }, select: { status: true } });
  if (r0?.status !== 'PENDING') return 0;
  const cred = await liveCredentialOf('PAY_LINK', id, orgId);
  if (cred) await revokeCredential(cred.id, orgId, actor, reason);
  const r = await prisma.paymentRequest.updateMany({ where: { id, orgId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
  return r.count;
}


/** At deploy: give every link stored before A-32 its hash and encrypted copy (KTD11). */
export async function hashAllLegacyLinks() {
  let n = 0;
  for (;;) {
    const rows = await prisma.documentShareLink.findMany({ where: { tokenHash: null }, take: 200, orderBy: { id: 'asc' } });
    if (!rows.length) break;
    for (const l of rows) {
      await upgrade(l, l.token);
      n += 1;
    }
  }
  return n;
}
