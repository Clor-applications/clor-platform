import { Router, type Request, type Response, type NextFunction } from 'express';
import { anyAppLive, appLive } from '../services/principalAllowed.js';
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';

import { platformPrisma } from '../utils/platformPrisma.js';
import { recordAuthEvent, clientIp } from '../services/auth.js';
import { notifyPermission } from '../services/notifications.js';
import { LAST_ADMIN_ERROR, automaticRoleUsable, userIsAdmin, wouldRemoveLastAdmin } from '../services/roleGuards.js';
import { ACCOUNT_ADMINS } from '../services/accountMembership.js';
import { domainRefusalFor } from '../services/policy.js';
import { outsideTenant, enterTenant } from '../utils/tenantScope.js';
import { verifyCredential, touchLastUsed } from '../services/credentials.js';
import { scimKind } from '../services/scimTokens.js';
import { flagCreatorRemoved } from '../services/credentialReview.js';
import { ensureAccountMembership } from '../services/accountMembership.js';

/**
 * /scim/v2 — SCIM 2.0 provisioning (RFC 7643 / 7644), the way Microsoft
 * Entra, Okta, JumpCloud and Google provision users into an application. One
 * bearer token per organisation (Settings → Single sign-on → Directory sync);
 * the provider creates, updates, deactivates and removes users here, and CLOR
 * keeps roles and company access its own. Groups are not provisioned: roles
 * are assigned in CLOR.
 *
 * A user is the platform user; membership of the token's organisation is what
 * the provider manages. `active: false` switches the login off only for a
 * user that belongs to this account (never a person another company owns).
 */
export const scimRouter = Router();

const SCHEMA_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCHEMA_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCHEMA_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const SCHEMA_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

const scim = (res: Response, status: number, body: unknown) => res.status(status).type('application/scim+json').send(JSON.stringify(body));
const fail = (res: Response, status: number, detail: string, scimType?: string) => scim(res, status, { schemas: [SCHEMA_ERROR], status: String(status), detail, ...(scimType ? { scimType } : {}) });

type Tenant = { id: string; accountId: string; orgId: string; defaultRoleId: string | null; createdByUserId: string | null };
declare module 'express-serve-static-core' {
  interface Request {
    scim?: Tenant;
  }
}

/** Bearer token → the organisation it provisions. */
scimRouter.use(async (req: Request, res: Response, next: NextFunction) => {
  const m = /^Bearer\s+(clors_[A-Za-z0-9_-]{20,})$/i.exec(String(req.headers.authorization || ''));
  if (!m) return fail(res, 401, 'A bearer token from CLOR’s directory-sync settings is required.');
  /* Batch 5 (A-31): the registry, the token's row and — for an agent's token — the agent must all allow it. */
  const v = await verifyCredential('SCIM', m[1], scimKind);
  if (!v.ok) {
    if (v.block === 'COMPANY_CLOSING') return fail(res, 403, 'This company is being closed; directory sync is switched off.');
    if (v.block === 'SUSPENDED') return fail(res, 403, 'This directory-sync token is paused in CLOR.');
    if (v.block === 'EXPIRED') return fail(res, 401, 'This directory-sync token has expired. Make a new one in CLOR and paste it into your identity provider.');
    if (v.block === 'PARENT_OFF') return fail(res, 403, 'The connector this token belongs to is switched off in CLOR.');
    return fail(res, 401, 'That token is not known (revoked, or made for another server).');
  }
  const t = v.row;
  req.scim = { id: t.id, accountId: t.accountId, orgId: t.orgId, defaultRoleId: t.defaultRoleId, createdByUserId: t.createdByUserId ?? null };
  /* A-30: the rest of this request runs as the company the token named — the last-used stamp included (A-35). */
  enterTenant(t.orgId);
  if (v.credential.expiresAt) res.setHeader('X-Clor-Credential-Expires', v.credential.expiresAt.toISOString());
  touchLastUsed(v.credential, String(req.ip || '') || null);
  platformPrisma.scimToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  next();
});

