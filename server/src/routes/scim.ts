import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';

import { platformPrisma } from '../utils/platformPrisma.js';
import { recordAuthEvent, clientIp } from '../services/auth.js';
import { hashToken } from './publicApi.js';

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

export const newScimToken = () => `clors_${randomBytes(24).toString('base64url')}`;

const scim = (res: Response, status: number, body: unknown) => res.status(status).type('application/scim+json').send(JSON.stringify(body));
const fail = (res: Response, status: number, detail: string, scimType?: string) => scim(res, status, { schemas: [SCHEMA_ERROR], status: String(status), detail, ...(scimType ? { scimType } : {}) });

type Tenant = { id: string; accountId: string; orgId: string; defaultRoleId: string | null };
declare module 'express-serve-static-core' {
  interface Request {
    scim?: Tenant;
  }
}

/** Bearer token → the organisation it provisions. */
scimRouter.use(async (req: Request, res: Response, next: NextFunction) => {
  const m = /^Bearer\s+(clors_[A-Za-z0-9_-]{20,})$/i.exec(String(req.headers.authorization || ''));
  if (!m) return fail(res, 401, 'A bearer token from CLOR’s directory-sync settings is required.');
  const t = await platformPrisma.scimToken.findUnique({ where: { tokenHash: hashToken(m[1]) } });
  if (!t) return fail(res, 401, 'That token is not known (revoked, or made for another server).');
  req.scim = { id: t.id, accountId: t.accountId, orgId: t.orgId, defaultRoleId: t.defaultRoleId };
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
    documentationUri: 'https://clor.in/docs/scim',
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

  let user = await platformPrisma.user.findFirst({ where: { email }, select: SELECT });
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
  }
  if (t.defaultRoleId) {
    await platformPrisma.userRoleAssignment.create({ data: { accountId: t.accountId, orgId: t.orgId, userId: user.id, roleId: t.defaultRoleId, createdByUserId: user.id } }).catch(() => {});
  }
  await recordAuthEvent({ accountId: t.accountId, userId: user.id, email, eventType: 'USER_PROVISIONED', ip, userAgent, detail: 'SCIM directory sync' });
  res.setHeader('Location', `${base(req)}/Users/${user.id}`);
  scim(res, 201, resource(req, user));
});

/** What a replace or a patch may change, applied the same way. */
async function applyChanges(t: Tenant, u: U, changes: { email?: string; fullName?: string; active?: boolean }) {
  const data: any = {};
  if (changes.email && changes.email !== u.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email)) throw Object.assign(new Error('userName must be an e-mail address.'), { status: 400, scimType: 'invalidValue' });
    if (await platformPrisma.user.findFirst({ where: { email: changes.email, NOT: { id: u.id } }, select: { id: true } })) throw Object.assign(new Error(`${changes.email} is already another user’s address.`), { status: 409, scimType: 'uniqueness' });
    data.email = changes.email;
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
    await platformPrisma.userRoleAssignment.deleteMany({ where: { orgId: t.orgId, userId: u.id } });
    await platformPrisma.userOrgMembership.deleteMany({ where: { orgId: t.orgId, userId: u.id } });
    /* Their own account's person with nowhere left to sign in to is switched off; a person of another company keeps theirs. */
    if (u.accountId === t.accountId) {
      const elsewhere = await platformPrisma.userOrgMembership.count({ where: { userId: u.id } });
      if (!elsewhere) await platformPrisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    }
    await recordAuthEvent({ accountId: t.accountId, userId: u.id, email: u.email, eventType: 'USER_DEPROVISIONED', ip: clientIp(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 200), detail: 'SCIM directory sync' });
    res.status(204).end();
  }),
);

scimRouter.all(['/Groups', '/Groups/:id'], (_req, res) => fail(res, 501, 'Groups are not provisioned; roles are assigned in CLOR.'));
scimRouter.use((_req, res) => fail(res, 404, 'No such SCIM resource.'));
