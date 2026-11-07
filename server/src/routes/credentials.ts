import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { prisma } from '../utils/prisma.js';
import { recordAudit } from '../services/auditTrail.js';
import { appLive } from '../services/principalAllowed.js';
import {
  CredentialError,
  actorFrom,
  effectiveStatus,
  extendCredential,
  markReviewed,
  resumeCredential,
  revokeCredential,
  suspendCredential,
  type Owner,
} from '../services/credentials.js';
import { agentKind, apiKeyKind, devicePushKind } from '../services/credentialKinds.js';
import { scimKind, revokeScimToken, rotateScimToken } from '../services/scimTokens.js';
import { createApiKey, revokeApiKey, rotateApiKey } from '../services/apiKeys.js';
import { SCOPES } from './publicApi.js';
import { scopeRefusal } from '../services/apiKeyScopes.js';
import { automaticRoleRefusal } from '../services/roleGuards.js';
import { stepUpIfHeld } from '../services/stepUp.js';
import { permKey } from '../constants/permissionCatalog.js';

/**
 * Workspace → Credentials (Batch 5, R18): every key and token other
 * systems hold for this company, in one list, with what each can do now and
 * why not. API keys are made here (they used to live under Attendance →
 * Integrations). Connectors and readers are still set up on their Attendance
 * screens — they need settings only those screens have — but are listed,
 * paused and revoked here like the rest. Directory-sync tokens add people, so
 * they are shown and changed only for someone who may manage users.
 * Customer links (invoice shares, payment links) are counted, not listed: a
 * list would show customers and amounts to someone with no sales access.
 */
export const credentialsRouter = Router();
credentialsRouter.use(requireAuth, requireTenantContext);

const MODULE = 'SETTINGS';
const RESOURCE = 'Credentials';
const can = (action: string) => requirePermission(MODULE, action as any, RESOURCE);
const base = '/orgs/:orgId/credentials';
const MACHINE = ['SCIM', 'API_KEY', 'AGENT', 'DEVICE_PUSH'];

const orgOk = (req: Request, res: Response) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};
const allowed = async (req: Request, module: string, action: string, resource: string) => !(await authorize(req, module, action as any, resource));

/** Directory-sync tokens are user provisioning: seen with Users::VIEW, changed with Users::EDIT (KTD12). */
const scimVisible = (req: Request) => allowed(req, MODULE, PermissionAction.VIEW, 'Users');
const scimEditable = (req: Request) => allowed(req, MODULE, PermissionAction.EDIT, 'Users');

const failed = (res: Response, e: unknown) => {
  if (e instanceof CredentialError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

async function ownerOf(c: { kind: string; ownerId: string; orgId: string }): Promise<(Owner & { row?: any }) | null> {
  const cr = c as any;
  switch (c.kind) {
    case 'API_KEY':
      return apiKeyKind.owner(c.ownerId, cr);
    case 'AGENT':
      return agentKind.owner(c.ownerId, cr);
    case 'DEVICE_PUSH': {
      const d = await peoplePrisma.attendanceDevice.findUnique({ where: { id: c.ownerId }, select: { vendor: true } });
      return d ? devicePushKind(d.vendor).owner(c.ownerId, cr) : null;
    }
    case 'SCIM':
      return scimKind.owner(c.ownerId, cr);
    default:
      return null;
  }
}

/** Where a credential is set up, for the "owner" column and the link to it. */
function ownerLabel(kind: string, row: any) {
  if (!row) return { name: 'Removed', where: null };
  if (kind === 'API_KEY') return { name: row.name, where: null };
  if (kind === 'AGENT') return { name: row.name, where: { app: 'attendance', screen: 'integrations' } };
  if (kind === 'DEVICE_PUSH') return { name: row.name, where: { app: 'attendance', screen: 'devices' } };
  return { name: 'Directory sync', where: { app: 'admin', screen: 'sso' } };
}

credentialsRouter.get(base, can(PermissionAction.VIEW), async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const kinds = (await scimVisible(req)) ? MACHINE : MACHINE.filter((k) => k !== 'SCIM');
  const showRevoked = String(req.query.revoked || '') === '1';
  const rows = await platformPrisma.credential.findMany({
    where: { orgId, accountId, kind: { in: kinds }, ...(showRevoked ? {} : { status: { not: 'REVOKED' } }) },
    orderBy: [{ createdAt: 'desc' }],
    take: 500,
  });
  const userIds = [...new Set(rows.map((r) => r.createdByUserId).filter((x): x is string => !!x))];
  const users = userIds.length ? await platformPrisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.fullName || u.email]));
  const now = new Date();
  const list = await Promise.all(
    rows.map(async (c) => {
      const owner = await ownerOf(c);
      const eff = await effectiveStatus(c, owner, now);
      const scopes = c.kind === 'API_KEY' && owner?.row ? String(owner.row.scopes || '').split(',').filter(Boolean) : undefined;
      return {
        id: c.id,
        kind: c.kind,
        label: c.label,
        tokenPrefix: c.tokenPrefix,
        status: c.status,
        effective: eff.usable ? 'ACTIVE' : eff.block,
        expiresAt: c.expiresAt,
        lastUsedAt: c.lastUsedAt,
        createdAt: c.createdAt,
        createdBy: c.createdByUserId ? nameOf.get(c.createdByUserId) || 'Someone no longer here' : null,
        needsReviewReason: c.needsReviewReason,
        owner: ownerLabel(c.kind, owner?.row),
        ...(scopes ? { scopes } : {}),
      };
    })
  );
  /* Needs review first, then the soonest to expire. */
  list.sort((a, b) => Number(!!b.needsReviewReason) - Number(!!a.needsReviewReason) || (a.expiresAt ? +a.expiresAt : Infinity) - (b.expiresAt ? +b.expiresAt : Infinity));
  const links = (await allowed(req, 'SALES', PermissionAction.VIEW, 'Invoices'))
    ? {
        shareLinks: await prisma.documentShareLink.count({ where: { orgId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
        payLinks: await prisma.paymentRequest.count({ where: { orgId, status: 'PENDING' } }),
      }
    : null;
  const attendance = await appLive(accountId, orgId, 'attendance');
  res.json({
    credentials: list,
    links,
    scopes: SCOPES,
    mayCreateApiKey: !attendance,
    createBlockedReason: attendance ? 'API keys work only while Attendance is on for this company.' : null,
    closing: list.some((c) => c.effective === 'COMPANY_CLOSING'),
  });
});

const ipList = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .refine((v) => !v || v.split(',').every((ip) => /^[0-9a-fA-F:.]{3,45}$/.test(ip.trim())), 'Addresses are IPs, separated by commas.');

const expiry = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime()) || d <= new Date() || d.getTime() > Date.now() + 366 * 864e5) {
      ctx.addIssue({ code: 'custom', message: 'An expiry must be a date in the future, at most a year away.' });
      return z.NEVER;
    }
    return d;
  });