const base = (req: Request) => `${process.env.API_PUBLIC_URL || process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`}/scim/v2`;

type U = { id: string; email: string; fullName: string; isActive: boolean; accountId: string; createdAt: Date; updatedAt: Date };

const splitName = (fullName: string) => {
  const parts = fullName.trim().split(/\s+/);
  return { givenName: parts[0] || '', familyName: parts.slice(1).join(' ') };
};

const resource = (req: Request, u: U) => ({
  schemas: [SCHEMA_USER],
  id: u.id,
  userName: u.email,
  name: { ...splitName(u.fullName), formatted: u.fullName },
  displayName: u.fullName,
  emails: [{ value: u.email, type: 'work', primary: true }],
  active: u.isActive,
  meta: { resourceType: 'User', created: u.createdAt.toISOString(), lastModified: u.updatedAt.toISOString(), location: `${base(req)}/Users/${u.id}` },
});

const SELECT = { id: true, email: true, fullName: true, isActive: true, accountId: true, createdAt: true, updatedAt: true } as const;

/** A member of this organisation, by platform user id. */
async function memberById(t: Tenant, id: string): Promise<U | null> {
  const m = await platformPrisma.userOrgMembership.findFirst({ where: { orgId: t.orgId, userId: id }, select: { userId: true } });
  if (!m) return null;
  return platformPrisma.user.findUnique({ where: { id: m.userId }, select: SELECT });
}

/** `userName eq "x"`, `emails eq "x"`, `externalId eq "x"` — what providers send to look somebody up before creating them. */
export function parseFilter(filter: string | undefined): { attr: string; value: string } | null {
  if (!filter) return null;
  const m = /^\s*([\w.]+)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  if (!m) return null;
  return { attr: m[1].toLowerCase(), value: m[2].replace(/\\"/g, '"') };
}

const nameOf = (body: any, fallback: string) => {
  const n = body?.name || {};
  const full = String(n.formatted || `${n.givenName || ''} ${n.familyName || ''}`.trim() || body?.displayName || fallback).trim();
  return full.slice(0, 120);
};
const emailOf = (body: any) => {
  const primary = Array.isArray(body?.emails) ? body.emails.find((e: any) => e?.primary) || body.emails[0] : null;
  return String(body?.userName || primary?.value || '').trim().toLowerCase();
};
const activeOf = (v: unknown, dflt: boolean) => (v === undefined || v === null ? dflt : typeof v === 'string' ? !/^(false|0|no)$/i.test(v) : Boolean(v));

/* ----------------------------------------------------------------- discovery */

scimRouter.get('/ServiceProviderConfig', (req, res) =>
  scim(res, 200, {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://app.clor.in/docs/scim',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'A token made under Settings → Single sign-on → Directory sync.' }],
    meta: { resourceType: 'ServiceProviderConfig', location: `${base(req)}/ServiceProviderConfig` },
  }),
);

scimRouter.get('/ResourceTypes', (req, res) =>
  scim(res, 200, {
    schemas: [SCHEMA_LIST],
    totalResults: 1,
    Resources: [{ schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'User', name: 'User', endpoint: '/Users', schema: SCHEMA_USER, meta: { resourceType: 'ResourceType', location: `${base(req)}/ResourceTypes/User` } }],
  }),
);

scimRouter.get('/Schemas', (req, res) =>
  scim(res, 200, {
    schemas: [SCHEMA_LIST],
    totalResults: 1,
    Resources: [
      {
        id: SCHEMA_USER,
        name: 'User',
        description: 'A person who can sign in to CLOR',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'server' },
          { name: 'name', type: 'complex', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', subAttributes: [{ name: 'givenName', type: 'string' }, { name: 'familyName', type: 'string' }, { name: 'formatted', type: 'string' }] },
          { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
          { name: 'emails', type: 'complex', multiValued: true, required: false, mutability: 'readWrite', returned: 'default' },
          { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
        ],
        meta: { resourceType: 'Schema', location: `${base(req)}/Schemas/${SCHEMA_USER}` },
      },
    ],
  }),
);

/* ---------------------------------------------------------------------- users */

scimRouter.get('/Users', async (req, res) => {
  const t = req.scim!;
  const f = parseFilter(req.query.filter ? String(req.query.filter) : undefined);
  if (req.query.filter && !f) return fail(res, 400, 'Only filters of the form attribute eq "value" are supported.', 'invalidFilter');
  const startIndex = Math.max(1, Number(req.query.startIndex) || 1);
  const count = Math.min(200, Math.max(0, Number(req.query.count ?? 100)));
  if (f && f.attr === 'externalid') return scim(res, 200, { schemas: [SCHEMA_LIST], totalResults: 0, startIndex, itemsPerPage: 0, Resources: [] });
  const where: any = { orgId: t.orgId };
  if (f) {
    if (!['username', 'emails', 'emails.value'].includes(f.attr)) return fail(res, 400, `Filtering on ${f.attr} is not supported.`, 'invalidFilter');
    where.user = { email: f.value.toLowerCase() };
  }
  const [total, rows] = await Promise.all([
    platformPrisma.userOrgMembership.count({ where }),
    platformPrisma.userOrgMembership.findMany({ where, orderBy: { id: 'asc' }, skip: startIndex - 1, take: count, select: { user: { select: SELECT } } }),
  ]);
  scim(res, 200, { schemas: [SCHEMA_LIST], totalResults: total, startIndex, itemsPerPage: rows.length, Resources: rows.map((r) => resource(req, r.user as U)) });
});

scimRouter.get('/Users/:id', async (req, res) => {
  const u = await memberById(req.scim!, String(req.params.id));
  if (!u) return fail(res, 404, 'No such user in this organisation.');
  scim(res, 200, resource(req, u));
});

scimRouter.post('/Users', async (req, res) => {
  const t = req.scim!;
  const body = req.body || {};
  const email = emailOf(body);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'userName must be the person’s e-mail address.', 'invalidValue');
  const fullName = nameOf(body, email.split('@')[0]);
  const active = activeOf(body.active, true);
  const ip = clientIp(req);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 200);

  /* #4: the company's allowed email domains bind its directory as well as its administrators. */
  const domainRefused = await domainRefusalFor([t.orgId], email);
  if (domainRefused) return fail(res, 400, domainRefused, 'invalidValue');

  let user = await platformPrisma.user.findFirst({ where: { email }, select: SELECT });
  /* A person of another CLOR account is theirs: neither attached nor described here. Invite them instead. */
  if (user && user.accountId !== t.accountId) return fail(res, 409, `${email} already has a CLOR login under another account; invite them from Settings → Users instead.`, 'uniqueness');
  if (user) {
    const member = await platformPrisma.userOrgMembership.findFirst({ where: { orgId: t.orgId, userId: user.id }, select: { id: true } });
    if (member) return fail(res, 409, `${email} is already a user of this organisation.`, 'uniqueness');
    await platformPrisma.userOrgMembership.create({ data: { accountId: t.accountId, orgId: t.orgId, userId: user.id } });
  } else {
    user = await platformPrisma.user.create({
      data: { accountId: t.accountId, email, fullName, isActive: active, passwordHash: await bcrypt.hash(randomBytes(32).toString('base64url'), 10), emailVerifiedAt: new Date() },
      select: SELECT,
    });
    await platformPrisma.userOrgMembership.create({ data: { accountId: t.accountId, orgId: t.orgId, userId: user.id } });
    await ensureAccountMembership(t.accountId, user.id);
  }
  /*
   * #2: the token's role, checked again now — still this company's, still not
   * an administrator's, and still within what the token's maker holds. If not,
   * the person arrives with no role and an administrator assigns one.
   */
  const roleGiven = await automaticRoleUsable(t.accountId, t.orgId, t.defaultRoleId, t.createdByUserId);
  if (roleGiven) {
    await platformPrisma.userRoleAssignment.create({ data: { accountId: t.accountId, orgId: t.orgId, userId: user.id, roleId: t.defaultRoleId!, createdByUserId: t.createdByUserId || user.id } }).catch(() => {});
  }
  await recordAuthEvent({ accountId: t.accountId, userId: user.id, email, eventType: 'USER_PROVISIONED', ip, userAgent, detail: t.defaultRoleId && !roleGiven ? 'SCIM directory sync; the token’s role was not given (no longer allowed)' : 'SCIM directory sync' });
  await notifyPermission(t.accountId, t.orgId, 'SETTINGS::Users::EDIT', { kind: 'scim.user', title: `${fullName} (${email}) was added by directory sync`, body: roleGiven ? 'With the role chosen for directory sync.' : 'With no role yet: assign one under Settings → Users.', link: { app: 'accounting', screen: 'settingsUsers' } });
  res.setHeader('Location', `${base(req)}/Users/${user.id}`);
  scim(res, 201, resource(req, user));
});

/**
 * #1: people a directory-sync token never switches off or removes — an owner
 * or administrator of the account (ACCOUNT_ADMINS, review S4), and anyone who
 * administers this company. The token is not
 * an administrator, so the Users route's rule ("an administrator only by an
 * administrator") leaves them out of its reach entirely.
 */
async function protectedFromDirectory(t: Tenant, userId: string) {
  const leader = await platformPrisma.accountMembership.findFirst({ where: { accountId: t.accountId, userId, role: { in: ACCOUNT_ADMINS } }, select: { id: true } });
  return Boolean(leader) || (await userIsAdmin(t.accountId, t.orgId, userId));
}

/** What a replace or a patch may change, applied the same way. */
async function applyChanges(t: Tenant, u: U, changes: { email?: string; fullName?: string; active?: boolean }) {
  const data: any = {};
  /* Another account's person: this provider may drop their membership, never change who they are. */
  const touches = (changes.email && changes.email !== u.email) || (changes.fullName && changes.fullName !== u.fullName) || (changes.active !== undefined && changes.active !== u.isActive);
  if (touches && u.accountId !== t.accountId) throw Object.assign(new Error('This person belongs to another account; only their membership here can be removed.'), { status: 403 });
  /*
   * A-01: a directory token speaks for one company, but an email or being
   * switched off reaches every company the person signs in to. So it may
   * change those only for people who work in this company alone and do not
   * administer it — never for an owner who would lose their other companies
   * to whoever holds the token.
   */
  const identity = (changes.email && changes.email !== u.email) || (changes.active !== undefined && changes.active !== u.isActive);
  if (identity) {
    const elsewhere = await outsideTenant('SCIM: does this person work in other companies?', () =>
      platformPrisma.userOrgMembership.count({ where: { userId: u.id, NOT: { orgId: t.orgId } } }),
    );
    if (elsewhere || (await protectedFromDirectory(t, u.id))) {
      throw Object.assign(new Error('This person administers this company or works in others; their sign-in is changed in CLOR, not by directory sync.'), { status: 403, scimType: 'mutability' });
    }
  }
  if (changes.email && changes.email !== u.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email)) throw Object.assign(new Error('userName must be an e-mail address.'), { status: 400, scimType: 'invalidValue' });
    const domainRefused = await domainRefusalFor([t.orgId], changes.email);
    if (domainRefused) throw Object.assign(new Error(domainRefused), { status: 400, scimType: 'invalidValue' });
    if (await platformPrisma.user.findFirst({ where: { email: changes.email, NOT: { id: u.id } }, select: { id: true } })) throw Object.assign(new Error(`${changes.email} is already another user’s address.`), { status: 409, scimType: 'uniqueness' });
    data.email = changes.email;
    /* An address nobody has proven yet: the directory says so, the person has not. */
    data.emailVerifiedAt = null;
  }
  if (changes.fullName && changes.fullName !== u.fullName) data.fullName = changes.fullName;
  if (changes.active !== undefined && changes.active !== u.isActive) {
    /* Only a person of this account is switched on or off; another company's user keeps their login. */
    if (u.accountId !== t.accountId) throw Object.assign(new Error('This person belongs to another account; only their membership here can be removed.'), { status: 403 });
    data.isActive = changes.active;
    if (!changes.active) data.lockedUntil = null;
  }
  if (!Object.keys(data).length) return u;
  const next = await platformPrisma.user.update({ where: { id: u.id }, data, select: SELECT });
  /* Batch 5: switched off by the directory — what they made is flagged for review, by this token. */
  if (data.isActive === false) await flagCreatorRemoved({ accountId: t.accountId, userId: u.id, orgIds: 'ALL' }, 'The person who made it was switched off by directory sync', { type: 'SCIM', id: t.id });
  await recordAuthEvent({ accountId: t.accountId, userId: u.id, email: next.email, eventType: data.isActive === false ? 'USER_DEACTIVATED' : data.isActive === true ? 'USER_REACTIVATED' : 'USER_UPDATED', detail: `SCIM directory sync: ${Object.keys(data).filter((k) => k !== 'lockedUntil').join(', ')}` });
  return next;
}

const withErrors = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (e: any) {
    if (e?.status) return fail(res, e.status, String(e.message), e.scimType);
    console.error('[scim]', e instanceof Error ? e.message : e);
    fail(res, 500, 'Something went wrong on CLOR’s side.');
  }
};

scimRouter.put(
  '/Users/:id',
  withErrors(async (req, res) => {
    const t = req.scim!;
    const u = await memberById(t, String(req.params.id));
    if (!u) return fail(res, 404, 'No such user in this organisation.');
    const body = req.body || {};
    const next = await applyChanges(t, u, { email: emailOf(body) || undefined, fullName: body.name || body.displayName ? nameOf(body, u.fullName) : undefined, active: body.active === undefined ? undefined : activeOf(body.active, u.isActive) });
    scim(res, 200, resource(req, next));
  }),
);

scimRouter.patch(
  '/Users/:id',
  withErrors(async (req, res) => {
    const t = req.scim!;
    const u = await memberById(t, String(req.params.id));
    if (!u) return fail(res, 404, 'No such user in this organisation.');
    const body = req.body || {};
    if (!Array.isArray(body.Operations) || (Array.isArray(body.schemas) && !body.schemas.includes(SCHEMA_PATCH))) return fail(res, 400, 'A PatchOp with Operations is required.', 'invalidSyntax');
    const changes: { email?: string; fullName?: string; active?: boolean } = {};
    let given = splitName(u.fullName).givenName;
    let family = splitName(u.fullName).familyName;
    let nameTouched = false;
    for (const op of body.Operations) {
      const kind = String(op?.op || '').toLowerCase();
      if (kind === 'remove') continue;
      const path = String(op?.path || '').toLowerCase().replace(/^urn:ietf:params:scim:schemas:core:2\.0:user:/, '');
      const value = op?.value;
      /* Entra sends `path: "active", value: "False"`; Okta sends `value: { active: false }` without a path. */
      const set = (key: string, v: unknown) => {
        if (key === 'active') changes.active = activeOf(v, u.isActive);
        else if (key === 'username') changes.email = String(v || '').trim().toLowerCase();
        else if (key === 'name.givenname') (given = String(v || '')), (nameTouched = true);
        else if (key === 'name.familyname') (family = String(v || '')), (nameTouched = true);
        else if (key === 'name.formatted' || key === 'displayname') (changes.fullName = String(v || '').slice(0, 120)), (nameTouched = false);
        else if (key === 'name' && v && typeof v === 'object') {
          if ((v as any).formatted) (changes.fullName = String((v as any).formatted).slice(0, 120)), (nameTouched = false);
          else {
            if ((v as any).givenName !== undefined) given = String((v as any).givenName);
            if ((v as any).familyName !== undefined) family = String((v as any).familyName);
            nameTouched = true;
          }
        } else if (key === 'emails' || key.startsWith('emails[')) {
          const e = Array.isArray(v) ? v.find((x: any) => x?.primary) || v[0] : v;
          const addr = typeof e === 'string' ? e : e?.value;
          if (addr) changes.email = String(addr).trim().toLowerCase();
        }
      };
      if (path) set(path, value);
      else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) set(k.toLowerCase(), v);
    }
    if (nameTouched) changes.fullName = `${given} ${family}`.trim().slice(0, 120) || u.fullName;
    const next = await applyChanges(t, u, changes);
    scim(res, 200, resource(req, next));
  }),
);

scimRouter.delete(
  '/Users/:id',
  withErrors(async (req, res) => {
    const t = req.scim!;
    const u = await memberById(t, String(req.params.id));
    if (!u) return fail(res, 404, 'No such user in this organisation.');
    /*
     * #1: the same guards as removing someone under Users. A token is not an
     * administrator, so it never removes one — nor an owner of the account,
     * nor (by construction) the last administrator. Removing them is done in
     * CLOR by another administrator.
     */
    if (await protectedFromDirectory(t, u.id)) {
      return fail(res, 403, 'This person owns the account or administers this company; they are removed in CLOR, not by directory sync.', 'mutability');
    }
    if (await wouldRemoveLastAdmin(t.accountId, t.orgId, u.id)) return fail(res, 409, LAST_ADMIN_ERROR.error, 'mutability');
    await platformPrisma.userRoleAssignment.deleteMany({ where: { orgId: t.orgId, userId: u.id } });
    /* Profiles too, as the Users route does: a profile left behind is a set of roles waiting to come back on re-add. */
    await platformPrisma.userRoleProfile.deleteMany({ where: { accountId: t.accountId, orgId: t.orgId, userId: u.id } });
    await platformPrisma.userWarehouseAccess.deleteMany({ where: { accountId: t.accountId, orgId: t.orgId, userId: u.id } });
    await platformPrisma.userBranchMembership.deleteMany({ where: { accountId: t.accountId, orgId: t.orgId, userId: u.id } });
    await platformPrisma.userOrgMembership.deleteMany({ where: { orgId: t.orgId, userId: u.id } });
    /* Their own account's person with nowhere left to sign in to is switched off; a person of another company keeps theirs. */
    if (u.accountId === t.accountId) {
      const elsewhere = await platformPrisma.userOrgMembership.count({ where: { userId: u.id } });
      if (!elsewhere) await platformPrisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    }
    await flagCreatorRemoved({ accountId: t.accountId, userId: u.id, orgIds: [t.orgId] }, 'The person who made it was removed by directory sync', { type: 'SCIM', id: t.id });
    await recordAuthEvent({ accountId: t.accountId, userId: u.id, email: u.email, eventType: 'USER_DEPROVISIONED', ip: clientIp(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 200), detail: 'SCIM directory sync' });
    res.status(204).end();
  }),
);

scimRouter.all(['/Groups', '/Groups/:id'], (_req, res) => fail(res, 501, 'Groups are not provisioned; roles are assigned in CLOR.'));
scimRouter.use((_req, res) => fail(res, 404, 'No such SCIM resource.'));