/** A new API key, shown once. */
credentialsRouter.post(`${base}/api-keys`, can(PermissionAction.CREATE), async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const refused = await appLive(accountId, orgId, 'attendance');
  if (refused) return res.status(409).json({ error: 'API keys work only while Attendance is on for this company.', code: refused.code });
  const p = z
    .object({ name: z.string().trim().min(1, 'Name the key after what uses it.').max(80), scopes: z.array(z.enum(SCOPES)).min(1, 'Choose what the key may do.'), allowedIps: ipList, expiresAt: expiry })
    .safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the details.' });
  /* #10: a key does only what its maker could do themselves. */
  const scopeRefused = await scopeRefusal(req, p.data.scopes, permKey(MODULE, RESOURCE, PermissionAction.CREATE));
  if (scopeRefused) return res.status(scopeRefused.status).json(scopeRefused.body);
  const { key, token, credential } = await createApiKey({ accountId, orgId }, p.data, { ...actorFrom(req), id: req.auth!.userId });
  await recordAudit(req, { entity: 'Credential', entityId: credential?.id || key.id, action: 'CREATE', message: `Made the API key “${key.name}”`, metadata: { scopes: p.data.scopes, expiresAt: credential?.expiresAt ?? null } });
  res.status(201).json({ token, credentialId: credential?.id ?? null, note: 'Shown once — copy it now. Only a hash is kept.' });
});

/** The credential a change is about, checked for this company and — for SCIM — for user management. */
async function target(req: Request, res: Response) {
  if (!orgOk(req, res)) return null;
  const c = await platformPrisma.credential.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId, kind: { in: MACHINE } } });
  if (!c) {
    res.status(404).json({ error: 'No such credential.' });
    return null;
  }
  if (c.kind === 'SCIM' && !(await scimEditable(req))) {
    res.status(403).json({ error: 'Directory-sync tokens add people to CLOR: changing one needs permission to edit users.', code: 'NEEDS_USERS_EDIT' });
    return null;
  }
  return c;
}

const reasonOf = (req: Request) => (req.body?.reason ? String(req.body.reason).slice(0, 200) : null);
const audit = (req: Request, c: { id: string; kind: string; tokenPrefix: string }, action: string, words: string) =>
  recordAudit(req, { entity: 'Credential', entityId: c.id, action, message: `${words} ${c.kind.replace('_', ' ').toLowerCase()} ${c.tokenPrefix}…`, metadata: { reason: reasonOf(req) } });

credentialsRouter.post(`${base}/:id/suspend`, can(PermissionAction.EDIT), async (req, res) => {
  const c = await target(req, res);
  if (!c) return;
  try {
    await suspendCredential(c.id, c.orgId, actorFrom(req), reasonOf(req));
    await audit(req, c, 'SUSPEND', 'Paused');
    res.json({ ok: true });
  } catch (e) {
    failed(res, e);
  }
});

credentialsRouter.post(`${base}/:id/resume`, can(PermissionAction.EDIT), async (req, res) => {
  const c = await target(req, res);
  if (!c) return;
  try {
    await resumeCredential(c.id, c.orgId, actorFrom(req), reasonOf(req));
    await audit(req, c, 'RESUME', 'Resumed');
    res.json({ ok: true });
  } catch (e) {
    failed(res, e);
  }
});

credentialsRouter.post(`${base}/:id/extend`, can(PermissionAction.EDIT), async (req, res) => {
  const c = await target(req, res);
  if (!c) return;
  const until = new Date(String(req.body?.expiresAt || ''));
  try {
    const row = await extendCredential(c.id, c.orgId, until, actorFrom(req));
    await audit(req, c, 'EXTEND', 'Extended');
    res.json({ ok: true, expiresAt: row.expiresAt });
  } catch (e) {
    failed(res, e);
  }
});

credentialsRouter.post(`${base}/:id/review`, can(PermissionAction.EDIT), async (req, res) => {
  const c = await target(req, res);
  if (!c) return;
  await markReviewed(c.id, c.orgId, actorFrom(req));
  await audit(req, c, 'REVIEW', 'Marked reviewed');
  res.json({ ok: true });
});

/**
 * Rotate: a new token, the old one stops at once. API keys and stand-alone
 * directory-sync tokens are shown once here; an agent's directory-sync token
 * goes to the agent. Connectors and readers rotate on their Attendance
 * screens, where the new address or token is installed.
 */
credentialsRouter.post(`${base}/:id/rotate`, can(PermissionAction.EDIT), async (req, res) => {
  const c = await target(req, res);
  if (!c) return;
  const t = { accountId: req.tenant!.accountId, orgId: c.orgId };
  /*
   * #2, #10: a rotation hands out a working token with everything the old one
   * could do, so whoever rotates must be able to make it afresh.
   */
  if (c.kind === 'API_KEY') {
    const k = await peoplePrisma.apiClient.findFirst({ where: { id: c.ownerId, orgId: c.orgId }, select: { scopes: true } });
    const refused = await scopeRefusal(req, String(k?.scopes || '').split(',').filter(Boolean), permKey(MODULE, RESOURCE, PermissionAction.EDIT));
    if (refused) return res.status(refused.status).json(refused.body);
  }
  if (c.kind === 'SCIM') {
    const s = await platformPrisma.scimToken.findFirst({ where: { id: c.ownerId, orgId: c.orgId }, select: { defaultRoleId: true } });
    /* A role since deleted is simply not given (routes/scim.ts checks at each provision), so only a live one is bounded here. */
    const roleRefused = await automaticRoleRefusal(req, s?.defaultRoleId);
    const refused = (roleRefused?.body.code === 'FOREIGN_ROLE' ? null : roleRefused) || (await stepUpIfHeld(req, 'Enter the code from your authenticator app to rotate a directory-sync token.'));
    if (refused) return res.status(refused.status).json(refused.body);
  }
  try {
    if (c.kind === 'API_KEY') {
      const r = await rotateApiKey(t, c.ownerId, actorFrom(req), reasonOf(req));
      await audit(req, c, 'ROTATE', 'Rotated');
      return res.json({ token: r.token, credentialId: r.credential.id, note: 'Rotated — the previous key no longer works. Shown once.' });
    }
    if (c.kind === 'SCIM') {
      const r = await rotateScimToken(c.orgId, c.ownerId, actorFrom(req), reasonOf(req));
      /*
       * Review B1, N-c: the person rotating answers for its role from now on;
       * provisioning checks against them. Recorded only once the rotation has
       * gone through, so a failed one leaves the token answering to whoever
       * it did before.
       */
      await platformPrisma.scimToken.update({ where: { id: c.ownerId }, data: { createdByUserId: req.auth!.userId } });
      await audit(req, c, 'ROTATE', 'Rotated');
      return res.json({ token: r.token, credentialId: r.credential.id, sentToAgent: !!r.agentId, note: r.token ? 'Rotated — paste the new token into your identity provider. Shown once.' : 'Rotated — the connector picks up the new token on its next check-in.' });
    }
    return res.status(409).json({ error: c.kind === 'AGENT' ? 'Rotate a connector’s token under Attendance → Integrations, where it is reinstalled.' : 'Make a new push address for a reader under Attendance → Readers, where it is set up.', code: 'ROTATE_ELSEWHERE' });
  } catch (e) {
    failed(res, e);
  }
});

/** Revoke: final. Written to the registry first, then to where older code looks (KTD4). */
credentialsRouter.post(`${base}/:id/revoke`, can(PermissionAction.EDIT), async (req, res) => {
  const c = await target(req, res);
  if (!c) return;
  const t = { accountId: req.tenant!.accountId, orgId: c.orgId };
  try {
    if (c.kind === 'API_KEY') await revokeApiKey(t, c.ownerId, actorFrom(req), reasonOf(req));
    else if (c.kind === 'SCIM') await revokeScimToken(c.orgId, c.ownerId, actorFrom(req), reasonOf(req));
    else await revokeCredential(c.id, c.orgId, actorFrom(req), reasonOf(req));
    await audit(req, c, 'REVOKE', 'Revoked');
    res.json({ ok: true });
  } catch (e) {
    failed(res, e);
  }
});
